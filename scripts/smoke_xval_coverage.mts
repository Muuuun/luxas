/**
 * Smoke test: the two cross-validation fixes from the 2026-08-23 production
 * audit (77 executed entries since July → 1 corroborated claim).
 *
 *   B  xvalVerdict rejects a bit-identical value_a/value_b as "identical" —
 *      the same computation recorded twice is not an independent control.
 *      23 of 40 "agreeing" production entries were this.
 *   A  5f blocks a headline claim whose number has an agreeing control filed
 *      under a DIFFERENT claim_key (credit lost at the exact-string join),
 *      and reports coverage for headline claims with no control at all
 *      without blocking (blocking there recreates the finish-gate livelock).
 *
 * Each scenario builds a minimal project on disk and runs the real
 * reportIntegrityIssues(). No .agent/jobs/ is created, so value anchoring
 * takes the legacy-project branch and the smoke exercises A and B alone.
 *
 * Run:  npx tsx scripts/smoke_xval_coverage.mts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { reportIntegrityIssues } = await import(join(ROOT, "src/tools/report-integrity.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

interface Fixture {
	abstract: string;
	claims: any[];
	xval: any[];
}

/** Minimal project: one experiment, one run, a report whose abstract carries the claim. */
function build(f: Fixture): string {
	const dir = mkdtempSync(join(tmpdir(), "luxas-xval-"));
	mkdirSync(join(dir, "report"), { recursive: true });
	mkdirSync(join(dir, "notes"), { recursive: true });
	const run = join(dir, "data", "experiments", "E1_fixture", "runs", "run_0");
	mkdirSync(run, { recursive: true });
	writeFileSync(join(dir, "report", "report.tex"),
		`\\documentclass{article}\\begin{document}\n\\begin{abstract}\n${f.abstract}\n\\end{abstract}\n` +
		`\\section{Body}\nSee E1.\n\\end{document}\n`);
	writeFileSync(join(dir, "report", "claims.json"), JSON.stringify(f.claims, null, 1));
	writeFileSync(join(run, "results.json"), JSON.stringify({
		computed: { headline_rate: 0.0321, other_rate: 0.0321, cross_validation: f.xval },
	}, null, 1));
	writeFileSync(join(dir, "notes", "experiments.md"), "## L2.1 — fixture\n\n**Status:** Complete\n\nheadline_rate = 0.0321\n");
	return dir;
}

function texts(issues: any[]): string { return issues.map((i) => i.text).join("\n"); }

