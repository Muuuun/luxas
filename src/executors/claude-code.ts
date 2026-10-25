/**
 * Claude Code as the experiment executor (LUXAS_EXPERIMENT_MODE=claude-code).
 *
 * The brain still decomposes and the harness still reviews; only who does an
 * experiment changes. spawnAgent and the background runner hand an
 * `experiment` spawn to runClaudeCodeExperiment, which runs one `claude -p` in
 * the project dir with the solo experiment definition and the experiment
 * context the pi executor gets appended to Claude Code's own system prompt,
 * and returns a SpawnAgentResult. runExperimentReviewLoop (blind estimates,
 * reviewer rounds, declaration send-back), the claims table and the finish
 * gate read the same files as before; the loop's re-runs come back here and
 * resume the experiment's Claude Code session.
 *
 * Why (notes/executor-arms-2026-10-24.md, pre-registered, n=1 per cell): on
 * the same model and tasks, Claude Code got 3 of 3 hard tasks right for
 * $17.93 over four tasks; pi's loop with the same model got 1 of 3 for $31.50
 * and hit the $9 cap on three of four.
 *
 * Auth has no default: LUXAS_CC_AUTH=subscription runs on the claude.ai login
 * (no API key reaches the child; usage rows are logged at cost 0 and the list
 * price goes to log.jsonl), LUXAS_CC_AUTH=api bills the Anthropic key Luxas
 * resolves (getApiKey: env, then ~/.sisyphus/auth.json — `luxas run` has
 * already removed the key from process.env by then) and logs the cost as it
 * accrues, so the run's cap counts it. The CLI reports which credential it
 * used in its first event; a run on the other one is killed at once. The
 * choice is the operator's: the subscription is for the operator's own
 * projects, and preflight refuses it for a studio tenant's project.
 *
 * What the pi executor has and this one does not: Luxas's write guards and
 * per-call hooks never see Claude Code's tool calls. The project is compared
 * before and after the run instead; changes outside the experiment's write
 * roots are reported to the brain, RESEARCH.md is put back, and the harness
 * files the executor could otherwise use against its own controls
 * (run_config.json, usage.log, board-actions.jsonl) are restored if touched.
 * Within one OS user that is detection and repair, not a boundary: a separate
 * user for agents is the real fix.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefinition, resolvePrompt } from "../agents/registry.js";
import { resolveContextBuilder } from "../agents/context-builders.js";
import type { SpawnAgentOptions, SpawnAgentResult } from "../agents/spawn.js";
import { addAgent, removeAgent, type SubAgentExit, type SubAgentStopReason } from "../active-agents.js";
import { recordAgentOutcome } from "../agent-liveness.js";
import { getApiKey as resolveApiKey } from "../auth.js";
import { appendUsage, costCapFor, enforceCostCap, readUsageTotals, type UsageEntry } from "../usage-log.js";
import { jobOwnerAls } from "../jobs/als.js";
import {
  WATCHDOG_NAME, archiveBoardDirectives, clearRunningMarker, latestActionFor, operatorStopNote, readBoardActions,
  readRunningMarkers, stopIssuedSince, stoppedByOperator, writeRunningMarker,
} from "../board-actions.js";

export type CcAuth = "subscription" | "api";

export const CC_DEFAULT_MODEL = "claude-opus-5-5";
// The tool set the executor comparison measured. --allowedTools takes the rest of the line, so it goes last.
export const CC_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OAUTH_TOKEN = /^sk-ant-oat/;
const DEFAULT_MAX_USD = 25;
const DEFAULT_WALL_MIN = 240;
const MIN_LAUNCH_USD = 0.5;
const TICK_MS = 2000;

export function claudeCodeExecutorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LUXAS_EXPERIMENT_MODE === "claude-code";
}

export function ccAuth(env: NodeJS.ProcessEnv = process.env): CcAuth | null {
  return env.LUXAS_CC_AUTH === "subscription" || env.LUXAS_CC_AUTH === "api" ? env.LUXAS_CC_AUTH : null;
}

const claudeBin = (env: NodeJS.ProcessEnv) => env.LUXAS_CLAUDE_BIN || "claude";
// A studio tenant's project (memory.ts ownerKey): /<hex12>/projects/<name>.
const TENANT_PATH = /\/[0-9a-f]{12}\/projects\/[^/]+\/?$/;
type KeyResolver = (provider: string) => Promise<string | undefined> | string | undefined;

/** Why the api credential cannot be used, or null. An OAuth token is a claude.ai login, not an API key. */
function apiKeyProblem(key: string | undefined): string | null {
  if (!key) return "LUXAS_CC_AUTH=api but no Anthropic API key (ANTHROPIC_API_KEY or ~/.sisyphus/auth.json)";
  if (OAUTH_TOKEN.test(key)) return "LUXAS_CC_AUTH=api but the Anthropic credential is an OAuth token, not an API key: use LUXAS_CC_AUTH=subscription for a claude.ai login";
  return null;
}

