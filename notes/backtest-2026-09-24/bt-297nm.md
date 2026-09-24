# Backtest: single_photon_297nm (droplet `sisyphus-projects/manual/projects/single_photon_297nm`)

Run 2026-08-24 16:48 → 2026-08-26 01:48, $151.49, 7 experiments (E1–E6 run, E7 descoped), ended via `finish()` (3 finish calls + 2 operator "call finish now" directives). Profile `dual`. Models (usage.log): deepseek-v4-pro 1527 calls / $112.06 (brain, experiment, tool_impl, report_writer, contradiction/prior-art auditors); glm-5.2 449 / $12.96 (tool_review); claude-opus-4-6 374 / $19.77 (PI reviewer, experiment_reviewer, ledger_writer); kimi-k2.5 (illustrators); haiku; gpt-5.6-terra 1 call (failed: no API key). Brain model is inferred (brain conversation is not persisted; the brain followed the profile until 09-06, so deepseek-v4-pro).

Cost by phase (usage.log timestamps): E1–E3 + v1 report $60.53 → after the 08-25 11:16 "synthesize" directive (E4–E6) $45.78 → after the 17:58 "descope E7" directive (figures, auditors, finish loop) $33.89 + $6.66 + $4.62.

Everything below was read on-box (read-only) or from a scratch copy of notes/, reviews/, report/, and data/experiments (no papers). I ran one local numpy/scipy toy (my laptop, no billing, not on the droplet) to size D1.

---

## 1. Defect catalog

