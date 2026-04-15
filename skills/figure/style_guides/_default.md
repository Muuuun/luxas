# Default Figure Style Guide (generic / unknown domain)

Used when domain detection fails or the project doesn't fit one of the six mined Nature domains. Conservative, publication-safe, colorblind-friendly. Lifted from defaults that hold across most science venues; **prefer a domain-specific guide if one applies** (`physics.md`, `biology.md`, `chemistry.md`, `earth.md`, `ml.md`, `policy.md`).

> **Adoption rule when this fallback is in use**: be conservative — preserve project conventions where they already exist; do not aggressively rewrite plot script hex codes / markers to match this guide. (Domain-specific guides invert the rule: when `physics.md` etc. is in use, the guide IS the ground truth and plot scripts must conform.)

## Visual voice

Restrained, technical, colorblind-safe. Plain white background, no decorative ornament. The figure should feel "made by a careful scientist", not styled.

## Palette

Okabe-Ito (8 hues, designed for colorblind safety). Use these in order for categorical data:

| Role | Hex | Name |
|---|---|---|
| Primary | `#0072B2` | blue |
| Secondary | `#D55E00` | vermillion |
| Tertiary | `#009E73` | green |
| Quaternary | `#CC79A7` | reddish-purple |
| Reference / muted | `#F0E442` | yellow |
| Sky-blue accent | `#56B4E9` | sky-blue |
| Orange accent | `#E69F00` | orange |
| Neutral | `#000000` | black |

For grey reference: `#999999`. Two-color working pair: blue + vermillion.

## Color conventions

- Categorical data → distinct hues from the palette in the order above.
- Sequential data → `viridis` (preferred, perceptually uniform) or `cividis` (colorblind-safe).
- Diverging data → `RdBu_r` centered at zero.
- Marker color matched to its line color. Reference / null lines in grey `#999999` dashed.
- Transparency for overlapping scatter or CI bands: `alpha = 0.2–0.3`.

## Markers

Filled circles by default. Open squares for secondary series. Down-triangles for upper limits. Cross/plus for excluded data.
- Size: `5–7 pt`, uniform within a series.
- Edge: thin black `0.5 pt`, OR borderless when fill is dark and contrasts the background.

## Lines

- Main data: solid `1.0 pt`.
- Fits / theory: dashed `1.0 pt` in same hue as the data they fit.
- Reference / null: dotted `0.5–0.75 pt` in grey.
- Round line ends; no shadows or glow.

## Bars

Flat-filled with thin black outline (`0.5 pt`). Capped error bars (flat black, `~2 pt` cap width). Bars at `0.7` width ratio, single series unclustered unless comparing groups.

## Heatmaps

- Square cells, no separators (or hairline white `0.25 pt` if cell counts < 50).
- Sequential colormap = `viridis`, diverging = `RdBu_r`.
- Right-strip colorbar, label perpendicular at midpoint.

## Typography

- Sans-serif throughout (Helvetica / Arial / DejaVu Sans).
- Axis labels `9–10 pt`, tick labels `7–8 pt`, panel labels `(a)` bold `9–10 pt`, legend `7–8 pt`.
- Math via `mathtext` (matplotlib) or full LaTeX if document uses it.
- Panel labels lowercase bold in upper-left, inside or just outside the panel frame.

## Composition

- Multi-panel: grid layout, equal margins, generous gutters between panels (`~10–15 pt`).
- Inward ticks, major-only on most axes; minor ticks only for log axes.
- Spine style: bottom-left only (drop top + right) is the safe default; all-four for image / heatmap panels.
- No gridlines (or very faint dashed light-grey if data demands them).
- Whitespace generous; legends placed inside the plot only when they don't overlap data.

## Error representation

- Bar / point data → capped error bars, `±SEM` or `±SD` per convention.
- Continuous curves → shaded CI band, alpha `0.2`, color matched to the curve.
- No raw error bars on lines — use bands.

## Signature moves

1. Sober two-color pairing (blue + vermillion) is the default for primary vs comparison series.
2. Bottom-left L-frame spines with no gridlines.
3. Legend frameless (`frameon=False`), inside the plot, top-right or bottom-right.
4. Panel labels bold lowercase inside the frame.
5. CI bands over error bars wherever a curve is involved.
