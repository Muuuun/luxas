# PRISMA / Cochrane / GRADE / RoB 2 — distilled for autonomous agents

> Source-of-truth: PRISMA 2020 (PMC8007028), PRISMA-ScR (Tricco 2018,
> PMID:30178033), Cochrane Handbook ch. 8 (RoB 2), GRADE Working Group.
> This file extracts the *agent-actionable* kernels — read this instead
> of the full ~200-page handbooks for plan-time decisions.

## PRISMA 2020 — 10 load-bearing items (distilled from 27)

The full PRISMA 2020 checklist has 27 items across 7 sections. For
autonomous-agent operationalization, the load-bearing items are:

| # | Item | Agent operationalization |
|---|---|---|
| 1 | Pre-register the protocol (PRISMA item 24a) | Pre-commit `notes/scope.md` before any literature load. Amendments in `notes/scope_amendments.md`. |
| 2 | State PICO/PECO/PICOS question (item 4) | scope.md§Question section |
| 3 | Specify eligibility criteria (item 5) | scope.md§Inclusion + §Exclusion (each with yes/no test) |
| 4 | Document information sources + dates (item 6) | scope.md§Information sources |
| 5 | Publish full search strategy (item 7) | scope.md§Information sources includes full search query + dates |
| 6 | Dual-reviewer screening with conflict resolution (items 8-9) | Spawn `screen_dual_<batch>` with `tool_impl` + `tool_review` blind on same candidates; brain adjudicates disagreements |
| 7 | Risk-of-bias assessment + tool versioning (item 11) | Spawn `bias_assess_<study>` with design-matched tool (RoB 2 / ROBINS-I / AMSTAR 2 / Newcastle-Ottawa) |
| 8 | Pre-specify synthesis methods (items 13a-f) | scope.md§Synthesis plan |
| 9 | Certainty of evidence per outcome (items 15, 22 — new in 2020) | GRADE-tag every load-bearing claim per `templates/literature_entry.md` |
| 10 | PRISMA flow diagram + COI + data/code availability (items 16, 26, 27) | Render flow diagram from `notes/excluded.md` counts; report COI per cited primary source |

**Critical**: PRISMA 2020 added the certainty-of-evidence item explicitly
because PRISMA 2009-compliant SRs were producing pooled effect estimates
without certainty tags. The same failure mode applies to autonomous-agent
surveys: untagged claims drift into the report.

## PRISMA-ScR (scoping reviews) — 5 stages

For "scoping" review type per SKILL.md Step 1. Distinguishing feature:
**no quality appraisal of included sources** (skip RoB 2 / GRADE).

1. Identify the research question
2. Identify relevant studies (search strategy required, like PRISMA)
3. Study selection (dual-screening recommended)
4. Chart the data (formal data-charting form — like extracted-feature
   table in templates/literature_entry.md)
5. Collate, summarize, report results

Use scoping when mapping breadth of a heterogeneous emerging field. The
relaxation: skip risk-of-bias appraisal because the goal is mapping not
adjudicating quality.

## RoB 2 — 5 domains for randomized trials

Cochrane standard for assessing risk of bias in RCTs. Each domain has
signaling questions answered with **Yes / Probably yes / Probably no /
No / No information**. Algorithm maps responses to **Low / Some concerns
/ High** — assessor may override with documented justification.

1. Bias arising from the randomization process
2. Bias due to deviations from intended interventions
3. Bias due to missing outcome data
4. Bias in measurement of the outcome
5. Bias in selection of the reported result

For non-randomized studies, use **ROBINS-I** instead. For systematic
reviews themselves (in umbrella reviews), use **AMSTAR 2**. For
observational studies, use **Newcastle-Ottawa**.

**Agent operationalization**: do not produce a binary good/bad judgment.
Decompose into domains, answer signaling questions, apply the documented
mapping rule. Output is the per-domain table.

## GRADE — 4-level certainty

Every load-bearing claim in the report carries one of:

| Level | Definition |
|---|---|
| **High** | "We are very confident that the true effect lies close to that of the estimate of the effect." |
| **Moderate** | "We are moderately confident in the effect estimate. The true effect is likely to be close to the estimate, but there is a possibility that it is substantially different." |
| **Low** | "Our confidence in the effect estimate is limited. The true effect may be substantially different from the estimate." |
| **Very Low** | "We have very little confidence in the effect estimate. The true effect is likely to be substantially different from the estimate." |

**Starting point**: RCTs start at High; non-randomized studies start at
Low.

### 5 downgrade domains (each a checkable test)

1. **Risk of bias** — the RoB 2 / ROBINS-I result for the studies feeding
   this claim
