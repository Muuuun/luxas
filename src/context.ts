/**
 * Layer 3: transformContext — research state injection + message compaction.
 */

import { existsSync, readdirSync } from "node:fs";
import { readFileSafe, smartTruncate } from "./utils.js";
import { getActiveBackgroundAgents } from "./tools/spawn-agent.js";
import { isAlive } from "./active-agents.js";
import { join, dirname } from "node:path";
import { generateResearchSummary, heuristicSummary } from "./compaction.js";
import { compactNotesIfNeeded } from "./notes-compaction.js";
import type { Model } from "@mariozechner/pi-ai";
import type { CostTracker } from "./hooks.js";
import type { ExtensionBus } from "./extensions.js";
import type { ReminderRegistry } from "./reminders.js";

const TOOL_DEF_RESERVE = 20_000;
const AUTOCOMPACT_BUFFER = 13_000;
const WARNING_HEADROOM = 53_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;

function computeThresholds(contextWindow: number = DEFAULT_CONTEXT_WINDOW) {
  const effectiveWindow = contextWindow - TOOL_DEF_RESERVE;
  return {
    compaction: effectiveWindow - AUTOCOMPACT_BUFFER,
    warning: effectiveWindow - WARNING_HEADROOM,
  };
}

const COMPACTION_CHAR_THRESHOLD = 80_000;
const WARNING_CHAR_THRESHOLD = 60_000;

const KEEP_RECENT = 12;

const RAPID_REFILL_TURN_WINDOW = 3;
const RAPID_REFILL_LIMIT = 3;
const FAILURE_LIMIT = 3;

const MICROCOMPACT_KEEP_RECENT_TOOL_RESULTS = 10;
const MICROCOMPACT_PLACEHOLDER = "[tool result cleared by micro-compaction to save context — re-run the tool if needed]";
const COMPACTABLE_TOOLS = new Set([
  "read", "write", "edit", "bash",
  "search_papers", "get_citations", "download_paper",
  "grep", "glob", "web_search", "web_fetch",
]);

export interface ContextTransformerOptions {
  projectDir: string;
  model?: Model<any>;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  tracker?: CostTracker;
  bus?: ExtensionBus;
  reminders?: ReminderRegistry;
  /** Restored from session compaction entries for crash recovery. */
  initialPreviousSummary?: string;
}

export function buildContextTransformer(opts: ContextTransformerOptions) {
  const { projectDir, model, getApiKey, tracker, bus } = opts;
  let previousSummary: string | undefined = opts.initialPreviousSummary;

  const tracking = {
    turnCounter: 0,
    lastCompactTurn: -1,
    consecutiveRapidRefills: 0,
    consecutiveFailures: 0,
    hasWarnedSinceLastCompaction: false,
  };

  const modelContextWindow = (model as any)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const TOKEN_THRESHOLDS = computeThresholds(modelContextWindow);

  return async (messages: any[]): Promise<any[]> => {
    tracking.turnCounter++;

    const snapshot = buildResearchSnapshot(opts);

    const tokenCount = tracker?.lastContextTokens ?? 0;
    const useTokens = tokenCount > 0;

    let needsCompaction: boolean;
    let needsWarning: boolean;
    let sizeForEvent = tokenCount;

    if (useTokens) {
      needsCompaction = tokenCount > TOKEN_THRESHOLDS.compaction;
      needsWarning = tokenCount > TOKEN_THRESHOLDS.warning;
    } else {
      let totalChars = 0;
      for (const m of messages) {
        totalChars += typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length;
      }
      needsCompaction = totalChars > COMPACTION_CHAR_THRESHOLD;
      needsWarning = totalChars > WARNING_CHAR_THRESHOLD;
      sizeForEvent = totalChars;
    }

    if (needsWarning && !needsCompaction) {
      const { messages: compacted, charsFreed } = microCompactToolResults(messages);
      if (charsFreed > 0) {
        messages = compacted;
        bus?.emit({ type: "micro_compaction", charsFreed });
      }
    }

    if (needsCompaction && messages.length > KEEP_RECENT + 2) {
      const turnsSinceLastCompact = tracking.turnCounter - tracking.lastCompactTurn;
      if (tracking.lastCompactTurn >= 0 && turnsSinceLastCompact < RAPID_REFILL_TURN_WINDOW) {
        tracking.consecutiveRapidRefills++;
        if (tracking.consecutiveRapidRefills >= RAPID_REFILL_LIMIT) {
          throw new Error(
            `FATAL: Compaction thrashing — context refilled to threshold within ${RAPID_REFILL_TURN_WINDOW} turns, ${RAPID_REFILL_LIMIT} times in a row. ` +
            `Likely a tool result too large for context window. ` +
            `Try smaller reads, or restart brain with /clear.`
          );
        }
      } else {
        tracking.consecutiveRapidRefills = 0;
      }

      // Split point must land on an assistant message to keep tool_use/tool_result pairing valid.
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

      await bus?.emit({ type: "before_compaction", messages: oldMessages, tokenCount });

      let summary: string;
      try {
        if (model && getApiKey) {
          const apiKey = await getApiKey("anthropic");
          if (!apiKey) throw new Error("No API key");
          summary = await generateResearchSummary(oldMessages, model, apiKey, previousSummary);
        } else {
          summary = heuristicSummary(oldMessages);
        }
        tracking.consecutiveFailures = 0;
      } catch (err) {
        tracking.consecutiveFailures++;
        if (tracking.consecutiveFailures >= FAILURE_LIMIT) {
          throw new Error(
            `FATAL: ${FAILURE_LIMIT} consecutive compaction failures. ` +
            `Last error: ${(err as any)?.message ?? err}. ` +
            `Stopping to prevent silent cost accumulation.`
          );
        }
        summary = heuristicSummary(oldMessages);
      }

      previousSummary = summary;
      tracking.lastCompactTurn = tracking.turnCounter;
      tracking.hasWarnedSinceLastCompaction = false;

      await bus?.emit({ type: "after_compaction", summary, droppedCount: oldMessages.length });

      if (model && getApiKey) {
        getApiKey("anthropic").then(apiKey => {
          if (apiKey) return compactNotesIfNeeded(projectDir, model, apiKey, bus);
        }).catch(() => {});
      }

      let completionHint = "";
      const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
      const piFeedback = readFileSafe(join(projectDir, "reviews", "pi_feedback.md")) ?? "";
      const piApproved = piFeedback.includes("## Verdict: CONTINUE") || piFeedback.includes("## Verdict: STOP");
      if (hasPdf && piApproved) {
        completionHint = "\n\n⚠️ Research appears COMPLETE (PDF compiled, PI approved). If there is nothing left to do, call finish() immediately. Do NOT re-read memory.md in a loop.";
      } else if (hasPdf) {
        completionHint = "\n\nNote: report.pdf exists. If you have completed all research tasks, request PI review and then call finish().";
      }

      return [
        { role: "user", content: snapshot, timestamp: Date.now() },
        { role: "assistant", content: [{ type: "text", text: "I've reviewed the current research state. Let me continue from where I left off." }], timestamp: Date.now() },
        { role: "user", content: `<compacted_history>\n${summary}\n</compacted_history>\n\n[MEMORY] Context was compacted — ${oldMessages.length} earlier messages were summarized above. Your notes files (notes/literature.md, notes/experiments.md, notes/memory.md) are your ground truth. If you recall working on something not yet saved to notes, save it now before continuing.${completionHint}`, timestamp: Date.now() },
        { role: "assistant", content: [{ type: "text", text: "Understood. I'll check my notes and continue based on the current research state." }], timestamp: Date.now() },
        ...recentMessages,
      ];
    }

    // Warnings fire once per compaction cycle as bus events only — never injected into
    // the message stream (brain must never see them, to prevent panic-save loops).
    if (needsWarning && !tracking.hasWarnedSinceLastCompaction) {
      tracking.hasWarnedSinceLastCompaction = true;
      const threshold = useTokens ? TOKEN_THRESHOLDS.compaction : COMPACTION_CHAR_THRESHOLD;
      await bus?.emit({ type: "memory_warning", tokenCount: sizeForEvent, threshold });
    }

    return injectSnapshot(messages, snapshot);
  };
}

