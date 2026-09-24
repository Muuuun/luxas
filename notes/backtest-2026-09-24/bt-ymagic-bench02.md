# Backtest: yttrium-magic-wavelengths-20260906 + probe-claims-20260826/bench02

Auditor stance: counterfactual, not advocacy. Everything was read on the droplet and nothing was modified. The only local computation was a closed-form arithmetic check (hydrogen sums, a/deficit ratios).

---

## Project 1: yttrium-magic-wavelengths-20260906 ($40.19, single experiment E1_y_sos_dataset_validation)

Cost by model (usage.log): deepseek-v4-pro $22.18 · glm-5.3 $11.59 · claude-opus-4-6 $5.88 · deepseek-v4-flash-vision-exp $0.52.
Roles: brain, experiment, tool_impl, replicator, contradiction_auditor and report_writer ran on deepseek-v4-pro. tool_review ran on glm-5.3. experiment_reviewer, PI, reviewer and ledger_writer ran on opus-4-6.

Timeline that matters:
- 08:00, 08:28, 08:47: experiment_reviewer rounds r1, r2 and r3. r3 was **satisfied** at 08:49 with a headline of 151.41 and a verdict of *confirmed*.
- 09:13–10:08: the same experiment agent (experiment-rumqxf) ran FollowUp "E_{N+1} multi-channel QDT" inside E1/run_1. It added a new tool, `multi_channel_qdt_continuum.py`, and wrote `finalize_r3.py`. The headline moved to **146.59** and the verdict flipped to *inconclusive*.
- No experiment_reviewer ran after this change.
- PI STEER (10:26) approved the descoping and forbade the εf follow-up "because the f-sum already bounds the continuum at 1.75".
- PI STOP (12:09), then finish, which was blocked by the typesetter and deadlocked by the edit tool.

### Defect table

