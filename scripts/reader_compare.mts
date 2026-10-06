#!/usr/bin/env tsx
/**
 * reader_compare — can the reader run on a cheaper model?
 *
 * The reader's notes feed everything downstream (they are the only source of
 * cite keys and of the literature numbers the brain reasons from), so a
 * cheaper model is only cheaper if it transcribes as faithfully. This runs the
 * REAL reader definition on the same papers with each candidate model, in a
 * sandbox holding that one paper, and scores the literature fragment two ways:
 *
 *   grounding  mechanical, no judge: every number the note states is looked up
 *              in the paper's own text (LaTeX source or pdftotext). A number
 *              that is not there was mis-transcribed, derived, or invented.
 *   judge      a model from a family that is not a contestant reads the paper
 *              and the notes blind (shuffled labels) and lists each statement
 *              the paper contradicts or does not support.
 *
 * An existing note for the same paper (e.g. the production run's) can be added
 * as a third, free sample: two notes from the SAME model show how much of any
 * difference is run-to-run noise.
 *
 * --append <file> adds that text to the reader's prompt for this run only (try an
 * instruction before writing it into reader.md); --reps N repeats each model.
 *
 *   npx tsx scripts/reader_compare.mts run --project <dir> --papers id1,id2 --models deepseek-v4-pro,deepseek-flash [--reps N] [--append FILE] [--judge anthropic/claude-sonnet-5|none] [--out <dir>]
 *   npx tsx scripts/reader_compare.mts score --out <dir> [--judge M]
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH = join(ROOT, "skills", "search", "scripts", "search");
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

// ── paper text and numbers ───────────────────────────────────────────────────

/** The paper's own text: every .tex under a LaTeX layout, or pdftotext of a flat PDF. */
export function paperText(project: string, paper: string): string {
  const dir = join(project, "data", "papers", paper), pdf = `${dir}.pdf`;
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const out: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tex|bbl)$/.test(f)) out.push(readFileSync(p, "utf-8")); } };
    walk(dir);
    return out.join("\n");
  }
  if (existsSync(pdf)) return spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  return "";
}

const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "−": "-" };
const squash = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻₀-₉−]/g, (c) => SUP[c] ?? c).replace(/[\s{}$\\,~]|\\[,;! ]/g, "");

/**
 * Numbers a note states, as written. Only values specific enough to be
 * checkable: a decimal point, an uncertainty in parentheses, or 3+ digits.
 * Section/figure/equation references and years are dropped.
 */
export function statedNumbers(note: string): string[] {
  const body = note.split("\n").filter((l) => !/^\s*-\s*\*\*(Authors|DOI|Source file)/.test(l)).join("\n")
    // powers of ten are scale, not a stated value: "1.2×10¹³" must not yield "1013"
    .replace(/(?:[×x]|\\times)?\s*10\s*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹⁻−]+|\^\s*\{?\s*[-−]?\d+\s*\}?)/g, " ")
    .replace(/\[(Fig|Eq|Table|Sec|§|Note|Appendix)[^\]]*\]/gi, " ").replace(/\b(Fig|Eq|Table|Ref)s?\.?\s*\(?\d+[a-z]?\)?/gi, " ");
  const found = new Set<string>();
  for (const m of squashKeepSpaces(body).matchAll(/(?<![\w.])\d+(?:\.\d+)?(?:\(\d+\))?(?![\w]*\])/g)) {
    const t = m[0];
    const specific = /\./.test(t) || /\(/.test(t) || t.replace(/\D/g, "").length >= 3;
    if (!specific) continue;
    if (/^(19|20)\d\d$/.test(t)) continue; // a year
    found.add(t);
  }
  return [...found];
}
const squashKeepSpaces = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻₀-₉−]/g, (c) => SUP[c] ?? c);

/** Is this number in the paper? Tried as written, then without its uncertainty. */
export function grounded(num: string, paperSquashed: string): boolean {
  if (paperSquashed.includes(num)) return true;
  const bare = num.replace(/\(\d+\)$/, "");
  if (bare !== num && paperSquashed.includes(bare)) return true;
  // 0.56 written as .56 in old typesetting
  if (bare.startsWith("0.") && paperSquashed.includes(bare.slice(1))) return true;
  return false;
}

// ── trial (child process) ────────────────────────────────────────────────────

