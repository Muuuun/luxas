/**
 * Conductor — the agentic loop with parallel execution.
 *
 * Loop:
 *   1. Brain reads state → decides next action(s) (can be parallel)
 *   2. Conductor dispatches tasks to SessionPool
 *   3. Multiple Claude Code / Codex sessions run in parallel
 *   4. Brain evaluates all results
 *   5. Log, update state, repeat
 *   6. Stop when Brain says "done" or safety limits hit
 */

import { Brain } from "./brain.js";
import { SessionPool } from "./terminal.js";
import { loadState, saveState, ensureDataDirs, validateReport, consolidateReportFiles } from "./state.js";
import { KnowledgeStore } from "./knowledge/store.js";
import { AgentStore } from "./agents.js";
import { bus } from "./events.js";
import type { ToolName, AgentDefinition, ResearchState, TaskSpec } from "./types.js";

/**
 * Max agentic turns per action type.
 * Prevents executor from making unlimited tool calls (the #1 cause of token bloat).
 * Actions that get extraction digest injected need fewer turns since they don't need to read files.
 */
const MAX_TURNS: Record<string, number> = {
  decompose_topic: 5,
  search_papers: 10,
  search_more_papers: 10,
  evaluate_papers: 10,
  expand_citations: 10,
  download_papers: 15,
  extract_paper: 15,
  extract_more_papers: 15,
  extract_figures: 15,
  verify_figures: 15,
  write_report: 15,      // data injected → just needs to write .tex + .bib
  refine_report: 15,     // data injected → read existing report + write edits
  compile_report: 8,     // just 4 pdflatex/bibtex commands
  fix_compilation: 10,
  cross_validate: 10,    // data injected
  assess_quality: 10,    // data injected
  fill_gaps: 10,
  custom: 20,
};

/**
 * Actions that benefit from extraction digest injection.
 * These tasks need paper data but shouldn't read 50+ individual files.
 */
const INJECT_DIGEST_ACTIONS = new Set([
  "write_report",
  "refine_report",
  "cross_validate",
  "assess_quality",
]);

/**
 * Actions that touch report files (.tex, .bib, .pdf).
 * These get a hard-injected canonical report directory path to prevent file scatter.
 */
const REPORT_ACTIONS = new Set([
  "write_report",
  "refine_report",
  "compile_report",
  "fix_compilation",
]);

/** Safety limits */
const MAX_STEPS = 50;            // max decision steps per run
const MAX_CONSECUTIVE_FAILS = 5; // stop after N consecutive failures
const MAX_SAME_ACTION = 4;       // max times to repeat same action pattern

export class Conductor {
  private projectDir: string;
  private defaultTool: ToolName;
  private defaultTimeout: number;
  private brain: Brain;
  private userDirective?: string;
  private _aborted = false;

  constructor(opts: {
    projectDir?: string;
    tool?: ToolName;
    brainTool?: "claude" | "codex";
    timeout?: number;
  } = {}) {
    this.projectDir = opts.projectDir ?? ".";
    this.defaultTool = opts.tool ?? "claude";
    this.defaultTimeout = opts.timeout ?? 1_800_000; // 30 min — brain sets per-task timeouts, this is just the safety cap
    this.brain = new Brain(this.projectDir, opts.brainTool ?? "claude");
  }

  /** Signal the conductor to stop after the current task completes. */
  abort(): void {
    this._aborted = true;
    bus.emitLog("warn", "[conductor] Abort requested — stopping after current task...");
  }

  /**
   * Run the autonomous research loop.
   * @param topic — new topic to start (omit to resume)
   * @param directive — user instruction for refining/expanding existing research
   */
  async run(topic?: string, directive?: string): Promise<void> {
    const state = loadState(this.projectDir);

    if (topic) {
      state.topic = topic;
      state.goal = `Produce a comprehensive LaTeX survey report on "${topic}" with proper citations, compiled to PDF.`;
      state.status = "running";
    }
    if (!state.topic) {
      throw new Error("No topic specified.");
    }

    // Store directive for the first brain call
    this.userDirective = directive;

    saveState(state, this.projectDir);
    ensureDataDirs(this.projectDir);

    // Consolidate scattered report files before Brain reads state
    consolidateReportFiles(this.projectDir);

    // Initialize knowledge store
    const store = new KnowledgeStore(this.projectDir);
    store.initIndex(state.topic, state.goal);

    // Create session pool
    const pool = new SessionPool(this.projectDir);

    try {
      await this.agentLoop(pool, state);
    } catch (err) {
      bus.emitLog("error", `Agent loop error: ${err}`);
      state.status = "failed";
      throw err;
    } finally {
      pool.closeAll();
      saveState(state, this.projectDir);
    }
  }