/** Why a claude-code run must not start; empty = it may. `luxas run` refuses before any spend. */
export async function claudeCodePreflight(env: NodeJS.ProcessEnv = process.env, projectDir?: string, getKey: KeyResolver = resolveApiKey): Promise<string[]> {
  const problems: string[] = [];
  const auth = ccAuth(env);
  if (!auth) {
    problems.push("LUXAS_EXPERIMENT_MODE=claude-code needs LUXAS_CC_AUTH=subscription (your claude.ai login, not billed) or LUXAS_CC_AUTH=api (an Anthropic API key, billed and counted against --max-cost)");
  }
  if (auth === "api") { const p = apiKeyProblem(await getKey("anthropic")); if (p) problems.push(p); }
  if (auth === "subscription" && projectDir && TENANT_PATH.test(projectDir)) {
    problems.push(`${projectDir} is a studio tenant's project: its experiments cannot run on your subscription; use LUXAS_CC_AUTH=api`);
  }
  const v = spawnSync(claudeBin(env), ["--version"], { encoding: "utf-8", env, timeout: 30_000 });
  if (v.error || v.status !== 0) {
    problems.push(`the claude CLI does not run (${v.error?.message ?? `exit ${v.status}`}): install Claude Code or set LUXAS_CLAUDE_BIN`);
  }
  return problems;
}

export interface CcArgsOptions {
  /** The appended system prompt, in a file: one argument is capped at 128 KiB on Linux, and argv is readable by every local user. */
  systemPromptFile: string;
  model: string;
  effort: string;
  maxBudgetUsd: number;
  /** A fresh session gets this id, so the harness knows it before the first event. */
  sessionId?: string;
  /** Resume this session instead (the experiment's earlier run). Only a UUID is passed. */
  resumeSessionId?: string;
}

/**
 * The executor's argv. The task goes on stdin, not here. The model is always
 * pinned: the CLI's default changes between sessions (it became fable on this
 * Mac in October). User skills, every settings file (user, project and local:
 * a .claude/settings.json the executor writes into the project would otherwise
 * carry its hooks into the next run), MCP servers and auto-memory stay out.
 * A resume id that is not a UUID is dropped: the session file is in the
 * project, where the executor can write, and `--resume --some-flag` would
 * hand the CLI a flag.
 */
export function claudeCodeArgs(o: CcArgsOptions): string[] {
  const resume = o.resumeSessionId && SESSION_ID_RE.test(o.resumeSessionId) ? o.resumeSessionId : undefined;
  const fresh = o.sessionId && SESSION_ID_RE.test(o.sessionId) ? o.sessionId : randomUUID();
  return [
    "-p",
    "--model", o.model,
    "--effort", o.effort,
    "--max-budget-usd", o.maxBudgetUsd.toFixed(2),
    "--permission-mode", "acceptEdits",
    "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "",
    "--append-system-prompt-file", o.systemPromptFile,
    ...(resume ? ["--resume", resume] : ["--session-id", fresh]),
    "--allowedTools", ...CC_TOOLS,
  ];
}

// The executor's environment is an allowlist, not Luxas's environment minus a
// few names. The executor runs code it writes itself from papers and web
// pages, and every child of its Bash tool inherits what it is given: the other
// providers' keys (DeepSeek, OpenAI, GLM…), GitHub tokens, the studio's
// session secret, an ssh-agent socket that reaches the production server.
// None of them is needed to run an experiment, so none is passed. What is
// passed: the shell basics, locale, toolchain and numerics settings, proxies
// and CA bundles (without them the CLI cannot reach the API behind a proxy),
// and the one credential the chosen auth needs — which the CLI then keeps out
// of its Bash children (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB), so an honest `env`
// dump into data/ (served by the studio's file browser) cannot carry it.
// LUXAS_CC_ENV_PASS names any extra variable the operator decides to pass.
const PASS_EXACT = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "TERM", "COLORTERM", "TZ", "LANG", "LANGUAGE",
  "__CF_USER_TEXT_ENCODING",
  "PYTHONPATH", "PYTHONHOME", "PYTHONUTF8", "PYTHONIOENCODING", "PYTHONDONTWRITEBYTECODE", "VIRTUAL_ENV",
  "MPLBACKEND", "MPLCONFIGDIR", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
  "NUMEXPR_MAX_THREADS", "CUDA_HOME", "CUDA_VISIBLE_DEVICES", "LD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
  "JAVA_HOME", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME", "JULIA_DEPOT_PATH", "TEXINPUTS", "TEXMFHOME",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
  "CLAUDE_CONFIG_DIR",
]);
const PASS_PREFIX = /^(LC_|XDG_|CONDA_)/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `apiKey` is the resolved key for api runs: process.env no longer has it inside `luxas run`. */
export function claudeCodeEnv(base: NodeJS.ProcessEnv, auth: CcAuth, apiKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const pass = (k: string) => { if (base[k] !== undefined) env[k] = base[k]; };
  for (const k of Object.keys(base)) if (PASS_EXACT.has(k) || PASS_PREFIX.test(k)) pass(k);
  // The credential the chosen login needs, and only that. With an API key in
  // the env, claude -p bills the key whatever login exists, so the
  // subscription run gets none.
  if (auth === "api") { if (apiKey) env.ANTHROPIC_API_KEY = apiKey; pass("ANTHROPIC_BASE_URL"); }
  else pass("CLAUDE_CODE_OAUTH_TOKEN");
  if (base.CLAUDE_CODE_USE_BEDROCK) { pass("CLAUDE_CODE_USE_BEDROCK"); for (const k of Object.keys(base)) if (k.startsWith("AWS_")) pass(k); }
  if (base.CLAUDE_CODE_USE_VERTEX) {
    pass("CLAUDE_CODE_USE_VERTEX"); pass("CLOUD_ML_REGION"); pass("GOOGLE_APPLICATION_CREDENTIALS");
    for (const k of Object.keys(base)) if (k.startsWith("ANTHROPIC_VERTEX_")) pass(k);
  }
  for (const k of (base.LUXAS_CC_ENV_PASS ?? "").split(",").map((s) => s.trim())) if (ENV_NAME.test(k)) pass(k);
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  env.DISABLE_AUTOUPDATER = "1";
  return env;
}

