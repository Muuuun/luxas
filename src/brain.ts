/**
 * Brain — the autonomous decision-making agent.
 *
 * The Brain can issue multiple parallel tasks per step.
 * For example: "download 3 papers in parallel" or
 * "extract paper A on claude while extracting paper B on codex".
 */

import { spawn } from "node:child_process";

// ANSI
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const CLEAR_LINE = "\x1b[2K";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
import { buildBrainContext } from "./state.js";
import type { BrainDecision, TaskSpec } from "./types.js";

const MAX_BRAIN_TIMEOUT = 300_000; // 5 min

export class Brain {
  private projectDir: string;

  constructor(projectDir = ".") {
    this.projectDir = projectDir;
  }

  /**
   * Core method: decide what to do next.
   * Can return 1 task (sequential) or multiple tasks (parallel).
   */
  async decideNextAction(userDirective?: string): Promise<BrainDecision> {
    const context = buildBrainContext(this.projectDir);

    const directiveBlock = userDirective
      ? `\n\nUSER DIRECTIVE (HIGHEST PRIORITY — follow this instruction):\n${userDirective}\n`
      : "";

    const prompt = `You are the autonomous research agent brain for "Sisyphus" — a system that produces comprehensive technology survey reports as LaTeX PDFs with proper citations.

YOUR CURRENT STATE:
${context}${directiveBlock}

YOUR GOAL:
Produce a high-quality LaTeX survey report (compiled to PDF) with proper \\cite{} citations for every claim, benchmark comparison tables, and cross-validation of claims across papers.

PAPER MANAGEMENT:
Papers go through a funnel: discovered → candidate → core → excluded.
Each paper lives in data/papers/{paper_id}/ with meta.json, status.json, extraction.json, source/.
Cross-paper data in data/relations/ (citations.json, claims.json).
Central registry: data/index.json.

AVAILABLE ACTIONS:
- "decompose_topic": Break topic into subtopics → data/topics.json
- "search_papers": Search S2/arXiv, add discovered papers
- "search_more_papers": Search under-covered areas
- "evaluate_papers": Promote discovered/candidate → core or exclude
- "expand_citations": Snowball via S2 citations/references from core papers
- "download_papers": Download source for undownloaded core papers
- "extract_paper": Extract structured info from ONE downloaded core paper
- "extract_more_papers": Continue extracting unextracted core papers
- "extract_figures": Extract images from papers (LaTeX source or PDF) → data/papers/{id}/figures/
- "cross_validate": Compare claims across papers → data/relations/claims.json
- "write_report": Generate LaTeX survey + BibTeX (MUST include figures with \\includegraphics)
- "refine_report": Improve existing report (add figures if missing)
- "compile_report": pdflatex + bibtex → PDF
- "fix_compilation": Fix LaTeX errors and re-compile
- "assess_quality": Check coverage, depth, completeness
- "fill_gaps": Search for papers in under-covered areas
- "define_agent": Define a custom sub-agent for this project (see CUSTOM AGENTS below)
- "custom": Execute a task using a custom agent (must set agent_id)
- "done": Research complete (only when PDF exists and is good)

CUSTOM AGENTS:
You can define project-specific sub-agents with specialized system prompts.
Each agent is reusable across tasks and persisted in data/agents.json.

To DEFINE or UPDATE an agent, use action "define_agent". The executor_prompt must be a JSON:
{
  "id": "agent_id_snake_case",
  "name": "Human-readable Name",
  "description": "What this agent specializes in",
  "system_prompt": "You are an expert in X. You always Y. When analyzing Z, focus on...",
  "default_model": "fast"
}
To UPDATE: use the same "id" — it overwrites the old definition.
To DELETE: use action "define_agent" with "delete": true and the agent id.

The current state shows FULL system_prompt of each agent so you can review and adjust.
If an agent's prompt is producing poor results, UPDATE it with better instructions.

To USE a custom agent, set "agent_id" in the task. The agent's system_prompt
is automatically prepended to the executor_prompt. Example:
{
  "action": "custom",
  "executor_prompt": "Analyze the performance data in data/papers/xxx/extraction.json...",
  "agent_id": "quantum_expert",
  "tool": "claude",
  "model": "fast",
  "timeout": 300
}

You can also use agent_id with standard actions like "extract_paper", "write_report", etc.

WHEN TO CREATE AGENTS:
- When a task requires deep domain knowledge (e.g., "quantum computing gate fidelity expert")
- When you want consistent behavior across multiple similar tasks (e.g., "latex_figure_composer")
- When a specialized persona would produce better results than a generic prompt
- Re-use existing agents instead of creating duplicates — check the Custom Agents section in state
- ITERATE: after using an agent, review results and update its system_prompt if needed

KEY CAPABILITY: PARALLEL TASKS
You can return MULTIPLE tasks to run simultaneously. Use this when:
- Downloading multiple papers → each in its own session
- Extracting multiple papers → each in its own session
- Searching S2 AND arXiv at the same time
- One claude does extraction while another codex does downloading

The system has a SessionPool that can run multiple Claude Code and Codex instances in parallel.

DECISION RULES:
- Look at ACTUAL state, not a fixed sequence
- Be SELECTIVE: 30 well-chosen core papers > 200 tangential ones
- DO NOT loop: if action failed 3+ times, change strategy
- PARALLELIZE aggressively: up to 8 concurrent tasks. If 10 papers need work, create 8 parallel tasks.

QUALITY GUIDELINES (not a fixed pipeline — you decide the order):
- Generally: download → extract → figures → cross-validate → write → compile → review → improve
- But you CAN interleave, go back, skip, or reorder based on actual state
- Don't write report if many core papers are still undownloaded/unextracted
- Extract figures from papers before or alongside writing — report should include key figures
- SELF-REVIEW: after compiling a PDF, always do assess_quality (think model) to read the full report and identify:
  * Weak/shallow sections, missing citations, gaps in coverage
  * Where figures/tables would help, whether comparisons are thorough
  * Then act on the review: fill_gaps, refine_report, extract_figures as needed
- You MUST do at least one self-review cycle before marking done
- NEVER mark done without having read and assessed the compiled report
- If review finds issues, go fix them — search more papers, add figures, rewrite sections

TOOL SELECTION:
- "claude": Claude Code. Use for ALL tasks. Set tool to "claude" for everything.
- "codex": OpenAI Codex. CURRENTLY UNAVAILABLE (rate limited). Do NOT use codex. Set tool to "claude" for all tasks.
- Spread parallel tasks across both "fast" and "think" models to avoid rate limits on one model.

MODEL SELECTION — each task has a "model" field: "cheap", "fast", or "think":
- "cheap" = Haiku — for trivial mechanical tasks: download_papers, compile_report, fix_compilation, expand_citations
- "fast" = Sonnet — for most tasks: search_papers, decompose_topic, extract_paper, extract_more_papers, evaluate_papers
- "think" = Opus — ONLY for deep analysis or creative writing: write_report, refine_report, cross_validate, assess_quality
- DEFAULT to "fast". Use "cheap" for file operations/downloads, "think" only for writing/analysis

FIGURE EXTRACTION RULES:
- BEFORE writing the report, run "extract_figures" on core papers to get images
- For LaTeX source papers: figures are in source/ dir as .png/.pdf/.eps files — copy them to data/papers/{id}/figures/
- For PDF-only papers: use "pdfimages -png paper.pdf fig" to extract embedded images, filter out tiny ones (<10KB)
- Each paper's figures go in data/papers/{id}/figures/ with a manifest.json listing filename + caption
- The report MUST include key figures: architecture diagrams, fabrication process photos, performance comparison charts
- Use \\includegraphics[width=\\columnwidth]{data/papers/{id}/figures/filename.png} in the LaTeX report
- Copy the most important figures to data/reports/figures/ for easier reference
- Each extract_figures task can handle 3-5 papers (cheap model)
- COMPOSITE FIGURES: combine related images from different papers into one figure using LaTeX subcaption:
  \\begin{figure}[htbp]
    \\centering
    \\begin{subfigure}[b]{0.48\\textwidth}
      \\includegraphics[width=\\textwidth]{path/to/fig1.png}
      \\caption{Description from Paper A}
    \\end{subfigure}
    \\hfill
    \\begin{subfigure}[b]{0.48\\textwidth}
      \\includegraphics[width=\\textwidth]{path/to/fig2.png}
      \\caption{Description from Paper B}
    \\end{subfigure}
    \\caption{Comparison of approaches. (a) from \\cite{A}, (b) from \\cite{B}}
  \\end{figure}
- Use composite figures to compare: fabrication processes, trap architectures, performance metrics across papers

EXTRACTION RULES:
- Each extract_paper task should handle ONE paper only
- For large documents (theses, surveys >50 pages), split into MULTIPLE parallel extract tasks:
  - One task per major section/chapter (e.g., "extract chapters 1-3", "extract chapters 4-6")
  - Each task writes partial results to data/papers/{id}/extraction_part_N.json
  - A final merge task combines all parts into extraction.json
- For normal papers (<30 pages), one extract task is sufficient
- The executor prompt MUST tell claude to read the paper source from data/papers/{paper_id}/source/
- After extraction, write extraction.json and update status.json with extracted:true

DOWNLOAD RULES (CRITICAL — previous downloads failed due to empty dirs):
- Papers are stored in data/papers/{paper_id}/source/
- A paper with an empty source/ dir is NOT downloaded — it MUST be retried
- For arXiv papers: try LaTeX source first (https://arxiv.org/src/{id}), then PDF (https://arxiv.org/pdf/{id}.pdf)
- For non-arXiv papers: try DOI link, or search for PDF on the web
- ALWAYS verify the download succeeded: check that source/ dir has at least one file (*.tex or *.pdf)
- If download fails, remove the empty source/ dir so the system knows to retry
- Add a 2-second delay between arXiv downloads to avoid rate limiting
- Each download task should handle at most 2-3 papers to avoid timeouts

EXECUTOR PROMPT RULES:
- Each prompt must be SELF-CONTAINED (file paths, API URLs, schemas)
- When adding papers: write meta.json + status.json to data/papers/{paper_id}/
- When extracting: write extraction.json to data/papers/{paper_id}/
- Paper IDs with / should be replaced with _ in directory names
- Always tell executor to update data/index.json

Return ONLY a JSON object (no markdown fences):
{
  "reason": "why these actions based on current state",
  "done": false,
  "tasks": [
    {
      "action": "action_name",
      "executor_prompt": "complete prompt for executor",
      "tool": "claude",
      "model": "fast",
      "timeout": 600,
      "agent_id": "optional_agent_id"
    }
  ]
}

For parallel work, include multiple tasks:
{
  "reason": "downloading + extracting in parallel",
  "done": false,
  "tasks": [
    {"action": "download_papers", "executor_prompt": "download papers...", "tool": "claude", "model": "cheap", "timeout": 300},
    {"action": "extract_paper", "executor_prompt": "extract paper X...", "tool": "claude", "model": "fast", "timeout": 600, "agent_id": "domain_expert"},
    {"action": "extract_paper", "executor_prompt": "extract paper Y...", "tool": "claude", "model": "fast", "timeout": 600, "agent_id": "domain_expert"}
  ]
}

If research is complete:
{
  "reason": "PDF report exists with good quality",
  "done": true,
  "tasks": []
}`;

    console.log("[brain] Deciding next action...");
    const result = await this.callClaude(prompt);
    const decision = this.parseDecision(result);

    if (decision.tasks.length > 1) {
      console.log(`[brain] Decision: ${decision.tasks.length} parallel tasks — ${decision.reason}`);
      for (const t of decision.tasks) {
        console.log(`  [${t.tool}] ${t.action}`);
      }
    } else if (decision.tasks.length === 1) {
      console.log(`[brain] Decision: ${decision.tasks[0].action} — ${decision.reason}`);
    } else if (decision.done) {
      console.log(`[brain] Decision: DONE — ${decision.reason}`);
    }

    return decision;
  }

