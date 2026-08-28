---
status: 4-to-fix
audited_at: 2026-08-28T13:17:31Z
figures:
  - report/figures/fig1_geometry.pdf
  - report/figures/fig2_c6_angular.pdf
  - report/figures/fig3_gain_vs_anisotropy.pdf
  - report/figures/fig4_gate_viability.pdf
  - report/figures/fig5_interaction_gate_gain.pdf
---

## report/figures/fig1_geometry.pdf  (print width 7.0 in)

lint:
  ERROR report/figures/fig1_geometry.pdf: collision "⊥" ⊗ "Strong-blockade gate"
  ERROR report/figures/fig1_geometry.pdf: collision "θ = 90◦" ⊗ "R ∼5.5 µm"
  ERROR report/figures/fig1_geometry.pdf: collision "θ" ⊗ "C6(θ∗) = 0"

CLAIM: Figure shows two-atom geometry with quantization axis ẑ, two gate regimes (strong-blockade at θ=90°, interaction gate at θ*≈24.65°), separation R for each, and a mini C₆(θ) inset. Visible at 7 in: yes — both coloured dots, angle arcs, axis arrows, and mini inset are all present.

LEGIBLE: Main body text (all ≥8 pt at 7 in) is readable. Three specific collisions confirmed in pixels: (1) "θ =" runs directly into the "R ∼5.5 µm" brace label — the orange text "θ =" and the orange bracket merge into one unreadable blur in the upper-left quadrant; (2) "⊥" perpendicular indicator is submerged under the descenders of "Strong-blockade gate" heading; (3) in the upper-right mini-inset, the axis-end label ("θ = 0") collides with the pink curve annotation "C₆(θ*) = 0", producing a single illegible string.

OCCLUSION: Mini C₆(θ) inset is clear of main-body data; no inset-over-data problem. The three collisions above are label-on-label, not label-on-curve.

CLUTTER: 4 labelled elements (strong-blockade dot + annotation set, interaction-gate dot + annotation set, mini inset, angle arcs). All carry the claim. No superfluous series.

SCHEMATIC: Three collision regions confirmed visually and by lint (see LEGIBLE). "θ =" label for strong-blockade arm is pushed left of the brace so the "=" touches "R"; at print scale the two strings merge. The ⊥ tick mark shares the same bounding box as the "gate" word descenders. The mini-inset right-hand axis label collides with the pink curve text.

FIXES (note-only — imported TikZ, no editable source):
  1. Shift "θ = 90°" label 8–10 pt upward so it clears the "R ∼5.5 µm" brace; or move the brace to the right of the tick.
  2. Move the ⊥ indicator 6 pt to the right of "Strong-blockade gate" so it sits on a blank line below the heading, not behind its descenders.
  3. In the mini-inset, move the "C₆(θ*) = 0" text 4 pt above the arrow endpoint rather than beside the axis-end tick, which currently carries the "θ = 0" label.

verdict: fix

---

## report/figures/fig2_c6_angular.pdf  (print width 3.4 in)

lint:
  WARN fig2_c6_angular.pdf: 5 in-axes annotations (> 4) — keep the ones that carry the claim, move the rest to the caption
  WARN fig2_c6_angular.pdf: x-axis is LINEAR but positive data spans 90x (min 1, max 90) — small values will be invisible; use a log scale or broken axis
  WARN fig2_c6_angular.pdf: y-axis is LINEAR but positive data spans 43090x (min 0.0068, max 293) — small values will be invisible; use a log scale or broken axis

lint-dispute (WARN 2–3): The x-axis runs from 0° to 90° on a linear degree scale — "90x span" is a spurious artefact of the linter treating degree values as a magnitude ratio. The y-axis 43090x flag similarly conflates the near-zero crossing with a dynamic-range problem; the data of interest (C₆ crossing from negative to positive) is well-resolved at linear scale. Both WARNs are physically incorrect here; a log scale on angle or C₆ would be meaningless. Region: entire axes bbox.

CLAIM: Figure shows C₆(θ) for two methods (second-order perturbation theory, diagonalisation), crossing zero at θ*≈24.65°, with a ΔM=0 channel-zero callout at θ≈55°. All of this is visible: two coloured series with distinct markers, the zero-crossing annotation with arrow, the green dotted vertical at 55°, the ΔM=0 label, and the repulsive/attractive zone labels.

LEGIBLE: All text comfortable at 3.4 in. Legend (upper-left, two items) clear. The "ΔM=0 channel zero / C₆≈+126" annotation in the upper-right readable. The "repulsive (C₆<0)" and "attractive (C₆>0)" floating labels both visible and unobstructed.

OCCLUSION: No annotation covers data. Zero-crossing arrow points accurately to the interpolated crossing. One unlabelled grey solid vertical line appears at θ≈17° — it is not annotated, does not match any labelled angle, and cannot be attributed to any claim element from the pixel information alone. It floats as an orphan.

