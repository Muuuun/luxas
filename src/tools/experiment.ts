/**
 * Run experiment tool — spawns a full coding agent for implementation tasks.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import { nameAgent } from "agentsmelt";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { listFilesRecursive, readFileSafe, smartTruncate } from "../utils.js";
import * as tmux from "../tmux.js";

const ExperimentParams = Type.Object({
  hypothesis: Type.String({ description: "The hypothesis being tested" }),
  task: Type.String({ description: "What code to write and what experiments to run" }),
  thinkingLevel: Type.Optional(Type.String({ description: "Thinking level controls model and reasoning depth. 'off'/'low': fast, minimal reasoning (simple file ops). 'medium' (default): balanced (plotting, standard scripts). 'high': uses strongest model (opus) for complex physics simulations, difficult algorithms, or tasks requiring deep reasoning." })),
});

/**
 * Build full project context for the coding agent — like Claude Code seeing the whole project.
 */
function buildExperimentContext(projectDir: string): string {
  const parts: string[] = [];

  // 1. Project file tree
  const allFiles = listFilesRecursive(projectDir)
    .map(f => f.replace(projectDir + "/", ""))
    .filter(f => !f.startsWith(".agent/") && !f.includes("node_modules"));
  parts.push(`<project_structure>\n${allFiles.join("\n")}\nYou can read any of these files with the read tool.\n</project_structure>`);

  // 2. RESEARCH.md — research goal and user feedback
  const researchMd = readFileSafe(join(projectDir, "RESEARCH.md"));
  if (researchMd) {
    parts.push(`<research_goal readonly="true">\n${smartTruncate(researchMd, 2000)}\n</research_goal>`);
  }

  // 3. Experiment notes
  const expNotes = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (expNotes && expNotes.trim().length > 20) {
    parts.push(`<experiment_notes readonly="true">\n${smartTruncate(expNotes, 3000)}\n</experiment_notes>`);
  }

  // 4. Literature notes
  const litNotes = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (litNotes && litNotes.trim().length > 20) {
    parts.push(`<literature_notes readonly="true">\n${smartTruncate(litNotes, 2000)}\n</literature_notes>`);
  }

  // 5. Agent memory
  const memory = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (memory && memory.trim().length > 20) {
    parts.push(`<agent_memory readonly="true">\n${smartTruncate(memory, 1500)}\n</agent_memory>`);
  }

  // 6. Existing scripts with content preview
  const scriptsDir = join(projectDir, "data", "scripts");
  const scripts = listFilesRecursive(scriptsDir)
    .filter(f => /\.(py|jl|m|sh|ts|js)$/.test(f))
    .slice(0, 12);

  if (scripts.length > 0) {
    parts.push("<existing_scripts>");
    for (const script of scripts) {
      const relPath = script.replace(projectDir + "/", "");
      try {
        const content = readFileSync(script, "utf-8");
        const lines = content.split("\n");
        const preview = lines.slice(0, 60).join("\n");
        const suffix = lines.length > 60 ? `\n... (${lines.length} total lines — use read tool for full file)` : "";
        parts.push(`<script path="${relPath}" lines="${lines.length}">\n${preview}${suffix}\n</script>`);
      } catch {
        parts.push(`<script path="${relPath}">use read tool to view</script>`);
      }
    }
    parts.push("</existing_scripts>");
  }

  // 7. Report structure preview
  const reportTex = readFileSafe(join(projectDir, "report", "report.tex"));
  if (reportTex) {
    const sections = reportTex.split("\n")
      .filter(l => /\\section|\\subsection|\\subsubsection/.test(l))
      .map(l => l.trim());
    if (sections.length > 0) {
      parts.push(`<report_structure readonly="true">\n${sections.join("\n")}\nUse read tool for full content.\n</report_structure>`);
    }
  }

  if (parts.length === 0) return "";

  return [
    ...parts,
    ``,
    `<code_consistency>`,
    `1. REVIEW existing scripts before writing new code. Reuse correct code, fix incorrect code.`,
    `2. In your output, include a "Consistency Check" section listing which scripts you reviewed and whether they were correct.`,
    `</code_consistency>`,
  ].join("\n");
}

