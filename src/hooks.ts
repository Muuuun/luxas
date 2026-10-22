/**
 * Layer 4: Hooks — runtime policies (safety guards + tracking).
 *
 * beforeToolCall: cost/time limits, file protection
 * afterToolCall: session logging, tmux logging, convergence tracking
 */

import { setExitReason } from "./exit-state.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSafe, extractTextContent } from "./utils.js";
import { readUsageTotals, SOFT_CAP_FRACTION } from "./usage-log.js";
import { blindFlagAnswerText, buildClaimTable } from "./claims-table.js";
import { loadAgentDefinitions } from "./agents/registry.js";
import { surfaceReturnedIsError } from "./agents/safety-wrappers.js";
import type { ReminderRegistry } from "./reminders.js";
import type { ExtensionBus } from "./extensions.js";

// Defined beside the cost cap so the review loop can share it without importing hooks.
export { SOFT_CAP_FRACTION };

// ── Finalization freeze policy ─────────────────────────────────────────────
// One allow-list, two triggers: the PI's STOP verdict and the soft cost cap.
// Both mean the same thing operationally — "land what exists, open nothing
// new" — so they must not disagree about which tools are still legal.
// They differ deliberately in one place, the dispute hatch: a STOP with a
// DISPUTED/CONDITIONAL headline row still has budget for a settling
// experiment, while the last 10% of the cap does not.

/**
 * Tools that remain available once a run is in finalization. idle waits on
 * landing agents with zero LLM turns; init_report is idempotent and never
 * overwrites an existing report.tex — neither opens new work.
 */
export const FINALIZATION_TOOLS = new Set([
  "read", "write", "edit", "compile_latex", "request_pi_review", "escalate_authority_bound", "finish",
  "idle", "init_report",
]);

/**
 * Agents a finish() gate (or a PI-mandated finalization pass) can require.
 * Allowing these through breaks the deadlock observed 2026-05-07 on the BOM
 * run: PI verdict STOP blocked spawn_agent, the typesetter finish-gate
 * required spawn_agent typesetter, and brain looped 240+ times alternating
 * spawn (blocked) / finish (blocked).
 *
 * These are SEEDS, not the answer — see finalizationAllowedAgents().
 */
export const FINALIZATION_SEED_AGENTS = [
  "typesetter", "illustrator", "illustrator_write", "experiment_reviewer", "reviewer",
  // Both are finish-gate mandated (2026-07-05). Omitting contradiction_auditor
  // created a genuine deadlock: the finish gate demands a clean sweep while the
  // PI-STEER hook blocked spawning the only agent that can produce it — the brain
  // was cornered into hand-writing sweep files with forged/placeholder md5s.
  "contradiction_auditor", "ledger_writer",
  // finish() blocks on a stale reviews/prior_art.md and names this agent as the
  // only fix, but the freeze did not list it: blocker #4 of four unclearable
  // blockers in pp-vs-ss-gate-packing-20260826's finalization-blocked.md.
  "prior_art_auditor",
  // Blocks the brain can hit while frozen name these: finish() check 1d
  // (report-integrity.ts, missing claims.json) sends it to report_writer, as
  // brain.md's report flow does; compile_latex's repeated-error footer
  // (tools/report.ts) sends it to fixer. Both are leaves, so the closure grows
  // by exactly these two.
  "report_writer", "fixer",
];

/** A blind replicate never opens new research, so it is always finalization. */
export const SETTLING_SEED_AGENTS = ["replicator"];

/** Finalization only under a PI STOP while the claim table has a blocked headline row. */
export const DISPUTE_SEED_AGENTS = ["experiment"];

/**
 * Close the seed set under `spawn.allowedTypes`.
 *
 * The freeze used to be a hand-maintained list of leaf agents, and it was
 * wrong in both directions at once (measured 2026-09-22 across the 08-25..09-20
 * runs): `reviewer` was allowed but the `figure_auditor` it spawns 15 times
 * was not, and the 2026-08-28 settling hatch allowed `experiment` while
 * freezing the `tool_impl` / `tool_review` that every experiment spawns on
 * turn one — so the hatch could not actually settle anything. Deriving the
 * closure makes "allowed" mean "allowed to do its job", by construction.
 * The graph is validated acyclic by validateSpawnGraph().
 */
function spawnClosure(seeds: string[]): Set<string> {
  const out = new Set<string>();
  let defs: Map<string, { spawn: { allowedTypes: string[] } }>;
  try { defs = loadAgentDefinitions() as any; } catch { return new Set(seeds); }
  const stack = [...seeds];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const child of defs.get(n)?.spawn?.allowedTypes ?? []) stack.push(child);
  }
  return out;
}

