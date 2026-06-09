/**
 * Named groups of project-relative paths. Referenced from agent `.md`
 * frontmatter via `safety.presets: [...]` and expanded to the per-agent
 * `protectedFiles` list by `buildSafetyWrapper`. Values containing `{{VAR}}`
 * are expanded against the spawn's templateVars at wrapper-build time.
 */

export const SAFETY_PRESETS = {
  /** User-authored research brief — no agent may overwrite. */
  research_brief: [
    "RESEARCH.md",
  ],

  /** Files that materialize the written report + its citation graph. */
  report_surface: [
    "report/report.tex",
    "report/references.bib",
    "notes/literature.md",
  ],

  /** Cross-agent ledgers that should only be mutated by their owning agent. */
  notes_ledger: [
    "notes/experiments.md",
    "notes/memory.md",
    "notes/plan.md",
  ],

  /** Per-experiment scope root — expanded with EXPERIMENT_ID at spawn time. */
  experiment_scope: [
    "data/experiments/{{EXPERIMENT_ID}}",
  ],
} as const;
