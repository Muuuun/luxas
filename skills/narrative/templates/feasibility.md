# Article type: feasibility / design study

The reader's question: **"Should we build this — and what exactly would we
build?"** The paper is a reasoned recommendation, not a tour of analyses.
(PRX Applied / PRA design-study shape.)

## Section logic (instantiate, don't copy labels)

1. **Introduction** — the design goal as a quantified requirement ("a gate
   architecture reaching 99.99% over N sites"), why existing approaches fall
   short, and the verdict in one sentence: feasible / feasible-with-caveats /
   infeasible, under which headline conditions. Verdict-first, like the
   abstract of a referee report.
2. **The proposed architecture** — **Figure 1 (schematic)**: the system you
   are evaluating, drawn concretely enough that a skeptic can attack it.
   Requirements table: every quantified constraint the design must meet.
3. **Design space & elimination** — the candidate space and what kills each
   alternative. This is where comparison analyses live (species choice,
   parameter regimes) — as *reasons for the surviving design*, not as
   standalone result dumps. Each elimination cites its evidence (L2 /
   literature) in one or two sentences; losers get paragraphs, not sections.
4. **Quantitative case for the surviving design** — the **hero figure**:
   the performance ceiling / budget of the recommended design, with the
   requirement line drawn ON the figure so the pass/fail is visible. Error
   budget for the headline number.
5. **Risks & falsifiers** — what would change the verdict: the assumptions
   that, if wrong, flip feasibility; the first experiment a lab should run
   to de-risk.

## What the experiment DAG looks like in this shape

Per-question experiments (B-field handling, fidelity ceiling, species
comparison, transfer efficiency…) are EVIDENCE inside §3 and §4 — never
parallel sections. The collisional-gate failure mode: six sections, one per
experiment, each "answering a sub-question" — that is a consulting memo, not
a paper. The design is the protagonist; experiments are witnesses.

## Figure plan slots

- Figure 1: architecture schematic — grounding: <cite keys / L2 refs>.
- Hero figure: performance vs requirement, requirement line drawn on it.
- Elimination summary: ONE compact table or decision figure (not one bar
  chart per eliminated option).

## Self-test

Does every section advance the case for/against the verdict stated in §1?
A section that merely "reports findings on sub-question N" without changing
the reader's confidence in the verdict is ledger residue — fold it in or
cut it.
