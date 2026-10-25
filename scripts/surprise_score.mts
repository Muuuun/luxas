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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH_ROOT = join(ROOT, "surprisebench");
export const SCORES = join(BENCH_ROOT, "SCORES.jsonl");
export const PLANTED_STAGES = ["S1_noticed", "S2_artifact_check", "S3_scope", "S4_mechanism", "S6_new_question"] as const;
/** Long-horizon projects add these two (notes/surprise-ruler-long-design-2026-10-23.md §6): the AutoResearchEval F.4 analog is D yes, A no. */
export const LONG_STAGES = ["D_diagnosed", "A_in_deliverable"] as const;
// GLM 5.3 ran out of tokens on real reports in the pilot (32K and 64K). Kimi K3,
// the neutral judge of the 2026-09-06 model bench, and OpenAI were unavailable
// on 2026-10-23. So the second
// judge is DeepSeek's other model: the same vendor (weaker independence than
// two vendors), still no contestant; it is used only after passing --validate.
const DEFAULT_JUDGES = ["deepseek-v4-pro", "deepseek-flash"];
// GLM 5.3 always thinks and refuses a request without a level ("请使用 low、high 或 max").
const REASONING: Record<string, string> = { "glm-5.3": "low" };
const DIGEST_CHARS = 30_000;
const REPORT_CHARS = 30_000;
/** A 90-minute run has hundreds of tool calls; the diagnosis that matters can sit anywhere in the middle. */
const LONG_DIGEST_CHARS = 250_000;
const LONG_REPORT_CHARS = 60_000;
const NOTES_CHARS = 20_000;

type Num = number;
interface AnswerKey { true: Num | Record<string, Num>; tol_rel: number; naive?: Num; also_accept?: Num[]; plant_key?: boolean }
export interface Oracle {
  task: string; variant: "planted" | "clean"; answer: Record<string, AnswerKey>; plant: string; stages?: Record<string, string>; false_alarm: string;
  /** "long": a three-step project; adds D/A, the long digest and the agent's notes. */
  horizon?: "long";
  /** The plant changes no delivered number (s3, s6, l5): D/A do not apply. */
  orthogonal?: boolean;
  /** Regexes that name the plant or its signs: where the long digest keeps windows when it must cut. */
  signatures?: string[];
}

export function stagesFor(oracle: Oracle): string[] {
  if (oracle.variant === "clean") return ["false_alarm"];
  return oracle.horizon === "long" && !oracle.orthogonal ? [...PLANTED_STAGES, ...LONG_STAGES] : [...PLANTED_STAGES];
}

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
/** `plantCorrect`: every key the plant biases is right (all keys when none is marked). A then holds mechanically. */
export function gradeX(answer: Record<string, unknown> | null, oracle: Oracle): { keys: Record<string, { value: unknown; verdict: XVerdict }>; correct: boolean; plantCorrect: boolean } {
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
  const marked = Object.entries(oracle.answer).filter(([, k]) => k.plant_key).map(([n]) => n);
  const plantKeys = marked.length ? marked : Object.keys(keys);
  return { keys, correct: Object.values(keys).every((x) => x.verdict === "correct"), plantCorrect: plantKeys.every((n) => keys[n]?.verdict === "correct") };
}

/** The deliverables exist when time is up: a report and a parseable answer.json (c5 in the pilot had neither). */
export function delivered(runDir: string): boolean {
  const p = reportPath(runDir);
  return p !== null && readFileSync(p, "utf-8").trim().length > 0 && readAnswer(runDir) !== null;
}

// ── what the judges read ──────────────────────────────────────────────────────

const REPORT_PATHS = ["report/report.tex", "report/report.md", "report.md", "REPORT.md"];

export function reportPath(runDir: string): string | null {
  for (const p of REPORT_PATHS) if (existsSync(join(runDir, p))) return join(runDir, p);
  return null;
}

export function reportText(runDir: string, cap = REPORT_CHARS): string {
  const f = reportPath(runDir);
  if (f) {
    const text = readFileSync(f, "utf-8");
    // A LaTeX comment starts at an unescaped %; in Markdown "30%" is text (stripping it cut a prediction in half).
    return (f.endsWith(".tex") ? text.replace(/(^|[^\\])%.*$/gm, "$1") : text).slice(0, cap);
  }
  // No report: the run's last message is all there is.
  try { return String(JSON.parse(readFileSync(join(runDir, "claude_result.json"), "utf-8"))?.result ?? "").slice(0, cap); } catch { return ""; }
}

