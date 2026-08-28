# Design: figures v2 — publication-grade figures from an agent pipeline

*2026-08-28. Trace reviewed: every figure-related artifact of `pp-vs-ss-gate-packing-20260826` — 5 canonical figures (4 matplotlib, 1 TikZ), 21 figure-agent transcripts (13.6 MB, ≈25% of the run's tokens), 4 audit note files, the plot scripts, `figstyle.mplstyle`, the deployed `style_guide.md`, and the figures as they print in `report.pdf`. Survey: PlotGen / MatPlotAgent (multimodal feedback loops), visualization linters (McNutt & Kindlmann's matplotlib linter, VizLinter), adjustText, sciwrite-lint.*

## 1. What the figures actually look like

I looked at all five at print size.

| figure | what a referee sees |
|---|---|
| fig1 geometry (TikZ) | "θ = 90°" hidden under "R ∼ 5.5 μm"; an unlabelled C₆(θ) inset with colliding axis labels; a dotted 54.7° line labelled "channel zero" pointing at nothing; serif and sans fonts mixed; the lattice dots invisible. No reader can extract the geometry claim. |
| fig2 C₆(θ) | single panel labelled "(a)"; the title-like "total C₆ zero θ*≈24.65°" collides with an annotation; 10 sparse points joined by lines pretending to be a curve; two arrows crossing the data. |
| fig3 gain vs anisotropy | a curve drawn as a fat rope of markers; "interaction-gate gain" text crosses the dashed model; legend entries at **3.9 pt** at column width; an unexplained A_crit line; the y-range clips the model curve. |
| fig4 gate viability | **8 overlaid Ω curves** zig-zagging through a dead zone; annotations stacked on the data; legend over the data; fonts inconsistent between panels; the "Best" callout overlapping three lines. |
| fig5 interaction gain | 4 points on a huge empty axes; an inset placed over the data region with its labels crossing its own curve; the "1.98× @ R=2.0 μm" callout overlapping its arrow. |

`figlint-pdf` (built today, §4) on these same PDFs: fig1 3 collisions, fig2 1, fig3 1 collision + 3.9 pt text, fig4 44 text lines (dense), fig5 clean at the PDF layer — and its inset-over-data is caught by the save-time budget.

## 2. Why — five causes, each with the trace that proves it

