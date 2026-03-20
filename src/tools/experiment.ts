/**
 * Run experiment tool — spawns a full coding agent for implementation tasks.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { listFilesRecursive, readFileSafe, smartTruncate } from "../utils.js";
import * as tmux from "../tmux.js";

const ExperimentParams = Type.Object({
  hypothesis: Type.String({ description: "The hypothesis being tested" }),
  task: Type.String({ description: "What code to write and what experiments to run" }),
  thinkingLevel: Type.Optional(Type.String({ description: "Thinking level: off, low, medium, high (default: medium)" })),
});

/**
 * Build context from previous experiments so the coding agent can reuse
 * existing code/formulas instead of reimplementing from scratch.
 */
function buildExperimentContext(projectDir: string): string {
  const parts: string[] = [];

  // 1. Existing scripts with content preview
  const scriptsDir = join(projectDir, "data", "scripts");
  const scripts = listFilesRecursive(scriptsDir)
    .filter(f => /\.(py|jl|m|sh|ts|js)$/.test(f))
    .slice(0, 8);

  if (scripts.length > 0) {
    parts.push("### Existing Scripts in data/scripts/");
    for (const script of scripts) {
      const relPath = script.replace(projectDir + "/", "");
      try {
        const content = readFileSync(script, "utf-8");
        const lines = content.split("\n");
        const preview = lines.slice(0, 40).join("\n");
        const suffix = lines.length > 40 ? `\n... (${lines.length} total lines)` : "";
        parts.push(`\n**${relPath}** (${lines.length} lines):\n\`\`\`\n${preview}${suffix}\n\`\`\``);
      } catch {
        parts.push(`\n**${relPath}**: (could not read)`);
      }
    }
  }

  // 2. Experiment notes for context on what was already tested and the formulas used
  const expNotes = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (expNotes && expNotes.trim().length > 20) {
    parts.push(`\n### Experiment Notes (notes/experiments.md)\n${smartTruncate(expNotes, 3000)}`);
  }

  if (parts.length === 0) return "";

  return [
    `## Previous Experiment Context`,
    ...parts,
    ``,
    `**IMPORTANT — Code Consistency Protocol:**`,
    `1. REVIEW existing scripts above. Check their formulas, constants, and methodology for correctness.`,
    `2. If correct → reuse directly (import or copy). Do not reimplement from scratch.`,
    `3. If INCORRECT → explain what is wrong and why, then implement the corrected version.`,
    `4. In your final output, include a section "## Consistency Check" that lists:`,
    `   - Which existing scripts/formulas you reviewed`,
    `   - Whether each was correct or had errors`,
    `   - If errors found: what was wrong, what the correct formula should be, and which previous results may be affected`,
    `   This section is critical — the supervising agent needs it to decide whether to re-run earlier experiments.`,
  ].join("\n");
}

export function createExperimentTool(
  projectDir: string,
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
) {
  return {
    name: "run_experiment",
    label: "Run Experiment",
    description: "Spawn a full coding agent to write code, run simulations, and analyze results. Describe the hypothesis and the task. The coding agent works in data/scripts/ and has bash, read, write, edit tools. It returns results for you to analyze and record in notes/experiments.md.",
    parameters: ExperimentParams,
    async execute(
      _toolCallId: string,
      params: { hypothesis: string; task: string; thinkingLevel?: string },
    ) {
      // Use project root as cwd — coding agents think in project-relative paths
      // (e.g., "data/scripts/foo.py", "data/runs/run_1/"). Restricting cwd to a
      // subdirectory causes path mismatch between the agent's mental model and bash.
      const cwd = projectDir;
      mkdirSync(join(projectDir, "data", "scripts"), { recursive: true });
      mkdirSync(join(projectDir, "report", "figures"), { recursive: true });

      const thinkingLevel = (params.thinkingLevel ?? "medium") as any;
      const t0 = Date.now();
      const logFile = tmux.openWindow(`exp: ${params.hypothesis.slice(0, 25)}`);

      try {
        // Snapshot files before experiment (only track data/ and report/ for new file detection)
        const trackDirs = [join(projectDir, "data"), join(projectDir, "report")];
        const filesBefore = new Set(trackDirs.flatMap(d => listFilesRecursive(d)));

        const expTools = createCodingTools(cwd);
        const experimentContext = buildExperimentContext(projectDir);

        const hasStyle = existsSync(join(projectDir, "report", "figstyle.mplstyle"));
        const figStyleLines = hasStyle
          ? [
              `Figure style: report/figstyle.mplstyle — ALWAYS load it before plotting:`,
              `  import matplotlib.pyplot as plt`,
              `  plt.style.use('${join(projectDir, "report", "figstyle.mplstyle")}')`,
              `Save figures as PDF (vector): fig.savefig('report/figures/fig_name.pdf')`,
            ]
          : [
              `When plotting: use plt.savefig('report/figures/fig_name.pdf', bbox_inches='tight', dpi=300).`,
              `Prefer PDF format. Use publication-quality font sizes (≥7pt).`,
            ];

        const systemPrompt = [
          `You are an experiment coding agent. Write code, run simulations, and report results.`,
          ``,
          `Working directory: ${projectDir}`,
          `Scripts go in: data/scripts/`,
          `Save figures to: report/figures/`,
          `Experiment runs go in: data/runs/run_N/`,
          ...figStyleLines,
        ].join("\n");

        const expAgent = new Agent({
          initialState: {
            systemPrompt,
            model,
            thinkingLevel,
            tools: expTools,
          },
          getApiKey,
        });

        if (logFile) {
          expAgent.subscribe(tmux.createAgentObserver(logFile));
        }

        const prompt = [
          `# Experiment`,
          ``,
          `**Hypothesis:** ${params.hypothesis}`,
          ``,
          `**Task:** ${params.task}`,
          ``,
          ...(experimentContext ? [experimentContext, ``] : []),
          `Write code, run the experiment, and report your findings clearly.`,
          `Include: what you implemented, the results, and your interpretation.`,
        ].join("\n");

        await expAgent.prompt(prompt);

        const messages = expAgent.state.messages;
        const lastAssistant = [...messages].reverse().find(
          (m: any) => m.role === "assistant"
        ) as any;
        const output = lastAssistant?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") ?? "(no output)";

        // Find new files created during experiment
        const filesAfter = trackDirs.flatMap(d => listFilesRecursive(d));
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

