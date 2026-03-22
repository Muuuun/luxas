/**
 * Event-driven reminder system — compact, per-turn quality nudges.
 *
 * Inspired by Claude Code's <system-reminder> pattern:
 *   - Injected every LLM call via the research snapshot
 *   - State-driven: providers read disk/flags, not conversation history
 *   - Budget-controlled: total output capped, high-priority reminders survive
 *
 * Two activation modes:
 *   Tier 1 — State providers: evaluate disk state every turn (figstyle, PNG, etc.)
 *   Tier 2 — Event providers: read flags set by afterToolCall hooks, with TTL
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Interface ───────────────────────────────────────────────────────────────

export interface ReminderContext {
  projectDir: string;
  /** Shared flag store. Hooks write, providers read. */
  flags: Map<string, Flag>;
}

export interface Flag {
  value: any;
  setAt: number;     // Date.now() when set
  ttlMs?: number;    // auto-expire after this many ms (omit = permanent until cleared)
}

export interface ReminderProvider {
  /** Unique id — used for dedup and ordering. */
  id: string;
  /** Higher = appears first. Default 0. */
  priority?: number;
  /**
   * Return a short string (1–2 lines) or null to suppress.
   * Must be fast and synchronous — reads disk state or flags, nothing else.
   */
  evaluate(ctx: ReminderContext): string | null;
}

// ── Registry ────────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 600; // chars — ~150 tokens, fits 4–5 one-line reminders

export class ReminderRegistry {
  private providers: ReminderProvider[] = [];
  readonly flags: Map<string, Flag> = new Map();
  private budget: number;

  constructor(budget = DEFAULT_BUDGET) {
    this.budget = budget;
  }

  register(provider: ReminderProvider): void {
    // Dedup by id
    this.providers = this.providers.filter(p => p.id !== provider.id);
    this.providers.push(provider);
  }

  setFlag(key: string, value: any = true, ttlMs?: number): void {
    this.flags.set(key, { value, setAt: Date.now(), ttlMs });
  }

  clearFlag(key: string): void {
    this.flags.delete(key);
  }

  /** Remove expired flags. */
  private gc(): void {
    const now = Date.now();
    for (const [key, flag] of this.flags) {
      if (flag.ttlMs && now - flag.setAt > flag.ttlMs) {
        this.flags.delete(key);
      }
    }
  }

  /**
   * Evaluate all providers, return rendered section or null.
   * Called by buildResearchSnapshot every turn.
   */
  render(projectDir: string): string | null {
    this.gc();
    const ctx: ReminderContext = { projectDir, flags: this.flags };

    const lines: { priority: number; text: string }[] = [];
    for (const p of this.providers) {
      try {
        const text = p.evaluate(ctx);
        if (text) lines.push({ priority: p.priority ?? 0, text });
      } catch { /* provider crash must not break the agent */ }
    }

    if (lines.length === 0) return null;

    // High priority first
    lines.sort((a, b) => b.priority - a.priority);

    // Budget enforcement
    const header = "## Active Reminders\n";
    let total = header.length;
    const kept: string[] = [];
    for (const line of lines) {
      const formatted = `- ${line.text}`;
      if (total + formatted.length + 1 > this.budget) break;
      kept.push(formatted);
      total += formatted.length + 1;
    }

    if (kept.length === 0) return null;
    return header + kept.join("\n");
  }
}

// ── Built-in Providers ──────────────────────────────────────────────────────

/** Figure style — remind to use figstyle.mplstyle when it exists. */
const figstyle: ReminderProvider = {
  id: "figstyle",
  priority: 10,
  evaluate(ctx) {
    const path = join(ctx.projectDir, "report", "figstyle.mplstyle");
    if (!existsSync(path)) return null;
    return `Figures: MUST plt.style.use('${path}'). Save as PDF, not PNG.`;
  },
};

/** PNG cleanup — detect PNG figures that should be PDF. */
const pngFigures: ReminderProvider = {
  id: "png-figures",
  priority: 8,
  evaluate(ctx) {
    const dir = join(ctx.projectDir, "report", "figures");
    try {
      const pngs = readdirSync(dir).filter(f => f.endsWith(".png"));
      if (pngs.length > 0) return `${pngs.length} PNG figure(s) in report/figures/ — regenerate as PDF.`;
    } catch {}
    return null;
  },
};

