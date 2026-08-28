# Architecture review: the first claims-first run (pp-vs-ss, 2026-08-26 → 28)

*Reviewed: the full trace of `sisyphus-projects/pp-vs-ss-gate-packing-20260826/project` (question: PP sin⁴ vdW vs SS two-qubit gate — how many more atoms fit; flat-top beam), 2026-08-26 21:12 → 2026-08-28 07:20 UTC, against the 297nm baseline in `architecture-review-2026-08-26.md` and the claims-first design (`design-claims-first.md` §7 step 7). Sources: `.agent/log.jsonl` (94 brain tool calls, 178 spawn markers), `usage.log`, 68 agent transcripts, 8 harness review files, `pi_feedback.md`, 6 results.json + 4 replications, `notes/memory.md`, `report/report.pdf`, the claim table and integrity gate re-run on the final tree.*

## 1. Verdict in one paragraph

Better, and for the reason the design predicted: **the unit of work became the disputed quantity**. The brain's early estimate of the packing gain (E3: 1.96×, from an angular zero of C₆) was challenged by a blind replicator, the brain dispatched a discriminator (E4) that *capped* the gain at 1.35× under the gate's own blockade requirement, then found a different mechanism (E5/E6: an interaction gate *at* the zero) that recovers ~2× on honest terms. That is a research loop, not a write-up loop; the 297nm run never did it. Zero operator directives (baseline 4), one `finish()` call (baseline 4), the report's abstract is still — correctly — blocked by the claim gate. The costs of the new machinery are real and measurable (§4), and three of them are design gaps rather than tuning (§5).

## 2. Numbers against the baseline

| metric (design §7.7) | 297nm (2026-08-24) | pp-vs-ss (this run) |
|---|---|---|
| operator directives | 4 (two were livelock breaks: "WRAP UP NOW") | **0** |
| `finish()` calls | 4 | **1** (blocked: no synthesis owner → brain complied with E6) |
| sessions | 13 | 2 (both external: DeepSeek balance, operator kill) |
| cost | $151 | $95.54 ($58.8 deepseek, $25.7 opus, $9.9 glm, $1.1 kimi) |
| wall clock | 32 h | ~29 h active (34 h incl. the balance outage) |
| experiments | 7 | 6 + 4 blind replications |
| review rounds | ad hoc | 8 harness rounds (E1×3, E2–E6×1), all with DISCRIMINATOR lines |
| blind estimates | 0 | 17 replicator spawns; 15/23 headline ids estimated |
| PI estimate lines | 0 | 92 ESTIMATE + 33 DISCRIMINATOR lines |
| `disclosed_headline_count` | — | 2 (brain proposed, PI countersigned `DISCLOSE-OK`) |
| flags answered with a locator vs narrated | — | E1 θ=0: locator (re-diag −16.2 → −10.4, blind 10.4); C₆^SS sign: narrated → disclosed; E3 zero angle: locator (E4 24.3°); E3 gain: locator (E4 cap 1.35) |
| cosmetic spawns while a headline was disputed | 5 illustrator + 2 audit re-sweeps | 5 illustrator_write + report_writer + 2 auditors at 08-28 03:21–04:36 (rule in prompt only — §5.2) |
| abstract number that survived all layers while wrong | E5's 2.555e-4 shipped | 1.98× and 24.65° are in the abstract; **the gate blocks it** (6 claim-status issues, incl. value-match inheritance of the disputed 1.96) |

## 3. What worked (with the evidence)

