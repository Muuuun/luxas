/**
 * Safety wrappers — runtime constraints around the raw pi-coding-agent tools.
 *
 * Provides:
 *   - Read tracking (session-scoped Map of absPath → mtime + range)
 *   - Read-before-edit enforcement (must read before edit/write)
 *   - External-modification detection (mtime mismatch → require re-read)
 *   - Partial-read coverage check (offset/limit must include the edit target)
 *   - Protected-file blocking (per-agent list, exact absolute-path match)
 *   - Block write-on-existing (force edit over write)
 *   - Fresh-excerpt recovery on edit failure (delegated to edit-recovery.ts)
 *
 * Two preset wrappers:
 *   - wrapBrainTools     — protects RESEARCH.md only
 *   - wrapExperimentTools — protects RESEARCH.md, report.tex, references.bib, notes/*.md
 *
 * Both share the same factory (createSafetyWrapper) and tracker semantics.
 *
 * I/O is fully async (fs/promises) so the wrapper doesn't block parallel
 * tool execution that pi-agent-core schedules with toolExecution: "parallel".
 *
 * Note: there's an unavoidable best-effort TOCTOU window between the mtime
 * check and the underlying edit. The check catches the common cases
 * (different agent / external bash modified the file); concurrent races
 * within one agent's parallel tool batch are not protected.
 */

import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findOldTextLine, freshExcerptError } from "./edit-recovery.js";
import { extractTextContent } from "../utils.js";

// ── Types ────────────────────────────────────────────────────────────────

export type SafetyWrapper = (tools: any[], projectDir: string) => any[];

interface ReadEntry {
  /** mtimeMs of the file at the moment it was read (or written/edited). */
  mtimeAtRead: number;
  /** Inclusive 1-indexed line range actually covered. Undefined = full read. */
  range?: { start: number; end: number };
}

type ReadTracker = Map<string, ReadEntry>;

interface SafetyOptions {
  /** Project-relative paths that block edit/write entirely. Resolved at construction. */
  protectedFiles: string[];
  /** "block" → reject write on existing file. "allow_as_read" → permit, count as read. */
  writeOnExistingPolicy: "block" | "allow_as_read";
}

/** Detect content-shape errors from upstream pi-coding-agent edit tool. */
const EDIT_FAILURE_PATTERNS = /Could not find the exact text|Found \d+ occurrences|No changes made/;

// mtime granularity tolerance in ms. ext4/zfs round to ms; HFS+ to seconds.
// 2ms covers ms-rounded filesystems without false-positives on the post-write bump.
const MTIME_TOLERANCE_MS = 2;

// ── Helpers ──────────────────────────────────────────────────────────────

function getPathArg(params: any): string {
  return params.path || params.file_path || "";
}

function errorContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function blocked(reason: string) {
  return errorContent(`BLOCKED: ${reason}`);
}

async function safeMtime(absPath: string): Promise<number | null> {
  try {
    return (await stat(absPath)).mtimeMs;
  } catch {
    return null;
  }
}

async function safeReadFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

// ── Tool wrappers ────────────────────────────────────────────────────────

function wrapRead(tool: any, tracker: ReadTracker, projectDir: string) {
  const origExecute = tool.execute;
  return {
    ...tool,
    execute: async (id: string, params: any, signal?: any) => {
      const result = await origExecute(id, params, signal);
      if (result?.isError === true) return result;
      const p = getPathArg(params);
      if (!p) return result;
      const abs = resolve(projectDir, p);
      const mtime = await safeMtime(abs);
      if (mtime === null) return result;

      const fullRead = !params.offset && !params.limit;
      const entry: ReadEntry = { mtimeAtRead: mtime };
      if (!fullRead) {
        const start = params.offset ?? 1;
        const end = params.limit
          ? start + params.limit - 1
          : Number.MAX_SAFE_INTEGER;
        entry.range = { start, end };
      }
      tracker.set(abs, entry);
      return result;
    },
  };
}

