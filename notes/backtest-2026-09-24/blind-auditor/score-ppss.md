# Score: blind audit (A) vs backtest (G): pp-vs-ss-gate-packing-20260826

G = `notes/backtest-2026-09-24/bt-ppss.md`; A = `scratchpad/audit-ppss.md`. I checked the findings read-only on the droplet. I used scratch space only in `/tmp/score-ppss/`, and deleted it afterwards.

## Recall (G research defects)

| G id | defect | reached report? | A match |
|---|---|---|---|
| D1 | `pi.C6` drops ΔM=0/±1 channels (sin⁴ fraction 0.9999999, ~10⁶ anisotropy) | No (only as corrected history) | **MISSED**. A lists the corrected 26× as a claim (H5) and does not examine it. |
| D2 | θ=0 residual truncated by the ±20 GHz window; n=75 gain of 1.476 still biased | Yes (disclosed as "indicative") | **MISSED**. A puts the n=75 extrapolation under "Not checked". |
| D3 | E3 two-channel model: zero 22.9°, 1.956 divergent, self-same-formula "verification" | No (corrected history) | **MISSED** |
| D4 | Stale or superseded E4 values in the report: min\|C6\|=0.007, 24.0° vs E7's 24.43°, "headline 24.3±0.35°" label | **Yes** | **FOUND**. F4 covers the 0.007 artifact and 24.43° vs 24.0°; F7 bullet 3 covers the 24.3 vs 24.65 label and the omitted 24.43. |
| D5 | Unmatched SS baseline gate length (4.90 vs 2.0 µm); the matched gain is 1.66×, not 1.98× | **Yes (title/abstract)** | **FOUND**, F2. Same mechanism and same number (1.66). F7 bullet 4 covers the Fig. 1 caption. |
| D6 | V(2 µm) = C5/R⁵+C8/R⁸ unverified: (a) 23 MHz/deg angle sensitivity; (b) no pair diagonalization below 6 µm | **Yes (abstract 0.9967)** | **FOUND**. F5 = (a), with the same 23 MHz/deg. F1 = (b), and A goes further by running the diagonalization at 2 µm (see Disagreements). |
| D7 | "60P₃/₂ decays faster than 60S, so F is an upper bound": the direction is wrong | Yes (§6) | **MISSED**. Worse, F7 bullet 2 repeats the report's wrong direction as a finding. |
| D8 | "≈1.35× strong-blockade ceiling" is only the best over restricted lattice families | **Yes (abstract)** | **PARTIAL**, F2. A also says the "cap" is not a cap, but by another route: gate-length convention, P–P 90° at 2 µm giving 1.52. It does not use G's route (restricted lattice family; E7 found ~1.56 with an oblique lattice). |
| D9 | The E7 "settlement" is not independent: it imports E6's module and compares feasibility ratios and θ=90 baselines | No (after the report) | **MISSED**. F6 finds the same pattern one experiment earlier, in E6's cross-validation. It does not cover the E7 settlement. |

## Precision (A findings)

