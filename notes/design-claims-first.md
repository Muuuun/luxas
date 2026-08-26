# Design: claims-first research dynamics

*Draft 2.1, 2026-08-26 — after a four-critic adversarial round and a convergence round (all four: ACCEPT-WITH-FIXES; fixes applied, see §10) (epistemologist, systems engineer, AMO-PI referee, simpler-alternatives advocate). Draft 1 is preserved in git history; §10 is the adjudication log. Companions: `architecture-review-2026-08-26.md` (diagnosis), `human-researcher-trace.md` (evidence base).*

---

## 1. One sentence

The unit of research state becomes the **quantity** — a named observable with project-wide identity, a history of estimates, and a status computed from data — and the abstract may carry only what that status supports. The report stays authored; it is *gated* by claim status, not generated from it.

## 2. What the debate settled

Unanimous or three-of-four, adopted as is:

- **Quantity `id` under nearest-id rejection is the primitive.** It is the one producer-compliance mechanism in this repo with a before/after (key invention 70% → 0% on `claims.json`). Keep it; concentrate the producer contract on it.
- **Producer self-clearing is deleted everywhere.** `cross_validation_resolved` clears nothing. No adjudication-by-reason. No brain-side unilateral disclosure. A dispute closes only when a computation both sides agreed would discriminate has run.
- **Wiring never corroborates, and wiring is computed, not declared.** Two values agreeing to < 1e-6 relative, from the same script, or from the same agent are the same computation (inputs are compared by value, not closure — see 3.3). Widen the existing `===` veto; do not retire it.
- **`corroborated` needs an externally anchored leg.** Two agreeing novel computations from one model family are `converging`, not corroborated. Anchors: a limiting case with a known answer, a literature value with a locator, or a nearby published benchmark with a stated scaling adjustment.
- **Majority vote over estimates is deleted.** It promotes whichever observable got implemented more often (the 297nm category error would have *won* a vote).
- **`load` is computed from the consumer side** (abstract/conclusion `claims.json` entries and the verdicts that read them). A producer declaration is at most a floor. An abstract with numbers and an empty headline set blocks.
- **Reviewer obligation is a pre-registered discriminator plus a blind estimate — flag, then escalate.** Not a one-line Fermi that auto-blocks at 3×; that veto belongs to a prior the trace shows is bad, and its example route was a function of the producer's most fragile number.
- **Keep the 12-call global finish backstop unconditionally.** Escalate-on-repeat is layered *under* it, keyed on non-decreasing issue count, never on issue kind (7 kinds is too coarse; kind-keying restores the 441-call bug).
- **Physics errors announce themselves in exponents, not point values.** E5's own two numbers give leakage ∝ Ω^4.03 where finite-blockade error goes as Ω². A scaling/limit check catches this at zero experiment cost; no tolerance on point agreement does. Headline quantities carry a limit check and, where swept, an observed exponent.
- **Uncertainty replaces producer-declared `resolution`.** A headline number without σ is four-significant-figure theatre; with σ, "disputed" is a σ-distance and the 1.5×–3× dead band closes. Missing σ caps status at `indicative`.
- **Minimal producer surface, four fields, two mechanical.** Everything else in Draft 1's `quantities[]` (units, conditions, class, resolution) had no consumer or was a producer-declared switch.
- **Legacy is grandfathered, not degraded.** `quantities[]` absent ⇒ today's gates. bench-05 splits into a retrofit fixture and a raw-legacy fixture.

Rejected from Draft 1: the 8-rung method-class enum, producer-declared `resolution`, `CLAIM-DISCLOSE` as written, `adjudications.jsonl`, majority-supersede, the status rename (`indicative` stays), `definition_conflicts` as a hard block on free-text equality, `moves:` as a separate frontier subsystem, the kind-keyed 2-call finish rule, and untruncated `<claim_status>`.

## 3. Data model

Computed view over `results.json` + reviewer artifacts. No stored registry (unchanged rationale).

### 3.1 Producer contract (experiment)

