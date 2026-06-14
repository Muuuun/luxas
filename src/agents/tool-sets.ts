/**
 * Tool-set registry — named factories that produce tool arrays for agents.
 */

import { createReadTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
  // PI gets read + grep but stays write-less by design: it audits, it does
  // not produce. Without grep, PI reviewers spawned illustrator agents just
  // to run file-location errands (observed: 6 of 16 illustrator spawns in
  // one session were grep/ls runs).
  pi: (dir) => [createReadTool(dir), createGrepTool(dir)],
  wolfram: () => [createWolframTool()],
  "figure-gen": (dir) => createFigureGenTools(dir),
  // "exit" gives a sub-agent the `finish` tool. Required for typesetter /
  // illustrator / illustrator_write when running under tool_choice="required"
  // providers (Kimi, deepseek-chat — see pickRequireToolChoice). On Anthropic
  // / reasoning models the natural text-only exit works without this; the
  // tool is harmless there.
  exit: () => [createSubAgentFinishTool()],
};

const GrepParams = Type.Object({
  pattern: Type.String({ description: "Extended regex (grep -E) to search for." }),
  path: Type.Optional(Type.String({ description: "Subdirectory or file relative to the project root. Default: whole project." })),
  glob: Type.Optional(Type.String({ description: "Filename filter, e.g. \"*.md\" or \"*.json\". Default: all files." })),
});

/** Read-only search across the project tree. */
function createGrepTool(projectDir: string) {
  return {
    name: "grep",
    label: "Grep (read-only)",
    description:
      "Search project files for a regex; returns matching lines as file:line:text. " +
      "Use to locate a number, section, or claim across notes/, report/, data/ " +
      "without reading whole files. Read-only.",
    parameters: GrepParams,
    async execute(_toolCallId: string, params: { pattern: string; path?: string; glob?: string }) {
      const target = resolve(projectDir, params.path ?? ".");
      if (target !== projectDir && !target.startsWith(projectDir + "/")) {
        return { content: [{ type: "text" as const, text: "grep is restricted to the project directory." }] };
      }
      const args = ["-rnIE", "--exclude-dir=.agent", "--exclude-dir=.git"];
      if (params.glob) args.push(`--include=${params.glob}`);
      args.push(params.pattern, target);
      const r = spawnSync("grep", args, { encoding: "utf-8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
      const out = (r.stdout ?? "").trim();
      const text = out
        ? (out.length > 20_000 ? out.slice(0, 20_000) + "\n…(truncated; narrow the pattern or path)" : out)
        : "(no matches)";
      return { content: [{ type: "text" as const, text }] };
    },
  };
}

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
