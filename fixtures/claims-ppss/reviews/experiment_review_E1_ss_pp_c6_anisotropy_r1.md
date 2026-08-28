# experiment_reviewer — E1_ss_pp_c6_anisotropy round 1

Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):
ESTIMATE(blind): c6_ss_60 — 140 ± 12 via Singer n^11 fit (Low2012, repulsive) — inputs: [n=60, l=0, j=0.5, m=0.5]
ESTIMATE(blind): c6_pp_theta90_60 — +292 ± 30 via ARC perturbative vdW C6 stretched pair θ=90° — inputs: [n=60, l=1, j=1.5, m=1.5]
ESTIMATE(blind): c6_pp_theta0_60_diag — 10.4 ± 3 via ARC full-diagonalization level-diagram C6 fit — inputs: [n=60, l=1, j=1.5, m=1.5]

Reviewer obligation lines (design §3.5):
DISCRIMINATOR: c6_ss_60 — if right: −139 ± 4 GHz µm⁶; if wrong: outside [−120, −160]; computation: compare Singer n^11 formula with QDT correction at n=60 (gives −140.3) and ARC perturbative C6 for 60S1/2
SCALING: c6_ss_60 — expected 11 in n; observed 12.03 from log-log fit over n=40–80 (consistent with Singer polynomial prefactor increasing effective local exponent above bare n^11)
DISCRIMINATOR: c6_pp_theta90_60 — if right: +290 ± 30 GHz µm⁶; if wrong: outside [+200, +400]; computation: ARC PairStateInteractions.getC6perturbatively at θ=90° for 60P3/2 stretched pair (replication script gives ~293)
SCALING: c6_pp_theta90_60 — expected ~11 in n; observed 8.66 from log-log fit n=40–80 (local exponent climbs from ~10 at n=55–60 to ~10.5 at n=75–80; the low-n anomaly at n=40–43 pulls the global fit down; Förster-defect structure modulates the scaling away from bare n^11)
DISCRIMINATOR: c6_pp_theta0_60_diag — if right: |C6| ∈ [5, 25] GHz µm⁶; if wrong: < 1 or > 50; computation: run pairinteraction full-diagonalization at n=60, θ=0° with progressively wider n_range (±3, ±5, ±7, ±10) and check convergence of the R^-6 fitted C6; also run ARC full-diag at matching parameters
SCALING: c6_pp_theta0_60_diag — expected ~11 in n; observed 10.98 from log-log fit n=45–80 (self-consistent but from un-provenanced diag_theta0_by_n.json)
DISCRIMINATOR: c6_pp_anisotropy_60_diag — if right: 12–30; if wrong: < 5 or > 100; computation: ratio |C6(90°)/C6(0°)| with basis-converged θ=0 value (current 18.5; if θ=0 converges to blind estimate ~10.4 → ratio ~29; if to manual sum ~5 → ratio ~60)
SCALING: c6_pp_anisotropy_60_diag — observed not swept (single n=60 point; the ratio depends on the relative n-scaling of θ=90° and θ=0° channels)

REVIEW-COMPLETE
VERDICT: revise
