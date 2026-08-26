# Architecture review: what the single_photon_297nm trace says about Luxas

*2026-08-26. Reviewed: the full run of `sisyphus-projects/manual/projects/single_photon_297nm` (two phases, 2026-08-24 16:48 → 2026-08-26 01:48; 578 logged events; 13 session starts; 4 operator directives; $151; 7 experiments), its ledger, results.json files, PI feedback, audits, scripts, and the final report — against the mechanisms shipped yesterday (`src/dynamics.ts`) and the human-trace synthesis (`notes/human-researcher-trace.md`).*

---

## 0. The one-paragraph verdict

Luxas is an excellent **provenance machine** and a weak **epistemic machine**. Every layer of verification it has — tool_review tests, experiment_reviewer, cross_validation, contradiction_auditor, prior_art_auditor, PI, finish gates — checks that the *same numbers appear consistently* and that the *procedure was followed*. None of them produces an independent estimate of a load-bearing quantity by a different route and forces reconciliation. In this run the report's headline (fidelity is U-shaped; optimum 28 MHz / 963 mW / 99.975%; "the recoil-limited ceiling does not survive fast driving") rests on one number — blockade leakage 2.555×10⁻⁴ at 40 MHz — that (a) disagrees with the simplest estimate at the same interaction strength by 135×, (b) measures a different observable than the term it replaced, and (c) passed all seven layers and reached the abstract. Separately, the two decisions the literature says agents cannot make — *what is the question really asking* (silo → synthesis) and *when to stop* (descope E7, break the finish loop) — were made by the human, out of band, four times, and the architecture has no record that it was steered. The dynamics blocks added yesterday were keyed on the wrong unit of iteration and fired zero times.

---

## 1. The E5 case: how a number nobody could check became the headline

**The chain.** E3 (closed-form five-channel budget): leakage negligible, ceiling 99.89% recoil-limited. Human directive: "silo results don't answer a composite question — synthesize." E4: sweeping Ω, closed-form leakage ε = ħ²Ω²/2V² with V = C₆/r⁶ = 850 MHz grows as Ω², so F(40 MHz) < F(10 MHz), optimum 19 MHz. E5: full pair diagonalization at n=75 finds V(4 μm) = −152 MHz, not −850 (near-Förster mixing, |rr⟩ purity 0.47), and a "master equation" gives leakage 2.555×10⁻⁴ at 40 MHz — 4.3× *below* E4's closed form. E6 substitutes E5's number into the five-channel sum; ordering flips; report rewritten around the flip.

**What the E5 script computes** (`blockade_gate_master.py:297-322`): start in |gg⟩, drive, measure `P_gg` at the end; `leakage = 1 − P_gg(no decay)`; `infidelity = 1 − P_gg(with decay)`. That is the *non-return population of the |gg⟩ branch* — an off-resonant, adiabatically-returning quantity, tiny by construction (9.6×10⁻⁷ at 10 MHz). The closed-form ε = ħ²Ω²/2V² it replaced is the finite-blockade error of the symmetric two-atom gate: the |gr⟩ branch's light-shift/phase error under an imperfect blockade. Different observables. At V = 152 MHz and Ω = 40 MHz (Ω/V = 0.26 — a *weak* blockade) the closed form gives 3.5%; E5's ledger records this in "Alternatives (d)" and dismisses it in one clause: "the scalar-shift formula is invalid in the strong-mixing regime." Whether the physics is finally right I cannot settle from here; what I can settle is that **no component of the pipeline could tell**, and the decisive argument was a single sentence by the party whose result depended on it.

**Each layer, and why it passed:**

| Layer | What it did | Why it couldn't catch this |
|---|---|---|
| tool_review (13 tests, blind) | `test_f40_lt_f10_ordering` asserts the *predicted* ordering; the rest check shapes, bounds, monotonicity, wiring | The description carried the prediction, so the "independent" test enforces the expected answer. Nothing tests *what quantity* `leakage` is. |
| cross_validation | control = E4 closed form; `agrees: false`; `cross_validation_resolved`: "NOT a bug … the full master equation is authoritative" | The escape hatch — *declare the control method invalid* — is available to the producer. A disagreement of 4.3× was converted into a finding by fiat. |
| experiment_reviewer (auto-spawned, opus) | reads criterion → data → derives verdict mechanically | The frozen criterion was `r6_tail_describes_4um == false AND f40_lt_f10 == true` — a criterion *about the predicted narrative*, not about the observable's correctness. Mechanical application confirms. No finding is recorded anywhere in `notes/` or `reviews/` for any of E1–E7. |
| contradiction_auditor | 44 quantities, 0 contradictions | It checks that 2.555×10⁻⁴ is the same digits everywhere. It reconciled "99.89% vs 99.909%" as "two models of the same point" — which is also how it would reconcile a wrong model. |
| prior_art_auditor | 3 of 4 claims *known*, 1 *new_regime* | Ran at report time, after the work. The novel claim is precisely the one resting on the least-verified number — verification effort was flat across claims. |
| PI (opus, 7 reviews) | CONTINUE ×3, STEER ×2, STOP ×2 | Its own physics prediction for E5 ("the true pair potential is almost certainly *stronger* than 3482 → leakage smaller") was refuted (V came out 5.6× weaker) and the verdict didn't change. It never ran a number. Earlier it said STOP twice on the report the human then judged insufficient. |
| finish gates | 0 blocking issues | They check ledger/plan/claims/report consistency. |

