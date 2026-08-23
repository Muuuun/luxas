#!/usr/bin/env tsx
/**
 * Drive ONE production sub-agent standalone against a project directory —
 * the same spawnAgent machinery brain uses, with the production registry as
 * the definition resolver. Counterpart of invoke_meta_agent.mts for
 * non-meta agents; exists so an auditor can be exercised on a real report
 * without running a whole research session.
 *
 * Usage:
 *   tsx scripts/invoke_agent.mts <agent> <projectDir> [prompt]
 *
 * Template vars PROJECT_DIR and SEARCH_SCRIPT are filled from the arguments
 * and the Luxas root; pass others via INVOKE_TEMPLATE_VARS='{"K":"v"}'.
 * Prompt from argv, or stdin when omitted / "-".
 */

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnAgent } from "../src/agents/spawn.js";
import { getDefinition } from "../src/agents/registry.js";
import { getApiKey } from "../src/auth.js";

const [, , agentName, projectDirArg, promptArg] = process.argv;
if (!agentName || !projectDirArg) {
  console.error("usage: invoke_agent.mts <agent> <projectDir> [prompt]");
  process.exit(2);
}
const projectDir = resolve(projectDirArg);
const luxasRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const extra = process.env.INVOKE_TEMPLATE_VARS ? JSON.parse(process.env.INVOKE_TEMPLATE_VARS) : {};
const templateVars: Record<string, string> = {
  PROJECT_DIR: projectDir,
  SEARCH_SCRIPT: join(luxasRoot, "skills", "search", "scripts", "search"),
  ...extra,
};

const prompt = (!promptArg || promptArg === "-") ? readFileSync(0, "utf-8").trim() : promptArg;
if (!prompt) { console.error("prompt is empty"); process.exit(2); }

getDefinition(agentName); // fail fast on an unknown agent

const result = await spawnAgent({ name: agentName, resolveDefinition: getDefinition, templateVars, prompt, projectDir, getApiKey });

process.stdout.write(result.output);
if (!result.output.endsWith("\n")) process.stdout.write("\n");
console.error(`\n--- invoke_agent trailer ---\nagent: ${agentName}\nsuccess: ${result.success}\nelapsed_ms: ${result.elapsed}`);
process.exit(result.success ? 0 : 1);
