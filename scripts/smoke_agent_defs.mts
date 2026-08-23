#!/usr/bin/env tsx
/**
 * Smoke: agent definitions load and resolve wrappers/builders.
 */
import { loadAgentDefinitions } from "../src/agents/registry.js";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { resolveContextBuilder } from "../src/agents/context-builders.js";

const defs = loadAgentDefinitions();
const checked = ["brain", "experiment", "tool_impl", "tool_review", "typesetter", "contradiction_auditor", "prior_art_auditor"];
let failures = 0;

for (const name of checked) {
  const d = defs.get(name);
  if (!d) {
    console.log(`FAIL missing definition: ${name}`);
    failures++;
    continue;
  }
  const sw = buildSafetyWrapper(d.safety);
  const cb = resolveContextBuilder(d.contextBuilder);
  const swTag = d.safety ? (sw ? "OK" : "MISSING") : "(none)";
  const cbTag = d.contextBuilder ? (cb ? "OK" : "MISSING") : "(none)";
  if (d.safety && !sw) failures++;
  if (d.contextBuilder && !cb) failures++;
  console.log(`${name.padEnd(14)} model=${d.model.padEnd(8)} spawn.enabled=${String(d.spawn.enabled).padEnd(5)} spawn.allowedTypes=${JSON.stringify(d.spawn.allowedTypes ?? null).padEnd(50)} safety=${swTag} context=${cbTag} templates=${JSON.stringify(d.templates)}`);
}

// Every toolSets entry must be a real factory name, or "spawn" (special-cased
// in resolveToolSets and a no-op there: spawn.enabled alone grants the
// spawn tool, spawn.ts:459). An unknown name is only a console warning at spawn time
// and the agent silently runs WITHOUT that capability — observed 2026-08-23:
// prior_art_auditor declared toolSets: [search] (an agent type, not a
// toolSet) and would have spawned with no way to search.
const VALID_TOOL_SETS = new Set(["coding", "report", "authority", "pi", "wolfram", "exit", "figure-gen", "spawn"]);
for (const [name, d] of defs) {
  for (const ts of d.toolSets ?? []) {
    if (!VALID_TOOL_SETS.has(ts)) {
      console.log(`FAIL ${name}: unknown toolSet "${ts}" (valid: ${[...VALID_TOOL_SETS].join(", ")}) — agent would spawn without it`);
      failures++;
    }
  }
  // Every allowedType must name a definition that exists.
  for (const t of d.spawn.allowedTypes ?? []) {
    if (!defs.has(t)) { console.log(`FAIL ${name}: spawn.allowedTypes names unknown agent "${t}"`); failures++; }
  }
}

const exp = defs.get("experiment")!;
for (const n of ["tool_impl", "tool_review"]) {
  if (!exp.spawn.allowedTypes?.includes(n)) {
    console.log(`FAIL experiment.spawn.allowedTypes missing: ${n}`);
    failures++;
  }
}

if (failures === 0) {
  console.log(`\nPASS — ${checked.length} agent defs load & wire up cleanly`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
