# Adversarial audit: ba-neutral-atom-qc-20260829

Project: `ssh luxas:/Users/muqiao/Documents/sisyphus-projects/ba-neutral-atom-qc-20260829/project`
All paths below are relative to that directory. Scratch computations: `/tmp/audit-ba-qc/` on the server (nothing in the project was modified).

## Headline claims

1. **H1 (lifetime).** Ba 6sng ¹G₄ radiative lifetime at n=60 is 0.303–0.371 ms ("upper bound"; σ=0.034 ms), 19–24× below Shi2025's 7.1 ms. Two "independent" routes: exact-hydrogenic, and QD-corrected Numerov with δ(¹F₃)=0.048±0.005 (report.tex:30-33, 134-144).
2. **H2 (BBR equalizes).** At 300 K, τ_BBR(n=60)=0.239 ms and τ_eff=0.143 ms, so Ba is only ~1.5× Rb 60S (99.4 µs) and has no edge over Sr (report.tex:164-173).
3. **H3 (2 W decay edge).** At a 2 W drive, Ba's decay-limited infidelity is below all four references at every n=40–100 and both temperatures; Ba/Sr = 0.756 at n=100, 4 K (report.tex:37-38, 190-197).
4. **H4 (equal-power flip).** At 20 mW the Ba two-photon Rabi is 5.78±0.12 MHz at n=100 (n*^-3/2 scaling), and the Ba/Sr decay ratio inverts to 7.56 (band [7.6, 29]) (report.tex:39-41, 199-209).
5. **H5 (total-error edge survives via blockade).** At 20 mW Ba's total error is 3.0×10⁻⁵, so Ba stays ~3.4× better than Sr in total (ratio 0.297). The edge is blockade-mediated and C₆-band-sensitive (report.tex:41-43, 211-216, 241-246).
6. **H6 (Ba is blockade-limited).** At the winning point blockade leakage is 7.3× the decay term, so "barium is blockade-limited, not decay-limited". The 2 W total is 2.49×10⁻⁵ (Shi C₆), and with the second-order C₆ it is 9.63×10⁻⁵, about equal to Rb/Cs (report.tex:217-221, 242-244, 264-266).
7. **H7 (recommendation).** ¹³⁸Ba (I=0) with the ¹S₀↔¹D₂ E2 qubit is "a sound, power-conditional platform choice… competitive" (report.tex:43-44, 254-271).
8. **H8 (cross-validation).** The binding quantities were blind-estimated and "replicated by a distinct route" (report.tex:277-284).

## Findings (ranked)

### F1: At 20 mW the total-error "Ba ~3.4× better than Sr" comes from a stale, n-inconsistent Rabi. With the corrected Rabi, Ba is at parity with or worse than every reference.
- **severity:** BREAKS · **confidence:** verified
- **claim:** "The total decay-plus-blockade error nonetheless keeps Ba ∼3× better than Sr, a blockade-mediated edge" (tex:41-43); "its total error ($3.0\times10^{-5}$) … barium remains ∼3.4× better than strontium in total (ratio 0.297)" (tex:213-215).
- **what is wrong:** E8 fixed the n-scaling error in the *decay* ratio: the Ba Rabi at n=100 is 5.78 MHz, not the n=53 value of 15 MHz, which took the ratio from 2.92 to 7.56. The *total*-error leaf was never recomputed. `E7…/runs/run_1/results.json` key_leaves: `eps_total_ba_n100_4K_hydro_20mW_shi = 3.018e-5` and `ratio_total_ba_vs_sr_20mW_shi = 0.2969`. Both come from Ω=15 MHz (`power_matched_frontier.csv` row `0.02,15.0,…,eps_total_hydro=3.018e-5`). The report puts the corrected decay ratio (5.78 MHz) next to the uncorrected total (15 MHz) in the same paragraph. Once n-consistent, the 20 mW total is decay-dominated and C₆-independent, so the "blockade-mediated edge pending the C₆ band" story disappears.
- **recomputation** (Pagano ε_d=(3π/2)/(2π·Ω·τ), ε_b=(Ω/U)², U_Ba(n=100, R=5 µm, Shi C₆) = 213.6×150 MHz = 32 042 MHz; references from `E6…/frontier_4K.csv` n=100):
  - Ba, Ω=5.7835 MHz: ε_d = 7.77e-5 (hydro τ=1668.8 µs) / 9.48e-5 (qd τ=1368.3 µs); ε_b = 3.3e-8. So ε_tot ≈ 7.77e-5 to 9.48e-5.
  - Sr total 1.017e-4 → Ba/Sr = **0.76–0.93** (the report says 0.297). Rb total 8.15e-5 → Ba/Rb = **0.95–1.16**. Cs total 8.29e-5 → Ba/Cs = **0.94–1.14**.
  - Sr's blockade term (9.1e-5) dominates only because Sr is held at Ω=38 MHz. Re-optimizing Sr's Rabi at the same R=5 µm (minimize a/Ω + Ω²/U², with a=3.91e-4 MHz and U=3985 MHz) gives Ω*=14.6 MHz and ε_Sr = **4.0e-5**. That is 1.9–2.4× *better* than Ba at equal power. See also F4.

