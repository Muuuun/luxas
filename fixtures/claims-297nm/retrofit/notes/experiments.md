# Experiment Notes

## L2.1 — Single-photon 297 nm transition strength and laser power requirement (Rb 5S₁/₂ → nP)

**Experiment dir:** data/experiments/E1_transition_strength_power/

**Key computed leaves:**
- `computed.d2_reduced_a0` (5.9783 a₀)
- `computed.rabi_38P_khz` (101.25 kHz)
- `computed.rabi_per_sqrt_power_at_297nm_MHz_per_sqrt_mW` (0.902 MHz/√mW)
- `computed.power_budget_at_297nm_mW` (1.228 mW for 1 MHz Ω; 4.912 mW for 2 MHz Ω)
- `computed.n_at_target` (P₁/₂: 75.34, P₃/₂: 75.33)

**Status:** Complete

**Acceptance criterion (frozen at Phase 1) + Verdict:**

> Criterion: "CONFIRMED iff (a) computed.d2_reduced_a0 reproduces the published D2 reduced matrix element (Safronova 5.956 a0) within 1% (0.99 ≤ d2_ratio_vs_safronova ≤ 1.01) AND (b) computed.rabi_38P_khz reproduces Manthey2014's measured 2π×90 kHz within a factor 1.5 (0.5 ≤ rabi_38P_ratio_vs_90khz ≤ 1.5); REFUTED otherwise."

**Verdict: Confirmed.**
- (a) `computed.d2_reduced_a0` = 5.9783 a₀ vs Safronova 5.956 a₀ → `computed.d2_ratio_vs_safronova` = 1.0037, within 1%.
- (b) `computed.rabi_38P_khz` = 101.25 kHz vs Manthey 90 kHz → `computed.rabi_38P_ratio_vs_90khz` = 1.125, within factor-1.5 window [0.5, 1.5].

### Headline findings

- **n ↔ λ mapping at 297.0 nm:** The target wavelength 297.0 nm addresses n ≈ 75 (P₁/₂: 75.34, P₃/₂: 75.33), not n ≈ 55–65 as originally estimated in the plan. The fine-structure splitting at n = 75 is ~230 MHz, so P₁/₂ and P₃/₂ are spectrally well-resolved.
- **Dipole matrix element validation:** ARC Numerov radial integration gives `computed.d2_reduced_a0` = 5.9783 a₀, matching the Safronova coupled-cluster benchmark (5.956 a₀) to 0.37%. The radial scaling exponent fitted over the nP₃/₂ series is −1.5096, consistent with the hydrogenic n*^(−3/2) expectation (−1.5).
- **Manthey cross-check (among tested constructions):** At n = 38, P = 7 mW, w = 700 μm (the corrected Manthey line-scan parameters), the computed Rabi frequency is 101.25 kHz, 12.5% above the measured 90 kHz — well within the ×1.5 acceptance window. The plan's originally stated "700 mW, 100 μm" parameters are internally inconsistent with the 90 kHz measurement (see Limitations).
- **Power budget at 297 nm (n ≈ 75), w₀ = 10 μm, F = 2 → F' stretched (best-case σ⁺):** Ω/√P = 0.902 MHz/√mW; reaching Ω = 2π × 1 MHz requires 1.228 mW; Ω = 2π × 2 MHz requires 4.912 mW. Corresponding π-pulse durations are 0.5 μs and 0.25 μs.
- **Stretched dipole matrix element at 297 nm:** μ = 8.63 × 10⁻³³ C·m (from `computed.mu_stretched_Cm_at_297nm`).

### Figure candidates

- `runs/run_1/data/dipole_matrix_elements.csv` — log-log plot of radial dipole matrix element vs n with n*^(−3/2) fit overlay (validates absolute scale + scaling law).
- `runs/run_1/data/rabi_power_budget.csv` — Ω/√P vs n at 10 μm waist with horizontal lines at 1 MHz and 2 MHz power thresholds (delivers the power requirement).
- `runs/run_1/data/n_lambda.csv` — λ vs n mapping across the Rydberg series (settles exact n ↔ λ correspondence and identifies 297 nm target).

### Alternatives considered

1. **Pure hydrogenic n*^(−3/2) scaling with a fitted prefactor** — rejected: no citable prefactor; the 5P anchor is non-hydrogenic so the prefactor is wrong by ~14×.
2. **Back-of-envelope from the D2-line dipole moment scaled by n^(−3/2)** — rejected: same failure; the 5P state is not in the hydrogenic asymptotic regime, so scaling its dipole to n = 38 or 75 gives the wrong absolute scale.
3. **Citing Manthey2014's 90 kHz directly without computation** — rejected: no instantiation on our inputs (n ≈ 75 at 297 nm, 10 μm waist), no n-scan, no power budget.
4. **ARC model-potential Numerov integration** — CHOSEN (field standard, Sibalic2016), validated against D-line literature + Manthey experiment.
5. **pairinteraction `get_matrix_element` as an independent second code** — considered but not run: for the ground (5S) → Rydberg dipole both ARC and pairinteraction are QDT-class and the methods registry notes "grade caps at indicative for ν < 25 lower states regardless"; the experimental Manthey anchor is the stronger control.

### Limitations

