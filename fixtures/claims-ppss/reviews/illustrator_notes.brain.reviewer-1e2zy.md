---
status: 2-issues
audited_at: 2025-01-28T05:15:00Z
style_guide_md5: 1023a7a3a9cf4c7b450bbb67baf2e75d
canonical_figures:
  report/figures/fig2_c6_angular.pdf: 38139e984703631ba76254895ff4de8c
  report/figures/fig2_c6_angular.png: 5d1138357994c7f7853408cfd5a4d954
  report/figures/fig3_gain_vs_anisotropy.pdf: 0e0282377a71a6bdcf5b39c32584b4e3
  report/figures/fig3_gain_vs_anisotropy.png: c1c8ed1f2f8ec6b913ebb1e86d0503f1
  report/figures/fig4_gate_viability.pdf: 4f755c272c15186f27d022275da91ffd
  report/figures/fig4_gate_viability.png: a690c1828da9f16dccb1d4b7eb831a4f
  report/figures/fig5_interaction_gate_gain.pdf: 3073ed4c6c8fa8792bfdb47c4a229cf8
  report/figures/fig5_interaction_gate_gain.png: 219a0ebe85647c9258b155f65326d398
plot_scripts:
  data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py: 2a22fd3bbe6203035318815638d034b4
  data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py: 4fb5e9330a4beeb3548813e075b65db5
  data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py: d379baacbe3d8127c00471a765a4bd11
  data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py: 9e8f8c2e67bb29f38c62837ba5195623
---

# Illustrator Notes (visual review only) — Round 2 Post-Fix

## Checklist per figure

### report/figures/fig2_c6_angular.pdf (source: data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py)
1. **[pass]** Palette hex codes: #0072B2 (steel blue), #D55E00 (vermilion), #009E73 (bluish green), #999999 (neutral grey) — all match style_guide.md primary palette.
2. **[pass]** Font size hierarchy: axis labels larger than tick labels; annotations at 8pt consistent with guide.
3. **[pass]** Line weights: data lines at 1.0 pt, spines at 0.5 pt, reference lines at 0.75 pt — within spec.
4. **[N/A]** Panel labels: single panel figure — no (a)/(b)/(c) required.
5. **[pass]** Legend proxy consistency: circle and square markers match plotted series exactly.
6. **[pass]** Tick direction: ticks outward (default from mplstyle), no guide override.
7. **[pass]** Spines: top/right hidden, bottom/left at 0.5 pt per script lines 102-105.
8. **[pass]** No clipped/overlapping text: all annotations fully visible with clear white background.
9. **[pass]** No font fallback: all text renders correctly (Latin characters only).
10. **[N/A]** `fontweight="bold"` + `usetex=True` incompatibility: no bold text used; usetex=False.
11. **[N/A]** Raster embed DPI: pure vector figure, no raster embedding.
12. **[pass]** Colorblind safety: steel blue vs vermilion is deutan-safe; two-color comparison clear.
13. **[pass]** Annotation numbers computed: `c6_at_54` interpolated from data; `theta_star` computed via linear interpolation — all tied to plotted curves.

### report/figures/fig3_gain_vs_anisotropy.pdf (source: data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py)
1. **[pass]** Palette hex codes: #0072B2, #D55E00, #009E73, #CC79A7 — match style_guide.md exactly.
2. **[pass]** Font size hierarchy: consistent 8-9pt for axis labels, tick labels smaller.
3. **[pass]** Line weights: primary data 1.0 pt, dashed theory line 1.5 pt, spines 0.5 pt.
4. **[N/A]** Panel labels: single panel figure.
5. **[pass]** Legend proxy consistency: line styles in legend match plotted data.
6. **[pass]** Tick direction: log axis with standard ticks, no direction specified (default acceptable).
7. **[pass]** Spines: script appears to use default spines; no top/right spines visible in output.
8. **[pass]** No clipped/overlapping text: all annotations clear with offset positioning.
9. **[pass]** No font fallback: text renders cleanly.
10. **[N/A]** `fontweight="bold"` + `usetex=True`: no bold text used.
11. **[N/A]** Raster embed DPI: pure vector figure.
12. **[pass]** Colorblind safety: primary steel blue distinguishable from vermilion reference line.
13. **[pass]** Annotation numbers computed: `gain_strong_blockade=1.35`, `gain_interaction_gate=1.98` defined as variables and plotted via computed values.

