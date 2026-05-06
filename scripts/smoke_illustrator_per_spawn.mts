#!/usr/bin/env tsx
/**
 * smoke_illustrator_per_spawn — verify the per-spawn illustrator_notes
 * convention works end-to-end:
 *  - context-builders.ts picks the most-recent `reviews/illustrator_notes.*.md`
 *  - falls back to legacy `reviews/illustrator_notes.md` when no per-spawn
 *    files exist (older projects pre-namespacing keep working)
 *  - spawn.ts injects SPAWN_ID into templateVars so {{SPAWN_ID}} resolves
 *
 * Bug C from the BOM debate: a single-writer reviews/illustrator_notes.md
 * meant one bootstrap-illustrator + one regen-illustrator stomped each
 * other, with the bootstrap notes left in place after regen crashed —
 * brain read the stale bootstrap status as if it were the regen result.
 *
 *   npx tsx scripts/smoke_illustrator_per_spawn.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContextBuilder } from "../src/agents/context-builders.js";
import { expandTemplate } from "../src/utils.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

const tmp = mkdtempSync(join(tmpdir(), "luxas-illustrator-spawn-"));
try {
  const reviewsDir = join(tmp, "reviews");
  mkdirSync(reviewsDir, { recursive: true });
  mkdirSync(join(tmp, "data", "experiments"), { recursive: true });
  writeFileSync(join(tmp, "RESEARCH.md"), "# test\n");

  console.log("1. {{SPAWN_ID}} expands via expandTemplate");
  const expanded = expandTemplate(
    "Write to reviews/illustrator_notes.{{SPAWN_ID}}.md",
    { SPAWN_ID: "brain.illustrator-bg-7", PROJECT_DIR: tmp },
  );
  check("template substitution works",
    expanded === "Write to reviews/illustrator_notes.brain.illustrator-bg-7.md",
    `got "${expanded}"`);

  console.log("\n2. context-builders picks the most-recent per-spawn notes file");
  // Write three notes files with different mtimes (older first, latest last).
  const oldFile = join(reviewsDir, "illustrator_notes.illustrator-aaa.md");
  const midFile = join(reviewsDir, "illustrator_notes.illustrator-bbb.md");
  const newFile = join(reviewsDir, "illustrator_notes.illustrator-ccc.md");
  for (const f of [oldFile, midFile, newFile]) {
    writeFileSync(f, `---\nstatus: all-clear\naudited_at: 2025-01-01T00:00:00Z\n---\n# from ${f}\n`);
  }
  const now = Date.now() / 1000;
  utimesSync(oldFile, now - 300, now - 300);
  utimesSync(midFile, now - 60,  now - 60);
  utimesSync(newFile, now,       now);

  // Render reviewer (PI) context — figure_convergence lives in the PI builder.
  const builder = resolveContextBuilder("reviewer");
  if (!builder) throw new Error("reviewer context builder not registered");
  const block = builder(tmp);
  check("convergence block references illustrator audit",
    /figure_convergence/.test(block));
  // The latest file is "all-clear"; convergence should not say "missing".
  check("convergence block did NOT say illustrator_notes.md: missing",
    !/illustrator_notes\.md: missing/.test(block),
    `block excerpt: ${block.slice(0, 400)}`);

  console.log("\n3. legacy fallback: when no per-spawn files exist, use illustrator_notes.md");
  // Wipe the per-spawn files; write a legacy single-path file
  rmSync(oldFile); rmSync(midFile); rmSync(newFile);
  const legacyFile = join(reviewsDir, "illustrator_notes.md");
  writeFileSync(legacyFile, `---\nstatus: all-clear\naudited_at: 2025-01-01T00:00:00Z\n---\n# legacy single-file\n`);
  const block2 = builder!(tmp);
  check("legacy single-path file still consulted",
    !/illustrator_notes\.md: missing/.test(block2),
    `block2 excerpt: ${block2.slice(0, 400)}`);

  console.log("\n4. no notes at all → convergence block reports missing");
  rmSync(legacyFile);
  const block3 = builder!(tmp);
  check("convergence block flags missing illustrator notes",
    /none|missing|figure_convergence/.test(block3));
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