| id | defect | where | author (agent/model) | reached report / abstract | caught? by what | cost |
|---|---|---|---|---|---|---|
| **D1** | **E5 "blockade leakage" measures a different observable than the term it replaces.** `leakage = 1 − P_gg(no decay)`: starts in \|gg⟩, measures only the return **population**. There is no conditional phase, no \|01⟩/\|10⟩ branch, and the pulse is a Gaussian Rabi pulse without Pagano's detuning chirp. The value scales as Ω⁴ (9.6e-7 → 2.555e-4 is 266× for 4× Ω), not the Ω²/V² of the finite-blockade gate error it replaces. My 3-level toy using E5's own V = −152 MHz and \|rr⟩ overlap 0.469 reproduces E5's population number (1.8e-4 at 40 MHz, 6.6e-7 at 10 MHz), but the \|11⟩ branch picks up a 0.126 rad phase error, which is **~2.4e-3** average-gate infidelity (3δ²/20). That is ~10× E5's number. A 135× gap to the closed form (3.5%) was dismissed in one clause: "scalar-shift formula invalid in strong-mixing regime". Caveat: E5's reduced basis has several bright eigenstates whose light shifts may partly cancel (two-eigenstate Förster literature, read in the 07-27 single_photon_Rydberg project), so the true size is unsettled. The observable mismatch itself is definite. | `E5/scripts/blockade_gate_master.py:297-322` (e_ops=[P_gg]); results.json `cross_validation_resolved[1]` | Observable defined by the E5 experiment agent (deepseek-v4-pro) in the tool description. tool_impl deepseek-v4-pro; tool_review glm-5.2 (`test_f40_lt_f10_ordering`, "gate returns to \|gg⟩"); experiment_reviewer claude-opus-4-6 said **satisfied** (it had Pagano Eq. 4–6, the phase condition, and "V/ℏΩ<10 cannot maintain solution" in context; the run is at V/Ω = 3.8); brain deepseek adopted it (memory `E5-CORRECTION-FLIP`). | **Yes, abstract** ("leakage 2.555×10⁻⁴ … 4.3× smaller") | Not in-run. Caught post hoc by architecture-review-2026-08-26 (human + Claude) | Underlies E6 and the rewrite; roughly $45 of E4–E6 plus most of the $34 of polish went into a headline that rests on it |
| **D2** | **E6 substitutes D1's population metric for E4's ε term and flips the headline.** Claims F(40) 99.963% > F(10) 99.909%, optimum 28 MHz / 963 mW / 99.975%, "recoil ceiling does not survive fast driving". Nobody compared the two observable definitions. All four E6 "cross-validations" are wiring checks (same data re-summed). With the phase-inclusive ~2.4e-3 at 40 MHz, F(40) ≈ 99.75% < F(10) ≈ 99.90%, so the flip probably reverses. | E6 results.json `corrected_frontier`; report abstract, §4, §5 | E6 experiment deepseek-v4-pro. The brain's (deepseek) task text said "replace E4's term with E5's leakage". The operator directive at 17:58 also said to integrate 2.555e-4 (a human propagated it too). | **Yes, headline and title** | Not in-run | as D1 |
| **D3** | **C₆(75) = 3482 GHz·μm⁶ is an n¹¹ extrapolation from a near-Förster perturbative value, and the direction of its error was asserted wrong.** E2's own data contradict n¹¹: C₆(60)/C₆(40) = 15.2, while n¹¹ predicts 86. E2 also flagged these C₆ as "must not be used as naive design inputs". E3 and E4 then called 3482 a "LOWER bound → leakage even smaller". The brain FRONTIER-DECLINEd the pair-potential follow-up on that argument, and the v1 report shipped "blockade negligible, 6.9e-5". E5 found V(4 μm) = −152 MHz, 5.6× *smaller*. The final report still carries E3's 6.92e-5 at 10 MHz, computed with the refuted V = 850 MHz. | `E3/scripts/fidelity_scan.py:149-151`; E3 Limitations #3; memory.md FRONTIER-DECLINE E_3 | E3 experiment + tool_impl deepseek-v4-pro; brain deepseek (decline). PI claude-opus-4-6 made the **same** wrong-direction prediction. The E4 experiment_reviewer (opus-4-6) called the extrapolation "Acceptable". | v1 abstract yes (recoil-limited, leakage negligible); final report keeps the stale 6.92e-5 | Yes, by E5, an existing mechanism: the premise-correction channel plus full diagonalization. That only happened after an operator directive forced synthesis. | v1 report phase ($60) shipped a wrong negligible-leakage claim; PI said STOP twice on it |
| **D4** | **E2 "pure sin⁴θ", anisotropy ~10⁶, r_b(θ=0) = 0.32 μm are artifacts.** The perturbative C₆(0) ≈ 1e-6. E2's **own** full diagonalization at θ=0, n=50 gives C₆ = 1.22 GHz·μm⁶ (overlap 0.99999, clean vdW regime), so the ratio is 56×, and r_b(0) ≈ 3.3 μm, not 0.32. The published Vermersch constant term (0.269, 4% of max) was not reproduced and was explained away as a "Zeeman-field" effect, but at θ=0 the S₁/₂(½)+D₅/₂(5/2), M=3 channel is dipole-allowed. The sin4_fraction "cross-validation" leg is "analytically forced", i.e. it restates the prediction. The qualitative Q2 answer ("yes, angle dependent") and "fails on-axis at 4 μm" roughly survive. | `E2/runs/run_1/data/cross_validation.json` `n50_p3half_m3half_theta0` vs `analysis.json` c6_theta0; results.json `benchmark.conclusion` | E2 experiment + tool_impl deepseek-v4-pro; tool_review glm-5.2; ledger_writer opus-4-6 propagated the rationale; **no experiment_reviewer** | **Yes, abstract** ("pure sin⁴θ"); §2 carries 10⁶ and 0.32 μm | Not caught | — |
| **D5** | **The "Numerov reproduces the published D2 matrix element to 0.37%" anchor is circular.** `d2_reduced_a0` comes from ARC's literature-DME table (script docstring lines 4–9; results.json method_a is "ARC (Steck literature D2 value)"), so acceptance criterion (a) compares literature to literature. The report lists it as one of "five literature benchmarks" validating the machinery. Physics impact is low: the Manthey n=38 anchor is genuine Numerov and passed at 12.5%. | `E1/scripts/dipole_matrix_elements.py:4-9,148-152`; E1 results.json cross_validation[1]; ledger L2.1 l.27; report abstract + Methods | tool_impl deepseek documented it correctly. The mislabel "ARC Numerov radial integration gives 5.9783" was written by ledger_writer **claude-opus-4-6**, which had the "Steck literature" string in its input. report_writer deepseek propagated it. | **Yes, abstract** | Not caught | — |
| **D6** | **The report's "one remaining caveat" is ill-posed.** It says the leakage "rests on the defect at integer n=75, while the operating level is n≈75.3". The principal quantum number is an integer. 75.33 is just the continuous inverse of λ(n) at exactly 297.000 nm, and an experiment tunes the laser to 75P. The integer-n=75 defect *is* the operating defect. Meanwhile the real unverified assumptions (D1's observable; E5 hand-removed the m-degenerate Zeeman partners of the target at zero field; the pulse shape) are undisclosed. The brain's FRONTIER-DECLINE of the E_6 robustness follow-up also cited an "n=70–80 defect −0.21 to −0.16 GHz" that exists only as prose (forster_defect.json has n=40–60 only). | E5/E6 FollowUps; report §5(i); memory.md FRONTIER-DECLINE E_6 | E5/E6 experiment deepseek; brain deepseek; the operator directive (human) adopted it verbatim | **Yes, abstract**, as the sole caveat | Not caught | E7 was planned on this premise, then descoped |
| **D7** | **The "power-cheap" framing contradicts the run's own numbers.** Abstract and conclusion: "≈1.2 mW drives a μs π-pulse … three orders of magnitude inside the envelope" + "feasible and power-cheap", paired with fidelities that need 122.8 mW (99.89%) and 963 mW (99.975%). At 1.2 mW (Ω = 1 MHz) E6's own CSV gives F = 0.938 (5 μK) / 0.882 (10 μK). | report abstract, §3, §5 last paragraph; `E6/.../corrected_frontier.csv` row Ω=1 | report_writer + brain deepseek-v4-pro; PI opus-4-6 reviewed the report ×7 without flagging it | **Yes, abstract** | Not caught | — |
| **D8** | **Internal inconsistencies passed by the contradiction auditor.** (a) The abstract gives 99.89% and 99.909% for the same 10 MHz point. (b) Ledger L2.6 says "recoil-limited ceiling **DOES** survive fast driving"; the report says "does **not**". (c) The Förster defect is +0.185 GHz in report §4 and −0.185 GHz in §5 (sign convention). | report.tex l.20, 86, 116; experiments.md l.265 | contradiction_auditor deepseek; report_writer deepseek | Yes (a) | Not caught (auditor reconciled (a) as "two models") | — |
| D9 (minor, latent) | **E3 scan sets blockade = 0 when C₆ = 0 (θ=0 rows).** No interaction is scored as zero leakage instead of gate failure. tool_impl flagged the AMBIGUITY and followed the description. The plot filters to θ=90°. | `E3/scripts/fidelity_scan.py:164-193`; scan.csv θ=0 rows | E3 experiment description (deepseek); tool_impl deepseek | No | No | — |
| D10 (caught by existing) | **Wrong plan premises**: n≈55–65 (actual 75.3), τ≈1 μs (actual 221.6 μs), Manthey anchor "700 mW / 100 μm" (actual 7 mW / 700 μm). | plan.md; E1 Limitations 1–2; E3 premise corrections | brain deepseek (plan) | No | **Yes**: E1/E3 anchors plus the premise-correction channel | — |
| **P1** | **No independent review for E1, E2, E3, E6.** E4/E5 reviews ran (opus, both "satisfied" on the frozen criterion) but were never written to `reviews/`. There are no `experiment_review_*.md` files. | `reviews/`; conversations `experiment-review-1.*` | harness | — | — | — |
| **P2** | **Tests enforce the described prediction; nothing tests what quantity `leakage` is.** Examples: `test_f40_lt_f10_ordering`, `test_lowest_omega_infidelity_small` ("gate returns to \|gg⟩"). E2 tests likewise encode "vanishes at θ=0". | E5 tests l.281, l.346 | experiment agent descriptions (deepseek) → tool_review glm-5.2 | — | — | — |
| **P3** | **The run could not stop by itself.** The E7 descope, "WRAP UP", and two "call finish() first" came from the operator. After the descope, $45 went to 5 illustrators, auditor re-sweeps, and a 15×-read-plan.md finish loop. The descoped E7 was itself ill-posed (D6); the real highest-VOI check (full-gate simulation with conditional phase) was never proposed. | directives/, finish_stats.json | brain deepseek | — | operator | ~$45 |
| **P4** | **Infra failures converted to skip + disclose.** Plan PI review failed (Anthropic credit), and the brain "relied on downstream gates". OpenAlex 429 became a report caveat. Reader 402 plus a 126-byte-HTML "Safronova2004.pdf" led to the citation being dropped and the prose softened. The E4 `math` sub-agent failed with "No API key for provider: openai-codex", so its analytic controls were redone by the orchestrator with the same formula (the E4 x-vals are same-formula). | memory.md; `conversations/...math-cbisrx.jsonl` | harness / providers | disclosed | — | plan never PI-reviewed |

