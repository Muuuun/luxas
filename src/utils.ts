/**
 * Shared utility functions used across multiple modules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strict arXiv id: YYMM.NNNNN (4-5 digits after the dot). */
export const ARXIV_ID_RE = /^\d{4}\.\d{4,5}$/;

/**
 * Section header under which `luxas init --prompt` preserves the user's
 * verbatim request in RESEARCH.md. Downstream PI prompts key off this exact
 * string to locate the ground-truth deliverable, so the writer and the
 * readers must stay in sync — import this constant rather than typing the
 * literal.
 */
export const ORIGINAL_REQUEST_HEADER = "## Original User Request";

/**
 * Derive a short project title from the first non-empty line of a markdown
 * file or raw user prompt. Used for both RESEARCH.md title headers and
 * cross-project registry names (~/.sisyphus/projects.json), so the
 * derivation must stay stable across both shapes.
 */
export function deriveProjectTitle(text: string, maxLen = 120): string {
  const firstLine = text.split("\n").find(l => l.trim().length > 0)?.trim() ?? "";
  const stripped = firstLine.replace(/^#+\s*/, "").replace(/[*_`[\]]/g, "").trim();
  return stripped.slice(0, maxLen) || "Untitled";
}

export function hasTexFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith(".tex"));
  } catch {
    return false;
  }
}

export function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...listFilesRecursive(full));
      else results.push(full);
    }
  } catch {}
  return results;
}

export function readFileSafe(path: string, fallback = ""): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return fallback;
  }
}

/** Extract text from LLM content blocks (the standard content array format). */
export function extractTextContent(content: any[]): string {
  return (content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

/**
 * Smart truncation: keeps section headers + most recent content.
 * For structured notes, this preserves the outline and latest entries.
 */
export function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const lines = text.split("\n");

  // Extract all section headers (## or ### lines)
  const headers = lines
    .filter(l => l.match(/^#{1,4}\s/))
    .map(h => h.trim());

  // Take the last N lines that fit within budget
  const headerSection = headers.length > 0
    ? `[Table of contents: ${headers.join(" | ")}]\n\n`
    : "";
  const headerBudget = headerSection.length;
  const contentBudget = maxChars - headerBudget - 50; // 50 for ellipsis message

  // Take content from the end (most recent entries)
  let tail = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i] + "\n" + tail;
    if (candidate.length > contentBudget) break;
    tail = candidate;
  }

  return `${headerSection}...(earlier content truncated, ${lines.length} total lines, use read tool for full file)\n\n${tail.trim()}`;
}
