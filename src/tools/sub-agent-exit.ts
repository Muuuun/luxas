/**
 * `finish` tool for sub-agents whose natural exit ("emit text-only turn,
 * pi-agent-core sees zero tool_use, loop ends") doesn't work under
 * `tool_choice: "required"` providers (Kimi, deepseek-chat, openai chat).
 *
 * Without this tool, those agents loop indefinitely once their actual work
 * is done — every turn must emit a tool call but every legitimate tool
 * call either is blocked (re-writing an already-written output) or does
 * nothing useful. Brain's finish tool exists for a different reason (the
 * elaborate finish gate); this one is the minimal "I'm done, exit" signal.
 *
 * Exit mechanism: the postinstall patch `pi-agent-core-no-tool-retry-guard.sh`
 * extends agent-loop.js to set `hasMoreToolCalls = false` when this tool was
 * called in the current turn, breaking the inner loop. The outer loop then
 * sees no follow-up messages and exits.
 *
 * Claude (anthropic) and reasoning models can still emit a text-only finish
 * turn naturally — `finish()` is harmless there but redundant.
 */

import { Type } from "@sinclair/typebox";

export function createSubAgentFinishTool() {
  return {
    name: "finish",
    label: "Finish",
    description:
      "Signal that your task is complete and exit the agent loop. Call ONCE, " +
      "AFTER you have written your output file(s) per your prompt's workflow. " +
      "Do NOT call this to skip work or as a placeholder tool call. The agent " +
      "loop terminates after this returns; any further tool calls would not run.",
    parameters: Type.Object({
      summary: Type.String({
        description: "One-line summary of what was done (mirrors your prompt's <output_brevity>).",
      }),
    }),
    async execute(_toolCallId: string, params: { summary: string }) {
      return {
        content: [{ type: "text" as const, text: `Finished: ${params.summary}` }],
        details: { success: true },
      };
    },
  };
}
