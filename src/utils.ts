/**
 * Shared utility functions used across multiple modules.
 */

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Liveness probe via signal 0 — kernel returns ESRCH if no process owns
 * the pid. Both pid wrap-around (rare) and "pid alive but it's a different
 * program now" (more common) are accepted false positives; callers needing
 * stronger ownership proof must verify out of band.
 */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Atomic JSON write: serialize, write to a sibling tmp file, rename onto
 * the target. The rename is the atomic step on POSIX, so a crash mid-write
 * never leaves a half-written file at `path`.
 */
export function atomicWriteJson(path: string, value: unknown): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
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
/**
 * Extract the user's verbatim request region from a RESEARCH.md rendered by
 * renderResearchDoc: the blockquote lines under "## Original (User) Request".
 * Returns null when the file has no such section (hand-written RESEARCH.md).
 * Anchoring on this region keeps later additions (STATE headers, <feedback>
 * sections, result notes a human prepended/appended) out of derived titles
 * and digest questions.
 */
export function originalRequestBlock(text: string): string | null {
  const m = /^##\s+Original (?:User )?Request\s*$/im.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const lines: string[] = [];
  let started = false;
  for (const raw of after.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^_.*_$/.test(t)) continue; // italic scaffold explainer
    if (t.startsWith(">")) {
      lines.push(t.replace(/^(?:>\s*)+/, ""));
      started = true;
      continue;
    }
    if (started) break; // blockquote region ended
    break; // next section began before any quote — no usable block
  }
  const block = lines.join("\n").trim();
  return block || null;
}

export function deriveProjectTitle(text: string, maxLen = 120): string {
  // Inbox prompts start "Hi Luxas, ..." and scaffold files start with a bare
  // "# Research Goal" header — both produced junk registry names for ~half
  // the registry. Prefer the verbatim user request region when present, then
  // strip salutations, blockquote markers, XML-ish wrapper tags, and
  // structural headers; take the first line with real content. Splits on
  // literal "\n" too: the --prompt CLI path does not unescape newlines, so
  // some RESEARCH.md files carry them verbatim.
  const source = originalRequestBlock(text) ?? text;
  for (const raw of source.split(/\r?\n|\\n/)) {
    const unquoted = raw.replace(/^(?:>\s*)+/, "").trim();
    if (/^_.*_$/.test(unquoted)) continue; // italic-only scaffold explainer line
    let line = unquoted
      .replace(/^#+\s*/, "")
      .replace(/[*_`[\]]/g, "")
      .trim();
    if (!line) continue;
    line = line
      .replace(/^<[a-zA-Z][^>]*>\s*/, "")   // unwrap leading <goal>/<research> tag
      .replace(/\s*<\/[a-zA-Z][^>]*>$/, "") // unwrap trailing closing tag
      .trim();
    line = line.replace(/^(hi|hello|hey|dear)[,!.\s]+luxas[,!.:：，\s]*/i, "").trim();
    line = line.replace(/^research goal[:：]?\s*/i, "").trim();
    if (!line || /^<[^>]*>$/.test(line)) continue;
    if (/^original user request$/i.test(line)) continue;
    return line.slice(0, maxLen);
  }
  return "Untitled";
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
  page_count?: string;
  canonical_figures?: Record<string, string>;
  plot_scripts?: Record<string, string>;
}

// report_tex_md5 was previously in this list but never consumed — convergence
// (src/agents/context-builders.ts) and the finish-gate compare only
// report_pdf_md5. Removed 2026-05-13 because asking weak models (Kimi 32k)
// to compute and emit a tex md5 with no workflow step grounding it produced
// reliable hallucination (md5 of empty string baked into Sonnet/Kimi training).
const FRONTMATTER_SCALAR_KEYS = new Set([
  "status", "audited_at", "style_guide_md5",
  "report_pdf_md5", "page_count",
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

/**
 * A generative fork an experiment authored into notes/experiments.md.
 * experiment.md H6 (fail_forward_protocol) makes every completed experiment
 * append either `### FollowUp: NONE — <argument>` or `### FollowUp: E_{N}_<slug>`
 * with a Question / Estimated effort / Decision rule body. These were only ever
 * read in report-writing mode (experiments.md is framed as "report source"),
 * and smartTruncate(exp,2000) clipped every block but the file tail to a bare
 * header — so the forks were invisible to the brain as control flow.
 *
 * The id regex tolerates the literal `E_{N}_slug` BRACE form the template emits
 * (observed in the wild: `E_{4}_bb_logical_spread`); a bare `E_\d+` silently
 * misses it — the dead-regex failure class (see project_finish_gate_regex_deadgate).
 */
export interface FollowUpLead {
  leadId: string;        // normalized: "E_4_bb_logical_spread" (braces stripped)
  num: number;           // 4  (-1 for NONE)
  sourceSection: string; // "L2.3" / "E_3"
  isNone: boolean;
  question: string;
  effort: string;
  decisionRule: string;
}

export function parseFollowUps(text: string): FollowUpLead[] {
  const lines = text.split("\n");
  const out: FollowUpLead[] = [];
  let sourceSection = "";
  const sectionRE = /^##\s+(L2\.\d+|E_?\d+)\b/;
  const fuRE = /^###\s+FollowUp:\s*(.*)$/i;
  const headerRE = /^#{2,3}\s/;
  for (let i = 0; i < lines.length; i++) {
    const sm = lines[i].match(sectionRE);
    if (sm) { sourceSection = sm[1]; continue; }
    const fm = lines[i].match(fuRE);
    if (!fm) continue;
    const rest = fm[1].trim();
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && !headerRE.test(lines[j]); j++) body.push(lines[j]);
    const blockBody = body.join("\n");
    if (/^NONE\b/i.test(rest)) {
      out.push({ leadId: "NONE", num: -1, sourceSection, isNone: true, question: "", effort: "", decisionRule: rest.replace(/^NONE\s*[—-]?\s*/i, "") });
      continue;
    }
    // Match the lead id tolerant of EVERY observed shape: `E_{4}_slug` (brace
    // template), `E4_slug` (no brace), AND `E5 — Title` / `E5: ...` (bare number,
    // no underscore-slug at all — the slug is optional). The earlier
    // `\d+\}?_\S+` REQUIRED an underscore+slug and silently dropped the bare
    // `E5 — …` form an experiment actually authored, so the disposition gate
    // never saw that open lead and the brain finished with it dangling — the
    // dead-regex failure class, this time in the frontier parser itself.
    const idm = rest.match(/E_?\{?(\d+)\}?(?:_([A-Za-z0-9_]+))?/);
    if (!idm) continue;
    const num = parseInt(idm[1], 10);
    const field = (name: string): string => {
      const re = new RegExp(`\\*\\*${name}[^*]*\\*\\*\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*-\\s*\\*\\*|\\n#{2,3}\\s|$)`, "i");
      const m = blockBody.match(re);
      return m ? m[1].trim().replace(/\s+/g, " ") : "";
    };
    out.push({ leadId: idm[2] ? `E_${num}_${idm[2]}` : `E_${num}`, num, sourceSection, isNone: false, question: field("Question"), effort: field("Estimated effort"), decisionRule: field("Decision rule") });
  }
  return out;
}
