---
status: 14-issues
audited_at: 2025-01-27T00:00:00Z
style_guide_md5: 1023a7a3a9cf4c7b450bbb67baf2e75d
canonical_figures:
  report/figures/fig2_c6_angular.png: 394938c2395ba2cf67259f3050143cdc
  report/figures/fig3_gain_vs_anisotropy.png: 9a2bd053318e7178cdee2bec424bf63a
  report/figures/fig4_gate_viability.png: 30e31b4304cec7c27ec23ff061c79308
  report/figures/fig5_interaction_gate_gain.png: 1427fc7dc30ce075fbe054258e5525cc
plot_scripts:
  data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py: 9dcc6e55a8ddc4b04c63a5f7be1221f0
  data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py: 37ffd87a847bf7956390eb07c5cafd94
  data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py: cc50a7d5ee4b365ffada7447421993d9
  data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py: 193947059d31ca3e1c32d0f8ab7c3087
---

# Illustrator Notes (visual review only)

## Style Guide Reference

**Palette (from style_guide.md / figstyle.mplstyle):**
- Primary: `#0072B2` (steel blue)
- Secondary: `#D55E00` (vermillion)
- Tertiary: `#009E73` (forest green)
- Accent 1: `#CC79A7` (pink)
- Accent 2: `#F0E442` (yellow)
- Accent 3: `#56B4E9` (sky blue)
- Accent 4: `#E69F00` (orange)

**Typography:**
- Axis labels: 9 pt
- Tick labels: 8 pt
- Annotations: 8 pt

**Line weights:**
- Data lines: ≥1.0 pt
- Spines: 0.5 pt
- Connectors: ≥0.75 pt

**Spines:** L-frame (bottom-left only, no top/right)

---

## Checklist per figure

### report/figures/fig2_c6_angular.png (source: data/experiments/E4_verify_c6_zero_physical_gain/scripts/plot_fig2_c6_angular.py)

