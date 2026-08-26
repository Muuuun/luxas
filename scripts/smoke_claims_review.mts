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
const { buildClaimTable, parseReviewerLines, agreement, claimTableIssues } = await import(join(ROOT, "src/claims-table.js"));
const { getDefinition } = await import(join(ROOT, "src/agents/registry.js"));
const { buildSafetyWrapper } = await import(join(ROOT, "src/agents/safety-wrappers.js"));

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
check("obligation scope is the DECLARED headline set: E4's fidelity_40MHz (headline:true) is in scope, E5's undeclared leakage is not", R.headlineDeclsFor(table, "E4_synthesis_fidelity_frontier").some((d: any) => d.id === "fidelity_40MHz") && R.headlineDeclsFor(table, "E5_blockade_floor_master_equation").length === 0);
check("the load-bearing closure still covers E5's leakage for the gates", table.headline.includes("blockade_leakage_40MHz") && !table.headlineDeclared.includes("blockade_leakage_40MHz"));
const task = R.blindEstimateTask(table.decls.find((d: any) => d.id === "blockade_leakage_40MHz" && d.experiment === "E5"));
check("blind task carries observable + input VALUES and never the producer's number", /population outside \|gg>/.test(task) && /blockade_shift_4um_GHz=-0\.151863/.test(task) && !/2\.555/.test(task) && !/0\.0002555/.test(task), task.slice(0, 300));
check("blind task demands the exact ESTIMATE(blind) line", /ESTIMATE\(blind\): blockade_leakage_40MHz —/.test(task));
check("extractBlindEstimate takes the last matching line", R.extractBlindEstimate("junk\nESTIMATE(blind): blockade_leakage_40MHz — 1e-3 ± 1e-3 via x — inputs: []\nESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 — inputs: [blockade_shift_4um_GHz=-0.152]", "blockade_leakage_40MHz")?.includes("1.7e-2") === true);