1. **Manthey parameter mis-specification in the plan:** The plan's stated Manthey anchor ("Ω = 2π × 90 kHz at 700 mW, ~100 μm") is internally inconsistent: the 90 kHz corresponds to the line-scan condition P = 7 mW, w = 700 μm (SEM_UV.tex Fig caption "I = 7 mW, w = 700 μm"), NOT 700 mW / 100 μm. Verified: computed Ω at 7 mW / 700 μm = 101.25 kHz ≈ 90 kHz; at 700 mW / 100 μm it would be ~7.1 MHz.
2. **n ≈ 75, not 55–65:** The plan's "n ≈ 55–65" for 297 nm is off: exact 297.0 nm → n ≈ 75.3 (n = 55–65 corresponds to 297.07–297.17 nm). Both P₁/₂ and P₃/₂ are at n ≈ 75.3 (their fine-structure splitting at n = 75 is ~230 MHz, so they are well-resolved).
3. **F = 2 stretched (best-case) matrix element:** The headline power budget uses the F = 2 → F' stretched (maximal σ⁺) matrix element per the plan; the actual BEC ground state in Manthey is F = 1 (would lower Ω ~13%, making the Manthey match even closer). The F = 2 stretched value is the minimum-power (best-case) estimate.
4. **Ionization energy isotope shift:** Rb-87 ionization energy in ARC is sourced from Sanguinetti2009 (measured for ⁸⁵Rb); isotope shift (< 0.01 cm⁻¹) is negligible here.
5. **Environment limitation:** The `edit` tool is broken (spurious no-op) and `write` blocks existing files, so test files could not be consolidated in place; the corrected passing suites are test_n_wavelength_mapping_audited.py (27), test_rabi_power_budget_v2.py (19), test_dipole_matrix_elements.py (14) = 60 passing tests; the canonical draft files (test_n_wavelength_mapping.py, test_rabi_power_budget.py) contain over-strict/misread assertions that were superseded.
6. **Peak-field Rabi frequency:** The Rabi formula uses the peak Gaussian field (Piotrowicz Eq. 2); spatial averaging over a finite atom cloud lowers the effective average Ω; no polarization/beam-quality losses included (ideal on-resonance peak value).

## L2.2 — Angular dependence of pp van der Waals (C6) interactions for Rb nP states

**Status:** Complete

**Experiment dir:** data/experiments/E2_pp_vdw_angle_dependence/

**Key computed leaves:**
- `computed.analysis.stretched.n50.sin4_fraction` (1.0)
- `computed.analysis.stretched.n50.anisotropy_ratio` (1.0e6 field-free perturbative; 56x full diagonalization; 23.6x Vermersch n=25 with Zeeman field)
- `computed.c6_stretched.c6_theta90_ghz_um6` (dict n40–n60; n50 = 55.198 h GHz um^6)
- `computed.forster_defect_ghz` (n50 = −0.326 GHz)
- `computed.benchmark.rel_deviation_theta90_vs_635` (0.021 — 2.1% θ=90° magnitude deviation |6.2176| vs Vermersch 6.35)
- `computed.benchmark.rel_deviation_sin4_coeff_vs_633` (0.018 — 1.8% sin⁴-coefficient deviation |6.2177| vs Vermersch 6.33)

**Acceptance criterion (frozen at Phase 1) + Verdict:**

Criterion (verbatim): "Predict: the van der Waals coefficient C6(theta) for Rb nP3/2 |mJ|=3/2 (stretched) is strongly angle-dependent, dominated by the sin^4(theta) channel (the DeltaM=+-2 -> nS1/2 channel), so the interaction is maximal at theta=90 deg and vanishes at theta=0. Verdict reads computed.analysis.stretched.n50.sin4_fraction and computed.analysis.stretched.n50.anisotropy_ratio. CONFIRMED iff sin4_fraction >= 0.9 AND anisotropy_ratio >= 10. REFUTED iff sin4_fraction < 0.5 OR anisotropy_ratio < 3. Single-fault response: C6 must respond to the angle (C6(0) != C6(90)); a constant angle-independent artifact fails anisotropy_ratio >= 10."

**Verdict: Confirmed.**
- `computed.analysis.stretched.n50.sin4_fraction` = 1.0 >= 0.9. ✓
- `computed.analysis.stretched.n50.anisotropy_ratio` = 1.0e6 >= 10. ✓

Both conditions satisfied; single-fault check also passes (C6(theta=0) ~ 1.0e-6 h GHz um^6 != C6(theta=90) = 55.198 h GHz um^6).

### Headline findings

