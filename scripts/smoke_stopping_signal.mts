/**
 * Smoke test: the epistemic stopping rule (src/dynamics.ts, 2026-08-25).
 *
 * Two consecutive runs whose headline moved by less than the acceptance
 * criterion's resolution → <stopping_signal> forces ship / change-hypothesis /
 * change-experiment-space; STOP-ACK keyed to the latest run clears it; a new
 * run re-opens the decision under a new key.
 *
 * Run:  npx tsx scripts/smoke_stopping_signal.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { buildStoppingSignal, detectPlateaus } = await import(join(ROOT, "src/dynamics.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const d = mkdtempSync(join(tmpdir(), "luxas-stop-"));
function run(n: number, value: number, extra: Record<string, unknown> = {}) {
	const dir = join(d, "data", "experiments", "E2_fidelity", "runs", `run_${n}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "results.json"), JSON.stringify({
		verdict: "inconclusive",
		computed: { fidelity: value, iteration: { headline_key: "computed.fidelity", headline_value: value, resolution: 0.01, inherited_from: n ? `run_${n - 1}` : null, kept: ["pipeline"], ...extra } },
	}));
}
try {
	mkdirSync(join(d, "notes"), { recursive: true });
	run(0, 0.90); run(1, 0.95);
	check("two runs → no signal (need two deltas)", buildStoppingSignal(d) === "");
	run(2, 0.951);
	check("one small delta after a large one → no signal", buildStoppingSignal(d) === "", buildStoppingSignal(d).slice(0, 120));
	run(3, 0.952);
	const b = buildStoppingSignal(d);
	check("two consecutive sub-resolution deltas → <stopping_signal>", /<stopping_signal priority="high">/.test(b), b.slice(0, 120));
	check("names the three legal forks", /ship:/.test(b) && /change-hypothesis:/.test(b) && /change-experiment-space:/.test(b));
	check("entry keyed EID@run_N with the value trajectory", /\[E2@run_3\]/.test(b) && /0\.95 → 0\.951 → 0\.952/.test(b), b);
	check("detectPlateaus reports the resolution", detectPlateaus(d)[0]?.resolution === 0.01);

	writeFileSync(join(d, "notes", "memory.md"), "STOP-ACK: E2@run_3 — ship: fidelity converged at 0.95, verdict inconclusive stands\n");
	check("STOP-ACK clears it", buildStoppingSignal(d) === "", buildStoppingSignal(d).slice(0, 120));
	run(4, 0.9525);
	check("a later run re-opens the decision under a new key", /\[E2@run_4\]/.test(buildStoppingSignal(d)));

	run(5, 0.99);
	check("a large move ends the plateau", buildStoppingSignal(d) === "");

	// Missing metadata never fires: no headline tracked → nothing to decide on.
	const e3 = join(d, "data", "experiments", "E3_bare", "runs");
	for (const n of [0, 1, 2]) { mkdirSync(join(e3, `run_${n}`), { recursive: true }); writeFileSync(join(e3, `run_${n}`, "results.json"), JSON.stringify({ computed: { x: 1 } })); }
	check("runs without computed.iteration never trigger", !/E3/.test(buildStoppingSignal(d)));
	check("resolution=0 never triggers", (() => { run(6, 0.99, { resolution: 0 }); run(7, 0.99, { resolution: 0 }); return !/E2/.test(buildStoppingSignal(d)); })());
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — iteration stops on evidence, not on budget." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