function wrapEdit(
  tool: any,
  tracker: ReadTracker,
  projectDir: string,
  protectedAbs: Set<string>,
) {
  const origExecute = tool.execute;
  return {
    ...tool,
    execute: async (id: string, params: any, signal?: any) => {
      const p = getPathArg(params);
      const abs = resolve(projectDir, p);
      const oldText = String(params.oldText ?? "");

      if (protectedAbs.has(abs)) {
        return blocked(`${p} is protected and cannot be edited by this agent.`);
      }

      const entry = tracker.get(abs);
      if (!entry) {
        return blocked(
          `You must read ${p} with the read tool before editing it. ` +
          `This catches stale oldText caused by reading from memory instead of disk.`
        );
      }

      const currentMtime = await safeMtime(abs);
      if (currentMtime === null) {
        return blocked(`${p} no longer exists or is unreadable.`);
      }
      if (currentMtime > entry.mtimeAtRead + MTIME_TOLERANCE_MS) {
        return blocked(
          `${p} was modified after you last read it ` +
          `(mtime ${entry.mtimeAtRead.toFixed(0)} → ${currentMtime.toFixed(0)}). ` +
          `Re-read the file before editing — your oldText is likely stale.`
        );
      }

      // Partial-read coverage. We have to read the file once to find the
      // target line; cache the content so freshExcerptError can reuse it
      // on a subsequent edit failure without re-reading.
      let cachedContent: string | undefined;
      if (entry.range !== undefined) {
        cachedContent = (await safeReadFile(abs)) ?? undefined;
        if (cachedContent !== undefined) {
          const targetLine = findOldTextLine(cachedContent, oldText);
          if (targetLine !== null &&
              (targetLine < entry.range.start || targetLine > entry.range.end)) {
            const endStr = entry.range.end === Number.MAX_SAFE_INTEGER
              ? "EOF" : String(entry.range.end);
            return blocked(
              `You only read ${p} lines ${entry.range.start}-${endStr}, ` +
              `but the text you are trying to edit is at approximately line ${targetLine}. ` +
              `Re-read the file without offset/limit (or with a wider range that covers line ${targetLine}).`
            );
          }
        }
      }

      // Execute the underlying edit tool. Two failure modes:
      //   (a) it throws (reject) — wrap with fresh excerpt and re-throw
      //   (b) it returns content with isError or "Could not find" text
      let result: any;
      try {
        result = await origExecute(id, params, signal);
      } catch (err: any) {
        const enriched = await freshExcerptError(
          abs, p, oldText,
          err?.message || String(err),
          cachedContent,
        );
        throw new Error(enriched);
      }

      // Detect content-shape errors that pi-coding-agent might return without
      // throwing (current version always throws, but defensive guard).
      const text = extractTextContent(result?.content ?? []);
      const isContentError = result?.isError === true || EDIT_FAILURE_PATTERNS.test(text);
      if (isContentError) {
        const enriched = await freshExcerptError(
          abs, p, oldText, text || "Edit failed", cachedContent,
        );
        throw new Error(enriched);
      }

      // Success: bump tracker mtime to the new disk mtime so the next edit on
      // the same file (in the same diff region) doesn't trip the mtime check.
      const newMtime = await safeMtime(abs);
      if (newMtime !== null) {
        tracker.set(abs, { ...entry, mtimeAtRead: newMtime });
      }
      return result;
    },
  };
}

