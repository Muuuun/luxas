# Adversarial audit: yttrium-magic-wavelengths-20260906

Project: `luxas:/Users/muqiao/Documents/sisyphus-projects/yttrium-magic-wavelengths-20260906/project`
Paths below are relative to that project. `R` = `data/experiments/E1_y_sos_dataset_validation/runs/run_1/results.json`. Scratch recomputations were run from `/tmp/audit-ymagic/{a,b}.py` on the server, reading `R/../data/augmented_y_dataset.json`.

## Headline claims

1. **C1**: The complete SOS model gives α_s(²D₃/₂, static) = 146.59 a₀³ (valence 141.66 + continuum 1.03 + core 3.9). This is 1.28σ below 162 ± 12 and below the 150 pass line, so the gate fails and the verdict is inconclusive.
2. **C2**: The discrete valence f-sum is 2.20 of the TRK value 3. The 0.80 deficit "contributes at most 1.75 a₀³" and "caps the total near 147.3 a₀³". "No amount of missing upward transition … can restore the gate."
3. **C3**: "The shortfall is therefore core-valence correlation, inaccessible to any single-electron SOS, rather than missing transitions." This refutes the predecessor's missing-upward-transitions hypothesis.
4. **C4**: The ground-configuration states ²D₃/₂ and ²D₅/₂ are "well converged". The imaging and cooling excited states are not.
5. **C5**: The 146.59 value lies inside the single-electron theory scatter, and it "fails … in the same direction as every tabulated single-electron method". "No correlated value exists for yttrium."
6. **C6**: A relativistic CI+all-order or CC calculation is the decisive next step. The scan was correctly not run.

## Findings (ranked)

### F1: BREAKS, verified. The "f-sum bound" of 1.75 a₀³ is not an upper bound. The true bound is 15.3 a₀³, which would pass the gate.
- **Claim**: "The most generous assignment of that deficit --- placing all of it in a flat above-threshold continuum … contributes at most 1.75\,\aunit" and "No amount of missing upward transition --- including the unanchored $\varepsilon f$ channel … --- can restore the gate." (report.tex §4; abstract "caps the total near 147.3")
- **What is wrong**: The code computes `alpha_deficit = fsum_deficit / (2.0 * a_hartree)` (`scripts/multi_channel_qdt_continuum.py:299-300`). This takes the *total* missing oscillator strength (0.80, dimensionless) and uses it as a Rydberg-normalised threshold *density* f₀ (per-Hartree units). That density is then held flat from threshold to infinity, which integrates to infinite total f. The quantity has the wrong dimensions to be a bound on anything. Oscillator strength f placed at energy ω ≥ IP contributes f/ω² (a.u.), so the maximum for a fixed f_deficit above threshold comes from putting all of it at threshold. The run's own ledger describes 1.75 as "assigning the entire f-sum deficit to threshold" (`notes/experiments.md:28`, `:48`). That is exactly the case that gives 15.3, not 1.75.
- **Evidence**: `R` computed.continuum_deficit_bound_a03 = 1.7514; fsum_deficit = 0.8003; IP = 50145.6 cm⁻¹ = 0.22848 Ha.
- **Recomputation**: 0.8003 / 0.22848² = **15.33 a₀³**. The max total is 141.66 + 15.33 + 3.9 = **160.9 a₀³**, inside the [150, 174] pass band. Even a moderate placement at the run's own "physical" ω_eff = 0.37 Ha gives 0.80/0.37² = 5.84 → total 151.4, which passes (`R:100-103`, the r2 "confirmed" state). The r2 and r3 reviewers' own estimates were 164.5 ± 13 and 151.4 ± 5 (`reviews/experiment_review_*_r1.md:9`, `_r3.md:9`). The claim that missing transitions cannot close the gate is false by the run's own numbers. The PI accepted this argument and on that basis cancelled the ε-f anchor experiment (`reviews/pi_feedback.md:33,37`). That experiment was the one that could have decided it: `notes/experiments.md:107` says ~4–5 a₀³ from εf would restore "confirmed".

