/**
 * Filesystem state for the meta-agent subsystem.
 *
 * Owns:
 *   - ~/.sisyphus/reflect-state/     — counters + observation logs
 *   - ~/.sisyphus/reflect-inbox/     — pending proposals awaiting user vote
 *
 * Pure path/IO helpers. No agent logic. Any module that needs to read or
 * mutate meta-state goes through this file so the layout stays in one place.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pidAlive } from "../utils.js";

// ── Configuration constants ────────────────────────────────────────────────

/** Sessions between deep reviews. Light review runs every session; reflect
 * (deep) is triggered once this many accumulate. Tunable per user. */
export const DEEP_REVIEW_EVERY_N_SESSIONS = 5;

/** User votes (accept + reject + tie) that trigger reflect_evolve. */
export const EVOLUTION_TRIGGER_VOTES = 10;

/** A/B replicates per benchmark task (each side). Only the first replicate
 * that yields a PDF is kept; the rest are retries. */
export const AB_REPLICATES = 3;

/**
 * Per-replicate cost ceiling (USD) passed to `luxas run --max-cost` by
 * reflect_ab. Without this every replicate inherits the $250 production
 * backstop: at 3 benches × 3 replicates × 2 sides that is an 18-run bill
 * before a single vote. Benchmarks are deliberately scoped to finish inside
 * the runner's 40-minute timeout, so a run that needs more than this is
 * already off-task; the cap turns it into a skipped replicate instead of a
 * $250 one. */
export const AB_MAX_COST_USD = 15;

/** Branches managed by the harness. Single source of truth — do not inline. */
export const PENDING_BRANCH = "meta/pending";
export const EVOLUTION_BRANCH = "meta/evolution";

// ── Paths ──────────────────────────────────────────────────────────────────

const ROOT = join(homedir(), ".sisyphus");
const STATE_DIR = join(ROOT, "reflect-state");
const INBOX_DIR = join(ROOT, "reflect-inbox");

export interface MetaPaths {
  root: string;
  stateDir: string;
  inboxDir: string;
  runCounter: string;
  voteCounter: string;
  observations: string;
  support: string;
  inboxCurrent: string;
  inboxEvolution: string;
  inboxArchive: string;
  inboxLock: string;
}

export function getMetaPaths(): MetaPaths {
  return {
    root: ROOT,
    stateDir: STATE_DIR,
    inboxDir: INBOX_DIR,
    runCounter: join(STATE_DIR, "run_counter"),
    voteCounter: join(STATE_DIR, "vote_counter"),
    observations: join(STATE_DIR, "observations.jsonl"),
    support: join(STATE_DIR, "support.jsonl"),
    inboxCurrent: join(INBOX_DIR, "current"),
    inboxEvolution: join(INBOX_DIR, "evolution"),
    inboxArchive: join(INBOX_DIR, "archive"),
    inboxLock: join(INBOX_DIR, ".lock"),
  };
}

/** Create every meta-state directory if missing. Idempotent. */
export function ensureMetaDirs(): MetaPaths {
  const p = getMetaPaths();
  for (const d of [p.root, p.stateDir, p.inboxDir, p.inboxCurrent, p.inboxEvolution, p.inboxArchive]) {
    mkdirSync(d, { recursive: true });
  }
  return p;
}

// ── Counters ───────────────────────────────────────────────────────────────

function readCounter(path: string): number {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, "utf-8").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function writeCounter(path: string, n: number): void {
  writeFileSync(path, `${n}\n`);
}

export function readRunCounter(): number {
  return readCounter(getMetaPaths().runCounter);
}

export function readVoteCounter(): number {
  return readCounter(getMetaPaths().voteCounter);
}

// Sync sleep without spawning a subprocess. Atomics.wait on a fresh
// SharedArrayBuffer is the standard pattern — blocks the current thread
// for ms milliseconds. Used for the brief lock-contention spin below.
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Atomically increment a counter file. The naive read-then-write at
 * `bumpRunCounter` previously was a non-atomic read-modify-write — two
 * concurrent post_session_hook processes both reading n and both writing
 * n+1 would lose increments, intermittently delaying the deep-review
 * threshold. Same hazard for vote counter.
 *
 * Approach: O_EXCL lockfile (writeFileSync with flag "wx" atomically
 * creates-or-fails), held only across the read+write window. Stale locks
 * from dead PIDs are auto-reaped (same pattern as inboxLocked). 5-second
 * total budget; throws if contention persists longer (a contention storm
 * that severe means something else is wrong).
 */
