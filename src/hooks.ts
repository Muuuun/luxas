/**
 * Layer 4: Hooks — runtime policies (safety guards + tracking).
 *
 * beforeToolCall: cost/time limits, file protection, rate limiting
 * afterToolCall: session logging, tmux logging, convergence tracking
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSafe, extractTextContent } from "./utils.js";
import { readUsageTotals } from "./usage-log.js";
import type { ReminderRegistry } from "./reminders.js";
import type { ExtensionBus } from "./extensions.js";

export interface ResearchOptions {
  maxCostUsd?: number;       // Cost limit in USD. On exceed, process exits.
  projectDir: string;
  usageLogPath?: string;     // Path to usage.log (default: .agent/usage.log)
  reminders?: ReminderRegistry;
  bus?: ExtensionBus;
  /**
   * Side-effect invoked after a successful `search download --arxiv <id>`
   * bash call. Injected by agent.ts so hooks stay policy-only (no direct
   * dependency on agents/spawn.ts). Fire-and-forget; callback owns queueing,
   * dedup, and error handling.
   */
  onPaperDownloaded?: (paperId: string) => void;
  /** Restored harness state from session JSONL (stateless harness recovery). */
  initialState?: {
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    lastContextTokens?: number;
    piStopped?: boolean;
  };
}

export interface CostTracker {
  lastContextTokens: number;  // #3: precise token count from last LLM response (used by compaction)
}

export function buildResearchHooks(opts: ResearchOptions) {
  const init = opts.initialState;
  const maxCost = opts.maxCostUsd ?? 250;  // Default runaway backstop ($250 ≈ 2× largest observed legit run); override per-run with --max-cost
  const logFile = join(opts.projectDir, ".agent", "log.jsonl");

  // Ensure log directory exists
  mkdirSync(dirname(logFile), { recursive: true });

  const usageLogPath = opts.usageLogPath ?? join(opts.projectDir, ".agent", "usage.log");

  const tracker: CostTracker = {
    lastContextTokens: init?.lastContextTokens ?? 0,
  };

  // PI STOP enforcement — when PI says stop, block non-finalization tools
  let piStopped = init?.piStopped ?? false;
  const FINALIZATION_TOOLS = new Set([
    "read", "write", "edit", "compile_latex", "request_pi_review", "escalate_authority_bound", "finish",
  ]);
  // Spawn targets that are themselves finalization helpers (audit / red-team
  // agents required by various finish() gates). Allowing these through PI-STOP
  // breaks the deadlock observed 2026-05-07 BOM run: PI verdict STOP blocked
  // spawn_agent, but the typesetter finish-gate required spawn_agent typesetter,
  // and brain looped 240+ times alternating spawn (blocked) / finish (blocked).
  const FINALIZATION_HELPER_AGENTS = new Set([
    "typesetter", "illustrator", "illustrator_write", "experiment_reviewer", "reviewer",
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

    // 2. PI STOP enforcement — only allow finalization tools after PI says stop.
    // spawn_agent is allowed when the target is a finalization helper
    // (typesetter / illustrator / experiment_reviewer / reviewer) — these
    // are mandated by finish-gate audits, not new research.
    if (piStopped && !FINALIZATION_TOOLS.has(name)) {
      const isFinalizationSpawn = name === "spawn_agent"
        && FINALIZATION_HELPER_AGENTS.has(String(args.agent ?? ""));
      if (!isFinalizationSpawn) {
        return { block: true, reason: `PI verdict is STOP. Only finalization tools (read, write, edit, compile_latex, request_pi_review, escalate_authority_bound, finish, and spawn_agent for ${[...FINALIZATION_HELPER_AGENTS].join("/")}) are allowed. Tool "${name}"${name === "spawn_agent" ? ` (target: ${args.agent})` : ""} is blocked.` };
      }
    }

    // 3. Cost limit (reads from usage.log — single source of truth).
    // On exceed, kill the process directly — returning {block: true} only
    // rejects the tool call, which feeds the reason back to the model as a
    // tool result; the model then emits another tool call in a new LLM
    // turn, which blocks again, and each block is one full paid turn.
    // That observed-failure mode burned ~$70 on 2026-04-20 before being
    // caught. `process.exit(1)` is non-swallowable and stops the bleed.
    if (maxCost < Infinity) {
      const totals = readUsageTotals(usageLogPath);
      if (totals.cost > maxCost) {
        console.error(
          `\n[FATAL] Cost limit exceeded: $${totals.cost.toFixed(2)} > $${maxCost}. ` +
          `Killing process.\n`,
        );
        process.exit(1);
      }
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

    // 4. Notify on successful arXiv paper download so the caller (agent.ts) can
    //    dispatch a reader. Hook stays policy-only.
    //
    //    Arxiv-only here: DOI/URL downloads have non-predictable filename
    //    derivation, and the <unprocessed_papers> fallback in the research
    //    snapshot catches them by scanning data/papers/ every turn.
    if (toolName === "bash" && !ctx.isError && opts.onPaperDownloaded) {
      const cmd = String(ctx.args?.command ?? "");
      if (/\bsearch\s+download\b[^|&;]*?--arxiv\b/.test(cmd)) {
        // Primary: literal id directly after the flag, e.g. `--arxiv 2308.07915`
        // or `--arxiv=2308.07915`, optionally quoted.
        let m = cmd.match(/--arxiv[=\s]+["']?(\d{4}\.\d{4,5})["']?/);
        // Fallback: shell-variable form like `id=2308.07915; search download --arxiv $id`.
        // The literal id appears elsewhere on the same command string — take the first
        // well-formed arXiv token. Conservative: only if the primary match missed.
        if (!m) m = cmd.match(/\b(\d{4}\.\d{4,5})\b/);
        if (m) opts.onPaperDownloaded(m[1]);
      }
    }

    return undefined; // Don't modify tool results — reminders appear in snapshot
  };

  // Update context token count for compaction triggers (called from agent event subscription).
  // Cost/token totals are tracked in usage.log by the provider-level wrapper.
  const updateContextTokens = (usage: any) => {
    if (usage) {
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
  const snapshotState = () => {
    const totals = readUsageTotals(usageLogPath);
    return {
      cost: totals.cost,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      lastContextTokens: tracker.lastContextTokens,
      piStopped,
    };
  };

  return { before, after, tracker, updateContextTokens, setPIStopped, snapshotState };
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