export function createExperimentTool(
  projectDir: string,
  workerModel: Model<any>,
  mainModel: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
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
      // thinkingLevel "high" → use opus for complex experiments
      const expModel = thinkingLevel === "high" ? mainModel : workerModel;
      const t0 = Date.now();
      const logFile = tmux.openWindow(`exp: ${params.hypothesis.slice(0, 25)}`);
      let expAgent: Agent | null = null;

      try {
        // Snapshot files before experiment (only track data/ and report/ for new file detection)
        const trackDirs = [join(projectDir, "data"), join(projectDir, "report")];
        const filesBefore = new Set(trackDirs.flatMap(d => listFilesRecursive(d)));

        const rawTools = createCodingTools(cwd);

        // Wrap tools with safety constraints (like Claude Code):
        // 1. edit requires prior read of the file
        // 2. write is blocked for existing files (must use edit)
        // 3. Protected files are read-only
        const readFiles = new Set<string>();
        const protectedFiles = ["report.tex", "references.bib", "notes/literature.md", "notes/experiments.md", "notes/memory.md", "RESEARCH.md"];

        const expTools = rawTools.map((tool: any) => {
          if (tool.name === "read") {
            const origExecute = tool.execute;
            return { ...tool, execute: async (id: string, params: any, signal?: any) => {
              const p = params.path || params.file_path || "";
              readFiles.add(join(cwd, p));
              readFiles.add(p);
              return origExecute(id, params, signal);
            }};
          }
          if (tool.name === "edit") {
            const origExecute = tool.execute;
            return { ...tool, execute: async (id: string, params: any, signal?: any) => {
              const p = params.path || params.file_path || "";
              const abs = join(cwd, p);
              if (protectedFiles.some(f => p.endsWith(f) || abs.endsWith(f))) {
                return { content: [{ type: "text", text: `BLOCKED: ${p} is managed by the supervising agent. Do not modify it.` }] };
              }
              if (!readFiles.has(abs) && !readFiles.has(p)) {
                return { content: [{ type: "text", text: `BLOCKED: You must read ${p} before editing it. Use the read tool first.` }] };
              }
              return origExecute(id, params, signal);
            }};
          }
          if (tool.name === "write") {
            const origExecute = tool.execute;
            return { ...tool, execute: async (id: string, params: any, signal?: any) => {
              const p = params.path || params.file_path || "";
              const abs = join(cwd, p);
              if (protectedFiles.some(f => p.endsWith(f) || abs.endsWith(f))) {
                return { content: [{ type: "text", text: `BLOCKED: ${p} is managed by the supervising agent. Do not modify it.` }] };
              }
              if (existsSync(abs)) {
                return { content: [{ type: "text", text: `BLOCKED: ${p} already exists. Use the edit tool to modify existing files, not write. This prevents regression.` }] };
              }
              return origExecute(id, params, signal);
            }};
          }
          return tool;
        });

        const experimentContext = buildExperimentContext(projectDir);

        const hasStyle = existsSync(join(projectDir, "report", "figstyle.mplstyle"));
        const figStyleLines = hasStyle
          ? [
              `<figure_style>Load report/figstyle.mplstyle before plotting: plt.style.use('${join(projectDir, "report", "figstyle.mplstyle")}'). Save as PDF: fig.savefig('report/figures/fig_name.pdf')</figure_style>`,
            ]
          : [
              `<figure_style>plt.savefig('report/figures/fig_name.pdf', bbox_inches='tight', dpi=300). Prefer PDF. Publication-quality font sizes (≥7pt).</figure_style>`,
            ];

        const systemPrompt = [
          `You are an experiment coding agent. Write code, run simulations, and report results.`,
          ``,
          `<environment>`,
          `<working_directory>${projectDir}</working_directory>`,
          `<paths>`,
          `  <scripts>data/scripts/</scripts>`,
          `  <figures>report/figures/</figures>`,
          `  <runs>data/runs/run_N/</runs>`,
          `</paths>`,
          ...figStyleLines,
          `</environment>`,
          ``,
          `<tools>`,
          `<tool name="read">`,
          `Read file contents. Returns the file with line numbers.`,
          `You MUST read a file before editing it — the edit tool will reject edits to unread files.`,
          `You can read ANY file in the project, including report.tex and notes/ (read-only access).`,
          `For large files, use offset and limit parameters to read specific sections.`,
          `</tool>`,
          `<tool name="edit">`,
          `Make precise changes to existing files using exact string replacement.`,
          `Provide oldText (exact text to find) and newText (replacement).`,
          `The oldText must match EXACTLY — including whitespace, indentation, and line breaks.`,
          `If oldText is not unique in the file, the edit FAILS. Include more surrounding context to make it unique.`,
          `ALWAYS prefer edit over write for existing files. Edit sends a diff; write overwrites everything.`,
          `The tool will REJECT edits to files you haven't read yet, and to protected files.`,
          `</tool>`,
          `<tool name="write">`,
          `Create NEW files only. Will be REJECTED if the file already exists — use edit instead.`,
          `Protected files (report.tex, references.bib, notes/*.md, RESEARCH.md) are always blocked.`,
          `</tool>`,
          `<tool name="bash">`,
          `Run shell commands. Working directory is the project root.`,
          `Use for: running scripts, installing packages, checking output, listing directories.`,
          `Always check output for errors. If a command fails, read the error, fix with edit, retry.`,
          `</tool>`,
          `</tools>`,
          ``,
          `<scope>`,
          `<writable>data/scripts/, data/runs/, report/figures/</writable>`,
          `<read_only>report.tex, references.bib, notes/*.md, RESEARCH.md</read_only>`,
          `You can READ anything in the project. You can only WRITE/EDIT files in the writable paths.`,
          `</scope>`,
          ``,
          `<workflow>`,
          `1. Read existing code and context before writing. Understand what exists.`,
          `2. Keep changes minimal. Fix the bug, don't rewrite the file.`,
          `3. Test your code by running it. Read the output. Fix errors and retry.`,
          `4. When done, report clearly: what you implemented, results, interpretation.`,
          `5. If something fails after multiple attempts, report the failure honestly — don't fabricate results.`,
          `</workflow>`,
        ].join("\n");

        // Context compaction for coding agent — same principle as main agent
        const CODING_COMPACTION_CHARS = 60_000;
        const CODING_KEEP_RECENT = 8;
        const codingTransformContext = async (messages: any[]): Promise<any[]> => {
          const totalChars = messages.reduce((sum: number, m: any) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return sum + content.length;
          }, 0);
          if (totalChars > CODING_COMPACTION_CHARS && messages.length > CODING_KEEP_RECENT + 2) {
            const splitIdx = Math.max(2, messages.length - CODING_KEEP_RECENT);
            const oldMessages = messages.slice(0, splitIdx);
            const recentMessages = messages.slice(splitIdx);
            const toolCalls = oldMessages
              .filter((m: any) => m.role === "assistant")
              .flatMap((m: any) => (m.content || []).filter((c: any) => c.type === "toolCall"))
              .map((c: any) => c.name)
              .filter(Boolean);
            const summary = `[Context compacted: ${oldMessages.length} messages summarized. Tools called: ${[...new Set(toolCalls)].join(", ") || "none"}. Continue from where you left off.]`;
            return [
              messages[0],
              { role: "user", content: summary, timestamp: Date.now() },
              ...recentMessages,
            ];
          }
          return messages;
        };

        expAgent = new Agent({
          initialState: {
            systemPrompt,
            model: expModel,
            thinkingLevel,
            tools: expTools,
          },
          transformContext: codingTransformContext,
          getApiKey,
        });
        nameAgent(expAgent, "experiment", "experiment");

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
      } finally {
        // Collect sub-agent costs — add to parent tracker after completion
        if (trackUsage && expAgent) {
          for (const m of expAgent.state.messages) {
            if ((m as any).role === "assistant" && (m as any).usage) {
              trackUsage((m as any).usage);
            }
          }
        }
      }
    },
  };
}

