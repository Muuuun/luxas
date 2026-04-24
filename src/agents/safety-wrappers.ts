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
 * Per-agent safety is driven by each agent's `.md` frontmatter — see
 * `SafetyConfig` in registry.ts. `buildSafetyWrapper(config)` compiles that
 * config into a SafetyWrapper; the internal `createSafetyWrapper` factory
 * applies the runtime tracker + enforcement.
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
import { SAFETY_PRESETS } from "./safety-presets.js";
import { expandTemplate, extractTextContent } from "../utils.js";
import type { SafetyConfig } from "./registry.js";
import type { FileTouchRecord } from "../active-agents.js";
import {
  createFileContextCache,
  FILE_CONTEXT_MAX_ENTRY_BYTES,
  type FileContextCache,
  type FileContextEntry,
} from "./file-context-cache.js";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Observer callbacks fired by the safety wrapper at well-defined tool
 * milestones.
 *
 * - `onFileTouched` fires on successful write/edit and is the narrow
 *   "the agent modified a file" signal consumed by the PR-1 SubAgentExit
 *   collector.
 * - `onFileContextEntry` fires on successful read/write/edit with the full
 *   cache entry (content, mtime, range, via). Phase 3b agent-level
 *   aggregators subscribe to this to build a compaction carry-forward
 *   view without re-scanning disk.
 *
 * Hooks are invoked synchronously inside the wrapper's success branch (after
 * the underlying tool resolved, before the success result is returned). A
 * throwing hook does NOT turn the tool success into a failure — the wrapper
 * isolates exceptions (see notifyFileTouched / notifyFileContextEntry).
 */
export interface SafetyRuntimeHooks {
  onFileTouched?: (event: FileTouchRecord) => void;
  onFileContextEntry?: (event: { absPath: string; entry: FileContextEntry }) => void;
}

export type SafetyWrapper = (
  tools: any[],
  projectDir: string,
  templateVars?: Record<string, string>,
  hooks?: SafetyRuntimeHooks,
) => any[];

// The cache is the FileContextCache from ./file-context-cache.ts. Legacy
// ReadTracker / ReadEntry types were renamed into FileContextCache /
// FileContextEntry with additional fields (content, touchedAt, via) that
// Phase 3b compaction carry-forward consumes. The enforcement logic below
// uses only mtimeMs + range, so adding content is purely additive.

interface SafetyOptions {
  /** Project-relative paths that block edit/write entirely. Resolved at construction. */
  protectedFiles: string[];
  /** "block" → reject write on existing file. "allow_as_read" → permit, count as read. */
  writeOnExistingPolicy: "block" | "allow_as_read";
  /**
   * If set, the read tool will only succeed for paths under one of these roots.
   * Paths are project-relative and support `{{VAR}}` templating resolved from
   * the spawn's templateVars (e.g. `data/experiments/{{EXPERIMENT_ID}}`).
   * Unset = no read-path restriction.
   */
  allowedReadRoots?: string[];
  /**
   * If set, write/edit paths must resolve under one of these roots. Same
   * templating rules as allowedReadRoots. Unset = no write-path whitelist
   * (blocklist via protectedFiles still applies).
   */
  allowedWriteRoots?: string[];
  /**
   * If set, write/edit to paths matching any of these regex patterns returns
   * BLOCKED. Intent: force role separation — e.g. the experiment agent must
   * delegate script/test authorship to tool_impl/tool_review sub-agents rather
   * than writing those files directly. Patterns match against project-relative
   * forward-slash paths. The block message is appended so the agent knows why
   * and which sub-agent to spawn instead.
   */
  forbiddenWritePatterns?: { pattern: RegExp; reason: string }[];
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

function wrapRead(
  tool: any,
  cache: FileContextCache,
  projectDir: string,
  allowedReadRoots: string[] | null,
  hooks: SafetyRuntimeHooks | undefined,
) {
  const origExecute = tool.execute;
  return {
    ...tool,
    execute: async (id: string, params: any, signal?: any) => {
      const p = getPathArg(params);

      // Read-scope check: enforced before the underlying tool runs so nothing
      // leaks even through symlinks — we compare resolved absolute paths.
      if (allowedReadRoots && p) {
        const abs = resolve(projectDir, p);
        if (!withinRoots(abs, allowedReadRoots)) {
          const rel = allowedReadRoots.map((r) => r.replace(projectDir + "/", "")).join(", ");
          return blocked(
            `Read of ${p} is outside your allowed scope. ` +
            `You may only read files under: ${rel}. ` +
            `Your task description is the spec — don't hunt literature.`
          );
        }
      }

      const result = await origExecute(id, params, signal);
      if (result?.isError === true) return result;
      if (!p) return result;
      const abs = resolve(projectDir, p);
      const mtime = await safeMtime(abs);
      if (mtime === null) return result;

      const fullRead = !params.offset && !params.limit;
      const at = Date.now();
      const entry: FileContextEntry = {
        mtimeMs: mtime,
        touchedAt: at,
        via: "read",
        content: extractReadContent(result),
      };
      if (!fullRead) {
        const start = params.offset ?? 1;
        const end = params.limit
          ? start + params.limit - 1
          : Number.MAX_SAFE_INTEGER;
        entry.range = { start, end };
      }
      cache.set(abs, entry);
      notifyFileContextEntry(hooks, abs, entry);
      return result;
    },
  };
}

/**
 * Pull the text payload from a pi-coding-agent Read tool result. The tool
 * returns { content: [{ type:"text", text }], details? } (or image blocks
 * for binary files). We only cache text — images get undefined, with the
 * range annotation still set so Phase 3b attachments know this was a read
 * even if content is absent. Strips trailing "[Showing lines X-Y of Z…]"
 * banners the tool adds when truncating — they're for the model, not for
 * cache replay.
 */
function extractReadContent(result: any): string | undefined {
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return undefined;
  for (const b of blocks) {
    if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
      return stripTruncationBanner(b.text);
    }
  }
  return undefined;
}

