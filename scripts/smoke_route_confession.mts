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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeConfessesDependence, sameRoute } from "../src/claims-review.js";
import { relation } from "../src/claims-table.js";
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

summary();
