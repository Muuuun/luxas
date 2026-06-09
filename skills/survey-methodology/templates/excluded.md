# Excluded but relevant — PRISMA item 16b

> **Required artifact.** PRISMA item 16b (cite studies that might appear
> to meet inclusion criteria, but were excluded, and explain why) is
> the **single most-skipped item** in nominally PRISMA-compliant
> systematic reviews and the cleanest signal of confirmation bias if
> missing. For non-SR review types, this artifact is also required:
> readers need to see what the agent considered and rejected.

## Per-excluded-source entry

For every source/system/paper that almost qualified but was excluded:

```markdown
## E<N> — <citation key>

- title:
- authors:
- venue / year:
- DOI / arXiv / URL:
- exclusion reason: <verbatim from inclusion/exclusion criteria in scope.md>
- specific failure mode: <which test of the criterion failed>
- relevance note: <why a reader might expect this source to be included
  and how the exclusion is defended>
```

## Worked examples

```markdown
## E1 — Cursor

- title: Cursor: AI-First Code Editor
- authors: Anysphere (vendor)
- venue / year: commercial product, no peer-reviewed paper
- DOI / arXiv / URL: https://cursor.com
- exclusion reason: scope.md§Exclusion: "We exclude coding assistants that edit code but do not survey it"
- specific failure mode: Cursor is a code editor with autocomplete +
  agent capabilities, but its primary use is single-task code editing
  in a developer's active workflow, not autonomous repository research
  or scientific discovery
- relevance note: a reader interested in "AI agents and code" might
  expect Cursor to appear. We exclude it because its autonomy mode is
  short-horizon (in-IDE editing) rather than long-horizon (autonomous
  research), and its evaluation literature is closer to dev productivity
  than to GitHub research capability per our scope question
```

```markdown
## E2 — Devin (Cognition Labs)

- title: Devin: AI Software Engineer
- authors: Cognition Labs
- venue / year: industry blog / demo, March 2024; no peer-reviewed paper
- URL: https://www.cognition.com/blog/introducing-devin
- exclusion reason: scope.md§Exclusion: "Closed-source proprietary
  systems without published technical report or accessible source code"
- specific failure mode: no public technical report, no accessible
  source code, no third-party verification of demonstrated capabilities
- relevance note: a 2024-2026 SOTA survey of autonomous coding agents
  might be expected to include Devin. We exclude because the only
  available source material is the launch demo + marketing copy, with
  no methodology section, no benchmark scores reproducible by third
  parties, no source. Citation tier would be `industry-disclosure`
  per SKILL.md§Step 5; we noted this in adjudication log D5 but
  excluded from primary capability matrix
```

## Cross-cutting requirement

The PRISMA flow diagram (finish-gate item) must include the count of
excluded sources:

```
Records identified through search:           N1
Records after deduplication:                 N2
Records screened on title/abstract:          N3
Records excluded at title/abstract:          N4 = N3 - (passed)
Records assessed for full eligibility:       N5
Records excluded with reason (this file):    N6 = entries in excluded.md
Records included in final review:            N7
```

## What this artifact prevents

- Cherry-picking: agent silently filtering out sources that contradict
  its emerging narrative
- Confirmation bias: post-hoc rationalization of why an inconvenient
  source "isn't really relevant"
- Coverage misrepresentation: claiming "comprehensive review" while
  invisibly excluding entire research traditions

If this file is empty or has < 10% the count of included sources, that
is itself a red flag (perfect inclusion = no real selection happened).
