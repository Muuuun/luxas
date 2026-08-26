/**
 * Layer 3: transformContext — research state injection + message compaction.
 *
 * Compaction is handled by the universal ContextPacker module.
 * This file adds the brain-specific layer: research snapshot injection,
 * notes compaction trigger, completion hints, and bus event bridging.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFileSafe, smartTruncate, parseFollowUps } from "./utils.js";
import { listExperimentDirs, xvalVerdict } from "./tools/report-integrity.js";
import { buildClaimTable, renderClaimTable } from "./claims-table.js";
import { buildPastResearchDigest, GLOBAL_MEMORY_PATH } from "./memory.js";
import { buildCareerBlock } from "./career.js";
import { findUnprocessedPapers, methodologyPath } from "./methodology.js";
import { join, dirname } from "node:path";
import { compactNotesIfNeeded } from "./notes-compaction.js";
import { resolveContextBuilder } from "./agents/context-builders.js";
import { parseCompileVerdict, gateBlockingIssues } from "./tools/report.js";
import { createCompactionTransform, getContextWindow } from "./compaction/create-transform.js";
import type { TokenTap } from "./compaction/token-tap.js";
import type { Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionBus } from "./extensions.js";
import type { ReminderRegistry } from "./reminders.js";

// ── Research-specific summarizer prompts ─────────────
// (Moved from old compaction.ts — these customize the ContextPacker's
// summarizer for brain's research context.)

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant for an autonomous research agent (Luxas). Your task is to read a conversation and produce a structured summary. Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const RESEARCH_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the research.

CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. You already have all the context you need. Your entire response must be the structured summary below — any tool call will be rejected.

Use this EXACT format:

## Research Goal
[Current understanding of the research goal, verbatim from RESEARCH.md if available]

## All User Messages Verbatim
[List EVERY non-tool-result user message from the conversation, in order. These are critical for understanding user intent and preventing drift. Reproduce them verbatim — not paraphrased. If a message is very long, reproduce its key directive sentences verbatim and note "[truncated]" for the rest.]

## Literature Findings
- [Key papers read, with citation keys and core findings]
- [Or "(none yet)" if no papers read]

## Experiments Conducted
- [For each experiment: Hypothesis → Setup → Result → Interpretation]
- [Include EXACT numerical results, formulas, and parameter values]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Dead Ends
- [Approaches tried that didn't work, and WHY]
- [Or "(none)" if no dead ends encountered]

## Errors and Fixes
- [Errors encountered and how they were fixed; especially any user corrections]

## Progress
### Done
- [x] [Completed tasks/analyses]

### In Progress
- [ ] [Current work — be specific about file paths and line numbers]

## Current Work (Verbatim)
[Describe in detail EXACTLY what was being worked on immediately before this summary. Include direct quotes from the most recent user messages and assistant turns showing the specific task and where work was left off. This should be verbatim to prevent intent drift after resume.]

## Next Steps
1. [Ordered list of what should happen next]
2. [Tie directly to the most recent user request — do NOT start tangential work]

## Critical Context
- [File paths, parameter values, formulas, physical constants needed to continue]
- [Exact wavelengths, intensities, fidelity values, error budget numbers]
- [Or "(none)" if not applicable]

Keep each section concise but preserve ALL quantitative results, exact file paths, formula expressions, and numerical values — these are the agent's long-term memory.

REMINDER: Respond with plain text only. No tool calls.`;

const RESEARCH_UPDATE_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous_note> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new experiments, literature, decisions, and context
- UPDATE Progress: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE all exact numerical results, file paths, and formulas
- If something is no longer relevant, you may remove it
- If an earlier result was found to be WRONG, mark it clearly and add the correction

Use the same EXACT format as the original summary:

## Research Goal
## Literature Findings
## Experiments Conducted
## Key Decisions
## Dead Ends
## Progress
### Done / In Progress
## Next Steps
## Critical Context

Keep each section concise. Preserve exact file paths, formulas, and numerical values.`;

// ── Tool names eligible for micro-compaction ─────────

const COMPACTABLE_TOOLS = new Set([
  "read", "write", "edit", "bash",
  "search_papers", "get_citations", "download_paper",
  "grep", "glob", "web_search", "web_fetch",
]);

// ── Public interface ─────────────────────────────────

export interface ContextTransformerOptions {
  projectDir: string;
  model?: Model<any>;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  bus?: ExtensionBus;
  reminders?: ReminderRegistry;
  /** Restored from session compaction entries for crash recovery. */
  initialPreviousSummary?: string;
  /**
   * Fix β: when `luxas run --directive "..."` started this session, pass that
   * verbatim string here. The trailer puts it at the TOP as
   * `<user_directive priority="highest" new="true">…` so that on every turn
   * the directive sits structurally above the "done" signals from notes/,
   * experiments.md, plan.md. Without this, on a previously-finish()'d project
   * brain pattern-matches the trailer's wrap-up state and ignores the new ask.
   */
  userDirective?: string;
}