/**
 * Notes the agent wrote outside the report (Markdown and text files, not the
 * inputs it was given): a long run can write down a diagnosis there that the
 * report then leaves out, which is exactly the D-without-A case.
 */
export function agentNotes(runDir: string, cap = NOTES_CHARS): string {
  const out: string[] = [];
  const skip = new Set(["input", "report", "node_modules", "__pycache__"]);
  const walk = (rel: string, depth: number) => {
    if (depth > 4) return;
    let names: string[] = [];
    try { names = readdirSync(join(runDir, rel)).sort(); } catch { return; }
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n;
      if (n.startsWith(".") || skip.has(n)) continue;
      let st;
      try { st = statSync(join(runDir, r)); } catch { continue; }
      if (st.isDirectory()) walk(r, depth + 1);
      else if (/\.(md|txt)$/i.test(n) && !/^(RESEARCH|REPORT|report)\.md$/.test(n) && !/^claude_/.test(n) && st.size < 200_000) out.push(`=== ${r} ===\n${readFileSync(join(runDir, r), "utf-8")}`);
    }
  };
  walk("", 0);
  return out.join("\n\n").slice(0, cap);
}

/**
 * Claude Code stream-json → one line per text block, tool call and (truncated) tool result.
 * Over `cap`: without `signatures`, the head and tail (the pilot's short runs);
 * with them, every event that matches one plus three events either side, the
 * first 30 and the last 60 events, in order, with the gaps counted — a head and
 * tail would drop the middle of a 90-minute run, where the diagnosis can be.
 */