async function trial() {
  const dir = arg("--sandbox")!, paper = arg("--paper")!, model = arg("--model")!;
  process.env.LUXAS_PROJECT_DIR = dir;
  const { installUsageTracking } = await import("../src/usage-log.ts");
  installUsageTracking(join(dir, ".agent", "usage.log"), { maxCostUsd: 1 });
  const { spawnAgent, resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const t0 = Date.now();
  const rec: any = { paper, model, started: new Date().toISOString() };
  try {
    resolveModelExact(model);
    // --append: a bench-only prompt variant (text added to the real definition),
    // for trying an instruction before it is written into reader.md.
    const append = arg("--append");
    const { getDefinition } = await import("../src/agents/registry.ts");
    const variant = (name: string) => { const d: any = getDefinition(name); return append && name === "reader" ? { ...d, systemPromptTemplate: `${d.systemPromptTemplate}\n\n${readFileSync(append, "utf-8")}` } : d; };
    const r = await spawnAgent({
      name: "reader", prompt: `Read paper ${paper} and extract methodology + literature entry.`,
      projectDir: dir, getApiKey, exactModel: model, parentAgentId: "bench",
      templateVars: { PROJECT_DIR: dir, PAPER_ID: paper, SEARCH_SCRIPT: SEARCH },
      resolveDefinition: variant as any,
    } as any);
    rec.stopReason = r.exit?.stopReason; rec.errorMessage = r.exit?.errorMessage; rec.toolCalls = r.exit?.toolCallCount;
  } catch (e: any) { rec.stopReason = "harness_error"; rec.errorMessage = String(e?.message ?? e).slice(0, 500); }
  rec.elapsedMs = Date.now() - t0;
  writeFileSync(join(dir, "trial.json"), JSON.stringify(rec, null, 2));
}

// ── run ──────────────────────────────────────────────────────────────────────

const safe = (s: string) => s.replace(/[^\w.-]/g, "_");

async function run() {
  const project = resolve(arg("--project")!), papers = arg("--papers")!.split(","), models = arg("--models")!.split(",");
  const out = resolve(arg("--out", join(homedir(), ".sisyphus", "model-bench", "reader-compare", new Date().toISOString().replace(/[:.]/g, "-")))!);
  mkdirSync(out, { recursive: true });
  // --reps N runs each model N times; a sample key is "model" or "model@rep".
  const reps = Number(arg("--reps", "1")), append = arg("--append");
  const samples = models.flatMap((m) => (reps > 1 ? Array.from({ length: reps }, (_, i) => `${m}@${i + 1}`) : [m]));
  writeFileSync(join(out, "plan.json"), JSON.stringify({ project, papers, models: samples, append: append ?? null }, null, 2));
  const jobs: Promise<void>[] = [];
  for (const paper of papers) for (const key of samples) {
    const model = key.split("@")[0];
    const dir = join(out, `${safe(paper)}__${safe(key)}`);
    for (const d of [".agent", "notes/methodology.d", "notes/literature.d", "report/references.d", "data/papers"]) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(project, "RESEARCH.md"), join(dir, "RESEARCH.md"));
    const src = join(project, "data", "papers", paper);
    if (existsSync(src)) cpSync(src, join(dir, "data", "papers", paper), { recursive: true });
    else cpSync(`${src}.pdf`, join(dir, "data", "papers", `${paper}.pdf`));
    console.log(`▶ ${paper} × ${key}${append ? " (+appended instruction)" : ""}`);
    jobs.push(new Promise((done) => {
      const c = spawn(join(ROOT, "node_modules", ".bin", "tsx"), [fileURLToPath(import.meta.url), "trial", "--sandbox", dir, "--paper", paper, "--model", model, ...(append ? ["--append", resolve(append)] : [])], { stdio: "ignore" });
      const kill = setTimeout(() => c.kill("SIGKILL"), 25 * 60_000);
      c.on("exit", () => { clearTimeout(kill); done(); });
    }));
  }
  await Promise.all(jobs);
  console.log(`\nsandboxes: ${out}`);
  await score(out);
}

// ── score ────────────────────────────────────────────────────────────────────

