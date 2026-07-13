---
name: compute-methods
description: >
  Environment-verified friction sheets for field-standard computational tools
  (Rydberg pair interactions, QEC circuits, qLDPC decoding, code distance,
  atom dynamics, optics, quantum chemistry). Each sheet lists the tools the
  field actually uses, the first-use frictions that make agents wrongly
  abandon them, and one-line smoke tests. Injected at spawn time into
  experiment and tool_impl contexts by buildMethodsRegistry
  (src/agents/context-builders.ts) — the named reader; do not add sheets
  without match: keywords or they will never be injected.
compatibility: Pure prompt skill. Sheets are data; the injection lives in the harness.
---

# Compute-methods registry

**Why this exists** (2026-07-13, debate-adjudicated): experiment agents abandon
the field-standard tool over first-use friction and fall back to
approximations that change the science. Canonical: pairinteraction rejected as
"requires manual database download" when the real fix was the species string
`'Yb174_mqdt'` — the ν¹¹-scaling fallback missed series splitting and a pair
resonance that refuted a headline claim. A sheet row is cheaper than a
debugging spiral: **a friction listed here is a usage bug, not a tool failure.**

Sheet contract:
- frontmatter `match:` comma-separated keywords (substring, case-insensitive)
  — ranked by hit count against RESEARCH.md + literature head + task text.
- frontmatter `verified:` YYYY-MM-DD + `verified-on:` vm|mac. Sheets without
  `verified:` are injected with an UNVERIFIED banner; older than 90 days get a
  STALE banner (frictions demote to hints).
- Body: per-tool table (frictions, smoke test), then `## Known false
  rejections` — verbatim wrong claims from past ledgers, so a reviewer can
  recognize a recurrence.
- After you fix a new friction in anger, add the row in the same session —
  the next agent inherits it.
