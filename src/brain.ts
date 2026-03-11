/**
 * Brain — the autonomous decision-making agent.
 *
 * The Brain can issue multiple parallel tasks per step.
 * For example: "download 3 papers in parallel" or
 * "extract paper A on claude while extracting paper B on codex".
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ANSI
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const CLEAR_LINE = "\x1b[2K";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
import { buildBrainContext } from "./state.js";
import { bus, tuiActive } from "./events.js";
import type { BrainDecision, TaskSpec } from "./types.js";

const MAX_BRAIN_TIMEOUT = 600_000; // 10 min — large contexts (50+ papers) need more thinking time

export class Brain {
  private projectDir: string;
  private tool: "claude" | "codex";

  constructor(projectDir = ".", tool: "claude" | "codex" = "claude") {
    this.projectDir = projectDir;
    this.tool = tool;
  }

  /**
   * Core method: decide what to do next.
   * Can return 1 task (sequential) or multiple tasks (parallel).
   */
  async decideNextAction(userDirective?: string): Promise<BrainDecision> {
    const context = buildBrainContext(this.projectDir);

    const directiveBlock = userDirective
      ? `\n<user_directive priority="highest">\n${userDirective}\n</user_directive>`
      : "";

    // === PROMPT STRUCTURE FOR PROMPT CACHING ===
    // Static instructions FIRST (cached by API across calls), dynamic state LAST.
    // This ensures the API-level prompt cache hits on the ~8K token static prefix.
    const prompt = `<system>
You are the autonomous research agent brain for "Sisyphus" — a system that produces comprehensive technology survey reports as LaTeX PDFs with proper citations.

<goal>
Produce a high-quality LaTeX survey report (compiled to PDF) with proper \\cite{} citations for every claim, benchmark comparison tables, and cross-validation of claims across papers.
</goal>

<paper_management>
Papers go through a funnel: discovered → candidate → core → excluded.
Each paper lives in data/papers/{paper_id}/ with meta.json, status.json, extraction.json, source/.
Cross-paper data in data/relations/ (citations.json, claims.json).
Central registry: data/index.json.
</paper_management>

<available_actions>
- "decompose_topic": Break topic into subtopics → data/topics.json
- "search_papers": Search S2/arXiv, add discovered papers
- "search_more_papers": Search under-covered areas
- "evaluate_papers": Promote discovered/candidate → core or exclude
- "expand_citations": Snowball via S2 citations/references from core papers
- "download_papers": Download source for undownloaded core papers
- "extract_paper": Extract structured info from ONE downloaded core paper
- "extract_more_papers": Continue extracting unextracted core papers
- "extract_figures": Extract images from papers (LaTeX source or PDF) → data/papers/{id}/figures/
- "verify_figures": VISUALLY inspect extracted figures — read each image, fix wrong captions, exclude junk (MANDATORY before report)
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
</available_actions>

<custom_agents>
You can define project-specific sub-agents with specialized system prompts.
Each agent is reusable across tasks and persisted in data/agents.json.

To DEFINE or UPDATE an agent, use action "define_agent". The executor_prompt must be a JSON:
{"id": "agent_id_snake_case", "name": "Human-readable Name", "description": "What this agent specializes in", "system_prompt": "You are an expert in X...", "default_model": "fast"}
To UPDATE: use the same "id" — it overwrites the old definition.
To DELETE: use action "define_agent" with "delete": true and the agent id.

To USE a custom agent, set "agent_id" in the task. The agent's system_prompt is automatically prepended to the executor_prompt.
You can also use agent_id with standard actions like "extract_paper", "write_report", etc.

WHEN TO CREATE AGENTS:
- Deep domain knowledge needed, consistent behavior across similar tasks, or specialized persona would help
- Re-use existing agents — check Custom Agents section in state. ITERATE on prompts if results are poor.
</custom_agents>

<rules>
PARALLEL TASKS: Return MULTIPLE tasks to run simultaneously (up to 8 concurrent). Use for: downloading, extracting, searching in parallel.

DECISION RULES:
- Look at ACTUAL state, not a fixed sequence
- Be SELECTIVE: 30 well-chosen core papers > 200 tangential ones
- DO NOT loop: if action failed 3+ times, change strategy
- PARALLELIZE aggressively: up to 8 concurrent tasks

QUALITY GUIDELINES:
- Generally: download → extract → extract_figures → write → verify_figures → compile → review → improve
- But you CAN interleave, go back, skip, or reorder based on actual state
- Don't write report if many core papers are still undownloaded/unextracted
- HARD RULE: After writing a report with figures, ALWAYS run verify_figures to visually confirm every included figure matches its caption.
- HARD RULE: ANY time the .tex file is modified, you MUST re-run compile_report. The PDF must always reflect the latest .tex. Never assess_quality or mark done on a stale PDF.
- SELF-REVIEW: after compiling, always assess_quality (think model). You MUST do at least one self-review cycle before marking done.
- NEVER mark done without having read and assessed the compiled report.

REPORT COMPLETENESS — HARD RULES (system will BLOCK "done" if violated):
- write_report MUST generate BOTH .tex AND references.bib in the SAME directory. Never one without the other.
- The .tex MUST include: \\documentclass, \\begin{document}, \\end{document}, \\title{}, \\bibliography{references} or \\addbibresource{}, \\bibliographystyle{}.
- The .tex MUST have \\cite{} commands referencing keys from references.bib.
- references.bib MUST have @article/@inproceedings entries matching the \\cite keys.

COMPILATION — CRITICAL (most common failure point):
- compile_report MUST run EXACTLY this 4-step sequence in the report directory:
  1. pdflatex -interaction=nonstopmode main.tex
  2. bibtex main
  3. pdflatex -interaction=nonstopmode main.tex
  4. pdflatex -interaction=nonstopmode main.tex
- ALL 4 STEPS ARE MANDATORY. Running only pdflatex without bibtex produces ? for all citations.
- Running bibtex without the 2nd+3rd pdflatex also leaves ? markers.
- The executor prompt for compile_report MUST include the EXACT 4 commands above.
- The system checks the actual PDF text for ? markers. If ANY unresolved references exist, validation FAILS.
- If <report_validation> shows UNRESOLVED_REFS_IN_PDF, the ONLY fix is to re-run all 4 compilation steps.
- If <report_validation> shows FAILED, you MUST fix ALL listed issues before marking done.
- The system automatically validates the report. If you say "done" but validation fails, you'll be sent back.

TOOL SELECTION:
- "claude" = Claude Code (claude -p) — supports all tools, file read/write, web fetch, streaming
- "codex" = OpenAI Codex (codex exec) — supports file read/write, bash execution
- Both tools can execute any action. Use "claude" by default; use "codex" for tasks that benefit from OpenAI models (e.g., alternative perspective, diversity of analysis).

MODEL SELECTION — each task has a "model" field:
- "cheap" = Haiku — trivial mechanical tasks: download_papers, compile_report, fix_compilation, expand_citations
- "fast" = Sonnet — most tasks: search_papers, decompose_topic, extract_paper, evaluate_papers
- "think" = Opus — deep analysis/creative writing ONLY: write_report, refine_report, cross_validate, assess_quality

FIGURE WORKFLOW:
Phase 1 EXTRACT: extract figure metadata into extraction.json "figures" array during extraction. extract_figures copies actual image files.
Phase 2 SELECT: during write_report, include only "key"/"useful" figures via \\includegraphics. Use subcaption for composites.
Phase 3 VERIFY: after writing, verify_figures reads each image (vision), compares with caption, fixes mismatches. Parallelize across tasks.

REPORT DIRECTORY: The report MUST be written to data/reports/ (canonical path). If you find report files in data/report/ or report/ (non-standard), move them to data/reports/ and delete the old copies. Only one copy of the report should exist.

EXTRACTION: One paper per task. Large docs (>50 pages): split into parallel tasks per section. Must extract figure metadata.
DOWNLOAD: Verify source/ dir has files. ArXiv: LaTeX source first, PDF fallback. 2s delay between downloads. Max 2-3 papers per task.
EXECUTOR PROMPTS: Must be SELF-CONTAINED (file paths, API URLs, schemas). Paper IDs with / → _ in dir names.

TOKEN EFFICIENCY — CRITICAL:
- For write_report, refine_report, cross_validate, assess_quality: the system AUTO-INJECTS all extraction data into the executor prompt. Do NOT tell executors to "read all extraction.json files" or "scan data/papers/*/extraction.json" — the data is already in their prompt.
- Do NOT tell executors to read paper source files for report writing. All needed info is in the injected extraction digest.
- Keep executor_prompt concise: describe WHAT to do, not HOW to find data. The conductor handles data injection.
- Use "cheap" model (Haiku) for mechanical tasks: download_papers, compile_report, fix_compilation, expand_citations.
- Use "fast" model (Sonnet) for most tasks. Reserve "think" (Opus) ONLY for write_report and refine_report.
</rules>

<output_format>
Return ONLY a JSON object (no markdown fences):
{"reason": "why these actions", "done": false, "tasks": [{"action": "action_name", "executor_prompt": "complete prompt", "tool": "claude", "model": "fast", "timeout": 600, "agent_id": "optional"}]}
For done: {"reason": "PDF report exists with good quality", "done": true, "tasks": []}
</output_format>
</system>

<current_state>
${context}
</current_state>${directiveBlock}`;

    bus.emitLog("info", `[brain] Deciding next action... (${this.tool})`);
    bus.emitBrain({ status: "thinking", elapsed: 0 });
    const result = this.tool === "codex"
      ? await this.callCodex(prompt)
      : await this.callClaude(prompt);
    const decision = this.parseDecision(result);

    if (decision.tasks.length > 1) {
      bus.emitLog("info", `[brain] Decision: ${decision.tasks.length} parallel tasks — ${decision.reason}`);
      for (const t of decision.tasks) {
        bus.emitLog("info", `  [${t.tool}] ${t.action}`);
      }
    } else if (decision.tasks.length === 1) {
      bus.emitLog("info", `[brain] Decision: ${decision.tasks[0].action} — ${decision.reason}`);
    } else if (decision.done) {
      bus.emitLog("info", `[brain] Decision: DONE — ${decision.reason}`);
    }
    bus.emitBrain({
      status: decision.done ? "decided" : "decided",
      elapsed: 0,
      reason: decision.reason,
      taskCount: decision.tasks.length,
    });

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

    const callFn = this.tool === "codex" ? this.callCodex.bind(this) : this.callClaude.bind(this);
    return (await callFn(prompt)) || "Could not evaluate result.";
  }

  private callClaude(prompt: string): Promise<string> {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(
        "claude",
        ["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-4-6", "--tools", ""],
        {
          cwd: this.projectDir,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      // Manual timeout — spawn() does NOT support the timeout option (only exec/execFile do)
      const killTimer = setTimeout(() => {
        bus.emitLog("warn", `[brain] Timeout after ${MAX_BRAIN_TIMEOUT / 1000}s — killing brain process`);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000); // force kill if SIGTERM didn't work
      }, MAX_BRAIN_TIMEOUT);

      let stdout = "";
      let resultText = "";
      let frame = 0;
      let lineBuffer = "";

      // Spinner timer
      const spinner = setInterval(() => {
        frame++;
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        if (tuiActive) {
          bus.emitBrain({ status: "thinking", elapsed: parseFloat(el) });
        } else {
          const icon = CYAN + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + RESET;
          process.stderr.write(`\r${CLEAR_LINE}${icon} ${DIM}[brain] thinking... ${el}s${RESET}`);
        }
      }, 200);

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Buffer partial lines across chunks
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || ""; // keep incomplete last line

        // Parse stream-json events for live status
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            const status = this.parseBrainEvent(evt);
            if (status) {
              if (tuiActive) {
                const el = ((Date.now() - t0) / 1000).toFixed(0);
                bus.emitBrain({ status: "thinking", elapsed: parseFloat(el), thought: status });
              } else {
                const el = ((Date.now() - t0) / 1000).toFixed(0);
                const icon = CYAN + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + RESET;
                process.stderr.write(`\r${CLEAR_LINE}${icon} ${DIM}[brain ${el}s]${RESET} ${status}`);
              }
            }
            // Capture result
            if (evt.type === "result" && evt.result) {
              resultText = evt.result;
            }
          } catch {
            // malformed JSON line
          }
        }
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line && !tuiActive) {
          process.stderr.write(`\r${CLEAR_LINE}${DIM}[brain] ${line.slice(0, 120)}${RESET}`);
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on("close", (code) => {
        clearTimeout(killTimer);
        clearInterval(spinner);
        // Flush remaining lineBuffer
        if (lineBuffer.trim()) {
          try {
            const evt = JSON.parse(lineBuffer);
            if (evt.type === "result" && evt.result) {
              resultText = evt.result;
            }
          } catch { /* ignore */ }
        }
        if (!tuiActive) {
          process.stderr.write(`\r${CLEAR_LINE}`);
          process.stderr.write("\n");
        }
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        bus.emitLog("info", `[brain] Finished in ${elapsed}s. resultText: ${resultText.length} chars, stdout: ${stdout.length} chars`);
        const output = resultText || stdout.trim();
        if (code !== 0 && !output) {
          bus.emitLog("warn", `[brain] Claude exited with code ${code}`);
          resolve("");
        } else {
          resolve(output);
        }
      });

      child.on("error", (err: any) => {
        clearTimeout(killTimer);
        clearInterval(spinner);
        if (!tuiActive) process.stderr.write(`\r${CLEAR_LINE}\n`);
        bus.emitLog("warn", `[brain] Claude call failed: ${err.message?.slice(0, 300)}`);
        resolve("");
      });
    });
  }

  /**
   * Call codex as brain (for OpenAI-backed decision making).
   */
  private callCodex(prompt: string): Promise<string> {
    const env = { ...process.env };

    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(
        "codex",
        ["exec", "--full-auto", "-"],
        {
          cwd: this.projectDir,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const killTimer = setTimeout(() => {
        bus.emitLog("warn", `[brain/codex] Timeout after ${MAX_BRAIN_TIMEOUT / 1000}s`);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }, MAX_BRAIN_TIMEOUT);

      let stdout = "";
      let frame = 0;

      const spinner = setInterval(() => {
        frame++;
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        if (tuiActive) {
          bus.emitBrain({ status: "thinking", elapsed: parseFloat(el), thought: "codex thinking..." });
        } else {
          const icon = CYAN + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + RESET;
          process.stderr.write(`\r${CLEAR_LINE}${icon} ${DIM}[brain/codex] thinking... ${el}s${RESET}`);
        }
      }, 200);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line && !tuiActive) {
          process.stderr.write(`\r${CLEAR_LINE}${DIM}[brain/codex] ${line.slice(0, 120)}${RESET}`);
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on("close", (code) => {
        clearTimeout(killTimer);
        clearInterval(spinner);
        if (!tuiActive) {
          process.stderr.write(`\r${CLEAR_LINE}\n`);
        }
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        bus.emitLog("info", `[brain/codex] Finished in ${elapsed}s. stdout: ${stdout.length} chars`);
        if (code !== 0 && !stdout.trim()) {
          bus.emitLog("warn", `[brain/codex] Codex exited with code ${code}`);
          resolve("");
        } else {
          resolve(stdout.trim());
        }
      });

      child.on("error", (err: any) => {
        clearTimeout(killTimer);
        clearInterval(spinner);
        if (!tuiActive) process.stderr.write(`\r${CLEAR_LINE}\n`);
        bus.emitLog("warn", `[brain/codex] Codex call failed: ${err.message?.slice(0, 300)}`);
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
    // Debug: log brain output to file for diagnosis
    try {
      const logDir = join(this.projectDir, "data");
      mkdirSync(logDir, { recursive: true });
      const ts = new Date().toISOString();
      appendFileSync(
        join(logDir, "brain_debug.log"),
        `\n=== ${ts} ===\nresultText length: ${text.length}\nFirst 1000 chars:\n${text.slice(0, 1000)}\n`,
      );
    } catch { /* ignore log errors */ }

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
      bus.emitLog("warn", `[brain] JSON parse error: ${parseErr.message}`);
      bus.emitLog("warn", `[brain] Raw text (first 500): ${text.slice(0, 500)}`);
    }

    bus.emitLog("warn", "[brain] Could not parse decision, defaulting to assess_quality");
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
