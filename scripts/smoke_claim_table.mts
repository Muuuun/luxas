/**
 * Smoke test: the claim table (src/claims-table.ts) on the retrofit fixture —
 * the frozen single_photon_297nm project with hand-written quantities[] /
 * verdicts[] (fixtures/claims-297nm/retrofit, built by
 * fixtures/claims-297nm/build_retrofit.py). The expected table is hand-derived
 * (expected.json); this gate is the acceptance test of the claims-first
 * design (notes/design-claims-first.md §7.2).
 *
 * Run:  npx tsx scripts/smoke_claim_table.mts
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIX = join(ROOT, "fixtures", "claims-297nm", "retrofit");
const { buildClaimTable, claimTableIssues, renderClaimTable } = await import(join(ROOT, "src/claims-table.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf-8"));
const t = buildClaimTable(FIX);
check("declarations found", t.declared === true);
check("no MALFORMED rows on the clean fixture", t.malformed.length === 0, t.malformed.join(" | "));
for (const [id, st] of Object.entries(expected.rows)) {
	const row = t.rows.find((r: any) => r.id === id);
	check(`${id} → ${st}`, row?.status === st, `got ${row?.status}; reasons: ${row?.reasons?.join(" | ")}`);
}
for (const [id, st] of Object.entries(expected.verdicts)) {
	const v = t.verdicts.find((v: any) => v.id === id);
	check(`verdict ${id} → ${st}`, v?.status === st, `got ${v?.status}`);
}
check("headline set = frame ∪ headline:true ∪ verdict reads ∪ propagation", JSON.stringify(t.headline) === JSON.stringify(expected.headline), JSON.stringify(t.headline));
check("reads-diff: E6 dropped decay_40MHz_closedform from ordering_f40_vs_f10", t.readsDrops.length === expected.readsDrops && /decay_40MHz_closedform/.test(t.readsDrops[0] ?? ""), t.readsDrops.join(" | "));

// Mechanism-level assertions on the E5 case (architecture-review §1).
const leak = t.rows.find((r: any) => r.id === "blockade_leakage_40MHz");
check("E4 vs E5 leakage are INCOMPARABLE (different V) and the dispute propagated upstream", leak.reasons.some((x: string) => /incomparable/.test(x)) && leak.reasons.some((x: string) => /propagated to blockade_shift_4um_GHz/.test(x)), leak.reasons.join(" | "));
check("blind reviewer estimate (1.7e-2) disputes E5's 2.555e-4", leak.reasons.some((x: string) => /blind reviewer estimate/.test(x)));
check("scaling exponent 4.03 vs 2 disputes it independently", leak.reasons.some((x: string) => /scaling: observed exponent 4.03/.test(x)));
// §C76: ANCHOR-OK is gone. It changed no status once `corroborated` was
// removed, and its nag ("limit_check present but not attested") was the
// rendered last reason of disputed rows, hiding why they were disputed. A
// stray ANCHOR-OK line is ignored; the render and the claims.json block show
// the reason that decided the status.
{
	const { reviewerObligationBlock, extractReviewerLines } = await import(join(ROOT, "src/claims-review.js"));
	const dc = mkdtempSync(join(tmpdir(), "luxas-c76-"));
	try {
		cpSync(FIX, dc, { recursive: true });
		const p = join(dc, "reviews/experiment_review_E5_blockade_floor_master_equation_r1.md");
		writeFileSync(p, readFileSync(p, "utf-8") + "\nANCHOR-OK: blockade_leakage_40MHz — V -> 10 GHz limit reproduced\n");
		const b = buildClaimTable(dc).rows.find((x: any) => x.id === "blockade_leakage_40MHz");
		check("§C76 an ANCHOR-OK line changes nothing in blockade_leakage_40MHz (reasons, status)", JSON.stringify(b) === JSON.stringify(leak), `${leak.reasons.at(-1)} | ${b?.reasons?.at(-1)}`);
	} finally {
		rmSync(dc, { recursive: true, force: true });
	}
	check("§C76 the reviewer obligation block no longer offers ANCHOR-OK", !/ANCHOR-OK/.test(reviewerObligationBlock(["x"], [])));
	check("§C76 an ANCHOR-OK line in a reviewer's return is not extracted (never persisted)", extractReviewerLines("ANCHOR-OK: x — limit reproduced").length === 0);
	const lines = renderClaimTable(t).split("\n");
	const shown = (id: string) => { const i = lines.findIndex((l: string) => l.startsWith(`- ${id} `)); return i < 0 ? "" : (lines[i + 1] ?? "").trim(); };
	check("§C76 disputed blockade_leakage_40MHz renders why it is disputed (blind or scaling), not a limit_check note", /blind reviewer estimate|scaling: observed exponent/.test(shown("blockade_leakage_40MHz")), shown("blockade_leakage_40MHz"));
	check("§C76 disputed blockade_shift_4um_GHz renders the disagreement, not its σ note", /^disagree:/.test(shown("blockade_shift_4um_GHz")), shown("blockade_shift_4um_GHz"));
	const f40 = claimTableIssues(FIX, t).find((i: any) => /cites fidelity_40MHz whose status/.test(i.text));
	check("§C76 the claims.json block cites the cause of conditional fidelity_40MHz", /whose status is conditional \(conditional on blockade_leakage_40MHz\)/.test(f40?.text ?? ""), f40?.text?.slice(0, 200));
}
const shift = t.rows.find((r: any) => r.id === "blockade_shift_4um_GHz");
check("blockade_shift: full diag vs perturbative disagree (missing σ, 5.6×)", shift.reasons.some((x: string) => /disagree:/.test(x)), shift.reasons.join(" | "));
const rabi = t.rows.find((r: any) => r.id === "rabi_38P_khz");
check("rabi_38P: anchored literature estimate with σ is recorded in reasons (status no longer keys off it — corroborated removed 2026-09-04)", rabi.reasons.some((x: string) => /\(anchored\)/.test(x)));
const f10 = t.rows.find((r: any) => r.id === "fidelity_10MHz");
check("E3 and E4 fidelity_10MHz are wiring (identical value)", f10.reasons.some((x: string) => /^wiring:/.test(x)), f10.reasons.join(" | "));

// Gate issues.
const issues = claimTableIssues(FIX, t);
check("reads-drop is a blocking issue", issues.some((i: any) => i.blocking && /reads-diff/.test(i.text)));
check("abstract entry citing conditional fidelity_40MHz blocks with the three legal moves", issues.some((i: any) => i.blocking && /fidelity_40MHz/.test(i.text) && /countersigned disclosure/.test(i.text)));
check("abstract entry citing a declared non-headline quantity blocks (set never widens silently)", issues.some((i: any) => i.blocking && /outside the headline set/.test(i.text)));

// Render.
const r = renderClaimTable(t);
check("render opens with <claim_status> and reports the abstract as blocked", /^<claim_status>/.test(r) && /abstract blocked/.test(r), r.slice(0, 200));
check("render carries the READS-DROP line", /READS-DROP/.test(r));
check("render is deterministic over equal state", r === renderClaimTable(buildClaimTable(FIX)));

// MALFORMED: a string uncertainty must be complained about, not coerced or skipped.
const d = mkdtempSync(join(tmpdir(), "luxas-ct-"));
try {
	cpSync(FIX, d, { recursive: true });
	const p = join(d, "data/experiments/E5_blockade_floor_master_equation/runs/run_1/results.json");
	const j = JSON.parse(readFileSync(p, "utf-8"));
	j.computed.quantities[2].uncertainty = "0.001";
	j.computed.quantities[0].inputs = { forster_defect_GHz: "0.185" };
	writeFileSync(p, JSON.stringify(j));
	const t2 = buildClaimTable(d);
	check("string uncertainty → MALFORMED (not Number()-coerced)", t2.malformed.some((m: string) => /uncertainty must be a number ≥ 0/.test(m)), t2.malformed.join(" | "));
	check("string input value → MALFORMED (values, not ids)", t2.malformed.some((m: string) => /inputs\.forster_defect_GHz must be a number/.test(m)));
	check("MALFORMED rows are a blocking gate issue", claimTableIssues(d, t2).some((i: any) => i.blocking && /Malformed quantity declarations/.test(i.text)));
	check("MALFORMED rows render (never silently skipped)", /MALFORMED/.test(renderClaimTable(t2)));
} finally {
	rmSync(d, { recursive: true, force: true });
}

// §C41: INDEPENDENT is a closed form. Two agreeing headline estimates
// (E3 24.65 vs E4 24.5, σ 0.35) converge only on a line answering exactly
// "shared: none"; Dy E4 r1's denial ("these are not independent") used to
// lift the pair because any INDEPENDENT prefix attested. Every other answer
// is recorded, never malformed (malformed blocks finish).
function c41Project(indepLine: string): string {
	const dir = mkdtempSync(join(tmpdir(), "luxas-c41-"));
	mkdirSync(join(dir, "notes"), { recursive: true });
	writeFileSync(join(dir, "notes", "frame.md"), "# F\n\n## Headline quantities\n- `zero_angle`\n");
	for (const [exp, v] of [["E3_a", 24.65], ["E4_b", 24.5]] as const) {
		const base = join(dir, "data", "experiments", exp, "runs", "run_1");
		mkdirSync(base, { recursive: true });
		writeFileSync(join(base, "results.json"), JSON.stringify({ computed: { quantities: [{ id: "zero_angle", key: "computed.zero_angle", headline: true, observable: "angle where total C6 crosses zero, degrees", uncertainty: 0.35, inputs: {} }], zero_angle: v } }));
	}
	mkdirSync(join(dir, "reviews"), { recursive: true });
	writeFileSync(join(dir, "reviews", "experiment_review_E4_b_r1.md"), `# r\nDISCRIMINATOR: zero_angle — if right: a; if wrong: b; computation: c\n${indepLine}\nREVIEW-COMPLETE\nVERDICT: satisfied\n`);
	return dir;
}
const c41Cases: [string, string, boolean][] = [
	["denial in open prose", "INDEPENDENT: zero_angle E3:own vs E4:own — these are not independent: method_b reuses five of the six solver channel values", false],
	["shared: model", "INDEPENDENT: zero_angle E3:own vs E4:own — shared: model — same Hamiltonian, separate code", false],
	["shared: none of the code", "INDEPENDENT: zero_angle E3:own vs E4:own — shared: none of the code", false],
	["shared: code", "INDEPENDENT: zero_angle E3:own vs E4:own — shared: code", false],
	["shared: none, closed form", "INDEPENDENT: zero_angle E3:own vs E4:own — shared: none — differ in formulation, integrator and truncation", true],
];
for (const [name, line, converges] of c41Cases) {
	const dir = c41Project(line);
	try {
		const tc = buildClaimTable(dir);
		const row = tc.rows.find((x: any) => x.id === "zero_angle");
		check(`§C41 ${name} → ${converges ? "converging" : "not converging"}`, (row?.status === "converging") === converges, `got ${row?.status}; reasons: ${row?.reasons?.join(" | ")}`);
		check(`§C41 ${name}: no malformed`, tc.malformed.length === 0, tc.malformed.join(" | "));
		if (name === "denial in open prose") check("§C41 the unattested reason says the line does not answer \"shared: none\"", row?.reasons?.some((x: string) => /does not answer "shared: none"/.test(x)) === true, row?.reasons?.join(" | "));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// §C10: a cross_validation entry estimates its claim_key's quantity only for
// the same instance. Dy E1 filed three other clock-point roots (value_a
// 19797.5 / 24866.8 / 48119.6) under the key of the 3136.82 G root; their
// value_b disputed clock_B and made everything reading it conditional. The
// instance test is value_a against the own value (1 %, or within own σ);
// an entry without value_a is legacy and still counts.
{
	const { quantityDeclarationProblems } = await import(join(ROOT, "src/claims-review.js"));
	const dir = mkdtempSync(join(tmpdir(), "luxas-c10-"));
	const write = (eid: string, j: unknown) => { const p = join(dir, "data/experiments", eid, "runs/run_1"); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "results.json"), JSON.stringify(j)); };
	const K = "computed.clock_points.B";
	const otherRoot = (a: number, b: number) => ({ claim_key: K, method_a: "numeric df/dB root", method_b: "sympy analytic df/dB=0", value_a: a, value_b: b, tolerance_rel: 0.1 });
	write("E1_field", { computed: {
		clock_points: { B: 3136.82 }, same: { x: 1.0 }, sig: { y: 100 }, nova: { z: 2.0 },
		quantities: [
			{ id: "clock_B", key: K, headline: true, uncertainty: 0.31, observable: "clock field (G)" },
			{ id: "same_inst", key: "computed.same.x", headline: true, uncertainty: 0.01, observable: "x" },
			{ id: "sigma_inst", key: "computed.sig.y", headline: true, uncertainty: 5, observable: "y" },
			{ id: "no_va", key: "computed.nova.z", headline: true, uncertainty: 0.02, observable: "z" },
		],
		cross_validation: [
			{ claim_key: K, method_a: "brentq df/dB root, 5 G stencil", method_b: "dy_clock_uncertainty nominal root", value_a: 3136.8188, value_b: 3136.8088, tolerance_rel: 0.001 },
			otherRoot(19797.5, 20303.1), otherRoot(24866.8, 25964.3), otherRoot(48119.6, 48783.0),
			{ claim_key: "computed.same.x", method_a: "full diagonalization", method_b: "perturbation theory", value_a: 1.0, value_b: 3.0, sigma_b: 0.05, tolerance_rel: 0.1 },
			{ claim_key: "computed.sig.y", method_a: "full diagonalization", method_b: "perturbation theory", value_a: 103, value_b: 300, sigma_b: 10, tolerance_rel: 0.5 },
			{ claim_key: "computed.nova.z", method_a: "full diagonalization", method_b: "perturbation theory", value_b: 6.0, sigma_b: 0.1, tolerance_rel: 0.1 },
		],
	} });
	write("E2_dep", { computed: { a: 1, b: 2, c: 3, quantities: ["a", "b", "c"].map((k) => ({ id: `dep_${k}`, key: `computed.${k}`, headline: true, uncertainty: 0.1, observable: k, inputs: { clock_B: 3136.82 } })) } });
	try {
		const tc = buildClaimTable(dir);
		const row = (id: string) => tc.rows.find((r: any) => r.id === id);
		const cb = row("clock_B");
		const inst = (cb?.reasons ?? []).filter((x: string) => /^different instance: /.test(x));
		check("§C10 other-root xval entries (value_a 19797.5/24866.8/48119.6) do not dispute clock_B", cb?.status !== "disputed", `${cb?.status}: ${cb?.reasons?.join(" | ")}`);
		check("§C10 clock_B keeps the same-instance xval leg (value_a 3136.8188)", cb?.estimates?.some((e: any) => e.kind === "xval" && e.value === 3136.8088) === true);
		check("§C10 clock_B carries 3 'different instance' reasons, first in the row", inst.length === 3 && (cb?.reasons ?? []).slice(0, 3).every((x: string) => inst.includes(x)), cb?.reasons?.join(" | "));
		for (const k of ["a", "b", "c"]) check(`§C10 dep_${k} (reads clock_B) is not conditional`, row(`dep_${k}`)?.status !== "conditional", `${row(`dep_${k}`)?.status}: ${row(`dep_${k}`)?.reasons?.join(" | ")}`);
		const probs: string[] = quantityDeclarationProblems(dir, "E1_field");
		check("§C10 write-time hint: each other instance goes under its own computed.* key", probs.filter((p) => /^different instance: E1:xval:.*its own computed\.\* key/.test(p)).length === 3, probs.join(" | "));
		check("§C10 same-instance 3x disagreement (value_a = own) is still disputed", row("same_inst")?.status === "disputed", row("same_inst")?.status);
		check("§C10 value_a within own σ but >1% (103 vs 100±5) still counts: disputed by value_b 300", row("sigma_inst")?.status === "disputed", row("sigma_inst")?.status);
		check("§C10 entry without value_a still counts (legacy): disputed by value_b 6.0", row("no_va")?.status === "disputed", row("no_va")?.status);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// §C38 (2026-10-22, step 0): a blind-estimate flag is answered by an
// independent computation that agrees with the producer — an own estimate from
// another experiment, or a computing replication (route + job) on a route other
// than the producer's. blender-02 run 2 (2026-10-21) re-ran E1 four times
// against such flags: a re-run never answers (only the latest run is read), and
// the replications that would have were refused by the rule and overwrote each
// other in one shared file. What must still dispute: a replication on the
// producer's own route, one with no job, one that sides with the blind line,
// and everything under LUXAS_REPLICATION_ANSWERS_BLIND=0. Every legal-move text
// says what answers, from one function (blindFlagAnswerText).
{
	const { cosmeticSpawnNotice } = await import(join(ROOT, "src/claims-review.js"));
	const { finalizationDenyText } = await import(join(ROOT, "src/hooks.js"));
	const Q = "rf_gate_error", Q2 = "rf_gate_time";
	const ROUTE = "Floquet propagator on the full Zeeman-hyperfine manifold";
	const BLIND = `ESTIMATE(blind): ${Q} — 1.7e-6 ± 3e-7 via Landau-Zener leakage of the Blackman pulse`;
	type Rep = { path: string; json: Record<string, unknown> };
	const rep = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ quantity: Q, value: 4.4e-7, sigma: 3e-8, route: ROUTE, script: "replication/rf_floquet.py", job_id: "job_0a1b2c3d4e", inputs: {}, ...over });
	const dirs: string[] = [];
	const mk = (o: { reps?: Rep[]; sigma?: number | null; producerRoute?: string; blind?: string; claims?: boolean } = {}) => {
		const dir = mkdtempSync(join(tmpdir(), "luxas-c38-"));
		dirs.push(dir);
		const exp = join(dir, "data/experiments/E3_control");
		mkdirSync(join(exp, "runs/run_1"), { recursive: true });
		for (const d of ["notes", "reviews", "report"]) mkdirSync(join(dir, d), { recursive: true });
		writeFileSync(join(dir, "notes/frame.md"), `# F\n\n## Headline quantities\n- \`${Q}\`\n`);
		const q: any = { id: Q, key: "computed.rf.err", headline: true, observable: "RF gate error at the clock point", inputs: {} };
		if (o.sigma !== null) q.uncertainty = o.sigma ?? 1.8e-8;
		const computed: any = { rf: { err: 4.363e-7, time_us: 12.5 }, quantities: [q, { id: Q2, key: "computed.rf.time_us", observable: "RF gate time", uncertainty: 0.1, inputs: {} }] };
		if (o.producerRoute) computed.cross_validation = [{ claim_key: "computed.rf.err", method_a: o.producerRoute, method_b: "control" }];
		writeFileSync(join(exp, "runs/run_1/results.json"), JSON.stringify({ computed }));
		for (const r of o.reps ?? []) { mkdirSync(join(exp, r.path, ".."), { recursive: true }); writeFileSync(join(exp, r.path), JSON.stringify(r.json)); }
		writeFileSync(join(dir, "reviews/experiment_review_E3_control_r1.md"), `# r\n${o.blind ?? BLIND}\nDISCRIMINATOR: ${Q} — if right: a; if wrong: b; computation: c\nREVIEW-COMPLETE\nVERDICT: satisfied\n`);
		if (o.claims) writeFileSync(join(dir, "report/claims.json"), JSON.stringify([{ quantity_id: Q, value: 4.363e-7, tex_context: "RF gate error 4.4e-7 at the clock point" }]));
		return dir;
	};
	const row = (dir: string, id = Q) => buildClaimTable(dir).rows.find((x: any) => x.id === id);
	const says = (r: any) => `${r?.status}: ${r?.reasons?.join(" | ")}`;
	const answered = (r: any) => (r?.reasons ?? []).some((x: string) => /^blind estimate .* answered by .*replication/.test(x));
	const open = (r: any) => (r?.reasons ?? []).some((x: string) => /^blind reviewer estimate .*\(unanswered\)$/.test(x));
	try {
		const legacy = row(mk({ reps: [{ path: "replication/results.json", json: rep() }] }));
		check("§C38 a route+job replication on another route that agrees with the producer answers the blind flag (legacy shared file)", legacy?.status === "converging" && answered(legacy) && !open(legacy), says(legacy));
		const own = mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep() }, { path: `replication/${Q2}/results.json`, json: rep({ quantity: Q2, value: 12.4, sigma: 0.2, script: `replication/${Q2}/t.py` }) }] });
		check("§C38 …and from its own replication/<QID>/results.json", row(own)?.status === "converging" && answered(row(own)), says(row(own)));
		check("§C38 two replications in two directories are two legs, neither overwrites the other", row(own, Q2)?.estimates.some((e: any) => e.kind === "replication" && e.value === 12.4) && row(own)?.estimates.some((e: any) => e.kind === "replication" && e.value === 4.4e-7), says(row(own, Q2)));
		const sameRoute = row(mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep() }], producerRoute: ROUTE }));
		check("§C38 a replication on the producer's own route answers nothing (one leg)", sameRoute?.status === "disputed" && open(sameRoute), says(sameRoute));
		const noJob = row(mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep({ job_id: undefined, script: "rf.py" }) }] }));
		check("§C38 a replication with no job answers nothing (not a computing leg)", noJob?.status === "disputed" && open(noJob), says(noJob));
		const sides = row(mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep({ value: 1.75e-6, sigma: 2e-7 }) }] }));
		check("§C38 a replication that sides with the blind line is a producer dispute, not an answer", sides?.status === "disputed" && (sides?.reasons ?? []).some((x: string) => /^disagree: /.test(x)) && !answered(sides), says(sides));
		process.env.LUXAS_REPLICATION_ANSWERS_BLIND = "0";
		const rolled = row(mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep() }] }));
		check("§C38 LUXAS_REPLICATION_ANSWERS_BLIND=0: the agreeing replication leaves the flag unanswered", rolled?.status === "disputed" && open(rolled), says(rolled));
		const rolledText = cosmeticSpawnNotice(mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep({ value: 1.75e-6, sigma: 2e-7 }) }] }), "illustrator").notice;
		check("§C38 …and the texts say so", /never a blind-estimate flag/.test(rolledText), rolledText.slice(0, 300));
		delete process.env.LUXAS_REPLICATION_ANSWERS_BLIND;
		// σ = 0 is a declaration; a producer with no σ is held to its value; the blind line's σ decides.
		const zeroDir = mk({ sigma: 0, blind: `ESTIMATE(blind): ${Q} — 5e-7 ± 1e-7 via napkin` });
		const zero = buildClaimTable(zeroDir);
		check("§S0 uncertainty 0 is not MALFORMED", zero.malformed.length === 0, zero.malformed.join(" | "));
		check("§S0 a blind line whose own σ covers a σ=0 producer agrees", row(zeroDir)?.status !== "disputed" && (row(zeroDir)?.reasons ?? []).some((x: string) => /^blind estimate .* agrees with/.test(x)), says(row(zeroDir)));
		const noSigma = row(mk({ sigma: null, blind: `ESTIMATE(blind): ${Q} — 3e-7 ± 1e-7 via napkin` }));
		check("§S0 a producer with no σ is held to its value: blind 3e-7 ± 1e-7 covers 4.363e-7, no flag", noSigma?.status !== "disputed" && (noSigma?.reasons ?? []).some((x: string) => /^blind estimate .* agrees with/.test(x)), says(noSigma));
		const noSigmaFar = row(mk({ sigma: null, blind: `ESTIMATE(blind): ${Q} — 3e-7 ± 5e-8 via napkin` }));
		check("§S0 …and one outside the blind line's 2σ still flags", noSigmaFar?.status === "disputed" && open(noSigmaFar), says(noSigmaFar));
		const neg = buildClaimTable(mk({ sigma: -1e-8 }));
		check("§S0 a negative uncertainty is MALFORMED", neg.malformed.some((m: string) => /uncertainty must be a number ≥ 0/.test(m)), neg.malformed.join(" | "));
		// Texts: every one that offers moves for a disputed row says what answers a blind flag.
		const disputedDir = mk({ reps: [{ path: `replication/${Q}/results.json`, json: rep({ value: 1.75e-6, sigma: 2e-7 }) }], claims: true });
		const tc = buildClaimTable(disputedDir);
		const texts: [string, string][] = claimTableIssues(disputedDir, tc).filter((i: any) => i.blocking && i.text.includes(Q) && !i.text.startsWith("[abstain]")).map((i: any) => ["claims.json issue", i.text]);
		check("§C38 the claims.json entry citing the disputed row blocks with the legal moves", texts.length === 1 && /\bLegal moves: /.test(texts[0]?.[1] ?? ""), texts.map(([, t]) => t.slice(0, 120)).join(" | "));
		texts.push(["cosmetic notice", cosmeticSpawnNotice(disputedDir, "illustrator").notice]);
		mkdirSync(join(disputedDir, ".agent"), { recursive: true });
		writeFileSync(join(disputedDir, ".agent/run_config.json"), JSON.stringify({ maxCost: 100 }));
		writeFileSync(join(disputedDir, ".agent/usage.log"), "1788000000000\tm\tp\t1\t1\t0\t0\t95\n");
		const late = cosmeticSpawnNotice(disputedDir, "illustrator").notice;
		check("§C38 the cosmetic notice past the soft cap carries the finalization moves", /Legal moves in finalization/.test(late), late.slice(0, 200));
		texts.push(["cosmetic notice (finalization)", late], ["cost-freeze refusal", finalizationDenyText("spawn_agent", "experiment", true, "cost")]);
		for (const [label, text] of texts) {
			check(`§C38 ${label}: a replicator that agrees with the producer answers a blind-estimate flag`, /replicator \(replicate mode\) on a route other than the producer's[^.]*answers a blind-estimate flag/.test(text), text.slice(Math.max(0, text.search(/replicator/) - 40), text.search(/replicator/) + 300));
			const finalization = /finalization|In what is left/.test(text);
			if (!finalization) check(`${"§C38"} ${label}: a re-run of the same experiment never answers one`, /re-run of the same experiment never does/.test(text), text.slice(text.search(/Legal moves/), text.search(/Legal moves/) + 500));
			else check(`§C38 ${label}: offers no new experiment`, !/experiment under a new experiment id/.test(text), text.slice(0, 300));
		}
	} finally {
		delete process.env.LUXAS_REPLICATION_ANSWERS_BLIND;
		for (const d of dirs) rmSync(d, { recursive: true, force: true });
	}
}

console.log(failures === 0 ? "\nALL PASS — the E5 number is disputed, its abstract is blocked, and nothing self-clears." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
