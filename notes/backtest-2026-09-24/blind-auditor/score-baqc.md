# Score: blind audit (A) vs ground truth (G), ba-neutral-atom-qc-20260829

G = `notes/backtest-2026-09-24/bt-baqc.md`, A = `scratchpad/audit-baqc.md`.
All verification was read-only on the droplet project. I recomputed F1, F2 and F11 myself, using the run's own CSVs and the run's own E5 script copied to `/tmp/score-baqc/`, which has since been deleted.

## 1. Recall (research defects D1–D9; process defects P* skipped)

| G id | defect | reached report? | A match |
|---|---|---|---|
| D1 | Intermediate 5d6p ¹F₃ᵒ scattering is left out of the error budget (ρ_ii = 0.5625, Γ_sc ≫ the Ba total) | **Yes (abstract)** | **FOUND**: F3. The mechanism matches: ρ_ii = 0.5625, the 17 ns proxy, Γ_sc·2π/Ω ≈ 0.22 at 150 MHz and ≈ 5.7 at 5.78 MHz, which agrees with G's 0.17 and ≈ 4 once the 3/4 prefactor is applied. A also gives a second, more conservative bound from Shi's own ~3×10⁻⁴. |
| D2 | Ba Ω_eff is treated as n-independent (150 MHz used at n = 100) | G says no ("corrected before the final report"). **Verified: yes, in the abstract.** See §3. | **FOUND**: F1 + F2. They show the fix reached only the *decay* ratio. The 20 mW total, the 2 W totals, the "7.3× blockade-limited" claim and the abstract's "Ba ~3× better than Sr in total" still use the unscaled Rabi. |
| D3 | The Ba lifetime path failed its own Rb/Sr validation (REFUTED), yet the report calls it "validated"; no published Ba lifetime was used | **Yes** (Methods + abstract) | **PARTIAL**: F6. A notes that no validation against a published *Ba* lifetime was done (a RESEARCH.md requirement) and that the "two routes" are not independent. A misses the core mechanism: the E3 REFUTED verdict (Rb 50S 24× off) against the report's "validated against the references" sentence. |
| D4 | E5's δ(¹F₃) = 0.054 was copied from δ(¹G₄) | No (fixed) | MISSED |
| D5 | σ(c6_rb87_78s) = 0.1 vs the stated 0.6% | No (fixed) | MISSED |
| D6 | Non-independent cross-validation (E4 Rabi legs; E8 "blind 7.56") | **Yes** (Methods: "blind 7.56±1.5") | **FOUND**: F8, the E8 half. That is the half that reached the report. The E4 half was removed before the report. |
| D7 | Wrong PI priors (n⁵/ℓ⁴; δ_F 0.1–0.3) | No | MISSED (they never reached the artifacts A audited) |
| D8 | Methods attributes PI/brain STEERs to "human decisions" | **Yes** (Methods) | MISSED |
| D9 | Sr 99.9% cited to Pagano2022 instead of Scholl2023 | No (fixed) | MISSED |

## 2. Precision (A findings not matching a G defect)

| F id | verdict | reason |
|---|---|---|
| F1 | matches D2 (verified, **BREAKS**) | `E7…/power_matched_frontier.csv` row `0.02,15.0,…,3.018e-5` means the 20 mW total uses Ω = 15 MHz at n = 100. Rescaled to 5.78 MHz, ε_d = 7.77e-5 (hydro) to 9.48e-5 (qd). Against E6 `frontier_4K.csv` Sr total 1.017e-4, Ba/Sr = 0.76–0.93, not 0.297. Re-optimizing Sr: a = 3.91e-4, U = 3985 MHz, which gives Ω* = 14.6 MHz and ε = 4.0e-5. Both reproduced. |
| F2 | matches D2 (verified, **BREAKS**) | `gate_infidelity_frontier.py:99` has `BA_OMEGA_2PI_MHZ = 150.0 # n-independent`. The frontier at n = 100 gives Ba blockade/decay = 2.19e-5/3.00e-6 = 7.3 at 150 MHz. At 57.8 MHz, decay 7.77e-6 exceeds blockade 3.26e-6, so Ba is decay-limited. Ba/Rb with the second-order C₆ becomes 2.16e-5/8.15e-5 = 0.27, not 1.18. Reproduced. |
| F3 | matches D1 (**BREAKS**) | See the recall table. A's "likely" confidence is appropriate. |
| F4 | NEW-TRUE (WEAKENS) | Verified: the Ba waist is 10 µm (`rydberg_rabi.py`) and the Sr waist is 12 µm (`reference_interactions.py:321`). E7 uses Cs 6.0 and Yb 7.0 MHz (`power_matched_frontier.py:255`), while E6 uses Cs 10.14 and Yb 1.07. The report's Rb "20 MHz" does not match the frontier's 8.96 MHz. The Sr re-optimization arithmetic is correct. |
| F5 | NEW-TRUE (severity is closer to MINOR) | The E1 frozen criterion rejects when HFS/linewidth ≥ 1e3 (experiments.md). ⁸⁷Sr ³P₁ (~2.6 GHz / 7.5 kHz ≈ 3×10⁵) is a routinely cooled narrow-line MOT, so "prohibitive" is not a valid general rationale. The ¹³⁸Ba choice survives on other grounds, so no headline changes. |
| F6 | PARTIAL for D3, plus a NEW-TRUE part | The E5 `cross_validation[0]` is literally δ_F = 0.048 vs its own δ_F → 0 limit. So σ = 0.034 is δ-sensitivity, not model uncertainty. The ledger calls the result "a model-class disagreement, not a proven refutation", yet the report asserts that Shi "under-count[s]". G's D6 does not cover the E5 non-independence, so that part is new. |
| F7 | NEW-TRUE (MINOR; omission) | Shi2025.md:6/11 has 1.3 ms at 300 K, and the report never cites it. 4α³kT/3n² at n = 60, 300 K gives 5.7e3 s⁻¹ (τ ≈ 0.18 ms), which confirms A's point. Addressing it would strengthen the report rather than overturn it. |
| F8 | matches D6 (E8 half) | — |
| F9 | NEW-TRUE (MINOR) | The report says ±0.12 MHz, while the PI estimate (pi_feedback.md:207) is 5.8 ± 2 and the scenario spread is 1.83–5.78. The 2 W 0.756 is the hydro end; the qd end is 9.48e-6/1.03e-5 = 0.92, and that end is never quoted. The report does disclose the 20 mW band [7.6, 29], which softens this. |
| F10 | NEW-TRUE (MINOR, borderline) | The narrow claim holds: a prefactor that cancels in ratios cannot validate the absolute values 2.49e-5 / 3.0e-5 that the report quotes. Whether 2π/3.86 is the right explanation is unsettled; G lists it as "no definitive ground truth". |
| F11 | NEW-TRUE (WEAKENS the σ, not the verdict) | Reproduced exactly. With the run's own `_compute_one_n(60, 0.048, 0.054164)` as the baseline (0.3029 ms) and the n′ = 4–7 channels swapped to their measured per-level δ, τ = **0.267 ms**, outside [0.303, 0.371]. Caveat: plugging per-level δ into a single-electron wavefunction for perturbed low-n′ levels is itself model-dependent. |

