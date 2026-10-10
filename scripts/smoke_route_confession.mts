#!/usr/bin/env tsx
/**
 * smoke_route_confession — the route leg of the wiring detector must actually
 * fire, and must not fire on genuinely independent routes.
 *
 * Background (notes/route-confession-2026-09-22.md): `sameRoute` is token-set
 * EQUALITY and, measured over every cross_validation pair in the corpus that
 * carries both method strings and both numbers (64 pairs, 5 projects), it fires
 * **0 times**. Every wiring verdict in production came from the numeric 1e-6
 * veto alone — so a pair that is one computation twice but lands at 1e-5 has
 * always been graded as corroboration.
 *
 * The fixture's LABEL comes from the two NUMBERS; the detector sees only the two
 * STRINGS. That is the whole point — it is scored against evidence it never saw.
 *
 *   npx tsx scripts/smoke_route_confession.mts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeConfessesDependence, sameRoute } from "../src/claims-review.js";
import { buildClaimTable, claimTableIssues, relation } from "../src/claims-table.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pairs: any[] = JSON.parse(readFileSync(join(ROOT, "fixtures/route-confession/pairs.json"), "utf8"));

console.log(`1. the corpus fixture (${pairs.length} real pairs)`);
check("fixture is the harvested corpus, not a toy", pairs.length >= 60, `${pairs.length} pairs`);
const wiring = pairs.filter((p) => p.rel <= 1e-6);
const indep = pairs.filter((p) => p.rel > 0.1);
check("carries both labelled classes", wiring.length >= 5 && indep.length >= 15,
  `${wiring.length} bit-wiring, ${indep.length} independent`);

console.log("\n2. the regression this exists for: sameRoute alone is silent");
check("sameRoute still fires on nothing in the corpus",
  pairs.filter((p) => sameRoute(p.method_a, p.method_b)).length === 0,
  "if this ever changes, re-measure before trusting it");

console.log("\n3. the confession detector");
const hits = pairs.filter((p) => routeConfessesDependence(p.method_a, p.method_b));
const fp = hits.filter((p) => p.rel > 0.1);
const newCatch = hits.filter((p) => p.rel > 1e-6 && p.rel <= 0.1);
check("fires at all", hits.length > 0, `${hits.length}/${pairs.length}`);
check("NO false positives on numerically-independent pairs", fp.length === 0,
  fp.map((p) => `${p.method_a} ⟂ ${p.method_b}`).join(" | "));
check("catches wiring the numeric 1e-6 veto cannot see", newCatch.length >= 2,
  `${newCatch.length} pairs in 1e-6..0.1`);
check("every hit names a reason", hits.every((p) => typeof routeConfessesDependence(p.method_a, p.method_b) === "string"));

console.log("\n4. the specific confessions, each tied to a corpus example");
const cases: [string, string, boolean][] = [
  ["E6 packing optimizer internal full-pairwise check",
   "independent brute-force full-cell cross-talk recheck of the same exhibited lattice", true],
  ["fom_table resolution of quantity id y_mot_laser_count_typeI",
   "E4 declared computed.laser_inventory.mot_laser_count read directly from data/experiments", true],
  ["Le Kien SOS (A -> |<d>|^2 -> 6j -> alpha)",
   "alpha = sum f_n/omega_n^2 with f derived from the same A via the standard f(A) relation", true],
  ["re-summing the pipeline's own channel contributions",
   "channel-sum recomputed from the pipeline outputs", true],
  // Innocent uses of the same words must NOT fire.
  ["ARC getC6perturbatively at the same n=60 state", "full pair diagonalization at n=60", false],
  ["master-equation integration at the same temperature", "closed-form recoil-limited bound", false],
  ["ARC model potential", "Evered2023 measured", false],
  ["pairinteraction MQDT", "Pagano2022 published", false],
];
for (const [a, b, want] of cases) {
  const got = routeConfessesDependence(a, b);
  check(`${want ? "confession" : "innocent "}: ${a.slice(0, 44)}`, !!got === want, `got ${JSON.stringify(got)}`);
}

console.log("\n5. it reaches relation() as wiring, with the reason attached");
const est = (route: string, kind: string, value: number) =>
  ({ quantity: "q", value, kind, source: `s:${kind}`, route, script: `${kind}.py` } as any);
// 5e-5 apart: ABOVE the numeric 1e-6 veto, so the confession leg is the only
// thing that can fire. This is the band the corpus showed is unguarded today
// (two real pairs at rel 3.4e-5 and 7.8e-6).
const r = relation(est("E6 optimizer internal full-pairwise check", "own", 1.0),
                   est("independent brute-force recheck of the same lattice", "xval", 1.00005));
check("relation() returns wiring above the numeric veto", r.rel === "wiring", JSON.stringify(r));
check("relation() names why", typeof r.why === "string" && /internal/i.test(r.why), JSON.stringify(r.why));
const ok = relation(est("ARC model potential", "own", 1.0), est("Evered2023 measured", "xval", 1.19));
check("two genuinely different routes are NOT wiring", ok.rel !== "wiring", JSON.stringify(ok));

// C13 — "its own RK45 integrator" / "Pade resummed series" confess dependence,
// but legs 1.5× or 4× apart are not one computation twice: the confession
// removes the corroboration credit, it must not erase the dispute.
console.log("\n6. C13: a confession may remove a credit, never a numeric disagreement");
{
  const own = (route: string, value = 1.0) => ({ quantity: "zeta", value, sigma: 0.01, kind: "own", source: "E1:computed.zeta", experiment: "E1", script: "E1:own", inputs: {}, route } as any);
  const rep = (route: string, value = 1.5) => ({ quantity: "zeta", value, sigma: 0.01, kind: "replication", source: "E1:replication", experiment: "E1", script: "replication:E1:replication/x.py", inputs: {}, route, job: "replication/x.py" } as any);
  const RK = "independent time-domain integration with its own RK45 integrator";
  const r1 = relation(own("direct numerical diagonalization"), rep(RK));
  check("C13 disagreeing confession pair (own vs replication) is not wiring", r1.rel !== "wiring", JSON.stringify(r1));
  const r2 = relation({ ...own("closed-form second-order perturbation theory"), sigma: undefined },
                      { quantity: "zeta", value: 4.0, kind: "xval", source: "E1:xval", script: "E1:xval:b", route: "Pade resummed series" } as any);
  check("C13 disagreeing confession pair (own vs xval, ratio 4, no σ) is not wiring", r2.rel !== "wiring", JSON.stringify(r2));
  // §5's agreeing pair (no σ → undecidable) and a σ-agreeing pair keep losing their credit.
  const r3 = relation(est("E6 optimizer internal full-pairwise check", "own", 1.0),
                      est("independent brute-force recheck of the same lattice", "xval", 1.00005));
  check("C13 agreeing confession pair stays wiring", r3.rel === "wiring" && /internal/.test(r3.why ?? ""), JSON.stringify(r3));
  const r4 = relation(own("direct numerical diagonalization"), rep(RK, 1.005));
  check("C13 σ-agreeing confession pair stays wiring", r4.rel === "wiring", JSON.stringify(r4));

  const frame = "# Frame\n\n## Headline quantities\n- `zeta` — dimensionless leakage per gate\n";
  const decl = { id: "zeta", key: "computed.zeta", headline: true, observable: "dimensionless leakage per gate", uncertainty: 0.01, inputs: {} };
  const dir = mkdtempSync(join(tmpdir(), "luxas-confession-"));
  try {
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "notes", "frame.md"), frame);
    const base = join(dir, "data", "experiments", "E1_zeta");
    mkdirSync(join(base, "runs", "run_1"), { recursive: true });
    mkdirSync(join(base, "replication"), { recursive: true });
    writeFileSync(join(base, "runs", "run_1", "results.json"), JSON.stringify({ computed: {
      quantities: [decl], zeta: 1.0, cross_validation: [{ claim_key: "computed.zeta", method_a: "direct numerical diagonalization" }] } }));
    // job_id + mode stamp a harness replication, so the leg stays valid once provenance is checked.
    writeFileSync(join(base, "replication", "results.json"), JSON.stringify({ quantity: "zeta", value: 1.5, sigma: 0.01, route: RK, script: "replication/x.py", job_id: "job-rep-1", mode: "replicate", inputs: {} }));
    mkdirSync(join(dir, "report"), { recursive: true });
    writeFileSync(join(dir, "report", "report.tex"), "\\begin{abstract}We find a leakage per gate of 1.00.\\end{abstract}\n");
    writeFileSync(join(dir, "report", "claims.json"), JSON.stringify([{ claim_key: "computed.zeta", quantity_id: "zeta", value: 1.0, tex_context: "leakage per gate of 1.00" }]));
    const t = buildClaimTable(dir);
    const row = t.rows.find((r) => r.id === "zeta");
    check("C13 own 1.0 vs replication 1.5 ('its own RK45 integrator') → disputed with a disagree: reason",
      row?.status === "disputed" && row.reasons.some((x) => x.startsWith("disagree: E1:computed.zeta=1 vs E1:replication=1.5")),
      JSON.stringify(row && { status: row.status, reasons: row.reasons }));
    const issues = claimTableIssues(dir, t);
    check("C13 finish gate blocks with [abstain] zeta is disputed", issues.some((i) => i.blocking && i.text.startsWith("[abstain] zeta is disputed")),
      JSON.stringify(issues.map((i) => i.text.slice(0, 60))));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const dir2 = mkdtempSync(join(tmpdir(), "luxas-confession-xv-"));
  try {
    mkdirSync(join(dir2, "notes"), { recursive: true });
    writeFileSync(join(dir2, "notes", "frame.md"), frame);
    const run = join(dir2, "data", "experiments", "E1_zeta", "runs", "run_1");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "results.json"), JSON.stringify({ computed: {
      quantities: [decl], zeta: 1.0,
      cross_validation: [{ claim_key: "computed.zeta", method_a: "closed-form second-order perturbation theory", method_b: "Pade resummed series", value_a: 1.0, value_b: 4.0 }] } }));
    const row = buildClaimTable(dir2).rows.find((r) => r.id === "zeta");
    check("C13 producer-only xval 'Pade resummed series' 1.0 vs 4.0 → disputed",
      row?.status === "disputed" && row.reasons.some((x) => x.startsWith("disagree:")),
      JSON.stringify(row && { status: row.status, reasons: row.reasons }));
  } finally { rmSync(dir2, { recursive: true, force: true }); }
}

summary();
