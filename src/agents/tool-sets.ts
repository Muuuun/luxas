/**
 * Tool-set registry — named factories that produce tool arrays for agents.
 */

import { createCodingTools, createReadTool } from "@mariozechner/pi-coding-agent";
import { createReportTools } from "../tools/report.js";
import { createWolframTool } from "../tools/wolfram.js";
import { createImageGenTool } from "../tools/image-gen.js";

export type ToolSetFactory = (projectDir: string) => any[];

const TOOL_SETS: Record<string, ToolSetFactory> = {
  coding: (dir) => createCodingTools(dir),
  report: (dir) => createReportTools(dir),
  pi: (dir) => [createReadTool(dir)],
  wolfram: () => [createWolframTool()],
  imagegen: (dir) => [createImageGenTool(dir)],
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