export interface ContextTransformerResult {
  transformContext: (messages: any[]) => Promise<any[]>;
  tokenTap: TokenTap;
}

export function buildContextTransformer(opts: ContextTransformerOptions): ContextTransformerResult {
  const { projectDir, model, getApiKey, bus } = opts;

  // ── Build universal compaction via ContextPacker ──
  const { transformContext: packTransform, tokenTap } = createCompactionTransform({
    model,
    getApiKey,
    thresholds: { windowLimit: model ? getContextWindow(model) : undefined },
    toolPrune: { eligibleToolNames: COMPACTABLE_TOOLS },
    summarizer: {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      freshNoteTemplate: RESEARCH_SUMMARIZATION_PROMPT,
      updateNoteTemplate: RESEARCH_UPDATE_PROMPT,
    },
    callbacks: {
      onTrim: (p: any) => bus?.emit({ type: "micro_compaction", charsFreed: p.freedUnits }),
      onWarning: (p: any) => bus?.emit({ type: "memory_warning", tokenCount: p.observedSize, threshold: p.threshold }),
      onBeforeCondense: (p: any) => bus?.emit({ type: "before_compaction", messages: p.messages, tokenCount: p.observedSize }),
      onAfterCondense: (p: any) => {
        bus?.emit({ type: "after_compaction", summary: p.note, droppedCount: p.removedCount });
        if (model && getApiKey) {
          getApiKey("anthropic").then(apiKey => {
            if (apiKey) return compactNotesIfNeeded(projectDir, model, apiKey, bus);
          }).catch(() => {});
        }
      },
    },
    ledger: opts.initialPreviousSummary
      ? { readSnapshot: () => ({ note: opts.initialPreviousSummary! }), markApplied: () => {} }
      : undefined,
  });

  // ── Brain-specific layer: research snapshot injection ──
  const transformContext = async (messages: any[]): Promise<any[]> => {
    // Step 1: Universal compaction (micro-compact, snip, or full condense)
    const packed = await packTransform(messages);

    // (Overflow backstop now lives INSIDE packTransform — pre-pack so the
    // summarizer call is bounded, post-pack so the final request fits.)

    // Step 2: Brain-specific research snapshot injection (every turn)
    const snapshot = buildResearchSnapshot(opts);
    return injectSnapshot(packed, snapshot);
  };

  return { transformContext, tokenTap };
}

export { overflowBackstop } from "./compaction/overflow-backstop.js";

// ── Research snapshot (brain-specific) ────────────────

/**
 * Inject research snapshot into messages as a trailing user message.
 *
 * Cache budget (Anthropic max = 4 breakpoints per request):
 *   1. system prompt (one merged block, pinned in agent.ts)
 *   2. last message BEFORE the snapshot (pinned here) — caches the growing
 *      conversation history so it survives turn-over-turn snapshot deltas
 *   3. snapshot trailer (auto-pinned by pi-ai on the last user message)
 *
 * Skipping pin #2 would make every snapshot change invalidate the entire
 * conversation history (expensive once the session is >20 turns). Pinning
 * inside the history segment keeps that block cache-warm.
 *
 * Safety: transformContext output is ephemeral (used for one LLM call, never
 * persisted to agent state). Anthropic API accepts consecutive user messages.
 */
/**
 * H9: collect every active directive in priority order.
 *   1. The --directive flag on THIS process invocation (runtime; transient).
 *   2. Every `.md` file under `notes/directives/` (persisted by index.ts on
 *      each `luxas run --directive`). Files in `notes/directives/archived/`
 *      are skipped — the user moves stale directives there to retire them.
 * Returns at most MAX_TOTAL directives (newest first under disk), each
 * truncated to MAX_BYTES so a runaway file doesn't blow the cache budget.
 */
