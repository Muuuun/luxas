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
	check("string uncertainty → MALFORMED (not Number()-coerced)", t2.malformed.some((m: string) => /uncertainty must be a positive number/.test(m)), t2.malformed.join(" | "));
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

// §C38 fallback (F3): a blind-estimate flag is answered only by another
// experiment's own estimate of the id. A replicate-mode replication that
// agrees with the producer leaves the row DISPUTED (Dy rf_gate / κ532 /
// scattering_1064), so every text that offers the replicator for such a row
// must say it does not settle a blind flag. The first check pins the code
// side: when a replication can answer a blind flag (C38 proper), it goes red
// and the texts change in the same diff.
{
	const { cosmeticSpawnNotice } = await import(join(ROOT, "src/claims-review.js"));
	const dir = mkdtempSync(join(tmpdir(), "luxas-c38-"));
	const Q = "rf_gate_error";
	const exp = join(dir, "data/experiments/E3_control");
	mkdirSync(join(exp, "runs/run_1"), { recursive: true });
	mkdirSync(join(exp, "replication"), { recursive: true });
	mkdirSync(join(dir, "notes"), { recursive: true });
	mkdirSync(join(dir, "reviews"), { recursive: true });
	mkdirSync(join(dir, "report"), { recursive: true });
	writeFileSync(join(dir, "notes/frame.md"), `# F\n\n## Headline quantities\n- \`${Q}\`\n`);
	writeFileSync(join(exp, "runs/run_1/results.json"), JSON.stringify({ computed: { rf: { err: 4.363e-7 }, quantities: [{ id: Q, key: "computed.rf.err", headline: true, observable: "RF gate error at the clock point", uncertainty: 1.8e-8, inputs: {} }] } }));
	writeFileSync(join(exp, "replication/results.json"), JSON.stringify({ quantity: Q, value: 4.4e-7, sigma: 3e-8, route: "Floquet propagator on the full Zeeman-hyperfine manifold", script: "replication/rf_floquet.py", job_id: "job_0a1b2c3d4e", inputs: {} }));
	writeFileSync(join(dir, "reviews/experiment_review_E3_control_r1.md"), `# r\nESTIMATE(blind): ${Q} — 1.7e-6 ± 3e-7 via Landau-Zener leakage of the Blackman pulse\nDISCRIMINATOR: ${Q} — if right: a; if wrong: b; computation: c\nREVIEW-COMPLETE\nVERDICT: satisfied\n`);
	writeFileSync(join(dir, "report/claims.json"), JSON.stringify([
		{ quantity_id: Q, value: 4.363e-7, tex_context: "RF gate error 4.4e-7 at the clock point" },
		{ claim_key: "computed.rf.err_v2", value: 4.363e-7, tex_context: "the same gate error under another key" },
	]));
	try {
		const tc = buildClaimTable(dir);
		const row = tc.rows.find((x: any) => x.id === Q);
		const blindOpen = (row?.reasons ?? []).some((x: string) => /^(blind reviewer estimate|sign convention: blind estimate).*\(unanswered\)$/.test(x));
		check("§C38 an agreeing route+job replication leaves a blind-flag row DISPUTED, flag unanswered", row?.status === "disputed" && blindOpen && (row?.reasons ?? []).some((x: string) => /^agree: .*replication/.test(x)), `${row?.status}: ${row?.reasons?.join(" | ")}`);
		const texts: [string, string][] = claimTableIssues(dir, tc).filter((i: any) => i.blocking && i.text.includes(Q) && !i.text.startsWith("[abstain]")).map((i: any) => [`claims.json "${i.text.match(/^"([^"]*)"/)?.[1] ?? "?"}"`, i.text]);
		check("§C38 both claims.json entries (by id, and the re-keyed value) block on the row", texts.length === 2, texts.map(([l]) => l).join(" | "));
		const notice = cosmeticSpawnNotice(dir, "illustrator").notice;
		check("§C38 the cosmetic notice outside finalization carries the legal moves", /\bLegal moves: /.test(notice), notice.slice(0, 200));
		texts.push(["cosmetic notice", notice]);
		mkdirSync(join(dir, ".agent"), { recursive: true });
		writeFileSync(join(dir, ".agent/run_config.json"), JSON.stringify({ maxCost: 100 }));
		writeFileSync(join(dir, ".agent/usage.log"), "1788000000000\tm\tp\t1\t1\t0\t0\t95\n");
		const late = cosmeticSpawnNotice(dir, "illustrator").notice;
		check("§C38 the cosmetic notice past the soft cap carries the finalization moves", /Legal moves in finalization/.test(late), late.slice(0, 200));
		texts.push(["cosmetic notice (finalization)", late]);
		for (const [label, text] of texts) {
			if (/replicator/i.test(text)) check(`§C38 ${label}: offers the replicator only as not settling a blind-estimate flag`, /(?:never|not) a blind-estimate flag/.test(text), text.slice(text.search(/Legal moves/), text.search(/Legal moves/) + 400));
			if (/Legal moves: /.test(text)) check(`§C38 ${label}: names an experiment declaring the same quantity id as what answers a blind flag`, /experiment.{0,120}same quantity id.{0,60}blind-estimate flag/.test(text), text.slice(text.search(/Legal moves/), text.search(/Legal moves/) + 400));
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log(failures === 0 ? "\nALL PASS — the E5 number is disputed, its abstract is blocked, and nothing self-clears." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