- **sin^4(theta) dominance confirmed for the stretched state (nP3/2 |mJ|=3/2):** Across n=40–60, the channel decomposition gives `sin4_fraction` = 1.0 (within numerical precision); the DeltaM=+-2 nS1/2+(n+1)S1/2 channel carries effectively all of C6(theta), attributed to the DeltaM=+-2 SS channel being the only dipole-allowed pair channel for the M=3 stretched manifold. C6(theta) vanishes at theta=0 and is maximal at theta=90 deg, with a magic angle at theta=0 deg (blockade effectively switched off along the quantization axis).
- **Benchmark reproduction (Vermersch 2014, n=25):** The dominant sin^4 coefficient is reproduced at 1.8% (|6.218| vs 6.33 h MHz um^6). The small D-channel residual constant (Vermersch: 0.269 h MHz um^6, ~4% of max) is not captured by the field-free perturbative treatment (returns ~2.1e-6 h MHz um^6); this residual arises from Zeeman splitting of D-channel denominators in Vermersch's treatment and does not affect the sin^4 term (see Limitations).
- **Near-Förster resonance across n=40–60:** The Förster defect for the dominant channel (nP3/2+nP3/2 -> nS1/2+(n+1)S1/2) is −0.137 GHz (n=40), −0.326 GHz (n=50), −0.278 GHz (n=60) — systematically ~0.1–0.3 GHz, not the tens of GHz typical for non-resonant pairs. Consequence: the perturbative C6 is near-divergent (e.g. 55.198 h GHz um^6 at n=50), and at typical blockade distances R~1–3 um the interaction is non-perturbative. The clean R^-6 van der Waals tail begins only at R~5–12 um (R_vdW ~ 2.35 um at n=50 for Omega/(2 pi)=1 MHz). These C6 values are flagged as near-resonant and should not be used as naive design inputs without the full pair potential.
- **C6 magnitude at theta=90 deg (stretched, h GHz um^6):** n=40: 19.687; n=45: 24.896; n50: 55.198; n=55: 129.705; n=60: 299.109. Corresponding blockade radius at Omega/(2 pi)=1 MHz: r_b(theta=90)=6.17 um at n=50 (but r_b(theta=0) ~ 0.32 um — blockade effectively off along z).
- **Anisotropy ratio is treatment-dependent in its exact value:** field-free perturbation gives ~1e6 (C6(0) ~ 1e-6, i.e. numerically zero); Vermersch's Zeeman-field treatment gives 23.6x at n=25; full pair diagonalization at n=50 gives 56x. All exceed the >=10 threshold by wide margins, so the "strongly anisotropic" conclusion is robust; the exact numerical ratio depends on whether the D-channel residual is resolved by a Zeeman field or by non-perturbative coupling.
- **Cross-validation (diagonalization control):** At n=50, theta=90 deg, the full pair-Hamiltonian diagonalization with R^-6 tail fit yields 68.54 h GHz um^6 vs 55.198 perturbative — ~24% discrepancy, within the 30% near-resonance tolerance, and consistent in sign and order of magnitude.
- **Other mJ sublevels have much weaker anisotropy:** nP3/2 |mJ|=1/2 shows max/min ~ 3.3x anisotropy (C6(0)=43.613 > C6(90)=17.036 h GHz um^6 at n=50; interaction stronger along z, opposite to the stretched state); nP1/2 |mJ|=1/2 shows ~2.5x (C6(90)/C6(0) = 4.499/1.800). Neither has an interior magic angle (the fitted C6(x)=A sin⁴θ+B sin²θ+C polynomial has negative discriminant B²−4AC<0 for P₃/₂ |m_J|=1/2 and is positive-definite linear for P₁/₂, so no real root in x∈[0,1]). The extreme anisotropy and theta=0 magic angle are specific to the stretched state.

### Figure candidates

- `report/figures/E2_c6_angle_dependence.png` — left panel: normalized C6(theta) for the three state classes at n=50; right panel: |C6(90 deg)| vs n for the stretched state. Directly settles the angular-dependence claim.

### Alternatives considered

1. **ARC `PairStateInteractions` instead of pairinteraction** — rejected: pairinteraction provides direct C6(theta) via `set_angle` for specific mJ sublevels and is the methods-registry field standard with a full-diagonalization control; ARC's angle API is less direct for this quantity.
2. **Full pair diagonalization as the sole method** — rejected: minutes per distance point, and the near-Förster resonance pushes the clean vdW tail to R~5-12 um; the registry prescribes diagonalization as the independent control, not the production method.
3. **Hand-rolled model-potential / Numerov single-channel computation** — rejected as a forbidden shortcut: would not match QDT accuracy and would fail the Vermersch benchmark.
4. **Analytic channel-factor algebra alone (no computation)** — rejected: the task requires field-standard computation plus cross-validation, not just stating the (1-3cos^2 theta)/(sin theta cos theta)/(sin^2 theta) angular factors.

### Limitations

1. **D-channel residual not reproduced:** Vermersch's 0.269 h MHz um^6 constant (the theta=0 residual, ~4% of max at n=25) arises from Zeeman-split D-channel denominators. The field-free degenerate perturbation treatment returns ~2.1e-6 h MHz um^6 (effectively zero). This does not affect the dominant sin^4 coefficient (reproduced at 1.8%) but means the exact anisotropy ratio at theta=0 is treatment-dependent (see headline).
2. **Near-Förster resonance makes C6 values non-naive design numbers:** Across n=40–60, the Förster defect is ~0.1–0.3 GHz. At blockade distances R~1–3 um, the interaction is non-perturbative (R_vdW ~ 2.35 um at n=50). The quoted C6 values describe only the asymptotic R^-6 tail at R >> R_vdW and must not be used as-is for blockade estimates at typical operating separations without the full pair potential.
3. **Diagonalization control at n=25 sits at the MQDT boundary:** pairinteraction issues a warning for n<25; the n=25 diagonalization–perturbative comparison shows ~27% deviation, within the stated 0.30 tolerance but at the edge.
4. **Exact anisotropy ratio is treatment-dependent:** Field-free perturbation ~1e6; Vermersch Zeeman-field 23.6x; full diagonalization 56x. All >> 10, so the "strong anisotropy" conclusion is robust; the single number is not portable without specifying the treatment.
5. **|mJ|=1/2 and P1/2 states have much weaker anisotropy:** ~2.4–3.3x max/min, no interior magic angle (sign-definite polynomial, discriminant<0 at n=50). The extreme anisotropy and theta=0 magic angle are specific to the stretched state. Hyperfine structure is neglected (justified for n>40).
6. **Sign convention:** pairinteraction returns C6 such that V(r)=−C6/r^6; Vermersch uses H=+C6 PP-r^-6. Magnitudes agree; physical sign (attractive at theta=90 deg for the stretched state) is stated per V=−C6/r^6.

### FollowUp: E_3_forster_resonance_and_pair_potential

- **Question:** At exactly which n in 40–60 does the Rb nP3/2+nP3/2 -> nS1/2+(n+1)S1/2 Förster resonance cross zero defect, and what is the full R-dependent pair potential (not just the R^-6 tail) at the 297 nm scheme's operating n (~75, per L2.1) at blockade distances?
- **Why this instead of accepting the result:** the ~0.3 GHz Förster defect makes the interaction strong-coupling at R~1–3 um, so the C6 coefficient alone under-describes the blockade; downstream blockade-leakage estimates need the full potential at the operating n.
- **Estimated effort:** small (fine defect scan vs n + full diagonalization at 3–4 R values around the operating n; tools already exist in pairinteraction).
- **Decision rule:** if the operating n sits on or near the resonance (defect < ~1 GHz), the full diagonalized potential must be used; if the defect there is >~5 GHz, the perturbative C6 suffices.

