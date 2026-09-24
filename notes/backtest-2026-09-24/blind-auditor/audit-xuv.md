# Adversarial audit — XUV实现路径 (non-cryogenic path to 1e-12 mbar)

Project: `ssh luxas:/Users/muqiao/Documents/sisyphus-projects/0b13afad7e43/projects/XUV实现路径`
Paths below are relative to that directory. Report = `report/report.tex`.

Note: `notes/escalations/needs-operator.md` says research was paused for missing verifier credit. A report was still produced afterwards from E1 run_2, E2 run_3 and E3 run_1. All current test suites pass when I re-ran them in a /tmp copy (E1 211, E2 193, E3 42). The stale `.pytest_cache/lastfailed` entries are old history, not current failures.

## Headline claims

1. **C1 Reachability.** Non-cryogenic architecture reaches 6.571e-13 mbar in the science region with the source off. Margin 1.52x; "统计 σ=1.14e-14" (tex:22, 32, 107–113).
2. **C2 H2 is not the bottleneck.** Required H2 speed is 51 L/s (k=1 ±18.4) against a 1618.6 L/s dual-NEG effective ceiling (31.7x). P_H2 = 3.15e-14 (tex:32, 60).
3. **C3 The non-getterable load binds.** Q_NG = 6.15e-12 mbar L/s at S_NG = 10 L/s gives P_NG = 6.15e-13, 93.6% of the total (tex:76).
4. **C4 Window He.** BSG plus the ion pump meets the He budget (1.06e-14 mbar), so sapphire is not needed (tex:56, 94).
5. **C5 Source isolation.** Source isolation is mandatory. A 1 mm differential aperture brings the source-on offset down to ~9.2e-15 mbar (tex:47, 52).
6. **C6 Pathway ranking.** Passive NEG-only, source-open, turbo-only and ion-only designs fail. Turbo-only is "受限于涡轮 ~1e-10 mbar 极限压力" and ion-only is "抽氢不足" (tex:94, 99).
7. **C7 Two independent routes.** The result was "经两条独立路由对照". Each experiment "通过其冻结的验收判据" (tex:124, 136).
8. **C8 Provability.** The result is provable only as an inferred upper bound, because the CAVS floor is 5e-11 and the IP floor is 2e-11 (tex:34, 130). Carle2023 has a sign error, which "在本文中被发现并修正" (tex:85, 134).

## Findings (ranked)

### F1 — BREAKS — confidence: verified (discrepancy); likely (interpretation)
**Claim:** "源关断时科学区总压 6.571e-13 mbar … 以 1.52× 余量穿过 1e-12 mbar" (tex:22). Also "非低温路径能到 1e-12 mbar" (tex:28).

**What is wrong:** The budget model was never back-tested on the one real system it is built from, and on that system it under-predicts the measured pressure by about 6x.
- The adopted architecture is Hahn2025's apparatus: 2x SAES Z1000 NEG = 2500 L/s H2 nameplate, a 75 L/s ion pump with "~10 L/s" for non-getterables, and 400 °C heat treatment plus air bake.
- Its dominant term reuses Hahn's own Q_NG and S_NG exactly. See `data/experiments/E3_synthesis_paths/runs/run_1/compose.py` (`Q_NG = 6.15e-12`, `S_NG = 10.0  # Hahn2025 ion pump`) and `notes/literature.d/Hahn2025.md` (pumps; Appendix I).
- Hahn's H2 outgassing is lower than the adopted chamber's: q < 4.58e-15 against 5.1e-14 mbar L s⁻¹ cm⁻².

**Evidence and recomputation:**
- Model applied to Hahn: P = 6.15e-12/10 + 4.58e-15·A/1618.6. That is ≤ 6.15e-13 + 2.8e-14 = 6.4e-13 mbar even for A = 10⁴ cm².
- Hahn's measurements (Hahn2025.md "Key numerical results"):
  - At the ions: (3.9±0.3)e-12 mbar, which is 6.1x the model.
  - At the gauge: ≤1.5e-12, which is ≥2.3x the model and sits at the gauge's x-ray limit.
