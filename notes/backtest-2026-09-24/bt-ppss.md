# Backtest: pp-vs-ss-gate-packing-20260826

Project: `/Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project` (droplet, read-only).
Run: 2026-08-26 21:13 → 2026-08-28 17:41 UTC, **$128.61** of a $130 cap, `last_exit.finished=false`. E1–E7. Report compiled 08-28 04:59 and **never updated after that**. E7 (the settlement experiment) ran 15:50–17:37 after the operator lifted the freeze, and none of its output reached report.tex.

Models (from `.agent/conversations/*.jsonl` `model` fields and `usage.log`): brain = deepseek-v4-pro (dual profile; `usage.log` is 69% deepseek, $88.44). experiment + tool_impl + replicator + search/reader + report_writer + prior_art_auditor + contradiction_auditor = **deepseek-v4-pro**. tool_review = **glm-5.2**. experiment_reviewer + reviewer + ledger_writer + PI = **claude-opus-4-6** ($28.03). illustrator = kimi-k2.5. figure_auditor = claude-sonnet-4-6. math sub-agent = gpt-5.6-terra (died with no API key).

Cost slices: after the report compile (04:59) $43.77. After the genuine PI STOP (06:11) $37.44, all of it spent on the deadlock, escalations and E7. E7 onward $11.99.

---

## Step 1: Defect catalog (ground truth only)

### Research-quality defects

