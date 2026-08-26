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
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
check("zero-expected limit_check without ANCHOR-OK is called out as wiring", leak.reasons.some((x: string) => /zero-expected limit is wiring/.test(x)));
const shift = t.rows.find((r: any) => r.id === "blockade_shift_4um_GHz");
check("blockade_shift: full diag vs perturbative disagree (missing σ, 5.6×)", shift.reasons.some((x: string) => /disagree:/.test(x)), shift.reasons.join(" | "));
const rabi = t.rows.find((r: any) => r.id === "rabi_38P_khz");
check("rabi_38P: corroborated via an anchored literature estimate with σ", rabi.reasons.some((x: string) => /\(anchored\)/.test(x)));
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

console.log(failures === 0 ? "\nALL PASS — the E5 number is disputed, its abstract is blocked, and nothing self-clears." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