function usageOf(dir: string) {
  let calls = 0, input = 0, output = 0, cost = 0;
  try { for (const l of readFileSync(join(dir, ".agent", "usage.log"), "utf-8").trim().split("\n")) { const p = l.split("\t"); if (p.length < 8) continue; calls++; input += +p[3] + +p[5] + +p[6]; output += +p[4]; cost += +p[7]; } } catch { /* never reached a model */ }
  return { calls, input, output, cost };
}
/**
 * Tool calls that name a path outside this trial's own sandbox (other trials,
 * the source project). The reader's bash is not confined, and a reader that
 * goes looking can find another sample's note for the same paper — a trial
 * with any of these is contaminated and its score means nothing. Seen
 * 2026-10-06: three trials given a page-image instruction each made 19-24.
 */
export function outsideReads(dir: string): number {
  const convDir = join(dir, ".agent", "conversations");
  if (!existsSync(convDir)) return 0;
  const own = resolve(dir), home = homedir();
  let n = 0;
  for (const f of readdirSync(convDir)) for (const line of readFileSync(join(convDir, f), "utf-8").split("\n")) {
    if (!line.includes('"toolCall"')) continue;
    let m: any; try { const r = JSON.parse(line); m = r.message ?? r; } catch { continue; }
    if (m?.role !== "assistant") continue;
    for (const b of m.content ?? []) {
      if (b?.type !== "toolCall") continue;
      const paths = JSON.stringify(b.arguments ?? {}).match(new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"'\\s;|&)]*`, "g")) ?? [];
      if (paths.some((p) => !p.startsWith(own) && !p.startsWith(ROOT))) n++;
    }
  }
  return n;
}
function noteOf(dir: string): string | null {
  const d = join(dir, "notes", "literature.d");
  const f = existsSync(d) ? readdirSync(d).filter((x) => x.endsWith(".md")) : [];
  return f.length ? readFileSync(join(d, f[0]), "utf-8") : null;
}

async function judgePaper(judgeModel: string, text: string, notes: { key: string; note: string }[]) {
  const { resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
  // Shuffle so the judge cannot learn which label is which model across papers.
  const order = notes.map((n, i) => ({ n, r: Math.random(), i })).sort((a, b) => a.r - b.r).map((x) => x.n);
  const system = "You check literature notes against the paper they were extracted from. Be strict and literal: an error is a statement in a note that the paper contradicts or does not support (wrong number, wrong unit, wrong attribution, a result the paper does not report). Rounding the paper itself uses, and unit conversions that are arithmetically right, are not errors. Reply with JSON only.";
  const user = `PAPER TEXT (source of truth):\n<<<\n${text.slice(0, 180_000)}\n>>>\n\n` +
    order.map((n, i) => `NOTE ${i + 1}:\n<<<\n${n.note}\n>>>`).join("\n\n") +
    `\n\nThe notes were written for a project on using the nuclear spin of fermionic dysprosium for quantum computing.\nFor EACH note return:\n- "errors": [{"claim": "<verbatim from the note>", "paper_says": "<what the paper actually says, or 'not in paper'>", "kind": "wrong_number|wrong_attribution|unsupported|minor"}]\n- "missed": up to 4 results in the paper that clearly bear on that project and that this note leaves out\n- "numbers_checked": how many numeric values of this note you verified against the paper\nThen "ranking": note numbers from most to least faithful-and-useful, and a one-sentence "comment".\nJSON shape: {"notes":[{"note":1,"errors":[],"missed":[],"numbers_checked":0}],"ranking":[1],"comment":""}`;
  const m: any = resolveModelExact(judgeModel);
  const res: any = await completeSimple(m, { systemPrompt: system, messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }], tools: [] },
    { maxTokens: 24000, apiKey: await getApiKey(m.provider) } as any);
  const raw = (res?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`judge returned no JSON (stop=${res?.stopReason} ${String(res?.errorMessage ?? "").slice(0, 120)})`);
  const parsed = JSON.parse(json);
  const cost = res?.usage?.cost?.total ?? 0;
  return {
    cost,
    comment: parsed.comment as string,
    byKey: Object.fromEntries(order.map((n, i) => {
      const e = (parsed.notes ?? []).find((x: any) => x.note === i + 1) ?? {};
      return [n.key, { errors: e.errors ?? [], missed: e.missed ?? [], numbersChecked: e.numbers_checked ?? null, rank: (parsed.ranking ?? []).indexOf(i + 1) + 1 }];
    })),
  };
}

