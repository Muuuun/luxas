/**
 * Active agent registry — file-backed bookkeeping for running sub-agents.
 *
 * Replaces the in-memory `activeBackgroundAgents` Map with a JSON file
 * so brain can recover orphaned sub-agent results after crash.
 *
 * File: .agent/active-agents.json
 * Maintained by harness code only (not LLM).
 */

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, closeSync, openSync, unlinkSync, utimesSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { atomicWriteJson, extractTextContent, pidAlive } from "./utils.js";

/**
 * Normalized stop reason across sub-agent completion paths.
 *
 *   "stop"    — model ended the turn cleanly (pi-ai maps end_turn/pause_turn/
 *               stop_sequence to "stop")
 *   "length"  — max_tokens hit. Agent produced no final tool call; caller
 *               should treat this as recoverable, not terminal
 *   "error"   — provider returned an error-shaped response (refusal, HTTP 5xx,
 *               stream aborted mid-response without SIGINT)
 *   "killed"  — signal-aborted (pi-ai "aborted"; SIGTERM/SIGINT to subagent-runner,
 *               or parent calling agent.abort() on foreground)
 *   "unknown" — captured no reliable stopReason. Do NOT fake "length" here —
 *               downstream recovery logic depends on "length" being truthful
 */
export type SubAgentStopReason = "stop" | "length" | "error" | "killed" | "unknown";

export interface FileTouchRecord {
  path: string;           // absolute
  via: "write" | "edit";
  at: number;             // Date.now() millis
}

/**
 * Structured completion metadata for a sub-agent run. Written alongside
 * `result` by markDone/markFailed, consumed by parent harvest to decide
 * how to react (continue, retry with changed scope, fail up the stack).
 *
 * Best-effort: filesTouched may be empty on SIGKILL/crash, stopReason may
 * be "unknown" when pi-agent-core doesn't surface the underlying provider
 * signal.
 */
export interface SubAgentExit {
  stopReason: SubAgentStopReason;
  partialAssistantText?: string;   // present only when stopReason === "length" AND capture succeeded
  /**
   * Provider's errorMessage from the last assistant message when stopReason === "error".
   * Surfaced to parent so it can distinguish terminal classes (402 balance, 429 suspended,
   * 401 auth) from transient ones already retried at the F5 layer. Observed 2026-05-13:
   * UWR brain spawned typesetter 4× because the 429 "account suspended" was hidden behind
   * a bare "stopReason=error" hint and brain assumed retry would help.
   */
  errorMessage?: string;
  filesTouched: FileTouchRecord[]; // clean-exit best-effort; empty on killed
  elapsedMs: number;
  toolCallCount: number;           // assistant-message toolCall blocks seen
  lastContextTokens?: number;      // from tokenTap if available
  /**
   * Number of Phase 2 length-recovery attempts consumed before this exit.
   * 0 or undefined when the initial prompt resolved without a length
   * truncation. Populated by the outer recovery controller; present on both
   * successful (stopReason="stop") recovered runs and exhausted runs
   * (stopReason="length", attemptsUsed === MAX).
   */
  recoveryAttemptsUsed?: number;
  /**
   * Revision number of THIS run (1-indexed, includes this continue).
   * Absent on initial spawn (action="spawn"); set on every continue
   * (action="continue") to prior_continue_init_count + 1. Caller uses this
   * for cap awareness — typical contract is cap=3 per logical agent, after
   * which the caller marks the work WIP and stops issuing continues.
   */
  revisionNumber?: number;
  endedAt: string;                 // ISO-8601
}

/**
 * Classify a thrown error (from buildAgentFromDefinition or agent.prompt)
 * into the SubAgentStopReason vocabulary. Pure — callable from any catch.
 * AbortError / "aborted" in the message indicates a signal-initiated stop
 * (SIGINT/SIGTERM to the runner, or parent calling agent.abort()).
 */
