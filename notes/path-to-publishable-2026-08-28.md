# Path to a shippable, publishable paper — small experiments (2026-08-28)

*Both providers were out of credit, so these are experiments I could run without model spend, on the real artifacts of `pp-vs-ss-gate-packing-20260826` copied to the Mac: the final plot scripts + data, the report source, the reviews, every `results.json`.*

## Experiment 1 — figure convergence with a "gold" illustrator

Question: if the illustrator could see perfectly, how many edit rounds does each figure need to pass the lint *and* a referee's eye, and what does that reveal about the tools?

Baseline (final scripts as left by the run, re-rendered locally): fig3/fig4/fig5 had 0 PDF-layer errors, fig2 1, fig1 (TikZ) 3 — the run's last fix round had got the data plots close. But every data plot still had the same class of defect a referee sees at once: **text laid over the curve it describes** (fig2 ×2, fig3, fig4, fig5). Neither lint layer detected it. → Built the text-over-data rule (50 % core of the text box, ≥ 4 line samples; calibrated on the archetype set: labels beside curves score 0–2). It flagged exactly those five.

Gold pass on the two hardest (me, editing scripts, lint after each render):

| figure | edits | rounds | what it took |
|---|---|---|---|
| fig3 gain vs anisotropy | 3 | 2 | marker rope → line; two labels moved; my first move landed the theory label on the other curve — the new lint caught *my* error |
| fig4 gate viability | 4 | 4 | callout moved three times blind (into the legend twice — I misread the legend's axes-fraction anchor); resolved only when I wrote `figplace` and let the code pick a free spot |

Three linter false positives surfaced and were fixed on the way: mathtext font-switch fragments of one annotation "colliding" with each other (now merged when adjacent on the same baseline, horizontal only, never overlapping labels); rotated axis labels glued to tick labels by the merge; an `Annotation`'s bbox including its arrow path (now text-only in both the hook and `figplace`).

**Finding:** the bottleneck is not seeing — it is *placing*. An author (human or model) placing labels in data coordinates cannot see the legend, the other labels or the curves at write time, so every placement is a guess and each guess costs a render + lint round. `figplace.annotate_free(ax, text, xy, candidates)` tries candidates against the linter's own occupancy (line samples, legend, texts, insets) and draws at the first free one, or returns None with the reason per candidate. With it, fig4's callout converged in one round. This is now the documented way to place callouts in `illustrator_write`.

State after the experiment: fig3 and fig4 lint-clean at both layers and, to my eye, publishable; fig2 and fig5 need one label move each (identified by the new rule); fig1 (TikZ) still has three collisions — the schematic needs a template with fixed label slots, not another free-hand attempt.

## Experiment 2 — the ship gate on the project as-is

`reportIntegrityIssues` + claim table on the final tree: **6 blocking issues** — 3 claim-status (abstract quotes the disputed 1.98× via value match; cites the disputed θ*; a malformed SCALING line), 2 method-blocked (an undisposed `math` sub-agent escalation; E2's `gain_3d_n60` cross-validation is bit-identical = wiring), 1 stale prior-art audit. Four headline rows disputed/conditional:

| row | why | cheapest closure |
|---|---|---|
| `c6_total_zero_angle_deg` | E3's stale 22.909 ± 0.01 vs E4 24.65, E7 24.5 | **supersession** (v2 P1): E7 re-measured the id in the same lineage; today only a disclosure clears it |
| `c6_diag_min_abs_ghz_um6_in_20_26` | E4 0.007 vs E7 0.64 — genuine | one discriminator at finer angular resolution (~$5) or disclose |
| `max_gain_over_orientation` | E3's 1.96 model artifact; E4 capped at 1.35 under a different id | re-key: E4's value *is* the answer to E3's question — a `replaces` on the verdict, no computation |
| `pp_interaction_gate_density_per_um2` | conditional on the above | clears with them |

So finishing needs: one disclosure (the zero angle, until supersession exists), one small discriminator or a second disclosure (min |C₆| — but only one disclosure is allowed, so the discriminator), two bookkeeping moves (re-key, method-blocked disposition), a prior-art re-audit, the figure fixes, and `finish()`. Estimated **$20–30** with both providers funded.

## Experiment 3 — a referee's read of the manuscript

2 800 words, 7 claim-titled sections, 4 equations, 16 of 23 references cited, a Methods-and-scope statement. Substantively coherent and honest about n = 60 vs n = 75. What a referee would send back:

1. **The crux is under-resolved.** Everything downstream of §4 rests on the C₆ zero being sharp; the two methods disagree by 100× on min |C₆| in the window. The paper needs one figure that shows C₆(θ) from 20–28° at ≤ 0.5° resolution from both methods with the C₅/C₈ floor drawn in.
2. **The interaction gate is asserted, not stress-tested.** F = 0.9967 at R = 2.0 μm comes from one model; no master-equation vs analytic comparison across the dead zone, no sensitivity to θ misalignment (the whole point of the lattice orientation) or to the flat-top beam's residual inhomogeneity. The flat-top assumption in the user's question was taken as given and never costed.
3. **Operating point.** The headline is at n = 60; the conclusion admits n ≈ 75 is not established. A referee will ask for the n = 75 numbers or a demotion of the headline.
4. **Housekeeping the gates already catch:** "Hero figure:" in a caption (now banned vocabulary), colour words in captions ("(red)", "(purple)") that must match the figure, an author line ("Luxas / Singularity Research") to be replaced, figure captions that restate section claims.

## What "shippable" needs, in order

1. **Credit on both providers**, then finish this project under the new gates (~$25). This is also the only way to measure whether the figure loop now converges — the run died before its first gated compile.
2. **Supersession of stale producer estimates** (claims v2 P1.1): a later experiment of the same lineage re-measuring an id retires the earlier estimate from the dispute set. Without it every re-measurement forces a disclosure.
3. **Schematic templates with label slots** for TikZ figures, and `figplace` for every matplotlib callout (done for the generator prompt; the illustrator fixer should use it too).
4. **A "referee pass" gate before finish**: the three substantive questions above are exactly the shape of `DISCRIMINATOR` lines — the PI's final review should be obliged to name, for each headline claim, the single computation a referee would demand, and the brain must either run it or disclose it. This is elicitation, not a new agent.
5. Then a second full project from scratch on the v2 code, with the counters in `plan-claims-first-v2.md` §4 plus figure-gate refusals and rounds-to-clean per figure.
