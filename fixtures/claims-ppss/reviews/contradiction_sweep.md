---
status: contradictions
sources_md5: 238f7a2a593e29b3ee9cf2846643614a
quantities_checked: 46
contradictions_found: 2
definition_concerns: 2
upper_bound_concerns: 1
---

## Summary

Re-diffed the three update points plus the full quantity set across `report/report.tex` (abstract, body, figure captions, methods), `notes/experiments.md` (the ledger), and all six `data/experiments/*/runs/run_1/results.json` files (`computed.*` and `invariants.*` leaves). Update (1) is reconciled: the Fig. 1 caption now assigns the S--S blockade radius `R~4.9 µm` and the P--P θ=90° radius `R~5.5 µm`, matching E2's `blockade_radii_n60` (4.903 / 5.471 µm). Update (2) is reconciled: E1's `c6_pp_sin4_fraction` (0.9999999) is now SUPERSEDED and points at E4's three-channel fraction 0.921; the report's "≈0.93" matches the ledger's own "~0.93" rendering. Update (3) is NOT fully reconciled: E4's `c6_total_zero_angle_deg` headline is 24.65° (24.3° superseded) in E4's results.json and the ledger, but `report.tex` still labels the headline "24.3±0.35°" in two places (Sec. "zero" and Methods), and E5's results.json + the ledger L2.5 section still carry the stale θ*≈24.3° input constant while E5's own C5/C8 are quoted at 24.65°. Two contradictions remain, both on the C6-zero angle θ*; two same-id definition concerns (two-channel vs three-channel) remain between E3 and E4; one upper-bound concern remains (the "strong-blockade maximum/ceiling 1.35×" is a grid best-found, not a certified bound).

## Contradictions

### C6-zero angle θ* — "headline" designation (report vs E4 results/ledger)
- "headline 24.3±0.35°" @ `report/report.tex`, Sec. "The 54.7° magic angle is a channel zero…" (conditions: headline C6-zero angle; same sentence notes "the three-channel root 24.65° is used throughout the packing analysis")
- "headline 24.3±0.35°" @ `report/report.tex`, Methods and Scope Statement ("…the C6 zero θ*=24.65° (three-channel/second-order sum 24.65° vs. full diagonalization 24.0°; headline 24.3±0.35°)")
- "24.65" @ `data/experiments/E4_verify_c6_zero_physical_gain/runs/run_1/results.json` `computed.c6_total_zero_angle_deg` — with `superseded.old_value_deg: 24.3`, `superseded_by_deg: 24.65`, and uncertainty_source "The previous headline 24.3+-0.35 deg … is superseded by 24.65 deg"
- "24.65 deg (three-channel root; supersedes 24.3±0.35 inter-method avg; full-diag 24.0)" @ `notes/experiments.md`, L2.4 key-computed-leaves table

Why incompatible: the report still calls 24.3±0.35° the "headline" in two places, while E4's results.json and the ledger declare the headline to be 24.65° and mark 24.3±0.35° as superseded. (The abstract's "θ*≈24.65° … bounded to ±0.35°" is fine; the body/methods "headline 24.3±0.35°" is the stale residue that update (3) should have removed.)
Resolution required: change both report sites to state the headline as 24.65° (three-channel root; full-diagonalization 24.0°), and demote 24.3±0.35° to "superseded inter-method average" if retained at all.

### C6-zero angle θ* — E5 input constant (24.3° vs 24.65°)
- "θ*=24.3°" @ `data/experiments/E5_weak_blockade_gate_viability/runs/run_1/results.json` `invariants.target_pair.value` ("…interatomic axis at theta*=24.3 deg where C6 ~ 0") and `acceptance_criterion` ("at theta*~=24.3 deg")
- "θ*≈24.3 deg" @ `notes/experiments.md` L2.5 acceptance criterion and L2.5 FollowUp ("Near θ* ≈ 24.3 deg the C6 vanishes")
- "24.65" @ E4 `computed.c6_total_zero_angle_deg` (canonical zero) and @ `data/experiments/E6_interaction_gate_packing_gain/runs/run_1/results.json` `invariants.theta_gate_deg.value` ("C6(theta*)=0 at theta*=24.65 deg")
- "theta=24.65 deg" @ E5's own `invariants.c5_at_zero_ghz_um5.anchored_to` and `invariants.c8_at_zero_ghz_um8.anchored_to` (E5's C5/C8 — the actual gate inputs — are quoted from `quadrupole_floor.json` key 24.65)