function stripTruncationBanner(text: string): string {
  // Match the shape that pi-coding-agent's read.js appends on truncation:
  //   "\n\n[Showing lines 1-500 of 1234. Use offset=501 to continue.]"
  // or "\n\n[1234 more lines in file. Use offset=N to continue.]"
  return text.replace(/\n\n\[(?:Showing lines|Line \d+ is |\d+ more lines in file).*?\]\s*$/s, "");
}

function wrapEdit(
  tool: any,
  cache: FileContextCache,
  projectDir: string,
  protectedAbs: Set<string>,
  allowedWriteAbs: string[] | null,
  forbiddenWritePatterns: { pattern: RegExp; reason: string }[],
  hooks: SafetyRuntimeHooks | undefined,
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

      if (allowedWriteAbs && !withinRoots(abs, allowedWriteAbs)) {
        return blocked(allowedWriteMessage(p, allowedWriteAbs, projectDir));
      }

      for (const { pattern, reason } of forbiddenWritePatterns) {
        if (pattern.test(p)) {
          return blocked(`Edit of ${p} is forbidden for this agent. ${reason}`);
        }
      }

      const entry = cache.get(abs);
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
      if (currentMtime > entry.mtimeMs + MTIME_TOLERANCE_MS) {
        return blocked(
          `${p} was modified after you last read it ` +
          `(mtime ${entry.mtimeMs.toFixed(0)} → ${currentMtime.toFixed(0)}). ` +
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

      // Success: bump cache mtime to the new disk mtime so the next edit on
      // the same file (in the same diff region) doesn't trip the mtime check.
      // Also refresh content from disk — params.oldText/newText only describe
      // a patch, not the final file; reading back is the authoritative capture.
      // Size-capped: above FILE_CONTEXT_MAX_ENTRY_BYTES the entry keeps only
      // mtime/range/via with content undefined.
      const newMtime = await safeMtime(abs);
      if (newMtime !== null) {
        const at = Date.now();
        const postContent = await readContentForCache(abs);
        const updated: FileContextEntry = {
          ...entry,
          mtimeMs: newMtime,
          touchedAt: at,
          via: "edit",
          content: postContent,
          // A successful full-file edit means we now know the whole file, not
          // a partial range — drop any prior range flag so Phase 3b treats
          // this as full content.
          range: undefined,
        };
        cache.set(abs, updated);
        notifyFileContextEntry(hooks, abs, updated);
      }
      notifyFileTouched(hooks, abs, "edit");
      return result;
    },
  };
}

/** Read a file's content for caching. Returns undefined above the byte cap. */
async function readContentForCache(absPath: string): Promise<string | undefined> {
  try {
    const stats = await stat(absPath);
    if (stats.size > FILE_CONTEXT_MAX_ENTRY_BYTES) return undefined;
    return await readFile(absPath, "utf-8");
  } catch {
    return undefined;
  }
}

function wrapWrite(
  tool: any,
  cache: FileContextCache,
  projectDir: string,
  protectedAbs: Set<string>,
  allowedWriteAbs: string[] | null,
  opts: SafetyOptions,
  forbiddenWritePatterns: { pattern: RegExp; reason: string }[],
  hooks: SafetyRuntimeHooks | undefined,
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

      if (allowedWriteAbs && !withinRoots(abs, allowedWriteAbs)) {
        return blocked(allowedWriteMessage(p, allowedWriteAbs, projectDir));
      }

      for (const { pattern, reason } of forbiddenWritePatterns) {
        if (pattern.test(p)) {
          return blocked(`Write of ${p} is forbidden for this agent. ${reason}`);
        }
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
      // After successful write, cache considers the file "freshly read" —
      // the agent knows its content because they just wrote it. params.content
      // is the authoritative source; store it (up to the size cap) instead
      // of re-reading disk.
      if (result?.isError !== true) {
        const newMtime = await safeMtime(abs);
        if (newMtime !== null) {
          const written: unknown = params.content;
          const content = typeof written === "string" && written.length <= FILE_CONTEXT_MAX_ENTRY_BYTES
            ? written
            : undefined;
          const entry: FileContextEntry = {
            mtimeMs: newMtime,
            touchedAt: Date.now(),
            via: "write",
            content,
          };
          cache.set(abs, entry);
          notifyFileContextEntry(hooks, abs, entry);
        }
        notifyFileTouched(hooks, abs, "write");
      }
      return result;
    },
  };
}