| id | defect | where | author (agent / model) | reached report? | caught? by what | cost |
|---|---|---|---|---|---|---|
| **Y1** | **The "f-sum-deficit upper bound" of 1.75 a₀³ is not a bound.** It computes `fsum_deficit/(2a)`, which treats a *total* oscillator strength (dimensionless) as if it were the channel *density* f0 (per Hartree). The actual "most generous assignment" is to put the whole deficit at threshold, which gives deficit/a² = 0.8003/0.22848² = **15.33 a₀³**, not 1.75. The ceiling is therefore 141.66 + 3.9 + 15.33 ≈ **160.9 a₀³, inside the [150, 174] pass band.** So the headline diagnosis is unsupported: "the shortfall is core-valence correlation, not missing transitions; no amount of missing upward transition can restore the gate". A second sign of the error: the r3 text says spreading the deficit *down* to threshold (0.2285 Ha) *reduces* α relative to ω_eff = 0.37, which is backwards under a 1/ω² weight. | `scripts/multi_channel_qdt_continuum.py:299-300`; `runs/run_1/finalize_r3.py:128,197`; frame.md headline #2; report.tex:30 (abstract), :69, :71, :101, :105, title "…at its correlation limit" | Proposed by experiment-rumqxf (deepseek-v4-pro), conversation line 108, *before* the tool was built ("The result will show… ≈1.75"). Implemented by tool_impl (deepseek-v4-pro). tool_review (glm-5.3) pinned the same formula because the description dictated it (test lines 55, 266, 353). Endorsed and propagated by the PI (opus-4-6). | **Yes.** Abstract, title, conclusion, frame headline. | **Never caught.** contradiction_sweep (deepseek) said upper-bound claims are "backed by computed f-sum-deficit bound leaves". The PI (opus) cited it to forbid E_{N+2}. | It killed the one follow-up that could have flipped the verdict (the εf anchor, which has up to ~14 a₀³ of headroom), and it made the report's central scientific claim wrong. |
| **Y2** | **Factor-2 error in the QDT continuum density.** For E_n = IP − Ry/n*², dn/dE = n*³/Hartree, so df/dE = f0 per Hartree and α_cont = f0/a, not f0/(2a). Hydrogen check (computed locally): lim n³f_n = 1.5629, which equals σ₀(6.30×10⁻¹⁸ cm²)/(2π²α) = 1.563 per Hartree. The flat continuation is then f0/a = 3.13 against a true continuum of 0.837. The agent's own `runs/scratch/h_check*.py` used the halved formula and concluded "flat overestimates ~1.9×", which is recorded as Limitation 2 (the correct ratio is ~3.7×). The test file even labels the correct form "the classic bug". | `multi_channel_qdt_continuum.py:14-17,242`; `tests/test_multi_channel_qdt_continuum.py:36-40,329,408-419` | experiment-rumqxf and tool_impl (deepseek-v4-pro); tool_review (glm-5.3) copied it from the description | Yes: "continuum 1.03" (should be ~2.05 as a flat estimate) | Never | Small numerically (total 146.6 → ~147.6); the verdict does not flip on its own |
| **Y3** | **The r3 revision that changed the headline and verdict was never reviewed.** The last experiment_reviewer (r3, 08:49) reviewed the r2 state (151.41, ω_eff closure) and said *satisfied*. The QDT tool, the 146.59 headline and the confirmed→inconclusive flip all came after it. The ledger lists "Reviewer findings addressed (r3)", which makes it look reviewed. | reviews/experiment_review_*_r3.md (08:49) vs finalize_r3.py (10:05) and results.json (11:32); log.jsonl has no reviewer spawn after 08:47 | Harness/brain (deepseek-v4-pro) chose to `continue` the experiment rather than start a reviewed round | Yes (all r3 numbers) | No | Y1 and Y2 went through unreviewed |
| **Y4** | **Unsourced core polarizability of 14.0 a₀³** ("free Kr 16.78 mildly contracted") was added into the total in r1. The correct Y³⁺ value is ~3.9. | finalize.py (r1) | experiment-nw3fq0 (deepseek-v4-pro) | Not in the final report | **Caught** by experiment_reviewer r1 (opus-4-6) | One review round |
| **Y5** | **Parametric continuum closure** (ω_eff = 0.30 Ha, unexplained, 8.9 a₀³, double-counting below 0.37 Ha) produced a marginal "confirmed" of 154.45 and then 151.41. | finalize.py:62 | experiment (deepseek-v4-pro) | No (superseded) | **Caught** by experiment_reviewer r1 and r2 (opus-4-6) | Two review rounds |
| **Y6** | **The blind replicator's "estimate" was just the benchmark** (162 ± 12, "via Schwerdtfeger-Nagle recommended value, inputs: []") in all three rounds. No independent estimate ever existed, so the claims machinery compared the result against the target. | reviews/experiment_review_*_r{1,2,3}.md | replicator (deepseek-v4-pro) | Disclosed in report §2 | Self-disclosed only | Three replicator calls, zero information |
| **Y7** | **Tablepol "197.2 ± 0.2" was treated as a second Y value.** It is actually Sr (Z = 38). | memory.md PREMISE-ACK E1#0; PI STEER item (e) | experiment (deepseek-v4-pro), amplified by the PI (opus-4-6), who told the brain to put it in the report | No, fixed before the final version | **Caught** by the pre-finish contradiction_auditor and prior_art_auditor (deepseek) at 11:22 | One fix cycle |
| **Y8** | **Process: the run could not finish.** The edit tool silently rejected every canonical `edits[]` call (four `\bibliography` edits). bash and experiment spawns were frozen by the PI STOP, and write was blocked for existing files. The finish gate was held by a cosmetic typesetter flag, which led to a needs-operator escalation. | notes/escalations/needs-operator.md; log.jsonl edit calls; 0 `tool_block` entries | Harness (wrapEdit) | n/a | Already fixed by the 2026-09-22 P0 commit (wrapEdit normalisation plus freeze closure) | Run never finished; operator time needed |

Not listed because there is no ground truth for them: Kurucz computed gf possibly inflating Σf (the PI raised this but it was never tested); y²F°₅/₂ α = −932 resting on one Kurucz line (disclosed); TRK N_eff = 3 as a valence approximation.

### Verdict matrix (Y)

