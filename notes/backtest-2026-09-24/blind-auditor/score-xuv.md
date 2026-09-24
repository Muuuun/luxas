# Score: blind audit (A) vs ground truth (G), XUV实现路径

G = `notes/backtest-2026-09-24/bt-xuv.md`. A = `scratchpad/audit-xuv.md`.
I checked A's findings read-only on the droplet against `report/report.tex`, E2 run_3 and E3 run_1 `compose.py`, `results.json`, `pathway_comparison.csv` and the E3 scripts, `CARLE_main.tex` l.165–180, and the `Hahn2025.md` and `Kumar2026.md` notes. I wrote no scratch files on the droplet, so there is nothing to clean up.

Structural caveat: A audited the **final** artifacts (report plus the reported runs). D1–D9 and D11 live in superseded runs (E1 run_1, E2 runs 1–2), and none of them reached the report, so A could only find them by digging through history.

## 1. Recall (research defects D1–D13; P-class D14–D17 skipped)

| G id | Defect | Reached report? | A |
|---|---|---|---|
| D1 | "H2-only" P includes the Q_NG/S_ion term (99%) | No (superseded) | MISSED |
| D2 | S_ion = 75 instead of 10 L/s for non-getterables | No | MISSED |
| D3 | Scalar computed at 2500 L/s but inputs say 982.48; single-NEG labelled as dual | No | MISSED |
| D4 | Required and available speed keyed as one quantity, which caused DISPUTED | No | MISSED |
| D5 | k=2 expanded uncertainty stored as 1σ | No | MISSED |
| D6 | Hahn "25 cm / 26 d" read literally, so depletion was wrongly denied | No | MISSED |
| D7 | Eckel2018 1e-11 Pa called a unit slip | No | MISSED |
| D8 | He2026a D-class values used as K (solubility missing) | No (withdrawal is disclosed in methods) | MISSED |
| D9 | Li atom-loss "cannot certify" stated as universal | No (narrowed version reached) | MISSED |
| D10 | Invented 10% σ fed into the PI ESTIMATE | Only via the PI ESTIMATE, not report.tex | MISSED |
| D11 | Carle E_D sign misread in run_2; the blind test enshrined it | No (report has the corrected sign) | MISSED. F8 touches the same topic but critiques the report's *framing*, not the run_2 error. |
| **D12** | Abstract σ = 1.14e-14 leaves out the 93.6% P_NG term | **Yes, abstract** | **FOUND**: F4, last bullet. It names the abstract, the 1.7%, and says the omitted term is disclosed in the body. |
| **D13** | "Independent routes" are the same algebra (E3 throughput vs nS, E1 51 L/s, E2 blind replication) | **Yes, body + methods** | **FOUND**: F5. It names all three cases and adds more (below). |

## 2. Precision (A findings that do not map to a G defect)