1. **Disputes changed dispatch.** `claims_dispatch` at 08-27 read CHANGED: 5 settling / 0 cosmetic spawns after the first DISCREPANT signal. E4 is literally the reviewer's DISCRIMINATOR for E3 (`c6_total_zero_angle_deg`, `max_gain_over_orientation`), run as an experiment, and its `strong_blockade_max_gain_2d = 1.35 ± 0.05` reversed E3's headline.
2. **Blind replication corroborated the numbers that matter.** `packing_gain_2d` 1.38 ± 0.07 (blind 1.38 ± 0.07), `gain_2d_n75` 1.48 (blind 1.48), `c6_at_dm0_magic_angle` 126.3 (blind 126.3 on the second try). When the producer and the blind route agree from different routes, that is the strongest signal this system has ever produced.
3. **Producers complied once the shape was tolerated.** After the 2026-08-26 fixes: `headline`/`observable`/`uncertainty`/`uncertainty_source` 100% on every E2–E6 quantity; the near-miss hint made E2 adopt the frame's ids (`packing_gain_2d`, `c6_ss_vs_pp_ratio`).
4. **The finish gate blocked for a substantive reason** — "2 experiments and NO synthesis owner … the 297nm run computed C₆(θ) in one experiment and fidelity in another" — and the brain's answer was E6 (`interaction_gate_packing_gain_2d`), the composite deliverable. Verdict `refuted` on its own criterion, honestly recorded.
5. **Two disclosures went through the countersign path** (`CLAIM-DISCLOSE` in memory → `DISCLOSE-OK` in pi_feedback), and the gate then said "more than one disclosed headline = review request, escalate" — the design's own stop condition, reached without an operator.
6. **PI reviews carried computation.** 92 ESTIMATE lines with values; the final STOP verdict names the mechanism chain correctly (26× → 1.35× → zero → interaction gate → ~2×).

## 4. What it cost

- **Review machinery ≈ 30% of tokens**: replicator 5.3 MB of transcript (17 spawns, 608 turns), tool_review 4.1 MB, experiment_reviewer + plan reviewers 2.1 MB, vs experiment + tool_impl 14.6 MB. Opus is 27% of dollars ($25.7) almost entirely from replicators, reviewers and PI.
- **Illustration ≈ 23% of tokens** (5 illustrators, 5 illustrator_write, 12 reviewer-side illustrator children, ~11 MB) and the single most expensive hour of the run ($12.5 at 08-28 04:00) — spent while 9 headline rows were disputed and the abstract could not ship (§5.2).
- **Three false disputes from a toy blind model**: E3's replicator estimated the zero angle "45 ± 10 via two-channel equal-magnitude" and min|C₆| "22 via two-anchor fit" with `inputs: []`. They triggered E4 (worth it scientifically) but stayed in the table forever as stale rows the brain could only disclose; its memory note says exactly that: "stale blind estimates from the superseded two-channel model".
- `ledger_writer` hit its 28-turn cap 9 times → E4/E5/E6 ledger sections are partial.
- Operator error, not architecture: the run was killed at $61 by pid of the `npx` wrapper; the exec'd child ran six more hours to $95.54. `luxas stop` now exists (`src/stop-run.ts`), and a bare resume now inherits `--max-cost`.

## 5. Design gaps found (ordered by expected value)