async function score(out: string) {
  const { project, papers, models } = JSON.parse(readFileSync(join(out, "plan.json"), "utf-8"));
  const judgeModel = arg("--judge", "anthropic/claude-sonnet-5")!;
  const rows: any[] = [];
  let judgeCost = 0;
  for (const paper of papers) {
    const text = paperText(project, paper), sq = squash(text);
    const samples: { key: string; model: string; note: string | null; dir?: string }[] = models.map((model: string) => {
      const dir = join(out, `${safe(paper)}__${safe(model)}`);
      return { key: model, model, note: noteOf(dir), dir };
    });
    // The production run's own note for this paper: a free second sample of whatever model wrote it.
    const prodDir = join(project, "notes", "literature.d");
    const prod = existsSync(prodDir) ? readdirSync(prodDir).map((f) => readFileSync(join(prodDir, f), "utf-8")).find((t) => t.includes(`data/papers/${paper}`)) : undefined;
    if (prod) samples.push({ key: "production", model: "production run (deepseek-v4-pro)", note: prod });
    let judged: any = null;
    const withNotes = samples.filter((s) => s.note);
    if (judgeModel !== "none" && withNotes.length >= 2 && text.length > 2000) {
      try { judged = await judgePaper(judgeModel, text, withNotes.map((s) => ({ key: s.key, note: s.note! }))); judgeCost += judged.cost; }
      catch (e: any) { console.log(`  judge failed on ${paper}: ${String(e?.message).slice(0, 160)}`); }
    }
    for (const s of samples) {
      const nums = s.note ? statedNumbers(s.note) : [];
      const missing = nums.filter((n) => !grounded(n, sq));
      const u = s.dir ? usageOf(s.dir) : null;
      const t = s.dir && existsSync(join(s.dir, "trial.json")) ? JSON.parse(readFileSync(join(s.dir, "trial.json"), "utf-8")) : null;
      const filesDone = s.dir ? ["notes/methodology.d", "notes/literature.d", "report/references.d"].filter((d) => readdirSync(join(s.dir!, d)).length > 0).length : null;
      rows.push({ paper, sample: s.model, wrote: !!s.note, filesDone, outside: s.dir ? outsideReads(s.dir) : null, noteChars: s.note?.length ?? 0, numbers: nums.length, ungrounded: missing, cost: u?.cost ?? null, calls: u?.calls ?? null, input: u?.input ?? null, output: u?.output ?? null,
        minutes: t ? t.elapsedMs / 60000 : null, stop: t?.stopReason ?? null, error: t?.errorMessage ?? null,
        judgeErrors: judged?.byKey?.[s.key]?.errors ?? null, judgeMissed: judged?.byKey?.[s.key]?.missed ?? null, judgeRank: judged?.byKey?.[s.key]?.rank ?? null });
    }
    if (judged?.comment) console.log(`  judge on ${paper}: ${judged.comment}`);
  }
  writeFileSync(join(out, "scores.json"), JSON.stringify({ judgeModel, judgeCost, rows }, null, 2));
  console.log("\npaper\tsample\tfiles\tnumbers\tnot_in_paper\tjudge_errors\tjudge_rank\t$\tmin\tcalls\toutside_reads");
  for (const r of rows) console.log([r.paper, r.sample, r.filesDone ?? "-", r.numbers, r.ungrounded.length, r.judgeErrors ? r.judgeErrors.length : "-", r.judgeRank ?? "-", r.cost === null ? "-" : r.cost.toFixed(3), r.minutes === null ? "-" : r.minutes.toFixed(1), r.calls ?? "-", r.outside ?? "-"].join("\t"));
  const dirty = rows.filter((r) => r.outside);
  if (dirty.length) console.log(`\nCONTAMINATED: ${dirty.map((r) => `${r.paper}/${r.sample} (${r.outside})`).join(", ")} read outside their sandbox — do not use their scores.`);
  console.log(`\njudge ${judgeModel}: $${judgeCost.toFixed(3)}.  details: ${join(out, "scores.json")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = argv[0];
  if (cmd === "trial") await trial();
  else if (cmd === "run") await run();
  else if (cmd === "score") await score(resolve(arg("--out")!));
  else { console.error("usage: reader_compare.mts run --project <dir> --papers a,b --models m1,m2 [--judge M] [--out DIR]\n       reader_compare.mts score --out DIR [--judge M]"); process.exit(2); }
}
