/**
 * smoke_claim_table_colocated — the claim table accepts the co-located form a
 * live producer actually wrote (2026-08-26 probe): quantities[] = bare {id,key},
 * metadata + number under the computed leaf object. Also: actionable hints for
 * object-without-value keys, string limit_checks, and frame-id near-misses.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaimTable } from "../src/claims-table.ts";
import { quantityDeclarationProblems } from "../src/claims-review.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

const dir = mkdtempSync(join(tmpdir(), "claims-colocated-"));
const run = join(dir, "data", "experiments", "E1_c6_theta_60p", "runs", "run_1");
mkdirSync(run, { recursive: true });
mkdirSync(join(dir, "notes"), { recursive: true });
writeFileSync(join(dir, "notes", "frame.md"), "# Frame\n\n## Headline quantities (ship-gate scope; ≤3)\n- `C6_60P_mj32_theta` — C6(θ)\n- `p2_at_r0_theta` — p2(θ)\n");
writeFileSync(join(run, "results.json"), JSON.stringify({
  computed: {
    quantities: [
      { id: "c6_theta_60p_mj32", key: "computed.c6_theta" },
      { id: "c6_anisotropy_ratio_60p", key: "computed.c6_anisotropy_ratio" },
      { id: "blockade_radius_r0_60p", key: "computed.blockade_radius_r0" },
      { id: "n11_scaling_factor_60p", key: "computed.n11_scaling_factor", uncertainty: 0.5 },
      { id: "missing_key_q", key: "computed.nope" },
    ],
    c6_theta: { headline: true, observable: "Van der Waals coefficient C6(theta) [GHz*um^6] for two Rb |60P3/2, mJ=+3/2> atoms", value_fit: { sin4_coeff_ghz_um6: -294.9 }, c6_at_theta_pi2_ghz_um6: -293.0, uncertainty: 0.1, uncertainty_source: "pert vs exact", limit_check: { limit: "n=25 anchor", expected: "6.33 sin^4 ...", observed: "6.333 sin^4 ...", artifact: "x.json" }, inputs: {} },
    c6_anisotropy_ratio: { headline: true, observable: "Ratio |C6(pi/2)|/|C6(0)| for the stretched 60P3/2 pair, dimensionless", value: 28.14, uncertainty: 0.15, uncertainty_source: "basis truncation", limit_check: { limit: "isotropic 70S control", expected: 1.0, observed: 1.02, artifact: "tests/t.py" }, inputs: {} },
    blockade_radius_r0: { headline: true, observable: "Blockade radius r0 = (|C6(pi/2)|/hbar Omega)^(1/6) in micrometers at Omega/2pi = 45.4 kHz", value_um: 13.65, uncertainty: 0.02, uncertainty_source: "1/6 power", inputs: { rabi_frequency: 45.36 } },
    n11_scaling_factor: 3.1,
  },
}));

const t = buildClaimTable(dir);
const row = (id: string) => t.rows.find((r) => r.id === id);
const decl = (id: string) => t.decls.find((d) => d.id === id)!;

check("object leaf with `value` → value read (28.14)", decl("c6_anisotropy_ratio_60p").value === 28.14);
check("object leaf with single value_<unit> → value read (13.65)", decl("blockade_radius_r0_60p").value === 13.65);
check("metadata read from the leaf object: headline/observable/σ/inputs", decl("blockade_radius_r0_60p").headline === true && /Blockade radius/.test(decl("blockade_radius_r0_60p").observable ?? "") && decl("blockade_radius_r0_60p").uncertainty === 0.02 && decl("blockade_radius_r0_60p").inputs.rabi_frequency === 45.36);
check("numeric limit_check on the leaf is accepted", decl("c6_anisotropy_ratio_60p").limitCheck?.expected === 1.0);
check("quantities[] entry wins over the leaf (uncertainty 0.5 on a plain numeric leaf)", decl("n11_scaling_factor_60p").value === 3.1 && decl("n11_scaling_factor_60p").uncertainty === 0.5);
check("co-located headline rows are load-bearing", t.headline.includes("c6_anisotropy_ratio_60p") && t.headline.includes("blockade_radius_r0_60p"));
check("leaf object with no single value → actionable MALFORMED naming numeric candidates", t.malformed.some((m) => /c6_theta_60p_mj32.*no single numeric `value`.*candidates: .*c6_at_theta_pi2_ghz_um6/.test(m)), t.malformed.join(" | "));
check("string limit_check → actionable MALFORMED (numbers demanded, description kept in limit)", t.malformed.some((m) => /c6_theta_60p_mj32.*limit_check needs .*NUMBER.*textual anchor/.test(m)));
check("missing key → says the key does not exist", t.malformed.some((m) => /missing_key_q.*does not exist/.test(m)));
check("leaf-with-value rows are not MALFORMED", !t.malformed.some((m) => /c6_anisotropy_ratio_60p|blockade_radius_r0_60p/.test(m)), t.malformed.join(" | "));

const problems = quantityDeclarationProblems(dir, "E1_c6_theta_60p");
check("frame id near-miss hint: C6_60P_mj32_theta ← c6_theta_60p_mj32", problems.some((p) => /frame\.md names headline quantity "C6_60P_mj32_theta".*your "c6_theta_60p_mj32"/.test(p)), problems.join(" | "));
check("no hint for a frame id with no near-miss (p2_at_r0_theta)", !problems.some((p) => /"p2_at_r0_theta"/.test(p)), problems.join(" | "));
check("σ/observable hints fire for the co-located headline rows only when missing", !problems.some((p) => /blockade_radius_r0_60p.*no `uncertainty`/.test(p)));

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — co-located quantity metadata is read, and every rejection says how to fix it.");