**Diagnosis.** The repo's founding insight — *independent authorship breaks self-grading* — was applied to code (tool_impl/tool_review) and to prose (ledger_writer, experiment_reviewer) but not to the two things that carry truth: **the definition of the observable** and **the disposition of a disagreement between methods**. Collins' experimenter's regress ("to know the result is right you need a working apparatus; to know the apparatus works you need the right result") is resolved in real labs socially and by third methods; here it is resolved by whichever method is described as "full". Dunbar's experts "show little attempt to explain [anomalies] away"; this trace explained away a 135× discrepancy in eleven words. The "Correct Answer, Wrong Mechanism" pattern from the AI-scientist literature is exactly this shape, and the paper that named it also said trace logs catch it while final reports hide it — which is what happened: the ledger has the 135× sentence; the abstract has the flip.

---

## 2. The dynamics live at the wrong level

**The real iteration was the experiment chain.** E3 → E4 → E5 → E6 → E7 are five experiments on *one quantity* (the fidelity frontier, specifically leakage at 40 MHz): 6.9×10⁻⁵ (E3, 10 MHz) → 1.107×10⁻³ (E4) → 2.555×10⁻⁴ (E5) → composed (E6) → robustness (E7, cut). This is Holmes's investigative pathway and Rheinberger's experimental system: E3's `error_terms` machinery is the apparatus, reused and re-tuned run after run; goals moved at every step (Pickering). Every one of those is `run_1` with `inherited_from: null`.

Yesterday's blocks watch `run_N` inside one experiment. They saw nothing: no experiment was re-run, so `stopping_signal` and `iteration_lineage` were structurally inert, and the experiments emitted `resolution` as strings ("boolean ordering; smallest gap…") and `headline_value` as booleans, which the parser silently drops. Producer side cost tokens; consumer side never fired. This is the orphan-mechanism failure CLAUDE.md warns about, one day old, and I built it. Two lessons: the consumer must *complain* about unparseable rows rather than skip them; and the unit of iteration in Luxas is not the run but the **claim**.

**Stopping happened by budget, by the human, and cut the highest-value step.** "WRAP UP — descope E7, out of budget" arrived at 17:58. E7 was the one experiment whose outcome could flip the headline (the near-Förster defect the whole corrected frontier rests on). After it was cut, the system spent 00:19–01:48 on five illustrators, a contradiction re-sweep, and a finish loop. Value-of-information ranking — EIG, the one mature import from the agent literature — would have put E7 before any figure polish. Nothing in `research_frontier` ranks; it lists.

**Proposal — make the quantity the unit.** A claims ledger already exists (`src/claims-registry.ts`, `report/claims.json`). Extend each headline quantity with a *value history*: `[{experiment, method, observable_definition, value, resolution}]`. Then:
- **Anomaly** = two entries for the same quantity disagree beyond resolution. Automatic, from data, no self-report. E4 vs E5 leakage is an open anomaly the moment E5 lands.
- **Disposition** of a cross-method disagreement cannot be "method A is invalid" by the author of A's competitor. It needs a *third* method, or a reviewer-adjudicated argument with an evidence locator. Until then the quantity carries `disputed` and cannot enter the abstract undecorated.
- **Stopping** = a headline quantity has ≥2 estimates by *different* methods that agree within resolution (Galison: "would stand up in court"). That is the epistemic stopping rule at the level where iteration actually occurs. The same-method re-run plateau I built is a special case.
- **Lineage** = which experimental system produced each estimate (E4 "kept: E3 error_terms" is exactly this, already recorded).

---

## 3. The anomaly channel was consumed by its own producer

All three anomalies in E4/E5 were written and marked `explained` in the same results.json by the same agent in the same turn. E4's explanation ("leakage ∝ Ω² overtakes recoil") was overturned by E5 one experiment later. E5's explanation ("strong mixing suppresses coupling") is the disputed one above. Zero anomalies ever reached the brain's block, because `explained` closes them. I designed it that way, and it reproduces the self-grading loophole the repo already knows about.

