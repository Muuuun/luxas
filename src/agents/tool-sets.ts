/**
 * Tool-set registry — named factories that produce tool arrays for agents.
 */

import { createReadTool } from "@mariozechner/pi-coding-agent";
import { createCodingToolsForProject } from "../tools/coding.js";
import { createReportTools } from "../tools/report.js";
import { createWolframTool } from "../tools/wolfram.js";
import { createFigureGenTools } from "../tools/figure-gen.js";

export type ToolSetFactory = (projectDir: string) => any[];

const TOOL_SETS: Record<string, ToolSetFactory> = {
  // "coding" routes through Sisyphus's wrapper so every agent that requests
  // coding tools — including all sub-agents (experiment, tool_impl, …) —
  // gets the hardened bash with default timeout, process-tree kill, and
  // .agent/jobs/<id>/ records. Without this, only brain (which builds its
  // tools via buildResearchTools) was protected.
  coding: (dir) => createCodingToolsForProject(dir),
  report: (dir) => createReportTools(dir),
  pi: (dir) => [createReadTool(dir)],
  wolfram: () => [createWolframTool()],
  "figure-gen": (dir) => createFigureGenTools(dir),
};

/**
 * Resolve tool-set names to a flat array of tool instances.
 * Unknown names are silently skipped with a warning.
 */
export function resolveToolSets(names: string[], projectDir: string): any[] {
  const tools: any[] = [];
  for (const name of names) {
    const factory = TOOL_SETS[name];
    if (factory) {
      tools.push(...factory(projectDir));
    } else if (name !== "spawn") {
      // "spawn" is handled by spawn.ts itself; other unknowns are warnings
      console.error(`  Warning: unknown tool-set "${name}", skipping`);
    }
  }
  return tools;
}

export function registerToolSet(name: string, factory: ToolSetFactory): void {
  TOOL_SETS[name] = factory;
}
