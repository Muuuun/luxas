# Backtest: ba-neutral-atom-qc-20260829 (E1–E9, $160.28, SIGKILLed at the cost cap)

Project: `/Users/muqiao/Documents/sisyphus-projects/ba-neutral-atom-qc-20260829/project` (droplet, read-only).
Run window: 2026-08-29 10:35 to 2026-08-31 11:34 UTC. `finish()` was never called (0 `finish` tool calls in `.agent/log.jsonl`). `run.log` ends with `[FATAL] Cost limit exceeded at usage record: $160.28 > $160`.

Cost by model (`.agent/usage.log`): deepseek-v4-pro $107.54, claude-opus-4-6 $43.66, claude-sonnet-4-6 $6.04, kimi-k2.5 $3.03, glm-5.2 $0.00 (every call was a 429), gpt-5.6-terra $0.00.

How models map to agents (from `"model"` fields in `.agent/conversations/*` and `checkpoint.jsonl`):
- deepseek-v4-pro: brain (checkpoint: 197/197 deepseek), all 14 experiment agents, tool_impl, replicator, reader, report_writer
- claude-opus-4-6: experiment_reviewer (all 17), ledger_writer, PI (inferred: `run_config.json` model = "opus"; PI is the flagship slot)
- sonnet-4-6 / opus / kimi: reviewer (report); kimi-k2.5: illustrator_write
- glm-5.2: tool_review (35 of 35 spawns returned 429)
- gpt-5.6-terra: math (1 spawn, failed with "No API key for provider: openai-codex")

---

## Step 1: Defect catalog

### Research-quality defects