const MAX_DIRECTIVES = 6;
const MAX_DIRECTIVE_BYTES = 3000;
function collectActiveDirectives(
  projectDir: string,
  runtimeDirective: string | undefined,
): Array<{ source?: string; text: string }> {
  const out: Array<{ source?: string; text: string }> = [];
  if (runtimeDirective && runtimeDirective.trim()) {
    out.push({ source: "current --directive", text: runtimeDirective.trim().slice(0, MAX_DIRECTIVE_BYTES) });
  }
  const dir = join(projectDir, "notes", "directives");
  if (existsSync(dir)) {
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort().reverse(); }
    catch { /* unreadable dir; treat as empty */ }
    for (const name of names) {
      if (out.length >= MAX_DIRECTIVES) break;
      try {
        const raw = readFileSafe(join(dir, name)) ?? "";
        const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
        if (!body) continue;
        // Dedup against runtime directive
        if (runtimeDirective && body === runtimeDirective.trim()) continue;
        out.push({ source: name.replace(/\.md$/, ""), text: body.slice(0, MAX_DIRECTIVE_BYTES) });
      } catch { /* skip unreadable */ }
    }
  }
  return out;
}

function injectSnapshot(messages: any[], snapshot: string): any[] {
  if (messages.length <= 2) return messages;

  // The manual breakpoint that used to sit here — on the message BEFORE this
  // volatile trailer, so a long session's history stayed a cached prefix — is
  // no longer expressible: pi-ai 0.84 removed `cacheControl` from TextContent
  // and always marks the LAST user content block itself, which is this
  // snapshot. The system-prompt and tool-definition breakpoints still hit; the
  // history segment between them and the trailer is re-sent each turn.
  // Recovering it means making the snapshot part of the stable prefix (persist
  // it into history instead of regenerating per turn) — a change to what the
  // model sees, so it is a measured decision, not part of this migration.
  const result = [...messages];

  result.push({
    role: "user",
    content: `<research_snapshot>\n${snapshot}\n</research_snapshot>`,
    timestamp: Date.now(),
  });
  return result;
}

/**
 * Surface the experiment-authored generative forks (### FollowUp blocks) as a
 * first-class, UNTRUNCATED state block above the done-signals — so the brain
 * reads an OPEN lead as a candidate next ACTION (a continue-vs-report fork),
 * not as report prose buried under smartTruncate. An OPEN lead is one whose
 * proposed experiment has not run yet (no `## L2.N` / `## E_N` section). A
 * `FollowUp: NONE` or an already-run lead produces no row, so a genuinely
 * drained frontier emits nothing and the brain proceeds to the report.
 */
/**
 * Surface experiment-recorded PREMISE CORRECTIONS as a forced decision in the
 * brain's per-turn state — the surprise half of expectation/surprise dynamics
 * (2026-08-25 trace analysis). Observed failure this exists for: E1 computed
 * that 297 nm addresses n≈75, not the plan's n≈55–65 — a correction with
 * consequences for every downstream experiment (C6 ~ n^11) — and it landed in
 * a Limitations paragraph where nothing forced brain to propagate it. Prose
 * parks surprises; state interrupts them. Same pattern as research_frontier:
 * structured event from the experiment, untruncated block in the snapshot,
 * explicit disposition required.
 *
 * An experiment records in results.json:
 *   computed.premise_corrections: [{ premise, corrected, consequence,
 *                                    affects: ["E_3", "report"] }]
 * Brain clears a correction by EITHER editing plan.md for the affected
 * experiments OR recording  PREMISE-ACK: <EID>#<idx> — <why nothing changes>
 * in notes/memory.md. Unacknowledged corrections re-surface every turn.
 */
export function buildPremiseCorrections(projectDir: string): string {
  try {
    const memory = readFileSafe(join(projectDir, "notes", "memory.md")) ?? "";
    const rows: string[] = [];
    for (const e of listExperimentDirs(projectDir)) {
      if (!e.latestResults) continue;
      let j: any;
      try { j = JSON.parse(readFileSafe(e.latestResults) ?? ""); } catch { continue; }
      const pcs = j?.computed?.premise_corrections;
      if (!Array.isArray(pcs)) continue;
      pcs.forEach((c: any, i: number) => {
        if (!c || typeof c !== "object") return;
        if (memory.includes(`PREMISE-ACK: ${e.id}#${i}`)) return;
        const affects = Array.isArray(c.affects) ? c.affects.join(", ") : String(c.affects ?? "unstated");
        rows.push(`- [${e.id}#${i}] premise: ${String(c.premise ?? "?").slice(0, 160)}\n` +
          `    corrected: ${String(c.corrected ?? "?").slice(0, 160)}\n` +
          `    consequence: ${String(c.consequence ?? "?").slice(0, 200)}\n` +
          `    affects: ${affects}`);
      });
    }
    if (rows.length === 0) return "";
    return `<premise_corrections priority="high">\n` +
      `An experiment PROVED a premise of your plan wrong. This is a surprise signal, not a footnote —\n` +
      `every affected downstream experiment is currently specified against the WRONG premise.\n` +
      `For each entry, before dispatching anything it affects: EITHER edit plan.md so the affected\n` +
      `### E_N sections carry the corrected value, OR record in notes/memory.md a line\n` +
      `  PREMISE-ACK: <EID>#<idx> — <why the correction changes nothing downstream>\n` +
      `An entry stays in this block every turn until one of those happens.\n\n${rows.join("\n")}\n</premise_corrections>`;
  } catch {
    return "";
  }
}

