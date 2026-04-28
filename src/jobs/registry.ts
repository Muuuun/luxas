/**
 * Per-job state.json under .agent/jobs/<id>/ as the durable source of truth
 * for every bash invocation. Designed to survive crashes and `luxas resume`:
 * if the harness dies mid-bash, reconcileOnStartup either confirms the
 * process is gone, kills the orphan we can verify is ours, or marks
 * ambiguous ones as orphaned for human cleanup. Never kills something we
 * can't verify — a misfire (wrong-pid kill after pid reuse) is worse than
 * a leaked orphan.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWriteJson, pidAlive, sleep } from "../utils.js";

export type JobStatus = "running" | "done" | "orphaned";

export type JobCause =
  | "completed"
  | "timeout"
  | "aborted"
  | "signal"
  | "process_gone_during_outage"
  | "reconcile_orphan_killed"
  | "pid_reuse_or_unverifiable"
  | `spawn_error:${string}`;

export const SIGTERM_GRACE_MS = 2000;

export interface JobState {
  id: string;
  ownerAgentId: string;
  ownerAgentType: string;
  toolCallId: string | null;
  command: string;
  cwd: string;
  pid: number;
  startedAt: number;
  deadlineAt: number;
  timeoutSec: number;
  status: JobStatus;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  cause: JobCause | null;
  logPath: string;
}

export function jobsDir(projectDir: string): string {
  return join(projectDir, ".agent", "jobs");
}

export function jobDir(projectDir: string, jobId: string): string {
  return join(jobsDir(projectDir), jobId);
}

export function jobStatePath(projectDir: string, jobId: string): string {
  return join(jobDir(projectDir, jobId), "state.json");
}

export function jobLogPath(projectDir: string, jobId: string): string {
  return join(jobDir(projectDir, jobId), "output.log");
}

export function newJobId(): string {
  return `job_${randomBytes(6).toString("hex")}`;
}

export function writeState(projectDir: string, state: JobState): void {
  mkdirSync(jobDir(projectDir, state.id), { recursive: true });
  atomicWriteJson(jobStatePath(projectDir, state.id), state);
}

export function readState(projectDir: string, jobId: string): JobState | null {
  const p = jobStatePath(projectDir, jobId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as JobState;
  } catch {
    return null;
  }
}

export function listJobIds(projectDir: string): string[] {
  const root = jobsDir(projectDir);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name =>
    name.startsWith("job_") && existsSync(jobStatePath(projectDir, name)));
}

/**
 * Conservative ownership check. Returns true only when ps confirms both
 * (a) the pid is still its own process-group leader (i.e. nobody re-pgid'd
 * it) and (b) the recorded command appears as a substring of the live ps
 * command line. If ps fails, parsing fails, or either signal is missing,
 * returns false — the caller marks the record `orphaned` rather than
 * risking a wrong-target kill after pid reuse.
 */
function processIsOurs(pid: number, expectedCommand: string): boolean {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "pgid=,command="], {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    const m = out.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) return false;
    if (Number(m[1]) !== pid) return false;
    return m[2].includes(expectedCommand);
  } catch {
    return false;
  }
}

export interface ReconcileSummary {
  scanned: number;
  alreadyDone: number;
  markedDone: number;
  killedOrphans: number;
  unverifiable: number;
}

export async function reconcileOnStartup(projectDir: string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    scanned: 0, alreadyDone: 0, markedDone: 0, killedOrphans: 0, unverifiable: 0,
  };
  for (const id of listJobIds(projectDir)) {
    summary.scanned++;
    const state = readState(projectDir, id);
    if (!state) continue;
    if (state.status !== "running") {
      summary.alreadyDone++;
      continue;
    }
    const now = Date.now();
    if (!pidAlive(state.pid)) {
      writeState(projectDir, {
        ...state, status: "done", endedAt: now,
        exitCode: null, signal: null, cause: "process_gone_during_outage",
      });
      summary.markedDone++;
      continue;
    }
    if (processIsOurs(state.pid, state.command)) {
      try { process.kill(-state.pid, "SIGTERM"); } catch { /* may already be exiting */ }
      const deadline = Date.now() + SIGTERM_GRACE_MS;
      while (Date.now() < deadline && pidAlive(state.pid)) {
        await sleep(50);
      }
      if (pidAlive(state.pid)) {
        try { process.kill(-state.pid, "SIGKILL"); } catch { /* gone */ }
      }
      writeState(projectDir, {
        ...state, status: "done", endedAt: Date.now(),
        exitCode: null, signal: "SIGKILL", cause: "reconcile_orphan_killed",
      });
      summary.killedOrphans++;
      continue;
    }
    writeState(projectDir, {
      ...state, status: "orphaned", endedAt: now,
      exitCode: null, signal: null, cause: "pid_reuse_or_unverifiable",
    });
    summary.unverifiable++;
  }
  return summary;
}