- Hahn's own MolFlow simulation puts the ion location ~3x above the gauge location. The report's single-node P = Q/S_eff has no such location factor. The science region is exactly the place the report makes claims about.
- The 3.9e-12 value assumes 100% H2. The report's own model says the residual is 94% non-getterable gas (CH4/Ar/He). Langevin k ∝ √(α/μ), heavy-ion limit with μ ≈ m_gas:
  - H2: √(0.81/2) = 0.64
  - CH4: √(2.59/16) = 0.40
  - Ar: √(1.64/40) = 0.20
  - So if the residual is non-getterable, the true ion-site pressure is 1.6–3.1x above 3.9e-12, i.e. ~6–12e-12. This part is a hypothesis about composition, but it can only raise the pressure.
- The unmodelled excess in the reference system is ≥3.3e-12 mbar, which is 5x the adopted total. If any of it transfers (local sources, location factor), the adopted design lands at ~4e-12 and fails the target.

The run records both Hahn numbers (tex:103; E3 `transfer_reconciliation`) but never compares them with its own model's prediction for Hahn. `grep` for underpredict/back-test/retrodict in notes returns nothing relevant.

### F2 — WEAKENS — confidence: likely
**Claim:** "氢放气不是瓶颈，非可吸收负载才是" (tex:58). Also "氢分压 … 比目标低 32×" (tex:60).

**What is wrong:** The run's own corpus of real room-temperature neutral-atom systems shows H2 dominating the residual gas at the atoms.
- Kumar2026 (Ti chamber, the best H2 material in Fedchak): the RT baseline is ~1e-11 mbar. A 4 K cold tip that pumps only H2 drops it to ~2.5e-12. So ≥75% of the RT residual was H2 (`notes/literature.d/Kumar2026.md`).
- Zhang2025cryo: an H2 cryopump alone takes the lifetime from 30 s to 3000 s.

C2 rests only on the declared geometry: 1000 cm² with a 6"/6" tube delivering 1618.6 L/s H2 to the "science region". It is not a property of real non-cryogenic neutral-atom apparatus. Measured systems that use the same levers (Kumar, Manetsch, Hahn) sit at 4–10e-12, and H2 is the gas cryo removes. The model has not shown that it captures the H2 that actually reaches the atoms.

### F3 — WEAKENS — confidence: verified
**Claim:** "经 1 mm 差分孔径＋源区 100 L/s NEG，源开时科学区偏移降至 ~9.2e-15 mbar" (tex:47; Fig. 2 caption tex:52).

**What is wrong:** 9.2e-15 assumes a 500 L/s science-side pump for the source gas. The adopted architecture has no such pump. Three tools use three incompatible speeds for the same source gas:
- **E2:** `runs/run_3/compose.py:105-106` sets `"S_science_l_s": 500.0`. The result is `source_on_differential_1mm` = 9.24e-15 (`runs/run_3/data/source_modes.csv`).
- **E3 `science_pressure_surface`:** defaults S_source = S_NG = 10 L/s (`scripts/science_pressure_surface.py:280-283`). Adopted plus differential gives 9.077e-13 mbar, margin **1.10**. Adopted plus open gives 5.0e-10 (E3 results.json `operating_modes`).
- **E3 `pathway_comparison`:** pumps source gas at S_eff_h2 = 1618.6 (`scripts/pathway_comparison.py:109-115, 137-142`). Differential gives 6.586e-13 and open gives 3.75e-12 (`data/pathway_comparison.csv`, ranks 7 and 11).
- The two E3 tools disagree by 134x on source-open for identical declared inputs. The only cross-check (F5) was run at source-off, where the source term is zero.

**Recomputation:** 1 mm aperture into the adopted S_NG = 10 L/s gives 9.24e-15 × 500/10 = 4.6e-13. The total is then 6.57e-13 + 4.6e-13 = 1.12e-12, which **fails** the target.

A neutral-atom experiment reloads from its source every cycle. So the source-on science pressure is undetermined over a ~160x range of its source term (the species of the source gas was never fixed). The report shows only the source-off number.

### F4 — WEAKENS — confidence: verified
**Claim:** "Q_NG 误差 +70% 或 S_NG 误差 −50% 即翻转判决" (tex:128). Also the margin and σ in the abstract (tex:22).

