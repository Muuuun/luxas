# Luxas v3 — implementation plan (2026-08-29)

*Executes `design-luxas-v3-2026-08-29.md` §3 P0. Every diff = producer + consumer + gate + fixture in one commit (CLAUDE.md 生产者-消费边纪律). No model spend to build; the measurement run needs provider credit. Order is by dependency, then trust-per-dollar. Sizes are lines of TypeScript/prompt, not effort estimates for a model.*

## D1 — Revise carried forward (Q4)  ·  gate `smoke_revise_binding`

**Bug being fixed.** `spawn-agent.ts:680` at the iteration cap writes "REVISE but iteration cap reached — accepting current state with open issues" into the *spawn result*; `persistReview` (`claims-review.ts:153`) writes only obligation lines + `VERDICT:` to `reviews/experiment_review_<EID>_r<N>.md` — the feedback text is never on disk; nothing at finish reads `VERDICT: revise`; the ledger stays `Status: Complete`. Literature: 82.5 % of failed runs.

1. **Producer** — `persistReview(..., feedback?: string)`: append a `FEEDBACK:` block (first 600 chars of the reviewer's feedback, verbatim) under the VERDICT line. Call site `spawn-agent.ts` review loop passes `reviewResult.output`'s FEEDBACK section (it already parses `VERDICT:`; reuse that regex for `FEEDBACK:`). ~15 lines.
2. **Grammar** — `experiment_reviewer.md`: feedback must begin with one sentence naming the flaw (the sentence the ledger will quote). `experiment.md` Phase 3 / `ledger_writer.md`: on a revise-at-cap, the L2 section's `### Limitations` carries `finding_answered: <one clause> — <locator>` **or** `finding_open: "<reviewer's first sentence verbatim>"`. ~10 lines of prompt.
3. **Consumer A (finish)** — `report-integrity.ts` new check `reviseCarriedForward(projectDir)`: for each experiment, take the highest-round review file; if `VERDICT: revise` and it has a `FEEDBACK:` block, require the ledger's L2 section for that experiment (or `computed.reviewer_open_issues[]` in results.json) to contain either a `finding_answered:` line with a locator (`path:line` / `job_…` / `results.json` key) or a `finding_open:` line quoting ≥ 12 words of the feedback's first sentence. Missing → **blocking** issue kind `review-open`, text = the feedback sentence + the two legal lines. ~60 lines.
4. **Consumer B (table)** — `claims-table.ts` status loop: quantities declared by an experiment in "revise-open" state (Consumer A's predicate exported as `openReviewFindings(projectDir): Map<E, string>`) are capped at `indicative` with reason `reviewer finding open: "<sentence>"`. ~20 lines.
5. **Fixture** — `fixtures/claims-ppss`: write a synthetic `experiment_review_E1_…_r4.md` with `VERDICT: revise` + `FEEDBACK:` (taken from E1 r2's actual feedback wording); gate asserts: blocking issue present; E1 rows capped `indicative`; adding a `finding_open:` quote to the ledger clears the block; adding `finding_answered:` with a locator clears the cap. Also assert a `(none)` verdict (E1 r3 in the fixture) never counts as revise.
6. **Kill switch** `LUXAS_REVISE_BINDING=0`. **Counter**: revise-at-cap experiments whose ledger carries the flaw (target 1/1).

## D2 — Replication legs and route wiring (Q2)  ·  gate `smoke_replicate_legs`

**Bug being fixed.** `claims-table.ts:503` parses `replication/results.json` as kind `replication`, but the status loop's `producers` filter (`kind !== "blind" && kind !== "posthoc"`) includes it only for *disagreement*; blind lines (`ESTIMATE(blind)`) can never form `agreeingPair`; nothing records the route; two replicators on the same route count as two legs. Result: K discriminators cannot settle a row.

1. **Estimate record** — add `route?: string` and `model?: string` to `Estimate`. Sources: replication results.json gets `route` and `model` fields (replicator prompt writes them; `spawn-agent` stamps `model` from the resolved model id when it runs replicate mode); `ESTIMATE(blind)` lines: `route` = the `via …` text; `own` estimates: `route` = the producer's `method` if `cross_validation_plan` names one, else the experiment id. ~25 lines.
2. **Wiring** — `relation()`: same normalized route string (lower-cased, punctuation stripped, ≥ 2 shared tokens of ≥ 3 letters) ⇒ `wiring`; same `model` **and** same route ⇒ `wiring`. Unit checks in the gate. ~15 lines.
3. **Legs** — a `replication` estimate whose `route` is set and whose `script` names an executed job (`job_…` in `replication/results.json`, or a `via … [job_…]` suffix on a blind line) is a *computing* estimate: it participates in `agreeingPair` (may make a row `converging`), can be the anchored leg only if it carries `anchor`, and counts as a "later" leg for supersession (assign it the experiment number of its `EXPERIMENT_ID` + 0.5 so it is later than its producer, earlier than the next experiment). Blind lines without a job stay dispute-only (unchanged). ~30 lines.
4. **Replicator contract** — `replicator.md` replicate mode: must write `{quantity, value, sigma, route, job_id, script}` to `replication/results.json`; route is the one it was *assigned* (new templateVar `ROUTE`, optional); it may not choose the producer's route. `blindEstimateTask` (estimate mode) unchanged.
5. **Brain policy** — `brain.md` `<claim_status_dispatch>`: on the top disputed *frame* row, spawn up to `LUXAS_BREADTH_K` (default 2) replicate-mode replicators with distinct `ROUTE`s taken from the reviewer's `DISCRIMINATOR` lines; stop when the row leaves `disputed`; total breadth spend ≤ `LUXAS_BREADTH_FRAC` (default 0.15) × cap — the harness enforces the fraction via `usage.log` tagged by agent (add `agent` column to usage entries: producer + consumer in the same diff). No spawn on rows already `converging`/`corroborated`.
6. **Fixture** — synthetic project: producer 24.65 ± 0.35, replication A (route "three-channel fit", job) 24.5 ± 0.2, replication B (route "three-channel fit", job) 24.6 ± 0.2 → A and B are wiring, one leg → `converging`; replication C (route "full diagonalization", job) → second leg; blind 45 ± 10 → answered. Asserts row status per step; same-model-same-route wiring; no job ⇒ no leg.
7. **Kill switch** `LUXAS_REPLICATE_LEGS=0` (falls back to dispute-only). **Counters**: rows converging/corroborated at finish (target ≥ 2), replicator spawns / rows settled (≤ 8 / ≥ 2).

## D3 — Anchor exfiltration + best-of-N (Q3)  ·  gate `smoke_result_integrity_detectors`

1. **Anchor exfiltration** — `claims-table.ts` status loop: for each `own` estimate, compare against every numeric `invariants.*` leaf of the same results.json and every `anchor`-tagged `value_b`; `relDiff ≤ 1e-6` **and** no job in `.agent/jobs` with `ownerAgentId` under that experiment whose `command` names a file in `data/experiments/<E>/scripts/` ⇒ cap `indicative`, reason `computed value equals literature input <key> to 1e-6 with no producing job`. Uses `listJobIds`/`readState` (`jobs/registry.ts`). ~40 lines. Advisory-to-cap, never block (a legitimate limiting-case reproduction trips it).
2. **Best-of-N** — `report-integrity.ts`: for each experiment, N = number of `runs/run_*` dirs (and jobs whose command names the same script), reported = the run results.json cites; if N > 1 and the ledger lacks a line `runs executed: N; reported: run_k because …` ⇒ non-blocking issue `selection-policy`. `ledger_writer.md` / `report_writer.md`: the Methods paragraph "Runs executed / reported / selection policy / human decisions" (D6). ~35 lines.
3. **Fixture** — `claims-297nm/retrofit` copy with one quantity's value set equal to its invariant and no job → capped; with a job whose command names the script → not capped. A synthetic project with `run_1..run_3` and no policy line → issue; with the line → none.
4. **Counters**: hits per run (read manually the first time); reject if false-positive rate > 50 %.

## D4 — Abstention sentence (Q5)  ·  gate `smoke_abstention`

1. **Table** — `ClaimTable.abstain: { id, observable, reason }[]` = frame headline ids whose row is `disputed`/`conditional` and not `disclosed`. ~10 lines.
2. **Finish** — in the claim-status issues: for each abstain id, the abstract must contain the id or ≥ 4 consecutive words of its `observable` **and** the phrase `could not determine` (or `remains undetermined`); missing ⇒ blocking with the exact sentence to paste: `we could not determine <observable> (<route a> gives v₁, <route b> gives v₂; discriminator: <first DISCRIMINATOR line>)`. An abstained id no longer counts toward the `disclosedHeadlineCount > 1` escalation and is not "abstract blocked" once the sentence is present (the *number* stays banned by the existing value-match rule). ~40 lines.
3. **Prompt** — `report_writer.md` render caps: the abstention sentence is the only legal way to mention a disputed frame id in the abstract.
4. **Fixture** — `claims-ppss` report.tex as-is (quotes 1.98× and 24.65°) ⇒ blocking with the sentence; a copy whose abstract carries the sentence for `max_gain_over_orientation` and the θ* row ⇒ passes.
5. **Counter**: abstentions rendered = disputed frame rows at finish; disclosures ≤ 1.

## D5 — Route lint on the cross-validation plan (Q1)  ·  extend `smoke_write_time_validation`

1. `safety-wrappers.ts:385` write-time validation of `cross_validation_plan` / `cross_validation`: `method_a` and `method_b` must differ by ≥ 2 route tokens after stripping library names (`arc`, `pairinteraction`, `numpy`, `scipy`, `qutip`) and words like `perturbative`/`v2`; identical after normalization ⇒ hint "a second call of the same function is not a control — name a route that differs in formalism or limiting approximation". Advisory at write time; the existing `identical` veto at finish stays. ~25 lines.
2. `experiment.md` Phase 1: the one-clause route sentence. `<methods_registry>` already lists standard pairs — reference it.
3. **Counter**: bit-identical cross-validations at finish (pp-vs-ss: 1 → target 0).

## D6 — Methods paragraph + prompts (Q3/Q6-lite/Q7)

1. `report_writer.md`: fixed paragraph in Methods-and-scope: *runs executed / reported and why; blind replications and their routes; human decisions during the run (from `decisions[]` when D7 lands; until then, from `--directive` lines in `.agent/run_config.json` history)*. Consumer: `report-integrity.ts` checks the paragraph exists when N > 1 runs or any replication exists (non-blocking).
2. `brain.md`: breadth policy (D2.5), "an abstention is derived, not chosen", route naming.
3. `experiment_reviewer.md`: `finding_answered:` / `finding_open:` grammar; first sentence names the flaw.

## D7 (P1, after one measured run) — Operator queue

`queue.jsonl` / `answers.jsonl`, `luxas answer <project> <id> <option|text>`, `<operator_pending>` L3 block, defaults + `LUXAS_OPERATOR_TIMEOUT_H`, `decisions[]` → Methods. Triggered only by countersign requests and > 1 disclosure. Build only if the D1–D4 run still produces ≥ 1 escalation file.

## Order and dependencies

```
D5 (independent, smallest)  →  D1 (persistReview + finish + table)  →  D2 (Estimate fields, wiring, legs, brain policy)
                                                                     →  D3 (uses jobs registry; independent of D2)
D4 depends on D2's statuses being final (abstain set computed after legs/supersession)
D6 prompts land with the diff that consumes each line (D1: reviewer/ledger; D2: brain/replicator; D3/D4: report_writer)
```

Estimated size: ~300 lines TS, ~80 lines prompt, 5 gates, 2 new fixture variants. Each diff runs `npm test` (currently 65 gates) before commit; deploy to the droplet after each; the running measurement project is *not* restarted mid-diff.

## Acceptance for the whole update

1. `npm test` green on Mac and droplet after every diff.
2. On `fixtures/claims-ppss`: the θ* row converging (D2), E1 capped indicative under a synthetic revise-at-cap (D1), the 1.98× abstract sentence demanded (D4), no exfiltration false positive on the real run (D3).
3. Measurement run (needs credit, ~$25 to finish pp-vs-ss): the §4 counters of the design note; specifically ≥ 2 converging rows, ≤ 1 disclosure, 0 escalation files, finish reached.