/** What the executor is told on top of the definition: what differs from running inside Luxas. */
export function executorNote(experimentId: string, auth: CcAuth): string {
  return [
    "<claude_code_executor>",
    "You run as Claude Code, not inside Luxas's own agent loop. What that changes in the text above:",
    "- There is no spawn_agent tool. Read papers yourself, do symbolic work yourself (sympy), and write the body of your `## L2.N` section in notes/experiments.md yourself, in the format the text gives the ledger_writer.",
    "- Luxas's tool names (read, write, edit, bash) are your Read, Write, Edit and Bash.",
    `- Write only under data/experiments/${experimentId}/, your own section of notes/experiments.md, and report/figures/. The harness compares the project before and after your run and reports any other change to the brain; RESEARCH.md is put back if you touch it.`,
    "- Start a computation that takes longer than about 3 minutes in the background and check on it with commands that return within 3 minutes; do not end your turn while it is still running." +
      (auth === "api" ? " The prompt cache expires 5 minutes after a request, so a longer wait re-sends your whole context at full price." : ""),
    "</claude_code_executor>",
  ].join("\n");
}

// ── Before/after comparison of the project ───────────────────────────────────

const SKIP_DIRS = new Set([".agent", ".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ipynb_checkpoints"]);
const MAX_SNAPSHOT_ENTRIES = 200_000;

const inRoots = (rel: string, roots: string[]) => roots.some((r) => (r.endsWith("/") ? rel.startsWith(r) : rel === r));

/** size:mtime of every file outside `roots` (relative paths; a root ending in / is a directory). */
export function projectSnapshot(projectDir: string, roots: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let seen = 0;
  const walk = (rel: string) => {
    let entries;
    try { entries = readdirSync(rel ? join(projectDir, rel) : projectDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > MAX_SNAPSHOT_ENTRIES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !inRoots(`${r}/`, roots)) walk(r);
      } else if (!inRoots(r, roots)) {
        try { const s = lstatSync(join(projectDir, r)); out.set(r, `${s.size}:${s.mtimeMs}`); } catch { /* gone */ }
      }
    }
  };
  walk("");
  return out;
}

export function snapshotChanges(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  for (const [k, v] of after) if (before.get(k) !== v) changes.push(`${before.has(k) ? "modified" : "created"} ${k}`);
  for (const k of before.keys()) if (!after.has(k)) changes.push(`deleted ${k}`);
  return changes.sort();
}

/** The experiment's write roots, from its definition (so they follow experiment.md), plus its whole directory. */
export function executorWriteRoots(def: { safety?: { allowedWriteRoots?: string[] } }, experimentId: string): string[] {
  const expand = (r: string) => r.replaceAll("{{EXPERIMENT_ID}}", experimentId);
  return [...new Set([...(def.safety?.allowedWriteRoots ?? []).map(expand), `data/experiments/${experimentId}/`])];
}

// ── Processes: the executor's group, its detached descendants, the host ───────

interface ProcRow { pid: number; ppid: number; lstart: string }

function processTable(): ProcRow[] {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid=,lstart="], { encoding: "utf-8", timeout: 5000 });
  const out: ProcRow[] = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), lstart: m[3].trim() });
  }
  return out;
}

/** Every descendant of `root` now, with its start time (so a later kill skips a reused pid). */
function descendants(root: number, table = processTable()): Map<number, string> {
  const kids = new Map<number, ProcRow[]>();
  for (const r of table) { const a = kids.get(r.ppid) ?? []; a.push(r); kids.set(r.ppid, a); }
  const out = new Map<number, string>();
  const stack = [root];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) if (!out.has(c.pid)) { out.set(c.pid, c.lstart); stack.push(c.pid); }
  }
  return out;
}

/**
 * Kill the executor's process group, then every descendant seen during the
 * run that is still the same process. Claude Code starts its Bash commands
 * detached, in groups of their own, so the group kill alone leaves a
 * background computation running after the CLI is gone.
 */
function killAll(pgid: number, tracked: Map<number, string>, sig: NodeJS.Signals): void {
  try { process.kill(-pgid, sig); } catch { /* group gone */ }
  if (!tracked.size) return;
  const now = new Map(processTable().map((r) => [r.pid, r.lstart]));
  for (const [pid, lstart] of tracked) {
    if (now.get(pid) !== lstart) continue;
    try { process.kill(-pid, sig); } catch { /* not a group leader */ }
    try { process.kill(pid, sig); } catch { /* gone */ }
  }
}

// Executors running in this process. If the host goes (luxas stop's SIGTERM,
// the cost cap's process.exit, ^C), they go with it: the watchdog would get
// the group within seconds anyway, but not the detached descendants.
const liveRuns = new Map<number, Map<number, string>>();
let hostHandlers = false;
function installHostHandlers(): void {
  if (hostHandlers) return;
  hostHandlers = true;
  const killLive = () => { for (const [pgid, tracked] of liveRuns) killAll(pgid, tracked, "SIGKILL"); };
  process.on("exit", killLive);
  for (const [sig, code] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const) {
    process.on(sig, () => {
      killLive();
      // The only listener: keep Node's default of exiting. Otherwise the host's own handlers decide.
      if (process.listenerCount(sig) === 1) process.exit(code);
    });
  }
}

