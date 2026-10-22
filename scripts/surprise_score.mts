#!/usr/bin/env tsx
/**
 * surprise_score — grade one run of a planted-surprise bench (surprisebench/).
 *
 * The question these benches answer (notes/surprise-ruler-design-2026-10-22.md):
 * when the data hide a phenomenon the task never mentions, does the agent
 * notice it, rule out an artifact, scope it, find the mechanism, still answer
 * the question, and ask the next question? And on clean controls, does it
 * invent one?
 *
 * Two kinds of grading, kept apart:
 *   - X, mechanical: answer.json against oracle.json (true value, tolerance,
 *     the naive value a run gets by ignoring the plant).
 *   - Stages S1–S4, S6 and false alarms, by judges from vendors with no
 *     contestant (CLAUDE.md: a judge panel must include a vendor with no
 *     entrant). Each "yes" must quote the report or transcript; the quote is
 *     checked here, and a quote that is not there turns the verdict to "no".
 *     A stage is "yes" only when every judge says yes with a verified quote.
 *
 * Usage:
 *   npx tsx scripts/surprise_score.mts <run-dir> --bench <variant> [--arm <arm>] [--judges deepseek-v4-pro,glm-5.3] [--no-judge]
 *   npx tsx scripts/surprise_score.mts --validate [--judges ...] [--only <case-id,...>]
 *        the hand-written reports in surprisebench/_validation/cases.json; every
 *        expected verdict must come out before any arm is run.
 *
 * Writes <run-dir>/surprise_score.json and appends one row to surprisebench/SCORES.jsonl.
 * The judges cost money (DeepSeek, GLM); --no-judge grades X only, for free.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH_ROOT = join(ROOT, "surprisebench");
export const SCORES = join(BENCH_ROOT, "SCORES.jsonl");
export const PLANTED_STAGES = ["S1_noticed", "S2_artifact_check", "S3_scope", "S4_mechanism", "S6_new_question"] as const;
const DEFAULT_JUDGES = ["deepseek-v4-pro", "glm-5.3"];
// GLM 5.3 always thinks and refuses a request without a level ("请使用 low、high 或 max").
const REASONING: Record<string, string> = { "glm-5.3": "low" };
const DIGEST_CHARS = 30_000;
const REPORT_CHARS = 30_000;

type Num = number;
interface AnswerKey { true: Num | Record<string, Num>; tol_rel: number; naive?: Num; also_accept?: Num[] }
export interface Oracle { task: string; variant: "planted" | "clean"; answer: Record<string, AnswerKey>; plant: string; stages?: Record<string, string>; false_alarm: string }

export function loadOracle(bench: string): Oracle {
  return JSON.parse(readFileSync(join(BENCH_ROOT, bench, "oracle.json"), "utf-8"));
}

// ── X, mechanical ────────────────────────────────────────────────────────────

const within = (v: number, t: number, tol: number) => Math.abs(v - t) <= tol * Math.abs(t);

function readAnswer(runDir: string): Record<string, unknown> | null {
  for (const p of ["answer.json", "data/answer.json", "report/answer.json"]) {
    const f = join(runDir, p);
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf-8");
    try { return JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } } }
  }
  return null;
}

export type XVerdict = "correct" | "naive" | "wrong" | "missing";
export function gradeX(answer: Record<string, unknown> | null, oracle: Oracle): { keys: Record<string, { value: unknown; verdict: XVerdict }>; correct: boolean } {
  const keys: Record<string, { value: unknown; verdict: XVerdict }> = {};
  const one = (v: unknown, k: AnswerKey, t: number): XVerdict => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "missing";
    if (within(v, t, k.tol_rel) || (k.also_accept ?? []).some((a) => within(v, a, k.tol_rel))) return "correct";
    if (k.naive !== undefined && within(v, k.naive, k.tol_rel)) return "naive";
    return "wrong";
  };
  for (const [name, k] of Object.entries(oracle.answer)) {
    const v = answer?.[name];
    if (typeof k.true === "number") { keys[name] = { value: v ?? null, verdict: one(v, k, k.true) }; continue; }
    // A per-case dict (s3): every case must be right; the worst verdict stands.
    const order: XVerdict[] = ["missing", "wrong", "naive", "correct"];
    const sub = Object.entries(k.true).map(([c, t]) => one((v as any)?.[c], k, t));
    keys[name] = { value: v ?? null, verdict: sub.reduce((w, x) => (order.indexOf(x) < order.indexOf(w) ? x : w), "correct" as XVerdict) };
  }
  return { keys, correct: Object.values(keys).every((x) => x.verdict === "correct") };
}

// ── what the judges read ──────────────────────────────────────────────────────

export function reportText(runDir: string): string {
  for (const p of ["report/report.tex", "report/report.md", "report.md", "REPORT.md"]) {
    const f = join(runDir, p);
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf-8");
    // A LaTeX comment starts at an unescaped %; in Markdown "30%" is text (stripping it cut a prediction in half).
    return (p.endsWith(".tex") ? text.replace(/(^|[^\\])%.*$/gm, "$1") : text).slice(0, REPORT_CHARS);
  }
  // No report: the run's last message is all there is.
  try { return String(JSON.parse(readFileSync(join(runDir, "claude_result.json"), "utf-8"))?.result ?? "").slice(0, REPORT_CHARS); } catch { return ""; }
}

/** Claude Code stream-json → one line per text block, tool call and (truncated) tool result. */
export function transcriptDigest(runDir: string, cap = DIGEST_CHARS): string {
  const f = join(runDir, "claude_transcript.jsonl");
  if (!existsSync(f)) return "";
  const out: string[] = [];
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ` …[${s.length - n} more chars]` : s);
  for (const line of readFileSync(f, "utf-8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(e?.message?.content) ? e.message.content : [];
    for (const b of content) {
      if (e.type === "assistant" && b?.type === "text" && b.text?.trim()) out.push(`[assistant] ${clip(b.text.trim(), 800)}`);
      else if (e.type === "assistant" && b?.type === "tool_use") {
        const i = b.input ?? {};
        const what = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.query ?? JSON.stringify(i);
        const body = typeof i.content === "string" ? `\n${clip(i.content, 500)}` : typeof i.new_string === "string" ? `\n${clip(i.new_string, 300)}` : "";
        out.push(`[tool ${b.name}] ${clip(String(what), 600)}${body}`);
      } else if (e.type === "user" && b?.type === "tool_result") {
        const txt = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? "").join("\n") : "";
        if (txt.trim()) out.push(`[result${b.is_error ? " ERROR" : ""}] ${clip(txt.trim(), 700)}`);
      }
    }
  }
  const all = out.join("\n");
  if (all.length <= cap) return all;
  const half = Math.floor(cap / 2);
  return `${all.slice(0, half)}\n…[${all.length - cap} chars of the middle omitted]…\n${all.slice(-half)}`;
}

