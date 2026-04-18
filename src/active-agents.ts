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
import { join, dirname } from "node:path";
import { extractTextContent } from "./utils.js";

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
export function markDone(agentDir: string, agentId: string, result: string): void {
  withRegistryLock(agentDir, (agents) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = "done";
      agent.result = result.slice(0, 50_000);
    }
  });
}

/** Mark a sub-agent as failed (called by subagent-runner on error). */
export function markFailed(agentDir: string, agentId: string, error: string): void {
  withRegistryLock(agentDir, (agents) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = "failed";
      agent.result = error.slice(0, 5_000);
    }
  });
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