// claude runs in the foreground of a shell whose background subshell polls the
// host: if the Luxas process dies by any means (luxas stop, the cost cap's
// process.exit, SIGKILL), the subshell kills the whole group, so no executor
// keeps spending with nobody to read its result. A run that reached $95 on a
// $60 cap after its wrapper was killed (2026-08-28) is the failure this stops.
export const WATCHDOG_SCRIPT = [
  'host=$1; shift',
  '( while kill -0 "$host" 2>/dev/null; do sleep 2; done; kill -TERM 0 2>/dev/null; sleep 5; kill -KILL 0 2>/dev/null ) &',
  'watch=$!',
  '"$@"',
  'st=$?',
  'kill "$watch" 2>/dev/null',
  'exit $st',
].join("\n");

export interface LaunchResult { code: number | null; timedOut: boolean; elapsedMs: number; pid?: number; spawnError?: string; killedBy?: string }

export interface LaunchOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  wallMs: number;
  transcriptPath: string;
  stderrPath: string;
  hostPid?: number;
  /** Written to the CLI's stdin and closed: the task. */
  stdin?: string;
  onStart?: (pgid: number) => void;
  /** Called every couple of seconds while the run lives; a string return kills the run with that reason. */
  onTick?: () => string | undefined;
}

/**
 * Run `bin args` in its own process group from `cwd`, stdout appended to
 * `transcriptPath`, stderr to `stderrPath`. At the wall limit, or when onTick
 * asks, the group gets SIGTERM (Claude Code's own cleanup stops its shells),
 * then SIGKILL; after the CLI exits the group and every descendant seen during
 * the run are killed anyway (the bench runner left a blender process holding a
 * core for six days because nothing did).
 */
export function launchClaudeCode(bin: string, args: string[], o: LaunchOptions): Promise<LaunchResult> {
  const started = Date.now();
  const out = openSync(o.transcriptPath, "a");
  const err = openSync(o.stderrPath, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("/bin/sh", ["-c", WATCHDOG_SCRIPT, WATCHDOG_NAME, String(o.hostPid ?? process.pid), bin, ...args],
      { cwd: o.cwd, env: o.env, detached: true, stdio: ["pipe", out, err] });
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const pid = child.pid;
  child.stdin?.on("error", () => { /* the CLI may exit before reading */ });
  child.stdin?.end(o.stdin ?? "");
  const tracked = new Map<number, string>();
  if (pid) {
    installHostHandlers();
    liveRuns.set(pid, tracked);
    try { o.onStart?.(pid); } catch { /* a marker that fails to write must not orphan the run */ }
  }
  return new Promise((resolveP) => {
    let timedOut = false;
    let settled = false;
    let killedBy: string | undefined;
    const stop = (reason: string) => {
      if (!pid || killedBy) return;
      killedBy = reason;
      killAll(pid, tracked, "SIGTERM");
      setTimeout(() => killAll(pid, tracked, "SIGKILL"), 10_000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop("wall limit"); }, o.wallMs);
    const tick = setInterval(() => {
      if (!pid) return;
      for (const [p, l] of descendants(pid)) tracked.set(p, l);
      const why = o.onTick?.();
      if (why) stop(why);
    }, TICK_MS);
    const done = (r: Omit<LaunchResult, "elapsedMs" | "timedOut" | "pid" | "killedBy">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(tick);
      if (pid) { killAll(pid, tracked, "SIGKILL"); liveRuns.delete(pid); }
      resolveP({ ...r, timedOut, elapsedMs: Date.now() - started, pid, killedBy: timedOut ? undefined : killedBy });
    };
    child.on("error", (e) => done({ code: null, spawnError: e.message }));
    child.on("exit", (code) => done({ code }));
  });
}

// ── Transcript ───────────────────────────────────────────────────────────────

export interface ParsedTranscript { result: any; sessionId?: string; toolCalls: number; model?: string; apiKeySource?: string }

export function parseClaudeTranscript(text: string): ParsedTranscript {
  const p: ParsedTranscript = { result: null, toolCalls: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    if (j?.type === "system" && j.subtype === "init") { p.sessionId = j.session_id ?? p.sessionId; p.model = j.model ?? p.model; p.apiKeySource = j.apiKeySource ?? p.apiKeySource; }
    else if (j?.type === "assistant") { for (const c of j.message?.content ?? []) if (c?.type === "tool_use") p.toolCalls++; }
    else if (j?.type === "result") { p.result = j; p.sessionId = j.session_id ?? p.sessionId; }
  }
  return p;
}

/** Why the credential the CLI reports is not the one asked for, or null. */
export function authMismatch(auth: CcAuth, apiKeySource: string | undefined): string | null {
  if (apiKeySource === undefined) return null;
  if (auth === "api" && apiKeySource !== "ANTHROPIC_API_KEY") return `LUXAS_CC_AUTH=api but the CLI authenticated with "${apiKeySource}"`;
  if (auth === "subscription" && (apiKeySource === "ANTHROPIC_API_KEY" || apiKeySource === "apiKeyHelper")) return `LUXAS_CC_AUTH=subscription but the CLI authenticated with "${apiKeySource}"`;
  return null;
}

/**
 * How the run ended, for SubAgentExit. A run stopped by its own budget or turn
 * limit still goes to review (it may have delivered); a provider abort, a CLI
 * error or a missing result line is "error"; the wall limit is "killed".
 */
export function classifyCcRun(p: ParsedTranscript, launch: LaunchResult, wallMin: number, stderrTail: string): { stopReason: SubAgentStopReason; errorMessage?: string; note?: string } {
  const r = p.result;
  if (launch.spawnError) return { stopReason: "error", errorMessage: `could not start claude: ${launch.spawnError}` };
  if (launch.timedOut) return { stopReason: "killed", errorMessage: `wall limit ${wallMin} min`, note: `stopped at the ${wallMin}-minute wall limit` };
  if (launch.killedBy) return { stopReason: "error", errorMessage: launch.killedBy };
  if (!r) return { stopReason: "error", errorMessage: `claude exited (code ${launch.code}) without a result line${stderrTail ? `: ${stderrTail}` : ""}` };
  // The CLI reports a provider abort (no credit, an outage) as subtype "success" with is_error.
  if (r.is_error === true && r.terminal_reason === "api_error") return { stopReason: "error", errorMessage: `provider abort: ${String(r.result || "api_error").slice(0, 200)}` };
  if (r.subtype === "error_max_budget_usd") return { stopReason: "stop", errorMessage: "max budget reached", note: "stopped at its budget" };
  if (r.subtype === "error_max_turns") return { stopReason: "stop", errorMessage: "max turns reached", note: "stopped at its turn limit" };
  if (r.is_error === true || (typeof r.subtype === "string" && r.subtype.startsWith("error"))) {
    return { stopReason: "error", errorMessage: `${r.subtype ?? "error"}: ${String(r.result ?? "").slice(0, 200)}` };
  }
  return { stopReason: "stop" };
}

// ── Spend as it accrues ──────────────────────────────────────────────────────

// $/Mtok: input, output, cache read, 5-minute and 1-hour cache writes. Only for
// rows logged during an api run, so the cap acts mid-run; the CLI's own total
// settles the run's spend at the end. An unknown model is priced as Opus.
const PRICES: { re: RegExp; p: [number, number, number, number, number] }[] = [
  { re: /haiku/, p: [1, 5, 0.1, 1.25, 2] },
  { re: /sonnet/, p: [3, 15, 0.3, 3.75, 6] },
  { re: /.*/, p: [5, 25, 0.5, 6.25, 10] },
];

export interface MessageUsage { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }

function usageOf(u: any): MessageUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const w1h = n(u?.cache_creation?.ephemeral_1h_input_tokens);
  const w5m = u?.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : n(u?.cache_creation_input_tokens);
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), cacheRead: n(u?.cache_read_input_tokens), cacheWrite5m: w5m, cacheWrite1h: w1h };
}

