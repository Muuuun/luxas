/**
 * Smoke test: iteration lineage (src/dynamics.ts, 2026-08-25).
 *
 * A re-run that inherits nothing from a run that produced a verdict is the
 * measured loser pattern (Yin et al. 2019) → flagged [REBUILD]; a run without
 * computed.iteration is [UNTRACKED]; run_0 is never a rebuild.
 *
 * Run:  npx tsx scripts/smoke_iteration_lineage.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { buildIterationLineage, listLineage } = await import(join(ROOT, "src/dynamics.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const d = mkdtempSync(join(tmpdir(), "luxas-lin-"));
function run(exp: string, n: number, body: Record<string, unknown>) {
	const dir = join(d, "data", "experiments", exp, "runs", `run_${n}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "results.json"), JSON.stringify(body));
}
try {
	run("E1_a", 0, { verdict: "inconclusive", computed: { iteration: { inherited_from: null, kept: [] } } });
	check("single run → no block", buildIterationLineage(d) === "");

	run("E1_a", 1, { verdict: "confirmed", computed: { iteration: { inherited_from: "run_0", kept: ["pipeline", "calibration"] } } });
	const b1 = buildIterationLineage(d);
	check("block appears with ≥2 runs", /<iteration_lineage>/.test(b1), b1.slice(0, 120));
	check("inheriting run is listed without a flag", /^- \[E1 run_1\] inherits run_0; kept: pipeline, calibration$/m.test(b1), b1);

	run("E1_a", 2, { verdict: "inconclusive", computed: { iteration: { inherited_from: null, kept: [] } } });
	const b2 = buildIterationLineage(d);
	check("run inheriting nothing after a verdict → [REBUILD]", /\[E1 run_2\] \[REBUILD\] inherits nothing/.test(b2), b2);
	check("rebuild count in preamble", /1 rebuild\(s\) flagged/.test(b2));

	run("E1_a", 3, { computed: { x: 1 } });
	check("run without computed.iteration → [UNTRACKED]", /\[E1 run_3\] \[UNTRACKED\]/.test(buildIterationLineage(d)));

	// run_0 of a fresh experiment is never a rebuild, and a run_1 after a run_0
	// with no results at all is not one either.
	run("E2_b", 0, { computed: { iteration: { inherited_from: null } } });
	run("E2_b", 1, { computed: { iteration: { inherited_from: null } } });
	const rows = listLineage(d).filter((r: any) => r.id === "E2");
	check("run_0 is not a lineage row", !rows.some((r: any) => r.run === 0));
	check("run_1 after a run_0 with computed → rebuild (prior run counts as having produced something)", rows[0]?.rebuild === true);
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — re-runs declare what they keep; rebuilds are visible." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
