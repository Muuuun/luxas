---
status: 5-to-fix
audited_at: 2026-08-28T12:36:57Z
figures:
  - report/figures/fig1_geometry.pdf
  - report/figures/fig2_c6_angular.pdf
  - report/figures/fig3_gain_vs_anisotropy.pdf
  - report/figures/fig4_gate_viability.pdf
  - report/figures/fig5_interaction_gate_gain.pdf
---

## report/figures/fig1_geometry.pdf  (print width 7.0 in)

lint:
  [figlint-pdf] ERROR report/figures/fig1_geometry.pdf: collision "⊥" ⊗ "Strong-blockade gate"
  [figlint-pdf] ERROR report/figures/fig1_geometry.pdf: collision "θ = 90◦" ⊗ "R ∼5.5 µm"
  [figlint-pdf] ERROR report/figures/fig1_geometry.pdf: collision "θ" ⊗ "C6(θ∗) = 0"

CLAIM: Caption implies a geometry schematic distinguishing a strong-blockade configuration (θ=90°, R~5.5 µm) from an interaction-gate configuration (θ*≈24.65°, R=2.0 µm). Both configurations are visible as labelled dots on the angle-axis diagram. Claim is partially met, but three label collisions corrupt the key annotations.

LEGIBLE: Body text at print size is generally readable. Three labels are not cleanly readable: (1) In the upper-left, "θ =" is printed directly on top of the "R ∼5.5 µm" brace annotation — the orange characters fuse into an illegible smear at 7 in. (2) In the small inset curve (upper right), the trailing "θ" glyph collides with "C6(θ∗) = 0", making the zero-value label unreadable. (3) The "⊥" symbol (right-angle marker on the vertical axis) is kerned into the "Strong-blockade gate" title — readable in isolation but a confirmed pixel collision.

OCCLUSION: No data-covering legend or inset. All three collisions are annotation-on-annotation. The small sine-wave inset in the upper right is clear of other elements except the trailing "θ = 0" label.

CLUTTER: Five named elements (two gate labels, quantization-axis label, θ* arrow, R-brace). All carry the claim; none redundant. Clutter is not the problem — label placement is.

SCHEMATIC: (1) "θ =" label floats over the "R ∼5.5 µm" brace rather than beside it — shift the "θ =" text 6–8 pt to the left so it clears the brace entirely. (2) The "θ" suffix on the inset x-axis collides with "C6(θ∗) = 0" — move the axis label below the inset box or shorten the label to "θ". (3) The right-angle symbol "⊥" at the vertical-axis base overlaps the title "Strong-blockade gate" — nudge the ⊥ marker down 4 pt or the title up 4 pt.

FIXES:
  1. (TikZ) Shift the orange "θ =" text node 6–8 pt leftward so it no longer overlaps the "R ∼5.5 µm" double-headed brace.
  2. (TikZ) Move the inset x-axis label from the right end of the axis to below the inset frame; label can be abbreviated to "θ" to avoid overlap with "C₆(θ*)=0".
  3. (TikZ) Translate the ⊥ right-angle marker 4 pt downward (or the "Strong-blockade gate" title 4 pt upward) to clear the collision flagged by lint.

verdict: fix

---

## report/figures/fig2_c6_angular.pdf  (print width 3.4 in)

lint:
  [figlint-pdf] ERROR report/figures/fig2_c6_angular.pdf: collision "total 𝘊𝟨 zero" ⊗ "*≈𝟤𝟦.𝟨𝟧°"

CLAIM: Caption says the figure shows C₆ vs angle θ with a zero crossing at θ*≈24.65°. At 300 dpi I can see both curves (blue circles = second-order, red squares = diagonalization) crossing zero near 25°. Claim is visible.

LEGIBLE: Most text is legible at 3.4 in. The annotation "total C₆ zero / θ*≈24.65°" is a two-line text block attached to a black arrow pointing at the crossing. At print size the two text lines overlap each other — "total C₆ zero" sits directly atop "θ*≈24.65°" making the second line unreadable. The green "ΔM=0 channel zero / C₆≈+126" label at upper right is readable. The "repulsive (C₆<0)" and "attractive (C₆>0)" side annotations are readable.

