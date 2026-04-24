/**
 * Phase 3b — carry-forward attachments injected into the ContextPacker's
 * rebuild step after a successful compact.
 *
 * Attachments are the "what was true at the time of the cut" signal that
 * survives the summary's lossy compression. Three kinds for now:
 *
 *   1. Recent files the agent touched (from Phase 3a FileContextCache).
 *   2. Authoritative artifacts (plan.md, memory.md, methodology.md) read
 *      from disk at compact time — independent of summary fidelity.
 *   3. (Future) restored sub-agent state, skill contents, etc.
 *
 * Engine insertion order (engine.ts: rebuild step):
 *   [carryforward, ...preamble, ...attachments, ...retained]
 *
 * carryforward + preamble describe the compact itself; attachments describe
 * recovered context. Putting attachments between them keeps the compact
 * marker adjacent to its summary without visually separating them from
 * the user's preserved tail.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { FileContextCache, FileContextEntry } from "../agents/file-context-cache.js";

/**
 * Concrete message shape producers emit. Engine casts to the generic
 * TMessage type of the active ContextPacker — compatible with
 * BlockConversationMessage because extra fields (`kind`, `isMeta`) are
 * allowed by its `[key: string]: unknown` index signature.
 */
export interface AttachmentMessage {
  role: "user";
  content: string;
  /**
   * Marker so Phase 3b dedup + renderers can distinguish attachment
   * categories without string-matching the body. Kinds are structural,
   * not instructional — keep them stable.
   */
  kind: "recent_files" | "authoritative_artifact";
  /** Path this attachment represents, for dedup across providers. */
  sourcePath?: string;
  /** Hide from UI timelines if renderer supports isMeta filtering. */
  isMeta: true;
  timestamp: number;
}

export interface AttachmentContext {
  trigger: "automatic" | "manual";
  removedCount: number;
}

export type AttachmentProvider<TMessage = any> = (
  ctx: AttachmentContext,
) => TMessage[] | Promise<TMessage[]>;

// ── Recent files ──────────────────────────────────────────────────────────

export interface RecentFilesProviderOptions {
  /** Maximum number of files to include in the attachment. Default: 5. */
  maxFiles?: number;
  /** Per-file byte cap for the rendered body. Default: 5000. */
  maxBytesPerFile?: number;
  /**
   * Paths to exclude — typically the authoritative artifacts list so
   * those go through their own provider without double-injection.
   */
  excludePaths?: Iterable<string>;
  /** Project directory for rendering file paths relative to the root. */
  projectDir: string;
}

/**
 * Build an attachment with the contents of the N most-recently-touched
 * files from the cache. Reads the cache at call time — providers run
 * once per compact, so this cost is amortized over many agent turns.
 */
export function createRecentFilesProvider(
  cache: FileContextCache,
  opts: RecentFilesProviderOptions,
): AttachmentProvider<AttachmentMessage> {
  const maxFiles = opts.maxFiles ?? 5;
  const maxBytesPerFile = opts.maxBytesPerFile ?? 5_000;
  const excluded = new Set(opts.excludePaths ?? []);

  return async () => {
    const snapshot = cache.snapshot();
    if (snapshot.size === 0) return [];

    const candidates: Array<{ path: string; entry: FileContextEntry }> = [];
    for (const [path, entry] of snapshot) {
      if (excluded.has(path)) continue;
      candidates.push({ path, entry });
    }
    if (candidates.length === 0) return [];

    // Most recently touched wins. Ties broken by insertion order (stable
    // sort preserves Map's insertion semantics).
    candidates.sort((a, b) => b.entry.touchedAt - a.entry.touchedAt);
    const selected = candidates.slice(0, maxFiles);

    const sections: string[] = [];
    for (const { path, entry } of selected) {
      const rel = relative(opts.projectDir, path) || path;
      const header = `### ${rel}${entry.range ? ` (lines ${entry.range.start}–${entry.range.end})` : ""} [via=${entry.via}]`;

      if (!entry.content) {
        sections.push(`${header}\n\n_(cached without content — file above ${50_000} bytes when touched; re-read to view)_`);
        continue;
      }
      const trimmed = entry.content.length > maxBytesPerFile
        ? entry.content.slice(0, maxBytesPerFile) + "\n…[truncated for attachment]"
        : entry.content;
      sections.push(`${header}\n\n\`\`\`\n${trimmed}\n\`\`\``);
    }

    const body =
      `<recent_files count="${selected.length}" reason="post-compact-carry-forward">\n\n` +
      `These are the ${selected.length} most recently read/written/edited files from before compaction. ` +
      `Their content is snapshot at touch time — re-read before editing if you need a guaranteed-fresh view.\n\n` +
      sections.join("\n\n") +
      `\n\n</recent_files>`;

    return [{
      role: "user",
      content: body,
      kind: "recent_files",
      isMeta: true,
      timestamp: Date.now(),
    }];
  };
}

