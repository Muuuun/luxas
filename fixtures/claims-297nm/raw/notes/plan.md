# Language

- **Chosen**: en
- **Signals**: research_md=en, dirname=en, corpus=en
- **Rationale**: The user request is written in English and the entire literature corpus is English-language; the report targets a general technical audience.

### E_1: Single-photon 297 nm transition strength and laser power requirement (Rb 5S₁/₂ → nP)

**Question**: What is the single-photon transition strength (radial dipole matrix element, oscillator strength) of the Rb 5S₁/₂ → nP₁/₂,₃/₂ Rydberg transitions addressed by 297 nm light, and how much 297 nm UV laser power (at a specified beam waist) is required to drive the transition at Rabi frequencies suitable for μs-timescale Rydberg quantum gates?

**Approach**:
- Map the 297 nm photon energy onto the Rb Rydberg nP manifold (Rb ionization energy ≈ 4.177 eV; 297 nm ≈ 4.176 eV sits just below the series limit, addressing n ≈ 55–65 P states; compute the exact n↔λ correspondence with Rb quantum defects δ(P₁/₂)=δ(P₃/₂)≈2.64).
- Compute radial dipole matrix elements ⟨5S₁/₂|r|nP₃/₂⟩ and ⟨5S₁/₂|r|nP₁/₂⟩ across n = 30–100 using a field-standard alkali-atom computation (ARC model potential / Numerov radial integration).
- Fold in angular + hyperfine factors for the ⁸⁷Rb F=2 → F′ stretched-state transition to obtain the effective dipole moment and Rabi frequency per √power, Ω/√P (MHz/√mW), at a reference waist.
- Convert to a power budget: mW of 297 nm needed for target Rabi frequencies (e.g. 2π×1 MHz and 2π×2 MHz) at a 10 μm (1/e² radius) waist, and state the corresponding π-pulse / gate times.
- Cross-validate against literature anchors: Manthey2014 (Rb 5S₁/₂ → 38P₃/₂, Ω = 2π×90 kHz at 700 mW, ~100 μm waist) and Piotrowicz2011 methodology (Ω ∝ √P scaling); also against the Cs 318.6 nm single-photon system (Wang2017/Bai2016, 2 W at ~800 μm waist → Ω_c ≈ 0.1–0.3 MHz).

