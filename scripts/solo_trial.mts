#!/usr/bin/env tsx
/**
 * solo_trial — one agent, one short prompt, one task directory, on Luxas's own
 * loop. The cell of the architecture comparison that Claude Code cannot fill:
 * the same single-agent shape on any model Luxas can route to (deepseek-v4-pro
 * here), so "is it the structure or the model" can be separated.
 *
 * The directory holds TASK.md and its inputs, exactly as given to the
 * `claude -p` arm; the prompt is that arm's prompt. Nothing of the Luxas
 * experiment workflow is used: no orchestrator, no tool_impl / tool_review.
 *
 * It is also the harness for the paired test against claude -p (C64). Every
 * earlier comparison changed model, effort, prompt, cap and head start at once,
 * so: a dir any arm has worked in is refused; what each arm ran under goes in
 * trial.json before it runs, and trial.json is written even when the cost cap
 * or an unfunded provider kills the process; --pair compares two arms only
 * when nothing but the arm differs.
 *
 *   npx tsx scripts/solo_trial.mts --dir <task dir> --model claude-opus-5-5 --cap 9 [--thinking high] [--turns 400]
 *   npx tsx scripts/solo_trial.mts --print-cc --dir <task dir> --cap 9 [--thinking high]   (the claude -p arm's command)
 *   npx tsx scripts/solo_trial.mts --ingest-cc <transcript.jsonl> --dir <task dir>
 *   npx tsx scripts/solo_trial.mts --pair <solo dir> <claude -p dir>
 *
 * Three-arm form (2026-10-24: should Luxas dispatch experiments to Claude Code or Codex as well as pi):
 *   npx tsx scripts/solo_trial.mts --run cc|codex --dir <task dir> --cap 9 [--thinking high] [--model X] [--wall-min 150]
 *   npx tsx scripts/solo_trial.mts --compare <dir> <dir> [<dir> ...]
 * --run launches the CLI in its own process group from the fresh dir and ingests it: claude -p on the
 * subscription login with 5-minute caching forced, codex exec with an isolated CODEX_HOME (the login is
 * shared through a symlink; the user's global AGENTS.md, which tells Codex to prefix every command with
 * rtk, is not). codex exec has no cost cap, so --compare marks a Codex run over the cap afterwards.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installUsageTracking, readUsageTotals, unfundedSentinelPath } from "../src/usage-log.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// data/: upstream files a task names at relative paths (ba E5's E2/E3 inputs). An earlier arm's own data/
// passes this check, so --compare also requires equal inputsSha across the arms of a task.
const TASK_INPUTS = new Set(["TASK.md", "PROMPT.txt", "refs", "upstream", "data"]);
/** --print-cc's record of the claude -p arm, in the dir's .agent/; --ingest-cc builds on it. */
export const CC_ARM_RECORD = "cc_arm.json";
export const CC_MODEL = "claude-opus-5-5";
/** --run codex's record, in the dir's .agent/. */
export const CODEX_ARM_RECORD = "codex_arm.json";
export const CODEX_MODEL = "gpt-6-astra";
// pi's thinking levels that are also effort levels: the same word goes to the solo definition and to claude --effort.
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const argOf = (argv: string[], k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } };
const writeTrial = (dir: string, rec: any) => writeFileSync(join(dir, "trial.json"), JSON.stringify(rec, null, 2) + "\n");

/** Why `dir` is not a fresh task dir; empty = fresh. Anything but the task's inputs is an earlier arm's head start. */
export function freshDirProblems(dir: string): string[] {
  const out = ["TASK.md", "PROMPT.txt"].filter((f) => !existsSync(join(dir, f))).map((f) => `missing ${f}`);
  const list = (d: string) => readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== ".DS_Store").map((e) => e.isDirectory() ? `${e.name}/` : e.name);
  let names: string[];
  try { names = list(dir); } catch { return [`cannot read ${dir}`]; }
  for (const n of names) {
    if (TASK_INPUTS.has(n.replace(/\/$/, ""))) continue;
    // .agent/ may hold an arm's own record and nothing else; a usage.log means an arm already spent here.
    if (n === ".agent/") out.push(...list(join(dir, ".agent")).filter((f) => f !== CC_ARM_RECORD && f !== CODEX_ARM_RECORD).map((f) => `.agent/${f}`));
    else out.push(n);
  }
  return out;
}

