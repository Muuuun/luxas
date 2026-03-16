/**
 * Layer 4: Hooks — runtime policies (safety guards + tracking).
 *
 * beforeToolCall: cost/time limits, file protection, rate limiting
 * afterToolCall: session logging, tmux logging, convergence tracking
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface ResearchOptions {
  maxCostUsd?: number;       // Cost limit in USD (default: 50)
  maxDurationMs?: number;    // Time limit in ms (default: 8 hours)
  projectDir: string;
}

export interface CostTracker {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function buildResearchHooks(opts: ResearchOptions) {
  const startTime = Date.now();
  const maxCost = opts.maxCostUsd ?? 50;
  const maxDuration = opts.maxDurationMs ?? 8 * 60 * 60 * 1000;
  const logFile = join(opts.projectDir, "log.jsonl");

  // Ensure log directory exists
  mkdirSync(dirname(logFile), { recursive: true });

  const tracker: CostTracker = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

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

    // 2. Cost limit
    if (tracker.totalCost > maxCost) {
      return { block: true, reason: `Cost limit reached: $${tracker.totalCost.toFixed(2)} / $${maxCost}` };
    }

    // 3. Time limit
    const elapsed = Date.now() - startTime;
    if (elapsed > maxDuration) {
      const hours = (maxDuration / 3600000).toFixed(1);
      return { block: true, reason: `Time limit reached: ${hours}h` };
    }

    // 4. Rate limiting for API tools
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

    return undefined; // Don't modify result
  };

  // Usage tracking (called from agent event subscription)
  const trackUsage = (usage: any) => {
    if (usage) {
      tracker.totalInputTokens += usage.inputTokens ?? 0;
      tracker.totalOutputTokens += usage.outputTokens ?? 0;
      tracker.totalCost += usage.totalCost ?? 0;
    }
  };

  return { before, after, tracker, trackUsage, startTime };
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