### F2: BREAKS, verified (physics). Attributing the shortfall to "core-valence correlation inaccessible to SOS" is physically wrong for an empirical SOS.
- **Claim**: "The shortfall is therefore core-valence correlation, inaccessible to any single-electron SOS, rather than missing transitions" (abstract, §4, §7, §8). Also: "This refutes, for the ground state, the predecessor's hypothesis that the missing piece was upward transitions."
- **What is wrong**: This model is not a single-electron model. Its matrix elements come from *measured* A-values and lifetimes (NIST supplies 99.1 a₀³, the lifetime anchor 12.35) and semi-empirical Kurucz gf (30.2 a₀³). Experimental transition strengths already contain all valence-valence and core-valence correlation, including core polarisation of the dipole operator. In the standard decomposition α = α_v(SOS) + α_core + α_vc, the only core-valence term an empirical SOS lacks is α_vc. That term is a small *negative* correction (Pauli blocking), so it cannot supply +15 a₀³. With a correct bound (F1), the residual is fully consistent with missing or low oscillator strength. The deficit itself (0.80, 27 % of TRK) is direct evidence of missing transitions, and the run's own note says the deficit includes "high-n bound" strength (`R:214`). Missing bound strength below IP weighs even more than continuum strength: f = 0.1 at 30 000 cm⁻¹ (0.137 Ha) adds 5.3 a₀³.
- **Recomputation**: Source breakdown for ²D₃/₂ (822 lines): nist 16 lines, f = 1.235, α = 99.10; lifetime 1 line, f = 0.199, α = 12.35; kurucz 805 lines, f = 0.766, α = 30.20. The diagnosis has no support. The conclusion that SOS cannot answer the question, and that CI+all-order is the required next step (C6), is unsupported.

### F3: WEAKENS, verified. The gate "failure" uses only the benchmark σ. The model has an unpropagated uncertainty of the same size.
- **Claim**: "146.59\,\aunit{} is 1.28$\sigma$ below the benchmark"; valence SOS described as "exact arithmetic" (`R:129`).
- **What is wrong**: The quantity's uncertainty is set to the benchmark's σ = 12 (`R:128-129`). No model uncertainty is propagated. 30.2 a₀³ rests on computed Kurucz gf values with no stated accuracy. Two single Kurucz lines carry 7.44 a₀³ (404.88 nm, A = 7.66e7, J' = 1/2) and 4.20 a₀³ (949.7 nm, J' = 1/2). The 12.35 a₀³ 359 nm term assumes a 100 % branching fraction to the ground state. The continuum (F1, F4) is uncertain at the ×2–15 level.
- **Estimate**: A 20–30 % gf uncertainty on the Kurucz part gives ±6–9 a₀³. With the continuum range from F1 (1–15 a₀³), the model interval roughly spans 142–161. Against 162 ± 12 the result is <1σ and not a gate failure. At minimum, "fails the gate" is not a firm result. The frozen criterion reads a point value that sits 3.4 a₀³ from the boundary.

### F4: WEAKENS, verified. The per-channel QDT continuum formula has a factor of 2 wrong relative to its own derivation.
- **Claim**: Continuum 1.03 a₀³ from "per-channel QDT", split 0.824 + 0.203.
- **What is wrong**: The docstring gives E_n = IP − Ry/n*², so dE/dn = 2Ry/n*³ = 1 Hartree/n*³. With f_n = f₀/n*³, the density is df/dE = f₀ per Hartree, so α_cont = f₀/a. The code uses f₀/(2·HARTREE) per cm⁻¹, giving α = f₀/(2a) (`multi_channel_qdt_continuum.py:13,18,253`). A hydrogen check confirms the correct density: n³f(1s→np) → ~1.56 for H 1s, and the threshold cross-section of 6.3 Mb corresponds to 1.56 per Hartree. With the corrected formula the anchored value is 2.05 a₀³ and the "deficit bound" is 3.50. The run's note that "H-atom calibration shows flat continuation overestimates ~1.9×" (`notes/experiments.md:74`) comes from the halved formula. So the net value is an ad hoc estimate whose uncertainty is at least a factor of 2 either way, not a controlled 1.03. On its own this does not move the total over 150 (it gives 147.6), but it compounds F1.
- **Evidence**: `R:24-44`: f₀ = 0.3767 and 0.0926; a = 0.22848 Ha; 0.3767/(2 × 0.22848) = 0.824 as reported, and f₀/a = 1.649.