/** Post-experiment — remind to update notes before continuing. Self-clears when notes updated. */
const postExperiment: ReminderProvider = {
  id: "post-experiment",
  priority: 20,
  evaluate(ctx) {
    const flag = ctx.flags.get("experiment_completed");
    if (!flag) return null;
    // Self-clear: if experiments.md was modified after the flag, notes are updated
    try {
      const mtime = statSync(join(ctx.projectDir, "notes", "experiments.md")).mtimeMs;
      if (mtime > flag.setAt) { ctx.flags.delete("experiment_completed"); return null; }
    } catch {}
    return "Update notes/experiments.md with experiment results before doing anything else.";
  },
};

/** Post-workers — remind to record findings before dispatching more. Self-clears. */
const postWorkers: ReminderProvider = {
  id: "post-workers",
  priority: 15,
  evaluate(ctx) {
    const flag = ctx.flags.get("workers_completed");
    if (!flag) return null;
    try {
      const mtime = statSync(join(ctx.projectDir, "notes", "literature.md")).mtimeMs;
      if (mtime > flag.setAt) { ctx.flags.delete("workers_completed"); return null; }
    } catch {}
    return "Update notes/literature.md with worker findings BEFORE dispatching more workers.";
  },
};

/** Post-compile with errors — remind to record fix. TTL-based (5 min). */
const postLatexError: ReminderProvider = {
  id: "post-latex-error",
  priority: 5,
  evaluate(ctx) {
    const flag = ctx.flags.get("latex_had_errors");
    if (!flag) return null;
    return "Record LaTeX fix in notes/memory.md (problem + solution) to avoid repeating.";
  },
};

/** Paper figures — remind to extract figures before writing report. */
/** Paper figures — three-stage reminder: extract → review → include. */
const paperFigures: ReminderProvider = {
  id: "paper-figures",
  priority: 12,
  evaluate(ctx) {
    const papersDir = join(ctx.projectDir, "data", "papers");
    try {
      const entries = readdirSync(papersDir, { withFileTypes: true });
      const hasPapers = entries.some(e => e.name.endsWith(".pdf") || (e.isDirectory() && !e.name.endsWith("_figures")));
      if (!hasPapers) return null;
      const hasFigDirs = entries.some(e => e.isDirectory() && e.name.endsWith("_figures"));
      // Stage 1: papers exist but no figures extracted
      if (!hasFigDirs) {
        return "Papers downloaded but NO figures extracted. Run extract-figures on each PDF.";
      }
      // Stage 2: figures extracted but not reviewed in notes
      const mem = join(ctx.projectDir, "notes", "memory.md");
      if (existsSync(mem)) {
        const notes = readFileSync(mem, "utf-8");
        if (notes.includes("## Figure Review")) return null; // reviewed — done
      }
      return "Figures extracted but NOT reviewed. Read manifest.json captions, add ## Figure Review to notes/memory.md.";
    } catch {}
    return null;
  },
};

/** Plan required — remind agent to create a research plan before doing research. */
const planRequired: ReminderProvider = {
  id: "plan-required",
  priority: 25,  // highest priority — planning comes first
  evaluate(ctx) {
    if (existsSync(join(ctx.projectDir, "notes", "plan.md"))) return null;
    return "Create notes/plan.md with your research plan, then request PI review before starting research.";
  },
};

/** Unresolved lessons — remind agent to update lesson resolutions. */
const unresolvedLessons: ReminderProvider = {
  id: "unresolved-lessons",
  priority: 3,
  evaluate(ctx) {
    const lessonsPath = join(ctx.projectDir, "notes", "lessons.md");
    if (!existsSync(lessonsPath)) return null;
    try {
      const content = readFileSync(lessonsPath, "utf-8");
      const pendingCount = (content.match(/\(pending/g) || []).length;
      if (pendingCount > 3) {
        return `${pendingCount} unresolved lessons in notes/lessons.md — update Resolution fields for fixed issues.`;
      }
    } catch {}
    return null;
  },
};

// ── Export ───────────────────────────────────────────────────────────────────

export const builtinProviders: ReminderProvider[] = [
  planRequired,
  figstyle,
  pngFigures,
  postExperiment,
  postWorkers,
  postLatexError,
  paperFigures,
  unresolvedLessons,
];
