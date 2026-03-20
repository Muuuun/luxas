/**
 * Dispatch workers tool — parallel lightweight agents for independent tasks.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as tmux from "../tmux.js";
import { createCodingToolsForProject } from "./coding.js";

const DispatchParams = Type.Object({
  tasks: Type.Array(Type.Object({
    description: Type.String({ description: "Short description of the task" }),
    prompt: Type.String({ description: "Full instructions for the worker" }),
  }), { description: "List of independent tasks to run in parallel" }),
});

function buildWorkerPrompt(projectDir: string): string {
  return `You are a research worker agent. Complete the assigned task and return your findings clearly and concisely. Focus on extracting and reporting information, not on managing files.

Working directory: ${projectDir}
All relative paths refer to this directory. When running bash commands, always cd to this directory first.`;
}

export function createDispatchWorkersTool(
  _parentTools: any[],  // kept for API compat; workers now create their own tools
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  projectDir: string,
  trackUsage?: (usage: any) => void,
) {
  return {
    name: "dispatch_workers",
    label: "Dispatch Workers",
    description: "Run multiple independent tasks in parallel using lightweight worker agents. Use for: reading multiple papers simultaneously, searching multiple subtopics, or any batch of independent tasks. Workers return results; you should then update notes/literature.md and notes/experiments.md yourself.",
    parameters: DispatchParams,
    async execute(
      _toolCallId: string,
      params: { tasks: Array<{ description: string; prompt: string }> },
    ) {
      const results = await Promise.all(params.tasks.map(async (task) => {
        const t0 = Date.now();
        const logFile = tmux.openWindow(`w: ${task.description.slice(0, 25)}`);
        let worker: Agent | null = null;

        try {
          // Each worker gets its own tools bound to projectDir (like Claude Code's cwd inheritance)
          const workerTools = createCodingToolsForProject(projectDir);
          worker = new Agent({
            initialState: {
              systemPrompt: buildWorkerPrompt(projectDir),
              model,
              thinkingLevel: "medium" as any,
              tools: workerTools,
            },
            getApiKey,
          });

          if (logFile) {
            worker.subscribe(tmux.createAgentObserver(logFile));
          }

          await worker.prompt(task.prompt);

          const messages = worker.state.messages;
          const lastAssistant = [...messages].reverse().find(
            (m: any) => m.role === "assistant"
          ) as any;
          const output = lastAssistant?.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n") ?? "(no output)";

          const elapsed = Date.now() - t0;
          tmux.closeWindow(logFile, task.description, true, elapsed);

          return { description: task.description, success: true, output: output.slice(0, 20_000), elapsed };
        } catch (err: any) {
          const elapsed = Date.now() - t0;
          tmux.closeWindow(logFile, task.description, false, elapsed);
          return { description: task.description, success: false, output: `Error: ${err.message}`, elapsed };
        } finally {
          // Collect sub-agent costs — add to parent tracker after completion
          if (trackUsage && worker) {
            for (const m of worker.state.messages) {
              if ((m as any).role === "assistant" && (m as any).usage) {
                trackUsage((m as any).usage);
              }
            }
          }
        }
      }));

      const summary = results.map((r, i) => {
        const icon = r.success ? "✓" : "✗";
        const el = Math.floor(r.elapsed / 1000);
        return `## Worker ${i + 1}: ${r.description} ${icon} (${el}s)\n\n${r.output}`;
      }).join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        details: { results },
      };
    },
  };
}
