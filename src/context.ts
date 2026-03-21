/**
 * Layer 3: transformContext — research state injection + message compaction.
 *
 * Called before each LLM call. Does NOT modify the Agent's stored messages.
 * Two jobs:
 *   1. Inject current research state from .md files (long-term memory)
 *   2. Compact old messages when token count is high (working memory management)
 *
 * #1: LLM-based compaction via generateResearchSummary
 * #3: Token-based thresholds using precise tracker.lastContextTokens
 * #8: Extension bus events for compaction lifecycle
 */

import { existsSync, readdirSync } from "node:fs";
import { readFileSafe, smartTruncate } from "./utils.js";
import { join, dirname } from "node:path";
import { generateResearchSummary, heuristicSummary } from "./compaction.js";
import type { Model } from "@mariozechner/pi-ai";
import type { CostTracker } from "./hooks.js";
import type { ExtensionBus } from "./extensions.js";
import type { ReminderRegistry } from "./reminders.js";

// Token-based thresholds (#3: precise token estimation)
const COMPACTION_TOKEN_THRESHOLD = 140_000;  // ~70% of 200K context
const WARNING_TOKEN_THRESHOLD = 100_000;     // ~50% of 200K context

// Char-based fallbacks (when token count unavailable)
const COMPACTION_CHAR_THRESHOLD = 80_000;    // ~20K tokens
const WARNING_CHAR_THRESHOLD = 60_000;       // ~15K tokens

const KEEP_RECENT = 12; // messages to keep after compaction

export interface ContextTransformerOptions {
  projectDir: string;
  model?: Model<any>;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  tracker?: CostTracker;
  bus?: ExtensionBus;
  reminders?: ReminderRegistry;
}

/**
 * Build the transformContext function for a given project directory.
 * #1: LLM compaction, #3: token thresholds, #8: extension events
 */