| | M1 anchor pilot | M2 independence | M3 receipts | M4 failure routing | M5 review at finish | M6 x-project memory | M7 physics-invariant tests |
|---|---|---|---|---|---|---|---|
| **Y1** f-sum "bound" | **MISS**: the bound is a derived inequality with no published counterpart. E1's natural anchor, α = 162 ± 12, is the gate itself, and the model already "failed" it without anyone finding Y1. | **MISS**: M2 would strip credit from the QDT-vs-deficit "bound_check" (same module, same A-values), but the report's claim rests on the bound alone, so 15.3 would never surface. | **MISS**: 1.75 has a receipt (finalize_r3.py output). | N/A | **MISS** as specified: E1 has review files r1–r3. It would be CATCH only if M5 also required a review newer than results.json (see Y3). | **MISS**: the predecessor yttrium-tweezer (09-05) has no f-sum lesson. | **MAYBE (leaning catch)**: a SymPy check on `alpha_deficit` gives [f]/[E] = Eh⁻¹, not a₀³ ∝ f/ω² = Eh⁻², so it fires mechanically *if* the author types fsum_deficit as dimensionless. The natural limit, "whole deficit as a delta at threshold ⇒ f/a²", fires if the author tests the "upper bound" property. However, the description dictated `/(2a)` and glm-5.3 simply pinned it. |
| **Y2** factor-2 density | **MAYBE**: the anchor would be H 1s (σ₀ = 6.3×10⁻¹⁸ cm² or α = 4.5). A flat-continuation α_H mismatches under *both* the correct and the buggy formula, so it blocks for the wrong reason. Only a df/dE-at-threshold anchor discriminates. | MISS | MISS | N/A | MISS | MISS | **MAYBE**: the discriminating limit is the H threshold continuity lim n³f_n = df/dE (1.563/Hartree). A blind author could plausibly pick it from "flat density df/dE = f0/(2·HARTREE)", but the actual author picked the formula itself as the oracle ("independent quadrature of the stated density"). |
| **Y3** unreviewed r3 | N/A | N/A | MISS (receipts exist) | N/A | **MISS as specified** (file-existence check passes). A one-clause change, "review must postdate the results.json it certifies", makes it **CATCH**. | MISS | N/A |
| **Y4** core 14.0 | MAYBE: a Y³⁺ core value is standard (Mitroy 2010 isoelectronic table), but the core is an input, not a code-path output. | N/A | **CATCH**: a hard-coded constant returned into the total. The same rule would also block the legitimate 3.9 (FP). | N/A | Existing reviewer r1 already caught it | MISS | MISS |
| **Y5** ω_eff closure | MISS | MISS | MISS: computed from a hard-coded parameter, not the parameter itself | N/A | Existing reviewer r1/r2 already caught it | MISS | MISS: 1/ω_eff² is the model's own definition (reviewer r3 noted this) |
| **Y6** replicator = benchmark | N/A | MAYBE: if the blind estimate counts as a "leg", method class = literature and would be rejected as an estimator | MAYBE: "value equal to literature value without receipt". M3 is scoped to claims/report, not ESTIMATE lines. | N/A | MISS | MISS | N/A |
| **Y7** Sr value as Y | MISS | MISS | MISS: it was a literature value and was cited | N/A | N/A | MISS | N/A. Existing auditors already caught it. |
| **Y8** edit deadlock | N/A | N/A | N/A | **MISS**: a harness tool bug is not in {429, 402, timeout, cost}, and no route exists for "tool is broken" | MISS | **MAYBE**: pp-vs-ss (2026-08-28) finalization-blocked.md states the exact lesson: "edit is broken (returns empty oldText/newText), bash is frozen, write is blocked…". A harness-injected lesson could have made the brain clear the typesetter via bash *before* requesting the STOP review, but only if the brain acted on it. Already fixed in code on 09-22. | N/A |

---

## Project 2: probe-claims-20260826/bench02 ($19.92 against a $5 cap, single experiment E1_c6_theta_60p)

Cost: deepseek-v4-pro $10.32 (brain, experiment, tool_impl, readers) · glm-5.2 $8.00 (tool_review ×3) · opus-4-6 $1.61 (PI, experiment_reviewer, ledger).
Outcome: `[FATAL] Cost limit exceeded: $19.92 > $5`. The run was killed at 21:10 UTC while the brain was in a `read`. **E_2 (p₂(θ), TDSE, the deliverable) never ran, and there is no report.** E1 itself is careful work: the n = 25 same-code anchor reproduces Vermersch 2014 (6.333 / −0.267 / 0.269 MHz·μm⁶) with a job-log receipt, there is a 70S isotropy control, and the reviewer wrote ANCHOR-OK (one of the rare ones).

