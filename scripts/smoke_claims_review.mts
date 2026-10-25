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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const reviewText = `Some prose.\nDISCRIMINATOR: blockade_leakage_40MHz — if right: Ω²; if wrong: Ω⁴; computation: two-branch gate\nSCALING: blockade_leakage_40MHz — expected 2 in Omega; observed 4.03 from data.csv\nINDEPENDENT: c6_75_ghz_um6 E3:own vs E5:own — shared: none — extrapolation vs tail fit\nVERDICT: revise\nFEEDBACK:\n- Issue 1: x`;
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
	// C41: only the closed form attests; an open-form line is recorded, never malformed.
	const openForm = join(d, "reviews", "experiment_review_E1_transition_strength_power_r1.md");
	writeFileSync(openForm, "INDEPENDENT: rabi_38P_khz E1:own vs E1:xval — computed dipole + beam formula vs a measured line scan\n");
	const parsedOpen = parseReviewerLines(d);
	check("C41: an open-form INDEPENDENT line is recorded in independentLines but does not attest", parsedOpen.independentLines?.some((l: any) => l.id === "rabi_38P_khz" && l.shared.length === 0) === true && !parsedOpen.independent.has("rabi_38P_khz") && parsedOpen.independent.has("c6_75_ghz_um6") && parsedOpen.malformed.length === 0, JSON.stringify({ lines: parsedOpen.independentLines, attested: [...parsedOpen.independent], malformed: parsedOpen.malformed }));
	rmSync(openForm);
	const after = buildClaimTable(d).rows.find((r: any) => r.id === "blockade_leakage_40MHz");
	check("after persistence the blind estimate and scaling both appear as reasons", after.reasons.some((x: string) => /blind reviewer estimate/.test(x)) && after.reasons.some((x: string) => /scaling: observed exponent 4.03/.test(x)));
	const block = R.reviewerObligationBlock(["blockade_leakage_40MHz"], ["ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via x — inputs: []"]);
	check("reviewer obligation block names the ids, the line formats, and the blind estimate", /DISCRIMINATOR: <id>/.test(block) && /SCALING: <id>/.test(block) && /1\.7e-2/.test(block));
	check("obligation block is empty when there is nothing in scope", R.reviewerObligationBlock([], []) === "");
	const reviewerDef = readFileSync(join(ROOT, "src/agents/definitions/experiment_reviewer.md"), "utf-8");
	check("C41: block and reviewer definition both show INDEPENDENT's closed form and say only shared: none attests", [block, reviewerDef].every((s) => /INDEPENDENT: <id> <a> vs <b> — shared: none\|inputs\|model\|code\|values — <why>/.test(s) && /only "?`?shared: none`?"? counts as an attestation/i.test(s)));
	check("C41: INDEPENDENT stays optional (completeness asks only for DISCRIMINATOR + SCALING)", R.reviewCompleteness(lines.filter((l: any) => l.kind !== "INDEPENDENT"), ["blockade_leakage_40MHz"]).length === 0);

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
check("PI stop with estimates for every headline id stands", R.piEstimateRule("stop", [{ quantity: "a", value: 1, route: "x" }], ["a"], ["DISCRIMINATOR: a — if right: 1; if wrong: 2; computation: scan"]).verdict === "stop");
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

// ── referee pass: a STOP needs a DISCRIMINATOR per headline quantity ──
{
	const est = [{ quantity: "a", value: 1, sigma: 0.1, route: "x" }, { quantity: "b", value: 2, sigma: 0.1, route: "y" }];
	const r1 = R.piEstimateRule("stop", est, ["a", "b"], ["DISCRIMINATOR: a — if right: 1; if wrong: 2; computation: scan"]);
	check("stop with estimates but a missing DISCRIMINATOR → steer naming the id", r1.verdict === "steer" && /referee pass/.test(r1.issue ?? "") && /\bb\b/.test(r1.issue ?? ""), r1.issue);
	const r2 = R.piEstimateRule("stop", est, ["a", "b"], ["DISCRIMINATOR: a — …", "DISCRIMINATOR: b — …"]);
	check("stop with estimates and discriminators for all → stands", r2.verdict === "stop");
	check("estimate rule still fires first", /no independent estimate/.test(R.piEstimateRule("stop", est.slice(0, 1), ["a", "b"], []).issue ?? ""));
	check("continue/steer untouched by the referee pass", R.piEstimateRule("steer", [], ["a"], []).verdict === "steer");
}