/**
 * Replaces old compactable tool results with a placeholder while preserving
 * tool_use/tool_result pairing. Returns the original array reference (not a
 * copy) when nothing changed, so callers can detect no-ops cheaply.
 */
function microCompactToolResults(
  messages: any[],
): { messages: any[]; charsFreed: number } {
  const idToName = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      if (b.type === "toolCall" || b.type === "tool_use") {
        const id = b.id ?? b.toolCallId;
        if (id && b.name) idToName.set(id, b.name);
      }
    }
  }

  let toolResultsSeen = 0;
  let charsFreed = 0;
  let modified = false;
  const out: any[] = new Array(messages.length);

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];

    if (m.role === "toolResult") {
      toolResultsSeen++;
      if (toolResultsSeen <= MICROCOMPACT_KEEP_RECENT_TOOL_RESULTS) {
        out[i] = m;
        continue;
      }
      const toolName = m.toolName ?? idToName.get(m.toolCallId) ?? "";
      const existing = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
        : "";
      if (!COMPACTABLE_TOOLS.has(toolName) || existing === MICROCOMPACT_PLACEHOLDER) {
        out[i] = m;
        continue;
      }
      charsFreed += existing.length - MICROCOMPACT_PLACEHOLDER.length;
      modified = true;
      out[i] = { ...m, content: [{ type: "text", text: MICROCOMPACT_PLACEHOLDER }] };
      continue;
    }

    if (m.role === "user" && Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result")) {
      let blockChanged = false;
      const newBlocks = m.content.map((b: any) => {
        if (b.type !== "tool_result") return b;
        toolResultsSeen++;
        if (toolResultsSeen <= MICROCOMPACT_KEEP_RECENT_TOOL_RESULTS) return b;
        const toolName = idToName.get(b.tool_use_id) ?? "";
        const existing = typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
            : "";
        if (!COMPACTABLE_TOOLS.has(toolName) || existing === MICROCOMPACT_PLACEHOLDER) return b;
        charsFreed += existing.length - MICROCOMPACT_PLACEHOLDER.length;
        blockChanged = true;
        return { ...b, content: [{ type: "text", text: MICROCOMPACT_PLACEHOLDER }] };
      });
      if (blockChanged) {
        modified = true;
        out[i] = { ...m, content: newBlocks };
      } else {
        out[i] = m;
      }
      continue;
    }

    out[i] = m;
  }

  return modified ? { messages: out, charsFreed } : { messages, charsFreed: 0 };
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
