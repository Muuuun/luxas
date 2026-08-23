#!/usr/bin/env tsx
/**
 * A/B harness. Called by reflect_harness after it commits a proposal to
 * meta/pending. Runs Sisyphus on every benchmark task {{AB_REPLICATES}} times
 * under each side (main vs meta/pending), collects the produced report PDFs,
 * pairs them with randomized A/B assignment, and drops the result into
 * ~/.sisyphus/reflect-inbox/current/ for user vote.
 *
 * Usage:
 *   tsx scripts/reflect_ab.mts <sisyphus-root> <pending-branch>
 *
 * Benchmark layout (SISYPHUS_ROOT/benchmarks/):
 *   benchmarks/
 *     bench-01-<slug>/
 *       RESEARCH.md
 *     bench-02-<slug>/
 *       RESEARCH.md
 *     ...
 *
 * If benchmarks/ is missing or empty, this script exits 0 with a clear log
 * and no inbox population. reflect_harness treats that as "proposal exists
 * but untestable" — user can still vote by reading PROPOSAL.md alone (but
 * the UX is degraded; populate benchmarks/ to restore it).
 *
 * PDF collection:
 *   current/<bench-slug>/A.pdf    (randomly main or pending)
 *   current/<bench-slug>/B.pdf    (the other)
 *   current/.assign.json          {bench-slug: {A: "main"|"pending", B: ...}}
 *
 * Sisyphus invocation: runSisyphusOnTask spawns `tsx <worktree>/src/index.ts
 * run <taskDir> --max-cost AB_MAX_COST_USD` under a 40-minute timeout. A
 * bench must be scoped to finish inside both; see benchmarks/README.md.
 */