/** Lower-case, LaTeX and punctuation stripped, whitespace collapsed: what a quote is matched in. */
export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/\\[a-z]+\*?/g, " ")
    .replace(/[‐-―−]/g, "-").replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[{}$\\~^_*#>|]/g, " ")
    .replace(/[^a-z0-9.,:;%+\-=/()'"<\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** A quote counts when it, or 70% of its 24-character windows, appear in the surface. */
export function quoteFound(quote: string, surface: string): boolean {
  const q = normalize(quote), s = normalize(surface);
  if (q.length < 8) return false;
  if (s.includes(q)) return true;
  if (q.length < 24) return false;
  let hit = 0, n = 0;
  for (let i = 0; i + 24 <= q.length; i += 8) { n++; if (s.includes(q.slice(i, i + 24))) hit++; }
  return n > 0 && hit / n >= 0.7;
}

// ── judges ───────────────────────────────────────────────────────────────────

const SYSTEM = [
  "You grade one run of a research agent against a hidden answer key. The data given to the agent contained a phenomenon the task did not mention (or, for a control, nothing extra).",
  "Judge each stage separately and literally from what the REPORT or the TRANSCRIPT actually contains. Credit only what was said or done, not what was implied, intended or would have been easy.",
  "For every stage answer \"yes\" or \"no\". For \"yes\", give a verbatim quote (at most 300 characters) from the report or transcript that shows it; copy it exactly. For \"no\", give an empty quote.",
  "Generic hedges (\"there may be systematic errors\", \"the fit is not perfect\") do not count as noticing a specific phenomenon.",
  "Reply with JSON only.",
].join("\n");

export function judgeUser(oracle: Oracle, task: string, report: string, digest: string, answer: unknown): { user: string; stages: string[] } {
  const stages = oracle.variant === "planted" ? [...PLANTED_STAGES] : ["false_alarm"];
  const crit = oracle.variant === "planted"
    ? PLANTED_STAGES.map((s) => `- ${s}: ${oracle.stages?.[s] ?? ""}`).join("\n")
    : `- false_alarm: ${oracle.false_alarm}`;
  const user =
    `TASK GIVEN TO THE AGENT:\n<<<\n${task.trim()}\n>>>\n\n` +
    `HIDDEN KEY — what was in the data:\n${oracle.plant}\n\nSTAGES TO JUDGE:\n${crit}\n\n` +
    `REPORT:\n<<<\n${report || "(no report)"}\n>>>\n\nANSWER FILE:\n${JSON.stringify(answer)}\n\n` +
    `TRANSCRIPT DIGEST (tool calls and outputs, truncated):\n<<<\n${digest || "(none)"}\n>>>\n\n` +
    `Return {"stages": {${stages.map((s) => `"${s}": {"verdict": "yes|no", "quote": "..."}`).join(", ")}}}`;
  return { user, stages };
}

async function callJudge(modelId: string, user: string): Promise<{ raw: any; cost: number; error?: string }> {
  const { resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
  const m: any = resolveModelExact(modelId);
  try {
    const res: any = await completeSimple(m, { systemPrompt: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }], tools: [] } as any,
      { maxTokens: 32_000, apiKey: await getApiKey(m.provider), ...(REASONING[modelId] ? { reasoning: REASONING[modelId] } : {}) } as any);
    const text = (res?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const cost = res?.usage?.cost?.total ?? 0;
    if (!json) return { raw: null, cost, error: `no JSON (stop=${res?.stopReason} ${String(res?.errorMessage ?? "").slice(0, 120)})` };
    return { raw: JSON.parse(json), cost };
  } catch (err) {
    return { raw: null, cost: 0, error: (err as Error).message.slice(0, 200) };
  }
}

export interface StageResult { verdict: "yes" | "no"; byJudge: Record<string, { said: string; quote: string; quoteFound: boolean }> }

export async function judgeRun(runDir: string, oracle: Oracle, task: string, judges: string[]) {
  const report = reportText(runDir), digest = transcriptDigest(runDir), answer = readAnswer(runDir);
  const { user, stages } = judgeUser(oracle, task, report, digest, answer);
  const surface = `${report}\n${digest}\n${JSON.stringify(answer)}`;
  const replies = await Promise.all(judges.map(async (j) => ({ j, ...(await callJudge(j, user)) })));
  const out: Record<string, StageResult> = {};
  for (const s of stages) {
    const byJudge: StageResult["byJudge"] = {};
    for (const r of replies) {
      const v = r.raw?.stages?.[s] ?? {};
      const said = String(v.verdict ?? (r.error ? "error" : "missing")).toLowerCase();
      const quote = String(v.quote ?? "");
      byJudge[r.j] = { said, quote: quote.slice(0, 300), quoteFound: said === "yes" ? quoteFound(quote, surface) : false };
    }
    const yes = Object.values(byJudge).every((b) => b.said === "yes" && b.quoteFound);
    out[s] = { verdict: yes ? "yes" : "no", byJudge };
  }
  return { stages: out, cost: replies.reduce((a, r) => a + r.cost, 0), errors: replies.filter((r) => r.error).map((r) => `${r.j}: ${r.error}`) };
}

export async function scoreRun(runDir: string, bench: string, o: { judges: string[]; arm?: string }) {
  const oracle = loadOracle(bench);
  const task = readFileSync(join(BENCH_ROOT, bench, "RESEARCH.md"), "utf-8");
  const x = gradeX(readAnswer(runDir), oracle);
  const judged = o.judges.length ? await judgeRun(runDir, oracle, task, o.judges) : null;
  const row = {
    ts: new Date().toISOString(), run: resolve(runDir), bench, variant: oracle.variant, arm: o.arm ?? null,
    x, stages: judged?.stages ?? null, judges: o.judges, judgeCostUsd: judged ? Number(judged.cost.toFixed(4)) : 0, judgeErrors: judged?.errors ?? [],
  };
  writeFileSync(join(runDir, "surprise_score.json"), JSON.stringify(row, null, 2) + "\n");
  return row;
}

// ── validation on hand-written reports ───────────────────────────────────────

interface Case { id: string; bench: string; report: string; tools?: { cmd: string; out: string }[]; answer: Record<string, unknown>; expect: Record<string, "yes" | "no"> }

function materialize(c: Case): string {
  const dir = mkdtempSync(join(tmpdir(), `surprise-val-${c.id}-`));
  mkdirSync(join(dir, "report"), { recursive: true });
  writeFileSync(join(dir, "report", "report.md"), c.report);
  writeFileSync(join(dir, "answer.json"), JSON.stringify(c.answer));
  const lines: string[] = [];
  (c.tools ?? []).forEach((t, i) => {
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command: t.cmd } }] } }));
    lines.push(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: t.out }] } }));
  });
  writeFileSync(join(dir, "claude_transcript.jsonl"), lines.join("\n") + "\n");
  return dir;
}

