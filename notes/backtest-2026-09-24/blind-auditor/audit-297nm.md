# Adversarial audit: single_photon_297nm

Project: `ssh luxas:/Users/muqiao/Documents/sisyphus-projects/manual/projects/single_photon_297nm`.
All paths below are relative to that directory. Recomputations ran on the server in `/tmp/audit-single_photon_297nm/` (`phase.py`, `toy.py`, `frontier.py`). They import the run's own `E5/scripts/blockade_gate_master.py` with `PYTHONDONTWRITEBYTECODE=1` and the cached pairinteraction DB. The recomputation reproduces the run's leakage of 2.555e-4 at 40 MHz exactly, so it uses the same pair block as the run.

## Headline claims

- **H1.** At 297.0 nm the 5S→nP transition sits at n≈75. The stretched dipole gives Ω/√P = 0.902 MHz/√mW (10 µm waist), so 1.2 mW drives a µs π-pulse. The route is "feasible and power-cheap". (report.tex:20, 72, 121)
- **H2.** The stretched nP3/2 |m_J|=3/2 pp vdW interaction is pure sin⁴θ, with C6(0)≈1e-6, an anisotropy of about 10⁶ and r_b(0)=0.32 µm. The gate "fails on-axis" and θ*=53.77°. (report.tex:40–44)
- **H3.** At low drive the gate is recoil-limited: F=99.89% at 10 MHz, with recoil at 3.86e-4 as the dominant term. (report.tex:86)
- **H4.** A full pair-Hamiltonian master equation gives a blockade leakage of 2.555e-4 at 40 MHz. That is 4.3× below the closed form, "because the pair is near-Förster-resonant … strong mixing suppresses the actual leakage". (report.tex:88, 115)
- **H5.** With that leakage folded in, the ordering flips to F(40 MHz)=99.963% > F(10 MHz)=99.909%. The optimum moves to 28 MHz / 963 mW / F=99.975%, and the report concludes "The recoil-limited ceiling … does not survive fast driving". (report.tex:20, 90, 111)
- **H6.** The optimum infidelity of 2.50e-4 is below Evered (5e-3), de Léséleuc and Pagano. (report.tex:92)

## Findings (ranked)

### F1 — BREAKS — verified — the |11⟩ conditional-phase error is omitted and reverses the flip (H4, H5)
**Affected text:** "folding it into the five-channel budget flips the ordering to $F(40\,\mathrm{MHz})=99.963\%>F(10\,\mathrm{MHz})=99.909\%$ and shifts the optimum to $28$\,MHz / $963$\,mW / $F=99.975\%$" (report.tex:20). Also: "The recoil-limited ceiling therefore does \emph{not} survive fast driving."

**What is wrong:** E5 defines leakage = 1 − P_gg(final) and infidelity = 1 − P_gg with decay (`E5/scripts/blockade_gate_master.py:313-322`). That is a *population* return probability for the |11⟩ input. With finite blockade, the dominant error of a smooth adiabatic pulse is the *phase* of the |11⟩ amplitude, not the population left behind. This phase is an entangling-phase error, so local Z rotations cannot remove it. The run never computes it. E6 composes the population-only number into the "gate fidelity" budget (`E6/scripts/compose_corrected_frontier.py:9, 81-85`).

**Evidence and recomputation:** I used the run's own pair block (10 reachable eigenstates; dominant state at −0.1553 GHz with |c|²=0.517, others at +0.546 / −0.284 / −0.695 GHz) and its own Gaussian pulse (τ/Ω=7.69, y=2.602):

| Ω/2π (MHz) | Population leakage (matches run) | |11⟩ phase deviation δ from π (rad) |
|---|---|---|
| 10 | 9.59e-7 | 0.0343 |
| 28 | 5.95e-5 | 0.0968 |
| 40 | 2.555e-4 | 0.1394 |

For a pure phase error δ on one of the four basis states, the average gate fidelity is F_avg = (|3+e^{iδ}|²+4)/20 ≈ 1 − 0.15δ². That adds 1.77e-4 at 10 MHz, 1.40e-3 at 28 MHz and 2.91e-3 at 40 MHz. Adding this to E6's own 5 µK totals (`E6/runs/run_1/data/corrected_frontier.csv`):

- F(10) = 99.891%
- F(28) = 99.835%
- F(40) = **99.671%**, which is below F(10)
- The optimum moves to **15 MHz, F = 99.912%** (about 150 mW), not 28 MHz / 99.975%.

So the ordering does not flip. Blockade error at 40 MHz is about 11× larger than reported. The claim "driving faster buys fidelity up to 28 MHz" (report.tex:111) does not hold for the simulated protocol.

