/**
 * Layer 4: Hooks — runtime policies (safety guards + tracking).
 *
 * beforeToolCall: cost/time limits, file protection, rate limiting
 * afterToolCall: session logging, tmux logging, convergence tracking
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSafe, extractTextContent } from "./utils.js";
import type { ReminderRegistry } from "./reminders.js";
import type { ExtensionBus } from "./extensions.js";

export interface ResearchOptions {
  maxCostUsd?: number;       // Cost limit in USD (default: 50)
  maxDurationMs?: number;    // Time limit in ms (default: 8 hours)
  projectDir: string;
  reminders?: ReminderRegistry;
  bus?: ExtensionBus;
  /** Restored harness state from session JSONL (stateless harness recovery). */
  initialState?: {
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    lastContextTokens?: number;
    startTime?: number;
    piStopped?: boolean;
  };
}

export interface CostTracker {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastContextTokens: number;  // #3: precise token count from last LLM response
}

export function buildResearchHooks(opts: ResearchOptions) {
  const init = opts.initialState;
  const startTime = init?.startTime ?? Date.now();
  const maxCost = opts.maxCostUsd ?? Infinity;  // No default cost limit; pass --max-cost to set one
  const maxDuration = opts.maxDurationMs ?? 8 * 60 * 60 * 1000;
  const logFile = join(opts.projectDir, ".agent", "log.jsonl");

  // Ensure log directory exists
  mkdirSync(dirname(logFile), { recursive: true });

  const tracker: CostTracker = {
    totalCost: init?.cost ?? 0,
    totalInputTokens: init?.inputTokens ?? 0,
    totalOutputTokens: init?.outputTokens ?? 0,
    lastContextTokens: init?.lastContextTokens ?? 0,
  };

  // PI STOP enforcement — when PI says stop, block non-finalization tools
  let piStopped = init?.piStopped ?? false;
  const FINALIZATION_TOOLS = new Set([
    "read", "write", "edit", "compile_latex", "request_pi_review", "finish",
  ]);

  // Simple rate limiters
  const lastCallTime: Record<string, number> = {};
  const rateLimits: Record<string, number> = {
    search_papers: 300,    // 300ms between calls
    get_citations: 300,
    download_paper: 1100,  // 1.1s (arXiv rate limit)
  };

  let logWriteFailures = 0;
  const MAX_LOG_FAILURES = 3;

  const before = async (ctx: any): Promise<any> => {
    // 1. RESEARCH.md write protection (defense-in-depth; the brain/experiment
    // safety wrappers are the primary line of defense for tools that go through
    // them, but this hook also covers any future tools that don't).
    const name = ctx.toolCall?.name ?? "";
    const args = ctx.args ?? {};
    if (name === "write" || name === "edit") {
      // pi-coding-agent uses `path`; some other tools may use `file_path`.
      const filePath = String(args.path ?? args.file_path ?? "");
      if (filePath && (filePath.endsWith("RESEARCH.md") || filePath.includes("/RESEARCH.md"))) {
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
    const toolName = ctx.toolCall?.name ?? "unknown";
    const errorText = extractErrorText(ctx);
    const errorCategory = ctx.isError ? classifyError(errorText, toolName) : undefined;

    // 1. Log to JSONL (enriched with error info)
    const entry: Record<string, any> = {
      type: "tool_call",
      tool: toolName,
      args: summarizeArgs(ctx.args),
      success: !ctx.isError,
      timestamp: new Date().toISOString(),
    };
    if (ctx.isError && errorCategory) {
      entry.errorCategory = errorCategory;
      entry.errorMessage = errorText.slice(0, 300);
    }
    try {
      appendFileSync(logFile, JSON.stringify(entry) + "\n");
      logWriteFailures = 0;
    } catch (err: any) {
      logWriteFailures++;
      console.error(`[CRITICAL] Failed to write log.jsonl (${err?.code}): ${err?.message}`);
      if (logWriteFailures >= MAX_LOG_FAILURES) {
        throw new Error(`FATAL: ${MAX_LOG_FAILURES} consecutive log write failures. Last: ${err?.code}. Aborting to prevent silent cost accumulation.`);
      }
    }

    // 2. Capture lessons from failures → notes/lessons.md
    if (ctx.isError && errorText.length > 10) {
      captureLesson(opts.projectDir, toolName, errorCategory ?? "unknown", errorText, ctx.args);
      opts.bus?.emit({
        type: "tool_failure",
        tool: toolName,
        errorCategory: errorCategory ?? "unknown",
        errorMessage: errorText.slice(0, 500),
        args: summarizeArgs(ctx.args),
      });
    }

    // 3. Set reminder flags — providers in reminders.ts render them on next turn
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

  /** Snapshot current harness state for session persistence. */
  const snapshotState = () => ({
    cost: tracker.totalCost,
    inputTokens: tracker.totalInputTokens,
    outputTokens: tracker.totalOutputTokens,
    lastContextTokens: tracker.lastContextTokens,
    startTime,
    piStopped,
  });

  return { before, after, tracker, trackUsage, startTime, setPIStopped, snapshotState };
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

// ── Failure capture → notes/lessons.md ───────────────────────────────────────

/** Extract error text from tool result. */
function extractErrorText(ctx: any): string {
  if (!ctx.isError) return "";
  return extractTextContent(ctx.result?.content ?? []).slice(0, 1000);
}

/** Classify error into a category for structured logging. */
function classifyError(errorText: string, toolName: string): string {
  const t = errorText.toLowerCase();
  // LaTeX
  if (t.includes("undefined control sequence") || t.includes("missing $")) return "latex_syntax";
  if (t.includes("file not found") && toolName === "compile_latex") return "latex_missing_file";
  // Python
  if (t.includes("modulenotfounderror") || t.includes("importerror")) return "python_import";
  if (t.includes("syntaxerror")) return "python_syntax";
  if (t.includes("typeerror") || t.includes("attributeerror")) return "python_type";
  if (t.includes("filenotfounderror")) return "file_not_found";
  // Shell
  if (t.includes("command not found")) return "shell_command_not_found";
  if (t.includes("permission denied")) return "shell_permission";
  // Network
  if (t.includes("econnrefused") || t.includes("timeout") || t.includes("rate limit")) return "network";
  // Generic
  if (toolName === "compile_latex") return "latex_other";
  if (toolName === "bash") return "shell_other";
  return "other";
}

/**
 * Append a lesson entry to notes/lessons.md.
 * Deduplicates: if the same error category + tool combination exists in the
 * last 5 entries, skip to avoid noise.
 */
function captureLesson(
  projectDir: string,
  toolName: string,
  errorCategory: string,
  errorText: string,
  args: any,
): void {
  const lessonsPath = join(projectDir, "notes", "lessons.md");

  // Dedup check — skip if same tool+category combo appears in recent entries
  const existing = readFileSafe(lessonsPath);
  if (existing) {
    const tail = existing.slice(-2000);
    if (tail.includes(`${toolName} — ${errorCategory}`)) return;
  }

  // First line of error (most informative)
  const firstLine = errorText.split("\n").find(l => l.trim().length > 5) ?? errorText.slice(0, 200);
  const argsStr = args?.command ?? args?.file_path ?? args?.hypothesis ?? "";

  const entry = [
    `### ${new Date().toISOString().slice(0, 16)} ${toolName} — ${errorCategory}`,
    `- **Error:** ${firstLine.slice(0, 300)}`,
    argsStr ? `- **Context:** ${String(argsStr).slice(0, 200)}` : "",
    `- **Resolution:** _(pending — update when fixed)_`,
    "",
  ].filter(Boolean).join("\n");

  const header = existing ? "" : "# Lessons Learned\n\nFailures and fixes captured automatically. Update **Resolution** when you fix the issue.\n\n";

  try {
    mkdirSync(join(projectDir, "notes"), { recursive: true });
    appendFileSync(lessonsPath, header + entry + "\n");
  } catch {}
}