// Hooks are observers — a throwing telemetry callback must not turn a
// successful disk mutation into a reported tool failure. Swallow and log;
// caller-supplied hooks should already be defensive but this is belt-and-
// suspenders for the mutation path specifically.
function notifyFileTouched(
  hooks: SafetyRuntimeHooks | undefined,
  abs: string,
  via: "write" | "edit",
): void {
  const cb = hooks?.onFileTouched;
  if (!cb) return;
  try {
    cb({ path: abs, via, at: Date.now() });
  } catch (err) {
    console.error(`[safety-wrappers] onFileTouched hook threw: ${(err as any)?.message ?? err}`);
  }
}

function notifyFileContextEntry(
  hooks: SafetyRuntimeHooks | undefined,
  absPath: string,
  entry: FileContextEntry,
): void {
  const cb = hooks?.onFileContextEntry;
  if (!cb) return;
  try {
    cb({ absPath, entry });
  } catch (err) {
    console.error(`[safety-wrappers] onFileContextEntry hook threw: ${(err as any)?.message ?? err}`);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

function createSafetyWrapper(opts: SafetyOptions): SafetyWrapper {
  return (tools, projectDir, templateVars = {}, hooks) => {
    // One cache per wrapper instance — closure-scoped, lives as long as
    // the agent that owns these tool instances. Holds both the enforcement
    // state (mtime, range) and the Phase 3b content-carry-forward payload.
    const cache: FileContextCache = createFileContextCache();
    // Resolve protected files to absolute paths once at construction so the
    // hot path can use exact set membership instead of suffix matching
    // (which would false-positive on names like `evilRESEARCH.md`).
    const protectedAbs = new Set(opts.protectedFiles.map((f) => resolve(projectDir, f)));

    // Any {{VAR}} that isn't substituted remains literal, which resolves to a
    // nonexistent path and fails closed (no reads allowed) — see expandTemplate.
    const allowedReadAbs = resolveScopeRoots(opts.allowedReadRoots, projectDir, templateVars);
    const allowedWriteAbs = resolveScopeRoots(opts.allowedWriteRoots, projectDir, templateVars);

    const forbiddenWritePatterns = opts.forbiddenWritePatterns ?? [];

    return tools.map((tool: any) => {
      if (tool.name === "read")  return wrapRead(tool, cache, projectDir, allowedReadAbs, hooks);
      if (tool.name === "edit")  return wrapEdit(tool, cache, projectDir, protectedAbs, allowedWriteAbs, forbiddenWritePatterns, hooks);
      if (tool.name === "write") return wrapWrite(tool, cache, projectDir, protectedAbs, allowedWriteAbs, opts, forbiddenWritePatterns, hooks);
      return tool;
    });
  };
}

function withinRoots(abs: string, roots: string[]): boolean {
  return roots.some((root) => abs === root || abs.startsWith(root + "/"));
}

// Any {{VAR}} that isn't substituted remains literal, which resolves to a
// nonexistent path and fails closed — see expandTemplate in utils.ts.
function resolveScopeRoots(
  roots: string[] | undefined,
  projectDir: string,
  templateVars: Record<string, string>,
): string[] | null {
  if (!roots) return null;
  return roots.map((r) => resolve(projectDir, expandTemplate(r, templateVars)));
}

function allowedWriteMessage(p: string, roots: string[], projectDir: string): string {
  const rel = roots.map((r) => r.replace(projectDir + "/", "")).join(", ");
  return (
    `Write/edit of ${p} is outside your allowed write scope. ` +
    `You may only write under: ${rel}.`
  );
}

// ── Universal declarative entry point ───────────────────────────────────
//
// Called by buildAgentFromDefinition with the `.md`-declared SafetyConfig.
// Preset names are expanded against SAFETY_PRESETS; `{{VAR}}` placeholders
// inside presets, protectedFiles, and allowedReadRoots are expanded by the
// underlying createSafetyWrapper at wrap time against the spawn's templateVars.

export function buildSafetyWrapper(
  config: SafetyConfig | undefined,
): SafetyWrapper | undefined {
  if (!config) return undefined;

  // Preset names have already been validated at parse time (see buildSafetyConfig
  // in registry.ts). Unknown names here silently contribute no paths rather than
  // double-logging the same error.
  const presetPaths = (config.presets ?? []).flatMap((name) =>
    SAFETY_PRESETS[name as keyof typeof SAFETY_PRESETS] ?? [],
  );

  return createSafetyWrapper({
    protectedFiles: [...presetPaths, ...(config.protectedFiles ?? [])],
    allowedReadRoots: config.allowedReadRoots,
    allowedWriteRoots: config.allowedWriteRoots,
    // Default "block" is fail-secure: forgetting the field in frontmatter
    // shouldn't silently relax write-overwrite on protected files.
    writeOnExistingPolicy: config.writeOnExistingPolicy ?? "block",
  });
}