export function classifyThrownStopReason(err: unknown): SubAgentStopReason {
  const msg = (err as any)?.message ?? String(err);
  const name = (err as any)?.name;
  return name === "AbortError" || /aborted/i.test(msg) ? "killed" : "error";
}

export interface ActiveAgent {
  id: string;             // "brain.worker-0"
  name: string;           // "worker"
  task: string;           // task summary (truncated)
  mode: "foreground" | "background" | "parallel";
  startedAt: number;
  conversationFile: string;
  pid?: number;           // independent process PID
  /**
   * In-process entries only: the process the spawn runs in (spawn.ts addAgent)
   * — the brain, a background runner, or scripts/review_experiment.mts. Such
   * an entry has no pid or heartbeat of its own; it lives as long as this
   * process does. Absent on legacy entries.
   */
  hostPid?: number;
  /**
   * The host's parent. A studio launch writes run.pid as the tsx wrapper's
   * pid and the brain runs in tsx's inner process, so the brain's own work
   * is known by run.pid === hostPpid.
   */
  hostPpid?: number;
  status?: "running" | "done" | "failed";
  result?: string;        // frozen result text (written by sub-agent on completion)
  /**
   * Structured completion metadata. Present iff status is "done" or "failed"
   * and the completion path produced it. Absent on "running" agents and on
   * crash-exited agents whose markDone/markFailed never fired.
   */
  exit?: SubAgentExit;
  /**
   * File path the agent is expected to produce. Used by brain's Layer 3 snapshot
   * to surface "in-flight" artifacts and prevent duplicate spawns. Extracted from
   * the task string at spawn time (looks for `→ path` or file path tokens), or
   * passed explicitly by the caller. Empty string when no artifact expected
   * (search, reader, math, reviewer).
   */
  expected_artifact?: string;
}

const FILENAME = "active-agents.json";

function registryPath(agentDir: string): string {
  return join(agentDir, FILENAME);
}

export function loadRegistry(agentDir: string): ActiveAgent[] {
  try {
    return JSON.parse(readFileSync(registryPath(agentDir), "utf-8"));
  } catch {
    return [];
  }
}

function saveRegistry(agentDir: string, agents: ActiveAgent[]): void {
  atomicWriteJson(registryPath(agentDir), agents);
}

// Exclusive-file lock around load-mutate-save. Without this, two sub-agents
// calling markDone/markFailed in overlapping windows would both read the old
// registry and both save their own update — last writer wins, the other
// update vanishes. Lock file is auto-reclaimed if older than STALE_MS (a
// crashed sub-agent would otherwise orphan it); the stale-unlink itself is
// racy (two waiters can both judge stale) but the next openSync(wx) serializes
// them — at most one wins, others see EEXIST and retry.
const LOCK_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function withRegistryLock(agentDir: string, fn: (agents: ActiveAgent[]) => void): void {
  mkdirSync(agentDir, { recursive: true });
  const lockPath = registryPath(agentDir) + ".lock";
  const MAX_RETRIES = 30;
  const SLEEP_MS = 50;
  const STALE_MS = 10_000;

  let fd: number | null = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          try { unlinkSync(lockPath); } catch { /* another waiter got there first */ }
          continue;
        }
      } catch { /* lock vanished between catch and stat — just retry */ }
      Atomics.wait(LOCK_SLEEP_BUF, 0, 0, SLEEP_MS);
    }
  }
  if (fd === null) {
    throw new Error(`active-agents: failed to acquire ${lockPath} after ${MAX_RETRIES * SLEEP_MS}ms`);
  }

  try {
    const agents = loadRegistry(agentDir);
    fn(agents);
    saveRegistry(agentDir, agents);
  } finally {
    try { closeSync(fd); } catch {}
    try { unlinkSync(lockPath); } catch {}
  }
}

export function addAgent(agentDir: string, agent: ActiveAgent): void {
  if (agent.expected_artifact === undefined) {
    agent.expected_artifact = extractExpectedArtifact(agent.task);
  }
  withRegistryLock(agentDir, (agents) => {
    const idx = agents.findIndex(a => a.id === agent.id);
    if (idx >= 0) agents.splice(idx, 1);
    agents.push(agent);
  });
}