Why incompatible: the same physical C6-zero angle θ* is stated as 24.3° (E5 target/acceptance + ledger L2.5) and as 24.65° (E4 canonical, E6 input, and E5's own C5/C8 evaluation point). The 0.35° gap is physically consequential, not cosmetic: E6's `premise_corrections` records that at 24.3° the residual C6 = −0.51 GHz·µm⁶ contributes +8 MHz at R=2.0 µm, flipping the gate interaction from V=−2.887 MHz to +5.0 MHz — so E5's declared target and its actual C5/C8 inputs disagree in the sign of the residual interaction.
Resolution required: update E5's `target_pair`/`acceptance_criterion` and the ledger L2.5 section to θ*=24.65° (matching E5's own C5/C8 inputs), or explicitly annotate that E5's fidelity was evaluated at 24.65° while 24.3° was the then-current, now-superseded headline.

## Upper-bound / negative-claim check

### "Strong-blockade-constrained maximum is 1.35" / "≈1.35× strong-blockade ceiling/cap"
- "maximum is 1.35" @ `report/report.tex` Sec. "The packing gain is the sixth root…" ("The strong-blockade-constrained maximum is 1.35, under the requirement |C6(θ_gate)|≥|C6_SS|=138.86")
- "≈1.35× strong-blockade ceiling" @ abstract and conclusion; "1.35× strong-blockade cap" @ Sec. "interaction gate recovers ≈2×"
- Support @ `data/experiments/E4_verify_c6_zero_physical_gain/runs/run_1/results.json` `computed.strong_blockade_max_gain_2d = 1.35` — uncertainty_source: "best found theta=90/psi=15 gives 1.350; **optimizer heuristic, not a certified global max**"; limitation 5: "grid+heuristic optimum, not a certified global maximum … the true global max could differ by the quoted ±0.05"

Why flagged: "maximum/cap/ceiling" asserts a proven bound, but the only support is a best-found value over a discrete orientation grid — a search, not exhaustive enumeration or a theorem-grade proof. The report's own Limitations ("The packing optimizer is a grid-plus-bisection search, not a certified global optimum") partially discloses this, but the headline still converts a best-found result into a bound. (Secondary: "the gain is capped at ≈1.34–1.47×" — rectangular 1.471 is an analytic diagonal-neighbor bound, but the staggered 1.341 is numerical.)
Resolution required: restate as "best-found 1.35× (grid+heuristic, ±0.05, not a certified global maximum)" in the body, and soften "ceiling/cap/maximum" in the abstract and conclusion, or add the theorem-grade bound derivation.

## Definition concerns

Same id, different measurement (revise-level advice, not a string-equality veto — quoted so the reviewer can reconcile):

### `c6_total_zero_angle_deg` — two-channel model zero (E3) vs physical three-channel zero (E4)
- E3 `computed.quantities[]`: "angle in [0,90] deg where the total **two-channel** C6(theta)=0 (repulsive dM=0 cancels attractive dM=+-2)" → value 22.909°
- E4 `computed.quantities[]`: "Interatomic angle (deg) at which the **isolated-stretched-state van der Waals C6** of the Rb 60P3/2 pair crosses zero (repulsive at smaller angle, attractive at larger angle)…" → value 24.65°

The id name is identical but the observable changed from a two-channel model root (b=0) to the physical three-channel crossing; the value moved 22.909° → 24.65°. E4 documents the supersession, but a downstream reader matching on the id could silently conflate the two numbers.

### `c6_at_dm0_magic_angle_ghz_um6` — two-channel (E3) vs three-channel/full (E4)
- E3 `computed.quantities[]`: "total **two-channel** C6 at the dM=0 magic angle 54.7356 deg, GHz*um^6 (the load-bearing discriminator…)" → value 120.30
- E4 `computed.quantities[]`: "C6 (GHz um^6) at theta = 54.7 deg (the dM=0-channel magic angle where (1-3cos^2 theta)=0), for the Rb 60P3/2 stretched pair." → value 126.3

Same id, different channel set (two-channel vs full three-channel); E4's uncertainty_source states the ~6 GHz·µm⁶ difference is the neglected ΔM=±1 channel, but the id reuse leaves the two measurements under one name.

## Checked and consistent