OCCLUSION: The annotation box for the zero-crossing sits at the data crossing point. The black arrow and text cover a small stretch of both curves around θ≈20–28°, but the underlying zero crossing is identifiable from context.

CLUTTER: 2 data series + 1 vertical grey reference line + 1 vertical green dotted line + 4 text annotations. All annotations directly support the claim. The "ΔM=0 channel zero" annotation explains the green line's meaning — necessary.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Separate the two-line annotation into two independent text objects stacked with at least 2 pt of gap, or use a single-line annotation "θ*≈24.65° (total C₆=0)" rotated 0° so both parts sit on one non-overlapping line.
  2. Shift the annotation anchor point 10–15 pt to the right of the crossing so the text box does not sit on top of the curves.

verdict: fix

---

## report/figures/fig3_gain_vs_anisotropy.pdf  (print width 3.4 in)

lint:
  [figlint-pdf] ERROR report/figures/fig3_gain_vs_anisotropy.pdf: collision "𝟨/𝘊𝟫𝟢" ⊗ "𝟨"
  [figlint-pdf] ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "𝘈𝟣/𝟨 scaling" renders at 3.9 pt at 3.40 in print width (min 5.0 pt)
  [figlint-pdf] ERROR report/figures/fig3_gain_vs_anisotropy.pdf: tiny text "𝘈𝖼𝗋𝗂𝗍≈𝟥.𝟩𝟥" renders at 3.9 pt at 3.40 in print width (min 5.0 pt)

CLAIM: Caption implies the figure shows packing gain as a function of anisotropy ratio A, including an A^{1/6} scaling law and a settled anisotropy range. The blue curve, the black dashed power-law line, the green band, and the two horizontal reference lines are all visible. Claim is met in structure.

LEGIBLE: Two legend entries are unreadable at print size. "A^{1/6} scaling" renders at 3.9 pt — less than 4 pt; invisible at 3.4 in without magnification. "A_crit≈3.73" renders at the same 3.9 pt. Both appear in the in-axes legend box. The x-axis label "Anisotropy ratio A = C₆^{SS}/C₆^{90}" has a collision between the subscript "6" and the fraction bar in "C₆^{SS}/C₆^{90}" rendering the denominator ambiguous at print size.

OCCLUSION: The legend box (4 entries: PP packing gain, A^{1/6} scaling, Settled anisotropy range, A_crit≈3.73) sits in the lower-right of the axes at approximately A=10–100, gain≈1.2–1.5. The blue data cloud passes through this region — several hundred data points are hidden behind the legend.

CLUTTER: 1 data series (dense scatter) + 1 power-law dashed line + 1 green band + 2 horizontal annotation lines + legend of 4 = manageable content for the claim.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Increase font size of all legend text to ≥6 pt so "A^{1/6} scaling" and "A_crit≈3.73" clear the 5 pt minimum — or move these two items to direct annotation arrows on the plot rather than legend entries.
  2. Move the legend to upper-left (the corner near A=1, gain≈0.8–1.0) where the data cloud is absent, to uncover the hidden blue points.
  3. Rewrite the x-axis label fraction as "C₆^{SS} / C₆^{90}" with explicit spaces and a slash rather than a stacked fraction or collision-prone superscript combination, matching the style of the other axis labels.

verdict: fix

---

## report/figures/fig4_gate_viability.pdf  (print width 3.4 in)

lint:
  [figlint-pdf] WARN  report/figures/fig4_gate_viability.pdf: dense text: 44 text lines on one figure (> 40) — split panels or drop annotations

CLAIM: Caption says the figure shows gate fidelity vs interatomic spacing for several Ω values (panel a) and interaction strength |V(R)| vs R (panel b), establishing a viable zone at R≤2.2 µm. Both panels are present, the green viable-region shading is clear, and the purple dotted "dead zone" line at R≈2.5 µm is visible. Claim is met.

