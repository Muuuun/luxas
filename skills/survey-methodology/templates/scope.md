# Scope — frozen at <ISO timestamp>

> **Required artifact.** Write this file BEFORE any literature load.
> Amendments after first commit go in `notes/scope_amendments.md` with
> timestamp + reason. Do not silently rewrite scope to fit what the
> search returned (cherry-picking failure mode).

## Review type

Choose ONE (per SKILL.md Step 1):

- [ ] audit-benchmark — most CS/ML SOTA / capability-comparison surveys
- [ ] scoping — heterogeneous emerging field; mapping breadth
- [ ] systematic — bounded answerable question; full PRISMA + GRADE
- [ ] umbrella — synthesize multiple existing SRs
- [ ] critical-narrative — RMP/Annu Rev Phys Chem-style theoretical recap
- [ ] narrative-with-embedded-re-analysis — earth-science / observational re-processing
- [ ] theoretical-unification — Acta Numerica-style; new master object
- [ ] rapid — decision-relevant urgency; declared shortcuts
- [ ] lancet-commission-delphi — multi-stakeholder framework

## Verification floor(s)

Choose ≥1 (per SKILL.md Step 2). For each, name an anchor exemplar from
`references/anchor_exemplars.md`:

- [ ] counting (≥1000 papers, mechanical classification, public lexicon)
  - anchor:
- [ ] measurement (≥30 open artifacts, ≥3 own-run benchmarks, hardware named)
  - anchor:
- [ ] SLR (search query + screening counts + ≥50 included + extracted-feature dump)
  - anchor:
- [ ] anchor-experiment (≥1 sub-claim controllably tested by survey authors)
  - anchor:
- [ ] re-derivation (math/theoretical only; ≥10 named methods drop out as instances)
  - anchor:
- [ ] dataset-re-analysis (earth/observational; documented pipeline + new figures)
  - anchor:

## Topic-ceiling honesty check

- [ ] Are the artifacts under review **open**? (open-weight model / open
      dataset / public proceedings / accessible source code = audit possible)
- [ ] Or **closed**? (frontier-model evals / industry-disclosed tools /
      closed-weight benchmarks = structurally B-capped)

If closed-source dominates: state the highest achievable grade is B and
explain why. Do not pretend audit is possible.

```
Closed-source artifacts in this survey:
- 
- 

Open-source artifacts in this survey:
- 
- 

Highest achievable grade for this scope:
```

## Question (PICO/PECO/PICOS or analog)

- Population:
- Intervention/Exposure:
- Comparator:
- Outcome:
- Study design eligibility:

## Inclusion criteria

Each must have a yes/no test the agent can apply mechanically.

- [ ]
- [ ]
- [ ]

## Exclusion criteria

Each must have a yes/no test.

- [ ]
- [ ]
- [ ]

## Information sources

For each: full URL/database name, search dates, full search query.

```
- Source 1:
  - URL/database:
  - Date range searched: <inception> → <cutoff>
  - Full search string:

- Source 2:
  ...
```

## Bounded N

- Target corpus size: ~N =
- Selection rule if more than N qualify: <recency / citation rank /
  representative sampling rule>
- Selection rule for ties:

## Out of scope (anti-list)

What readers might expect this survey to cover but it deliberately won't,
with reason for each:

- 
- 

## search_current_as_of

ISO date of the most recent literature pass. Update on every amendment.
