/**
 * Shared utility functions used across multiple modules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