Suspected but **not** ground truth (not scored): E5 removes the m-degenerate partners of \|75P₃/₂, m=3/2⟩ from the pair basis at zero field. This is only justified under a large B field, which is never declared, and Walker & Saffman 2008 (in literature.md) is exactly about this degeneracy. The effect on overlap/V is unknown.

---

## 2. Verdict matrix (defects × M1–M7)

Legend: C = CATCH, M? = MAYBE, – = MISS, n/a.

| | M1 anchor | M2 independence | M3 receipts | M4 routing | M5 review@finish | M6 xproj memory | M7 physics tests |
|---|---|---|---|---|---|---|---|
| D1 | – | – | – | n/a | M? | – | M? |
| D2 | – | – | – | n/a | M? | – | – |
| D3 | – | – | – | n/a | M? | – (risk of harm) | M? |
| D4 | M? | M? | – | n/a | – (loophole) | – | – (reinforces) |
| D5 | – | **C** | – | n/a | M? (high) | – | – |
| D6 | n/a | – | – | n/a | – | – | – |
| D7 | n/a | – | – | n/a | – | – | – |
| D8 | n/a | – | – | n/a | – | – | – |
| D9 | – | n/a | – | n/a | M? | – | – |
| P1 | n/a | n/a | n/a | n/a | **C** (E1, E3, E6; not E2) | – | n/a |
| P2 | n/a | n/a | n/a | n/a | – | – | M? |
| P3 | n/a | n/a | n/a | – | – | – | n/a |
| P4 | n/a | n/a | n/a | **C** | n/a | – | n/a |

