# Score: blind audit (A) vs ground truth (G), yttrium-tweezer-20260905

I verified everything read-only on the droplet: E2 `compose.py`, the `polarizability_{ground,excited}.csv` files, E2 `results.json`, the E1 `nist_y_dataset.json`, `notes/literature.d/Hannaford1982a.md`, E5 `compose.py` and `report/report.tex`. No scratch files were created.

"Reached report" means the defect is in the current `report/report.tex`. D10 reached an earlier version of the report but was fixed before the final one, so it does not count here.

## 1. Recall (research defects only)

| G id | Defect | Reached report? | A match |
|---|---|---|---|
| D1 | "No scalar magic λ" is a filter artifact: the 5 nm mask covers every line in the list | **Yes** (abstract, QC row) | **FOUND**: F2(a), plus F10 last bullet. Same mechanism (`_far_from_resonance` over all lines, including those with no A-value). |
| D2 | Magic-ellipticity scan covered only 532/780/1064 nm, but the abstract says 350–1600 | **Yes** (abstract) | **MISSED** |
| D3 | SOS misses its anchor by 39 % (99.1 vs 162 a₀³), relabelled "not an error"; excited states rest on 1–2 terms | **Yes** (disclosed as a lower bound) | **PARTIAL**: F2(b). Hits the excited-state incompleteness (n_terms_used = 2, no upward terms) and shows it biases the magic result. Does not address the 99.1 vs 162 miss or the relabel. |
| D4 | Imaging ignores the trap light shift of the 407.7 line (~132 MHz ≈ 5 Γ), so photons drop ~17× | **Yes** (abstract headline) | **FOUND**: F1. Same numbers: 132.5 MHz, ≈43 scattered, ≈1.2 detected. |
| D5 | False gap: "Y hfs A-constants unmeasured" | **Yes** (abstract) | **FOUND**: F9. Same values (−57.2 / −28.7 MHz). |
| D6 | Circular E1 xval: NIST A = Hannaford BF/τ, so closure 1.0017/1.0048 holds by construction | **Yes** (abstract "cross-checked against measured lifetimes") | **FOUND**: F7. Same arithmetic, e.g. 0.841/5.3 ns. |
| D7 | The 15 % IR leak is Hannaford's flat (±15 %) assumed correction, reported to 4 figures; the reconciliation is tautological | **Yes** | **FOUND**: F3. Same source line in the Hannaford note; A also shows 0.70 + 0.151 = 0.851 is the "closure". |
| D8 | claims.json binds 4/23 claims to the wrong keys, and the file is stale | No (claims.json only) | **MISSED** |
| D9 | The σ values (±0.005 fidelity, ±0.05 survival) are copied from the PI's ESTIMATE lines, not computed | **Yes** (abstract) | **PARTIAL**: F10(c). A saw that "0.9999 ± 0.005" is meaningless because the interval crosses 1, but not that it came from the PI. |
| D10 | Two cross-artifact contradictions (359.4 nm sensitivity; Dy tensor) | Earlier version only; fixed | **MISSED**. A's tensor finding is about the Y column, not Dy. |
| D11 | `radial_Hz` is ω², not Hz | No | **MISSED** |

## 2. Precision (A findings with no G match)

| F id | Verdict | Reason |
|---|---|---|
| F2(b) | **NEW-TRUE** (extends D3) | The excited-state SOS has 2 terms and no upward partners. The project's own level list has f²D₃/₂,₅/₂ at 36420.6 / 36431.2 cm⁻¹, even parity, 4d5s6s, which is 840 nm from y²F°5/2 (24518.75), plus other even levels at 1027–1321 nm. Near each E1 pole α_e sweeps ±∞ while α_g is smooth and positive, so a trapping magic crossing is structurally forced. G never makes the "wrong in sign" point. |
| F4 | **NEW-TRUE**, but severity overstated (WEAKENS, not BREAKS) | Verified from the dataset: 8 even J = 3/2–7/2 levels at 1088–1956 nm (a⁴P, a²F, b²D, a²G, a²P), and a²D in the results.json destination label is the ground term. One "IR repump" cannot cover them. The report already hedges ("only if the leak terminates on dark states"), so this is an undercount, not a broken claim. A also missed the a⁴F destinations at 736–755 nm. |
| F5 | **NEW-TRUE** (BREAKS for the l.240–246 sentence only) | The project's own Hannaford note lists z²D°3/2,5/2 with τ = 185 / 175 ns. The dataset has 619 nm ²D3/2→z²D°3/2 with A = 4.6e6. So "every reachable state has τ = 4.6–22 ns" is false, and the narrow-line option (~0.8 MHz) was never evaluated. The line is sub-MHz rather than kHz-class, and the overall conclusion changes little. |
| F6 | **NEW-TRUE** (WEAKENS) | `scattering_lifetime_at_1mK_s` = 0.1988 = 1/5.03 s⁻¹, the one-photon scattering time. It is compared against a ">100 ms trap lifetime" bar and used to reject 532 nm (41.8 ms). Recoil heating implies a trap loss time many orders of magnitude longer. The choice of 1064 nm survives; the framing does not. |
| F8 | **NEW-TRUE** (WEAKENS) | E5 `compose.py:105` gives Y "no" because its manifold is "thermally empty … no clock/erasure state demonstrated". `:229` gives Dy "yes" with source "omg/erasure not demonstrated for Dy". That is a real double standard, and "thermally empty" is not a valid criterion (Sr/Yb ³P₀ are too). The overall verdict probably survives. |
| F10(a) | **NEW-TRUE** (minor) | E5 `compose.py:208` and report l.391 give "¹⁶²Dy 0.139 % abundance". The natural abundance of ¹⁶²Dy is ≈25.5 %. A factual error in the table. |
| F10(b) | **NEW-TRUE** (minor) | The QC table's tensor polarizability of 48 a₀³ is the 532 nm value (`alpha_t` = 48.239). At the chosen 1064 nm trap it is 35.019, and the static value is 28.9, so "≈29–48 over 532–1064 nm" at l.218 mixes in the static value. |