Phase 1, in the Evidence Contract and persisted to `results.json`:
```jsonc
"computed": { "quantities": [ { "id": "blockade_leakage_40MHz", "key": "computed.master_equation.leakage_40MHz" } ] }
```
Phase 3, after the number exists, for quantities the experiment believes headline (a floor, see 3.4):
```jsonc
{ "id": "...", "key": "...", "headline": true,
  "observable": "population outside |gg> after the pulse, evolving |gg> under sesolve; no |gr> branch, no conditional phase (dimensionless; n=75, theta=90, R=4um, Omega/2pi=40MHz)",
  "uncertainty": 5e-5, "uncertainty_source": "V(4um) ±10% from pair-state truncation, propagated as 2*dV/V",
  "limit_check": { "limit": "V -> 10 GHz", "expected": 0, "observed": 3e-9, "artifact": "scripts/blockade_gate_master.py:limit_test" },
  "inputs": { "blockade_shift_4um": -0.152, "rydberg_lifetime_75P": 221.6 } }
```
Write-time validation (same hook as `claims.json` today): `id` must reuse an existing project id or be lexically distant from all of them (nearest-id rejection with suggestions); `uncertainty` numeric > 0 or absent (never a string; strings are rejected, not coerced — `Number("0.001")` must not pass); `inputs` keys must be existing ids and values must be the numbers actually used (values, not just ids — two estimates reading the same id at different values are *incomparable*, not wired); `limit_check.observed` must be transcript-anchored like `method_blocked.verbatim_last_error`. Verdict predicates (`f40_gt_f10`) are not quantities; they are `verdicts: [{id, reads: [ids]}]`.

Producer fields with a named consumer, field by field: `id` (registry, validator, table), `key` (registry), `headline` (load floor), `observable` (reviewer prompt, contradiction auditor, report_writer), `uncertainty` (status σ-distance), `limit_check` (anchor *proposal* — it counts only after reviewer attestation, 3.3), `inputs` (comparability rule, dispute propagation, reads-diff). Nothing else.

### 3.2 Estimates

An estimate = `{quantity, value, sigma?, source, inputs, anchored}`. Sources: (1) the experiment's own key; (2) each `cross_validation` entry's `value_b` — this deliberately reads a subtree the registry excludes as "bookkeeping", with the rationale that a `value_b` is bookkeeping *as a claim* and evidence *as an estimate*; (3) another experiment's same-id entry; (4) reviewer blind estimates (3.5); (5) literature values with a locator; (6) a replicator's result (3.6).

### 3.3 Independence (computed)

Two estimates are **wiring** iff any of: bit-agreement < 1e-6 relative; same script artifact; same agent. (Inputs closure is *not* part of the wiring test — inputs are compared by value, below.) Two estimates of one id whose `inputs` differ in **value** for any shared id are **incomparable**: they never corroborate, and if they disagree beyond 2σ the dispute is *propagated onto the differing upstream id*, which joins the headline set — a mismatch withholds corroboration but can never dissolve a dispute. Otherwise the pair is comparable; for headline quantities the experiment_reviewer additionally attests `INDEPENDENT: <id> <a> vs <b> — <why the routes differ>`, and unattested pairs stay `wiring`.

An estimate is **anchored** iff it is a literature value with locator, a nearby benchmark with a stated scaling adjustment, or a `limit_check` that the reviewer has attested `ANCHOR-OK: <id> — <why competing observables predict different values at this limit>`. A limit whose expected value is zero is wiring unless so attested — every candidate observable vanishes at V→∞, so a self-chosen zero limit discriminates nothing.

### 3.4 Status (computed)

Headline set = the ids named in `notes/frame.md` at framing ∪ `headline: true` declarations. A `claims.json` abstract/conclusion entry whose quantity is outside that set **blocks** (the set never silently widens); quantities read by in-set verdicts, and upstream ids onto which a dispute propagated, are pulled in. Then per quantity:

| status | rule |
|---|---|
| `corroborated` | ≥2 independent estimates agree within 2σ (σ combined; both σ present) **and** at least one anchored leg agrees |
| `converging` | ≥2 independent estimates agree, no anchored leg |
| `indicative` | one independent estimate (existing name; = single-method) — also the cap when σ is missing |
| `disputed` | comparable independent estimates disagree beyond 2σ; or a pair with a missing σ differs by > 3×; or a flagged reviewer estimate is unanswered after one round (3.5); or the observed scaling exponent differs from the expected by > 0.5 (3.5) — cleared by the same one-round-locator rule |
| *(missing σ)* | a pair with any missing σ can never be `corroborated` or `converging` |
| *(incomparable)* | different input values (3.3): never corroborates; disagreement propagates upstream |
| `disclosed` | disputed, countersigned disclosure (3.6.3) |
| `conditional` / `divergent` | existing rules; `conditional` also when any `inputs` or `reads` quantity is `disputed`/`indicative` |

