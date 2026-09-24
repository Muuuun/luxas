# Adversarial audit: yttrium-tweezer-20260905

Project: `luxas:/Users/muqiao/Documents/sisyphus-projects/yttrium-tweezer-20260905/project`
All line numbers are for `report/report.tex` unless another file is named. "E1…E5" means `data/experiments/E*_…/runs/run_1/`.

## Headline claims

1. **Laser count.** A Y MOT closes with 2 lasers (414.3 nm J→J cycle, "fully closed"), 2–3 lasers (407.7 nm type-I cycle, the third an IR repump for a "≈15 % IR leak"), or 4 lasers (546.6 nm metastable cycle). The full apparatus needs **four distinct lasers** (abstract l.36–46; §4 l.255–259).
2. **Trap.** A 1064 nm tweezer gives **14.4 mK/W** (lower bound; 23.6 mK/W completeness-scaled) with a **199 ms scattering-limited lifetime at 1 mK**. 532 nm is rejected because its lifetime "collapses" to 41.8 ms (l.50–53, l.215–224).
3. **No magic condition.** No state-insensitive wavelength or ellipticity exists between 350 and 1600 nm (l.53–55; QC table row "magic trap condition: no").
4. **Imaging.** Imaging on 407.7 nm scatters ≈752 photons and detects ≈21, giving **0.9999 detection fidelity** and **0.9998–1.0000 survival** in 200 µs at 5 mK depth, provided the 15 % IR leak is repumped (l.55–60, l.264–270).
5. **No narrow line.** Yttrium has no narrow-line option: every reachable upper state has τ = 4.6–22 ns (l.240–246).
6. **Cross-checks.** The closure ratios 1.0017 and 1.0048, and the 0.17 % / 0.48 % agreement between NIST and the measured lifetimes, validate the branching budget. Two headline quantities were "blind-replicated by independent routes" (l.451–460).
7. **QC verdict.** Yttrium has no quantum-computing advantage. It is "strictly dominated" on every performance row, including magic condition, omg/erasure manifold and Rydberg route (l.395–411, Table `tab:fom`).

## Findings (ranked)

### F1 — BREAKS — verified
**Claim:** "The 407.7 nm imaging pulse at saturation s=0.5, detuning −38 MHz (−1.50 Γ), and 200 µs exposure in a 5 mK-deep tweezer scatters ≈752 photons, of which ≈21 reach the detector … a single-shot 0-vs-1 detection fidelity of 0.9999" (l.266–270).

**What is wrong:** These photon numbers are for a free atom. The scattering rate ignores the trap's differential light shift of the imaging transition, and by the run's own polarizabilities that shift is about 5 Γ.

**Evidence:**
- `E3/compose.py` grid loop: `r_sc_mhz = np.pi*gamma_MHz*s/(1+s+(2*det/gamma_MHz)**2)`. The detuning is the free-space detuning.
- The trap enters only through `U_eff` in `recoil_heating.py`, which affects survival, not the scattering rate.
- The same file sets `U0_uK = 5000` and `alpha_e_over_alpha_g = (118.3-150.5)/118.3 = -0.272` (compose.py:82–86).

**Recomputation:**
- At the trap bottom the transition is blue-shifted by (1 − α_e/α_g)·U0/h = 1.272 × 5 mK × 20.84 MHz/mK = **132.5 MHz**.
- Effective detuning = −38 − 132.5 = −170.5 MHz, so (2δ/Γ)² = (2·170.5/25.26)² = 182.
- R = π·25.26 MHz·0.5/(1.5 + 182) = 2.16×10⁵ s⁻¹. That gives **≈43 photons in 200 µs, not 752 (17× fewer)**.
- Detected photons: 43 × 0.0281 (NA 0.5 × QE 0.6 × T 0.7) ≈ **1.2 detected**, against a background of 0.2. Fidelity at that level is roughly 0.7, not 0.9999.

A re-tuned (blue-shifted) probe might recover the count. It would then face a thermal spread of the light shift of ≈26 MHz per mK of atom energy, which is about Γ. Neither case was computed. The fidelity and survival headlines are therefore unsupported for the stated operating point.

