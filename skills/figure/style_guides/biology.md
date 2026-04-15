# Biology (Nature) Figure Style Guide

## Visual voice

A Nature biology figure is quiet, clinical, and data-forward. The recurring mood is *clinical*, *analytical*, *rigorous* — never decorative. Every stroke is functional: thin hairlines, flat fills, no gradients or drop-shadows outside pseudocolored micrographs. The eye moves left-to-right across a schematic banner, then top-to-bottom through dense mosaics of six to twelve panels. Restraint dominates — three to seven hues per figure, and those hues persist unchanged from Figure 1 through Figure 4 as a semantic grammar. If a reader can name the genotype from a color in Fig. 3c without a legend, you are in register.

## Figure 1 schematic conventions

Figure 1 is almost always a *hybrid*: a polished-vector cartoon on top — pathway, pipeline, mouse timeline, genetic construct, or molecular complex — flowing left-to-right into a first row of data panels beneath. The iconographic vocabulary is established: mouse silhouettes, cryovials, brain cross-sections, timeline arrows, rounded-rectangle exon boxes, coiled-coil protein ovals, colored domain bars (NoLS blue, Killswitch gold), H&E or fluorescence inserts framed by dashed white ellipses. Lines are 0.5–0.75 pt uniform hairlines, orthogonal. Arrowheads are small, filled, solid triangles — never open. Alignment is grid-tight; whitespace generous around the banner, tight within data panels. Figure 1 telegraphs the paper's color semantics: if blue will mean "wildtype" in Fig. 4, it first appears on a cartoon vial in Fig. 1a. Signature moves include color-coded rectangular arm labels that double as a legend-within-diagram (mTOR=blue-purple, MEK=yellow-green, EGFR=pink), Boolean check/X state matrices above protocol flows, and shaded tan swimlane boxes grouping computational stages.

## Palette