An explanation is a hypothesis. Fix: `explained` requires an `evidence` locator to an *independent* computation (a different script, a literature value, a limiting case), and the experiment_reviewer receives the explained-anomaly list as its primary target — "refute this explanation" — rather than the acceptance criterion, which the author wrote. `parked` stays as is. Brain-side `ANOMALY-ACK … explained` without a locator should be rejected by the block (re-surfaces with "no evidence locator").

Corollary for tool_review: **descriptions must not contain the predicted outcome.** The acceptance criterion belongs to the experiment; the reviewer should receive inputs, invariants, and observable definitions only. A test named `test_f40_lt_f10_ordering` is confirmation bias with a green checkmark.

---

## 4. The reviewers are cooperative, and the human is the actual PI

PI verdicts track the brain's narrative: STOP on the silo report (twice), CONTINUE on every plan the brain proposed, STEER only on presentation (experiment-ID leaks, a missing citation, "report contradicts own data" — which was true, but it was the brain's memory note `E5-CORRECTION-FLIP` that found the flip, not the PI). The PI's one substantive physics prediction was wrong and cost it nothing. This matches the measured literature: debate and critique degrade toward conformity; LLM self-review scores 6.1 where humans score 3.8; the only critics with teeth are ones that *compute*.

The four operator directives supplied, in order: taste ("composite question answered with silo results"), a stopping decision (descope E7), and two livelock breaks ("WRAP UP NOW", "CALL finish() AS YOUR VERY FIRST TOOL CALL"). Those are exactly the two capabilities — problem framing and stopping — that the human-trace synthesis identified as absent in agents. The system is not autonomous at those points; it is human-in-the-loop with the loop invisible to the architecture. That's fine as an operating model; it is not fine that no artifact records "this decision was external," so the next run cannot learn from it and the report cannot disclose it.

**Proposal — a Fermi obligation for every reviewer.** Brain rule 3b ("compute the 30-second numbers now") applied to PI and experiment_reviewer: before a verdict, produce your own order-of-magnitude estimate of each headline quantity by a route the experiment did not use (bash, one line). Disagreement > 3× is an automatic STEER carrying the estimate. This is Fermi killing Dyson's line in fifteen minutes; it is cheap; it converts a rhetorical reviewer into an epistemic one. The PI's E5 review would have written (Ω/2V)² ≈ 1.7% and asked why the ME said 0.026%.

**Proposal — record steering as state.** Operator directives already land in `notes/directives/`. Add them to the report's Methods-and-scope as "operator interventions: N (framing, stopping)" and to `~/.sisyphus/memory.md` as a lesson candidate. A run with 4 directives is data about the architecture.

---

## 5. Proportionality: 32 hours and $151 for a two-sentence question