### F2 — BREAKS — likely
**Claim:** "no state-insensitive (magic) wavelength or ellipticity is found between 350 and 1600 nm in a sum-over-states over the tabulated transitions" (l.53–55). QC table: "magic trap condition: no" (l.385). The verdict repeats "whereas Rb, Yb, Sr and Dy all have one" (l.401–403).

**What is wrong, part (a):** The run's own model contains α_e = α_g crossings, and a filter deleted them.
- Sign changes of α_s(y²F°5/2) − α_s(²D3/2) in `E2/data/polarizability_{ground,excited}.csv` occur at ≈356.x, 412.x, 460.5 and 611.6 nm.
- For the 414.3 nm transition they occur at ≈461.0 and 612.5 nm.
- All were removed by `_far_from_resonance(tol=5 nm)` over all 361 lines, including lines with no A-value (`E2/compose.py:179–198`).
- These particular roots sit where α_g < 0 (for example −45 a₀³ near 611.6 nm), so they are anti-trapping. Still, "none found" is not what the code computed.

**What is wrong, part (b):** Trapping magic wavelengths almost certainly exist in the window.
- The excited-state polarizabilities include **only downward decays**: n_terms_used = 2 for y²F°5/2 (E2 results `excited_states`).
- y²F°5/2 (24518.75 cm⁻¹) has many even-parity partners inside the scanned window, taken from the run's own NIST level list:
  - 4d5s6s f²D₃/₂,₅/₂ at 36420/36431 cm⁻¹ → **840 nm** (a one-electron 5p→6s doublet transition, so strong).
  - e²D and e⁴P → 1027–1038 nm.
  - ²P₃/₂ → 1072.5 nm.
  - e⁴D → 1083, 1124 and 1147 nm.
  - b⁴P and ²D → 1204–1321 nm.
- α_e runs from −∞ to +∞ across each such pole. Meanwhile α_g is smooth there and ≈ +110–150 a₀³ (trapping; 118 a₀³ at 1064 nm).
- So α_e = α_g must cross near every one of these lines. Because these are excited-state resonances, ground-state scattering is not enhanced at those crossings. This is the same mechanism behind excited-state magic wavelengths in Sr and Cs.

**Consequence:** The report labels the result "indicative", but it is structurally biased toward "no". The abstract's scan claim is wrong in sign, and the QC-table "no" is presented as fact.

### F3 — BREAKS — verified
**Claim:** The type-I cycle "closes only to 0.8505 … ≈15 % of the total decay rate leaves through unmeasured infrared branches" (l.190–192). The imaging stage is conditional on "repumping the one **measured-and-quantified** leak" (l.349). By contrast, the 414.3 nm cycle "closes to 1.0017 … fully closed with two wavelengths" (l.183–185).

**What is wrong:** The 15 % is not an observed leak. It is the flat *assumed* IR correction, (15 ± 15) %, that Hannaford et al. applied when normalising their visible branching fractions. The asymmetry between the two cycles is bookkeeping, not physics.

**Evidence:**
- `notes/literature.d/Hannaford1982a.md` l.5 and l.22: "a flat ~15% (±15%) correction is applied for unmeasured infrared (>9000 Å) branches". The report itself says this at l.320–321.
- The NIST A-values are exactly Hannaford's BF/τ:
  - A(407.7) = 0.70/6.3 ns = 1.111×10⁸ s⁻¹; the dataset has 1.11e8, grade C+.
  - A(416.75) = 0.151/6.3 ns = 2.4×10⁷ s⁻¹; the dataset has 2.4e7, grade **C**.
  - The branches sum to 0.70 + 0.151 = 0.851. That sum *is* the "closure ratio".
- The E1 anchor quotes a 407.7 branch of "70(12) %" and NIST grades C+/C (≤18 % / ≤25 %). The "leak" is therefore not distinguishable from zero, or from 30 %.
- The 414.3 nm upper state y²D°3/2 has 11 unmeasured IR channels listed in `E1/data/budgets.json` "missing_channels" (a⁴P, a²F, b²D, a²P, ²S). Its closure of 1.0017 only means no correction was applied to it. The Hannaford literature note even lists y²D°3/2 among the corrected levels, which conflicts with its closure of 1.0017.

**Consequence:** "2 lasers, fully closed" (414.3) versus "2–3 lasers, 15 % leak" (407.7) is not established. Neither is the "≈7 photons without repump" statement.