Reasons, per cell that isn't obviously n/a:

**D1**
- M1 MISS. The natural anchor is Pagano2022's Bell F 99.899% / 99.973% (in literature.md, already E3's anchor). E5's ME code on Pagano's inputs (V/ℏΩ = 21.1, τ = 50 μs) would return ≈ 1 − decay ≈ 99.9%, because at strong blockade both the population and the phase error are tiny. The anchor **passes with the wrong observable**. Only a weak-blockade anchor would expose it, and none with a published number is in literature.md: Pagano's "V/ℏΩ<10 cannot maintain solution" is qualitative.
- M2 MISS. The legs are time-evolution vs analytic with no shared H module, so M2 grants independence. The failure is the producer's disposition of a *disagreement*, which M2 does not govern. frame.md (1.6 KB, question-level) has no observable definition to diff against. Existing mechanism: claims-first step 1 (landed 08-26, after this run) no longer lets `cross_validation_resolved` clear DISCREPANT, so this number would be `disputed`/hedged mechanically.
- M3 MISS. The value is in `master_fidelity_vs_omega.csv` from a logged run.
- M5 MAYBE. E5 *was* reviewed, and opus passed it with Pagano's phase condition in context. The code shows `e_ops=[P_gg]` and the method_ladder says "sesolve (no-decay)", so reading scripts gives the reviewer the evidence, but recognizing population ≠ gate fidelity is a judgment call.
- M6 MISS. No earlier project has a "measure the conditional phase, not the return population" lesson. The 07-27 single_photon_Rydberg literature note ("two-eigenstate Förster structure suppresses gate errors up to 100×") would, if injected, have *supported* E5's story.
- M7 MAYBE. The exposing limit is the V≫Ω scaling test: blockade error ∝ Ω²/V² (textbook), while E5's metric goes as Ω⁴ and would fail. A blind author given "infidelity = 1 − P_gg" is more likely to pick "V→∞ ⇒ P_gg→1" or "phase→π", which pass. Plausible but not likely.

**D2**
- M1 MISS. E6 is a composition; its anchor is E4's 10 MHz point, and it reproduced it.
- M2 MISS. M2 would strip credit from E6's four wiring x-vals, which is correct but doesn't touch the substitution.
- M3 MISS. Receipted.
- M5 MAYBE (low). M5 forces an E6 review, but E6's arithmetic is right. Catching it means questioning E5's definition.
- M7 MISS. The composition tests pass.
- Existing claims-first (post-run) would propagate E5's `disputed` into E6 (verdict inherits the lowest status). That flag is mechanical but only hedges.

**D3**
- M1 MISS. The anchors used (Pagano, Vermersch n=25) pass. No published Rb nP₃/₂ pair shift at n≈75 is in literature.md, and the n¹¹ path is never exercised by an anchor.
- M2 MISS. No second leg existed.
- M3 MISS. Receipted.
- M5 MAYBE. M5 forces an E3 review. The reviewer would see `c6_n60*(75/60)**11` next to E2's "not naive design inputs" flag and the 15× vs 86× series, but the E4 reviewer (same model) saw the same line and wrote "Acceptable".
- M6 MISS, with risk of harm. The earlier Yb-和-Rb project (07-14) states "For Rb nP₃/₂ at n=50–90, no known Förster resonances exist, so perturbative C₆ is expected to be reliable". An auto-extracted lesson from it would have reinforced D3.
- M7 MAYBE. A "C₆ ∝ n¹¹" scaling test on E2's C₆ tool is a textbook limit a blind author might pick. It would fail on E2's own data (15× vs 86× over n=40→60) and force a disposition.

