/**
 * Active agent registry — file-backed bookkeeping for running sub-agents.
 *
 * Replaces the in-memory `activeBackgroundAgents` Map with a JSON file
 * so brain can recover orphaned sub-agent results after crash.
 *
 * File: .agent/active-agents.json
 * Maintained by harness code only (not LLM).
 */

import { readFileSync, writeFileSync, renameSync, statSync, mkdirSync, closeSync, openSync, unlinkSync, utimesSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { extractTextContent } from "./utils.js";

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
  filesTouched: FileTouchRecord[]; // clean-exit best-effort; empty on killed
  elapsedMs: number;
  toolCallCount: number;           // assistant-message toolCall blocks seen
  lastContextTokens?: number;      // from tokenTap if available
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
  const path = registryPath(agentDir);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(agents, null, 2));
  renameSync(tmp, path); // atomic replace
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

  return `${header}${touchedSuffix}${partialSuffix}`;
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

/** Check if a sub-agent's heartbeat is fresh (default threshold: 60s). */
export function isAlive(agentDir: string, agentId: string, thresholdMs = 60_000): boolean {
  try {
    const st = statSync(heartbeatPath(agentDir, agentId));
    return Date.now() - st.mtimeMs < thresholdMs;
  } catch {
    return false;
  }
}

/**
 * Try to extract a result from a sub-agent's conversation file.
 * Reads the last assistant message's text content.
 */
export function tryExtractResult(conversationFile: string): string | null {
  try {
    const lines = readFileSync(conversationFile, "utf-8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        // Support both raw messages (role at top level) and Session MessageEntry wrapper
        const msg = entry.type === "message" && entry.message ? entry.message : entry;
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const text = extractTextContent(msg.content);
          if (text.length > 0) return text.slice(0, 30_000);
        }
      } catch { /* skip malformed line */ }
    }
  } catch { /* file not found or read error */ }
  return null;
}
