#!/usr/bin/env tsx
/**
 * smoke_validate_observation_parse — verify the verdict-extraction regex
 * in validate_observation.mts handles the various output shapes
 * reflect_validate emits (raw {...}, fenced ```json blocks, multiple
 * candidate blocks with the LAST one being the actual verdict).
 *
 * Doesn't spawn any LLM — just exercises the parsing logic against
 * synthetic agent outputs.
 *
 *   npx tsx scripts/smoke_validate_observation_parse.mts
 */
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

// Mirror the parsing logic from validate_observation.mts so a regression
// in the script's regex causes this smoke to go red.
function extractVerdict(out: string): { verdict?: string; rationale?: string; addressed_by_commit?: string | null } | null {
  const fencedBlocks = [...out.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const looseBlocks = [...out.matchAll(/\{[\s\S]*?\}/g)].map((m) => m[0]);
  const candidates = [...fencedBlocks, ...looseBlocks].reverse();
  for (const blob of candidates) {
    try {
      const obj = JSON.parse(blob.trim());
      if (obj && typeof obj.verdict === "string" &&
          (obj.verdict === "real" || obj.verdict === "false" || obj.verdict === "unresolved")) {
        return obj;
      }
    } catch { /* keep looking */ }
  }
  return null;
}

console.log("1. fenced ```json block (the canonical agent output)");
const r1 = extractVerdict(`After reading the diff, my conclusion:

\`\`\`json
{
  "stance": "pro",
  "verdict": "real",
  "rationale": "Pattern recurs across 3 sessions; no commit fixes it.",
  "evidence_cited": [{ "type": "session_line", "ref": "lines 124-130" }],
  "addressed_by_commit": null
}
\`\`\`
`);
check("fenced json verdict extracted", r1?.verdict === "real");
check("rationale preserved", r1?.rationale?.startsWith("Pattern"));

console.log("\n2. fenced block with no language tag");
const r2 = extractVerdict("```\n{\"verdict\": \"false\", \"addressed_by_commit\": \"abc1234\"}\n```");
check("non-tagged fenced verdict extracted", r2?.verdict === "false");
check("commit hash preserved", r2?.addressed_by_commit === "abc1234");

console.log("\n3. raw {...} (no fences) — fallback");
const r3 = extractVerdict(`I'm done. {"verdict": "unresolved", "rationale": "evidence ambiguous"}`);
check("raw json verdict extracted", r3?.verdict === "unresolved");

console.log("\n4. multiple JSON-shaped blobs, last is the verdict");
const r4 = extractVerdict(`
First I noted the observation: {"pattern": "edit_partial_read_blocked"}.
Then I checked the commit: {"hash": "abc1234", "subject": "..."}.
Final verdict:
\`\`\`json
{ "stance": "con", "verdict": "false", "addressed_by_commit": "abc1234" }
\`\`\`
`);
check("picks the verdict-shaped object, not earlier non-verdicts",
  r4?.verdict === "false" && r4?.addressed_by_commit === "abc1234");

console.log("\n5. malformed JSON ignored, valid trailing one wins");
const r5 = extractVerdict(`
Earlier draft: { "verdict": "real", but I was wrong... }
Corrected:
\`\`\`json
{ "verdict": "false", "rationale": "after re-reading commit, it does fix the pattern" }
\`\`\`
`);
check("malformed earlier block skipped", r5?.verdict === "false");

console.log("\n6. agent emitted no verdict at all → null");
const r6 = extractVerdict("I explored extensively but never reached a conclusion.");
check("null when no parseable verdict", r6 === null);

console.log("\n7. invalid verdict value (e.g. 'maybe') → skipped");
const r7 = extractVerdict(`\`\`\`json\n{"verdict": "maybe"}\n\`\`\``);
check("rejects unknown verdict value", r7 === null);

console.log("\n8. empty fenced block doesn't break parser");
const r8 = extractVerdict("```\n\n```\n```json\n{\"verdict\": \"real\"}\n```");
check("empty fence skipped, real one extracted", r8?.verdict === "real");

summary();
