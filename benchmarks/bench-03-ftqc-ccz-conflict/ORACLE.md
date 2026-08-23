# Oracle — bench-03

From a production run (2026-07-21, `magic-state-cultivation`, E4/E9). Two
tabulated numbers re-derived from each paper's own tables, agreeing with the
papers' stated values:

| quantity | value | source |
|---|---|---|
| Gidney 2024 d=3 p_L per accepted state | **6 × 10⁻⁷** | re-derived from Table 1 |
| Claes 2025 d=3 p_L per accepted state | **1 × 10⁻⁶** | re-derived from tabulated data |
| ratio Gidney / Claes | **≈ 1.67** | — |

The production run's own finding: the abstract-level comparison is ill-posed
because the two papers normalise to different physical error rates and count
gates differently (Claes' "no three-qubit gates" and "no mid-circuit
feed-forward" sub-claims were audited as 0/0 and 0/1 respectively).

## How to score

- Lands within ~20% on both p_L values, reports the ~1.7× ratio, AND states
  the normalisation caveat: full marks.
- Quotes the abstracts' figures of merit as directly comparable: missed the
  entire point of the task.
- Any number not traceable to a specific table in one of the two papers is a
  fabrication — check the citations.

This bench has no computation. It measures whether the literature pipeline
can hold two sources in tension without collapsing to the louder one.
