/**
 * Layer 3: transformContext — research state injection + message compaction.
 *
 * Compaction is handled by the universal ContextPacker module.
 * This file adds the brain-specific layer: research snapshot injection,
 * notes compaction trigger, completion hints, and bus event bridging.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFileSafe, smartTruncate } from "./utils.js";
import { findUnprocessedPapers, methodologyPath } from "./methodology.js";
import { getActiveBackgroundAgents } from "./tools/spawn-agent.js";
import { isAlive } from "./active-agents.js";
import { join, dirname } from "node:path";
import { compactNotesIfNeeded } from "./notes-compaction.js";
import { createCompactionTransform, getContextWindow } from "./compaction/create-transform.js";
import type { TokenTap } from "./compaction/token-tap.js";
import type { Model } from "@mariozechner/pi-ai";
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

    // Step 2: Brain-specific research snapshot injection (every turn)
    const snapshot = buildResearchSnapshot(opts);
    return injectSnapshot(packed, snapshot);
  };

  return { transformContext, tokenTap };
}

// ── Research snapshot (brain-specific) ────────────────

/**
 * Inject research snapshot into messages as a trailing user message.
 *
 * Cache strategy: pi-ai places cache_control breakpoints on (1) system prompt
 * and (2) the last user message. We add a THIRD breakpoint on the last
 * conversation message before the snapshot. This creates three cache segments:
 *
 *   [System Prompt + breakpoint]     → segment 1: stable, cached ✓
 *   [Messages 1..N + breakpoint]     → segment 2: stable history, cached ✓
 *   [Snapshot + breakpoint(pi-ai)]   → segment 3: changes each turn, small miss
 *
 * Without the middle breakpoint, segments 1→2 are one block that includes
 * the changing snapshot, causing a full cache miss every turn.
 *
 * Safety: transformContext output is ephemeral (used for one LLM call, never
 * persisted to agent state). Anthropic API accepts consecutive user messages.
 */
function injectSnapshot(messages: any[], snapshot: string): any[] {
  if (messages.length <= 2) return messages;

  // Add cache breakpoint to the last message BEFORE snapshot,
  // so conversation history becomes a stable cacheable segment.
  // Deep-clone the last message to avoid mutating persisted agent state.
  const result = [...messages];
  const lastMsg = result[result.length - 1];
  if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
    const clonedContent = lastMsg.content.map((b: any) => ({ ...b }));
    clonedContent[clonedContent.length - 1].cache_control = { type: "ephemeral" };
    result[result.length - 1] = { ...lastMsg, content: clonedContent };
  } else if (typeof lastMsg.content === "string") {
    result[result.length - 1] = {
      ...lastMsg,
      content: [{ type: "text", text: lastMsg.content, cache_control: { type: "ephemeral" } }],
    };
  }

  result.push({
    role: "user",
    content: `<research_snapshot>\n${snapshot}\n</research_snapshot>`,
    timestamp: Date.now(),
  });
  return result;
}

/**
 * Build a snapshot of current research state from files on disk.
 */