  /**
   * The core agentic loop with parallel task support.
   */
  private async agentLoop(
    pool: SessionPool,
    state: ResearchState,
  ): Promise<void> {
    let consecutiveFails = 0;
    const startStep = state.actions_taken.length;

    for (let step = 0; step < MAX_STEPS; step++) {
      // Check abort before each step
      if (this._aborted) {
        state.status = "paused";
        saveState(state, this.projectDir);
        bus.emitLog("info", "[conductor] Aborted by user.");
        bus.emit("paused", { reason: "Aborted by user" });
        return;
      }

      const globalStep = startStep + step + 1;
      bus.emitLog("info", `\n${"=".repeat(60)}`);
      bus.emitLog("info", `STEP ${globalStep} (${step + 1}/${MAX_STEPS} this session)`);
      bus.emitLog("info", "=".repeat(60));
      bus.emitStep(step + 1, globalStep, MAX_STEPS);

      // 1. Brain decides
      state.total_brain_calls++;
      saveState(state, this.projectDir); // save before brain reads
      // Pass user directive on every step until goal is achieved
      const decision = await this.brain.decideNextAction(this.userDirective);

      // 2. Done? — validate report first
      if (decision.done) {
        const reportIssues = validateReport(this.projectDir);
        if (reportIssues.length > 0) {
          bus.emitLog("warn", `\n[conductor] Brain says DONE but report validation FAILED:`);
          for (const issue of reportIssues) {
            bus.emitLog("warn", `  ⚠ ${issue}`);
          }
          bus.emitLog("warn", "[conductor] Overriding: NOT done. Brain will see issues in next state.\n");
          state.actions_taken.push({
            action: "done",
            reason: decision.reason,
            result: "failed",
            details: `Report validation blocked completion: ${reportIssues.join("; ")}`,
            timestamp: Date.now(),
          });
          saveState(state, this.projectDir);
          continue; // let the brain see the validation errors and fix them
        }

        bus.emitLog("info", `\n${"=".repeat(60)}`);
        bus.emitLog("info", "RESEARCH COMPLETE");
        bus.emitLog("info", `Reason: ${decision.reason}`);
        bus.emitLog("info", "=".repeat(60));
        bus.emit("done", { reason: decision.reason });
        state.status = "done";
        saveState(state, this.projectDir);
        return;
      }

      // 3. No tasks?
      if (decision.tasks.length === 0) {
        bus.emitLog("warn", "[conductor] Brain returned no tasks. Retrying...");
        consecutiveFails++;
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) break;
        continue;
      }

      // 4. Loop detection
      const actionPattern = decision.tasks.map((t) => t.action).sort().join(",");
      if (this.isStuck(state, actionPattern)) {
        bus.emitLog("warn", `[conductor] Pattern "${actionPattern}" repeated ${MAX_SAME_ACTION}+ times.`);
        state.actions_taken.push({
          action: actionPattern,
          reason: "SKIPPED — loop detected",
          result: "failed",
          details: `Pattern repeated ${MAX_SAME_ACTION}+ times`,
          timestamp: Date.now(),
        });
        consecutiveFails++;
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) break;
        saveState(state, this.projectDir);
        continue;
      }

      // 5. Handle define_agent actions locally (no executor needed)
      const agentStore = new AgentStore(this.projectDir);
      const agentDefs = decision.tasks.filter((t) => t.action === "define_agent");
      const execTasks = decision.tasks.filter((t) => t.action !== "define_agent");

