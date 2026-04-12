/**
 * Shared helpers for the field-methodology extraction pipeline.
 *
 * - Template scaffold writer — called by the dispatcher before a worker spawns,
 *   so a worker crash can't leave notes/methodology.md in a clobber-prone
 *   empty state.
 * - Ledger parser — lives here (shared between context.ts research snapshot
 *   and callers that want to check processed status).
 * - Paper ID discovery — lists both arXiv subdirectories and flat PDF files
 *   so DOI/URL downloads are caught by the fallback scan.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
