# Literature entry template — tier-tagged citation record

> **Required format** for every entry in `notes/literature.d/<key>.md`.
> Untagged entries are inadmissible for quantitative claims in the
> report. The `tier:` field gates whether this source can support a
> quantitative claim directly or whether corroboration is required.

## Skeleton

```markdown
## Bibliographic
- key: <BibTeX key, e.g. Reuel2024BetterBench>
- citation: <full citation>
- DOI:
- arXiv:

## Tier (per SKILL.md Step 5)
- tier: <one of:>
  - primary-empirical — original RCT / paper with releasable code + dataset; replicated independently
  - primary-theoretical — original derivation/proof in peer-reviewed venue
  - systematic-review — PRISMA-compliant SR with verified GRADE per outcome
  - expert-opinion-tier — Nature Reviews family / NEJM Review Articles / Annual Reviews narrative
  - clinical-decision-aid — NEJM Clinical Practice
  - expert-consensus — Lancet Commission / WHO consensus / Delphi
  - industry-disclosure — vendor blogs / disclosed roadmaps
  - leaderboard — live benchmark leaderboards
- tier rationale: <why this tier; cite editorial policy or article type
  if borderline>

## Methodological metadata
- search_current_as_of: <ISO date if SR>
- PRISMA-checklist verified: <yes per items <list> / no / N/A>
  - GRADE table actually present?: <yes / no / N/A>
  - Funnel plot or Egger statistic present?: <yes / no / N/A>
  - PRISMA flow diagram present?: <yes / no / N/A>
- Funding source: <verbatim from acknowledgments>
- Conflicts of interest declared: <yes — list / no / not stated>
- Retraction status: <checked on <date>; clean / retracted / corrected>
- Replication status: <independently replicated by [paper] / not yet /
  attempted-failed by [paper]>

## Claims extracted (each with certainty)

### Claim C1
- claim: <verbatim quote of the claim>
- location in source: <page / section / paragraph>
- certainty (GRADE): <High / Moderate / Low / Very_low>
- certainty rationale: <enumerate downgrade/upgrade reasons:>
  - Risk of bias: <Low / Some concerns / High>; <reason>
  - Inconsistency: <Low / Some / Serious>; <reason>
  - Indirectness: <Low / Some / Serious>; <reason>
  - Imprecision: <Low / Some / Serious>; <reason>
  - Publication bias: <Suspected / Not suspected>; <reason>
- citable for: <which report sections / claim types>

### Claim C2
...

## Notes
<freeform analysis: how this source fits the survey, contradictions
with other sources noted in adjudication.md, etc.>
```

## Worked example

```markdown
## Bibliographic
- key: Reuel2024BetterBench
- citation: Reuel A et al. (2024). BetterBench: Assessing AI Benchmarks, Uncovering Issues, and Establishing Best Practices. NeurIPS 2024 Datasets & Benchmarks Track.
- DOI: arXiv:2411.12990
- arXiv: https://arxiv.org/abs/2411.12990

## Tier
- tier: primary-empirical
- tier rationale: NeurIPS 2024 D&B paper with hand-audit of 24
  benchmarks against 46 criteria, ≥2 raters, public companion site
  betterbench.stanford.edu; original empirical contribution

## Methodological metadata
- search_current_as_of: N/A (audit, not SR)
- PRISMA-checklist verified: N/A (audit-benchmark survey type, not SR)
- Funding source: Stanford HAI (per acknowledgments)
- Conflicts of interest declared: not specifically; authors include
  benchmark developers — flag for self-selection consideration
- Retraction status: checked 2026-05-02; clean
- Replication status: methodology open via companion site, not yet
  independently re-run

## Claims extracted

### Claim C1
- claim: "17 out of 24 benchmarks do not provide easy-to-run scripts to replicate the results reported in the initial paper"
- location in source: §4.2, p. 7
- certainty: High
- certainty rationale:
  - Risk of bias: Low; ≥2 raters with calibration round
  - Inconsistency: Low; rater agreement reported
  - Indirectness: Low; directly observable
  - Imprecision: Low; n=24 enumerated
  - Publication bias: Not suspected; first-of-kind audit
- citable for: report §5 (failure modes / reproducibility)

### Claim C2
- claim: "14 out of 24 benchmarks did not perform multiple evaluations of the same model or report statistical significance"
- location in source: §4.3, p. 8
- certainty: High
- certainty rationale: same protocol as C1
- citable for: report §5 (statistical-rigor anti-pattern)

## Notes
This is an A-grade exemplar for the "counting" verification floor —
bounded N (24 benchmarks), explicit criteria (46), ≥2 raters, calibration
round, third-rater tie-breaker (never invoked), public lexicon released.
The survey methodology skill cites this as the BetterBench template.
```

## Cross-cutting requirements

1. **Untagged entries are inadmissible** for quantitative claims in the
   report. Brain's draft pass must check `tier:` exists for every cite.
2. **Quantitative claims sourced from `expert-opinion-tier` /
   `industry-disclosure` / `leaderboard`** require corroboration from
   `primary-empirical` or verified `systematic-review`.
3. **Claims from sources flagged retracted** must not be cited; if
   discussion of the retracted claim is necessary (e.g., to note a
   discredited approach), tag explicitly.
4. **search_current_as_of older than 36 months** triggers a freshness
   flag in any context where the cited claim is presented as current.