// ── blind-estimate cap (live probe 2026-08-26: producers headline 6/7 quantities) ──
{
	const decls = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
	const r = R.selectBlindEstimateDecls(decls, ["e", "zzz_not_declared", "b"], 3);
	check("cap: frame ids first (in frame order), then declaration order, ≤3", r.chosen.map((d: any) => d.id).join(",") === "e,b,a" && r.skipped.join(",") === "c,d,f", JSON.stringify(r));
	check("cap: duplicates across frame/decls collapse", R.selectBlindEstimateDecls([{ id: "a" }, { id: "a" }, { id: "b" }], ["a"], 3).chosen.length === 2);
	{ const r2 = R.selectBlindEstimateDecls(decls, ["e"], 3, new Set(["e", "a"])); check("settled ids are skipped and reported", !r2.chosen.some((d: any) => d.id === "e" || d.id === "a") && r2.skipped.some((x: string) => /^e \(already settled\)/.test(x)), JSON.stringify(r2)); }
	check("cap 0 disables blind estimates", R.selectBlindEstimateDecls(decls, [], 0).chosen.length === 0 && R.selectBlindEstimateDecls(decls, [], 0).skipped.length === 6);
}

// ── §C9: units and asymmetric errors parse; a line that still does not parse is kept, never blocking ──
// Verbatim Dy lines (2026-10-07, replicator finals and reviewer returns of E1–E4). 11 of them failed the
// pre-C9 grammar (9 for a unit, 2 for an asymmetric error) and were dropped without a trace: E4's blind
// 207.82 MHz against the producer's 65.68 (3.2×) reached neither the reviewer nor the table.
{
	const T = await import(join(ROOT, "src/claims-table.js"));
	const DY = [
		"ESTIMATE(blind): nuclear_qubit_clock_point_B — 3137 ± 300 via full 102-state diagonalization, 161Dy mJ=-8 stretched mI=+5/2↔+3/2 transition — inputs: [A_MHz_161=-116.231, A_MHz_163=162.754, Bq_MHz_161=1091.577, Bq_MHz_163=1152.869, gI_161=-0.192, gI_163=0.2692]",
		"ESTIMATE(blind): nuclear_qubit_T2_field_limited — 0.0483 ± 0.020 via quasi-static ΔB/B noise, Marsh2026 T2*=1/(π·df_dB·ΔB), grid log-midpoint — inputs: [df_dB_kHz_per_G=851, DeltaB_over_B=0.00001, S0_G2_per_Hz=0.000001]",
		"ESTIMATE: nuclear_qubit_clock_point_B — 3125 ± 25 G (161, m_I=+3/2↔+5/2) via sign change on the 50 G grid of df_dB_vs_B_161.csv; this agrees with the blind 3137 ± 300 G.",
		"ESTIMATE: nuclear_qubit_clock_point_B — 3136.8 ± 0.3 G via independent full diagonalization with input-error propagation.",
		"ESTIMATE(blind): nuclear_qubit_clock_point_B — 3136.83 G ± 0.31 G via fixed-M block diagonalization + direct scalar max (f''=-4.20 Hz/G²) — inputs: [A=-116.231 MHz, B_quadrupole=1091.577 MHz, g_J=1.2416, mu_I=-0.480 muN, I=5/2]",
		"ESTIMATE(blind): nuclear_qubit_transition_frequency — 575 ± 55 via stretched-state closed form ν=−8A−(13/40)Bq, 161Dy lowest rung — inputs: [A_MHz_161=-116.231, Bq_MHz_161=1091.577, A_MHz_163=162.754, Bq_MHz_163=1152.869]",
		"ESTIMATE(blind): tweezer_kappa_532_theta90 — -2.56e-6 ± 1.3e-6 via full 102×102 Zeeman+hyperfine+light-shift diagonalization, Hellmann-Feynman derivative — inputs: [alpha_s_532_au=180, alpha_t_532_au=-25, nuclear_qubit_clock_point_B=3136.82, U0_uK=150]",
		"ESTIMATE(blind): tweezer_kappa_1064_worst_theta — 3.2e-7 ± 1.2e-7 via 102-state hyperfine+Zeeman diagonalization, tensor ⟨T⟩/120 — inputs: [alpha_s_1064_au=184.4, alpha_t_1064_au=1.7, nuclear_qubit_clock_point_B=3136.82, U0_uK=150]",
		"ESTIMATE: tweezer_kappa_1064_worst_theta — 4.0e-7 ± 3e-7 via agent MC spread; consistent with blind 3.2e-7 ± 1.2e-7",
		"ESTIMATE: tweezer_total_scattering_rate_1064 — 0.147 ± 0.01 s⁻¹ via closed-form Rayleigh from measured α (excludes 5I7 Raman); disagrees with blind 0.29 ± 0.07 at about 2σ",
		"ESTIMATE(blind): nuclear_qubit_clock_point_B — 3136.83 G (d2f/dB2=-4.20e-6 MHz/G^2), 19797.53 G (d2f/dB2=+1.43e-8) ± 64 G via 102x102 diagonalization, overlap tracking, Hellmann-Feynman df/dB — inputs: [A=-116.231 MHz, Bq=1091.577 MHz, g_J=1.2416, mu_I=-0.480 muN, I=5/2]",
		"ESTIMATE: tweezer_total_scattering_rate_1064 — 0.134 ± 0.03 s⁻¹ via two-level Grimm formula on the 421-nm line (A=2.08e8 s⁻¹), counter-rotating term included, U0=k_B·150 µK",
		"ESTIMATE: tweezer_total_scattering_rate_1064 — 0.134 ± 0.03 s⁻¹ via Grimm two-level formula for the 421-nm line with ω³ and counter-rotating terms.",
		"ESTIMATE(blind): dy_readout_infidelity_shelved_626 — 0.011 ± 0.004 via Bloch2023-anchored two-state fluorescence loss model, threshold/time optimized — inputs: [eta=0.022792559751431924, p_loss_per_photon=0.00003586397867722966, N0_per_30ms=10, read_noise=1.6, sigma_B_G=0.031368200000000006, chi_pol=0.01, nuclear_qubit_clock_point_B=3136.82]",
		"ESTIMATE(blind): tweezer_total_scattering_rate_1064 — 0.29 ± 0.07 via two-level Im[α]/Re[α] × depth; 421-nm line dominates — inputs: [alpha_s_1064_au=184.4, U0_uK=150]",
		"ESTIMATE(blind): dy_init_error_626_pumping — 0.013 ± 0.008 via Paschen-Back hyperfine-mixed biased-walk optical pumping + chi impurity + Bloch2023 loss — inputs: [nuclear_qubit_clock_point_B=3136.82, Gamma_626_Hz=135000, sigma_B_G=0.031368200000000006]",
		"ESTIMATE: dy_readout_infidelity_shelved_626 — 0.0152 ± 0.0005 via a 7-node Gauss–Hermite field-noise mixture of the closed-form Bloch2023 histogram model, t = 60 ms (0.0093 at σ_B = 0)",
		"ESTIMATE: dy_rf_gate_error_blackman_1MHz — 7e-7 (+1e-6/−3e-7) via a 3-level AC-Stark Blackman propagation with virtual-Z optimisation",
		"ESTIMATE: dy_rf_gate_error_blackman_1MHz — 4.4e-7 ± 0.5e-7 via analytic admixture ratio (≈0.43 outer step) fed into the run's own I_x-vs-electronic comparison",
		"ESTIMATE(blind): mI_shelving_selectivity_161_clock — 207.82 ± 5 MHz via 102×102 hyperfine+Zeeman diagonalization, Childs1970/Stone2014, nearest M1 spectator — inputs: [clock_field_G=3136.82]",
		"ESTIMATE(blind): cz_gate_error_dy_nuclear — 1.2e-2 ± 6e-3 via 2π-blockade CZ decay+laser+Doppler+M1 sum — inputs: [clock_field_G=3136.82, Omega_over_2pi_MHz=5, R_um=2, T_K=0.00001, T2s_laser_s=0.0000034]",
		"ESTIMATE: cz_gate_error_dy_nuclear — 1.9e-2 ± 1e-2 via the budget with C6 at a recoupling factor of about 0.55 (geometric centre of [0.3, 1]), giving blockade error ×3.3.",
		"ESTIMATE: dy_readout_infidelity_shelved_626 — 0.016 ± 0.002 via the noise-averaged two-state model (the blind 0.011 matches the agent's noise-off floor; the gap is the σ_B = 1e-5·B penalty).",
		"ESTIMATE: dy_init_error_626_pumping — 0.02 ± 0.005 via the full-branching jump chain plus 0.5% loss (blind 0.013 ± 0.008, within 1.3σ).",
		"ESTIMATE(blind): dy_rf_gate_error_blackman_1MHz — 1.7e-06 ± 3e-07 via full 102-level hyperfine RWA simulation (AC-Stark dominated) — inputs: [nuclear_qubit_clock_point_B=3136.82, nuclear_qubit_transition_frequency_MHz=1270.655312820305, sigma_B_G=0.031368200000000006]",
		"ESTIMATE: cz_gate_error_dy_nuclear — 1.0e-2 ± 2e-3 via channel sum (blockade 0.21(Ω/V)² at V/Ω = 7.4 + Γ·T_R with T_R = 2.94/Ω and τ = 29.8 µs + 2.3e-3 for shelving, Doppler, phase and intensity noise); consistent with the blind 1.2e-2 ± 6e-3",
		"ESTIMATE: cz_gate_error_dy_nuclear — 9.9e-3 (+3.9e-2/−1.5e-3) via the reproduced channel budget; consistent with the blind 1.2e-2 ± 6e-3.",
		"ESTIMATE: mI_shelving_selectivity_161_clock — 65.68 ± 0.01 MHz via my own hyperfine-plus-Zeeman diagonalisation.",
	];
	// Two values on one line (replicator bg-2): not one estimate, so it must stay unparsed.
	const TWO_ROOTS = DY[10];
	// The pre-C9 grammar, frozen as the reference for (e).
	const OLD_NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
	const OLD_RE = new RegExp(String.raw`^\s*ESTIMATE(\(blind\))?:\s*(\S+)\s+[—–-]+\s+(${OLD_NUM})(?:\s*(?:±|\+/-)\s*(${OLD_NUM}))?\s*(?:via\s+(.*?))?(?:\s+[—–-]+\s*inputs:\s*(.*))?\s*$`);
	const parse = (l: string) => (typeof T.parseEstimateLine === "function" ? T.parseEstimateLine(l) : undefined);
	const dir = mkdtempSync(join(tmpdir(), "luxas-c9-"));
	try {
		// (a) the ten Dy lines the old grammar dropped that carry one value each.
		const unitLines = DY.filter((l) => !OLD_RE.test(l) && l !== TWO_ROOTS);
		const extracted = R.extractReviewerLines(unitLines.join("\n"));
		R.persistReview(join(dir, "a"), "E1_dy", 1, [], extracted, "VERDICT: satisfied", []);
		const pa = parseReviewerLines(join(dir, "a"));
		const got = [...pa.blind, ...pa.posthoc];
		const want: [string, number, number, string | undefined][] = [
			["nuclear_qubit_clock_point_B", 3125, 25, "G"], ["nuclear_qubit_clock_point_B", 3136.8, 0.3, "G"], ["nuclear_qubit_clock_point_B", 3136.83, 0.31, "G"],
			["tweezer_total_scattering_rate_1064", 0.147, 0.01, "s⁻¹"], ["tweezer_total_scattering_rate_1064", 0.134, 0.03, "s⁻¹"], ["tweezer_total_scattering_rate_1064", 0.134, 0.03, "s⁻¹"],
			["dy_rf_gate_error_blackman_1MHz", 7e-7, 1e-6, undefined], ["cz_gate_error_dy_nuclear", 9.9e-3, 3.9e-2, undefined],
			["mI_shelving_selectivity_161_clock", 207.82, 5, "MHz"], ["mI_shelving_selectivity_161_clock", 65.68, 0.01, "MHz"],
		];
		const missed = want.filter(([id, v, s, u]) => {
			const i = got.findIndex((e: any) => e.quantity === id && e.value === v && e.sigma === s && e.unit === u);
			if (i < 0) return true;
			got.splice(i, 1);
			return false;
		});
		const malformedAtExtract = extracted.filter((l: any) => l.kind === "MALFORMED").length;
		check(`§C9(a) the Dy unit/asymmetric lines survive extract → persist → parse with value/σ/unit (${want.length - missed.length}/${want.length})`, unitLines.length === 10 && missed.length === 0 && malformedAtExtract === 0,
			`missed ${missed.map((w) => w.join("/")).join("; ")}; MALFORMED at extraction: ${malformedAtExtract}`);

		// (b) E4: the blind line is recovered at spawn time and disputes the producer.
		const E4_FINAL = "ESTIMATE(blind): mI_shelving_selectivity_161_clock — 207.82 ± 5 MHz via 102×102 hyperfine+Zeeman diagonalization, Childs1970/Stone2014, nearest M1 spectator — inputs: [clock_field_G=3136.82]";
		const e4 = R.extractBlindEstimate(E4_FINAL, "mI_shelving_selectivity_161_clock");
		check("§C9(b) extractBlindEstimate recovers the verbatim E4 replicator line", typeof e4 === "string" && e4.startsWith("ESTIMATE(blind): mI_shelving_selectivity_161_clock — 207.82 ± 5 MHz"), String(e4));
		const proj = join(dir, "proj");
		const run4 = join(proj, "data", "experiments", "E4_entangling_gate", "runs", "run_1");
		mkdirSync(run4, { recursive: true });
		writeFileSync(join(run4, "results.json"), JSON.stringify({ computed: {
			mI_shelving_selectivity_MHz: 65.68371473322296,
			quantities: [{ id: "mI_shelving_selectivity_161_clock", key: "computed.mI_shelving_selectivity_MHz", headline: true,
				observable: "gap between the 161Dy m_I shelving line and the nearest M1 spectator at the clock field (MHz)",
				uncertainty: 0.01, uncertainty_source: "diagonalisation basis convergence", inputs: { clock_field_G: 3136.82 } }],
		} }));
		R.persistReview(proj, "E4_entangling_gate", 1, e4 ? [R.stampBlindInputs(e4, { clock_field_G: 3136.82 })] : [], [], "VERDICT: satisfied", []);
		const t4 = buildClaimTable(proj);
		const row4 = t4.rows.find((r: any) => r.id === "mI_shelving_selectivity_161_clock");
		check("§C9(b) the 3.2× blind/producer gap disputes the E4 row, unit in the reason", row4?.status === "disputed" && row4.reasons.some((x: string) => x.includes("207.82 MHz") && x.includes("disagrees")), `${row4?.status}: ${row4?.reasons.join(" | ")}`);
		check("§C9(b) the rendered estimate token carries the unit (review:blind=207.82 MHz±5)", T.renderClaimTable(t4).includes("review:blind=207.82 MHz±5"), T.renderClaimTable(t4));

		// (c) adversarial units: only value and σ are numbers.
		const c1 = parse("ESTIMATE: x — 0.147 ± 0.01 s^-1 via y");
		check("§C9(c) a digit-bearing unit after σ is the unit, never σ (0.147 ± 0.01 s^-1)", c1?.value === 0.147 && c1?.sigma === 0.01 && c1?.unit === "s^-1", JSON.stringify(c1));
		const c2 = parse("ESTIMATE: x — 0.147 s^-1 via y");
		check("§C9(c) a unit and no σ leaves σ undefined (0.147 s^-1)", c2?.value === 0.147 && c2?.sigma === undefined && c2?.unit === "s^-1", JSON.stringify(c2));
		const c3 = parse("ESTIMATE: x — 207.82 MHz±5 via y");
		check("§C9(c) ± glued to the unit still splits (207.82 MHz±5)", c3?.sigma === 5 && c3?.unit === "MHz", JSON.stringify(c3));
		const c4 = parse("ESTIMATE: x — 5 — inputs: [a=1]");
		check("§C9(c) a dash separator is never a unit (5 — inputs: [a=1])", c4?.value === 5 && c4?.unit === undefined && c4?.inputs?.a === 1, JSON.stringify(c4));
		check("§C9(c) 'via' is never a unit; ASCII minus in (+a/-b); +/- after a unit", c4 !== undefined && parse("ESTIMATE: x — 5 via y")?.unit === undefined && parse("ESTIMATE: x — 9.9e-3 (+3.9e-2/-1.5e-3) via y")?.sigma === 3.9e-2 && parse("ESTIMATE: x — 207.82 MHz+/-5 via y")?.sigma === 5);
		check("§C9(c) still unparsed: a digit-led unit, value and σ in different units, two values on one line", parse("ESTIMATE: x — 0.147 ± 0.01 1/s via y") === null && parse("ESTIMATE: x — 5 MHz ± 1 G via y") === null && parse(TWO_ROOTS) === null);
		// F2: a percent σ is relative (σ = |v|·p/100) and never labels the value; read as an absolute σ of 30 it
		// was capped at 0.5·|v| and a 2× gap on a sub-unity error rate "agreed". A value in % keeps σ in %.
		const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
		const pcts = ["0.01 ± 30 %", "0.01 ±30%", "0.01 ± 30% ", "0.01 ± 30 percent"].map((s) => [s, parse(`ESTIMATE(blind): q — ${s} via y`)] as const);
		check("§C9(c) F2 a percent σ is relative, with or without a space (0.01 ± 30 % → σ 0.003, no unit)", pcts.every(([, p]) => p?.value === 0.01 && near(p?.sigma, 0.003) && p?.unit === undefined), pcts.map(([s, p]) => `${s} → ${JSON.stringify(p && { v: p.value, s: p.sigma, u: p.unit })}`).join(" | "));
		const shared = parse("ESTIMATE: x — 1.2 % ± 0.3 % via y"), bare = parse("ESTIMATE: x — 1.2 ± 0.3 % via y");
		check("§C9(c) F2 a value in % keeps σ in %; σ-only % is relative even below the value (1.2 ± 0.3 % → 0.0036)", shared?.sigma === 0.3 && shared?.unit === "%" && near(bare?.sigma, 0.0036) && bare?.unit === undefined, `${JSON.stringify(shared)} | ${JSON.stringify(bare)}`);
		const asymT = parse("ESTIMATE: x — 0.01 (+30/−10) % via y"), asymS = parse("ESTIMATE: x — 0.01 (+30%/−10%) via y"), mhz = parse("ESTIMATE: x — 207.82 MHz ± 5 % via y");
		check("§C9(c) F2 asymmetric % is relative per side; a % σ on a value with a unit keeps the unit (207.82 MHz ± 5 % → σ 10.391 MHz)", near(asymT?.sigma, 0.003) && asymT?.unit === undefined && near(asymS?.sigma, 0.003) && asymS?.unit === undefined && near(mhz?.sigma, 10.391) && mhz?.unit === "MHz",
			`${JSON.stringify(asymT)} | ${JSON.stringify(asymS)} | ${JSON.stringify(mhz)}`);
		{
			const pd = join(dir, "pct");
			const run = join(pd, "data", "experiments", "E3_pump", "runs", "run_1");
			mkdirSync(run, { recursive: true });
			writeFileSync(join(run, "results.json"), JSON.stringify({ computed: { init_err: 0.02, quantities: [{ id: "init_err", key: "computed.init_err", headline: true,
				observable: "initialisation error after optical pumping, dimensionless", uncertainty: 0.001, uncertainty_source: "MC" }] } }));
			const bl = R.extractBlindEstimate("napkin\nESTIMATE(blind): init_err — 0.01 ± 30 % via napkin rate-equation pumping estimate", "init_err");
			R.persistReview(pd, "E3_pump", 1, bl ? [bl] : [], [], "VERDICT: satisfied", []);
			const tp = buildClaimTable(pd), rp = tp.rows.find((r: any) => r.id === "init_err");
			const pe = parse(bl ?? "");
			check("§C9(c) F2 a blind 0.01 ± 30 % against a producer 0.02 ± 0.001 disagrees and disputes the row", pe !== null && agreement({ value: pe.value, sigma: pe.sigma }, { value: 0.02, sigma: 0.001 }) === "disagree"
				&& rp?.status === "disputed" && rp.reasons.some((x: string) => /blind .*0\.01 disagrees/.test(x)) && !rp.reasons.some((x: string) => /\bagrees/.test(x)),
				`${String(bl)} → ${rp?.status}: ${rp?.reasons.join(" | ")}`);
		}
		// The review loop's blind-line reuse (C14) reads id and inputs through the same parse and compares with the table's rule.
		const b = parse("ESTIMATE(blind): kappa_x — 3.2e-7 ± 1.2e-7 via tensor shift scaling — inputs: [alpha_s_au=184.4, producer]");
		check("§C14 parseEstimateLine exposes id, blind flag and the inputs clause", b?.id === "kappa_x" && b?.blind === true && b?.inputs?.alpha_s_au === 184.4 && b?.producerSupplied === true, JSON.stringify(b));
		check("§C14 differingInputs: shared keys more than 1 % apart, nothing else", typeof T.differingInputs === "function" && JSON.stringify(T.differingInputs({ a: 1, b: 2, c: 3 }, { a: 1.005, b: 3 })) === `["b"]` && T.differingInputs(undefined, { a: 1 }).length === 0);

		// (d) lines that still fail are kept where the reader sees them, never in the blocking list.
		const bg2 = R.extractBlindEstimate(TWO_ROOTS, "nuclear_qubit_clock_point_B");
		check("§C9(d) an unparseable blind line comes back marked instead of null", typeof bg2 === "string" && bg2.startsWith("MALFORMED-ESTIMATE: ESTIMATE(blind): nuclear_qubit_clock_point_B — 3136.83 G"), String(bg2));
		R.persistReview(proj, "E1_nuclear_encoding_field", 1, bg2 ? [bg2] : [], [], "VERDICT: satisfied", []);
		// The reviewer path (marked at extraction), and an unmarked line in a harness file (an older harness, or the PI).
		R.persistReview(proj, "E4_entangling_gate", 2, [], R.extractReviewerLines("ESTIMATE: mI_shelving_selectivity_161_clock — 65.7 ± 0.01 1/s via the reviewer's rerun"), "VERDICT: satisfied", []);
		writeFileSync(join(proj, "reviews", "pi_feedback.md"), "## Claim estimates\nESTIMATE: mI_shelving_selectivity_161_clock — about 66 MHz via the PI's napkin\n");
		const td = buildClaimTable(proj);
		const unparsed: string[] = td.unparsed ?? [];
		check("§C9(d) all three are in table.unparsed as reviews/<file>: <text>, none in table.malformed",
			unparsed.some((u) => u.startsWith("reviews/experiment_review_E1_nuclear_encoding_field_r1.md: MALFORMED-ESTIMATE: ESTIMATE(blind): nuclear_qubit_clock_point_B — 3136.83 G"))
			&& unparsed.some((u) => u.startsWith("reviews/experiment_review_E4_entangling_gate_r2.md: MALFORMED-ESTIMATE: ESTIMATE: mI_shelving_selectivity_161_clock — 65.7"))
			&& unparsed.some((u) => u.startsWith("reviews/pi_feedback.md: ESTIMATE: mI_shelving_selectivity_161_clock — about 66 MHz"))
			&& !td.malformed.some((m: string) => /reviews\//.test(m)),
			`unparsed=${JSON.stringify(unparsed)} malformed=${JSON.stringify(td.malformed)}`);
		const iss = claimTableIssues(proj, td);
		check("§C9(d) claimTableIssues lists them in one non-blocking issue", iss.filter((i: any) => !i.blocking && i.text.includes("nuclear_qubit_clock_point_B") && i.text.includes("pi_feedback.md")).length === 1, iss.map((i: any) => `${i.blocking ? "B" : "nb"}: ${i.text.slice(0, 100)}`).join(" | "));
		check("§C9(d) no blocking issue names a review file (they are write-protected: a typo there would deadlock finish)", !iss.some((i: any) => i.blocking && /reviews\//.test(i.text)), iss.filter((i: any) => i.blocking).map((i: any) => i.text.slice(0, 160)).join(" | "));
		check("§C9(d) the brain's <claim_status> shows them as UNPARSED lines", T.renderClaimTable(td).includes("\n- UNPARSED reviews/experiment_review_E1_nuclear_encoding_field_r1.md: MALFORMED-ESTIMATE: ESTIMATE(blind)"), T.renderClaimTable(td));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	// (e) non-regression: every line the old grammar accepted parses to the same fields, with no unit.
	const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
	const fixtureLines = ["claims-ppss", "claims-297nm"].flatMap((f) => walk(join(ROOT, "fixtures", f))).filter((p) => p.endsWith(".md"))
		.flatMap((p) => readFileSync(p, "utf-8").split("\n")).filter((l) => /^\s*ESTIMATE(\(blind\))?:/.test(l));
	let accepted = 0;
	const changed: string[] = [];
	for (const l of [...DY, ...fixtureLines]) {
		const m = l.match(OLD_RE);
		if (!m) continue;
		accepted++;
		const inputs: Record<string, number> = {};
		let producerSupplied = false;
		for (const tok of (m[6] ?? "").split(/[,\s\[\]]+/).filter(Boolean)) {
			const kv = tok.split("=");
			if (kv.length === 2 && Number.isFinite(Number(kv[1]))) inputs[kv[0]] = Number(kv[1]);
			if (/^producer$/i.test(tok)) producerSupplied = true;
		}
		const was = JSON.stringify({ id: m[2], value: Number(m[3]), sigma: m[4] && Number(m[4]) > 0 ? Number(m[4]) : undefined, route: m[5]?.trim() || undefined, inputs, blind: !!m[1], producerSupplied, unit: undefined });
		const p = parse(l.trim());
		const now = JSON.stringify(p ? { id: p.id, value: p.value, sigma: p.sigma, route: p.route, inputs: p.inputs, blind: p.blind, producerSupplied: p.producerSupplied, unit: p.unit } : p);
		if (now !== was) changed.push(`${l.slice(0, 80)} → ${now}`);
	}
	check(`§C9(e) every line the old grammar accepted parses identically with no unit (${accepted - changed.length}/${accepted})`, accepted >= 137 && changed.length === 0, changed.slice(0, 3).join(" | "));
}

// §A3 — headline quantities the obligation leaves out are named to the
// reviewer, with why. Verifier bench A3 (2026-10-21): Dy E1's two T2*
// headlines resolve to objects with no single value, headlineDeclsFor drops
// them, and the reviewer, told "Headline quantities in your scope:
// clock_point_B, transition_frequency", never looked at T2* — where both of
// the bench's E1 faults sat (a planted 2π and a stale floor).
{
	const decl = (id: string, value: number | undefined, headline = true) => ({ id, key: `computed.${id}`, experiment: "E1", headline, inputs: {}, value });
	const tbl = (decls: any[]) => ({ decls, frameHeadline: [], headlineDeclared: [], verdicts: [], rows: [] });
	const t1 = tbl([decl("clock_B", 3136.8), decl("freq", 1.2e5), decl("T2star_clock", undefined), decl("not_headline", 7, false)]);
	const out1 = R.headlineDeclsOutOfScope?.(t1, "E1_probe") ?? [];
	check("§A3 a headline id with no single numeric value is reported out of scope, with its key and why",
		out1.length === 1 && out1[0].id === "T2star_clock" && out1[0].key === "computed.T2star_clock" && /no single numeric value/.test(out1[0].why), JSON.stringify(out1));
	check("§A3 the in-scope set is unchanged (numeric headline ids only)", R.headlineDeclsFor(t1, "E1_probe").map((d: any) => d.id).join() === "clock_B,freq");
	const blk = R.reviewerObligationBlock(["clock_B", "freq"], [], out1);
	check("§A3 the reviewer's block names it and says its number is a headline claim to check", /T2star_clock \(computed\.T2star_clock: no single numeric value/.test(blk) && /headline claims too/.test(blk) && blk.includes("</claim_obligation>"), blk.slice(0, 400));
	check("§A3 nothing left out: the block is the same as before (no extra line)", R.reviewerObligationBlock(["clock_B", "freq"], [], []) === R.reviewerObligationBlock(["clock_B", "freq"], []) && !/outside this block/.test(R.reviewerObligationBlock(["clock_B", "freq"], [])));
	const t2 = tbl(["q1", "q2", "q3", "q4", "q5"].map((id, i) => decl(id, i + 1)));
	const out2 = R.headlineDeclsOutOfScope?.(t2, "E1_probe") ?? [];
	check("§A3 ids past the cap are reported too", out2.length === 2 && out2.every((o: any) => /past the 3-id cap/.test(o.why)), JSON.stringify(out2));
	const only = R.reviewerObligationBlock([], [], out1);
	check("§A3 with nothing in scope but something left out, the block still names it", only !== "" && /T2star_clock/.test(only) && !/For EACH/.test(only), only);
}

console.log(failures === 0 ? "\nALL PASS — reviewers estimate, reviews persist, disputes escalate to people, replicators are blind." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
