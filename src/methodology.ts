/**
 * Shared helpers for the reader pipeline (paper full-text extraction).
 *
 * - Template scaffolds — written before a reader spawns, so a reader crash
 *   can't leave notes/methodology.md or notes/literature.md in a clobber-prone
 *   empty state.
 * - Ledger parser — lives here (shared between context.ts research snapshot
 *   and callers that want to check processed status).
 * - Paper ID discovery — lists both arXiv subdirectories and flat PDF files
 *   so DOI/URL downloads are caught by the fallback scan.
 * - Literature cite-key extraction — reads `### <key>` headings so the
 *   citation-integrity reminder can compare them against \cite{} in report.tex.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { ARXIV_ID_RE, readFileSafe } from "./utils.js";

export const METHODOLOGY_TEMPLATE = `# Field Methodology Standard

Auto-extracted from the literature downloaded into \`data/papers/\`. This is a
map of what this field considers **standard methodology** — NOT a summary of
paper results. Use it to calibrate what your own experiments, simulations,
and report must cover to meet field standards.

## A. Theoretical quantities computed in this field

## B. Experimental / simulation demonstrations done in this field

## C. Figure content inventory (standard figure content for this field)

## D. Rigor thresholds observed

## Papers processed

`;

/** Path resolver — kept in one place so tests/workers use the same layout. */
export function methodologyPath(projectDir: string): string {
  return join(projectDir, "notes", "methodology.md");
}

/**
 * Ensure notes/methodology.md exists with the standard scaffold.
 * Idempotent: no-op if the file already has content.
 */
export function ensureMethodologyFile(projectDir: string): void {
  const path = methodologyPath(projectDir);
  if (existsSync(path)) return;
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  writeFileSync(path, METHODOLOGY_TEMPLATE);
}

/**
 * Parse the "## Papers processed" section into a Set of paper IDs.
 * Captures the first whitespace-delimited token after the bullet, so both
 * arXiv IDs (`2308.07915`) and DOI-style IDs (`10.1038_s41586-021-03819-2`)
 * are recognized. IDs mentioned later in the bullet (e.g. cross-references
 * in a "contributed: method from 2308.07915" phrase) are ignored.
 */
export function parseProcessedLedger(content: string | null): Set<string> {
  const result = new Set<string>();
  if (!content) return result;
  const match = content.match(/##\s*Papers processed\s*\n([\s\S]*?)(?:\n##|\n*$)/);
  if (!match) return result;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^\s*[-*]\s+(\S+)/);
    if (m) result.add(m[1]);
  }
  return result;
}

/**
 * Discover paper IDs on disk under data/papers/. Handles both:
 *   - arXiv LaTeX downloads: data/papers/<arxiv_id>/   (subdirectory)
 *   - DOI/URL PDF downloads: data/papers/<id>.pdf      (flat file)
 * The returned ID is what the worker's PAPER_ID template var will be set to
 * — the worker must resolve it to a path by trying both structures.
 */
export function listPaperIds(projectDir: string): string[] {
  const papersDir = join(projectDir, "data", "papers");
  if (!existsSync(papersDir)) return [];
  const out: string[] = [];
  try {
    for (const name of readdirSync(papersDir)) {
      const full = join(papersDir, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory() && ARXIV_ID_RE.test(name)) {
        out.push(name);
      } else if (stat.isFile() && extname(name).toLowerCase() === ".pdf") {
        out.push(basename(name, extname(name)));
      }
    }
  } catch {}
  return out;
}

/** Return IDs present on disk but missing from the processed ledger. */
export function findUnprocessedPapers(projectDir: string): string[] {
  const present = listPaperIds(projectDir);
  if (present.length === 0) return [];
  const method = readFileSafe(methodologyPath(projectDir));
  const processed = parseProcessedLedger(method);
  return present.filter(id => !processed.has(id));
}