export function priceUsage(model: string, u: MessageUsage): number {
  const [i, o, cr, w5, w1] = PRICES.find((x) => x.re.test(model))!.p;
  return (u.input * i + u.output * o + u.cacheRead * cr + u.cacheWrite5m * w5 + u.cacheWrite1h * w1) / 1e6;
}

/** Reads the transcript as it grows: the init line, and each finished API message's usage, once per message id. */
class TranscriptTail {
  private offset = 0;
  private partial = "";
  private order: string[] = [];
  private usage = new Map<string, MessageUsage>();
  private flushed = new Set<string>();
  apiKeySource?: string;
  model?: string;
  constructor(private path: string) {}
  read(): void {
    let fd: number | undefined;
    try {
      fd = openSync(this.path, "r");
      const buf = Buffer.alloc(1 << 20);
      for (;;) {
        const n = readSync(fd, buf, 0, buf.length, this.offset);
        if (n <= 0) break;
        this.offset += n;
        this.partial += buf.subarray(0, n).toString("utf-8");
      }
    } catch { return; } finally { if (fd !== undefined) closeSync(fd); }
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) {
      let j: any;
      try { j = JSON.parse(line); } catch { continue; }
      if (j?.type === "system" && j.subtype === "init") { this.apiKeySource ??= j.apiKeySource; this.model ??= j.model; }
      else if (j?.type === "assistant" && j.message?.usage) {
        const id = String(j.message.id ?? `#${this.order.length}`);
        if (!this.usage.has(id)) this.order.push(id);
        this.usage.set(id, usageOf(j.message.usage));
      }
    }
  }
  /** Messages not yet logged; the newest is held back while the run lives (a message can arrive as several events). */
  takeFinished(final: boolean): MessageUsage[] {
    const ids = final ? this.order : this.order.slice(0, -1);
    const out: MessageUsage[] = [];
    for (const id of ids) if (!this.flushed.has(id)) { this.flushed.add(id); out.push(this.usage.get(id)!); }
    return out;
  }
  get messages(): number { return this.order.length; }
}

// ── Sessions: one Claude Code session per experiment ─────────────────────────

const ccDir = (projectDir: string) => join(projectDir, ".agent", "claude-code");
const sessionFile = (projectDir: string, eid: string) => join(ccDir(projectDir), `session-${eid.replace(/[^\w.-]/g, "_")}.json`);

/** The experiment's session id, if the file holds a UUID (it is in the project, where the executor can write). */
export function readExperimentSession(projectDir: string, eid: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(sessionFile(projectDir, eid), "utf-8"));
    return typeof j.sessionId === "string" && SESSION_ID_RE.test(j.sessionId) ? j.sessionId : undefined;
  } catch { return undefined; }
}