function wrapWrite(
  tool: any,
  tracker: ReadTracker,
  projectDir: string,
  protectedAbs: Set<string>,
  opts: SafetyOptions,
) {
  const origExecute = tool.execute;
  return {
    ...tool,
    execute: async (id: string, params: any, signal?: any) => {
      const p = getPathArg(params);
      const abs = resolve(projectDir, p);

      if (protectedAbs.has(abs)) {
        return blocked(`${p} is protected and cannot be written by this agent.`);
      }

      if (opts.writeOnExistingPolicy === "block") {
        const exists = (await safeMtime(abs)) !== null;
        if (exists) {
          return blocked(
            `${p} already exists. Use the edit tool to modify existing files. ` +
            `This prevents regression from full-file overwrites.`
          );
        }
      }

      const result = await origExecute(id, params, signal);
      // After successful write, tracker considers the file "freshly read" —
      // the agent knows its content because they just wrote it.
      if (result?.isError !== true) {
        const newMtime = await safeMtime(abs);
        if (newMtime !== null) {
          tracker.set(abs, { mtimeAtRead: newMtime });
        }
      }
      return result;
    },
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

function createSafetyWrapper(opts: SafetyOptions): SafetyWrapper {
  return (tools, projectDir) => {
    // One tracker per wrapper instance — closure-scoped, lives as long as
    // the agent that owns these tool instances.
    const tracker: ReadTracker = new Map();
    // Resolve protected files to absolute paths once at construction so the
    // hot path can use exact set membership instead of suffix matching
    // (which would false-positive on names like `evilRESEARCH.md`).
    const protectedAbs = new Set(opts.protectedFiles.map((f) => resolve(projectDir, f)));

    return tools.map((tool: any) => {
      if (tool.name === "read")  return wrapRead(tool, tracker, projectDir);
      if (tool.name === "edit")  return wrapEdit(tool, tracker, projectDir, protectedAbs);
      if (tool.name === "write") return wrapWrite(tool, tracker, projectDir, protectedAbs, opts);
      return tool;
    });
  };
}

// ── Preset wrappers ──────────────────────────────────────────────────────

export const wrapBrainTools: SafetyWrapper = createSafetyWrapper({
  // Brain owns notes/, report/, references.bib — only RESEARCH.md is sacred.
  protectedFiles: ["RESEARCH.md"],
  // Brain.md prompt says "ALWAYS use edit, NEVER use write to overwrite" —
  // enforce that at runtime. If brain genuinely needs to overwrite, it can
  // delete the file via bash first.
  writeOnExistingPolicy: "block",
});

// experiment owns per-experiment artifacts under data/experiments/<id>/ and
// appends per-L2 sections to notes/experiments.md (V5: notes/experiments.md
// is now the analysis ledger replacing design/spec_*.md). Blocked from
// rewriting RESEARCH.md, the report, references, and literature notes.
export const wrapExperimentTools: SafetyWrapper = createSafetyWrapper({
  protectedFiles: [
    "RESEARCH.md",
    "report.tex",
    "references.bib",
    "notes/literature.md",
  ],
  writeOnExistingPolicy: "block",
});

// tool_impl writes Python modules under data/experiments/<id>/scripts/.
// Does not write tests, notes, or report. Per-experiment-directory
// enforcement is left to the prompt (safety wrapper lacks EXPERIMENT_ID
// from templateVars); this wrapper just blocks the obvious cross-cutting
// files.
export const wrapToolImplTools: SafetyWrapper = createSafetyWrapper({
  protectedFiles: [
    "RESEARCH.md",
    "report.tex",
    "references.bib",
    "notes/literature.md",
    "notes/experiments.md",
    "notes/memory.md",
    "notes/plan.md",
  ],
  writeOnExistingPolicy: "block",
});

// tool_review writes pytest files under data/experiments/<id>/tests/. Same
// cross-cutting blocks as tool_impl; additionally must NOT write to
// scripts/ (prompt enforces; wrapper lacks path-glob granularity).
export const wrapToolReviewTools: SafetyWrapper = createSafetyWrapper({
  protectedFiles: [
    "RESEARCH.md",
    "report.tex",
    "references.bib",
    "notes/literature.md",
    "notes/experiments.md",
    "notes/memory.md",
    "notes/plan.md",
  ],
  writeOnExistingPolicy: "block",
});

// ── Registry ─────────────────────────────────────────────────────────────

const SAFETY_WRAPPERS: Record<string, SafetyWrapper> = {
  brain: wrapBrainTools,
  experiment: wrapExperimentTools,
  tool_impl: wrapToolImplTools,
  tool_review: wrapToolReviewTools,
};

export function resolveSafetyWrapper(name: string | undefined): SafetyWrapper | undefined {
  if (!name) return undefined;
  return SAFETY_WRAPPERS[name];
}

export function registerSafetyWrapper(name: string, wrapper: SafetyWrapper): void {
  SAFETY_WRAPPERS[name] = wrapper;
}
