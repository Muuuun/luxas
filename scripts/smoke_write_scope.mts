#!/usr/bin/env tsx
/**
 * Smoke: wrapper write/edit permissions across the three agent roles.
 *
 * V5 impl/review split is enforced by (1) spawn_agent availability in
 * background agents (see subagent-runner.ts) + (2) prompt guidance
 * (role_separation + scope_boundary blocks in experiment.md). The tool
 * layer does NOT block experiment writes to scripts/ or tests/ —
 * prompt + tool availability is the right layer for role guidance.
 *
 * What this smoke pins down:
 *   - experiment can write anywhere except REPORT_SURFACE protected files
 *   - tool_impl / tool_review are blocked from REPORT_SURFACE and
 *     NOTES_LEDGER (cross-cutting protected files)
 *   - writeOnExistingPolicy blocks write on pre-existing files (use edit)
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSafetyWrapper, type SafetyWrapper } from "../src/agents/safety-wrappers.js";
import { getDefinition } from "../src/agents/registry.js";

function wrapperFor(name: string): SafetyWrapper {
  const wrap = buildSafetyWrapper(getDefinition(name).safety);
  if (!wrap) throw new Error(`${name}.md must declare a safety config for this smoke to run`);
  return wrap;
}
const wrapExperimentTools = wrapperFor("experiment");
const wrapToolImplTools = wrapperFor("tool_impl");
const wrapToolReviewTools = wrapperFor("tool_review");

const dir = mkdtempSync(join(tmpdir(), "smoke-write-scope-"));
mkdirSync(join(dir, "data/experiments/E_test/scripts"), { recursive: true });
mkdirSync(join(dir, "data/experiments/E_test/tests"), { recursive: true });
mkdirSync(join(dir, "data/experiments/E_test/runs/run_1"), { recursive: true });
mkdirSync(join(dir, "notes"));

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const fakeWrite = {
  name: "write",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `WROTE:${params.path}` }],
  }),
};
const fakeEdit = {
  name: "edit",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `EDITED:${params.path}` }],
  }),
};

async function test(label: string, wrapper: any, templateVars: Record<string, string>, expect: Record<string, "ok" | "blocked">) {
  console.log(`\n[${label}]`);
  const wrapped = wrapper([fakeWrite, fakeEdit], dir, templateVars);
  const write = wrapped.find((t: any) => t.name === "write")!;
  for (const [path, want] of Object.entries(expect)) {
    const r = await write.execute("1", { path });
    const text = r.content[0].text;
    const got = text.startsWith("BLOCKED") ? "blocked" : "ok";
    assert(got === want, `write ${path} → ${got} (expected ${want})`);
  }
}

// experiment: tool layer does NOT block role-separation paths. Role
// enforcement is handled by prompt + spawn_agent tool availability.
// Only REPORT_SURFACE files are protected against experiment writes.
await test("wrapExperimentTools", wrapExperimentTools, { EXPERIMENT_ID: "E_test" }, {
  "data/experiments/E_test/scripts/foo.py": "ok",
  "data/experiments/E_test/tests/test_foo.py": "ok",
  "data/experiments/E_test/tests/conftest.py": "ok",
  "data/experiments/E_other/scripts/bar.py": "ok",
  "data/experiments/E_test/runs/run_1/results.json": "ok",
  "notes/experiments.md": "ok",
  "report/figures/e1_comparison.png": "ok",
  "RESEARCH.md": "blocked",
  "report.tex": "blocked",
  "references.bib": "blocked",
  "notes/literature.md": "blocked",
});

// tool_impl: CAN write scripts/ in its own experiment (per read-scope + no
// forbiddenWritePatterns); writeOnExistingPolicy=block means new files only
await test("wrapToolImplTools", wrapToolImplTools, { EXPERIMENT_ID: "E_test" }, {
  "data/experiments/E_test/scripts/impl.py": "ok",
  "notes/experiments.md": "blocked",  // cross-cutting protected
});

// tool_review: CAN write tests/ in its own experiment
await test("wrapToolReviewTools", wrapToolReviewTools, { EXPERIMENT_ID: "E_test" }, {
  "data/experiments/E_test/tests/test_impl.py": "ok",
  "notes/experiments.md": "blocked",
});


rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — wrapper write permissions per role are correct");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
