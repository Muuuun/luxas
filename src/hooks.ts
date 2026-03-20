/**
 * Layer 4: Hooks — runtime policies (safety guards + tracking).
 *
 * beforeToolCall: cost/time limits, file protection, rate limiting
 * afterToolCall: session logging, tmux logging, convergence tracking
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ReminderRegistry } from "./reminders.js";

export interface ResearchOptions {
  maxCostUsd?: number;       // Cost limit in USD (default: 50)
  maxDurationMs?: number;    // Time limit in ms (default: 8 hours)
  projectDir: string;
  reminders?: ReminderRegistry;
}

export interface CostTracker {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastContextTokens: number;  // #3: precise token count from last LLM response
}

export function buildResearchHooks(opts: ResearchOptions) {
  const startTime = Date.now();
  const maxCost = opts.maxCostUsd ?? 50;
  const maxDuration = opts.maxDurationMs ?? 8 * 60 * 60 * 1000;
  const logFile = join(opts.projectDir, ".agent", "log.jsonl");

  // Ensure log directory exists
  mkdirSync(dirname(logFile), { recursive: true });

  const tracker: CostTracker = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastContextTokens: 0,
  };

  // PI STOP enforcement — when PI says stop, block non-finalization tools
  let piStopped = false;
  const FINALIZATION_TOOLS = new Set([
    "read", "write", "edit", "compile_latex", "request_pi_review",
  ]);

  // Simple rate limiters
  const lastCallTime: Record<string, number> = {};
  const rateLimits: Record<string, number> = {
    search_papers: 300,    // 300ms between calls
    get_citations: 300,
    download_paper: 1100,  // 1.1s (arXiv rate limit)
  };

  const before = async (ctx: any): Promise<any> => {
    // 1. RESEARCH.md write protection
    const name = ctx.toolCall?.name ?? "";
    const args = ctx.args ?? {};
    if ((name === "write" || name === "edit") && args.file_path) {
      const filePath = String(args.file_path);
      if (filePath.endsWith("RESEARCH.md") || filePath.includes("/RESEARCH.md")) {
        return { block: true, reason: "RESEARCH.md is read-only. It contains the human-written research goal and must not be modified." };
      }
    }

    // 2. PI STOP enforcement — only allow finalization tools after PI says stop
    if (piStopped && !FINALIZATION_TOOLS.has(name)) {
      return { block: true, reason: `PI verdict is STOP. Only finalization tools (read, write, edit, compile_latex) are allowed. Tool "${name}" is blocked.` };
    }

    // 3. Cost limit
    if (tracker.totalCost > maxCost) {
      return { block: true, reason: `Cost limit reached: $${tracker.totalCost.toFixed(2)} / $${maxCost}` };
    }

    // 4. Time limit
    const elapsed = Date.now() - startTime;
    if (elapsed > maxDuration) {
      const hours = (maxDuration / 3600000).toFixed(1);
      return { block: true, reason: `Time limit reached: ${hours}h` };
    }

    // 5. Rate limiting for API tools
    const rateLimit = rateLimits[name];
    if (rateLimit) {
      const lastCall = lastCallTime[name] ?? 0;
      const timeSince = Date.now() - lastCall;
      if (timeSince < rateLimit) {
        await new Promise(resolve => setTimeout(resolve, rateLimit - timeSince));
      }
      lastCallTime[name] = Date.now();
    }

    return undefined; // Allow
  };

  const after = async (ctx: any): Promise<any> => {
    // 1. Log to JSONL
    const entry = {
      type: "tool_call",
      tool: ctx.toolCall?.name ?? "unknown",
      args: summarizeArgs(ctx.args),
      success: !ctx.isError,
      timestamp: new Date().toISOString(),
    };
    try {
      appendFileSync(logFile, JSON.stringify(entry) + "\n");
    } catch {}

    // 2. Set reminder flags — providers in reminders.ts render them on next turn
    const toolName = ctx.toolCall?.name ?? "";
    const reminders = opts.reminders;

    if (toolName === "run_experiment" && !ctx.isError && reminders) {
      reminders.setFlag("experiment_completed", true);  // self-clears when notes updated
    }
    if (toolName === "compile_latex" && reminders) {
      const existingContent: any[] = ctx.result?.content ?? [];
      const hadErrors = ctx.isError || existingContent.some(
        (c: any) => typeof c.text === "string" && (c.text.includes("Error") || c.text.includes("Warning") || c.text.includes("Undefined"))
      );
      if (hadErrors) {
        reminders.setFlag("latex_had_errors", true, 5 * 60 * 1000);  // 5 min TTL
      }
    }
    if (toolName === "dispatch_workers" && !ctx.isError && reminders) {
      reminders.setFlag("workers_completed", true);  // self-clears when notes updated
    }

    return undefined; // Don't modify tool results — reminders appear in snapshot
  };

  // Usage tracking (called from agent event subscription)
  // pi-ai Usage: { input, output, cacheRead, cacheWrite, totalTokens, cost: { total, ... } }
  const trackUsage = (usage: any) => {
    if (usage) {
      tracker.totalInputTokens += usage.input ?? 0;
      tracker.totalOutputTokens += usage.output ?? 0;
      tracker.totalCost += usage.cost?.total ?? 0;
      // #3: Track context size from last response for precise compaction triggers
      const contextTokens = usage.totalTokens
        || ((usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0));
      if (contextTokens > 0) {
        tracker.lastContextTokens = contextTokens;
      }
    }
  };

  /** Call when PI verdict is STOP — blocks non-finalization tools */
  const setPIStopped = () => { piStopped = true; };

  return { before, after, tracker, trackUsage, startTime, setPIStopped };
}

function summarizeArgs(args: any): any {
  if (!args) return {};
  const summary: any = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 200) {
      summary[key] = value.slice(0, 200) + "...";
    } else {
      summary[key] = value;
    }
  }
  return summary;
}