/**
 * Extract the expected output artifact path from a task string.
 *
 * Brain is instructed to include an explicit target (e.g. "Return: design/spec_X.md"
 * or "→ circuits/Y.stim") in every experiment spawn. This heuristic surfaces that
 * path for the Layer 3 <active_agents> snapshot so brain can detect duplicate
 * spawns before they happen.
 *
 * Returns "" when no obvious path is found (search / reader / math spawns).
 */
export function extractExpectedArtifact(task: string): string {
  // Patterns (priority order):
  //   1. "Return: <path>"       (brain.md recommended format)
  //   2. "→ <path>"             (V-model hierarchy arrow)
  //   3. "produce <path>"
  //   4. Standalone backticked   `foo/bar.ext`
  const patterns: RegExp[] = [
    /(?:Return|Deliver|Output|Produce)s?:?\s*[`"]?([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)[`"]?/i,
    /→\s*[`"]?([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)[`"]?/,
    /`([A-Za-z0-9_\-./]+\.(?:md|stim|json|py|yaml|csv|pdf|npz))`/,
  ];
  for (const re of patterns) {
    const m = task.match(re);
    if (m && m[1]) {
      // Sanity filter — extension must be known artifact type, path can't have ".."
      const path = m[1];
      if (!path.includes("..") && /\.(md|stim|json|py|yaml|csv|pdf|npz|tex|txt)$/i.test(path)) {
        return path;
      }
    }
  }
  return "";
}

export function removeAgent(agentDir: string, agentId: string): void {
  withRegistryLock(agentDir, (agents) => {
    const idx = agents.findIndex(a => a.id === agentId);
    if (idx >= 0) agents.splice(idx, 1);
  });
}

/** Mark a sub-agent as done with frozen result (called by subagent-runner, not brain). */
export function markDone(agentDir: string, agentId: string, result: string, exit?: SubAgentExit): void {
  withRegistryLock(agentDir, (agents) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = "done";
      agent.result = result.slice(0, 50_000);
      if (exit) agent.exit = truncateExitForStorage(exit);
    }
  });
}

/** Mark a sub-agent as failed (called by subagent-runner on error). */
export function markFailed(agentDir: string, agentId: string, error: string, exit?: SubAgentExit): void {
  withRegistryLock(agentDir, (agents) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = "failed";
      agent.result = error.slice(0, 5_000);
      if (exit) agent.exit = truncateExitForStorage(exit);
    }
  });
}

// Keep partial text bounded — active-agents.json is read into memory every
// harvest and a full 32K partial blob per stuck agent would bloat turns.
// 4K is enough to diagnose "what was sonnet drafting when it got cut".
function truncateExitForStorage(exit: SubAgentExit): SubAgentExit {
  if (!exit.partialAssistantText || exit.partialAssistantText.length <= 4_000) return exit;
  return { ...exit, partialAssistantText: exit.partialAssistantText.slice(0, 4_000) + "\n…[truncated]" };
}

/**
 * Human-readable one-line tag for a SubAgentExit, prefixed with a newline so
 * callers can append directly to result text. Returns empty string for the
 * "stop" happy path (no noise for normal completions). For length/error/killed
 * the tag tells a parent agent enough to pick a retry policy without parsing
 * the full exit object.
 *
 * `projectDir` is used to render touched file paths as project-relative; if
 * omitted, falls back to the last two path segments.
 */