// ── Authoritative artifacts (plan / memory / methodology) ────────────────

export interface AuthoritativeArtifactTier {
  /** Project-relative path. */
  path: string;
  /**
   * Inclusion policy:
   *   "always"         — always included when the file exists.
   *   { truncateTo: N } — included truncated to N bytes (head + tail with
   *                       a marker in the middle).
   */
  policy: "always" | { truncateTo: number };
}

export const DEFAULT_AUTHORITATIVE_ARTIFACTS: AuthoritativeArtifactTier[] = [
  { path: "notes/plan.md", policy: "always" },
  { path: "notes/memory.md", policy: "always" },
  { path: "notes/methodology.md", policy: { truncateTo: 8_000 } },
  { path: "notes/literature.md", policy: { truncateTo: 6_000 } },
  { path: "notes/experiments.md", policy: { truncateTo: 6_000 } },
];

export interface AuthoritativeArtifactsProviderOptions {
  projectDir: string;
  tiers?: AuthoritativeArtifactTier[];
}

/**
 * Read plan/memory/methodology/etc. from disk at compact time and insert
 * them as attachment messages — independent of summary fidelity, so the
 * agent's plan never gets compressed into "user wanted to do stuff".
 *
 * Known limitation (non-blocker): this provider does NOT currently check
 * whether the brain-level snapshot (src/context.ts buildSemiStaticSystemLayer
 * / research_snapshot trailer) already includes the same path. For agents
 * where both mechanisms fire — mostly the brain itself today, though it
 * uses buildContextTransformer rather than buildAgentFromDefinition — this
 * means methodology.md / literature.md / experiments.md can appear both
 * in the snapshot and in the carry-forward attachment after compact. Impact
 * is token redundancy (bounded by the truncateTo tiers), not correctness.
 * A future optimization could dedup by comparing the attachment's sourcePath
 * against a list of paths the snapshot is known to cover.
 */
export function createAuthoritativeArtifactsProvider(
  opts: AuthoritativeArtifactsProviderOptions,
): AttachmentProvider<AttachmentMessage> {
  const tiers = opts.tiers ?? DEFAULT_AUTHORITATIVE_ARTIFACTS;

  return async () => {
    const attachments: AttachmentMessage[] = [];

    for (const tier of tiers) {
      const absPath = join(opts.projectDir, tier.path);
      if (!existsSync(absPath)) continue;

      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }
      if (content.length === 0) continue;

      if (typeof tier.policy === "object") {
        const cap = tier.policy.truncateTo;
        if (content.length > cap) {
          // Head + tail with elision marker; callers can spot either half
          // by position. Use 70/30 split biased toward the head (intros
          // and current-state sections tend to cluster at file top).
          const headSize = Math.floor(cap * 0.7);
          const tailSize = cap - headSize - 50;
          content =
            content.slice(0, headSize) +
            `\n\n…[truncated ${content.length - cap} chars — re-read file for full view]…\n\n` +
            content.slice(-tailSize);
        }
      }

      let mtimeMs = 0;
      try { mtimeMs = statSync(absPath).mtimeMs; } catch {}

      attachments.push({
        role: "user",
        content:
          `<authoritative path="${tier.path}" mtime="${new Date(mtimeMs).toISOString()}">\n\n` +
          content +
          `\n\n</authoritative>`,
        kind: "authoritative_artifact",
        sourcePath: absPath,
        isMeta: true,
        timestamp: Date.now(),
      });
    }

    return attachments;
  };
}

/**
 * Collect the set of absolute paths that will be injected by an
 * authoritative-artifacts provider. Useful for RecentFilesProviderOptions.
 * excludePaths so the same file doesn't show up twice.
 */
export function listAuthoritativeArtifactPaths(
  projectDir: string,
  tiers: AuthoritativeArtifactTier[] = DEFAULT_AUTHORITATIVE_ARTIFACTS,
): string[] {
  return tiers.map(t => join(projectDir, t.path));
}
