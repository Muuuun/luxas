/**
 * Smoke test: the career layer (2026-08-25) — the user's project history as
 * accumulated research identity.
 *
 * harvestCareer extracts findings (claims.json), corrections
 * (premise_corrections), and open leads (unrun FollowUps) with provenance;
 * buildCareerBlock matches them to a NEW question and renders the <career>
 * block with the inherited-unverified discipline; standards.md rides into
 * the PI context as the durable channel for user dissatisfaction. Uses an
 * isolated HOME so the real career is untouched.
 *
 * Run:  npx tsx scripts/smoke_career.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fakeHome = mkdtempSync(join(tmpdir(), "luxas-career-home-"));
process.env.HOME = fakeHome; // must precede module load: career.ts resolves homedir() at import
const { harvestCareer, buildCareerBlock, readCareerStandards } = await import(join(ROOT, "src/career.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

function project(name: string): string {
	const d = mkdtempSync(join(tmpdir(), "luxas-cp-"));
	mkdirSync(join(d, "report"), { recursive: true });
	mkdirSync(join(d, "notes"), { recursive: true });
	const run = join(d, "data", "experiments", "E2_vdw", "runs", "run_0");
	mkdirSync(run, { recursive: true });
	writeFileSync(join(d, "RESEARCH.md"), `# ${name}\n\n> question text\n`);
	writeFileSync(join(d, "report", "claims.json"), JSON.stringify([
		{ value: 53.77, grade: "corroborated", claim_key: "computed.f_theta.crossover_angle_deg",
		  tex_context: "blockade-recoil crossover angle for Rydberg P states 53.77 deg" },
	]));
	writeFileSync(join(run, "results.json"), JSON.stringify({ computed: {
		premise_corrections: [{ premise: "driving faster always helps recoil",
			corrected: "blockade leakage overtakes above 19 MHz for Rydberg blockade gates",
			consequence: "optimum Omega near 19 MHz" }],
	}}));
	writeFileSync(join(d, "notes", "experiments.md"),
		`## L2.2 — vdw\n\n**Status:** Complete\n\n### FollowUp: E_5_master_equation\nQuestion: verify the blockade-limited regime with a master equation for Rydberg gates\nDecision rule: agree within 10%\nEffort: M\n`);
	return d;
}

const p1 = project("Rydberg blockade fidelity study");
try {
	const h = harvestCareer(p1)!;
	check("harvest extracts findings/corrections/leads", h.findings === 1 && h.corrections === 1 && h.leads === 1, JSON.stringify(h));
	check("re-harvest is idempotent", harvestCareer(p1) === null);

	const block = buildCareerBlock("study the fidelity of Rydberg blockade gates vs angle");
	check("matched question renders <career>", /<career>/.test(block), block.slice(0, 120));
	check("finding carries provenance + inherited-unverified discipline",
		/Rydberg blockade fidelity study/.test(block) && /INHERITED-UNVERIFIED/.test(block) && /53\.77/.test(block));
	check("correction carried (do-not-re-assume)", /blockade leakage overtakes/.test(block));
	check("career frontier lists the unrun lead", /E_5_master_equation/.test(block));

	const off = buildCareerBlock("economic analysis of battery supply chains in Chile");
	check("unrelated question gets no career noise", !/53\.77/.test(off) && !/E_5_master/.test(off), off.slice(0, 150));

	writeFileSync(join(fakeHome, ".sisyphus", "career", "standards.md"),
		"- A composite question requires the joint deliverable object; silo answers are a STEER.\n");
	check("standards readable", /joint deliverable/.test(readCareerStandards()));
	check("standards appear in career block for ANY question", /Standing standards/.test(buildCareerBlock("anything else entirely qqq")));
} finally {
	rmSync(p1, { recursive: true, force: true });
	rmSync(fakeHome, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — history is a career." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
