/**
 * Smoke: confirm meta-registry plugs into production spawn machinery
 * without any LLM call — just verifies type compatibility + entry-point
 * signature + definition resolution paths.
 */
import { getMetaDefinition } from "../src/meta-agents/registry.js";
import { getDefinition } from "../src/agents/registry.js";
import type { SpawnAgentOptions } from "../src/agents/spawn.js";

// 1. Meta resolver is assignment-compatible with the new option slot.
const metaResolver: SpawnAgentOptions["resolveDefinition"] = getMetaDefinition;
const prodResolver: SpawnAgentOptions["resolveDefinition"] = getDefinition;

// 2. Both registries resolve their own names and throw on the other's.
const reflect = metaResolver!("reflect");
console.log(`  ✓ meta resolves "reflect" → model=${reflect.model}`);

try {
  metaResolver!("brain");
  console.error(`  ✗ meta registry should not know "brain"`);
  process.exit(1);
} catch {
  console.log(`  ✓ meta registry correctly rejects "brain"`);
}

try {
  prodResolver!("reflect");
  console.error(`  ✗ production registry should not know "reflect"`);
  process.exit(1);
} catch {
  console.log(`  ✓ production registry correctly rejects "reflect"`);
}

console.log(`\nPASS — meta-agents slot into src/agents/spawn.ts via resolveDefinition`);
