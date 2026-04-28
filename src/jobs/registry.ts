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
  | "process_gone_since_last_sweep"
  | "reconcile_orphan_killed"
  | "sweep_deadline_killed"
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
 * Return every job record currently owned by `ownerAgentId`. Used by the
 * job-control tools to scope visibility and for the upcoming Owner Exit
 * Gate (filter to status=running before allowing a clean exit).
 */
export function listJobsByOwner(projectDir: string, ownerAgentId: string): JobState[] {
  const out: JobState[] = [];
  for (const id of listJobIds(projectDir)) {
    const state = readState(projectDir, id);
    if (state && state.ownerAgentId === ownerAgentId) out.push(state);
  }
  return out;
}

/**
 * Poll state.json until status !== "running" or `timeoutMs` elapses. The
 * agent-facing `job_wait` tool sits on top of this. Polling beats fs.watch
 * because (a) state.json writes are atomic via tmp+rename, which can confuse
 * fs.watch on macOS; (b) the agent loop's natural cadence is multi-second
 * anyway, so 500ms polls are not load-bearing.
 *
 * Returns the final state, or `null` if the job dir disappeared.
 */
export async function waitForJob(
  projectDir: string,
  jobId: string,
  timeoutMs: number,
): Promise<JobState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readState(projectDir, jobId);
    if (!state) return null;
    if (state.status !== "running") return state;
    await sleep(500);
  }
  return readState(projectDir, jobId);
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

/** SIGTERM the process group, wait up to SIGTERM_GRACE_MS, then SIGKILL. */
export async function killGroupAndWait(pid: number): Promise<void> {
  try { process.kill(-pid, "SIGTERM"); } catch { /* may already be exiting */ }
  const deadline = Date.now() + SIGTERM_GRACE_MS;
  while (Date.now() < deadline && pidAlive(pid)) {
    await sleep(50);
  }
  if (pidAlive(pid)) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
  }
}

export interface ReconcileSummary {
  scanned: number;
  alreadyDone: number;
  markedDone: number;
  killedOrphans: number;
  unverifiable: number;
}

/**
 * Walk every running record at session boot. No race guard needed — the agent
 * loop hasn't started yet, so no concurrent writer can clobber our writes.
 * (Sweep, which runs alongside the agent, uses a re-read commit guard.)
 */
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
      await killGroupAndWait(state.pid);
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

export interface SweepSummary {
  scanned: number;
  healthy: number;          // running, deadline not yet passed — left alone
  markedDone: number;       // pid gone since last sweep
  killedDeadline: number;   // deadline passed AND verified ours → killed
  unverifiable: number;     // deadline passed but ownership unconfirmable
}

/**
 * Per-tick scan of running records. Designed to be called every ~15s on
 * an unrefed setInterval inside the harness. Distinguished from reconcile:
 * reconcile presumes every running record is from a prior session and acts
 * on all of them; sweep distinguishes healthy in-flight jobs (deadline
 * still in the future, leave alone) from stuck/leaked ones.
 *
 * Race vs. bash-hardened's own close handler: between this loop's read and
 * its write, the in-process handler may transition the same record to done
 * with a more accurate cause (e.g. "completed"). Re-read guards each write
 * — if status flipped under us, we skip and let the in-process write win.
 */
export async function sweepJobs(projectDir: string): Promise<SweepSummary> {
  const summary: SweepSummary = {
    scanned: 0, healthy: 0, markedDone: 0,
    killedDeadline: 0, unverifiable: 0,
  };
  for (const id of listJobIds(projectDir)) {
    summary.scanned++;
    const state = readState(projectDir, id);
    if (!state || state.status !== "running") continue;

    // Re-read guard against bash-hardened's close handler racing us — if it
    // already wrote a more accurate cause (e.g. "completed"), skip the commit.
    const commit = (next: JobState): boolean => {
      const fresh = readState(projectDir, id);
      if (!fresh || fresh.status !== "running") return false;
      writeState(projectDir, next);
      return true;
    };

    if (!pidAlive(state.pid)) {
      if (commit({
        ...state, status: "done", endedAt: Date.now(),
        exitCode: null, signal: null, cause: "process_gone_since_last_sweep",
      })) summary.markedDone++;
      continue;
    }

    if (Date.now() < state.deadlineAt) {
      summary.healthy++;
      continue;
    }

    if (processIsOurs(state.pid, state.command)) {
      await killGroupAndWait(state.pid);
      if (commit({
        ...state, status: "done", endedAt: Date.now(),
        exitCode: null, signal: "SIGKILL", cause: "sweep_deadline_killed",
      })) summary.killedDeadline++;
      continue;
    }

    if (commit({
      ...state, status: "orphaned", endedAt: Date.now(),
      exitCode: null, signal: null, cause: "pid_reuse_or_unverifiable",
    })) summary.unverifiable++;
  }
  return summary;
}