**D4**
- M1 MAYBE. Vermersch2014 is the natural anchor and is in literature.md. Its θ=0 constant (0.269) mismatches by 10⁵. But "≥1 anchor" is satisfied by the sin⁴ coefficient (1.8%), and that is the one the agent chose.
- M2 MAYBE. M2 fires: the "analytically forced" sin4 leg declares no operator, and perturbative vs diag both import `pairinteraction`, so the sin⁴ claim loses credit. But the refuting diag θ=0 number (1.22) is never surfaced.
- M5 MISS. E2 has no key in claims.json even though "pure sin⁴θ" is in the abstract, so "every EID cited in claims.json" never requires an E2 review. This is a loophole.
- M7 MISS. The description carried "vanishes at θ=0", so a blind test author would assert C₆(0)≈0 and enforce the defect.

**D5**
- M2 CATCH. The results.json leg self-declares method_a "ARC (Steck literature D2 value)" vs method_b "Safronova1999": both method class literature, so agreement credit is rejected mechanically.
- M1 MISS. The Manthey anchor (true Numerov path) satisfies M1. The harness cannot see ARC's internal literature-table branch.
- M3 MISS. The value is output of an executed script. The constant lives in a dependency's CSV, not the script, and 5.9783 ≠ literature.md's 5.956.
- M5 MAYBE (high). E1 is in claims.json and unreviewed. The docstring (l.4–9) and results.json both say "literature", so a script-reading reviewer is likely to see it.

**D6 / D7 / D8**
- No mechanism fires. These are synthesis and physics-framing errors in brain/report prose.
- M3 would block the unreceipted "n=70–80 defect" prose value if it reached the report, but it only fed a FRONTIER-DECLINE.
- The existing PI (7 reviews) and contradiction_auditor missed all three.

**D9**
- M5 MAYBE: an E3 review might question zeroing.
- M7 MISS: the description stated the convention, so the test enforces it.

**P1**
- M5 CATCH for E1, E3, E6. It would have forced three more reviews, but E2 escapes (see D4).

**P2**
- M7 MAYBE. The mandated limit test adds a non-prediction test, but see D1 on which limit gets picked.

**P3**
- M4 MISS: budget and descoping were human decisions, not infra failures.
- The existing 09-22 finish escalation / freeze addresses the livelock half.

**P4**
- M4 CATCH. 402, 429, and "No API key" are mechanically classifiable as infra. Retry or provider-switch would have produced a plan PI review, a real E4 math leg, and the Safronova PDF.

---

## 3. False-positive / cost side (this project)

- **M1.** Natural published anchors exist for E1 (Manthey, already used), E2 (Vermersch, already used), E3 (Pagano, Low2012, already used), and E5's pair-diagonalization path (e.g. the Walker2008 70S C₆ run through the same pairinteraction code; not used). E4 and E6 are pure compositions with no meaningful anchor and would need a waiver or a ceremonial re-anchor. E7 was never run. **3 of 7 already had M1-style anchors, and all passed while the defects lived elsewhere.** For D1 the natural anchor passes by construction. Marginal value here is about 0.
- **M2.** It correctly strips credit from about 9 wiring "cross-validations": E4 ×3 same formula, E6 ×4 same data, E1 D2 literature-vs-literature, and E2's sin4 "analytically forced" leg. It would **wrongly** downgrade 2 legitimate controls that share the `pairinteraction` import: E2 perturbative vs full diagonalization, and E5 tail fit vs perturbative. These are different methods, and the E2 one is the only place the D4 refutation lived. Deadlock risk: if finish demanded an independent agreeing leg for each headline, the leakage/flip headline has none, so the run could not finish without a new experiment it had no budget for. That is arguably the right outcome, but it would need the escalation path.
- **M3.** Every computed number has a receipt. Blocked or needing a citation-receipt class: about 8 literature numbers quoted in the report (Pagano 7.69/3.86 and 99.899/99.973, Manthey 90 kHz, Safronova 5.956, Vermersch 6.33, Evered 5e-3, LeSeleuc 1e-2); the E4 analytic-control values computed in transcripts rather than files (a correct block); and E2's n=70–80 prose. Low cost if literature values get a cite-receipt path.
- **M4.** No false positives. Cost: retries during credit exhaustion (Anthropic balance for the PI) burn wall time; provider switching for the PI needs a non-Anthropic reviewer slot.
- **M5.** It needs 3 extra reviews (E1, E3, E6), about $1–3 of opus at the E4/E5 reviewer sizes. Deadlock risk: it would have fired during the wrap-up, when the operator had explicitly forbidden spawning reviewers, which is the pp-vs-ss "mutually inconsistent constraint" pattern unless experiment_reviewer is in the freeze closure. The claims.json-only trigger misses E2 (D4).
- **M6.** No false positive, but a **harm** risk: the only relevant earlier-project content (Yb-和-Rb 07-14) states the opposite of the truth about Rb nP Förster resonances.
- **M7.** There were about 16+ tool_impl/tool_review pairs. For IO/plot/composition tools (synthesis_inputs, compose_corrected_frontier, plot_*) a limit test or SymPy units check is vacuous busywork. Where the description carries the prediction (D4, D9, E5), blind authors enforce the defect.

