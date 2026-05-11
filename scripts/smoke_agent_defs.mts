#!/usr/bin/env tsx
/**
 * Smoke: agent definitions load and resolve wrappers/builders.
 */
import { loadAgentDefinitions } from "../src/agents/registry.js";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
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
  const sw = buildSafetyWrapper(d.safety);
  const cb = resolveContextBuilder(d.contextBuilder);
  const swTag = d.safety ? (sw ? "OK" : "MISSING") : "(none)";
  const cbTag = d.contextBuilder ? (cb ? "OK" : "MISSING") : "(none)";
  if (d.safety && !sw) failures++;
  if (d.contextBuilder && !cb) failures++;
  console.log(`${name.padEnd(14)} model=${d.model.padEnd(8)} spawn.enabled=${String(d.spawn.enabled).padEnd(5)} spawn.allowedTypes=${JSON.stringify(d.spawn.allowedTypes ?? null).padEnd(50)} safety=${swTag} context=${cbTag} templates=${JSON.stringify(d.templates)}`);
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
