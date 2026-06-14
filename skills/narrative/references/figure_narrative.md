# Figure–narrative binding

Figures are not decorations on prose; the figure sequence IS a parallel
telling of the argument. A reader flipping only through figures + captions
should reconstruct the paper's claim chain. Three rules:

## 1. Schematic-first (Figure 1)

Every report with a physical system, an architecture, or a framework leads
with a concept schematic — the thing the reader must hold in their head to
parse everything after. (~3/4 of published physics papers do this; the
fleet's historical execution rate was 0%.)

- The outline names Figure 1 BEFORE any data figure is commissioned.
- Schematics are where basic-fact hallucinations ship to print: every
  depicted mechanism/geometry carries a grounding source (cite key +
  section) in the `illustrator_write` spec. An ungrounded component is
  worse than no figure.
- The Figure-1 decision is recorded in the outline (or its rejection, with
  one line of why — e.g. a pure-theory note with one equation may not need
  one).

## 2. Hero figure = central claim, visible

Exactly one figure settles the paper's central claim, and the outline names
it. Tests it must pass:

- The claim's threshold/requirement is drawn ON the figure (a requirement
  line, a shaded feasible region) — pass/fail visible without reading the
  caption.
- The caption states the claim, not the axes ("Loss-corrected ceiling
  reaches 99.99% only in the optimistic dipolar-rate corner", not
  "Fidelity vs sweep time for several parameters").
- If the central claim changes during revision (restructure class), the
  hero figure is re-audited FIRST — a stale hero figure contradicts the new
  abstract in the most visible place possible.

## 3. Caption-as-claim, numbers computed

- Every caption's first sentence is the claim the figure settles; details
  (parameters, methods) come after.
- Any number in a caption or in-figure annotation is traceable to the same
  computed quantity that drew the curve (f-string discipline, see
  illustrator_write). A caption saying "minimum at 2.33 ms" while the dot
  sits at 23 ms is a shipped contradiction — the typesetter audits this on
  the rendered page, but the cheapest place to prevent it is here, at
  commissioning: the spawn spec quotes the claim WITH its number sourced
  from results.json, never from memory.

## Figure-sequence test (at outline time and pre-finish)

Lay out the planned figures in order. Read only their one-line claims. Is
that the paper's argument? Missing step → missing figure. A figure whose
claim doesn't appear in the chain → cut it (unused churn like fidelity_
scaling.png that never got cited).
