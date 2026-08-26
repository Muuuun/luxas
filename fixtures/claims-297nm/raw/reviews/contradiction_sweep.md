---
status: clean
sources_md5: c1f4bf12adcb8c55c9827ae9e8840300
quantities_checked: 44
contradictions_found: 0
---

## Summary
Swept `report/report.tex` (abstract, intro, §§architecture/why/budget/risks, Methods-and-scope, and all six figure captions), `notes/experiments.md`, and all six `data/experiments/*/runs/run_1/results.json` (`computed.*` and `invariants.*` leaves). Every named quantity that appears more than once was tabulated against the ledger and the results.json leaves. The two pairings previously flagged are **confirmed reconciled by the evidence store, not physics errors**:

1. **n=75 Förster-defect sign** — the E2-convention series list (`−0.185 GHz`) and the E5-convention Hamiltonian channel (`+0.185 GHz`) are opposite sign conventions of the same 0.185 GHz defect; E5's `invariants.forster_channel.note` records exactly this and designates `+0.185` as the master-equation input.
2. **Gate fidelity at Ω/2π = 10 MHz** — `99.89%` (closed-form five-channel budget, E3/E4) vs `99.909%` (corrected frontier, E6) are two different models of the same operating point, both labeled as such in the report and both supported by results.json leaves.

No third, genuinely-unreconciled contradiction remains; `contradictions_found = 0`. Both previously-flagged pairings are documented below so their dispositions stay on record.

## Reconciled known pairings (previously flagged)

### Förster defect at n=75 (sign convention)
- `−0.185 GHz` @ report §"Mitigation-transfer verdict, risks, and open questions", item (i) series list — "−0.137 GHz at n=40, −0.326 GHz at n=50, −0.278 GHz at n=60, −0.185 GHz at n=75" (conditions: E2 sign convention, defect = E(target) − E(Förster); convention is **not** printed at this site).
- `+0.185 GHz` @ report §"Fidelity is a U-shaped function of drive" — "the |75S₁/₂+76S₁/₂⟩ channel at +0.185 GHz explicitly diagonalized"; §risks open-question — "the specific near-Förster defect +0.185 GHz at integer n=75"; and abstract — "a near-Förster defect of 0.185 GHz at n=75" (conditions: E5 sign convention, channel energy above target; this is the sign that enters the master-equation Hamiltonian).
- Why reconciled: the magnitude 0.185 GHz is identical at every site; the sign flip is the documented E2-vs-E5 convention difference. `data/experiments/E5_blockade_floor_master_equation/runs/run_1/results.json` `invariants.forster_channel` = `{defect_ghz: 0.185, convention: "E(Foerster) - E(target) = +0.185 GHz ...", note: "E2's 'forster_defect_ghz.n75 = -0.185' used the opposite convention E(target)-E(Foerster). The +0.185 sign is the one that enters the master-equation Hamiltonian (the prior partial run used -0.185, a sign error)."}`; `data/experiments/E2_pp_vdw_angle_dependence/runs/run_1/results.json` `computed.forster_defect_ghz.values.n75 = -0.185` carries the opposite-convention value. Disposition: **reconciled via that cited source.** Residual (cosmetic, not an error): report.tex does not print the convention next to either sign; the ledger already records both, so no reconciliation edit is required for this sweep.

### Gate fidelity at Ω/2π = 10 MHz (T=5 μK, θ=90°, r=4 μm, Δν=1 kHz)
- `99.89%` @ abstract — "99.89% at 10 MHz from the closed-form channel-sum budget"; intro — "the low-drive floor is 99.89% (recoil-limited) at Ω/2π=10 MHz"; §budget — "closed-form total infidelity is 1.058×10⁻³, i.e. F=99.89%"; fig:budget caption — "F=99.89%"; §risks final paragraph — "the fidelity is 99.89% at the low-drive 10 MHz point" (conditions: **uncorrected/closed-form** five-channel budget).
- `99.909%` @ abstract — "F(10 MHz)=99.909%"; §budget — "The corrected frontier … gives F(10 MHz)=99.909%"; fig:frontier caption — "F(10 MHz)=99.909%"; §risks — "F=99.963% vs 99.909%" (conditions: **corrected** frontier with E5 master-equation leakage folded in).
- Why reconciled: two different models of the same operating point, not a disagreement. `data/experiments/E3_gate_fidelity_budget/runs/run_1/results.json` `computed.ceiling` = `{total_infidelity: 1.058009…e-3, fidelity: 0.9989419909…}` → 99.89% (E4 `computed.consistency.ceiling_fidelity_reproduced: true` re-wires the same value); `data/experiments/E6_corrected_fidelity_frontier/runs/run_1/results.json` `computed.corrected_frontier.ordering.f10 = 0.99908957968…` → 99.909%, which folds E5 `computed.master_equation.leakage_10MHz = 9.594e-7` into the five-channel sum. Disposition: **reconciled as closed-form-vs-corrected conditions, both cited.**