      for (const ad of agentDefs) {
        try {
          const parsed = JSON.parse(ad.executor_prompt);

          if (parsed.delete && parsed.id) {
            // Delete agent
            const deleted = agentStore.delete(parsed.id);
            bus.emitLog("info", `[conductor] ${deleted ? "Deleted" : "Not found"} agent: "${parsed.id}"`);
            state.actions_taken.push({
              action: "define_agent",
              reason: decision.reason,
              result: deleted ? "success" : "failed",
              details: `Delete agent "${parsed.id}": ${deleted ? "done" : "not found"}`,
              timestamp: Date.now(),
            });
          } else {
            // Create or update agent
            const def = parsed as AgentDefinition;
            def.created_at = agentStore.get(def.id)?.created_at ?? Date.now();
            agentStore.save(def);
            const isUpdate = agentStore.get(def.id) !== null;
            bus.emitLog("info", `[conductor] ${isUpdate ? "Updated" : "Defined"} agent: "${def.id}" — ${def.name}`);
            state.actions_taken.push({
              action: "define_agent",
              reason: decision.reason,
              result: "success",
              details: `Agent "${def.id}": ${def.description}`,
              timestamp: Date.now(),
            });
          }
        } catch (err: any) {
          bus.emitLog("warn", `[conductor] Failed to parse agent definition: ${err.message}`);
          state.actions_taken.push({
            action: "define_agent",
            reason: decision.reason,
            result: "failed",
            details: err.message,
            timestamp: Date.now(),
          });
        }
      }

      if (execTasks.length === 0) {
        // Only define_agent tasks this step
        saveState(state, this.projectDir);
        consecutiveFails = 0;
        continue;
      }

      // Check abort before executing
      if (this._aborted) {
        state.status = "paused";
        saveState(state, this.projectDir);
        bus.emitLog("info", "[conductor] Aborted by user.");
        bus.emit("paused", { reason: "Aborted by user" });
        return;
      }

      // Execute remaining tasks (parallel if multiple)
      const taskCount = execTasks.length;

      // Build extraction digest once (shared across all tasks that need it)
      const store = new KnowledgeStore(this.projectDir);
      let extractionDigest: string | null = null;
      const needsDigest = execTasks.some((t) => INJECT_DIGEST_ACTIONS.has(t.action));
      if (needsDigest) {
        try {
          extractionDigest = store.buildExtractionDigest();
        } catch (digestErr) {
          bus.emitLog("warn", `[conductor] Failed to build extraction digest: ${digestErr}`);
          extractionDigest = null;
        }
        if (extractionDigest) {
          bus.emitLog("info", `[conductor] Injecting extraction digest (${(extractionDigest.length / 1024).toFixed(1)}KB) into ${execTasks.filter(t => INJECT_DIGEST_ACTIONS.has(t.action)).length} task(s)`);
        }
      }

      bus.emitLog("info",
        `[conductor] Executing ${taskCount} task(s)` +
        (taskCount > 1 ? " IN PARALLEL" : "") +
        `: ${decision.reason}`,
      );

      for (const t of execTasks) {
        const agentTag = t.agent_id ? ` @${t.agent_id}` : "";
        const maxTurns = MAX_TURNS[t.action] ?? 15;
        bus.emitLog("info", `  [${t.tool}/${t.model}] ${t.action}${agentTag} (timeout: ${t.timeout}s, max-turns: ${maxTurns})`);
      }

      state.total_executor_calls += taskCount;
      const artifactsBefore = { ...state.artifacts };

      // Resolve absolute canonical report directory for injection
      const { resolve } = await import("node:path");
      const canonicalReportDir = resolve(this.projectDir, "data", "reports");

      const results = await pool.runParallel(
        execTasks.map((t) => {
          // Build prompt with optional digest injection
          let prompt = agentStore.buildPrompt(t.executor_prompt, t.agent_id);

          // Inject extraction digest for data-heavy tasks
          if (extractionDigest && INJECT_DIGEST_ACTIONS.has(t.action)) {
            prompt += `\n\n<extraction_digest>\n${extractionDigest}\n</extraction_digest>\n\nIMPORTANT: All paper extraction data is provided above in <extraction_digest>. Do NOT read individual extraction.json files — the data is already here. Use it directly.`;
          }

          // Inject canonical report directory for report-touching tasks
          // Also inject for custom actions with report-related agents
          const isReportTask = REPORT_ACTIONS.has(t.action) ||
            (t.action === "custom" && t.agent_id && /report|latex|compile|bib/i.test(t.agent_id));
          if (isReportTask) {
            prompt += `\n\n<report_directory_rule>\nMANDATORY: ALL report files (.tex, .bib, .pdf, and all LaTeX auxiliary files) MUST be written to this EXACT directory:\n  ${canonicalReportDir}\nDo NOT create or write report files in any other directory (not report/, not data/report/, not reports/). This is enforced by the system.\nIf you find existing report files in other directories, IGNORE them — the system has already consolidated them.\n</report_directory_rule>`;
          }

          const maxTurns = MAX_TURNS[t.action] ?? 15;
          return {
            tool: t.tool,
            prompt,
            action: t.action + (t.agent_id ? `@${t.agent_id}` : ""),
            model: t.model,
            timeout: Math.min(t.timeout * 1000, this.defaultTimeout),
            maxTurns,
          };
        }),
        // Save each task result incrementally (survives kill)
        (idx, task, result) => {
          state.actions_taken.push({
            action: execTasks[idx].action + (execTasks[idx].agent_id ? `@${execTasks[idx].agent_id}` : ""),
            reason: decision.reason,
            result: result.success ? "success" : "failed",
            details: (result.output || "").slice(0, 300),
            timestamp: Date.now(),
          });
          saveState(state, this.projectDir);
          bus.emitLog("info", `[conductor] Saved checkpoint after ${task.action}`);
          bus.emitAction({
            action: execTasks[idx].action,
            result: result.success ? "success" : "failed",
            details: (result.output || "").slice(0, 200),
            timestamp: Date.now(),
          });
          bus.emitStateChange();
        },
      );

