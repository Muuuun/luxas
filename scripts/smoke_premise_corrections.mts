/**
 * Smoke test: the premise-correction channel (expectation/surprise dynamics,
 * 2026-08-25).
 *
 * An experiment that PROVES a plan premise wrong records
 * computed.premise_corrections; buildPremiseCorrections surfaces every
 * unacknowledged entry into the brain's per-turn snapshot as a forced
 * decision, and a PREMISE-ACK line in notes/memory.md clears it. Prose parks
 * surprises; state interrupts them — the live case is E1 discovering
 * n(297nm) ≈ 75 against the plan's 55–65 and parking it in Limitations.
 *
 * Run:  npx tsx scripts/smoke_premise_corrections.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { buildPremiseCorrections } = await import(join(ROOT, "src/context.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const d = mkdtempSync(join(tmpdir(), "luxas-pc-"));
try {
	const run = join(d, "data", "experiments", "E1_mapping", "runs", "run_0");
	mkdirSync(run, { recursive: true });
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(run, "results.json"), JSON.stringify({ computed: {
		n_at_target: 75.3,
		premise_corrections: [{
			premise: "plan assumed 297 nm addresses n≈55–65",
			corrected: "exact mapping gives n≈75.3 for both P1/2 and P3/2",
			consequence: "C6 ~ n^11: blockade inputs for E2/E3 change by orders of magnitude",
			affects: ["E_2", "E_3"],
		}],
	}}));

	const b1 = buildPremiseCorrections(d);
	check("unacknowledged correction surfaces", /<premise_corrections priority="high">/.test(b1), b1.slice(0, 120));
	check("carries premise, corrected value, and affects list", /55–65/.test(b1) && /75\.3/.test(b1) && /E_2, E_3/.test(b1));
	check("names the two legal dispositions", /edit plan\.md/.test(b1) && /PREMISE-ACK/.test(b1));
	check("entry is addressable as EID#idx", /\[E1#0\]/.test(b1), b1.slice(0, 300));

	writeFileSync(join(d, "notes", "memory.md"),
		"PREMISE-ACK: E1#0 — plan.md E_2/E_3 updated to n=75.3 before dispatch\n");
	const b2 = buildPremiseCorrections(d);
	check("PREMISE-ACK clears the block", b2 === "", b2.slice(0, 120));

	rmSync(join(d, "notes", "memory.md"));
	check("removing the ACK resurfaces it (state, not one-shot)", buildPremiseCorrections(d) !== "");

	const bare = mkdtempSync(join(tmpdir(), "luxas-pc2-"));
	check("no corrections → empty block", buildPremiseCorrections(bare) === "");
	rmSync(bare, { recursive: true, force: true });
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — surprises interrupt; prose no longer parks them." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
