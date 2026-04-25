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
import { parseExperimentSections } from "../src/tools/index.js";

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

if (failures === 0) {
  console.log(`\nPASS — finish() gate parser handles all 8 cases`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