      // Rate limit detection — if all tasks hit rate limit, pause immediately
      const rateLimited = results.every((r) =>
        r.output.includes("hit your limit") || r.output.includes("rate limit"),
      );
      if (rateLimited) {
        bus.emitLog("warn", "[conductor] Rate limited on all tasks. Pausing to avoid wasting steps.");
        state.status = "paused";
        state.actions_taken.push({
          action: actionPattern,
          reason: "Rate limited",
          result: "failed",
          details: "All tasks hit rate limit. Resume later.",
          timestamp: Date.now(),
        });
        saveState(state, this.projectDir);
        return;
      }

      // 6. Consolidate any report files executors may have scattered
      consolidateReportFiles(this.projectDir);

      // 7. Check improvement (skip separate evaluateResult — Brain sees state in next decideNextAction)
      saveState(state, this.projectDir); // triggers artifact rescan
      const improved = didImprove(artifactsBefore, state.artifacts);
      const anySuccess = results.some((r) => r.success);
      const actionResult = improved ? "success" : (anySuccess ? "partial" : "failed");

      if (actionResult === "failed") {
        consecutiveFails++;
      } else {
        consecutiveFails = 0;
      }

      // 8. Actions already logged incrementally via onTaskComplete callback
      saveState(state, this.projectDir);

      // 9. Pool stats
      const stats = pool.stats();
      bus.emitLog("info", `[pool] ${stats.completed} tasks completed (max concurrent: ${stats.maxConcurrent})`);

      // 10. Safety
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        bus.emitLog("error", "[conductor] Too many consecutive failures. Pausing.");
        break;
      }
    }

    if (state.status !== "done") {
      state.status = "paused";
      saveState(state, this.projectDir);
      bus.emitLog("warn", "[conductor] Paused. Run 'sisyphus resume' to continue.");
      bus.emit("paused", { reason: "Step limit or consecutive failures" });
    }
  }

  /**
   * Detect if the agent is stuck repeating the same action pattern.
   * Only counts consecutive FAILED attempts of the exact same pattern.
   */
  private isStuck(state: ResearchState, pattern: string): boolean {
    const recent = state.actions_taken.slice(-(MAX_SAME_ACTION * 2));
    if (recent.length < MAX_SAME_ACTION) return false;

    // Count consecutive failed attempts of this exact pattern (from most recent)
    let consecutiveFailedSame = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const r = recent[i];
      if (r.action === pattern && r.result === "failed") {
        consecutiveFailedSame++;
      } else {
        break; // stop at first non-matching or non-failed entry
      }
    }
    return consecutiveFailedSame >= MAX_SAME_ACTION;
  }
}

function didImprove(
  before: ResearchState["artifacts"],
  after: ResearchState["artifacts"],
): boolean {
  return (
    after.subtopics_count > before.subtopics_count ||
    after.seed_papers_count > before.seed_papers_count ||
    after.core_papers_count > before.core_papers_count ||
    after.downloaded_count > before.downloaded_count ||
    after.extracted_count > before.extracted_count ||
    (after.has_report_tex && !before.has_report_tex) ||
    (after.has_report_bib && !before.has_report_bib) ||
    (after.has_report_pdf && !before.has_report_pdf)
  );
}