Severity check. F1, F2 and F3 are genuinely conclusion-changing:
- The abstract's "total error keeps Ba ~3× better than Sr" and "blockade-limited" do not survive any of the three.
- F4, F9 and F11 change error bars or matching, not the verdict.
- F5, F7 and F10 are rationale or presentation issues.

A's own severity labels are, if anything, slightly high only on F5 ("WEAKENS"; MINOR fits better).

## 3. Disagreements

- **D2 "corrected before the final report" (G) vs F1/F2 (A). A is right.** G checked only the decay ratios (7.56 / 0.756), which were fixed. The E6 frontier (`BA_OMEGA_2PI_MHZ = 150.0 # n-independent`) and the E7 20 mW total leaf (Ω = 15 MHz at n = 100) were never regenerated. So the report's §4 mixes the scaled Rabi (decay sentences) with the unscaled Rabi (total-error and blockade sentences). This reaches the abstract. G's D1 quotes the same abstract sentence but attributes its wrongness only to missing scattering. In fact it is wrong twice over, and D2 alone (F1) already takes Ba/Sr from 0.297 to 0.76–0.93.
- **Effect of per-level low-n′ ¹F₃ defects on τ.** G guessed "a few-% ω³ effect, not definitive"; A computed 12%. A's number reproduces with the run's own code, so G underestimated it. Both agree that the direction (a shorter τ) strengthens the anti-7.1 ms conclusion.
- **D1 magnitude.** G gives ~0.17 at 150 MHz; A gives ~0.22. The difference is only the 3/4 vs 1 pulse prefactor. Both also note that Shi's own ~3×10⁻⁴ is 10–100× the reported Ba total. They agree.

## 4. Counts

- **Recall (all 9 research defects):** 3 FOUND (D1, D2, D6) + 1 PARTIAL (D3) = **3/9 strict, 4/9 counting partial**.
- **Recall (defects that reached the report):** using the verified set {D1, D2, D3, D6, D8}, **3/5 strict, 4/5 counting partial**. Using G's own labels {D1, D3, D6, D8}, 2/4 strict, 3/4 counting partial. The only reached-report miss is D8 (provenance wording). A missed only defects that were fixed before the report, plus D8.
- **Unmatched A findings:** NEW-TRUE **6** (F4, F5, F7, F9, F10, F11; F6 also has a new-true component). FALSE **0**. UNVERIFIABLE **0**.
- **BREAKS findings that are real:** **3 of 3** (F1, F2, F3).

## 5. Summary

1. A found both high-impact physics failures in the abstract: missing intermediate scattering (D1 = F3) and the n-independent Rabi (D2 = F1+F2). It only partially found D3 (it missed the REFUTED Rb/Sr validation being relabelled "validated") and it missed D8's provenance misattribution.
2. On D2, A is right and G is wrong. The n-scaling fix never reached the total-error leaves. The report's "Ba ~3× better than Sr in total" (really 0.76–0.93, or worse than a re-optimized Sr) and "blockade-limited 7.3×" (really decay-limited) are stale. I verified both from `frontier_4K.csv` and `power_matched_frontier.csv`.
3. A's precision is high: 0 FALSE, 3/3 BREAKS real, and 6 new-true findings (mostly minor). Its misses are almost all defects already fixed before the report, which a blind report-facing audit cannot see by construction.
