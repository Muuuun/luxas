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

## Machine-readable checks

Consumed by `scripts/bench_score.mts` (the prose rubric above is the human
half of the same claim; keep them in sync). `discrepancy` passes only when
BOTH values appear and the report uses disagreement language — a report that
prints 0.248 and 0.39 while calling them consistent fails, which is the
"papers over it" case this bench exists to catch. `trap` passes when the
pattern does NOT appear.

```oracle
{
  "checks": [
    { "kind": "discrepancy", "label": "peak p2(r0): analytic 0.248 vs TDSE 0.39, ~1.6x apart",
      "a": 0.248, "b": 0.39, "rtol": 0.12 },
    { "kind": "value", "label": "C6 at theta=90deg from full diagonalisation (GHz.um^6)",
      "target": -318, "rtol": 0.15 },
    { "kind": "trap", "label": "perturbative C6(theta=0)~0 read as 'no on-axis interaction'",
      "patterns": ["no (?:significant )?(?:on-axis|axial) interaction",
                   "vanish\\w*\\s+(?:on|along)\\s+(?:the\\s+)?(?:axis|quantisation axis|quantization axis)",
                   "C_?6\\s*\\(?\\s*(?:\\\\theta|theta)\\s*=\\s*0\\s*\\)?\\s*(?:=|\\\\approx|~)\\s*0\\b"] }
  ]
}
```