### F2: "Barium is blockade-limited, not decay-limited" and the 2 W total-error numbers use an unscaled 150 MHz Rabi at n=100
- **severity:** BREAKS (for the stated dominant limitation and the C₆-sensitivity narrative) · **confidence:** verified
- **claims:** "The dominant error at the winning point is blockade leakage, which exceeds the decay term by 7.3×—barium is blockade-limited, not decay-limited" (tex:220-221, repeated in the Recommendation at tex:264-266). "with the primary C₆ … total error is $2.49\times10^{-5}$ … with the independent second-order sum … $9.63\times10^{-5}$ … comparable to, or slightly worse than, rubidium and cesium" (tex:217-220, 242-244, "1.18× and 1.16×").
- **what is wrong:** `E6…/scripts/gate_infidelity_frontier.py:99` hard-codes `BA_OMEGA_2PI_MHZ = 150.0  # n-independent`. So every E6 frontier row, the 7.3× ratio, the 2.49e-5 and 9.63e-5 totals, and the whole Fig. 3 "Ba total" curve (`figspec` series `Ba_qd_eps_total_shi` from `frontier_4K.csv`) use 150 MHz at n=100. The report's own H3 sentence uses the n-scaled 57.8 MHz at 2 W, n=100 (tex:195), and its 0.756 comes from 57.8 MHz (2.996e-6×150/57.8/1.0276e-5 = 0.757). The two halves of §4 therefore use Rabi frequencies 2.6× apart.
- **recomputation** at 2 W, n=100, Ω=57.835 MHz:
  - ε_d = 7.77e-6 (hydro) / 9.48e-6 (qd); ε_b(Shi C₆) = 3.26e-6. **Decay exceeds blockade by 2.4–2.9×**, so Ba is decay-limited (the report says blockade is 7.3× decay).
  - Total = 1.10–1.27e-5 (Shi C₆) or 2.16–2.33e-5 (second-order C₆).
  - Ba/Rb total = 0.14–0.16 (Shi) or **0.27–0.29 (second-order)**, not 1.18. The C₆ band does not flip the 2 W ranking.
  - Consequence: the report's claim that the verdict hinges on "the unresolved Ba C₆ band" (abstract, §5, §6) is an artifact at both powers.

