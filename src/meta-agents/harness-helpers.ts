/**
 * Shared setup/teardown for meta-agent harnesses (reflect_harness,
 * evolve_harness). Both need the same sequence: ensure state dirs exist,
 * refuse to run if the inbox is locked, acquire the lock, create a detached
 * worktree from main, run the agent, and clean up on every exit path.
 *
 * Extracting avoided 3-of-a-kind drift between the two callers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureMetaDirs,
  inboxLocked,
  acquireInboxLock,
  releaseInboxLock,
  type MetaPaths,
} from "./state.js";
import { git, gitTry, removeWorktree } from "./git-helpers.js";

export interface WorktreeOptions {
  /** Label recorded in the lock file. Appears in debug output. */
  lockOwner: string;
  /** Prefix for the worktree directory under os.tmpdir(). */
  worktreePrefix: string;
  /** Git ref to check out in the worktree. Default: "main". */
  base?: string;
}

export type WithMetaWorktreeResult =
  | { status: "ran" }
  | { status: "lock_conflict" };

export async function withMetaWorktree(
  sisyphusRoot: string,
  opts: WorktreeOptions,
  body: (worktree: string, paths: MetaPaths) => Promise<void> | void,
): Promise<WithMetaWorktreeResult> {
  const paths = ensureMetaDirs();
  if (inboxLocked()) return { status: "lock_conflict" };
  acquireInboxLock(opts.lockOwner);

  const worktree = mkdtempSync(join(tmpdir(), opts.worktreePrefix));
  // Reap registrations whose working dirs were deleted out-of-band (previous
  // harness SIGKILLed before its own finally ran). Without this, a stale
  // entry holding meta/pending or meta/evolution blocks later branch -D.
  gitTry(sisyphusRoot, "worktree", "prune");
  git(sisyphusRoot, "worktree", "add", "--detach", worktree, opts.base ?? "main");

  try {
    await body(worktree, paths);
    return { status: "ran" };
  } finally {
    removeWorktree(sisyphusRoot, worktree);
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    releaseInboxLock();
  }
}