---

## 4. Model attribution

| defect | authored the defective step | also passed it |
|---|---|---|
| D1 | E5 experiment (deepseek-v4-pro) defined the observable; tool_impl deepseek-v4-pro | tool_review glm-5.2; experiment_reviewer **claude-opus-4-6**; PI claude-opus-4-6; brain deepseek |
| D2 | E6 experiment deepseek; brain deepseek task spec | PI opus-4-6; human operator directive |
| D3 | E3 experiment/tool_impl deepseek; brain deepseek decline | **PI opus-4-6 made the same wrong-direction physics prediction**; E4 reviewer opus-4-6 "Acceptable" |
| D4 | E2 experiment/tool_impl deepseek | tool_review glm-5.2; ledger_writer opus-4-6 |
| D5 | ledger_writer **claude-opus-4-6** wrote "Numerov" with "Steck literature" in its input; report_writer deepseek propagated | PI opus-4-6 |
| D6 | E5/E6 experiment deepseek; brain deepseek | human operator adopted it verbatim |
| D7 | report_writer / brain deepseek | PI opus-4-6 (7 reviews) |
| D8 | contradiction_auditor / report_writer deepseek | — |

On "base model explains more than scaffold": the *originating* steps are overwhelmingly deepseek-v4-pro (6 of 8 physics/synthesis defects). But claude-opus-4-6 **authored** D5, made D3's wrong-direction prediction independently, and **passed** D1, D3, D7 in reviewer roles, with the decisive literature (Pagano's phase condition, V/Ω<10) in its context. A human operator also propagated D2 and D6. The failures are cross-family and cross-role, and every one of them occurs at a point where no role is obliged to compute an independent estimate or check an observable definition. This project supports "scaffold (who must check what) explains more than base model" at least as much as the reverse. The one clearly model-shaped signal is that deepseek originated most errors, but opus was no better as a gate.

---

## 5. Summary

- In this project, M2 would have caught 1 of 10 ground-truth research defects mechanically (D5's circular D2 "anchor"), plus MAYBE on D4. It would also wrongly strip 2 legit pairinteraction perturbative-vs-diagonalization controls.
- M4 would catch the 1 infra process defect (P4: PI plan review, math agent, reader 402 all converted to skip + disclose), and M5 the 1 review-coverage defect (P1: E1, E3, E6 unreviewed; E2 escapes because it has no claims.json key). Both are CATCH on process, and only MAYBE on the physics defects they would expose.
- M1, M3, and M6 catch 0 of 10. The headline defect D1 (E5 measures \|gg⟩ return population, not gate fidelity) passes the natural Pagano anchor by construction, has full receipts, and has no earlier-project lesson. M6's only relevant prior content would have reinforced D3.
- M7 gives MAYBE on D1 and D3, only if the blind author picks the V≫Ω ∝Ω²/V² (or C₆∝n¹¹) scaling limit. Where the description carries the prediction (D4, D9), M7 enforces the defect instead.
- The defects that reached the abstract (D1/D2 flip, D4 pure sin⁴, D5, D6 ill-posed caveat, D7 "power-cheap") are caught by none of M1–M7 mechanically. They were originated mostly by deepseek-v4-pro but passed by claude-opus-4-6 reviewers and a human operator, so the gap is who is obliged to compute an independent estimate, not the base model.