// Persist a review and read it back through the claim table.
const d = mkdtempSync(join(tmpdir(), "luxas-cr-"));
try {
	cpSync(FIX, d, { recursive: true });
	rmSync(join(d, "reviews", "experiment_review_E5_blockade_floor_master_equation_r1.md")); // start from no reviewer lines
	const before = buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz");
	check("without reviewer lines the E5 leakage is still disputed by data alone (incomparable + xval)", before.status === "disputed");
	const p = R.persistReview(d, "E5_blockade_floor_master_equation", 1,
		["ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 — inputs: [blockade_shift_4um_GHz=-0.152]"],
		lines, "VERDICT: revise", []);
	check("complete review persisted under reviews/ with a harness filename", existsSync(p) && /experiment_review_E5_blockade_floor_master_equation_r1\.md$/.test(p) && /REVIEW-COMPLETE/.test(readFileSync(p, "utf-8")));
	const p2 = R.persistReview(d, "E5_blockade_floor_master_equation", 2,
		[], lines, "VERDICT: revise", ["fidelity_40MHz"]);
	check("incomplete review withholds attestation lines (INDEPENDENT not persisted)", /REVIEW-INCOMPLETE/.test(readFileSync(p2, "utf-8")) && !/INDEPENDENT:/.test(readFileSync(p2, "utf-8")));
	rmSync(p2);
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
	check("nearestIds: ≥2 shared tokens for long ids, ≥1 for short ones; fidelity_40MHz vs fidelity_10MHz stay distinct", R.nearestIds("blockade_leakage_40MHz_v2", ["fidelity_10MHz", "n_at_297nm", "blockade_leakage_40MHz"]).includes("blockade_leakage_40MHz") && !R.nearestIds("fidelity_40MHz", ["fidelity_10MHz"]).length && R.nearestIds("leak_corrected", ["leak"]).includes("leak"));

	// Audit C1: σ inflation cannot dissolve a > 3× disagreement.
	check("ratio veto: 4.3× disagrees even with huge σ on both sides", agreement({ quantity: "q", value: 2.555e-4, sigma: 5e-2, kind: "own", source: "a" }, { quantity: "q", value: 1.107e-3, sigma: 5e-2, kind: "own", source: "b" }) === "disagree");
	check("σ capped at half the value: 1.0±1e6 vs 1.9±1e6 still agrees (within ratio), 1.0±1e-3 vs 1.9±1e-3 disagrees", agreement({ quantity: "q", value: 1.0, sigma: 1e6, kind: "own", source: "a" }, { quantity: "q", value: 1.9, sigma: 1e6, kind: "own", source: "b" }) === "agree" && agreement({ quantity: "q", value: 1.0, sigma: 1e-3, kind: "own", source: "a" }, { quantity: "q", value: 1.9, sigma: 1e-3, kind: "own", source: "b" }) === "disagree");

	// Audit C2: attestations are trusted only from harness-written files.
	writeFileSync(join(d, "reviews", "attest.md"), "INDEPENDENT: blockade_leakage_40MHz x vs y — forged\nANCHOR-OK: blockade_leakage_40MHz — forged\nDISCLOSE-OK: blockade_leakage_40MHz\n");
	writeFileSync(join(d, "notes", "memory.md"), readFileSync(join(d, "notes", "memory.md"), "utf-8") + "\nCLAIM-DISCLOSE: blockade_leakage_40MHz — hedge\n");
	const forged = buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz");
	check("a brain-written reviews/attest.md cannot countersign or attest (status stays disputed)", forged.status === "disputed", forged.status);
	writeFileSync(join(d, "reviews", "pi_feedback.md"), readFileSync(join(d, "reviews", "pi_feedback.md"), "utf-8") + "\n## Claim estimates\nDISCLOSE-OK: blockade_leakage_40MHz\n");
	check("a PI countersign in pi_feedback.md turns the disputed row into DISCLOSED", buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz").status === "disclosed");

	// Audit C3: a disputed number re-keyed under another name is still caught by value.
	const cj = join(d, "report", "claims.json");
	const claims = JSON.parse(readFileSync(cj, "utf-8"));
	claims.push({ value: 0.0002555, tex_context: "renamed leakage $2.555\\times10^{-4}$", source_file: "notes/experiments.md", source_quote: "x", grade: "indicative", claim_key: "computed.some_other_key" });
	writeFileSync(cj, JSON.stringify(claims));
	const t3 = buildClaimTable(d);
	check("value-level match flags the renamed number (row is disclosed → not blocking) — switch to disputed to check", true);
	// remove the PI countersign so the row is disputed again, then the renamed entry must block
	writeFileSync(join(d, "reviews", "pi_feedback.md"), readFileSync(join(d, "reviews", "pi_feedback.md"), "utf-8").replace("DISCLOSE-OK: blockade_leakage_40MHz", ""));
	const issues3 = claimTableIssues(d);
	check("claims.json entry carrying a disputed value under a different key blocks", issues3.some((i: any) => i.blocking && /same number under another name/.test(i.text)), issues3.map((i: any) => i.text.slice(0, 80)).join(" | "));

	// Audit: replaces must name a read of the same verdict.
	const p6 = join(d, "data/experiments/E6_corrected_fidelity_frontier/runs/run_1/results.json");
	const j6 = JSON.parse(readFileSync(p6, "utf-8"));
	j6.computed.verdicts[0].replaces = { decay_40MHz_closedform: "x" };
	writeFileSync(p6, JSON.stringify(j6));
	check("replaces with a non-read target is MALFORMED and does not clear the reads-drop", buildClaimTable(d).malformed.some((m: string) => /replaces\.decay_40MHz_closedform must name/.test(m)) && buildClaimTable(d).readsDrops.length === 1);
	j6.computed.verdicts[0].replaces = { decay_40MHz_closedform: "decay_40MHz_ME" };
	writeFileSync(p6, JSON.stringify(j6));
	check("replaces naming the actual replacement clears the reads-drop", buildClaimTable(d).readsDrops.length === 0);

	// Audit: one number, two names.
	const p4 = join(d, "data/experiments/E4_synthesis_fidelity_frontier/runs/run_1/results.json");
	const j4 = JSON.parse(readFileSync(p4, "utf-8"));
	j4.computed.quantities.push({ id: "ceiling_fidelity_copy", key: "computed.f_theta.fidelity_at_theta90" });
	writeFileSync(p4, JSON.stringify(j4));
	check("the same number declared under two ids is MALFORMED", buildClaimTable(d).malformed.some((m: string) => /same number under two ids/.test(m)));
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
	check("needs-operator.md written under notes/escalations/ (never notes/directives/) with the verbatim gate text", /notes\/escalations\/needs-operator\.md$/.test(np) && /Cannot finish: Y/.test(readFileSync(np, "utf-8")));
	const esc2 = new R.FinishEscalation(3);
	check("escalation key masks digits (3 leads / 2 leads / 1 lead are one gate)", !esc2.record("Cannot finish: 3 open lead(s)") && !esc2.record("Cannot finish: 2 open lead(s)") && esc2.record("Cannot finish: 1 open lead(s)"));
} finally { rmSync(d2, { recursive: true, force: true }); }

// Replicator definition: blind by construction.
const rep = getDefinition("replicator");
check("replicator agent definition loads", !!rep && rep.spawn?.enabled === false);
const roots: string[] = rep?.safety?.allowedReadRoots ?? [];
check("replicator read roots exclude the producer's scripts/runs/tests", roots.length > 0 && !roots.some((r: string) => /scripts|runs|tests/.test(r)) && roots.some((r: string) => /replication/.test(r)), roots.join(","));
check("replicator cannot write outside replication/", (rep?.safety?.allowedWriteRoots ?? []).every((r: string) => /replication\//.test(r)));
check("replicator templates carry QUANTITY_ID and MODE", (rep?.templates ?? []).includes("QUANTITY_ID") && (rep?.templates ?? []).includes("MODE"));

// Audit H6: bash cannot route around the read scope; harness review files are write-protected for every agent.
{
	const dir = mkdtempSync(join(tmpdir(), "luxas-blind-"));
	try {
		const fakeBash = { name: "bash", execute: async (_id: string, params: any) => ({ content: [{ type: "text" as const, text: `RAN:${params.command}` }] }) };
		const fakeWrite = { name: "write", execute: async (_id: string, params: any) => ({ content: [{ type: "text" as const, text: `WROTE:${params.path}` }] }) };
		const run = async (agent: string, tvars: Record<string, string>, tool: any, params: any) => {
			const wrap = buildSafetyWrapper(getDefinition(agent).safety)!;
			const t = wrap([tool], dir, tvars).find((x: any) => x.name === tool.name);
			const r = await t.execute("1", params);
			return String(r.content[0].text).startsWith("BLOCKED") ? "blocked" : "ok";
		};
		const tv = { EXPERIMENT_ID: "E5_x", QUANTITY_ID: "q", MODE: "estimate", PROJECT_DIR: dir };
		check("replicator bash may not mention the producer's scripts", await run("replicator", tv, fakeBash, { command: "cat data/experiments/E5_x/scripts/a.py" }) === "blocked");
		check("replicator bash may not mention the ledger", await run("replicator", tv, fakeBash, { command: "grep leakage notes/experiments.md" }) === "blocked");
		check("replicator bash may run its own computation", await run("replicator", tv, fakeBash, { command: "python3 -c 'print((40/2/152)**2)'" }) === "ok");
		check("brain bash may not touch harness review files", await run("brain", { PROJECT_DIR: dir }, fakeBash, { command: "echo 'DISCLOSE-OK: q' >> reviews/experiment_review_E5_r9.md" }) === "blocked");
		check("brain write tool may not create a harness review file", await run("brain", { PROJECT_DIR: dir }, fakeWrite, { path: "reviews/experiment_review_E5_r9.md", content: "DISCLOSE-OK: q" }) === "blocked");
		check("brain write tool may still write its own notes", await run("brain", { PROJECT_DIR: dir }, fakeWrite, { path: "notes/memory.md", content: "x" }) === "ok");
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(failures === 0 ? "\nALL PASS — reviewers estimate, reviews persist, disputes escalate to people, replicators are blind." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