/**
 * Reconcile `notes/methodology.md` "## Papers processed" with the reader's
 * fragment directory. Called by the harness after any reader agent completes
 * (see `spawnAgent` in `src/agents/spawn.ts`). Without this, brain-driven
 * reader spawns (which bypass the search agent's final MERGE_NOTES step)
 * leave the ledger stale, causing `findUnprocessedPapers` to re-flag the
 * paper and brain to re-spawn the reader in a loop.
 *
 * Idempotent: no-op if every fragment id is already in the ledger. Atomic
 * tmpfile+rename write tolerates parallel readers — last writer wins, next
 * call picks up any missed ids.
 */
export function syncProcessedLedger(projectDir: string): void {
  const fragDir = join(projectDir, "notes", "methodology.d");
  let fragmentIds: string[];
  try {
    fragmentIds = readdirSync(fragDir)
      .filter(n => n.endsWith(".md"))
      .map(n => basename(n, ".md"))
      .sort();
  } catch { return; }
  if (fragmentIds.length === 0) return;

  ensureMethodologyFile(projectDir);
  const path = methodologyPath(projectDir);
  const content = readFileSync(path, "utf-8");
  const existing = parseProcessedLedger(content);
  const missing = fragmentIds.filter(id => !existing.has(id));
  if (missing.length === 0) return;

  const bullets = missing.map(id => `- ${id}\n`).join("");
  const sectionRe = /(##\s*Papers processed\s*\n)/;
  const updated = sectionRe.test(content)
    ? content.replace(sectionRe, `$1${bullets}`)
    : content.trimEnd() + `\n\n## Papers processed\n${bullets}`;

  const tmp = path + ".tmp";
  writeFileSync(tmp, updated);
  renameSync(tmp, path);
}

// ── Literature notes (owned by reader agent) ────────────────────────────────

export const LITERATURE_TEMPLATE = `# Literature Notes

Per-paper entries are written by the \`reader\` agent after it reads a paper's
full text. Each entry's heading is its BibTeX \`cite_key\` — the same key used
in \`report/references.bib\` and in \`\\cite{…}\` calls in \`report.tex\`.

**Rule:** A \`\\cite{key}\` in the report is only valid if \`### key\` exists
below (i.e. a reader actually read the paper). Brain may append observations
under \`#### Notes:\` inside an existing entry but should NOT create new \`###\`
entries — that would bypass the must-read-to-cite contract. If the brain needs
a new reference, it should dispatch \`search\` (topical) or spawn a \`reader\`
(specific paper) to produce the entry.

`;

export function literaturePath(projectDir: string): string {
  return join(projectDir, "notes", "literature.md");
}

/**
 * Ensure notes/literature.md exists with the standard scaffold. The size
 * threshold upgrades a stub `# Literature Notes\n` header (written by older
 * init logic) to the full reader-ownership contract text.
 */
export function ensureLiteratureFile(projectDir: string): void {
  const path = literaturePath(projectDir);
  try {
    if (statSync(path).size > 80) return;
  } catch { /* missing file — write it below */ }
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  writeFileSync(path, LITERATURE_TEMPLATE);
}

/**
 * Parse `### <key>` headings from literature.md. These are the cite_keys that
 * reader has produced entries for — the ground-truth set of "papers actually
 * read". Used by the citation-integrity reminder to flag \cite{} in report.tex
 * that points at a paper never read.
 */
// Capture the first whitespace-delimited token after `### `. Trailing text
// (e.g. `### Rubies2023 — collective emission`) is tolerated so the contract
// survives minor prompt drift.
const LITERATURE_HEADING_RE = /^###\s+(\S+)/;

export function parseLiteratureCiteKeys(content: string | null): Set<string> {
  const result = new Set<string>();
  if (!content) return result;
  for (const line of content.split("\n")) {
    const m = line.match(LITERATURE_HEADING_RE);
    if (m) result.add(m[1]);
  }
  return result;
}
