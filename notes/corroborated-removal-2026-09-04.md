# Removing `corroborated` from the claim table (2026-09-04)

The code change landed in `ed10a17` alongside unrelated work, so this note is
the record of why. Rationale only — the mechanics are in `src/claims-table.ts`
at the `ClaimStatus` definition.

## What was removed

`ClaimStatus` had six rungs; `corroborated` sat at the top, above `converging`:

```ts
else if (agreeingPair && anchoredAgree && anyOwnSigma) status = "corroborated";
else if (agreeingPair && anyOwnSigma)                  status = "converging";
```

`converging` is now the top status. `anchoredAgree` is gone. Anchors still show
up in `reasons` as `(anchored)`; they no longer move status.

## Why — two measurements

**1. It was unreachable.** `anchoredAgree` had two routes: an `anchor` string on
one of the agreeing estimates, or the reviewer's `ANCHOR-OK:` line with a
passing limit check. Pooled fill rates for reviewer lines, measured with
`scripts/claims_compliance.mts` over the droplet corpus (71 projects with
`data/experiments/`, 482 runs — only **3** declare `computed.quantities[]`, the
rest predate 2026-08-26 and are grandfathered):

| line | prompt wording | fill |
|---|---|---|
| DISCRIMINATOR | "must contain", enforced (NO REVIEW without it) | 82% |
| SCALING | "must contain", not enforced | 73% |
| ESTIMATE(blind) | harness-injected | 61% |
| **ANCHOR-OK** | **"and may contain"** | **2%** (1/49) |
| **INDEPENDENT** | **"and may contain"** | **2%** (1/49) |

Fill rate tracks the obligation wording in `experiment_reviewer.md`'s
`<claim_obligation_standing>` block, not model capability. The reviewer was
complying with its spec; the spec marked the line optional while the top grade
depended on it.

Result across the three claims-first projects (`probe-claims-20260826/bench02`,
`pp-vs-ss-gate-packing-20260826`, `ba-neutral-atom-qc-20260829`): **75 claim
rows, 0 corroborated.** Seven sit at `converging` — agreeing pair, σ present,
blocked only on the anchor. This is the mechanism behind the 1%-corroborated
figure in the 2026-08-23 cross-validation audit.

**2. Nothing consumed it.** The gates read the *bottom* of the ladder —
`claims-review.ts` and `hooks.ts` both filter for `disputed`/`conditional`.
The one place that named `corroborated` (`tools/spawn-agent.ts`, the settled set
that lets the blind estimator skip a quantity) OR'd it with `converging`, and
every row that could reach corroborated already satisfied converging's
condition, so that set is unchanged by the removal.

So it was a rung nothing could reach and nothing read — while being rendered
into brain's `<claim_status>` every turn as a target. `context.ts` still
describes stopping as "every headline quantity corroborated or disclosed";
that comment now reads `converging`.

## Do not conflate with the report-side grade

`report/claims.json` has its own unrelated `corroborated`, computed by
`xvalVerdict` from `computed.cross_validation` entries and enforced by
`report-integrity.ts`'s render cap. That one is live, consumed, and untouched.
`smoke_xval_dispute_gate`, `smoke_xval_coverage`, `smoke_claim_registry`,
`smoke_career` and `smoke_write_time_validation` all test that path.

## If you want the rung back

Requiring `ANCHOR-OK` is a one-line change to the reviewer prompt (mirror
DISCRIMINATOR's "must contain" phrasing). Do not ship that half alone — per the
producer/consumer rule, decide first what would *read* a corroborated row, e.g.
gating finish on headline rows being corroborated-or-disclosed, which is the
stated design intent. Re-measure afterwards with `scripts/claims_compliance.mts`
and check ANCHOR-OK crosses design §7.4's 80% line.
