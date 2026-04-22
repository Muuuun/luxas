#!/usr/bin/env tsx
/**
 * Smoke: validateSpawnGraph catches cycles at load time, and the real
 * 14 agent definitions form a DAG.
 */

import { loadAgentDefinitions, validateSpawnGraph, type AgentDefinition } from "../src/agents/registry.js";

let failures = 0;

function stubDef(name: string, allowedTypes: string[]): AgentDefinition {
  return {
    name,
    description: "",
    model: "inherit",
    thinkingLevel: "medium",
    toolSets: [],
    templates: [],
    spawn: { enabled: true, allowedTypes },
    systemPromptTemplate: "",
  };
}

// ── Case 1: real agent defs form a DAG ──────────────────────────────────

try {
  const defs = loadAgentDefinitions();
  console.log(`✓ Real agent graph accepted (${defs.size} defs)`);
} catch (err: any) {
  console.log(`✗ Real agent graph rejected: ${err?.message ?? err}`);
  failures++;
}

// ── Case 2: direct 2-cycle (a → b → a) ──────────────────────────────────

{
  const defs = new Map<string, AgentDefinition>([
    ["a", stubDef("a", ["b"])],
    ["b", stubDef("b", ["a"])],
  ]);
  try {
    validateSpawnGraph(defs);
    console.log("✗ 2-cycle (a→b→a) not detected");
    failures++;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("a → b → a")) {
      console.log(`✓ 2-cycle detected: ${msg.split(". ")[0]}`);
    } else {
      console.log(`✗ 2-cycle detected but wrong path: ${msg}`);
      failures++;
    }
  }
}

// ── Case 3: self-loop (a → a) — distinct edge case for path.indexOf ─────

{
  const defs = new Map<string, AgentDefinition>([["a", stubDef("a", ["a"])]]);
  try {
    validateSpawnGraph(defs);
    console.log("✗ self-loop (a→a) not detected");
    failures++;
  } catch (err: any) {
    console.log(`✓ Self-loop detected: ${String(err?.message ?? err).split(". ")[0]}`);
  }
}

// ── Case 4: DAG with diamond (no cycle) is accepted ─────────────────────

{
  const defs = new Map<string, AgentDefinition>([
    ["root", stubDef("root", ["left", "right"])],
    ["left", stubDef("left", ["leaf"])],
    ["right", stubDef("right", ["leaf"])],
    ["leaf", stubDef("leaf", [])],
  ]);
  try {
    validateSpawnGraph(defs);
    console.log("✓ Diamond DAG accepted (root → {left,right} → leaf)");
  } catch (err: any) {
    console.log(`✗ Diamond DAG wrongly rejected: ${err?.message ?? err}`);
    failures++;
  }
}

if (failures === 0) {
  console.log("\nPASS — validateSpawnGraph catches cycles and accepts DAGs");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
