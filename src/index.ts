#!/usr/bin/env node
/**
 * Sisyphus CLI — autonomous research agent.
 *
 * Usage:
 *   sisyphus run [project-dir]              Run research on a project
 *   sisyphus run [project-dir] --model opus Use a specific model
 *   sisyphus status [project-dir]           Show project status
 *   sisyphus init [project-dir]             Initialize a new project
 *   sisyphus login                          Authenticate with Anthropic OAuth
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createResearchAgent } from "./agent.js";
import { loginAnthropicOAuth } from "./auth.js";
import * as tmux from "./tmux.js";

const args = process.argv.slice(2);
const command = args[0] ?? "run";

// Parse flags
let projectDir = ".";
let model = "sonnet";
let directive: string | undefined;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    model = args[++i];
  } else if (args[i] === "--directive" && args[i + 1]) {
    directive = args[++i];
  } else if (!args[i].startsWith("--")) {
    projectDir = args[i];
  }
}

projectDir = resolve(projectDir);

if (command === "login") {
  await loginAnthropicOAuth();
  process.exit(0);
}

if (command === "status") {
  showStatus(projectDir);
  process.exit(0);
}

if (command === "init") {
  initProject(projectDir);
  process.exit(0);
}

if (command === "run") {
  await run(projectDir, model, directive);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
console.error("Usage: sisyphus <run|status|init|login> [project-dir] [--model sonnet|opus|haiku]");
process.exit(1);

// ─── Commands ────────────────────────────────────────────

async function run(dir: string, modelName: string, userDirective?: string) {
  // Validate project
  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    console.error(`No RESEARCH.md found in ${dir}`);
    console.error("Create one with your research goal, or run: sisyphus init <dir>");
    process.exit(1);
  }

  const researchGoal = readFileSync(researchFile, "utf-8").trim();
  console.log(`\n📚 Sisyphus — Autonomous Research Agent`);
  console.log(`   Project: ${dir}`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Goal: ${researchGoal.split("\n")[0].slice(0, 80)}`);
  console.log();

  // Create agent
  const { agent, hooks } = createResearchAgent({
    projectDir: dir,
    model: modelName,
  });

  // Tmux observability
  const logFile = tmux.openWindow("sisyphus-main");
  agent.subscribe(tmux.createAgentObserver(logFile));

  // Console progress
  agent.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      const argsPreview = event.args ? JSON.stringify(event.args).slice(0, 60) : "";
      process.stderr.write(`  ✻ ${event.toolName} ${argsPreview}\n`);
    }
    if (event.type === "tool_execution_end") {
      const icon = event.isError ? "✗" : "→";
      process.stderr.write(`  ${icon} ${event.toolName}\n`);
    }
  });

  // Build prompt
  const prompt = userDirective
    ? `Research goal (from RESEARCH.md):\n${researchGoal}\n\nAdditional directive: ${userDirective}`
    : `Research goal (from RESEARCH.md):\n${researchGoal}\n\nStart by reading RESEARCH.md for the full goal, then check literature.md and experiments.md for any existing progress. Proceed with the research.`;

  // Run
  const t0 = Date.now();
  try {
    await agent.prompt(prompt);
  } catch (err: any) {
    console.error(`\n✗ Agent error: ${err.message}`);
  }

  const elapsed = Math.floor((Date.now() - t0) / 1000);
  const cost = hooks.tracker.totalCost.toFixed(4);
  console.log(`\n✓ Done in ${elapsed}s | $${cost} | ${hooks.tracker.totalInputTokens + hooks.tracker.totalOutputTokens} tokens`);

  tmux.closeWindow(logFile, "sisyphus-main", true, Date.now() - t0);
}

function showStatus(dir: string) {
  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    console.log("No RESEARCH.md found. Not a Sisyphus project.");
    return;
  }

  const research = readFileSync(researchFile, "utf-8").trim();
  console.log(`\n📚 Research Goal:\n${research.split("\n").slice(0, 5).join("\n")}\n`);

  const files: [string, string][] = [
    ["literature.md", "Literature notes"],
    ["experiments.md", "Experiment notes"],
    ["report/report.tex", "Report source"],
    ["report/report.pdf", "Compiled report"],
  ];

  for (const [file, label] of files) {
    const path = join(dir, file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const lines = content.split("\n").length;
      console.log(`  ✓ ${label}: ${lines} lines`);
    } else {
      console.log(`  · ${label}: not yet`);
    }
  }

  // Count papers
  const papersDir = join(dir, "data", "papers");
  try {
    const count = readdirSync(papersDir).length;
    console.log(`  📄 Downloaded papers: ${count}`);
  } catch {
    console.log(`  📄 Downloaded papers: 0`);
  }

  console.log();
}

function initProject(dir: string) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "report"), { recursive: true });
  mkdirSync(join(dir, "data", "papers"), { recursive: true });
  mkdirSync(join(dir, "data", "scripts"), { recursive: true });

  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    writeFileSync(researchFile, "# Research Goal\n\nDescribe your research goal here.\n");
    console.log(`Created ${researchFile}`);
  }

  for (const f of ["literature.md", "experiments.md"]) {
    const path = join(dir, f);
    if (!existsSync(path)) {
      const title = f.replace(".md", "").charAt(0).toUpperCase() + f.replace(".md", "").slice(1);
      writeFileSync(path, `# ${title}\n`);
    }
  }

  console.log(`Initialized Sisyphus project at ${dir}`);
}
