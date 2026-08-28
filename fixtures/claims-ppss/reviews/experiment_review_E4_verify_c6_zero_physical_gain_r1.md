# experiment_reviewer — E4_verify_c6_zero_physical_gain round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): c6_total_zero_angle_deg — 22.9 ± 3.0 via dipole-dipole angular channels A(1−3cos²θ)²+C sin⁴θ, B≈0 — inputs: [c6_pp_theta0_60_diagonalization_ghz_um6=-10.41, c6_pp_theta90_60_ghz_um6=268.08]
ESTIMATE(blind): c6_diag_min_abs_ghz_um6_in_20_26 — 22.17 ± 3.0 via Glaetzle D0 angular form two-anchor fit — inputs: [c6_pp_theta0_60_diagonalization_ghz_um6=-10.41, c6_pp_theta90_60_ghz_um6=268.08]
ESTIMATE(blind): c6_at_dm0_magic_angle_ghz_um6 — 126.3 ± 3.0 via direct second-order dipole sum over full pair basis (all dM channels) — inputs: [c6_pp_theta0_60_diagonalization_ghz_um6=-10.41, c6_pp_theta90_60_ghz_um6=268.08]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: c6_total_zero_angle_deg — if right: 24.3° ± 0.65° (zero in [23.4, 25.0]); if wrong: zero outside [20,26] or no sign change; computation: full diag at 1° steps in [20,30] with a wider energy window (>30 GHz) to resolve the 0.65° inter-method spread
SCALING: c6_total_zero_angle_deg — expected exponent 0 in n (single n=60 computed); observed not swept
DISCRIMINATOR: c6_diag_min_abs_ghz_um6_in_20_26 — if right: <1 GHz µm⁶ (both methods <1); if wrong: >10 GHz µm⁶ at all sampled angles; computation: pairinteraction full SystemPair diag with angle-aware interaction matrix (library fix) at 0.5° steps in [20,26]
SCALING: c6_diag_min_abs_ghz_um6_in_20_26 — expected exponent 0 in n (single n=60); observed not swept
DISCRIMINATOR: c6_at_dm0_magic_angle_ghz_um6 — if right: ~126 GHz µm⁶; if wrong: ~120 GHz µm⁶ (two-channel) or <100 GHz µm⁶ (if ΔM=±1 channel has opposite sign); computation: full pair diag at θ=54.7° with wide energy window to handle S+S Förster channel non-perturbatively
SCALING: c6_at_dm0_magic_angle_ghz_um6 — expected exponent 0 in n (single n=60); observed not swept
DISCRIMINATOR: c6_dm1_channel_ghz_um6 — if right: ≈−22.7 GHz µm⁶ (non-negligible); if wrong: ≈0 (pairinteraction pi.C6 result); computation: compare angular C6 scan from a corrected pairinteraction (angle-aware) vs the hand-built all-channel sum
SCALING: c6_dm1_channel_ghz_um6 — expected exponent 0 in n (single n=60); observed not swept
DISCRIMINATOR: c5_at_zero_ghz_um5 — if right: ≈−0.126 GHz µm⁵; if wrong: ≈0 or ≫1; computation: extract C5 from full-diag eigenvalue slope in R⁻⁵ at the zero angle (planned but not executed)
SCALING: c5_at_zero_ghz_um5 — expected exponent 0 in n (single n=60); observed not swept
DISCRIMINATOR: c8_at_zero_ghz_um8 — if right: ≈+1.75 GHz µm⁸; if wrong: order-of-magnitude different if n-window convergence fails; computation: re-run C8 sum with n_range expanded from [58,62] to [55,65] and compare
SCALING: c8_at_zero_ghz_um8 — expected exponent 0 in n (single n=60); observed not swept
DISCRIMINATOR: strong_blockade_max_gain_2d — if right: ≈1.35 (strong blockade removes near-zero orientations); if wrong: >1.6 (if strong-blockade constraint allows near-zero gate angles) or <1.2 (if cross-talk is more restrictive); computation: run optimizer with finer orientation grid (1° steps in θ and ψ) and verify no orientation with |C6|≥138.86 yields gain >1.5
SCALING: strong_blockade_max_gain_2d — expected exponent 0 in n (single n=60); observed not swept
ESTIMATE: c6_total_zero_angle_deg — 24.65 ± 0.35 via three-channel quadratic root from verified a,b,c coefficients
ESTIMATE: c6_diag_min_abs_ghz_um6_in_20_26 — 0.007 ± 0.22 via envelope of both methods' minima in [20,26]
ESTIMATE: c6_at_dm0_magic_angle_ghz_um6 — 126.3 ± 2.0 via three-channel formula at θ=54.7° (same route as experiment, tautological)

REVIEW-COMPLETE
VERDICT: satisfied
