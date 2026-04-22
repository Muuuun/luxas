/**
 * Smoke: counters + inbox lock + archive roundtrip. Uses a temp HOME to
 * avoid polluting the real ~/.sisyphus state if the user already has any.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME before importing state.ts — getMetaPaths resolves at call time
// but computes STATE_DIR/INBOX_DIR from homedir() at module load. Hack it:
const fakeHome = mkdtempSync(join(tmpdir(), "sisyphus-state-smoke-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome; // for Windows parity

const {
  ensureMetaDirs,
  bumpRunCounter,
  bumpVoteCounter,
  resetRunCounter,
  resetVoteCounter,
  readRunCounter,
  readVoteCounter,
  acquireInboxLock,
  releaseInboxLock,
  inboxLocked,
  rotateObservationLogs,
  archiveInboxSlot,
} = await import("../src/meta-agents/state.js");

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Fresh dirs
const paths = ensureMetaDirs();
assert(paths.root.startsWith(fakeHome), "paths rooted under fake HOME");
assert(existsSync(paths.stateDir), "stateDir created");
assert(existsSync(paths.inboxCurrent), "inboxCurrent created");

// Counters roundtrip
assert(readRunCounter() === 0, "run counter starts at 0");
bumpRunCounter(); bumpRunCounter();
assert(readRunCounter() === 2, "run counter bumps to 2");
resetRunCounter();
assert(readRunCounter() === 0, "run counter resets");

for (let i = 0; i < 3; i++) bumpVoteCounter();
assert(readVoteCounter() === 3, "vote counter accumulates");
resetVoteCounter();
assert(readVoteCounter() === 0, "vote counter resets");

// Lock
assert(!inboxLocked(), "no lock initially");
acquireInboxLock("smoke");
assert(inboxLocked(), "lock acquired");
releaseInboxLock();
assert(!inboxLocked(), "lock released");

// Observation log rotation
writeFileSync(paths.observations, `{"pattern":"test"}\n`);
writeFileSync(paths.support, `{"ts":"now"}\n`);
const rotated = rotateObservationLogs();
assert(rotated !== null, "rotation returned non-null");
assert(!existsSync(paths.observations), "observations moved away after rotation");

// Archive
writeFileSync(join(paths.inboxCurrent, "A.pdf"), "fake-A");
writeFileSync(join(paths.inboxCurrent, "B.pdf"), "fake-B");
writeFileSync(join(paths.inboxCurrent, "VOTE.md"), "choice: A");
const archiveDest = archiveInboxSlot("current", "merged");
assert(existsSync(join(archiveDest, "A.pdf")), "archive contains moved files");
assert(!existsSync(join(paths.inboxCurrent, "A.pdf")), "current/ is empty after archive");

rmSync(fakeHome, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — meta-agent state management");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