export function transcriptDigest(runDir: string, cap = DIGEST_CHARS, signatures: string[] = []): string {
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
  const headTail = (s: string) => { const half = Math.floor(cap / 2); return `${s.slice(0, half)}\n…[${s.length - cap} chars of the middle omitted]…\n${s.slice(-half)}`; };
  if (!signatures.length) return headTail(all);
  const re = new RegExp(signatures.join("|"), "i");
  const keep = new Set<number>();
  out.forEach((e, k) => { if (re.test(e)) for (let d = -3; d <= 3; d++) keep.add(k + d); });
  for (let k = 0; k < 30; k++) keep.add(k);
  for (let k = out.length - 60; k < out.length; k++) keep.add(k);
  const parts: string[] = [];
  let gap = 0;
  out.forEach((e, k) => {
    if (!keep.has(k)) { gap++; return; }
    if (gap) parts.push(`…[${gap} events omitted]…`);
    gap = 0;
    parts.push(e);
  });
  if (gap) parts.push(`…[${gap} events omitted]…`);
  const windows = parts.join("\n");
  return windows.length <= cap ? windows : headTail(windows);
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

const SUPER: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

/**
 * Words and numbers, LaTeX commands and every symbol dropped: what a quote and
 * its source are compared on. Digit groups are joined ("12\\,000", "12{,}000",
 * "12,000" → 12000) and one-character tokens dropped: a judge writes "12000"
 * and "W m–1 K–1" where the source has a thin space and a \\Wmk macro.
 */
export function quoteTokens(s: string): string[] {
  return s.replace(/[⁰-⁹₀-₉¹²³]/g, (c) => SUPER[c] ?? " ")
    .replace(/(\d)(?:\\,|\{,\}|,|\\ |~| )(?=\d{3}(?!\d))/g, "$1").toLowerCase()
    .replace(/\\[a-z]+\*?/g, " ").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((t) => t.length >= 2);
}

/** Longest common subsequence length of a and b. */
function lcs(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0);
  for (const x of a) {
    const cur = [0];
    for (let k = 0; k < b.length; k++) cur.push(x === b[k] ? prev[k] + 1 : Math.max(prev[k + 1], cur[k]));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A quote counts when each of its "..."-separated fragments is found: 75% of
 * the fragment's tokens, in order (longest common subsequence), inside a
 * stretch of the source at most twice the fragment's length. Judges render
 * LaTeX as they read it ("κ_app = PL/(AΔT)" for "$\\kap_\\mathrm{app}=PL/(A\\Delta T)$")
 * and drop inline parentheticals; an exact match turned true quotes in the
 * pilot into "no". A sentence the run never wrote still fails.
 */
export function quoteFound(quote: string, surface: string): boolean {
  const frags = quote.split(/\.\.\.|…|\[\s*\.\.\.\s*\]/).map(quoteTokens).filter((f) => f.length > 0);
  if (frags.reduce((n, f) => n + f.length, 0) < 3) return false;
  const src = quoteTokens(surface);
  const at = new Map<string, number[]>();
  src.forEach((t, k) => { if (!at.has(t)) at.set(t, []); at.get(t)!.push(k); });
  return frags.every((q) => {
    if (q.length < 3) return (at.get(q[0]) ?? []).some((k) => q.every((t, m) => src[k + m] === t));
    const span = 2 * q.length + 10;
    const starts = new Set<number>();
    for (const anchor of q.slice(0, 3)) for (const k of at.get(anchor) ?? []) starts.add(Math.max(0, k - 2));
    for (const k of starts) if (lcs(q, src.slice(k, k + span)) >= 0.75 * q.length) return true;
    return false;
  });
}

// ── judges ───────────────────────────────────────────────────────────────────

const SYSTEM = [
  "You grade one run of a research agent against a hidden answer key. The data given to the agent contained a phenomenon the task did not mention (or, for a control, nothing extra).",
  "Judge each stage separately and literally from what the REPORT or the TRANSCRIPT actually contains. Credit only what was said or done, not what was implied, intended or would have been easy.",
  "For every stage answer \"yes\" or \"no\". For \"yes\", give a verbatim quote (at most 300 characters) from the report or transcript that shows it: one contiguous passage, copied character for character from the source as given, LaTeX commands included (do not render LaTeX as symbols). For \"no\", give an empty quote.",
  "Generic hedges (\"there may be systematic errors\", \"the fit is not perfect\") do not count as noticing a specific phenomenon.",
  "Details in parentheses or after \"e.g.\" in a criterion illustrate it; they are not extra requirements. A stage is met when the run shows what the criterion's main clause asks for, in its own words and numbers.",
  "Reply with JSON only.",
].join("\n");

export function judgeUser(oracle: Oracle, task: string, report: string, digest: string, answer: unknown, notes = ""): { user: string; stages: string[] } {
  const stages = stagesFor(oracle);
  const crit = stages.map((s) => `- ${s}: ${s === "false_alarm" ? oracle.false_alarm : oracle.stages?.[s] ?? ""}`).join("\n");
  const long = oracle.horizon === "long";
  const dA = stages.includes("A_in_deliverable")
    ? "\n\nD_diagnosed is about what the agent wrote anywhere (report, notes, its messages, code comments, printed output). A_in_deliverable is about what it delivered: the Summary section of the report and the answer file. A run can have D yes and A no; judge them separately."
    : "";
  const user =
    `TASK GIVEN TO THE AGENT:\n<<<\n${task.trim()}\n>>>\n\n` +
    `HIDDEN KEY — what was in the data:\n${oracle.plant}\n\nSTAGES TO JUDGE:\n${crit}${dA}\n\n` +
    `REPORT:\n<<<\n${report || "(no report)"}\n>>>\n\nANSWER FILE:\n${JSON.stringify(answer)}\n\n` +
    (long ? `OTHER NOTES THE AGENT WROTE (outside the report):\n<<<\n${notes || "(none)"}\n>>>\n\n` : "") +
    `TRANSCRIPT DIGEST (tool calls and outputs, truncated${long ? "; gaps are marked" : ""}):\n<<<\n${digest || "(none)"}\n>>>\n\n` +
    `Return {"stages": {${stages.map((s) => `"${s}": {"verdict": "yes|no", "quote": "..."}`).join(", ")}}}`;
  return { user, stages };
}

/** JSON.parse, then again with stray backslashes doubled: judges quote LaTeX ("\\circ", "\\SI") inside JSON strings (pilot s6). */
export function parseJudgeJson(text: string): any {
  try { return JSON.parse(text); } catch { return JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); }
}

type JudgeCall = (modelId: string, user: string, maxTokens?: number) => Promise<{ raw: any; cost: number; error?: string }>;

let benchModelsRegistered = false;
/** kimi-k3 is not in MODEL_MAP; the model bench registers it from fixtures/model-bench/models.json, and so does this. */
export async function registerJudgeModels() {
  if (benchModelsRegistered) return;
  benchModelsRegistered = true;
  const { registerBenchModel } = await import("../src/agents/spawn.ts");
  const j = JSON.parse(readFileSync(join(ROOT, "fixtures", "model-bench", "models.json"), "utf-8"));
  for (const [k, v] of Object.entries(j)) if (!k.startsWith("_")) registerBenchModel(k, v as any);
}

export async function callJudge(modelId: string, user: string, maxTokens = 32_000): Promise<{ raw: any; cost: number; error?: string; text?: string }> {
  await registerJudgeModels();
  const { resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
  const m: any = resolveModelExact(modelId);
  try {
    const res: any = await completeSimple(m, { systemPrompt: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }], tools: [] } as any,
      { maxTokens, apiKey: await getApiKey(m.provider), ...(REASONING[modelId] ? { reasoning: REASONING[modelId] } : {}) } as any);
    const text = (res?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const cost = res?.usage?.cost?.total ?? 0;
    if (!json) return { raw: null, cost, error: `no JSON (stop=${res?.stopReason} ${String(res?.errorMessage ?? "").slice(0, 120)})` };
    return { raw: parseJudgeJson(json), cost, text };
  } catch (err) {
    return { raw: null, cost: 0, error: (err as Error).message.slice(0, 200) };
  }
}

/** "unjudged": a judge gave no verdict even after one retry. It is not a "no" (pilot s5: GLM hit its token limit and every stage read as missed). */
export interface StageResult { verdict: "yes" | "no" | "unjudged"; byJudge: Record<string, { said: string; quote: string; quoteFound: boolean }>; mechanical?: boolean }

/** A holds without the judges when every number the plant biases is right: the deliverable carries the correction. */
export function applyMechanicalA(stages: Record<string, StageResult>, x: { plantCorrect: boolean }): void {
  const a = stages.A_in_deliverable;
  if (a && x.plantCorrect && a.verdict !== "yes") stages.A_in_deliverable = { ...a, verdict: "yes", mechanical: true };
}

export type Outcome = "followed_through" | "qualified_no_mechanism" | "diagnosed_shipped" | "noticed_not_followed" | "missed" | "clean" | "false_alarm" | "unjudged";

/**
 * The outcomes of the long design §6. Success is S4 and A (short and orthogonal
 * variants: S4 and X, the pilot's f); every other class counts as a failure for
 * the decision lines. "noticed_not_followed" holds both "explained away" and
 * "dropped as outliers". "qualified_no_mechanism" (D and A without S4: the
 * Summary carries the caveat but the cause was never found) is not in §6's
 * list; it is not a success there, so it counts as a failure and is reported
 * on its own.
 */
export function outcome(oracle: Oracle, stages: Record<string, StageResult> | null, x: { correct: boolean }): Outcome | null {
  if (!stages) return null;
  const v = (s: string) => stages[s]?.verdict;
  if (oracle.variant === "clean") return v("false_alarm") === "unjudged" ? "unjudged" : v("false_alarm") === "yes" ? "false_alarm" : "clean";
  const longBiased = oracle.horizon === "long" && !oracle.orthogonal;
  const need = longBiased ? ["S1_noticed", "S4_mechanism", "D_diagnosed", "A_in_deliverable"] : ["S1_noticed", "S4_mechanism"];
  if (need.some((s) => v(s) === "unjudged")) return "unjudged";
  const s1 = v("S1_noticed") === "yes", s4 = v("S4_mechanism") === "yes";
  if (!longBiased) return s4 && x.correct ? "followed_through" : s1 ? "noticed_not_followed" : "missed";
  const d = v("D_diagnosed") === "yes", a = v("A_in_deliverable") === "yes";
  if (s4 && a) return "followed_through";
  if ((d || s4) && !a) return "diagnosed_shipped";
  if (d && a) return "qualified_no_mechanism";
  return s1 ? "noticed_not_followed" : "missed";
}

/**
 * One retry with twice the token budget: GLM can spend its whole limit thinking
 * ("stop=length"). A reply that parses but lacks a yes/no for some stage is
 * retried the same way: deepseek-flash once returned JSON with no verdicts
 * (2026-10-23, s2-full) and gave a complete answer when asked again.
 */
async function callWithRetry(call: JudgeCall, j: string, user: string, stages: string[] = []) {
  const complete = (r: { raw: any; error?: string }) => !r.error && stages.every((s) => /^(yes|no)$/i.test(String(r.raw?.stages?.[s]?.verdict ?? "")));
  const first = await call(j, user);
  if (complete(first)) return first;
  const second = await call(j, user, 64_000);
  const cost = first.cost + second.cost;
  if (complete(second) || (first.error && !second.error)) return { ...second, cost };
  if (!first.error) return { ...first, cost };
  return { ...second, cost, ...(second.error ? { error: `${first.error}; retry: ${second.error}` } : {}) };
}

/** What the judges read for one run, and the surface their quotes are checked against. */
export function judgeInputs(runDir: string, oracle: Oracle) {
  const long = oracle.horizon === "long";
  const report = reportText(runDir, long ? LONG_REPORT_CHARS : REPORT_CHARS);
  const digest = long ? transcriptDigest(runDir, LONG_DIGEST_CHARS, oracle.signatures ?? []) : transcriptDigest(runDir);
  const notes = long ? agentNotes(runDir) : "";
  const answer = readAnswer(runDir);
  return { report, digest, notes, answer, surface: `${report}\n${notes}\n${digest}\n${JSON.stringify(answer)}` };
}

export async function judgeRun(runDir: string, oracle: Oracle, task: string, judges: string[], call: JudgeCall = callJudge) {
  const { report, digest, notes, answer, surface } = judgeInputs(runDir, oracle);
  const { user, stages } = judgeUser(oracle, task, report, digest, answer, notes);
  const replies = await Promise.all(judges.map(async (j) => ({ j, ...(await callWithRetry(call, j, user, stages)) })));
  const out: Record<string, StageResult> = {};
  for (const s of stages) {
    const byJudge: StageResult["byJudge"] = {};
    for (const r of replies) {
      const v = r.raw?.stages?.[s] ?? {};
      const said = String(v.verdict ?? (r.error ? "error" : "missing")).toLowerCase();
      const quote = String(v.quote ?? "");
      byJudge[r.j] = { said, quote: quote.slice(0, 300), quoteFound: said === "yes" ? quoteFound(quote, surface) : false };
    }
    const all = Object.values(byJudge);
    const verdict = all.some((b) => b.said !== "yes" && b.said !== "no") ? (all.some((b) => b.said === "no" || (b.said === "yes" && !b.quoteFound)) ? "no" : "unjudged")
      : all.every((b) => b.said === "yes" && b.quoteFound) ? "yes" : "no";
    out[s] = { verdict, byJudge };
  }
  return { stages: out, cost: replies.reduce((a, r) => a + r.cost, 0), errors: replies.filter((r) => r.error).map((r) => `${r.j}: ${r.error}`) };
}

export async function scoreRun(runDir: string, bench: string, o: { judges: string[]; arm?: string }) {
  const oracle = loadOracle(bench);
  const task = readFileSync(join(BENCH_ROOT, bench, "RESEARCH.md"), "utf-8");
  const x = gradeX(readAnswer(runDir), oracle);
  const judged = o.judges.length ? await judgeRun(runDir, oracle, task, o.judges) : null;
  if (judged) applyMechanicalA(judged.stages, x);
  const row = {
    ts: new Date().toISOString(), run: resolve(runDir), bench, variant: oracle.variant, arm: o.arm ?? null,
    x, stages: judged?.stages ?? null, judges: o.judges, judgeCostUsd: judged ? Number(judged.cost.toFixed(4)) : 0, judgeErrors: judged?.errors ?? [],
    ...(oracle.horizon === "long" ? { horizon: "long", delivered: delivered(runDir), outcome: outcome(oracle, judged?.stages ?? null, x) } : {}),
  };
  writeFileSync(join(runDir, "surprise_score.json"), JSON.stringify(row, null, 2) + "\n");
  return row;
}

// ── validation on hand-written reports ───────────────────────────────────────

/**
 * `notes`: files the agent wrote outside the report (path → text). `pad`: that
 * many filler tool calls with long outputs, half before and half after `tools`,
 * so the case's evidence sits in the middle of a transcript longer than the
 * long digest's cap (the windowing must keep it).
 */
export interface Case { id: string; bench: string; report: string; tools?: { cmd: string; out: string }[]; notes?: Record<string, string>; pad?: number; answer: Record<string, unknown>; expect: Record<string, "yes" | "no"> }

export function materialize(c: Case): string {
  const dir = mkdtempSync(join(tmpdir(), `surprise-val-${c.id}-`));
  mkdirSync(join(dir, "report"), { recursive: true });
  writeFileSync(join(dir, "report", "report.md"), c.report);
  writeFileSync(join(dir, "answer.json"), JSON.stringify(c.answer));
  for (const [p, text] of Object.entries(c.notes ?? {})) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
  const lines: string[] = [];
  const call = (id: string, cmd: string, out: string) => {
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } }));
    lines.push(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: out }] } }));
  };
  const filler = (k: number) => call(`f${k}`, `python3 data/sweep_step.py --index ${k}`, `step ${k}: ` + Array.from({ length: 60 }, (_, m) => `${(k * 0.37 + m * 1.13).toFixed(4)}`).join(" "));
  const half = Math.floor((c.pad ?? 0) / 2);
  for (let k = 0; k < half; k++) filler(k);
  (c.tools ?? []).forEach((t, i) => call(`t${i}`, t.cmd, t.out));
  for (let k = half; k < (c.pad ?? 0); k++) filler(k);
  writeFileSync(join(dir, "claude_transcript.jsonl"), lines.join("\n") + "\n");
  return dir;
}

