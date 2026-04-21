#!/usr/bin/env tsx
/**
 * Smoke: V5 agent definitions load and resolve wrappers/builders.
 */
import { loadAgentDefinitions } from "../src/agents/registry.js";
import { resolveSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { resolveContextBuilder } from "../src/agents/context-builders.js";

const defs = loadAgentDefinitions();
const checked = ["brain", "experiment", "tool_impl", "tool_review", "typesetter"];
let failures = 0;

for (const name of checked) {
  const d = defs.get(name);
  if (!d) {
    console.log(`FAIL missing definition: ${name}`);
    failures++;
    continue;
  }
  const sw = resolveSafetyWrapper(d.safetyWrapper);
  const cb = resolveContextBuilder(d.contextBuilder);
  const swTag = d.safetyWrapper ? (sw ? "OK" : "MISSING") : "(none)";
  const cbTag = d.contextBuilder ? (cb ? "OK" : "MISSING") : "(none)";
  if (d.safetyWrapper && !sw) failures++;
  if (d.contextBuilder && !cb) failures++;
  console.log(`${name.padEnd(14)} model=${d.model.padEnd(8)} canSpawn=${String(d.canSpawn).padEnd(5)} allowedSpawn=${JSON.stringify(d.allowedSpawn ?? null).padEnd(50)} safety=${swTag} context=${cbTag} templates=${JSON.stringify(d.templates)}`);
}

const exp = defs.get("experiment")!;
for (const n of ["tool_impl", "tool_review"]) {
  if (!exp.allowedSpawn?.includes(n)) {
    console.log(`FAIL experiment.allowedSpawn missing: ${n}`);
    failures++;
  }
}

if (failures === 0) {
  console.log(`\nPASS — ${checked.length} V5 agent defs load & wire up cleanly`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