### 5.1 Estimates need a lifecycle — supersede, not accumulate
Every `ESTIMATE(blind)` line persists in a review file and the table reads all files forever. A blind estimate made against inputs that were later corrected (E1's θ=0 value moved from −16.2 to −10.4; E3's model was replaced by E4's three-channel form) has no way to leave the dispute set. The brain's only legal moves are discriminator (done — E4) or disclosure (done — 2, which trips the escalation rule). **Proposal:** a blind estimate is comparable only while its recorded `inputs` match the current values of those ids (the comparability rule already exists for producer↔producer pairs; apply it to blind estimates too, and treat `inputs: []` from a replicator as *incomparable*, never as a flag). Add a harness-only `SUPERSEDED: <id> — <review file>:<line> by <experiment>` line written when a discriminator experiment lands for that id, so the row's history shows the estimate and why it stopped counting. Gate: the E3 → E4 trace as fixture.

### 5.2 "No cosmetic spawns while disputed" must be a speed bump, not a sentence in brain.md
The rule (design §3.7, brain.md) was violated at 03:21 with 9 rows disputed, at ~$25. CLAUDE.md is right that hard infra gates get performed around; but the cheapest possible tooth is a **non-blocking `spawn_agent` reply**: when the target is illustrator/typesetter/report_writer/auditor and the ship line is not clean, the tool result opens with the ship line and the three legal moves, and the spawn proceeds. The brain then sees the cost at the moment of the decision, not in an L3 block it read 40 turns ago. Measure: illustration dollars per project before vs after.

### 5.3 The blind estimator must compute
"The only critics with teeth are ones that compute" (2026-08-26 review). Estimate-mode replicators wrote prose routes ("via two-channel equal-magnitude") with round σ's. **Proposal:** an `ESTIMATE(blind)` counts as a flag only if the replicator's transcript shows an executed job (`.agent/jobs/*` owned by that agent) and the line cites it (`via <route> [job_…]`); otherwise it is recorded as `posthoc`-grade — visible, never disputing. The harness has the job ownership table already.

### 5.4 Finish must return the whole batch
Design §3.8 promised one batch diagnostic; `tools/index.ts` returns on the first failing class (synthesis owner at line ~594 returned before the integrity batch at ~933). The brain paid one full E6 cycle before learning about the 6 claim-status issues, the bit-identical cross-validation in E2 (`gain_3d_n60`, a wiring veto), the stale prior-art audit and the undisposed `method_blocked` (math sub-agent). **Proposal:** collect every cheap check into one list and return it with the first blocking class marked primary. This is mechanical.

### 5.5 Attestation lines are never written unprompted
`INDEPENDENT` 1/23, `ANCHOR-OK` 0/23 across 8 rounds — so no pair can reach `corroborated`, and `packing_gain_2d` stayed `conditional` despite three agreeing routes. Free-form obligation text does not elicit them. **Proposal:** the harness computes the agreeing pairs and asks the reviewer a closed question per pair ("E2:own vs review:blind for packing_gain_2d agree within 2σ — INDEPENDENT? yes/no, one clause why"), and writes the line itself from the answer. Same for anchors: list the numeric `limit_check`s present and ask ANCHOR-OK per item. Decide, after one run, whether to demote the requirement if the yes-rate is low.

### 5.6 Headline over-declaration
Producers set `headline: true` on nearly every quantity; the obligation scope reached 23 ids (frame says ≤3). Reviewers coped (91% DISCRIMINATOR coverage), blind estimates were capped at 3/round, but the ship line and the PI estimate rule scale with it. **Proposal:** a producer may mark at most 3 `headline: true` per experiment; the rest are ordinary quantities (still tabled, still comparable) — enforced at write time with the same nearest-id style hint.

### 5.7 Value-match false positives
The gate flagged "(fidelity 0.9967 at R=2.0 μm)" as carrying the disputed 1.96–1.98 gain "under a different key". The value dereference matched `2.0` within the row's σ. **Proposal:** require the matched number to have ≥3 significant figures or to sit next to the quantity's unit/name; and never match a number that is itself a declared quantity of another id (0.9967 is `cz_gate_max_fidelity`).

### 5.8 Observability of the L3 blocks
`claims_dispatch` reconstructs "when the first dispute appeared" from current disk state; E1's revised results.json removed the DISCREPANT xval, so the same run read CHANGED on 08-27 and NO-SIGNAL on 08-28. **Proposal:** `context.ts` appends `{type:"context_block", block, hash}` to log.jsonl when a block's content changes — one line per change, cache-safe because it is not in the L3 output. Then dispatch analysis is historical.

### 5.9 Small
- `ledger_writer` turn cap: raise to 40 or split the SYNTH section append into its own spawn.
- `SCALING` grammar: reviewers wrote `expected: fidelity decreases as V decreases` — now accepted as descriptive. Keep watching malformed counts per run (0 in the last file).
- Sign conventions: `observable` for signed quantities should state the convention; the write-time hint could ask for it when the id contains `c6`/`shift`/`detuning` and no sign word appears.

## 6. What to do first

1. §5.1 estimate lifecycle + §5.3 computing blind estimates (one change to `claims-table.ts` + `replicator.md` + the harness line) — removes the stale-dispute livelock that produced both disclosures.
2. §5.4 batch finish — mechanical, saves an experiment cycle per false stop.
3. §5.2 spawn speed bump — cheapest lever on the largest waste.
4. §5.5 closed-question attestation — the path to any `corroborated` row at all.
Then resume this project with `--max-cost 90`: the report exists, the gate's six issues are all actionable, and the physics answer (≈1.35× strong-blockade; ≈2× with an interaction gate at the C₆ zero, n=60) is worth finishing.
