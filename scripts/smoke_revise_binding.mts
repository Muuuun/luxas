/**
 * smoke_revise_binding — v3 D1: a `VERDICT: revise` at the iteration cap must
 * reach the ledger. On a copy of the pp-vs-ss fixture: a synthetic round-4
 * review with FEEDBACK → E1's quantities capped at indicative + a blocking
 * finish issue; `finding_open:` quoting the sentence clears the block;
 * `finding_answered:` with a locator lifts the cap; a `(none)` verdict never counts.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReviewFindings, quotesSentence, persistReview } from "../src/claims-review.ts";
import { buildClaimTable, claimTableIssues } from "../src/claims-table.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "revise-binding-"));
cpSync("fixtures/claims-ppss", dir, { recursive: true });
delete process.env.LUXAS_REVISE_BINDING;

check("baseline: the fixture's latest E1 review is (none) → no open finding", !openReviewFindings(dir).has("E1"));
const sentence = "The theta=90 value 299.11 rests on a truncated basis that the diagonalization control contradicts by 10 percent.";
const feedback = sentence + " Re-run the SystemPair diagonalization with n±5 and report the converged C6 at theta=90 with its σ.";
persistReview(dir, "E1_ss_pp_c6_anisotropy", 4, [], [], "VERDICT: revise", [], feedback);
const f = openReviewFindings(dir).get("E1");
check("revise + FEEDBACK persisted → open finding for E1 with the first sentence", !!f && f.sentence === sentence && !f.answered && !f.quoted, JSON.stringify(f));
check("review file carries the FEEDBACK block", /^FEEDBACK:\n/m.test(readFileSync(join(dir, "reviews", "experiment_review_E1_ss_pp_c6_anisotropy_r4.md"), "utf-8")));
const t1 = buildClaimTable(dir);
check("E1's quantities carry the open-finding reason", t1.rows.filter((r) => r.estimates.some((e) => e.experiment === "E1")).some((r) => r.reasons.some((x) => /reviewer finding open \(E1 round 4\)/.test(x))));
check("finish issue [review-open] is blocking and quotes the sentence", claimTableIssues(dir, t1).some((i) => i.blocking && /\[review-open\] E1/.test(i.text) && i.text.includes(sentence.slice(0, 60))));

// finding_open quote → block clears, cap stays
const ledgerPath = join(dir, "notes", "experiments.md");
const ledger = readFileSync(ledgerPath, "utf-8");
const l2 = ledger.indexOf("## L2.1");
const nextSec = ledger.indexOf("\n## ", l2 + 5);
const withQuote = ledger.slice(0, nextSec) + `\n### Limitations\nfinding_open: "${sentence}"\n` + ledger.slice(nextSec);
writeFileSync(ledgerPath, withQuote);
const f2 = openReviewFindings(dir).get("E1")!;
check("finding_open quoting ≥8 words clears the finish block (quoted=true, answered=false)", f2.quoted && !f2.answered);
check("quotesSentence: partial 8-token window matches; unrelated text does not", quotesSentence("… we note: the theta=90 value 299.11 rests on a truncated basis …", sentence) && !quotesSentence("unrelated limitations text about beams", sentence));
check("no [review-open] issue once quoted", !claimTableIssues(dir).some((i) => /\[review-open\] E1/.test(i.text)));
check("cap persists while only quoted", buildClaimTable(dir).rows.filter((r) => r.estimates.some((e) => e.experiment === "E1")).some((r) => r.reasons.some((x) => /reviewer finding open/.test(x))));

// finding_answered with a locator → cap lifts
writeFileSync(ledgerPath, ledger.slice(0, nextSec) + `\n### Limitations\nfinding_answered: re-ran the diagonalization with n±5 — data/experiments/E1_ss_pp_c6_anisotropy/runs/run_1/results.json computed.c6_pp_theta90_60\n` + ledger.slice(nextSec));
const f3 = openReviewFindings(dir).get("E1")!;
check("finding_answered with a locator → answered", f3.answered);
check("cap lifted once answered", !buildClaimTable(dir).rows.some((r) => r.reasons.some((x) => /reviewer finding open/.test(x))));
writeFileSync(ledgerPath, ledger.slice(0, nextSec) + `\n### Limitations\nfinding_answered: we fixed it\n` + ledger.slice(nextSec));
check("finding_answered WITHOUT a locator does not count", !openReviewFindings(dir).get("E1")!.answered);
process.env.LUXAS_REVISE_BINDING = "0";
check("LUXAS_REVISE_BINDING=0 disables", openReviewFindings(dir).size === 0);
delete process.env.LUXAS_REVISE_BINDING;
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — a diagnosed flaw must reach the ledger before the report ships.");
