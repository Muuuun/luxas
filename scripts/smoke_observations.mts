/**
 * Smoke: observations/support JSONL schema validator. Covers happy path,
 * malformed lines (bad JSON, missing required fields, wrong enum value),
 * and mixed-quality file loading.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseObservation, parseSupport, loadObservations, loadSupport } from "../src/meta-agents/observations.js";

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Happy path — valid observation
const good = JSON.stringify({
  ts: "2026-04-22T14:35:00Z",
  session_id: "session-abc",
  outcome: "degraded_finish",
  pattern: "search_skipped_before_plan",
  evidence: "Brain went to plan without reader spawn.",
  proposed_target: "src/agents/definitions/brain.md",
});
assert(parseObservation(good) !== null, "valid observation parses");

// Bad — wrong outcome enum
const badOutcome = JSON.stringify({ ...JSON.parse(good), outcome: "crashed" });
assert(parseObservation(badOutcome) === null, "invalid outcome rejected");

// Bad — missing required field
const missingPattern = JSON.stringify({ ...JSON.parse(good), pattern: undefined });
assert(parseObservation(missingPattern) === null, "missing pattern rejected");

// Bad — malformed JSON
assert(parseObservation("{not valid json") === null, "malformed JSON rejected");

// Bad — empty pattern
const emptyPattern = JSON.stringify({ ...JSON.parse(good), pattern: "" });
assert(parseObservation(emptyPattern) === null, "empty pattern rejected");

// Support signals
const goodSupport = JSON.stringify({
  ts: "2026-04-22T15:00:00Z",
  session_id: "session-xyz",
  pending_rev: "abc1234",
  item_ref: "hypothesis-1",
});
assert(parseSupport(goodSupport) !== null, "valid support parses");
assert(parseSupport(JSON.stringify({ ts: "now" })) === null, "truncated support rejected");

// Mixed-quality file loading
const dir = mkdtempSync(join(tmpdir(), "smoke-obs-"));
const path = join(dir, "observations.jsonl");
writeFileSync(path, [good, badOutcome, "", "{bad", good].join("\n"));
const result = loadObservations(path);
assert(result.valid.length === 2, `mixed-quality file: 2 valid, got ${result.valid.length}`);
assert(result.skipped === 2, `mixed-quality file: 2 skipped, got ${result.skipped}`);

// Missing file — not an error, returns empty
const missing = loadObservations(join(dir, "nonexistent.jsonl"));
assert(missing.valid.length === 0 && missing.skipped === 0, "missing file returns empty valid + 0 skipped");

// Same pattern for support
const supportPath = join(dir, "support.jsonl");
writeFileSync(supportPath, [goodSupport, "{", goodSupport].join("\n"));
const supportResult = loadSupport(supportPath);
assert(supportResult.valid.length === 2, "support mixed-quality: 2 valid");
assert(supportResult.skipped === 1, "support mixed-quality: 1 skipped");

if (failures === 0) {
  console.log("\nPASS — observations validator");
  process.exit(0);
} else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
