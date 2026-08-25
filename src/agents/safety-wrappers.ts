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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findOldTextLine, freshExcerptError } from "./edit-recovery.js";
import { SAFETY_PRESETS } from "./safety-presets.js";
import { expandTemplate, extractTextContent } from "../utils.js";
import { reportIntegrityIssues } from "../tools/report-integrity.js";
import { buildClaimRegistry, nearestKeys } from "../claims-registry.js";
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
   * If set, bash commands that appear to write (redirect, heredoc via `>`,
   * `tee`, `cp`/`mv`, `touch`, `sed -i`, inline `open(..., "w")`, or
   * `writeFileSync`) to any path under these prefixes are blocked at
   * wrap time. Guards against agents bypassing `allowedWriteRoots` via
   * bash. Not airtight against variable-substitution evasion, but closes
   * the "lazy bypass" path LLMs reach for first. Supports `{{VAR}}`.
   */
  blockedBashWriteRoots?: string[];
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

// `.agent/` holds studio's authoritative state: run.pid, usage.log,
// checkpoint.jsonl, conversations/, active-agents.json, etc. Sisyphus
// itself writes these through internal in-process fs calls that DON'T
// pass through the agent's tool wrappers, so a hard tool-level lock here
// doesn't interfere with normal bookkeeping.
//
// Without this lock, a prompt-injected agent can `rm .agent/usage.log` to
// reset its recorded spend, or rewrite run.pid to evade the budget watcher.
// Studio has its own monotonic spend-floor + RUN_REGISTRY in-memory authority
// as backstops, but blocking at this layer closes the attack at the cheapest
// possible point.
const SYSTEM_RESERVED_DIR = ".agent";

function isSystemReserved(abs: string, projectDir: string): boolean {
  const target = resolve(projectDir, SYSTEM_RESERVED_DIR);
  return abs === target || abs.startsWith(target + "/");
}

// ── Credential-exfiltration guards ────────────────────────────────────────
//
// Tools (read/edit/write/bash) run as the same OS user as the studio, so
// without explicit denylisting they can reach any file in $HOME. Credential
// stores are the highest-value exfil target: read auth.json, key lands in
// the tool result → committed to checkpoint.jsonl + log.jsonl → if studio
// later surfaces those files (e.g. via a project-files endpoint) or they
// get rsync'd / backed up, the key escapes.
//
// Two-layer defense:
//   1. Block read/edit/write of credential paths by absolute prefix.
//   2. Block bash commands whose text references those paths or any known
//      key env var name. Substring match — easy to bypass with creative
//      shell, but stops the obvious cases (cat / head / tail / xxd / printenv).
//
// Also strips API key env vars from process.env at brain startup
// (src/index.ts), so even `printenv | grep KEY` returns nothing — the
// keys are loaded once via the auth.json fallback and live in pi-agent-core's
// memory, not the child env.
const CREDENTIAL_PATH_SUFFIXES = [
  "/.sisyphus/auth.json",
  "/.codex/auth.json",
  "/.codex/config.json",
  "/.config/codex/auth.json",
  "/.config/anthropic/auth.json",
  "/.aws/credentials",
  "/.netrc",
  "/.ssh/id_rsa",
  "/.ssh/id_ed25519",
];

function isCredentialPath(abs: string): boolean {
  for (const suffix of CREDENTIAL_PATH_SUFFIXES) {
    if (abs.endsWith(suffix)) return true;
  }
  return false;
}

// Substrings that, if present in a bash command, indicate a credential
// access attempt. Match either an explicit path fragment or a known env
// var name (covers `printenv DEEPSEEK_API_KEY`, `echo $ANTHROPIC_API_KEY`,
// `env | grep KEY`, etc.).
const CREDENTIAL_BASH_PATTERNS: RegExp[] = [
  /\.sisyphus\/auth\.json/,
  /\.codex\/(auth|config)\.json/,
  /\.config\/codex\/auth\.json/,
  /\.config\/anthropic\/auth\.json/,
  /\.aws\/credentials/,
  /\.netrc\b/,
  /\.ssh\/id_(rsa|ed25519|dsa|ecdsa)\b/,
  /\b(ANTHROPIC|DEEPSEEK|KIMI|MOONSHOT|OPENAI|GEMINI|GROQ)_API_KEY\b/,
  /\bAWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/,
  /\bGITHUB_(TOKEN|PAT)\b/,
];

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

      // Credential-exfil block (always-on, runs before any other gate).
      if (p) {
        const abs = resolve(projectDir, p);
        if (isCredentialPath(abs)) {
          return blocked(
            `Read of ${p} is denied: this path stores credentials and is ` +
            `unconditionally protected. The agent's API keys are loaded by ` +
            `pi-agent-core internally and never need to be read by tools.`
          );
        }
      }

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

