/**
 * Smoke test: gate 5g (prior-art positioning) behaves per the novelty debate.
 *
 *   - a contribution sentence with no reviews/prior_art.md      → BLOCK
 *   - audit present, every claim new_regime/new_result          → clean
 *   - audit marks a claim `known`, prior IS in references.bib    → DEMOTION
 *     (blocking, but the message is a one-line wording edit)
 *   - audit marks a claim `known`, prior NOT in references.bib   → BLOCK
 *     (an uncitable prior cannot be applied)
 *   - audit is stale (report.tex edited after)                   → BLOCK
 *   - abstract has no contribution language at all              → gate silent
 *
 * Run:  npx tsx scripts/smoke_prior_art_gate.mts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { reportIntegrityIssues, priorArtSourcesDigest } = await import(join(ROOT, "src/tools/report-integrity.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const CONTRIB = "We show for the first time that the stretched P3/2 pair has a finite on-axis C6 of 9.63 GHz um6.";
const PLAIN = "The on-axis C6 of the stretched P3/2 pair is computed by full diagonalisation.";

function project(abstract: string, bib = "@article{walker2008,\n  author={Walker, Thad G. and Saffman, Mark},\n  title={x},\n  year={2008},\n}\n"): string {
	const dir = mkdtempSync(join(tmpdir(), "luxas-pa-"));
	mkdirSync(join(dir, "report"), { recursive: true });
	mkdirSync(join(dir, "reviews"), { recursive: true });
	mkdirSync(join(dir, "notes"), { recursive: true });
	writeFileSync(join(dir, "report", "report.tex"),
		`\\documentclass{article}\\begin{document}\n\\begin{abstract}\n${abstract}\n\\end{abstract}\n\\section{Body}\nText.\n\\end{document}\n`);
	writeFileSync(join(dir, "report", "references.bib"), bib);
	writeFileSync(join(dir, "notes", "experiments.md"), "## L2.1 — x\n\n**Status:** Complete\n");
	return dir;
}

function audit(dir: string, cls: string, prior: string, status = "positioned", digest?: string): void {
	const md5 = digest ?? priorArtSourcesDigest(dir);
	writeFileSync(join(dir, "reviews", "prior_art.md"),
`---
status: ${status}
sources_md5: ${md5}
claims_audited: 1
known: ${cls === "known" ? 1 : 0}
new_regime: ${cls === "new_regime" ? 1 : 0}
new_method: 0
new_result: 0
reconciliation: 0
---

## Summary
One claim.

## Claims
### C1: ${CONTRIB}
- **Neutral restatement:** on-axis C6 for stretched P3/2 pairs.
- **Closest prior:**
  1. ${prior} — Eq. 12 — non-perturbative C6 for stretched pairs
  2. saffman2010 — §IV.B — review of anisotropic blockade
- **Delta class:** ${cls}
- **Delta:** ${cls === "known" ? "Prior gives the same finite on-axis C6 for this state." : "Prior treats S states; this report covers P3/2 at n=60."}
- **Queries run:** "stretched P3/2 C6 on-axis", "Rydberg pair anisotropy non-perturbative"
- **Wording required:** ${cls === "known" ? "Consistent with ${prior}, the stretched P3/2 pair has a finite on-axis C6 of 9.63 GHz um6." : "as-is"}
`);
}

const texts = (iss: any[]) => iss.map((i) => i.text).join("\n");
const blockersOf = (iss: any[]) => iss.filter((i) => i.blocking && /Prior-art positioning incomplete/.test(i.text));
const demotionsOf = (iss: any[]) => iss.filter((i) => /prior-art audit found already in the literature/.test(i.text));
const dirs: string[] = [];

try {
	{ // no audit → block
		const d = project(CONTRIB); dirs.push(d);
		const iss = reportIntegrityIssues(d);
		check("no audit: contribution sentence BLOCKS", blockersOf(iss).length === 1, texts(iss).slice(0, 200));
		check("no audit: message tells brain to spawn prior_art_auditor", /spawn_agent\(agent="prior_art_auditor"/.test(texts(iss)));
	}
	{ // new_regime → clean
		const d = project(CONTRIB); dirs.push(d); audit(d, "new_regime", "walker2008");
		const iss = reportIntegrityIssues(d);
		check("new_regime: no block", blockersOf(iss).length === 0, texts(blockersOf(iss)).slice(0, 200));
		check("new_regime: no demotion", demotionsOf(iss).length === 0);
		check("new_regime: coverage line present", /Prior-art coverage: 1 contribution/.test(texts(iss)));
	}
	{ // known + citable → demotion
		const d = project(CONTRIB); dirs.push(d); audit(d, "known", "walker2008");
		const iss = reportIntegrityIssues(d);
		check("known+citable: no structural block", blockersOf(iss).length === 0, texts(blockersOf(iss)).slice(0, 200));
		const dem = demotionsOf(iss);
		check("known+citable: DEMOTION issued", dem.length === 1, texts(iss).slice(0, 300));
		check("known+citable: demotion names the prior and the wording", dem.length === 1 && /walker2008/.test(dem[0].text) && /Consistent with/.test(dem[0].text));
		check("known+citable: says reword, not re-research", dem.length === 1 && /reword, do not re-research/.test(dem[0].text));
	}
	{ // known + NOT citable → block
		const d = project(CONTRIB); dirs.push(d); audit(d, "known", "ghost2099");
		const iss = reportIntegrityIssues(d);
		const b = blockersOf(iss);
		check("known+uncitable: BLOCKS with bib instruction", b.length === 1 && b[0].text.includes("is a key in references.bib"), `blockers=${b.length}: ` + texts(b).slice(0, 400));
		check("known+uncitable: no demotion (cannot be applied)", demotionsOf(iss).length === 0);
	}
	{ // stale → block
		const d = project(CONTRIB); dirs.push(d); audit(d, "new_regime", "walker2008", "positioned", "0000deadbeef0000deadbeef0000deadbeef");
		const iss = reportIntegrityIssues(d);
		check("stale audit: BLOCKS", blockersOf(iss).length === 1 && /audited different sources/.test(texts(iss)), texts(iss).slice(0, 200));
	}
	{ // no contribution language → silent
		const d = project(PLAIN); dirs.push(d);
		const iss = reportIntegrityIssues(d);
		check("plain abstract: gate is silent", !/Prior-art/.test(texts(iss)), texts(iss).slice(0, 200));
	}
	{ // POSITIONED wording is still a contribution claim (found live 2026-08-23:
	  // after the auditor's rewording removed "we find that", the gate went
	  // silent on single_photon_Rydberg's stale audit)
		const d = project("Here we compute the residual on-axis C6 of the stretched P3/2 pair beyond the Forster-zero picture of Walker2008."); dirs.push(d);
		const iss = reportIntegrityIssues(d);
		check("positioned 'here we compute' still detected and BLOCKS without audit", blockersOf(iss).length === 1, texts(iss).slice(0, 200));
	}
	{ // Priors written as PROSE (the auditor's real format) resolve by surname+year
		const d = project(CONTRIB); dirs.push(d);
		audit(d, "known", "Walker & Saffman, PRA 77, 032723 (2008)");
		const iss = reportIntegrityIssues(d);
		check("prose prior 'Walker & Saffman … (2008)' resolves to walker2008 → demotion, not bib block",
			blockersOf(iss).length === 0 && demotionsOf(iss).length === 1, texts(iss).slice(0, 300));
	}
	{ // Prose prior with the wrong year must NOT resolve
		const d = project(CONTRIB); dirs.push(d);
		audit(d, "known", "Walker et al. (2019)");
		const iss = reportIntegrityIssues(d);
		const b = blockersOf(iss);
		check("prose prior with mismatched year does not resolve → bib block", b.length === 1 && b[0].text.includes("is a key in references.bib"), texts(b).slice(0, 200));
	}
	{ // Coverage survives the auditor trimming a leading word from the sentence
		const d = project("Crucially, " + CONTRIB); dirs.push(d);
		audit(d, "new_regime", "walker2008"); // header quotes CONTRIB without "Crucially,"
		const iss = reportIntegrityIssues(d);
		check("coverage matches when the audit header drops a leading 'Crucially,'", blockersOf(iss).length === 0, texts(blockersOf(iss)).slice(0, 300));
	}
	{ // Chinese contribution language is detected
		const d = project("我们首次证明拉伸 P3/2 对在轴向具有有限的 C6 值 9.63 GHz um6。"); dirs.push(d);
		const iss = reportIntegrityIssues(d);
		check("zh 首次/我们证明: detected and BLOCKS without audit", blockersOf(iss).length === 1, texts(iss).slice(0, 200));
	}
} finally {
	for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(failures === 0 ? "\nALL PASS — prior-art gate behaves per the debate." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
