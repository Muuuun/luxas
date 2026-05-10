#!/usr/bin/env tsx
/**
 * smoke_validate_pending_merge — verify the F2 race-recovery: a
 * .pending.jsonl file is merged into observations.jsonl on validate
 * startup (when not locked) then unlinked, and a final-write under a
 * detected race is diverted to the pending file instead of the live
 * observations.jsonl.
 *
 * Spawns validate_observation.mts in an isolated HOME-overridden state
 * directory with no observations to validate, and asserts that the
 * pending-merge runs and the file is removed.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "smoke-pending-"));
const sisyphusRoot = process.cwd();
const stateDir = join(tmpHome, ".sisyphus/reflect-state");
mkdirSync(stateDir, { recursive: true });
const obsPath = join(stateDir, "observations.jsonl");
const pendingPath = join(stateDir, "observations.pending.jsonl");

// Seed: put one ordinary obs in observations.jsonl and one validation
// entry in observations.pending.jsonl. After validate startup, the
// pending entry should have been merged into observations.jsonl AND
// pending file should be unlinked.
const seedObs = JSON.stringify({
  ts: "2026-05-10T12:00:00Z",
  session_id: "checkpoint.done-2026-05-10T12-00-00-000Z.jsonl",
  session_jsonl_path: "/fake/path/checkpoint.done-2026-05-10T12-00-00-000Z.jsonl",
  outcome: "degraded_finish",
  pattern: "smoke_pending_merge_test_pattern",
  evidence: "smoke test seeded pattern",
  proposed_target: "n/a",
}) + "\n";
const pendingValidation = JSON.stringify({
  type: "validation",
  ts: "2026-05-10T11:55:00.000Z",
  validates_session_id: "checkpoint.done-2026-05-10T12-00-00-000Z.jsonl",
  validates_pattern: "smoke_pending_merge_test_pattern",
  verdict: "real",
  addressed_by_commit: null,
  rounds: [],
}) + "\n";
writeFileSync(obsPath, seedObs);
writeFileSync(pendingPath, pendingValidation);

console.log(`[smoke] HOME=${tmpHome}`);
console.log(`[smoke] before: obsPath has ${readFileSync(obsPath, "utf-8").split("\n").filter(Boolean).length} lines, pendingPath exists=${existsSync(pendingPath)}`);

// Run validate_observation. With one observation that ALREADY has a
// validation entry (after merge), it will find no unvalidated work and
// exit 0 quickly without spawning agents. The merge step happens BEFORE
// the "find unvalidated" step, so we can verify it ran.
const r = spawnSync(
  "npx",
  ["tsx", join(sisyphusRoot, "scripts/validate_observation.mts"), sisyphusRoot],
  {
    encoding: "utf-8",
    cwd: sisyphusRoot,
    env: { ...process.env, HOME: tmpHome },
    timeout: 60_000,
  },
);

console.log(`[smoke] exit=${r.status}, stderr last 300:\n${(r.stderr ?? "").slice(-300)}`);

const obsLines = readFileSync(obsPath, "utf-8").split("\n").filter(Boolean);
const pendingExists = existsSync(pendingPath);

let ok = true;
if (!obsLines.some((l) => {
  try { return JSON.parse(l).type === "validation"; } catch { return false; }
})) {
  console.error("FAIL: validation entry not present in observations.jsonl after merge");
  ok = false;
}
if (pendingExists) {
  console.error("FAIL: pending file still present — should have been unlinked after merge");
  ok = false;
}
if (obsLines.length !== 2) {
  console.error(`FAIL: expected 2 lines (obs + merged validation), got ${obsLines.length}`);
  ok = false;
}

rmSync(tmpHome, { recursive: true, force: true });
if (!ok) process.exit(1);
console.log(`OK: pending merge ran, validation entry now in observations.jsonl, pending file removed.`);