/** sha256 over every input file's path and bytes (not .agent/): equal across the arms of one task iff they started from the same bytes. */
export function inputsSha(dir: string): string {
  const rows: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".DS_Store" || (d === dir && e.name === ".agent")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() || e.isSymbolicLink()) rows.push(`${relative(dir, p)}\0${statSync(p).isFile() ? sha256(readFileSync(p)) : "not-a-file"}`);
    }
  };
  walk(dir);
  return sha256(rows.sort().join("\n"));
}

/** The flat task dir's deliverables: results.json parses to an object and REPORT.md is not empty. */
export function deliveredFlat(dir: string): boolean {
  try {
    const j = JSON.parse(readFileSync(join(dir, "results.json"), "utf-8"));
    return !!j && typeof j === "object" && !Array.isArray(j) && readFileSync(join(dir, "REPORT.md"), "utf-8").trim() !== "";
  } catch { return false; }
}

/** The solo arm's and --print-cc's settings. No cap means no measurement, so it never defaults. */
export function parseTrialArgs(argv: string[], needModel = true) {
  const dir = argOf(argv, "--dir"), model = argOf(argv, "--model"), capArg = argOf(argv, "--cap");
  const thinking = argOf(argv, "--thinking") ?? "high", turns = Number(argOf(argv, "--turns") ?? "400"), cap = Number(capArg);
  const bad: string[] = [];
  if (!dir) bad.push("--dir <task dir> is required");
  if (needModel && !model) bad.push("--model is required");
  if (capArg === undefined || !(cap > 0)) bad.push("--cap <usd> is required: both arms of a pair run under the same recorded cap");
  if (!EFFORTS.includes(thinking)) bad.push(`--thinking must be one of ${EFFORTS.join(", ")}`);
  if (!Number.isInteger(turns) || turns < 1) bad.push("--turns must be a positive integer");
  if (bad.length) throw new Error(bad.join("; "));
  return { dir: resolve(dir!), model, cap, thinking, turns };
}

export const soloDefinition = (thinking: string, turns: number) => ({
  name: "solo",
  description: "Bench-only: a single agent with coding tools and no Luxas workflow.",
  model: "opus", thinkingLevel: thinking, toolSets: ["coding"], templates: ["PROJECT_DIR"],
  spawn: { enabled: false },
  systemPromptTemplate: "You are a research engineer working alone in {{PROJECT_DIR}}. Always `cd` there before running commands. Finish the job yourself: write the code, run it, check it, and write the deliverables the request names.",
  maxTurns: turns,
});

/**
 * What an arm runs under, recorded before it runs. systemSha hashes the
 * template, before {{PROJECT_DIR}}, so it is equal across task dirs whenever
 * the definition is.
 */
export function newTrialRecord(dir: string, o: { arm: "solo" | "claude-p" | "codex"; model: string; thinking: string; cap: number; turns: number | null; systemPrompt?: string }) {
  const git = (...a: string[]) => spawnSync("git", ["--no-optional-locks", ...a], { cwd: ROOT, encoding: "utf-8" }).stdout?.trim() ?? "";
  const commit = git("rev-parse", "HEAD") || "unknown", dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
  const promptSha = sha256(readFileSync(join(dir, "PROMPT.txt")));
  const rec: any = { arm: o.arm, model: o.model, thinking: o.thinking, cap: o.cap, turns: o.turns, commit, dirty, promptSha, inputsSha: inputsSha(dir),
    systemSha: o.systemPrompt === undefined ? null : sha256(o.systemPrompt), fresh: freshDirProblems(dir), dir, started: new Date().toISOString() };
  return rec;
}

function usageOf(dir: string) {
  const t = readUsageTotals(join(dir, ".agent", "usage.log"));
  return { calls: t.calls, tokens: { input: t.inputTokens, output: t.outputTokens, cacheRead: t.cacheReadTokens, cacheWrite: t.cacheWriteTokens }, cost: t.cost };
}

