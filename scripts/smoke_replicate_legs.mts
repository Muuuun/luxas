/**
 * smoke_replicate_legs — v3 D2: a computing replication on an assigned route
 * that differs from the producer's is an independent leg (converging without
 * an INDEPENDENT line); two replications on one route are one leg (wiring);
 * same model + same route is wiring; a replication with no route/script is
 * not a leg; replications count as "later" for supersession.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaimTable, relation } from "../src/claims-table.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
delete process.env.LUXAS_REPLICATE_LEGS;
function project(reps: Array<{ exp: string; value: number; sigma: number; route?: string; script?: string; model?: string; own?: number }>): string {
  const dir = mkdtempSync(join(tmpdir(), "rep-legs-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "frame.md"), "# F\n\n## Headline quantities\n- `zero_angle`\n");
  for (const r of reps) {
    const base = join(dir, "data", "experiments", r.exp);
    mkdirSync(join(base, "runs", "run_1"), { recursive: true });
    if (r.own !== undefined) writeFileSync(join(base, "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [{ id: "zero_angle", key: "computed.zero_angle", headline: true, observable: "angle at which the total C6 crosses zero, degrees, Rb 60P3/2 stretched pair", uncertainty: r.sigma, inputs: {} }], zero_angle: r.own } }));
    else writeFileSync(join(base, "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [], dummy: 1 } }));
    if (r.route !== undefined || r.script !== undefined) {
      mkdirSync(join(base, "replication"), { recursive: true });
      writeFileSync(join(base, "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: r.value, sigma: r.sigma, route: r.route, script: r.script, model: r.model, inputs: {} }));
    }
  }
  return dir;
}
const row = (dir: string) => buildClaimTable(dir).rows.find((r) => r.id === "zero_angle")!;

// producer alone
let r = row(project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35 }]));
check("producer alone → indicative", r.status === "indicative");
// + one computing replication on a different route → converging (no INDEPENDENT line needed)
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root fit", script: "replication/fit.py" }]));
check("computing replication, route unset on producer → still a leg (routes differ by default)", r.status === "converging", r.status + " :: " + r.reasons.join(" | "));
// producer with a route equal to the replication's → wiring, not a leg
r = row(project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35, route: "full diagonalization", script: "replication/diag.py" }]));
const dirSame = project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35 }]);
writeFileSync(join(dirSame, "data", "experiments", "E3_a", "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [{ id: "zero_angle", key: "computed.zero_angle", headline: true, observable: "angle at which the total C6 crosses zero, degrees", uncertainty: 0.35, inputs: {} }], zero_angle: 24.65, cross_validation: [{ claim_key: "computed.zero_angle", method_a: "full pair-Hamiltonian diagonalization", method_b: "second-order channel sum", value_a: 24.65, value_b: 24.0, tolerance_rel: 0.1 }] } }));
mkdirSync(join(dirSame, "data", "experiments", "E3_a", "replication"), { recursive: true });
writeFileSync(join(dirSame, "data", "experiments", "E3_a", "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: 24.6, sigma: 0.3, route: "full diagonalization of the pair Hamiltonian", script: "replication/diag.py", inputs: {} }));
const rs = row(dirSame);
check("replication on the PRODUCER's route → wiring, not a second leg", rs.reasons.some((x) => /wiring: .*replication|wiring: E3_a:replication|wiring:.*E3_a:computed.*E3_a:replication/.test(x)) || !rs.reasons.some((x) => /agree: E3_a:computed[^|]*E3_a:replication/.test(x)), rs.reasons.join(" | "));
// no script → not a computing leg
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "napkin two-channel model" }]));
check("replication without a script is not a leg (unattested)", r.status === "indicative" && r.reasons.some((x) => /unattested/.test(x)), r.status + " :: " + r.reasons.join(" | "));
// relation(): same model + same route = wiring
const a = { quantity: "q", value: 24.5, sigma: 0.2, kind: "replication", source: "E4:replication", experiment: "E4", route: "three-channel fit", model: "m1", job: "replication/a.py" } as any;
const b = { ...a, value: 24.6, source: "E5:replication", experiment: "E5", job: "replication/b.py" };
check("two replications on the same route are wiring", relation(a, b).rel === "wiring");
check("different routes, different values → comparable", relation(a, { ...b, route: "full diagonalization" }).rel === "comparable");
// supersession with a replication as a later leg: E3 stale 22.909±0.01; E4 own 24.65±0.35; E4 replication (different route) 24.5±0.2
const dirSup = project([{ exp: "E3_a", own: 22.909, value: 0, sigma: 0.01 }, { exp: "E4_b", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root", script: "replication/fit.py" }]);
writeFileSync(join(dirSup, "data", "experiments", "E4_b", "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: 24.5, sigma: 0.2, route: "three-channel quadratic root", script: "replication/fit.py", inputs: {} }));
const rsup = row(dirSup);
check("E3's stale value superseded by E4 own + E4's replication (different route)", rsup.reasons.some((x) => /superseded: E3/.test(x)) && rsup.status !== "disputed", rsup.status + " :: " + rsup.reasons.join(" | "));
process.env.LUXAS_REPLICATE_LEGS = "0";
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root fit", script: "replication/fit.py" }]));
check("LUXAS_REPLICATE_LEGS=0 → replications attest nothing", r.status === "indicative");
delete process.env.LUXAS_REPLICATE_LEGS;
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — computing replications on assigned routes settle rows; same route is one leg.");
