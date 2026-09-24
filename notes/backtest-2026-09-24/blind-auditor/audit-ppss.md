# Adversarial audit: pp-vs-ss-gate-packing-20260826

Project: `ssh luxas:/Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project` (P below)
Scratch work: `/tmp/audit-ppss/` on the server (`pd.py` = copy of the E6 optimizer, `diag2.py`, `gen2.py`).

## Headline claims

1. **H1**: Orienting P–P gate pairs at the C6 zero θ*=24.65° with an R=2.0 µm gate gives a **1.98× packing-density gain** over S–S (1.95–2.11× for R∈[1.5,2.2] µm). (abstract, report.tex:22, :119–121, :133)
2. **H2**: At θ* the leading C6 vanishes, so the interaction is the C5/C8 quadrupole floor, **V(2 µm) = −2.887 MHz**, and a weak-blockade interaction gate reaches **F = 0.9967** (R=2.0 µm, Ω=160 MHz). (:99–107)
3. **H3**: There is a genuine total C6 zero at **θ*=24.65°** (±0.35°), confirmed by full diagonalization with min|C6| = 0.007 GHz µm⁶. (:22, :85)
4. **H4**: Strong blockade caps the gain at **≈1.35×** (sixth-root law); only the C6-zero interaction gate "breaks the cap". (:22, :61–68, :116, :133)
5. **H5**: Physical P–P anisotropy is ≈26–29× (C6(0°) = −10.41, C6(90°) = 268–299 GHz µm⁶), not ~10⁶×. (:54–56)
6. **H6**: C6(54.7°) = +126.3; the magic angle is a channel zero, not a total zero. (:85)

## Findings (ranked)

### F1: BREAKS (verified). At the gate distance R = 2 µm the "C6 zero" does not exist. The real target-state shift is about +158 MHz, not −2.9 MHz.
- **Affected claim**: "At $\theta^*$ the leading $C_6$ vanishes and the interaction floor is set by the quadrupole terms … At $R=2.0$~\um\ this gives $V=-2.887$~MHz … A $\pi$-$\pi$-hold-$\pi$-$\pi$ interaction gate on this floor reaches fidelity 0.9967 at $R=2.0$~\um" (report.tex:99–105), and so the abstract's viability claim and H1.
- **What is wrong**: C6(θ) is a Zeeman-isolated, single-reference second-order coefficient. It is extracted from diagonalizations at R = 6–15 µm with a 5 MHz Zeeman offset (`E4.../tests/test_pair_dipole_diag.py:43`, `E7.../c6_discriminator_scan.py:57–58`). The cancellation at θ* holds only while the M-changing couplings are small compared with the Zeeman splitting. At 2 µm they are much larger, so the pair state mixes and the dipole–dipole shift returns at roughly the θ=0 magnitude. The gate code uses only `V = -C5/R^5 - C8/R^8` (`E5.../scripts/cz_gate_fidelity.py:284–286, 389`). It contains no C6 term, no pair-state mixing and no other M sublevels.
- **Evidence and recomputation**: I ran the run's own tool `E4.../scripts/pair_dipole_diag.py:compute` (Rb 60P3/2 m=3/2, n 58–62, l 0–3, 30 GHz window) at the gate distance:

  | θ | Zeeman | R=2.0 | 2.5 | 3.0 | 4.0 | 6.0 | 8.0 | 10.0 µm |
  |---|---|---|---|---|---|---|---|---|
  | 24.65° | 5 MHz | **+158.0 MHz** (overlap 0.75) | +39.0 | +12.4 | +1.96 | +0.081 | +0.001 | −0.001 |
  | 24.65° | 50 MHz | +150.6 MHz (overlap 0.85) | +35.2 | +10.4 | +0.93 | −0.079 | −0.021 | −0.006 |

  The apparent C6 = −ΔE·R⁶ at 2 µm is −10.1 GHz µm⁶, essentially the θ=0 value, not ≈0. So the intra-pair interaction at 2 µm is about 55× the modelled 2.887 MHz. The |3/2,3/2⟩ overlap is only 0.75, so the gate does not stay in a two-level-per-atom subspace. The simulated gate (F = 0.9967, t = 0.1855 µs, calibrated to a −2.887 MHz hold phase) models a Hamiltonian that does not exist at that geometry. A 150 MHz-scale interaction might still support some gate at 2 µm, but it would be an ordinary blockade gate. The report's mechanism ("C5/C8 floor at the C6 zero") and its fidelity number are not supported.

