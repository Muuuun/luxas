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
 * (ANTHROPIC_API_KEY is removed from the child's env, the run's usage row is
 * logged at cost 0 and its list price goes to log.jsonl), LUXAS_CC_AUTH=api
 * bills ANTHROPIC_API_KEY and logs the cost, so the run's cap counts it. The
 * choice is the operator's: the subscription is for the operator's own
 * projects, and preflight refuses it for a studio tenant's project.
 *
 * What the pi executor has and this one does not: Luxas's write guards and
 * per-call hooks never see Claude Code's tool calls. The project is compared
 * before and after the run instead; changes outside the experiment's write
 * roots are reported to the brain, and RESEARCH.md is put back.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefinition, resolvePrompt } from "../agents/registry.js";
import { resolveContextBuilder } from "../agents/context-builders.js";
import type { SpawnAgentOptions, SpawnAgentResult } from "../agents/spawn.js";
import { addAgent, removeAgent, type SubAgentExit, type SubAgentStopReason } from "../active-agents.js";
import { recordAgentOutcome } from "../agent-liveness.js";
import { appendUsage, enforceCostCap, readUsageTotals } from "../usage-log.js";
import { jobOwnerAls } from "../jobs/als.js";

export type CcAuth = "subscription" | "api";

export const CC_DEFAULT_MODEL = "claude-opus-5-5";
// The tool set the executor comparison measured. --allowedTools takes the rest of the line, so it goes last.
export const CC_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const DEFAULT_MAX_USD = 25;
const DEFAULT_WALL_MIN = 240;
const MIN_LAUNCH_USD = 0.5;

export function claudeCodeExecutorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LUXAS_EXPERIMENT_MODE === "claude-code";
}

export function ccAuth(env: NodeJS.ProcessEnv = process.env): CcAuth | null {
  return env.LUXAS_CC_AUTH === "subscription" || env.LUXAS_CC_AUTH === "api" ? env.LUXAS_CC_AUTH : null;
}

const claudeBin = (env: NodeJS.ProcessEnv) => env.LUXAS_CLAUDE_BIN || "claude";
// A studio tenant's project (memory.ts ownerKey): /<hex12>/projects/<name>.
const TENANT_PATH = /\/[0-9a-f]{12}\/projects\/[^/]+\/?$/;

/** Why a claude-code run must not start; empty = it may. `luxas run` refuses before any spend. */
export function claudeCodePreflight(env: NodeJS.ProcessEnv = process.env, projectDir?: string): string[] {
  const problems: string[] = [];
  const auth = ccAuth(env);
  if (!auth) {
    problems.push("LUXAS_EXPERIMENT_MODE=claude-code needs LUXAS_CC_AUTH=subscription (your claude.ai login, not billed) or LUXAS_CC_AUTH=api (ANTHROPIC_API_KEY, billed and counted against --max-cost)");
  }
  if (auth === "api" && !env.ANTHROPIC_API_KEY) problems.push("LUXAS_CC_AUTH=api but ANTHROPIC_API_KEY is not set");
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
  prompt: string;
  systemAppend: string;
  model: string;
  effort: string;
  maxBudgetUsd: number;
  /** A fresh session gets this id, so the harness knows it before the first event. */
  sessionId?: string;
  /** Resume this session instead (the experiment's earlier run). */
  resumeSessionId?: string;
}

/**
 * The executor's argv. The model is always pinned: the CLI's default changes
 * between sessions (it became fable on this Mac in October). User skills,
 * user settings, MCP servers and auto-memory stay out (the executor comparison
 * found Claude Code loading the home repo's auto-memory and the user's skills).
 */
export function claudeCodeArgs(o: CcArgsOptions): string[] {
  return [
    "-p", o.prompt,
    "--model", o.model,
    "--effort", o.effort,
    "--max-budget-usd", o.maxBudgetUsd.toFixed(2),
    "--permission-mode", "acceptEdits",
    "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "project,local",
    "--append-system-prompt", o.systemAppend,
    ...(o.resumeSessionId ? ["--resume", o.resumeSessionId] : ["--session-id", o.sessionId ?? randomUUID()]),
    "--allowedTools", ...CC_TOOLS,
  ];
}

