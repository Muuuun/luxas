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
import { enableTUI } from "./events.js";

// Activate TUI mode — suppresses console output, routes to event bus
enableTUI();

// Determine base directory for projects
const args = process.argv.slice(2);
let baseDir = join(homedir(), "Documents");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--projects-dir" && args[i + 1]) {
    baseDir = args[++i];
  } else if (!args[i].startsWith("--")) {
    baseDir = args[i];
  }
}

if (!existsSync(baseDir)) {
  mkdirSync(baseDir, { recursive: true });
}

// Render the TUI
const { waitUntilExit } = render(<App baseDir={baseDir} />, {
  exitOnCtrlC: true,
});

waitUntilExit().then(() => {
  process.exit(0);
});
