# figspec — the only way to make a data figure

`figspec <spec.json>` renders a JSON spec through a fixed template. The author fills the
spec; the renderer owns composition, style (`report/figstyle.mplstyle`), marker policy,
label placement (occupancy-aware: never over a line, a text, a reference line or the frame),
legends (never inside the axes — series are labelled directly in the right margin or at a
free spot), panel letters, sizes. No matplotlib is written by an agent for a data figure.

```json
{ "out": "report/figures/fig3_gain_vs_anisotropy",        // writes .pdf + .png
  "width": "single" | "double",  "layout": "row" | "column",  "sharex": true,
  "panels": [ {
    "label": "a",  "xlabel": "...", "ylabel": "...",  "xscale": "log", "yscale": "log",
    "xlim": [lo, hi], "ylim": [lo, hi],
    "series": [ { "x": REF, "y": REF, "label": "computed", "role": "data" | "model" | "envelope",
                  "sigma": REF, "ylo": REF, "yhi": REF } ],          // ≤ 4 data series
    "bands":    [ { "axis": "x" | "y", "from": a, "to": b, "label": "viable" } ],
    "reflines": [ { "axis": "x" | "y", "value": v, "label": "strong blockade" } ],
    "highlight": { "series": 0, "at": 2.0, "label": "{y:.2f}×" }   // ONE per panel; the number is looked up, never typed
  } ] }
```

`REF` is a data reference — never an array typed by hand for measured data:
`{"csv": "data/experiments/E2_x/runs/run_1/data/gain.csv", "col": "gain"}`;
`{"csv": ..., "cols": ["1","2","5"], "reduce": "min" | "max" | "mean"}` (envelopes);
`{"expr": "x**(1/6)"}` (a model curve over the series' own x); `{"logspace": [1, 1000, 100]}`;
a literal list is allowed only for a model grid or a documented constant.

Rules the renderer enforces (do not fight them): markers only when a series has ≤ 16 points;
`model` role is a thin dashed black line; `envelope` is a tint of the first colour; reference-line
labels live in the margins; band labels in the reserved headroom; one highlight per panel;
no insets — a second view is a second panel; no boxes, no arrows crossing data.
If a label cannot be placed the renderer says so on stderr — reduce content, do not add text.
Schematics (TikZ) are not figspec: use `skills/figure/templates/schematic_slots.tex`.

## Forms beyond y(x) (figures v3.1)

- **Uncertainty**: `"sigma": REF` on a series draws ±1σ error bars (≤ 16 points) or a 1σ band (dense, or `"band": true`). REF may be `{"expr": "0.03*y"}` — `y` is the series' own y. The σ of a headline quantity comes from `results.json computed.quantities[].sigma`; a headline figure without it is incomplete.
- **Heatmap + contour** (`"type": "heatmap"`): `"x": REF, "y": REF` (grid axes), `"z": {"csv": path, "cols": [...]}` (one column per y value, rows along x) or a 2-D list; `"contours": [0.99]` draws the level(s) that carry the claim; `"zlabel"`, `"zlim"`, `"cmap"` (default viridis); `"highlight": {"x": .., "y": .., "label": ..}`. Use it whenever the result is a function of two controls (F(R, Ω), not an envelope of curves).
- **Polar** (`"type": "polar"`): series `x` in degrees, `y` the radius; `"zero": "N"` puts 0° at the top (quantization axis; θ then opens clockwise toward +x unless `"clockwise": false`), `"thetalim": [0, 90]`; reflines with `"axis": "theta"`. For anisotropies C₆(θ).
- **Composite**: `"layout": "grid", "ncols": 2` with panels of mixed type — a Nature-style Fig. 1 is schematic (TikZ, separate) + polar + comparison in one grid.

Spec-level honesty fields: `"points_note": "…"` (why a sweep has < 20 points — e.g. a discrete lattice angle set) and `"sigma_note": "…"` (why a series shows no σ). Without them the finish gate lists the figure under `figure-data` (coarse sweep / no σ on the page).