Palettes are disciplined categorical sets of three to seven hues. The dominant convention is condition-identity: **black (#000000 or #1a1a1a) = wildtype**, **white or open = empty-vector / GFP control**, **warm red or brick (#C0392B, #D94F3D, #E83B2A) = rescue or perturbation**, **navy or cobalt (#1A3A6B, #2166AC, #2471A3) = mutant / loss-of-function**, medium grey (#808080–#CCCCCC) = non-significant or background. Three real combinations: (1) *immunology/genetics* — black WT + brick-red complement + navy mutant + white vector; (2) *single-cell / spatial omics* — cobalt #2166AC, orange #F4A442, teal #3A9E7E, dusty rose #E07B8A, lavender #9B72B0, salmon #D04E3A, sky blue #87CEEB against light-grey #CCCCCC background; (3) *imaging / biophysics* — cyan ~#00BFBF for DNA, crimson ~#B22222 for protein, vivid green #00B050 and magenta #FF00C8 for GFP/RFP dual-channel.

## Color conventions

Hue is fixed per condition across every panel. Warm hues (red, orange, amber) mean "up / gain / high / significant"; cool hues (blue, navy, teal) mean "down / loss / control"; grey is always unselected background or non-significant. Green-vs-magenta is the reserved dual-channel fluorescence pair. Transparency is functional only: alpha 0.2–0.3 on CI bands behind mean traces, 0.4–0.6 on dense UMAP scatter, light alpha on jittered strip-plot dots. No CI shading on bars; no tinted panel backgrounds except rare beige meta-panel summaries.

## Markers & data encoding

Filled circles dominate — 3–7 pt for individual biological replicates overlaid on bars and strip plots. A second shape encodes something real: open circles vs filled squares map WT vs KO (fill = genotype); filled squares are the forest-plot point-estimate convention; diamonds mark cis-regulatory elements in GRN diagrams; downward triangles call out response-latency onsets. Open markers carry 0.3–0.75 pt black stroke; filled markers have no stroke. Size rarely encodes magnitude except in dot-plot bubbles (area = AUCell score) and lollipop heads (radius = variant count). Color differentiates condition; shape differentiates data type.

## Lines & hierarchy

Weights live in a narrow band: 0.5 pt for axis spines and schematic hairlines, 0.75 pt for bar outlines and error bars, 1.0–1.5 pt for primary data traces, up to 2 pt for GRN edges that must pop. Dash patterns are semantic: **solid = primary / observed / familiar**, **dashed = control / shuffled / unfamiliar / extended-CI / tissue-ROI outline**. Z-order is strict: grey background first, colored foreground on top, black overlay dots last as the visual pop.

## Bars & heatmaps

Bars are flat-filled rectangles with a thin black outline at 0.5–0.75 pt — never borderless except in dense waterfall charts. Width is moderate; grouped clusters use a narrow ~0.15-bar-width inter-bar gap with wider inter-group gutters. Error caps are flat-black, proportional to bar width. No labels on the bar face; p-values hang above on thin bracket lines written as "P < 0.0001" or "P = 0.005" in plain text (exception: **** for extreme, NS for non-significant). Individual replicate dots overlay in matched-or-contrasting color with ~0.5 pt black stroke.

Heatmaps are the dominant omics readout and follow two rigid conventions. **Diverging red-white-blue (RdBu, centered at zero)** for log2FC, differential expression, observed/expected Hi-C, normalized firing rate — red = up, blue = down, white = zero; scale typically ±1 to ±10. **Sequential white-to-deep-red or white-to-navy** for absolute ChIP pileups, Hi-C contact frequency (log scale), or expression magnitude; viridis-adjacent dark-purple-to-cream appears for TF expression. Cells are rectangular with no inter-cell gap — thin white separators only between major row or column groups. Small log2FC heatmaps carry in-cell numeric values at ~6 pt; large omics heatmaps never do. Colorbars are thin-tall vertical on the right (endpoints plus midpoint zero labeled) or thin-wide horizontal inset bottom-left. Fluorescence micrographs use thermal lookup (black→blue→cyan→yellow→red→white) with a numberless High/Low bar.

## Typography

Sans-serif throughout — Helvetica or Arial, period. Panel letters 9–11 pt bold lowercase (occasionally italic) top-left, axis titles 7–9 pt regular, tick labels 6–8 pt regular, in-cell heatmap numbers and inline p-values 6–7 pt. Bold is reserved for panel letters and occasional section-header row dividers. Gene names italicize; Greek letters, superscripts, and units (μm, kbp, s⁻¹, pN) render as inline unicode. Voice is compact and neutral.

## Composition & whitespace

Figures are mosaic grids, typically three to four rows of two to four panels, with irregular sizing that lets a hero heatmap or micrograph strip span full width. Panel letters sit top-left without an enclosing box. Inter-panel gutters are tight (2–8 mm); outer margins moderate. Axes use a **bottom-left-only L-frame** — top and right spines removed, no gridlines, outward major ticks only at 3–5 per axis. UMAP and spatial panels often drop spines entirely and substitute a small L-shaped arrow indicator in the corner. Scale bars lock to the bottom-right of every micrograph; n-values tuck into panel corners.

## Error representation

Three forms dominate. **Mean ± SEM with capped flat-black error bars** on bars. **Shaded CI bands at alpha 0.2–0.3 color-matched to the mean line** on time-series, FRAP, and Kaplan-Meier curves — smooth-edged, never capped. **Box-and-whisker with IQR box, median line, whiskers to 1.5×IQR, individual replicate dots overlaid in matched color** for distributions; increasingly replaced by dot-strip plots with a horizontal median line and jittered points, now the default for small-n biological replicates. Error bars are always solid black regardless of bar color. Forest-plot CI whiskers use plain butt terminations without caps.

## Signature moves

Strict condition-color identity across every panel so readers cross-reference by hue alone; individual replicate dots overlaid on every bar and box, often colored by independent-experiment identity to expose batch variability; bottom-left L-frame axes with zero gridlines; diverging red-white-blue heatmaps with in-cell log2FC numbers for small matrices, sequential white-to-red for large omics; thermal pseudocolor micrographs with numberless High/Low bar; grey-out-then-highlight small multiples where a single cluster pops against light-grey background; paired overview-and-magnified micrograph diptychs with identical channel layout; solid-vs-dashed coding for familiar-vs-unfamiliar or observed-vs-shuffled; Boolean check/X icon matrices replacing wordy condition labels; exact-P-value bracket annotations in plain text; and the triptych fluorescence layout (channel-A | channel-B | merge) with dashed white nuclear outlines.
