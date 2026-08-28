# experiment_reviewer — E1_ss_pp_c6_anisotropy round 3

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): c6_ss_60 — 140 ± 12 via Singer n^11 fit (Low2012, repulsive) — inputs: [n=60, l=0, j=0.5, m=0.5]
ESTIMATE(blind): c6_pp_theta90_60 — +292 ± 30 via ARC perturbative vdW C6 stretched pair θ=90° — inputs: [n=60, l=1, j=1.5, m=1.5]
ESTIMATE(blind): c6_pp_theta0_60_diag — 10.4 ± 3 via ARC full-diagonalization level-diagram C6 fit — inputs: [n=60, l=1, j=1.5, m=1.5]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: c6_ss_60 — if right: −139 ± 3 GHz µm⁶ (repulsive, QDT-bounded by the two anchors); if wrong: would deviate >5% from Singer n¹¹ formula interpolation at n=60; computation: evaluate Singer's `C6 = n^11 (11.97 − 0.8486n + 3.385e-3 n²)` in a.u. at n=60 and convert to GHz µm⁶; the pairinteraction value should agree to <3%.
SCALING: c6_ss_60 — expected 11 in n* (Singer/Low2012 n*^11 with polynomial prefactor); observed 11.35 from log-log fit of c6_ss_by_n (n=40–80) vs n*=n−3.13
DISCRIMINATOR: c6_pp_theta90_60 — if right: +299 ± 30 GHz µm⁶ (attractive, sin⁴θ-dominant channel); if wrong: value would be <200 or >400, indicating a Förster-resonance mislabeling or a dM-channel selection error; computation: run ARC `getC6perturbatively` for Rb 60P₃/₂ |m|=3/2 stretched pair at θ=90° and compare.
SCALING: c6_pp_theta90_60 — expected 11 in n* (Wadenpfuhl2025 n*^11 on-axis); observed 9.48 from log-log fit of c6_pp_theta90_by_n (n=50–80) vs n*=n−2.64 — sub-n*^11 scaling likely reflects near-Förster structure at low n distorting the fit; not necessarily wrong but the departure from 11 is not discussed in the findings.
DISCRIMINATOR: c6_pp_theta0_60_diag — if right: −16.2 ± 2 GHz µm⁶ (repulsive dM=0 S+D channel); if wrong: magnitude closer to 5–10 GHz µm⁶ (the second-order sum gives 4.96, ARC blind gives 10.4); computation: run the diagonalization basis convergence sweep at k={2,3,5,7,10} (the script `c6_diag_theta0_scan.py` already supports this but the results are NOT recorded anywhere in the run data) and report how C6(θ=0) converges with basis size.
SCALING: c6_pp_theta0_60_diag — expected ~11 in n* (same underlying n*^11 from dipole matrix elements); observed 10.19 from log-log fit of c6_pp_theta0_diag_by_n (n=50–80) vs n*
DISCRIMINATOR: c6_pp_anisotropy_60_diag — if right: ~18.5 (diag-based θ=0 residual dominates); if wrong: ~29 (ARC blind) or ~60 (second-order sum); computation: resolve the θ=0 residual with a converged basis (k≥7 sweep) — the anisotropy is entirely determined by the ratio of the converged θ=90° to the converged θ=0° values.
SCALING: c6_pp_anisotropy_60_diag — expected ~−0.7 in n* (ratio of two ~n*^{10} quantities); observed −0.74 from log-log fit of anisotropy vs n* (n=50–80) — approximately n-independent as expected.

REVIEW-COMPLETE
VERDICT: revise