// Why the process ended before the agent returned: usage-log.ts's two process.exit paths leave these traces.
function exitReason(dir: string, rec: any, code: number) {
  const sentinel = unfundedSentinelPath(join(dir, ".agent", "usage.log"));
  if (existsSync(sentinel)) {
    const j = readJson(sentinel);
    return { stopReason: "provider_unfunded", aborted: (j ? `${j.provider}: ${j.message}` : "a provider refused for lack of funds").slice(0, 200) };
  }
  const cost = usageOf(dir).cost;
  if (cost > rec.cap) return { stopReason: "budget_exhausted", errorMessage: `cost $${cost.toFixed(2)} exceeded the $${rec.cap} cap` };
  return { stopReason: "crashed", errorMessage: `process exited with code ${code} before the agent returned` };
}

/**
 * Write trial.json however the process ends. The usage tracker ends a trial
 * with process.exit, on the cost cap and on an unfunded provider, from inside
 * a stream callback, so code after `await spawnAgent` never runs on exactly
 * the trials a comparison must count. An "exit" handler runs on both and may
 * only do sync work. Returns the writer for the normal path; the first write wins.
 */
export function armTrialRecord(dir: string, rec: any): () => any {
  let written = false;
  const write = (code?: number) => {
    if (written) return rec;
    written = true;
    if (rec.stopReason === undefined && code !== undefined) Object.assign(rec, exitReason(dir, rec, code));
    Object.assign(rec, { elapsedMs: Date.now() - Date.parse(rec.started), ...usageOf(dir), delivered: deliveredFlat(dir) });
    writeTrial(dir, rec);
    return rec;
  };
  process.on("exit", (code) => { try { write(code); } catch { /* recording must not be what breaks an exit */ } });
  return () => write();
}

/**
 * The claude -p arm: the PROMPT.txt bytes and nothing else as the prompt, the
 * solo arm's effort and cap. --allowedTools takes the rest of the line, so it
 * stays last.
 */
export function ccArmArgs(prompt: string, o: { thinking: string; cap: number; model?: string }): string[] {
  return ["-p", prompt, "--model", o.model ?? CC_MODEL, "--effort", o.thinking, "--max-budget-usd", String(o.cap),
    "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose", "--strict-mcp-config",
    "--allowedTools", "Bash", "Read", "Write", "Edit", "Glob", "Grep"];
}

