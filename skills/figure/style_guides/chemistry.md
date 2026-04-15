# Chemistry (Nature) Figure Style Guide

## Visual voice

Clinical and systematic — molecular craft does the rhetorical work and typography steps back. Figures read like instrument output lightly dressed in vector polish: a TEM micrograph, XRD trace, or APT point cloud sits beside a ball-and-stick render with nothing dominating. Warmth comes from a single saturated accent (magenta, salmon, amber) carried across panels; the rest stays muted and semantically pinned. No drop shadows, no data gradients, no gratuitous 3D. Scale hierarchies (wafer → TEM → atoms; bulk → monolayer → molecule) drive the narrative through tight 3×2 or 2×3 mosaics.

## Figure 1 schematic conventions

Fig 1 is almost always a hybrid: 2D skeletal formulas or reaction schemes cohabit with a 3D ball-and-stick or CPK render and often an instrument micrograph. Reaction schemes use bold-triangle filled arrowheads for forward steps, thin double-headed arrows for equilibria, and thin hairline curves with small filled heads for electron-push mechanism. Mechanistic highlight comes from selectively coloring a single bond (blue for a reactive acyl linkage, red for a leaving halogen) against an otherwise black skeleton. Dashed bonds follow a fixed convention: green = H-bonds, gold/orange = π–π stacking, legended inline on the render. CPK coloring stays textbook (red=O, blue=N, grey=C, white=H) with metal-specific hues for Zn, Ru, Cu, Au. Compound identity is signaled by bold italic labels (e.g. **H₄CTNL**) or colored bounding boxes (salmon/green/blue for three synthetic generations). Yields appear bold black inline next to arrows; Roman numerals label conditions. Dotted-border inset boxes isolate zoom-ins beside parent renders.

## Palette

A tight 3–5 hue categorical palette dominates, one warm accent doing the semantic heavy lifting. Recurring primaries: navy/cobalt `#1a3a6b`–`#2B6CBF` (reference, ordered, Ni, aryl/sp2), brick/crimson `#C0392B`–`#c94040` (experimental, disordered, Co), forest green `#27AE60`–`#2E7D32` (third category, control), burnt orange/amber `#e67e22`–`#F5A623` (Fe, annotation, alkyl), and a signature magenta `#d63f8c`–`#e6007e` or salmon `#f08080` reserved for the headline condition. Supporting accents: cyan/teal `#00bcd4`, gold `#ffc107`, slate grey `#5f6368`. Saturation is vivid on traces, matte on 3D renders; temperature mixes so warm/cool opposition does semantic duty.

## Color conventions

Color is always semantic. One hue = one identity, enforced across every panel: Ni=navy, Co=red, Fe=orange, Ta=teal, Al=grey; or S-variant=blue, M=red, L=green. Sequential ramps encode continuous parameters (dark→bright for pressure; cool→warm for time evolution in transient absorption). Diverging blue↔red ramps appear on electron-density contour maps and enrichment heatmaps with independent top/bottom colorbars. Grey-dashed traces are the universal zero-reference baseline. Soft blue vs orange background bands (α≈0.2) turn an x-axis into a spatial phase map. Transparency stays sparing: α≈0.2 for CI bands and phase shading, α≈0.4–0.5 for peak-decomposition fills under Raman/XPS curves.

## Markers & data encoding

Open vs filled is the primary semantic axis: open circles/squares for raw data or fracture endpoints, filled for fits or UTS points; open circle with thick colored ring (~1.5 pt) flags outliers and champion points. Shape families separate dataset origin (squares=experiment, circles=model, stars=headline result). Sizes run 3–8 pt, with occasional 12 pt enlargement to single out a champion point (e.g. the M-MCA open star on Ashby plots) without text callout. Strokes ~0.75–1.5 pt color-matched; open markers carry white interior.

## Lines & hierarchy

Weights run 0.75–1.5 pt for data traces, ~2 pt for mean/summary lines and stress–strain curves, ~0.5 pt for chemical bonds, ~3 pt for cartoon loops or process arrows. Joins rounded; ends butt for spectra, rounded for smooth fits. Z-order keeps raw black traces above colored fitted fills and measured curves above dashed references; no white halos. Hierarchy is built by size and saturation, not stroke weight — the hero 3D render or XRD panel dominates by footprint.

## Bars & heatmaps

Bars are flat-filled with no outline or a thin ~0.5 pt black border, moderate width (~0.6 relative), single-cluster, with raw points overlaid as scatter. Error caps are flat, ~0.75 pt, black or color-matched. Heatmaps use rectangular cells with thin white separators (~0.5 pt); colormaps are diverging blue-to-yellow-red (turbo/jet-like) for enrichment data, sequential green-yellow-orange-red for cohesive energy, or a three-tone semantic ramp (green=susceptible, white=intermediate, red=resistant) for MIC tables. Numeric cell annotations in white or black by luminance. Colorbars are right-side thin-tall or inset thin-wide, endpoints plus midpoint labeled.

## Typography

Sans-serif throughout (Arial/Helvetica, Nature house style). Hierarchy is compact: panel labels bold lowercase **a, b, c** at ~10–11 pt top-left with no box; axis titles ~8–9 pt regular; tick labels ~7–8 pt; in-plot annotations ~7–8 pt; in-cell heatmap numbers ~6–7 pt. Regular weight everywhere except panel letters. Math renders as inline unicode with italic variables (σ, ε, ΔF/F₀, sp², *E*_p/2); units stay plain text. Voice is neutral and data-first.

## Composition & whitespace

Grid-tight mosaics — 3×2, 2×3, 4×2 — with ~4–6 pt gutters and consistent panel heights. Spines bottom-left-only (L-frame) on line/scatter plots; full four-sided frames on heatmaps and spectra. Gridlines absent, replaced by major-only inward ticks, 4–6 per axis. Whitespace is tight within panels, moderate between, generous around schematic Fig 1s. Legends sit inside plot areas where space permits; annotation density runs heavy in structural/TEM panels (bond lengths, angles), sparse in AFM/force panels.

## Error representation

Error bars are color-matched, full opacity, flat horizontal caps ~2 pt wide — no tapers, no whiskers. Shaded CI bands (α≈0.2, color-matched) appear on photometry and kinetic fits; discrete error bars sit on APT profiles, bar charts, and stress–strain endpoints. Inline `±` values (e.g. *E* = 1.77 ± 0.16 GPa) in matching colors replace error bars where only one or two values need flagging. Significance is bracket + p-value stars above bars, never value-on-bar.

## Signature moves

Phase-region background shading (soft blue L1₂ vs soft orange fcc) turning a distance axis into a spatial phase map. Single-bond color highlights (blue acyl, red halogen) as mechanistic shorthand. Three-color semantic boxing (salmon/green/blue) tracing compound generations through a synthesis. Dual-color dashed legends (green H-bond + gold π–π) inlaid on molecular packing renders. Proportional Venn circles for commercial-compound chemical space. Open-star champion markers on Ashby plots. Cyan translucent rectangles flagging stimulus epochs across time-courses. Raw points scattered over every bar. And the recurring editorial gesture: one warm accent reserved for the headline claim, carried unchanging across every figure.