CLUTTER: 2 data series + 5 annotations (total C₆ zero arrow, ΔM=0 arrow + label, repulsive label, attractive label, unlabelled grey vertical). The unlabelled grey vertical line at ~17° does not carry the claim and adds confusion.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Remove the unlabelled grey vertical line at θ≈17°, or add a text label identifying what it marks (e.g., the second-order-only zero crossing) — one character of ambiguity is enough to break trust in the figure.
  2. Absorb the "repulsive (C₆<0)" / "attractive (C₆>0)" floating labels into the caption (they are definitional, not data), freeing the in-axes annotation budget back to ≤4 and clearing the lint WARN.

verdict: ship
  (No lint ERROR; CLAIM visible; all labels legible; no data occlusion. The orphan vertical line and WARN are noted for the illustrator but do not cross any fix threshold on their own.)

---

## report/figures/fig3_gain_vs_anisotropy.pdf  (print width 3.4 in)

lint:
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: collision "Anisotropy ratio 𝘈= 𝘊(𝖲𝖲)" ⊗ "𝟨"
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: collision "/𝘊(𝟫𝟢)" ⊗ "𝟨"
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "Anisotropy ratio 𝘈= 𝘊(𝖲𝖲)" renders at 4.3 pt at 3.40 in print width (min 5.0 pt)
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "/𝘊(𝟫𝟢)" renders at 4.3 pt at 3.40 in print width (min 5.0 pt)
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "strong-blockade gain ≈ 1.35×" renders at 4.8 pt at 3.40 in print width (min 5.0 pt)
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "interaction-gate gain ≈ 1.98×" renders at 4.8 pt at 3.40 in print width (min 5.0 pt)
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "𝘈𝟣/𝟨 scaling" renders at 3.8 pt at 3.40 in print width (min 5.0 pt)
  ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "𝘈𝖼𝗋𝗂𝗍≈𝟥.𝟩𝟥" renders at 3.8 pt at 3.40 in print width (min 5.0 pt)

CLAIM: Figure shows packing gain (relative to SS) vs anisotropy ratio A on a log-x axis, with a power-law A^(1/6) reference dashed line, a critical anisotropy marker A_crit≈3.73, a settled-range green band, and two right-edge gain callouts (strong-blockade 1.35×, interaction-gate 1.98×). All elements are visible in the 300 dpi PNG, but the labels identified by lint as tiny are confirmed illegible at print scale: the x-axis label subscripts ("C₆^SS/C₆^90") collapse to grey smear; the right-margin "≈1.35×" and "≈1.98×" callouts are sub-5 pt; "A^(1/6) scaling" next to the dashed curve is 3.8 pt and invisible; the red vertical "A_crit≈3.73" label is 3.8 pt and invisible.

LEGIBLE: The main blue scatter and black dashed reference curve are clear. The legend box (3 items: PP packing gain, A^(1/6) scaling, Settled anisotropy range, A_crit) is rendered at adequate size. However, every inline/axis annotation identified by lint is below 5 pt at print width and cannot be read without a magnifier.

OCCLUSION: The x-axis label "Anisotropy ratio A = C₆^SS/C₆^90" collides with the x-axis tick label "6" (rightmost tick of the log axis) — confirmed visually: the numeral 6 sits inside the subscript string.

CLUTTER: 1 main data series, 1 reference curve, 4 reference lines/band (A_crit vertical, settled-range band, strong-blockade horizontal, interaction-gate horizontal). All carry the claim. No series to drop.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Increase x-axis label font to ≥7 pt and rewrite the subscripted expression as plain mathtext (e.g., `$A = C_6^{SS}/C_6^{90}$`) so the superscripts render above the minimum; this also removes the collision with the tick "6" because the label moves down below the tick row.
  2. Move the "strong-blockade gain ≈ 1.35×" and "interaction-gate gain ≈ 1.98×" right-margin annotations into the legend as two named horizontal lines (add them to the legend with `label=` and remove the in-axes text objects); or increase their fontsize to ≥7 pt.
  3. Increase "A^(1/6) scaling" and "A_crit≈3.73" inline labels to ≥6 pt (matching the legend fontsize); both are currently 3.8 pt, 1.2 pt below the minimum.

verdict: fix

---

## report/figures/fig4_gate_viability.pdf  (print width 3.4 in)

lint:
  WARN fig4_gate_viability.pdf: 6 in-axes annotations (> 4) — keep the ones that carry the claim, move the rest to the caption

CLAIM: Figure shows (a) gate fidelity F vs interatomic spacing R for 7 Ω values, with the peak fidelity F=0.9967 at R=2.0 µm / Ω=160 MHz inside the viable zone R≤2.2 µm; (b) |V(R)| vs R on a log scale showing the interaction strength dropping below 1 MHz at R≈2.4 µm (dead zone). Both panels visible; the claim is findable, but only with effort in panel (a).

LEGIBLE: All text at or above 5 pt. Legend in panel (a) uses a two-column layout and is readable. "Best: F=0.9967 @ R=2.0 µm, Ω=160 MHz" annotation in the upper-right orange zone is unobstructed and legible. "F=0.99" horizontal line label, "Viable (R≤2.2 µm)" green label, "Sub-MHz (not viable)" orange label, and "Dead zone (V≈0)" purple arrow label all legible. Panel (b) "2.89 MHz" and "0.74 MHz" callouts legible.