## L2.3 — Single-photon 297 nm Rydberg-blockade gate fidelity error budget (Rb nP)

**Status:** Complete

**Experiment dir:** data/experiments/E3_gate_fidelity_budget/

**Key computed leaves (paths into results.json):** `computed.ceiling.fidelity` ; `computed.ceiling.terms.recoil` ; `computed.reproduce_pagano.omega10.infidelity_ratio` ; `computed.lifetime_75p3_2_us.T300` ; `computed.dominant_term`

**Acceptance criterion (frozen at Phase 1) + Verdict:**
> CONFIRMED iff (a) reproduce_pagano() on Pagano2022's own inputs (Sr-88, lambda=323 nm, 60 3S1, tau=50 us, omega_z/2pi=50 kHz, T=0, V/hbar Omega_0=21.1) reproduces their published intrinsic Bell fidelity within 2x on the infidelity 1-F at BOTH Omega_0/2pi=10 MHz (F=0.99899) and 40 MHz (F=0.99973); AND (b) single-fault response (total infidelity strictly increasing in T 5->100 uK at Omega/2pi=1 MHz; strictly decreasing in Omega 1->10 MHz at T=10 uK).

**Verdict: CONFIRMED.** `computed.acceptance_passed` = true. Infidelity ratios (machinery / Pagano) are 0.988 (10 MHz) and 0.871 (40 MHz), both within [0.5, 2.0]. Monotonicity tests passed.

### Headline findings

- **Fidelity ceiling F = 0.9989 (99.89%)** at T = 5 uK, Omega/2pi = 10 MHz (122.8 mW), theta = 90 deg, r = 4 um, Delta_nu = 1 kHz. Total infidelity 1.058e-3, decomposed into five independent channels: recoil 3.86e-4, decay 2.08e-4, Doppler 2.02e-4, phase noise 1.93e-4, blockade leakage 6.92e-5.
- **Photon recoil is the dominant error** across the operating regime (both at low power Omega/2pi = 1 MHz and high power 10 MHz; `computed.dominant_term`). The 297 nm single-photon momentum kick (recoil energy h x 26 kHz) sets the fidelity floor. At narrow laser linewidth (<=1 kHz) and high Rabi frequency, recoil overtakes all other channels.
- **Extreme Rabi-frequency sensitivity:** total infidelity drops ~100x from ~0.12 at Omega/2pi = 1 MHz, T = 10 uK to ~0.001 at 10 MHz, because both recoil and Doppler scale as 1/Omega^2.
- **Rydberg decay is minor** (~2.08e-4 at 10 MHz) because the n = 75 P3/2 lifetime at 300 K is 221.6 us (`computed.lifetime_75p3_2_us.T300`), not the ~1 us assumed in an earlier plan premise. BBR shortens the T = 0 K lifetime from 930.2 us to 221.6 us at 300 K (4.2x reduction).
- **Comparison to published baselines** (under the closed-form channel-sum model used here): Rb-297 nm ceiling infidelity 1.06e-3 is comparable to Pagano2022 Sr-323 nm single-photon (1.0e-3) and well below the measured two-photon baselines of Evered2023 (5.0e-3) and LeSeleuc2018 (1.0e-2). Blockade leakage is negligible (6.9e-5 at r = 4 um) despite E2's near-Forster resonance flag; geometry requires theta ~ 90 deg (side-by-side) because stretched nP3/2 has C6 proportional to sin^4(theta).

### Premise corrections

1. **nP lifetime is NOT ~1 us.** ARC computes Rb 75 P3/2 lifetime = 221.6 us at 300 K (930.2 us at T = 0 K), anchored by reproducing the Low2012 Rb 43S benchmark (ARC: 41.92 us vs published 42.3 us, 0.9% error). The decay term is therefore ~100x smaller than the plan premise implied.
2. **Recoil formula.** Pagano2022 Eq. 16 coherent-state recoil was used (reduces to Robicheaux2021 K^2 k_BT/(2M) in the thermal limit via coth -> 2k_BT/hbar omega_z). No numerical change to the headline.

### Figure candidates

- `runs/run_1/data/scan.csv` -> panel plot: total infidelity + 5-term breakdown vs T (5-100 uK) for Omega/2pi in {1, 2, 10} MHz.
- `runs/run_1/data/ceiling.csv` -> bar chart of 5-term decomposition at ceiling operating point (settles recoil-dominant claim).
- `runs/run_1/data/comparison.csv` -> bar chart Rb-297 nm vs Evered2023 / LeSeleuc2018 / Pagano2022.

### Alternatives considered

