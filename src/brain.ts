/**
 * Brain — the autonomous decision-making agent.
 *
 * The Brain can issue multiple parallel tasks per step.
 * For example: "download 3 papers in parallel" or
 * "extract paper A on claude while extracting paper B on codex".
 */

import { spawn } from "node:child_process";
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
  async decideNextAction(): Promise<BrainDecision> {
    const context = buildBrainContext(this.projectDir);

    const prompt = `You are the autonomous research agent brain for "Sisyphus" — a system that produces comprehensive technology survey reports as LaTeX PDFs with proper citations.

YOUR CURRENT STATE:
${context}

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
- "cross_validate": Compare claims across papers → data/relations/claims.json
- "write_report": Generate LaTeX survey + BibTeX
- "refine_report": Improve existing report
- "compile_report": pdflatex + bibtex → PDF
- "fix_compilation": Fix LaTeX errors and re-compile
- "assess_quality": Check coverage, depth, completeness
- "fill_gaps": Search for papers in under-covered areas
- "done": Research complete (only when PDF exists and is good)

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

STRICT ORDERING — DO NOT SKIP STEPS:
1. First: ALL core papers must be downloaded. If any core paper has "no-dl" or "FAILED", download it BEFORE anything else.
2. Second: ALL downloaded core papers must be extracted. If any has "no-ext", extract it.
3. Third: ONLY after ALL core papers are downloaded AND extracted, then cross_validate and write_report.
4. If some papers truly cannot be downloaded (no arXiv ID, paywalled), EXCLUDE them from core first, then proceed.
- NEVER start write_report while there are undownloaded or unextracted core papers.
- NEVER skip downloads to "save time". Complete the data pipeline first.

TOOL SELECTION:
- "claude": Claude Code. Use for ALL tasks. Set tool to "claude" for everything.
- "codex": OpenAI Codex. CURRENTLY UNAVAILABLE (rate limited). Do NOT use codex. Set tool to "claude" for all tasks.
- Spread parallel tasks across both "fast" and "think" models to avoid rate limits on one model.

MODEL SELECTION — each task has a "model" field: "cheap", "fast", or "think":
- "cheap" = Haiku — for trivial mechanical tasks: download_papers, compile_report, fix_compilation, expand_citations
- "fast" = Sonnet — for most tasks: search_papers, decompose_topic, extract_paper, extract_more_papers, evaluate_papers
- "think" = Opus — ONLY for deep analysis or creative writing: write_report, refine_report, cross_validate, assess_quality
- DEFAULT to "fast". Use "cheap" for file operations/downloads, "think" only for writing/analysis

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
      "timeout": 600
    }
  ]
}

For parallel work, include multiple tasks:
{
  "reason": "downloading + extracting in parallel",
  "done": false,
  "tasks": [
    {"action": "download_papers", "executor_prompt": "download papers...", "tool": "codex", "model": "fast", "timeout": 300},
    {"action": "extract_paper", "executor_prompt": "extract paper X...", "tool": "claude", "model": "think", "timeout": 600},
    {"action": "extract_paper", "executor_prompt": "extract paper Y...", "tool": "claude", "model": "think", "timeout": 600}
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
        ["-p", "--output-format", "text", "--model", "claude-sonnet-4-6"],
        {
          cwd: this.projectDir,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: MAX_BRAIN_TIMEOUT,
        },
      );

      let stdout = "";
      let stderr = "";

      // Heartbeat: show elapsed time every 5s
      const heartbeat = setInterval(() => {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        process.stderr.write(`\r[brain] ⏳ thinking... ${elapsed}s\x1b[K`);
      }, 5_000);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
        // Show claude stderr (rate limit messages etc.)
        const line = data.toString().trim();
        if (line) process.stderr.write(`\r[brain] ${line.slice(0, 120)}\x1b[K`);
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on("close", (code) => {
        clearInterval(heartbeat);
        process.stderr.write("\n");
        if (code !== 0 && !stdout.trim()) {
          console.warn(`[brain] Claude exited with code ${code}`);
          if (stderr) console.warn(`[brain] stderr: ${stderr.slice(0, 500)}`);
          resolve("");
        } else {
          resolve(stdout.trim());
        }
      });

      child.on("error", (err: any) => {
        clearInterval(heartbeat);
        process.stderr.write("\n");
        console.warn(`[brain] Claude call failed: ${err.message?.slice(0, 300)}`);
        resolve("");
      });
    });
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