// CLAUDE_CODE_* variables that configure auth or a provider pass through; the
// rest tie a child to the session that launched Luxas (an interactive Claude
// Code's session id and messaging socket) and are dropped, with CLAUDECODE.
const KEEP_CLAUDE_CODE_VAR = /^CLAUDE_CODE_(OAUTH_TOKEN|USE_[A-Z_]+|SKIP_[A-Z_]+_AUTH|API_KEY_HELPER_TTL_MS|MAX_OUTPUT_TOKENS|CLIENT_CERT|CLIENT_KEY[A-Z_]*)$/;

export function claudeCodeEnv(base: NodeJS.ProcessEnv, auth: CcAuth): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === "CLAUDECODE") continue;
    if (k.startsWith("CLAUDE_CODE_") && !KEEP_CLAUDE_CODE_VAR.test(k)) continue;
    env[k] = v;
  }
  // With a key in the env, claude -p bills the key, whatever login exists.
  if (auth === "subscription") { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; }
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

// ── Launch ───────────────────────────────────────────────────────────────────

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

export interface LaunchResult { code: number | null; timedOut: boolean; elapsedMs: number; pid?: number; spawnError?: string }

/**
 * Run `bin args` in its own process group from `cwd`, stdout appended to
 * `transcriptPath`, stderr to `stderrPath`. At the wall limit the group gets
 * SIGTERM, then SIGKILL; after the CLI exits the group is killed anyway, which
 * takes out background jobs it left running (the bench runner left a blender
 * process holding a core for six days that way).
 */
export function launchClaudeCode(bin: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; wallMs: number; transcriptPath: string; stderrPath: string; hostPid?: number }): Promise<LaunchResult> {
  const started = Date.now();
  const out = openSync(o.transcriptPath, "a");
  const err = openSync(o.stderrPath, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("/bin/sh", ["-c", WATCHDOG_SCRIPT, "luxas-claude-code", String(o.hostPid ?? process.pid), bin, ...args],
      { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", out, err] });
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const pid = child.pid;
  const killGroup = (sig: NodeJS.Signals) => { if (pid) try { process.kill(-pid, sig); } catch { /* group gone */ } };
  return new Promise((resolveP) => {
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
    }, o.wallMs);
    const done = (r: Omit<LaunchResult, "elapsedMs" | "timedOut" | "pid">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup("SIGKILL");
      resolveP({ ...r, timedOut, elapsedMs: Date.now() - started, pid });
    };
    child.on("error", (e) => done({ code: null, spawnError: e.message }));
    child.on("exit", (code) => done({ code }));
  });
}

// ── Transcript ───────────────────────────────────────────────────────────────

export interface ParsedTranscript { result: any; sessionId?: string; toolCalls: number; model?: string }

export function parseClaudeTranscript(text: string): ParsedTranscript {
  const p: ParsedTranscript = { result: null, toolCalls: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    if (j?.type === "system" && j.subtype === "init") { p.sessionId = j.session_id ?? p.sessionId; p.model = j.model ?? p.model; }
    else if (j?.type === "assistant") { for (const c of j.message?.content ?? []) if (c?.type === "tool_use") p.toolCalls++; }
    else if (j?.type === "result") { p.result = j; p.sessionId = j.session_id ?? p.sessionId; }
  }
  return p;
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

// ── Sessions: one Claude Code session per experiment ─────────────────────────

const ccDir = (projectDir: string) => join(projectDir, ".agent", "claude-code");
const sessionFile = (projectDir: string, eid: string) => join(ccDir(projectDir), `session-${eid.replace(/[^\w.-]/g, "_")}.json`);

export function readExperimentSession(projectDir: string, eid: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(sessionFile(projectDir, eid), "utf-8"));
    return typeof j.sessionId === "string" && j.sessionId ? j.sessionId : undefined;
  } catch { return undefined; }
}

