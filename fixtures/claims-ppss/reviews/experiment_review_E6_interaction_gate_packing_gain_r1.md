# experiment_reviewer — E6_interaction_gate_packing_gain round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): interaction_gate_packing_gain_2d — 2.4 ± 1.0 via cross-talk-radius ratio squared (C5~1 GHz·um5 est) — inputs: [c6_ss_ghz_um6=138.86, d_gate_interaction_um=2, theta_gate_deg=24.65, v_ct_ghz=0.00001, v_block_ghz=0.01]
ESTIMATE(blind): pp_interaction_gate_density_per_um2 — 0.0168 ± 0.004 via densest-Bravais-lattice search, full V=C6(3ch)/r6+C5/r5+C8/r8, |V|≤Vct cross-dimer — inputs: [c6_three_channel_a_ghz_um6=-2.6, c6_three_channel_b_ghz_um6=-22.72, c6_three_channel_c_ghz_um6=295.62, c5_ghz_um5=-0.126, c8_ghz_um8=1.747, d_gate_interaction_um=2, theta_gate_deg=24.65, v_ct_ghz=0.00001]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: interaction_gate_packing_gain_2d — if right: gain ≈ 2.0, dominated by θ≈90° cross-talk (R_ct ≈ 17.5 µm) in the perpendicular direction; if wrong: gain ≈ 1.35, C5/C8 floor insufficient to compress along-gate pitch below strong-blockade scaling; computation: measure the along-gate pitch L1 ≈ d_gate + R_ct(θ*) ≈ 2 + 6.5 = 8.5 µm vs SS staggered pitch ≈ gate_length + R_ct_SS ≈ 4.9 + 15.5 ≈ 20.4 µm, and confirm the perpendicular pitch L2 is set by R_ct(90°) ≈ 17.5 µm → area ratio gives gain
DISCRIMINATOR: pp_interaction_gate_density_per_um2 — if right: ~0.014 atoms/µm², binding constraint at (n1,n2)=(−5,1) near θ≈90°; if wrong: ~0.007 atoms/µm² (no improvement over SS); computation: brute-force all-neighbor |V| check at the optimal (L1,L2) lattice — already verified, worst |V|/V_ct = 1.0000
SCALING: interaction_gate_packing_gain_2d — expected ≈ −0.2 in gate_length_um (weak dependence, L1 ≈ R + R_ct with R_ct constant); observed −0.21 from data/gate_length_sweep.csv (log(1.952/2.113)/log(2.2/1.5))
SCALING: pp_interaction_gate_density_per_um2 — expected ≈ −0.2 in gate_length_um; observed −0.21 from data/gate_length_sweep.csv (log(0.01374/0.01487)/log(2.2/1.5))

REVIEW-COMPLETE
VERDICT: satisfied
