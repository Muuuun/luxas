/**
 * spawn_agent tool — the single generic tool for spawning sub-agents.
 * Replaces search-agent.ts, workers.ts, and the agent-spawning parts of experiment.ts.
 */

import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";
import { spawnAgent, type SpawnAgentOptions } from "../agents/spawn.js";
import { listAgentDescriptions, getDefinition } from "../agents/registry.js";

export function createSpawnAgentTool(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
  parentAgentId?: string,
  depth?: number,
) {
  // Build agent catalog for the tool description
  const agents = listAgentDescriptions();
  const agentCatalog = agents
    .map(a => `- **${a.name}**: ${a.description}${a.canSpawn ? " (can spawn sub-agents)" : ""}`)
    .join("\n");

  const SpawnParams = Type.Object({
    agent: Type.String({
      description: `Agent type to spawn. Available: ${agents.map(a => a.name).join(", ")}`,
    }),
    task: Type.String({
      description: "The task or prompt for the agent. Be specific about what you want it to do.",
    }),
    tasks: Type.Optional(Type.Array(Type.String(), {
      description: "For parallel execution: array of tasks. Spawns one agent instance per task, runs them concurrently.",
    })),
    thinkingLevel: Type.Optional(Type.String({
      description: 'Override thinking level: "off", "low", "medium", "high". Defaults to the agent definition\'s level.',
    })),
  });

  /**
   * Factory for creating a spawn_agent tool scoped to a specific parent.
   * Used by spawn.ts when canSpawn=true to give sub-agents their own spawn tool.
   */
  function makeSpawnTool(parentId: string, childDepth: number): any {
    return createSpawnAgentTool(projectDir, templateVars, getApiKey, trackUsage, parentId, childDepth);
  }

  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    description:
      "Spawn a sub-agent to handle a task. Choose the agent type based on the task.\n\n" +
      "Available agents:\n" + agentCatalog + "\n\n" +
      "For parallel work, use the `tasks` parameter to spawn multiple instances:\n" +
      'spawn_agent(agent="worker", tasks=["read paper A", "read paper B", "read paper C"])',
    parameters: SpawnParams,

    async execute(
      _toolCallId: string,
      params: { agent: string; task: string; tasks?: string[]; thinkingLevel?: string },
    ) {
      // Validate agent exists
      try {
        getDefinition(params.agent);
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: err.message }],
          details: { success: false },
        };
      }

      const baseOpts: Omit<SpawnAgentOptions, "prompt" | "instanceIndex"> = {
        name: params.agent,
        templateVars,
        projectDir,
        getApiKey,
        trackUsage,
        parentAgentId: parentAgentId ?? "brain",
        depth: depth ?? 0,
        createSpawnTool: makeSpawnTool,
      };

      // Override model if thinkingLevel=high implies opus (handled by definition now)
      // thinkingLevel override is passed via modelOverride only if different from definition
      if (params.thinkingLevel) {
        const def = getDefinition(params.agent);
        if (params.thinkingLevel !== def.thinkingLevel) {
          // High thinking → opus, otherwise use definition default
          if (params.thinkingLevel === "high") {
            baseOpts.modelOverride = "opus";
          }
        }
      }

      if (params.tasks && params.tasks.length > 0) {
        // Parallel mode: spawn one agent per task
        const results = await Promise.all(
          params.tasks.map((task, i) =>
            spawnAgent({ ...baseOpts, prompt: task, instanceIndex: i })
          ),
        );

        const summary = results.map((r, i) => {
          const icon = r.success ? "✓" : "✗";
          const secs = Math.floor(r.elapsed / 1000);
          return `## Task ${i + 1} ${icon} (${secs}s)\n\n${r.output}`;
        }).join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: summary }],
          details: { results },
        };
      }

      // Single mode
      const result = await spawnAgent({ ...baseOpts, prompt: params.task });
      return {
        content: [{ type: "text" as const, text: result.output }],
        details: { elapsed: result.elapsed, success: result.success },
      };
    },

    // Expose factory for spawn.ts to use (avoids circular import)
    _makeSpawnTool: makeSpawnTool,
  };
}