function bumpCounterAtomic(counterPath: string): number {
  const lockPath = `${counterPath}.lock`;
  // Defensive: production callers go through ensureMetaDirs() first, but
  // some entry points (test harness, future scripts) may not.
  mkdirSync(dirname(counterPath), { recursive: true });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" });
      try {
        const n = readCounter(counterPath) + 1;
        writeCounter(counterPath, n);
        return n;
      } finally {
        try { unlinkSync(lockPath); } catch { /* best-effort cleanup */ }
      }
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      // Reap stale lock from a dead PID before sleeping.
      try {
        const lockRaw = readFileSync(lockPath, "utf-8");
        const pid = Number(lockRaw.split("\n")[0]?.trim());
        if (Number.isFinite(pid) && pid > 0 && !pidAlive(pid)) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch { /* lock vanished between EEXIST and read — retry immediately */ }
      sleepSync(20);
    }
  }
  throw new Error(`bumpCounterAtomic: failed to acquire ${lockPath} after 5s`);
}

export function bumpRunCounter(): number {
  return bumpCounterAtomic(getMetaPaths().runCounter);
}

export function bumpVoteCounter(): number {
  return bumpCounterAtomic(getMetaPaths().voteCounter);
}

export function resetRunCounter(): void {
  writeCounter(getMetaPaths().runCounter, 0);
}

export function resetVoteCounter(): void {
  writeCounter(getMetaPaths().voteCounter, 0);
}

// ── Observation log rotation ───────────────────────────────────────────────

/**
 * Move observations.jsonl + support.jsonl to archived suffixes. Called by
 * harness after a deep review consumes them. No-op for files that don't exist.
 */
export function rotateObservationLogs(): { observations: string; support: string } | null {
  const p = getMetaPaths();
  const ts = Math.floor(Date.now() / 1000);
  const results = { observations: "", support: "" };
  let rotated = false;
  for (const [key, src] of [["observations", p.observations], ["support", p.support]] as const) {
    if (existsSync(src)) {
      const dest = src.replace(/\.jsonl$/, `.archived.${ts}.jsonl`);
      renameSync(src, dest);
      results[key] = dest;
      rotated = true;
    }
  }
  return rotated ? results : null;
}

// ── Inbox lock ─────────────────────────────────────────────────────────────
//
// Purpose: prevent reflect from mutating current/ while user is mid-vote.
// The feedback daemon acquires the lock when it detects VOTE.md edits in
// progress and releases after merge/discard. The harness refuses to update
// current/ while the lock file exists.

/**
 * Returns true only if the lockfile exists AND the PID written into it is
 * still alive. A SIGKILL or power loss on the owner would otherwise wedge
 * every harness/daemon permanently; we auto-reap here.
 *
 * PID wrap-around (same PID recycled to a different process) is accepted as
 * a rare false-positive — worst case is one extra polling cycle deferred.
 */
export function inboxLocked(): boolean {
  const p = getMetaPaths().inboxLock;
  let raw: string;
  try { raw = readFileSync(p, "utf-8"); }
  catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
  const parts = raw.split("\n");
  const pid = Number(parts[2]);
  if (Number.isFinite(pid) && pid > 0 && !pidAlive(pid)) {
    console.error(`[meta-state] reaping stale inbox lock from dead PID ${pid} (owner: ${parts[0]})`);
    try { unlinkSync(p); } catch {}
    return false;
  }
  return true;
}

export function acquireInboxLock(owner: string): void {
  const p = getMetaPaths().inboxLock;
  writeFileSync(p, `${owner}\n${new Date().toISOString()}\n${process.pid}\n`);
}

export function releaseInboxLock(): void {
  const p = getMetaPaths().inboxLock;
  if (existsSync(p)) unlinkSync(p);
}

// ── Archive ────────────────────────────────────────────────────────────────

/**
 * Move current/ or evolution/ contents into archive/<ts>-<outcome>/. Leaves
 * the directory itself in place but empty for the next proposal.
 */
export function archiveInboxSlot(slot: "current" | "evolution", outcome: "merged" | "rejected" | "tie"): string {
  const p = getMetaPaths();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(p.inboxArchive, `${ts}-${slot}-${outcome}`);
  mkdirSync(dest, { recursive: true });
  const src = slot === "current" ? p.inboxCurrent : p.inboxEvolution;
  if (existsSync(src)) {
    // Move contents, not the directory itself — keep slot dir around for
    // the next proposal without having to recreate it.
    for (const f of readdirSync(src)) {
      renameSync(join(src, f), join(dest, f));
    }
  }
  return dest;
}