1. **The lint already existed and already fired; nothing consumed it.** The save-time hook printed `[figlint] ERROR … collision` for fig2, fig3, fig4, fig5 in the generators' own bash output (20, 17, 25 calls). Each generator then wrote "visual check passed — no text overlaps". The SKILL said "exit 2 = errors; do not `|| true`" — a sentence, not a consumer. This is the CLAUDE.md orphan-mechanism failure, in the figure pipeline.
2. **The eyes were a model that cannot see.** Under `--profile dual` every figure agent (generator, per-figure fixer, global auditor, typesetter — 21 spawns) ran on Kimi K2.5. Every one of the 16 "Read the PNG" steps concluded "no overlaps / passed" on figures with visible collisions. The reviewer and PI never look at figures by design (`reviewer.md`: "DO NOT view figures"). So no agent in the loop was capable of seeing the defect, and the only deterministic instrument was ignored.
3. **Two style sources that contradict.** `figstyle.mplstyle` mandates Okabe-Ito and outward ticks; the deployed `style_guide.md` ("Nature house voice", copied from `skills/figure/style_guides/physics.md`) mandates tab10 hex codes and inward ticks. Audit round 1 restyled all four figures tab10→Okabe-Ito; round 2 restyled them back; round 3 flipped ticks. Eight spawns, ~$10, zero legibility gained, and the audit notes' "[pass]" items were about hex codes.
4. **Audit = style checklist, not legibility.** The 13-item illustrator checklist has one legibility item (#8, delegated to the same blind vision) and twelve about hex codes, weights, spines, `usetex` bold, hard-coded literals. Audits found "14 issues", "5 issues", "1 issue" — none of them a collision. The instrument measured the wrong thing with high precision.
5. **No composition budget.** Briefs said "claim it settles: …" (good) but nothing bounded series, annotations or insets; the generator prompt's composition rules were prose. fig4's author plotted every Ω it had computed.

Secondary: the TikZ path had no lint at all (figlint is matplotlib-only); the `style_guide.md` prose is ~1 k words of voice with hex codes embedded, which a literal-minded model treats as a spec.

## 3. What the literature says (briefly)

- **Multimodal feedback loops work when the feedback is specific and the judge can see** — PlotGen's numeric/lexical/visual feedback agents, MatPlotAgent's visual refinement. Our loop had the shape but a judge that could not see and feedback ("[pass]") that carried no information.
- **Linters beat judgment for the mechanical classes** — McNutt & Kindlmann's matplotlib linter, VizLinter on Vega-Lite specs; sciwrite-lint's figure checks (caption/label consistency). Collisions, clipping, minimum font size, occlusion and series count are all decidable from the artist tree or the PDF text layer.
- **Avoid at authoring time, not only detect** — adjustText for label placement; "direct labeling ≤4 series" is the standard advice in every publication-figure guide.

## 4. The design

**Principle: deterministic where decidable, a seeing judge where not, one style truth, and every instrument with a consumer.**

| layer | mechanism | consumer | status |
|---|---|---|---|
| A. PDF-layer lint | `skills/matplotlib-figures/scripts/figlint-pdf` (PyMuPDF): line-level text collisions, clipping, text < 5 pt **at the figure's print width** (from `\includegraphics`), density warning. Works on matplotlib, TikZ, imported PDFs. | compile gate (C); auditor (D) | built, gate `smoke_figlint_pdf` |
| B. Composition budgets at save time | `figlint_core.py`: WARN > 6 overlaid series, WARN > 4 in-axes annotations, **ERROR legend covers ≥ 3 data points, ERROR inset covers ≥ 3 data points**; findings written to a `<file>.figlint.json` sidecar with the file's md5. | compile gate (C) | built |
| C. **Compile gate** | `compile_latex` refuses to compile while any included figure has a lint ERROR (PDF layer at print width ∪ sidecar with matching md5); lists them with the reproduce command. `LUXAS_FIGLINT_GATE=0` disables. This is a rendering gate like the missing-image and CJK checks, not a methodology gate. | — | built, gate `smoke_figure_gate` |
| D. **A judge that can see** | new `figure_auditor` agent (sonnet, vision), exempt from both profiles (`LUXAS_VISION_AUDIT_MODEL_PROFILE` to override). Procedure: run the lint first (facts), then per figure answer CLAIM / LEGIBLE / OCCLUSION / CLUTTER / SCHEMATIC and give ≤ 3 mechanical FIXES; verdict ship/fix; never restyles; a text-only model must write `unaudited`. Replaces the illustrator audit in the reviewer's finalize loop. | reviewer Step 3 → Step 2 briefs | built |
| E. Single style source | `report/figstyle.mplstyle` is the truth; the prose guide is deployed with a header saying so (init_report and reviewer P2); illustrator checklist item 1 compares against `axes.prop_cycle`, not prose hex codes. | audits | built |
| F. Budgets in the generator | illustrator_write: ≤ 4 series overlaid (optimum + grey envelope otherwise), ≤ 3 annotations, no inset unless briefed, one figure one message; run figlint-pdf before returning. | compile gate | built (prompt) |

What the loop looks like now: brain brief → illustrator_write draws → save-time lint (sidecar) → figlint-pdf at print width → **compile refuses until clean** → figure_auditor (sees) → fixes as mechanical briefs → illustrator applies → compile. Style churn cannot start (one truth); a blind "passed" cannot end the loop (the gate reads the lint, not the prose).

## 5. What I did not build, and why

- **A TikZ-aware layout solver** or automatic label placement (adjustText) inside the hook — authoring-time avoidance is better than detection, but it changes what the scripts draw; do it in P1 as a helper the generator may call, after the gate has shown which defect classes remain.
- **A figure-spec DSL** (Vega-Lite-style declarative specs → rendering) — the strongest structural fix in the literature; too large for one cycle and it would change the brief contract with brain. Revisit if budgets + gate + seeing judge still leave clutter.
- **Replacing K2.5 for generation** — generation is cheap and the gate now bounds its output; the judge is where seeing matters. If the fix rounds under the gate exceed 2 per figure, route generation to sonnet as well.
- Palette conformance as a lint — cheap to add later (colors used at save time vs `axes.prop_cycle`); today the churn was the audit, not the drift.

## 6. Measurement

Next run (the pp-vs-ss measurement run is live on P0 of claims-first; figures v2 lands mid-run and applies to its next compile): count `compile_latex` refusals by figure-lint, fix rounds per figure, figure-agent transcript MB (baseline 13.6 MB / 21 spawns for 5 figures), figure_auditor verdicts vs my own reading of the PNGs (the calibration that K2.5 failed), and — the only number that matters — whether a human looking at the shipped PDF finds a collision. Baseline: 5 of 5 figures had at least one.
