#!/usr/bin/env tsx
/**
 * smoke_experiment_paths — guard against regression to a flat data/ layout.
 *
 *   1. provref / resultref / litref / mergeRuns / PROVREF surface should be 0
 *      across src/, scripts/, skills/.
 *   2. Bare `data/scripts/` and `data/runs/` (the old flat dirs) should be 0
 *      in agent prompts and tool code — current layout is
 *      `data/experiments/<EID>/scripts|runs/`.
 *   3. init_report scaffold must not reference provref / `\resultref` / PROVREF_USAGE.md.
 *   4. Project init creates data/experiments/, NOT data/scripts/ or data/runs/.
 *
 *   npx tsx scripts/smoke_experiment_paths.mts
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ROOT = "/Users/muqiao/Documents/Sisyphus";

// ── 1. provref surface should be 0 ───────────────────────────────
console.log("1. provref surface across src/, scripts/, skills/");
function grepSurface(pattern: string): string[] {
  try {
    const out = execSync(
      `grep -rEn "${pattern}" src/ scripts/ skills/ 2>/dev/null | grep -v node_modules | grep -v smoke_experiment_paths.mts || true`,
      { cwd: ROOT, encoding: "utf-8" },
    ).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

const provrefHits = grepSurface("provref|resultref|litref|all_results.json|mergeRuns|PROVREF");
check(`provref / resultref / litref / mergeRuns hits = 0`,
  provrefHits.length === 0,
  provrefHits.length ? `\n    ${provrefHits.slice(0, 5).join("\n    ")}` : undefined);

// ── 2. flat data/scripts and data/runs should be 0 (must be per-experiment) ──
console.log("\n2. flat data/scripts, data/runs in source (must be per-experiment)");
const flatHits = grepSurface("data/scripts/|data/runs/")
  .filter(line => !line.includes("data/experiments/"));
check(`data/scripts/ and data/runs/ literal hits = 0`,
  flatHits.length === 0,
  flatHits.length ? `\n    ${flatHits.slice(0, 5).join("\n    ")}` : undefined);

// ── 3. init_report scaffold no longer mentions provref ───────────
console.log("\n3. init_report scaffold");
const initReport = readFileSync(join(ROOT, "src/tools/init-report.ts"), "utf-8");
check("init-report.ts has no provref import",
  !/provref-utils/.test(initReport));
check("init-report.ts has no PROVREF_MANUAL or PROVREF_STY constant",
  !/PROVREF_MANUAL|PROVREF_STY/.test(initReport));
check("init-report.ts scaffold has no \\usepackage{provref}",
  !/\\usepackage\{provref\}/.test(initReport));
check("init-report.ts has no \\resultref or \\litref macro",
  !/\\\\resultref|\\\\litref/.test(initReport));
check("init-report.ts has no PROVREF_USAGE.md write",
  !/PROVREF_USAGE/.test(initReport));

// ── 4. report.ts has no provref pipeline ─────────────────────────
console.log("\n4. report.ts");
const reportTs = readFileSync(join(ROOT, "src/tools/report.ts"), "utf-8");
check("report.ts has no provref import",
  !/provref-utils/.test(reportTs));
check("report.ts has no runProvrefPipeline function",
  !/runProvrefPipeline/.test(reportTs));

// ── 5. provref-utils.ts deleted ──────────────────────────────────
console.log("\n5. provref-utils.ts deleted");
check("src/tools/provref-utils.ts does not exist",
  !existsSync(join(ROOT, "src/tools/provref-utils.ts")));

// ── 6. project init creates data/experiments/, not data/scripts or data/runs ─
console.log("\n6. project init dir layout");
const tmp = mkdtempSync(join(tmpdir(), "luxas-smoke-"));
try {
  // Re-implement the createProject mkdir logic from src/tui/projects.ts:140
  // (we don't import the function to avoid dragging Anthropic SDK init).
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const projectDir = join(tmp, "test-project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "RESEARCH.md"), "# test\n");
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  for (const d of ["data/papers", "data/experiments", "report", "reviews", ".agent"]) {
    mkdirSync(join(projectDir, d), { recursive: true });
  }
  // The actual function is exercised by separate integration tests; here we
  // just assert the source code lists the expected dirs (per-experiment, not flat).
  const projectsTs = readFileSync(join(ROOT, "src/tui/projects.ts"), "utf-8");
  const mkdirLists = projectsTs.match(/for \(const d of \[[^\]]+\]\)/g) ?? [];
  check(`createProject + createProjectShell mkdir lists found (${mkdirLists.length})`,
    mkdirLists.length === 2);
  for (const list of mkdirLists) {
    check(`mkdir list contains "data/experiments": ${list.slice(0, 80)}…`,
      list.includes("data/experiments"));
    check(`mkdir list does NOT contain "data/scripts": ${list.slice(0, 80)}…`,
      !list.includes("data/scripts"));
    check(`mkdir list does NOT contain "data/runs": ${list.slice(0, 80)}…`,
      !list.includes('"data/runs"'));
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// ── 7. context-builders.ts artifact roots use data/experiments ───
console.log("\n7. L3 artifact roots");
const ctxBuilders = readFileSync(join(ROOT, "src/agents/context-builders.ts"), "utf-8");
const rootsLine = ctxBuilders.match(/const roots = \[[^\]]+\]/)?.[0] ?? "";
check("L3 artifact roots include data/experiments",
  rootsLine.includes("data/experiments"));
check("L3 artifact roots do NOT include data/runs",
  !rootsLine.includes('"data/runs"'));

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