async function validate(judges: string[], only?: Set<string>, casesFile = "cases.json") {
  const cases: Case[] = JSON.parse(readFileSync(join(BENCH_ROOT, "_validation", casesFile), "utf-8")).filter((c: Case) => !only || only.has(c.id));
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
      applyMechanicalA(r.stages, gradeX(c.answer, oracle));
      cost += r.cost;
      for (const [s, want] of Object.entries(c.expect)) {
        const got = r.stages[s]?.verdict;
        const ok = got === want;
        if (!ok) wrong++;
        const detail = Object.entries(r.stages[s]?.byJudge ?? {}).map(([j, b]) => `${j}:${b.said}${b.said === "yes" ? (b.quoteFound ? "" : `(quote not found: "${b.quote.slice(0, 90)}")`) : ""}`).join(" ") + (r.stages[s]?.mechanical ? " (A mechanical: plant keys right)" : "");
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
  if (argv.includes("--requote")) {
    // Re-check the quotes a scored run already holds against its report and transcript: free, no judge call.
    const dir = argv.find((a) => !a.startsWith("--") && existsSync(join(a, "surprise_score.json")));
    if (!dir) { console.error("usage: surprise_score.mts --requote <run-dir>"); process.exit(2); }
    const row = JSON.parse(readFileSync(join(dir, "surprise_score.json"), "utf-8"));
    const { surface } = judgeInputs(dir, loadOracle(row.bench));
    for (const st of Object.values<StageResult>(row.stages ?? {})) {
      for (const b of Object.values(st.byJudge)) b.quoteFound = b.said === "yes" ? quoteFound(b.quote, surface) : false;
      const all = Object.values(st.byJudge);
      st.verdict = all.some((b) => b.said !== "yes" && b.said !== "no") ? (all.some((b) => b.said === "no" || (b.said === "yes" && !b.quoteFound)) ? "no" : "unjudged")
        : all.every((b) => b.said === "yes" && b.quoteFound) ? "yes" : "no";
    }
    row.ts = new Date().toISOString(); row.requoted = true;
    writeFileSync(join(dir, "surprise_score.json"), JSON.stringify(row, null, 2) + "\n");
    appendFileSync(SCORES, JSON.stringify(row) + "\n");
    console.log(`${basename(dir)} ${row.bench}: ${Object.entries<StageResult>(row.stages ?? {}).map(([k, v]) => `${k}=${v.verdict}`).join(" ")} (requoted)`);
    process.exit(0);
  }
  if (argv.includes("--validate")) {
    const only = flag("--only") ? new Set(flag("--only")!.split(",")) : undefined;
    process.exit((await validate(judges, only, flag("--cases") ?? "cases.json")) === 0 ? 0 : 1);
  }
  const runDir = argv.find((a) => !a.startsWith("--") && existsSync(a));
  const bench = flag("--bench");
  if (!runDir || !bench) { console.error("usage: surprise_score.mts <run-dir> --bench <variant> [--arm A] [--judges a,b] [--no-judge] | --validate [--judges a,b] [--only ids]"); process.exit(2); }
  const row = await scoreRun(runDir, bench, { judges, arm: flag("--arm") });
  appendFileSync(SCORES, JSON.stringify(row) + "\n");
  const st = row.stages ? Object.entries(row.stages).map(([s, v]) => `${s}=${(v as StageResult).verdict}`).join(" ") : "(not judged)";
  const long = "outcome" in row ? ` | outcome ${row.outcome ?? "(not judged)"} delivered=${row.delivered}` : "";
  console.log(`${basename(runDir)} ${bench}: X ${row.x.correct ? "correct" : Object.entries(row.x.keys).map(([k, v]) => `${k}:${v.verdict}`).join(",")} | ${st}${long} | judges $${row.judgeCostUsd}${row.judgeErrors.length ? ` | ERR ${row.judgeErrors.join("; ")}` : ""}`);
}