No FALSE or UNVERIFIABLE findings. F9 relies on outside literature, but G relies on the same knowledge for D5.

## 3. Disagreements

- **D1 vs F2(a): A is right about the consequence.** Every root the filter removed sits where α_g < 0 (anti-trapping). From the CSVs, α_g is −31.6 → −59.2 a₀³ at the 611/612 nm roots, −78.5 at 460 nm, and −870 at 412 nm, and the 356 nm root sits next to a pole. The filter artifact is real, so "none found" does not describe what the code computed. But G's framing ("smooth, non-pole Δα_s zero at 611.66 nm") implies a usable magic wavelength was lost, and in-model there is none for a red-detuned trap. The real reason "no magic" is wrong is F2(b), the missing upward excited-state terms, which G mentions only in passing under D3. On the mask size G is right: it covers 302 lines, since the compose step drops lines with None fields, whereas A counted all 361 lines in the dataset. Both have the mechanism right.
- **D7 vs F3: consistent, and A goes further.** G treats this as over-precision plus a tautological reconciliation. A argues the leak itself is not observed (anywhere from 0 to 30 %), and that the 414.3 cycle's 1.0017 closure only reflects that no correction was applied to it. That undercuts "2 lasers fully closed vs 2–3 lasers" as well. Both points are supported by the Hannaford note, so A is the more complete account.
- **D9 vs F10(c): G is deeper.** A saw only the symptom (the interval crosses 1), while G traced the provenance (σ copied from the PI's ESTIMATE lines, not computed).
- **D4 vs F1: agree** on both the numbers and the mechanism.

## 4. Counts

- Recall, all 11 research defects: **5 FOUND + 2 PARTIAL + 4 MISSED**, so 5/11 strict and 7/11 counting PARTIAL.
- Recall, the 8 defects that reached the report (D1–D7, D9): **5 FOUND + 2 PARTIAL + 1 MISSED (D2)**, so 5/8 strict and 7/8 counting PARTIAL.
- A's findings with no G match: **7 NEW-TRUE / 0 FALSE / 0 UNVERIFIABLE**. The NEW-TRUE ones are F2(b), F4, F5, F6, F8, F10(a) and F10(b).
- BREAKS findings that are real: **5 of 5 real**. F1, F2, F3 and F5 hold at BREAKS severity; F4 is real but is WEAKENS, because the report hedges the IR-repump count.

## 5. Summary

1. The blind audit found 5 of the 8 report-reaching defects outright and 2 more partially: the light shift, the magic filter, the fake hfs gap, the circular xval and the 15 % leak. Its only miss that reached the abstract is D2 (the ellipticity scan covered only 3 wavelengths). It also missed the bookkeeping defects (D8 claims.json keys, D10, D11) and the provenance of the copied σ values (D9).
2. All of its unmatched findings check out (7 NEW-TRUE, 0 FALSE). The most important is F2(b): the excited-state SOS lacks upward terms, so trapping magic crossings near 840–1321 nm are structurally forced and "no magic" is probably wrong in sign. Next are F5 (an overlooked 185 ns z²D° line) and F6 (the "199 ms lifetime" is really a one-photon scattering time).
3. Where the two passes overlap, A corrects G on D1: every root the filter removed is anti-trapping, so the filter bug alone does not lose a usable magic wavelength and the real hole is the incomplete excited-state sum. G is deeper on the provenance of D9.
