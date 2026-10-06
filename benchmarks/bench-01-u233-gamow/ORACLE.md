# Oracle — bench-01

Known-good values from a production run (2026-07-29, `加速alpha-衰变`, E3), two
independent methods agreeing:

| quantity | method A | method B | agreement |
|---|---|---|---|
| Gamow factor G | WKB numerical integration (Coulomb + centrifugal) **42.66** | Viola–Seaborg semi-empirical, uncalibrated **42.59** | 0.16% |
| Q_α (MeV) | AME2020 mass defect **4.908679** | ENSDF/NNDC published **4.9088** | 0.002% |

Reference half-life: ²³³U t½ = 1.592 × 10⁵ yr (ENSDF).

## How to score

- Headline G within ~2% of 42.6 AND the two methods in the report are
  genuinely different (not WKB run twice): full marks.
- G correct but the cross-validation is the same computation with a different
  label, or the Q-value is quoted without a database source: the number is
  right and the evidence tier is wrong — the weaker report.
- A naive WKB with no centrifugal term gives G ≈ 40.2; a report landing there
  skipped a term the request names explicitly.

## Machine-readable checks

Consumed by `scripts/bench_score.mts`; the prose rubric above is the human half of the same claim — keep them in sync.

```oracle
{
  "checks": [
    { "kind": "value", "label": "Gamow factor G = 42.6 (WKB with centrifugal term; 40.2 is the no-centrifugal miss)",
      "target": 42.62, "rtol": 0.02, "minSig": 3 },
    { "kind": "value", "label": "Q_alpha from AME2020 (MeV)",
      "target": 4.9087, "rtol": 0.001, "minSig": 4 },
    { "kind": "mention", "label": "an independent semi-empirical cross-check is named",
      "patterns": ["Viola", "Royer"] },
    { "kind": "mention", "label": "the Q-value carries a database source",
      "patterns": ["AME\\s*-?\\s*2020", "atomic mass evaluation", "ENSDF", "NNDC"] }
  ]
}
```
