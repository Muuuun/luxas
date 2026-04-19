#!/usr/bin/env tsx
/**
 * Smoke: V5 role-enforcement write guard.
 *
 * Confirms wrapExperimentTools blocks write/edit to scripts/ and tests/
 * under any experiment dir, while still allowing writes to:
 *   - runs/run_N/results.json (Phase 3 integration output)
 *   - notes/experiments.md (L2 analysis section)
 *   - report/figures/ (Phase 3 figures)
 * tool_impl / tool_review wrappers remain free to write to their own
 * scripts/ or tests/ dirs respectively — those are the sub-agents that
 * V5 forces experiment to delegate to.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  wrapExperimentTools,
  wrapToolImplTools,
  wrapToolReviewTools,
} from "../src/agents/safety-wrappers.js";

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

// experiment: must NOT write to scripts/ or tests/ in any experiment dir,
// but CAN write to runs/, notes/, report/, and new files elsewhere
await test("wrapExperimentTools", wrapExperimentTools, { EXPERIMENT_ID: "E_test" }, {
  "data/experiments/E_test/scripts/foo.py": "blocked",
  "data/experiments/E_test/tests/test_foo.py": "blocked",
  "data/experiments/E_test/tests/conftest.py": "blocked",
  "data/experiments/E_other/scripts/bar.py": "blocked",
  "data/experiments/E_test/runs/run_1/results.json": "ok",
  "notes/experiments.md": "ok",
  "report/figures/e1_comparison.png": "ok",
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

// Edit tool also honors forbidden patterns (pre-existing file created below)
writeFileSync(join(dir, "data/experiments/E_test/scripts/existing.py"), "# seed");
console.log("\n[wrapExperimentTools — edit on scripts/]");
{
  const wrapped = wrapExperimentTools([fakeEdit], dir, { EXPERIMENT_ID: "E_test" });
  const edit = wrapped.find((t: any) => t.name === "edit")!;
  const r = await edit.execute("1", { path: "data/experiments/E_test/scripts/existing.py" });
  assert(r.content[0].text.startsWith("BLOCKED"), "edit scripts/*.py blocked for experiment");
}

rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — V5 role-enforcement write guards hold");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
