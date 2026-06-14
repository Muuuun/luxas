# Article type: empirical / measurement

The reader's question: **"What did you establish, and why should I believe
the number?"** The paper is an argument that a quantity/effect is what you
say it is. (PRX/PRA long-form shape.)

## Section logic (instantiate, don't copy labels)

1. **Introduction** — the physical question, why it is open, and the answer
   in one sentence WITH the headline number. The reader knows your result
   before page 2; the rest of the paper earns their belief in it.
2. **System & methods** — the apparatus / model / protocol. This is where
   **Figure 1 (schematic)** lives: level diagram, geometry, pulse sequence —
   whatever the reader must hold in their head to parse the results. Grounded
   per `references/figure_narrative.md`.
3. **Main result** — the **hero figure** and the measurement/derivation that
   produces the headline number. One section, one claim, the figure carries
   it. Everything before this section exists to make this figure readable;
   everything after exists to defend it.
4. **Error budget / robustness** — the section that turns "we got X" into
   "X is right": systematic effects enumerated in a table, dominant terms
   analyzed, the rest bounded. Weak empirical papers skip this; strong ones
   make it a centerpiece.
5. **Implications & outlook** — what changes given the number; honest
   limitations; next measurement.

## What the experiment DAG looks like in this shape

E1…E7 do NOT appear as sections. Calibration experiments fold into §2 or the
error budget; the central measurement(s) into §3; cross-checks into §4. One
experiment commonly feeds three sections; one section commonly draws on
three experiments.

## Figure plan slots (fill in the outline)

- Figure 1: schematic of <system> — grounding: <cite keys>.
- Hero figure: <the plot that IS the main result> — settles: <central claim>.
- Error-budget table or figure.

## Self-test

Could a referee reconstruct your experiment dispatch order from the section
sequence? If yes, restructure. Could they state your central number after
reading only the introduction? If no, rewrite the introduction.
