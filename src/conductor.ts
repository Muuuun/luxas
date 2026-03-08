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
import { loadState, saveState, ensureDataDirs } from "./state.js";
import { KnowledgeStore } from "./knowledge/store.js";
import { AgentStore } from "./agents.js";
import type { ToolName, AgentDefinition, ResearchState, TaskSpec } from "./types.js";

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

  constructor(opts: {
    projectDir?: string;
    tool?: ToolName;
    timeout?: number;
  } = {}) {
    this.projectDir = opts.projectDir ?? ".";
    this.defaultTool = opts.tool ?? "claude";
    this.defaultTimeout = opts.timeout ?? 600_000;
    this.brain = new Brain(this.projectDir);
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

    // Initialize knowledge store
    const store = new KnowledgeStore(this.projectDir);
    store.initIndex(state.topic, state.goal);

    // Create session pool
    const pool = new SessionPool(this.projectDir);

    try {
      await this.agentLoop(pool, state);
    } catch (err) {
      console.error("Agent loop error:", err);
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
      const globalStep = startStep + step + 1;
      console.log("\n" + "=".repeat(60));
      console.log(`STEP ${globalStep} (${step + 1}/${MAX_STEPS} this session)`);
      console.log("=".repeat(60));

      // 1. Brain decides
      state.total_brain_calls++;
      saveState(state, this.projectDir); // save before brain reads
      // Pass user directive on every step until goal is achieved
      const decision = await this.brain.decideNextAction(this.userDirective);

      // 2. Done?
      if (decision.done) {
        console.log(`\n${"=".repeat(60)}`);
        console.log("RESEARCH COMPLETE");
        console.log(`Reason: ${decision.reason}`);
        console.log("=".repeat(60));
        state.status = "done";
        saveState(state, this.projectDir);
        return;
      }

      // 3. No tasks?
      if (decision.tasks.length === 0) {
        console.warn("[conductor] Brain returned no tasks. Retrying...");
        consecutiveFails++;
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) break;
        continue;
      }

      // 4. Loop detection
      const actionPattern = decision.tasks.map((t) => t.action).sort().join(",");
      if (this.isStuck(state, actionPattern)) {
        console.warn(`[conductor] Pattern "${actionPattern}" repeated ${MAX_SAME_ACTION}+ times.`);
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
            console.log(`[conductor] ${deleted ? "Deleted" : "Not found"} agent: "${parsed.id}"`);
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
            console.log(`[conductor] ${isUpdate ? "Updated" : "Defined"} agent: "${def.id}" — ${def.name}`);
            state.actions_taken.push({
              action: "define_agent",
              reason: decision.reason,
              result: "success",
              details: `Agent "${def.id}": ${def.description}`,
              timestamp: Date.now(),
            });
          }
        } catch (err: any) {
          console.warn(`[conductor] Failed to parse agent definition: ${err.message}`);
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

      // Execute remaining tasks (parallel if multiple)
      const taskCount = execTasks.length;
      console.log(
        `[conductor] Executing ${taskCount} task(s)` +
        (taskCount > 1 ? " IN PARALLEL" : "") +
        `: ${decision.reason}`,
      );

      for (const t of execTasks) {
        const agentTag = t.agent_id ? ` @${t.agent_id}` : "";
        console.log(`  [${t.tool}/${t.model}] ${t.action}${agentTag} (timeout: ${t.timeout}s)`);
      }

      state.total_executor_calls += taskCount;
      const artifactsBefore = { ...state.artifacts };

      const results = await pool.runParallel(
        execTasks.map((t) => ({
          tool: t.tool,
          prompt: agentStore.buildPrompt(t.executor_prompt, t.agent_id),
          action: t.action + (t.agent_id ? `@${t.agent_id}` : ""),
          model: t.model,
          timeout: Math.min(t.timeout * 1000, this.defaultTimeout),
        })),
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
          console.log(`[conductor] Saved checkpoint after ${task.action}`);
        },
      );

      // Rate limit detection — if all tasks hit rate limit, pause immediately
      const rateLimited = results.every((r) =>
        r.output.includes("hit your limit") || r.output.includes("rate limit"),
      );
      if (rateLimited) {
        console.warn("[conductor] Rate limited on all tasks. Pausing to avoid wasting steps.");
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

      // 6. Brain evaluates all results
      state.total_brain_calls++;
      const actions = execTasks.map((t) => t.action);
      const outputs = results.map((r) => r.output);
      const evaluation = await this.brain.evaluateResult(actions, outputs);
      console.log(`[brain] Evaluation: ${evaluation}`);

      // 7. Check improvement
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
      console.log(`[pool] ${stats.completed} tasks completed (max concurrent: ${stats.maxConcurrent})`);

      // 10. Safety
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        console.error("[conductor] Too many consecutive failures. Pausing.");
        break;
      }
    }

    if (state.status !== "done") {
      state.status = "paused";
      saveState(state, this.projectDir);
      console.warn("[conductor] Paused. Run 'sisyphus resume' to continue.");
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