| id | defect | where | author (agent/model) | in report / abstract? | caught? by what, cost |
|---|---|---|---|---|---|
| **D1** | **Intermediate-state scattering is left out of the gate error budget, and the run's own stored numbers make it about 10⁴× the headline error.** E7 `results.json` stores `rho_ii_anchor = 0.5625` (the 5d6p ¹F₃ᵒ intermediate is 56% populated at Shi2025's operating point, Δ_f = 20 GHz < Ω_df = 30 GHz). The same file stores `intermediate_1F3_linewidth_proxy_hz = 5.88e7` (the 17 ns proxy). That gives Γ_sc = γ_f·ρ_ii = 3.3×10⁷ s⁻¹. With the report's own ε = (3/4)·(2π/Ω)·Γ: ε_sc ≈ 0.17 at 150 MHz (n=53, 2 W); ≈ 0.43 at 57.8 MHz (n=100, 2 W); ≈ 4 (gate impossible) at 5.78 MHz (n=100, 20 mW, scenario S_C). The report instead gives Ba totals of 2.49e-5 (2 W) and 3.0e-5 (20 mW) and says "Ba ~3× better than Sr in total". The reference species use single-photon drives (Sr, Yb) or run far-detuned (Rb). So the "same model, equal footing" comparison is broken in Ba's favour. Even if γ_f were 10× smaller, ε_sc ≥ 0.017 ≫ 1e-5. | `data/experiments/E7_ba_equal_power_rabi/runs/run_1/results.json` (rho_ii_anchor, intermediate_1F3_linewidth_proxy_hz, `consequence`: "E6's decay-only model omitted this"); report.tex §4 (lines ~190–225) + abstract | Error model: brain plan + E6 experiment (deepseek-v4-pro). E7 experiment (deepseek) found ρ_ii and wrote "report states the scattering penalty". Brain (deepseek) deferred E7.1 and the report only mentions ρ_ii. Missed by E6/E7 experiment_reviewer (opus-4-6) and by the PI (opus-4-6) across 7 STEER rounds. | **Yes, in the abstract** ("total decay-plus-blockade error nonetheless keeps Ba ~3× better than Sr"; "at 2 W … below all four references") | **Never caught.** `grep -i scatter reviews/*.md report/report.tex` finds 0 hits. |
| **D2** | Ba two-photon Ω_eff was treated as n-independent (150 MHz used at n=100). The f→g leg couples to the Rydberg state, so Ω_eff ∝ n*^-3/2. This propagated E4 → E6 (Ba/Sr ratio 0.292) → E7 (2.916 at 20 mW). E8 corrected it to 0.756 / 7.56. E6's blind replicator took the same 150 MHz input and "agreed" at 0.292, so the corroboration was false. | E4 L2.4 item 2; E6 frontier; E7 `ratio_decay_ba_vs_sr_20mW = 2.9158`; memory.md "E8 correction" | E4 experiment (deepseek-v4-pro); missed by E4, E6 and E7 reviewers (opus) and the E6 replicator (deepseek) | Corrected before the final report (report uses 7.56 / 0.756) | **Caught** by the E8 experiment_reviewer r1 (opus), "Issue 1: … uses Ba Rabi Ω_eff = 15 MHz evaluated at n=53". It lived from E4 to E8 (~1 day). It cost E8 plus E8 r2. |
| **D3** | **The Ba lifetime code path failed its own validation, and the report calls it validated.** E3's frozen acceptance test (the constant-δ model reproducing Beterov Rb and Pagano Sr) failed: Rb 50S 2.76 µs vs 65.2 µs (24×), Sr 60³S₁ 2.81 µs vs 50–80 µs. E3's verdict is **REFUTED**. The Ba numbers then came from a different branch ("exact hydrogenic + QD energies"), which was checked only against its own n³ scaling, never against a published lifetime. RESEARCH.md requires validation "against at least one published Ba Rydberg lifetime"; none was done. The report says the model was "validated against the references (ARC reproduces Beterov2009 Table VII to ~5%; pairinteraction reproduces strontium …)". ARC and pairinteraction are different codes from the Ba path. | notes/experiments.md L2.3 lines 21–27 (FAIL rows + "Verdict: REFUTED"); report.tex ~l.284–287 | E3 experiment (deepseek) recorded REFUTED honestly. Brain and report_writer (deepseek) wrote "validated". The E3 reviewer (opus) returned `satisfied`. | **Yes**: Methods paragraph plus the abstract framing "does not survive validation" | **Never caught.** The PI praised the result as "validated against Rb/Sr references". |
| **D4** | E5's headline δ(¹F₃) = 0.054 was copied from δ(¹G₄) instead of fitted. The correct value is 0.048 (Neukammer δ₃ = 0.047(5), Förster inversion, Table V 57f). | E5 run_1 results.json r1 → experiment_review_E5_…_r1.md Issue 1 | E5 experiment (deepseek) | Fixed before the report (0.048 used) | **Caught** by the E5 reviewer r1 (opus) using the harness blind replicator (deepseek) estimate 0.048. Cost: one revise round. |
| **D5** | σ mislabelled: `c6_rb87_78s` has uncertainty 0.1 GHz µm⁶ while its own `uncertainty_source` says "ARC-vs-pairinteraction method spread 0.6%" (≈ 19). It was re-keyed to ±200. | E4 run_1/results.json (`"uncertainty": 0.1`) | E4 experiment (deepseek) | Fixed (±200 in report) | **Caught** by the PI (opus) STEER, "re-key to +/-200". |
| **D6** | A cross-validation that was not independent: E4's Rabi xval method_a (Ω_dfΩ_fg/2Δ) is algebraically identical to method_b. E8's decay-ratio legs "differ only in n* vs bare n (same formula)". | E4 L2.4 item 8; experiment_review_E8_…_r2.md INDEPENDENT line | E4 / E8 experiment (deepseek) | E4 entry removed; E8 still reports the "blind 7.56 ± 1.5" as a replication | **Caught** by the E4 reviewer r1 and the E8 reviewer r2 (opus) |
| **D7** | Wrong physics priors from the PI. It told E3 to "reproduce the hydrogenic ℓ=4 lifetime τ ∝ n⁵/ℓ⁴" (wrong for fixed ℓ; the answer is n³, exponent 2.992). It also gave a δ(¹F₃) prior of 0.1–0.3 and "lifetime likely 0.5–2 ms" (E5 found 0.048, and δ>0 *shortens* τ). | reviews/pi_feedback.md l.17, l.38 | **PI (claude-opus-4-6)** | No | **Caught** by the E3 and E5 producers (deepseek) through computation |
| **D8** | Provenance misattribution. The report's Methods say "the human decisions taken during the run were the directive to descope … the re-keying … and the deferral …". No operator directive exists (there is no `notes/directives/`, and no monitor directive); all three were PI-agent STEERs or brain FRONTIER-DECLINEs. | report.tex ~l.297–300 | brain / report_writer (deepseek) | Yes (Methods) | **Never caught** |
| **D9** | Citation misattribution: measured 99.9% Sr fidelity was cited to Pagano2022 (theory) instead of Scholl2023. | lessons.md 2026-08-31 entry | brain (deepseek) | Fixed | **Caught** by the PI STEER (opus) |

