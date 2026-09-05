# figspec — the only way to make a data figure

`figspec <spec.json>` renders a JSON spec through a fixed template. The author fills the
spec; the renderer owns composition, style (`report/figstyle.mplstyle`), marker policy,
label placement (occupancy-aware: never over a line, a text, a reference line or the frame),
legends (never — series are labelled directly at their right end), panel letters, sizes.
No matplotlib is written by an agent for a data figure.

**The grammar is strict (figures v4).** An unknown key is an error naming the nearest valid
key; matplotlib vocabulary (`title`, `legend`, `style`, `color`, `annotations`, `linewidth`,
`inset`) is refused with the figspec word to use instead. Exit 0 means rendered clean.
Exit 2 means the spec was refused OR the figure was written but is **not done**: a label
that could not be placed, more than five series on one axes, a figure that prints taller
than 6.5 in. Those findings also land in `<out>.pdf.figlint.json`, which `compile_latex`
reads — an exit-2 figure cannot be compiled into the report until the spec is fixed.

```json
{ "out": "report/figures/fig3_gain_vs_anisotropy",        // writes .pdf + .png
  "width": "single" | "1.5" | "double",   // 89 / 120 / 183 mm (Nature)
  "layout": "row" | "column" | "grid",  "sharex": true,  "sharey": true,   // sharey defaults to true when every panel plots the same quantity
  "panels": [ {
    "label": "a",  "tag": "T = 4 K",                          // tag = the panel's condition, drawn inside the frame
    "xlabel": "...", "ylabel": "...",  "xscale": "log", "yscale": "log",
    "xlim": [lo, hi], "ylim": [lo, hi],
    "series": [ { "x": REF, "y": REF, "label": "computed",
                  "role": "data" | "model" | "envelope" | "reference",
                  "group": "Ba",                            // one hue per group; variants within a group differ by line style
                  "linestyle": "solid|dashed|dotted|dashdot",   // "--" / ":" / "-." accepted
                  "markers": false,                         // default: markers iff ≤ 16 points and not a computed curve
                  "sigma": REF, "sigma_kind": "sd" | "sem" | "ci95" | "ci68" | "range",   // sigma_kind is REQUIRED with sigma
                  "band": true, "ylo": REF, "yhi": REF } ],   // ≤ 4 foreground series (5 hard cap) + ≤ 4 grey references
    "bands":    [ { "axis": "x" | "y", "from": a, "to": b, "label": "viable" } ],
    "reflines": [ { "axis": "x" | "y", "value": v, "label": "strong blockade" } ],
    "highlight": [ { "series": 0, "at": 2.0, "label": "{y:.2f}×" },            // ≤ 2 per panel: the claim's words at the x where
                   { "series": 1, "at": 85, "label": "above Rb, Cs, Sr" } ]   // the relation holds, or a looked-up number (never typed)
  } ] }
```

