/**
 * Typed terminal states — how a `luxas run` ended, written by the process that
 * ended and read by the next one.
 *
 * Six runs between 08-25 and 09-20: one ended through finish(). The other five
 * died on a cost-cap kill, a provider 402, or a finalization deadlock, and all
 * five left the same record as a healthy pause: `{finished:false}`. Nothing
 * read even that. This file gives every ending a name and puts a reader on it.
 *
 * Writers (brain process only — a detached sub-agent runner must not overwrite
 * the run's record, so everything here is a no-op until beginRun is called):
 *   - index.ts run()          beginRun at launch; the normal end of the loop
 *   - hooks.ts                cost cap, soft-cap denial limit
 *   - agent.ts                turn cap
 *   - usage-log.ts            cost cap at usage record, unfunded provider
 *   - the process "exit" hook anything that exited without naming a reason
 *
 * Readers:
 *   - index.ts run()          tells the operator and the resuming brain how the
 *                             previous session ended (resume prompt)
 *   - index.ts showStatus     `luxas status`
 *   - tools/monitor-tools.ts  the sidecar monitor's run_status
 *
 * A SIGKILL / OOM / power loss runs no handler, so the record still says
 * "running" with a pid that no longer exists; readLastExit reports that as
 * "killed" rather than leaving the reader to guess.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type ExitKind =
  | "running"            // launched, not ended (or ended with no handler — see "killed")
  | "finished"           // gated finish() passed
  | "forced_finish"      // a finish backstop shipped the report over open blockers
  | "needs_operator"     // escalated to the operator and stopped cleanly
  | "budget_exhausted"   // cost cap, turn cap, or the post-freeze denial limit
  | "provider_unfunded"  // a provider refused for lack of funds
  | "provider_transient" // retries on a network / 5xx / rate-limit error ran out
  | "provider_error"     // the last turn ended on a non-retryable provider error
  | "stopped_unfinished" // the loop ended with no finish and no error
  | "crashed"            // uncaught exception, or an exit nobody named
  | "killed";            // derived by the reader: "running" with a dead pid

export interface ExitRecord {
  kind: ExitKind;
  detail?: string;
  ts: number;
  pid: number;
  startedAt?: number;
  /** Kept for the external supervisor (sisyphus-inbox), which reads these two. */
  finished: boolean;
  lastErrTransient: boolean;
}

/** What the operator (or the supervisor) should do next. */
export const EXIT_ACTION: Record<ExitKind, string> = {
  running: "A run is in progress.",
  finished: "Nothing to do.",
  forced_finish: "The report shipped over open finish-gate blockers; read notes/experiments.md for the quarantine note before trusting it.",
  needs_operator: "Read notes/escalations/needs-operator.md and decide; resuming without acting on it will reach the same gate.",
  budget_exhausted: "Resume with a larger --max-cost only if the remaining work is worth it; the checkpoint is live.",
  provider_unfunded: "Top up the provider, then resume; the checkpoint is live.",
  provider_transient: "Safe to relaunch with backoff; the checkpoint is live.",
  provider_error: "Not retryable as-is: fix the request or the model routing before resuming.",
  stopped_unfinished: "Resume to continue; the checkpoint is live.",
  crashed: "See the process_crash entry in .agent/log.jsonl, then resume; the checkpoint is live.",
  killed: "The process was killed (signal, OOM or host restart) before it could record why. Resume; the checkpoint is live.",
};

const FILE = "last_exit.json";
let active: { projectDir: string; startedAt: number } | null = null;
let reason: { kind: ExitKind; detail?: string } | null = null;
let hooked = false;

function write(projectDir: string, rec: ExitRecord): void {
  try {
    const dir = join(projectDir, ".agent");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(rec) + "\n");
    renameSync(tmp, join(dir, FILE));
  } catch { /* recording an exit must never be what breaks one */ }
}

function record(kind: ExitKind, detail?: string): ExitRecord | null {
  if (!active) return null;
  const rec: ExitRecord = {
    kind, detail: detail?.slice(0, 500), ts: Date.now(), pid: process.pid, startedAt: active.startedAt,
    finished: kind === "finished" || kind === "forced_finish" || kind === "needs_operator",
    lastErrTransient: kind === "provider_transient",
  };
  write(active.projectDir, rec);
  return rec;
}

/**
 * Brain process, at launch. Marks the run as running and arms the exit hook.
 * Returns the previous session's record (read BEFORE it is overwritten).
 */
export function beginRun(projectDir: string): ExitRecord | null {
  const previous = readLastExit(projectDir);
  active = { projectDir, startedAt: Date.now() };
  reason = null;
  record("running");
  if (!hooked) {
    hooked = true;
    // "exit" handlers may only do sync work — write() is sync.
    process.on("exit", (code) => {
      if (!active) return;
      if (reason) record(reason.kind, reason.detail);
      else record("crashed", `process exited with code ${code} without naming a reason`);
    });
  }
  return previous;
}

/**
 * Name why this process is about to end. First caller wins: the first fatal
 * condition is the cause, anything after it is fallout. Written immediately
 * (not only in the exit hook) so the reason survives a kill in between.
 */
export function setExitReason(kind: ExitKind, detail?: string): void {
  if (!active || reason) return;
  reason = { kind, detail };
  record(kind, detail);
}

/** Gates only. */
export function _resetExitStateForTest(): void { active = null; reason = null; }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

export function readLastExit(projectDir: string): ExitRecord | null {
  const p = join(projectDir, ".agent", FILE);
  if (!existsSync(p)) return null;
  let j: any;
  try { j = JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  // Records written before 2026-10-05 carry only {finished, lastErrTransient, ts}.
  const kind: ExitKind = typeof j.kind === "string" ? j.kind
    : j.finished ? "finished" : j.lastErrTransient ? "provider_transient" : "stopped_unfinished";
  const rec: ExitRecord = {
    kind, detail: typeof j.detail === "string" ? j.detail : undefined,
    ts: Number(j.ts) || 0, pid: Number(j.pid) || 0, startedAt: Number(j.startedAt) || undefined,
    finished: !!j.finished, lastErrTransient: !!j.lastErrTransient,
  };
  if (rec.kind === "running" && rec.pid && rec.pid !== process.pid && !pidAlive(rec.pid)) {
    return { ...rec, kind: "killed" };
  }
  return rec;
}

/** One line for a human or for the resuming brain. */
export function describeExit(rec: ExitRecord): string {
  const when = rec.ts ? new Date(rec.ts).toISOString() : "unknown time";
  return `${rec.kind}${rec.detail ? ` — ${rec.detail}` : ""} (${when}). ${EXIT_ACTION[rec.kind] ?? ""}`.trim();
}