- SS C6(60): −138.86 GHz·µm⁶ — report = E1 `c6_ss_60_ghz_um6` (−138.8616); consistent in E2/E4/E6 invariants ✔
- SS 43S anchor: −2.4413 vs Low2012 −2.441 (0.014%) — report = E1 `c6_ss_43s_ghz_um6` ✔
- SS 70S anchor: −868.6 within {891,862,862,853} — report = E1 `c6_ss_70s_ghz_um6` ✔
- SS isotropy ratio 1.012–1.019 (n=40–80) — report = E1 `c6_ss_anisotropy_ratio_by_n` ✔
- PP C6(90°): perturbative +299.11 / diag +268.08 / ARC +292.4 — report = E1 leaves ✔
- PP C6(0°) residual: −10.41±0.3 (diag −10.408, 2nd-order −10.412, ARC 10.4±3) — report = E1 leaves; consistent across E2/E3/E4 invariants ✔
- PP anisotropy ratio: 25.76 (diag) / 28.74 (mixed) — report = E1 `c6_pp_anisotropy_60_diagonalization` / `_mixed` ✔
- Energy-window sweep −16.16(±20) / −12.04(±25) / −9.63(±30) / −10.41(±100) — report = E1 `energy_window_truncation_finding` ✔
- Sixth-root factors f_dec=1.540, f_gate=0.896 — report = E2 `factor_decoupled_n60` / `factor_gate_n60` ✔
- 2D gain 1.380 analytic / 1.315 staggered; 3D 1.237 — report = E2 `packing_gain_2d` / `gain_2d_n60_packing` / `gain_3d_n60` ✔
- n=75 gain 1.476 (indicative, ±20 GHz window) — report = E2 `gain_2d_n75` ✔
- Trap-limited cap 1.471 rect / 1.341 staggered; d_gate=5.47 µm — report = E2 leaves ✔
- Magic distance absent at θ=0 — report = E2 `magic_distance_conclusion.magic_distance_exists=false` (structural, theorem-grade) ✔
- Three-channel coefficients a=−2.60, b=−22.72, c=+295.62 — report = E4/E6 leaves; C6(54.7°)=+126.3 (2nd-order 126.10 vs diag 126.43) — report = E4 ✔
- Two-channel legacy C6(54.7°)=+120.3 and two-channel zero 22.9° — report = E3 leaves ✔
- C5=−0.126 GHz·µm⁵, C8=+1.747 GHz·µm⁸ — report = E4/E5/E6 leaves ✔
- V(R=2.0 µm)=−2.887 MHz; dead zone R=2.4024 µm; sub-MHz |V|≤0.27 MHz for R≥2.4 µm — report = E5 leaves ✔
- Gate fidelity 0.9967 @ R=2.0 µm / Ω=160 MHz / t_gate=0.1855 µs; grid max 0.9994 @ R=1.0 µm — report = E5 leaves ✔
- Fundamental bound |V|≥0.318 MHz, R≤2.2874 µm; sub-MHz cap fidelity 0.981 — report = E5 leaves ✔
- Interaction-gate gain 1.98±0.1 (PP 0.013911 vs SS 0.007038 atoms/µm²) — report = E6 leaves ✔
- Robust range 1.95 (R=2.2) to 2.11 (R=1.5) — report = E6 `gate_length_sweep` ✔
- Cross-talk radii 6.54 (θ*) / 15.26 (54.7°) / 17.54 (90°); pitch 8.54 µm; L2=40.36 µm; unit cell 143.77 µm² — report = E6 leaves ✔
- Orientation sweep 1.97–1.99 (non-degenerate), 30° outlier 2.52 excluded — report = E6 `orientation_sweep` ✔
- Cross-validation: SS density reproduced (2.6×10⁻⁵ rel. err), strong-blockade PP 1.3385 vs 1.331 — report = E6 `cross_validation` ✔
- Strong-blockade gain 1.35 — report = E4 `strong_blockade_max_gain_2d` (value; see upper-bound concern for the "maximum" framing) ✔
- Fig. 1 radii: S--S R~4.9 µm, P--P θ=90° R~5.5 µm — report = E2 `blockade_radii_n60` (4.903 / 5.471) ✔
- E1 sin⁴ fraction 0.9999999 SUPERSEDED → 0.921 (report "≈0.93" = ledger E4 "~0.93"; exact 0.921) — reconciled ✔
- n≈75 / 297 nm follow-up gap and QDT ~2.5% floor — consistent across report and ledger ✔
