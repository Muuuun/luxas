# experiment_reviewer — E1_ss_pp_c6_anisotropy round 2

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): c6_ss_60 — 140 ± 12 via Singer n^11 fit (Low2012, repulsive) — inputs: [n=60, l=0, j=0.5, m=0.5]
ESTIMATE(blind): c6_pp_theta90_60 — +292 ± 30 via ARC perturbative vdW C6 stretched pair θ=90° — inputs: [n=60, l=1, j=1.5, m=1.5]
ESTIMATE(blind): c6_pp_theta0_60_diag — 10.4 ± 3 via ARC full-diagonalization level-diagram C6 fit — inputs: [n=60, l=1, j=1.5, m=1.5]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: c6_ss_60 — if right: magnitude ~139 GHz µm⁶ (repulsive, isotropic to <2%); if wrong: magnitude deviates >5% from the Singer n¹¹ interpolation between the two anchors (43S and 70S); computation: evaluate the Singer formula C6 = n¹¹(11.97 − 0.8486n + 3.385×10⁻³n²) at n=60 in a.u. and convert to GHz µm⁶
SCALING: c6_ss_60 — expected 11 in n (Singer n¹¹ with polynomial prefactor); observed 12.03 from log-log fit over n=40–80 in c6_ss_pp_scan.csv (the effective exponent is >11 because the polynomial prefactor grows with n, consistent with the Singer formula)
DISCRIMINATOR: c6_pp_theta90_60 — if right: ~299 GHz µm⁶ (attractive, sin⁴θ-dominated); if wrong: <200 or >400 GHz µm⁶; computation: run ARC `getC6perturbatively` for Rb 60P₃/₂ |m|=3/2 stretched pair at θ=90° and compare
SCALING: c6_pp_theta90_60 — expected ~11 in n (from dipole matrix element ∝ n² giving C6 ∝ n¹¹ modulo defect structure); observed 9.55 from log-log fit over n=45–80 in c6_ss_pp_scan.csv (lower effective exponent likely due to the varying Förster defect denominator; non-monotonic defect structure at n=40–43 breaks simple power-law)
DISCRIMINATOR: c6_pp_theta0_60_diag — if right: magnitude ~16 GHz µm⁶ (repulsive, dM=0 S+D channel); if wrong: magnitude <7 or >25 GHz µm⁶; computation: run the same pairinteraction full-diagonalization at n=60, θ=0° with a wide basis (k=10, n_range=(50,70)) and verify convergence against the k=2 value
SCALING: c6_pp_theta0_60_diag — expected ~11 in n (same second-order perturbation scaling as the other channels); observed 10.98 from log-log fit over n=45–80 in c6_diag_theta0_by_n.json
DISCRIMINATOR: c6_pp_anisotropy_60_diag — if right: ~18.5 (≫1, ≪10⁶); if wrong: <10 or >30 (or the ~10⁶ from perturbative); computation: divide the all-diagonalization values: 268.08/16.16 = 16.59 (pure-diag ratio) vs the mixed 299.1/16.16 = 18.51 reported; the spread 16.6–18.5 is methodological
SCALING: c6_pp_anisotropy_60_diag — expected roughly constant in n (both numerator and denominator scale ~n¹¹); observed non-constant: 56 at n=45, 18.5 at n=60, 24.5 at n=70, from c6_diag_theta0_by_n.json + c6_ss_pp_scan.csv (the residual grows faster than the dominant channel at low n, non-monotonic variation ~18–56 across n=45–80)
INDEPENDENT: c6_pp_theta0_60_diag perturbative(pi.C6) vs diag(pi.SystemPair R⁻⁶ fit) — routes differ: perturbative evaluates the second-order series analytically in the degenerate manifold; diag solves the full pair Hamiltonian numerically and extracts C6 from the R⁻⁶ tail. The ×10⁶ discrepancy shows the perturbative class misses the dM=0 S+D channel entirely for this stretched state.
ANCHOR-OK: c6_ss_43s — Singer formula gives the same anchor within 0.014% because pairinteraction's MQDT radial integrals reproduce the same QDT database that Singer2005/Low2012 used.

REVIEW-COMPLETE
VERDICT: revise