### F4 — BREAKS — likely (conditional on the leak being real)
**Claim:** "the MOT+tweezer+imaging apparatus needs four distinct lasers (407.7 nm cooling/imaging, 423.6 nm repump, the infrared repump, and 1064 nm trap)" (l.256–259, abstract l.46–47).

**What is wrong:** If the 15 % IR leak exists, one "infrared repump" cannot close it.
- E1 and E4 give the destination as "b2D/a2D/a2P" (`E4 results laser_inventory`). But a²D is the *ground term*, so that label is wrong.
- The allowed E1 destinations of y²F°5/2 (J=5/2, odd) with λ > 900 nm are the even-parity J = 3/2–7/2 levels between 13,400 and 24,519 cm⁻¹. That gives about 8 distinct levels:
  - a⁴P₃/₂,₅/₂ → 1088 and 1106 nm
  - a²F₅/₂,₇/₂ → 1088 and 1155 nm
  - b²D₃/₂,₅/₂ → 1173 and 1196 nm
  - a²G₇/₂ → 1665 nm
  - a²P₃/₂ → 1956 nm
- Each populated level needs its own repump frequency. Several are hundreds of cm⁻¹ apart, so sidebands cannot cover them.

**Consequence:** Under F3, the count is either 3 (no leak) or substantially more than 4 (leak real). "Four" does not follow in either case.

### F5 — BREAKS (for the narrow-line elimination) — verified
**Claim:** "No narrow-line (kHz-class) transition exists … every tabulated state reachable from ²D3/2 or ⁴F has a lifetime of 4.6–22 ns, i.e. a linewidth of 7–40 MHz. This rules out the narrow-line imaging strategy" (l.240–246). E4 adds: "Y has NO intercombination line".

**What is wrong:** The run's own inputs contradict this.
- `notes/literature.d/Hannaford1982a.md` l.11/l.17 gives z²D° levels at 16066/16146 cm⁻¹ with τ = 185(10)/175(10) ns.
- The NIST dataset in E1 has ²D3/2 → z²D°3/2 at **619.17 nm, A = 4.6×10⁶ s⁻¹** (C+). Its only other listed decay is 640.2 nm to ²D5/2 with A = 2.7×10⁵ s⁻¹.
- The same dataset lists ground-state intercombination lines to z⁴F° (655.7–693.4 nm) and z⁴D° (602.3 nm), all with A-values missing.

**Recomputation for the 619 nm line:**
- Γ/2π ≈ 4.9×10⁶/2π ≈ 0.78–0.86 MHz, about 30× narrower than 407.7 nm.
- T_D = hΓ/2π/(2k_B) ≈ 19 µK.
- 94 % of decays return to ²D3/2; the ²D5/2 branch can be repumped with the existing 423.6 nm light.

That is the same class as Yb 556 nm (182 kHz) and Er 583 nm (186 kHz), which the report cites as the strategy Y "cannot" use. The broad-line versus narrow-line choice was never actually evaluated.

### F6 — WEAKENS — verified
**Claim:** "a 199 ms scattering-limited lifetime at 1 mK". At 532 nm "the scattering-limited lifetime collapses to 41.8 ms" (l.51–53, l.219–221). The requirement bar is ">100 ms" (Table `tab:bar`).

**What is wrong:** 199 ms is 1/R_sc, the time to scatter *one* trap photon. It is not a trap lifetime.
- E2 `trap_design.1064nm`: scattering_rate_at_1mK = 5.03 s⁻¹ and scattering_lifetime = 0.1988 s = 1/5.03.

**Recomputation:**
- Recoil at 1064 nm: E_r = 0.647 µK × (407.7/1064)² = 0.095 µK.
- Heating is about 5 s⁻¹ × ~0.2 µK ≈ 1 µK/s, so heating-limited loss from a 1 mK trap takes ~10³ s.
- The 532 nm rejection criterion is therefore misframed. The 1064 nm choice probably survives on other grounds, since 532 nm has near-resonant lines. But the headline "lifetime" number is mislabelled by about 10³–10⁴. It is really a Raman/decoherence rate, which matters for QC rather than for trap loss.

