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
import { spawn } from "node:child_process";
import { spawnAgent, type SpawnAgentOptions } from "../agents/spawn.js";
import { listAgentDescriptions, getDefinition } from "../agents/registry.js";
import { addAgent, removeAgent, loadRegistry, isAlive, tryExtractResult } from "../active-agents.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Module-scope: spawn-agent tools are rebuilt per brain turn (see tools/index.ts),
// so a closure-local counter would reset and collide across turns. Keeping this
// at module scope gives every background spawn in the process a unique bg id.
let bgCounter = 0;

export function getActiveBackgroundAgents(projectDir?: string) {
  if (!projectDir) return [];
  return loadRegistry(join(projectDir, ".agent"));
}

/**
 * Helper for callers (pi-agent.ts, runFigures) that need to pass a
 * `createSpawnTool` factory into `spawnAgent` without background capability.
 */
export function createSpawnToolFactory(
  projectDir: string,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
) {
  return (parentId: string, childDepth: number, childAllowedSpawn?: string[]) =>
    createSpawnAgentTool(projectDir, {}, getApiKey, parentId, childDepth, undefined, childAllowedSpawn);
}

export function createSpawnAgentTool(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  parentAgentId?: string,
  depth?: number,
  /** Reference to the parent Agent instance — needed for steer() on background completion */
  parentAgent?: AgentType,
  /** If set, restricts which sub-agent names this parent may spawn. */
  allowedSpawn?: string[],
) {
  const agentDir = join(projectDir, ".agent");
  const luxasRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const allAgents = listAgentDescriptions();
  const agents = allowedSpawn
    ? allAgents.filter(a => allowedSpawn.includes(a.name))
    : allAgents;
  const agentCatalog = agents
    .map(a => `- **${a.name}**: ${a.description}${a.canSpawn ? " (can spawn sub-agents)" : ""}`)
    .join("\n");

  const SpawnParams = Type.Object({
    agent: Type.String({
      description: `Agent type to spawn. Available: ${agents.map(a => a.name).join(", ")}`,
    }),
    task: Type.Optional(Type.String({
      description: "The task or prompt for the agent. Use this OR `tasks` (array form). Required for single/background spawns.",
    })),
    tasks: Type.Optional(Type.Array(Type.String(), {
      description: "For parallel execution: array of tasks. Spawns one agent instance per task, runs them concurrently. Mutually exclusive with a singular `task`.",
    })),
    background: Type.Optional(Type.Boolean({
      description: "Run in background — you continue working while this agent runs. Results are delivered back as a message when done. Use for long-running tasks (sub-brain, complex experiments) that you don't need to wait for.",
    })),
    thinkingLevel: Type.Optional(Type.String({
      description: 'Override thinking level: "off", "low", "medium", "high". Defaults to the agent definition\'s level.',
    })),
    action: Type.Optional(Type.String({
      description: '"spawn" (default) or "status" — query a running background agent\'s recent progress.',
    })),
    id: Type.Optional(Type.String({
      description: 'Agent ID to query status for (e.g. "brain.worker-bg-1"). Required when action="status".',
    })),
    templateVars: Type.Optional(Type.Record(Type.String(), Type.String(), {
      description: 'Per-call template variables substituted into the sub-agent\'s system prompt (e.g. {PAPER_ID: "2301.07041"} for the reader agent). PROJECT_DIR is always injected automatically; do not set it here. Forwarded through to both foreground and background spawns.',
    })),
  });

  /**
   * Factory for creating a spawn_agent tool scoped to a specific parent.
   * Used by spawn.ts when canSpawn=true to give sub-agents their own spawn tool.
   */
  function makeSpawnTool(parentId: string, childDepth: number, childAllowedSpawn?: string[]): any {
    // Sub-agents don't get background capability (no parentAgent ref to steer)
    return createSpawnAgentTool(projectDir, templateVars, getApiKey, parentId, childDepth, undefined, childAllowedSpawn);
  }

  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    description:
      "Spawn a sub-agent to handle a task. Choose the agent type based on the task.\n\n" +
      "Available agents:\n" + agentCatalog + "\n\n" +
      "For parallel work spawning the SAME agent with multiple task strings (shared template vars), use `tasks`:\n" +
      'spawn_agent(agent="worker", tasks=["read paper A", "read paper B"])\n\n' +
      "To spawn multiple instances with DIFFERENT template vars (e.g. one reader per PAPER_ID), emit multiple spawn_agent calls in the same turn — the harness runs tool calls in parallel:\n" +
      'spawn_agent(agent="reader", task="Read paper 2301.07041", templateVars={PAPER_ID: "2301.07041"})\n' +
      'spawn_agent(agent="reader", task="Read paper 2405.12345", templateVars={PAPER_ID: "2405.12345"})\n\n' +
      "For long-running tasks, use `background: true` — you continue working while the agent runs.\n" +
      "Results are delivered back as a message when done. Good for sub-brain research tasks.\n" +
      'spawn_agent(agent="brain", task="investigate sub-topic X in depth", background=true)\n\n' +
      "Common mistakes to avoid:\n" +
      '  ✗ spawn_agent(agent="worker", tasks=[{"task": "..."}])    — `tasks` must be string[], not object[]\n' +
      '  ✗ spawn_agent(action={"type": "spawn", agent: "..."})    — no `action` wrapper; pass fields at top level\n' +
      '  ✗ spawn_agent(agent="worker", task=["a", "b"])            — `task` is a single string; use `tasks` for arrays\n' +
      "If you need to pass multiple sub-instructions to one agent, concatenate them into a single string using " +
      "newlines or bullet points inside `task`.",
    parameters: SpawnParams,

    async execute(
      _toolCallId: string,
      params: { agent: string; task?: string; tasks?: string[]; background?: boolean; thinkingLevel?: string; action?: string; id?: string; templateVars?: Record<string, string> },
    ) {
      // ── Status query ──
      if (params.action === "status" && params.id) {
        const reg = loadRegistry(agentDir);
        const entry = reg.find(a => a.id === params.id);
        if (!entry) {
          return { content: [{ type: "text" as const, text: `No active agent with id "${params.id}".` }], details: { success: false } };
        }
        const alive = isAlive(agentDir, params.id);
        const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000);
        const status = entry.status === "done" ? "done" : entry.status === "failed" ? "failed" : alive ? "running" : "dead";
        const recent = tryExtractResult(entry.conversationFile);
        const lines = [
          `Agent: ${entry.id}`,
          `Status: ${status} (${elapsed}s)`,
          `Task: ${entry.task}`,
          recent ? `\nLast completed turn:\n${recent.slice(0, 5000)}` : "\nNo output yet.",
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { success: true } };
      }

      // Validate agent exists
      try {
        getDefinition(params.agent);
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: err.message }],
          details: { success: false },
        };
      }

      // Normalize `task` / `tasks` into a single list. Downstream code only
      // reads taskList; the string-vs-array distinction is surface syntax.
      const taskList: string[] = params.tasks && params.tasks.length > 0
        ? params.tasks
        : params.task !== undefined
          ? [params.task]
          : [];
      if (taskList.length === 0) {
        return {
          content: [{ type: "text" as const, text: 'spawn_agent: must provide either `task` (string) or `tasks` (non-empty array of strings).' }],
          details: { success: false },
        };
      }
      if (params.background && taskList.length > 1) {
        return {
          content: [{ type: "text" as const, text: 'spawn_agent: `background` mode expects a single task. Spawn each background task with its own call.' }],
          details: { success: false },
        };
      }

      // Enforce allowedSpawn restriction (if parent is scoped)
      if (allowedSpawn && !allowedSpawn.includes(params.agent)) {
        return {
          content: [{ type: "text" as const, text: `Agent "${params.agent}" is not in this agent's allowedSpawn list. Allowed: ${allowedSpawn.join(", ")}.` }],
          details: { success: false },
        };
      }

      // Merge per-call templateVars over the factory defaults (PROJECT_DIR etc).
      // The factory defaults win for PROJECT_DIR to avoid letting a caller
      // redirect the sub-agent at a different project.
      const mergedTemplateVars = {
        ...(params.templateVars ?? {}),
        ...templateVars,
      };
      const baseOpts: Omit<SpawnAgentOptions, "prompt" | "instanceIndex"> = {
        name: params.agent,
        templateVars: mergedTemplateVars,
        projectDir,
        getApiKey,
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

      // ── Background mode — independent process ──
      if (params.background) {
        const task = taskList[0];
        const bgId = `bg-${++bgCounter}`;
        const taskPreview = task.slice(0, 80);
        const agentId = `${parentAgentId ?? "brain"}.${params.agent}-${bgId}`;
        const convFile = join(agentDir, "conversations", `${agentId}.jsonl`);

        // Forward the merged templateVars to the subprocess so background
        // spawns see the same vars as foreground. PROJECT_DIR is re-injected
        // by the subagent-runner and stripped here to keep callers from
        // redirecting the sub-agent at a different project.
        const bgTemplateVars: Record<string, string> = { ...mergedTemplateVars };
        delete bgTemplateVars.PROJECT_DIR;

        const args = [
          "--import=tsx",
          join(luxasRoot, "src", "subagent-runner.ts"),
          "--agent", params.agent,
          "--task", task,
          "--project", projectDir,
          "--id", agentId,
          "--session", convFile,
        ];
        if (Object.keys(bgTemplateVars).length > 0) {
          args.push("--template-vars", JSON.stringify(bgTemplateVars));
        }

        const child = spawn("node", args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        addAgent(agentDir, {
          id: agentId,
          name: params.agent,
          task: taskPreview,
          mode: "background",
          startedAt: Date.now(),
          conversationFile: convFile,
          pid: child.pid,
          status: "running",
        });

        return {
          content: [{ type: "text" as const, text: `Background agent "${params.agent}" launched as independent process (${agentId}, pid=${child.pid}). It will survive if this session crashes.\nTask: ${taskPreview}\nUse spawn_agent(action="status", id="${agentId}") to check progress.` }],
          details: { backgroundId: bgId, agentId, pid: child.pid, success: true },
        };
      }

      // ── Parallel mode ──
      if (taskList.length > 1) {
        const results = await Promise.all(
          taskList.map((task, i) =>
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
      const initialTask = taskList[0];
      let result = await spawnAgent({ ...baseOpts, prompt: initialTask });

      // Auto-review loop: after any foreground experiment completes, spawn
      // the experiment_reviewer to audit its L2 section + results + cited
      // literature. If the reviewer votes revise, re-run the experiment
      // with the feedback injected as a follow-up task. Bounded at 3
      // iterations to cap cost. Replaces the old self-written "### Red
      // team" section — the independent-auditor pattern (same as the
      // tool_impl / tool_review split) prevents template-filling
      // self-deflection.
      if (params.agent === "experiment" && result.success) {
        const experimentId = mergedTemplateVars.EXPERIMENT_ID;
        if (experimentId) {
          const MAX_REVIEW_ITERATIONS = 3;
          for (let round = 1; round <= MAX_REVIEW_ITERATIONS; round++) {
            const reviewResult = await spawnAgent({
              name: "experiment_reviewer",
              projectDir,
              templateVars: { ...mergedTemplateVars },
              prompt:
                `Audit the completed experiment with EXPERIMENT_ID=${experimentId}. ` +
                `Read the matching L2 section in notes/experiments.md, its ` +
                `data/experiments/${experimentId}/runs/run_N/results.json, the referenced ` +
                `raw_data files, and the cited literature fragments under notes/literature.d/. ` +
                `Return a VERDICT: satisfied or VERDICT: revise with actionable FEEDBACK per ` +
                `your system prompt.`,
              getApiKey,
              parentAgentId: `${parentAgentId ?? "brain"}.experiment-review-${round}`,
              depth: (depth ?? 0) + 1,
              createSpawnTool: makeSpawnTool,
            });

            const verdictText = reviewResult.output ?? "";
            const satisfied = /VERDICT:\s*satisfied/i.test(verdictText);
            if (satisfied) {
              result = {
                ...result,
                output:
                  result.output +
                  `\n\n---\n[experiment_reviewer round ${round}: SATISFIED]`,
              };
              break;
            }

            // Extract FEEDBACK block (machine contract with reviewer).
            const feedbackMatch = verdictText.match(/FEEDBACK:\s*([\s\S]*?)$/i);
            const feedback = feedbackMatch ? feedbackMatch[1].trim() : verdictText.trim();

            if (round === MAX_REVIEW_ITERATIONS) {
              result = {
                ...result,
                output:
                  result.output +
                  `\n\n---\n[experiment_reviewer round ${round}: REVISE but iteration cap reached — accepting current state with open issues]\n\nOutstanding reviewer feedback:\n${feedback}`,
              };
              break;
            }

            // Re-run the experiment with feedback as a follow-up task.
            // Tell the experiment agent explicitly to iterate on existing
            // artifacts rather than start fresh.
            const revisionTask =
              `# Revision round ${round} — experiment_reviewer voted REVISE.\n\n` +
              `Your previous run's L2 section + results.json have been audited. ` +
              `Address these issues, iterating on existing data/experiments/${experimentId}/ ` +
              `artifacts (scripts, tests, runs/). Do NOT start from scratch; reuse or extend.\n\n` +
              `## Reviewer feedback\n\n${feedback}\n\n` +
              `## Original task (for reference)\n\n${initialTask}`;
            result = await spawnAgent({ ...baseOpts, prompt: revisionTask });
            if (!result.success) break;
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: result.output }],
        details: { elapsed: result.elapsed, success: result.success },
      };
    },

    _makeSpawnTool: makeSpawnTool,
  };
}
