---
name: narrative
description: Narrative discipline for research reports — article-type templates (empirical / feasibility / comparison / policy-zh) and the feedback revision protocol that keeps outline, prose, and figures coherent across many feedback rounds.
compatibility: Always available. No external dependencies.
allowed-tools: read
---

# Narrative Skill

Two jobs, in order of importance:

1. **Revision protocol** — how to absorb PI/user feedback without the report
   degrading back into a patchwork (most narrative damage happens during
   feedback rounds, not first drafts).
2. **Article-type templates** — positive examples of section logic per
   article type, consumed at outline time.

This skill is the delta on top of brain.md's `<report_synthesis_protocol>`
(outline-first, claims-as-titles, lab-book test, anti-stacking pass). It does
not repeat those rules — it adds what they lack: per-type section logic, the
figure-narrative binding, and what to do when feedback arrives.

## First draft (thin — most rules live in brain.md)

1. Pick the article type and record it as the first line of
   `notes/report_outline.md`: `type: empirical | feasibility | comparison |
   policy-zh | survey`. Surveys: stop here and follow `skills/review/` +
   `skills/survey-methodology/` instead — never both pipelines.
2. Read `templates/<type>.md` BEFORE writing the outline. The template gives
   the section logic for that type; your outline instantiates it with this
   project's claims. The lab-book test catches structure that mirrors the
   experiment DAG; the template shows what to write instead.
3. Read `references/figure_narrative.md` before commissioning figures. The
   outline must name its **Figure 1 (schematic)** and its **hero figure**
   (the one figure that settles the central claim) — both are outline-level
   decisions, not afterthoughts.

## Revision protocol (core)

Every feedback batch that touches the report gets classified BEFORE any
edit. Mixed batches: tag every item first, edit second (tag-all-before-
edit-any) — append-only `reviews/pi_feedback.md` means earlier instructions
never vanish, so there is no need to rush.

Add the class tag to each checklist line in `notes/memory.md` (the existing
pi_correction_protocol checklist — same boxes, one tag + one-line rationale
extra):

```
- [ ] <instruction verbatim>  [class: local-fix | section-rewrite | restructure — <one-line why>]
```

### Class 1 — local-fix (a number, a wording, a citation)

The pi_correction_protocol order applies unchanged: ledger first, report
second. Then:
- grep report.tex for OTHER occurrences of the corrected number (abstract,
  captions, tables — printed values drift in packs, not alone).
- re-read the first sentence of the touched paragraph against its section's
  outline thesis (10 seconds — does the paragraph still serve the claim?).
- the outline is NOT touched — **unless the corrected number appears in, or
  defines, the central-claim sentence** (e.g. a threshold comparison like
  "99.987% < 99.99%"). Then this is not a local-fix; reclassify as
  restructure and follow that flow.

### Class 2 — section-rewrite (a section's argument is wrong/weak)

Precondition: if the feedback strikes an L2 claim, the experiment re-spawn
(ledger fix) comes FIRST; this class begins only after `notes/experiments.md`
§ L2.X reflects the new physics.

1. Edit that section's block in `notes/report_outline.md` first (thesis /
   evidence / synthesis move).
2. Rewrite the section from outline + ledger — single-section scope
   (`mv` the old text into the editor's view, don't patch sentence by
   sentence around a broken spine).
3. Check the transitions: the last paragraph of the previous section and the
   first of the next still hand over correctly.

### Class 3 — restructure (the central claim changes)

**Default triggers — burden of proof is reversed.** Any of:
- feedback strikes a headline finding (an L2 claim quoted in the abstract),
- feedback contradicts a sentence of the abstract,
- experiments are added or removed after the report exists.

→ classify as restructure BY DEFAULT. Downgrading to a smaller class
requires a one-line written justification on the checklist line.

Flow:
1. Re-derive the WHOLE outline (new central claim, possibly new type
   template consultation). Diff old vs new outline.
2. Walk report.tex section by section against the new outline — rewrite what
   the diff touches, keep what it doesn't.
3. **Figure re-audit**: does the hero figure still settle the NEW central
   claim? If not, commission a replacement — and the `illustrator_write`
   spawn task must quote the NEW claim text (spawn prompts are frozen
   snapshots; re-spawning with the old task resurrects the old framing).
4. **Re-verify every already-ticked checkbox** in `notes/memory.md` PI
   sections. Prose-level feedback ("stop calling it deterministic") lives
   only in report.tex — a rewrite can silently resurrect what an earlier
   round corrected. Each previously-ticked box gets re-checked against the
   new text; re-tick or re-fix.

### Pre-finish reconciliation

Before `finish()` (and before the final PI review that the finish gate
requires): one outline-vs-tex walkthrough — for each section, first
paragraph vs outline thesis. Attach the outline verbatim to the final
`request_pi_review` so PI reviews the argument, not just the prose.

## Number provenance (interaction with correctness gates)

Rewrites must not orphan numbers. Every quantitative value in report.tex
traces to a `results.json` `computed.*` field plus a stated transform
(rounding, unit change). After a restructure, sweep the rewritten sections
for numbers with no surviving source — flag, don't guess. Char-for-char
identity is NOT required (rounding and Chinese prose legitimately reformat);
traceability is.