| id | defect | where | producer (model) | reached report/abstract? | caught? by what | cost |
|---|---|---|---|---|---|---|
| **D1** | `pairinteraction` `pi.C6` (degenerate-perturbation class) silently drops the ΔM=0 and ΔM=±1 channels for the stretched pair. Effects: sin⁴ fraction 0.9999999, θ=0 C6 = −1.36e-5, and a "~10⁶ anisotropy". | E1 `results.json` `c6_pp_sin4_fraction_by_n`; `notes/experiments.md` L2.1 finding 2 | E1 experiment/tool_impl (deepseek-v4-pro) | Only as a corrected artifact (§2 and §4 of report) | θ=0 part: E1's own revisions, driven by the opus experiment_reviewer ("16.16 … ~1.9σ tension"). sin⁴ fraction: E4's three-channel decomposition. | E1 took 3 revisions, the largest experiment by turns |
| **D2** | θ=0 residual truncated by the energy window: −16.16 at the ±20 GHz default and −4.96 from a single-channel partial sum, against a converged −10.41. Every n≠60 value, including n=75 (−128.76), stayed at the ±20 GHz window, so `gain_2d_n75` = 1.476 is biased and known to be biased. | E1 L2.1 §5 and Limitation 1; E2 `gain_2d_n75` | E1 (deepseek-v4-pro) | Yes. 1.476 is in claims.json as "indicative" with a caveat. | n=60: E1 revision (second-order-sum cross-check plus opus reviewer). n=75: never fixed, only disclosed. | — |
| **D3** | The E3 two-channel angular model (b=0) gave a C6 zero at 22.909° (true value 24.4–24.6°), C6(54.7°)=120.3 (true 126.3), and a divergent `max_gain_over_orientation` = 1.956. The zero was "verified to 1e-6" by a closed-form root against a numeric grid of the **same formula**. The brain's task forbade any new C6 computation ("reuse E1's model"). | E3 L2.3; `results.json` | brain task design + E3 experiment (both deepseek-v4-pro) | Only as corrected history | E4 (full diag plus the ΔM=±1 channel) and E7 (1.34 under the constraint). The opus E3 reviewer also labelled 1.956 a model artifact. | Cost E4 in full |
| **D4** | The report carries E4 values that E7 superseded, plus a label flagged as stale that was never fixed. `min|C6| = 0.007` is a grid-sample coincidence from the window-30 diag at exactly 24.0°; E7's wide window gives 0.64. The full-diag zero "24.0°" is 24.43° under E7. The report text still says "headline 24.3±0.35°". | report.tex §5 (`min|C6|=0.007`, "24.0°", "headline 24.3±0.35°"); E7 `results.json` | E4 experiment (deepseek-v4-pro); brain/report_writer (deepseek-v4-pro) did not update | **Yes**, report body, and θ*≈24.65 ±0.35 in the abstract | contradiction_sweep (04:31) flagged the stale 24.3 label, and the report compiled at 04:59 still had it (**raised, then ignored**). E7 found the rest after the report. The claims-table `disputed` gate blocked finish(), so an existing mechanism did catch it. | — |
| **D5** | **Unmatched baseline behind the headline 1.98×.** The PP interaction gate gets gate length d=2.0 µm. The SS baseline gets d = SS blockade radius (138.86/0.01)^(1/6) = 4.90 µm (`E6 runs/run_1/collect.py:25 SS_GL`). A strongly blockaded SS gate at 2 µm is legal and standard: V_SS(2 µm) ≈ 2.2 GHz ≫ Ω, and the report's own intro cites Evered2023 "53S blockade gates at 2 µm". **I recomputed E6's own lattice families (aligned plus half-period stagger, isotropic, V_ct = 10 kHz). SS density = 0.00703 at d=4.90 (reproduces E6's 0.007038), 0.00836 at d=2.0, and 0.00959 as d→0.** The matched-gate-length gain is therefore **1.66×, not 1.98×** (−16%). At d→0 it is 1.45×. The same "gate length = blockade radius" convention also runs through E2/E4 (d_gate = 5.47 / 4.90). | E6 `collect.py:25,34`; report abstract and §7; Fig. 1 caption ("strong-blockade S–S gate requires R∼4.9 µm") | E5 follow-up framing ("R~2 µm vs … R~5.5 µm"), E6 experiment, brain (all deepseek-v4-pro) | **Yes: headline number in title and abstract** | **Never caught.** The E6 reviewer (opus) wrote the mismatch into its own DISCRIMINATOR ("SS staggered pitch ≈ gate_length + R_ct_SS ≈ 4.9 + 15.5"). The PI (opus) estimated "R=2µm vs R_b≈4.9µm area ratio". | Headline wrong by about 16–27% |
| **D6** | **The weak-blockade gate's interaction at R=2 µm is not established.** `V = C5/R⁵ + C8/R⁸ = −2.887 MHz` assumes the C6 term cancels exactly and that the asymptotic expansion holds at 2 µm. (a) *Angle sensitivity, definitive from artifacts:* E7's `c6_discriminator_scan.csv` gives dC6/dθ ≈ 1.45 GHz·µm⁶/deg at θ*, which is ≈23 MHz/deg at R=2 µm. A 0.13° error, about 4.5 nm of transverse position at 2 µm, already equals the whole −2.887 MHz. E7's own inter-method zero spread of 0.21° puts about 5 MHz of C6 term at the gate's operating angle (24.65° vs a full-diag zero at 24.43°). E6's premise correction shows the same thing: 0.35° flips the sign, +8 MHz. None of this entered the σ of the fidelity or of the gain. (b) *Validity domain, strong inference:* no angle-resolved pair diagonalization was ever done below R=6 µm (E4/E7 `DISTANCES_UM=[6..15]`; the C5 control used 3–10 µm, at θ=0 only). The near-Förster S+S channel (defect 0.278 GHz) already gives a 10% diag-vs-perturbative spread at 6–15 µm, and that spread grows about as R⁻⁶. The S+S-dominated c·sin⁴θ* term being cancelled is about 140 MHz at 2 µm. So the multipole cancellation is unverified at the operating point. | E5 L2.5; E4 `quadrupole_floor.json`; report abstract "fidelity 0.9967 at R=2.0 µm" and §6 | E4 follow-up framing, E5 experiment (deepseek-v4-pro) | **Yes: abstract (0.9967) and mechanism narrative** | **Never caught.** No reviewer or PI mentioned the vdW crossover or angular tolerance. Note: the packing gain (cross-talk at ≥6.5 µm) is much less affected than the gate-viability claim. | — |
| **D7** | "τ=100 µs is the 60S value; 60P₃/₂ decays faster, so the computed fidelity is an upper bound." The direction is wrong. Rb nP₃/₂ radiative lifetimes exceed nS at the same n (Beterov 2009 scaling; the τ_l^(0)(n*)^α form is also in literature.md:314). The fidelity is conservative, not an upper bound. Minor, medium-high confidence, standard knowledge. | E5 Limitation 3; report §6 | E5 experiment (deepseek-v4-pro) | Yes (report §6 text) | Never caught | — |
| **D8** | "≈1.35× strong-blockade **ceiling/cap**" is a grid-best result over two restricted lattice families (E4 Limitation 5). The contradiction_sweep raised an "upper-bound concern" and the report still says "ceiling" (**raised, then ignored**). E7 then found about 1.56 with a general oblique lattice plus tilt (unverified). | report abstract and §3; claims.json `strong_blockade_max_gain_2d` graded "corroborated" | E4 (deepseek-v4-pro) | **Yes, abstract** | Raised by contradiction_auditor (deepseek) and ignored. E7 found the counterexample after the report. | — |
| **D9** | **The E7 "settlement" is not independent.** `pp_interaction_gate_density` is re-run by **importing E6's own module** (`interaction_gate_discriminator.py:24-30`), and its cross-validation compares feasibility ratios (1.0000001 vs 1.0000001), not densities. The `max_gain_over_orientation` cross-validation compares two θ=90 *baselines* (1.3385 vs 1.331), not maxima. The same id was **re-defined** from E3's unconstrained 1.956 to a strong-blockade-constrained 1.34, and then declared "confirmed". | E7 `results.json` `computed.cross_validation` | brain task ("reuse prior scripts … do NOT re-derive") + E7 experiment (deepseek-v4-pro) | No (after report) | Never caught. The E7 review died on Anthropic 400 credit. | — |

### Process defects that damaged research quality

| id | defect | evidence | model | effect |
|---|---|---|---|---|
| **P1** | Infra failures became "skip + disclose". The tool_review (glm-5.2) returned 429 code 1113 (quota) on **every** attempt for E5 (5 spawns), E6 (4) and E7 (2). E5's tests/ is empty; E6 and E7 have no tests/ at all. The math sub-agent died on "No API key for provider: openai-codex" (E3) and failed with no record (E2). | L2.5 Lim 1, L2.6 Lim 1, L2.7 Lim 1; conversations `*.tool_review-*` (3 lines each, `errorMessage":"429`) | glm-5.2 quota; experiment (deepseek) chose "fallback = orchestrator checks" | **The three experiments behind every abstract headline (0.9967, 1.98, and the settlement) have zero adversarial tests.** |
| **P2** | Review evidence was lost or never produced. E1's substantive opus reviews from 08-26/27 (which drove the D1/D2 fixes) were **overwritten** in `reviews/experiment_review_E1_*_r{1,2,3}.md` by the 08-28 15:26–15:41 re-review, which died on `400 credit balance too low`, so the files now read REVIEW-INCOMPLETE. The E7 reviews r1–r3 are all 1-turn 400s. The PI returned non-verdicts at 13:25 and 13:31 (402/credit). The ledger_writer for E7 also got a 400. | `conversations/brain.experiment-review-*.experiment_reviewer-{4tq2xx,rvjbqs,dbnd1q,tnb6wr,a53jtr,4og3pj}` | Anthropic balance exhaustion | E7 was never reviewed. The E1 review record was destroyed. |
| **P3** | The run could not finish. The STOP freeze deadlocked against the finish gate, and edit was broken (`notes/escalations/finalization-blocked.md`). A harness false dispute (blind |C6| vs signed C6) forced a disclosure budget escalation (`needs-operator.md`). After the operator unfreeze, the budget ran out ($128.61/$130) before the report absorbed E7. | escalations/*.md, directives/*.md, `last_exit.json` | harness | Report stale (D4); $37 spent after the genuine STOP |
| **P4** | PI "estimates" were tautological, and the brain then used them as corroboration. Examples: "0.014 ± 0.002 via … agent's 143.77 µm² gives 0.0139"; "−10.4 via 4a = 4×(−2.60)", which just restates the producer's coefficient. `needs-operator-disputed.md` argues "All seven DISCRIMINATORs are already corroborated by the PI's own posthoc ESTIMATEs". | `reviews/pi_feedback.md` L43–66, L99–122, L142+ | PI claude-opus-4-6 (source); brain deepseek-v4-pro (misuse) | Circular corroboration in the operator-facing escalation |

---

## Step 2: Verdict matrix (defects × M1–M7)

Key: C = CATCH (mechanical), M = MAYBE (needs the right judgment call), – = MISS, n/a = not applicable. "(ex)" means an existing Luxas mechanism already caught it.

| | M1 anchor | M2 independence | M3 receipts | M4 failure routing | M5 per-EID review | M6 x-project memory | M7 physics-invariant tests |
|---|---|---|---|---|---|---|---|
| D1 pi.C6 channel drop (ex) | M | – | – | n/a | – | M | M |
| D2 window truncation / n=75 (ex for n=60) | M | – | – | n/a | C (partial) | – | M |
| D3 two-channel zero / 1.956 (ex, E4) | M | C | – | n/a | C | – | – |
| D4 stale / grid-artifact values in report (ex, gate) | – | – | – | – | C | – | – |
| **D5 unmatched SS baseline (headline)** | – | – | – | n/a | – | – | – |
| **D6 V(2 µm) unverified / angle sensitivity (headline)** | – | – | – | n/a | C (partial, wrong reason) | C* (lesson exists; see caveat) | – |
| D7 lifetime direction | M | n/a | – | n/a | M | – | – |
| D8 "ceiling" is restricted-family best-found | n/a | – | – | n/a | C | – | M |
| D9 E7 non-independent settlement | n/a | C | – | n/a | M | – | n/a |
| P1 tool_review 429 → skip + disclose | n/a | n/a | n/a | C | – | – | (depends on M4) |
| P2 reviews lost to 400 credit | n/a | n/a | n/a | C | M | – | n/a |
| P3 could not finish (ex, fixed 09-22) | n/a | n/a | n/a | M | – (worsens) | – | n/a |
| P4 tautological PI estimates | n/a | M | – | n/a | – | – | n/a |

### Reasons (one per non-trivial cell)

**D1**
- M1 M: the natural anchor was a PP number already in `frame.md`, Vermersch2014 n=25: C6(θ) = 6.33 sin⁴ − 0.267 sin² + 0.269 MHz·µm⁶. `pi.C6` gives about 2e-6 for the θ=0 residual against 0.269. But E1 had already satisfied "≥1 published number" with the SS anchors (43S Low2012, 70S Walker2008), which pass. As specified, M1 fires only if the anchor has to match the observable class. The prior 297nm project hit exactly this mismatch and explained it away as "treatment-dependent (Zeeman)".
- M2 –: the problem is a dropped channel, not two legs sharing a construction. The existing diag-vs-perturbative disagreement at θ=0 is what triggered the fix.
- M6 M: 297nm (archived 08-26 01:48, before this run) records "field-free perturbative returns ~2.1e-6 … anisotropy treatment-dependent (1e6 vs 56× full diag)". The brain copied those numbers into `frame.md` and E1 still produced 10⁶. The same project also mislabelled sin⁴ fraction = 1.0 as real.
- M7 M: a test such as "C6(θ=0) equals the ΔM=0 channel from an independent second-order sum" would expose it. The E1 glm tests (6 files) instead tested sin⁴ form and passed.

**D2**
- M1 M: no published n=60 θ=0 residual exists. An anchor would have to be Vermersch at n=25, which is a different n.
- M5 C (partial): the E2 reviewer's DISCRIMINATOR ("repeat θ=0 at n=75 ±100 GHz") has no results key, so `gain_2d_n75` gets downgraded. It was already labelled "indicative".
- M7 M: a window-convergence test is plausible from the tool description ("energy_window_ghz" parameter).

**D3**
- M2 C: both legs of `c6_total_zero_angle_deg` (closed-form root and grid) are analytic evaluations of the same two-channel function, so the "<1e-6 agreement" credit is rejected mechanically. It had no real effect, because E3 already called the zero unverified and E4 fixed it.
- M5 C: the E3 reviewer's DISCRIMINATOR ("full pair diagonalization at 5 angles 20–50°") has no E3 key.
- M1 M: Vermersch's three-term form has a sin² (ΔM=±1-like) term. A two-channel fit is about 8% off at 45°, which is tolerance-dependent.

**D4**
- M5 C: the E4 reviewer's DISCRIMINATOR ("full diag at 1° steps, window >30 GHz") has no E4 key, so `c6_total_zero_angle_deg` and `c6_diag_min_abs` are downgraded and must be hedged in the report.
- M3 –: the stale values do have receipts (E4 results.json).
- The existing claims-table gate had already blocked finish() on this.

**D5**
- M1 –: no published number anchors "SS packing density at matched gate length". Evered's 2 µm is a geometry, not a computed quantity.
- M2 –: not a cross-validation problem. `frame.md` says "matched operating parameters", but M2 diffs Hamiltonians, not geometry.
- M3 –: every number has a receipt.
- M5 –: the reviewer did read `collect.py` and **endorsed** 4.9 + 15.5.
- M6 –: no earlier lesson on baseline matching.
- M7 –: a tool-level test cannot see a mismatch made in `collect.py`. E6's isotropic-limit test passes (0.007038 reproduced).

**D6**
- M1 –: no published short-range Rb 60P₃/₂ pair potential at θ* in `literature.md`.
- M2 –: E5's cross-validation (qutip master equation vs Saffman Eq.34) is different-class, but both legs consume the same V(R). `frame.md` has no gate Hamiltonian to diff against.
- M5 C (partial): the E5 reviewer's DISCRIMINATOR ("re-run … including C9+ multipoles at R=2.0 µm") has no key, so 0.9967 is downgraded. It is downgraded for an adjacent reason; neither the crossover nor the angle tolerance is surfaced.
- M6 C*: 297nm L2.2 has "at typical blockade distances R~1–3 µm the interaction is non-perturbative. The clean R⁻⁶ tail begins only at R~5–12 µm … should not be used as naive design inputs without the full pair potential". Its L2.5 has "R=4 µm … |rr⟩ purity 0.469". **Caveat:** the brain demonstrably read this project for `frame.md` (it imported "3482 GHz·µm⁶ … from adjacent project E2") and dropped the caveat. Realistically this is a MAYBE.
- M7 –: the exposing limit is "full diag at R=2 µm, θ* reproduces C5/R⁵ + C8/R⁸" or "∂V/∂θ tolerance". Neither follows from the E5 tool description (V is an input), and neither is a limiting case a blind test author would choose for the E4 quadrupole tool.

**D7**
- M1 M: a Beterov lifetime anchor applies only if E5 had to anchor τ.
- M3 –: τ is an input, not a result.
- M5 M: the reviewer reads the scripts, so catching it is a judgment call.

**D8**
- M5 C: the E4 reviewer's DISCRIMINATOR ("finer 1° grid, verify none > 1.5") has no key, so the claims.json "corroborated" 1.35 is downgraded.
- M7 M: a monotonicity test ("a superset lattice family never lowers density") is plausible but is a judgment call.

**D9**
- M2 C: the E7 density leg imports `E6_interaction_gate_packing_gain/scripts/interaction_gate_packing_density.py`, a shared module in the import graph. The max-gain legs are both the same-class θ=90 optimizer baseline.
- M5 M: E7 review files *exist* (r1–r3, INCOMPLETE). As specified ("has an experiment_review file"), M5 passes. It blocks only if completion is required.

**P1**
- M4 C: 429 code 1113 is classified infra, retried or switched provider, and "skip + disclose" is forbidden.
- M7 depends on M4: tool_review never ran for E5–E7, so M7 alone adds nothing there.

**P2**
- M4 C: the 400 credit error is infra. It needs a provider switch (Anthropic balance was at zero; backoff does not help).
- M5 M: completion vs file existence, as for D9. Separately, the harness overwriting valid review files with failed ones is a mechanism bug in its own right.

**P3**
- (ex) The P0 fixes of 09-22 (freeze closure, edit normalization, soft cap) address the deadlock.
- M4 M: it covers the PI non-response, but not the budget exhaustion.
- M5: adds finish blockers, so it worsens P3.

**P4**
- M2 M: applies only if ESTIMATE lines are treated as legs with a declared method class ("4a from producer coefficients" = same source).

---

## Step 3: False positives and cost in this project

- **M1.** Natural published anchors exist only for E1 (43S Low2012, 70S Walker2008, and Vermersch2014 for PP) and weakly for E5 (Saffman2010 gate-error formulas; Evered2023 0.995). E2, E3, E4, E6 and E7 have **no** published anchor for their observables; prior_art.md says "no earlier paper computes a packing/atom-count gain". So **5 of 7 experiments** would be blocked or pushed into contrived "anchors" such as the hexagonal close-packing density, which is not published. The two headline defects (D5, D6) have no anchor that would fire.
- **M2.** At risk of false downgrades: E1 θ=0 (wide-window diag vs all-channel second-order sum) and E4/E7 zero angle (hand-built diag vs second-order sum). The methods are genuinely different classes (exact-diag vs perturbative), but **both import `pairinteraction.real`** for matrix elements. If "H-construction module" is read at package level, 2–3 legitimate cross-validations get downgraded, including the one that actually resolved D2. It needs a library allowlist or a function-level import graph. ARC and Singer legs are safe.
- **M3.** Few legitimate values lack receipts: E1's `arc_blind: 10.4` is a hand-typed constant in E1's results, but it has a real receipt in the replicator conversation (ARC `PairStateInteractions` run), not in an output file. There are also literature inputs (Low2012, Walker2008) and rounded report values (≈26, ≈1.35). M3 catches no ground-truth defect here; every wrong number has a receipt.
- **M4.** No false positives. Cost: the provider balance was **exhausted** (glm quota, then Anthropic credit), so retry with backoff fails and a provider switch is required. With $1.4 of headroom at the end, forced retries could not have run. **New deadlock risk:** if infra failures can never be disclosed, a zero-balance provider makes E7 review and PI impossible, so finish never passes. It needs an escalate-to-operator exit.
- **M5.** Extra work needed:
  - complete reviews for E1 and E7 (both were infra-killed);
  - DISCRIMINATOR→key mapping would downgrade roughly 8 claims (E2: n=75, ss_vs_pp; E3: 3 ids; E4: C8 window, finer grid, zero angle; E5: C9+). That includes 0.9967 and 1.35, and C8 feeds 1.98.
  
  Settling those needs about 3–4 more experiments. With $1.4 left, this is a **certain finish deadlock** unless downgrade is allowed to ship as a hedge instead of blocking.
- **M6.** No blocking cost. The injection would carry 297nm's partly wrong lessons (sin⁴ fraction = 1.0 as real), so trust tags matter.
- **M7.** It could not run for E5–E7 (tool_review quota-dead), so it depends on M4. For E1–E4, glm tests existed and passed with the artifacts in place. The added SymPy unit checks would find no unit defect in this project.

---

## Step 4: Model attribution

| defect | authoring step | model |
|---|---|---|
| D1 | E1 tool_impl/experiment chose `pi.C6` and trusted its channel fit | deepseek-v4-pro |
| D2 | E1 default ±20 GHz window; n≠60 never re-run | deepseek-v4-pro |
| D3 | brain task forbade new C6 computation; E3 built a two-channel model | deepseek-v4-pro (brain + experiment) |
| D4 | E4 grid-sample "min|C6|"; brain/report_writer did not update the report or fix the flagged label | deepseek-v4-pro |
| D5 | E5 follow-up and E6 `collect.py` set SS gate = blockade radius; brain adopted it; **opus reviewer + opus PI endorsed it** | deepseek-v4-pro (authored); claude-opus-4-6 (missed twice) |
| D6 | E4 follow-up framing plus the E5 V(R) model at 2 µm; **opus reviewer + PI missed it** | deepseek-v4-pro (authored); claude-opus-4-6 (missed) |
| D7 | E5 limitation text | deepseek-v4-pro |
| D8 | E4 "ceiling" wording; brain ignored the contradiction_sweep flag | deepseek-v4-pro |
| D9 | brain "reuse, don't re-derive" task plus E7 cross-validation design | deepseek-v4-pro |
| P1 | glm-5.2 quota (infra); experiment chose skip | glm-5.2 / deepseek-v4-pro |
| P2 | Anthropic balance (infra) + harness overwrote review files | harness |
| P4 | PI copied producer values into ESTIMATEs | claude-opus-4-6 |

**Read on "base model vs scaffold".** Every defect in the physics and design was *authored* by deepseek-v4-pro, but that is the only model that wrote any physics here, so authorship alone is uninformative. The informative signal is on the **check** side: claude-opus-4-6, reviewing as reviewer and PI, **caught** D1, D2 and D3 (all numerical or self-consistency problems visible in the ledger). It **missed and actively endorsed** D5 and D6, the two framing/validity-domain defects that carry the headline. The one model upgrade available in this run did not fix what matters. The scaffold defects (P1–P3: quota → skip, review overwrite, freeze deadlock) removed the adversarial tests and final review from exactly the headline experiments. In this project the scaffold explains *why nothing independent ever looked at E5–E7*, and the base models explain *why the reviews that did happen missed D5/D6*. Neither alone is sufficient.

---

## 5-line summary

1. In this project (9 research + 4 process ground-truth defects), **M5 would have fired mechanically on 5** (D2, D3, D4, D6-partial, D8), mostly through unmapped reviewer DISCRIMINATORs. It would also have added about 8 downgrades and a near-certain finish deadlock at $1.4 of headroom.
2. **M2 caught 2** (D3 same-formula "verification"; D9 E7 importing E6's module). It risks downgrading 2–3 legitimate cross-validations that share `pairinteraction.real`. **M4 caught 2** (P1 glm 429 → zero tests for E5–E7; P2 Anthropic 400 → E7 unreviewed, E1 reviews overwritten).
3. **M1, M3 and M7 caught 0.** M1 has no published anchor for 5/7 experiments. M3 found every wrong number had a receipt. M7 never ran where it mattered because tool_review was quota-dead.
4. **M6 caught 1 on paper** (D6: 297nm had "R~1–3 µm is non-perturbative, don't use C6 as a design input"), but the brain had already read that project and dropped the caveat, so realistically it is a MAYBE.
5. **The two headline defects were missed by every mechanism: D5 and D6.** D5: the SS baseline gets a 4.9 µm gate while PP gets 2 µm, and a matched 2 µm SS gate drops 1.98× to **1.66×** on E6's own lattice. D6: the 0.9967 gate rests on an unverified multipole V at 2 µm, where 0.13° of angle error equals the whole interaction. Both were endorsed by the claude-opus-4-6 reviewer and PI.
