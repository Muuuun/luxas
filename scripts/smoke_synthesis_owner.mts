/**
 * Smoke test: the synthesis-owner gate (2026-08-25, 297nm postmortem).
 *
 * A plan with ≥2 experiments must contain a synthesis section (or an explicit
 * SYNTH-DECLINE). The acceptance run shipped C6(θ) in one silo and
 * single-θ fidelity in another with no owner for F(θ) — sound everywhere,
 * insufficient as an answer — and the PI approved it. Structure, not
 * exhortation: the check rides the existing plan→ledger→finish chain.
 *
 * Run:  npx tsx scripts/smoke_synthesis_owner.mts
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { synthesisOwnerIssue } = await import(join(ROOT, "src/tools/index.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TWO = `# plan\n\n### E_1: transition strength\nstuff\n\n### E_2: angle dependence\nstuff\n`;
const WITH_SYNTH = TWO + `\n### E_3 (synthesis): F(theta) and F(P) frontier\nConsumes E_1 + E_2.\n`;
const ONE = `# plan\n\n### E_1: only question\nstuff\n`;

check("two silos, no synthesis → BLOCKS", synthesisOwnerIssue(TWO, "") !== null);
check("block message names the deliverable object and the transfer question",
	/DELIVERABLE OBJECT/.test(synthesisOwnerIssue(TWO, "") ?? "") && /mitigation-transfer/.test(synthesisOwnerIssue(TWO, "") ?? ""));
check("synthesis section present → passes", synthesisOwnerIssue(WITH_SYNTH, "") === null);
check("SYNTH-DECLINE in memory → passes", synthesisOwnerIssue(TWO, "notes...\nSYNTH-DECLINE: two independent lookups, nothing to join\n") === null);
check("single-experiment plan exempt", synthesisOwnerIssue(ONE, "") === null);
check("heading variant '### E_4 synthesis of frontiers' accepted",
	synthesisOwnerIssue(TWO + "\n### E_4 synthesis of frontiers\nx\n", "") === null);

console.log(failures === 0 ? "\nALL PASS — synthesis has an owner." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