Render caps (existing principle, extended): abstract/conclusion may carry `corroborated` unhedged; `converging` and `indicative` with a one-clause hedge naming the regime and σ; `disclosed` only with its countersigned hedge; `disputed`, `conditional`, `divergent` not at all. First-of-kind single-method results belong in the abstract *with a number, an uncertainty, and a regime* — that is the hedge, not the word "indicative".

Applied to 297nm: `blockade_leakage_40MHz` has E4 (perturbative, V=850) and E5 (1−P_gg, V=−152); with `inputs` declared they are estimates under different upstream values of `blockade_shift_4um` and the fight routes there: `blockade_shift_4um` is `indicative` (one method, no anchor) → E5's leakage is `conditional` → `ordering_f40_vs_f10` is `conditional` → not the abstract. The right outcome for the right reason.

### 3.5 Reviewer obligation (experiment_reviewer, PI)

"Preregistered" cannot be enforced inside one agent turn (the reviewer sees criterion, data and narrative in one context). So the blind estimate is produced by the **harness**: before spawning `experiment_reviewer`, it spawns a `replicator` in `estimate` mode — blind to the producer's scripts and value, given the `observable` sentence and `inputs` values only, small budget — and injects the result into the reviewer's context as `ESTIMATE(blind)`. The reviewer then records, per headline quantity in scope:
```
DISCRIMINATOR: <id> — if the number is right: <prediction>; if wrong: <prediction>; computation: <what would tell them apart>
ESTIMATE: <id> — <value> ± <sigma> via <route> — inputs: [<ids or "own">]
SCALING: <id> — expected <exponent> in <parameter>; observed <exponent> from <artifact> (or "not swept")
```
Rules: the blind estimate is the one that can flag; a reviewer's own post-hoc `ESTIMATE` line is recorded as `post-hoc` and never flags. An estimate whose inputs are entirely producer-supplied values is recorded but never flags. `SCALING` has status consequence (3.4): an exponent mismatch > 0.5 disputes the quantity. A > 3× disagreement **flags**: the producer must answer with a locator (a computation, not prose) in one round; an unanswered flag, or a second-round disagreement, makes the quantity `disputed`. The discriminator becomes a frontier lead automatically (3.7). A review lacking these lines for its headline quantities is treated as no review — same as a PI review with no `## Verdict`.

### 3.6 Closing a dispute