### F3: The model omits intermediate-state (5d6p ¹F₃ᵒ) scattering, which the run's own numbers show dominates every compared term. The "Rabi-driven edge" is unphysical.
- **severity:** BREAKS (H3, H5, H7 as fidelity statements) · **confidence:** likely
- **claims:** "The fidelity edge that remains is Rabi-driven" (tex:36-37); "Barium remains a sound, power-conditional platform choice" (tex:43); "decay-limited infidelity sits below all four references" (tex:37-38).
- **what is wrong:** The run's own code confirms the physics. `E4…/scripts/rydberg_rabi.py:178-215` has Ω_df=30 GHz and Δ_f=100·Ω_fg=20 GHz, which gives ρ_ii=(Ω_df/2Δ)²=0.5625. E7 key_leaves `rho_ii_anchor=0.5625`, and experiments.md:454 says "the intermediate is never far-detuned … carries an omitted intermediate-scattering penalty (Γ_sc = γ_f·ρ_ii)". The penalty was never computed or added to ε_tot, and the report never mentions it. The comparison is also unmatched: Sr and Yb are single-photon with no intermediate state, while Ba (and Rb/Cs, modeled as a bare upper-leg Rabi from 5P₃/₂) get scattering-free two-photon Rabis. Under the chosen scenario S_C (ρ_ii held at 0.5625), the scattering per gate grows ∝ 1/Ω, so the equal-power case makes it 26× worse again.
- **recomputation/estimates:**
  - (a) Shi2025's own figure (notes/literature.d/Shi2025.md:14) is a scattering error of about 3×10⁻⁴ at the 150 MHz point. That is already 10–100× larger than Ba's ε_tot in the report (2.5×10⁻⁵ to 3×10⁻⁵). Scaled to 5.78 MHz under S_C it becomes ≈7.8×10⁻³, which is ~80–190× Sr's total.
  - (b) With the run's own ρ_ii=0.5625 and its 17 ns lifetime proxy (experiments.md:467): Γ_sc ≈ 3.3×10⁷ s⁻¹, and Γ_sc·2π/Ω ≈ 0.22 at 150 MHz and ≈5.7 at 5.78 MHz. That means the operating point cannot support a gate at all as parametrized.
  - Either way the missing term is larger than every term compared, and it turns the Ba-vs-Sr/Yb ranking against Ba at both powers. (Labeled "likely": the exact prefactor depends on Shi's convention, which I did not read from the PDF.)

### F4: The total-error comparison is not matched. References sit at fixed, un-optimized Rabis at a fixed R=5 µm, and reference Rabis are inconsistent between scripts.
- **severity:** WEAKENS · **confidence:** verified
- **claim:** "strontium's own blockade term ($9.1\times10^{-5}$ at its 38 MHz Rabi) dominates" (tex:215-216).
- **evidence:**
  - Sr's Ω=38.09 MHz at n=100 is an ARC single-photon value at 20 mW with a 12 µm waist (`E4…/reference_c6_rabi_vs_n.csv`). Ba uses a 10 µm waist (`rydberg_rabi.py:184`), a 1.2× Rabi advantage built into "equal power".
  - E6 itself credits Ba with a "smaller-R mitigation" (experiments.md:385) but never gives Sr the same. As shown in F1, lowering Sr's Ω gives 4.0e-5, not 1.02e-4.
  - Reference Rabis differ between scripts: E7 `power_matched_frontier.py:255` uses Cs 6.0 and Yb 7.0 MHz; E4/E6 use Cs 10.14 and Yb 1.07 MHz at n=100.
  - Rb's "20 MHz" (tex:195) is ARC's 5P₃/₂→60S single-leg Rabi (the atom is assumed to already sit in 5P₃/₂), not a two-photon effective Rabi. Evered's actual value is 4.6 MHz (literature.md:115).

### F5: The isotope-selection criterion would reject the established I≠0 platforms. The "prohibitive hyperfine" rationale is wrong.
- **severity:** WEAKENS (the rationale fails; the choice of ¹³⁸Ba may survive for other reasons) · **confidence:** likely
- **claim:** "the odd isotopes carry prohibitive hyperfine structure on the cooling lines (¹³⁷Ba ³P₁ splitting 4641.2 MHz, 39 222× the 118.33 kHz natural linewidth)" (tex:106-108, 255-257).
- **what is wrong:** A large hyperfine-to-linewidth ratio is routinely handled in narrow-line MOTs (for example with a stirring beam). ⁸⁷Sr ³P₁ has a hyperfine span of about 2.5 GHz against a 7.5 kHz linewidth, a ratio of about 3×10⁵, roughly 10× worse than ¹³⁷Ba. ¹⁷¹Yb and ⁸⁷Sr are exactly the nuclear-spin qubit platforms the report benchmarks against (Muniz2024, Lis2023, Ma2022/2023). The E1 acceptance test (`hfs_to_linewidth_ratio >= 1e3` → reject, experiments.md:17-22) would exclude both. The report itself concedes that choosing I=0 forecloses the ground-state nuclear-spin qubit and the hyperfine-mixed clock qubit (tex:257-259), but the ¹³⁵Ba/¹³⁷Ba (I=3/2) nuclear-spin/omg option required by RESEARCH.md deliverable 2 was dismissed on this faulty criterion. (Literature values from memory, not from run files. Hence "likely".)

### F6: The lifetime "bracket" is a δ_F sensitivity sweep of a single single-electron model, not two independent routes. The attribution to Shi's method is untested.
- **severity:** WEAKENS · **confidence:** verified (independence); hypothesis (direction of the missing physics)
- **claims:** "two independent single-electron routes bracket the radiative lifetime at [0.303, 0.371] ms (upper bound)… σ=0.034 ms" (tex:72-73, 135-140); "the quasiclassical matrix elements of [Shi2025] under-count" (tex:74-75).
- **evidence:**
  - E5's cross-validation is literally "exact-hydrogenic limit δ_F→0 reproduces E3" (`E5…/results.json` cross_validation[0]). The two ends are one model at δ_F=0 and δ_F=0.048, so σ=0.034 is sensitivity to δ_F, not model uncertainty.
  - The run's own ledger says the crux channel is "captured by neither the hydrogenic nor the Kaulakys-quasiclassical model" (experiments.md:181). It also says "Shi2025's 7.1 ms was not reproduced by their own quasiclassical method here" (experiments.md:340) and calls it "a model-class disagreement, not a proven refutation" (experiments.md:211). The report's causal statement that Shi's matrix elements under-count is therefore an unverified hypothesis.
  - The report also calls 0.371 ms an "upper bound", but a two-electron effect such as diluted 6sn′f character in perturbed low-n′ ¹F₃ levels would *lengthen* the lifetime, so it is not a bound. RESEARCH.md also required validation against a published *Ba* Rydberg lifetime; none was done.
- **independent estimate:** A hydrogenic n=60, ℓ=4 state has τ ≈ 0.093 ns·n³(ℓ+½)² ≈ 0.093 ns × 216 000 × 20.25 ≈ 0.41 ms. So the 0.37 ms end is right for a single-electron picture, and the conclusion "7.1 ms is implausible for a near-hydrogenic g state" probably survives. What is not established is the specific mechanism and the tight σ. The measured low-n ¹F₃ energies (n′=4–7: δ=0.122, −0.055, 0.099, 0.137 from `E5…/results.json` qd_1F3_per_level_defects) are near-hydrogenic, which argues against 4f collapse. They were still not used for the channels that carry ~66% of the rate: the model applies the high-n δ=0.048 to n′=4–8. See the addendum for the per-level recomputation.

### F7: Shi2025's 300 K number is never confronted. The BBR "equalization" contradicts Shi's own 1.3 ms at 300 K, and that is not discussed.
- **severity:** MINOR · **confidence:** verified (the omission), likely (the physics)
- **claim:** "Blackbody radiation … species-independent to leading order … τ_BBR=0.239 ms" (tex:165-168).
- **evidence and recomputation:** Shi reports 1.3 ms at 300 K at n=60 (literature.d/Shi2025.md:6). Together with 7.1 ms radiative, that implies τ_BBR ≈ 1.6 ms. The generic rate 4α³kT/(3n²) at n=60, 300 K is 5.7×10³ s⁻¹, so τ_BBR ≈ 0.18 ms. That supports the run's 0.18–0.24 ms band and suggests Shi's BBR is also ~7× too slow. The report attacks only the radiative number and misses a second, independent discrepancy that would strengthen its point.

### F8: The "blind replication" of the 7.56 equal-power ratio is the same arithmetic on the same inputs
- **severity:** MINOR · **confidence:** verified
- **claim:** "the equal-power decay ratio by an adiabatic-elimination re-derivation (blind 7.56±1.5)" (tex:282-283).
- **evidence:** `E8…/replication/ba_decay_ratio_vs_sr.py` hard-codes Ω_Ba(53)=15, Ω_Sr=38.091, τ_Sr=1916.1 and τ_Ba=1668.8, then computes (Ω_Sr·τ_Sr)/(Ω_Ba·(53/100)^1.5·τ_Ba). This is the same formula, inputs and scaling as production. It checks transcription, not the physics (the 15 MHz S_C scenario, the 200 MHz Shi anchor, and the omission of scattering).

### F9: The quoted uncertainties on the equal-power Rabi and ratio are understated or one-sided
- **severity:** MINOR · **confidence:** verified
- **claim:** "the two-photon Rabi falls to $5.78\pm0.12$ MHz" (tex:39).
- **evidence:** Scenario spread S_A/S_C = 1.83–5.78 MHz at n=100 (tex:229-231), and the value rests on Shi2025's unmeasured 200 MHz f→g anchor (tex:290-292). The PI's own estimate was 5.8±2 (pi_feedback.md:207). ±0.12 (2%) captures only the n vs n* difference. Likewise, the 2 W Ba/Sr ratio 0.756 is the hydro (longest-τ) end; the qd end gives 0.92 (recomputed: 9.48e-6/1.0276e-5), and only 0.756 is quoted.

### F10: The "cross-validation" of the Pagano error model is a post-hoc fit of a 62% miss
- **severity:** MINOR · **confidence:** verified
- **claim:** "The Pagano form reproduces the measured ytterbium gate decay error (computed 5.36e-3 vs measured 3.3e-3; the ratio 1.62=2π/3.86 is exactly the square-pulse versus optimized-pulse prefactor)" (tex:110-115).
- **what is wrong:** The model misses by 1.62×, and the gap is attributed after the fact to a pulse-shape prefactor. Species ratios cancel this prefactor, so it cannot validate the ratios. It also cannot validate absolute values such as 2.49e-5 or 3.0e-5, which the report quotes as absolutes.

### F11: The run's own model, fed the measured low-n ¹F₃ energies, gives a lifetime outside the stated bracket
- **severity:** WEAKENS · **confidence:** verified (the run's own code, rerun read-only)
- **claim:** "bracket the lifetime at [0.303, 0.371] ms (midpoint 0.337 ms, σ=0.034 ms)" (tex:139-140).
- **recomputation:** I imported `E5…/scripts/ba_1G4_qd_lifetime.py` `_compute_one_n(60, δ_F, δ_G=0.054164)` from `/tmp/audit-ba-qc`. Starting from the production baseline (δ_F=0.048, τ=0.3029 ms), I replaced the n′=4–7 channel rates with rates computed at each level's measured defect (0.1224, −0.0546, 0.0986, 0.137; from `results.json` qd_1F3_per_level_defects). Result: **τ_rad(n=60) = 0.267 ms**. That is 12% below the bracket's lower end, or 2σ by the report's own σ. The conclusion that 7.1 ms is not supported only gets stronger. But the quoted band and σ do not contain the run's own best single-electron input, and the "upper bound" framing plus the σ=0.034 are not a real uncertainty.

**Not checked:** C₆ second-order sum internals (radial matrix elements, the angular D-factors, the n^11 extrapolation to n=100 near the Förster resonance where vdW scaling may fail), the reference lifetimes (ARC/pairinteraction for Rb/Cs/Sr/Yb) beyond order of magnitude, the level-diagram figure, perturbations of 6sng by 5dn′l (5d7d-type) doubly-excited states, and Shi2025's PDF (not read, per instructions).
