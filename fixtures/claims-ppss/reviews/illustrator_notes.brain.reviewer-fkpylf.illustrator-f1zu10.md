---
status: 5-issues
audited_at: 2025-01-28T05:55:00Z
style_guide_md5: 1023a7a3a9cf4c7b450bbb67baf2e75d
canonical_figures:
  report/figures/fig2_c6_angular.pdf: a518e64394ed92470bf7b8da768f449f
  report/figures/fig2_c6_angular.png: 437df8d2937d963d9e17c08502fc7323
  report/figures/fig3_gain_vs_anisotropy.pdf: 1de0e58cfdd9eaae4b0be5d7b9223137
  report/figures/fig3_gain_vs_anisotropy.png: c22c7ddaa449f6cc900cbe0aca982516
  report/figures/fig4_gate_viability.pdf: 8a8e8c289b21d30e15719ec15f729a75
  report/figures/fig4_gate_viability.png: fd749e7e291333b44e851000400a88b6
  report/figures/fig5_interaction_gate_gain.pdf: adc6c76487c250ffbe6dd60018a29b2c
  report/figures/fig5_interaction_gate_gain.png: 8854c739e99046d21d5058d4dfb8748d
plot_scripts:
  data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py: ddee3a2014dba891f956d6bde0300f0a
  data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py: 005203551ae79f416a28ef8d72628d3d
  data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py: bad421e0c34d77df666b21189e426426
  data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py: 6c54b747a2d2c75ce130e310c81dc825
---

# Illustrator Notes (visual review only)

## Checklist per figure

### report/figures/fig2_c6_angular.pdf (source: data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py)
1. [pass] Palette uses #0072B2 (steel blue), #D55E00 (crimson), #009E73 (green) matching style guide.
2. [pass] Font sizes: axis labels ~12pt, tick labels ~10pt, annotations ~10pt.
3. [pass] Line weights: data lines 2.0 pt, reference lines 1.5 pt.
4. [N/A] Single panel, no (a)(b)(c) labels required.
5. [pass] Legend proxy matches plotted series (circles and squares).
6. [pass] Tick direction defaults to 'in' (style guide preference).
7. [pass] No top/right spines.
8. [pass] No clipped or overlapping text.
9. [pass] No font fallback artifacts.
10. [N/A] No fontweight="bold" with usetex=True combination found.
11. [N/A] No raster embeds (pure vector).
12. [pass] Colorblind-safe: steel blue and crimson are distinguishable to deutan/protan.
13. [fail: hardcoded annotation values] Annotation "θ* ≈ 24.65°" uses hardcoded string instead of f-string with computed `theta_star` variable. Annotation "C6 ≈ +126" uses hardcoded value instead of f-string with `c6_at_54` variable.

### report/figures/fig3_gain_vs_anisotropy.pdf (source: data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py)
1. [pass] Palette uses #0072B2 (steel blue), #009E73 (green), #D55E00 (crimson) matching style guide.
2. [pass] Font sizes consistent with hierarchy.
3. [pass] Line weights: data 2.0 pt, reference lines 1.5 pt.
4. [N/A] Single panel.
5. [pass] Legend proxy matches plotted series.
6. [pass] Tick direction 'in'.
7. [pass] No top/right spines.
8. [pass] No clipped text.
9. [pass] No font fallback.
10. [N/A] No fontweight="bold" with usetex=True combination.
11. [N/A] No raster embeds.
12. [pass] Colorblind-safe palette.
13. [fail: hardcoded annotation values] Annotations "A_crit ≈ 3.73", "≈ 1.35×", "≈ 1.98×" use hardcoded strings instead of f-strings with the defined constants (A_crit, gain_strong_blockade, gain_interaction_gate).

### report/figures/fig4_gate_viability.pdf (source: data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py)
1. [pass] Palette uses tab10 colors matching style guide.
2. [pass] Font hierarchy: labels 12pt, ticks 10pt, panel labels 14pt bold.
3. [pass] Line weights: primary curves 3.0 pt, reference lines 2.0 pt.
4. [pass] Panel labels (a) and (b) are bold, lowercase, parentheses, positioned top-left.
5. [pass] Legend proxy matches plotted series.
6. [pass] Tick direction 'in'.
7. [pass] No top/right spines.
8. [pass] No clipped or overlapping text.
9. [pass] No font fallback artifacts.
10. [pass] No fontweight="bold" with usetex=True (script explicitly sets usetex=False).
11. [N/A] No raster embeds.
12. [pass] Colorblind-safe palette.
13. [fail: hardcoded annotation values] Annotations "2.89 MHz" and "0.74 MHz" in panel (b) use hardcoded strings instead of f-strings with computed `V_at_2_0` and `V_at_2_5` variables.

### report/figures/fig5_interaction_gate_gain.pdf (source: data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py)
1. [pass] Palette uses #0072B2 (steel blue), #D55E00 (crimson), #009E73 (green) matching style guide.
2. [pass] Font hierarchy consistent.
3. [pass] Line weights: main line 2.5 pt, reference 3.0 pt (inset).
4. [pass] Panel label (a) is bold, lowercase, parentheses, positioned top-left.
5. [pass] Legend proxy matches plotted series.
6. [pass] Tick direction 'in'.
7. [pass] No top/right spines.
8. [pass] No clipped text.
9. [pass] No font fallback.
10. [pass] No fontweight="bold" with usetex=True.
11. [N/A] No raster embeds.
12. [pass] Colorblind-safe palette.
13. [fail: hardcoded annotation values] Annotation "1.98× @ R=2.0 μm" uses hardcoded string instead of f-string with computed `gain_at_R2` variable.

## Overall consistency
- **Palette**: Consistent across all figures using tab10 (steel blue #0072B2 primary, crimson #D55E00 secondary, green #009E73 tertiary).
- **Typography**: Consistent sans-serif, appropriate size hierarchy. All panel labels use bold 14pt lowercase (a), (b) at top-left.
- **Line weights**: All figures use line weights ≥ 1.5 pt, exceeding the minimum 1.0 pt requirement. Minor variation (2.0–3.0 pt) across figures is acceptable but could be harmonized.
- **Spine conventions**: All figures use standard bottom+left spines only, no top/right.
- **Tick direction**: All use 'in' (default from mplstyle).

## Summary
5 issues to fix: All figures fail checklist item 13 (annotation numbers must be computed, not typed). Annotations use hardcoded numeric literals instead of f-strings referencing the computed variables that generate the curves. This risks annotation drift if data is regenerated. Suggested fix: replace hardcoded values with f-strings using the computed variables (e.g., `f"{theta_star:.2f}°"`, `f"{V_at_2_0:.2f} MHz"`, etc.).