let _allowedBase: Set<string> | undefined;
let _allowedDisputed: Set<string> | undefined;

/** Agent types spawnable during finalization. `claimBlocked` opens the settling hatch. */
export function finalizationAllowedAgents(claimBlocked: boolean): Set<string> {
  if (claimBlocked) {
    return (_allowedDisputed ??= spawnClosure([...FINALIZATION_SEED_AGENTS, ...SETTLING_SEED_AGENTS, ...DISPUTE_SEED_AGENTS]));
  }
  return (_allowedBase ??= spawnClosure([...FINALIZATION_SEED_AGENTS, ...SETTLING_SEED_AGENTS]));
}

/** The single predicate both finalization triggers ask. */
export function finalizationAllows(toolName: string, spawnTarget: string, claimBlocked: boolean): boolean {
  if (FINALIZATION_TOOLS.has(toolName)) return true;
  if (toolName !== "spawn_agent") return false;
  return finalizationAllowedAgents(claimBlocked).has(spawnTarget);
}

/**
 * The block text both triggers share: what is still legal, and what was
 * refused. The cost trigger never opens the dispute hatch, so its text names
 * the routes that fit in what is left instead of promising settling agents.
 */
export function finalizationDenyText(toolName: string, spawnTarget: string, claimBlocked: boolean, trigger: "pi_stop" | "cost" = "pi_stop"): string {
  const hatch = claimBlocked && trigger === "pi_stop";
  const agents = [...finalizationAllowedAgents(hatch)].sort().join("/");
  const what = toolName === "spawn_agent" ? `Tool "spawn_agent" (target: ${spawnTarget || "?"})` : `Tool "${toolName}"`;
  return (
    `Only finalization tools (${[...FINALIZATION_TOOLS].join(", ")}, and spawn_agent for ${agents}) are allowed. ` +
    `${what} is blocked. ` +
    (trigger === "cost"
      ? `No new experiment starts in the last 10% of the cap, even while a headline quantity is DISPUTED/CONDITIONAL: one does not fit in what is left. ` +
        `For such a row, abstain on it in the abstract (the claim table's [abstain] sentence), or CLAIM-DISCLOSE it for the PI or a reviewer to countersign — ` +
        `at most one disclosed headline quantity; more than one is a notes/escalations/needs-operator.md escalation, not a report. ` +
        `In what is left, ${blindFlagAnswerText(false)}.`
      : hatch
        ? `A headline quantity is DISPUTED/CONDITIONAL, so settling work (replicator / experiment and the tools an experiment needs) is open.`
        : `If a headline quantity is DISPUTED/CONDITIONAL the settling agents open automatically — check the claim table rather than working around this block.`)
  );
}


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