| F id | Verdict | Reason |
|---|---|---|
| F1 (BREAKS) | **NEW-TRUE** (it matches G's un-tallied candidate X1) | G listed the Hahn mismatch as a candidate but would not call it. A adds the retrodiction G did not do: apply the run's own model to Hahn's apparatus. That gives ≤6.4e-13, against 3.9e-12 ion-site (6×) and ≤1.5e-12 gauge. Hahn's own MolFlow ion/gauge factor of ~3× (Hahn2025.md l.16) has no counterpart in the single-node model. I confirmed the inputs (Q_NG = 6.15e-12, S_NG = 10 in compose.py; Hahn numbers in the notes), and I confirmed the report states both Hahn numbers (tex:103) without reconciling them. The discrepancy is real and unaddressed. "BREAKS" is not proven: the gauge is at its x-ray limit, and the Langevin/composition argument is a hypothesis. Honest severity: strong WEAKENS, plausible BREAKS. |
| F2 | UNVERIFIABLE | This is an argument by analogy. Kumar2026 (Ti chamber, 4 K H2-only tip, 1e-11 → 2.5e-12) is H2-dominated, but it is a different pumping architecture (no dual NEG at 1618 L/s). Nothing on the box shows that the run's H2 term is wrong for the adopted design. The finding is fair as a caveat, not as a defect. |
| F3 | **NEW-TRUE** | Verified. E2 run_3 compose.py:105 uses `S_science_l_s: 500.0`, which gives 9.24e-15 (the number that reaches tex:47 and the Fig. 2 caption). E3 `science_pressure_surface.py:280-283` defaults S_source = S_NG = 10, giving differential 9.08e-13 (margin 1.10) and open 5.0e-10. `pathway_comparison.py` pumps source gas at S_eff_h2 = 1618.6, giving open 3.75e-12. The two E3 tools disagree by 134× on the same mode. The reported "~9.2e-15 source-on offset" rests on a 500 L/s pump the adopted architecture does not have. The source-off headline is unaffected. The source-on claim is unsupported, and A's 1.12e-12 "fails" extrapolation is a scaling estimate (the tool's own number is 9.08e-13, which still passes at 1.10×). |
| F4 (beyond σ) | **NEW-TRUE** (minor) | Verified. compose.py:290 feeds `Q_NG: 0.70` as the *perturbation size*. The true flip points are +56% (Q_NG) and −36% (S_NG), and my recomputation matches A. The report's "+70% or −50% flips" is literally true, but it understates how fragile the result is. `tier()` defaults `s_ng="measured"` (compose.py:60), while the source quote is "ion pump **expected** to pump … ~10 L/s" (results.json l.29). That is a real mislabel. |
| F6 | **NEW-TRUE** (severity overstated) | Verified: the He load uses A = 10 cm² and d = 0.3 cm (E2 run_3 compose.py:438-441), and the report never states the 10 cm² window area. The scaling to realistic viewports and the fused-silica cells are judgment calls. By A's own numbers, the BSG conclusion survives (margin 1.25). This is MINOR, not WEAKENS. |
| F7 | **NEW-TRUE** | Verified. Path 13 "turbo-only" (compose.py:177-180) swaps in as-received steel, an illustrative 1e-9 bare-glass He load and S_TURBO = 800, with no turbo ultimate-pressure term. The CSV says `dominant_term=He` at P = 2.8e-11, which contradicts tex:94's "受限于涡轮 ~1e-10 极限压力". Ion-only uses `S_ION_ONLY_H2 = 100.0 # illustrative`, and the pass threshold works out to 136 L/s (my recomputation matches A). The stated reasons for failure are not what the code computed. |
| F8 | UNVERIFIABLE (partly a disagreement with G, see §3) | A is right that Carle's printed equation and numbers are internally inconsistent, and that the field quotes Pyrex −0.29 eV and Corning −0.52 eV with the same sign (CARLE l.171). Whether this is a convention inherited from Norton/Altemose rather than an error cannot be settled on the box. The objection is about how the report frames its novelty ("在本文中被发现"), and it has no effect on the headline. |
| F9 | **NEW-TRUE** (minor) | Verified. tex:76 and the Fig. 4 caption say Q_NG "测得" (measured), while tex:81/113 say "推断上限" (inferred upper bound). tex:38 says q_H2 ~1e-15 while the headline uses 5.1e-14 (51×). A calls tex:38 "the abstract", but it is §2 body, which is a small location error. The gauge/ion-pump CH4 transfer argument is a hypothesis. |
| F10 | UNVERIFIABLE | The missing terms (alkali residue, light-induced desorption, in-vacuum parts, gauge outgassing) are plausible, but none is quantified. This is an open-question list, not a demonstrated defect. |

## 3. Disagreements

- **D11 vs F8 (Carle sign).** G's defect is the run_2 *misreading*: it took the negative sign literally, concluded that RT K is higher, and the blind test enshrined that. The report fixed this. A accepts the report's corrected physics and instead faults the claim of *discovery*. Both agree on the arithmetic (1.6e-7 vs 6.4e-22). G is right about what the defect was. A's point is a separate, weaker framing issue that A did not verify against Norton. A did not find D11.
- **X1 vs F1.** G hedged: "may be geometry (1000 cm² hypothetical chamber) or metrology, so I cannot call it wrong". A's retrodiction removes part of the geometry excuse, because Hahn's H2 load is *lower* than the adopted chamber's and the NG term is copied unchanged, so the model cannot reproduce Hahn's ion-site value. A is more right that this is a real, unreconciled gap. G is more right that it has not been shown to break the verdict (the gauge is at its x-ray limit, and the 100%-H2 inference cuts both ways). I rate it a real finding at WEAKENS-plus.
- **D13 / F5.** Same defect. A goes further than G with E3 acceptance criteria (b) and (c): the contour is non-empty by construction, and "reproduces upstream within 1e-6" compares hard-coded constants. Both points are correct, and they strengthen D13.
- **D12 / F4.** They agree on both the magnitude (σ 1.7% vs a 93.6% term with no σ) and the location (abstract).

## 4. Counts

- **recall (all research defects): 2 / 13 = 15%** (D12, D13). All 11 misses are in superseded run_1/run_2 artifacts, or D10 via the PI ESTIMATE only.
- **recall (defects that reached the report): 2 / 2 = 100%** (D12 abstract, D13 body + methods).
- **NEW-TRUE: 5** (F1, F3, F6, F7, F9), plus new true extras inside F4, which is counted as a match for D12. **FALSE: 0. UNVERIFIABLE: 3** (F2, F8, F10).
- **BREAKS findings that are real: 1 of 1, qualified.** The F1 discrepancy is real and unaddressed, but it has not been shown to flip the verdict.

## 5. Summary

1. A caught both defects that actually reached the report (D12 abstract σ, D13 fake independence) with the right mechanism, and missed all 11 defects that lived only in superseded runs, which it had no reason to reopen.
2. Of A's 8 unmatched findings, 5 are verified new true defects that G missed (F1 Hahn retrodiction gap, F3 source-on offset resting on a nonexistent 500 L/s pump, F6, F7 turbo/ion-only reasons not what the code computed, F9 measured vs inferred label). 3 cannot be settled, and none is false.
3. A's severity runs somewhat hot: F1 BREAKS is at most a strong WEAKENS, and F6 is MINOR. Even so, F1 and F3 are the most decision-relevant issues about the headline that either pass raised.
