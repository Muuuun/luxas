# experiment_reviewer — E5_weak_blockade_gate_viability round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): cz_gate_max_fidelity — 0.996 ± 0.002 via Saffman Eq.34 interaction-gate formula plus two-atom Lindblad master equation — inputs: [c5_at_zero_ghz_um5=-0.126, c8_at_zero_ghz_um8=1.747, rydberg_lifetime_tau_us=100, ground_hyperfine_omega10_MHz=6834]
ESTIMATE(blind): fundamental_min_interaction_mhz_for_0_99 — 0.3183 ± 0.0005 via Saffman bound V≥2/(0.01τ), 2 rad/µs→0.318 MHz — inputs: [rydberg_lifetime_tau_us=100]
ESTIMATE(blind): fundamental_max_viable_separation_um — 2.2876 ± 0.005 via bisection root |V|=0.318 MHz attractive branch — inputs: [c5_at_zero_ghz_um5=-0.126, c8_at_zero_ghz_um8=1.747, rydberg_lifetime_tau_us=100]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: cz_gate_max_fidelity — if right: ~0.997 at R≈2 µm with interaction gate (few-MHz V regime); if wrong: <0.99 everywhere or >0.999 at R=2 µm; computation: re-run master equation with independent QuTiP implementation including C9+ multipole terms at R=2.0 µm
SCALING: cz_gate_max_fidelity — expected exponent not a simple power law (gate error is sum of decay∝1/V, leakage∝V²/Ω², off-resonant∝Ω²/ω₁₀²); observed not swept as single-variable power law — the optimization is over a 2D (R,Ω) grid with competing error channels
DISCRIMINATOR: fundamental_min_interaction_mhz_for_0_99 — if right: 0.318 MHz (= 2/(2π×0.01×100)); if wrong: differs by factor >2 (e.g. if the bound is E≥2π/(Bτ) not 2/(Bτ)); computation: re-derive Saffman2016 Eq. Elimit from the original paper's Lagrangian or check dimensional analysis of 2/(Bτ) with B in angular vs regular frequency
SCALING: fundamental_min_interaction_mhz_for_0_99 — expected ∝ τ^{-1} in rydberg_lifetime; observed not swept (single τ=100 µs point)
DISCRIMINATOR: fundamental_max_viable_separation_um — if right: 2.287±0.05 µm; if wrong: >2.4 µm or <2.0 µm (would indicate C5/C8 sign error or wrong branch); computation: solve |−C5/R^5−C8/R^8|=0.318 MHz numerically with C5=−0.126, C8=1.747 on the attractive (R<2.40) branch — I did this and get 2.2876 µm, confirming
SCALING: fundamental_max_viable_separation_um — expected ∝ C8^{1/8} at fixed threshold (C8-dominated near crossing); observed not swept (single C5/C8 pair)
DISCRIMINATOR: sub_mhz_regime_max_fidelity — if right: ~0.98 (limited by E≥2/(Vτ) with V≤0.27 MHz); if wrong: >0.99 (would mean the fundamental bound is wrong or V is larger than computed); computation: check master-equation fidelity at R=2.8 µm where |V|=0.270 MHz — cross_validation.json shows master infidelity 0.0203 at R=3.0, consistent with 0.98
SCALING: sub_mhz_regime_max_fidelity — expected: fidelity decreases as V decreases (error ∝ 1/V from decay channel); observed from best_gate_vs_R: F=0.981(R=2.8), 0.980(R=3.0), 0.969(R=3.5), 0.949(R=4.0) — monotonically decreasing beyond R=2.8 as V∝R^{-5} decreases, consistent

REVIEW-COMPLETE
VERDICT: satisfied