### F2 — BREAKS — verified — the "4.3× smaller because of Förster mixing" explanation is backwards; the comparison is unmatched (H4)
**Affected text:** "this overestimates the true leakage by $4.3\times$, because the pair is near-F\"orster-resonant … the strong mixing suppresses the actual leakage to $2.555\times10^{-4}$" (report.tex:88). Also: "the strong mixing makes the true blockade leakage \emph{smaller} than the perturbative estimate" (report.tex:115).

**What is wrong:** The two numbers compare a square-pulse Jaksch formula (ε=Ω²/2V²) against a smooth Gaussian pulse, whose final population leakage is adiabatically suppressed. The reduction comes from the pulse shape. The mixing makes things worse.

**Recomputation (`toy.py`):** same ME code, same Gaussian pulse, one doubly-excited level with overlap 1:

| Blockade shift V | Leakage at 40 MHz | Closed form Ω²/2V² | Phase δ |
|---|---|---|---|
| −850 MHz (the perturbative value) | 4.95e-7 | 1.107e-3 | 0.047 rad |
| −152 MHz (the true dressed shift) | 4.95e-4 | 3.46e-2 | 0.265 rad |

The matched comparison is therefore ME(850 MHz) = 5e-7 against ME(full pair) = 2.6e-4: near-Förster mixing *raises* leakage by about 500×. The report's premise correction (E5 `results.json` `premise_corrections`) and its causal story are inverted. The 5.6× weaker blockade (−152 vs −850 MHz, `E5/runs/run_1/results.json` `pair_potential.v_4um_ghz`) is a penalty, not a benefit.

### F3 — BREAKS — verified — the simulated pulse is not a CZ gate; "gate fidelity" is only the |11⟩ return probability (H4, H5)
**Affected text:** "A full pair-Hamiltonian master equation shows … blockade leakage $2.555\times10^{-4}$" and the corrected "F" values (report.tex:20, 88-90).

**What is wrong:** The pulse width is solved so that the symmetric |gg⟩↔|W⟩ mode (Rabi √2Ω) completes 2π (`blockade_gate_master.py:212-226`). The single-atom pulse area is then ∫Ω dt = π√2 = **4.443 rad** (recomputed), not 2π. The |01⟩ and |10⟩ inputs therefore return with probability sin-limited **|a01|² = 0.367** at every Ω (recomputed). The code evolves only ψ0=|gg⟩ (line 291).

Pagano et al. use a detuned protocol ("Gaussian detuning with smooth Rabi turn-on", `notes/literature.md:446`), and that detuning is what makes both branches return. E5 simulated a resonant pulse with no detuning, which is a different protocol.

Every "F" in the corrected frontier is P(|11⟩→|11⟩) plus closed-form single-atom terms. The E6 "gate fidelity" has not been computed for any real CZ protocol. A detuned protocol would change the |11⟩ trajectory, the time spent in Rydberg states and the phase error, so none of the E5/E6 numbers carries over.

### F4 — BREAKS — verified — "feasible and power-cheap" combines two different operating points (H1, H5)
**Affected text:** "the verdict is \emph{feasible and power-cheap}: a $\approx1.2$\,mW drive reaches $n\approx75$ … and the fidelity is $99.89\%$ … but reaches $99.975\%$ at the $28$\,MHz / $963$\,mW optimum" (report.tex:121). Also: "The $\approx1.2$\,mW low-drive requirement … sits three orders of magnitude inside this envelope" (report.tex:117).

**What is wrong:** 1.2 mW corresponds to Ω/2π = 1 MHz. At that point the run's own frontier gives **F = 93.84%** (`E6/runs/run_1/data/corrected_frontier.csv` row 1: total infidelity 0.0616, dominated by recoil 0.0386 and Doppler 0.0198). The high-fidelity points need much more power:

| Point | Power needed |
|---|---|
| 99.89% | 122.8 mW |
| Claimed optimum | **963 mW** |
| 40 MHz | 1965 mW |

The only demonstrated 297 nm source is 700 mW, measured before any optical losses (report.tex:117, citing Manthey). So the claimed optimum needs more than 1.4× the best laser demonstrated at this wavelength, for a single 10 µm spot. The route is "power-cheap" only at a fidelity of about 94%.

### F5 — WEAKENS — verified — "pure sin⁴θ, C6(0)≈10⁻⁶, anisotropy ≈10⁶, r_b(0)=0.32 µm" contradicts the run's own control and benchmark (H2)
**Affected text:** "the angular-channel decomposition … is pure $\sin^4\theta$ … $C_6(\theta{=}90^\circ)=55.198$ … versus $C_6(0)\approx10^{-6}$, a field-free anisotropy ratio of $\sim10^6$" and "the blockade radius is $6.17\,\mu$m at $\theta=90^\circ$ but $\sim0.32\,\mu$m at $\theta=0$" (report.tex:40, 42).

