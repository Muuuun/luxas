#!/usr/bin/env node
/**
 * Sisyphus TUI — interactive research agent dashboard.
 *
 * Usage:
 *   npx tsx src/tui.tsx [projects-dir]
 *   sisyphus tui [--projects-dir <path>]
 *
 * Default projects directory: ~/Documents
 */

import React from "react";
import { render } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import App from "./tui/app.js";

// TODO: TUI needs migration to agent-core event model

// Determine base directory for projects and options
const args = process.argv.slice(2);
let baseDir = join(homedir(), "Documents", "agent_research_reports");
let brainTool: "claude" | "codex" = "claude";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--projects-dir" && args[i + 1]) {
    baseDir = args[++i];
  } else if (args[i] === "--brain" && args[i + 1]) {
    brainTool = args[++i] as "claude" | "codex";
  } else if (!args[i].startsWith("--")) {
    baseDir = args[i];
  }
}

if (!existsSync(baseDir)) {
  mkdirSync(baseDir, { recursive: true });
}

// Render the TUI
const { waitUntilExit } = render(<App baseDir={baseDir} brainTool={brainTool} />, {
  exitOnCtrlC: true,
});

waitUntilExit().then(() => {
  process.exit(0);
});
