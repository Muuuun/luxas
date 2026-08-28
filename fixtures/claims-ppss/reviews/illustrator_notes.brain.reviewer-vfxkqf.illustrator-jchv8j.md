---
status: 1-issues
audited_at: 2026-01-22T18:30:00Z
style_guide_md5: 1023a7a3a9cf4c7b450bbb67baf2e75d
canonical_figures:
  report/figures/fig2_c6_angular.png: c5783b032848610ccb5d92e0ce3813fb
  report/figures/fig3_gain_vs_anisotropy.png: 69de8058ac8d3f5fd9857e6818236378
  report/figures/fig4_gate_viability.png: fd749e7e291333b44e851000400a88b6
  report/figures/fig5_interaction_gate_gain.png: 8854c739e99046d21d5058d4dfb8748d
plot_scripts:
  data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py: 4457999b2d391e950c00436340e42848
  data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py: 988f4cf6d5ada11b81cd400d5a1ec672
  data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py: bad421e0c34d77df666b21189e426426
  data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py: 6c54b747a2d2c75ce130e310c81dc825
---

# Illustrator Notes (visual review only)

## Checklist per figure

### report/figures/fig2_c6_angular.png (source: data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py)
1. [pass] Palette hex codes match style_guide.md (steel blue #1f77b4, crimson #d62728, forest green #2ca02c)
2. [pass] Font sizes: axis 9pt, ticks 7pt, annotations 7pt — consistent with guide (axis 8-9pt, ticks 7-8pt)
3. [pass] Line weights: data lines 1.2pt ≥ 1.0pt, spines 0.5pt per guide
4. [pass] Panel label (a): lowercase in parentheses, top-left, 10pt bold
5. [pass] Legend proxy matches plotted series (blue circles, red squares)
6. [pass] Tick direction: 'in' with length 3pt, matching guide
7. [pass] Spines: L-frame (bottom-left only), top/right hidden
8. [pass] No clipped/overlapping text visible
9. [pass] No font fallback boxes visible
10. [pass] No fontweight="bold" used with usetex (script does not enable usetex)
11. [N/A] No raster embeds in this figure
12. [pass] Colorblind safety: blue/crimson/green distinguishable to deutan/protan
13. [pass] Annotation numbers computed: C6 value uses f"{c6_at_54:.0f}", theta_star uses f"{theta_star:.2f}"

### report/figures/fig3_gain_vs_anisotropy.png (source: data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py)
1. [pass] Palette hex codes match style_guide.md tab10 palette (#1f77b4, #000000, #2ca02c, #d62728)
2. [pass] Font sizes: axis labels 8pt, annotations 7pt, within guide brackets
3. [pass] Line weights: primary data (scatter) visible, theory line 1.0pt, spines hidden for L-frame
4. [N/A] Single panel — no (a)/(b)/(c) labels required
5. [pass] Legend proxy matches plotted series
6. [pass] Tick direction: 'in' which='both'
7. [pass] Spines: L-frame (top/right hidden)
8. [pass] No clipped/overlapping text visible
9. [pass] No font fallback boxes visible
10. [pass] No fontweight="bold" used with usetex
11. [N/A] No raster embeds
12. [pass] Colorblind safety: blue/green/crimson distinguishable
13. [pass] Annotation numbers computed: gain values use f"{gain_strong_blockade:.2f}×" and f"{gain_interaction_gate:.2f}×"

### report/figures/fig4_gate_viability.png (source: data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py)
1. [pass] Palette hex codes match style_guide.md (#1f77b4 steel blue, #d62728 crimson, #2ca02c forest green, #ff7f0e orange)
2. [pass] Font sizes: panel labels 10pt bold, axis 9pt, ticks 8pt, annotations 7-8pt per guide
3. [pass] Line weights: curves 1.5-2.0pt for Ω=160 MHz emphasis, spines 0.6pt
4. [pass] Panel labels (a)/(b): lowercase parentheses, top-left, bold
5. [pass] Legend proxy matches plotted series (colors correspond to Ω values)
6. [pass] Tick direction: 'in' per rcParams
7. [pass] Spines: L-frame in both panels (top/right hidden)
8. [pass] No clipped/overlapping text visible
9. [pass] No font fallback boxes visible
10. [pass] No fontweight="bold" used with usetex (uses rcParams only)
11. [N/A] No raster embeds
12. [pass] Colorblind safety: tab10 palette pre-audited in guide
13. [pass] Annotation numbers computed: "Best: F = {best_fid_at_2_0:.4f}", "{V_at_2_0:.2f} MHz" etc.

### report/figures/fig5_interaction_gate_gain.png (source: data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py)
1. [pass] Palette hex codes match style_guide.md (#1f77b4, #d62728, #2ca02c, #ff7f0e)
2. [pass] Font sizes: panel label 10pt bold, axis 9pt, annotations 8pt, inset ticks 7pt
3. [pass] Line weights: data line 1.5pt, cap line 2.0pt, spines 0.6pt
4. [pass] Panel label (a): lowercase parentheses, top-left, bold
5. [pass] Legend proxy matches plotted series
6. [pass] Tick direction: 'in' per constants
7. [pass] Spines: L-frame (top/right hidden)
8. [pass] No clipped/overlapping text visible
9. [pass] No font fallback boxes visible
10. [pass] No fontweight="bold" used with usetex
11. [N/A] No raster embeds
12. [pass] Colorblind safety: blue/crimson/green/orange distinguishable
13. [fail: hardcoded annotation] Line 90: "Robust 1.95–2.11×" is hardcoded literal while plateau_min/plateau_max are computed later. Should use f"Robust {plateau_min:.2f}–{plateau_max:.2f}×" to survive data revisions.

## Overall consistency
- **Palette**: All figures use consistent tab10 palette (steel blue #1f77b4, crimson #d62728, forest green #2ca02c, orange #ff7f0e) per style_guide.md
- **Typography**: Sans-serif throughout. Panel labels 10pt bold, axis 8-9pt, ticks 7-8pt, annotations 7-8pt — consistent with guide.
- **Line weights**: Primary data ≥1.0pt, spines 0.5-0.6pt, consistent across all figures.
- **Spine style**: L-frame (bottom-left only) with top/right hidden in all figures.
- **Tick direction**: Inward ticks on all figures per guide.

## Summary
1 issue to fix: hardcoded annotation in fig5_interaction_gate_gain.py. The "Robust 1.95–2.11×" text on line 90 uses hardcoded values while computed plateau_min/plateau_max variables exist — this will drift from actual data on revision. Replace with computed f-string.