### F5: WEAKENS, verified. Saying ²D₃/₂ and ²D₅/₂ are "well converged" contradicts the run's own f-sum.
- **Claim**: "The two ground-configuration states are well converged … their static scalars (141.66 and 143.30\,\aunit) are stable" (§5, Table 1 caption).
- **What is wrong**: No convergence or stability test exists. The only completeness measure is term count. The ground state is the one the report says misses its benchmark by ~15 a₀³, and its f-sum is 2.20/3 (73 %). Recomputed for ²D₅/₂: 995 lines, f-sum = **2.245**, α = 143.28, of which Kurucz supplies 24.3 a₀³. That is the same incompleteness. RESEARCH.md asks for a "completeness fraction for every state", and the report gives only N_terms.
- **Consequence**: "Converged" and "fails the gate because incomplete or uncorrelated" cannot both be true for the same state.

### F6: WEAKENS, likely. The literature framing misstates the tabulated theory values.
- **Claim**: "it fails it in the same direction as every tabulated single-electron method --- low, by the core-valence correlation that none of them includes … because no correlated value exists for yttrium" (§6).
- **What is wrong**: The run's own list (`R:154`) includes LR-CCSD 126.74 a₀³. That is a correlated coupled-cluster value, not a single-electron one, and it is the *second-lowest* entry. A correlated method lands further below the anchor, which is the opposite of the report's mechanism. TD-DFT LEXX gives 163, which is not low. "No correlated value exists" is true only with the qualifier "relativistic". The sentence as written is false.

### F7: MINOR, verified. The "single-electron" label and the use of "complete" in the title contradict the data.
- **Claim**: The title says "a complete sum-over-states model"; the abstract calls it a "complete single-electron sum-over-states (SOS) polarizability model".
- **What is wrong**: The f-sum is 73 % complete (F2), and the report itself says the εf channel is unanchored. The matrix elements are empirical, so the model is not single-electron (F2).

### F8: MINOR, likely. The 359.3 nm A-value comes from a lifetime with an assumed unit branching fraction.
- **Evidence**: `R:65-73` has `"source": "lifetime"` and A = 2.051e8. The recomputed f = 0.199 and α contribution = 12.35 a₀³ match `R`. x²P°₁/₂ at 27 824.6 cm⁻¹ can also decay to the even a⁴F/a⁴P/a²P levels at 10–22 kcm⁻¹. A 5–10 % branching to those lowers this term by 0.6–1.2 a₀³, which pushes the total further down. This is a hypothesis about size; scratch/x2p_decay*.py was not checked.

### F9: MINOR, verified. The "internal checks" provide no independent evidence on the headline value.
- The report discloses this, and it matters for how the claims should be read. The valence cross-check uses the same inputs algebraically (`R:194-205`). The replicator returned the benchmark itself, and the reviewer ESTIMATE lines are MALFORMED. The contradiction sweep (`reviews/contradiction_sweep.md:11`) checked that 1.75 and 147.3 are *consistent* across files and called them "backed by computed f-sum-deficit bound leaves". No layer checked whether the bound is a bound (F1).

## Not checked
I did not check: the dynamic α(λ) curve and figure; the excited-state values (y²F −932, z⁴G 2347) and the 1665 nm Kurucz line; the Kurucz line parsing and level matching in `merge_transition_dataset.py`; the Le Kien tensor/vector implementation; the 359 nm branching scripts; and whether the Ma et al. 2015 value is actually 163 ± 12.