## Checked and consistent
- D2 reduced matrix element — 5.9783 a₀ computed vs 5.956 a₀ Safronova, 0.37% (report §architecture; E1 `computed.d2_reduced_a0`, `invariants.d2_reduced_reference_a0`)
- Ω/√P at 297 nm — 0.902 MHz/√mW (report abstract/§why/fig:power; E1 `computed.rabi_per_sqrt_power_at_297nm_MHz_per_sqrt_mW = 0.9023859638724778`; E3/E4/E6 invariant `0.9024`)
- Power budget — 1.228 mW → 1 MHz, 4.912 mW → 2 MHz (report §why/fig:power; E1 `computed.power_budget_at_297nm_mW`)
- Gate time — 0.5 μs / 0.25 μs (report §why; E1 `computed.gate_time_at_297nm_us`)
- n↔λ mapping — 75.34 (P₁/₂) / 75.33 (P₃/₂) (report §architecture; E1 `computed.n_at_target`; ledger L2.1)
- Fine-structure splitting at n=75 — ~230 MHz (report §architecture/fig:schematic; ledger L2.1)
- Manthey Rabi — measured 2π×90 kHz vs computed 101.25 kHz, 12.5% (report abstract/§architecture/§methods; E1 `computed.rabi_38P_khz = 101.25321…`, `computed.rabi_38P_ratio_vs_90khz = 1.12504…`)
- Radial scaling exponent — −1.51 (report §architecture; E1 `computed.radial_scaling_exponent_P32 = −1.509626…`)
- sin⁴θ fraction (stretched, n=40–60) — 1.0 (report §architecture; E2 `computed.analysis.stretched.all_n.sin4_fraction = 1.0`)
- C₆(θ=90°, n=50) — 55.198 h GHz μm⁶ (report §architecture/fig:c6angle; E2 `computed.c6_stretched.c6_theta90_ghz_um6.n50 = 55.198`)
- C₆(0, n=50) — ≈10⁻⁶ (report §architecture; E2 `computed.c6_stretched.c6_theta0_ghz_um6.n50 = 1e-06`)
- Anisotropy ratio — ~10⁶ field-free / 23.6× Vermersch n=25 / 56× diagonalization n=50 (report §architecture; E2 `computed.analysis.stretched.n50.anisotropy_ratio = 1000000.0`, `anisotropy_ratio_vermersch_n25 = 23.6`, `anisotropy_ratio_diagonalization = 56.0`)
- Vermersch sin⁴ coefficient — 6.33 h MHz μm⁶, reproduced 1.8% (report §architecture; E2 `computed.benchmark.rel_deviation_sin4_coeff_vs_633 = 0.018`, `vermersch_sin4_coeff_h_mhz_um6 = 6.33`)
- |m_J|=1/2 sublevel C₆ — C₆(0)=43.613 vs C₆(90°)=17.036, ~3.3× (report §architecture; E2 `computed.analysis.p3half_m1half.n50` with `full_anisotropy_max_over_min = 3.3`)
- P₁/₂ |m_J|=1/2 C₆ — 4.499/1.800, ~2.5× (report §architecture; E2 `computed.analysis.p1half_m1half.n50.c6_theta90_ghz_um6 = 4.499`, `c6_theta0_ghz_um6 = 1.8`, `anisotropy_ratio_c6_90_over_c6_0 = 2.5`)
- Blockade radius at Ω/2π=1 MHz — 6.17 μm (θ=90°) / ~0.32 μm (θ=0) (report §architecture; E2 `computed.analysis.stretched.n50.blockade_radius_um_rabi1MHz`)
- Leakage-vs-recoil crossover angle — θ* = 53.77° (report §architecture/fig:ftheta; E4 `computed.f_theta.crossover_angle_deg = 53.76905479294061`)
- ΔM=0 magic angle — 54.74° (report §architecture; E4 `computed.f_theta.note`)
- 75P₃/₂ lifetime — 221.6 μs @300 K / 930.2 μs @0 K, 4.2× BBR (report §why/§risks; E3 `computed.lifetime_75p3_2_us.T300 = 221.6357…`, `T0 = 930.2`; E5 invariant `rydberg_lifetime_us = 221.64`)
- Low 43S benchmark — 41.92 μs computed vs 42.3 μs published, 0.9% (report §why; E3 `computed.arc_lifetime_43s_300K_us = 41.92`, `invariants.low2012_rb43s_lifetime_300K_us = 42.3`)
- Pagano Sr-88 infidelity ratios — 0.988 (10 MHz) / 0.871 (40 MHz) (report §budget/§methods; E3 `computed.reproduce_pagano.*.infidelity_ratio`)
- Closed-form total infidelity @10 MHz — 1.058×10⁻³ → F=99.89% (report §budget/fig:budget; E3 `computed.ceiling.total_infidelity = 0.0010580091…`)
- Five closed-form error terms @10 MHz — recoil 3.86e-4, decay 2.08e-4, Doppler 2.02e-4, phase 1.93e-4, leakage 6.92e-5 (report §budget/fig:budget; E3 `computed.ceiling.terms`)
- Recoil/Doppler @40 MHz — 2.41e-5 / 1.26e-5 (report §budget/§risks; E4 `computed.mitigation_verdict` and `f_power.term_breakdown_T5uK_40MHz`)
- Closed-form blockade leakage @40 MHz — 1.107×10⁻³ (report §budget/§risks; E4 `f_power.term_breakdown_T5uK_40MHz.blockade = 1.107e-03`; E5 `invariants.e4_upstream.blockade_leakage_40MHz = 0.001107`)
- C₆(n=75) — 3482 GHz μm⁶, n¹¹ extrapolation (report §budget/§methods; E3/E4 `c6_75_ghz_um6 = 3482.087…`, E5 `c6_perturbative_ghz_um6 = 3482.09`)
- Blockade shift at R=4 μm — −152 MHz (full) vs −850 MHz (perturbative) (report §budget; E5 `computed.pair_potential.v_4um_mhz = −151.863`, `cross_validation[1].value_b = −0.8501196… GHz`)
- |rr⟩ purity at R=4 μm — 47% (report §budget; E5 `computed.pair_potential.overlap_4um = 0.469309`)
- Corrected leakage @40 MHz — 2.555×10⁻⁴, 4.3× below closed form (report abstract/§budget/§risks; E5 `computed.master_equation.leakage_40MHz = 0.0002555`; E6 `anchor_points["40"].terms.leakage = 0.00025550243…`)
- Master-equation decay @40 MHz — 3.26×10⁻⁵ (report §budget/§risks; E5 `computed.master_equation.decay_40MHz = 3.26e-05`; E6 `E5_master_equation_channels.decay_40MHz_ME`)
- Corrected F(19 MHz) — 99.966% (report §budget; E6 `computed.corrected_frontier.ordering.f19 = 0.99965529…`)
- Corrected F(40 MHz) — 99.963% (report abstract/§budget/fig:frontier/§risks; E6 `f40 = 0.99962690…`)
- Corrected optimum — 28 MHz / 963 mW / F=99.975% (report abstract/intro/§budget/fig:frontier/§risks; E6 `computed.corrected_frontier.optimum["5"] = {rabi_MHz: 28, power_mW: 962.7896…, fidelity: 0.99975039…}`)
- Corrected optimum infidelity — 2.50×10⁻⁴ (report §budget; E6 `optimum["5"].total_infidelity = 0.00024960897…`)
- Published baselines — Evered 5.0e-3, de Léseleuc 1.0e-2, Pagano 1.0e-3 (report §budget; E3 `computed.comparison`)
- 297 nm hardware — 700 mW, <700 kHz linewidth (report intro/§why/§risks; literature claim, internally consistent)
- Power at 40 MHz — 1965 mW (report §risks; E4 `computed.mitigation_verdict.power_mW_at_40MHz = 1964.8768…`)
- Power at 10 MHz — 122.8 mW (report §architecture/fig:ftheta/§budget; E3 `computed.ceiling.params.power_mW = 122.8`)
- Blockade+decay-only ME optimum — ~20 MHz, F≈0.9999 (report §budget; E5 `computed.master_equation.optimum_rabi_mhz = 20.0`, `optimum_fidelity = 0.99992`)
- Decay-model sensitivity of F(40) — ~2×10⁻⁵ (report §budget; E6 `computed.corrected_frontier.decay_choice` — f40 primary 0.99962690 vs alternative 0.99960753, Δ≈1.94e-5)
- Rb Rydberg quantum defects across E1/E2 — E1 ARC δ(P₁/₂)=2.6548849, δ(P₃/₂)=2.6416737 vs E2 pairinteraction δ(P₁/₂)=2.65486, δ(P₃/₂)=2.64150 (E1 `invariants.qdefect_reconciliation_note` and E2 `invariants[2].reconciliation_note` both record the ≤1.7×10⁻⁴ difference as a benign ≈2.6 MHz level shift — reconciled on both sides)
- Cross-experiment invariant constants — Ω/√P (0.9023859638774778 vs 0.9024), C₆(n=60) (299.109), C₆(75) (3482.087 vs 3482.09), lifetime (221.6357 vs 221.64 μs), m(Rb-87)=1.44316e-25 kg, protocol τ=7.69 / T̄_r=3.86, trap 50 kHz, λ=297.0 nm (E1–E6 `invariants.*`, all consistent within explicit rounding)

## Negative / non-existence / non-reproduction claims
No upper-bound or non-existence claim in report.tex or the ledger rests on a failed candidate search. The only non-existence-adjacent claims — "no interior magic angle" for the |m_J|=1/2 and P₁/₂ sublevels (report §architecture; ledger L2.2) — are supported by a theorem-grade discriminant/sign-definiteness computation in E2 (`computed.analysis.p3half_m1half.n50.magic_angle_sign_definiteness.discriminant_B2_minus_4AC = −2942.29…` and `p1half_m1half.n50.magic_angle_sign_definiteness` positive-definite-linear conclusion), not by a failed search. The descoped E7 robustness check is recorded in the ledger as "no computation was run … UNVERIFIED", i.e. honestly framed as not-run rather than as a refutation.