/**
 * Open cross-method disagreements, from executed cross_validation entries
 * whose harness verdict is DISCREPANT. This is the prior check the
 * claims-first design (§3.7) requires before a full claim table is injected:
 * if surfacing today's disputes does not change what the brain dispatches,
 * a richer table will not either. The producer's cross_validation_resolved
 * is deliberately ignored (design §3.6 — H2). Deterministic over disk state.
 */
export function buildOpenDiscrepancies(projectDir: string): string {
  const rows: string[] = [];
  try {
    for (const e of listExperimentDirs(projectDir)) {
      if (!e.latestResults) continue;
      let j: any;
      try { j = JSON.parse(readFileSafe(e.latestResults) ?? ""); } catch { rows.push(`- ${e.id}: results.json unparseable`); continue; }
      const xv = j?.computed?.cross_validation;
      if (!Array.isArray(xv)) continue;
      for (const x of xv) {
        if (xvalVerdict(x) !== "discrepant") continue;
        rows.push(`- ${e.id} ${String(x?.claim_key ?? "?").slice(0, 70)}: ${x.value_a} (${String(x?.method_a ?? "?").slice(0, 36)}) vs ` +
          `${x.value_b} (${String(x?.method_b ?? "?").slice(0, 36)})`);
      }
    }
  } catch (err) {
    rows.push(`- MALFORMED: ${(err as Error).message.slice(0, 100)}`);
  }
  if (rows.length === 0) return "";
  return `<open_discrepancies priority="high">\n` +
    `Two independent methods DISAGREE on these quantities and nothing has settled which is right. ` +
    `A number equal to either side may headline only at grade "disputed" with a hedge. Settling one ` +
    `takes a third independent estimate (an experiment with a different route, or a blind replication) ` +
    `or a non-producer adjudication with a locator — not a paragraph explaining why one method wins.\n` +
    `${rows.join("\n")}\n</open_discrepancies>`;
}

