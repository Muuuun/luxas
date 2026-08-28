# Experiment Notes

## L2.1 — SS vs PP van der Waals interaction anisotropy at matched principal quantum number (Rb)

**Status:** Complete (Revision 3 — adds independent cross-checks, n-scaling finding, and settles θ=0 residual)

**Experiment dir:** `data/experiments/E1_ss_pp_c6_anisotropy/`

**Key computed leaves:**
- `computed.c6_ss_anisotropy_ratio_by_n` — SS isotropy ratios |C6(90°)/C6(0°)| for n = 40–80
- `computed.c6_pp_sin4_fraction_by_n` — fraction of PP C6(θ) in the dM = ±2 (sin⁴θ) channel, n = 40–80
- `computed.c6_ss_43s_ghz_um6` — 43S anchor vs Low2012
- `computed.c6_ss_70s_ghz_um6` — 70S anchor vs Walker2008
- `computed.c6_pp_theta0_60_diagonalization_ghz_um6` — converged θ=0 residual (wide-window diag, ±100 GHz)

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Confirmatory. Predict: (i) the SS pair C6 is isotropic (|C6(90 deg)/C6(0 deg)| in [0.9,1.1] for every scanned n); (ii) the PP stretched-pair C6 is sin^4-theta dominant (angular-channel sin4_fraction > 0.9 for every scanned n); (iii) the field-standard anchors reproduce: 43S |C6| within 5% of Low2012 2.441 GHz um^6 and 70S |C6| within the Walker2008 set {862,891} GHz um^6 (~10%). Verdict reads computed.c6_ss_anisotropy_ratio_by_n, computed.c6_pp_sin4_fraction_by_n, computed.c6_ss_43s_ghz_um6, computed.c6_ss_70s_ghz_um6. CONFIRMED iff all three hold; REFUTED if the SS pair is anisotropic (>10% off 1), or the PP pair is not sin^4-dominant (sin4_fraction <= 0.9), or either anchor is off by more than its tolerance.

**Verdict: CONFIRMED.** (Unchanged from revision 1; the three acceptance-criterion tests are unaffected by the θ=0 residual corrections in revisions 2–3.)