export function formatExitHint(exit: SubAgentExit | undefined, projectDir?: string): string {
  if (!exit) return "";
  if (exit.stopReason === "stop") return "";

  const bits: string[] = [`stopReason=${exit.stopReason}`];
  if (exit.filesTouched.length > 0) bits.push(`filesTouched=${exit.filesTouched.length}`);
  if (exit.toolCallCount > 0) bits.push(`toolCalls=${exit.toolCallCount}`);

  const header = `\n\n[sub-agent exit: ${bits.join(", ")}]`;

  let touchedSuffix = "";
  if (exit.filesTouched.length > 0) {
    const rel = (p: string) => {
      if (projectDir) {
        const r = relative(projectDir, p);
        // path.relative returns something like "../other/foo" when p is outside
        // projectDir — that's still more useful than the last-two-segments fallback.
        if (r) return r;
      }
      return p.split("/").slice(-2).join("/");
    };
    const touchedList = exit.filesTouched
      .slice(0, 5)
      .map((t) => `${t.via}:${rel(t.path)}`)
      .join(", ");
    const overflow = exit.filesTouched.length > 5 ? ` (+${exit.filesTouched.length - 5} more)` : "";
    touchedSuffix = `\n  touched: ${touchedList}${overflow}`;
  }

  let partialSuffix = "";
  if (exit.partialAssistantText) {
    const preview = exit.partialAssistantText.slice(0, 500).replace(/\n/g, " ⏎ ");
    const ellipsis = exit.partialAssistantText.length > 500 ? "…" : "";
    partialSuffix = `\n  partial (first 500 chars): ${preview}${ellipsis}`;
  }

  // Surface provider's errorMessage (set in buildSubAgentExit when stopReason="error").
  // Without this, terminal errors like 429 "account suspended" appear to the parent as
  // a bare "stopReason=error" hint with no actionable diagnosis, and the parent loops
  // retrying. UWR 2026-05-13: brain spawned typesetter 4× because the underlying
  // 429 Kimi-balance-exhausted was hidden.
  let errSuffix = "";
  if (exit.errorMessage) {
    errSuffix = `\n  errorMessage: ${exit.errorMessage.replace(/\n/g, " ⏎ ")}`;
  }

  return `${header}${touchedSuffix}${partialSuffix}${errSuffix}`;
}

function heartbeatPath(agentDir: string, agentId: string): string {
  return join(agentDir, "heartbeat", agentId.replace(/[/\\]/g, "_"));
}

/** Touch heartbeat file (called periodically by subagent-runner). */
export function touchHeartbeat(agentDir: string, agentId: string): void {
  const p = heartbeatPath(agentDir, agentId);
  mkdirSync(dirname(p), { recursive: true });
  const now = new Date();
  try {
    // Update mtime if file exists
    utimesSync(p, now, now);
  } catch {
    // Create if doesn't exist
    closeSync(openSync(p, "w"));
  }
}

/**
 * In-process work hosted by another live process (a review_experiment, or a
 * background runner's revision and review loop): in flight, though it writes
 * no heartbeat. The caller's own in-process work is left out: a leaked entry
 * of a live process could never be swept — the 2026-07-09 immortal entries
 * that blocked finish() 357 times.
 */
function hostedElsewhere(a: ActiveAgent | undefined): boolean {
  return !!a && typeof a.pid !== "number" && typeof a.hostPid === "number"
    && a.hostPid !== process.pid && pidAlive(a.hostPid);
}

/**
 * Whether a sub-agent is alive: its heartbeat is fresh (default threshold:
 * 60s), or it is in-process work hosted by another live process. Both zombie
 * sweeps (getActiveBackgroundAgents, waitAndHarvestBackground) judge every
 * running entry by this, and in-process work never beats.
 */
export function isAlive(agentDir: string, agentId: string, thresholdMs = 60_000): boolean {
  try {
    if (Date.now() - statSync(heartbeatPath(agentDir, agentId)).mtimeMs < thresholdMs) return true;
  } catch { /* no heartbeat file */ }
  return hostedElsewhere(loadRegistry(agentDir).find((a) => a.id === agentId));
}

export interface InFlightAgent {
  agent: ActiveAgent;
  /** The process it depends on answers (heartbeat or pid). */
  alive: boolean;
  /** Liveness, and for in-process work the process it lives in. */
  label: string;
}