`REF` is a data reference — never an array typed by hand for measured data:
`{"csv": "data/experiments/E2_x/runs/run_1/data/gain.csv", "col": "gain"}`;
`{"csv": ..., "col": ..., "where": {"atom": "Rb", "l": 0}}` (**row filter** — a mixed-species
table is selected by value, never plotted whole; x and y take the same `where`);
`{"csv": ..., "cols": ["1","2","5"], "reduce": "min" | "max" | "mean"}` (envelopes);
`{"expr": "x**(1/6)"}` (a model curve over the series' own x); `{"logspace": [1, 1000, 100]}`;
a literal list is allowed only for a model grid or a documented constant (a single literature
point `"x": [60], "y": [121.64]` is drawn as one marker with its label).

Roles: `data` (palette colour, or its group's hue; filled markers) — the foreground, ≤ 4 per axes;
`reference` (grey, thin, **open** markers, end-labelled; line-style variants; ≤ 4 per axes) — a literature
or other-species curve, drawn **individually whenever the claim names it**; `model` (thin dashed black);
`envelope` (a tint band between `ylo` and `yhi`) — only for references the claim treats as a set
("the other lanthanides"), never for one it names: a band hides exactly the comparison a referee wants
(2026-09-05 test: a clean figure with the references in a band lost 7 of 8 referee votes to a cluttered
one that drew them individually and wrote the claim next to the curves).

**The claim's words go on the page.** `highlight` takes one or two callouts per panel: `{"series": i,
"at": x0, "label": "…"}` puts a ring at the looked-up point and ≤ 5 words beside it — the relation the
claim states there ("below all four references", "above Rb, Cs, Sr") or a looked-up number
(`"{y:.2f}×"`, `"{y:.2e}"` is typeset as $1.05\times10^{-5}$). A figure whose claim is only
inferable from the curves is not finished; the auditor's CLAIM line checks for the words.

## Nature methodology the renderer enforces (figures v4.1, 2026-09-05)

From Nature's artwork guide and the *Points of View* columns (Wong, Krzywinski, 2010–13):
- **Colour is categorical and colour-blind safe.** The palette is `report/figstyle.mplstyle`; a prose style
  guide never overrides it. Two hues a deuteranope cannot separate on one axes (tab10 red/green) are
  drawn with different line styles and a warning names the pair.
- **Text contrast.** A label set in its series colour is darkened until it reads at WCAG 4.5 on white
  (Okabe-Ito yellow becomes olive as text; the line keeps its colour).
- **Quantity to colour.** `cmap` must be sequential (viridis, cividis, inferno, magma, plasma, Blues, …);
  rainbow maps (jet, turbo, hsv, Spectral, …) are refused. A signed quantity says `"diverging": true`
  (`"center"` if the meaningful zero is not 0): RdBu_r, limits symmetric about the centre.
- **Error bars say what they are.** `sigma` requires `sigma_kind`; the renderer prints
  `caption must state: error bars, ±1 s.d. (label)` and stores it in the sidecar — the caption must echo it.
- **Fixed scales across panels.** A row/grid whose panels share the y quantity shares the y axis (union
  of limits), tick labels once, title once; a stacked column shows x tick labels and the x title only on
  the bottom panel; no offset multipliers (fold the scale into the unit).
- **Symbols carry hierarchy.** Primary data filled, references open.
- **Sizes.** Panel letters `min(10, font.size + 1)` pt bold (8 pt under the Nature style), labels
  ≤ `font.size` (7 pt under Nature); widths 89 / 120 / 183 mm.
- **Simplify.** Series of one `group` whose labels repeat the group word ("Ba, 2 W", "Ba, 20 mW") are set
  as a header "Ba" over "2 W" / "20 mW" in the margin.

Rules the renderer enforces (do not fight them): markers only when a series has ≤ 16 points
and is not an `expr` curve; reference-line labels live in the margins; band labels in the
reserved headroom; one highlight per panel; the `tag` goes to a free corner inside the frame,
else above the top spine; no insets — a second view is a second panel; no boxes, no arrows
crossing data; a stacked (`column`) panel is 2.45 in tall, a `double` row figure is 7 in wide.
If a label cannot be placed the renderer says so and exits 2 — shorten the label (the caption
carries the sentence) or remove content; never add text. It also warns when a series is
mostly outside the authored limits, when the data fills < 35 % of an axis, and when more
than four series share an axes.
Schematics (TikZ) are not figspec: `skills/figure/templates/schematic_slots.tex`; energy-level
diagrams are `levelspec` (`skills/figure/scripts/levelspec`, grammar in
`skills/figure/references/levelspec_schema.md`).

## Forms beyond y(x) (figures v3.1)

- **Uncertainty**: `"sigma": REF` on a series draws ±1σ error bars (≤ 16 points) or a 1σ band (dense, or `"band": true`). REF may be `{"expr": "0.03*y"}` — `y` is the series' own y. The σ of a headline quantity comes from `results.json computed.quantities[].sigma`; a headline figure without it is incomplete.
- **Heatmap + contour** (`"type": "heatmap"`): `"x": REF, "y": REF` (grid axes), `"z": {"csv": path, "cols": [...]}` (one column per y value, rows along x) or a 2-D list; `"contours": [0.99]` draws the level(s) that carry the claim; `"zlabel"`, `"zlim"`, `"cmap"` (sequential, default viridis), `"diverging": true` + `"center"` for a signed quantity (RdBu_r, symmetric); `"highlight": {"x": .., "y": .., "label": ..}`. Use it whenever the result is a function of two controls (F(R, Ω), not an envelope of curves). A grid coarser than ~12 × 12 is warned — it reads as a table.
- **Polar** (`"type": "polar"`): series `x` in degrees, `y` the radius; `"zero": "N"` puts 0° at the top (quantization axis; θ then opens clockwise toward +x unless `"clockwise": false`), `"thetalim": [0, 90]`; reflines with `"axis": "theta"`. For anisotropies C₆(θ).
- **Composite**: `"layout": "grid", "ncols": 2` with panels of mixed type — a Nature-style Fig. 1 is schematic (TikZ, separate) + polar + comparison in one grid.

Spec-level honesty fields: `"points_note": "…"` (why a sweep has < 20 points — e.g. a discrete lattice angle set) and `"sigma_note": "…"` (why a series shows no σ). Without them the finish gate lists the figure under `figure-data` (coarse sweep / no σ on the page).

**The spec is the editable source.** A reviewer or PI asking for "a standalone plotting script on disk" is asking for the `.figspec.json` — it is the script. Per-series `linestyle`, `group`, `role`, `sigma`, `band`, `markers`, the panel `tag`, bands, reflines and the single highlight are the knobs; a caption must describe what the spec draws (say "dashed" only if the series has `"linestyle": "dashed"` or is the second member of its group).

## Worked example — the Ba frontier as it should have been (two panels, one comparison each)

```json
{ "out": "report/figures/gate_infidelity_frontier", "width": "double", "layout": "row",
  "panels": [
    { "label": "a", "tag": "T = 4 K", "xlabel": "Principal quantum number $n$", "ylabel": "Gate infidelity $\\epsilon$",
      "yscale": "log", "xlim": [40, 100], "ylim": [3e-6, 1e-2],
      "series": [
        { "x": {"csv": "…/frontier_4K.csv", "col": "n"}, "y": {"csv": "…/frontier_4K.csv", "col": "Ba_qd_eps_decay"}, "label": "Ba, 2 W", "group": "Ba" },
        { "x": {"csv": "…/ba_decay_20mw_4K.csv", "col": "n"}, "y": {"csv": "…/ba_decay_20mw_4K.csv", "col": "eps_decay_20mw"}, "label": "Ba, 20 mW", "group": "Ba" },
        { "x": {"csv": "…/frontier_4K.csv", "col": "n"}, "y": {"csv": "…/frontier_4K.csv", "col": "Sr_eps_decay"}, "label": "Sr", "role": "reference" },
        { "x": {"csv": "…/frontier_4K.csv", "col": "n"}, "y": {"csv": "…/frontier_4K.csv", "col": "Rb_eps_decay"}, "label": "Rb", "role": "reference" },
        { "x": {"csv": "…/frontier_4K.csv", "col": "n"}, "y": {"csv": "…/frontier_4K.csv", "col": "Cs_eps_decay"}, "label": "Cs", "role": "reference" },
        { "x": {"csv": "…/frontier_4K.csv", "col": "n"}, "y": {"csv": "…/frontier_4K.csv", "col": "Yb_eps_decay"}, "label": "Yb", "role": "reference" } ],
      "highlight": [ { "series": 0, "at": 60, "label": "below all four" }, { "series": 1, "at": 85, "label": "above Rb, Cs, Sr" } ] },
    { "label": "b", "tag": "T = 300 K", "…": "same six series and two callouts from the 300 K files" } ] }
```

Eight foreground curves per panel became two Ba variants (one hue, solid / dashed, the shared word as a
header) and the four references the claim names as thin grey open-marker lines, each end-labelled; the
claim's two relations are written where they hold; the condition is on the panel; nothing is clipped;
no legend. The `_eps_total` columns were not plotted: they exceed 1 (an invalid blockade term), which
the author reports rather than draws.
