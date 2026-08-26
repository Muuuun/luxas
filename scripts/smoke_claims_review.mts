/**
 * Smoke test: claims-first review mechanics (src/claims-review.ts) and their
 * wiring — reviewer obligation lines are extracted, completeness is judged,
 * the review is persisted to a file claims-table.ts reads back, the blind
 * estimate task hides the producer's value, the PI stop→steer rule fires,
 * finish escalation trips on the third identical block, quantity
 * declarations are validated at write time, and the replicator agent
 * definition is scoped so it cannot read the producer's scripts.
 *
 * Run:  npx tsx scripts/smoke_claims_review.mts
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIX = join(ROOT, "fixtures", "claims-297nm", "retrofit");
const R = await import(join(ROOT, "src/claims-review.js"));
const { buildClaimTable, parseReviewerLines } = await import(join(ROOT, "src/claims-table.js"));
const { getDefinition } = await import(join(ROOT, "src/agents/registry.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// Reviewer line extraction + completeness.
const reviewText = `Some prose.\nDISCRIMINATOR: blockade_leakage_40MHz — if right: Ω²; if wrong: Ω⁴; computation: two-branch gate\nSCALING: blockade_leakage_40MHz — expected 2 in Omega; observed 4.03 from data.csv\nINDEPENDENT: c6_75_ghz_um6 E3:own vs E5:own — extrapolation vs tail fit\nVERDICT: revise\nFEEDBACK:\n- Issue 1: x`;
const lines = R.extractReviewerLines(reviewText);
check("extracts DISCRIMINATOR/SCALING/INDEPENDENT lines", lines.length === 3 && lines[0].kind === "DISCRIMINATOR" && lines[1].kind === "SCALING");
check("completeness: fidelity_40MHz missing, blockade_leakage_40MHz present", JSON.stringify(R.reviewCompleteness(lines, ["blockade_leakage_40MHz", "fidelity_40MHz"])) === JSON.stringify(["fidelity_40MHz"]));
check("experimentNumberOf maps EXPERIMENT_ID → E-number", R.experimentNumberOf("E5_blockade_floor_master_equation") === "E5" && R.experimentNumberOf("E_12_x") === "E12" && R.experimentNumberOf("bogus") === null);

// Headline decls + blind task on the retrofit fixture.
const table = buildClaimTable(FIX);
const decls = R.headlineDeclsFor(table, "E5_blockade_floor_master_equation");
check("E5's headline declarations found via the headline set", decls.some((d: any) => d.id === "blockade_leakage_40MHz") && decls.some((d: any) => d.id === "blockade_shift_4um_GHz"), decls.map((d: any) => d.id).join(","));
const task = R.blindEstimateTask(decls.find((d: any) => d.id === "blockade_leakage_40MHz"));
check("blind task carries observable + input VALUES and never the producer's number", /population outside \|gg>/.test(task) && /blockade_shift_4um_GHz=-0\.151863/.test(task) && !/2\.555/.test(task) && !/0\.0002555/.test(task), task.slice(0, 300));
check("blind task demands the exact ESTIMATE(blind) line", /ESTIMATE\(blind\): blockade_leakage_40MHz —/.test(task));
check("extractBlindEstimate takes the last matching line", R.extractBlindEstimate("junk\nESTIMATE(blind): blockade_leakage_40MHz — 1e-3 ± 1e-3 via x — inputs: []\nESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 — inputs: [blockade_shift_4um_GHz=-0.152]", "blockade_leakage_40MHz")?.includes("1.7e-2") === true);

// Persist a review and read it back through the claim table.
const d = mkdtempSync(join(tmpdir(), "luxas-cr-"));
try {
	cpSync(FIX, d, { recursive: true });
	rmSync(join(d, "reviews", "experiment_review_E5.md")); // start from no reviewer lines
	const before = buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz");
	check("without reviewer lines the E5 leakage is still disputed by data alone (incomparable + xval)", before.status === "disputed");
	const p = R.persistReview(d, "E5_blockade_floor_master_equation", 1,
		["ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 — inputs: [blockade_shift_4um_GHz=-0.152]"],
		lines, "VERDICT: revise", ["fidelity_40MHz"]);
	check("review persisted under reviews/", existsSync(p) && /REVIEW-INCOMPLETE: no DISCRIMINATOR for fidelity_40MHz/.test(readFileSync(p, "utf-8")));
	const parsed = parseReviewerLines(d);
	check("claims-table parses the persisted blind estimate, scaling and INDEPENDENT lines", parsed.blind.length === 1 && parsed.scaling.length === 1 && parsed.independent.has("c6_75_ghz_um6"), JSON.stringify({ b: parsed.blind.length, s: parsed.scaling.length }));
	const after = buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz");
	check("after persistence the blind estimate and scaling both appear as reasons", after.reasons.some((x: string) => /blind reviewer estimate/.test(x)) && after.reasons.some((x: string) => /scaling: observed exponent 4.03/.test(x)));
	const block = R.reviewerObligationBlock(["blockade_leakage_40MHz"], ["ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via x — inputs: []"]);
	check("reviewer obligation block names the ids, the line formats, and the blind estimate", /DISCRIMINATOR: <id>/.test(block) && /SCALING: <id>/.test(block) && /1\.7e-2/.test(block));
	check("obligation block is empty when there is nothing in scope", R.reviewerObligationBlock([], []) === "");

	// Write-time validation on a near-duplicate id and a headline without σ.
	const p5 = join(d, "data/experiments/E5_blockade_floor_master_equation/runs/run_1/results.json");
	const j = JSON.parse(readFileSync(p5, "utf-8"));
	j.computed.quantities.push({ id: "blockade_leakage_40_MHz_full", key: "computed.master_equation.leakage_40MHz", headline: true });
	writeFileSync(p5, JSON.stringify(j));
	const probs = R.quantityDeclarationProblems(d, "E5_blockade_floor_master_equation");
	check("near-duplicate id is rejected with the existing id suggested", probs.some((t: string) => /blockade_leakage_40_MHz_full/.test(t) && /blockade_leakage_40MHz/.test(t) && /reuse the existing id/.test(t)), probs.join(" | "));
	check("headline quantity without σ / observable is flagged", probs.some((t: string) => /no `uncertainty`/.test(t)) && probs.some((t: string) => /no `observable`/.test(t)));
	check("nearestIds needs ≥2 shared tokens (fidelity_40MHz vs fidelity_10MHz are distinct quantities, not near-duplicates)", R.nearestIds("blockade_leakage_40MHz_v2", ["fidelity_10MHz", "n_at_297nm", "blockade_leakage_40MHz"]).includes("blockade_leakage_40MHz") && !R.nearestIds("fidelity_40MHz", ["fidelity_10MHz"]).length);
} finally {
	rmSync(d, { recursive: true, force: true });
}

// PI rule.
check("PI stop with estimates for every headline id stands", R.piEstimateRule("stop", [{ quantity: "a", value: 1, route: "x" }], ["a"]).verdict === "stop");
const down = R.piEstimateRule("stop", [{ quantity: "a", value: 1, route: "x" }], ["a", "b"]);
check("PI stop missing an estimate is downgraded to steer with the missing id named", down.verdict === "steer" && /\bb\b/.test(down.issue ?? ""));
check("continue/steer are untouched; legacy (no headline) untouched", R.piEstimateRule("continue", undefined, ["a"]).verdict === "continue" && R.piEstimateRule("stop", undefined, []).verdict === "stop");
const fl = R.formatPIEstimateLines([{ quantity: "a", value: 2.5, sigma: 0.5, route: "napkin" }], ["DISCRIMINATOR: a — if right: x; if wrong: y; computation: z", "not a line"]);
check("PI estimate lines are formatted in the parseable ESTIMATE/DISCRIMINATOR grammar", fl.length === 2 && /^ESTIMATE: a — 2\.5 ± 0\.5 via napkin$/.test(fl[0]) && /^DISCRIMINATOR: a/.test(fl[1]));

// Finish escalation.
const esc = new R.FinishEscalation(3);
check("two identical blocks do not escalate", !esc.record("Cannot finish: X\ndetail") && !esc.record("Cannot finish: X\nother detail"));
check("a different block resets the streak", !esc.record("Cannot finish: Y") && esc.count === 1);
check("third identical consecutive block escalates", !esc.record("Cannot finish: Y") && esc.record("Cannot finish: Y"));
const d2 = mkdtempSync(join(tmpdir(), "luxas-esc-"));
try {
	const np = R.writeNeedsOperator(d2, "Cannot finish: Y\nverbatim", 5);
	check("needs-operator.md written with the verbatim gate text", /notes\/directives\/needs-operator\.md$/.test(np) && /Cannot finish: Y/.test(readFileSync(np, "utf-8")));
} finally { rmSync(d2, { recursive: true, force: true }); }

// Replicator definition: blind by construction.
const rep = getDefinition("replicator");
check("replicator agent definition loads", !!rep && rep.spawn?.enabled === false);
const roots: string[] = rep?.safety?.allowedReadRoots ?? [];
check("replicator read roots exclude the producer's scripts/runs/tests", roots.length > 0 && !roots.some((r: string) => /scripts|runs|tests/.test(r)) && roots.some((r: string) => /replication/.test(r)), roots.join(","));
check("replicator cannot write outside replication/", (rep?.safety?.allowedWriteRoots ?? []).every((r: string) => /replication\//.test(r)));
check("replicator templates carry QUANTITY_ID and MODE", (rep?.templates ?? []).includes("QUANTITY_ID") && (rep?.templates ?? []).includes("MODE"));

console.log(failures === 0 ? "\nALL PASS — reviewers estimate, reviews persist, disputes escalate to people, replicators are blind." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