**Evidence:**
- **The run's own control disagrees.** E2's field-free full diagonalization at n=50, θ=0 gives **C6(0) = 1.224 GHz µm⁶** (`E2/runs/run_1/data/cross_validation.json` `n50_p3half_m3half_theta0.c6_ghz_um6`, fit r²=1.0). That is six orders of magnitude above the perturbative 1e-6.
- **The Vermersch benchmark fails at θ=0 but is reported as a pass.** The computed n=25 value is 2.35e-6 MHz µm⁶ (`benchmark_n25_p3half_m3half.csv` row θ=0), against Vermersch's 0.269 MHz µm⁶. Only θ=90° was scored ("1.8%").
- **The given explanation does not fit.** `E2/results.json` attributes the missing residual to Vermersch's Zeeman field. But the run's own field-free diagonalization reproduces that residual: scaling 0.269 MHz µm⁶ from n*=22.36 to n*=47.36 as n*¹¹ gives 0.269×(2.118)¹¹ ≈ 1.0 GHz µm⁶, which matches the 1.22 from diagonalization. The perturbative zero is an artifact.

**Recomputation:**
- r_b(θ=0, n=50, Ω/2π=1 MHz) = (1224 MHz µm⁶ / 1 MHz)^{1/6} = **3.27 µm**, not 0.32 µm.
- At n=75: C6(0) ≈ 1.22×(72.36/47.36)¹¹ ≈ 130 GHz µm⁶, so V(4 µm, θ=0) ≈ 32 MHz. The on-axis interaction is weak but not zero.
- The anisotropy is about 56 (68.5/1.22), and the angular form has a constant term, as Vermersch found.

The qualitative answer to the user ("yes, strongly angle-dependent; use side-by-side geometry") survives. The quantities "pure sin⁴θ", "10⁶", "0.32 µm", "blockade off" and θ*=53.77° (Fig. 5 is built on the sin⁴ form) do not.

### F6 — WEAKENS — likely — Doppler is double-counted, and the "recoil-limited" label is mostly thermal motion (H3)
**Affected text:** "dominated by photon recoil ($3.86\times10^{-4}$) with decay ($2.08\times10^{-4}$), Doppler ($2.02\times10^{-4}$)…" (report.tex:86).

**Evidence:** In `E3/scripts/error_terms.py:118-126`:
- recoil = (15/32)(ħk²/2m)·T̄²·ω_z·coth(ħω_z/2k_BT). In the thermal limit this becomes (15/16)·k²k_BT·T̄²/m.
- doppler = x/2 with x = k²k_BT·T̄²/(2m).

Both terms are the same k²k_BT·T̄² thermal-motion quantity with different prefactors. Their ratio is 3.86/2.02 = 1.91 against the 1.875 predicted, and the small difference is the ω_z=50 kHz quantum correction.

The run's own literature note says Pagano's Eq. 16 term covers "photon recoil + Doppler broadening" (`notes/literature.md:480`), and that recoil is 0.008% at T=0 rising with T (`:458`). So adding Saffman's Doppler term on top counts thermal dephasing twice.

**Recomputation:** the T=0 part of the recoil term is 15/32 × 1.637e5 s⁻¹ × 3.14e5 s⁻¹ × (6.14e-8 s)² ≈ **9e-5** at 10 MHz. The other ~3e-4 is thermal Doppler. Removing the duplicate lowers the 10 MHz infidelity by about 2.0e-4. The number moves by about 0.02%. The physics label "recoil-limited" is inaccurate; "thermal-motion limited" would be correct.

### F7 — WEAKENS — hypothesis — degenerate Zeeman partners of the target were removed by hand, with no magnetic field specified (H4, H5)
**Affected text:** "A full pair-Hamiltonian master equation (the reduced two-atom Hamiltonian with the $|75S_{1/2}{+}76S_{1/2}\rangle$ channel … explicitly diagonalized)" (report.tex:88).

**What is wrong:** `blockade_gate_master.py:101-113` deletes the m≠3/2 sublevels of 75P3/2 "so the target stays non-degenerate". Without a large bias field these pair states are degenerate with |rr⟩, and at θ=90° they couple to it at second order through the S+S channel. This is exactly the Förster-zero physics of Walker & Saffman, which the report cites.