The user asked two things. Q2 ("is pp vdW angle dependent?") was correctly answered in the framing phase from four citations (Vermersch's C₆(θ) formula, Walker, Weber, Wadenpfuhl) — and then, by the framing rule that a cited answer is *non-terminal*, converted into E2: a field-standard pairinteraction computation across n=40–60 with a 10⁶ anisotropy ratio, diagonalization controls, and a figure. A top researcher answers Q2 with one sentence and one citation, and maybe a one-hour check at the target n. The anti-survey rule is right in spirit (don't write up the field's answer as a contribution) and wrong as a mandate: it manufactures generative work regardless of whether the user needs it. Alon's feasibility × interest, Hamming's "reasonable attack": *importance* is set by the asker, and the system never asks what precision or depth the asker needs.

Phase-1 counts: 25 readers, 19 experiment spawns, 12 tool_impl/12 tool_review, 12 illustrator_write + 8 illustrator, 6 contradiction_auditor, 4 prior_art, 2 typesetter, 28 idle events. Deepseek producer: 38M input tokens across 1,527 calls. The verification budget was flat: E2's known result got the same machinery as E5's disputed one.

**Proposal — allocate by novelty × load.** Run prior-art positioning on the *plan's claims* at framing time, not on the report at the end. A claim classed *known* gets a citation and a cheap instantiation; a claim classed *new_regime* / *new_result* gets the full apparatus plus the multi-method requirement of §2. Uzzi's finding — high-impact work is conventional core plus one atypical element — says where the checking should concentrate: on the atypical element. Here it was 2.555×10⁻⁴.

---

## 6. Terminal gates create livelock

00:24 → 01:48: `finish()` ×4; `notes/plan.md` read 15 consecutive times with no write between reads; `report.tex` read 8 times then edited once; a ledger_writer spawned to produce a section for a descoped experiment; two contradiction re-sweeps; three human interventions to exit. Each gate fix perturbs another gate's input (plan ↔ ledger ↔ claims ↔ report). The 13 session starts include restart pairs minutes apart (14:35/14:36, 19:40/19:48/19:53/20:00) — a crash-restart loop the daemon papers over. idea.md §8 designed a StuckDetector against exactly this; whatever it does, it did not fire on fifteen identical reads.

**Proposal.** (a) `finish()` runs the entire gate set as one diagnostic and returns the full issue list; the brain must plan the fixes as a batch and call `finish()` again at most once more; a second failure of the *same gate class* escalates to the operator with the diff instead of looping. (b) A loop detector on ≥5 consecutive reads of the same path with no intervening write — interrupt with the last diff, not a reminder.

---

## 7. What is working, so it isn't thrown out

- **Provenance is real.** Every number in the abstract traces to a `computed.*` leaf; the contradiction auditor's 44-quantity table is genuinely useful as a copy-consistency check; experiment-ID leaks are caught; citations exist.
- **The premise-correction channel carried two real surprises to the brain** (n≈75 not 55–65; V(4 μm) 5.6× smaller) and forced dispositions. State-over-prose works when keyed on the right unit.
- **The ledger is honest.** The 135× discrepancy, the "sesolve (no-decay)" method, the descoped E7 — all recorded. The report hedges E7 correctly. The trace *contains* the evidence to catch the problem; the architecture just has no reader for it.
- **Independent authorship works where applied.** tool_review found 60-test-passing implementations; ledger_writer's numbers matched results.json.

---

## 8. Direction, ranked by how much research quality it buys

1. **Quantity-level claims with multi-method histories; ship gate = agreement or disclosed dispute.** (§2) Subsumes stopping, anomaly, and lineage; makes cross_validation's escape hatch impossible; is the epistemic engine the pipeline lacks.
2. **Observable definitions as first-class, compared on substitution.** (§1) When E6 replaces E4's term with E5's number, the `observable_definition` strings must be judged equivalent by someone other than E5 — the contradiction auditor already tabulates quantities; give it definitions, not just digits.
3. **Fermi obligation for PI and experiment_reviewer.** (§4) One bash line per headline quantity, by a route the experiment did not use; >3× ⇒ STEER.
4. **Explanations are hypotheses.** (§3) `explained` needs an independent evidence locator; the reviewer targets explained anomalies; tool_review descriptions carry no predictions.
5. **VOI-ranked frontier; descoping a headline-flipping lead auto-downgrades the claim.** (§2, §5)
6. **Prior-art positioning at plan time; verification budget ∝ novelty × load.** (§5)
7. **Finish as batch diagnostic + escalate on repeat; loop detector on repeated reads.** (§6)
8. **Record operator steering as state and disclose it.** (§4)

And two things to *not* do: don't add more cooperative reviewers or reflection passes (measured to reduce accuracy through conformity), and don't extend the run-level stopping/lineage blocks — retarget them to claims or retire them.

---

## Appendix: physics note on the disputed number (for whoever re-checks)

- E5 `master_equation.leakage_10MHz = 9.6×10⁻⁷`, `leakage_40MHz = 2.555×10⁻⁴`, defined as 1 − P_gg after evolving |gg⟩ under `sesolve`. The gate fidelity is reported as `1 − leakage − decay`; there is no |gr⟩/|rg⟩ branch and no conditional-phase term in the fidelity.
- With the E5-computed V(4 μm) = −152 MHz, the standard finite-blockade estimate ε = ħ²Ω²/2V² gives 2.2×10⁻³ at 10 MHz and 3.5×10⁻² at 40 MHz — 2000× and 135× above E5. The 47% |rr⟩ purity suppresses the drive amplitude into the tracked branch by ~0.47 in probability, not by 10²–10³; the second (|SS′⟩-heavy) branch is also laser-accessible and also detuned by ~V.
- E6's corrected frontier substitutes E5's population non-return for E4's blockade-error term. The flip F(40) > F(10) and the 28 MHz optimum follow from that substitution. If the substitution is a category error, the report's pre-directive headline (recoil-limited at accessible drive; blockade-limited beyond ~19 MHz) may have been closer to right — with V = 152 MHz rather than 850, the leakage-limited regime starts *earlier*, not later.
- What would settle it: a two-atom simulation of the actual symmetric gate (|gr⟩ and |rr⟩ branches, conditional phase, the Levine/Pagano pulse) at V = −152 MHz with both pair branches, compared to ε = ħ²Ω²/2V² in the V ≫ Ω limit as a wiring check. That is E7's sibling and the highest-VOI experiment in the project.
