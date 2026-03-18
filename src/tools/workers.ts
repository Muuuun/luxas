/**
 * Dispatch workers tool — parallel lightweight agents for independent tasks.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as tmux from "../tmux.js";

const DispatchParams = Type.Object({
  tasks: Type.Array(Type.Object({
    description: Type.String({ description: "Short description of the task" }),
    prompt: Type.String({ description: "Full instructions for the worker" }),
  }), { description: "List of independent tasks to run in parallel" }),
});

const WORKER_PROMPT = `You are a research worker agent. Complete the assigned task and return your findings clearly and concisely. Focus on extracting and reporting information, not on managing files.`;

export function createDispatchWorkersTool(
  tools: any[],
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
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

        try {
          const worker = new Agent({
            initialState: {
              systemPrompt: WORKER_PROMPT,
              model,
              thinkingLevel: "medium" as any,
              tools,
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