1. [fail: Uses tab10 palette (#1f77b4, #d62728, #2ca02c) instead of style guide (#0072B2, #D55E00, #009E73)]
2. [pass: Axis label ~9pt, legend 8pt matches hierarchy]
3. [fail: Data line width 1.0 pt at minimum; should be ≥1.0 pt per guide]
4. [N/A: Single panel, no (a)/(b)/(c) labels]
5. [pass: Legend markers match plotted series]
6. [N/A: Tick direction not visible in PNG, likely default]
7. [pass: L-frame spines (top/right hidden), bottom-left visible]
8. [pass: No clipped/overlapping text]
9. [pass: No font fallback/missing glyphs]
10. [pass: No fontweight="bold" with usetex=True issues]
11. [N/A: No raster embed]
12. [pass: Colorblind safe - blue/red distinction clear]
13. [fail: Hardcoded annotation "≈ 24.65°" and "≈ + 126" instead of computed variables]

### report/figures/fig3_gain_vs_anisotropy.png (source: data/experiments/E2_pp_packing_density/scripts/plot_gain_vs_anisotropy.py)

1. [fail: Uses tab10 palette (#1f77b4, #d62728, #2ca02c, #9467bd) instead of style guide (#0072B2, #D55E00, #009E73, #CC79A7)]
2. [pass: Font sizes consistent with hierarchy]
3. [pass: Theory line 1.5 pt, data line weight sufficient]
4. [N/A: Single panel]
5. [pass: Legend proxies match plotted elements]
6. [N/A: Tick direction default]
7. [pass: L-frame spines per style guide]
8. [pass: No clipped text]
9. [pass: No font fallback]
10. [pass: No fontweight/bold issues]
11. [N/A: No raster embed]
12. [pass: Colorblind safe - blue/red distinguishable]
13. [fail: Hardcoded annotation values: "A_crit ≈ 3.73", "≈ 1.98×", "≈ 1.35×" instead of f-string computed values]

### report/figures/fig4_gate_viability.png (source: data/experiments/E5_weak_blockade_gate_viability/scripts/plot_fig4_gate_viability.py)

1. [fail: Uses custom hardcoded palette (#1f77b4, #d62728, #2ca02c, #ff7f0e, #9467bd) instead of style guide palette]
2. [pass: Axis labels 9pt, tick labels 8pt, annotations 7-8pt]
3. [pass: Line weights appropriate (1.0-1.5 pt)]
4. [fail: Panel labels are **uppercase** "(a)" and "(b)" — style guide requires **lowercase** "(a)", "(b)"]
5. [pass: Legend proxies match plotted series]
6. [N/A: Tick direction default]
7. [pass: L-frame spines applied]
8. [pass: No clipped text]
9. [pass: No font fallback]
10. [pass: No fontweight/bold issues]
11. [N/A: No raster embed]
12. [warn: Multi-line plot with many colors (8+ Ω values) — tab10 colors used, should verify distinctness under deutan/protan]
13. [fail: Hardcoded annotations: "F = 0.99", "R ≤ 2.2 µm", "Best: F = 0.9967", "0.74 MHz", "2.89 MHz" — mixed computed and literal values]

### report/figures/fig5_interaction_gate_gain.png (source: data/experiments/E6_interaction_gate_packing_gain/scripts/plot_interaction_gate_gain.py)

1. [fail: Uses tab10 palette (#1f77b4, #d62728, #2ca02c, #ff7f0e) instead of style guide (#0072B2, #D55E00, #009E73, #E69F00)]
2. [pass: FONT_AXIS = 9, FONT_TICK = 8, FONT_ANNOT = 8 — matches hierarchy]
3. [pass: DATA_LW = 1.2 pt (≥1.0), SPINE_LW = 0.5 pt — correct]
4. [fail: Panel label is **uppercase** "(a)" — style guide requires **lowercase** "(a)"]
5. [pass: Legend proxies match plotted series (circle marker vs dashed line)]
6. [N/A: Tick direction default]
7. [pass: L-frame spines (top/right set_visible(False))]
8. [pass: No clipped text]
9. [pass: No font fallback]
10. [pass: No fontweight/bold issues]
11. [N/A: No raster embed]
12. [pass: Colorblind safe — blue vs red/crimson distinguishable]
13. [fail: Hardcoded annotation "1.98× @ R=2.0 µm", "1×" in box — should use f-string with computed variable]

---

## Overall Consistency

### Cross-figure Consistency Issues

**Palette inconsistency (CRITICAL):**
- **All four figures** use matplotlib's default tab10 palette (`#1f77b4`, `#d62728`, `#2ca02c`, etc.)
- **Style guide specifies:** `#0072B2`, `#D55E00`, `#009E73`, `#CC79A7`, `#F0E442`, `#56B4E9`, `#E69F00`
- The tab10 colors are similar but **not identical** — this is a systematic deviation

**Typography consistency:**
- Font sizes are consistent across figures (axis 9pt, tick 8pt, annot 7-8pt)
- All figures use sans-serif per mplstyle

**Line weights:**
- Generally consistent with style guide (data ≥1.0 pt, spines 0.5 pt)

**Spines:**
- All figures use L-frame (bottom-left only) — consistent and correct

**Panel labels:**
- fig4 and fig5 use **uppercase** "(a)" — should be **lowercase** "(a)" per style guide

---

## Summary

**Summary: 14 issues to fix**

**Critical fixes needed:**
1. **Palette alignment** (4 figures): Replace tab10 colors (`#1f77b4`, `#d62728`, `#2ca02c`) with style guide colors (`#0072B2`, `#D55E00`, `#009E73`)
2. **Panel label case** (2 figures): Change "(a)" → "(a)" and "(b)" → "(b)" in fig4 and fig5
3. **Hardcoded annotations** (4 figures): Replace literal numeric strings with f-strings using computed variables