/**
 * Every registry entry still marked running, labelled by the process it
 * depends on. Read-only: no sweep, no registry write.
 *
 *   background — its own runner process: heartbeat and pid.
 *   in-process — no pid, no heartbeat: it lives inside the process that
 *                spawned it (hostPid). A reader fan-out lives in the brain, so
 *                stopping the brain kills it; reading its missing heartbeat
 *                as death made a mid fan-out restart look free. A runner's
 *                revision or a review_experiment's reviewer lives elsewhere;
 *                judged by run.pid, a live review read "died with the brain".
 *                The brain's own: hostPid or, under a studio launch, hostPpid
 *                is run.pid's pid.
 *                A legacy entry (no hostPid): its nearest registered ancestor
 *                with a pid, else the brain named by run.pid.
 */
export function describeInFlight(projectDir: string): InFlightAgent[] {
  const agentDir = join(projectDir, ".agent");
  let brainPid: number | undefined;
  try {
    const pid = JSON.parse(readFileSync(join(agentDir, "run.pid"), "utf-8"))?.pid;
    if (typeof pid === "number" && pid > 0) brainPid = pid;
  } catch { /* no run.pid */ }
  const agents = loadRegistry(agentDir);
  return agents.filter((a) => (a.status ?? "running") === "running").map((a) => {
    if (typeof a.pid === "number" || a.mode === "background") {
      const hb = isAlive(agentDir, a.id);
      const proc = typeof a.pid === "number" && pidAlive(a.pid);
      const label = hb ? "heartbeat fresh" : proc ? "heartbeat stale but process alive" : "NO heartbeat, process gone — likely dead";
      return { agent: a, alive: hb || proc, label };
    }
    // A registered runner is named: `luxas stop` reaches it, a brain restart does not.
    const host = typeof a.hostPid === "number"
      ? agents.find((h) => h.pid === a.hostPid)
      : agents
        .filter((h) => typeof h.pid === "number" && a.id.startsWith(h.id + "."))
        .sort((x, y) => y.id.length - x.id.length)[0];
    const hostPid = a.hostPid ?? host?.pid ?? brainPid;
    if (hostPid === undefined) return { agent: a, alive: false, label: "in-process with the brain; no run.pid to say whether it lives" };
    const alive = pidAlive(hostPid);
    // The brain is the run.pid process, or its child under a studio launch's
    // tsx wrapper. A runner is the brain's child too, hence the registered
    // runner first; and a dead host under a live brain was not the brain.
    const inBrain = brainPid !== undefined && (hostPid === brainPid
      || (a.hostPpid === brainPid && (alive || !pidAlive(brainPid))));
    const label = host
      ? alive ? `in-process in ${host.id} pid ${hostPid}, in flight` : `died with ${host.id} (pid ${hostPid} gone)`
      : inBrain
        ? alive ? `in-process with brain pid ${brainPid}, in flight; a restart kills it` : `died with the brain (pid ${brainPid} gone)`
        : alive ? `in-process in pid ${hostPid} (not the brain), in flight; a brain restart or luxas stop does not stop it` : `died with its host pid ${hostPid}`;
    return { agent: a, alive, label };
  });
}

// Support both raw messages (role at top level) and Session MessageEntry wrapper
function unwrapMessage(entry: any): any {
  return entry?.type === "message" && entry.message ? entry.message : entry;
}

/**
 * Entries of the conversation file's last run. One file can hold several: a
 * foreground continue appends after a continue_init, and a background spawn
 * once appended to a previous brain process's Session file (Dy bg-1,
 * 2026-10-06: its E2 run inherited the E1 run's last text). A run starts at a
 * Session header, a spawn_init, a continue_init, or a role:"system" message.
 */
function lastSegment(conversationFile: string): any[] {
  let raw: string;
  try { raw = readFileSync(conversationFile, "utf-8"); } catch { return []; }
  let seg: any[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type === "session" || entry?.type === "spawn_init" || entry?.type === "continue_init"
      || unwrapMessage(entry)?.role === "system") seg = [];
    seg.push(entry);
  }
  return seg;
}

/**
 * Try to extract a result from a sub-agent's conversation file: the last
 * assistant text of its last run, never an earlier run's.
 */