function buildResearchSnapshot(opts: ContextTransformerOptions): string {
  const { projectDir } = opts;
  const parts: string[] = [];

  // Project directory (ground truth for path resolution)
  parts.push(`<project_dir>${projectDir}</project_dir>`);

  // Research goal
  const goal = readFileSafe(join(projectDir, "RESEARCH.md"));
  parts.push(`<research_goal>\n${goal || "(no RESEARCH.md found)"}\n</research_goal>`);

  // Literature state
  const lit = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (lit) {
    parts.push(`<literature_notes lines="${lit.split("\n").length}">\n${smartTruncate(lit, 3000)}\n</literature_notes>`);
  } else {
    parts.push("<literature_notes>(empty — no literature review yet)</literature_notes>");
  }

  // Field methodology standard — auto-extracted by methodology-worker on paper download.
  // Brain should compare its own experiments/report against these standards.
  const method = readFileSafe(methodologyPath(projectDir));
  if (method && method.trim().length > 40) {
    parts.push(`<field_methodology_standard lines="${method.split("\n").length}">
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
    parts.push(`<unprocessed_papers count="${unprocessed.length}">
The following papers are present under data/papers/ but have no entry in
notes/methodology.md "Papers processed":
${unprocessed.map(id => `- ${id}`).join("\n")}

Each ID is either an arXiv-style subdirectory (data/papers/<id>/ with LaTeX source)
or a flat PDF (data/papers/<id>.pdf from a DOI/URL download). Dispatch one
methodology-worker per unprocessed paper:
  spawn_agent(agent="methodology-worker", task="Extract methodology coverage from paper <id>.", templateVars={{ PAPER_ID: "<id>" }})

These can all run in parallel (background=true). The worker is cheap (haiku, ≤30s) and idempotent.
</unprocessed_papers>`);
  }

  // Experiment state
  const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (exp) {
    parts.push(`<experiment_notes lines="${exp.split("\n").length}">\n${smartTruncate(exp, 2000)}\n</experiment_notes>`);
  } else {
    parts.push("<experiment_notes>(empty — no experiments yet)</experiment_notes>");
  }

  // Research plan
  const plan = readFileSafe(join(projectDir, "notes", "plan.md"));
  if (plan && plan.trim().length > 20) {
    parts.push(`<research_plan>\n${smartTruncate(plan, 1500)}\n</research_plan>`);
  }

  // Memory scratchpad
  const mem = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (mem && mem.trim().length > 20) {
    parts.push(`<memory_notes lines="${mem.split("\n").length}">\n${smartTruncate(mem, 2000)}\n</memory_notes>`);
  }

  // Lessons learned (auto-captured from tool failures)
  const lessons = readFileSafe(join(projectDir, "notes", "lessons.md"));
  if (lessons && lessons.trim().length > 20) {
    parts.push(`<lessons_learned lines="${lessons.split("\n").length}">\n${smartTruncate(lessons, 1500)}\n</lessons_learned>`);
  }

  // PI feedback (injected by PI monitor)
  const piFeedback = readFileSafe(join(projectDir, "reviews", "pi_feedback.md"));
  if (piFeedback) {
    parts.push(`<pi_feedback>\n${piFeedback}\n</pi_feedback>`);
  }

  // User feedback (manually injected, never overwritten by PI)
  const userFeedback = readFileSafe(join(projectDir, "reviews", "user_feedback.md"));
  if (userFeedback) {
    parts.push(`<user_feedback priority="highest">\nThis feedback is from the human user and takes absolute priority over PI feedback.\n${userFeedback}\n</user_feedback>`);
  }

  // Report status (enhanced — reduces redundant bash queries for report state)
  parts.push(buildReportStatus(projectDir));

  // Data status (enhanced — file names, run contents, results summary)
  parts.push(buildDataStatus(projectDir));

  // Background agents status — one-line summary per agent, no session file reads
  const bgAgents = getActiveBackgroundAgents(projectDir);
  if (bgAgents.length > 0) {
    const agentDir = join(projectDir, ".agent");
    const bgLines = bgAgents.map(a => {
      const elapsed = Math.floor((Date.now() - a.startedAt) / 1000);
      const alive = a.pid ? isAlive(agentDir, a.id) : true;
      const status = a.status === "done" ? "✓ done" : a.status === "failed" ? "✗ failed" : alive ? "running" : "✗ dead";
      return `- ${a.id} [${status} ${elapsed}s]: ${a.task}`;
    });
    parts.push(`<background_agents count="${bgAgents.length}">\n${bgLines.join("\n")}\nUse spawn_agent(action="status", id="...") to check details. Do NOT call finish until all complete.\n</background_agents>`);
  }

  // Active reminders — event-driven, compact, budget-controlled
  const remindersSection = opts.reminders?.render(projectDir) ?? null;
  if (remindersSection) parts.push(remindersSection);

  // Skills (Agent Skills spec — progressive disclosure: only name+description here)
  const skillSummary = discoverSkills(projectDir);
  if (skillSummary) parts.push(skillSummary);

  return parts.join("\n\n");
}

// ── Enhanced report status ──────────────────────────────

function buildReportStatus(projectDir: string): string {
  const reportDir = join(projectDir, "report");
  const lines: string[] = [];

  // report.tex: lines + section headers
  const tex = readFileSafe(join(reportDir, "report.tex"));
  if (tex) {
    const lineCount = tex.split("\n").length;
    const sections = [...tex.matchAll(/\\section\{([^}]+)\}/g)].map(m => m[1]);
    lines.push(`- report.tex: ${lineCount} lines` + (sections.length > 0 ? `, sections: [${sections.join(", ")}]` : ""));
  } else {
    lines.push("- report.tex: not yet");
  }

  // report.pdf: existence + size
  try {
    const stat = statSync(join(reportDir, "report.pdf"));
    lines.push(`- report.pdf: ${Math.round(stat.size / 1024)}KB`);
  } catch {
    lines.push("- report.pdf: not yet");
  }

  // references.bib: entry count
  const bib = readFileSafe(join(reportDir, "references.bib"));
  if (bib) {
    const entryCount = (bib.match(/@\w+\{/g) || []).length;
    lines.push(`- references.bib: ${entryCount} entries`);
  }

  // compile status from report.log
  const log = readFileSafe(join(reportDir, "report.log"));
  if (log) {
    const warnings = (log.match(/Warning/gi) || []).length;
    const errors = (log.match(/^!/gm) || []).length;
    lines.push(`- last compile: ${errors > 0 ? errors + " errors" : "OK"}${warnings > 0 ? ", " + warnings + " warnings" : ""}`);
  }

  // figures/ listing
  try {
    const figs = readdirSync(join(reportDir, "figures")).filter(f => !f.startsWith("."));
    if (figs.length > 0) lines.push(`- figures/: ${figs.join(", ")} (${figs.length} files)`);
  } catch {}

  return `<report_status>\n${lines.join("\n")}\n</report_status>`;
}

// ── Enhanced data status ────────────────────────────────

function buildDataStatus(projectDir: string): string {
  const lines: string[] = [];

  // Papers with names + figure extraction status
  const papersDir = join(projectDir, "data", "papers");
  try {
    const entries = readdirSync(papersDir);
    const papers = entries.filter(e => !e.endsWith("_figures") && !e.startsWith("."));
    const figDirs = entries.filter(e => e.endsWith("_figures"));
    if (papers.length > 0) {
      lines.push(`- Papers: ${papers.join(", ")} (${figDirs.length}/${papers.length} with figures)`);
    } else {
      lines.push("- Papers: none");
    }
  } catch {
    lines.push("- Papers: none");
  }

  // Scripts with names
  const scriptsDir = join(projectDir, "data", "scripts");
  try {
    const scripts = readdirSync(scriptsDir).filter(f => !f.startsWith("."));
    if (scripts.length > 0) lines.push(`- Scripts: ${scripts.join(", ")}`);
  } catch {}

  // Runs with contents
  const runsDir = join(projectDir, "data", "runs");
  try {
    const runs = readdirSync(runsDir, { withFileTypes: true });
    const runParts: string[] = [];
    for (const r of runs) {
      if (r.isDirectory()) {
        const files = readdirSync(join(runsDir, r.name)).filter(f => !f.startsWith("."));
        runParts.push(`${r.name}/ (${files.join(", ")})`);
      } else if (!r.name.startsWith(".")) {
        runParts.push(r.name);
      }
    }
    if (runParts.length > 0) lines.push(`- Runs: ${runParts.join("; ")}`);
  } catch {}

  // Latest aggregate results summary (if exists)
  const allResults = readFileSafe(join(runsDir, "all_results.json"));
  if (allResults) {
    lines.push(`- all_results.json: ${smartTruncate(allResults, 500)}`);
  }

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