### The model-routing bench claim: does its shape appear in the real run?
- **r₀(θ) making V ≡ ħΩ: NO.** The real brain explicitly rejected it. memory.md reads: "fixed r₀ = (C₆(π/2)/ℏΩ)^{1/6}… the only reading that makes p₂(θ) non-trivial (the self-consistent r₀(θ) reading gives constant p₂)". plan.md E_2 uses V(θ)/ħΩ = C₆(θ)/C₆(π/2).
- **Symbolic and numeric solutions of the same Hamiltonian as Leg A / Leg B: YES, in plan.md E_2.** It was *introduced by the PI (claude-opus-4-6)* and adopted by the brain (deepseek-v4-pro). The PI's CONTINUE instruction says to use the exact 3-level {|gg⟩, |+⟩, |rr⟩} diagonalisation as the "analytic" curve, "then the agreement check is a genuine test of whether the C6/r^6 pair model captures the physics". The plan's TDSE leg integrates *the same* 3-level H with V = C₆(θ)/r₀⁶. Two solutions of one H agree by construction, so the stated purpose (testing C₆/r⁶) is false. The PI's underlying complaint, that the Ω²/2B² asymptote is invalid at V = ħΩ, is correct. It never executed. In this run the shape is PI-authored, not deepseek-brain-authored.

### Defect table (bench02)

| id | defect | where | author / model | reached report? | caught? | cost |
|---|---|---|---|---|---|---|
| **B1** | The E_2 cross-validation compares two solutions of the same 3-level H (V = C₆/r₀⁶ in both legs) and claims this is "a genuine test of whether the C₆/r⁶ pair model captures the physics". A real test needs the TDSE on the multi-channel pair Hamiltonian that E1's exact-diag already built. | plan.md E_2 Approach; reviews/pi_feedback.md Instructions | PI (opus-4-6) proposed it; brain (deepseek-v4-pro) wrote it into the plan | No (never executed) | No | none (killed first) |
| **B2** | **Infra failure turned into skip-and-disclose.** The `math` sub-agent (gpt-5.6-terra) died on its first call with `No API key for provider: openai-codex`. E1 recorded "a math-derivation agent was unavailable (no anchored failure record — attribution unverified), so no independent symbolic re-derivation was performed". The independent analytic leg for the sin⁴ angular form was lost. | conversations/…math-0vsj0s.jsonl; experiments.md Limitations #5 | Scaffold (routing to a keyless provider); experiment (deepseek-v4-pro) disclosed rather than retrying | Would have (no report exists) | No | Lost an independent leg |
| **B3** | **Cost-cap overshoot of 4×.** The run crossed $5 at 18:59 UTC and was killed at 21:10 at $19.92, mid-read, with no deliverable. | probe.log; usage.log cumulative | Harness (cap was enforced only at the brain hook) | n/a | **Already fixed** by e83bb6b ("enforce at the usage record in every agent… a $5 run reach $13") | $14.92 past cap, plus the whole deliverable |
| **B4** | **Blind estimator silently skipped.** results.json declares 5 quantities with `headline: true`, co-located under the computed leaf, and frame.md ids (`C6_60P_mj32_theta`) are near-misses of the results ids (`c6_theta_60p_mj32`). The review says "(none — no declared headline quantity…)" and log.jsonl has 0 blind-estimate spawns. | reviews/experiment_review_E1_c6_theta_60p_r1.md; results.json | Harness | n/a | **Already fixed** by 8ea3eca / 289a3dd (co-located metadata, frame-id near-miss) | no blind check on 5 headlines |
| **B5** | **Fermi anchor has a unit and n* error.** frame.md scales "Vermersch n=25 (C₆=6.35 GHz·μm⁶)", but its own line above gives h·**MHz**·μm⁶. It also used n rather than n* ((60/25)¹¹ ⇒ 9.7×10⁴ GHz·μm⁶). The computed −293 GHz·μm⁶ is ~330× off the "anchor", and nobody noticed. | notes/frame.md "Fermi anchors" | brain (deepseek-v4-pro) | No | No (never compared) | none; shows Fermi anchors are not consumed |
| **B6** | **Tautological acceptance leg.** "CONFIRMED iff … molecular eigenenergies vary <1% over θ." Rotational invariance of the pair Hamiltonian guarantees this (observed 4.7×10⁻¹⁰ GHz), so it cannot fail. | results.json acceptance_criterion | experiment (deepseek-v4-pro) | No | No | none; inflates the verdict's apparent rigor |