Not listed as defects, because there is no definitive ground truth:
- the 7.1 ms vs 0.30–0.37 ms dispute (my own hydrogenic check, τ ≈ 0.093 ns·n³(ℓ+½)² ≈ 0.41 ms at n=60, ℓ=4, supports the project against Shi2025);
- the Ba C₆ factor 2–2.5 vs Shi2025 (open);
- using δ_F = 0.048 for the n′=4–8 decay channels, where NIST 6s4f ¹F₃ at 34736 cm⁻¹ implies δ(4) ≈ 0.12 (a few-% ω³ effect, not definitive);
- the post-hoc "1.62 = 2π/3.86 prefactor" explanation of the Yb/Sr error-model mismatch.

### Process defects that damaged research quality

| id | defect | evidence | author | effect |
|---|---|---|---|---|
| **P1** | **No adversarial tests anywhere.** 35 of 35 tool_review spawns (glm-5.2) returned 429 `{"code":"1113","message":"余额不足或无可用资源包,请充值。"}` (billing, not rate limit). 34 of them are 3-line conversations that died at turn 1; the 35th is 5 lines and also ends on 429. `find data/experiments -path '*tests*' -name '*.py'` returns 0, and no `tests/` directory exists in any of E1–E9. The math agent also died (no openai-codex key). The brain re-ran the spawn once, confirmed billing, and turned **13** `method_blocked` entries into `accept-with-disclosure` in one batch (E9 applied `method_blocked_resolved ×13`). | memory.md "METHOD-BLOCKED re-run"; conversations/*tool_review* | glm provider billing (infra); brain (deepseek) chose disclose over reroute | Tool correctness rests on 3 physics anchors plus the reviewer. The tool bugs D2/D4 went to reviewers instead of unit tests. |
| **P2** | The E4 r2 review is marked "REVIEW-INCOMPLETE: no DISCRIMINATOR+SCALING for ba_138_c6_6s78g_1G4_m4, ba_138_c6_6s54g_1G4_theta_pi2, c6_rb87_78s — NO REVIEW for those quantities", yet it still carries `VERDICT: satisfied`. The Ba C₆ quantities (2–2.5× disputed) drive the total-error verdict and were never re-reviewed. | reviews/experiment_review_E4_interaction_strength_r2.md | experiment_reviewer (opus); harness accepted it | Ba C₆ band stays unresolved; "Ba ~3× better in total" rests on an unreviewed quantity |
| **P3** | **The run could not finish.** At the first "Final review" request (08-30 12:17) spend was ~$111. The next ~$50 went to 7 PI STEER rounds. Figures looped with a dead illustrator (kimi-k2.5 404 from 08-31 08:07). The PI stop verdict was withheld 4× for "no independent estimate recorded for headline quantities …, **Named**, …". "Named" is the prose bullet "Named (non-scalar) deliverables" in frame.md parsed as a headline id, so that gate could never be satisfied (since fixed: `claims-table.ts` `frameHeadlineSkipped`). The run was SIGKILLed mid-`read` with a compiled but unsubmitted report. | pi_feedback.md l.194/241/276/309; log.jsonl lines 317–522; run.log | harness (parser, freeze, soft cap) + kimi provider + PI loop (opus) | ~$50 (31%) with no research content; no finish-gate checks ever ran |
| **P4** | Figures pass lint but are unreadable. There is a 1.2 in dead zone, 5 of 7 frontier curves are clipped at 1e-2, the lifetime plot has duplicate legend text, and the level diagram is page-tall with wavy arrows for laser drives. `figlint-pdf` returned `clean` on all 3. | notes/figure-pipeline-review-2026-09-02.md §1–3 | illustrator_write (kimi), figure_auditor (sonnet), plot scripts by brain (deepseek) | $93 in the figure phase, $3 of it on drawing; since fixed by figures v4 |

---

## Step 2: Counterfactual verdict matrix

C = CATCH, Y = MAYBE, M = MISS, – = N/A. "Existing" = a mechanism that already fired in this run.

| | M1 anchor pilot | M2 independence | M3 receipts | M4 failure routing | M5 per-EID review | M6 x-project memory | M7 physics-invariant tests | existing |
|---|---|---|---|---|---|---|---|---|
| **D1** scattering omitted | **Y**: the natural anchor is a published *two-photon* gate error budget where intermediate scattering is an itemized term (Rb 420/1013 nm: Levine2019/Evered2023). The run anchored its error model on Sr/Yb *single-photon* gates (Pagano/Peper, report §2), where the term is absent, so the pilot passes. | **M**: no cross-validation leg is involved; any second leg would share the decay+blockade model | **M**: every number has a receipt | – | **Y**: the E7 reviewer's DISCRIMINATOR asked for "full 3-level master-equation … with intermediate-state decay". There is no results.json key, so M5 would downgrade the 20 mW Rabi and its dependents, but only if DISCRIMINATOR computations count as "requested analyses". Even then it hedges the claim without exposing the ~10⁴× magnitude. | **C** (by the spec's definition): `rb87-2photon-fund-limit` (2026-05) report eq. "ε_S = Γ_e T_S (Ω₁/2Δ)²", "Intermediate-state scattering" is exactly the missing term. Actually applying it still depends on an agent. | **M**: the frontier tool's description is decay+blockade; its limits (τ→∞, U→∞) pass. Only an "adiabatic validity ρ_ii ≪ 1" assertion on `rabi_power_scaling` would fire, which is not a limiting case a blind author would pick from that description. | none |
| **D2** n-independent Ω | **Y**: fires only if the anchor is at a different n than the one tested (e.g. Rb ⟨6P\|r\|nS⟩ at two n). The single Shi2025 n=53 anchor passes. | **Y**: the E6 blind replicator and producer shared the 150 MHz input and the same analytic class, so M2 would strip the false 0.292 corroboration. It would not locate the scaling error. | **M**: 150 MHz has a literature receipt; the n=100 value was an input, not a returned result | – | **M**: E4/E6/E7 already had reviews (satisfied); the fix came from an existing review (E8 r1) | **Y**: the earlier projects (rb87-2photon, ba-atom-qc-feasibility) use n-dependent core→Rydberg dipoles, but neither states it as a lesson | **Y**: Ω_fg ∝ n*^-3/2 is a textbook large-n limit a blind author of a "Rabi vs n" tool would plausibly test, if the description exposes n | E8 reviewer r1 |
| **D3** lifetime path unvalidated, reported as validated | **C**: the harness would have printed "computed Rb 50S 2.76 µs vs published 65.2 µs (Beterov2009 Tab. VII)" and blocked. That mismatch is literally in the E3 ledger. It forces an in-domain anchor: Rb nF (Theodosiou 1984), or Ba 6snf ¹F₃ lifetimes n=11–40 (Zaki Ewiss 1997, already in `ba-atom-qc-feasibility` notes/methodology.md). | **Y**: Gordon closed form (analytic) vs QD Numerov (numerical) could be declared different classes; the replication reused Gordon (same as E3), so that part loses credit | **M** | – | **Y**: the reviewer would read runs showing REFUTED, but E3's actual reviewer did, and passed it | **C**: `ba-atom-qc-feasibility` (2026-05) holds both a published Ba Rydberg lifetime source (Zaki Ewiss 1997 MQDT 6snf ¹F₃/³F lifetimes) and the lesson "SAE Coulomb approximation systematically underestimates [Ba] lifetimes … core-valence correlation". Either kills "no published Ba lifetime exists" (frame.md). | **M**: the δ→0 hydrogen limit passes because the Ba path *is* hydrogenic; the failure is out of domain (large δ) | none |
| **D4** δ_F copied from δ_G | **C** (borderline): the published anchor Neukammer δ₃ = 0.047(5) vs 0.054 is 1.4σ; it fires only at tolerance ≤ 1σ | – | **C**: the "result" is another quantity's constant returned unchanged, with no fit receipt | – | **M**: already reviewed | **M**: the prior project holds the *number* δ₃ = 0.047(5), but M6 bars domain numbers | **Y**: a fit-reproduces-input-levels test would fire; not a limiting case | E5 reviewer r1 + blind replicator |
| **D5** σ = 0.1 vs stated 0.6% | **M**: the value is right | – | **Y**: fires if σ counts as a "value" needing a receipt (σ=0.1 is produced by no computation) | – | **M** | **M** | **M**: dimension check passes | PI |
| **D6** algebraically identical legs | – | **C**: same method class plus same formula | **M** | – | **M** | **M** | **M** | E4 r1 / E8 r2 reviewers |
| **D7** PI n⁵/ℓ⁴ and δ_F priors | – (PI output, not an experiment) | – | – | – | – | **M** | – | E3/E5 producers computed it |
| **D8** "human decisions" misattribution | **M** | **M** | **M**: numeric-only | **M** | **M** | **M** | **M** | none |
| **D9** Sr 99.9% citation | **M** | **M** | **M**: the value is right, only the cite is wrong | **M** | **M** | **M** | **M** | PI |
| **P1** 35/35 tool_review 429, 0 tests, 13 disclosures | **M** | **M** | **M** | **C**: billing 429 = infra, so switch provider and never "skip + disclose". Code 1113 is balance exhaustion, so backoff alone would loop; it needs a provider switch. | **M** | **M** | – (moot: M7 lives inside tool_review, which never ran; **M7 would have added zero tests in this project**) | none (disclosed) |
| **P2** E4 r2 "NO REVIEW" but satisfied | **M** | **M** | **M** | **M** | **Y**: the file exists, so the existence check passes. The requested ARPACK / full-channel C₆ has no key, so Ba C₆ claims would be downgraded, but they are already carried as a band. | **M** | **M** | none |
| **P3** never finished, ~$50 in STEER/figure loops | **M** | **M** | **M** | **Y**: catches the kimi 404 sub-cause (provider switch); does not fix the "Named" parse bug or the PI estimate loop | **M** (adds another finish gate: risk up) | **M** | **M** | since fixed (09-22 freeze/softcap, frameHeadlineSkipped) |
| **P4** figures | **M** | **M** | **M** | **M** | **M** | **M** | **M** | since fixed (figures v4) |

Tally across 13 ground-truth defects (9 research + 4 process):
- CATCH: M1 2 (D3, D4-borderline); M2 1 (D6, already caught by an existing reviewer); M3 1 (D4, already caught); M4 1 (P1); M5 0; M6 2 (D1, D3; agent must still apply the lesson); M7 0.
- Both high-impact uncaught physics defects (D1, D3) are CATCH only under M1 or M6. D1 gets only MAYBE under M1.

---

## Step 3: False-positive and cost side (this project)

- **M1 anchor pilot.** Natural published anchors:
  - E2: NIST levels.
  - E3: exists, but the only accessible in-domain anchor was in another project's corpus.
  - E4: Rb/Cs C₆ has ARC/literature anchors; the Ba Rabi part has **none** (the Ba two-photon Rabi is unmeasured, anchored only to Shi2025 theory).
  - E5: Neukammer.
  - E6: Pagano/Peper, but computed/published = 1.62×, so a tolerance tighter than 2× blocks legitimate work.
  - **No reasonable anchor:** E7 (Ba power scaling, unmeasured), E8 (claim closure), E9 (bookkeeping).
  - E1: the isotope table is a lookup; its HFS machinery was anchored on Rb87, which is fine.

  So about 3–4 of 9 need an exemption. **Deadlock risk:** E3 blocks on the Rb nS anchor (out of domain, 24× off). If the agent does not find an in-domain one (Rb nF/Ba 6snf, paywalled per memory.md), E3 cannot proceed and the crux experiment stalls.
- **M2.** It would downgrade legitimate agreements:
  - Rb C₆ ARC vs pairinteraction (both pair-potential perturbative/exact-diag, different codes, 0.6%);
  - Cs C₆ (7.2%);
  - the lifetime "two independent routes" (hydrogenic Gordon vs QD Numerov share the single-electron radial-sum class).

  That is ~3 downgrades, one arguably correct (the lifetime). Losing the Rb C₆ `converging` status would re-open a settled dispute and add PI rounds. frame.md defines no small-N operator for Ω(n) or the error model, so the operator diff has nothing to compare.
- **M3.**
  - Lookup deliverables equal literature values with no execution: abundance 71.698%, 133Ba t½, level wavelengths 648.47/657.87 nm, 3P₁ linewidth, and the Shi2025 inputs (150/200 MHz, −570/−10000 GHz µm⁶) quoted in the report. The E1/E2 deliverables would be blocked unless literature-cited inputs are exempt.
  - Estimate: ~8–12 report values need a "cited-input" class.
- **M4.** No false positives here, but in this run the only tool_review route was glm-5.2. Without a configured alternate provider, M4 turns "skip + disclose" into an infinite retry. It needs a provider-switch table plus a terminal escalation, or it creates a new deadlock.
- **M5.**
  - Every EID cited has a review file (E1–E9 all reviewed), so there are 0 extra reviews.
  - The "requested analysis must map to a key" clause is the costly one. DISCRIMINATOR `computation:` fields routinely ask for impossible things: "measure the 6s60g ¹G₄ radiative decay rate", "measure blockade shift at known inter-atom spacing", "MCHF wavefunctions", "ARPACK pair diagonalization".
  - Treated as requests, they downgrade essentially every headline (τ_rad, C₆, Rabi, ratio). With downgrade-as-blocking this is a guaranteed finish deadlock; it needs a runnable/unrunnable distinction.
- **M6.** The candidate lessons for D1/D3 exist (rb87-2photon-fund-limit, ba-atom-qc-feasibility), but the existing `<past_research>` digest already pointed at those projects (same user, same domain), and the brain did not open them. M6's marginal value depends on injecting the *lesson text*, not a pointer. Noise cost: low.
- **M7.**
  - Zero marginal value here: tool_review never ran (P1).
  - Where tools are lookups or bookkeeping (E1 isotope table, E9 JSON repair), a mandatory limiting-case test plus a SymPy units check per tool is performative.
  - Where it could bite (Rabi vs n), the limit is only as good as the description the experiment wrote.

New deadlocks: **M1 on E3** (only out-of-domain anchors accessible), **M5 with unrunnable DISCRIMINATOR requests**, **M4 with a single dead provider**. All three need an escape hatch that lands in `needs-operator.md`, not a silent block.

---

## Step 4: Model attribution

| defect | authored by | missed by | caught by |
|---|---|---|---|
| D1 | E6/E7 experiment + brain (deepseek-v4-pro) | E6/E7 reviewers + PI ×7 (opus-4-6), report reviewer (opus/sonnet) | nobody |
| D2 | E4 experiment (deepseek) | E4/E6/E7 reviewers (opus), E6 replicator (deepseek) | E8 reviewer (opus) |
| D3 | brain/report_writer wording (deepseek); E3 (deepseek) itself flagged REFUTED | E3 reviewer + PI (opus) | nobody |
| D4 | E5 experiment (deepseek) | – | E5 reviewer (opus) + replicator (deepseek) |
| D5 | E4 experiment (deepseek) | E4 reviewer (opus) | PI (opus) |
| D6 | E4/E8 experiment (deepseek) | – | reviewers (opus) |
| D7 | **PI (opus-4-6)** | – | E3/E5 experiments (deepseek) |
| D8 | brain/report_writer (deepseek) | PI, reviewer (opus/sonnet) | nobody |
| D9 | brain (deepseek) | – | PI (opus) |
| P1 | glm-5.2 billing (infra) + brain disclose decision (deepseek) | – | – |
| P2 | experiment_reviewer (opus) + harness accepting it | – | – |
| P3 | harness parser/gates + kimi provider + PI loop (opus) | – | – |
| P4 | kimi (drawing), sonnet (audit), lint | – | – |

Reading for "base model explains more than scaffold":
- deepseek authored 7 of 9 research defects, but it was the only producer model, so this is confounded.
- Opus caught 5 (D2, D4, D5, D6, D9), authored one (D7), and missed both surviving high-impact defects (D1, D3), even though D1's inputs and D3's REFUTED verdict were sitting in artifacts it read.
- The catches that worked were **scaffold** catches: a reviewer with a blind-replicator number, and a PI re-keying σ. The misses were **obligation gaps** that no model of either family filled unprompted.

This project does not support "base model explains more than scaffold".

---

## 5-line summary

1. Ground truth: 13 defects (9 research, 4 process). Two high-impact physics defects reached the abstract uncaught. D1: the omitted intermediate-state scattering is ~10⁴× the reported Ba total error, from the run's own stored ρ_ii = 0.5625 and γ_f. D3: a lifetime code path whose Rb/Sr validation was REFUTED is reported as "validated". Existing reviewer/replicator/PI mechanisms caught 6 others.
2. M1 (anchor pilot) catches 2 mechanically (D3 and borderline D4) and is MAYBE on D1/D2. It needs exemptions for 3–4 of 9 experiments and risks an E3 deadlock.
3. M4 catches P1 (35/35 tool_review 429s turned into 13 disclosures) but needs a provider-switch table. M6 catches D1 and D3 by definition: `rb87-2photon-fund-limit` has the scattering term, `ba-atom-qc-feasibility` has Ba 6snf lifetime anchors. Both still depend on an agent applying the lesson.
4. M2 catches only D6 (already caught) and would downgrade ~3 legitimate agreements. M3 catches only D4 (already caught) and would block ~8–12 legitimate literature-lookup values.
5. M5 catches 0 mechanically; its "requested analysis" clause would deadlock on unrunnable DISCRIMINATOR requests. M7 catches 0 and was moot, because tool_review never ran. The dominant failures (D1, D3, P3) were obligation and harness gaps missed by both deepseek and opus, not base-model gaps.