LEGIBLE: Individual axis labels and the "Best: F=0.9967 @ R=2.0 µm, Ω=160 MHz" annotation in panel (a) are readable. The two-column legend in panel (a) (8 Ω values + best-fidelity dashed) is readable at 300 dpi but will be marginal at 3.4 in print (~5–5.5 pt effective). The "2.89 MHz" and "0.74 MHz" arrow annotations in panel (b) are at borderline size and will be difficult to read without magnification.

OCCLUSION: The 8-series legend block in panel (a) occupies the lower-left quadrant (F≈0.4–0.65, R≈1.0–2.2 µm) and sits on top of the low-fidelity segments of several Ω curves, hiding portions of 4–5 curves.

CLUTTER: Panel (a) has 8 coloured Ω series + 1 dashed best-fidelity curve = 9 lines. In the viable region (R<2.2 µm) all 9 curves bunch and cross in a spaghetti formation; individual Ω traces cannot be followed by the eye. Only the bold blue Ω=160 MHz optimal curve and the overall "best-fidelity" envelope carry the claim — the other 7 sub-optimal curves add noise without showing trend.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Collapse the 7 sub-optimal Ω curves (2–300 MHz, excluding the optimal 160 MHz) into a single light-grey band (min–max envelope) in panel (a); keep the bold blue Ω=160 MHz curve and the black dashed best-fidelity envelope. This removes 7 series and the 14-entry legend, dropping text-line count well below 40.
  2. Move the remaining 2-item legend (Ω=160 MHz + best fidelity) to the empty lower-right orange (non-viable) region so it no longer occludes the low-fidelity curve segments.
  3. In panel (b), increase the "2.89 MHz" and "0.74 MHz" annotation font to match the axis tick font (≥6 pt at print size) and offset the labels horizontally so the arrows do not overprint the curve.

verdict: fix

---

## report/figures/fig5_interaction_gate_gain.pdf  (print width 3.4 in)

lint: clean

CLAIM: Caption implies the figure shows packing-density gain of the interaction gate as a function of gate length R, with values near 1.98× at R=2.0 µm, above the 1.35× strong-blockade cap. The blue curve, the labelled open circle at R=2.0 µm, the red dashed cap line, and the "Robust 1.95–2.11×" box are all visible. Claim is met.

LEGIBLE: Main axes labels and all on-axes annotations are readable. Inside the inset (lower-left): "Fragile (excl.)" and "Plateau 1.97–1.99×" render at approximately 5–6 pt at 3.4 in — borderline readable; the "Gain" y-axis label on the inset is ~4 pt at print size. The inset x-axis label "φ (°)" is readable.

OCCLUSION: The inset box occupies approximately R=1.4–1.72 µm, gain≈1.37–1.62 in the main panel. The main blue data curve (which reaches gain≈2.05–2.11 at R=1.5–1.6 µm) passes through the inset's top edge, and the red dashed cap line at gain=1.35 passes through the inset's bottom. Two main-panel data points (at R≈1.5 and R≈1.6 µm) are hidden behind the inset.

CLUTTER: 2 series (interaction gate, strong-blockade cap) + 1 inset + 2 text annotations ("1.98×" arrow, "Robust" box). The inset carries secondary content (φ-sensitivity sweep) that is distinct from the main claim; it introduces 3 additional series (orange fragile point, green plateau points, green triangle envelope) that are not explained in the main axes.

SCHEMATIC: n/a (matplotlib figure)

FIXES:
  1. Move the inset to the empty right side of the panel (R≈1.9–2.3 µm, gain≈1.22–1.6) where no main-panel data points or cap line are present, so it no longer occludes the blue curve or the red dashed line.
  2. Increase the inset's internal font size to ≥6 pt (currently ~4–5 pt at print size) so "Fragile (excl.)" and "Plateau 1.97–1.99×" are legible without magnification.
  3. If moving the inset is geometrically infeasible, promote the inset content to a separate panel (b) and relabel the current panel as (a) — the φ-sensitivity data is non-trivial secondary evidence worth its own dedicated space.

verdict: fix
