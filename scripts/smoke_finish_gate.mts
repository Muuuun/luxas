#!/usr/bin/env tsx
/**
 * Smoke: finish() gate over notes/experiments.md Status lines.
 *
 * Ensures the plan-commitment contract enforces:
 *   - Pending sections block finish
 *   - Missing Status lines block finish
 *   - Only `**Status:** Complete` passes
 *   - "Deferred" status (legacy) is unrecognized → parses as `missing` → blocks
 *   - Non-experiment h2 headers (e.g. "## Overview") are exempt
 *   - Missing experiments.md file is not a block (projects without it = fresh)
 *
 * "Deferred" was removed Apr 2026 — brain was using it as escape hatch with
 * weak reasons ("ran out of time") rather than as the intended legitimate
 * scope-reduction marker. Scope reductions now go through plan.md edits.
 */
import { parseExperimentSections, parsePlanSections } from "../src/tools/index.js";

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

if (failures === 0) {
  console.log(`\nPASS — finish() gate parser + plan-experiments cross-check`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
