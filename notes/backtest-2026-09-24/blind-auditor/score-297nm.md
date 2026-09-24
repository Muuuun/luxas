# Score: blind audit (A) vs backtest ground truth (G), single_photon_297nm

G = `notes/backtest-2026-09-24/bt-297nm.md`. A = `scratchpad/audit-297nm.md`. Verification was read-only on `ssh luxas` in the project directory: report.tex, E2 `cross_validation.json` / `analysis.json` / benchmark csv, E3 `error_terms.py`, and literature.md. I also ran one local 3-level numpy/scipy toy with no files and no billing. Nothing was written on the droplet.

## 1. Recall (research defects only; P1–P4 skipped)

| G id | defect (one line) | reached report? | A verdict |
|---|---|---|---|
| D1 | E5 "leakage" = 1−P_gg return population. There is no \|11⟩ conditional phase, no \|01⟩/\|10⟩ branch and no detuning chirp. It scales as Ω⁴, not Ω²/V² | **Yes** (abstract) | **FOUND**: F1 (the phase error is omitted) + F3 (the pulse is not a CZ gate: \|01⟩ returns with only 0.367 probability, and there is no detuning) |
| D2 | E6 substitutes D1's metric into the budget and flips the headline F(40)>F(10); the flip probably reverses | **Yes** (title, headline) | **FOUND**: F1 (recomputed: F(40)=99.671% < F(10)=99.891%, optimum 15 MHz) |
| D3 | C₆(75) is an n¹¹ extrapolation, and the direction of its error was asserted wrong ("lower bound → leakage smaller"). The final report keeps E3's stale 6.92e-5 computed from V=850 MHz | **Yes** (v1 abstract; the final report keeps the stale number and the wrong-direction narrative) | **PARTIAL**: F2. A shows the final report's "mixing makes leakage *smaller*" story is inverted: a matched ME at V=850 gives 5e-7, so the weaker true V is a penalty. That is the same wrong-direction claim surviving into the final report. A does not flag the n¹¹ extrapolation, E2's 15× vs 86× series, or the stale 6.92e-5 row |
| D4 | E2's "pure sin⁴θ", 10⁶ anisotropy and r_b(0)=0.32 µm are artifacts. The run's own diagonalization gives C₆(0)=1.22 (56×), and the Vermersch constant term is explained away | **Yes** (abstract, §2) | **FOUND**: F5. Same numbers (1.224, 56×, 3.27 µm), same Vermersch/Zeeman mechanism, plus an n*¹¹ rescale showing the 0.269 residual is reproduced |
| D5 | The "Numerov reproduces D2 to 0.37%" anchor is circular (ARC literature DME vs literature) | **Yes** (abstract) | **MISSED**. A lists the D2 reproduction under "Not checked" |
| D6 | The sole stated caveat (n=75 vs n≈75.3) is ill-posed, while the real assumptions go undisclosed | **Yes** (abstract, sole caveat) | **MISSED**. F10 establishes the underlying fact (n is a tuning choice, not something 297 nm implies), and F7 raises one of the undisclosed assumptions (Zeeman-partner removal). A never says the caveat is ill-posed, and it lists n-robustness under "Not checked" |
| D7 | "Power-cheap" contradicts the run's own numbers: 1.2 mW gives F≈93.8%, while the fidelity claims need 123–963 mW | **Yes** (abstract) | **FOUND**: F4 (same CSV row, 93.84%). A adds that 963 mW exceeds the 700 mW demonstrated source |
| D8 | Internal inconsistencies: 99.89 vs 99.909 for the same point; ledger "DOES" vs report "does not"; ±0.185 GHz sign | **Yes** (a) | **MISSED**. A quotes both 99.89 (H3) and 99.909 (F1) without flagging them |
| D9 | E3 scan scores C₆=0 rows as zero leakage (latent) | No | **MISSED** |
| D10 | Wrong plan premises: n≈55–65, τ≈1 µs, Manthey 700 mW/100 µm (caught in-run) | No | **MISSED / contested**. F10 argues the n≈55–65→75 "correction" is not warranted (see §3) |

## 2. Precision (A findings)