**What is wrong:**
- **Wrong flip thresholds.** +70% and −50% are the perturbation sizes fed to the sensitivity scan (`compose.py` `uncertainties = {"Q_NG": 0.70, "S_NG": 0.50}`), not where the verdict flips.
  - Headroom = 1e-12 − 6.571e-13 = 3.43e-13.
  - Q_NG flips at +3.43e-13/6.15e-13 = **+56%**.
  - S_NG flips when 6.15e-13/x + 4.21e-14 = 1e-12, i.e. x = 0.642, a **−36%** error.
- **Mislabelled evidence.** S_NG = 10 L/s is Hahn's "expected" speed ("ion pump expected to pump non-getterable gasses at ~10 L/s", E3 results.json invariant `hahn_S_ion_NG_l_s`). The code nonetheless labels it `measured`: `tier()` default `s_ng="measured"` in compose.py, and `tier_S_NG=measured` for the adopted row of pathway_comparison.csv.
- **Pump speed at XHV (hypothesis).** Sputter-ion pump speed for Ar/He is a small fraction of the N2 rating and falls further at XHV. A −36% error on an unmeasured speed is well within plausible range.
- **Misleading precision.** The quoted σ = 1.14e-14 (1.7%) and 4 significant figures ignore the 93.6% term, which has no uncertainty at all. This is disclosed in the body but misleading in the abstract.

### F5 — WEAKENS — confidence: verified
**Claim:** "合成结果经两条独立路由对照 … 完全一致" (tex:124). Also "盲复现路由 … 两条独立路径 … 同一 51 L/s" and "三项实验各自通过其冻结的验收判据" (tex:136).

**What is wrong:** None of the cross-checks is independent.
- **Throughput vs number balance.** "Throughput P = ΣQ/S" and "number balance n = Q/(S·k_B·T), P = Σ n k_B T" are the same algebraic identity. Agreement to 1e-16 is guaranteed (E3 results.json `cross_validation[0]`).
- **H2 cross-check.** It compares the same formula on the same hardcoded inputs (`[1]`).
- **E1 51 L/s.** This is 5.1e-11/1e-12 computed twice, with a Pa→mbar conversion in one path.
- **E2 "blind replication" of the allowable load.** It is 1e-12 × 10 = 1e-11.
- **E3 acceptance criterion (c).** "Reproduces upstream values within 1e-6" checks constants typed into compose.py (`Q_NG = 6.15e-12`, `Q_H2_316L_XHV = 5.1e-14`, `WINDOW_BSG = …`). It cannot fail.
- **E3 criterion (b).** "Contour non-empty" is guaranteed because the scan axis starts at Q_NG = 1e-13, 60x below the used value.
- **Untested tools.** The two tools that produce the headline have no independent tests (disclosed at tex:134).

Net: the headline has had no check that could have come out differently. F1 is the check that was available and not run.

### F6 — WEAKENS — confidence: verified (inputs); hypothesis (fused-silica magnitude)
**Claim:** "BSG 加离子泵已满足氦预算 … 蓝宝石并非必需" (tex:56, 94).

**What is wrong:** The He load assumes a total window area of 10 cm² at 0.3 cm thickness. See `E2_residual_load_metrology/runs/run_3/compose.py:438-441` and line 174: Q = K·A·P_ref·p_He/d.
- **Recheck of the stated inputs:** 5.9e-19 × 1e-3 × 101325 × 0.5309 / 0.003 × 10 = 1.058e-13 mbar L/s. This matches.
- **Realistic viewports.** A chamber with Hahn-like viewports (4× 4.5" CF plus 2× 6" CF) has ~290 cm² of clear glass at ~0.6 cm. That scales the load by (290/10)(0.3/0.6) ≈ 14:
  - With the 70 °C K the report actually uses: P_He ≈ 1.5e-13. The total becomes 8.0e-13, margin 1.25.
  - With E2's own RT branch (×0.227, `window_BSG_RT_He_load_bounds`): ≈3.4e-14.