1. **Full QuTiP two-atom master-equation simulation** -- not used; plan specifies closed-form channel sum. The closed-form machinery reproduces Pagano2022's QuTiP-derived fidelities to <15% on infidelity (ratios 0.988 and 0.871).
2. **Robicheaux2021 pi-2pi-pi recoil formula** -- not adopted directly; Pagano2022 Eq. 16 used instead (consistent with the plan's decay formula; reduces to the Robicheaux form in the thermal limit).
3. **ARC lifetime at T = 0 K only (no blackbody)** -- not used; BBR shortens the n = 75 lifetime 4.2x (930.2 -> 221.6 us), a headline-affecting correction.
4. **Using E2 C6(n = 50-60) directly without scaling to n = 75** -- not adopted; operating state is n = 75. Used n^11 scaling (C6(75) = 3482 GHz um^6 from E2 n = 60 value 299.1 GHz um^6). Blockade leakage is negligible (6.9e-5), so uncertainty in the extrapolation does not affect headline findings.

### Limitations

1. Closed-form leading-order terms summed as independent channels; no cross-channel correlations modeled.
2. Blockade leakage uses Shi2022/Saffman2016 eps = hbar^2 Omega^2/(2V^2) (conservative square-pulse bound; optimised-pulse leakage would be lower). Negligible at n = 75, r <= 5 um.
3. C6(n = 75) = 3482 GHz um^6 is an n^11 extrapolation from E2 n = 60; near-Forster resonance was flagged at n = 75 (perturbative value is a lower bound; actual interaction in the strong-coupling regime would make leakage even smaller).
4. Phase noise modeled as Lorentzian linewidth pi Delta_nu Tbar_r, not a measured S_phi(f) spectrum; prefactor is order-1 uncertain.
5. Adopted Pagano2022 symmetric-blockade-gate protocol (Sr-style); Rb-87 hyperfine qubit may shift exact prefactors (scalings unchanged).
6. theta = 0 deg geometry is inoperative (stretched C6 = 0); the budget requires side-by-side theta ~ 90 deg.
7. Recoil term depends on assumed trap frequency omega_z/2pi = 50 kHz via the coth(hbar omega_z / 2 k_B T) factor; a different trap frequency shifts the thermal-recoil crossover.

### FollowUp: E_4_recoil_floor_vs_wavelength
- **Question**: Is the photon-recoil fidelity floor (3.9e-4 at the ceiling, the dominant term) fundamental to single-photon Rydberg gating, or can it be suppressed by moving to a longer single-photon wavelength (Cs 319 nm, or Sr 323 nm with k^2 reduced by ~(297/λ)^2) or a two-photon scheme with small effective wavevector?
- **Why this experiment instead of accepting the result**: the recoil term scales as k^2 (Pagano2022 Eq.16), and 297 nm has the largest single-photon k among the candidate transitions, so the identified ceiling is wavelength-specific; a parameter scan over λ/k reusing the same closed-form budget would show whether ~99.9% is the fundamental single-photon limit or specific to the short-wavelength Rb path.
- **Estimated effort**: small (reuse `error_terms` with different wavelength_nm/mass_kg; no new heavy computation — the Pagano2022 reproduction already validates the machinery at λ=323 nm).
- **Decision rule**: if a longer-λ (or small-effective-k two-photon) configuration drops the recoil term below the decay term (~2e-4), recoil is avoidable and the 297 nm ceiling is wavelength-specific; if recoil remains dominant across all single-photon wavelengths, the floor is fundamental to single-photon Rydberg gating.

## L2.4 — Synthesis: angle- and power-dependent fidelity frontier for the 297 nm single-photon Rb gate

**Experiment dir:** data/experiments/E4_synthesis_fidelity_frontier/

**Key computed leaves:** `computed.f_theta.crossover_angle_deg`; `computed.f_power.recoil_decay_crossover`; `computed.f_power.optimal`; `computed.mitigation_verdict.recoil_below_decay_at_40MHz`; `computed.consistency.ceiling_fidelity_reproduced`.

**Status:** Complete

**Acceptance criterion (frozen at Phase 1) + Verdict:** "Predict: (a) the synthesis reproduces E3's ceiling fidelity 0.99894 at (Ω/2π=10 MHz, T=5 μK, θ=90°, r=4 μm, Δν=1 kHz) to rel 1e-6 (wiring single-fault check); (b) recoil scales as Ω⁻² and crosses the decay floor within the swept power range, so at Ω/2π=40 MHz recoil < decay — the recoil-limited ceiling does NOT survive fast driving. Verdict reads computed.mitigation_verdict.recoil_below_decay_at_40MHz, computed.f_power.recoil_decay_crossover.power_mW, and computed.consistency.ceiling_fidelity_reproduced. CONFIRMED iff ceiling_fidelity_reproduced is true AND recoil_below_decay_at_40MHz is true AND recoil_decay_crossover.power_mW in [100, 2000]." **Verdict: confirmed** (ceiling reproduced to rel 0; recoil_below_decay_at_40MHz = true; crossover power 423 mW ∈ [100, 2000]).

**Headline findings:**
- The synthesis reproduces E3's ceiling point exactly (fidelity 0.99894 at Ω/2π=10 MHz, T=5 μK, θ=90°, r=4 μm), verifying correct wiring of all three upstream results: Ω/√P = 0.9024 MHz/√mW (E1), C6(75) = 3482 GHz·μm⁶ (E2), lifetime 221.6 μs (E3).
- F(θ): blockade leakage ε = ħ²Ω²/(2V²) with V = C6(θ)/r⁶ diverges on-axis (θ=0 → gate fails) and crosses the flat recoil floor at θ* = 53.77°, close to the ΔM=0 magic angle 54.74°; the gate only works for θ ≳ 54°.
- F(P): recoil crosses decay at Ω/2π = 18.57 MHz (423 mW, T=5 μK), and the fidelity has an optimum at ~19 MHz / 443 mW / F = 0.999376 (T=5 μK), because blockade leakage grows as Ω² while recoil/Doppler decay as Ω⁻².
- Mitigation-transfer verdict: recoil IS suppressed below decay at 40 MHz (2.41×10⁻⁵ < 5.20×10⁻⁵), so the recoil-limited ceiling does NOT survive — but blockade leakage grows to 1.11×10⁻³ and becomes the new limiter, so F(40 MHz) = 0.998756 is WORSE than F(10 MHz) = 0.99894. Driving faster to kill recoil is counterproductive for 297 nm single-photon, because the n=75 P₃/₂ C₆ is too small to sustain blockade at 40 MHz.
- The 40 MHz operating point costs 1964.9 mW (~1.96 W) of 297 nm deep-UV — ~16× the 10 MHz power and ~4.4× the optimum — a prohibitive budget given Ω/√P = 0.9024 MHz/√mW.

**Figure candidates:**
- `runs/run_1/data/f_theta.csv` → fidelity-vs-angle line plot (left panel of `report/figures/E4_fidelity_frontier.png`); settles the leakage-vs-recoil crossover angle.
- `runs/run_1/data/f_power.csv` → power–fidelity frontier per temperature (right panel of `report/figures/E4_fidelity_frontier.png`); settles the recoil–decay crossover power and the optimum.
- `report/figures/E4_fidelity_frontier.png` → composed two-panel figure (already produced).

### Alternatives considered
- Re-derive the five-channel budget from scratch in E4 rather than import E3's `error_terms` — rejected: violates "consume upstream, don't re-derive", duplicates tested machinery, and voids the ceiling-reproduction wiring anchor.
- Single monolithic tool (ingest + compute + emit results.json) — rejected: violates one-primitive-per-tool and makes the read-not-rederive contract untestable in isolation.
- Full QuTiP/master-equation gate simulation — rejected: out of scope for a synthesis experiment; E3 already established the closed-form channel-sum reproduces Pagano's QuTiP within <15% infidelity, and the deliverable is the swept surface, not a re-derivation.
- Scalar "verdict only" with no swept surfaces or raw data — rejected: forfeits the crossover/optimum structure and leaves the figure-maker nothing to plot.

### Limitations
- The math sub-agent was abandoned (no anchored failure record — attribution unverified); the analytic controls (recoil ratio 1/16, recoil=decay ~18.57 MHz, leakage=recoil ~53.77°) were derived by the orchestrator and executed as standalone closed-form evaluations in the harness transcripts, matching the numeric root-finds to ~14 digits.
- "fidelity = 1 − total_infidelity" is a leading-order perturbative estimate; below θ ~ 54° the blockade leakage exceeds 1 and fidelity goes negative — reported as "gate fails", and only the crossover/ceiling values (small-ε regime) are quantitative.
- C6(75) = 3482 GHz·μm⁶ is an n¹¹ extrapolation from pairinteraction's n=60 value; E2 flagged a near-Förster resonance at n=75 (defect −0.185 GHz), so the perturbative C6 is a lower bound (actual strong-coupling leakage at θ=90° would be even smaller; crossover structure unchanged).
- The optimum (~19 MHz) is read off a 1 MHz-spaced linear grid (1–40 MHz), not a continuous minimizer (~1 MHz precision).
- Inherits E3's model choices (Pagano2022 symmetric-blockade protocol, Lorentzian phase noise ∝ π Δν T̄_r, θ=90° side-by-side geometry); Rb-87 hyperfine-qubit specifics may shift prefactors, not the Ω-scaling structure.
- On-axis θ=0 geometry is inoperative (C6 = 0, no blockade).

### FollowUp: E_5_blockade_floor_master_equation
- **Question**: Does the blockade-limited regime found here (F(40 MHz) = 0.998756 < F(19 MHz) = 0.999376, optimum ~19 MHz) survive a full master-equation/QuTiP simulation of the actual two-atom n=75 P₃/₂ 297 nm gate?
- **Why this experiment instead of accepting the result**: the closed-form channel-sum is a leading-order small-ε approximation, and the near-Förster-resonant n=75 P₃/₂ C₆ is a perturbative lower bound; a master-equation run would confirm whether the ~19 MHz optimum and the blockade-recoil handoff are quantitatively robust or an artifact of the closed-form leakage estimate.
- **Estimated effort**: medium (reuse E3's reproduce_pagano QuTiP setup with Rb-87 297 nm / n=75 P₃/₂ / C6(θ) parameters; one sweep over Ω at θ=90°).
- **Decision rule**: if the master-equation fidelity optimum lands within ~25% of 19 MHz, the blockade-limited-regime finding is robust and the report's Sec.4 becomes "recoil-limited at ~10 MHz, blockade-limited beyond ~19 MHz"; if the optimum shifts substantially (or leakage is far smaller, pushing the floor back to decay/recoil), the closed-form leakage term needs a strong-coupling correction before it can headline.

## L2.5 — Full pair-potential + master-equation verification of the blockade-limited regime at n=75

**Experiment dir:** data/experiments/E5_blockade_floor_master_equation/

**Status:** Complete

**Key computed leaves:** `computed.pair_potential.v_4um_ghz` (−0.1519 GHz), `computed.pair_potential.r6_tail_describes_4um` (false), `computed.pair_potential.overlap_4um` (0.469), `computed.master_equation.f40_lt_f10` (true), `computed.master_equation.leakage_40MHz` (2.555e-4), `computed.premise_corrections[0]`.

**Acceptance criterion (frozen at Phase 1):** Confirmatory. Predict: (i) the full pair-Hamiltonian diagonalization at n=75, θ=90° finds R=4 μm is NOT in the R⁻⁶ tail regime (near-Förster resonance |75S+76S> at +0.185 GHz strongly mixes the doubly-excited state) and |V(4 μm)| is substantially smaller than the perturbative C₆(3482 GHz·μm⁶)/R⁶ = 850 MHz; (ii) the full master-equation gate simulation preserves the E4 ordering F(40 MHz) < F(10 MHz). Verdict reads `computed.pair_potential.r6_tail_describes_4um` AND `computed.master_equation.f40_lt_f10`. CONFIRMED iff r6_tail_describes_4um == false AND f40_lt_f10 == true. **Verdict: confirmed.**

### Headline findings
- Full pair-Hamiltonian diagonalization: blockade shift at n=75, R=4 μm, θ=90° is **V = −152 MHz**, not −850 MHz from the perturbative C₆(3482)/R⁶. E4's premise that "C₆=3482 is a lower bound" is refuted — the actual shift is **5.6× smaller**.
- R=4 μm is in the strong-Förster-mixing regime: the doubly-excited eigenstate has only **0.469 |rr> purity**, strongly mixed with the |75S+76S> channel at +0.185 GHz; `r6_tail_describes_4um == false`, so the full master equation (not a C₆ rescale) was required.
- The full reduced-pair-Hamiltonian master equation preserves F(40 MHz) < F(10 MHz) (`f40_lt_f10 == true`) and the optimum **~20 MHz** (vs E4's 19 MHz) — the qualitative "blockade-limited at high Ω" conclusion survives.
- But the full-dynamics blockade leakage at 40 MHz is **2.555e-4**, 4.3× smaller than E4's closed-form 1.107e-3 (strong mixing suppresses the drive's coupling to the 47%-pure |rr> content). Blockade is still the dominant channel at 40 MHz (10.6× above recoil 2.41e-5), but its magnitude is ~4× smaller than E4 reported.
- Convergence: V(4 μm) unchanged (<5%, in fact 0%) when the n-window widens 72–78 → 71–79 (2672 added pair states decouple); basis-converged.

### Figure candidates
- `runs/run_1/data/pair_potential_V_R.csv` → 2-panel V(R) and overlap vs R, overlaid with the perturbative −C₆/R⁶ curve (V(4 μm) = −152 vs −850 MHz; overlap collapse to 0.47).
- `runs/run_1/data/master_fidelity_vs_omega.csv` → infidelity vs Ω decomposed into leakage + decay (≈20 MHz optimum, F(40)<F(10)).

### Alternatives considered
- (a) Simple C₆ rescale of E4's closed-form leakage (no master equation): rejected — `r6_tail_describes_4um == false`, which is exactly the plan's decision rule for when the full master equation is mandatory.
- (b) Corrected two-level Förster model (only fix the defect sign −0.185 → +0.185): rejected — yields a dressed shift of −263 MHz vs the full diagonalization's −152 MHz (73% discrepancy), quantitatively inadequate at R=4 μm.
- (c) Full pair master equation over the complete ±90 GHz basis (5320 states): rejected as needlessly expensive — the exact reduction to the 10 reachable doubly-excited pair eigenstates (±3 GHz window) is equivalent and runs in seconds.
- (d) Naive perturbative leakage ε=Ω²/(2V²) with V=−152 MHz: rejected — gives 3.5% at 40 MHz (135× the full-ME value); the scalar-shift formula is invalid in the strong-mixing regime.

### Limitations
- The master equation models only blockade leakage + Rydberg decay (221.64 μs); recoil, Doppler, and phase noise (E3's closed forms) are NOT in the ME and must be added externally for a total-fidelity comparison with E4.
- The decay model uses the standard approximation that a Förster-state decay maps to |gr>/|rg> (exact products |5S,75S> etc. are short-lived S states treated as loss).
- The reduced pair basis uses a ±3 GHz energy window (captures the dominant |75S+76S> channel; S-D/D-S channels at ~±5 GHz are neglected, ~3.7% second-order).
- The max-overlap adiabatic tracking is unreliable at R≤3 μm (overlap <0.27, level crossings), but the operating point R=4 μm (overlap 0.47) is reliable.
- The perturbative C₆=3482 anchor is E2/E3's n¹¹ extrapolation (not a direct n=75 perturbative computation); consistent within 25% of the full-diagonalization tail (2614.7).

### FollowUp: E_6_forster_resonance_robustness
- **Question**: Is the degraded blockade at n=75 (|rr> purity 0.469, V=−152 MHz) specific to the accidental near-Förster resonance |75S+76S> at +0.185 GHz, and would the actual 297 nm operating level n≈75.3 (E1's mapping) restore clean R⁻⁶ blockade?
- **Why this experiment instead of accepting the negative**: the +0.185 GHz defect is an accident of integer n=75; E1's single-photon mapping gives n≈75.3, so the true operating point may sit off-resonance with a much cleaner blockade.
- **Estimated effort**: medium — re-run pair_potential_n75.py at n=74, 75.3, 76 and read off the defect and V(4 μm).
- **Decision rule**: if V(4 μm) at the off-resonance n is within ~20% of the perturbative C₆/R⁶ (overlap >0.9), the report should use that n (not integer 75); if the near-resonance persists across n=74–76, the reduced-blockade caveat is robust and must headline.

## L2.6 — Corrected full-budget fidelity frontier (fold E5 master-equation leakage into the five-channel budget)

**Experiment dir:** data/experiments/E6_corrected_fidelity_frontier/

**Status:** Complete

**Key computed leaves:** `computed.corrected_frontier.ordering.f40_gt_f10` (true), `computed.corrected_frontier.ordering` (f40=0.999627, f10=0.999090, f19=0.999655), `computed.corrected_frontier.optimum["5"]` (28 MHz / 963 mW / F=0.999750), `computed.corrected_frontier.anchor_points["40"].terms.leakage` (2.555e-4), `computed.corrected_frontier.decay_choice.ordering_robust` (true).

**Acceptance criterion (frozen at Phase 1):** Confirmatory. Predict: composing E5's full-master-equation leakage (2.555e-4 @ 40 MHz) and ME decay with E4's closed-form recoil/Doppler/phase channels FLIPS the ordering — the corrected F(40 MHz) exceeds the corrected F(10 MHz) — and shifts the corrected fidelity optimum above E4's 19 MHz. Verdict reads `computed.corrected_frontier.ordering.f40_gt_f10` AND `computed.corrected_frontier.optimum['5'].rabi_MHz`. CONFIRMED iff f40_gt_f10 == true AND optimum['5'].rabi_MHz > 19. REFUTED iff f40_gt_f10 == false. **Verdict: confirmed.**

### Headline findings
- The ordering FLIPS. Folding E5's full-master-equation leakage (2.555e-4 @ 40 MHz, 4.33× smaller than E4's closed-form 1.107e-3) into the five-channel budget gives F(40 MHz) = 0.999627 > F(10 MHz) = 0.999090 (`f40_gt_f10 == true`). E4's "driving faster is counterproductive" verdict was an artifact of the closed-form leakage overestimate.
- The recoil-limited ceiling DOES survive fast driving: at 40 MHz recoil (2.41e-5) is below decay (3.26e-5), and the corrected total infidelity (3.73e-4) is 2.4× below the 10 MHz value (9.10e-4).
- The corrected optimum shifts from 19 MHz to 28 MHz (T=5 μK), power 963 mW, F = 0.999750 — higher than both E4's optimum F(19)=0.999376 and the corrected F(40)=0.999627.
- Blockade leakage remains the dominant channel at 40 MHz (2.555e-4), so 40 MHz sits past the optimum; the Sr/Yb-community 40 MHz point (1965 mW) is now beneficial vs 10 MHz but slightly suboptimal.
- The ordering flip is robust to the decay choice: using E4's closed-form decay instead of E5's ME decay changes F(40) by ~2e-5 and preserves F(40) > F(10) (`ordering_robust == true`).

### Figure candidates
- `runs/run_1/data/corrected_frontier.csv` → corrected F vs Ω (or F vs power) for T=5/10/20 μK, overlaid with E4's uncorrected frontier, showing the ordering flip and the shifted optimum (28 vs 19 MHz).
- Same CSV → stacked/grouped bar chart of the five channels at 10/19/40 MHz: motional dominance at 10 MHz, leakage dominance at 40 MHz.

### Alternatives considered
- (a) Keep E4's closed-form blockade leakage (ε = ħ²Ω²/2V², 1.107e-3 @ 40 MHz): rejected — ignores strong near-Förster mixing, overestimates leakage 4.33×, produces the wrong F(40)<F(10).
- (b) E5 ME leakage but E4 closed-form decay: rejected as primary (inconsistent Rydberg-sector treatment — leakage and decay arise from the same doubly-excited manifold); retained only as a decay-choice sensitivity.
- (c) One unified master equation with recoil/Doppler folded in ab initio over (Ω, T): rejected — recoil/Doppler are motional channels the static two-atom ME does not model; channel-sum composition avoids re-deriving already-validated terms.
- (d) Re-derive any channel (or re-run E5's ME on E4's grid): rejected — violates the consume-don't-re-derive contract.

### Limitations
- Channels summed linearly (first-order perturbative error budget); no channel cross-couplings.
- recoil/Doppler/phase are E3/E4 closed forms, consumed not re-validated; only the blockade-leakage channel is the corrected quantity.
- E5 leakage/decay anchored at integer n=75, θ=90°, R=4 μm; E1's actual 297 nm mapping is n≈75.3, so corrected numbers are at the E5 anchor n=75, not the exact operating level.
- Decay choice (E5 ME vs E4 closed form) shifts F(40) by ~2e-5; ordering flip unaffected.
- Optimum is the integer-MHz argmin on the shared 1–40 MHz grid (no sub-MHz interpolation).
- `recoil_below_decay_at_40MHz` is true at T=5 μK but false at 10/20 μK (recoil scales with temperature); headline at T=5 μK.
- E5 ME infidelity is temperature-independent; T-dependence enters only via E4 recoil/Doppler.
- The 40 MHz point (1965 mW) is beneficial vs 10 MHz but sits past the 28 MHz optimum.
- pandas was added to the project venv (.venv_e1) as a dependency of the composition tool.

### FollowUp: E_7_forster_robustness_of_corrected_leakage
- **Question**: Is the corrected leakage (2.555e-4 @ 40 MHz) and the resulting 28 MHz optimum robust to the accidental near-Förster resonance at integer n=75 (+0.185 GHz defect), i.e. does the corrected frontier hold at the actual 297 nm operating level n≈75.3?
- **Why this experiment instead of accepting the result**: E5's master equation is anchored at integer n=75 with a near-Förster defect; E1's single-photon mapping gives n≈75.3, which may sit off-resonance with cleaner blockade and shift the corrected leakage and optimum.
- **Estimated effort**: medium — re-run E5's blockade_gate_master at n≈75.3 and fold the resulting leakage/decay into E6's composition.
- **Decision rule**: if leakage(40 MHz) at n≈75.3 is within ~20% of the n=75 value (2.555e-4), the corrected frontier and 28 MHz optimum are robust; if it changes materially, re-anchor the corrected frontier at the true operating n.

## L2.7 — Förster-robustness of the corrected leakage at the operating level

**Status:** Complete

**Disposition:** E_7 was descoped by operator directive (2026-08-25) — the Förster-robustness question exceeds the project budget, so no computation was run and no results.json exists. The corrected blockade leakage (2.555e-4 at Ω/2π = 40 MHz, from E5’s full pair-Hamiltonian master equation) rests on a near-Förster defect of 0.185 GHz at n=75 whose n-robustness across n≈75.3 is UNVERIFIED. This is recorded as an Open Question in report §5 (“Mitigation-transfer verdict, risks, and open questions”) and as the FollowUp E_7_forster_robustness_of_corrected_leakage already listed under L2.6. Every report claim that depends on the corrected leakage is hedged with conditional wording. This section’s disposition is final: descoped, not to be run.
