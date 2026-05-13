/**
 * Tool-set registry — named factories that produce tool arrays for agents.
 */

import { createReadTool } from "@mariozechner/pi-coding-agent";
import { createCodingToolsForProject } from "../tools/coding.js";
import { createReportTools } from "../tools/report.js";
import { createWolframTool } from "../tools/wolfram.js";
import { createFigureGenTools } from "../tools/figure-gen.js";
import { createAuthorityEscalationTools } from "../tools/authority-escalation.js";
import { createSubAgentFinishTool } from "../tools/sub-agent-exit.js";

export type ToolSetFactory = (projectDir: string) => any[];

const TOOL_SETS: Record<string, ToolSetFactory> = {
  // "coding" routes through Sisyphus's wrapper so every agent that requests
  // coding tools — including all sub-agents (experiment, tool_impl, …) —
  // gets the hardened bash with default timeout, process-tree kill, and
  // .agent/jobs/<id>/ records. Without this, only brain (which builds its
  // tools via buildResearchTools) was protected.
  coding: (dir) => createCodingToolsForProject(dir),
  report: (dir) => createReportTools(dir),
  authority: (dir) => createAuthorityEscalationTools(dir),
  pi: (dir) => [createReadTool(dir)],
  wolfram: () => [createWolframTool()],
  "figure-gen": (dir) => createFigureGenTools(dir),
  // "exit" gives a sub-agent the `finish` tool. Required for typesetter /
  // illustrator / illustrator_write when running under tool_choice="required"
  // providers (Kimi, deepseek-chat — see pickRequireToolChoice). On Anthropic
  // / reasoning models the natural text-only exit works without this; the
  // tool is harmless there.
  exit: () => [createSubAgentFinishTool()],
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