export const shellCommand = (argv: string[]) => argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`).join(" ");

// The CLI reports a provider abort (no credit, an outage) as subtype
// "success" with is_error and terminal_reason "api_error". It is no
// measurement, so it is classified error:api_error and marked aborted.
export function classifyClaudeResult(j: any): { exit: string; aborted?: string } {
  if (!j) return { exit: "no-result-line" };
  // `||`, not `??`: the CLI can report the abort with result "", and an empty reason would drop the aborted mark.
  if (j.is_error === true && j.terminal_reason === "api_error") return { exit: "error:api_error", aborted: String(j.result || "api_error").slice(0, 200) };
  return { exit: String(j.subtype ?? (j.is_error ? "error" : "success")) };
}

/** The claude -p arm's trial.json: --print-cc's record plus the stream-json transcript's result line. */
export function ccTrialRecord(pre: any, transcript: string, dir: string) {
  let j: any = null;
  for (const line of transcript.split("\n")) { try { const x = JSON.parse(line); if (x?.type === "result") j = x; } catch { /* not a JSON line */ } }
  const { exit, aborted } = classifyClaudeResult(j);
  // Costliest first is the model that did the work; token classes sum over every model.
  const models = Object.entries<any>(j?.modelUsage ?? {}).sort((x, y) => (y[1]?.costUSD ?? 0) - (x[1]?.costUSD ?? 0));
  const sum = (k: string) => models.reduce((s, [, u]) => s + (Number(u?.[k]) || 0), 0);
  const u = j?.usage ?? {};
  const tokens = models.length
    ? { input: sum("inputTokens"), output: sum("outputTokens"), cacheRead: sum("cacheReadInputTokens"), cacheWrite: sum("cacheCreationInputTokens") }
    : { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  return { ...pre, dir, model: models[0]?.[0] ?? pre.model, stopReason: exit, ...(aborted ? { aborted } : {}),
    ...(j?.is_error && !aborted ? { errorMessage: String(j.result ?? "").slice(0, 500) } : {}),
    elapsedMs: j?.duration_ms ?? null, calls: j?.num_turns ?? 0,
    tokens: { ...tokens, cacheWrite1h: Number(u.cache_creation?.ephemeral_1h_input_tokens) || 0 },
    cost: j?.total_cost_usd ?? null, delivered: deliveredFlat(dir) };
}

/** Why two trial records are not a fair pair; empty = fair. Only the arm may differ. */
export function pairProblems(a: any, b: any): string[] {
  const out: string[] = [];
  for (const r of [a, b]) {
    const who = r?.arm ?? "an arm";
    if (!Array.isArray(r?.fresh)) out.push(`${who}: no fresh-dir check on record (a trial.json from before C64)`);
    else if (r.fresh.length) out.push(`${who}: the dir was not fresh (${r.fresh.join(", ")})`);
    if (r?.aborted) out.push(`${who}: aborted by the provider (${r.aborted}); not a measurement, rerun it`);
    if (r?.tokens?.cacheWrite1h > 0) out.push(`${who}: ${r.tokens.cacheWrite1h} tokens written to the 1-hour cache; CLAUDE_CODE_PROMPT_CACHE_TTL was not pinned to 5 min, so its cache traffic is not the solo arm's`);
  }
  for (const [k, label] of [["model", "model"], ["thinking", "effort"], ["cap", "cap"], ["promptSha", "PROMPT.txt sha256"]] as const)
    if (a?.[k] == null || a?.[k] !== b?.[k]) out.push(`the ${label} differs: ${a?.[k] ?? "(none)"} vs ${b?.[k] ?? "(none)"}`);
  return out;
}

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
/** USD for these token counts at one price table (USD per million tokens, pi-ai's catalog shape). */
export const repriceUsd = (t: any, p: Price) =>
  ((t?.input ?? 0) * p.input + (t?.output ?? 0) * p.output + (t?.cacheRead ?? 0) * p.cacheRead + (t?.cacheWrite ?? 0) * p.cacheWrite) / 1e6;

/**
 * The comparison. Both arms are repriced from their token counts at ONE price
 * table: as billed, claude -p is list price (or $0 on the subscription) and
 * the solo arm is pi-ai's catalog, so the billed ratio would measure billing.
 */
export function pairReport(a: any, b: any, price: Price): string[] {
  const usd = (x: unknown) => typeof x === "number" ? `$${x.toFixed(2)}` : "-";
  const row = (label: string, f: (r: any) => string) => `  ${label.padEnd(18)}${f(a).padEnd(18)}${f(b)}`;
  const ra = repriceUsd(a.tokens, price), rb = repriceUsd(b.tokens, price);
  return [
    `${a.model}, effort ${a.thinking}, cap $${a.cap}, PROMPT.txt ${String(a.promptSha).slice(0, 12)}`,
    `price table (USD per M tokens): input ${price.input}, output ${price.output}, cache read ${price.cacheRead}, cache write ${price.cacheWrite}`,
    "",
    row("", (r) => String(r.arm)),
    row("delivered", (r) => r.delivered ? "yes" : "no"),
    row("stop", (r) => String(r.stopReason)),
    row("wall", (r) => typeof r.elapsedMs === "number" ? `${(r.elapsedMs / 60_000).toFixed(1)} min` : "-"),
    row("calls", (r) => String(r.calls ?? "-")),
    row("cost (repriced)", (r) => usd(repriceUsd(r.tokens, price))),
    row("cost (as billed)", (r) => usd(r.cost)),
    "",
    `cost ratio ${a.arm} / ${b.arm}, repriced: ${rb > 0 ? `${(ra / rb).toFixed(2)}x` : "-"}`,
  ];
}

/**
 * The codex exec arm: the PROMPT.txt bytes as the prompt, the solo arm's effort word, no sandbox (the other
 * two arms run unrestricted bash as well), no user config and no saved session. The prompt stays last.
 */
export function codexArmArgs(prompt: string, o: { thinking: string; model?: string }): string[] {
  return ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-m", o.model ?? CODEX_MODEL,
    "-c", `model_reasoning_effort="${o.thinking}"`, "-s", "danger-full-access", prompt];
}

