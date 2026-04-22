#!/usr/bin/env tsx
/**
 * Entry point for the external harness (scripts/reflect_harness.sh,
 * scripts/reflect_ab.sh) to invoke a meta-agent. Drives the production
 * spawnAgent machinery with the meta-registry's getMetaDefinition as
 * definition resolver, so meta-agents share all the spawn/usage/conversation
 * infrastructure with production agents without a forked spawn module.
 *
 * Usage:
 *   tsx scripts/invoke_meta_agent.mts <agent> <projectDir> <templateVarsJson> [prompt]
 *
 *   <agent>            "reflect" | "reflect_light" | "reflect_evolve"
 *   <projectDir>       working directory the agent edits in (usually a git
 *                      worktree of Sisyphus, prepared by the harness)
 *   <templateVarsJson> JSON object mapping template variable name to string
 *   [prompt]           task prompt. If omitted or "-", read from stdin.
 *
 * Exit code 0 = agent returned; non-zero = spawn failed. The agent's own
 * success/failure is surfaced as stdout + a "success: <bool>" trailer.
 */

import { readFileSync } from "node:fs";
import { spawnAgent } from "../src/agents/spawn.js";
import { getMetaDefinition } from "../src/meta-agents/registry.js";
import { getApiKey } from "../src/auth.js";

function die(msg: string, code = 2): never {
  console.error(`invoke_meta_agent: ${msg}`);
  process.exit(code);
}

const [, , agentName, projectDir, templateVarsJson, promptArg] = process.argv;
if (!agentName || !projectDir || !templateVarsJson) {
  die("usage: invoke_meta_agent.mts <agent> <projectDir> <templateVarsJson> [prompt]");
}

let templateVars: Record<string, string>;
try {
  const parsed = JSON.parse(templateVarsJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die(`templateVarsJson must be a JSON object, got: ${typeof parsed}`);
  }
  templateVars = parsed as Record<string, string>;
} catch (err: any) {
  die(`cannot parse templateVarsJson: ${err?.message ?? err}`);
}

const prompt = (!promptArg || promptArg === "-")
  ? readFileSync(0, "utf-8").trim()
  : promptArg;
if (!prompt) die("prompt is empty (pass as argv or via stdin)");

// Validate the agent name up-front so we fail fast before setting up auth.
getMetaDefinition(agentName);

const result = await spawnAgent({
  name: agentName,
  resolveDefinition: getMetaDefinition,
  templateVars,
  prompt,
  projectDir,
  getApiKey,
});

process.stdout.write(result.output);
if (!result.output.endsWith("\n")) process.stdout.write("\n");
console.error(`\n--- invoke_meta_agent trailer ---`);
console.error(`agent: ${agentName}`);
console.error(`success: ${result.success}`);
console.error(`elapsed_ms: ${result.elapsed}`);
process.exit(result.success ? 0 : 1);