const dirs: string[] = [];
try {
	// ── B: bit-identical pair is rejected ──────────────────────────────────
	{
		const d = build({
			abstract: "The rate is 0.0321 per cycle.",
			claims: [{ value: 0.0321, tex_context: "rate is 0.0321", claim_key: "computed.headline_rate", grade: "corroborated", source_file: "notes/experiments.md", source_quote: "headline_rate = 0.0321" }],
			xval: [{ claim_key: "computed.headline_rate", method_a: "exact diag", method_b: "perturbative", value_a: 0.0321, value_b: 0.0321, tolerance_rel: 0.01, artifact: "x.py" }],
		});
		dirs.push(d);
		const t = texts(reportIntegrityIssues(d));
		check("B: bit-identical values flagged as not a cross-validation", /bit-identical/.test(t), t.slice(0, 200));
		check("B: identical pair cannot lift a claim to corroborated", /exceeds the recomputed cap/.test(t), t.slice(0, 200));
	}

	// ── B: small exact integer is still admissible ─────────────────────────
	{
		const d = build({
			abstract: "The circuit uses 42 CX gates.",
			claims: [{ value: 42, tex_context: "uses 42 CX gates", claim_key: "computed.headline_rate", grade: "corroborated", source_file: "notes/experiments.md", source_quote: "42" }],
			xval: [{ claim_key: "computed.headline_rate", method_a: "stim count", method_b: "hand tally", value_a: 42, value_b: 42, tolerance_rel: 0.01, artifact: "x.py" }],
		});
		dirs.push(d);
		const t = texts(reportIntegrityIssues(d));
		check("B: exact integer count from two methods is admitted", !/bit-identical/.test(t), t.slice(0, 200));
	}

	// ── B: genuinely independent values still corroborate ──────────────────
	{
		const d = build({
			abstract: "The rate is 0.0321 per cycle.",
			claims: [{ value: 0.0321, tex_context: "rate is 0.0321", claim_key: "computed.headline_rate", grade: "corroborated", source_file: "notes/experiments.md", source_quote: "headline_rate = 0.0321" }],
			xval: [{ claim_key: "computed.headline_rate", method_a: "exact diag", method_b: "perturbative", value_a: 0.0321, value_b: 0.0318, tolerance_rel: 0.02, artifact: "x.py" }],
		});
		dirs.push(d);
		const t = texts(reportIntegrityIssues(d));
		check("B: independent agreeing pair is not flagged", !/bit-identical/.test(t) && !/exceeds the recomputed cap/.test(t), t.slice(0, 200));
		check("A: covered headline reports 1/1 coverage", /coverage: 1\/1/.test(t), t.slice(0, 300));
	}

	// ── A: control exists but under the wrong key → BLOCK with the fix ─────
	{
		const d = build({
			abstract: "The rate is 0.0321 per cycle.",
			claims: [{ value: 0.0321, tex_context: "rate is 0.0321", claim_key: "computed.headline_rate", grade: "indicative", source_file: "notes/experiments.md", source_quote: "headline_rate = 0.0321" }],
			xval: [{ claim_key: "computed.other_rate", method_a: "exact diag", method_b: "perturbative", value_a: 0.0321, value_b: 0.0318, tolerance_rel: 0.02, artifact: "x.py" }],
		});
		dirs.push(d);
		const issues = reportIntegrityIssues(d);
		const hit = issues.find((i: any) => /wrong claim_key/.test(i.text));
		check("A: misattributed control is detected", !!hit, texts(issues).slice(0, 300));
		check("A: misattribution BLOCKS finish", !!hit && hit.blocking === true);
		check("A: message names the key to set", !!hit && /computed\.other_rate/.test(hit.text));
	}

	// ── A: no control at all → coverage line only, no block ────────────────
	{
		const d = build({
			abstract: "The rate is 0.0321 per cycle.",
			claims: [{ value: 0.0321, tex_context: "rate is 0.0321", claim_key: "computed.headline_rate", grade: "indicative", source_file: "notes/experiments.md", source_quote: "headline_rate = 0.0321" }],
			xval: [],
		});
		dirs.push(d);
		const issues = reportIntegrityIssues(d);
		const cov = issues.find((i: any) => /Headline cross-validation coverage/.test(i.text));
		check("A: uncovered headline produces a coverage line", !!cov && /coverage: 0\/1/.test(cov.text), texts(issues).slice(0, 300));
		check("A: uncovered headline does NOT block", !!cov && cov.blocking === false);
		check("A: no misattribution block when nothing to misattribute", !issues.some((i: any) => /wrong claim_key/.test(i.text)));
	}
} finally {
	for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

// ── Regression: sign-aware extraction + percent↔fraction dereference ──
// (2026-08-25, both found live on the 297nm finish.)
{
	const { extractNumbers } = await import(join(ROOT, "src/tools/report-integrity.js"));
	const nums = extractNumbers('"v_4um_ghz": -0.151863, c6_over_r6_ghz = -0.85011962890625');
	check("negative JSON/assignment values extract signed",
		nums.includes(-0.151863) && nums.includes(-0.85011962890625), JSON.stringify(nums));
	const dash = extractNumbers("n=40-80 scan, R-6 tail, realization---700 mW, 316--319 nm");
	check("range/LaTeX dashes do not become negative numbers",
		dash.includes(40) && dash.includes(80) && dash.includes(700) &&
		![-80, -6, -700, -319].some((v) => dash.includes(v)), JSON.stringify(dash));

	// percent↔fraction: claim says 99.963 (%), ledger quote says 0.999627.
	const dir = mkdtempSync(join(tmpdir(), "xval-pf-"));
	try {
		mkdirSync(join(dir, "report"), { recursive: true });
		mkdirSync(join(dir, "notes"), { recursive: true });
		mkdirSync(join(dir, "data", "experiments", "E1_x", "runs", "run_0"), { recursive: true });
		writeFileSync(join(dir, "data", "experiments", "E1_x", "runs", "run_0", "results.json"),
			JSON.stringify({ verdict: "confirmed", computed: {} }));
		writeFileSync(join(dir, "notes", "experiments.md"),
			"## L2.1 — frontier\nHeadline findings: gives F(40 MHz) = 0.999627 > F(10 MHz).\n");
		writeFileSync(join(dir, "report", "report.tex"),
			"\\begin{document}\\begin{abstract}F=99.963\\%\\end{abstract}\\end{document}");
		writeFileSync(join(dir, "report", "claims.json"), JSON.stringify([
			{ value: 99.963, tex_context: "F=99.963", source_file: "notes/experiments.md",
			  source_quote: "gives F(40 MHz) = 0.999627 > F(10 MHz)." },
		]));
		const issues = reportIntegrityIssues(dir);
		const deref = issues.filter((i: any) => /fail dereference/.test(i.text));
		check("percent claim resolves against fraction quote (no false dereference block)",
			deref.length === 0, deref.map((i: any) => i.text.slice(0, 120)).join(" | "));
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(failures === 0 ? "\nALL PASS — cross-validation fixes A and B behave." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