// A ChatGPT-plan limit or a lost login ends a run the way an unfunded API key does: no measurement.
const CODEX_ABORT = /usage limit|rate limit|quota|exceeded your|insufficient|unauthorized|\b401\b/i;

/** The codex arm's trial.json: --run codex's record plus the --json event stream. */
export function codexTrialRecord(pre: any, transcript: string, dir: string, run?: { timedOut?: boolean; elapsedMs?: number }) {
  const u = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  let completed = 0, commands = 0, edits = 0, failed = "", lastError = "";
  for (const line of transcript.split("\n")) {
    let x: any;
    try { x = JSON.parse(line); } catch { continue; }
    if (x?.type === "turn.completed") {
      completed++;
      const t = x.usage ?? {};
      u.input += Number(t.input_tokens) || 0; u.cached += Number(t.cached_input_tokens) || 0; u.cacheWrite += Number(t.cache_write_input_tokens) || 0;
      u.output += Number(t.output_tokens) || 0; u.reasoning += Number(t.reasoning_output_tokens) || 0;
    } else if (x?.type === "turn.failed") failed = String(x.error?.message ?? "turn failed");
    else if (x?.type === "error") lastError = String(x.message ?? "error");   // also emitted for retried stream errors
    else if (x?.type === "item.completed") { if (x.item?.type === "command_execution") commands++; else if (x.item?.type === "file_change") edits++; }
  }
  const fatal = failed || (!completed ? lastError : "");
  const aborted = fatal && CODEX_ABORT.test(fatal) ? fatal.slice(0, 200) : undefined;
  const stopReason = run?.timedOut ? "wall_limit" : failed ? "error" : completed ? "completed" : lastError ? "error" : "no-result";
  return { ...pre, dir, stopReason, ...(aborted ? { aborted } : {}), ...(fatal && !aborted ? { errorMessage: fatal.slice(0, 500) } : {}),
    elapsedMs: run?.elapsedMs ?? null, calls: commands + edits,
    // input_tokens counts the cached ones too (OpenAI's convention); reasoning_output_tokens is part of output_tokens.
    tokens: { input: Math.max(0, u.input - u.cached), output: u.output, cacheRead: u.cached, cacheWrite: u.cacheWrite },
    reasoningTokens: u.reasoning, cost: null, delivered: deliveredFlat(dir) };
}

/** A CODEX_HOME holding only the user's login (a symlink, so a token refresh reaches the real file): no global AGENTS.md, config or memories. */
export function isolatedCodexHome(base = join(tmpdir(), "luxas-bench-codex-home")): string {
  mkdirSync(base, { recursive: true });
  const link = join(base, "auth.json");
  try { statSync(link); } catch { symlinkSync(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"), link); }
  return base;
}

/** The environment an external arm starts from: none of the launching Claude Code session's variables (a nested claude would attach to it). */
export function armEnv(extra: Record<string, string>, drop: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== "CLAUDECODE" && !k.startsWith("CLAUDE_CODE_") && !drop.includes(k)) env[k] = v;
  return { ...env, ...extra };
}

/** Launch an external arm in its own process group; the group is killed when the CLI exits (background jobs it left) or the wall limit hits. */
export async function launchArm(cmd: string, args: string[], dir: string, env: NodeJS.ProcessEnv, wallMs: number, tag: string) {
  const out = openSync(join(dir, ".agent", `${tag}_transcript.jsonl`), "w"), err = openSync(join(dir, ".agent", `${tag}_stderr.txt`), "w");
  const t0 = Date.now();
  const child = spawn(cmd, args, { cwd: dir, env, detached: true, stdio: ["ignore", out, err] });
  let timedOut = false;
  const killGroup = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); } catch { /* the group is gone */ } };
  const timer = setTimeout(() => { timedOut = true; killGroup("SIGTERM"); setTimeout(() => killGroup("SIGKILL"), 10_000).unref(); }, wallMs);
  const code: number | null = await new Promise((res) => { child.on("exit", (c) => res(c)); child.on("error", () => res(-1)); });
  clearTimeout(timer);
  killGroup("SIGKILL");
  closeSync(out); closeSync(err);
  return { code, timedOut, elapsedMs: Date.now() - t0 };
}

