# ML / AI — Nature Figure Style Guide

## Visual voice

Nature-class ML figures read as *clinical-industrial*: spare, technical, unsentimental. They lean on four to five flat hues against pure white, every element either a sans-serif label, a flat-filled vector block, a thin directional arrow, or a hairline data trace. Nothing glows, nothing drifts off-grid, drop shadows are absent or whisper-subtle beneath a chip render. Mood words cluster around *clinical*, *precise*, *analytical*, *industrial* — the figures want to look etched into silicon. Decoration is zero; semantic density is high; alignment is "grid-tight".

## Figure 1 schematic conventions

Figure 1 is almost always an architecture-or-pipeline diagram, polished vector, flowing left-to-right with an optional feedback loop curving back at the top. Dominant iconography: flat rounded rectangles as neural-network blocks (often a short stack of translucent tiles to connote transformer layers), labeled boxes for DFT / tokenizer / dataset / decoder stages, bold-triangle arrowheads on ~1–1.5pt shafts, and — in AI-for-science papers — a 3D molecular ribbon rainbow-colored by chain, or an isometric chip render anchoring one corner. The central model block is the largest, darkest-saturated object, often outlined in warm amber or red to read as *the AI*; inputs/outputs (proteins, images, spectrograms) flank it in cooler or photographic tones. Callouts use offset lead-lines with plain sans-serif labels; legends sit inline. Craft is high: crisp beziers, hard edges, flat fills. A recurring move is the quantitative inset — loss curve, confusion matrix thumbnail, RMSD trace — embedded into the schematic to fuse concept with validation.

## Palette

The palette is narrow and recurs with striking consistency. Teal-cyan in `#2E8B7A`–`#3DBFBF` is the single most common primary — it encodes "our method", "photonic hardware", or "designed/learned" across roughly half the corpus — paired with one warm counterpart: crimson/coral `#B22222`–`#E8806A`, or amber-orange `#E8A020`–`#F5A623`. Secondary structure: deep navy/cobalt (`#1F4E8C`, `#2255CC`, `#4169E1`) for reference curves, medium purple (`#5B4EA0`, `#7B5EA7`) for in-silico or theory, neutral mid-grey (`#A8A8A8`–`#B5B5B5`) for the classical baseline the method is beating. Saturation is mixed: vivid at the stroke, muted inside CI bands.

## Color conventions

Color is strictly semantic and pinned globally across every figure of a paper. One hue equals one method — teal = proposed model, grey or dashed-black = conventional baseline, purple = simulation/theory, amber = experimental ground truth. Row-background tints (pale green vs. pale salmon) occasionally stripe a Figure 1 to pre-attentively separate paradigm families. Transparency is purposeful: ~0.15–0.25 alpha on CI bands matched to the parent hue, ~0.6 on histogram fills, light wash for grouping-bands in block diagrams.

## Markers & data encoding

Scatter and kinetic plots use a small vocabulary: filled circles at 4–7pt for the primary method, filled squares for a digital/ANN baseline, filled downward triangles for a transfer or ablated variant, and open circles (~1pt stroke, white fill) for "original" references. Stroke is absent or a thin 0.5pt match to fill. Shape encodes method class, never magnitude; color carries system identity. In t-SNE embeddings the rule flips — uniform circles, class identity by a 10-hue viridis-like rainbow.

## Lines & hierarchy

Primary data lines sit at 1.0–1.8pt, references drop to 0.75pt. Solid = primary method and experimental data; long-dashed = theoretical prediction, recalibrated variant, or reference spectrum; dotted = secondary ablation; dash-dot distinguishes sibling variants within one family (hue preserves family, dash encodes variant). Ends are rounded, z-order places the proposed method on top with no white halo. Dashed horizontal references — HWA benchmark, significance threshold, ground-truth spectrum — cut across bar charts as anchors.

## Bars & ablation tables

Bar charts are the workhorse of ML results and follow a uniform recipe: flat-filled, borderless or with a thin ~0.5pt dark outline, moderate width, grouped in clusters of two to four with a small within-group gap and a wider between-group gap. Individual seed/replicate points overlay the bar as 3pt filled dots at ~70% alpha — the genre's preferred substitute for box plots, making n and dispersion visible at a glance. Error caps are flat-black and short. Category labels sit below rotated 0° or 45°; numeric values float at bar ends, or in assertive papers print in bold red numerals above each bar. A dashed horizontal benchmark cuts the full width.

## Typography

Sans-serif throughout, Helvetica or Arial in Nature house style. Panel letters (bold lowercase a, b, c…) at 10–11pt, flush top-left; axis titles 8–9pt regular; tick labels 7–8pt; inline annotations 6–7pt. Regular weight dominates; bold is reserved for panel letters and occasional on-bar accuracy callouts. Math renders as inline unicode/mathtext — subscripts, Δ, ± — with italic variable names; no display LaTeX.

## Composition & whitespace

Panel layout is *mosaic*: irregular grids of mixed panel sizes, 2×3 or 2×4 with occasional full-width rows. Inter-panel gutters ~8–16pt, internal margins tight. Spines are minimalist L-frames — bottom and left only — with no gridlines. Ticks outward, major-only, 3–6 per axis. Annotation density is moderate to heavy, but in-panel whitespace stays generous enough that the figure reads information-dense rather than cramped.

## Error representation

Seed variance takes two dominant forms. On line plots and learning curves: shaded CI bands at ~0.15–0.25 alpha, color-matched to the parent line, no bounding stroke — the universal treatment for iteration curves, RMSD trajectories, and bootstrap intervals over multiple seeds. On bar charts: flat-black capped error bars on 1pt shafts, with individual replicate dots scatter-overlaid on the bar fill for raw distribution visibility. The primary method always draws on top.

## Signature moves

Three gestures mark a figure as Nature-ML-native. First, rigorous global color semantics — one hue per method, held constant across every figure, so the reader tracks "teal = ours" without re-reading legends. Second, the quantitative-inset-inside-schematic — a loss curve or confusion matrix thumbnail embedded directly into the Figure 1 pipeline, collapsing concept into validation. Third, seeds-as-scatter — individual replicate points dotted over grouped bar charts at moderate alpha, delivering the integrity of a strip plot inside the compactness of a bar and silently communicating that the headline number is a mean over many runs.
