/**
 * Layer 3: transformContext — research state injection + message compaction.
 *
 * Compaction is handled by the universal ContextPacker module.
 * This file adds the brain-specific layer: research snapshot injection,
 * notes compaction trigger, completion hints, and bus event bridging.
 */

import { existsSync, readdirSync } from "node:fs";
import { readFileSafe, smartTruncate } from "./utils.js";
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

/** Inject research snapshot into messages without breaking tool_use_id references. */
function injectSnapshot(messages: any[], snapshot: string): any[] {
  if (messages.length > 2) {
    const first = messages[0];
    const firstContent = typeof first.content === "string" ? first.content : JSON.stringify(first.content);
    return [
      { ...first, content: `${firstContent}\n\n<research_snapshot>\n${snapshot}\n</research_snapshot>` },
      ...messages.slice(1),
    ];
  }
  return messages;
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

  // Report status
  const hasReport = existsSync(join(projectDir, "report", "report.tex"));
  const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
  parts.push(`<report_status>\n- report.tex: ${hasReport ? "exists" : "not yet"}\n- report.pdf: ${hasPdf ? "exists" : "not yet"}\n</report_status>`);

  // Downloaded papers + figure extraction status
  const papersDir = join(projectDir, "data", "papers");
  const paperCount = countFiles(papersDir);
  const { extracted, unextracted } = countFigureExtraction(papersDir);
  let dataSection = `<data_status>\n- Downloaded papers: ${paperCount} files in data/papers/`;
  if (extracted > 0 || unextracted > 0) {
    dataSection += `\n- Figures: ${extracted}/${extracted + unextracted} papers have figures extracted`;
    if (unextracted > 0) {
      dataSection += ` (${unextracted} still need extract-figures)`;
    }
    if (unextracted > 0 && extracted === 0) {
      dataSection += ` ⚠️ Run extract-figures on PDFs before writing report!`;
    }
  }

  // Scripts
  const scriptsDir = join(projectDir, "data", "scripts");
  const scriptCount = countFiles(scriptsDir);
  if (scriptCount > 0) dataSection += `\n- Experiment scripts: ${scriptCount} files in data/scripts/`;
  dataSection += `\n</data_status>`;
  parts.push(dataSection);

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

function countFiles(dir: string): number {
  try { return readdirSync(dir).length; } catch { return 0; }
}

/** Count how many papers have had figures extracted vs not. */
function countFigureExtraction(papersDir: string): { extracted: number; unextracted: number } {
  try {
    const entries = readdirSync(papersDir, { withFileTypes: true });
    const figDirs = new Set(
      entries.filter(e => e.isDirectory() && e.name.endsWith("_figures")).map(e => e.name)
    );
    // Count PDFs and arXiv source dirs that could have figures extracted
    let extractable = 0;
    let extracted = 0;
    for (const e of entries) {
      if (e.name.endsWith("_figures")) continue; // skip figure dirs themselves
      const baseName = e.name.replace(/\.(pdf|txt|html)$/, "");
      if (e.name.endsWith(".txt") || e.name.endsWith(".html")) continue; // not extractable
      extractable++;
      if (figDirs.has(`${baseName}_figures`)) extracted++;
    }
    return { extracted, unextracted: extractable - extracted };
  } catch {
    return { extracted: 0, unextracted: 0 };
  }
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