### F7 — WEAKENS — verified
**Claim:** "The total decay rates additionally cross-check the NIST compilation against measured lifetimes, agreeing to 0.17 % (y²D) and 0.48 % (z⁴G), and the 414.3 nm branching ratio reproduces Hannaford et al.'s measured 84.1 %" (l.457–460). Also "Two headline quantities were blind-replicated by independent routes" (l.451–456).

**What is wrong:** The cross-checks are circular or trivial.

**Evidence for circularity:** the NIST A-values are Hannaford's BF divided by Hannaford's τ.
- 0.841/5.3 ns = 1.587×10⁸ (NIST 1.59e8).
- 0.159/5.3 ns = 3.0×10⁷ (NIST 3.0e7).
- 1.00/15.7 ns = 6.37×10⁷ (NIST 6.4e7), and 6.4e7 × 15.7 ns = **1.0048**.
- So the "agreement" is rounding error in an identity.

**The "independent" replications:**
- Survival by Monte Carlo versus analytic energy balance agrees at 0.02 %. Both give ≈1.000, which is uninformative, and neither includes the F1 light shift.
- The harmonic formula versus a numerical Hessian differentiates the *same* Gaussian potential. That check tests arithmetic, not physics.

### F8 — WEAKENS — likely
**Claim:** "its 4d²5s metastable manifold is thermally empty at oven temperature, so it offers no omg/erasure state" (l.404–407). The table gives Y "no" and Dy "yes".

**What is wrong:** The criterion is wrong and is applied inconsistently.
- Thermal population is irrelevant: Yb ³P₀ and Sr ³P₀ are also thermally empty, and they are prepared optically.
- Y has two metastable options:
  - The ²D5/2 fine-structure level (530 cm⁻¹, same parity as the ground state, so only M1/E2 decay).
  - The even-parity a⁴F manifold, where E1 decay to the ground term is parity-forbidden and which the run itself uses as a cooling lower state.
- `E5/compose.py` gives Dy "True" with source "omg/erasure not demonstrated for Dy", but gives Y "False" citing "no clock/erasure state demonstrated". That is a double standard.

**Consequence:** "strictly dominated on every performance row" is not supported for this row. The overall negative verdict probably survives, since the Rydberg row is still genuinely uncharacterised.

### F9 — MINOR — likely (from general literature knowledge; not checked against the run's files)
**Claim:** "whether the F=J±1/2 hyperfine sidebands require a physically separate laser … is unresolved because the Y I hyperfine A-constants are unmeasured" (l.47–50, l.134–138).

**What is wrong:** The ⁸⁹Y ground-term constants were measured long ago by atomic-beam magnetic resonance: A(a²D3/2) ≈ −57.2 MHz and A(a²D5/2) ≈ −28.7 MHz. The ground F=1–2 splitting is ≈114 MHz, which AOMs and EOMs handle easily. The "±1 on each laser count" therefore resolves to the lower count. The claim that the constants are unmeasured is itself a missed-literature error.

### F10 — MINOR — verified
- **Dy column:** It uses "¹⁶²Dy (I=0, 0.139 % abundance)" and "enrichment: yes" (l.391; `E5/compose.py`). ¹⁶²Dy's natural abundance is ≈25.5 %, and it is not enriched in the cited experiments.
- **Tensor polarizability:** The QC table's "48 a₀³" is the **532 nm** value (E2 `at_wavelength.532nm.alpha_t = 48.239`), but the chosen trap is 1064 nm, where α_t = 35.0. Separately, l.218's "≈29–48 a₀³ over 532–1064 nm" mixes in the static value (28.9); the 1064 nm value is 35.0.
- **Fidelity error bar:** "0.9999 ± 0.005" (abstract) is an interval that crosses 1. The error bar is not meaningful as stated.
- **Scalar magic filter:** The filter treats a proximity of 5 nm to *any* line, including lines with no A-value, as "near resonance" (see F2a).

## Not checked
I did not check: E2b (the descoped ab initio code), the figures, the E4 loading-path/capture-rate numbers, the 546.6 nm metastable ladder beyond a glance (including the 318.6 nm pump's losses to other even levels), photoionization rates (only thresholds), the reviews/ and directives/ files, or the ⁸⁹Y⁺ column against Gilbreth2026.
