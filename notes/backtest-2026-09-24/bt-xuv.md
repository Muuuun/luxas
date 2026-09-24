# Backtest: XUV实现路径 (non-cryogenic 1e-12 mbar neutral-atom vacuum)

Project: `/Users/muqiao/Documents/sisyphus-projects/0b13afad7e43/projects/XUV实现路径` (droplet, read-only audit 2026-09-24)

## 0. The task brief was out of date. What actually happened

The brief says the run "paused 2026-09-15, E3 never dispatched, no report". That describes only the first session. The run was resumed twice:

| Session | Dates | Spend (usage.log) | What happened |
|---|---|---|---|
| 1 | 09-15 15:30 → 17:52 | $28.46 (glm-5.3 $13.44, deepseek-v4-pro $10.73, opus-4-6 $2.79, gpt-6-astra $1.50) | E1 run_1 and E2 runs 1–2 ran. GLM `1302` rate limit made the runtime mark tool_review OFFLINE, then Anthropic ran out of balance and the run hard-stopped. Afterwards the brain did a read-only audit that named the E1 and E2 physics errors (`notes/escalations/needs-operator.md`). |
| (pause) | 09-15 17:52 → 09-19 14:26 | — | 3.9 days of wall time lost. |
| 2 | 09-19 | $11.40 | Correction runs: E1 run_2 (`jpd3kt`) and E2 run_3 (`epxu2r`). PI said CONTINUE. |
| 3 | 09-20 11:36 → 15:57 | $18.95 | E3 run_1 (`qcgco4`). GLM ran out of balance (`1113`), so 2 of 4 E3 tools were never tested. A report was still written and compiled (`report/report.pdf`, 15:42) and the PI said **STOP** (accept). Then DeepSeek returned 402 and killed the brain mid-polish. `finish()` was never called and `last_exit.json` shows `finished:false`. |

Total spend was $58.80. Brain model: gpt-6-astra on 09-15 (and partly 09-19), deepseek-v4-pro on 09-20 (matches commits f68d101 and e6ffbcf).

Mapping from experiment agent ID to run, taken from the ledger_writer transcripts:
- `b008f3` = E1 run_1
- `olxc7o` = E2 run_1
- `6oh6xh` = E2 run_2 (its ledger_writer died)
- `jpd3kt` = E1 run_2
- `epxu2r` = E2 run_3
- `qcgco4` = E3 run_1