/** True when the claim table has a DISPUTED/CONDITIONAL headline row (legacy projects: never). */
function claimTableBlocked(projectDir: string): boolean {
  try {
    const t = buildClaimTable(projectDir);
    return t.declared && t.rows.some((r) => r.headline && (r.status === "disputed" || r.status === "conditional"));
  } catch { return false; }
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

  // PI STOP enforcement — when PI says stop, block non-finalization tools.
  // The allow-list itself is module scope (FINALIZATION_TOOLS /
  // finalizationAllowedAgents) because the soft cost cap uses the same one.
  let piStopped = init?.piStopped ?? false;

  let logWriteFailures = 0;
  const MAX_LOG_FAILURES = 3;

  // The hard-cap comment below warns that a blocked tool call is still a paid
  // turn (~$70 burned on 2026-04-20 by a block loop). The soft-cap freeze can
  // loop the same way, so it is bounded: a brain that refuses this many
  // landing invitations in a row is not going to land, and grinding to the
  // hard cap costs more than stopping here. Reset by any allowed call.
  const MAX_SOFT_CAP_DENIALS = 10;
  let softCapDenials = 0;

  /**
   * Refuse a tool call AND leave a trace.
   *
   * A hook that returns {block:true} short-circuits the call, so afterToolCall
   * never runs and nothing reaches log.jsonl. Measured 2026-09-22: across six
   * runs — two of which ended in operator escalations *about* the STOP freeze —
   * `grep "PI verdict is STOP" .agent/log.jsonl` matched zero lines in all six.
   * The only record of a freeze deadlock was the brain's own prose. A policy
   * nobody can measure is a policy nobody can fix, so every block is logged.
   */
  const deny = (tool: string, args: any, reason: string) => {
    try {
      appendFileSync(logFile, JSON.stringify({
        type: "tool_block", tool, args: summarizeArgs(args),
        reason: reason.slice(0, 400), timestamp: new Date().toISOString(),
      }) + "\n");
    } catch { /* logging must never convert a block into a crash */ }
    return { block: true, reason };
  };

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
        return deny(name, args, "RESEARCH.md is read-only. It contains the human-written research goal and must not be modified.");
      }
    }

    // 1b. Hand-compile bypass block. compile_latex is the single-source
    // compile path (engine selection, CJK guard, verdict parse). Observed
    // 2026-07-05: the brain hand-ran `lualatex` in bash on a hallucinated
    // theory that compile_latex used LuaHBTeX; xeCJK critically fails under
    // LuaTeX, so the run shipped a 4461-missing-glyph mojibake PDF and the
    // polluted report.log then blocked finish() on stale errors for 10
    // cycles. The engine binaries are blocked in bash outright — every
    // legitimate compile goes through compile_latex.
    if (name === "bash") {
      const cmd = String(args.command ?? "");
      if (/\b(?:lualatex|luahbtex|xelatex|pdflatex|latexmk)\b/.test(cmd)) {
        return deny(name, args,
          "Direct LaTeX engine invocation in bash is blocked. Use the compile_latex tool — " +
          "it selects the correct engine (xelatex for CJK), runs the guards, and produces the " +
          "verdict that finish() reads. Hand-compiling (especially lualatex: xeCJK requires " +
          "XeTeX and silently drops every CJK glyph under LuaTeX) pollutes report.log and " +
          "ships mojibake PDFs.");
      }
    }

    // 2. PI STOP enforcement — only allow finalization tools after PI says stop.
    // spawn_agent is allowed when the target is a finalization helper
    // (typesetter / illustrator / experiment_reviewer / reviewer) — these
    // are mandated by finish-gate audits, not new research.
    // Claims-first settling work is finalization (2026-08-28 pp-vs-ss
    // deadlock): with headline rows DISPUTED/CONDITIONAL, finish() blocks and
    // every legal move is a replicator or a discriminator experiment — both of
    // which the STOP freeze refused. The brain wrote three escalation notes and
    // exited. Replicators are always finalization; an experiment is, exactly
    // while the table has a blocked headline row — and so is everything that
    // experiment must spawn to run (the closure, see finalizationAllowedAgents).
    if (piStopped) {
      const target = String(args.agent ?? "");
      const claimBlocked = name === "spawn_agent" && claimTableBlocked(opts.projectDir);
      if (!finalizationAllows(name, target, claimBlocked)) {
        // Past the soft cap the cost freeze below shuts the dispute hatch, so
        // this refusal must not promise it. The hatch's agents still fall
        // through to that freeze, which refuses them and counts the refusal.
        const atSoftCap = maxCost < Infinity && readUsageTotals(usageLogPath).cost >= maxCost * SOFT_CAP_FRACTION;
        return deny(name, args, `PI verdict is STOP. ${finalizationDenyText(name, target, claimBlocked, atSoftCap ? "cost" : "pi_stop")}`);
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
        setExitReason("budget_exhausted", `cost $${totals.cost.toFixed(2)} exceeded the $${maxCost} cap`);
        process.exit(1);
      }
      // Soft cap — finalization freeze, not advice.
      //
      // The 90% notice (buildBudgetStatus() in context.ts) is prose: it asks
      // the brain to open no new work. Measured 2026-08-31 on
      // ba-neutral-atom-qc-20260829: it kept spawning past $144 and the hard
      // cap SIGKILLed it mid-`read` at $160.28 — no finish(), no landing, the
      // run recoverable only from checkpoint. Two other runs of the six died
      // the same family of death (provider 402 at the cap).
      //
      // So the last 10% is reserved for landing by the same mechanism the PI's
      // STOP verdict uses. Same allow-list, so the two triggers cannot
      // disagree: read/write/edit/compile_latex/finish stay open, new
      // experiments and searches do not. The one deliberate difference is
      // the dispute hatch, which stays shut here: a disputed headline row
      // admitted a fresh experiment (and its tool_impl/tool_review) with
      // under 10% left, which cannot finish in what remains. Abstention,
      // CLAIM-DISCLOSE and a replicator still can. The hard kill below stays
      // as the backstop for a run that ignores the freeze.
      if (totals.cost >= maxCost * SOFT_CAP_FRACTION) {
        const target = String(args.agent ?? "");
        if (!finalizationAllows(name, target, false)) {
          if (++softCapDenials > MAX_SOFT_CAP_DENIALS) {
            console.error(
              `\n[FATAL] ${softCapDenials - 1} consecutive non-finalization tool calls after the ` +
              `${Math.round(SOFT_CAP_FRACTION * 100)}% cost freeze ($${totals.cost.toFixed(2)} of $${maxCost}). ` +
              `The brain is not landing; each blocked call is still a paid turn. Killing process — ` +
              `the checkpoint is live.\n`,
            );
            setExitReason("budget_exhausted", `${softCapDenials - 1} consecutive non-finalization calls after the ${Math.round(SOFT_CAP_FRACTION * 100)}% freeze at $${totals.cost.toFixed(2)} of $${maxCost}`);
            process.exit(1);
          }
          return deny(name, args,
            `Spend has passed ${Math.round(SOFT_CAP_FRACTION * 100)}% of this run's $${maxCost} cap ` +
            `($${totals.cost.toFixed(2)}), so the run is in finalization: what is left is reserved for landing. ` +
            finalizationDenyText(name, target, false, "cost") + " " +
            `Write down anything held only in this conversation (notes/memory.md), ` +
            `compile once, then finish() — DISCLOSING what is unresolved. A disclosed limitation is a ` +
            `finished report; an undisclosed one is the only real failure. If a gate blocks finish() and ` +
            `you cannot clear it within what is left, say so plainly and let the escalation hand the run ` +
            `to a person — do not iterate against it.`);
        }
        softCapDenials = 0;
      }
    }

    return undefined; // Allow
  };

  const after = async (ctx: any): Promise<any> => {
    const toolName = ctx.toolCall?.name ?? "unknown";
    // ctx.isError is set only for a thrown error; a safety block returns
    // isError:true instead (see surfaceReturnedIsError).
    const isError = ctx.isError === true || ctx.result?.isError === true;
    const errorText = extractErrorText(ctx, isError);
    const errorCategory = isError ? classifyError(errorText, toolName) : undefined;
    // A gate-blocked finish returns plain content without details.success
    // (src/tools/index.ts); it is not a fault, but it is not a finish either.
    const finishNotDone = toolName === "finish" && !isError && ctx.result?.details?.success !== true;

    // 1. Log to JSONL (enriched with error info)
    const entry: Record<string, any> = {
      type: "tool_call",
      tool: toolName,
      args: summarizeArgs(ctx.args),
      success: !isError && !finishNotDone,
      timestamp: new Date().toISOString(),
    };
    if (isError && errorCategory) {
      entry.errorCategory = errorCategory;
      entry.errorMessage = errorText.slice(0, 300);
    } else if (finishNotDone) {
      const firstLine = (extractTextContent(ctx.result?.content ?? []).split("\n").find((l) => l.trim()) ?? "").trim();
      entry.errorCategory = firstLine.startsWith("finish() deferred") ? "finish_deferred" : "finish_refused";
      entry.errorMessage = firstLine.slice(0, 300);
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

    // 2. Capture lessons from failures → notes/lessons.md. Thrown errors only:
    //    a safety block is policy working as intended, not a lesson to record.
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

    if (toolName === "compile_latex" && reminders) {
      const existingContent: any[] = ctx.result?.content ?? [];
      const hadErrors = isError || existingContent.some(
        (c: any) => typeof c.text === "string" && (c.text.includes("Error") || c.text.includes("Warning") || c.text.includes("Undefined"))
      );
      if (hadErrors) {
        reminders.setFlag("latex_had_errors", true, 5 * 60 * 1000);  // 5 min TTL
      }
    }

    // 4. Notify on successful arXiv paper download so the caller (agent.ts) can
    //    dispatch a reader. Hook stays policy-only.
    //
    //    Arxiv-only here: DOI/URL downloads have non-predictable filename
    //    derivation, and the <unprocessed_papers> fallback in the research
    //    snapshot catches them by scanning data/papers/ every turn.
    if (toolName === "bash" && !isError && opts.onPaperDownloaded) {
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

    // Content is never modified (reminders appear in the snapshot); only a
    // returned isError is carried onto the call. A refused finish has none,
    // so it is logged as failed above but not sent to the provider as is_error.
    return surfaceReturnedIsError(ctx);
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

  /** PI STOP freeze on/off. A genuine later non-STOP verdict clears it; placeholder (no-response) verdicts touch nothing. */
  const setPIStopped = (v = true) => { piStopped = v; };

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
function extractErrorText(ctx: any, isError: boolean): string {
  if (!isError) return "";
  return extractTextContent(ctx.result?.content ?? []).slice(0, 1000);
}

/** Classify error into a category for structured logging. */
function classifyError(errorText: string, toolName: string): string {
  const t = errorText.toLowerCase();
  // Safety-wrapper refusals (blocked() in agents/safety-wrappers.ts) first:
  // their text often quotes the offending command, which would match below.
  if (t.startsWith("blocked:")) return "safety_block";
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