**Architectural commitments**: none (first experiment; establishes the transition-strength baseline that E_3's fidelity budget consumes).

### E_2: Angular dependence of pp van der Waals (C₆) interactions for Rb nP states

**Question**: Is the pp van der Waals interaction between two Rb nP Rydberg states angle-dependent, and if so, what is the quantitative C₆(θ) angular dependence and its consequence for Rydberg blockade strength and gate geometry?

**Approach**:
- Compute C₆(θ) for Rb nP₁/₂×nP₁/₂ and nP₃/₂×nP₃/₂ pairs (specific m_J sublevels, including the stretched |m_J|=3/2 state) as a function of the angle θ between the interatomic axis and the quantization axis, at n values relevant to the 297 nm scheme (n ≈ 40–60).
- Use a field-standard pair-interaction computation (e.g. pairinteraction or ARC PairStateInteractions) with degenerate or full perturbation-theory treatment of the angular momentum channels; reproduce the known Vermersch2014 result C₆(θ) = 6.33 sin⁴θ − 0.267 sin²θ + 0.269 (in h·MHz·μm⁶) for Rb 25P₃/₂ m_J=3/2 as a benchmark, then extend to n = 40–60.
- Quantify: the anisotropy ratio C₆(π/2)/C₆(0) (or the appropriate max/min), the magic angle(s) where C₆ → 0 or changes sign, and how the angular structure arises from the dipole-dipole angular channels (ΔM=0 → 1−3cos²θ, ΔM=±1 → sinθcosθ, ΔM=±2 → sin²θ), following the Wadenpfuhl2024 channel decomposition.
- Translate C₆(θ) into the blockade radius r_b(θ) = (|C₆(θ)|/(ħΩ))^(1/6) and state which interatomic geometries (θ = 0°, 54.7°, 90°) give strong vs. weak vs. vanishing blockade.

**Architectural commitments**: none (independent of E_1; its C₆(θ) output feeds E_3's blockade-leakage term).

### E_3: Error budget and achievable fidelity for the 297 nm single-photon Rydberg gate

**Question**: What is the achievable gate fidelity for a Rb Rydberg-blockade entangling gate driven by single-photon 297 nm excitation, and how does it decompose into Doppler dephasing, photon recoil, Rydberg spontaneous emission (incl. blackbody), blockade leakage, and laser phase noise — as a function of laser power, atom temperature, and interatomic geometry?

**Approach**:
- Build an explicit error budget for a π-pulse / blockade-gate protocol using the single-photon 297 nm transition, with terms: (i) Doppler dephasing σ = k·√(k_B T/m) with k = 2π/297 nm (large single-photon wavevector); (ii) photon recoil infidelity ∝ K² (Robicheaux2021 sudden-approximation scaling); (iii) Rydberg spontaneous emission 1−F_d = (3/4)T̄_r γ with nP lifetime incl. 300 K blackbody (Saffman2016 Fig. 4: np ~ 1 μs at 300 K at low n, scaling as n*³); (iv) blockade leakage ε ≈ ħ²Ω²/(2V²) using the angle-dependent V from E_2's C₆(θ); (v) laser phase noise (LeSeleuc2018).
- Compute total error vs. (power/Rabi from E_1, temperature 5–100 μK, geometry θ and separation r), and identify the dominant term and the fidelity ceiling.
- Compare the 297 nm single-photon result against the two-photon 780+480 nm baseline (Evered2023 99.5%, LeSeleuc2018) and the Sr 323 nm single-photon budget (Pagano2022 99.9% at 10 MHz), isolating what is specific to the short-wavelength single-photon Rb path.

**Architectural commitments**: E_1 (transition strength → Rabi-per-power and gate time); E_2 (C₆(θ) → blockade strength V and leakage). Both upstream results must be read from their results.json files, not re-derived.

### E_4: Synthesis — angle- and power-dependent fidelity frontier for the 297 nm single-photon Rb gate

**Question**: Combining the transition strength (E_1), the angle-dependent pp van der Waals interaction (E_2), and the five-channel error budget (E_3), what is the full fidelity surface of the Rb 297 nm single-photon blockade gate? Specifically produce three deliverable objects: (i) F(θ) — the fidelity vs interatomic angle at fixed power, obtained by coupling E_2's C₆(θ) into the blockade-leakage term of E_3's error budget; (ii) F(P) — the power–fidelity frontier, obtained by sweeping the Rabi frequency Ω and mapping it to 297 nm laser power via E_1's Ω/√P, using E_3's own reproduce_pagano Ω-scaling (Ω/2π = 40 MHz gave 99.976%, showing recoil is suppressed by driving faster); and (iii) the mitigation-transfer verdict — does the recoil-limited-ceiling conclusion survive when Rb is driven at the Rabi frequencies the Sr/Yb single-photon community uses, and what 297 nm laser power does that cost?

**Approach**:
- Consume the upstream results as inputs (do NOT re-derive dipole moments, lifetimes, or C₆ values): E_1's `rabi_per_sqrt_power_at_297nm_MHz_per_sqrt_mW` (0.902 MHz/√mW), E_2's C₆(θ) ∝ sin⁴θ for the stretched nP₃/₂ |m_J|=3/2 state (with the n=75 extrapolation C₆(75) = 3482 GHz·μm⁶ at θ=90° that E_3 adopted), and E_3's five-channel error budget (recoil, Rydberg decay, Doppler, laser phase noise, blockade leakage) plus the reproduce_pagano machinery and the n=75 lifetime 221.6 μs.
- F(θ): at fixed power (fixed Ω via Ω/√P), sweep the interatomic angle θ ∈ [0°, 90°] and propagate C₆(θ) ∝ sin⁴θ into the blockade-leakage term ε = ħ²Ω²/(2V²) with V(θ,r) = −C₆(θ)/r⁶, keeping all other channels fixed; report fidelity vs θ, the leakage-vs-recoil crossover angle, and the θ where the gate fails (on-axis).
- F(P): sweep Ω/2π from ~1 MHz to ~40 MHz, convert to power P = (Ω/Ω_per_√P)² using Ω/√P = 0.902 MHz/√mW, and evaluate the full five-channel budget at each Ω (at the Sr/Yb-community-relevant temperatures T = 5–20 μK and fixed geometry θ = 90°, r = 4 μm); produce the F(P) power–fidelity frontier and identify the power at which recoil crosses the decay floor.
- Mitigation-transfer: reproduce E_3's reproduce_pagano Ω-scaling (Ω/2π = 10 MHz → 99.900%, 40 MHz → 99.976% on the Pagano inputs) to establish the recoil term's Ω⁻² scaling, then answer whether driving Rb at Ω/2π = 40 MHz suppresses recoil below the decay floor, and what 297 nm power that costs (P = (40/0.902)² mW).

**Architectural commitments**: E_1 (transition strength → Ω/√P = 0.902 MHz/√mW and the Ω↔power mapping); E_2 (C₆(θ) ∝ sin⁴θ for the stretched state and the n=75 extrapolation); E_3 (five-channel error budget, reproduce_pagano machinery, n=75 lifetime 221.6 μs). All three upstream results must be read from their results.json files, not re-derived.

### E_5: Full pair-potential and master-equation verification of the blockade-limited regime at n=75

**Question**: Does the E_4 finding that the 297 nm Rb n=75 P₃/₂ gate becomes blockade-limited at high Rabi frequency (F(40 MHz) = 0.998756 < F(19 MHz) = 0.999376, optimum ~19 MHz) survive a full two-atom computation that uses the actual near-Förster-resonant pair potential rather than the perturbative C₆ lower bound? Specifically: what is the actual blockade interaction V at n=75, R≈4 μm, θ=90°, and does a master-equation (or equivalent full-dynamics) gate simulation confirm or shift the fidelity optimum and the F(40 MHz) vs F(10 MHz) ordering?

**Approach**:
- Compute the full R-dependent pair potential for the stretched nP₃/₂ |m_J|=3/2 × same pair at n=75, θ=90° by full pair-Hamiltonian diagonalization (the method E_2 used as its independent control), over the operating-distance range R≈2–8 μm, and extract the actual blockade shift V(R) — accounting for the near-Förster-resonant channel (defect −0.185 GHz at n=75) that makes the perturbative C₆(75)=3482 GHz·μm⁶ a lower bound and pushes the van der Waals radius to large R (R_vdW ≈ 6.7 μm at Ω=40 MHz).
- Run the two-atom gate dynamics (master equation via QuTiP or an equivalent field-standard method) for the 297 nm Rb n=75 P₃/₂ blockade gate, sweeping Ω/2π from 1 to 40 MHz at θ=90° and R=4 μm, using the full pair potential for the blockade term and keeping recoil, Rydberg decay (221.6 μs), Doppler, and phase noise from E_3's machinery.
- Compare the full-dynamics fidelity optimum and the F(40 MHz) vs F(10 MHz) ordering against E_4's closed-form results (optimum 19 MHz / 443 mW, F(40 MHz)=0.998756 < F(10 MHz)=0.998942).

**Architectural commitments**: E_4 (closed-form synthesis results to be verified or corrected); E_2 (pairinteraction full-diagonalization method and the near-Förster-resonance flag); E_3 (five-channel error machinery, reproduce_pagano, n=75 lifetime 221.6 μs). The n=75 stretched-state full pair potential must be COMPUTED here (E_2 computed only the perturbative C₆ and explicitly flagged it as a near-resonant lower bound that should not be used as a naive design input).

- Set a convergence criterion for the pair-Hamiltonian diagonalization: the extracted blockade shift V(R) must change <5% when the basis n-range increases by 1 (near a Förster resonance the pair basis must be large enough to converge).
- Be pragmatic about the master equation: if the diagonalization shows the effective C₆ at n=75 is within ~20–30% of the perturbative 3482 GHz·μm⁶ (i.e. the R⁻⁶ tail still describes R=4 μm), a simple rescaling of E_4's closed-form leakage term suffices and the full master equation is unnecessary; reserve the full two-atom master equation for the case where the pair potential is qualitatively non-R⁻⁶ at R=4 μm (i.e. R < R_vdW, which the perturbative C₆ places at ≈6.7 μm for Ω=40 MHz).

### E_6: Corrected full-budget fidelity frontier — fold the master-equation leakage into the five-channel budget

**Question**: What is the corrected full five-channel fidelity frontier F(P) for the 297 nm Rb n=75 P₃/₂ single-photon gate, when E_4's closed-form blockade-leakage term (ε = ħ²Ω²/(2V²) with V = C₆/r⁶ = 850 MHz) is replaced by E_5's full-master-equation leakage (2.555×10⁻⁴ at Ω/2π = 40 MHz, from the strong-mixing near-Förster pair potential)? Does the corrected frontier still give F(40 MHz) < F(10 MHz), and what are the corrected fidelity optimum and the final mitigation-transfer verdict?

**Approach**:
- Consume E_4's `f_power.csv` (recoil, Doppler, decay, phase vs Ω) and E_5's `master_fidelity_vs_omega.csv` (blockade leakage and decay vs Ω) as inputs; do NOT re-derive any of these terms.
- Build the corrected total infidelity total(Ω) = recoil(Ω) + Doppler(Ω) + phase(Ω) + decay(Ω) + leakage_corrected(Ω), taking recoil/Doppler/phase from E_4/E_3 closed forms and blockade leakage (and, for self-consistency, the Rydberg-decay term) from E_5's master equation; document the single consistent decay choice (E_4 closed form vs E_5 ME) and its effect on the ordering.
- Report the corrected F(P) frontier, the corrected fidelity-optimal Ω and power (via E_1's Ω/√P = 0.902 MHz/√mW), the corrected F(40 MHz) vs F(10 MHz) vs F(19 MHz) ordering, and the final mitigation-transfer verdict (does the recoil-limited ceiling survive at the Sr/Yb-community Ω, and what power does 40 MHz cost).

**Architectural commitments**: E_4 (five-channel closed-form budget: recoil, Doppler, decay, phase, plus the now-superseded closed-form blockade leakage); E_5 (full pair-Hamiltonian blockade leakage vs Ω and the ME decay vs Ω, at n=75, θ=90°, R=4 μm); E_1 (Ω/√P = 0.9024 MHz/√mW for the Ω→power mapping). All upstream numbers must be read from their results.json/CSV, not re-derived.

### E_7: Förster-robustness of the corrected leakage at the operating level  **[DESCOPED 2026-08-25 — out of budget; recorded as Open Question in report §Risks and as FollowUp in ledger L2.6; corrected leakage 2.555e-4 @ 40 MHz rests on a near-Förster defect +0.185 GHz at n=75 whose n-robustness is UNVERIFIED]**

**Question**: Is the corrected blockade leakage (2.555e-4 at Ω/2π=40 MHz, from E_5's full pair-Hamiltonian master equation at integer n=75) — and the resulting E_6 headline (corrected F(40 MHz)=0.9996 > F(10 MHz)=0.9991, optimum 28 MHz) — robust to the n-dependence of the near-Förster resonance |nS₁/₂+(n+1)S₁/₂⟩ that brackets the 297 nm operating level (E_1 maps 297.0 nm to effective n≈75.3, so the integer states n=75 and n=76 are the nearest neighbors)? Does the leakage at n=74/75/76 stay within ~20% of the n=75 value (2.555e-4), or does it change materially and require re-anchoring the corrected frontier?

**Approach**:
- Re-run E_5's full pair-Hamiltonian diagonalization + reduced-pair master equation (`blockade_gate_master.py` + `pair_potential_n75.py`, both parameterized by n) at the integer neighbors n=74 and n=76 (bracketing the effective operating level n≈75.3), at θ=90°, R=4 μm, sweeping Ω/2π = 1–40 MHz, to obtain leakage(40 MHz) and decay(40 MHz) vs n.
- Compute the Förster defect |nS₁/₂+(n+1)S₁/₂⟩ at n=74, 75, 76 to characterize how the near-resonance moves with n.
- Fold the n=74/76 leakage/decay into E_6's corrected five-channel budget (`compose_corrected_frontier.py`) to obtain the corrected F(P) frontier and optimum at each n.
- Report whether leakage(40 MHz) at n=74/76 stays within ~20% of the n=75 value (2.555e-4), and whether the F(40 MHz)>F(10 MHz) ordering and the ~28 MHz optimum are robust to n.

**Architectural commitments**: E_5 (`blockade_gate_master.py` + `pair_potential_n75.py` machinery, parameterized by n); E_6 (`compose_corrected_frontier.py` composition); E_4/E_3 (recoil/Doppler/phase closed forms, consumed not re-derived); E_1 (Ω/√P = 0.9024 MHz/√mW; the n≈75.3 mapping that justifies bracketing n=74/76). All upstream numbers read from results.json/CSV, not re-derived.