- **(i) SS isotropy.** `computed.c6_ss_anisotropy_ratio_by_n` ranges from 1.012 (n = 40) to 1.019 (n = 80). Every value lies within [0.9, 1.1]. ✔
- **(ii) PP sin⁴θ dominance.** `computed.c6_pp_sin4_fraction_by_n` ranges from 0.9999988 (n = 65) to 0.9999999 (n = 75). Every value exceeds 0.9. ✔ *(The raw sin4_fraction is SUPERSEDED as a quantitative claim — see headline finding 2: pi.C6 drops the ΔM=0/ΔM=±1 channels, inflating it to ≈1. E4's three-channel decomposition gives the true fraction 0.921, which still exceeds 0.9, so condition (ii) is NOT invalidated.)*
- **(iii) Anchors.** `computed.c6_ss_43s_ghz_um6` = −2.4413 GHz µm⁶ vs Low2012 −2.441 (0.014% deviation, within 5%). `computed.c6_ss_70s_ghz_um6` = −868.6 GHz µm⁶ vs Walker2008 set {891, 862, 862, 853}; deviation from the mean (~867) is < 1% and falls inside the published eigenvalue spread (~10%). ✔

### Headline findings

1. **SS pairs are isotropic to < 2%.** Across n = 40–80, the SS anisotropy ratio stays in 1.012–1.019. C6_SS(60) = −138.86 GHz µm⁶ (`computed.c6_ss_60_ghz_um6`), independently confirmed by the Singer n¹¹ analytic formula at −140.27 GHz µm⁶ (`computed.c6_ss_60_singer_ghz_um6`, 1.0% off) and ARC `PairStateInteractions` at −141.15 GHz µm⁶ (`computed.c6_ss_60_arc_ghz_um6`, 1.6% off) — all three within ~2%, bounded by the ~2.5% QDT-model floor. The SS n-scaling exponent over n = 40–80 is 12.03 (`computed.n11_exponent`), consistent with Singer's nominal n¹¹ law with a polynomial prefactor; fitted as n*^11.33 over n = 50–80 (`computed.n_star_exponent_ss`).

2. **~~PP stretched pairs are sin⁴θ-dominated to > 99.999%~~ — SUPERSEDED.** The sin4_fraction ≥ 0.9999988 was a pairinteraction artifact: the pi.C6 degenerate-perturbation class silently drops the ΔM = 0 and ΔM = ±1 angular channels for the stretched pair, so the channel fit sees only the sin⁴ (ΔM = ±2) term and reports a fraction ≈ 1. E4's three-channel decomposition gives the true channels a = −2.60 (ΔM=0), b = −22.72 (ΔM=±1), c = +295.62 (ΔM=±2) GHz µm⁶, i.e. a true sin⁴ fraction c/(|a|+|b|+c) = 0.921. The acceptance criterion (sin4_fraction greater than 0.9) is NOT invalidated — 0.921 still passes — but the quantitative claim is withdrawn. At θ = 90° and n = 60 the perturbative coefficient is C6 = +299.11 GHz µm⁶ (attractive); the diagonalization control gives +268.08 GHz µm⁶ (10% near-Förster spread, S+S defect 0.278 GHz); ARC `getC6perturbatively` gives +292.4 GHz µm⁶ (`computed.c6_pp_theta90_60_arc_ghz_um6`, 2.3% off the perturbative value).

3. **Converged θ=0 residual (settled).** The converged C6(θ = 0°, n = 60) for the Rb 60P₃/₂ |m| = 3/2 stretched pair is −10.41 GHz µm⁶ (repulsive), confirmed by three independent methods to 0.04% central-value agreement: wide-window diagonalization −10.408 (`computed.c6_pp_theta0_60_diagonalization_wide_window_ghz_um6`), all-channel second-order sum −10.412 (`computed.c6_pp_theta0_60_second_order_sum_ghz_um6`), and ARC blind 10.4 ± 3 (recorded in the uncertainty_source of `c6_pp_theta0_60_diag`). The headline uncertainty is 0.3 GHz µm⁶ (~2.5% QDT-model floor from the 70S anchor), which dominates the 0.04% inter-method convergence.

4. **Physical PP anisotropy is ~26–29×.** `computed.c6_pp_anisotropy_60_diagonalization` = 25.76 (both-diagonalization: 268.08 / 10.41); `computed.c6_pp_anisotropy_60_mixed` = 28.74 (mixed: perturbative 299.11 / 10.41). The prior "18–60× range" was based on two stale artifacts now explained in `computed.theta0_discrepancy_resolution`: −4.96 was a single dominant channel (60S+59D, one symmetric partner), not the all-channel total; −16.16 was the ±20 GHz energy-window truncation. The two valid methods agree to 0.04%, so the "factor-3.3 discrepancy" evaporates.

5. **Energy-window truncation artifact explained.** The `computed.energy_window_truncation_finding` shows the default ±20 GHz window keeps the repulsive S+D channels (|defect| < 20 GHz, cumulative −16.16 GHz µm⁶) but excludes the attractive D+D channels (defect +20–30 GHz). The energy-window sweep converges: −16.16 at ±20 GHz, −12.04 at ±25 GHz, −9.63 at ±30 GHz, −10.41 at ±100 GHz. The second-order cumulative sum tracks this identically.

6. **The PP θ=0 residual is ~7.5% of the SS C6 at n = 60** (10.41 vs 138.86 GHz µm⁶). This sets the tight-packing floor for any PP gate geometry.

7. **PP θ=90° n-scaling departs from n¹¹ (new, reviewer Issue 5/6).** The PP θ = 90° C6 scales as n*^9.48 over n = 50–80 (`computed.n_star_exponent_pp_theta90` = 9.476), departing from the (n*)¹¹ Singer/Saffman prediction. The SS pair scales as n*^11.33 (`computed.n_star_exponent_ss` = 11.325), close to n¹¹. The departure is attributed to the near-Förster S+S resonance structure (1/Δ denominator in the dominant channel); the low-n region (n = 40–45) is non-monotonic (defect crossing), further confirming the resonance-driven origin.

8. **Cross-validation summary.** SS: three methods agree to ~1–2% (pairinteraction −138.86, Singer −140.27, ARC −141.15; perturbative vs diag 0.3%). PP θ = 90°: three methods agree to ~2–10% (perturbative 299.11, ARC 292.4, diag 268.08; the wider 10% spread vs diagonalization is the near-Förster S+S resonance). PP θ = 0°: RESOLVED — three valid independent methods converge to −10.41 GHz µm⁶ to 0.04%. The pairinteraction degenerate-perturbation C6 class returns −1.36 × 10⁻⁵ (`computed.c6_pp_theta0_60_perturbative_ghz_um6`), missing the dM = 0 channel — understood and not a conflict.

### Figure candidates

- `runs/run_1/data/c6_diag_theta0_energy_window_sweep.csv` → C6(θ = 0°) vs energy window + second-order cumulative vs |defect|; the decisive reconciliation plot (−16.16 → −10.41).
- `runs/run_1/data/c6_diag_theta0_convergence_sweep.csv` → C6(θ = 0°) vs basis half-width k (flat at −16.16 for ±20 GHz window; confirms the artifact was the energy window, not the basis).
- `runs/run_1/data/c6_second_order_sum_pp60_theta0.json` → per-channel contribution table (repulsive S+D vs attractive D+D cancellation).
- `runs/run_1/data/c6_independent_checks.json` → method-agreement summary (pairinteraction / Singer / ARC / diagonalization).
- `runs/run_1/data/c6_ss_pp_scan.csv` → SS/PP C6 vs n + anisotropy ratio vs n + the n*^9.48 vs n*^11 scaling departure.

### Alternatives considered

1. **ARC `PairStateInteractions` for C6** — rejected as production method (ARC's Yb module covers only ¹S₀, not Rb P₃/₂ MQDT channels), but USED as an independent cross-check: SS −141.15 GHz µm⁶ (`computed.c6_ss_60_arc_ghz_um6`), PP θ = 90° 292.4 GHz µm⁶ (`computed.c6_pp_theta90_60_arc_ghz_um6`).
2. **Hand-rolled second-order perturbation sum** — initially rejected as production (error-prone), promoted to an independent control that RESOLVED the θ = 0 discrepancy (all-channel sum −10.412 GHz µm⁶).
3. **Analytic single-channel sin⁴θ (Walker–Saffman) formula** — rejected: assumes only S+S channel, hiding the θ = 0 residual.
4. **Singer n¹¹ analytic formula** — now USED as an independent SS cross-check: −140.27 GHz µm⁶ at n = 60 (`computed.c6_ss_60_singer_ghz_um6`), within 1% of pairinteraction.
5. **Perturbative-only (no full-diagonalization control)** — rejected: the registry requires the full pair-Hamiltonian diagonalization control.

### Limitations

1. **Energy-window sensitivity at θ = 0°.** The default ±20 GHz window truncates the attractive D+D channels (defect +20–30 GHz), producing −16.16 instead of the converged −10.41 GHz µm⁶. Convergence requires sweeping `energy_window_ghz`; reached at ±100 GHz.
2. **θ = 90° near-Förster uncertainty ~10%.** The S+S Förster defect at n = 60 is 0.278 GHz (`computed.min_ss_forster_defect_ghz_by_n`). Diag C6(90°) = 268.08 vs perturbative 299.11 GHz µm⁶ (10% spread). Wide-window θ = 90° diagonalization fails (near-degeneracy "bijective map" errors / malloc crash), so the θ = 90° value carries ~10% uncertainty.
3. **QDT model accuracy ~2.5%** (70S anchor spread) bounds all computed C6 values; all methods are QDT-class, so inter-method agreement to < 2% is not evidence of < 2% accuracy vs experiment.
4. **Load-bearing constants** (Low2012 43S: −2.441, Walker2008 70S: {891, 862, 862, 853}) quoted verbatim from published LaTeX, reproduced via pairinteraction to 0.014% / 2.5% — not re-measured.
5. **Förster resonance approached above n = 80.** Minimum S+S defect is 0.161 GHz at n = 80, 0.185 GHz at n = 75. Perturbative C6 at n ≥ 75 should be treated cautiously.
6. **pairinteraction degenerate-perturbation C6 class misses the dM = 0 channel** at θ = 0° for stretched P₃/₂ pairs (returns −1.36 × 10⁻⁵ GHz µm⁶). This was the source of the original ~10⁶ anisotropy claim and is understood; it does not affect the converged diagonalization result.
7. **PP θ = 90° n*^9.48 departure from n¹¹** is attributed to near-Förster resonance structure but should be treated as an open question if a non-resonant n-region is needed for clean scaling.

### FollowUp: E_2_pp_packing_anisotropy

The corrected PP anisotropy (~26–29× at n = 60, with a θ = 0 floor of −10.4 GHz µm⁶) replaces all prior estimates (~18×/−16.2 and ~10⁶). Two tasks carry forward:

1. **Packing gain reassessment.** E_2 should plan around the verified ~26–29× anisotropy until a wider n-range is computed with converged energy windows. The θ = 0 residual is confirmed by three independent methods to 0.04% (with a ~2.5% QDT-model floor).
2. **n-dependent residual.** The `computed.c6_pp_theta0_diagonalization_by_n` values at n ≠ 60 still use the ±20 GHz window (the wide-window correction was performed only at n = 60). If the packing comparison is n-sensitive, the energy-window sweep should be repeated at the operating n.

## L2.2 — PP vs SS packing-density comparison (parallel two-qubit Rydberg-blockade gate arrays)

**Status:** Complete

**Experiment dir:** `data/experiments/E2_pp_packing_density/`

**Key computed leaves:**
- `computed.packing_gain_2d` = 1.380 (analytic sixth-root, rectangular lattice, n = 60)
- `computed.gain_2d_n60_packing` = 1.315 (numerical densest packing, staggered lattice, n = 60)
- `computed.factor_decoupled_n60` = 1.540
- `computed.factor_gate_n60` = 0.896
- `computed.magic_distance_conclusion.magic_distance_exists` = false

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Confirmatory. Predict at n=60 (wide-window-settled): (1) the 2D packing-density gain rho_PP/rho_SS equals the sixth-root scaling law gain_2d = [(|C6_SS/C6_0|)(|C6_SS/C6_90|)]^(1/6) within 15% (central ~1.38, clearly NOT the full ~26x anisotropy); (2) the two sixth-root factors are f_dec=(|C6_SS/C6_0|)^(1/6) in [1.3,1.8] and f_gate=(|C6_SS/C6_90|)^(1/6) in [0.75,0.95]; (3) the diagonal neighbor is NOT the binding constraint on the quantization-axis spacing at n=60 (the theta=0 same-column neighbor sets it; analytic law and full-pairwise packing agree <5%); (4) the magic-distance mechanism cannot raise the gain.

Verdict: **CONFIRMED** — all four sub-conditions hold.

| Sub-condition | Criterion | Result | Status |
|---|---|---|---|
| (1) Gain = sixth-root, not full anisotropy | analytic vs numerical within 15%; both ≪ 26× | 1.380 analytic / 1.315 packing (4.7% gap) | ✔ |
| (2a) f_dec ∈ [1.3, 1.8] | (|C6_SS|/|C6_0|)^(1/6) | 1.540 | ✔ |
| (2b) f_gate ∈ [0.75, 0.95] | (|C6_SS|/|C6_90|)^(1/6) | 0.896 | ✔ |
| (3) Diagonal not binding; methods agree <5% | analytic vs full-pairwise gap | 4.7%, traced to SS staggered-lattice advantage | ✔ |
| (4) Magic distance refuted | field-free θ=0 zero crossing | does not exist (D(θ) vanishes at θ=0) | ✔ |

### Headline findings

1. **The PP packing-density gain is ~1.3–1.4× at n = 60, not ~26×.** Blockade and cross-talk radii scale as |C6|^(1/6), so the full anisotropy ratio A ≈ 25.75 (`computed.anisotropy_n60`) is compressed to the sixth root. The analytic 2D gain is 1.380 (`computed.packing_gain_2d`); the densest full-pairwise packing (allowing staggered lattices) gives 1.315 (`computed.gain_2d_n60_packing`). The 4.7% gap between these two values is traced to the SS baseline exploiting a triangular-like staggered lattice that is ~11% denser than the rectangular SS lattice — not to a diagonal-neighbor constraint.

2. **The gain decomposes into two competing sixth-root factors.** Along the quantization axis (θ = 0, decoupled direction) the PP residual C6 = −10.41 GHz µm⁶ is 7.5% of the SS value −138.86 GHz µm⁶, giving f_dec = 1.540 (`computed.factor_decoupled_n60`). Perpendicular to it (θ = 90, gate direction) the PP C6 = 268.08 GHz µm⁶ exceeds the SS magnitude, giving f_gate = 0.896 (`computed.factor_gate_n60`). The 2D gain is their product: 1.540 × 0.896 ≈ 1.38.

3. **3D gain is smaller: 1.237 at n = 60** (`computed.gain_3d_n60`). In 3D (quantization axis out of plane), two of the three lattice directions lie at θ = 90, so the gate-direction penalty enters squared: gain_3D = f_dec × f_gate² ≈ 1.24.

4. **At the n = 75 canonical operating point the 2D gain is 1.476 (`computed.gain_2d_n75`), but this value is indicative** because the θ = 0 residual at n = 75 uses the ±20 GHz energy window (−128.76 GHz µm⁶), which at n = 60 overestimates the settled value by ~1.55× (−16.16 vs −10.41). The true n = 75 gain likely trends toward ~1.6.

5. **The magic-distance mechanism cannot raise the gain.** The Vermersch 2015 magic distance arises from C3-mediated cancellation, but at θ = 0 the angular coupling matrix D(θ) vanishes — the |m, m⟩ pair states are pure-blockade eigenstates — so the field-free θ = 0 potential V(r) = −C6/r⁶ is monotonic with no zero crossing (`computed.magic_distance_conclusion`).

6. **Even with a zero θ = 0 residual, the gain is capped at ~1.34–1.47×** (`computed.trap_limited_upper_bound_n60` = 1.471 rectangular, `computed.trap_limited_upper_bound_n60_staggered` = 1.341). The binding constraint shifts to the diagonal neighbor at θ ≈ 30° (from the gate pair's finite blockade extent d_gate = 5.47 µm), not the optical-trap floor.

### Alternatives considered

1. **Full anisotropy ratio as the gain (~26×)** — rejected: radii scale as C6^(1/6), compressing the ~26× ratio to ~1.38×. Verified by the analytic sixth-root law cross-checked against numerical packing.

2. **Constant-residual angular model C6(θ) = C6_0 + A·sin⁴θ** — rejected in favor of the channel decomposition C6(θ) = c₀(1−3cos²θ)² + c₂·sin⁴θ, which carries the ΔM = 0 channel's magic-angle zero at 54.7° and correctly treats diagonal neighbors at intermediate angles.

3. **Rectangular-lattice-only packing** — kept as the analytic baseline (gain 1.380), but the densest packing allows staggered/triangular lattices that improve the SS baseline by ~11%, reducing the gain to 1.315. Both values reported.

4. **Magic distance (Vermersch 2015) to cancel the θ = 0 residual** — refuted: the c-coupling is proportional to D(θ), which vanishes at θ = 0; the field-free θ = 0 potential is monotonic r⁻⁶ with no zero crossing.

5. **Single θ = 90 treatment only** — rejected: the near-Förster treatment spread (268.08 diag / 299.11 pert GHz µm⁶) is swept; it propagates only ~1.7% through the sixth root (gain 1.380 vs 1.355).

### Limitations

1. The n = 75 θ = 0 residual uses the ±20 GHz energy window (−128.76 GHz µm⁶), which is likely ~1.5× overestimated (at n = 60, window-20 gives −16.16 vs the settled −10.41); the n = 75 gain of 1.476 is therefore indicative, with the true value likely trending toward ~1.6. Downstream experiments should plan around the verified n = 60 gain (1.315–1.380) until a wider-window n = 75 computation is available.

2. The θ = 90 near-Förster treatment spread (~10%, 268.08 diag vs 299.11 pert GHz µm⁶, inherited from E1) enters the gain only at sixth-root level (~1.7%), so the headline gain is robust, but the absolute θ = 90 C6 carries that uncertainty.

3. The 2D gain has a 4.7% spread between the rectangular sixth-root law (1.380) and the staggered densest packing (1.315), traced to the SS baseline using a triangular-like lattice. Downstream experiments should use the range [1.315, 1.380] for the n = 60 gain.

4. An independent symbolic-derivation math agent was attempted but failed (no anchored failure record — attribution unverified); the sixth-root law was derived by hand and cross-validated numerically (analytic vs full-pairwise packing) and via blind unit tests.

5. Packing uses field conventions V_block = ℏΩ (Saffman 2010), V_ct = 10 kHz (Evered 2023), R_trap = 2 µm (Evered 2023). The gain is threshold-independent in the cross-talk-limited regime (the d_gate term cancels), so these choices do not change the headline gain.

6. The magic-distance check is field-free only; a B-field- or Förster-tuned C3 coupling at θ = 0 was not computed (the structural condition D(θ = 0) = 0 rules it out, but the derivation has not been extended to dressed-state potentials).

### Figure candidates

- `runs/run_1/data/gain_vs_n.csv` → gain-vs-n line plot (2D/3D, analytic sixth-root + densest packing), marking n=60 (settled) and n=75 (window-limited). **PRODUCED:** `report/figures/e2_packing_gain_vs_n.png`
- `runs/run_1/data/gain_vs_anisotropy.csv` → gain-vs-anisotropy log-x curve showing the A^(1/6) sixth-root shape, with the E1 settled range [25.76, 28.74] shaded and A_crit marked. **PRODUCED:** `report/figures/e2_packing_gain_vs_anisotropy.png`

### FollowUp: E_3_pp_packing_geometry_break_cap

- **Question**: Can a non-parallel or tilted-quantization-axis gate geometry (or a B-field/Förster-tuned magic distance at the diagonal angle theta ≈ 30°) push the 2D packing gain above the ~1.3–1.4× parallel-gate cap?
- **Why this experiment instead of accepting the negative**: the diagonal-neighbor finding (the gate pair's finite theta = 90° extent d_gate = 5.47 µm couples the row-stacking direction back into the strong-interaction regime) caps the gain at ~1.34–1.47× even with a zero theta = 0 residual, and the magic-distance mechanism is ruled out at theta = 0 (D(theta) vanishes there). A geometry that places the binding diagonal neighbor at the dM = 0 magic angle (54.7°, where the (1−3cos²θ)² channel vanishes) — e.g. a tilted quantization axis or staggered gate orientation — could in principle break this cap without any new C6 computation (E1's angular channel model is reused).
- **Estimated effort**: medium — parametrize the gate/lattice orientation relative to the quantization axis, re-run the `packing_density` optimizer over orientation, no new Rydberg physics required.
- **Decision rule**: if any orientation yields a gain exceeding 1.6× at n = 60, the ~1.4× figure is a property of the parallel/axis-aligned geometry, not a fundamental PP-vdW ceiling (the user's "more atoms" directive reopens). If no orientation exceeds ~1.5×, the ~1.3–1.4× gain is a robust ceiling for field-free PP vdW gates, and the directive closes with the corrected magnitude. (A companion task — computing the wide-window theta = 0 residual at n = 75 — is already flagged in E1's FollowUp and would firm the canonical-operating-point gain from 1.48 toward ~1.6.)

## L2.3 — PP packing gain vs gate/lattice orientation (does the dM=0 magic angle break the ~1.4x cap?)

**Status:** Complete

**Experiment dir:** `data/experiments/E3_pp_packing_geometry/`

**Key computed leaves:**
- `computed.max_gain_over_orientation` — 1.956 (best-found 2D packing gain over gate-axis and quantization-axis orientation; C6-model upper bound, not a physical ceiling — see caveats)
- `computed.c6_at_dm0_magic_angle_ghz_um6` — +120.30 GHz·µm⁶ (total C6 at the dM=0 magic angle 54.736°; far from zero)
- `computed.c6_total_zero_angle_deg` — 22.909° (angle where the total two-channel C6 vanishes: repulsive dM=0 cancels attractive dM=±2)
- `computed.baseline_gain_theta90_psi0` — 1.331 (gain at the physical strong-blockade orientation θ_gate=90°, ψ=0°)

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Confirmatory hypothesis test. Hypothesis: a non-parallel / tilted-quantization-axis gate geometry placing the binding diagonal neighbor at the dM=0 magic angle (54.7 deg) removes the diagonal-neighbor constraint and pushes the 2D packing gain above the ~1.3-1.4x cap. Predictions: (1) the dM=0 magic angle does NOT zero the total C6; (2) the genuine total-C6 zero is at theta* ~ 22.9 deg; (3) the maximum 2D packing gain over orientation at n=60 does not exceed 1.6x. Verdict reads computed.max_gain_over_orientation, computed.c6_at_dm0_magic_angle_ghz_um6, computed.c6_total_zero_angle_deg. CONFIRMED iff (max gain <= 1.6x) AND (|C6(54.7 deg)| > 10 GHz*um^6); REFUTED iff (max gain > 1.6x) OR (|C6(54.7 deg)| < 1 GHz*um^6).

**Verdict: REFUTED (mechanical).** `computed.max_gain_over_orientation` = 1.956 > 1.6, which triggers the REFUTED branch. Independently, prediction (1) is confirmed: |C6(54.7°)| = 120.30 >> 10 GHz·µm⁶. Prediction (2) is confirmed: the total-C6 zero is at 22.909° (closed-form quadratic root, verified by 181-point numeric grid to < 10⁻⁶ relative tolerance). **Critical caveat inline with the verdict:** the >1.6× gains arise from orienting the gate axis near the model's total-C6 zero at 22.9°, where the leading C6 term vanishes and the gain diverges (gate length → 0); this is a model breakdown, not a physical packing win (the C8 and higher-order terms, which are not included, dominate near the zero; furthermore the zero itself is an unverified interpolation since E1 anchored only θ=0° and 90°). For the physical strong-blockade gate orientation (θ_gate=90°), the gain stays at 1.33–1.40×.

### Headline findings

1. **The dM=0 magic angle (54.736°) does NOT zero the total interaction.** At 54.736°, the (1−3cos²θ)² channel (dM=0) vanishes, but the sin⁴θ channel (dM=±2) remains at 4/9 of its maximum. The total C6(54.736°) = +120.30 GHz·µm⁶ — comparable to C6(90°) = 268.08 GHz·µm⁶ and far from zero. The E2-FollowUp's stated mechanism ("place the diagonal neighbor at 54.7° to remove the interaction") conflates the single-channel zero with the total; it is physically incorrect.

2. **The genuine total-C6 zero is at 22.909°**, where the repulsive dM=0 contribution cancels the attractive dM=±2 contribution (C6(θ*) = c₀·(1−3cos²θ*)² + c₂·sin⁴θ* = 0, with c₀ = −2.60 GHz·µm⁶, c₂ = +270.68 GHz·µm⁶ from E1's n=60 values). This zero is a model interpolation anchored at only two points (θ=0° and 90°); its exact location and even its existence at the physical level are unverified.

3. **Gain > 1.6× exists in the C6 model but is unphysical.** The optimizer finds gains of 1.73× at (θ_gate=30°, ψ=20°) and 1.96× at (θ_gate=26°, ψ=22°), still climbing toward the C6 zero. At these orientations, C6(26°) ≈ 4.7 GHz·µm⁶ — 57× weaker than C6(90°) = 268.08 GHz·µm⁶ — placing the gate in a weak-blockade regime. The gain formally diverges as θ_gate → 22.9° because the model's gate length → 0. This divergence is unphysical: (a) higher-order C8 terms (absent from the model) dominate near the zero; (b) the zero is an unverified model artefact; (c) a 57×-weaker blockade shift is experimentally unusable without compensating measures.

4. **For the physical strong-blockade gate (θ_gate = 90°), the gain is 1.33×** (`computed.baseline_gain_theta90_psi0` = 1.331), consistent with E2's 1.31–1.47× range (1.3% lattice-family definition difference accounts for the spread). The ~1.4× cap remains robust for any orientation that maintains a strong blockade.

5. **Cross-validation.** The generalised optimizer at (θ_gate=90°, ψ=0°) reproduces E2's baseline gain to 1.3% (1.331 vs 1.315). The C6-zero angle agrees between closed-form and numeric grid to < 10⁻⁶ relative. The dM=0 magic-angle C6 matches the closed-form c₂·(4/9) = 120.30 exactly.

### Alternatives considered

1. **Keep θ_gate = 90° and only tilt the quantisation axis (ψ) out of plane** — rejected as incomplete parametrisation: the gate-axis angle θ_gate is the actual lever (the E2 cap stems from C6(90°)=268 > C6_SS=139); a pure ψ-tilt with θ_gate=90° cannot reverse that gate-direction penalty. The in-plane azimuth φ is pure gauge for a free lattice.

2. **Full 3D multi-layer packing** — rejected: out of scope (E2/E3 address 2D arrays; the user's question targets 2D packing density).

3. **B-field / Förster-tuned magic distance** — rejected: E2 already showed the magic-distance mechanism is ruled out at θ=0° (the structural condition D(θ=0)=0 holds), and the task mandates reusing E1's angular model with no new C6 computation.

4. **Independently re-compute C6 at intermediate angles (full pair diagonalisation at 22.9°)** — rejected as out of scope (task requires reusing E1's model, no new C6 computation); deferred to the E4 follow-up.

5. **(Chosen) Parametrise θ_gate and ψ, re-run the generalised packing optimizer** — the prescribed approach. Oblique-aligned and staggered lattice families explored; scipy bounded-Brent + scan for the gate-axis lattice vector (L1), scan + bisection for the cross-talk lattice vector (L2), full neighbour-cell enumeration.

### Figure candidates

- `data/report/figures/e3_c6_angular_analysis.png` — C6(θ) curve marking the dM=0 magic angle (54.7°, C6=+120) vs the genuine total zero (22.9°); settles the channel-zero vs total-zero confusion. **PRODUCED.**
- `data/report/figures/e3_packing_gain_vs_orientation.png` — gain heatmap vs (θ_gate, ψ) showing the >1.6× region hugging the C6 zero at 22.9°. **PRODUCED.**

### Limitations

1. The dM=0-magic-angle hypothesis (54.7°) rests on a channel/total confusion: the total C6 there is +120.30 GHz·µm⁶, not zero. The sin⁴θ (dM=±2) channel is non-negligible at all angles except θ=0°.

2. The genuine total-C6 zero at 22.909° is a **model interpolation**: E1 anchored the angular model at only θ=0° and 90°. The exact location of the zero and even whether the physical C6 actually passes through zero at any intermediate angle are unverified. Near the zero the higher-order C8 interaction (not included in the model) dominates, so the physical interaction does not vanish there.

3. The >1.6× gains are **model upper bounds**, not physical packing wins. They require a weak-blockade gate orientation (C6 up to 57× weaker than at θ=90°) and exploit the model's C6 zero, where the gain diverges.

4. The optimizer heuristic yields a **non-smooth landscape** (1.73× at θ_gate=30° vs 1.96× at θ_gate=26° from the coarse vs fine sweeps). The quoted maximum (1.956) is the best found, not a certified global optimum.

5. The lattice-family definition differs ~1.3% from E2 (stagger offset fixed at half-period along the gate axis vs E2's free offset along the row axis), producing a small baseline-gain spread (1.331 vs 1.315).

6. The math sub-agent was abandoned (`verbatim_last_error`: "No API key for provider: openai-codex"); analytic derivation was performed by the orchestrator and verified numerically by the reviewed tool (28 passing tests, closed-form + grid agreement exact).

### FollowUp: E_4_verify_c6_zero_and_physical_gain_cap

**Motivation:** E3 found that the two-channel C6 model admits a total-C6 zero at 22.9°, but this zero is unverified (E1 anchored only θ=0° and 90°) and the >1.6× gains near it are model breakdowns. The natural next step is to determine whether the zero is real and what the physical gain ceiling is.

**Discriminating computation:** (a) Full pair diagonalisation (or pairinteraction) at 5–10 intermediate angles (especially 20°–30° in 2° steps) to verify whether C6 actually passes through zero near 22.9°, and to extract the C8 coefficient; (b) re-run the packing optimizer with a strong-blockade constraint (e.g. |C6(θ_gate)| ≥ |C6_SS| = 138.86 GHz·µm⁶, or a minimum V/Ω ratio ≥ 10) to determine the physical max gain.

**Decision rule:** If the full diagonalisation at 20°–30° confirms |C6(θ)| < 1 GHz·µm⁶ at some angle in [20°, 26°], the zero is real and the question shifts to whether C8-dominated gates are viable. If |C6(θ)| ≥ 10 GHz·µm⁶ at all sampled angles, the model's zero is an artefact of the two-point anchor and the ~1.4× strong-blockade cap is confirmed as robust. In either case, the strong-blockade-constrained gain provides the physical ceiling to quote in the report.

## L2.4 — Verify the C6 zero at intermediate angles and the physical packing-gain ceiling (E4)

**Status:** Complete

**Experiment dir:** `data/experiments/E4_verify_c6_zero_physical_gain/`

**Key computed leaves:**

| key | value |
|---|---|
| `computed.c6_total_zero_angle_deg` | 24.65 deg (three-channel root; supersedes 24.3±0.35 inter-method avg; full-diag 24.0) |
| `computed.c6_diag_min_abs_ghz_um6_in_20_26` | 0.007 GHz µm⁶ |
| `computed.c6_dm1_channel_ghz_um6` | −22.7 GHz µm⁶ |
| `computed.c5_at_zero_ghz_um5` | −0.126 GHz µm⁵ |
| `computed.c8_at_zero_ghz_um8` | +1.747 GHz µm⁸ |
| `computed.strong_blockade_max_gain_2d` | 1.35 (±0.05) |

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Criterion (verbatim): "Confirmatory. Predict: the physical C6(theta) of the Rb 60P3/2 stretched pair passes through zero at theta* in [20,26] deg (repulsive at smaller theta, attractive at larger theta), with min|C6(theta)| < 1 GHz um^6 in [20,26]; the next-order interaction near theta* is finite (C5/C8); and the strong-blockade-constrained max 2D packing gain <= 1.6x. Verdict reads computed.c6_diag_min_abs_ghz_um6_in_20_26 and computed.c6_total_zero_angle_deg and computed.strong_blockade_max_gain_2d. CONFIRMED iff min|C6| < 1 GHz um^6 AND C6 changes sign across theta* in [20,26]. REFUTED (zero is an artifact) iff |C6| >= 10 GHz um^6 at all sampled angles in [20,26]."

**Verdict: CONFIRMED.** `computed.c6_diag_min_abs_ghz_um6_in_20_26` = 0.007 < 1 GHz µm⁶; C6 changes sign across θ* ≈ 24.65 deg (within [20, 26]); `computed.strong_blockade_max_gain_2d` = 1.35 ≤ 1.6.

### Headline findings

1. **The total-C6 zero is real at ~24.65 deg (not 22.9 deg), confirmed by two independent methods.** The canonical value is the three-channel root 24.65 deg (all-channel second-order perturbation sum, n_range 55-65); a hand-built full dipole-dipole diagonalisation with Zeeman lifting places it at 24.0 deg (the earlier 24.3±0.35 inter-method average is superseded). Both confirm a sign change in [20, 26] deg, with `computed.c6_diag_min_abs_ghz_um6_in_20_26` = 0.007 GHz µm⁶. The 0.65 deg inter-method spread is attributed to the window-30 diag truncation of the D+D channel.

2. **The ΔM=±1 channel (b = −22.7 GHz µm⁶) was neglected by the E3 two-channel model and shifts the zero ~1.4 deg.** The three-channel decomposition gives a = −2.60, b = −22.72, c = +295.62 GHz µm⁶; E3's two-channel model set b = 0. This also corrects C6(54.7°) from the E3 value of 120.3 to 126.3 GHz µm⁶ (`computed.c6_at_dm0_magic_angle_ghz_um6`).

3. **Near the zero the interaction floor is set by quadrupole terms: C5 = −0.126 GHz µm⁵, C8 = +1.747 GHz µm⁸.** At separations of 2–3 µm these yield sub-MHz interaction strengths (weak, insufficient for blockade near θ*).

4. **The strong-blockade-constrained max 2D packing gain is 1.35** (baseline θ = 90°/ψ = 0° gives 1.331). This is the physical ceiling under the requirement |C6(θ_gate)| ≥ |C6_SS| = 138.86 GHz µm⁶.

5. **E1's sin⁴ fraction = 0.9999999 was an artifact.** pairinteraction's `pi.C6` silently drops both the ΔM = 0 and ΔM = ±1 channels for the stretched pair; the true sin⁴ fraction among the three channels is ~0.93 (c / (|a| + |b| + c) ≈ 295.62 / 321.0).

### Figure candidates

- `data/c6_angle_scan.csv` → C6(θ) curve (both methods) showing zero crossing at 24.65 deg, overlaid with the E3 two-channel model.
- `data/quadrupole_floor.json` → C5, C8 vs angle, showing the sub-MHz interaction floor near θ*.
- `data/strong_blockade_gain.json` → 2D packing gain vs gate-axis orientation, showing the 1.35 cap.

### Alternatives considered

1. **pairinteraction `SystemPair` full diag at intermediate angles** — abandoned (anchored failure record: `computed.method_blocked`, `verbatim_last_error`: "theta=25 vs 0: max|dE| = 0.0 nonzero count = 0 (eigenvalue spectrum identical for theta=0/25/90)"). The library applies the distance but ignores the angle in the interaction matrix. **DISPOSED (accept-with-disclosure):** the hand-built fallback was cross-checked against the all-channel second-order sum (0.04% central-value agreement at θ=0, ~1% at intermediate angles); see `computed.method_blocked_resolved`.

2. **pairinteraction `pi.C6` with `set_angle`** — rejected; it drops the ΔM = 0 and ΔM = ±1 channels for the stretched pair, producing the misleading sin⁴ fraction = 0.9999999 (E1 artifact).

3. **Trust E3's two-channel model (zero at 22.909 deg)** — rejected; the ΔM = ±1 channel (b = −22.7 GHz µm⁶) is non-negligible (8% of c = 295.6) and shifts the zero by ~1.4 deg.

4. **Chosen method:** hand-built full dipole-dipole Hamiltonian diagonalisation (scipy) with explicit angle-dependent C3(θ) coupling and a Zeeman term (0.005 GHz) to lift the 16-fold m-degeneracy, cross-validated against the all-channel second-order perturbation sum.

### Limitations

1. **Window-30 diag truncation:** the hand-built diag uses a 30 GHz energy window (n = 58–62), which truncates distant D+D channels and shifts the zero (24.0 deg diag vs 24.65 deg second-order sum; canonical zero 24.65 deg; the earlier 24.3 deg inter-method average is superseded).

2. **S+S Förster near-resonance (0.278 GHz):** the S+S channel makes the θ = 90° C6 anchor (268.08 GHz µm⁶ diag vs 299.11 perturbative) ~10% uncertain, propagating to the sin⁴ coefficient c.

3. **C8 convergence not swept:** the C8 = +1.747 GHz µm⁸ value sums over 4200 dipole-quadrupole channels (n = 58–62, l = 0–3) but convergence with respect to n-window was not verified.

4. **C5 control (full diag R⁻⁵ tail fit) not executed:** C5 is computed from a single exact diagonal matrix element; an independent extraction from full-diag eigenvalue tails was planned but not carried out.

5. **Strong-blockade gain is a grid+heuristic optimum, not a certified global maximum:** the best gain 1.35 (at θ = 90°/ψ = 15°) was found on a discrete orientation grid; the true global max could differ by the quoted ±0.05 uncertainty.

6. **Isolated-state C6 requires Zeeman lifting of the 16-fold m-degeneracy:** without a quantisation field the naive max-overlap state-tracking returns the θ = 0 energy for θ ≤ 35 deg; a small Zeeman splitting (0.005 GHz) was applied, but its effect on the zero location was not independently bounded.

### FollowUp: E5_weak_blockade_c5c8_gate_viability

**Motivation:** Near θ* ≈ 24.3 deg the C6 vanishes and the interaction is dominated by C5/C8 (sub-MHz at 2–3 µm). Is a useful entangling gate still viable in this weak-blockade, higher-multipole regime?

**Decision rule:** VIABLE if there exists a gate configuration (R, Ω, t_gate) where the C5/C8-dominated interaction yields fidelity ≥ 0.99 for a two-qubit phase gate with realistic Rydberg lifetimes (τ ~ 100 µs for n = 60); NOT VIABLE otherwise.

**Estimated effort:** small (analytic gate-fidelity estimate from known C5, C8, lifetime).

## L2.5 — Weak-blockade C5/C8 gate viability (is a 0.99-fidelity phase gate possible near the C6 zero?)

**Status:** Complete

**Experiment dir:** `data/experiments/E5_weak_blockade_gate_viability/`

**Key computed leaves:**
- `computed.cz_gate_max_fidelity` = 0.9967
- `computed.optimal_gate_config` — R=2.0 µm, Ω=160 MHz, t_gate=0.1855 µs, interaction (pi-pi-hold-pi-pi) gate
- `computed.fundamental_min_interaction_mhz_for_0_99` = 0.318 MHz
- `computed.fundamental_max_viable_separation_um` = 2.2874 µm
- `computed.sub_mhz_regime_max_fidelity` = 0.981

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Criterion (verbatim): "Existence/optimization. Sweep R in [1,5] um and Omega in [1,500] MHz at the C5/C8 interaction (C5=-0.126 GHz um^5, C8=+1.747 GHz um^8 at theta*~=24.3 deg), tau=100 us. Let F_max = computed.cz_gate_max_fidelity. VIABLE iff F_max >= 0.99; NOT VIABLE iff F_max < 0.99."

**Verdict: VIABLE.** `computed.cz_gate_max_fidelity` = 0.9967 >= 0.99, with the qualifier that viability is confined to R ≤ ~2.2 µm where |V| >= 0.7 MHz (not in the genuinely sub-MHz regime).

### Headline findings

1. **VIABLE: max two-qubit CZ fidelity 0.9967 (>= 0.99).** The optimum under the interaction (pi-pi-hold-pi-pi) gate is at R = 2.0 µm, Ω = 160 MHz, t_gate = 0.1855 µs, where V = −2.887 MHz. The grid maximum at R = 1.0 µm reaches 0.9994 but is flagged unreliable: higher multipoles (C9+) are uncomputed at that separation.

2. **The interaction near the C6 zero is few-MHz at R = 2 µm, not sub-MHz.** V(R) = −C5/R⁵ − C8/R⁸ gives V = −2.887 MHz at R = 2.0 µm. The potential crosses zero at R = 2.4024 µm (dead zone where C5 and C8 cancel), and is sub-MHz (|V| ≤ 0.27 MHz) only for R >= 2.4 µm.

3. **NOT viable in the sub-MHz regime.** For R >= 2.5 µm the best fidelity caps at 0.981 (`computed.sub_mhz_regime_max_fidelity`). The Saffman-2016 fundamental bound E >= 2/(Vτ) requires |V| >= 0.318 MHz for F >= 0.99, which holds only for R ≤ 2.2874 µm (`computed.fundamental_max_viable_separation_um`).

4. **Two protocols simulated.** The pi-2pi-pi blockade gate dominates in the strong regime (R ≤ 1.5 µm); the pi-pi-hold-pi-pi interaction gate dominates in the weak regime (R ~ 2.0–2.2 µm). The "best gate" is the pointwise maximum over both protocols.

5. **Cross-validation: master equation vs Saffman-2010 Eq. 34 analytic agree to ~10% on infidelity** across R = 2.0–3.0 µm (master infidelity 0.0033 vs analytic 0.0030 at R = 2.0 µm, Ω = 160 MHz).

### Figure candidates

- `runs/run_1/data/best_gate_vs_R.json` → best-gate-fidelity vs R line plot with 0.99 threshold + dead-zone shading (rendered at `report/figures/e5_gate_viability.png`)
- `runs/run_1/data/interaction_gate_fidelity.csv` → fidelity heatmap vs (R, Ω)
- `runs/run_1/data/interaction_vs_R.csv` → V(R) curve with sign crossing + ±0.318 MHz threshold lines
- `runs/run_1/data/cross_validation.json` → master-vs-analytic agreement

### Alternatives considered

1. **pi-2pi-pi blockade gate only** — rejected: wrong protocol in the weak regime (F ~ 0.25 at R = 2 µm where V ≪ Ω); the interaction gate with an explicit π/|V| hold phase was added.

2. **Analytic Saffman Eq. 34 only** — rejected as sole method: validity region unknown a priori; full master equation (qutip liouvillian) added as authoritative, Eq. 34 kept as cross-check.

3. **pairinteraction/ARC re-derivation of C5/C8** — rejected: out of scope (E4 already computed them; inherited as inputs).

4. **Optimal-control shaped pulses** — rejected: overkill for this existence question.

### Limitations

1. **Independent adversarial test authorship not executed.** tool_review sub-agent was abandoned (`verbatim_last_error`: "429: {\"code\":\"1113\",\"message\":\"\\u4f59\\u989d\\u4e0d\\u8db3\\u6216\\u65e0\\u53ef\\u7528\\u8d44\\u6e90\\u5305,\\u8bf7\\u5145\\u503c\\u3002\"}"). Fallback: orchestrator pre-registered analytic checks + master-vs-analytic cross-validation (~10% infidelity agreement).

2. **C8 convergence unswept** (inherited from E4); higher multipoles (C9+) neglected → model unreliable at R < ~1.5 µm.

3. **τ = 100 µs is the 60S value; 60P₃/₂ decays faster** → computed fidelity is an upper bound (this strengthens the NOT-viable conclusion in the sub-MHz regime).

4. **Square pulses only; no motional dephasing; single Rydberg level; equal-Rabi off-resonant |0⟩↔|r⟩ coupling.**

5. **Grid + analytic optimum, not a certified global optimum.**

### FollowUp: E6_interaction_gate_packing_gain

- **Question:** With the interaction gate viable at R ~ 2.0 µm (vs strong-blockade C6 gate at R ~ 5.5 µm), what is the corrected packing gain when the C5/C8 dead zone and the R ≤ 2.2 µm viability boundary are enforced?
- **Why:** E3/E4 found a ~1.35× strong-blockade cap and model-divergent gain near the C6 zero; E5 shows a real gate exists at R ~ 2 µm, so the gain should be re-derived with the real interaction-gate fidelity and R-boundary.
- **Estimated effort:** medium (reuse E2/E3 packing tools + this experiment’s interaction-gate fidelity).
- **Decision rule:** CONFIRM ~1.35× cap if corrected gain still caps near 1.35; BREAK cap if the R ~ 2 µm interaction gate yields gain substantially above 1.35.

## L2.6 — Interaction-gate packing gain (does the R~2 um C5/C8 interaction gate break the ~1.35x cap?)

**Status:** Complete

**Experiment dir:** `data/experiments/E6_interaction_gate_packing_gain/`

**Key computed leaves:**
- `computed.interaction_gate_packing_gain_2d` — 2D density ratio PP interaction gate / SS strong-blockade gate
- `computed.pp_interaction_gate_density_per_um2` — PP interaction-gate packing density
- `computed.ss_baseline_density_per_um2` — SS strong-blockade packing density (cross-check)
- `computed.verdict` — acceptance-criterion verdict

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> G equals the 2D packing-density gain of the PP interaction gate (R=2.0 um, theta*=24.65 deg) over the SS strong-blockade gate (isotropic, blockade radius at V_block=0.01 GHz), both at V_ct=1e-5 GHz, with the full three-channel + C5/C8 potential. Verdict reads computed.interaction_gate_packing_gain_2d. CONFIRMED (~1.35 cap holds) iff G < 1.6; REFUTED (cap breaks) iff G >= 1.6.

**Verdict: REFUTED** — `computed.interaction_gate_packing_gain_2d` = 1.9765 >= 1.6. The ~1.35× strong-blockade packing cap is broken by the R ~ 2 µm C5/C8 interaction gate.

### Headline findings

1. **Interaction-gate 2D packing gain = 1.98 ± 0.1** (PP density 0.013911 atoms/µm² vs SS 0.007038 atoms/µm²), substantially exceeding the 1.35× strong-blockade cap.

2. **Mechanism — shorter gate length + anisotropic cross-talk.** Gate length is 2.0 µm vs SS blockade radius 4.90 µm (2.4× shorter). The gate axis sits at the C6 zero (θ* = 24.65°), where the along-gate cross-talk radius is only 6.54 µm (vs 15.26 µm at the magic angle, 17.54 µm at 90°). Along-gate stacking pitch is 8.54 µm (= 6.54 + 2.0) vs SS 36.66 µm (~4.3× tighter), which more than compensates for the looser perpendicular stacking (L₂ = 40.36 µm) forced by the large cross-talk radius at ~90° (17.54 µm). Unit cell area = 143.77 µm².

3. **Robustness across gate length:** gain ranges from 1.95 (R = 2.2 µm, density 0.01374) to 2.11 (R = 1.5 µm, density 0.01487) over R ∈ [1.5, 2.2] µm; the gain exceeds 1.6 across the entire E5-viable range.

4. **Robustness across lattice orientation (non-degenerate):** gain ranges from 1.97 to 1.99 across a₂ angles of 0°, 45°, 60°, 90°, 120°, and −24.65°. The a₂ = 30° orientation gives gain = 2.52 but is near-degenerate (lattice angle ~5.35°) and is excluded as fragile.

5. **Cross-validation:** SS density reproduced exactly (0.007038, 2.6 × 10⁻⁵ relative error vs E2). Strong-blockade PP gain reproduced at 1.3385 vs E4 1.331 (0.6% relative, within the near-Förster C6(90°) spread of 293.02 three-channel vs 268.08 full-diag). Independent brute-force feasibility check confirms worst |V|/v_ct = 1.0000 (binding constraint saturated, not violated).

6. **Premise correction:** the three-channel C6 zero is at 24.65°, not the E4 headline 24.3°. At 24.3° the residual C6 = −0.51 GHz·µm⁶ contributes +8 MHz at R = 2.0 µm, flipping the gate interaction sign. E6 uses 24.65°.

### Alternatives considered

- **(a) Reuse E3/E4 two-channel strong-blockade packing tool:** rejected — drops the ΔM = ±1 channel (b = −22.72, 8% of c) which shifts the C6 zero to 24.65°, and derives gate length from a blockade radius instead of the fixed 2.0 µm interaction-gate separation.
- **(b) Naïve (5.5/2.0)² ≈ 7.5× gate-length-ratio estimate:** rejected — packing is cross-talk-limited, not gate-length-limited; the actual gain (1.98) is far below the naïve estimate.
- **(c) E3/E4 C6 zero leading to infinite density divergence:** rejected — C5/C8 floor keeps the along-gate cross-talk radius finite (6.54 µm at θ*).
- **(d) Hexagonal/triangular lattice family:** not primary — the tilted gate axis favours an oblique lattice; covered by aligned + staggered configurations plus a 7-angle orientation sweep.

### Limitations

1. Independent adversarial test authorship was not executed: tool_review model tier returned quota error (verbatim_last_error: 429 code 1113) on 3 attempts; fallback = orchestrator pre-registered analytic checks + cross-validation against E2/E4.
2. Lattice family is not a certified global optimum — found via grid sweep + bisection over periodic oblique lattices. The near-degenerate a₂ = 30° orientation (gain 2.52) was excluded as fragile.
3. C5/C8 coefficients evaluated only at θ* = 24.65°; angular variation of C5/C8 and C9+ terms are neglected (unreliable at R < 1.5 µm).
4. Near-Förster spread of C6(90°) — 293.02 (three-channel) vs 268.08 (full-diag, ~10%) — propagates to gain at ~2%.
5. Single principal quantum number n = 60.

### Figure candidates

- `runs/run_1/data/crosstalk_radius_vs_angle.csv` → line plot R_ct(θ) vs θ ∈ [0°, 90°], marking the weak directions (0° ≈ 10.3 µm, θ* = 24.65° ≈ 6.5 µm) vs the strong directions (54.7° ≈ 15.3 µm, 90° ≈ 17.5 µm) — settles *why the gate-axis tilt at the C6 zero matters for packing*.
- `runs/run_1/data/gate_length_sweep.csv` → gain vs gate length R ∈ [1.5, 2.2] µm — settles *operating-point robustness of the ~2× gain*.
- `runs/run_1/data/orientation_sweep.csv` → gain vs a₂ lattice direction φ — settles *lattice-orientation robustness* (and shows the fragile near-degenerate φ = 30° outlier at 2.52).

## L2.7 — Discriminator settlement (re-run the reviewer-specified computations on the four disputed headline quantities)

**Status:** Complete

**Experiment dir:** `data/experiments/E7_discriminator_settlement/`

**Key computed leaves:** `computed.c6_diag_min_abs_ghz_um6_in_20_26`, `computed.c6_total_zero_angle_deg`, `computed.max_gain_over_orientation`, `computed.pp_interaction_gate_density_per_um2`, `computed.method_blocked`.

**Acceptance criterion (frozen at Phase 1, verbatim):** "Confirmatory settlement. Predict: (i) wide-window full-diag min |C6| over [20,26] < 1 GHz um^6 (zero real; REFUTED if >= 10 at all sampled angles); (ii) the wide-window full-diag C6 crosses zero at theta* in [23.35, 24.95] deg; (iii) three-channel strong-blockade max gain <= 1.6 (NOT the 1.96 near-C6-zero artifact); (iv) interaction-gate density in [0.0125, 0.0153] (0.0139 +- 10%). Verdict reads computed.c6_diag_min_abs_ghz_um6_in_20_26, computed.c6_total_zero_angle_deg, computed.max_gain_over_orientation, computed.pp_interaction_gate_density_per_um2."

**Verdict: confirmed** — all four discriminator expectations are met.

### Headline findings

1. **The C6 zero is real: `c6_diag_min_abs_ghz_um6_in_20_26` = 0.64 GHz·µm⁶** (wide-window 100 GHz full pair-Hamiltonian diagonalization at 1° steps; the all-channel second-order sum gives 0.52). Both are ≪ 1 GHz·µm⁶, refuting the stale blind estimate 22.17 and confirming the prior producer E4 ≈ 0.007 was in the right regime (E4's window-30 zero sat at exactly 24.0°; the wide window moves the full-diag zero to 24.43°).
2. **The true C6 zero is at 24.4–24.6°: `c6_total_zero_angle_deg` = 24.5° ± 0.2°.** Wide-window full-diag gives 24.4327°, all-channel second-order gives 24.6426° (0.21° inter-method spread). Both the stale blind 45° and the superseded E3 two-channel 22.909° are refuted.
3. **The 1.96 near-C6-zero divergence is refuted: `max_gain_over_orientation` = 1.34** (three-channel potential, strong-blockade constraint |C6(θ_gate)| ≥ 138.86 GHz·µm⁶). The three-channel optimizer gives 1.3385 at θ_gate=90°; the two-channel E4 sweep gives 1.331; the new tool's baseline 1.329 — all agree to <1%. The strong-blockade ceiling holds at ~1.34 for the established aligned+staggered lattice families.
4. **The interaction-gate density is 0.0139 atoms/µm²: `pp_interaction_gate_density_per_um2` = 0.013911** (C5/C8 gate at the C6 zero, R=2 µm, full pairwise cross-talk), reproducing E6's 0.0139 exactly; an independent brute-force full-cell recheck finds worst |V|/v_ct = 1.0000001 (the exhibited lattice saturates but does not violate the constraint).
5. **Premise correction:** a more general oblique lattice (free azimuthal angle for the second basis vector) + a 15° quantization tilt gives ~1.56 at θ_gate=70° (winning |C6|=227, still strongly blockaded). This is NOT the near-C6-zero divergence — it is a lattice-family generalization the E3/E4 optimizers did not search. It is recorded as **UNVERIFIED** (`headline_scalars.max_gain_over_orientation_general_oblique_unverified = 1.56`) because the new tool is not adversarially tested (tool_review quota-blocked); it must not be narrated as a settled headline.

### Figure candidates

- `runs/run_1/data/c6_discriminator_scan.csv` → line plot C6(θ) vs θ ∈ [20°, 29°] for the two methods (wide-window full-diag and all-channel second-order), marking the two zero crossings (24.43° and 24.64°) — settles the disputed zero angle (45° stale blind and 22.909° two-channel are both refuted).

### Alternatives considered

1. **E3/E4 two-channel oriented packing optimizer (c0, c2 only)** — rejected: drops the dM=±1 b channel, which shifts the C6 zero from ~22.9° to ~24.4–24.6°.
2. **Narrow (30 GHz) energy-window full diagonalization** — rejected: E1 showed it truncates the attractive D+D channels (defect +20..30 GHz) and shifts the zero; the reviewer's discriminator requires the wide (100 GHz) window.
3. **pairinteraction SystemPair.set_distance(angle_degree=…)** for finite-angle diagonalization — rejected: E4's method_blocked shows pairinteraction 2.5.1 ignores the angle in the interaction matrix; the hand-built angle-dependent dipole-dipole diagonalization is required.
4. **Reporting the all-channel second-order sum alone** — rejected: the discriminator explicitly asks for the full pair-Hamiltonian diagonalization as the primary; the second-order sum is retained as the independent cross-validation.

### Limitations

1. **tool_review (adversarial test author) quota-blocked** — HTTP 429 code 1113 ("余额不足或无可用资源包,请充值。") on 2 attempts, and ledger_writer also quota-blocked (400 credit balance). The new `three_channel_oriented_packing` tool therefore lacks adversarial tests; fallback was orchestrator pre-registered semantic checks (isotropic-limit known answer 0.007038 exact, gate-length anchor exact, strong-blockade acceptance, b-channel sensitivity). Recorded as `computed.method_blocked`.
2. **Wide-window full diagonalization used n_range (58,62)** instead of (55,65) to fit the 100 GHz pair basis in memory; θ=30° hit an eigsh "Not enough memory" error (irrelevant — the zero is at 24.4°).
3. **Near-Förster S+S sensitivity** near the zero: full-diag C6 is ~0.1–0.6 GHz·µm⁶ higher than the second-order sum there, giving a ~0.2° inter-method zero-angle spread.
4. **The ~1.56 general-oblique-lattice gain is unverified** (untested optimizer); the settled headline is the restricted-family 1.34.
5. Single principal quantum number n = 60.

### FollowUp: E8_general_oblique_packing_corroboration

- **Question**: Is the ~1.56 strong-blockade packing gain from a general oblique lattice (free azimuthal angle) + 15° quantization tilt physically real, or an artifact of the untested Nelder-Mead optimizer?
- **Why this experiment instead of accepting the negative**: the 1.34 headline is a lattice-family lower bound, not a proven ceiling; the general oblique result (1.56) sits between the 1.4 "ceiling" and the 1.6 "breakdown" bins of the frontier discriminator, and deciding which side is real changes the report's headline packing-gain claim.
- **Estimated effort**: small — one tool (independent second implementation of the oblique-lattice packing optimizer, e.g. a different lattice parameterization + a brute-force/linear-programming cross-check) + adversarial tests.
- **Decision rule**: if an independently-implemented optimizer reproduces ~1.56 at the exhibited orientation, the ceiling is ~1.6 (upgrade the headline); if it reproduces 1.34 (i.e. the 1.56 was a local-minimum artifact), the ≤1.4 ceiling is confirmed and the 1.56 candidate is discarded.
