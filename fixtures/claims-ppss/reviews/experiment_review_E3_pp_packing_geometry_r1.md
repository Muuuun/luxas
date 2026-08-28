# experiment_reviewer — E3_pp_packing_geometry round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): max_gain_over_orientation — 1.07 ± 0.08 via staggered brick-wall dimer packing, sin^4 vdW anisotropy — inputs: []
ESTIMATE(blind): c6_at_dm0_magic_angle_ghz_um6 — 14.8 ± 3 via ARC 2nd-order vdW, Rb 60P1/2 |++⟩ two-channel 𝟙+D₀ at θ=54.7356° — inputs: []
ESTIMATE(blind): c6_total_zero_angle_deg — 45.0 ± 10.0 via two-channel C6=(1−3cos²θ)²−sin⁴θ, equal magnitude — inputs: []

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: max_gain_over_orientation — if right: >1.6 (near C6-zero model breakdown); if wrong: ≤1.4 (physical strong-blockade ceiling holds for all orientations); computation: re-run optimizer with strong-blockade constraint |C6(θ_gate)| ≥ 139 GHz·µm⁶ and verify gain stays ≤ 1.4
SCALING: max_gain_over_orientation — expected divergent (∝ 1/C6(θ)^(1/6) as θ→θ*=22.9°) in θ_gate; observed gain climbs from 1.33 at θ=90° to 1.73 at θ=30° to 1.96 at θ=26° from orientation_sweep_fine.csv, consistent with C6^(-1/6) divergence near the zero
DISCRIMINATOR: c6_at_dm0_magic_angle_ghz_um6 — if right: ~120 GHz·µm⁶ (near-Förster-enhanced C6(90°)=268 drives c2≈271); if wrong: ~15 GHz·µm⁶ (perturbative C6(90°)~30); computation: independent ARC full-diagonalization at θ=54.7° for Rb 60P₁/₂ would settle this — the factor-of-8 discrepancy with the blind estimate traces entirely to C6(90°) being 268 (E1 near-Förster) vs ~30 (perturbative)
SCALING: c6_at_dm0_magic_angle_ghz_um6 — expected ∝ c2 = C6(90°) − C6(0°)/4 in the E1 anchor values; observed 120.30 = 270.68 × 4/9 from angular_analysis.json (not swept; single evaluation)
DISCRIMINATOR: c6_total_zero_angle_deg — if right: ~22.9° (c0/c2 ≈ −1/104, asymmetric channels); if wrong: ~45° (if channels were equal magnitude as blind assumed); computation: full pair diagonalization at 5 angles between 20°–50° (proposed as E4) would verify whether C6 actually passes through zero near 23° or 45° or not at all
SCALING: c6_total_zero_angle_deg — expected θ* = arccos(√(c2/(9c0+c2+c2))) depends on c0/c2 ratio, not swept; observed 22.909° from angular_analysis.json (single analytic evaluation, not a sweep)
ESTIMATE: max_gain_over_orientation — 1.33 ± 0.03 via physical strong-blockade regime (θ_gate=90°), consistent with E2's 1.31–1.47 range; the 1.956 value is a model-breakdown artifact near the C6 zero

REVIEW-COMPLETE
VERDICT: satisfied