### F2: BREAKS (verified). The 1.98× gain and the "1.35× strong-blockade cap" come from unmatched gate lengths.
- **Affected claim**: "The mechanism is a shorter gate length plus anisotropic cross-talk: the gate length is $2.0$~\um\ vs.\ the S--S blockade radius $4.90$~\um\ (2.4$\times$ shorter)" (:119). Also "the 1.35$\times$ strong-blockade cap … only the weak-blockade $C_5/C_8$ interaction gate … recovers the remaining factor" (:133).
- **What is wrong**: The S–S baseline gate, and the strong-blockade P–P gate, sit exactly at R_b(Ω/2π = 10 MHz): 4.90 µm and 5.47 µm. That is the *largest* distance at which they blockade, not a required length. The report itself says S–S gates run at 2 µm with V/2π ≈ 450 MHz (Evered, :36). E4 also imposes the strong-blockade criterion "|C6(θ_gate)| ≥ |C6_SS|" at fixed length = R_b (`E4 results.json strong_blockade_max_gain_2d.observable`). But a blockade gate at 2 µm only needs C6/64 ≫ Ω. Even at θ=0 that is 10.41/64 = 163 MHz ≫ 10 MHz.
- **Recomputation** (E6's own optimizer `interaction_gate_packing_density.py`, v_ct = 10 kHz, same C6 inputs):
  - S–S baseline at gate length 4.90 µm: 0.007039 atoms/µm² (reproduces report).
  - S–S baseline at gate length **2.0 µm**: **0.008362**, giving P–P(θ*, 2 µm) gain = 0.013911/0.008362 = **1.66**, not 1.98. At 1.5 µm: 0.008643, giving 1.61.
  - P–P *strong-blockade* gate, 2 µm long, along 90°: 0.010724, gain **1.52** against the report's own S–S@4.9 baseline. That already exceeds the "1.35 cap" with no C6 zero involved. At θ=1° or 5° (blockade 163 MHz): 1.355.
  - I checked the S–S lattice-family restriction with a general random lattice search (2 atoms per cell, all inter-pair distances ≥ r_ct = 15.51 µm). It gives 0.00702 (d=4.9) and 0.00831 (d=2.0), so the S–S densities themselves are right. Only the gate-length choice is unfair.
  - At matched 2 µm gate length and the report's own (optimistic) cross-talk model, the ranking is: θ* gate 1.66, P–P 90° strong blockade 1.28, P–P near-0° strong blockade 1.14.

### F3: WEAKENS (likely). The along-gate cross-talk radius at θ* (6.54 µm) is underestimated and depends on the magnetic field.
- **Affected claim**: "with the gate axis at $\theta^*$ the along-gate cross-talk radius is only $6.54$~\um … along-gate stacking pitch is therefore $8.54$~\um" (:119).
- **Evidence**: The model potential at (6 µm, θ*) is C5/R⁵ + C8/R⁸ + C6(θ*)/R⁶ ≈ −0.126/7776 + 1.747/1.68·10⁶ ≈ −15 kHz. The run's full dipole–dipole diagonalization (table in F1) alone gives **+81 kHz** at 6 µm with 5 MHz Zeeman. With 50 MHz Zeeman it gives −79 kHz at 6 µm and −21 kHz at 8 µm. The θ* "zero" is Zeeman-dependent: the fitted C6 at 24.65° is −0.31 (R² = 0.54) at 5 MHz and **+5.43** (R² = 0.999) at 50 MHz. The report never states a bias field.
- **Recomputation (estimate)**: The 10 kHz crossing along θ* sits at ≈7.0 µm (5 MHz Zeeman, log-interpolating 81 kHz → 1 kHz between 6 and 8 µm), not 6.54 µm. It sits at ≈9 µm for 50 MHz Zeeman. The pitch grows from 8.54 to about 9.0–11 µm, which cuts the gain by roughly 5–25% if the other constraints are unchanged. I did not rerun the full packing with a diagonalized potential.

### F4: WEAKENS (verified). The "min|C6| = 0.007" confirmation of the zero is a failed fit, and a better diagonalization is not cited.
- **Affected claim**: "a hand-built full dipole--dipole diagonalization with Zeeman lifting at $24.0^\circ$, both confirming a sign change in $[20,26]^\circ$ with $\min|C6|=0.007$" (:85).
- **Evidence**: `E4.../runs/run_1/data/c6_diag_control.log` reads "24.0: C6=0.0068  R2=-0.9251". The fit has negative R², so the shift is not R⁻⁶ at that angle and 0.0068 is fit noise. Every other angle has R² ≥ 0.998. The run's own wide-window (100 GHz) diagonalization in E7 (`E7.../data/c6_discriminator_summary.json`) gives a zero at **24.43°** and min|C6| = 0.64 on the 1° grid. The report instead quotes the 30-GHz-window 24.0° and the 0.007. A sign change between 24° and 25° does exist in the R ≥ 6 µm, 5 MHz-Zeeman regime, so this does not overturn H3 there. It does misstate the evidence.

### F5: WEAKENS (verified arithmetic; physical impact likely). The gate has no tolerance to angle or position error at 2 µm, and none is modelled.
- **Affected claim**: fidelity 0.9967 at R=2.0 µm (:105) and "bounded to ±0.35° inter-method spread" (:22).
- **Recomputation**: The three-channel model gives dC6/dθ at 24.65° = 1.47 GHz µm⁶ per degree. At R=2 µm (R⁶ = 64) that is **23 MHz per degree** of residual C6 interaction, against the 2.887 MHz gate interaction.
  - The report's own ±0.35° zero uncertainty maps to ±8 MHz, about 2.8× the gate interaction.
  - A typical 50 nm transverse thermal spread (10 µK, 100 kHz trap: σ = √(kT/mω²) ≈ 49 nm) is 1.4° at 2 µm, or about 33 MHz of shot-to-shot interaction noise.
  - `cz_gate_fidelity.py` has no position or angle averaging. This failure holds even if F1 were set aside.

### F6: WEAKENS (verified). The "cross-validation" of the 1.98 headline does not test it independently.
- **Affected claim**: "Cross-validation: the S--S density is reproduced exactly … and the strong-blockade P--P gain is reproduced at 1.3385 vs.\ 1.331" (:121). `claims.json` grades 1.98 as **"corroborated"**, but report.tex:141 calls it "single-method (indicative)".
- **Evidence**: `E6 results.json cross_validation` holds three checks:
  - The same optimizer class reproduces the E2 S–S density.
  - A strong-blockade 90° gain (a different quantity) is checked against E4.
  - A brute-force re-check confirms the exhibited lattice satisfies the model potential.

  None of these tests the potential at θ* (F1, F3) or the baseline choice (F2). The "reproduced 1.3385 vs 1.331" check also compares a three-channel C6(90°) = 293 with a two-channel 268 and calls the result agreement. The claims.json grade contradicts the report's own disclosure.

### F7: MINOR (verified). Internal inconsistencies.
- The gain/density is cross-referenced to "Sec. III" (:121, :135, :141), but sections are unnumbered-style titles 1–7 in `article`; "Sec. III" does not resolve to the S–S density section.
- The abstract says "fidelity 0.9967" is viable, but :107 notes 60P3/2 decays faster than the assumed τ = 100 µs. That makes 0.9967 an upper bound, and the caption of Fig. 4 does not say so.
- The headline "24.3 ± 0.35°" and "24.65° used throughout" (:85) coexist. The E7 wide-window 24.43° is omitted.
- Fig. 1 caption (:45) says an S–S gate "requires a separation R∼4.9 µm". This contradicts the report's own 2 µm Evered example (:36). It is the same root as F2.

## Not checked
I did not check the C5/C8 magnitudes or the C8 convergence, the E5 master-equation internals and the Saffman Eq. (34) comparison, the n=75 extrapolation, the E1 S–S anchors (43S/70S), or the 3D gain. I also did not rerun the packing optimizer with a diagonalized cross-talk potential; F3's size is an estimate.

Note on server side effects: my first pairinteraction call (with its default `download_missing=True`) refreshed `~/.cache/pairinteraction/database/homepage_cache_*.json` on the server. Nothing else outside `/tmp/audit-ppss/` was written.
