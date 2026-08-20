/**
 * Edit failure recovery — when the underlying edit tool can't find oldText,
 * read the current file and return a "fresh excerpt" hint that shows what
 * the file actually looks like in the region where oldText was expected.
 *
 * This converts a hard failure ("Could not find the exact text") into a
 * recoverable retry: the agent sees the current state inline and can either
 * reconstruct oldText or call read for a wider view.
 *
 * Anchor algorithm:
 *   1. Pick distinctive lines from oldText (first / last / middle).
 *   2. Fuzzy-search each anchor in the current file (Unicode-normalized).
 *   3. On hit, return ±CONTEXT_LINES around the match with line numbers.
 *   4. Fallback: word n-gram (4→3→2) shingle search to catch single-line
 *      rewrites that share partial phrasing.
 *   5. Last resort: generic "re-read" hint.
 *
 * Also exports `findOldTextLine` so safety-wrappers.ts can use the same
 * matching logic for partial-read coverage checks.
 */

import { readFile } from "node:fs/promises";

const CONTEXT_LINES = 12;
const MAX_MATCHES_PER_ANCHOR = 2;
// Skip shingle search on huge oldText — n-gram sweep over a 50KB file with
// 500-word oldText is ~12M char ops; rare but worth bounding.
const MAX_OLDTEXT_FOR_SHINGLE = 2000;

// ── Inlined fuzzy normalizer ──────────────────────────────────────────────
// Mirrors @earendil-works/pi-coding-agent/dist/core/tools/edit-diff.js so that
// our fuzzy search uses the same equivalence classes as the underlying edit
// tool's fuzzyFindText. Inlined to avoid fragile deep imports —
// pi-coding-agent's package.json doesn't export this from the main entry.
function normalizeForFuzzyMatch(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

// ── Helpers ───────────────────────────────────────────────────────────────

function pickAnchors(oldText: string): string[] {
  const lines = oldText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && /\w/.test(l));
  if (lines.length === 0) return [];
  const candidates = [
    lines[0],
    lines[lines.length - 1],
    lines[Math.floor(lines.length / 2)],
  ];
  // Dedupe — when oldText is short, candidates collapse onto the same line.
  return [...new Set(candidates)];
}

function findAnchorMatches(fuzzyContent: string, anchor: string): number[] {
  const fuzzyAnchor = normalizeForFuzzyMatch(anchor).trim();
  if (fuzzyAnchor.length < 5) return [];
  const matches: number[] = [];
  let cursor = 0;
  while (matches.length < MAX_MATCHES_PER_ANCHOR) {
    const idx = fuzzyContent.indexOf(fuzzyAnchor, cursor);
    if (idx === -1) break;
    const lineNum = fuzzyContent.slice(0, idx).split("\n").length;
    matches.push(lineNum);
    cursor = idx + fuzzyAnchor.length;
  }
  return matches;
}

/**
 * Word n-gram fallback. Used when no full-line anchor matches.
 *
 * Extracts every n-word shingle from oldText and looks for the first one that
 * appears in the file. Catches the case where a full line was rewritten but
 * shares partial phrasing with the new line ("Original results paragraph" →
 * "Updated results paragraph" both contain "results paragraph").
 *
 * Tries n=4 → 3 → 2 in sequence — longer shingles are more discriminating.
 */