  /**
   * After executor runs, evaluate what happened.
   */
  async evaluateResult(actions: string[], outputs: string[]): Promise<string> {
    const context = buildBrainContext(this.projectDir);

    const taskSummary = actions
      .map((a, i) => `Action: ${a}\nOutput (last 1000 chars): ${outputs[i]?.slice(-1000) ?? "no output"}`)
      .join("\n---\n");

    const prompt = `You just executed ${actions.length} task(s) in a research survey system.

Current state after execution:
${context}

Task results:
${taskSummary}

In 2-3 sentences, assess: what succeeded? What failed? What changed?
Return plain text, not JSON.`;

    return (await this.callClaude(prompt)) || "Could not evaluate result.";
  }

  private callClaude(prompt: string): Promise<string> {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(
        "claude",
        ["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-4-6"],
        {
          cwd: this.projectDir,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: MAX_BRAIN_TIMEOUT,
        },
      );

      let stdout = "";
      let resultText = "";
      let frame = 0;

      // Spinner timer
      const spinner = setInterval(() => {
        frame++;
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        const icon = CYAN + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + RESET;
        process.stderr.write(`\r${CLEAR_LINE}${icon} ${DIM}[brain] thinking... ${el}s${RESET}`);
      }, 200);

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Parse stream-json events for live status
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            const status = this.parseBrainEvent(evt);
            if (status) {
              const el = ((Date.now() - t0) / 1000).toFixed(0);
              const icon = CYAN + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + RESET;
              process.stderr.write(`\r${CLEAR_LINE}${icon} ${DIM}[brain ${el}s]${RESET} ${status}`);
            }
            // Capture result
            if (evt.type === "result" && evt.result) {
              resultText = evt.result;
            }
          } catch {
            // partial JSON line
          }
        }
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          process.stderr.write(`\r${CLEAR_LINE}${DIM}[brain] ${line.slice(0, 120)}${RESET}`);
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on("close", (code) => {
        clearInterval(spinner);
        process.stderr.write(`\r${CLEAR_LINE}`);
        process.stderr.write("\n");
        const output = resultText || stdout.trim();
        if (code !== 0 && !output) {
          console.warn(`[brain] Claude exited with code ${code}`);
          resolve("");
        } else {
          resolve(output);
        }
      });

      child.on("error", (err: any) => {
        clearInterval(spinner);
        process.stderr.write(`\r${CLEAR_LINE}\n`);
        console.warn(`[brain] Claude call failed: ${err.message?.slice(0, 300)}`);
        resolve("");
      });
    });
  }

  /**
   * Parse stream-json events from Brain's claude call for live display.
   */
  private parseBrainEvent(evt: any): string | null {
    if (!evt?.type) return null;

    if (evt.type === "assistant" && evt.message?.content) {
      for (const part of evt.message.content) {
        if (part.type === "thinking" && part.thinking) {
          // Show first meaningful line of thinking
          const lines = part.thinking.trim().split("\n");
          // Find last non-empty line (most recent thought)
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.length > 10) return `🧠 ${line.slice(0, 100)}`;
          }
        }
        if (part.type === "text" && part.text) {
          const line = part.text.trim().split("\n")[0].slice(0, 100);
          if (line) return `💬 ${line}`;
        }
      }
    }

    if (evt.type === "rate_limit_event") {
      const info = evt.rate_limit_info;
      if (info?.status === "rejected") return "⚠ Rate limited!";
    }

    return null;
  }

  private parseDecision(text: string): BrainDecision {
    try {
      const trimmed = text.trim();
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}") + 1;
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(trimmed.slice(start, end));

        // Handle both old format (single task) and new format (tasks array)
        if (parsed.tasks && Array.isArray(parsed.tasks)) {
          return {
            reason: parsed.reason ?? "",
            done: parsed.done ?? false,
            tasks: parsed.tasks.map((t: any) => ({
              action: t.action ?? "assess_quality",
              executor_prompt: t.executor_prompt ?? "",
              tool: t.tool ?? "claude",
              model: t.model ?? "fast",
              timeout: t.timeout ?? 600,
              agent_id: t.agent_id,
            })),
          };
        }

        // Legacy single-task format
        if (parsed.action) {
          return {
            reason: parsed.reason ?? "",
            done: parsed.done ?? false,
            tasks: parsed.done ? [] : [{
              action: parsed.action,
              executor_prompt: parsed.executor_prompt ?? "",
              tool: parsed.tool ?? "claude",
              model: parsed.model ?? "fast",
              timeout: parsed.timeout ?? 600,
              agent_id: parsed.agent_id,
            }],
          };
        }
      }
    } catch (parseErr: any) {
      console.warn(`[brain] JSON parse error: ${parseErr.message}`);
      console.warn(`[brain] Raw text (first 500): ${text.slice(0, 500)}`);
    }

    console.warn("[brain] Could not parse decision, defaulting to assess_quality");
    return {
      reason: "Failed to parse brain decision",
      done: false,
      tasks: [{
        action: "assess_quality",
        executor_prompt: "Read all files in the data/ directory and summarize what exists.",
        tool: "claude",
        model: "fast",
        timeout: 120,
      }],
    };
  }
}