OCCLUSION: In panel (a) the 7 coloured Ω curves are all active in the R=1–2.5 µm region simultaneously. The curves cross each other multiple times, and their trace lines physically pass through the bounding box of the "Viable (R≤2.2 µm)" green text (bottom-left of panel). At 3.4 in print, the green label is partially overdrawn by the yellow (Ω=30 MHz) and purple (Ω=10 MHz) curve segments that dip through fidelity ≈0.75–0.82 in exactly that text region. The label remains decodable only because of colour contrast, not because the lines avoid it.

CLUTTER: 8 series (7 Ω curves + 1 dashed best-fidelity envelope). 5 of the 7 Ω curves (Ω=2, 5, 10, 30, 60 MHz) are sub-optimal and do not reach F>0.99 anywhere in the viable zone; they exist to show the failure mode but individually contribute only visual mass in the viable region. The "Best: F=0.9967" annotation, the two shaded regions, the dead-zone arrow, and the "F=0.99" line all carry the claim; none can be dropped.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Collapse the 5 sub-optimal Ω curves (Ω=2, 5, 10, 30, 60 MHz) into a single light-grey shaded band (min–max envelope across those five), replacing 5 coloured traces with one unlabelled grey fill; keep only Ω=160 MHz (blue, optimal), Ω=100 MHz (next best), and Ω=300 MHz (overhead bound) as named lines. This reduces series from 8 to 4 and clears the spaghetti that encroaches on the "Viable" label.
  2. Move "Viable (R≤2.2 µm)" green label to the top of the green shaded region (y≈0.97–0.99) where no curve traces run, eliminating the encroachment found in OCCLUSION.
  3. Reduce the in-axes annotation count to ≤4 per the WARN: move "Sub-MHz (not viable)" explanatory text to the caption; the orange shaded region already communicates the zone boundary without a redundant floating label.

verdict: fix

---

## report/figures/fig5_interaction_gate_gain.pdf  (print width 3.4 in)

lint:
  WARN fig5_interaction_gate_gain.pdf: x-axis is LINEAR but positive data spans 120x (min 1, max 120) — small values will be invisible; use a log scale or broken axis
  WARN fig5_interaction_gate_gain.pdf: y-axis is LINEAR but positive data spans 113x (min 0.0223, max 2.52) — small values will be invisible; use a log scale or broken axis

lint-dispute (WARN 1–2): The main axes span R=1.4–2.3 µm (gain 1.2–2.3), which is a ≈1.6× dynamic range on both axes — completely appropriate for linear scale. The 120x and 113x flags originate from the inset Axes object whose raw data apparently includes φ values near 0° and gain values from the full simulation range (including the excluded "Fragile" outlier at gain≈2.52 and near-zero φ). The WARNs misattribute inset data to the main axes. No log scale is warranted. Pixel region: entire inset Axes bbox (approximately x=[1.45,1.73], y=[1.35,1.60] in main-plot data coordinates).

CLAIM: Figure shows packing-density gain vs gate length R for the interaction-gate scheme (blue solid), with a strong-blockade cap reference at 1.35× (red dashed), a "Robust 1.95–2.11×" annotation, and an inset showing gain vs azimuthal angle φ to establish angular robustness. All elements are present and the main claim (interaction gate ≈2× >> 1.35× cap) reads immediately.

LEGIBLE: Main axis text, legend, and "1.98× @ R=2.0 µm" arrow label all legible. "Robust 1.95–2.11×" box legible. Inset labels ("Gain", "φ (°)", "Fragile (excl.)", "Plateau 1.97–1.99×") are small but figlint returns no ERROR, placing them above the 5 pt floor; confirmed visually — they are tight but decodable at 300 dpi.

OCCLUSION: The inset's white-filled interior covers the main-plot red dashed reference line (strong-blockade cap, y≈1.35) across the strip R≈1.5–1.72 µm. The red dashed line is visible to the left of the inset (below R=1.5 µm, though the axis starts at 1.4 µm so this is a narrow sliver) and to the right (R>1.73 µm). Within the inset bounding box the red dashed line is completely hidden. At 3.4 in print the gap between inset frame bottom and the red line is less than 1 mm, making it impossible to trace the cap line across the full width of the panel without mental extrapolation.

CLUTTER: 2 series (interaction gate, strong-blockade cap) + 1 inset + 1 arrow annotation + 1 floating box. Moderate. Every element carries the claim.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Relocate the inset to the upper-right empty region of the panel (between R≈1.9–2.3 µm and gain≈1.6–2.0, where no data points are plotted), so the red dashed reference line is fully unobstructed across the panel width.
  2. If the inset cannot be relocated without covering data, clip only the inset background to be transparent and add a 1 pt white edge halo around the inset border, so the red dashed line remains visible underneath; this is a single `set_facecolor('none')` + `set_edgecolor` call.
  3. (Minor) The "Robust 1.95–2.11×" floating text box sits mid-panel over white space; confirm its bbox does not clip the blue data line near R=1.8 µm (visually clear at 300 dpi, but worth a bbox check in the source before close).

verdict: fix
