/**
 * Shared utility functions used across multiple modules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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

/**
 * Replace `{{VAR}}` placeholders in a string with values from a record.
 * Unmatched placeholders are left intact so downstream path/prompt resolution
 * fails closed (a literal `{{FOO}}` in a path won't exist) rather than
 * silently producing a truncated value.
 */
export function expandTemplate(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/** Extract text from LLM content blocks (the standard content array format). */
export function extractTextContent(content: any[]): string {
  return (content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

/** md5 of a file's contents, hex. Returns null if the file is unreadable. */
export function md5OrNull(path: string): string | null {
  try {
    return createHash("md5").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Frontmatter shape for the YAML headers written by illustrator and
 * typesetter into reviews/*.md. Top-level scalars + two map sections;
 * unknown keys are ignored. The audit-cache (figure_convergence) and
 * the finish-gate both parse from this shape — keep the schema in sync
 * with reviews/illustrator_notes.md and reviews/typesetter_notes.md.
 */
export interface AuditFrontmatter {
  status?: string;
  audited_at?: string;
  style_guide_md5?: string;
  report_pdf_md5?: string;
  report_tex_md5?: string;
  page_count?: string;
  canonical_figures?: Record<string, string>;
  plot_scripts?: Record<string, string>;
}

const FRONTMATTER_SCALAR_KEYS = new Set([
  "status", "audited_at", "style_guide_md5",
  "report_pdf_md5", "report_tex_md5", "page_count",
]);

/**
 * Parse the YAML envelope (`---\n...\n---`) from the start of a file.
 * Returns the inner block text, or null if no envelope is present.
 */
export function extractFrontmatterBlock(src: string): string | null {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

/**
 * Fixed-schema parser for the audit notes frontmatter (js-yaml is not a
 * dep). Tolerates tabs/CRLF; indented entries under `canonical_figures:`
 * / `plot_scripts:` go into the corresponding map, top-level scalars from
 * FRONTMATTER_SCALAR_KEYS are extracted, everything else is ignored.
 */
export function parseAuditFrontmatter(block: string): AuditFrontmatter {
  const out: AuditFrontmatter = {};
  let section: "canonical_figures" | "plot_scripts" | null = null;
  for (const raw of block.replace(/\r/g, "").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indented = /^[\t ]/.test(raw);
    if (!indented) {
      section = null;
      const m = raw.match(/^(\w+)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === "canonical_figures" || key === "plot_scripts") {
        section = key;
        out[key] = {};
      } else if (value && FRONTMATTER_SCALAR_KEYS.has(key)) {
        (out as any)[key] = value.trim().replace(/^["']|["']$/g, "");
      }
    } else if (section) {
      const m = raw.match(/^[\t ]+(.+?)\s*:\s*(.+)$/);
      if (m) out[section]![m[1].trim()] = m[2].trim();
    }
  }
  return out;
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