async function validate(judges: string[], only?: Set<string>) {
  const cases: Case[] = JSON.parse(readFileSync(join(BENCH_ROOT, "_validation", "cases.json"), "utf-8")).filter((c: Case) => !only || only.has(c.id));
  let wrong = 0, cost = 0;
  const rows: string[] = [];
  // Four cases at a time: GLM answers 429 to a burst (ba-qc, 2026-09).
  const queue = [...cases];
  const worker = async () => { for (let c = queue.shift(); c; c = queue.shift()) await one(c); };
  const one = async (c: Case) => {
    const dir = materialize(c);
    try {
      const oracle = loadOracle(c.bench);
      const task = readFileSync(join(BENCH_ROOT, c.bench, "RESEARCH.md"), "utf-8");
      const r = await judgeRun(dir, oracle, task, judges);
      cost += r.cost;
      for (const [s, want] of Object.entries(c.expect)) {
        const got = r.stages[s]?.verdict;
        const ok = got === want;
        if (!ok) wrong++;
        const detail = Object.entries(r.stages[s]?.byJudge ?? {}).map(([j, b]) => `${j.split("-")[0]}:${b.said}${b.said === "yes" ? (b.quoteFound ? "" : `(quote not found: "${b.quote.slice(0, 90)}")`) : ""}`).join(" ");
        rows.push(`${ok ? "ok  " : "BAD "} ${c.id.padEnd(22)} ${s.padEnd(18)} want ${want} got ${got}  [${detail}]`);
      }
      if (r.errors.length) rows.push(`ERR  ${c.id}: ${r.errors.join(" | ")}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(rows.sort().join("\n"));
  console.log(`\n${wrong === 0 ? "VALID" : `${wrong} verdict(s) wrong`} — ${cases.length} cases, judges ${judges.join(", ")}, $${cost.toFixed(3)}`);
  return wrong;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const judges = argv.includes("--no-judge") ? [] : (flag("--judges")?.split(",").filter(Boolean) ?? DEFAULT_JUDGES);
  if (argv.includes("--validate")) {
    const only = flag("--only") ? new Set(flag("--only")!.split(",")) : undefined;
    process.exit((await validate(judges, only)) === 0 ? 0 : 1);
  }
  const runDir = argv.find((a) => !a.startsWith("--") && existsSync(a));
  const bench = flag("--bench");
  if (!runDir || !bench) { console.error("usage: surprise_score.mts <run-dir> --bench <variant> [--arm A] [--judges a,b] [--no-judge] | --validate [--judges a,b] [--only ids]"); process.exit(2); }
  const row = await scoreRun(runDir, bench, { judges, arm: flag("--arm") });
  appendFileSync(SCORES, JSON.stringify(row) + "\n");
  const st = row.stages ? Object.entries(row.stages).map(([s, v]) => `${s}=${(v as StageResult).verdict}`).join(" ") : "(not judged)";
  console.log(`${basename(runDir)} ${bench}: X ${row.x.correct ? "correct" : Object.entries(row.x.keys).map(([k, v]) => `${k}:${v.verdict}`).join(",")} | ${st} | judges $${row.judgeCostUsd}${row.judgeErrors.length ? ` | ERR ${row.judgeErrors.join("; ")}` : ""}`);
}