### Verdict matrix (bench02)

| | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|
| **B1** same-H legs | MISS: both legs would reproduce any closed-form anchor | **MAYBE→CATCH**: CATCH if the two legs import one 3-level builder (the likely tool_impl pattern) or if identical declared operators count as shared. As literally specified (method class differs: exact-diag vs time-evolution), it fires only via the import graph. Note that the frame.md operator diff would *pass*, because both legs match frame. The existing `xvalVerdict` 1e-6 "wiring" rule catches it only if the TDSE error is below 1e-6. | MISS | N/A | MAYBE (reviewer judgment) | MAYBE: the 297nm project (08-25) is the origin of the "agreement ≠ independence" lesson, but it lives in Sisyphus/notes, not in a harness-written lesson | MISS |
| **B2** keyless math agent | N/A | N/A | N/A | **CATCH**: the error string is a mechanical auth/infra failure, so provider switch/retry applies and "skip + disclose" is forbidden | MISS | MISS | N/A |
| **B3** cap overshoot | N/A | N/A | N/A | MISS: cost is "infra", but a hard cap is not retryable, and the defect is enforcement lag. Already fixed by existing code. | N/A | N/A | N/A |
| **B4** estimator skipped | N/A | N/A | N/A | MISS | MISS (review file exists) | N/A | N/A. Already fixed. |
| **B5** Fermi units | MISS: E1's real anchor (n = 25 same code) was fine. The Fermi number is brain prose, not a code path. | N/A | N/A | N/A | N/A | MISS | MISS: M7 is tool-scoped and the frame is not a tool |
| **B6** tautological leg | MISS | MISS | MISS | N/A | MAYBE | MISS | MAYBE: a limit test "rotate the pair → identical spectrum" would expose that the criterion is a tautology, but a test author would write that as a *passing* invariant, not flag it |

---

## False-positive and cost side

**y-magic**
- **M1**: E1 has no anchor separate from its own acceptance gate. The only published Y observable is α = 162 ± 12, which *is* the gate. A 1σ tolerance would have **blocked E1**, whose legitimate output was "gate failed". Unless mismatch routes to "report the shortfall", M1 makes the negative result unreportable, which is a new deadlock. Tool-level anchors (H atom) mismatch for the flat-continuation model under any formula, so they are also false blocks. Two of the six tools (kurucz_parse, merge_transition_dataset) are parsers with no numeric anchor.
- **M2**: both existing xvals (f/ω² vs 6j; QDT vs deficit) would lose credit. That is correct, since they were already self-labelled non-independent, so the FP cost is ~0.
- **M3**: it would flag the legitimate core of 3.9 (a hard-coded isoelectronic extrapolation) and the cited benchmark 162 / 163 / 147.41 unless literature inputs can be declared. FP is manageable if an "input with citation" escape exists.
- **M5**: needs one extra experiment_review (opus, roughly $0.3–0.5) if freshness is enforced. experiment_reviewer is in the STOP allow-list, so no new deadlock.
- **M7**: 6 tools × 2 tests. Parsers get ceremonial tests. tool_review was already the second-largest spend ($11.6 of $40, glm-5.3).
- **Deadlock risk**: M1 (above) is the real one. M5 with a freshness rule could deadlock only if reviewers are frozen, and they are not.

**bench02**
- **M1**: zero added cost. E1 already ran the n = 25 same-code anchor voluntarily. E_2 has a natural closed-form anchor (V = 0 ⇒ standard two-atom Rabi).
- **M2**: **both** real xvals (perturbative vs exact-diag, at C₆(π/2) and at V(r₀)) import pairinteraction's pair-Hamiltonian builder, so they would be downgraded. They are legitimate tests of *perturbation validity* (the R⁻⁶ breakdown near Förster), not of H, so that is 2 of 2 false positives. M2 needs a "tests an approximation of the same H" class that is not scored as INDEPENDENT but is not rejected either.
- **M3**: every value has a job-log receipt, including the n = 25 anchor. No FP.
- **M4**: none beyond B2.
- **M7**: 3 tools. The 70S isotropy control already served as a limit test. Low cost.