Model by role (from conversations/*.jsonl):

| Role | Model |
|---|---|
| experiment, tool_impl, reader, replicator, report_writer | deepseek-v4-pro |
| tool_review | glm-5.3 |
| ledger_writer, reviewer/PI | claude-opus-4-6 |
| illustrator | deepseek-flash |
| figure_auditor | glm-5.3-flash (died on 1113) |

## 1. Defect catalog (ground truth only)

I checked each finding against the primary sources on the box:
- Hahn2025 `main.tex` l.222, 377
- Carle2023 `CARLE_main.tex` l.171–180
- Fedchak2021 pdftotext (Table IV, uncertainty section)

| ID | Defect | Where | Author (agent / model) | Reached report? | Caught by / when | Cost |
|---|---|---|---|---|---|---|
| **D1** | `h2_partial_pressure_mbar` is labelled "H2-ONLY", but the stored value is q·A/S + Q_NG/S_ion. The non-getterable term makes up 8.2e-14 of the 8.24e-14 (99%). The error was **written into the tool spec**: the chamber_budget_scanner description says "P_H2 = Q_H2/S_eff + Q_NG/S_ion". | E1 run_1 `results.json` quantities[h2_partial_pressure_mbar]; spec in `conversations/brain.experiment-b008f3.tool_impl-xlb0zc.jsonl` | E1 experiment (deepseek-v4-pro); implemented as specified by tool_impl (deepseek); tests matched the spec (glm-5.3) | No (superseded) | Brain read-only audit 09-15 (gpt-6-astra), fixed in run_2 | Part of the 09-19 rework ($11.40) |
| **D2** | Non-getterable floor uses S_ion = 75 L/s (ion-pump nameplate). Hahn2025 l.377 says the ion pump pumps non-getterables at "≈10 L/s", and the sibling tool in the **same experiment** (molecular_flow_transport) used 10. This understates P_NG by 7.5×. | Same scanner spec; run_1 inputs `s_ion_l_s: 75.0` | Same as D1 | No | Brain audit 09-15, run_2 | Same |
| **D3** | The stored scalar was computed with the 2500 L/s nameplate, but the quantity's declared inputs say `s_eff_dual_neg_l_s: 982.48`. Also, 982.48 is the **single**-NEG (1250 L/s) conductance-limited speed and is mislabelled "dual-NEG". | E1 run_1 `computed.h2_partial_pressure_condition`, limit_check, xval[2] ("dual-NEG 1250 L/s") | E1 experiment (deepseek-v4-pro), when composing results.json | No | Brain audit 09-15, run_2 premise correction | Same |
| **D4** | Required speed (51 L/s) and available speed (982 L/s) were keyed as one quantity/xval, so a DISPUTED flag appeared that blocked the abstract. | E1 run_1 xval[2] claim_key `required_effective_h2_speed_l_s` | E1 experiment (deepseek-v4-pro) | No | **Existing claims table (DISPUTED)**, then PI 09-19 (opus-4-6), then run_2 split the ids | Same |
| **D5** | A k=2 expanded uncertainty was stored as the 1σ `uncertainty` (36.7 L/s), even though its own `uncertainty_source` says "72% (k=2)". This is an internal contradiction. Fedchak p.15 says "all uncertainties reported here are given with a coverage factor of k = 2", but the sentence sits in the H₂O paragraph, so whether the 72% is k=2 is itself slightly ambiguous. The self-contradiction is definite either way. | E1 run_1 quantities[required_effective_h2_speed_l_s] | E1 experiment (deepseek-v4-pro) | No (report quotes run_2's k=1 = 18.4) | Brain audit 09-15, run_2 | Same |
| **D6** | Run_1 claims the 30-day 400 °C treatment "does NOT deplete … the entire RT reduction is the D(T) ratio … not concentration depletion", treating Hahn's "L=25 cm / 26 days" as literal. Hahn's own Eq.3 gives D(400 °C)=3.0e-7 cm²/s, so τ0(L=2.5 cm)=24 d. "26 days" therefore fits L≈2.5 cm (a typo in Hahn), and run_2's DLM series shows near-surface depletion is real. | E1 run_1 results.json l.237 (`premise_corrections`) | E1 experiment (deepseek-v4-pro); tool spec asked it to "flag any inconsistency", and the interpretation was the experiment's | No | Brain audit 09-15 + reader-bg-10 re-read of Hahn, run_2 | Same |
| **D7** | Eckel2018's "1e-11 Pa" was declared a unit slip. It is actually a differential-topology projection. | E2 run_1 premise_corrections[0] | E2 experiment (deepseek-v4-pro) | No | Independent reader-bg-6 (deepseek-v4-pro) 09-15, PI 09-15, run_2/3 coupled-topology calculation | Part of E2 reruns |
| **D8** | He2026a Table 2 values (cm²/s, diffusion-class, taken at unequal temperatures) were used as a pressure-denominated permeability, giving "quartz/sapphire adequate" and `window_permissible_K_cm2_s = 5.65e-9`. This is dimensionally *consistent* (D·A·ΔP/d is still a throughput), so the error is physical: the solubility factor is missing. | E2 run_1 | E2 experiment (deepseek-v4-pro) | No | Brain + PI 09-15, run_2 withdrew it | Same |
| **D9** | "Li atom-loss metrology cannot certify 1e-12" was stated as universal. It holds only for a quadrupole trap. | E2 run_1 | E2 experiment (deepseek-v4-pro) | No (narrowed version reached report) | PI 09-15 (opus-4-6), run_2 | Small |
| **D10** | The PI flagged σ=0 on two headline quantities. Run_3 answered by inserting an invented σ: "nominal 10% effective-speed calibration (illustrative, not measured)", giving 1e-11 ± 1e-12. The replicator invented the same 10%. The final PI then used "1e-11 ± 1e-12" as its ESTIMATE, i.e. an invented σ now feeds the claim-table σ-distance check. | E2 run_3 quantities[allowable_nongetter_load_mbar_l_s]; `replicator-bg-7` | E2 experiment + replicator (deepseek-v4-pro), prompted by PI (opus-4-6) | Via the PI ESTIMATE only | Not caught | — |
| **D11** | Carle2023's "E_D = −0.49 eV" was read as "RT permeability HIGHER than at 70 °C (~4.4× for BSG)". The paper writes ln K = ln K0 − E_D/kT but its own K0=1e-14 and K(70 °C)=1.3e-21 need E_D=+0.49 (the stated sign predicts 1.6e-7, off by 1.2e14×), and Fig.5 shows K rising with T. The wrong convention was **written into the tool spec, and the blind tool_review test enshrined it**: `test_arrhenius_signed_convention_non_degenerate` asserts "negative E_D ⇒ cooling 70 C → RT must RAISE K". | E2 run_2 `invariants.carle2023_BSG_E_D_eV.anchored_to`; `tests/test_window_permeation_budget.py:341-344` | E2 experiment (deepseek-v4-pro) spec, tool_impl (deepseek), tool_review (glm-5.3) | No (report states the corrected sign) | Brain audit 09-15 (gpt-6-astra), PI 09-19, E2 run_3 Fig.5 fit + K0 anchor (deepseek-v4-pro) | Part of 09-19 rework |
| **D12** | The headline `science_pressure_mbar` = 6.571e-13 is reported **in the abstract** with "统计 σ = 1.14e-14 mbar" (1.7%). That σ excludes the term that is 93.6% of the total (P_NG, "upper bound with no measured sigma", per the quantity's own `uncertainty_source`), so the stated precision is about 50× too tight. The body discloses this; the abstract does not. | E3 run_1 quantities[science_pressure_mbar]; `report.tex` abstract; `claims.json` #1–2 | E3 experiment (deepseek-v4-pro); report_writer (deepseek-v4-pro) | **Yes, abstract** | **Not caught.** Final PI (opus-4-6) copied it as `ESTIMATE: 6.57e-13 ± 1.14e-14` | — |
| **D13** | Fake independence reached the report as "两条独立路由" (two independent routes) and "盲复现路由" (blind-replication routes). (a) E3: "throughput identity P=Q/S" vs "particle-number balance n=Q/(S·kT), P=n·kT" are the same algebra and agree to 1e-16. (b) E1: "S_req via hardcoded 5.1e-14" vs "5.1e-12 Pa×0.01" is the same Fedchak constant. (c) E2: "blind species-number-balance replication Q = n·S·kT" = P·S. The final PI's "independent verification" also just re-did the producer's arithmetic from the producer's inputs. | E3 xval[0], E1 run_2 xval[0], E2 run_3 xval[0]; `report.tex` §4 and methods | E3 experiment/tool_impl, replicator, report_writer (all deepseek-v4-pro); accepted by PI (opus-4-6) | **Yes, body + methods** | Not caught in prose. The existing `xvalVerdict` rule (≤1e-6 relative = wiring) should classify (a)–(c) as wiring, but nothing stops the prose. | — |
| **D14** (process) | E3's headline tool `science_pressure_surface.py` and `transfer_reconciliation.py` have **no independent tests**: every E3 tool_review died on GLM `1113` (insufficient balance). The run went on to write, compile and PI-accept the report ("skip + disclose"). This contradicts the project's own escalation rule ("Do not replace independent verification with … a per-experiment disclosure waiver") and PI 09-15 instruction #4. | `E3 results.json computed.reviewer_open_issues`; `conversations/*qcgco4.tool_review-*` (1113) | Infra (GLM balance); decision by E3 experiment and brain (deepseek-v4-pro) | Yes (disclosed in methods) | Not blocked. Final PI STOP does not mention it. | — |
| **D15** (process) | **No `experiment_review_*.md` for any experiment** (E1, E2 or E3). `reviews/` contains only `pi_feedback.md`, and log.jsonl has zero `experiment_reviewer` spawns. The only review was PI arithmetic re-checks. | `reviews/`, `.agent/log.jsonl` | Scaffold | Yes (every claim) | Not caught (finish never ran) | — |
| **D16** (process) | A transient GLM `1302` rate limit (3 attempts) was classified as tool_review **OFFLINE**, and the run halted. Anthropic then ran out of balance and the runner hard-stopped. | `needs-operator.md`; 3× 1302 in tool_review transcripts; `run.log:151` | Runtime / infra | — | Operator | 3.9 days wall; E2 run_2 experiment and ledger_writer died mid-integration, leaving a stale L2.2 |
| **D17** (process) | The run could not finish: DeepSeek returned 402 after the PI STOP while the brain was polishing report.tex. finish, archiving and the registry summary never happened. | `run.log:391`, `last_exit.json` | Infra | Report exists but was never `finish`-validated | — | Report left un-gated |

**Candidate without ground truth (not in the tallies).** X1: E3's budget gives 6.57e-13 mbar for essentially Hahn2025's architecture (vacuum-fired chamber + dual NEG + ion pump). The one real build of that architecture measured 1.5e-12 (gauge, at its x-ray limit) and (3.9±0.3)e-12 (ion-inferred, assuming 100% H₂), 2.3–6× above the budget. The report cites both numbers but never reconciles them with the "1.52× margin". This may be geometry (1000 cm² hypothetical chamber) or metrology, so I cannot call it wrong.

## 2. Counterfactual verdict matrix

C = CATCH (mechanical), Y = MAYBE (needs judgment), M = MISS, – = N/A.

| | M1 anchor | M2 independence | M3 receipts | M4 routing | M5 exp-review | M6 x-proj memory | M7 invariant tests |
|---|---|---|---|---|---|---|---|
| D1 H2 label includes NG | M | M | M | M | – | M | Y |
| D2 75 vs 10 L/s | M | M | M | M | – | M | M |
| D3 2500 vs 982 / single-dual | M | M | M | M | – | M | M |
| D4 required vs available keyed together | M | C* | M | M | – | M | M |
| D5 k=2 stored as σ | M | M | M | M | – | M | M |
| D6 DLM depletion misread | M | M | M | M | – | M | M |
| D7 Eckel "unit slip" | Y | M | M | M | – | M | M |
| D8 He2026a D-as-K | Y | M | M | M | – | M | M |
| D9 Li universal overclaim | M | M | M | M | – | M | M |
| D10 invented σ | – | M | Y | M | Y | M | – |
| D11 Carle sign | Y | – | M | M | – | M | M |
| D12 σ omits 93.6% term (abstract) | M | M | M | M | Y | M | M |
| D13 fake independence (report) | M | C* | M | M | Y | Y | M |
| D14 untested headline tools | – | – | M | **C** | Y | Y | – |
| D15 no experiment review | – | – | – | – | **C**† | Y | – |
| D16 429→OFFLINE, balance halt | – | – | – | **C** | – | Y | – |
| D17 402 before finish | – | – | – | **C**‡ | – | M | – |

\* = an existing Luxas mechanism already flags it numerically (DISPUTED for D4, the 1e-6 wiring rule for D13), so the marginal value is lower. M2 adds class/operator-based rejection plus a prose-independent credit denial.
† = would block finish, but finish was never reached (D17).
‡ = only if another funded provider could take the brain role. Anthropic was funded on 09-20 (opus ledger_writer and PI ran at 13:27 and 14:32).

### Reasons, one line per non-trivial cell

**M1 (anchor pilot)**
- D1–D6: Anchors existed and *passed*. E1's q_RT/q_HT = 5.33e-6 matched Hahn's 5e-6 *while* the D6 interpretation was wrong, and molecular_flow_transport reproduced Hahn's P_NG with 10 L/s while the scanner used 75 as an input. The defects are in labels, inputs and interpretation, not in the code path.
- D7: The natural anchor is Eckel's 1e-11 Pa. M1 would fire on a mismatch (5e-9 vs 1e-11), but run_1 already saw this mismatch and "resolved" it by declaring a typo. The block forces attention but not the right answer.
- D8: It fires only if the agent picks a He2026a-vs-Carle BSG comparison as its anchor; the Carle τ anchor passes because it uses Carle's K.
- D11: The natural anchor exists in `notes/literature.md` (Carle K0=1e-14, E_D, K(70 °C)=1.3e-21); run through the Arrhenius path it gives 1.6e-7 vs 1.3e-21. But run_2 already satisfied "≥1 published number" with the Eq.2 τ anchors (74 d vs 75 d). It is CATCH only if M1 is enforced per code path feeding the headline, and MAYBE as written.

**M2 (independence by construction)**
- D4: If the legs must declare operators, leg B is S_pump·C/(S_pump+C), not q·A/P, so the operator mismatch is flagged mechanically. The existing DISPUTED flag already caught it.
- D13: (a) both legs are "analytic" with identical P=Q/S algebra; (b) both are "literature" with the same constant; (c) both are analytic P·S. Mechanical reject.
- D1–D3, D12: `frame.md` defines only headline ids, not operators, so there is nothing to diff against.

**M3 (receipts)**
- Every defective number was produced by a logged script (the 8.24e-14, 36.7, 1.14e-14, the 1e-16 agreement). Receipts exist, so M3 does not fire.
- D10: CATCH only if the "hard-coded constant returned as result" rule extends to `uncertainty` fields; that σ is a hard-coded 10%.

**M4 (failure routing)**
- D14: GLM `1113` is an infra error. Under M4 it would be switched to a funded provider (opus-4-6 was billing that day) instead of skip + disclose.
- D16: `1302` is a rate limit and should get backoff, not OFFLINE. The balance halt should get a provider switch.
- D17: same, for the brain.
- D1–D11: M4 routes failures it is told about. These were silent wrong-physics successes, so M4 has nothing to route.

**M5 (per-experiment review at finish)**
- D15: all 3 EIDs in claims.json lack review files, so finish blocks (had it been reached).
- D12, D13, D14: a reviewer reading `pathway_comparison.py` / `science_pressure_surface.py` could see n=Q/(SkT)→P=nkT and the σ exclusion, but that is judgment. The opus-4-6 PI with the same material signed off.
- D1–D9, D11: already superseded before finish, so a finish-time review adds nothing.

**M6 (cross-project memory)**
- D14/D16: earlier concrete precedents exist. `ba-neutral-atom-qc-20260829` (34 of 35 tool_review died of GLM 429, zero tests, run continued and disclosed). `Yb-的-shuttling-error/notes/memory.md` (2026-07-03): "API 429 blocked tool_review and tool_impl … Core results … are valid". The brain cannot reconfigure providers, and the Yb entry encodes the *bad* lesson, so this is MAYBE.
- D15: `yttrium-tweezer-20260905` precedent (1 of 6 experiments reviewed).
- D13: the 297nm wiring-agreement lesson (08-25).
- Physics defects: grep across all project `notes/*.md` finds no earlier lesson on coverage factors, Arrhenius sign conventions, species-resolved pressure or vacuum at all, so MISS.

**M7 (physics-invariant tests)**
- D1: the limit q_H2→0 ⇒ P_H2→0 would expose it, but the tool description *defines* P_H2 with the Q_NG term, so a blind author following the description tests the bug. Run_2's adversarial "no nongetter contamination" test was written after the brain named the defect (hindsight).
- D8: a SymPy units check passes, because D[cm²/s]·A·ΔP/d is a valid throughput dimension.
- D11: the blind author *did* write a sign test and it asserted the wrong physics from the description. T→∞⇒K→K0 is impossible because K0 is not in the interface.
- D14: M7 cannot run when tool_review is down.

## 3. False-positive and cost side (this project)

**M1**
- Of 3 experiments, E1 and E2 had anchors and all of them passed. Several are circular: they reproduce the paper's own arithmetic (Hahn P_NG = Q/S, Eckel bare Q/S, Norrgard Q/S, Hahn q_RT/q_HT from the same Eq.4). M1 would rubber-stamp these without catching D1–D6.
- E3 (synthesis) has no clean anchor. The only natural one is Hahn's measured 1.5e-12 / 3.9e-12 for the same architecture (X1), which **mismatches 2–6×**. M1 would block E3, and with no resolvable anchor it risks a deadlock on the synthesis experiment. It is unknown whether that block would be a true or false positive.

**M2**
- About 1 legitimate cross-check would be downgraded: E1's D(300 °C) Hahn Arrhenius vs Chiggiato Fig.20. Both are "literature" class but they are genuinely independent sources.
- The E2 Carle checks (Fig.5 fit vs K0 anchor, Eq.2 τ vs measured τ) are different classes and survive.
- M2 needs operator definitions in `frame.md`, which currently lists only names.

**M3**
- 12 of the 20 `claims.json` entries point at `notes/*.md` rather than output files: declared inputs (1e-12, 1000 cm², 10 L/s), literature quotes (7e-13 cryo, 1e-11 RT, 5e-11 CAVS, 2e-11 IP) and sensitivity phrasing (+70%, −50%).
- `computed.barker2026_cavs_floor_mbar` is a hard-coded literature constant returned as a result. It is legitimate and would be blocked unless cited pass-throughs are whitelisted.
- That is a high false-positive rate for zero true catches here.

**M4**
- Low false-positive risk.
- It needs to tell balance errors (`1113`, 402, Anthropic 400) from rate limits (`1302`): backoff on a balance error is useless.
- On 09-15 Anthropic *and* GLM were both failing, so the correct outcome was still a pause. M4 would not have removed that pause, only the misclassification.

**M5**
- 3 extra reviews (about opus-4-6 cost, feasible on 09-20).
- New deadlock: finish needs a reviewer, and on the final day several providers were at zero balance. That must sit under the existing 3-strike needs-operator exit.
- Here the run died before finish anyway.

**M6**
- Negligible block cost.
- Risk: automatic extraction would have promoted Yb's "429 blocked tool_review … core results valid" as a lesson, which is the wrong one.

**M7**
- About 16 tools. Several are bookkeeping with no natural physics limit (material reconciliation table, pathway ranking, staged plan, figure scripts), so it would force ritual tests.
- M7 does nothing when tool_review is the thing that is down (D14).

**Deadlocks:** M1 on E3 (X1) and M5 at finish under provider exhaustion are the two plausible ones.

## 4. Model attribution

- **Authors of every physics defect (D1–D13): deepseek-v4-pro**, as the experiment agent (all E1/E2/E3 tool specs, results composition and interpretation), replicator and report_writer. glm-5.3 tool_review faithfully tested the defective specs (D1, D11). This is confounded: deepseek-v4-pro produced essentially *all* the research content, so authorship alone cannot separate "model" from "role".
- **Who caught them:**
  - D1, D2, D3, D5, D6 and D11 were caught by the brain's read-only audit on 09-15 (**gpt-6-astra**), which reread the preserved JSONs against the sources.
  - D7 was caught by a **deepseek-v4-pro** reader given a narrow re-read task.
  - D11's final resolution (Fig.5 fit + K0 anchor) came from a **deepseek-v4-pro** experiment once it was told what to check.
  - D4 was caught by the existing **scaffold** (DISPUTED).
  - D9 was caught by the PI (**opus-4-6**).
- **What got through:** D12 and D13 (the two that reached the report) passed **claude-opus-4-6** as PI, which re-did the producer's arithmetic from the producer's inputs, called that "independent verification", and copied the understated σ into its own ESTIMATE.
- **Reading:** the same base model that authored the errors fixed them when the scaffold gave it a targeted check, and a stronger reviewer model missed the errors whose check was not structurally forced. In this project the evidence favours scaffold (what gets forced and checked) over base model. The one pro-model data point is that the gpt-6-astra brain audit was the most productive catcher (6 of 11 physics defects).

## 5. Summary

1. There are 13 ground-truth research defects plus 4 process defects. 11 of the 13 were caught and fixed by the run itself: 6 by the gpt-6-astra brain audit, 1 by the existing DISPUTED flag, plus readers and the PI. Only D12 (σ omits the 93.6% term, in the abstract) and D13 (fake "independent" cross-checks) reached report.tex.
2. **M4** would mechanically catch 3 of 4 process defects (D14, D16, D17, all provider-balance/rate-limit failures). **M5** would catch the fourth (D15: no experiment review at all), but only at a finish the run never reached. Neither catches a physics defect.
3. **M2** would mechanically catch 2 of 13 (D4, D13), and the existing wiring/DISPUTED rules already flag both numerically. It is the only mechanism that hits a defect that reached the report.
4. **M1**: 0 of 13 mechanically (3 MAYBE: D7, D8, D11). Its anchors all *passed* while D1–D6 were wrong, and it would likely deadlock E3 on the unreconciled Hahn measurement. **M7**: 0 of 13 (1 MAYBE); the blind test for D11 actually enshrined the wrong sign from the spec. **M3**: 0 of 13, with about 12 of 20 claims as false positives. **M6**: 0 of 13 physics (only process MAYBEs).
5. Model attribution: all physics defects were authored by deepseek-v4-pro (confounded, since it did all the production). The two that reached the report passed an opus-4-6 PI, and the same deepseek model fixed its errors when pointed at them. This project supports "scaffold explains more than base model".