2. **Inconsistency** — unexplained variability across studies; in
   meta-analysis quantified by **I²** statistic (0-100%); for ML, the
   analog is run-to-run variance / inter-paper spread on the same
   benchmark
3. **Indirectness** — PICO mismatch between primary studies and review
   question (different population / intervention / outcome / setting)
4. **Imprecision** — checked against **Optimal Information Size (OIS)**,
   akin to a sample-size calculation for a single adequately-powered
   trial; for ML, sample size of evaluation runs
5. **Publication bias** — funnel plot / Egger test; "because proving
   publication bias is inherently difficult, GRADE recommends downgrading
   by only one level when suspected"

### 3 upgrade domains (for non-RCT evidence only)

1. **Large effect** (e.g., RR > 2 or < 0.5)
2. **Dose-response gradient**
3. **Plausible confounding would reduce the observed effect**

### Agent operationalization

Every load-bearing claim in `notes/literature.d/<key>.md` per
`templates/literature_entry.md` carries the GRADE tag plus enumerated
downgrade reasons. Untagged claims are inadmissible in the report.

## Cochrane verbatim phrasings (the agent's quote bank)

Source: CD002991 inhaled corticosteroids COPD, PMC10042218 — *the*
exemplar Cochrane SR for autonomous agent emulation.

```
"Two [agents] independently assessed for relevance of the titles and,
where available, retrieved abstracts of all trials identified by the
search strategy."

"…independently assessed the quality of all relevant [items], using
[tool name]; [items] were judged as having a high, low or unclear
risk of bias."

"…assessed study design, risk of bias, inconsistency, indirectness,
imprecision for the results for these outcomes, and determined the
certainty of the evidence for each outcome using the GRADE Working
Group grades of evidence: high certainty, moderate certainty, low
certainty and very low certainty."

"…resolved disagreements about relevance by consensus."
```

Summary-of-Findings table columns:
- "Anticipated absolute effects" (per arm)
- "Relative effect" (RR / OR / HR with 95% CI)
- "No of participants (studies)"
- "Certainty of the evidence (GRADE)"
- "Comments"

Every slot is fillable by an autonomous agent with the Design → Impl
+ Review split: `tool_impl` does extraction, `tool_review` does blind
re-extraction, parent agent runs the equivalent of pytest as the
disagreement-resolution event log.

## PRISMA-substance verification (don't trust the label)

Empirical finding from the corpus:

> "Items with the least adherence in systematic reviews included
> certainty assessment and reporting bias assessment at 7.46%"
> — Ivaldi et al. (2024) Cochrane Evidence Synthesis and Methods

> "The GRADE approach has been reported more often in Cochrane review
> abstracts over recent years, from 30.7% to 74.2%"
> — Journal of Clinical Epidemiology (2025)

When citing an upstream "PRISMA-compliant" SR:

1. Verify GRADE-tagged outcome table is **actually present** (not just
   the PRISMA badge)
2. Verify funnel plot or Egger statistic for publication bias
3. Verify PRISMA flow diagram with actual screening counts
4. Verify each cited certainty claim is per-outcome, not blanket

PRISMA name-drop without screening log is **worse than not invoking
PRISMA** — it's badge fraud. Flag in `notes/excluded.md` if found in an
upstream review.

## Cochrane Rapid Reviews — declared shortcuts

For "rapid review" type per SKILL.md Step 1. Cochrane Rapid Reviews
Methods Group (PMC7557165) lists allowed shortcuts that **must be
declared explicitly**:

- "Screen a proportion (e.g., 20%) of records dually at the
  title/abstract level until sufficient reviewer agreement is achieved,
  then proceed with single-reviewer screening"
- Single-reviewer full-text screening
- "Single-data extraction only on the most relevant data points"
- "Single-risk of bias assessment on the most important outcomes"

Accepted trade-off: "Shortcuts may come with increased risk (e.g.,
missing one or more relevant studies, increasing data extraction errors).
Therefore, piloting the steps of the review process with the team
members that will perform them is essential in rapid reviews."

For autonomous agents: declare each shortcut in `notes/scope.md` with
reason + acknowledged risk; no silent shortcuts.

## What this distillation covers vs the full handbooks

This file covers the kernels actionable at plan + draft time. For deeper
methodological questions (specific I² thresholds, specific OIS
calculations, specific funnel-plot procedures), agent should fetch:

- PRISMA 2020 statement: https://pmc.ncbi.nlm.nih.gov/articles/PMC8007028/
- PRISMA-ScR (Tricco 2018): https://pubmed.ncbi.nlm.nih.gov/30178033/
- Cochrane Handbook ch. 8 (RoB 2): https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-08
- GRADE Working Group: https://www.gradeworkinggroup.org/

These are open access. The kernels above are the high-frequency lookups
agents need most.