---

## Model attribution (defective step → model)

| defect | authoring model | also missed by |
|---|---|---|
| Y1 f-sum "bound" | deepseek-v4-pro (experiment, tool_impl) | glm-5.3 (tool_review pinned it), **claude-opus-4-6 (PI endorsed it and used it to forbid the follow-up)**, deepseek-v4-pro (contradiction_auditor, report_writer) |
| Y2 factor 2 | deepseek-v4-pro | glm-5.3 (tool_review called the correct form "the classic bug") |
| Y3 unreviewed revision | scaffold (continue path, no review trigger) | n/a |
| Y4 core 14.0 | deepseek-v4-pro | caught by opus-4-6 |
| Y5 ω_eff closure | deepseek-v4-pro | caught by opus-4-6 |
| Y6 replicator = benchmark | deepseek-v4-pro (replicator) | n/a |
| Y7 Sr as Y | deepseek-v4-pro, amplified by opus-4-6 (PI) | caught by deepseek-v4-pro auditors |
| Y8 edit deadlock | scaffold | n/a |
| B1 same-H legs | **claude-opus-4-6 (PI)**, adopted by deepseek-v4-pro brain | opus-4-6 (the same PI approved it) |
| B2 keyless math agent | scaffold (routing), deepseek-v4-pro disclosed rather than retried | n/a |
| B3 / B4 | scaffold | n/a |
| B5 Fermi units | deepseek-v4-pro (brain) | everyone |
| B6 tautology | deepseek-v4-pro (experiment) | opus-4-6 reviewer |

On "base model explains more than scaffold": this is mixed. deepseek-v4-pro authored most of the physics errors (Y1, Y2, Y4, Y5, B5). Opus-4-6 caught the r1/r2 ones (Y4, Y5), but it *endorsed* the worst one (Y1) and *authored* B1, the bench's named deepseek failure shape. The highest-impact defects all survived at least one opus reviewer, and 5 of the 14 are purely scaffold (Y3, Y8, B2, B3, B4). The swap-to-a-better-model story does not explain Y1 or B1.

---

## 5-line summary
1. In these two projects there are 14 ground-truth defects (8 in y-magic, 6 in bench02). The worst is **Y1**: the "f-sum upper bound" of 1.75 a₀³ is really 15.3 a₀³, so the report's headline diagnosis ("core-valence correlation, not missing transitions") and the PI's veto of the εf follow-up are both unsupported. Nothing caught it, including the opus PI.
2. M4 would have caught 1 defect mechanically (B2, a keyless math agent turned into "skip and disclose"). M3 would have caught 1 (Y4, the hard-coded core 14.0), but the existing reviewer had already caught it and M3 would also block the legitimate 3.9.
3. M7 is the only candidate with a real shot at Y1/Y2, and only as a MAYBE: a dimension check on `alpha_deficit` fires if the deficit is typed as dimensionless, and the H-threshold limit exposes the factor of 2. As tool_review actually ran, it pinned the formula the description dictated. M2 is MAYBE/CATCH on B1 (same-H legs) but false-positives 2 of 2 legitimate perturbative-vs-exact xvals in bench02. M1, M3, M5 and M6 miss Y1 outright.
4. The cheapest decisive fix is a one-clause change to M5: a review must postdate the results.json it certifies. That would have caught Y3, the unreviewed r3 revision that carried Y1 and Y2 into the report. M1 would have *blocked* y-magic's legitimate gate-fail result, which is a new deadlock risk.
5. Of the model-bench shapes, r₀(θ) ⇒ V ≡ ħΩ does not appear in bench02: the brain explicitly rejected it. The same-H Leg A/Leg B shape does appear in plan E_2, but the Opus PI introduced it and the deepseek brain adopted it, and the run was killed at $19.92/$5 before E_2 ran. B3 and B4 are already fixed in code (e83bb6b, 8ea3eca), as is Y8 (09-22 P0).