**Evidence:**
- E2's diagonalization, which does not remove the partners, shows the |rr⟩ overlap saturating at **0.78 even at R=12 µm** for n=50 (`cross_validation.json` `n50_p3half_m3half_theta90.overlap`). That is the signature of strong degenerate mixing.
- Lifting the partners by more than the 150 MHz interaction needs 2·g_J·µ_B·B ≳ 150 MHz. With 2·(4/3)·1.4 MHz/G ≈ 3.7 MHz/G, that means B ≳ 40 G. No field is stated anywhere.

The blockade shift, the leakage and the phase could all change materially.

### F8 — WEAKENS — hypothesis — intensity-dependent error channels at the ~1 W optimum are missing (H5)
**Affected text:** "five additive, independent channels (recoil, Rydberg decay, Doppler dephasing, laser phase noise, blockade leakage)" (report.tex:126).

**Estimate:** 963 mW in a 10 µm waist gives I = 2P/πw² = 6.1e5 W/cm².
- **Ponderomotive shift of the Rydberg level:** U_p ≈ 9.33e-14·I·λ²[µm] eV = 5e-9 eV ≈ **1.2 MHz** (about 2.5 MHz at the 40 MHz point).
- **Ground-state light shift:** about 28.6 kHz × α[a.u.] at this intensity.

Both shifts scale as Ω², so δ/Ω grows linearly with drive (about 0.04 at 28 MHz). Their spatial and temporal variation over the Gaussian pulse and the thermal position spread, plus laser intensity noise, is not in the budget. These channels grow with Ω and would push the optimum lower still. They are not verified in magnitude, because the effect depends on calibration.

### F9 — WEAKENS — verified — the fidelity numbers assume a 1 kHz linewidth that is 700× narrower than the demonstrated 297 nm laser (H3, H5)
**Affected text:** "linewidth $1$\,kHz" (report.tex:86). Separately the report says: "$700$\,mW at 297\,nm with $<700$\,kHz linewidth" (report.tex:117).

**Evidence:** phase = π·Δν·T̄_r (`error_terms.py:143`). At 700 kHz this becomes 0.135 at 10 MHz and 0.034 at 40 MHz, which dominates everything. The abstract and conclusions state F without this condition. It appears only as an "engineering" open question.

### F10 — MINOR — verified — "297.0 nm places n≈75" is extremely sensitive to the wavelength (H1)
**Evidence:** 1/297.0 nm (vacuum) = 33670.0 cm⁻¹. With IE ≈ 33690.8 cm⁻¹, the binding energy is 20.8 cm⁻¹, giving n* = √(109736.6/20.8) = 72.6 and n = 75.3. This reproduces the run's value.

If 297.0 nm is an air wavelength, the vacuum value is 297.087 nm, the binding energy is 30.6 cm⁻¹, n* = 59.9 and **n ≈ 62.5**. In general dn*/dλ ≈ 0.4 per pm. So n is a free design choice, not something 297 nm implies. The report's correction of the plan's "n≈55–65" (report.tex:38) is not warranted.

### F11 — MINOR — verified — the "independent" cross-checks share code, and a 24% control mismatch is undisclosed
**Evidence:**
- The E5 wiring check compares a pairinteraction diagonalization against another pairinteraction diagonalization with the same DB and basis family (`blockade_gate_master.py:249-256`).
- The report calls full diagonalization an "independent control" (report.tex:126). Yet that control gives C6(90°, n=50) = 68.5 against the headline 55.198 (24%), and 7.88 against 6.22 MHz µm⁶ at n=25 (27% from Vermersch 6.33). Neither discrepancy is disclosed. The report quotes 55.198 and "1.8%".

### F12 — MINOR — verified — the comparison against baselines mixes theory and experiment (H6)
**Affected text:** "the corrected optimum infidelity ($2.50\times10^{-4}$) is below the measured two-photon values of Evered et al.\ ($5.0\times10^{-3}$)" (report.tex:92).

**What is wrong:** This compares a partial theoretical budget against measured gate errors that include SPAM, intensity noise, crosstalk and so on. The budget itself is invalidated by F1–F3. The comparison is unmatched and supports no ranking.

## Not checked
I did not check:
- the 221.6 µs lifetime and the 930 µs 0 K value (ARC), independently;
- the Numerov D2 and Manthey-38P reproductions line by line (the Manthey-scaled estimate of 0.81 MHz/√mW agrees with 0.902 to about 11%);
- the E4 F(θ) code;
- how sensitive the blockade is to R near the avoided crossings (V(3 µm)=+1.33 GHz against V(4 µm)=−0.152 GHz, `E5 results.json v_r`) given the thermal position spread;
- the n=75.3 vs n=75 Förster-defect robustness (E7 was descoped).
