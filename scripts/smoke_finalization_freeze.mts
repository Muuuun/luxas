#!/usr/bin/env tsx
/**
 * smoke_finalization_freeze — the finalization allow-list must be SATISFIABLE.
 *
 * Both triggers (PI verdict STOP, and the 90% cost freeze) close the tool
 * surface down to "land what exists". A freeze is only correct if every route
 * a finish() gate can demand is still walkable inside it. Twice it was not:
 *
 *  - pp-vs-ss-gate-packing-20260826 exited with three escalation notes.
 *    notes/escalations/finalization-blocked.md: "This is a mutually-inconsistent
 *    constraint between the STOP tool-freeze and the finish gate — it cannot be
 *    resolved inside the current authority." Blocker #4 was a stale
 *    reviews/prior_art.md whose only fix is spawning prior_art_auditor, which
 *    the freeze did not list.
 *
 *  - The 2026-08-28 settling hatch let `experiment` spawn under STOP to settle
 *    a disputed headline quantity, while still freezing the tool_impl /
 *    tool_review that every experiment spawns on turn one (measured: 115 and
 *    139 such spawns across six runs). The hatch could not settle anything.
 *
 * So the invariant is structural, not a list: the allowed set is CLOSED under
 * `spawn.allowedTypes`, and covers every agent a gate message names.
 *
 *   npx tsx scripts/smoke_finalization_freeze.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINALIZATION_TOOLS, finalizationAllowedAgents, finalizationAllows,
} from "../src/hooks.js";
import { loadAgentDefinitions } from "../src/agents/registry.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const defs = loadAgentDefinitions();

const base = finalizationAllowedAgents(false);
const disputed = finalizationAllowedAgents(true);

console.log("1. the allowed set is closed under spawn.allowedTypes");
for (const [label, set] of [["base", base], ["disputed", disputed]] as const) {
  for (const agent of set) {
    const children = defs.get(agent)?.spawn?.allowedTypes ?? [];
    const orphan = children.filter((c) => !set.has(c));
    check(`${label}: ${agent} can spawn everything it declares`, orphan.length === 0,
      `${agent} may spawn [${orphan}] which the freeze blocks`);
  }
}

console.log("\n2. the two regressions that cost two runs");
check("reviewer's figure_auditor is allowed (reviewer spawns it 15x across the six runs)",
  base.has("figure_auditor"));
check("prior_art_auditor is allowed (pp-vs-ss blocker #4)", base.has("prior_art_auditor"));
check("a settling experiment can spawn tool_impl", disputed.has("tool_impl"));
check("a settling experiment can spawn tool_review", disputed.has("tool_review"));

console.log("\n3. the freeze still freezes");
check("search is never allowed", !base.has("search") && !disputed.has("search"));
check("experiment is blocked with a settled claim table", !base.has("experiment"));
check("experiment opens only on a disputed table", disputed.has("experiment"));
check("bash is not a finalization tool", !FINALIZATION_TOOLS.has("bash"));
check("finish/compile/edit are", ["finish", "compile_latex", "edit", "write", "read"]
  .every((t) => FINALIZATION_TOOLS.has(t)));
check("finalizationAllows agrees with the set",
  finalizationAllows("spawn_agent", "typesetter", false) === true &&
  finalizationAllows("spawn_agent", "search", true) === false &&
  finalizationAllows("bash", "", true) === false);

console.log("\n4. every agent a gate BLOCK MESSAGE names is reachable inside the freeze");
// Sources whose strings can reach the brain as a finish()/integrity block.
const GATE_SOURCES = [
  "src/tools/index.ts",
  "src/tools/report-integrity.ts",
  "src/claims-review.ts",
];
const named = new Map<string, string>();
for (const rel of GATE_SOURCES) {
  const body = readFileSync(join(ROOT, rel), "utf-8");
  for (const m of body.matchAll(/spawn_agent\(\s*agent\s*=\s*["'\\]*([a-z_]+)/g)) {
    if (!named.has(m[1])) named.set(m[1], rel);
  }
}
check("found gate messages to check (the scan itself still works)", named.size > 0,
  `scanned ${GATE_SOURCES.join(", ")}`);
for (const [agent, where] of named) {
  const ok = disputed.has(agent);
  check(`${agent} (named by ${where}) is spawnable during finalization`, ok,
    ok ? "" : `a finish() gate tells the brain to spawn ${agent}, and the freeze refuses it — ` +
              `that is the pp-vs-ss deadlock. Add it to FINALIZATION_SEED_AGENTS in src/hooks.ts ` +
              `or stop naming it in the gate.`);
}

summary();
