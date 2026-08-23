# Oracle — bench-02

From a production run (2026-07-27, `single_photon_Rydberg`, E2). This oracle is
a documented **discrepancy**, not an agreement — the point of the bench is
whether the report notices and explains it rather than papers over it.

| quantity | method A | method B |
|---|---|---|
| peak p₂(r₀) | Vermersch 2015 analytic formula with pairinteraction C₆ **0.248** | time-dependent Schrödinger, 6-state pair system **0.39** |

Also established in that run: C₆ for the stretched P₃/₂ pair is ~33× anisotropic
(C₆(θ=90°) ≈ −318 GHz·μm⁶ at n=60), and second-order perturbation theory gives
C₆(θ=0°) ≈ 0 — an artefact refuted by full pair-state diagonalisation (+9.63).

## How to score

- Reports BOTH numbers, flags that they disagree by ~1.6×, and attributes it
  (the analytic formula assumes a two-level blockade; the TDSE includes the
  weak-axis leakage the anisotropy opens): full marks.
- Reports only one method, or reports two methods that agree suspiciously
  well: the cross-validation was not actually independent.
- Uses perturbative C₆ at θ=0 and concludes "no interaction on axis": fell
  into the documented perturbation-theory trap.