function writeExperimentSession(projectDir: string, eid: string, rec: Record<string, unknown>): void {
  const p = sessionFile(projectDir, eid);
  writeFileSync(`${p}.tmp`, JSON.stringify(rec, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
}

/** The cap this process enforces (registered at start-up, out of the executor's reach); run_config.json only when none is. */
function runCapUsd(projectDir: string, logPath: string): number {
  const inMemory = costCapFor(logPath);
  if (inMemory !== undefined) return inMemory;
  try {
    const cfg = JSON.parse(readFileSync(join(projectDir, ".agent", "run_config.json"), "utf-8"));
    if (typeof cfg.maxCost === "number" && Number.isFinite(cfg.maxCost)) return cfg.maxCost;
  } catch { /* no run_config: the same fallback as the runner's */ }
  return 250;
}

const positive = (s: string | undefined, dflt: number) => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : dflt; };
const alive = (pid: unknown) => { if (!Number.isInteger(pid) || (pid as number) <= 1) return false; try { process.kill(pid as number, 0); return true; } catch { return false; } };
const readBytes = (p: string) => { try { return readFileSync(p); } catch { return null; } };

// ── The executor ─────────────────────────────────────────────────────────────

export interface CcRunOptions {
  /** false in the background runner, which registered the agent and keeps its heartbeat. */
  register?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function runClaudeCodeExperiment(opts: SpawnAgentOptions, run: CcRunOptions = {}): Promise<SpawnAgentResult> {
  const env = run.env ?? process.env;
  const started = Date.now();
  const projectDir = opts.projectDir;
  const agentDir = join(projectDir, ".agent");
  const logPath = join(agentDir, "usage.log");
  const suffix = opts.instanceIndex !== undefined ? `-${opts.instanceIndex}` : `-${Math.random().toString(36).slice(2, 8)}`;
  const agentId = opts.resume?.agentId ?? opts.agentId ?? (opts.parentAgentId ? `${opts.parentAgentId}.${opts.name}${suffix}` : `${opts.name}${suffix}`);
  const eid = String(opts.templateVars?.EXPERIMENT_ID ?? "");
  const exitOf = (stopReason: SubAgentStopReason, extra: Partial<SubAgentExit> = {}): SubAgentExit => ({
    stopReason, filesTouched: [], elapsedMs: Date.now() - started, toolCallCount: 0, endedAt: new Date().toISOString(),
    ...(opts.resume ? { revisionNumber: opts.resume.revisionNumber } : {}), ...extra,
  });
  const refuse = (why: string): SpawnAgentResult => {
    recordAgentOutcome(projectDir, opts.name, false, why);
    return { output: `[harness: Claude Code executor not started — ${why}]`, elapsed: Date.now() - started, success: false, exit: exitOf("error", { errorMessage: why }), agentId };
  };
  // A stop from the board holds until the operator asks for a rework (src/board-actions.ts).
  const held = (): SpawnAgentResult | null => {
    const h = stoppedByOperator(projectDir, eid);
    return h ? { output: `[harness: ${operatorStopNote(eid, h)}; not started. Do not dispatch it again unless the operator asks for a rework.]`, elapsed: 0, success: false, exit: exitOf("killed", { errorMessage: "stopped by the operator" }), agentId } : null;
  };

  const auth = ccAuth(env);
  if (!auth) return refuse("LUXAS_CC_AUTH is neither subscription nor api");
  if (!eid) return refuse("no EXPERIMENT_ID template variable");
  const heldNow = held();
  if (heldNow) return heldNow;
  // api: the key Luxas resolves, not process.env (`luxas run` removed it from there at start-up).
  const apiKey = auth === "api" ? await opts.getApiKey("anthropic") : undefined;
  if (auth === "api") { const p = apiKeyProblem(apiKey); if (p) return refuse(p); }

  // The prompt the pi executor would get: the solo definition, then the experiment context.
  const def = (opts.resolveDefinition ?? getDefinition)("experiment");
  const templateVars = { SPAWN_ID: agentId, ...opts.templateVars };
  const context = resolveContextBuilder(def.contextBuilder)?.(projectDir, { ...opts.contextExtra, templateVars });
  const systemAppend = [resolvePrompt(def, templateVars), context, executorNote(eid, auth)].filter(Boolean).join("\n\n");

  // Budget: what is left of the run's cap after what is spent and what the
  // other running executors may still spend (each reserved its budget in its marker).
  const spent = readUsageTotals(logPath).cost;
  const cap = runCapUsd(projectDir, logPath);
  const reserved = auth === "api"
    ? readRunningMarkers(projectDir).filter((m) => m.eid !== eid && alive(m.hostPid) && alive(m.pgid)).reduce((s, m) => s + (m.budget ?? 0), 0)
    : 0;
  const perRun = positive(env.LUXAS_CC_MAX_USD, DEFAULT_MAX_USD);
  // On the subscription the run's list price is not spend, so only the per-run bound applies.
  const budget = auth === "api" ? Math.min(perRun, cap - spent - reserved) : perRun;
  if (budget < MIN_LAUNCH_USD) return refuse(`$${(cap - spent - reserved).toFixed(2)} left of the $${cap} run cap (after $${reserved.toFixed(2)} reserved by running executors)`);
  const wallMin = positive(env.LUXAS_CC_WALL_MIN, DEFAULT_WALL_MIN);
  const model = env.LUXAS_EXECUTOR_MODEL || CC_DEFAULT_MODEL;
  const effort = env.LUXAS_EXECUTOR_EFFORT || "high";
  // A re-run of the same experiment (not delivered, declarations, a revision,
  // action="continue") resumes its session, so it keeps what it already did.
  const resumeSessionId = env.LUXAS_CC_RESUME === "0" ? undefined : readExperimentSession(projectDir, eid);
  const freshSessionId = resumeSessionId ? undefined : randomUUID();

  mkdirSync(ccDir(projectDir), { recursive: true });
  const convDir = join(agentDir, "conversations");
  mkdirSync(convDir, { recursive: true });
  const convPath = join(convDir, `${agentId}.jsonl`);
  const runNo = readdirSync(ccDir(projectDir)).filter((f) => f.startsWith(`${agentId}.`) && f.endsWith(".jsonl")).length + 1;
  const transcriptPath = join(ccDir(projectDir), `${agentId}.${runNo}.jsonl`);
  const stderrPath = join(ccDir(projectDir), `${agentId}.${runNo}.stderr.txt`);
  const systemPromptFile = join(ccDir(projectDir), `${agentId}.${runNo}.system.md`);
  writeFileSync(systemPromptFile, systemAppend, { mode: 0o600 });
  try { chmodSync(systemPromptFile, 0o600); } catch { /* best effort */ }

  // The same markers spawnAgent writes, so action="continue", studio and the monitor find the agent.
  appendFileSync(convPath, JSON.stringify(opts.resume
    ? { type: "continue_init", newTask: opts.prompt.slice(0, 2000), timestamp: Date.now() }
    : { type: "spawn_init", agent: opts.name, task: opts.prompt.slice(0, 2000), parentAgentId: opts.parentAgentId, templateVars: opts.templateVars, timestamp: Date.now(),
        ...(opts.prompt.length > 2000 ? { contextTask: opts.prompt } : {}) }) + "\n");
  try {
    appendFileSync(join(agentDir, "log.jsonl"), JSON.stringify({
      type: "tool_call", tool: "spawn_agent", phase: "started",
      args: { agent: opts.name, agent_id: agentId, parent_agent_id: opts.parentAgentId, executor: "claude-code" },
      success: true, timestamp: new Date().toISOString(),
    }) + "\n");
  } catch { /* observability must not crash the spawn */ }
  const register = run.register !== false;
  if (register) {
    try {
      addAgent(agentDir, { id: agentId, name: opts.name, task: opts.prompt.slice(0, 200), mode: opts.instanceIndex !== undefined ? "parallel" : "foreground",
        startedAt: Date.now(), conversationFile: convPath, hostPid: process.pid, hostPpid: process.ppid, status: "running" });
    } catch { /* registry is best-effort */ }
  }

  const roots = executorWriteRoots(def, eid);
  const before = projectSnapshot(projectDir, roots);
  const researchPath = join(projectDir, "RESEARCH.md");
  const researchBefore = readBytes(researchPath);
  // Harness files the executor could turn against its own controls: the cap, the spend so far, the operator's decisions.
  const guarded = ["run_config.json", "usage.log", "board-actions.jsonl"].map((f) => ({ f, path: join(agentDir, f), bytes: readBytes(join(agentDir, f)) }));
  const loggedRows: UsageEntry[] = [];
  const logRow = (u: MessageUsage, cost: number) => {
    const row: UsageEntry = { timestamp: Date.now(), model: tail.model ?? model, provider: auth === "api" ? "anthropic" : "claude-subscription",
      input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite5m + u.cacheWrite1h, cost };
    loggedRows.push(row);
    jobOwnerAls.run({ agentId, agentType: opts.name, projectDir }, () => appendUsage(logPath, row));
  };
  const tail = new TranscriptTail(transcriptPath);
  let loggedCost = 0;
  const flushUsage = (final: boolean) => {
    for (const u of tail.takeFinished(final)) {
      const cost = auth === "api" ? priceUsage(tail.model ?? model, u) : 0;
      loggedCost += cost;
      logRow(u, cost);
    }
  };

  // The stop window between the check above and the marker: checked again just before launching.
  const heldLate = held();
  if (heldLate) { if (register) try { removeAgent(agentDir, agentId); } catch { /* best effort */ } return heldLate; }
  // This run acts on any rework the operator asked for: the brain stops seeing that directive.
  archiveBoardDirectives(projectDir, eid, "rework");
  let authProblem: string | undefined;
  const launch = await launchClaudeCode(claudeBin(env), claudeCodeArgs({ systemPromptFile, model, effort, maxBudgetUsd: budget, sessionId: freshSessionId, resumeSessionId }), {
    cwd: opts.workDir ?? projectDir, env: claudeCodeEnv(env, auth, apiKey), wallMs: wallMin * 60_000, transcriptPath, stderrPath, stdin: opts.prompt,
    // The board's stop is enforced here, by the host that holds the group: it polls the decision log.
    onStart: (pgid) => writeRunningMarker(projectDir, eid, { eid, pgid, hostPid: process.pid, agentId, startedAt: new Date(started).toISOString(), budget: auth === "api" ? budget : 0 }),
    onTick: () => {
      tail.read();
      const mismatch = authMismatch(auth, tail.apiKeySource);
      if (mismatch) { authProblem = mismatch; return mismatch; }
      flushUsage(false);
      // The cap that kills the process for any other agent's call applies to this spend too, as it accrues.
      if (auth === "api" && loggedCost > 0) enforceCostCap(logPath);
      if (stopIssuedSince(projectDir, eid, started)) return "stopped by the operator";
      return undefined;
    },
  });
  if (launch.pid) clearRunningMarker(projectDir, eid, launch.pid);
  const operatorStop = stopIssuedSince(projectDir, eid, started);

  tail.read();
  const parsed = parseClaudeTranscript(readFileSync(transcriptPath, "utf-8"));
  authProblem ??= authMismatch(auth, parsed.apiKeySource) ?? undefined;
  let stderrTail = "";
  try { stderrTail = readFileSync(stderrPath, "utf-8").trim().split("\n").slice(-3).join(" | ").slice(0, 300); } catch { /* none */ }
  const verdict = operatorStop
    ? { stopReason: "killed" as SubAgentStopReason, errorMessage: "stopped by the operator", note: `${operatorStopNote(eid, operatorStop)}; do not dispatch it again unless the operator asks for a rework` }
    : authProblem ? { stopReason: "error" as SubAgentStopReason, errorMessage: authProblem }
    : classifyCcRun(parsed, launch, wallMin, stderrTail);
  const r = parsed.result;
  const listUsd = typeof r?.total_cost_usd === "number" ? r.total_cost_usd : 0;

  // Spend: the messages not yet logged, then the CLI's own total settles the
  // run (a correction row, which may be negative). A CLI that reports no
  // per-message usage gets one row from its totals.
  flushUsage(true);
  if (r && tail.messages === 0 && r.usage) { const u = usageOf(r.usage); logRow(u, auth === "api" ? listUsd : 0); loggedCost += auth === "api" ? listUsd : 0; }
  else if (r && auth === "api" && Math.abs(listUsd - loggedCost) > 1e-4) { logRow({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, listUsd - loggedCost); loggedCost = listUsd; }

  const sessionId = parsed.sessionId ?? resumeSessionId ?? freshSessionId;
  // A rework asked for while this run was going starts the next run fresh, so this session is not kept.
  const reworkDuring = latestActionFor(readBoardActions(projectDir), eid);
  const keepSession = !(reworkDuring?.action === "rework" && Date.parse(reworkDuring.at) >= started - 1000);
  if (sessionId && SESSION_ID_RE.test(sessionId) && r && keepSession) writeExperimentSession(projectDir, eid, { sessionId, agentId, updatedAt: new Date().toISOString() });

  const notes: string[] = [];
  if (verdict.note) notes.push(verdict.note);
  const changes = snapshotChanges(before, projectSnapshot(projectDir, roots));
  if (researchBefore) {
    const now = readBytes(researchPath);
    if (!now || !now.equals(researchBefore)) {
      writeFileSync(researchPath, researchBefore);
      notes.push("changed RESEARCH.md, which was put back as it was before the run");
    }
  }
  // run_config.json is put back whole; usage.log and the decision log only
  // grow, so a run that rewrote what was there before gets it back (its own
  // usage rows re-appended; rows another agent appended during the run are lost).
  for (const g of guarded) {
    const now = readBytes(g.path);
    if (g.f === "run_config.json") {
      if (g.bytes ? !now?.equals(g.bytes) : now !== null) {
        if (g.bytes) writeFileSync(g.path, g.bytes); else try { unlinkSync(g.path); } catch { /* gone */ }
        notes.push("changed .agent/run_config.json, which was put back");
      }
    } else if (g.bytes && (!now || now.length < g.bytes.length || !now.subarray(0, g.bytes.length).equals(g.bytes))) {
      writeFileSync(g.path, g.bytes);
      if (g.f === "usage.log") for (const row of loggedRows) jobOwnerAls.run({ agentId, agentType: opts.name, projectDir }, () => appendUsage(logPath, row));
      notes.push(`rewrote .agent/${g.f}, which was put back`);
    }
  }
  const outside = changes.filter((c) => !c.endsWith(" RESEARCH.md"));
  if (outside.length) notes.push(`changed files outside its write roots (${roots.join(", ")}): ${outside.slice(0, 20).join("; ")}${outside.length > 20 ? `; and ${outside.length - 20} more` : ""}`);
  if (verdict.stopReason === "error" && verdict.errorMessage) notes.push(verdict.errorMessage);

  let output = (typeof r?.result === "string" && r.result.trim()) || "(no output)";
  if (notes.length) output += `\n\n---\n[harness: Claude Code executor ${notes.join("; ")}]`;

  try {
    appendFileSync(convPath, JSON.stringify({ role: "assistant", content: [{ type: "text", text: output.slice(0, 50_000) }], timestamp: Date.now() }) + "\n");
    appendFileSync(convPath, JSON.stringify({ type: "claude_code_run", sessionId, resumed: !!resumeSessionId, transcript: transcriptPath, auth, model: parsed.model ?? model,
      listUsd, billedUsd: auth === "api" ? loggedCost : 0, stopReason: verdict.stopReason, outsideChanges: outside.length, timestamp: Date.now() }) + "\n");
    appendFileSync(join(agentDir, "log.jsonl"), JSON.stringify({
      type: "claude_code_run", agent_id: agentId, experiment: eid, auth, list_usd: listUsd, billed_usd: auth === "api" ? loggedCost : 0,
      stop_reason: verdict.stopReason, wall_ms: launch.elapsedMs, outside_changes: outside, timestamp: new Date().toISOString(),
    }) + "\n");
  } catch { /* observability must not crash the spawn */ }

  if (register) try { removeAgent(agentDir, agentId); } catch { /* registry is best-effort */ }
  // An operator stop is not a capability failure (spawnAgent skips "killed" the same way).
  if (!operatorStop) recordAgentOutcome(projectDir, opts.name, verdict.stopReason !== "error", verdict.errorMessage);
  if (auth === "api" && loggedCost > 0) enforceCostCap(logPath);

  const exit = exitOf(verdict.stopReason, { errorMessage: verdict.errorMessage, toolCallCount: parsed.toolCalls, elapsedMs: launch.elapsedMs });
  // success:false for an operator stop: the review loop returns it as is instead of re-sending an "undelivered" run.
  return { output: output.slice(0, 50_000), elapsed: launch.elapsedMs, success: !launch.spawnError && !operatorStop && !authProblem, exit, agentId };
}