/**
 * Write-time validation: run the finish gate's own validators the moment a
 * provenance artifact is written, and hand the findings back in the SAME tool
 * result — while the writing agent still has the context to fix them.
 *
 * Why here and not only at finish(): the enforcement chokepoint was the
 * architecture bug. 29 "Cannot finish" checks + 16 blocking integrity issues
 * all fired hours after the mistake, at compaction-degraded context — the
 * observation corpus is 67% finish-gate livelock. The finish gate stays as
 * the backstop; this makes it almost never the first to fire.
 *
 * Scope: report/claims.json (claim-grade legality, headline coverage) and
 * data/experiments/<id>/runs/<n>/results.json (cross-validation integrity, plan
 * closure). Feedback is appended, never blocking — the write has happened;
 * the point is immediacy, not another wall.
 */
function writeTimeValidation(projectDir: string, relPath: string, result: any): any {
  const isClaims = /(^|\/)report\/claims\.json$/.test(relPath);
  const isResults = /(^|\/)data\/experiments\/[^/]+\/runs\/[^/]+\/results\.json$/.test(relPath);
  if (!isClaims && !isResults) return result;
  let issues: { blocking: boolean; text: string }[] = [];
  try {
    issues = reportIntegrityIssues(projectDir);
  } catch { return result; }
  const relevant = issues.filter((i) => i.blocking && (
    isClaims ? (/claims\.json/.test(i.text) || /wrong claim_key/.test(i.text))
             : /[Cc]ross-validation/.test(i.text)
  ));
  // Registry membership — the prevention half of the claim-registry design.
  // The finish gates only see the CONSEQUENCE of an invented key (no xval
  // ever matches, grade caps at indicative, 5f hunts by value); this names
  // the invention itself, at the write, with the nearest legal spellings.
  const keyProblems: string[] = [];
  try {
    const registry = buildClaimRegistry(projectDir);
    const known = new Set(registry.map((r) => r.key));
    if (isClaims && known.size > 0) {
      const cj = JSON.parse(readFileSync(resolve(projectDir, relPath), "utf-8"));
      for (const c of (Array.isArray(cj) ? cj : [])) {
        const k = c?.claim_key ? String(c.claim_key) : "";
        if (k && !known.has(k)) {
          const near = nearestKeys(k, registry);
          keyProblems.push(`claim_key "${k}" is not in the claim registry — keys are PICKED from ` +
            `<claim_registry>, never invented.${near.length ? ` Nearest: ${near.join(", ")}` : ""} ` +
            `If this number is not an experiment result, drop claim_key and source it from the literature.`);
        }
      }
    }
    if (isResults) {
      const j = JSON.parse(readFileSync(resolve(projectDir, relPath), "utf-8"));
      const computed = j?.computed ?? {};
      const own = new Set(registry.map((r) => r.key));
      for (const field of ["cross_validation", "cross_validation_plan"]) {
        for (const x of (Array.isArray(computed[field]) ? computed[field] : [])) {
          const k = x && typeof x === "object" && x.claim_key ? String(x.claim_key) : "";
          if (!k) { keyProblems.push(`${field} entry with missing/empty claim_key — every entry names the computed.* leaf it validates.`); continue; }
          if (!own.has(k)) {
            const near = nearestKeys(k, registry);
            keyProblems.push(`${field} claim_key "${k}" names no computed.* leaf in any results.json — ` +
              `a control filed under a phantom key is credit lost at the join.${near.length ? ` Nearest: ${near.join(", ")}` : ""}`);
          }
        }
      }
    }
  } catch { /* unparsable file — the schema gates already speak to that */ }
  if (relevant.length === 0 && keyProblems.length === 0) return result;
  const feedback = `\n\n[write-time validation of ${relPath} — fix NOW, while you have the context; ` +
    `these same checks block finish() later]\n` +
    [...keyProblems.map((t) => `- ${t}`),
     ...relevant.map((i) => `- ${i.text.split("\n").slice(0, 6).join("\n  ")}`)].join("\n");
  const content = Array.isArray(result?.content) ? result.content : [];
  return { ...result, content: [...content, { type: "text", text: feedback }] };
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
      const newText = String(params.newText ?? "");

      if (isCredentialPath(abs)) {
        return blocked(
          `Edit of ${p} is denied: credential paths are unconditionally protected.`
        );
      }

      // Reject no-op edits before fuzzy matching. Without this guard, the
      // underlying edit tool runs fuzzyFindText against text that may not
      // even exist, returns "no changes made", and the agent burns turns
      // retrying with stranger oldText values instead of recognising the
      // append-via-edit antipattern.
      if (oldText === newText) {
        // Quote the identical payload back. Observed live (297nm run,
        // 2026-08-25): a deepseek tool_review sent identical 4-char strings,
        // could not see its own slip from the bare "oldText === newText"
        // message, spent turns concluding the TOOL was broken, and wrote
        // "the edit tool is broken (spurious no-op)" into the ledger's
        // Limitations. Showing the exact payload turns that spiral into a
        // one-turn recovery.
        const quoted = String(oldText).length <= 120
          ? `Both were exactly: ${JSON.stringify(String(oldText))}. `
          : `Both begin: ${JSON.stringify(String(oldText).slice(0, 100))}… (${String(oldText).length} chars, byte-identical). `;
        return blocked(
          `No-op edit on ${p}: you sent oldText and newText that are IDENTICAL. ` +
          quoted +
          `This is a slip in the call you emitted, not a tool fault — the tool is fine. ` +
          `Re-issue with newText containing your intended change. ` +
          `If you meant to append, read the file first and use a real anchor line as oldText. ` +
          `If no change is intended, skip the call. Do NOT record this as a tool bug.`
        );
      }

      if (isSystemReserved(abs, projectDir)) {
        return blocked(
          `${p} is under .agent/ which is studio-reserved (run state, usage logs, ` +
          `checkpoint, conversations). These files are written by studio internals, ` +
          `not by tools. Do not edit them.`
        );
      }
      if (protectedAbs.has(abs)) {
        return blocked(
          `${p} is protected by this agent's safety configuration ` +
          `(frontmatter \`protectedFiles\`). The protection documents WHO owns ` +
          `the write, not whether the write happens. To revise this file, ` +
          `re-spawn the agent that owns it with a revision directive — e.g. for ` +
          `experiment-authored files: \`spawn_agent(agent="experiment", ` +
          `task="revise L2.X: <correction verbatim>", ` +
          `templateVars={EXPERIMENT_ID: "E{N}_..."})\`. ` +
          `Do not cite this block as a reason to skip the work.`
        );
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
      if (result?.isError !== true) return writeTimeValidation(projectDir, p, result);
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

      if (isCredentialPath(abs)) {
        return blocked(
          `Write of ${p} is denied: credential paths are unconditionally protected.`
        );
      }

      if (isSystemReserved(abs, projectDir)) {
        return blocked(
          `${p} is under .agent/ which is studio-reserved (run state, usage logs, ` +
          `checkpoint, conversations). These files are written by studio internals, ` +
          `not by tools. Do not write them.`
        );
      }
      if (protectedAbs.has(abs)) {
        return blocked(
          `${p} is protected by this agent's safety configuration ` +
          `(frontmatter \`protectedFiles\`). The protection documents WHO owns ` +
          `the write, not whether the write happens. To revise this file, ` +
          `re-spawn the agent that owns it with a revision directive — e.g. for ` +
          `experiment-authored files: \`spawn_agent(agent="experiment", ` +
          `task="revise L2.X: <correction verbatim>", ` +
          `templateVars={EXPERIMENT_ID: "E{N}_..."})\`. ` +
          `Do not cite this block as a reason to skip the work.`
        );
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
      if (result?.isError !== true) return writeTimeValidation(projectDir, p, result);
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

// ── Bash command filter ─────────────────────────────────────────────────
//
// The write/edit wrappers enforce allowedWriteRoots. Without a matching bash
// filter, an agent can bypass by using `cat > path`, `tee path`, `python -c
// "open(path, 'w')"`, etc. This wrapper regex-scans the command before
// execution and rejects if any extracted write-target falls under a blocked
// prefix. Not airtight against variable-substitution or encoded payloads,
// but catches the straightforward evasion patterns LLMs reach for first.

const BASH_WRITE_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  // Shell redirect: `> path`, `>> path`, `2> path` (group 1 = target)
  { re: /(?:^|[\s;&|(`])\d*\s*>>?\s*['"]?([^\s'"<>;&|`()]+)/g, kind: "redirect" },
  // tee / tee -a path
  { re: /\btee\b\s+(?:-[a-zA-Z]+\s+)*['"]?([^\s'"<>;&|`()]+)/g, kind: "tee" },
  // cp / mv / rsync — capture LAST positional arg (handles multi-source:
  // `cp a b c destdir` as well as `cp src dst`). `install` is handled
  // separately with a `/` constraint to avoid `apt install stim` false positives.
  { re: /\b(?:cp|mv|rsync)\b(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*\s+(?:\S+\s+)+?(['"]?[^\s'"<>;&|`()]+['"]?)(?=\s*(?:$|[;&|)]))/gm, kind: "cp/mv/rsync (last arg)" },
  // install src dst — require `/` in target to avoid matching package
  // manager invocations (`apt install X`, `pip install Y`).
  { re: /\binstall\b(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*\s+(?:\S+\s+)+?(['"]?[^\s'"<>;&|`()]*\/[^\s'"<>;&|`()]*['"]?)(?=\s*(?:$|[;&|)]))/gm, kind: "install" },
  // touch path
  { re: /\btouch\b\s+(?:-[a-zA-Z]+\s+)*['"]?([^\s'"<>;&|`()]+)/g, kind: "touch" },
  // dd of=path
  { re: /\bdd\b[^|;&\n]*?\bof=['"]?([^\s'"<>;&|`()]+)/g, kind: "dd of=" },
  // sed -i … path   (terminal path on the line)
  { re: /\bsed\b\s+(?:--in-place|-i)\b[^|;&\n]*?(?:^|\s)['"]?([^\s'"<>;&|`()]+)(?=\s*(?:$|[;&|]))/gm, kind: "sed -i" },
  // python / any-language inline open(path, 'w|a|x')
  { re: /open\s*\(\s*['"]([^'"]+)['"][^)]*['"][wax][a-z+]?['"][^)]*\)/g, kind: "open(w/a/x)" },
  // pathlib Path(...).write_text / write_bytes
  { re: /Path\s*\(\s*['"]([^'"]+)['"][^)]*\)\s*\.write_(?:text|bytes)\s*\(/g, kind: "Path.write_text/bytes" },
  // node fs.writeFileSync(path, …)
  { re: /\.writeFileSync?\s*\(\s*['"]([^'"]+)['"]/g, kind: "writeFileSync" },
  // rm / rmdir / unlink — captures the first non-flag positional. Multi-
  // target rm (e.g. `rm a b c`) only catches `a` here, but the catch-all
  // DESTRUCTIVE_WITH_AGENT check below covers the multi-arg / find -delete
  // / chflags-style bypasses.
  { re: /\b(?:rm|rmdir|unlink)\b(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*\s+(['"]?[^\s'"<>;&|`()]+['"]?)/g, kind: "rm/unlink" },
];

// Catch-all: any command that combines a destructive verb with a `.agent/`
// path segment is blocked, regardless of arg structure. Closes:
//   - multi-arg rm:  `rm foo.txt .agent/usage.log`  (per-pattern extracts only first)
//   - find -delete:  `find .agent -delete`
//   - attribute-strip then delete: `chflags nouappnd .agent/usage.log; rm ...`
//   - shell substitution / variable expansion that hides the literal target
const DESTRUCTIVE_VERB_RE = /\b(?:rm|rmdir|unlink|chflags\s+(?:no)?(?:u|s)appnd|chattr\s+[+-]a|find\b[^|;&\n]*?-delete)\b/;
const AGENT_PATH_RE = /(?:^|[\s/="'`(:])\.agent(?:\/|$|[\s'"`)])/;

function extractBashWriteTargets(cmd: string): Array<{ target: string; kind: string }> {
  const hits: Array<{ target: string; kind: string }> = [];
  for (const { re, kind } of BASH_WRITE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd)) !== null) {
      // Strip surrounding quotes that some patterns include in the capture
      // group (e.g. the cp/mv/rsync last-arg regex). Downstream comparison
      // is simpler if targets are always bare paths.
      const target = (m[1] ?? "").replace(/^['"]|['"]$/g, "");
      if (!target) continue;
      if (target.startsWith("/dev/")) continue;
      if (/^&\d+$/.test(target)) continue;
      hits.push({ target, kind });
    }
  }
  return hits;
}

function bashTargetHitsBlockedRoot(target: string, blockedRelPrefixes: string[]): string | null {
  for (const prefix of blockedRelPrefixes) {
    // Strip leading `./` for normalized comparison.
    const t = target.replace(/^\.\//, "");
    if (t === prefix.replace(/\/$/, "")) return prefix;
    if (t.startsWith(prefix)) return prefix;
    // Handles cases like "subdir/data/experiments/..." when agent `cd`d first,
    // by looking for the prefix as an interior substring. Over-matches are
    // safer than under-matches here — any legitimate collision would itself
    // be a violation (the path genuinely names the blocked root).
    if (t.includes("/" + prefix)) return prefix;
  }
  return null;
}

/**
 * A bash-extracted write target is "in-project" if it resolves under
 * projectDir. Paths outside (e.g. /tmp, /var, /dev/null, absolute paths
 * to user's home) are treated as out-of-scope — bash to scratch dirs
 * is legitimate, not an architectural-boundary concern.
 *
 * This heuristic resolves the target against projectDir. It does NOT
 * track `cd X && ...` within the command, so a command like
 * `cd subdir && cat > foo.py` will resolve `foo.py` as projectDir/foo.py
 * instead of projectDir/subdir/foo.py. Acceptable for the attack model
 * (LLMs typically write full project-relative paths); document the
 * limitation in the wrapper's jsdoc.
 */
function resolveBashTarget(target: string, projectDir: string): string | null {
  if (!target) return null;
  // Strip surrounding quotes if any
  const clean = target.replace(/^['"]|['"]$/g, "");
  if (!clean) return null;
  const abs = resolve(projectDir, clean);
  return abs;
}

function wrapBash(
  tool: any,
  projectDir: string,
  allowedWriteAbs: string[] | null,
  blockedRootsAbs: string[] | null,
): any {
  // `.agent/` is ALWAYS in the effective blocklist — studio-reserved,
  // not driven by frontmatter. Means we always wrap (no early return),
  // and even agents with no other blocklist still get .agent protection.
  const reservedAbs = resolve(projectDir, SYSTEM_RESERVED_DIR);
  const effectiveBlocked: string[] = [reservedAbs, ...(blockedRootsAbs ?? [])];
  const hasAllowlist = allowedWriteAbs !== null && allowedWriteAbs.length > 0;

  const blockedRelPrefixes = effectiveBlocked.map((r) => {
    const rel = r.startsWith(projectDir + "/") ? r.slice(projectDir.length + 1) : r;
    return rel.endsWith("/") ? rel : rel + "/";
  });

  const origExecute = tool.execute;
  return {
    ...tool,
    execute: async (id: string, params: any, signal?: any) => {
      const cmd: string = typeof params?.command === "string" ? params.command : "";

      // PATH-directory mutation: no agent may create/modify executables in
      // directories that appear on PATH. 2026-07-05 root cause: a fixer agent
      // "fixed" a compile problem by planting xelatex→lualatex shim scripts
      // in node_modules/.bin and ~/bin — a persistent, cross-project
      // environment poisoning that shipped mojibake PDFs for three days and
      // was invisible to every gate (exit codes stayed 0). Infrastructure
      // mutation is a human/ops action, never a fix an agent applies.
      if (/(?:>|>>|\btee\b|\bcp\b|\bmv\b|\binstall\b|\bln\b|\bchmod\b)[^;|&]*(?:node_modules\/\.bin|(?:~|\$HOME|\/Users\/[^/]+|\/home\/[^/]+)\/(?:\.local\/)?bin\b|\/usr\/(?:local\/)?s?bin\b)/.test(cmd)) {
        return blocked(
          "bash command appears to write into a PATH directory (node_modules/.bin, ~/bin, " +
          "/usr/local/bin, ...). Agents must never create or modify executables on PATH — " +
          "a planted engine shim poisoned every later run's compiles for days. If a binary " +
          "is genuinely missing or broken, report it via your final message or " +
          "escalate_authority_bound; installing/patching system tools is a human action."
        );
      }

      // Hand-compile bypass: LaTeX engines are blocked in EVERY agent's bash,
      // not just the brain's hooks. 2026-07-05: after the brain-level hook
      // shipped, the PI reviewer sub-agents kept hand-running lualatex during
      // audits (6 reviewer sessions), re-polluting report.log and re-shipping
      // a 4469-missing-glyph mojibake PDF — sub-agent bash never passes
      // through brain hooks, only through this wrapper. compile_latex is the
      // single-source compile path (xelatex for CJK, guards, verdict).
      if (/\b(?:lualatex|luahbtex|xelatex|pdflatex|latexmk)\b/.test(cmd)) {
        return blocked(
          "Direct LaTeX engine invocation is not allowed from any agent's bash. " +
          "Compiling is the brain's job via the compile_latex tool (it selects xelatex " +
          "for CJK sources; lualatex silently drops every CJK glyph and pollutes " +
          "report.log). If you need a fresh PDF, report that need back to the brain " +
          "instead of compiling yourself."
        );
      }

      // Credential-exfil: refuse any bash command that mentions a known
      // credential path or env-var name. Substring match — bypass-able with
      // creative shell quoting / dynamic indirection, but stops the obvious
      // cases (cat / head / tail / xxd / printenv / `env | grep KEY`).
      for (const pat of CREDENTIAL_BASH_PATTERNS) {
        if (pat.test(cmd)) {
          return blocked(
            `bash command references a credential path or API-key env var ` +
            `(matched ${pat.source}). These paths/vars are off-limits — the agent's ` +
            `keys live in pi-agent-core's memory and never need to be read by tools.`
          );
        }
      }

      // Catch-all: destructive verb + .agent/ path segment in the same command.
      // This blocks the bypasses that single-target regex extraction misses
      // (multi-arg rm, find -delete, attribute strips before delete).
      if (DESTRUCTIVE_VERB_RE.test(cmd) && AGENT_PATH_RE.test(cmd)) {
        return blocked(
          `bash command contains a destructive op targeting .agent/ which is ` +
          `studio-reserved (run state, usage logs). These paths cannot be ` +
          `removed or modified by tools — Sisyphus internals manage them.`
        );
      }

      const hits = extractBashWriteTargets(cmd);

      for (const { target, kind } of hits) {
        // 1. Blocklist check (substring match on project-relative prefix —
        //    catches both "data/experiments/..." and "./data/experiments/..."
        //    and `cd X && > data/experiments/...` since it's a pure-string scan).
        //    Always-on entries: .agent/. Plus any frontmatter blockedBashWriteRoots.
        const match = bashTargetHitsBlockedRoot(target, blockedRelPrefixes);
        if (match) {
          return blocked(
            `bash command attempts to ${kind} to "${target}" under protected path "${match}". ` +
            `This path is studio-reserved or restricted by your safety config. ` +
            `Delegate via spawn_agent to the appropriate sub-agent if you need to write there.`,
          );
        }

        // 2. Allowlist check: for in-project targets, require match against
        //    allowedWriteRoots. Out-of-project targets (/tmp, /var, absolute
        //    paths outside projectDir) are permitted — bash to scratch dirs
        //    is legitimate. This catches the bypass class "bash writes to
        //    a project path outside the agent's declared write scope."
        if (hasAllowlist) {
          const abs = resolveBashTarget(target, projectDir);
          if (abs === null) continue;
          const inProject = abs === projectDir || abs.startsWith(projectDir + "/");
          if (inProject && !withinRoots(abs, allowedWriteAbs!)) {
            return blocked(
              `bash command attempts to ${kind} to "${target}" which is outside this agent's allowed write scope. ` +
              allowedWriteMessage(target, allowedWriteAbs!, projectDir),
            );
          }
        }
      }
      return origExecute(id, params, signal);
    },
  };
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
    const blockedBashAbs = resolveScopeRoots(opts.blockedBashWriteRoots, projectDir, templateVars);

    const forbiddenWritePatterns = opts.forbiddenWritePatterns ?? [];

    return tools.map((tool: any) => {
      if (tool.name === "read")  return wrapRead(tool, cache, projectDir, allowedReadAbs, hooks);
      if (tool.name === "edit")  return wrapEdit(tool, cache, projectDir, protectedAbs, allowedWriteAbs, forbiddenWritePatterns, hooks);
      if (tool.name === "write") return wrapWrite(tool, cache, projectDir, protectedAbs, allowedWriteAbs, opts, forbiddenWritePatterns, hooks);
      if (tool.name === "bash")  return wrapBash(tool, projectDir, allowedWriteAbs, blockedBashAbs);
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
    blockedBashWriteRoots: config.blockedBashWriteRoots,
    // Default "block" is fail-secure: forgetting the field in frontmatter
    // shouldn't silently relax write-overwrite on protected files.
    writeOnExistingPolicy: config.writeOnExistingPolicy ?? "block",
  });
}