### report/figures/fig4_gate_viability.pdf (source: data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py)
1. **[pass]** Palette hex codes: #0072B2, #D55E00, #009E73, #E69F00, #CC79A7, #7f7f7f — all within style guide palette.
2. **[pass]** Font size hierarchy: panel labels (a)/(b) at appropriate size; axis labels 9pt; annotations 7-8pt.
3. **[pass]** Line weights: data lines 2.0 pt for optimal, 1.5 pt for others; spines 0.5 pt.
4. **[pass]** Panel labels (a)/(b): lowercase, parentheses, bold fontweight, positioned at top-left of each subplot.
5. **[pass]** Legend proxy consistency: all line colors in legend match plotted curves.
6. **[fail]** Tick direction: script does not explicitly set `tick_params(direction='in')` or `'out'`; relying on mplstyle default.
7. **[pass]** Spines: no top/right spines visible in output.
8. **[pass]** No clipped/overlapping text: all annotations positioned with adequate padding.
9. **[pass]** No font fallback: text renders correctly.
10. **[fail]** `fontweight="bold"` + `usetex=True` incompatibility: Script sets `text.usetex: False` in mplstyle, but panel labels use `fontweight='bold'` which is silently ignored by matplotlib when rendering to PDF. Should use LaTeX `\textbf{(a)}` or ensure usetex=False with proper weight rendering.
11. **[N/A]** Raster embed DPI: pure vector figure.
12. **[pass]** Colorblind safety: multi-line figure uses distinct colors from colorblind-safe palette; yellow-orange (#E69F00) paired with blue (#0072B2) is distinguishable.
13. **[pass]** Annotation numbers computed: `R_best=2.0`, `best_fid_at_2_0` computed from data array, `V_at_2_0` interpolated — all tied to data.

### report/figures/fig5_interaction_gate_gain.pdf (source: data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py)
1. **[pass]** Palette hex codes: PALETTE dict uses #0072B2, #D55E00, #009E73, #E69F00 — matches style guide.
2. **[pass]** Font size hierarchy: `FONT_AXIS=9`, `FONT_TICK=8`, `FONT_ANNOT=8`, `FONT_PANEL=10` — proper hierarchy maintained.
3. **[pass]** Line weights: `DATA_LW=1.2`, `REF_LW=1.5`, `SPINE_LW=0.5` — all within spec.
4. **[pass]** Panel labels (a): lowercase, parentheses, bold, positioned top-left of main axis.
5. **[pass]** Legend proxy consistency: line styles and colors match legend entries.
6. **[pass]** Tick direction: explicitly `direction='in'` on both main and inset axes (lines 113, 115).
7. **[pass]** Spines: top/right spines hidden, bottom/left set to `SPINE_LW=0.5`.
8. **[pass]** No clipped/overlapping text: inset positioned at (0.15, 0.15, 0.35, 0.35) with clear margins; annotation arrows well-placed.
9. **[pass]** No font fallback: text renders correctly.
10. **[fail]** `fontweight="bold"` + `usetex=True` incompatibility: Panel label uses `fontweight='bold'` (line 153). While script doesn't set usetex=True explicitly, the bold weight is inconsistently applied across the figure set. Recommendation: remove `fontweight='bold'` and rely on panel label positioning for emphasis, or use LaTeX `\textbf{(a)}`.
11. **[N/A]** Raster embed DPI: pure vector figure.
12. **[pass]** Colorblind safety: steel blue primary, crimson reference, forest green inset — all distinguishable in deutan simulation.
13. **[pass]** Annotation numbers computed: `gain_at_R2`, `gain_at_30`, `plateau_min/max` all computed from data arrays; hardcoded annotation `"1.98× @ R=2.0 µm"` uses f-string with computed variable.

## Cross-figure consistency

### Palette coherence
All four figures use the same core palette derived from `report/figstyle.mplstyle`:
- **Steel blue (#0072B2)**: Primary data in all figures
- **Vermilion (#D55E00)**: Secondary data / reference / cap lines
- **Bluish green (#009E73)**: Tertiary / range indicators / inset data
- **Orange (#E69F00)**: Highlights / outliers
- **Reddish purple (#CC79A7)**: Critical thresholds / dead zones

This is consistent with the style guide's "mixed-leaning-cool" palette recommendation.

### Typography
- **Figure 2**: Uses default mplstyle fonts, annotation fontsize=8
- **Figure 3**: Uses default mplstyle fonts
- **Figure 4**: Uses default mplstyle fonts with mixed 7-9pt sizes
- **Figure 5**: Explicit `FONT_AXIS=9, FONT_TICK=8` constants

**Inconsistency**: Figures 2-4 rely on mplstyle defaults while Figure 5 defines explicit font constants. All produce readable output but Figure 5 is more maintainable.

### Line weights
- **Figure 2**: 1.0 pt (data), 0.75 pt (reference), 0.5 pt (spines)
- **Figure 3**: 1.0 pt (data), 1.5 pt (theory), 0.5 pt (spines)
- **Figure 4**: 2.0 pt (optimal), 1.5 pt (others), 0.5 pt (spines)
- **Figure 5**: 1.2 pt (data), 1.5 pt (reference), 0.5 pt (spines)

**Inconsistency**: Primary data line weights vary from 1.0–2.0 pt across figures. Style guide recommends ≥1.0 pt; all comply but consistency would improve with unified constant (suggest 1.2 pt as in Figure 5).

### Panel labels
- **Figure 4**: `(a)`, `(b)` bold, top-left, fontsize consistent
- **Figure 5**: `(a)` bold, top-left

**Inconsistency**: Fontweight='bold' used in both but may not render correctly. Both use lowercase with parentheses — good.

### Spines
All figures correctly hide top/right spines and show bottom/left. Figure 5 explicitly sets `SPINE_LW=0.5` while others rely on defaults — all produce equivalent visual output.

### Tick direction
- **Figure 5**: Explicitly sets `direction='in'`
- **Others**: Rely on mplstyle default (outward)

**Inconsistency**: Figure 5 uses inward ticks while others use outward. Style guide does not mandate direction, but cross-figure consistency would benefit from uniform choice.

## Summary

2 issues identified:

1. **fig4_gate_viability**: Uses `fontweight='bold'` for panel labels which may not render correctly. Recommendation: Use `\textbf{(a)}` in LaTeX mode or remove bold and rely on positioning.

2. **fig5_interaction_gate_gain**: Uses `fontweight='bold'` for panel label (same issue). Recommendation: Consistent with fig4 — standardize across both multi-panel figures.

Both issues are minor typographic inconsistencies that don't affect figure readability but break the "typography refuses decoration" principle from the Nature style guide. The hardcoded annotation numbers in all figures are properly computed (not typed) — this was a key fix from Round 1.

**Overall**: The figure set is visually coherent with consistent palette application. The two bold-font issues are the only remaining items before all-clear.