function writeExperimentSession(projectDir: string, eid: string, rec: Record<string, unknown>): void {
  const p = sessionFile(projectDir, eid);
  writeFileSync(`${p}.tmp`, JSON.stringify(rec, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
}

function runCapUsd(projectDir: string): number {
  try {
    const cfg = JSON.parse(readFileSync(join(projectDir, ".agent", "run_config.json"), "utf-8"));
    if (typeof cfg.maxCost === "number" && Number.isFinite(cfg.maxCost)) return cfg.maxCost;
  } catch { /* no run_config: the same fallback as the runner's */ }
  return 250;
}

const positive = (s: string | undefined, dflt: number) => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : dflt; };

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

  const auth = ccAuth(env);
  if (!auth) return refuse("LUXAS_CC_AUTH is neither subscription nor api");
  if (!eid) return refuse("no EXPERIMENT_ID template variable");

  // The prompt the pi executor would get: the solo definition, then the experiment context.
  const def = (opts.resolveDefinition ?? getDefinition)("experiment");
  const templateVars = { SPAWN_ID: agentId, ...opts.templateVars };
  const context = resolveContextBuilder(def.contextBuilder)?.(projectDir, { ...opts.contextExtra, templateVars });
  const systemAppend = [resolvePrompt(def, templateVars), context, executorNote(eid, auth)].filter(Boolean).join("\n\n");

  const spent = readUsageTotals(join(agentDir, "usage.log")).cost;
  const cap = runCapUsd(projectDir);
  const perRun = positive(env.LUXAS_CC_MAX_USD, DEFAULT_MAX_USD);
  // On the subscription the run's list price is not spend, so only the per-run bound applies.
  const budget = auth === "api" ? Math.min(perRun, cap - spent) : perRun;
  if (budget < MIN_LAUNCH_USD) return refuse(`$${(cap - spent).toFixed(2)} left of the $${cap} run cap`);
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
  const researchBefore = existsSync(researchPath) ? readFileSync(researchPath) : null;

  const launch = await launchClaudeCode(claudeBin(env), claudeCodeArgs({ prompt: opts.prompt, systemAppend, model, effort, maxBudgetUsd: budget, sessionId: freshSessionId, resumeSessionId }),
    { cwd: opts.workDir ?? projectDir, env: claudeCodeEnv(env, auth), wallMs: wallMin * 60_000, transcriptPath, stderrPath });

  const parsed = parseClaudeTranscript(readFileSync(transcriptPath, "utf-8"));
  let stderrTail = "";
  try { stderrTail = readFileSync(stderrPath, "utf-8").trim().split("\n").slice(-3).join(" | ").slice(0, 300); } catch { /* none */ }
  const verdict = classifyCcRun(parsed, launch, wallMin, stderrTail);
  const r = parsed.result;
  const listUsd = typeof r?.total_cost_usd === "number" ? r.total_cost_usd : 0;
  const u = r?.usage ?? {};

  // One usage row per run. Fields 9–10 name the experiment, as any agent's rows do.
  const logPath = join(agentDir, "usage.log");
  if (r) {
    jobOwnerAls.run({ agentId, agentType: opts.name, projectDir }, () => appendUsage(logPath, {
      timestamp: Date.now(), model: parsed.model ?? model, provider: auth === "api" ? "anthropic" : "claude-subscription",
      input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
      cost: auth === "api" ? listUsd : 0,
    }));
  }

  const sessionId = parsed.sessionId ?? resumeSessionId ?? freshSessionId;
  if (sessionId && r) writeExperimentSession(projectDir, eid, { sessionId, agentId, updatedAt: new Date().toISOString() });

  const notes: string[] = [];
  if (verdict.note) notes.push(verdict.note);
  const changes = snapshotChanges(before, projectSnapshot(projectDir, roots));
  if (researchBefore) {
    const now = existsSync(researchPath) ? readFileSync(researchPath) : null;
    if (!now || !now.equals(researchBefore)) {
      writeFileSync(researchPath, researchBefore);
      notes.push("changed RESEARCH.md, which was put back as it was before the run");
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
      listUsd, billedUsd: auth === "api" ? listUsd : 0, stopReason: verdict.stopReason, outsideChanges: outside.length, timestamp: Date.now() }) + "\n");
    appendFileSync(join(agentDir, "log.jsonl"), JSON.stringify({
      type: "claude_code_run", agent_id: agentId, experiment: eid, auth, list_usd: listUsd, billed_usd: auth === "api" ? listUsd : 0,
      stop_reason: verdict.stopReason, wall_ms: launch.elapsedMs, outside_changes: outside, timestamp: new Date().toISOString(),
    }) + "\n");
  } catch { /* observability must not crash the spawn */ }

  if (register) try { removeAgent(agentDir, agentId); } catch { /* registry is best-effort */ }
  recordAgentOutcome(projectDir, opts.name, verdict.stopReason !== "error", verdict.errorMessage);
  // The cap that kills the process for any other agent's call applies to this spend too.
  if (auth === "api" && listUsd > 0) enforceCostCap(logPath);

  const exit = exitOf(verdict.stopReason, { errorMessage: verdict.errorMessage, toolCallCount: parsed.toolCalls, elapsedMs: launch.elapsedMs });
  return { output: output.slice(0, 50_000), elapsed: launch.elapsedMs, success: !launch.spawnError, exit, agentId };
}
