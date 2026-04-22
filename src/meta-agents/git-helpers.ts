/**
 * Git subprocess helpers for the meta-agent harness. Four harness scripts
 * (reflect_harness, reflect_ab, evolve_harness, feedback_daemon) each had
 * subtly different `git()` / `gitTry()` copies — consolidated here so
 * signatures and error-handling contracts can't drift.
 */

import { execFileSync, spawnSync } from "node:child_process";

/**
 * Run git in `cwd`, return stdout. Throws with stderr attached on non-zero.
 * Use for operations that MUST succeed (worktree add, commit, checkout).
 */
export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    });
  } catch (err: any) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err?.stderr ?? err?.message}`);
  }
}

/**
 * Run git in `cwd` without throwing. Returns `{ok, stdout}`.
 * Use for probe operations (does this branch exist? has this commit?).
 */
export function gitTry(cwd: string, ...args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
}

export function branchExists(cwd: string, branch: string): boolean {
  return gitTry(cwd, "rev-parse", "--verify", "--quiet", branch).ok;
}

export function deleteBranchIfExists(cwd: string, branch: string): void {
  if (branchExists(cwd, branch)) git(cwd, "branch", "-D", branch);
}

/**
 * Merge `branch` into `main` cleanly, then delete `branch`.
 *
 * The harness builds meta/pending / meta/evolution from main as it was at
 * proposal time (T0). The user may commit unrelated work to main before
 * voting (T1). A naive --ff-only merge at vote time fails because main
 * has moved on. We rebase the branch onto current main first (textual
 * conflicts become real merge conflicts, which WILL fail merge — caller
 * catches the throw and reports so the user can resolve manually).
 */
export function mergeBranchToMain(cwd: string, branch: string): void {
  git(cwd, "checkout", branch);
  try {
    git(cwd, "rebase", "main");
  } catch (err) {
    // Abort so we don't leave .git/rebase-apply around — that state blocks
    // every subsequent git op in this repo including the next harness run.
    gitTry(cwd, "rebase", "--abort");
    gitTry(cwd, "checkout", "main");
    throw err;
  }
  git(cwd, "checkout", "main");
  git(cwd, "merge", "--ff-only", branch);
  git(cwd, "branch", "-D", branch);
}

/**
 * Remove a git worktree, falling back to a best-effort directory delete if
 * git itself refuses (e.g. worktree already unregistered).
 */
export function removeWorktree(cwd: string, worktreePath: string): void {
  try {
    git(cwd, "worktree", "remove", "--force", worktreePath);
  } catch {
    // Let the caller deal with any residual path — we've done what we can
    // without risking rm -rf on a bad path from a failure mode upstream.
  }
}