// gpt-6-astra has no published price: the catalog pins $5/$30 so a cost cap bites early; the 09-06 routing analysis used $3/$18.
export const CODEX_ANALYSIS_PRICE: Price = { input: 3, output: 18, cacheRead: 0.3, cacheWrite: 0 };

/** Why the arms of one task are not comparable; empty = comparable. The model is meant to differ. */
export function compareProblems(recs: any[]): string[] {
  const out: string[] = [];
  for (const r of recs) {
    const who = `${r?.arm ?? "an arm"} (${String(r?.dir ?? "?").split("/").pop()})`;
    if (!Array.isArray(r?.fresh)) out.push(`${who}: no fresh-dir check on record`);
    else if (r.fresh.length) out.push(`${who}: the dir was not fresh (${r.fresh.join(", ")})`);
    if (r?.aborted) out.push(`${who}: aborted by the provider (${r.aborted}); not a measurement, rerun it`);
    if (r?.tokens?.cacheWrite1h > 0) out.push(`${who}: ${r.tokens.cacheWrite1h} tokens written to the 1-hour cache; 5-minute caching was not in force`);
  }
  for (const [k, label] of [["thinking", "effort"], ["cap", "cap"], ["promptSha", "PROMPT.txt sha256"], ["inputsSha", "input files"]] as const) {
    const vals = new Set(recs.map((r) => String(r?.[k] ?? "(none)")));
    if (vals.size > 1) out.push(`the ${label} differs across arms: ${[...vals].map((v) => v.slice(0, 12)).join(" vs ")}`);
  }
  return out;
}

/** One task's arms side by side, each repriced at its own model's table; a codex run is over the cap when its analysis-price cost is. */
export function compareReport(recs: any[], priceOf: (model: string) => Price | undefined): string[] {
  const usd = (x: number | undefined) => typeof x === "number" ? `$${x.toFixed(2)}` : "-";
  const cell = (r: any) => {
    const p = priceOf(r.model), list = p ? repriceUsd(r.tokens, p) : undefined;
    const alt = r.arm === "codex" ? repriceUsd(r.tokens, CODEX_ANALYSIS_PRICE) : undefined;
    return {
      arm: String(r.arm), model: String(r.model), delivered: r.delivered ? "yes" : "no", stop: String(r.stopReason),
      wall: typeof (r.elapsedMs ?? r.wallMs) === "number" ? `${((r.elapsedMs ?? r.wallMs) / 60_000).toFixed(1)} min` : "-",
      calls: String(r.calls ?? "-"),
      tokens: `${((r.tokens?.input ?? 0) / 1e6).toFixed(2)}M in, ${((r.tokens?.cacheRead ?? 0) / 1e6).toFixed(2)}M cached, ${((r.tokens?.output ?? 0) / 1e3).toFixed(0)}K out`,
      cost: alt === undefined ? usd(list) : `${usd(alt)} (catalog ${usd(list)})`,
      overCap: alt !== undefined && alt > r.cap ? "OVER CAP" : "",
    };
  };
  const cells = recs.map(cell);
  const rows = ["arm", "model", "delivered", "stop", "wall", "calls", "tokens", "cost", "overCap"] as const;
  return rows.map((k) => `  ${k.padEnd(10)}${cells.map((c) => String(c[k]).padEnd(40)).join("")}`);
}

