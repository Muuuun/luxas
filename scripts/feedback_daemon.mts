#!/usr/bin/env tsx
/**
 * Feedback daemon. Long-running process that watches the VOTE.md files in
 * ~/.sisyphus/reflect-inbox/{current,evolution}/. When a vote is written
 * (A/B/tie for current, approve/reject for evolution), it:
 *
 *   current/VOTE.md:
 *     A / B  → merge meta/pending to main if new side wins, else discard branch
 *     tie    → discard branch (conservative default, ties go to old)
 *     → archive current/ contents to archive/<ts>-<outcome>/
 *     → bump vote_counter. If >= EVOLUTION_TRIGGER_VOTES, fire reflect_evolve.
 *
 *   evolution/VOTE.md:
 *     approve → merge meta/evolution directly into main (user has approved
 *               the change to reflect.md/reflect_light.md itself)
 *     reject  → discard meta/evolution branch
 *     → archive evolution/ contents to archive/<ts>-evolution-<outcome>/
 *     → reset vote_counter to 0
 *
 * Usage:
 *   tsx scripts/feedback_daemon.mts <sisyphus-root>
 *
 * Run as a background process (via launchd / systemd / nohup / tmux —
 * user's choice). Polls every POLL_INTERVAL_MS. Not a fs.watch subscriber
 * because fs.watch semantics vary across macOS/Linux and the per-minute
 * polling cost is negligible.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureMetaDirs,
  archiveInboxSlot,
  bumpVoteCounter,
  resetVoteCounter,
  acquireInboxLock,
  releaseInboxLock,
  EVOLUTION_TRIGGER_VOTES,
  PENDING_BRANCH,
  EVOLUTION_BRANCH,
} from "../src/meta-agents/state.js";
import { mergeBranchToMain, deleteBranchIfExists } from "../src/meta-agents/git-helpers.js";

const POLL_INTERVAL_MS = 30_000;

const [, , sisyphusRoot] = process.argv;
if (!sisyphusRoot) {
  console.error("usage: feedback_daemon.mts <sisyphus-root>");
  process.exit(2);
}

const paths = ensureMetaDirs();

// ── Vote file parsing ─────────────────────────────────────────────────────

function parseVote(contents: string, allowed: string[]): string | null {
  // Accept either "choice: X" on any line, or a bare line that is exactly X.
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*choice\s*:\s*(\S+)\s*$/i);
    if (m && allowed.includes(m[1].toLowerCase())) return m[1].toLowerCase();
    const bare = line.trim().toLowerCase();
    if (allowed.includes(bare)) return bare;
  }
  return null;
}

// ── Vote-file state tracking ──────────────────────────────────────────────

const lastMtime = new Map<string, number>();

function mtimeOrZero(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

// ── Main handlers ─────────────────────────────────────────────────────────

function handleCurrentVote(): void {
  const votePath = join(paths.inboxCurrent, "VOTE.md");
  if (!existsSync(votePath)) return;

  // If a prior merge attempt produced a conflict, don't loop-retry every 30s
  // until the user resolves manually and deletes the marker.
  const conflictPath = join(paths.inboxCurrent, "MERGE_CONFLICT.md");
  if (existsSync(conflictPath)) return;

  const mt = mtimeOrZero(votePath);
  // Use !== so clock-skew or FS-resolution edge cases (mtime regressing)
  // still trigger a re-read instead of getting stuck.
  if (mt !== 0 && mt === lastMtime.get(votePath)) return;

  let shouldTriggerEvolution = false;

  acquireInboxLock("feedback_daemon:current");
  try {
    const vote = parseVote(readFileSync(votePath, "utf-8"), ["a", "b", "tie"]);
    if (!vote) {
      console.error(`[feedback_daemon] VOTE.md touched but no valid vote — waiting`);
      // Record so we don't re-log every 30s; user's next save bumps mtime
      // and we re-parse naturally.
      lastMtime.set(votePath, mt);
      return;
    }

    console.error(`[feedback_daemon] current vote: ${vote}`);

    // Decode: is A the new side or the old side?
    const assignPath = join(paths.inboxCurrent, ".assign.json");
    let assign: Record<string, { A: "main" | "pending"; B: "main" | "pending" }> = {};
    if (existsSync(assignPath)) {
      try { assign = JSON.parse(readFileSync(assignPath, "utf-8")); } catch {}
    }

    // Winning side across all benches. If any bench pairs A=pending, vote=A,
    // that's a pending win; mixed assignments are simplified by tallying
    // per-bench-implied side votes. Most common case: single bench, clear.
    let pendingWins = 0, mainWins = 0;
    for (const { A, B } of Object.values(assign)) {
      if (vote === "a") (A === "pending" ? pendingWins++ : mainWins++);
      else if (vote === "b") (B === "pending" ? pendingWins++ : mainWins++);
    }

    let outcome: "merged" | "rejected" | "tie";
    if (vote === "tie") {
      deleteBranchIfExists(sisyphusRoot, PENDING_BRANCH);
      outcome = "tie";
    } else if (pendingWins > mainWins) {
      console.error(`[feedback_daemon] merging ${PENDING_BRANCH} into main`);
      try {
        mergeBranchToMain(sisyphusRoot, PENDING_BRANCH);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error(`[feedback_daemon] merge failed: ${msg}`);
        writeFileSync(
          conflictPath,
          `# Merge conflict — pending → main\n\n` +
          `The daemon tried to merge \`${PENDING_BRANCH}\` into \`main\` after your vote and git reported a conflict:\n\n` +
          `\`\`\`\n${msg}\n\`\`\`\n\n` +
          `Resolve manually (e.g. \`git checkout main && git merge --no-ff ${PENDING_BRANCH}\` and fix conflicts), then\n` +
          `delete this file to unblock the daemon. Re-save VOTE.md after resolving if you want the merge retried.\n`,
        );
        lastMtime.set(votePath, mt);
        return;
      }
      outcome = "merged";
    } else {
      deleteBranchIfExists(sisyphusRoot, PENDING_BRANCH);
      outcome = "rejected";
    }

    archiveInboxSlot("current", outcome);
    // File is gone after archive; drop the mtime entry so a fresh VOTE.md
    // written seconds later (possibly with a close mtime) still triggers.
    lastMtime.delete(votePath);

    const n = bumpVoteCounter();
    console.error(`[feedback_daemon] vote_counter = ${n} / ${EVOLUTION_TRIGGER_VOTES}`);
    shouldTriggerEvolution = n >= EVOLUTION_TRIGGER_VOTES;
  } finally {
    releaseInboxLock();
  }

  // Defer until after the lock release: evolve_harness re-enters this same
  // lock via withMetaWorktree; holding it here would wedge every trigger
  // permanently as lock_conflict.
  if (shouldTriggerEvolution) triggerEvolution();
}

function handleEvolutionVote(): void {
  const votePath = join(paths.inboxEvolution, "VOTE.md");
  if (!existsSync(votePath)) return;

  const conflictPath = join(paths.inboxEvolution, "MERGE_CONFLICT.md");
  if (existsSync(conflictPath)) return;

  const mt = mtimeOrZero(votePath);
  // Use !== so clock-skew or FS-resolution edge cases (mtime regressing)
  // still trigger a re-read instead of getting stuck.
  if (mt !== 0 && mt === lastMtime.get(votePath)) return;

  acquireInboxLock("feedback_daemon:evolution");
  try {
    const vote = parseVote(readFileSync(votePath, "utf-8"), ["approve", "reject"]);
    if (!vote) {
      console.error(`[feedback_daemon] evolution VOTE.md touched but no valid vote — waiting`);
      lastMtime.set(votePath, mt);
      return;
    }
    console.error(`[feedback_daemon] evolution vote: ${vote}`);

    if (vote === "approve") {
      console.error(`[feedback_daemon] merging ${EVOLUTION_BRANCH} into main`);
      try {
        mergeBranchToMain(sisyphusRoot, EVOLUTION_BRANCH);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error(`[feedback_daemon] evolution merge failed: ${msg}`);
        writeFileSync(
          conflictPath,
          `# Merge conflict — evolution → main\n\n` +
          `Tried to merge \`${EVOLUTION_BRANCH}\` into \`main\` after your approve vote and got:\n\n` +
          `\`\`\`\n${msg}\n\`\`\`\n\n` +
          `Resolve manually, then delete this file. Re-save VOTE.md to retry.\n`,
        );
        lastMtime.set(votePath, mt);
        return;
      }
      archiveInboxSlot("evolution", "merged");
    } else {
      deleteBranchIfExists(sisyphusRoot, EVOLUTION_BRANCH);
      archiveInboxSlot("evolution", "rejected");
    }
    lastMtime.delete(votePath);
    // Reset vote counter regardless of outcome — either way, the 10-vote cycle
    // has been processed.
    resetVoteCounter();
  } finally {
    releaseInboxLock();
  }
}

function triggerEvolution(): void {
  if (existsSync(join(paths.inboxEvolution, "RATIONALE.md"))) {
    console.error(`[feedback_daemon] evolution inbox already populated — skipping trigger`);
    return;
  }
  console.error(`[feedback_daemon] vote_counter threshold reached — invoking reflect_evolve harness`);
  const r = spawnSync(
    "npx",
    ["tsx", join(sisyphusRoot, "scripts/evolve_harness.mts"), sisyphusRoot],
    // Opus + rationale-only (no A/B) → order of minutes, not hours. 30min cap
    // so a stalled LLM can't freeze the daemon's poll loop indefinitely
    // (spawnSync is blocking; signals don't interrupt it).
    { stdio: "inherit", cwd: sisyphusRoot, timeout: 30 * 60_000 },
  );
  if (r.status !== 0) {
    if (r.signal === "SIGTERM") {
      console.error(`[feedback_daemon] evolve_harness timed out after 30min — killed`);
    } else {
      console.error(`[feedback_daemon] evolve_harness failed with status ${r.status}`);
    }
  }
}

// ── Event loop ────────────────────────────────────────────────────────────

console.error(`[feedback_daemon] started. watching ${paths.inboxDir} (poll ${POLL_INTERVAL_MS / 1000}s)`);

function tick(): void {
  // Each handler owns its own try/finally for the lock. Don't release here:
  // an early throw (pre-acquire) would otherwise steal another process's lock.
  try { handleCurrentVote(); } catch (err: any) {
    console.error(`[feedback_daemon] handleCurrentVote error: ${err?.message ?? err}`);
  }
  try { handleEvolutionVote(); } catch (err: any) {
    console.error(`[feedback_daemon] handleEvolutionVote error: ${err?.message ?? err}`);
  }
}

tick();
setInterval(tick, POLL_INTERVAL_MS);

// Graceful shutdown — release the inbox lock if we hold it.
process.on("SIGINT", () => { releaseInboxLock(); process.exit(0); });
process.on("SIGTERM", () => { releaseInboxLock(); process.exit(0); });
