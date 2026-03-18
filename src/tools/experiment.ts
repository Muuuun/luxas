/**
 * Run experiment tool — spawns a full coding agent for implementation tasks.
 */

import { Type } from "@sinclair/typebox";
import { createAgentSession, createCodingTools } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { listFilesRecursive } from "../utils.js";
import * as tmux from "../tmux.js";

const ExperimentParams = Type.Object({
  hypothesis: Type.String({ description: "The hypothesis being tested" }),
  task: Type.String({ description: "What code to write and what experiments to run" }),
  thinkingLevel: Type.Optional(Type.String({ description: "Thinking level: off, low, medium, high (default: medium)" })),
});

export function createExperimentTool(projectDir: string) {
  return {
    name: "run_experiment",
    label: "Run Experiment",
    description: "Spawn a full coding agent to write code, run simulations, and analyze results. Describe the hypothesis and the task. The coding agent works in data/scripts/ and has bash, read, write, edit tools. It returns results for you to analyze and record in notes/experiments.md.",
    parameters: ExperimentParams,
    async execute(
      _toolCallId: string,
      params: { hypothesis: string; task: string; thinkingLevel?: string },
    ) {
      const cwd = join(projectDir, "data", "scripts");
      mkdirSync(cwd, { recursive: true });

      const thinkingLevel = (params.thinkingLevel ?? "medium") as any;
      const t0 = Date.now();
      const logFile = tmux.openWindow(`exp: ${params.hypothesis.slice(0, 25)}`);

      try {
        // Snapshot files before experiment
        const filesBefore = new Set(listFilesRecursive(cwd));

        const { session } = await createAgentSession({
          cwd,
          tools: createCodingTools(cwd),
          thinkingLevel,
        });

        if (logFile) {
          session.subscribe(tmux.createAgentObserver(logFile));
        }

        const prompt = [
          `# Experiment`,
          ``,
          `**Hypothesis:** ${params.hypothesis}`,
          ``,
          `**Task:** ${params.task}`,
          ``,
          `Write code, run the experiment, and report your findings clearly.`,
          `Include: what you implemented, the results, and your interpretation.`,
          `Working directory: ${cwd}`,
        ].join("\n");

        await session.prompt(prompt);
        const output = session.getLastAssistantText?.() ?? "(no output)";

        // Find new files created during experiment
        const filesAfter = listFilesRecursive(cwd);
        const newFiles = filesAfter.filter(f => !filesBefore.has(f));

        const elapsed = Date.now() - t0;
        tmux.closeWindow(logFile, params.hypothesis, true, elapsed);

        const result = [
          output,
          newFiles.length > 0 ? `\nFiles created/modified:\n${newFiles.map(f => `  - ${f}`).join("\n")}` : "",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: result.slice(0, 50_000) }],
          details: { success: true, newFiles, elapsed },
        };
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        tmux.closeWindow(logFile, params.hypothesis, false, elapsed);
        return {
          content: [{ type: "text" as const, text: `Experiment failed: ${err.message}` }],
          details: { success: false, elapsed },
        };
      }
    },
  };
}

