/**
 * spawn_agent tool — the single generic tool for spawning sub-agents.
 *
 * Modes:
 *   - Foreground (default): brain blocks until agent finishes, gets result as tool output
 *   - Background (background=true): agent runs async, brain continues working,
 *     result injected via steer() when done
 *   - Parallel (tasks=[]): multiple agents run concurrently, brain blocks until all finish
 */

import { Type } from "@sinclair/typebox";
import type { Agent as AgentType } from "@mariozechner/pi-agent-core";
import { spawnAgent, type SpawnAgentOptions } from "../agents/spawn.js";
import { listAgentDescriptions, getDefinition } from "../agents/registry.js";

/** Track active background agents for observability */
const activeBackgroundAgents = new Map<string, { name: string; task: string; startedAt: number }>();

export function getActiveBackgroundAgents() {
  return [...activeBackgroundAgents.values()];
}

export function createSpawnAgentTool(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
  parentAgentId?: string,
  depth?: number,
  /** Reference to the parent Agent instance — needed for steer() on background completion */
  parentAgent?: AgentType,
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
    background: Type.Optional(Type.Boolean({
      description: "Run in background — you continue working while this agent runs. Results are delivered back as a message when done. Use for long-running tasks (sub-brain, complex experiments) that you don't need to wait for.",
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
    // Sub-agents don't get background capability (no parentAgent ref to steer)
    return createSpawnAgentTool(projectDir, templateVars, getApiKey, trackUsage, parentId, childDepth);
  }

  let bgCounter = 0;

  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    description:
      "Spawn a sub-agent to handle a task. Choose the agent type based on the task.\n\n" +
      "Available agents:\n" + agentCatalog + "\n\n" +
      "For parallel work, use the `tasks` parameter to spawn multiple instances:\n" +
      'spawn_agent(agent="worker", tasks=["read paper A", "read paper B"])\n\n' +
      "For long-running tasks, use `background: true` — you continue working while the agent runs.\n" +
      "Results are delivered back as a message when done. Good for sub-brain research tasks.\n" +
      'spawn_agent(agent="brain", task="investigate sub-topic X in depth", background=true)',
    parameters: SpawnParams,

    async execute(
      _toolCallId: string,
      params: { agent: string; task: string; tasks?: string[]; background?: boolean; thinkingLevel?: string },
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

      if (params.thinkingLevel) {
        const def = getDefinition(params.agent);
        if (params.thinkingLevel !== def.thinkingLevel) {
          if (params.thinkingLevel === "high") {
            baseOpts.modelOverride = "opus";
          }
        }
      }

      // ── Background mode ──
      if (params.background && parentAgent) {
        const bgId = `bg-${++bgCounter}`;
        const taskPreview = params.task.slice(0, 80);
        activeBackgroundAgents.set(bgId, {
          name: params.agent,
          task: taskPreview,
          startedAt: Date.now(),
        });

        // Fire and forget — result delivered via steer()
        spawnAgent({ ...baseOpts, prompt: params.task })
          .then((result) => {
            activeBackgroundAgents.delete(bgId);
            const elapsed = Math.floor(result.elapsed / 1000);
            const icon = result.success ? "✓" : "✗";
            parentAgent.steer({
              role: "user",
              content: [
                `[Background Agent Complete: ${params.agent} ${icon} (${elapsed}s)]`,
                `Task: ${taskPreview}`,
                ``,
                result.output.slice(0, 30_000),
              ].join("\n"),
              timestamp: Date.now(),
            });
          })
          .catch((err) => {
            activeBackgroundAgents.delete(bgId);
            parentAgent.steer({
              role: "user",
              content: `[Background Agent Failed: ${params.agent}] ${err.message}`,
              timestamp: Date.now(),
            });
          });

        return {
          content: [{ type: "text" as const, text: `Background agent "${params.agent}" launched (${bgId}). Continue your work — results will be delivered when done.\nTask: ${taskPreview}` }],
          details: { backgroundId: bgId, success: true },
        };
      }

      // ── Parallel mode ──
      if (params.tasks && params.tasks.length > 0) {
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

      // ── Foreground mode (default) ──
      const result = await spawnAgent({ ...baseOpts, prompt: params.task });
      return {
        content: [{ type: "text" as const, text: result.output }],
        details: { elapsed: result.elapsed, success: result.success },
      };
    },

    _makeSpawnTool: makeSpawnTool,
  };
}