export function tryExtractResult(conversationFile: string): string | null {
  const seg = lastSegment(conversationFile);
  for (let i = seg.length - 1; i >= 0; i--) {
    try {
      const msg = unwrapMessage(seg[i]);
      if (msg?.role === "assistant" && Array.isArray(msg.content)) {
        const text = extractTextContent(msg.content);
        if (text.length > 0) return text.slice(0, 30_000);
      }
    } catch { /* skip malformed entry */ }
  }
  return null;
}

/** The id experiment.md names in its prompt: "Your `EXPERIMENT_ID` (`E2_x`) names exactly ONE sub-question." */
export function experimentIdFromPrompt(text: string): string | null {
  return text.match(/EXPERIMENT_ID` \(`([^`]+)`\)/)?.[1] ?? null;
}

// A foreground experiment keeps its templateVars on spawn_init; a background
// one only in the system prompt that opens its Session run. Either way the id
// is only used if it names an existing directory under data/experiments/.
function experimentIdOf(a: ActiveAgent, projectDir: string): string | null {
  const accept = (id: unknown): string | null =>
    typeof id === "string" && /^[A-Za-z0-9_.-]+$/.test(id) && !/^\.+$/.test(id)
      && existsSync(join(projectDir, "data", "experiments", id)) ? id : null;
  const fromInit = accept(parseConvJsonl(a.conversationFile).spawnInit?.templateVars?.EXPERIMENT_ID);
  if (fromInit) return fromInit;
  const head = unwrapMessage(lastSegment(a.conversationFile)[0]);
  if (head?.role !== "system") return null;
  let text = "";
  try { text = typeof head.content === "string" ? head.content : extractTextContent(head.content); } catch { /* malformed content */ }
  return accept(experimentIdFromPrompt(text));
}

// Newest run_N that holds a results.json, and the highest review round.
function experimentOnDisk(projectDir: string, eid: string) {
  let run: { name: string; n: number; mtimeMs: number } | null = null;
  const runsDir = join(projectDir, "data", "experiments", eid, "runs");
  try {
    for (const name of readdirSync(runsDir)) {
      const m = /^run_(\d+)$/.exec(name);
      if (!m) continue;
      let mtimeMs: number;
      try { mtimeMs = statSync(join(runsDir, name, "results.json")).mtimeMs; } catch { continue; }
      if (!run || +m[1] > run.n) run = { name, n: +m[1], mtimeMs };
    }
  } catch { /* no runs/ */ }
  let review: { k: number; verdict: string; mtimeMs: number } | null = null;
  const reviewsDir = join(projectDir, "reviews");
  const prefix = `experiment_review_${eid}_r`;
  try {
    for (const f of readdirSync(reviewsDir)) {
      const k = f.startsWith(prefix) && f.endsWith(".md") ? f.slice(prefix.length, -3) : "";
      if (!/^\d+$/.test(k) || (review && +k <= review.k)) continue;
      const path = join(reviewsDir, f);
      let text: string, mtimeMs: number;
      try { text = readFileSync(path, "utf-8"); mtimeMs = statSync(path).mtimeMs; } catch { continue; }
      const v = text.match(/^\s*#{0,6}\s*VERDICT:\s*(satisfied|revise)\b/im);
      review = { k: +k, verdict: v ? v[1].toUpperCase() : "NO VERDICT", mtimeMs };
    }
  } catch { /* no reviews/ */ }
  return { run, review };
}

// Same bar as the zombie sweep: the runner beats every 30 s.
const LIVE_HEARTBEAT_MS = 5 * 60_000;

/**
 * Settle the registry when a brain resumes, and say what became of each entry.
 *
 *   done/failed — not an orphan: left for the per-turn harvest, which delivers
 *                 the frozen result with its exit hint.
 *   live        — a background runner that outlived the brain (pid answers,
 *                 heartbeat fresh): kept, so its completion is harvested.
 *   hosted      — in-process work whose host (hostPid) is another live
 *                 process: a review_experiment's reviewer, a runner's
 *                 revision. Kept and said to be running; reported Lost, it
 *                 invited a second producer while the first kept writing.
 *   experiment  — whose results.json is newer than the spawn: reported as
 *                 completed on disk with its last review, whatever the
 *                 transcript ends with. Resuming Dy (2026-10-07) would have
 *                 reported its three finished experiments as Recovered with
 *                 another run's text, or Lost — an invitation to re-dispatch.
 *   otherwise   — Recovered (last-run text) or Lost, as before; an experiment
 *                 whose newest results.json predates the spawn (a killed
 *                 revision) says so, and is never reported completed.
 *
 * Every entry not kept is removed.
 */
export function reconcileOrphans(projectDir: string, agentDir: string): string[] {
  const lines: string[] = [];
  const agents = loadRegistry(agentDir);
  for (const a of agents) {
    if (a.status === "done" || a.status === "failed") continue;
    if (a.pid && pidAlive(a.pid) && isAlive(agentDir, a.id, LIVE_HEARTBEAT_MS)) {
      lines.push(`[Still running: ${a.name}] ${a.id}, pid ${a.pid} — its result will arrive as a Background Agent Complete message.`);
      continue;
    }
    if (hostedElsewhere(a)) {
      const runner = agents.find((h) => h.pid === a.hostPid);
      lines.push(`[Still running in pid ${a.hostPid}: ${a.name}] ${a.id}${runner ? `, inside ${runner.id}` : ""} — in flight in that process, not in this brain; its result goes to that process, not to you, and re-dispatching it would run it twice. Task: "${a.task}"`);
      continue;
    }
    const eid = a.name === "experiment" ? experimentIdOf(a, projectDir) : null;
    const { run, review } = eid ? experimentOnDisk(projectDir, eid) : { run: null, review: null };
    if (eid && run && run.mtimeMs >= a.startedAt) {
      const rv = review
        ? `last review r${review.k} ${review.verdict}${review.mtimeMs < run.mtimeMs ? ` (older than ${run.name})` : ""}`
        : "unreviewed";
      lines.push(`[Completed on disk: ${eid} — ${run.name}/results.json, ${rv}] Task: "${a.task}"`);
    } else {
      const stale = eid && run
        ? ` Its newest results.json (${run.name}) predates this spawn; files under data/experiments/${eid}/ may be newer than that run.`
        : "";
      const result = tryExtractResult(a.conversationFile);
      lines.push(result
        ? `[Recovered: ${a.name}] Task: "${a.task}"\n${result.slice(0, 5000)}${stale}`
        : `[Lost: ${a.name}] Task "${a.task}" was interrupted. Decide whether to retry.${stale}`);
    }
    removeAgent(agentDir, a.id);
  }
  return lines;
}

// agentId is NOT stored on either marker — the conv jsonl filename IS the
// agentId. continue_init carries no revisionNumber either: it's the index in
// ParsedConv.continueInits.
interface SpawnInitMeta {
  type: "spawn_init";
  agent: string;
  task: string;
  parentAgentId?: string;
  templateVars?: Record<string, string>;
  timestamp: number;
  /** The whole task, present only when `task` was cut at 2000 characters. */
  contextTask?: string;
}

interface ContinueInitMeta {
  type: "continue_init";
  newTask: string;
  timestamp: number;
}

interface ParsedConv {
  spawnInit: SpawnInitMeta | null;
  messages: any[];
  continueInits: ContinueInitMeta[];
}

// Empty/missing/malformed files yield empty-shape results, not throws.
export function parseConvJsonl(conversationFile: string): ParsedConv {
  const out: ParsedConv = { spawnInit: null, messages: [], continueInits: [] };
  let raw: string;
  try {
    raw = readFileSync(conversationFile, "utf-8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type === "spawn_init") { out.spawnInit = entry; continue; }
    if (entry?.type === "continue_init") { out.continueInits.push(entry); continue; }
    if (entry?.role) out.messages.push(entry);
  }
  return out;
}