1. **Discriminating computation** — the pre-registered discriminator (or an equivalent one the reviewer accepts) runs and lands as an estimate; status recomputes. The outlier is not "superseded"; it stays in the table with the discriminator's result beside it.
2. **Blind replicator** — one per project, aimed at the headline quantity that is `disputed` or `indicative` with the highest load. A `replicator` agent receives the `observable` sentence and `inputs` only: no method, no producer value, no read access to the producer's `scripts/` (the `wrapToolImplTools` path-block, extended). Its number enters as an estimate; the parent records, never reconciles.
3. **Countersigned disclosure** — the brain proposes `CLAIM-DISCLOSE: <id> — <hedge sentence>` in `notes/memory.md`; it takes effect only when a reviewer or PI countersigns in its own artifact (`DISCLOSE-OK: <id>`) — and the countersigner must be none of: the producer of either estimate, the author of the flag, the brain (agent-id check, same as the replicator's), the hedge appears in the claim's sentence, and a `disclosed_headline_count` lands in `finish_stats.json` and in the report's Methods-and-scope. **More than one disclosed headline quantity escalates to the operator** (`notes/directives/needs-operator.md`, clean exit with artifacts marked): a report resting on two disclosed disputes is a review request.
4. **Descoping** a frontier lead that would settle a `disputed` headline quantity is not a disclosure route; it escalates to the operator.

### 3.7 Brain steering surface

One compact L3 block, headline quantities only (bounded at ~12 rows, deterministic):
```
<claim_status>
blockade_shift_4um        INDICATIVE   E5:-152±15 MHz (diag)   no anchor   ← blocks: blockade_leakage_40MHz, ordering_f40_vs_f10
blockade_leakage_40MHz    CONDITIONAL  E4:1.1e-3 (V=850) E5:2.6e-4±5e-5 (V=-152) rev:1.7e-2 FLAG(unanswered)   scaling: obs Ω^4.03 vs exp Ω^2
n_at_297nm                CORROBORATED E1:75.33 lit:Manthey2014§2
frontier: [1] discriminator for blockade_leakage_40MHz (rev:E5) — two-branch gate at V=-152, check ε∝Ω² in V≫Ω limit
ship: 1 conditional headline → abstract blocked; discloses used: 0/1
</claim_status>
```
Replaces `stopping_signal`, `undispositioned_anomalies`, `iteration_lineage` (retire `src/dynamics.ts` blocks; keep `listExperimentRuns`). **Build order condition:** first surface today's DISCREPANT rows in L3 as a two-line block and check on one live run whether dispatch changes; the full table ships only if it does.

**Headline scope is fixed at framing.** The brain's `notes/frame.md` names ≤ N headline quantity ids for the user's question (N = 3 for a short ask; PI plan review may raise it). The table and the ship predicate are scoped to that set. The frontier is ordered by: reviewer discriminators on headline quantities → leads that add an anchored or independent estimate to a `disputed`/`indicative` headline quantity → everything else. Illustrator/typesetter/audit passes are not dispatched while a headline quantity is `disputed`.

### 3.8 Finish

All gates run as one batch diagnostic returning the complete list. `finishCallCount`'s 12-call global backstop is untouched. Underneath it: if the total issue count has not decreased across two consecutive `finish()` calls, escalate to the operator instead of iterating. Claim-status issues are one issue kind with the three legal moves listed (discriminator / replicator / countersigned disclosure).

### 3.9 Definitions

`observable` is one sentence, human-read: by the reviewer (to write the discriminator), the contradiction auditor (as prose, `revise`-level, never a string-equality veto), and report_writer (to phrase the hedge). The mechanical checks are: `inputs` mismatch across estimates of one id (prima facie different observable → not independent, flagged); and a **reads-diff**: when a verdict id recurs across experiments, a quantity that drops out of its `reads` set without a stated replacement blocks — this is how E6's silent channel swap (gate error → 1−P_gg) surfaces, and nearest-id cannot see it.

## 4. Producer → consumer table

| Producer | Where | Consumers (named) |
|---|---|---|
| `quantities[]` (id, key, headline, observable, uncertainty, limit_check, inputs) | results.json | registry v2, write validator, `<claim_status>`, finish claim gate, reviewer prompt scope, report_writer context, contradiction auditor (prose) |
| `verdicts[]` (id, reads) | results.json | status propagation, reads-diff gate |
| `cross_validation.value_b` | results.json | estimates (harvested) |
| `DISCRIMINATOR/ESTIMATE/SCALING/INDEPENDENT/DISCLOSE-OK` lines | reviewer & PI verdict artifacts | estimates, independence attestation, flag state, disclosure countersign, review-completeness gate |
| `CLAIM-DISCLOSE:` | notes/memory.md | disclosure (pending countersign) |
| replicator result | `data/experiments/<id>/replication/results.json` | estimates |
| `frame.md` headline ids | notes/frame.md | table scope, ship predicate |

One smoke gate per row, in the `run-gates` MANIFEST; every consumer **complains** on a malformed row (a `MALFORMED` line in the table) instead of returning "" — the `try { … } catch { return "" }` shape in `dynamics.ts` is explicitly the anti-pattern.

## 5. Agent changes

**experiment.md** — Phase 1: `quantities[].id/key` (+`verdicts[]`); reuse ids from `<claim_status>`. Phase 3: `headline`, `observable`, `uncertainty` (+source), `limit_check`, `inputs` for headline quantities. Delete `computed.anomalies`/`computed.iteration`. `cross_validation` unchanged; delete the "resolve in `cross_validation_resolved`" instruction — a discrepancy is recorded, and the FollowUp names the discriminating computation. tool_review task strings carry observable/inputs/invariants only; predicted outcomes redacted.

**experiment_reviewer.md / PI** — the 3.5 obligation, in the existing read order (criterion → data → *record discriminator+estimate+scaling* → producer narrative). May attest `INDEPENDENT`, may countersign `DISCLOSE-OK`. Never adjudicates by reason.

**replicator (new, one agent type)** — `tool_impl`-shaped: coding tools, no spawn, blind to `data/experiments/<producer>/scripts/`, receives observable + inputs. Emits a number and its route.

**brain.md** — `frame.md` names headline ids; dispatch reasons stated against `<claim_status>` rows; frontier order per 3.7; `CLAIM-DISCLOSE` proposal only; STOP-ACK/ANOMALY-ACK deleted.

**report_writer.md** — context gets the table; render caps per 3.4; "pick the validated sibling key" deleted; `claims.json` entries carry `quantity_id`.

**contradiction_auditor.md** — receives `observable` sentences; definition concerns reported as `revise`, not a frontmatter veto.

**finish** — 5d rewritten to the claim gate; batch diagnostic; escalate-on-non-decreasing under the global backstop.

## 6. Deleted

`dynamics.ts` blocks and their three gates (separate diff — dead-code deletion, not coupled); `computed.anomalies`, `computed.iteration`; `cross_validation_resolved` as gate-clearing; `method_a ≠ method_b` text test (subsumed by 3.3); the sibling-key paragraph in report_writer.md; STOP-ACK/ANOMALY-ACK in brain.md and CLAUDE.md.

## 7. Rollout

1. **Ship the deletions now** (Alternative C): `cross_validation_resolved` clears nothing; widened `===`/1e-6 wiring veto. ~60 lines, gated on bench-05b. Under this alone the 297nm flip ships as a disclosed dispute, not the abstract.
2. **Freeze bench-05a/05b**: 05b = raw 297nm project (legacy path must pass unchanged); 05a = same with hand-retrofitted `quantities[]`/`verdicts[]` for the 6 headline quantities and a hand-written expected table (`blockade_shift_4um: indicative`, `blockade_leakage_40MHz: conditional`, `ordering_f40_vs_f10: conditional`, `n_at_297nm: corroborated`, reads-diff fires on E6).
3. **Registry v2** (`buildClaimTable`, `renderClaimTable`) + status + render caps + reads-diff, as pure functions; smoke gates on 05a/05b; `MALFORMED` complaints.
4. **$5 live compliance probe**: one small dual-profile experiment run with the Phase-1/Phase-3 producer prompt; measure field-wise compliance before any gate depends on a field. Fields under ~80% compliance get demoted to optional or redesigned before step 5.
5. Write validator; finish claim gate; batch diagnostic + escalate-on-non-decreasing.
6. Reviewer/PI obligation; replicator; brain `frame.md` scope + `<claim_status>` (after the "surface DISCREPANT rows" prior check); report_writer; contradiction auditor.
*Steps 5–7 were implemented on 2026-08-26 by operator decision (architecture switched as a whole; the step-4 live probe becomes the verification that follows, with the same rule: producer fields under ~80% compliance get demoted to optional).*
7. One live project; compare against the 297nm baseline: operator directives (4), finish calls (4), sessions (13), cost ($151), and — the new metric — `disclosed_headline_count` and how many flags got answered with a locator vs narrated.

## 8. Costs, honestly

Engineer's estimate: +25–55% per project ($190–235, 36–42 h vs $151/32 h) if reviewer estimates and one extra independent-class estimate land on 3–6 headline quantities. Two things bound it: headline scope fixed at framing (≤3 for short asks), and the rule that figure/typesetter/audit passes are not dispatched while a headline is disputed — on 297nm that alone would have traded five illustrator spawns and two audit re-sweeps for the one experiment that mattered. Shared-prior false agreement is not eliminated, only bounded: the anchored-leg requirement and blind replication are the two guards, and neither is proof.

## 9. Open questions (decide before step 3)

1. σ floor: if a producer reports an implausibly small σ, corroboration becomes hard and disputes easy — self-punishing, so probably fine; but should the reviewer's σ override the producer's for the agreement test? Draft: use the larger.
2. Headline-set N at framing: fixed at 3 for a short ask, or PI-negotiated? Draft: 3, PI may raise with reason.
3. Whether the replicator is dispatched automatically on the first `disputed` headline or only by brain decision. Draft: brain decides, but the frontier puts it first and declining requires the countersigned path.

## 10. Adjudication log (Draft 1 → Draft 2)

| Draft-1 item | Critics | Decision |
|---|---|---|
| 8-rung `method_class` enum, producer-declared | alternatives: no extra decision vs a flag; epistemics: self-certified independence; engineer: taxonomy argument at every write | Deleted. Independence computed (3.3) + reviewer attestation for headline. |
| producer `resolution` | engineer: 1/3 compliance measured, FATAL; epistemics/alternatives: cap decides, field is decoration | Deleted. σ (3.1, 3.4) replaces it; missing σ caps at indicative. |
| majority-supersede | epistemics FATAL (promotes the category error); PI: adjudication-by-essay | Deleted. Discriminator / replicator / countersigned disclosure only. |
| `adjudications.jsonl` by reason | PI, epistemics | Deleted. |
| `CLAIM-DISCLOSE` unilateral | epistemics, PI, engineer: H2 restored at the top | Countersign + report-visible + counted; >1 escalates. |
| Fermi obligation auto-block at 3× | epistemics, alternatives, engineer: flag not block; PI: wrong altitude, want a discriminator | Discriminator + blind estimate + scaling; flag → answer → dispute (3.5). |
| `load` declared at Phase 1 | epistemics FATAL (dodge switch, unknowable at P1) | Computed from abstract/claims/reads; declaration is a floor (3.4). |
| "≥2 classes agree" = corroborated | epistemics, PI: robustness ≠ truth; need external anchor / limits | Anchored leg required; `converging` added; limit_check + scaling (3.4, 3.5). |
| free-text `definition_conflicts` veto | epistemics: false positives and misses the real case; engineer: LLM-judge veto | Prose for humans; mechanical = inputs + reads-diff (3.9). |
| kind-keyed 2-call finish rule | engineer FATAL (deletes 441-call backstop) | Global backstop kept; non-decreasing-count rule under it (3.8). |
| legacy fallback `id=key, single-method` | engineer FATAL (breaks every legacy abstract; bench-05 can't self-produce) | Grandfathered; 05a/05b split (7). |
| untruncated `<claim_status>` | engineer: cache; alternatives: third rendering of state | Compact, headline-only, bounded; prior check on existing DISCREPANT rows (3.7). |
| `resolution`/tolerance dead band 1.5–3× | PI, epistemics | σ-distance; no separate flag threshold on σ-tested pairs. |
| proportionality | PI: 32 h for two questions; headline set from the user's question | `frame.md` headline ids, N≤3, dispatch order 3.7. |
| blind replication (alt. B) | alternatives: strongest alternative; PI: "second student told the question not the answer" | Adopted as the standard third-estimate route, one per project (3.6.2). |
| `units`/`conditions` fields | engineer/alternatives: no consumer | Folded into the `observable` sentence. |
| value_b harvest vs registry exclusion | engineer: inverts a deliberate exclusion | Kept with stated rationale (3.2). |
| `moves:` frontier field | alternatives: subsystem for a sort key | Replaced by the fixed order in 3.7; discriminators are leads by construction. |

**Convergence round (all four ACCEPT-WITH-FIXES → Draft 2.1):**

| Fix | Raised by | Applied |
|---|---|---|
| countersigner ≠ flag author ≠ either producer ≠ brain | engineer | 3.6.3 |
| SCALING must have status consequence (>0.5 exponent ⇒ disputed) | PI | 3.4, 3.5 |
| missing-σ pair never corroborates; >3× ⇒ disputed | PI | 3.4 |
| zero-expected limit is wiring; anchor needs reviewer `ANCHOR-OK` | epistemics, alternatives | 3.3 |
| inputs mismatch withholds corroboration, never dissolves a dispute; propagate upstream | epistemics | 3.3, 3.4 |
| inputs are values not ids; drop closure from wiring test; `incomparable` state | alternatives | 3.1, 3.3, 3.4 |
| "preregistered" unenforceable → harness-spawned blind estimator | alternatives | 3.5 |
| one headline set: frame ∪ headline:true; outside-set abstract number blocks | alternatives | 3.4 |
| `<claim_status>` only if the DISCREPANT prior check changes dispatch | alternatives | 3.7 |
| steps 5–7 re-scoped after the compliance probe | engineer | 7 |

**Implementation audit (2026-08-26, three independent reviewers: design-conformance, principles, adversarial code — all on commit 4bd4dfd):**

| Finding | Severity | Fix landed |
|---|---|---|
| producer-declared σ dissolved disputes; replicator prompt asked for σ ≈ value | CRITICAL | `agreement()`: ratio veto (> 3× disagrees regardless of σ), σ capped at 0.5·\|value\|; σ_b / replication σ must be > 0; prompt reworded |
| any `reviews/*.md` trusted → brain could forge INDEPENDENT/ANCHOR-OK/DISCLOSE-OK/ESTIMATE(blind) | CRITICAL | only harness-written files parsed (`experiment_review_*_r*.md`, `pi_feedback.md`); those files are write-blocked for every agent's write/edit tool and bash may not mention them; PI countersigns via `submit_verdict.disclose_ok` |
| a disputed number re-declared under a new id escaped the gate | CRITICAL | value-level match in `claimTableIssues`; "one number, two ids" is MALFORMED; near-id rule covers single-token ids |
| `replicator` not in brain's spawn whitelist (replicate mode unreachable) | HIGH | added |
| replicator blindness read-tool-only | HIGH | `blockedBashPathMentions` (new safety field): bash may not name the producer's scripts/runs/tests or the ledger |
| incomplete review persisted attestations; real feedback discarded | HIGH | incomplete review persists blind lines + marker only; verdict/feedback always processed; SCALING now required alongside DISCRIMINATOR |
| `needs-operator.md` under notes/directives/ re-entered as the USER's directive | HIGH | moved to `notes/escalations/` |
| headline closure over inputs inflated obligations (16 blind spawns, PI stop unreachable) | HIGH | two tiers: `headline` (load-bearing closure — gates) vs `headlineDeclared` (frame ∪ headline:true — blind estimator, reviewer, PI scope) |
| silent `catch {}` in harness glue (spawn-agent, context-builders, pi-agent) | HIGH | every catch emits a visible note / MALFORMED block / verdict issue |
| `verdicts[].replaces` cleared by any string | MEDIUM | must name a quantity the verdict reads |
| `[—-]+` separator ate a leading minus | MEDIUM | separator must be whitespace-delimited; one strict grammar shared by extractor and parser |
| readdir order leaked into L3 | MEDIUM | `listExperimentDirs` sorted; estimates sorted |
| 1c value match one-sided, no exempt filter | MEDIUM | both legs, `exempt()`, ×100 windows only without a claim_key |
| integers wired by equality | MEDIUM | integers never wire by equality |
| escalation keyed on exact text (counts differ each call) | MEDIUM | digits masked; `details.escalated: true`; `disclosed_headline_count` in finish_stats; > 1 disclosed headline blocks |
| orphans: `quantity_id`, `definition_concerns`, `uncertainty_source` | LOW | `quantity_id` now the preferred claims→row join; `definition_concerns` read by the finish gate (non-blocking); `uncertainty_source` rendered in reasons |
| `method_a === method_b` text test not deleted (§6) | LOW | deleted |

Deviations kept, on purpose: no batch finish diagnostic (~30 early returns; escalation keys on masked gate text instead of issue count); `indicative` inputs do not make a quantity `conditional` (would make nearly everything conditional); no flag→answer round (a blind flag disputes immediately — stricter than designed); countersigner identity is "harness-written file + PI/reviewer", not a full agent-id check; `limit_check.observed` is not transcript-anchored (ANCHOR-OK attestation is the guard).

## 11. Live compliance probe (2026-08-26, bench-02, dual profile)

Reader: `scripts/claims_compliance.mts`; dispatch check: `scripts/claims_dispatch.mts`. One experiment (E1, C₆(θ) for 60P₃/₂), 7 declared quantities, cost $19 (the `--max-cost 5` cap did not fire — the brain's hook never ran while it sat inside the foreground experiment spawn; fixed in `usage-log.ts`, gate `smoke_cost_cap`).

| field | rate | outcome |
|---|---|---|
| `quantities[].id`, `key` | 100% | keep |
| `headline`, `observable`, `uncertainty` (numeric), `uncertainty_source` | 86% (6/7) | keep — **but the producer put them under `computed.<leaf>` (object with `value`/`value_<unit>`), then, after the write-time hint, repointed `key` at the numeric sub-leaf leaving the metadata on its parent.** The table now accepts all three locations (`resolveQuantity`); the entry wins. |
| `limit_check` with numeric `expected`/`observed` | 0/7 | **demoted**: text form accepted silently, never an anchor leg |
| `inputs` non-empty | 1/7 | **optional** (it already was in effect; empty = no comparability information) |
| `verdicts[].reads` / `replaces` | 100% | keep |
| brain `frame.md ## Headline quantities` | present, 3 ids | keep — but the ids did not match the producer's (`C6_60P_mj32_theta` vs `c6_theta_60p_mj32`): the write-time validator now suggests the frame id on a ≥2-token near-miss |
| producer `headline: true` | on 6/7 quantities | over-declared vs the ≤3 frame set; the obligation scope is the union, so reviewers get 9 ids. Open question §9.2 stands. |
| reviewer / PI lines | not yet measured at the time of writing (review round pending) | — |
