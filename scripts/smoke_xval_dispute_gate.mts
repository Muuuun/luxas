/**
 * Smoke test: step 1 of the claims-first rollout (design §7.1) —
 *   (a) xvalVerdict treats < 1e-6 relative agreement as "identical" (wiring);
 *   (b) cross_validation_resolved no longer clears a DISCREPANT entry;
 *   (c) a DISCREPANT entry caps any claims.json entry carrying that key OR
 *       that value at grade "disputed", which requires a hedge;
 * on the real 297nm project (fixtures/claims-297nm/raw), whose abstract cites
 * E5's disputed 2.555e-4 under E6's re-keyed copy at grade "indicative".
 *
 * Run:  npx tsx scripts/smoke_xval_dispute_gate.mts
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "fixtures", "claims-297nm", "raw");
const { xvalVerdict, reportIntegrityIssues } = await import(join(ROOT, "src/tools/report-integrity.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// (a) wiring veto
check("1e-9 relative agreement is identical (wiring), not corroborated", xvalVerdict({ value_a: 0.9989419909022651, value_b: 0.9989419909022648, tolerance_rel: 1e-9 }) === "identical");
check("bit-identical stays identical", xvalVerdict({ value_a: 2.5, value_b: 2.5, tolerance_rel: 0.1 }) === "identical");
check("1e-3 relative agreement within tolerance is corroborated", xvalVerdict({ value_a: 1.000, value_b: 1.001, tolerance_rel: 0.01 }) === "corroborated");
check("small exact integer counts are admitted", xvalVerdict({ value_a: 28, value_b: 28, tolerance_rel: 1e-9 }) === "corroborated");
check("5.6× is discrepant", xvalVerdict({ value_a: -0.151863, value_b: -0.85011962890625, tolerance_rel: 0.3 }) === "discrepant");

// (b)+(c) on the real project
const issues = reportIntegrityIssues(RAW);
const disclosure = issues.find((i: any) => i.kind === "disclosure" && /Cross-method DISPUTES on record/.test(i.text));
check("E5's two disputes are disclosed (non-blocking) despite cross_validation_resolved", !!disclosure && !disclosure.blocking && /leakage_40MHz/.test(disclosure.text) && /v_4um_ghz/.test(disclosure.text), disclosure?.text.slice(0, 200));
check("no blocking 'resolve it' issue remains for the resolved-by-producer entries", !issues.some((i: any) => /record computed\.cross_validation_resolved/.test(i.text)));
const cap = issues.find((i: any) => /Claim-grade legality/.test(i.text) && /2\.555/.test(i.text) && /"disputed"/.test(i.text));
check("abstract's re-keyed 2.555e-4 (grade indicative) is capped at disputed by VALUE", !!cap && cap.blocking, issues.filter((i: any) => /Claim-grade/.test(i.text)).map((i: any) => i.text.slice(0, 300)).join("\n"));

// Hedged + demoted → legal.
const d = mkdtempSync(join(tmpdir(), "luxas-xd-"));
try {
	cpSync(RAW, d, { recursive: true });
	const p = join(d, "report", "claims.json");
	const claims = JSON.parse(readFileSync(p, "utf-8"));
	for (const c of claims) if (Math.abs(Number(c.value) - 0.0002555) < 1e-7) { c.grade = "disputed"; c.tex_context = "blockade leakage $2.555\\times10^{-4}$ at $40$\\,MHz (disputed: the closed form gives 4.3× more)"; }
	writeFileSync(p, JSON.stringify(claims, null, 1));
	const after = reportIntegrityIssues(d);
	check("grade 'disputed' + a hedge in the sentence clears the cap", !after.some((i: any) => /Claim-grade legality/.test(i.text) && /2\.555/.test(i.text)), after.filter((i: any) => /Claim-grade/.test(i.text)).map((i: any) => i.text.slice(0, 300)).join("\n"));
	for (const c of claims) if (c.grade === "disputed") c.tex_context = "blockade leakage $2.555\\times10^{-4}$ at $40$\\,MHz";
	writeFileSync(p, JSON.stringify(claims, null, 1));
	const noHedge = reportIntegrityIssues(d);
	check("grade 'disputed' without a hedge is illegal", noHedge.some((i: any) => /Claim-grade legality/.test(i.text) && /requires a hedge/.test(i.text) && /disputed/.test(i.text)));
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — a dispute is a fact the producer cannot clear." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