| F id | verdict | reason |
|---|---|---|
| F1 BREAKS | matches D1/D2 | Real. A's pipeline reproduces 2.555e-4 exactly with the run's 10-state pair block. Phase δ=0.139 rad → 2.9e-3, so the flip reverses |
| F2 BREAKS | matches D3 (partial) + D1 | Real. My toy (3-level, Gaussian 2π pulse for √2Ω, 40 MHz) gives ME leakage 4.5e-7 at V=−850 vs 4.6e-4 at V=−152, against closed forms 1.1e-3 / 3.5e-2. The report's 4.3× "suppression" comes from the pulse shape (adiabatic Gaussian vs square-pulse formula), not from Förster mixing. Mixing raises leakage about 500×. report.tex:88 and :115 state the inverted causal story |
| F3 BREAKS | matches D1 | Real. Area π√2 = 4.443 rad gives \|01⟩ return probability cos²(2.22) = 0.366. The code evolves only \|gg⟩. G states the same ("no \|01⟩/\|10⟩ branch, no chirp"); A quantifies it |
| F4 BREAKS | matches D7 | Real; same CSV row |
| F5 WEAKENS | matches D4 | Real. Numbers verified on box: cross_validation `n50_..._theta0` = −1.224; benchmark θ=0 = 2.35e-6 MHz µm⁶ |
| F6 | **NEW-TRUE** (minor) | Verified in `error_terms.py:118-126`. Pagano's recoil term with ω·coth(ħω/2kT) already contains the thermal-momentum (Doppler) dephasing; literature.md:480 even labels it "photon recoil + Doppler broadening". Adding Saffman's Doppler term on top double-counts it. The ratio 1.875 checks out; the T=0 recoil is ≈9e-5 at 10 MHz. Impact: about 2e-4 at low drive and the "recoil-limited" label. It does not change the F1 conclusion. A's intermediate prefactor "(15/16)" is a typo (it should be 15/32 × k²k_BT T̄²/m), but its ratio is correct |
| F7 | **UNVERIFIABLE** | The evidence is real: E2 diagonalization overlap is 0.773–0.784 at R=5–12 µm, flat even where the pair shift is −23 kHz, which signals degenerate-manifold mixing. No field is declared. Its effect on V, leakage and phase cannot be settled without a new calculation. G lists the same item as "suspected, not ground truth" |
| F8 | **UNVERIFIABLE** | U_p ≈ 1.2 MHz at 963 mW / 10 µm checks out (9.33e-14·6.1e5·0.088 eV). The differential shift, intensity noise and its effect on fidelity depend on calibration and compensation; A itself labels this a hypothesis |
| F9 | **NEW-TRUE** (severity overstated) | Arithmetic verified: π·700 kHz·61 ns = 0.135. However, the 1 kHz assumption is stated in the body (report.tex:86) and the ≤kHz-linewidth risk is caveat (ii) (:117). The real defect is that the abstract and verdict quote F without that condition, so this is a disclosure issue rather than one that weakens a conclusion |
| F10 | **NEW-TRUE** (minor) | Verified: vacuum 297.000 nm → n*=72.6 (n=75.3); air 297.0 nm → vacuum 297.087 → n≈62.5. "297 nm" in the literature spans roughly 38P (Manthey, ≈297.6 nm) up to the limit. A's "dn*/dλ ≈ 0.4 per pm" is 2× high (it is ≈0.2 per pm), but the conclusion stands. Does not affect gate conclusions |
| F11 | **NEW-TRUE** (minor) | Verified: diag C₆(90°, n=50) = 68.54 vs headline 55.198 (24%), and n=25 = 7.88 vs Vermersch 6.33. There is no "68.5"/"24%" in report.tex. Note that the report *does* disclose the diagonalization's 56× anisotropy parenthetically (line 40) |
| F12 | **NEW-TRUE** (minor) | A partial theoretical budget is compared against measured, all-inclusive gate errors (report.tex:92). This is a real framing error but does not change a conclusion on its own |

Severity check: A's four BREAKS are all headline-changing and real. F9 is ranked too high (WEAKENS for a disclosed assumption). F6 is correctly ranked WEAKENS/minor.

## 3. Disagreements

- **D1/D2 magnitude.** G's 3-level toy gives δ=0.126 rad → ~2.4e-3 and "the flip probably reverses", with the caveat that bright-eigenstate shifts may partly cancel. A imports the run's own 10-eigenstate pair block (it reproduces 2.555e-4 exactly) and gets δ=0.139 → 2.9e-3, F(40)=99.671%, optimum 15 MHz / 99.912%. **A is more authoritative.** It resolves G's cancellation caveat within the run's own reduced basis, and the two agree on direction. This is still conditional on F7 (the basis truncation).
- **D3 "caught by E5".** G records D3 as caught in-run by E5's diagonalization. A (F2) shows the final report re-inverted the direction: it attributes to Förster mixing a suppression that really comes from the pulse shape, and it states that "the closed-form 'lower bound' reading was wrong" while drawing the wrong-sign conclusion. **A is right.** The magnitude of V was corrected, but the direction of its consequence in the final report is still wrong, so D3 is only half-caught.
- **D10 vs F10.** G counts plan n≈55–65 as a wrong premise; A says the correction to 75 is not warranted. **Both are partly right.** For a vacuum wavelength of exactly 297.000 nm, n=75.3 is correct arithmetic. But "297 nm" does not pin n: the air-wavelength reading gives 62.5, inside the plan's range. A's point also supports G's own D6 (n is a tuning choice), so G is internally inconsistent in calling the 55–65 premise "wrong".
- **Minor error in G.** In its M2 note, G says the refuting diagonalization "is never surfaced". The report does cite "56× in a full pair-Hamiltonian diagonalization at n=50" (report.tex:40), yet still asserts 10⁶ and pure sin⁴. D4 stands; only the "never surfaced" wording is wrong.

## 4. Counts

- **Recall, all research defects (D1–D10):** 4 FOUND + 1 PARTIAL + 5 MISSED. That is 4/10 strict, or 4.5/10 with half credit for PARTIAL.
- **Recall, defects that reached the report (D1–D8):** 4 FOUND (D1, D2, D4, D7) + 1 PARTIAL (D3) of 8. That is 4/8 strict, or 4.5/8 with half credit. D5, D6 and D8 were missed.
- **Unmatched A findings:** NEW-TRUE 5 (F6, F9, F10, F11, F12), FALSE 0, UNVERIFIABLE 2 (F7, F8; F7 = G's own unscored suspicion).
- **BREAKS findings that are real:** 4/4 (F1, F2, F3, F4).

## 5. Summary

A found every headline-changing defect (D1/D2 flip, D4 sin⁴, D7 power-cheap), and its reproductions are sharper than G's: it used the exact pair block, and it shows the Förster "suppression" really comes from the pulse shape. All 4 of its BREAKS are real and none of its findings is false.
It missed the provenance and consistency class: D5 (circular Numerov anchor), D6 (ill-posed sole caveat), D8 (99.89 vs 99.909 and the sign flips), plus the latent D9. Its D3 coverage misses the n¹¹ extrapolation itself.
Its 5 NEW-TRUE extras are all minor (Doppler double-count, the linewidth condition missing from the abstract, air vs vacuum n, the undisclosed 24% diagonalization gap, theory-vs-measured baselines). F7/F8 are plausible but unverifiable, and F9 is over-ranked.