export function buildContextTransformer(opts: ContextTransformerOptions) {
  const { projectDir, model, getApiKey, tracker, bus } = opts;
  let previousSummary: string | undefined;

  return async (messages: any[]): Promise<any[]> => {
    const snapshot = buildResearchSnapshot(opts);

    // #3: Use precise token count when available, fall back to char estimate
    const tokenCount = tracker?.lastContextTokens ?? 0;
    const useTokens = tokenCount > 0;

    const totalChars = messages.reduce((sum: number, m: any) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);

    const needsCompaction = useTokens
      ? tokenCount > COMPACTION_TOKEN_THRESHOLD
      : totalChars > COMPACTION_CHAR_THRESHOLD;

    const needsWarning = useTokens
      ? tokenCount > WARNING_TOKEN_THRESHOLD
      : totalChars > WARNING_CHAR_THRESHOLD;

    if (needsCompaction && messages.length > KEEP_RECENT + 2) {
      // === COMPACTION ===
      // Find a clean split point: must start at an assistant message
      let splitIdx = Math.max(1, messages.length - KEEP_RECENT);
      while (splitIdx < messages.length - 4) {
        if (messages[splitIdx].role === "assistant") break;
        splitIdx++;
      }
      if (splitIdx >= messages.length - 4) {
        return injectSnapshot(messages, snapshot);
      }

      const oldMessages = messages.slice(0, splitIdx);
      const recentMessages = messages.slice(splitIdx);

      // #8: Emit before_compaction event
      await bus?.emit({ type: "before_compaction", messages: oldMessages, tokenCount });

      // #1: LLM-based compaction with heuristic fallback
      let summary: string;
      try {
        if (model && getApiKey) {
          const apiKey = await getApiKey("anthropic");
          if (!apiKey) throw new Error("No API key");
          summary = await generateResearchSummary(
            oldMessages,
            model,
            apiKey,
            previousSummary,
          );
        } else {
          summary = heuristicSummary(oldMessages);
        }
      } catch {
        summary = heuristicSummary(oldMessages);
      }

      previousSummary = summary;

      // #8: Emit after_compaction event
      await bus?.emit({ type: "after_compaction", summary, droppedCount: oldMessages.length });

      // Layer B: Detect if research appears complete → guide agent to finish()
    let completionHint = "";
    const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
    const piPath = join(projectDir, "reviews", "pi_feedback.md");
    const piFeedback = readFileSafe(piPath) ?? "";
    const piApproved = piFeedback.includes("CONTINUE") || piFeedback.includes("APPROVED");
    if (hasPdf && piApproved) {
      completionHint = "\n\n⚠️ Research appears COMPLETE (PDF compiled, PI approved). If there is nothing left to do, call finish() immediately. Do NOT re-read memory.md in a loop.";
    } else if (hasPdf) {
      completionHint = "\n\nNote: report.pdf exists. If you have completed all research tasks, request PI review and then call finish().";
    }

      return [
        // Research snapshot (ground truth from files)
        { role: "user", content: snapshot, timestamp: Date.now() },
        { role: "assistant", content: [{ type: "text", text: "I've reviewed the current research state. Let me continue from where I left off." }], timestamp: Date.now() },
        // LLM-compacted history + post-compaction reminder
        { role: "user", content: `<compacted_history>\n${summary}\n</compacted_history>\n\n[MEMORY] Context was compacted — ${oldMessages.length} earlier messages were summarized above. Your notes files (notes/literature.md, notes/experiments.md, notes/memory.md) are your ground truth. If you recall working on something not yet saved to notes, save it now before continuing.${completionHint}`, timestamp: Date.now() },
        { role: "assistant", content: [{ type: "text", text: "Understood. I'll check my notes and continue based on the current research state." }], timestamp: Date.now() },
        // Recent messages preserved as-is (starts at clean boundary)
        ...recentMessages,
      ];
    }

    // === PRE-COMPACTION WARNING ===
    if (needsWarning && messages.length > KEEP_RECENT) {
      const lastFew = messages.slice(-4);
      const alreadyWarned = lastFew.some((m: any) =>
        typeof m.content === "string" && m.content.includes("[MEMORY WARNING]")
      );
      if (!alreadyWarned) {
        // #8: Emit memory_warning event
        const threshold = useTokens ? COMPACTION_TOKEN_THRESHOLD : COMPACTION_CHAR_THRESHOLD;
        await bus?.emit({ type: "memory_warning", tokenCount: useTokens ? tokenCount : totalChars, threshold });

        const sizeLabel = useTokens
          ? `${Math.round(tokenCount / 1000)}K/${Math.round(COMPACTION_TOKEN_THRESHOLD / 1000)}K tokens`
          : `${Math.round(totalChars / 1000)}K/${Math.round(COMPACTION_CHAR_THRESHOLD / 1000)}K chars`;

        return [
          ...injectSnapshot(messages, snapshot),
          { role: "user", content: `[MEMORY WARNING] Context is approaching compaction threshold (${sizeLabel}). Save any unsaved findings, decisions, or insights to your notes files NOW (notes/memory.md for freeform notes, or the appropriate structured notes file). After compaction, old messages will be summarized and detail will be lost.`, timestamp: Date.now() },
        ];
      }
    }

    // No compaction needed — inject snapshot into the first user message
    return injectSnapshot(messages, snapshot);
  };
}

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
  parts.push(`## Project Directory\n\`${projectDir}\``);

  // Research goal
  const goal = readFileSafe(join(projectDir, "RESEARCH.md"));
  parts.push(`## Research Goal\n${goal || "(no RESEARCH.md found)"}`);

  // Literature state
  const lit = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (lit) {
    parts.push(`## Literature Notes (${lit.split("\n").length} lines)\n${smartTruncate(lit, 3000)}`);
  } else {
    parts.push("## Literature Notes\n(empty — no literature review yet)");
  }

  // Experiment state
  const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (exp) {
    parts.push(`## Experiment Notes (${exp.split("\n").length} lines)\n${smartTruncate(exp, 2000)}`);
  } else {
    parts.push("## Experiment Notes\n(empty — no experiments yet)");
  }

  // Memory scratchpad
  const mem = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (mem && mem.trim().length > 20) {
    parts.push(`## Memory / Scratchpad (${mem.split("\n").length} lines)\n${smartTruncate(mem, 2000)}`);
  }

  // PI feedback (injected by PI monitor)
  const piFeedback = readFileSafe(join(projectDir, "reviews", "pi_feedback.md"));
  if (piFeedback) {
    parts.push(`## PI Feedback (Latest)\n${piFeedback}`);
  }

  // Report status
  const hasReport = existsSync(join(projectDir, "report", "report.tex"));
  const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
  parts.push(`## Report\n- report.tex: ${hasReport ? "exists" : "not yet"}\n- report.pdf: ${hasPdf ? "exists" : "not yet"}`);

  // Downloaded papers + figure extraction status
  const papersDir = join(projectDir, "data", "papers");
  const paperCount = countFiles(papersDir);
  const { extracted, unextracted } = countFigureExtraction(papersDir);
  let dataSection = `## Data\n- Downloaded papers: ${paperCount} files in data/papers/`;
  if (extracted > 0 || unextracted > 0) {
    dataSection += `\n- Figure extraction: ${extracted} papers extracted, ${unextracted} pending`;
    if (unextracted > 0 && extracted === 0) {
      dataSection += ` ⚠️ Run extract-figures on downloaded PDFs before writing report!`;
    }
  }
  parts.push(dataSection);

  // Scripts
  const scriptsDir = join(projectDir, "data", "scripts");
  const scriptCount = countFiles(scriptsDir);
  if (scriptCount > 0) parts.push(`- Experiment scripts: ${scriptCount} files in data/scripts/`);

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
 * Discover skills from the Sisyphus package's skills/ directory.
 * Follows Agent Skills spec: parse SKILL.md frontmatter for name + description.
 * Returns a compact summary for context injection (progressive disclosure).
 */
function discoverSkills(projectDir: string): string | null {
  // Sisyphus package root: skills/ lives next to src/
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
