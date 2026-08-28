# experiment_reviewer — E2_pp_packing_density round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): packing_gain_2d — 1.38 ± 0.07 via product of θ=0,θ=90 sixth-root spacing ratios, R_b∝(|C6|/Ω)^(1/6) — inputs: [c6_ss_60=-138.86163356371736, c6_pp_theta0_60_diag=-10.41, c6_pp_theta90_60=268.0806139003557]
ESTIMATE(blind): c6_ss_vs_pp_ratio — 0.518 ± 0.001 via abs(c6_ss/c6_pp) direct arithmetic on given inputs — inputs: [c6_ss_60=-138.86163356371736, c6_pp_theta90_60=268.0806139003557]
ESTIMATE(blind): gain_2d_n75 — 1.48 ± 0.18 via 2D blockade sixth-root, two-axis C6 ratio (ss/√(θ0·θ90))^(1/3) — inputs: [c6_ss_75=-1961.0673228944313, c6_pp_theta0_75_window20=-128.756613, c6_pp_theta90_75=2883.430272636706]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: packing_gain_2d — if right: ~1.38 (sixth-root compression of ~26× anisotropy); if wrong: ~26× (full anisotropy ratio) or ~1.0 (no gain); computation: compare (|C6_SS/C6_0|·|C6_SS/C6_90|)^(1/6) vs C6_SS/C6_0 directly, and verify via independent numerical lattice packing
SCALING: packing_gain_2d — expected 1/6 in anisotropy ratio; observed 1/6 from data/gain_vs_anisotropy.csv (gain tracks A^(1/6) curve)
DISCRIMINATOR: gain_2d_n75 — if right: ~1.48 (window-limited theta=0 residual); if wrong: >1.6 (if residual overestimated) or ~1.0; computation: repeat theta=0 C6 diagonalization at n=75 with wide energy window (±100 GHz) to settle the residual
SCALING: gain_2d_n75 — expected 1/6 in anisotropy product; observed not swept (single n-point, window-limited)
DISCRIMINATOR: c6_ss_vs_pp_ratio — if right: 0.518; if wrong: 0.464 (perturbative theta=90); computation: compare full-diagonalization vs perturbative C6(theta=90) at n=60, anchored to the near-Förster defect treatment
SCALING: c6_ss_vs_pp_ratio — expected ~constant in n (weak n-dependence from Förster defect); observed not swept (only n=60 settled)

REVIEW-COMPLETE
VERDICT: satisfied