import { mkdirSync, existsSync, readdirSync, writeFileSync, cpSync, mkdtempSync, statSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { ensureMetaDirs, AB_REPLICATES, AB_MAX_COST_USD } from "../src/meta-agents/state.js";
import { git, removeWorktree } from "../src/meta-agents/git-helpers.js";

const [, , sisyphusRoot, pendingBranch] = process.argv;
if (!sisyphusRoot || !pendingBranch) {
  console.error("usage: reflect_ab.mts <sisyphus-root> <pending-branch>");
  process.exit(2);
}

const paths = ensureMetaDirs();
const benchDir = join(sisyphusRoot, "benchmarks");

// Keep the a/b/tie vocabulary in rationale-only cases so the daemon's vote
// parser doesn't need a second schema. Convention: A = accept proposal (merge
// pending), B = keep old (discard), tie = B.
function writeRationaleOnlyVote(header: string, body: string): void {
  mkdirSync(paths.inboxCurrent, { recursive: true });
  const assign: Record<string, { A: "main" | "pending"; B: "main" | "pending" }> = {
    __rationale_only__: { A: "pending", B: "main" },
  };
  writeFileSync(join(paths.inboxCurrent, ".assign.json"), JSON.stringify(assign, null, 2));
  writeFileSync(
    join(paths.inboxCurrent, "VOTE.md"),
    `# ${header}\n\n${body}\n\nchoice: \n\n` +
    `(\`A\` = accept proposal (merge meta/pending), \`B\` = reject, \`tie\` = reject)\n`,
  );
}

function emitNoBenchmarksNote(reason: string): void {
  mkdirSync(paths.inboxCurrent, { recursive: true });
  writeFileSync(
    join(paths.inboxCurrent, "NO_BENCHMARKS.md"),
    `# A/B skipped — ${reason}\n\n` +
    `No paired PDFs were rendered. Read \`PROPOSAL.md\` alongside this note to\n` +
    `decide whether to approve the proposal based on rationale alone.\n\n` +
    `Populate \`${benchDir}\` with subdirectories each containing a RESEARCH.md\n` +
    `to restore the paired A/B workflow on the next deep review.\n`,
  );
  writeRationaleOnlyVote(
    "Vote (rationale-only, no A/B PDFs)",
    "No benchmark PDFs available. Read PROPOSAL.md and decide on the proposal's plausibility.",
  );
}

if (!existsSync(benchDir)) {
  console.error(`[reflect_ab] no benchmarks/ dir at ${benchDir} — skipping A/B; emitting NO_BENCHMARKS.md`);
  emitNoBenchmarksNote("benchmarks/ directory does not exist");
  process.exit(0);
}

const benches = readdirSync(benchDir).filter((d) => {
  const p = join(benchDir, d);
  return statSync(p).isDirectory() && existsSync(join(p, "RESEARCH.md"));
});

if (benches.length === 0) {
  console.error(`[reflect_ab] benchmarks/ empty or missing RESEARCH.md — skipping A/B; emitting NO_BENCHMARKS.md`);
  emitNoBenchmarksNote("benchmarks/ has no subdirectories with RESEARCH.md");
  process.exit(0);
}

console.error(`[reflect_ab] ${benches.length} benchmark tasks × ${AB_REPLICATES} replicates × 2 sides = ${benches.length * AB_REPLICATES * 2} runs`);

// ── Prepare two worktrees: one on main, one on the pending branch ─────────

const worktreeMain = mkdtempSync(join(tmpdir(), "sisyphus-ab-main-"));
const worktreePending = mkdtempSync(join(tmpdir(), "sisyphus-ab-pending-"));

git(sisyphusRoot, "worktree", "add", "--detach", worktreeMain, "main");
git(sisyphusRoot, "worktree", "add", "--detach", worktreePending, pendingBranch);

// ── Sisyphus invocation ───────────────────────────────────────────────────
//
// Each call: fresh task dir with the benchmark's RESEARCH.md copied in, then
// run `tsx <worktree>/src/index.ts run <taskDir>` using the main repo's tsx
// binary. node_modules is symlinked into the worktree (one-time, idempotent)
// because git worktree gives us tracked files only, and the Sisyphus source
// imports from node_modules at runtime.
//
// Returns the absolute report.pdf path on success; null if Sisyphus exited
// non-zero or didn't produce a PDF. Does not enforce a timeout — Sisyphus
// has its own cost/turn budgets.

function ensureWorktreeModules(worktreeRoot: string): void {
  const link = join(worktreeRoot, "node_modules");
  if (existsSync(link)) return;
  symlinkSync(join(sisyphusRoot, "node_modules"), link, "dir");
}

function runSisyphusOnTask(
  worktreeRoot: string,
  taskResearchMd: string,
  replicateIdx: number,
): string | null {
  ensureWorktreeModules(worktreeRoot);

  const taskDir = mkdtempSync(join(tmpdir(), `sisyphus-ab-task-r${replicateIdx}-`));
  cpSync(taskResearchMd, join(taskDir, "RESEARCH.md"));

  const tsxBin = join(sisyphusRoot, "node_modules/.bin/tsx");
  const entryPoint = join(worktreeRoot, "src/index.ts");

  console.error(`[reflect_ab]   run Sisyphus (worktree=${basename(worktreeRoot)}, task=${basename(taskDir)}, replicate=${replicateIdx})`);
  const r = spawnSync(tsxBin, [entryPoint, "run", taskDir, "--max-cost", String(AB_MAX_COST_USD)], {
    stdio: "inherit",
    env: process.env,
    // Per-Sisyphus-run cap. Each run has its own cost/turn budget inside; this
    // is a last-line defense against an API stall pinning one replicate.
    timeout: 40 * 60_000,
  });
  if (r.status !== 0) {
    const reason = r.signal ? `signal ${r.signal}` : `status ${r.status}`;
    console.error(`[reflect_ab]   Sisyphus exited (${reason}) — skipping this replicate`);
    return null;
  }
  const pdfPath = join(taskDir, "report", "report.pdf");
  if (!existsSync(pdfPath)) {
    console.error(`[reflect_ab]   Sisyphus exited 0 but no report.pdf at ${pdfPath}`);
    return null;
  }
  return pdfPath;
}

// ── Run all replicates ────────────────────────────────────────────────────
//
// Only the first successful replicate per bench × side is kept — the others
// exist purely as retries if earlier runs fail. Multiple kept replicates
// would enable variance estimates but the user sees a single pairing.

const firstPdf: Record<"main" | "pending", Record<string, string | null>> = { main: {}, pending: {} };

try {
  for (const bench of benches) {
    const researchMd = join(benchDir, bench, "RESEARCH.md");
    for (const side of ["main", "pending"] as const) {
      firstPdf[side][bench] = null;
      const worktree = side === "main" ? worktreeMain : worktreePending;
      for (let i = 0; i < AB_REPLICATES && !firstPdf[side][bench]; i++) {
        firstPdf[side][bench] = runSisyphusOnTask(worktree, researchMd, i);
      }
    }
  }
} finally {
  for (const wt of [worktreeMain, worktreePending]) removeWorktree(sisyphusRoot, wt);
}

// ── Pair + randomize into inbox ───────────────────────────────────────────

const assign: Record<string, { A: "main" | "pending"; B: "main" | "pending" }> = {};
let paired = 0;

for (const bench of benches) {
  const mainPdf = firstPdf.main[bench];
  const pendingPdf = firstPdf.pending[bench];
  if (!mainPdf || !pendingPdf) continue;

  const benchInbox = join(paths.inboxCurrent, bench);
  mkdirSync(benchInbox, { recursive: true });
  const mainIsA = randomBytes(1)[0] % 2 === 0;
  cpSync(mainPdf, join(benchInbox, mainIsA ? "A.pdf" : "B.pdf"));
  cpSync(pendingPdf, join(benchInbox, mainIsA ? "B.pdf" : "A.pdf"));
  assign[bench] = mainIsA ? { A: "main", B: "pending" } : { A: "pending", B: "main" };
  paired++;
}

if (paired > 0) {
  writeFileSync(join(paths.inboxCurrent, ".assign.json"), JSON.stringify(assign, null, 2));
  writeFileSync(
    join(paths.inboxCurrent, "VOTE.md"),
    `# Vote\n\n` +
    `${paired} benchmark${paired === 1 ? "" : "s"} have paired PDFs under current/<bench>/{A,B}.pdf.\n` +
    `Read both, decide which is better overall, and write your choice below.\n\n` +
    `choice: \n\n` +
    `(valid values: \`A\`, \`B\`, \`tie\`. Daemon watches this file and merges/discards on save.)\n`,
  );
} else {
  // Benchmarks existed but all replicates failed — no PDFs paired. Falling
  // through without writing .assign.json would let the daemon decode every
  // non-tie vote as "rejected" (both tallies stay 0).
  writeRationaleOnlyVote(
    "Vote (rationale-only — A/B runs failed)",
    `Benchmarks existed but all ${benches.length} × ${AB_REPLICATES} × 2 Sisyphus runs failed to produce PDFs.\n` +
    `Read PROPOSAL.md and decide on the proposal's plausibility.`,
  );
}

console.error(`[reflect_ab] done. paired ${paired}/${benches.length} benches`);
process.exit(0);
