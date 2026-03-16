/**
 * Layer 3: transformContext — research state injection + message compaction.
 *
 * Called before each LLM call. Does NOT modify the Agent's stored messages.
 * Two jobs:
 *   1. Inject current research state from .md files (long-term memory)
 *   2. Compact old messages when token count is high (working memory management)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const COMPACTION_THRESHOLD = 80_000; // characters (~20K tokens)
const KEEP_RECENT = 12; // messages to keep after compaction

/**
 * Build the transformContext function for a given project directory.
 */
export function buildContextTransformer(projectDir: string) {
  return async (messages: any[]): Promise<any[]> => {
    const snapshot = buildResearchSnapshot(projectDir);

    // Estimate message size
    const totalChars = messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);

    if (totalChars > COMPACTION_THRESHOLD && messages.length > KEEP_RECENT + 2) {
      // Compact: summarize old messages, keep recent ones
      const oldMessages = messages.slice(0, -KEEP_RECENT);
      const recentMessages = messages.slice(-KEEP_RECENT);

      // Build a text summary of old messages (without LLM call for now — simple extraction)
      const oldSummary = summarizeMessages(oldMessages);

      return [
        // Research snapshot (ground truth from files)
        { role: "user", content: snapshot },
        { role: "assistant", content: "I've reviewed the current research state. Let me continue from where I left off." },
        // Compacted history
        { role: "user", content: `<compacted_history>\n${oldSummary}\n</compacted_history>\n\nContinue your research based on the current state above and recent context below.` },
        { role: "assistant", content: "Understood. I'll continue based on the current research state and recent actions." },
        // Recent messages preserved as-is
        ...recentMessages,
      ];
    }

    // No compaction needed — just inject snapshot at the beginning
    // Only inject if there are enough messages (avoid injecting before first prompt)
    if (messages.length > 4) {
      return [
        messages[0], // Keep the original first user message (the directive)
        { role: "assistant", content: `<research_snapshot>\n${snapshot}\n</research_snapshot>\n\nI'll continue based on this current state.` },
        ...messages.slice(1),
      ];
    }

    return messages;
  };
}

/**
 * Build a snapshot of current research state from files on disk.
 */
function buildResearchSnapshot(projectDir: string): string {
  const parts: string[] = [];

  // Research goal
  const goal = readFileSafe(join(projectDir, "RESEARCH.md"));
  parts.push(`## Research Goal\n${goal || "(no RESEARCH.md found)"}`);

  // Literature state
  const lit = readFileSafe(join(projectDir, "literature.md"));
  if (lit) {
    const lineCount = lit.split("\n").length;
    const preview = lit.length > 2000 ? lit.slice(0, 2000) + "\n...(truncated)" : lit;
    parts.push(`## Literature Notes (${lineCount} lines)\n${preview}`);
  } else {
    parts.push("## Literature Notes\n(empty — no literature review yet)");
  }

  // Experiment state
  const exp = readFileSafe(join(projectDir, "experiments.md"));
  if (exp) {
    const lineCount = exp.split("\n").length;
    const preview = exp.length > 2000 ? exp.slice(0, 2000) + "\n...(truncated)" : exp;
    parts.push(`## Experiment Notes (${lineCount} lines)\n${preview}`);
  } else {
    parts.push("## Experiment Notes\n(empty — no experiments yet)");
  }

  // Report status
  const hasReport = existsSync(join(projectDir, "report", "report.tex"));
  const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
  parts.push(`## Report\n- report.tex: ${hasReport ? "exists" : "not yet"}\n- report.pdf: ${hasPdf ? "exists" : "not yet"}`);

  // Downloaded papers
  const papersDir = join(projectDir, "data", "papers");
  const paperCount = countFiles(papersDir);
  parts.push(`## Data\n- Downloaded papers: ${paperCount} files in data/papers/`);

  // Scripts
  const scriptsDir = join(projectDir, "data", "scripts");
  const scriptCount = countFiles(scriptsDir);
  if (scriptCount > 0) parts.push(`- Experiment scripts: ${scriptCount} files in data/scripts/`);

  return parts.join("\n\n");
}

/**
 * Simple message summarization (no LLM call — extracts key info).
 */
function summarizeMessages(messages: any[]): string {
  const items: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.content) {
      const content = typeof m.content === "string"
        ? m.content
        : (m.content as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
      // Extract tool uses
      const toolUses = typeof m.content !== "string"
        ? (m.content as any[]).filter((c: any) => c.type === "tool_use").map((c: any) => c.name)
        : [];
      if (toolUses.length > 0) {
        items.push(`- Used tools: ${toolUses.join(", ")}`);
      }
      const preview = content.slice(0, 200).replace(/\n/g, " ");
      if (preview.length > 10) items.push(`- ${preview}`);
    }
  }
  return items.length > 0
    ? `Summary of ${messages.length} earlier messages:\n${items.slice(0, 30).join("\n")}`
    : `(${messages.length} earlier messages compacted)`;
}

function readFileSafe(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function countFiles(dir: string): number {
  try { return readdirSync(dir).length; } catch { return 0; }
}
