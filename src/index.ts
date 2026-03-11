#!/usr/bin/env node
/**
 * Sisyphus CLI — autonomous research agent.
 *
 * Usage:
 *   sisyphus run "Large Language Model Reasoning"
 *   sisyphus resume
 *   sisyphus status
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Conductor } from "./conductor.js";
import { loadState } from "./state.js";
import { KnowledgeStore } from "./knowledge/store.js";
import type { ToolName } from "./types.js";

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "run": {
      const topic = args[1];
      if (!topic || topic.startsWith("--")) {
        console.error('Error: topic required. Usage: sisyphus run "your topic"');
        process.exit(1);
      }
      const conductor = createConductor(flags);
      conductor.run(topic).catch(fatal);
      break;
    }

    case "resume": {
      const conductor = createConductor(flags);
      conductor.run().catch(fatal);
      break;
    }

    case "refine": {
      const instruction = args[1];
      if (!instruction || instruction.startsWith("--")) {
        console.error('Error: instruction required. Usage: sisyphus refine "add more papers about X"');
        process.exit(1);
      }
      const conductor = createConductor(flags);
      conductor.run(undefined, instruction).catch(fatal);
      break;
    }

    case "status": {
      showStatus(flags["project-dir"] ?? ".");
      break;
    }

    case "tui": {
      // Dynamic import to avoid loading React/Ink for non-TUI commands
      import("./tui.js").catch(fatal);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
Sisyphus — Autonomous Research Agent
Il faut imaginer Sisyphe heureux.

Usage:
  sisyphus run <topic>       Start a new research survey
  sisyphus resume            Resume from last saved state
  sisyphus refine <instr>    Refine/expand existing research with instruction
  sisyphus status            Show current state
  sisyphus tui               Launch interactive TUI dashboard

Options:
  --tool <claude|codex>      Default executor tool (default: claude)
  --brain <claude|codex>     Brain decision-making tool (default: claude)
  --timeout <seconds>        Max timeout per action in seconds (default: 600)
  --project-dir <path>       Project directory (default: .)
`);
}

function showStatus(projectDir: string): void {
  const stateFile = join(projectDir, "research-state.json");
  if (!existsSync(stateFile)) {
    console.log('No research in progress. Run: sisyphus run "your topic"');
    return;
  }

  const state = loadState(projectDir);
  const store = new KnowledgeStore(projectDir);
  const index = store.getIndex();

  console.log(`Topic:        ${state.topic || "N/A"}`);
  console.log(`Status:       ${state.status}`);
  console.log(`Actions:      ${state.actions_taken.length} taken`);
  console.log(`Brain calls:  ${state.total_brain_calls}`);
  console.log(`Exec calls:   ${state.total_executor_calls}`);
  console.log();
  console.log("Paper Funnel:");
  console.log(`  Discovered:   ${index.counts.discovered}`);
  console.log(`  Candidate:    ${index.counts.candidate}`);
  console.log(`  Core:         ${index.counts.core}`);
  console.log(`  Excluded:     ${index.counts.excluded}`);
  console.log(`  Downloaded:   ${index.counts.downloaded}`);
  console.log(`  Extracted:    ${index.counts.extracted}`);
  console.log();
  console.log("Report:");
  const reportsDir = join(projectDir, "data", "reports");
  const hasTex = existsSync(join(reportsDir, "survey_report.tex"));
  const hasBib = existsSync(join(reportsDir, "references.bib"));
  const hasPdf = existsSync(join(reportsDir, "survey_report.pdf"));
  console.log(`  .tex:  ${hasTex ? "YES" : "NO"}`);
  console.log(`  .bib:  ${hasBib ? "YES" : "NO"}`);
  console.log(`  .pdf:  ${hasPdf ? "YES" : "NO"}`);

  if (hasPdf) {
    const pdf = join(reportsDir, "survey_report.pdf");
    console.log(`  Size:  ${statSync(pdf).size.toLocaleString()} bytes`);
  }

  // Show last 5 actions
  if (state.actions_taken.length > 0) {
    console.log();
    console.log("Recent actions:");
    for (const act of state.actions_taken.slice(-5)) {
      const time = new Date(act.timestamp).toLocaleTimeString();
      console.log(`  [${time}] ${act.result.padEnd(7)} ${act.action}: ${act.reason.slice(0, 60)}`);
    }
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      }
    }
  }
  return flags;
}

function createConductor(flags: Record<string, string>): Conductor {
  return new Conductor({
    projectDir: flags["project-dir"] ?? ".",
    tool: (flags["tool"] as ToolName) ?? "claude",
    brainTool: (flags["brain"] as "claude" | "codex") ?? "claude",
    timeout: flags["timeout"] ? parseInt(flags["timeout"], 10) * 1000 : 600_000,
  });
}

function fatal(err: unknown): void {
  console.error("Fatal error:", err);
  process.exit(1);
}

main();