function buildResearchFrontier(projectDir: string): string {
  try {
    const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
    if (!exp) return "";
    const leads = parseFollowUps(exp);
    const ran = new Set<number>();
    for (const m of exp.matchAll(/^##\s+(?:L2\.|E_?)(\d+)\b/gm)) ran.add(parseInt(m[1], 10));
    const open = leads.filter(l => !l.isNone && !ran.has(l.num));
    if (open.length === 0) return "";
    const rows = open.map(l =>
      `- [OPEN] ${l.leadId} (from ${l.sourceSection}${l.effort ? `, effort: ${l.effort.slice(0, 48)}` : ""})` +
      (l.question ? `\n    Question: ${l.question}` : "") +
      (l.decisionRule ? `\n    Decision rule: ${l.decisionRule}` : "")
    ).join("\n");
    return `<research_frontier priority="high">\n` +
      `Open generative leads your OWN completed experiments proposed but did NOT run.\n` +
      `Each is a candidate next ACTION — a continue-vs-report fork — NOT report prose.\n` +
      `write_report is also a candidate action. Do NOT finish() while an OPEN lead\n` +
      `could change a headline finding: either dispatch the experiment, or record in\n` +
      `notes/memory.md a line  FRONTIER-DECLINE: <leadId> — <why, citing its Decision\n` +
      `rule>. A lead that only enriches future-work is a legitimate DEFER; a lead that\n` +
      `could flip OR undermine the soundness of a claim you will SHIP is not.\n\n${rows}\n</research_frontier>`;
  } catch {
    return "";
  }
}

/**
 * Build a snapshot of current research state from files on disk.
 */
function buildResearchSnapshot(opts: ContextTransformerOptions): string {
  const { projectDir } = opts;
  const parts: string[] = [];

  // Project directory (ground truth for path resolution)
  parts.push(`<project_dir>${projectDir}</project_dir>`);

  // Lives in the volatile trailer, not the cached prefix, so the cache isn't
  // invalidated when the date rolls over mid-run.
  parts.push(`<today>${new Date().toISOString().slice(0, 10)}</today>`);

  // Fix β + H9: surface ALL active directives ABOVE every "done" signal so they
  // can't be drowned out by the wrap-up state (experiment_notes, plan_status,
  // pi_feedback all saying "Complete"). Sources, in priority order:
  //   1. opts.userDirective — the --directive flag on THIS process invocation
  //   2. notes/directives/*.md — union of all persisted directives from prior
  //      `luxas run --directive` invocations (Fix H9, persistDirectiveIfNew)
  // Without H9's persistence, on resume runs the user's original directive
  // evaporates: β has nothing to inject, brain loses sight of original intent.
  // Reading the union from disk means resumes inherit every active directive
  // until the user manually retires one (move to notes/directives/archived/).
  const allDirectives = collectActiveDirectives(projectDir, opts.userDirective);
  if (allDirectives.length > 0) {
    parts.push(
      `<user_directive priority="highest" new="true">\n` +
      `The user issued the directive(s) below. They take precedence over all ` +
      `"done"/"complete" signals in this snapshot. Until you have explicitly ` +
      `addressed EACH clause of EACH directive in the report.tex or in a new ` +
      `experiment under data/experiments/, do not call finish().\n\n` +
      allDirectives.map((d, i) =>
        `### Directive ${i + 1}${d.source ? ` (from ${d.source})` : ""}\n${d.text}`
      ).join("\n\n") +
      `\n</user_directive>`
    );
  }

  // Research frontier: experiment-authored generative forks (### FollowUp
  // blocks), surfaced as candidate-next-action state ABOVE the done-signals —
  // same tier as the directive. Without this the forks were clipped by
  // smartTruncate and read only as report prose, so the brain never saw the
  // continue-vs-report decision they encode. See buildResearchFrontier.
  const frontier = buildResearchFrontier(projectDir);
  if (frontier) parts.push(frontier);

  // Premise corrections outrank the frontier: an open lead extends the plan,
  // a corrected premise INVALIDATES part of it. Same untruncated tier.
  const premises = buildPremiseCorrections(projectDir);
  if (premises) parts.push(premises);

  // Open cross-method disputes (claims-first design §3.7 prior check,
  // 2026-08-26): the two-line block that must be shown to change dispatch
  // before the full <claim_status> table is built. Deterministic over disk.
  const disputes = buildOpenDiscrepancies(projectDir);
  if (disputes) parts.push(disputes);

  // Claim status (claims-first design §3.7, 2026-08-26): quantity-level
  // state — headline rows first, bounded, deterministic. Replaces the
  // run-level dynamics blocks (stopping / anomalies / lineage): stopping is
  // "every headline quantity corroborated or disclosed", an anomaly is a
  // DISPUTED row, lineage is the estimates column. Empty for legacy projects.
  try {
    const table = buildClaimTable(projectDir);
    const rendered = renderClaimTable(table);
    if (rendered) parts.push(rendered);
  } catch (err) {
    parts.push(`<claim_status>\n- MALFORMED table could not be built: ${(err as Error).message.slice(0, 120)}\n</claim_status>`);
  }

  // Execution-state snapshot (active sub-agents, completed artifacts, plan
  // status). Formerly a dedicated cache-pinned system layer (L3); moved here
  // because it changes at the same tempo as the other trailer content, and
  // the cache budget is tight enough that a separate pin per section would
  // overrun Anthropic's 4-breakpoint limit.
  const brainSnapshot = resolveContextBuilder("brain");
  if (brainSnapshot) {
    const brainBlock = brainSnapshot(projectDir).trim();
    if (brainBlock) parts.push(brainBlock);
  }

  // Literature state
  const lit = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (lit) {
    parts.push(`<literature_notes>\n${smartTruncate(lit, 3000)}\n</literature_notes>`);
  } else {
    parts.push("<literature_notes>(empty — no literature review yet)</literature_notes>");
  }

  // Field methodology standard — auto-extracted by reader on paper download.
  // Brain should compare its own experiments/report against these standards.
  const method = readFileSafe(methodologyPath(projectDir));
  if (method && method.trim().length > 40) {
    parts.push(`<field_methodology_standard>
Auto-extracted from the literature you have downloaded. This is a map of what
this field considers STANDARD methodology (what to compute, what to demo, what
rigor bar to meet, what goes in figures). Before claiming a milestone, verify
that your actual work covers these points. If there is a gap, address it — do
not paper over methodology gaps in the report.
${smartTruncate(method, 3000)}
</field_methodology_standard>`);
  }

  // Unprocessed papers fallback — catches downloads that missed the hook,
  // manual paper drops, DOI/URL downloads (flat PDFs), or session races.
  const unprocessed = findUnprocessedPapers(projectDir);
  if (unprocessed.length > 0) {
    parts.push(`<unprocessed_papers>
The following papers are present under data/papers/ but have no entry in
notes/methodology.md "Papers processed":
${unprocessed.map(id => `- ${id}`).join("\n")}

Each ID is either an arXiv-style subdirectory (data/papers/<id>/ with LaTeX source)
or a flat PDF (data/papers/<id>.pdf from a DOI/URL download). Dispatch one
reader per unprocessed paper (it writes BOTH methodology.md coverage and the
literature.md per-paper entry in a single read pass):
  spawn_agent(agent="reader", task="Read paper <id> and extract methodology + literature entry.", templateVars={{ PAPER_ID: "<id>" }})

Emit one call per paper in the SAME turn — the harness runs spawn_agent tool
calls in parallel, so readers execute concurrently and all finish before the
turn returns. Do NOT use background=true here; you want the entries on disk
before you continue. The reader is cheap (haiku, ≤30s) and idempotent.
</unprocessed_papers>`);
  }

  // Experiment state
  const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (exp) {
    parts.push(`<experiment_notes>\n${smartTruncate(exp, 2000)}\n</experiment_notes>`);
  } else {
    parts.push("<experiment_notes>(empty — no experiments yet)</experiment_notes>");
  }

  // (plan.md summary moved to brain's Layer 3; read the file directly when needed.)

  // Memory scratchpad
  const mem = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (mem && mem.trim().length > 20) {
    parts.push(`<memory_notes>\n${smartTruncate(mem, 2000)}\n</memory_notes>`);
  }

  // PI feedback (injected by PI monitor). File is append-only (newest review
  // last), so keep whole TAIL reviews when it outgrows the snapshot budget —
  // truncating mid-review could cut the newest verdict/instructions, which
  // is the overwrite bug in miniature. Addressed instructions from old
  // rounds live in notes/memory.md checkboxes.
  const piFeedback = readFileSafe(join(projectDir, "reviews", "pi_feedback.md"));
  if (piFeedback) {
    parts.push(`<pi_feedback>\n${tailWholeReviews(piFeedback, 6000)}\n</pi_feedback>`);
  }

  // User feedback (manually injected, never overwritten by PI)
  const userFeedback = readFileSafe(join(projectDir, "reviews", "user_feedback.md"));
  if (userFeedback) {
    parts.push(`<user_feedback priority="highest">\nThis feedback is from the human user and takes absolute priority over PI feedback.\n${userFeedback}\n</user_feedback>`);
  }

  parts.push(buildReportStatus(projectDir));
  parts.push(buildDataStatus(projectDir));


  // Active reminders — event-driven, compact, budget-controlled
  const remindersSection = opts.reminders?.render(projectDir) ?? null;
  if (remindersSection) parts.push(remindersSection);

  return parts.join("\n\n");
}

/**
 * Build the semi-static Layer 2 system-prompt block: content that rarely
 * changes during a run (RESEARCH.md, skills list, lessons.md). Cached
 * separately from Layer 1 (brain.md) so an occasional edit invalidates only
 * Layer 2 while the Layer 1 core-rules cache stays warm.
 */
export function buildSemiStaticSystemLayer(projectDir: string): string {
  const parts: string[] = [];

  const goal = readFileSafe(join(projectDir, "RESEARCH.md"));
  if (goal) parts.push(`<research_goal>\n${goal}\n</research_goal>`);

  const lessons = readFileSafe(join(projectDir, "notes", "lessons.md"));
  if (lessons && lessons.trim().length > 20) {
    parts.push(`<lessons_learned>\n${lessons}\n</lessons_learned>`);
  }

  const skillSummary = discoverSkills(projectDir);
  if (skillSummary) parts.push(skillSummary);

  // Cross-project memory. Built once per session (this layer is frozen into
  // the cache-pinned system block at agent creation), so it cannot vary
  // per-turn. Claim-free by construction — see buildPastResearchDigest.
  const globalMem = readFileSafe(GLOBAL_MEMORY_PATH);
  if (globalMem.trim().length > 20) {
    parts.push(`<global_memory>\n${truncateGlobalMemory(globalMem, 4000)}\n</global_memory>`);
  }
  const pastResearch = buildPastResearchDigest(projectDir);
  if (pastResearch) parts.push(pastResearch);

  // The career block: findings/corrections/leads from ALL past projects that
  // touch THIS question, plus the user's standing standards. Semi-static —
  // stable per session, cache-safe (matched once against RESEARCH.md).
  try {
    const career = buildCareerBlock(goal || "");
    if (career) parts.push(career);
  } catch { /* career is additive, never blocking */ }

  return parts.join("\n\n");
}

/**
 * Keep the newest whole reviews from an append-only feedback file
 * (`\n\n---\n\n`-separated, newest last). The most recent review is always
 * included in full, even when it alone exceeds the budget.
 */
function tailWholeReviews(feedback: string, budget: number): string {
  if (feedback.length <= budget) return feedback;
  const sections = feedback.split("\n\n---\n\n");
  const keep: string[] = [];
  let used = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const cost = sections[i].length + 9; // separator overhead
    if (keep.length > 0 && used + cost > budget) break;
    keep.unshift(sections[i]);
    used += cost;
  }
  const omitted = sections.length - keep.length;
  return (omitted > 0 ? `(${omitted} older review(s) truncated — full history in reviews/pi_feedback.md)\n\n---\n\n` : "")
    + keep.join("\n\n---\n\n");
}

/**
 * Truncate ~/.sisyphus/memory.md at entry boundaries (`- **[project, date]**`
 * bullets), keeping the preamble and the NEWEST whole entries that fit.
 * smartTruncate would cut mid-entry and strip provenance tags — an untagged
 * half-claim in the cache-pinned system block is exactly what the
 * contamination rules forbid.
 */
function truncateGlobalMemory(mem: string, budget: number): string {
  if (mem.length <= budget) return mem;
  const blocks = mem.split(/\n(?=- \*\*\[)/);
  if (blocks.length === 1) return smartTruncate(mem, budget); // no entry markers — fall back
  const preamble = blocks[0].slice(0, budget);
  let used = preamble.length;
  const entries = blocks.slice(1);
  const keep: string[] = [];
  for (let i = entries.length - 1; i >= 0; i--) { // entries append at the end — newest last
    const cost = entries[i].length + 1;
    if (used + cost > budget) break;
    keep.unshift(entries[i]);
    used += cost;
  }
  const omitted = entries.length - keep.length;
  return [preamble, ...keep].join("\n") +
    (omitted > 0 ? `\n(… ${omitted} older entries omitted — read ~/.sisyphus/memory.md for the rest)` : "");
}

// ── Report status ──────────────────────────────
//
// Canonicalization: emit discrete signals (exists / not-yet / ok / has-errors)
// rather than precise numbers (line counts, KB, warning counts). The precise
// numbers bounce every turn and poison prompt-cache prefix matching without
// carrying load-bearing information. Same rule applies to buildDataStatus.

function buildReportStatus(projectDir: string): string {
  const reportDir = join(projectDir, "report");
  const lines: string[] = [];

  const tex = readFileSafe(join(reportDir, "report.tex"));
  if (tex) {
    const sections = [...tex.matchAll(/\\section\{([^}]+)\}/g)].map(m => m[1]);
    lines.push(`- report.tex: exists` + (sections.length > 0 ? `, sections: [${sections.join(", ")}]` : ""));
  } else {
    lines.push("- report.tex: not yet");
  }

  try {
    statSync(join(reportDir, "report.pdf"));
    lines.push(`- report.pdf: exists`);
  } catch {
    lines.push("- report.pdf: not yet");
  }

  if (readFileSafe(join(reportDir, "references.bib"))) {
    lines.push(`- references.bib: exists`);
  }

  // Same parser as compile_latex and the finish gate — this line used to run
  // its own /^!/ + /Warning/i regexes and told the brain "warnings only"
  // while the tool said ✗ (the 2026-07-02 table-overlap rationalization
  // quoted this disagreement verbatim). Tags are discrete and sorted: the
  // string only changes when the log changes, per the cache rule above.
  const verdict = parseCompileVerdict(reportDir);
  if (!verdict.logMissing) {
    // Keyed off tags, not verdict.ok: bblStale leaves ok=true but blocks the
    // gate — rendering "ok" next to a "finish() will block" line would be a
    // self-contradictory snapshot with no named problem.
    lines.push(`- last compile: ${verdict.tags.length === 0 ? "ok" : verdict.tags.join(", ")}`);
    // Consequence claims must match the gate's real behavior — an imperative
    // the gate doesn't enforce is a soft door no backstop covers.
    if (gateBlockingIssues(verdict).length > 0) {
      lines.push(`- finish() will block on the citation/reference/bibliography problems above — fix and recompile with compile_latex`);
    }
  }

  try {
    const figs = readdirSync(join(reportDir, "figures")).filter(f => !f.startsWith(".")).sort();
    if (figs.length > 0) lines.push(`- figures/: ${figs.join(", ")}`);
  } catch {}

  return `<report_status>\n${lines.join("\n")}\n</report_status>`;
}

// ── Data status ────────────────────────────────

function buildDataStatus(projectDir: string): string {
  const lines: string[] = [];

  const papersDir = join(projectDir, "data", "papers");
  try {
    const entries = readdirSync(papersDir).sort();
    const papers = entries.filter(e => !e.endsWith("_figures") && !e.startsWith("."));
    const figSet = new Set(entries.filter(e => e.endsWith("_figures")).map(e => e.replace(/_figures$/, "")));
    if (papers.length > 0) {
      const annotated = papers.map(p => figSet.has(p.replace(/\.pdf$/, "")) || figSet.has(p) ? `${p}✓` : p);
      lines.push(`- Papers: ${annotated.join(", ")}`);
    } else {
      lines.push("- Papers: none");
    }
  } catch {
    lines.push("- Papers: none");
  }

  const expRoot = join(projectDir, "data", "experiments");
  try {
    const expEntries = readdirSync(expRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const exp of expEntries) {
      const runsDir = join(expRoot, exp.name, "runs");
      const runParts: string[] = [];
      try {
        for (const r of readdirSync(runsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (r.isDirectory()) {
            const files = readdirSync(join(runsDir, r.name)).filter(f => !f.startsWith(".")).sort();
            runParts.push(`${r.name}/ (${files.join(", ")})`);
          } else if (!r.name.startsWith(".")) {
            runParts.push(r.name);
          }
        }
      } catch {}
      const scriptsDir = join(expRoot, exp.name, "scripts");
      let scriptList = "";
      try {
        const scripts = readdirSync(scriptsDir).filter(f => !f.startsWith(".")).sort();
        if (scripts.length > 0) scriptList = `; scripts: ${scripts.join(", ")}`;
      } catch {}
      lines.push(`- ${exp.name}: runs ${runParts.join(", ") || "(none)"}${scriptList}`);
    }
  } catch {}

  return `<data_status>\n${lines.join("\n")}\n</data_status>`;
}



/**
 * Discover skills from the Luxas package's skills/ directory.
 * Follows Agent Skills spec: parse SKILL.md frontmatter for name + description.
 * Returns a compact summary for context injection (progressive disclosure).
 */
function discoverSkills(projectDir: string): string | null {
  // Luxas package root: skills/ lives next to src/
  const packageRoot = join(dirname(import.meta.url.replace("file://", "")), "..");
  const skillsDirs = [
    join(packageRoot, "skills"),       // package-level skills
    join(projectDir, ".agents", "skills"), // project-level skills (Agent Skills standard)
  ];

  const skills: { name: string; description: string; path: string }[] = [];

  for (const dir of skillsDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = join(dir, entry.name, "SKILL.md");
        const content = readFileSafe(skillMd);
        if (!content) continue;
        const parsed = parseSkillFrontmatter(content);
        if (parsed) {
          skills.push({ ...parsed, path: skillMd });
        }
      }
    } catch {}
  }

  if (skills.length === 0) return null;

  const lines = skills.map(
    (s) => `- **${s.name}**: ${s.description} _(read ${s.path} for full instructions)_`
  );
  return `## Available Skills\n${lines.join("\n")}`;
}

/**
 * Parse YAML frontmatter from SKILL.md — extracts name and description only.
 * Minimal parser (no yaml dependency), handles the standard frontmatter format.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = match[1];

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) return null;

  return {
    name: nameMatch[1].trim().replace(/^["']|["']$/g, ""),
    description: descMatch[1].trim().replace(/^["']|["']$/g, ""),
  };
}
