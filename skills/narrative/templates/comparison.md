# Article type: comparison study

The reader's question: **"Which one, under what conditions — and can I trust
that the contest was fair?"** The paper's credibility lives or dies on the
fairness of the benchmark, so the benchmark is a first-class section, not a
methods footnote.

## Section logic (instantiate, don't copy labels)

1. **Introduction** — what is being compared, the decision the comparison
   informs, and the answer in one sentence including its condition structure
   ("A wins below threshold T, B above"). Unconditional winners are rare;
   a crossover IS the typical headline.
2. **Fair-comparison ground rules** — the axes, the figure(s) of merit, and
   the normalization that makes the contest fair (same error model? same
   resource budget? same maturity assumptions?). State explicitly what was
   held fixed and what was allowed to vary. **Figure 1**: the comparison
   framework — axes and contenders, drawn before any scores.
3. **The contest** — dimension-by-dimension results ORGANIZED BY PHYSICS,
   not by contender ("coherence: A's mechanism vs B's mechanism", not
   "Chapter A" then "Chapter B"). The **hero figure** is the decision
   surface: where each contender wins, with the crossover visible.
4. **Sensitivity** — does the ranking survive perturbation of weights /
   assumptions? A ranking without a sensitivity check is an opinion with
   axes.
5. **Recommendation** — the conditional verdict, restated with the caveats
   the contest surfaced.

## Anti-patterns specific to this type

- A weighted-score bar chart as the hero figure. Weighted totals hide the
  physics; the decision surface (parameter regions where each wins) shows
  it. Scores belong in a table; the figure shows WHY.
- Excluded contenders drawn with score-length bars ("hard-excluded" entries
  must be visually distinct from scored ones — greyed text, not a bar whose
  length reads as a score).
- One section per contender (forces the reader to do the comparison
  themselves — the comparison is YOUR job).

## Figure plan slots

- Figure 1: comparison framework (contenders × axes).
- Hero figure: decision surface / crossover plot.
- Score table (numbers + provenance), one sensitivity figure.

## Self-test

Can the reader find the regime where the LOSER wins? If your comparison has
no such regime, either the contest was unfair or §4 is missing.
