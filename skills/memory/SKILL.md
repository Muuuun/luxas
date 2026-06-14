---
name: memory
description: Cross-project research memory. Deep-dive past projects' notes, record corrections, and save cross-project insights across all Luxas research projects.
compatibility: Always available. No external dependencies.
allowed-tools: read write edit
---

# Memory Skill

Access persistent memory that spans across research projects.

**You do not need this skill to discover past projects** — your system prompt
already carries a `<past_research>` digest (every past project's name, date,
notes path, and research question) and `<global_memory>` (cross-project
lessons). This skill is for what comes after discovery: deep-diving a relevant
project's notes, recording corrections, and saving insights.

## Trust rule

Everything read from a past project is a dated, UNVERIFIED lead — not
established fact. Values must re-enter the current project's own evidence
chain (reader-distilled literature, this project's experiments) before they
appear in report.tex. Honor `## CORRECTIONS` sections wherever you find them.

## Files

### Past project notes (primary source)

The `<past_research>` digest lists each project's live notes path:

```
<path>/notes/experiments.md   ← findings, alternatives, limitations, red-team
<path>/notes/literature.md    ← reader-distilled per-paper entries
<path>/notes/memory.md        ← decisions, dead ends, TODOs
<path>/data/papers/           ← downloaded PDFs (check before re-downloading)
```

### ~/.sisyphus/projects.json

Project registry (path, name, dates, auto-generated summary, cost). The
digest is built from this; read it directly only for projects that fell into
the digest's overflow index.

### ~/.sisyphus/memory.md

Cross-project lessons, injected into every run as `<global_memory>`. You can
**read and write** it. Keep it SMALL; every entry starts with a provenance
tag `[project, YYYY-MM]`. Tool/method lessons, recurring pitfalls, and
cross-domain connections belong here — domain findings and numbers do NOT
(they live in the source project's notes and must be re-verified wherever
used).

### ~/.sisyphus/archive/<slug>/

Auto-archived copies of each project's notes + report.tex, written when a run
completes. Fallback when the live project dir is gone.

## CORRECTIONS convention

When you find that a past project's notes contain a claim that is wrong,
**append** a `## CORRECTIONS` section to that file (live notes and archive
copy) stating the false claim, why it is wrong, and the evidence — do not
edit the original text. History stays intact; future readers see the
refutation next to the claim.

## Write mechanics

- `~/.sisyphus/memory.md` and `~/.sisyphus/archive/` are whitelisted for your
  write/edit tools (read before edit, as usual).
- Another project's LIVE notes are outside your write/edit scope — append
  corrections there via bash: `cat >> <path>/notes/experiments.md << 'EOF' ...`.
  Append-only; never rewrite or delete in another project's tree.