- **Glass cells not evaluated.** The typical neutral-atom science glass cell is fused silica, the most He-permeable glass family, and it is never evaluated. The "sapphire not needed" conclusion is therefore shown only for 10 cm² of borosilicate. It survives for BSG but is unproven for real cells.

### F7 — WEAKENS — confidence: verified
**Claim:** "涡轮泵-only 受限于涡轮 ~1e-10 mbar 极限压力；离子泵-only（无 NEG）抽氢不足" (tex:94).

**What is wrong:** The comparison is not made under matched conditions.
- **Turbo-only.** The "Bare 316L + turbo-only + glass" path swaps three things at once: as-received steel, a "bare glass" He load of 1e-9 mbar L/s (illustrative), and the turbo. It contains no turbo ultimate-pressure term. Its dominant term is **He** from the window (pathway_comparison.csv rank 13, `dominant_term=He`; 1e-9/50 = 2e-11 mbar), not the turbo. The stated reason for failure is not what was computed.
- **Ion-only.** It fails at 1.136e-12 with an "illustrative, declared" 100 L/s H2 speed (compose.py `S_ION_ONLY_H2 = 100.0`).
  - Recomputed: the path passes if 5.1e-11/S ≤ 1e-12 − 6.15e-13 − 1.06e-14 = 3.74e-13, i.e. **S_H2 ≥ 136 L/s**.
  - That verdict is set by an arbitrary input, not by physics.

### F8 — MINOR — confidence: likely
**Claim:** "Carle2023 符号错误在本文中被发现并修正" (tex:134); "Carle2023 符号错误必须点名" (tex:85).

**What is wrong:** The run is right that Carle's printed ln K = ln K0 − E_D/(k_BT) with E_D = −0.49 eV and K0 = 1e-14 cannot reproduce K(70 °C) ≈ 1e-21. I checked: 1e-14·e^{+16.56} = 1.6e-7, while e^{−16.56} gives 6.4e-22 (`data/papers/2303.13927/CARLE_main.tex:180`).

However, Carle quotes the literature values in the same sign convention: Pyrex −0.29 eV and Corning 1720 −0.52 eV (tex:171 of the paper). This is a convention slip in the equation as written, inherited from the field. It is not a physics error that this work "discovered". The physical direction (permeation drops on cooling) is standard. The claim is overstated but has no effect on the headline, which uses the BSG 70 °C value.

### F9 — MINOR — confidence: hypothesis
**Claim:** "Hahn2025 附录 I 测得的非可吸收负载 Q_NG=6.15e-12" (tex:76). The same value is called "推断上限" at tex:113.

**What is wrong:**
- Q_NG is a whole-system load from Hahn's apparatus. That includes its hot-filament BA gauge, which generates CH4/CO, and its own ion pump's re-emission during the pump-off transient. It is transferred unscaled to a hypothetical 1000 cm² chamber with unspecified gauges and pumps.
- Calling it "measured" in one place and an "inferred upper bound" in another hides that it is neither a bound nor a measurement for the target chamber.
- The abstract says walls reach "q_H2 ~ 1e-15" (tex:38), but the headline uses 5.1e-14. That is 51x higher, and the text is inconsistent with it.

### F10 — MINOR — confidence: hypothesis
**Claim:** Completeness of the source-off budget P_total = P_NG + P_H2 + P_He (tex:109).

**What is wrong:** Several contributions a physicist would expect at the atoms of a neutral-atom machine are absent. None is estimated, so the size of each is unknown:
- Residual alkali vapour from source-coated surfaces while the source is "off".
- Laser-induced desorption from windows and glass under high-power tweezer and lattice beams.
- Outgassing from in-vacuum components (coils, chips, optics mounts).
- Gauge outgassing.

Each of these is a local source. Hahn's gauge-to-ion 3x factor (F1) suggests local terms are exactly what the single-node model misses.

## Not checked
- E1 short-tube conductance arithmetic (4591 L/s implied tube conductance) and the E2 metrology numbers (Li S/B 0.066, Rb SNR 8.9) were not recomputed.
- Fedchak Table IV values were checked only against the literature notes.
- I did not read the Hahn2025 paper itself to confirm its ion species and pump layout.
