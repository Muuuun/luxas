#!/usr/bin/env tsx
/**
 * Smoke: wrapper write/edit permissions across the three agent roles.
 *
 * V5 impl/review split is enforced at three layers:
 *   1. spawn_agent availability — background agents can only delegate to
 *      their declared child types.
 *   2. Prompt guidance — role_separation + scope_boundary blocks spell out
 *      the intent in natural language.
 *   3. Tool-layer allowedWriteRoots — positive whitelist that hard-blocks
 *      writes outside each agent's declared scope. This layer exists
 *      because prompt alone was observed to fail under PI-STEER pressure:
 *      brain / experiment agents can be pushed to bypass the architecture
 *      ("I'll just write the script myself to save time"), and the tool
 *      layer is the last line of defence.
 *
 * What this smoke pins down:
 *   - experiment can write runs/, notes/, report/figures/ but NOT
 *     scripts/ or tests/ (must delegate to tool_impl / tool_review) and
 *     NOT other experiments' dirs.
 *   - tool_impl can write only scripts/ in its own experiment.
 *   - tool_review can write only tests/ in its own experiment.
 *   - REPORT_SURFACE and cross-cutting ledgers remain protected.
 *   - writeOnExistingPolicy blocks write on pre-existing files (use edit).
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
const wrapBrainTools = wrapperFor("brain");
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

// brain: cannot write notes/experiments.md (the experiment-status ledger
// is owned by experiment agents). Other notes/* and report/* paths fine.
// This protection added Apr-25 after brain was observed wiping
// experiments.md sections + fabricating a "PI STOP verdict" to bypass
// finish(). Tool-layer block prevents the audit-ledger erasure path.
await test("wrapBrainTools", wrapBrainTools, {}, {
  "notes/experiments.md": "blocked",      // protected — only experiment agent writes
  "notes/memory.md": "ok",                // brain's scratchpad — fine
  "notes/plan.md": "ok",                  // brain owns plan — fine
  "report/report.tex": "ok",              // brain writes report — fine
  "reviews/pi_pushback.md": "ok",         // brain writes pushback when needed
  "RESEARCH.md": "blocked",               // user-authored, protected
  "data/experiments/E_test/scripts/foo.py": "blocked",  // not in brain's allowedWriteRoots
  "data/experiments/E_test/runs/results.json": "blocked", // ditto
});

// experiment: tool layer enforces role separation. Writes to scripts/
// or tests/ (tool_impl/tool_review territory) are blocked. Writes to
// sibling experiment dirs are blocked (scope_boundary). Only the
// experiment's own runs/, notes/, and report/figures/ are permitted.
await test("wrapExperimentTools", wrapExperimentTools, { EXPERIMENT_ID: "E_test" }, {
  "data/experiments/E_test/scripts/foo.py": "blocked",       // delegate to tool_impl
  "data/experiments/E_test/tests/test_foo.py": "blocked",    // delegate to tool_review
  "data/experiments/E_test/tests/conftest.py": "blocked",    // delegate to tool_review
  "data/experiments/E_other/scripts/bar.py": "blocked",      // sibling experiment out of scope
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