async function main(argv: string[]) {
  // Declared type, not an inferred one: TS only narrows after a never-returning
  // call through a const whose type is annotated.
  const refuse: (msg: string) => never = (msg) => { console.error(msg); process.exit(2); };

  if (argv.includes("--compare")) {
    const dirs = argv.slice(argv.indexOf("--compare") + 1).filter((d) => !d.startsWith("--")).map((d) => resolve(d));
    const recs = dirs.map((d) => readJson(join(d, "trial.json")));
    if (dirs.length < 2 || recs.some((r) => !r)) refuse("--compare <dir> <dir> [...]: every dir needs a trial.json");
    const { resolveModelExact } = await import("../src/agents/spawn.ts");
    const priceOf = (m: string) => { try { return (resolveModelExact(m) as any).cost as Price; } catch { return undefined; } };
    const problems = compareProblems(recs);
    console.log([...compareReport(recs, priceOf), "", problems.length ? `NOT COMPARABLE:\n  - ${problems.join("\n  - ")}` : "comparable: same prompt, inputs, effort and cap; fresh dirs; no aborts"].join("\n"));
    return;
  }

  if (argv.includes("--run")) {
    const which = argOf(argv, "--run");
    if (which !== "cc" && which !== "codex") refuse("--run cc|codex --dir <task dir> --cap <usd>");
    let o!: ReturnType<typeof parseTrialArgs>;
    try { o = parseTrialArgs(argv, false); } catch (e: any) { refuse(e.message); }
    const problems = freshDirProblems(o.dir);
    if (problems.length) refuse(`not a fresh task dir: ${o.dir}\n  holds ${problems.join(", ")}`);
    const wallMs = Number(argOf(argv, "--wall-min") ?? "150") * 60_000;
    if (!(wallMs > 0)) refuse("--wall-min must be positive");
    mkdirSync(join(o.dir, ".agent"), { recursive: true });
    const prompt = readFileSync(join(o.dir, "PROMPT.txt"), "utf-8");
    if (which === "cc") {
      const model = o.model ?? CC_MODEL;
      const pre = { ...newTrialRecord(o.dir, { arm: "claude-p", model, thinking: o.thinking, cap: o.cap, turns: null }), launcher: "--run", auth: "subscription", cache: "FORCE_PROMPT_CACHING_5M" };
      writeFileSync(join(o.dir, ".agent", CC_ARM_RECORD), JSON.stringify(pre, null, 2) + "\n");
      const run = await launchArm("claude", ccArmArgs(prompt, { thinking: o.thinking, cap: o.cap, model }), o.dir,
        armEnv({ FORCE_PROMPT_CACHING_5M: "1" }, ["ANTHROPIC_API_KEY"]), wallMs, "cc");
      const rec: any = ccTrialRecord(pre, readFileSync(join(o.dir, ".agent", "cc_transcript.jsonl"), "utf-8"), o.dir);
      Object.assign(rec, { wallMs: run.elapsedMs, exitCode: run.code }, run.timedOut ? { stopReason: "wall_limit" } : {});
      writeTrial(o.dir, rec);
      console.log(JSON.stringify(rec));
      return;
    }
    const model = o.model ?? CODEX_MODEL;
    const pre = { ...newTrialRecord(o.dir, { arm: "codex", model, thinking: o.thinking, cap: o.cap, turns: null }), launcher: "--run", auth: "chatgpt", codexHome: "isolated" };
    writeFileSync(join(o.dir, ".agent", CODEX_ARM_RECORD), JSON.stringify(pre, null, 2) + "\n");
    const run = await launchArm("codex", codexArmArgs(prompt, { thinking: o.thinking, model }), o.dir, armEnv({ CODEX_HOME: isolatedCodexHome() }), wallMs, "codex");
    const rec: any = codexTrialRecord(pre, readFileSync(join(o.dir, ".agent", "codex_transcript.jsonl"), "utf-8"), o.dir, run);
    rec.exitCode = run.code;
    writeTrial(o.dir, rec);
    console.log(JSON.stringify(rec));
    return;
  }

  if (argv.includes("--pair")) {
    const dirs = argv.slice(argv.indexOf("--pair") + 1, argv.indexOf("--pair") + 3).map((d) => resolve(d));
    const [a, b] = dirs.map((d) => readJson(join(d, "trial.json")));
    if (dirs.length < 2 || !a || !b) refuse("--pair <solo dir> <claude -p dir>: both dirs need a trial.json");
    const problems = pairProblems(a, b);
    if (problems.length) refuse(`not a fair pair:\n  - ${problems.join("\n  - ")}`);
    const { resolveModelExact } = await import("../src/agents/spawn.ts");
    console.log(pairReport(a, b, (resolveModelExact(a.model) as any).cost).join("\n"));
    return;
  }

  if (argv.includes("--ingest-cc")) {
    const transcript = argOf(argv, "--ingest-cc"), dirArg = argOf(argv, "--dir");
    if (!transcript || !dirArg) refuse("--ingest-cc <transcript.jsonl> --dir <task dir>");
    const dir = resolve(dirArg), pre = readJson(join(dir, ".agent", CC_ARM_RECORD));
    if (!pre) refuse(`no .agent/${CC_ARM_RECORD} in ${dir}: launch the claude -p arm from --print-cc, which checks the dir is fresh and records the arm's settings; without it nothing says what the dir held before the run`);
    const prev = readJson(join(dir, "trial.json"));
    if (prev && prev.arm !== "claude-p") refuse(`${dir}/trial.json is the ${prev.arm} arm's: one dir, one arm`);
    const rec = ccTrialRecord(pre, readFileSync(transcript, "utf-8"), dir);
    writeTrial(dir, rec);
    console.log(JSON.stringify(rec));
    return;
  }

  let o!: ReturnType<typeof parseTrialArgs>;
  try { o = parseTrialArgs(argv, !argv.includes("--print-cc")); } catch (e: any) { refuse(e.message); }
  const problems = freshDirProblems(o.dir);
  if (problems.length) refuse(`not a fresh task dir: ${o.dir}\n  holds ${problems.join(", ")}\nOnly TASK.md, PROMPT.txt, refs/ and upstream/ may be there: copy the task's inputs into a new dir.`);

  if (argv.includes("--print-cc")) {
    const model = o.model ?? CC_MODEL;
    const pre = newTrialRecord(o.dir, { arm: "claude-p", model, thinking: o.thinking, cap: o.cap, turns: null });
    mkdirSync(join(o.dir, ".agent"), { recursive: true });
    writeFileSync(join(o.dir, ".agent", CC_ARM_RECORD), JSON.stringify(pre, null, 2) + "\n");
    const cc = ccArmArgs(readFileSync(join(o.dir, "PROMPT.txt"), "utf-8"), { thinking: o.thinking, cap: o.cap, model });
    console.log([
      `claude -p arm for ${o.dir}: fresh; ${model}, effort ${o.thinking}, cap $${o.cap}; recorded in .agent/${CC_ARM_RECORD}. Run it from a plain terminal:`,
      "",
      `cd ${shellCommand([o.dir])} && claude ${shellCommand(cc)} > .agent/cc_transcript.jsonl 2> .agent/cc_stderr.txt`,
      "",
      "On the subscription login Claude Code caches prompts for 1 hour, and the solo arm (a Luxas sub-agent) for",
      "5 minutes: pin CLAUDE_CODE_PROMPT_CACHE_TTL to 5 minutes for this launch (an API key already gets 5 minutes).",
      "--pair refuses a transcript that shows 1-hour cache writes.",
      "",
      `Then: npx tsx scripts/solo_trial.mts --ingest-cc ${shellCommand([join(o.dir, ".agent", "cc_transcript.jsonl")])} --dir ${shellCommand([o.dir])}`,
    ].join("\n"));
    return;
  }

  process.env.LUXAS_PROJECT_DIR = o.dir;
  const log = join(o.dir, ".agent", "usage.log");
  installUsageTracking(log, { maxCostUsd: o.cap });
  const { spawnAgent, resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const modelId = (resolveModelExact(o.model!) as any).id;
  const def = soloDefinition(o.thinking, o.turns);
  const rec: any = newTrialRecord(o.dir, { arm: "solo", model: modelId, thinking: o.thinking, cap: o.cap, turns: o.turns, systemPrompt: def.systemPromptTemplate });
  const finish = armTrialRecord(o.dir, rec);
  try {
    const r = await spawnAgent({ name: "solo", prompt: readFileSync(join(o.dir, "PROMPT.txt"), "utf-8"), projectDir: o.dir, getApiKey, exactModel: o.model,
      parentAgentId: "bench", templateVars: { PROJECT_DIR: o.dir }, resolveDefinition: (() => def) as any } as any);
    rec.stopReason = r.exit?.stopReason; rec.errorMessage = r.exit?.errorMessage; rec.toolCalls = r.exit?.toolCallCount;
    writeFileSync(join(o.dir, "agent_output.md"), r.output ?? "");
  } catch (e: any) { rec.stopReason = "harness_error"; rec.errorMessage = String(e?.message ?? e).slice(0, 500); }
  console.log(JSON.stringify(finish()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