| F id | verdict | reason |
|---|---|---|
| F1 | matches D6(b), **true** | I reproduced it: E4's `pair_dipole_diag.compute` at θ=24.65°, Zeeman 5 MHz, R=2 µm gives dE = **+158.0 MHz**, overlap 0.746, apparent C6 −10.1. At θ=0, R=2 µm it gives +159.3 MHz. So at the gate distance the C6 zero is gone, and the modelled −2.887 MHz is about 55× too small. Caveat: the basis (n 58–62, 30 GHz, dipole-only) is not converged at 2 µm, so the exact size is uncertain. The order of magnitude and the loss of angular cancellation are robust. BREAKS is justified. |
| F2 | matches D5 (+ partial D8), **true** | It independently reproduces G's 1.66 (0.013911/0.008362). The random-lattice check confirms the SS densities themselves. BREAKS is justified: the headline moves by 16%. |
| F3 | **NEW-TRUE** (magnitude only estimated) | Reproduced: diagonalization along θ* gives +81 kHz at 6 µm (apparent C6 −3.76, not ≈0). The model gives about −15 kHz, so the 10 kHz cross-talk radius along θ* is >6.54 µm. Zeeman dependence of the "zero" is also shown. The 5–25% gain cut is an unverified estimate. This challenges G's remark that the packing gain is "much less affected". Severity WEAKENS is right. |
| F4 | matches D4, **true** | `c6_diag_control.log:14` reads "24.0: C6=0.0068 R2=-0.9251". E7's wide-window diagonalization gives −0.639 at 24° and a zero between 24° and 25°. |
| F5 | matches D6(a), **true** | 1.47 GHz·µm⁶/deg becomes 23 MHz/deg at R=2 µm, agreeing with G's 1.45. The ±0.35° uncertainty maps to ±8 MHz. |
| F6 | **NEW-TRUE** | E6 `results.json` cross_validation keys a 1.3385 vs 1.331 *strong-blockade 90°* gain under `computed.interaction_gate_packing_gain_2d`, the 1.98 headline key. The third check is a feasibility ratio (1.0 vs 1.000034). `claims.json` grades 1.98 as `corroborated`, while report.tex:141 calls it "Single-method (indicative)". Same failure pattern as D9, but in E6, and it reached claims.json. |
| F7 | mixed: sub-bullets 3–4 duplicate D4/D5; Sec. III **NEW-TRUE (cosmetic)**; lifetime **FALSE** | "Sec.~III" is hard-coded text in an `article` with arabic-numbered sections, a cosmetic error. The lifetime bullet accepts the report's claim that 60P₃/₂ decays faster. That is backwards: Rb nP₃/₂ lifetimes exceed nS at the same n (Beterov 2009). The fidelity is conservative, not an upper bound (= D7). |

## Disagreements

- **D6 vs F1 (strength).** G calls the validity-domain part a "strong inference" because no diagonalization was done below 6 µm. A actually ran the run's own diagonalization at 2 µm, and I reproduced +158 MHz. **A is right and stronger.** The gate mechanism ("C5/C8 floor at the C6 zero") does not exist at 2 µm, so G's D6 understates the case: this is BREAKS, not just "unverified".
- **Packing gain sensitivity (G's D6 note vs F3).** G says the cross-talk at ≥6.5 µm is "much less affected". The diagonalization at 6 µm along θ* (+81 kHz vs a 10 kHz threshold) shows the cross-talk radius is underestimated there too. **A is more right on direction.** The size is unsettled.
- **D4 mechanism.** G calls min|C6|=0.007 a grid-sample coincidence. A shows it is a failed fit (R² = −0.93). **A is more precise.** Both agree it is not evidence of a zero.
- **D7 (lifetime direction).** A accepts "upper bound" and G says it is conservative. **G is right.**
- **1.3385 vs 1.331 cross-check.** G attributes it to E7 (D9). It is also, and verifiably, in E6's `results.json` under the headline key. Both passes are right about their own experiment. A's placement is the one that reached the report.

## Counts

- Recall (all research defects): **3 FOUND + 1 PARTIAL out of 9** (D4, D5, D6 found; D8 partial; D1, D2, D3, D7, D9 missed). That is 0.33 strict, 0.39 with half credit for partials.
- Recall (defects that reached the report: D2, D4, D5, D6, D7, D8): **3 FOUND + 1 PARTIAL out of 6**. That is 0.50 strict, 0.58 with half credit. **Both headline defects (D5, D6) were found.**
- NEW-TRUE: **3** (F3 cross-talk radius/Zeeman; F6 E6 xval mis-keyed + claims.json grade conflict; F7 Sec. III, cosmetic). FALSE: **1** (F7 lifetime sub-bullet, = D7 backwards). UNVERIFIABLE: **0**. F3's magnitude is only an estimate, but its direction is verified.
- BREAKS findings that are real: **2 of 2** (F1, F2).

## Summary

1. A found both headline defects that every G mechanism missed. For D5 it independently reproduced 1.66×. For D6 it did better than G: it ran the diagonalization at 2 µm (+158 MHz) and turned G's inference into a verified BREAKS.
2. A missed every defect that was only corrected history (D1, D3), the disclosed n=75 bias (D2) and the post-report E7 settlement (D9). It also repeated the report's backwards lifetime claim (D7) as its own finding.
3. Precision is high. A found 3 new true defects: the cross-talk radius along θ* is underestimated, E6's cross-validation is mis-keyed onto the headline with a claims.json/report grade conflict, and there is a cosmetic section reference. It made 1 false sub-claim and no false BREAKS.
