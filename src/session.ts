/**
 * Session — Pi-style JSONL log with tree structure and compaction.
 * Append-only, crash-safe, supports branching and summarization.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

// ── Entry types ──────────────────────────────────────────

export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export interface EntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface DecisionEntry extends EntryBase {
  type: "decision";
  reason: string;
  tasks: Array<{ action: string; tool: string; model: string }>;
  done?: boolean;
}

export interface ActionEntry extends EntryBase {
  type: "action";
  action: string;
  tool: string;
  result: "success" | "failed";
  details: string;
  elapsed: number;
}

export interface CompactionEntry extends EntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
}

export interface BranchSummaryEntry extends EntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
}

export type SessionEntry = DecisionEntry | ActionEntry | CompactionEntry | BranchSummaryEntry;

function genId(): string {
  return randomBytes(4).toString("hex");
}

// ── Session manager ──────────────────────────────────────

export class Session {
  private header: SessionHeader;
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private file: string;

  private constructor(file: string, header: SessionHeader) {
    this.file = file;
    this.header = header;
  }

  static create(file: string, cwd: string): Session {
    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      cwd,
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(header) + "\n");
    return new Session(file, header);
  }

  static open(file: string, cwd: string): Session {
    if (!existsSync(file)) return Session.create(file, cwd);

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    if (lines.length === 0) return Session.create(file, cwd);

    const header = JSON.parse(lines[0]) as SessionHeader;
    const session = new Session(file, header);

    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as SessionEntry;
        session.entries.push(entry);
        session.leafId = entry.id;
      } catch { /* skip malformed lines */ }
    }

    return session;
  }

  /** Append an entry, linking it to the current leaf. Returns the new entry's id. */
  append(data: Omit<DecisionEntry, "id" | "parentId" | "timestamp"> | Omit<ActionEntry, "id" | "parentId" | "timestamp"> | Omit<CompactionEntry, "id" | "parentId" | "timestamp"> | Omit<BranchSummaryEntry, "id" | "parentId" | "timestamp">): string {
    const entry = {
      ...data,
      id: genId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    } as SessionEntry;

    this.entries.push(entry);
    this.leafId = entry.id;
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    return entry.id;
  }

  /** Walk from an entry (default: leaf) back to root, returning entries in root→leaf order. */
  getBranch(fromId?: string | null): SessionEntry[] {
    const branch: SessionEntry[] = [];
    let currentId = fromId ?? this.leafId;
    const map = new Map(this.entries.map((e) => [e.id, e]));

    while (currentId) {
      const entry = map.get(currentId);
      if (!entry) break;
      branch.unshift(entry);
      currentId = entry.parentId;
    }
    return branch;
  }

  /** Get entries on current branch after the last compaction (or all if none). */
  getRecentEntries(maxCount = 30): SessionEntry[] {
    const branch = this.getBranch();
    let startIdx = 0;
    for (let i = branch.length - 1; i >= 0; i--) {
      if (branch[i].type === "compaction") {
        startIdx = i + 1;
        break;
      }
    }
    return branch.slice(startIdx).slice(-maxCount);
  }

  /** Get the latest compaction summary on the current branch. */
  getCompactionSummary(): string | null {
    const branch = this.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      if (branch[i].type === "compaction") {
        return (branch[i] as CompactionEntry).summary;
      }
    }
    return null;
  }

  /** Move the leaf to a different entry (tree navigation). */
  branch(entryId: string): void {
    if (this.entries.some((e) => e.id === entryId)) {
      this.leafId = entryId;
    }
  }

  /** Format recent session entries as text for Brain context. */
  formatForContext(): string {
    const summary = this.getCompactionSummary();
    const recent = this.getRecentEntries(20);

    const parts: string[] = [];
    if (summary) {
      parts.push(`<compaction_summary>\n${summary}\n</compaction_summary>`);
    }

    if (recent.length > 0) {
      const lines = recent.map((e) => {
        if (e.type === "decision") {
          const d = e as DecisionEntry;
          const taskList = d.tasks.map((t) => `${t.action}(${t.tool}/${t.model})`).join(", ");
          return `[${e.timestamp.slice(11, 19)}] DECISION: ${d.reason} → ${taskList}`;
        }
        if (e.type === "action") {
          const a = e as ActionEntry;
          const icon = a.result === "success" ? "✓" : "✗";
          return `[${e.timestamp.slice(11, 19)}] ${icon} ${a.action}: ${a.details.slice(0, 120)}`;
        }
        if (e.type === "branch_summary") {
          return `[${e.timestamp.slice(11, 19)}] BRANCH: ${(e as BranchSummaryEntry).summary.slice(0, 100)}`;
        }
        return "";
      }).filter(Boolean);

      parts.push(`<recent_actions>\n${lines.join("\n")}\n</recent_actions>`);
    }

    return parts.join("\n\n");
  }

  /** Stats for TUI display. */
  stats(): { totalActions: number; decisions: number; lastAction?: string } {
    const branch = this.getBranch();
    const actions = branch.filter((e) => e.type === "action") as ActionEntry[];
    const decisions = branch.filter((e) => e.type === "decision");
    const last = actions[actions.length - 1];
    return {
      totalActions: actions.length,
      decisions: decisions.length,
      lastAction: last ? `${last.action} (${last.result})` : undefined,
    };
  }

  /** Check if the agent is stuck repeating the same failed action pattern. */
  isStuck(pattern: string, threshold = 4): boolean {
    const recent = this.getRecentEntries(threshold * 2)
      .filter((e) => e.type === "action") as ActionEntry[];
    if (recent.length < threshold) return false;

    let consecutiveFailedSame = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].action === pattern && recent[i].result === "failed") {
        consecutiveFailedSame++;
      } else {
        break;
      }
    }
    return consecutiveFailedSame >= threshold;
  }

  /** Number of entries since last compaction (to decide when to compact). */
  entriesSinceCompaction(): number {
    return this.getRecentEntries(1000).length;
  }

  getLeafId(): string | null { return this.leafId; }
  getEntries(): SessionEntry[] { return this.entries; }
  getFile(): string { return this.file; }
}