function shingleMatch(
  fileContent: string,
  oldText: string,
): { lineNum: number; shingle: string } | null {
  if (oldText.length > MAX_OLDTEXT_FOR_SHINGLE) return null;
  const fileLower = fileContent.toLowerCase();
  const words = (oldText.toLowerCase().match(/[\w']+/g) || [])
    .filter((w) => w.length > 2);  // drop trivial stopwords like "a", "is"
  if (words.length === 0) return null;

  for (const n of [4, 3, 2]) {
    if (words.length < n) continue;
    for (let i = 0; i <= words.length - n; i++) {
      const shingle = words.slice(i, i + n).join(" ");
      const idx = fileLower.indexOf(shingle);
      if (idx !== -1) {
        // Compute lineNum from the lowercase string we actually searched.
        // Newlines are case-invariant so this is identical to the original
        // for ASCII, and consistent for non-ASCII (where toLowerCase can
        // change byte length and break index → line mapping in the original).
        const lineNum = fileLower.slice(0, idx).split("\n").length;
        return { lineNum, shingle };
      }
    }
  }
  return null;
}

function formatExcerpt(lines: string[], centerLine: number): string {
  const start = Math.max(0, centerLine - CONTEXT_LINES - 1);
  const end = Math.min(lines.length, centerLine + CONTEXT_LINES);
  const width = String(end).length;
  return lines
    .slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(width)}  ${l}`)
    .join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Locate which line in `fileContent` an `oldText` block most likely targets.
 * Returns 1-indexed line number, or null if no plausible match.
 *
 * Used by safety-wrappers.ts for partial-read coverage checks (where it asks
 * "is the agent trying to edit a region they didn't actually read?") and
 * internally by freshExcerptError.
 */
export function findOldTextLine(fileContent: string, oldText: string): number | null {
  const anchors = pickAnchors(oldText);
  if (anchors.length > 0) {
    const fuzzyContent = normalizeForFuzzyMatch(fileContent);
    for (const anchor of anchors) {
      const hits = findAnchorMatches(fuzzyContent, anchor);
      if (hits.length > 0) return hits[0];
    }
  }
  return shingleMatch(fileContent, oldText)?.lineNum ?? null;
}

/**
 * Build a recoverable error message with a fresh excerpt of the file.
 * Returns a string suitable for `throw new Error(returned_string)`.
 *
 * If `cachedContent` is provided (e.g., the wrapper already read the file
 * for a partial-read coverage check), it's reused instead of re-reading.
 */
export async function freshExcerptError(
  absPath: string,
  displayPath: string,
  oldText: string,
  originalErr: string,
  cachedContent?: string,
): Promise<string> {
  let current: string;
  if (cachedContent !== undefined) {
    current = cachedContent;
  } else {
    try {
      current = await readFile(absPath, "utf-8");
    } catch (e: any) {
      return `${originalErr}\n(Could not re-read file for excerpt: ${e?.message || e})`;
    }
  }

  const lines = current.split("\n");

  // First pass: full-line anchor matching (best for multi-line oldText where
  // some lines are unchanged).
  const anchors = pickAnchors(oldText);
  if (anchors.length > 0) {
    const fuzzyContent = normalizeForFuzzyMatch(current);
    for (const anchor of anchors) {
      const hits = findAnchorMatches(fuzzyContent, anchor);
      if (hits.length === 0) continue;

      const sections = hits.map((ln, i) => {
        const tag = hits.length > 1 ? ` (match ${i + 1} of ${hits.length})` : "";
        return `Anchor "${anchor.slice(0, 80)}" found at line ${ln}${tag}:\n` +
          "```\n" + formatExcerpt(lines, ln) + "\n```";
      }).join("\n\n");

      return [
        `Edit failed: oldText not found in ${displayPath}.`,
        ``,
        `The file may have been modified since you constructed oldText.`,
        `Current file state near where the text was expected:`,
        ``,
        sections,
        ``,
        `Use this excerpt to construct a corrected oldText, or re-read the full file with the read tool.`,
      ].join("\n");
    }
  }

  // Second pass: word n-gram shingle fallback. Catches single-line edits where
  // oldText was fully rewritten but shares partial phrasing with the new line.
  const shingle = shingleMatch(current, oldText);
  if (shingle) {
    return [
      `Edit failed: oldText not found in ${displayPath}.`,
      ``,
      `Closest partial match: phrase "${shingle.shingle}" appears at line ${shingle.lineNum}.`,
      `Current file state near that line:`,
      ``,
      "```",
      formatExcerpt(lines, shingle.lineNum),
      "```",
      ``,
      `The text you tried to edit appears to have been rewritten. Use this excerpt`,
      `to construct a corrected oldText, or re-read the full file with the read tool.`,
    ].join("\n");
  }

  return [
    `Edit failed: oldText not found in ${displayPath}, and no anchor from your`,
    `oldText matched the current file state. The file may have been substantially`,
    `rewritten since you read it. Re-read it with the read tool before retrying.`,
    ``,
    `(Original error: ${originalErr})`,
  ].join("\n");
}
