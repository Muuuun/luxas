#!/usr/bin/env tsx
/**
 * Smoke: finish() gate over notes/experiments.md Status lines.
 *
 * Ensures the plan-commitment contract enforces:
 *   - Pending sections block finish
 *   - Missing Status lines block finish
 *   - Only `**Status:** Complete` passes (bare or as a list item, `- **Status:** Complete`)
 *   - "Deferred" status (legacy) is unrecognized → parses as `missing` → blocks
 *   - Non-experiment h2 headers (e.g. "## Overview") are exempt
 *   - Missing experiments.md file is not a block (projects without it = fresh)
 *
 * "Deferred" was removed Apr 2026 — brain was using it as escape hatch with
 * weak reasons ("ran out of time") rather than as the intended legitimate
 * scope-reduction marker. Scope reductions now go through plan.md edits.
 *
 * Also: a hash-mismatch refusal prints the recorded hash in full and never the
 * current one (§C78b).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResearchTools, parseExperimentSections, parsePlanSections } from "../src/tools/index.js";
import { evidenceSourcesDigest, priorArtSourcesDigest, reportIntegrityIssues } from "../src/tools/report-integrity.js";

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// ---- 1. All Complete → no blockers ----
{
  const text = `# Experiments

## L2.1 — Code Family Comparison

**Status:** Complete

Body here.

## L2.2 — Syndrome Extraction

**Status:** Complete

More body.`;
  const sections = parseExperimentSections(text);
  console.log(`\n[all complete]`);
  assert(sections.length === 2, "parses 2 sections");
  assert(sections.every(s => s.status === "complete"), "both complete");
}

// ---- 2. One Pending → blocker list contains it ----
{
  const text = `## L2.1 — A

**Status:** Complete

## L2.2 — B

**Status:** Pending

## L2.3 — C

**Status:** Complete`;
  const sections = parseExperimentSections(text);
  const pending = sections.filter(s => s.status === "pending");
  console.log(`\n[one pending]`);
  assert(pending.length === 1 && pending[0].header.startsWith("L2.2"), "L2.2 flagged pending");
}

// ---- 3. Missing Status line → flagged ----
{
  const text = `## L2.1 — A

**Status:** Complete

## L2.2 — B

This section has no status line.

## L2.3 — C

**Status:** Complete`;
  const sections = parseExperimentSections(text);
  const missing = sections.filter(s => s.status === "missing");
  console.log(`\n[missing status]`);
  assert(missing.length === 1 && missing[0].header.startsWith("L2.2"), "L2.2 flagged missing");
}

// ---- 4. "Deferred" status (legacy) parses as `missing` → finish gate blocks ----
{
  const text = `## L2.1 — A

**Status:** Deferred: subsumed by L2.2's efficiency analysis

## L2.2 — B

**Status:** Deferred

## L2.3 — C

**Status:** Complete`;
  const sections = parseExperimentSections(text);
  console.log(`\n[deferred status — legacy, must block]`);
  assert(sections.length === 3, "all 3 sections parsed");
  // Both Deferred variants (with reason, without reason) parse as `missing`
  // since the parser no longer recognizes "Deferred" as a valid status.
  // The finish gate only allows `complete`; missing → block.
  const deferredAttempts = sections.filter(s => s.header.startsWith("L2.1") || s.header.startsWith("L2.2"));
  assert(deferredAttempts.every(s => s.status === "missing"),
    "Deferred (with or without reason) parses as missing — gate blocks");
  assert(sections[2].status === "complete", "Complete still recognized");
}

// ---- 6. Non-experiment h2 (Overview) ignored ----
{
  const text = `## Overview

This is narrative text with no status.

## L2.1 — Real experiment

**Status:** Complete`;
  const sections = parseExperimentSections(text);
  console.log(`\n[non-experiment h2 ignored]`);
  assert(sections.length === 1, "only L2.1 parsed, Overview ignored");
  assert(sections[0].header.startsWith("L2.1"), "correct section parsed");
}

// ---- 7. E_N style (from plan.md) also recognized ----
{
  const text = `## E2 — SE circuit

**Status:** Complete`;
  const sections = parseExperimentSections(text);
  console.log(`\n[E_N style header]`);
  assert(sections.length === 1, "E2 parsed as experiment section");
}

// ---- 8. Empty file / no experiments.md → 0 sections, no block ----
{
  const sections = parseExperimentSections("");
  console.log(`\n[empty file]`);
  assert(sections.length === 0, "empty text → 0 sections");
}

// ---- 9. Status case-insensitive + trailing text tolerated ----
{
  const text = `## L2.1 — A

**Status:** complete   (notes: all pytest passed)`;
  const sections = parseExperimentSections(text);
  console.log(`\n[case + trailing text]`);
  assert(sections[0]?.status === "complete", "lowercase 'complete' parsed");
}

// ---- 10. parsePlanSections: extracts E_N headers ----
{
  console.log(`\n[plan parser]`);
  const plan = `# Research Plan

## Overview
Some narrative.

## Experiment decomposition

### E1
**Question**: foo
### E2
**Question**: bar
### E3 — title with em dash
**Question**: baz
`;
  const ps = parsePlanSections(plan);
  assert(ps.length === 3, "3 E_N sections parsed");
  assert(ps[0].id === "E1" && ps[0].index === 1, "E1 with index 1");
  assert(ps[2].id === "E3" && ps[2].index === 3, "E3 with index 3");
}

// ---- 11. parsePlanSections: ignores h2 / non-E_N h3 ----
{
  console.log(`\n[plan parser ignores non-E_N]`);
  const plan = `## Overview\n### Approach\n### E5\n### Methodology`;
  const ps = parsePlanSections(plan);
  assert(ps.length === 1 && ps[0].id === "E5", "only E5 picked, others skipped");
}

// ---- 12. plan-experiments cross-check: missing L2 section blocks ----
//   This is THE failure mode brain found Apr-25: erase experiments.md sections,
//   call finish, ledger looks clean but plan still names required experiments.
{
  console.log(`\n[plan E_N missing from experiments ledger]`);
  const plan = `## Experiment decomposition\n### E1\n### E2\n### E3\n`;
  const exp = `# Experiment Notes\n\n(All planned experiments removed per PI STOP verdict)\n`;
  const planSecs = parsePlanSections(plan);
  const expSecs = parseExperimentSections(exp);
  assert(planSecs.length === 3, "plan has 3 E_N");
  assert(expSecs.length === 0, "experiments.md has no L2/E sections");
  // The cross-check inside finish would: count plan.length - matching ledger entries
  // = 3 missing → block. We assert the inputs that drive that decision.
  const ledgerKeys = new Set<string>();
  for (const s of expSecs) {
    const m = s.header.match(/^(L2\.\d+|E\d+)/);
    if (m) ledgerKeys.add(m[1]);
  }
  const missing = planSecs.filter(p => !ledgerKeys.has(`L2.${p.index}`) && !ledgerKeys.has(p.id));
  assert(missing.length === 3, "all 3 plan E_N missing from ledger → finish must block");
}

// ---- 13. plan-experiments cross-check: full match passes ----
{
  console.log(`\n[plan E_N all Complete in ledger]`);
  const plan = `### E1\n### E2\n`;
  const exp = `## L2.1 — A\n\n**Status:** Complete\n\n## L2.2 — B\n\n**Status:** Complete\n`;
  const planSecs = parsePlanSections(plan);
  const expSecs = parseExperimentSections(exp);
  const ledgerByKey = new Map<string, string>();
  for (const s of expSecs) {
    const m = s.header.match(/^L2\.(\d+)/);
    if (m) ledgerByKey.set(`L2.${m[1]}`, s.status);
  }
  const allComplete = planSecs.every(p => ledgerByKey.get(`L2.${p.index}`) === "complete");
  assert(allComplete, "all plan E_N matched as Complete → gate passes");
}

// ---- 14. plan-experiments cross-check: E_N in plan but L2 is Pending ----
{
  console.log(`\n[plan E_N exists but ledger says Pending]`);
  const plan = `### E1\n### E2\n`;
  const exp = `## L2.1 — A\n\n**Status:** Complete\n\n## L2.2 — B\n\n**Status:** Pending\n`;
  const planSecs = parsePlanSections(plan);
  const expSecs = parseExperimentSections(exp);
  const ledgerByKey = new Map<string, string>();
  for (const s of expSecs) {
    const m = s.header.match(/^L2\.(\d+)/);
    if (m) ledgerByKey.set(`L2.${m[1]}`, s.status);
  }
  const incomplete = planSecs.filter(p => ledgerByKey.get(`L2.${p.index}`) !== "complete");
  assert(incomplete.length === 1 && incomplete[0].id === "E2", "E2 flagged as Pending");
}

// ---- §C78a. A bulleted status line is a status line ----
//   The offline finish-gate replay (C78) found 5 of 7 plan-commitment refusals
//   in the primary corpus (73 of 94 extended) were ledgers whose sections were
//   Complete but written as a list item, '- **Status:** Complete'. The marker
//   is formatting; the contract (Pending blocks, no line = missing) is unchanged.
{
  console.log(`\n[§C78a bulleted status line]`);
  const exp = [
    "## L2.1 — dash bullet", "", "- **Status:** Complete", "",
    "## L2.2 — star bullet", "", "* **Status:** Pending", "",
    "## L2.3 — no status line", "", "- **Experiment dir:** data/experiments/E3_x/", "",
    "## L2.4 — status only in prose", "", "Set the **Status:** Complete field when done.", "",
    "## L2.5 — indented plus bullet", "", "  + **Status:** Complete", "",
  ].join("\n");
  const s = parseExperimentSections(exp);
  assert(s.length === 5, "5 sections parsed");
  assert(s[0]?.status === "complete", "'- **Status:** Complete' parses as complete");
  assert(s[1]?.status === "pending", "'* **Status:** Pending' parses as pending (still blocks)");
  assert(s[2]?.status === "missing", "section with no status line is still missing");
  assert(s[3]?.status === "missing", "'the **Status:** Complete field' mid-line does not count");
  assert(s[4]?.status === "complete", "indented '+ **Status:** Complete' parses as complete");
}

// ---- §C78b. A hash-mismatch refusal says "does not match", never a prefix ----
//   rb87: 43 of 46 typesetter-md5 refusals read 'recorded md5 61fdb6cb31f8…,
//   current 61fdb6cb31f8…'. The brain had pasted the 12-character prefix into
//   a typesetter_notes.md it wrote itself, so the refusal looked like a match
//   and it retried unchanged. The refusal now prints the recorded hash in full
//   and the current one not at all — printing it would hand a forger the value
//   to paste. Each fixture records a hash that shares the first 12 characters
//   with the current one and differs in every later one.
{
  console.log(`\n[§C78b hash-mismatch refusals: full recorded hash, no current hash]`);
  const twin = (h: string) => h.slice(0, 12) +
    [...h.slice(12)].map((c) => ((parseInt(c, 16) + 1) % 16).toString(16)).join("");
  const proj = () => {
    const d = mkdtempSync(join(tmpdir(), "luxas-c78b-"));
    for (const sub of [".agent", "report", "reviews", "notes"]) mkdirSync(join(d, sub), { recursive: true });
    writeFileSync(join(d, "RESEARCH.md"), "# probe\n");
    return d;
  };
  const finishText = async (d: string) => {
    const { tools } = buildResearchTools(d, { PROJECT_DIR: d }, () => undefined, {});
    const r = await tools.find((t: any) => t.name === "finish").execute("c78b", { summary: "probe" });
    return String(r?.content?.[0]?.text ?? "");
  };
  // The recorded hash in full, an explicit mismatch, and nothing of the current
  // hash beyond the prefix it shares with the recorded one.
  const showsRecordedOnly = (label: string, text: string, recorded: string, current: string) => {
    const first = text.split("\n")[0];
    assert(recorded !== current && recorded.slice(0, 12) === current.slice(0, 12),
      `${label}: fixture hashes share the 12-char prefix and differ`);
    assert(first.includes(recorded), `${label}: first line carries the full recorded hash ${recorded}`);
    assert(/does not match/.test(first), `${label}: first line says the hashes do not match`);
    assert(!first.includes(current.slice(12)), `${label}: the current hash is not printed (a forger could paste it)`);
    assert(!first.includes(`${current.slice(0, 12)}…`), `${label}: no 12-char prefix rendering ('${current.slice(0, 12)}…')`);
    if (!/does not match/.test(first)) console.log(`    got: ${first.slice(0, 240)}`);
  };
  const dirs: string[] = [];

  // Typesetter report.pdf md5, through the real finish tool.
  {
    const d = proj(); dirs.push(d);
    writeFileSync(join(d, "report", "report.pdf"), "%PDF-1.4\n% C78b fixture bytes, not a renderable PDF\n");
    writeFileSync(join(d, "reviews", "contradiction_sweep.md"),
      `---\nstatus: clean\nsources_md5: ${evidenceSourcesDigest(d)}\n---\n\n## Contradictions\n\nNone.\n`);
    const current = createHash("md5").update(readFileSync(join(d, "report", "report.pdf"))).digest("hex");
    const recorded = twin(current);
    writeFileSync(join(d, "reviews", "typesetter_notes.md"),
      `---\nstatus: all-clear\nreport_pdf_md5: ${recorded}\npage_count: 1\npages_audited: 1\n---\n\n## Summary\n\nClean.\n`);
    const text = await finishText(d);
    assert(text.startsWith("Cannot finish: reviews/typesetter_notes.md audited a different report.pdf (recorded md5 "),
      "typesetter: the md5 refusal fires, first-line wording unchanged");
    showsRecordedOnly("typesetter", text, recorded, current);
  }

  // Contradiction-sweep sources_md5, through the real finish tool.
  {
    const d = proj(); dirs.push(d);
    writeFileSync(join(d, "report", "report.pdf"), "%PDF-1.4\n% C78b fixture bytes\n");
    const current = evidenceSourcesDigest(d);
    const recorded = twin(current);
    writeFileSync(join(d, "reviews", "contradiction_sweep.md"),
      `---\nstatus: clean\nsources_md5: ${recorded}\n---\n\n## Contradictions\n\nNone.\n`);
    const text = await finishText(d);
    assert(text.startsWith("Cannot finish: reviews/contradiction_sweep.md swept different source files (recorded sources_md5 "),
      "sweep: the sources_md5 refusal fires, first-line wording unchanged");
    showsRecordedOnly("sweep", text, recorded, current);
  }

  // prior_art.md sources_md5, through reportIntegrityIssues (finish prints
  // its blocking texts verbatim via formatIntegrityIssues).
  {
    const d = proj(); dirs.push(d);
    writeFileSync(join(d, "report", "report.tex"), [
      "\\documentclass{article}", "\\begin{document}",
      "\\begin{abstract}", "We show that the blockade floor sits below the Doppler limit at 297 nm.", "\\end{abstract}",
      "\\end{document}", "",
    ].join("\n"));
    const current = priorArtSourcesDigest(d);
    const recorded = twin(current);
    writeFileSync(join(d, "reviews", "prior_art.md"),
      `---\nstatus: positioned\nsources_md5: ${recorded}\n---\n\n## Claims\n\nNone.\n`);
    const issue = reportIntegrityIssues(d).find((i) => i.blocking && /prior_art\.md audited different sources/.test(i.text));
    assert(!!issue, "prior_art: the stale-sources blocker fires");
    const line = (issue?.text ?? "").split("\n").find((l) => l.includes("prior_art.md audited different sources")) ?? "";
    showsRecordedOnly("prior_art", line, recorded, current);
  }

  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ---- §L1. A document-check refusal names every outstanding check, in clearing order ----
//   blender-02, 2026-10-20 (Opus 5.5 brain): finish() came back one gate per call —
//   sweep stale, then typesetter notes missing, then report.tex edited after the
//   compile. Three refusals; $3.23 of the run's $16.86 came after the first finish().
//   The first line stays the gate's own (FinishEscalation keys on it); when only one
//   check is outstanding the refusal is unchanged.
{
  console.log(`\n[§L1 document-check refusals list every outstanding check]`);
  const proj = () => {
    const d = mkdtempSync(join(tmpdir(), "luxas-l1-"));
    for (const sub of [".agent", "report/figures", "reviews", "notes"]) mkdirSync(join(d, sub), { recursive: true });
    writeFileSync(join(d, "RESEARCH.md"), "# probe\n");
    writeFileSync(join(d, "report", "figures", "a.pdf"), "%PDF-1.4\n% figure\n");
    writeFileSync(join(d, "report", "report.tex"), [
      "\\documentclass{article}", "\\usepackage{graphicx}", "\\begin{document}",
      "Figure~\\ref{fig:a} shows the scene.",
      "\\begin{figure}\\includegraphics{figures/a.pdf}\\caption{Scene.}\\label{fig:a}\\end{figure}",
      "\\end{document}", "",
    ].join("\n"));
    writeFileSync(join(d, "notes", "report_outline.md"), "type: empirical\n\n## The scene renders red and blue\n");
    writeFileSync(join(d, "report", "report.pdf"), "%PDF-1.4\n% L1 fixture bytes, not a renderable PDF\n");
    return d;
  };
  const finishText = async (d: string) => {
    const { tools } = buildResearchTools(d, { PROJECT_DIR: d }, () => undefined, {});
    const r = await tools.find((t: any) => t.name === "finish").execute("l1", { summary: "probe" });
    return String(r?.content?.[0]?.text ?? "");
  };
  const at = (p: string, s: number) => utimesSync(p, s, s);
  const now = Math.floor(Date.now() / 1000);
  const dirs: string[] = [];

  // The blender-02 state: report.tex edited after the compile, sweep stale, no typesetter notes, no PI review.
  {
    const d = proj(); dirs.push(d);
    writeFileSync(join(d, "reviews", "contradiction_sweep.md"),
      `---\nstatus: clean\nsources_md5: ${"0".repeat(32)}\n---\n\n## Contradictions\n\nNone.\n`);
    at(join(d, "report", "report.pdf"), now - 120);
    at(join(d, "report", "report.tex"), now - 60);
    const text = await finishText(d);
    const first = text.split("\n")[0];
    assert(first.startsWith("Cannot finish: reviews/contradiction_sweep.md swept different source files"),
      `the sweep gate refuses first, first line unchanged (got: ${first.slice(0, 120)})`);
    const order = ["compile_latex", "contradiction_auditor", "typesetter", "request_pi_review"];
    const tail = text.slice(first.length);
    const pos = order.map((s) => tail.indexOf(s));
    assert(/still outstanding/.test(tail), "the refusal carries the list of outstanding checks");
    assert(pos.every((p) => p >= 0), `the list names all four steps (${order.map((s, i) => `${s}@${pos[i]}`).join(", ")})`);
    assert(pos.every((p, i) => i === 0 || p > pos[i - 1]), "in clearing order: compile, sweep, typesetter, PI review");
  }

  // Only the typesetter outstanding: the refusal is the gate's own text and nothing else.
  {
    const d = proj(); dirs.push(d);
    at(join(d, "report", "report.tex"), now - 120);
    at(join(d, "report", "report.pdf"), now - 60);
    writeFileSync(join(d, "reviews", "contradiction_sweep.md"),
      `---\nstatus: clean\nsources_md5: ${evidenceSourcesDigest(d)}\n---\n\n## Contradictions\n\nNone.\n`);
    writeFileSync(join(d, "reviews", "pi_feedback.md"), "## Verdict: continue\n\nShip it.\n");
    const text = await finishText(d);
    assert(text.startsWith("Cannot finish: reviews/typesetter_notes.md is missing."), "the typesetter gate refuses");
    assert(!/still outstanding/.test(text), "one outstanding check: no list appended");
  }

  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (failures === 0) {
  console.log(`\nPASS — finish() gate parser + plan-experiments cross-check`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
