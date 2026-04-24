/**
 * File context cache — session-scoped record of files the agent has read,
 * written, or edited, along with (optional) current content for compaction
 * carry-forward. Upgrade of the read-only tracker previously embedded in
 * safety-wrappers.ts.
 *
 * Phase 3a introduces this structure; Phase 3b wires a cache snapshot into
 * the ContextPacker's rebuild step so recent-file content can be re-attached
 * after a compact without the model having to re-read every file. Phase 3a
 * itself does not touch compaction — it only ensures the wrapper produces
 * a well-shaped cache + fires onFileContextEntry hooks so external consumers
 * (Phase 3b aggregators, observability, etc.) can subscribe.
 *
 * Ownership: each buildSafetyWrapper() invocation creates its own cache
 * instance inside the wrapper closure. Per-agent lifetime, never shared
 * across agents (clean-context principle — sub-agent sees only its own
 * touch history).
 */

/**
 * A single file's cache entry. Per-path, not per-touch: the latest
 * read/write/edit overwrites the prior record, so the map grows with the
 * number of distinct files touched, not with operation count.
 */
export interface FileContextEntry {
  /**
   * File content at the moment of the cached operation, capped at
   * `FILE_CONTEXT_MAX_ENTRY_BYTES`. Undefined when:
   *   - The file exceeded the size cap on edit (mtime-only record kept
   *     so enforcement still works).
   *   - The capture failed (file deleted between tool success and stat,
   *     read returned a non-text result like an image).
   *
   * For partial reads (offset/limit), this contains only the requested
   * range, with `range` set accordingly. A subsequent full read upgrades
   * the entry to full content (range becomes undefined).
   */
  content?: string;
  /** File mtime captured at operation time. Drives the read-before-edit staleness check. */
  mtimeMs: number;
  /** Wall-clock timestamp when the entry was last updated (Date.now()). */
  touchedAt: number;
  /** Which tool produced this entry. Latest operation wins. */
  via: "read" | "write" | "edit";
  /** Inclusive 1-indexed line range that `content` covers, when applicable. */
  range?: { start: number; end: number };
}

/** Maximum byte size of `content` kept in a single entry. Larger files cache mtime-only. */
export const FILE_CONTEXT_MAX_ENTRY_BYTES = 50_000;

/** Soft upper bound on total cache entries. Older entries evict LRU-style on insert. */
export const FILE_CONTEXT_MAX_ENTRIES = 200;

export interface FileContextCache {
  /**
   * Insert or overwrite the entry for `absPath`. If the cache is at
   * capacity and this is a new key, the oldest-touched entry is evicted.
   * Existing keys update in place (no eviction).
   */
  set(absPath: string, entry: FileContextEntry): void;

  /** Look up a single entry. */
  get(absPath: string): FileContextEntry | undefined;

  /** Whether the cache has an entry for this path. */
  has(absPath: string): boolean;

  /**
   * Read-only view of all entries. Returned Map is a fresh copy so mutations
   * don't leak back into the cache — consumers can safely iterate and sort.
   */
  snapshot(): Map<string, FileContextEntry>;

  /** Number of entries currently cached. */
  size(): number;

  /** Drop all entries. Used post-compact to avoid double-injection. */
  clear(): void;
}

export function createFileContextCache(
  opts: { maxEntries?: number } = {},
): FileContextCache {
  const maxEntries = opts.maxEntries ?? FILE_CONTEXT_MAX_ENTRIES;
  const entries = new Map<string, FileContextEntry>();

  return {
    set(absPath, entry) {
      if (!entries.has(absPath) && entries.size >= maxEntries) {
        // Evict the oldest entry (by touchedAt). Map iteration is insertion
        // order, but we want LRU semantics — scan once, drop the min. Only
        // triggers in pathological "touch 200 distinct files" scenarios, so
        // the O(n) scan is acceptable vs. maintaining a secondary LRU index.
        let oldestPath: string | undefined;
        let oldestAt = Infinity;
        for (const [p, e] of entries) {
          if (e.touchedAt < oldestAt) {
            oldestAt = e.touchedAt;
            oldestPath = p;
          }
        }
        if (oldestPath !== undefined) entries.delete(oldestPath);
      }
      entries.set(absPath, entry);
    },

    get(absPath) { return entries.get(absPath); },
    has(absPath) { return entries.has(absPath); },
    snapshot() { return new Map(entries); },
    size() { return entries.size; },
    clear() { entries.clear(); },
  };
}
