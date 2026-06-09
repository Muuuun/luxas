---
name: survey-methodology
description: Plan-time methodology contract for survey/review/report projects. Forces an audit-grade survey instead of a paper-trust summary. Distilled from ~240 reviews (2024-2026) across 9 domain clusters — physics/RMP/Living Reviews, chemistry/materials, biology/medicine narrative + Cochrane SRs, CS/ML/AI, math/Acta Numerica, earth/environment, economics/JEL, engineering/Annual Reviews, plus PRISMA/GRADE/Cochrane protocol literature. Empirical A-grade rate by domain ranges 7% (biology narrative) to 86% (math/Acta Numerica); the discriminator is structural, not stylistic. **Read this BEFORE writing notes/plan.md for any survey-style RESEARCH.md.**
compatibility: Pure prompt skill. References existing tools (spawn, escalate_authority_bound, experiment_reviewer, compile_latex).
allowed-tools: Read, Edit, Write, Glob, Grep
---

# Survey Methodology Skill

The default failure mode of an autonomous-agent survey is **paper-trust**:
read N papers, organize claims into a taxonomy, ship a prose digest. The
output passes type-check (it looks like a survey) but fails verification
(none of the cited numbers checked, contradictions not adjudicated, code
not opened, negative space not bounded). This produces **B-grade** output.

Across ~240 reviews from 2024-2026, A-grade reviews share one structural
discriminator:

> **Removing the new taxonomy from an A-grade survey leaves a contribution.
> Removing it from a B-grade survey leaves nothing.**

Empirical A-rate by domain (with our wave-1 + wave-2 evidence base):

| Domain | A-rate | Modal A-pattern |
|---|---|---|
| Math (Acta Numerica / Bull AMS / SIAM Review / Probab Surv) | ~86% | Re-derivation in unified notation; new short proofs |
| Economics (JEL / Annu Rev Econ / Handbook) | ~80% | Author re-estimation on harmonized data; "stylized-fact tables" |
| Engineering (Annu Rev Control/BME, PECS, ARHT) | ~73% | Author re-simulation; harmonized device spec sheets |
| Physics (RMP / Living Reviews / Annu Rev Cond Matt) | ~70% | Re-derivation + cross-paper number table; per-edition updates |
| Chemistry/materials (Chem Rev / Chem Soc Rev / Annu Rev Phys Chem) | ~60% | Cross-paper benchmark table; Tutorial Review structured-closing |
| Earth/environment (Rev Geophys / Annu Rev Earth Planet Sci / NRE&E) | ~40% | Narrative-with-embedded-re-analysis of observational data |
| CS/ML/AI surveys (arXiv survey papers) | **~13%** | Bounded corpus + author benchmarks (BetterBench template) |
| Biology narrative (Nature Reviews / Annu Rev Bio / Cell / Trends) | **~7%** | Almost never — venue norm is conceptual synthesis |

Cochrane / BMJ / Lancet SRs are 100% PRISMA-compliant by editorial policy
but item-level adherence is asymmetric: ~75% of Cochrane abstracts use
GRADE, but only ~7.5% of nominally compliant SRs across journals do full
certainty + reporting-bias assessment. **The PRISMA label is not the
substance** — verify item-by-item.

Two key empirical insights from the corpus:

1. **A-grade is topic-determined, not author-determined.** Surveys of *open
   artifacts* (open-source models, public conference proceedings, public
   datasets) admit A-grade execution. Surveys of *capabilities reported by
   closed systems* (RLHF/alignment, frontier-model agents, healthcare LLMs,
   industry-disclosed tools like Aletheia) are structurally trapped at B
   because the survey author cannot independently re-execute cited
   results.

2. **Disagreement-handling is a near-universal blind spot.** 0/31 CS
   surveys, ~12/30 biology reviews and ~9/30 physics reviews fence-sit on
   contradictions. Even A-grade work routinely fails this dimension. **It
   is the cleanest novelty axis the agent can exploit.**

## When to use this skill

Trigger when RESEARCH.md uses: *survey, review, overview, landscape, state
of the art, comparative analysis, taxonomy, benchmark of benchmarks,
perspective.*

Skip for primary-research projects (single experiment + paper) — those use
the standard experiment / experiment_reviewer pattern directly.

## Step 1 — Pick the review type explicitly

Default-narrative is the modal mistake. An autonomous agent has no
editorial-gatekeeping defense, so it inherits all narrative-review failure
modes (cherry-picking, confirmation bias, irreproducibility) without the
defenses. **Default to PRISMA-ScR-grade documentation at minimum.**

Choose one and commit it in `notes/scope.md` before any literature load:

| Type | When to choose | Required protocol |
|---|---|---|
| **Audit / benchmark survey** | Field has many primary systems with reported numbers; Q is "do the claims hold?" Most CS/ML/AI SOTA survey work falls here. | BetterBench-style: bounded N, criteria list, ≥2 raters, *count* don't gesture (Reuel/Balloccu template) |
| **Scoping review** | Map breadth of a heterogeneous emerging field; decide whether full SR is warranted | PRISMA-ScR (Tricco 2018), 20 items, 5-stage Arksey-O'Malley. **No quality appraisal of included sources.** |
| **Systematic review** | Bounded answerable question, evidence is appraisable | PRISMA 2020 (27 items) + RoB 2 / ROBINS-I + GRADE + PROSPERO registration |
| **Umbrella review** | Synthesize multiple existing SRs on a related question | AMSTAR 2 for included reviews + handle SR overlap |
| **Critical narrative review** | Domain conceptual synthesis where adjudication matters more than coverage (RMP-style theoretical recap; Annu Rev Phys Chem) | Greenhalgh: explicit interpreter positioning + explicit selection logic + explicit acknowledgement of evidence not selected. **No paper-trust.** |
| **Narrative-with-embedded-re-analysis** | Earth/environment / climate where review value-add is reprocessing observational datasets | `notes/datasets.md` provenance + reproducible reprocessing pipeline |
| **Theoretical-unification survey** | Math/theoretical review where unifying object is the contribution (Acta Numerica template) | Re-derivation in unified notation; new short proofs of known results; competing approaches as instances of one master object |
| **Rapid review** | Decision-relevant urgency | Cochrane RR shortcuts (single screener etc.) **declared explicitly** |
| **Lancet Commission / Delphi consensus** | Multi-stakeholder framework or definition needed | Modified-Delphi protocol; ≥2-round endorsement; framework as deliverable (not effect estimates) |

For AI-scientist comparison surveys, SOTA-landscape surveys, or "compare N
systems' capabilities" projects: **Audit / benchmark survey** is the
default. The `ai_scientist_2026` survey was halfway there with 1 audit +
11 paper-trust = B-grade.

## Step 2 — Pick a verification floor explicitly

A-grade requires *at least one* of the following floors. Declare which in
`notes/scope.md` before writing. Mixing is allowed but each floor must be
cleared completely.

| Floor | What it requires | Anchor exemplars |
|---|---|---|
| **Counting** | ≥1000 papers from a publicly named source (e.g. conference proceedings); mechanical classification with released lexicon; longitudinal table | VLM-26K (arXiv:2510.09586) — 26,104 CVPR/ICLR/NeurIPS papers with public lexicon |
| **Measurement** | ≥30 open-weight artifacts; authors run ≥3 standard benchmarks themselves; system-level numbers (latency/memory) on identified hardware | Lu et al. SLM survey (arXiv:2409.15790) — 70 open-source SLMs, own benchmarks |
| **SLR** | Explicit search query + screening counts + ≥50 included works + extracted-feature data dump released | Saadati et al. OCL-SLR (arXiv:2501.04897); Cochrane CDSR template |
| **Anchor-experiment** | ≥1 sub-claim from the literature reproduced or controllably tested by the survey authors; setup described to standalone-empirical-paper depth | FedLearn aggregation (arXiv:2511.22616); White et al. synthetic-data scaling laws |
| **Re-derivation** (math/theoretical only) | Load-bearing equations re-derived in single unified notation; competing approaches as instances of one master object; new short proofs | Acta Numerica norm — 8/8 Vol 33-34 articles cleared this floor |
| **Dataset re-analysis** (earth-science / observational) | Authors re-process named observational datasets with documented pipeline; new figures derived from reprocessing; dataset versioning + processing-pipeline hash in `notes/datasets.md` | Tierney paleoclimate DA (Annu Rev Earth Planet Sci 53); Reviews of Geophysics LST |

**Anything below all relevant floors is B by default.** This includes
"comprehensive survey", "perspective", and "tutorial" formats lacking any
audit/measurement/SLR/anchor/re-derivation/re-analysis component.

## Step 3 — Pre-commit scope in `notes/scope.md`

Write before any literature load. Required fields:

```markdown
# Scope — frozen at <ISO timestamp>

## Review type
<one of the 9 types from Step 1>

## Verification floor
<one or more from Step 2; for each, name an anchor exemplar>

## Topic-ceiling honesty check
- Are the artifacts I'm reviewing open? (Open-weight models / open
  datasets / public proceedings / accessible source code = audit possible)
- Or are they closed? (Frontier-model evals / industry-disclosed tools /
  closed-weight benchmarks = structurally B-capped)
- If closed: state explicitly that the highest achievable grade is B and
  describe why; do not pretend audit is possible

## Question
<PICO/PECO/PICOS or analog. For ML: "Population: <system class>;
Intervention: <capability under test>; Comparator: <baseline>; Outcome:
<measurable>; Study design: <eligible source types>".>

## Inclusion criteria (each with a yes/no test)
- <criterion 1>
...

## Exclusion criteria (each with a yes/no test)
- <criterion 1>
...

## Information sources
- <database / venue / repo registry>, dates: <inception> → <cutoff>
- <full search query / URL pattern>

## Bounded N
- Target corpus size: ~N
- Selection rule if more than N qualify: <recency / citation rank /
  representative sampling rule>

## What is OUT of scope
- <explicit anti-list — what readers might expect but won't get and why>
```

Amendments after this point go in `notes/scope_amendments.md` with
timestamp + reason. Brain must not silently rewrite scope to match what
the search returned.

## Step 4 — Plan experiment types per chosen floor

The `notes/plan.md` for a survey project must include the experiment
types below, *matched to the chosen floor*.

### For Audit / benchmark survey + Counting floor

For every system that **claims a measurable capability**:

1. **`audit_<system>`** — clone repo, read source, verify the README's
   capability claims against the actual implementation. Output:
   `claim_verification` table with `claim`, `paper_says`, `code_does`,
   `verdict ∈ {Confirmed, Partial, Refuted, Not_inspectable}`. Spawn one
   per open-source system. Closed-source: `verdict: Not_inspectable` +
   `reason: closed-source`.

2. **`benchmark_sample_<system>`** — for every reported benchmark number
   (e.g. "82% on SWE-Bench Verified"), run a sample (≥10-30 instances)
   on the same benchmark with the same model and check the reported
   number holds. Output: `claim`, `paper_reports`, `sample_observed`,
   `sample_n`, `verdict`. If running infeasible: `verdict: Not_runnable`
   with reason.

3. **`code_repo_inspect_<system>`** — separate from audit: "does the
   README's pip install resolve? does the example script run? are cited
   capabilities reachable from the documented entrypoint?" Cheapest
   verification, most-skipped.

### For Counting / SLR floor (large corpus)

4. **`bounded_corpus_extract_<source>`** — pull all papers from a named
   source (proceedings/repository) within a date range; build a public
   lexicon for classification; release lexicon + classifications.
   Pattern: VLM-26K (release on GitHub).

5. **`screen_dual_<batch>`** — Cochrane two-reviewer pattern. Spawn
   `tool_impl` + `tool_review` blind on the same candidate batch (the
   blind impl/test split). Disagreements escalate to brain. Track inter-rater
   agreement; flag <0.7 kappa.

### For Systematic review + GRADE/RoB

6. **`bias_assess_<study>`** — apply design-matched tool: RoB 2 (RCTs),
   ROBINS-I (non-randomized), AMSTAR 2 (included SRs in umbrella),
   Newcastle-Ottawa (observational). Output: per-domain
   signaling-question table with one of {Low / Some concerns / High}.

7. **`grade_certainty_per_claim`** — every load-bearing claim carries
   one of {High / Moderate / Low / Very_low} with downgrade reasons:
   - Risk of bias
   - Inconsistency (across studies / sources)
   - Indirectness (population / intervention / outcome mismatch)
   - Imprecision (sample size; for ML, run-to-run variance)
   - Publication bias (for ML: "what failures aren't being reported?")
   
   Untagged claims do not enter the report.

### For Anchor-experiment floor

8. **`anchor_experiment_<claim>`** — pick ≥1 sub-claim from the surveyed
   literature; set up a controlled test; report results to standalone-
   empirical-paper depth (data, code, hardware identified). Materially
   stronger than narrative.

### For Re-derivation floor (math / theoretical)

9. **`unified_object_<topic>`** — identify the single object (frame /
   estimator / equation / category) from which the prior literature
   should follow; derive it; show ≥10 named methods drop out as
   instances; provide ≥1 new short proof of a known result.

### For Dataset re-analysis floor (earth-science / observational)

10. **`dataset_reprocess_<observation>`** — reprocess a named
    observational dataset (ERA5, CERES, AERONET, etc.); document
    provenance, version, processing-pipeline hash in `notes/datasets.md`;
    ship new figures from reprocessing.

### Universal across all floors

11. **`cross_paper_reconcile_<metric>`** — for any metric reported by ≥2
    primary sources, build a table comparing the values. If they
    disagree, adjudicate (cite which paper's setup is more rigorous, or
    call it a genuine open question). GRADE inconsistency / Cochrane I²
    analog. **Don't average and move on.** This is the universal blind
    spot — 0/31 CS surveys do it.

12. **`excluded_but_relevant`** — PRISMA item 16b. Maintain
    `notes/excluded.md`: studies/systems/papers that almost qualified,
    with reason. Single most-skipped item; clearest signal of
    confirmation bias if missing.

13. **`disagreement_resolution_log`** — per the universal blind spot,
    write `notes/adjudication.md`: every cross-paper or cross-source
    disagreement, the resolution policy applied, the verdict. Mirrors
    Copernicus open-review model where adjudication becomes a public
    artifact (the only mode that produces externally auditable
    disagreement records).

## Step 5 — Citation tier policy

Apply citation downgrades systematically. Untagged citations are
**inadmissible** for quantitative claims.

| Tier | Source class | Downgrade behavior |
|---|---|---|
| `primary-empirical` | Original RCT / paper with releasable code + dataset; replicated independently | Citable for quantitative claims as-is |
| `primary-theoretical` | Original derivation/proof in peer-reviewed venue | Citable for theoretical claims as-is |
| `systematic-review` | PRISMA-compliant SR with verified GRADE per outcome | Citable for pooled estimates **only if you verified the GRADE table is actually present**, not just the PRISMA badge |
| `expert-opinion-tier` | Nature Reviews family articles (per editorial policy: "do not publish original research, case studies, meta-analyses or systematic reviews"); NEJM Review Articles; Annual Reviews narrative entries | Quantitative claims sourced here require corroboration from a `primary-empirical` or verified-SR source. Carve-out: Nature Reviews *Perspectives* and *Analysis* article types DO carry methodology and can be `primary-empirical` |
| `clinical-decision-aid` | NEJM Clinical Practice (uses NEJM internal "Sources of Information" rubric, not PRISMA) | Clinical-context citable; quantitative claims need corroboration |
| `expert-consensus` | Lancet Commission / WHO consensus / modified-Delphi | Citable for definitions/frameworks; not for effect sizes |
| `industry-disclosure` | Blog posts (Anthropic alignment.anthropic.com / DeepMind blog / OpenAI roadmap interviews) | Cite as `directional-not-replicated`; never as primary-empirical |
| `leaderboard` | Live leaderboards (SWE-Bench, MLE-Bench, Open LLM Leaderboard) | Cite with access date; flag that numbers may have changed |

Every cited source in `notes/literature.md` carries a `tier:` field. Brain
uses tier to gate quantitative claim insertion.

## Step 6 — Cross-cutting requirements

These hold regardless of review type / floor.

### 6a. Citation budget

Hard cap: **25 cites per 1000 words** of report body (Nature Reviews
norm: ~150 cites over ~6000 words). Drive-by citation clusters
(`[3, 4, 5, 6]` without claim anchor) count as 1 cite for the budget but
trigger a quality flag if used >2× per section.

### 6b. Claim-first, not author-first

Every paragraph leads with a claim about the phenomenon, not "Smith et
al. (2023) showed". This is `skills/review/`'s anti-stacking rule;
surfaced here because the citation grammar is **diagnostic of rigor** —
claim-first forces the writer to commit to what is true; author-first
lets them launder it through attribution. Validated across all 4 wave-1
domains.

### 6c. Adjudicate disagreement, don't fence-sit

When primary sources contradict, the report must contain one of:
- A **ruling** with reasoning ("Janus 2025: the SK-vs-RSB controversy
  is of no consequence for off-equilibrium dynamics because…").
- An honest **"currently unresolved"** with the named experiment that
  would resolve it ("Smith 2025: octupolar correlation requires a
  measurement with direct sensitivity to octupolar moments below 0.05K,
  not yet performed").
- An **`escalate_authority_bound`** call if the disagreement requires
  modifying RESEARCH.md scope.

Banned: "some authors find X, others find Y; further work is needed."

### 6d. Negative space must be concrete

Every Open Problems / Outlook item is bound to a specific missing
measurement, method, system, or experiment. Generic "more research
needed" is rewritten or dropped. Pattern (validated across physics,
math, and engineering): each open question names the observable / method
that would close it.

### 6e. PRISMA-label verification

When citing an upstream SR, agent must independently verify:
- GRADE-tagged outcome table is actually present (not just the PRISMA
  badge — only ~7.5% of nominally compliant SRs have it)
- Funnel plot or Egger statistic for publication bias is present
- PRISMA flow diagram shows actual screening counts

PRISMA name-drop without screening log is **worse than not invoking
PRISMA** — it's badge fraud. Flag explicitly in `notes/excluded.md`
when an upstream review fails the verification.

### 6f. search_current_as_of separate from publication year

Every cited SR / review carries `search_current_as_of: <date>`. Cochrane
reviews routinely cite as canonical with searches 5+ years stale. If
search_current_as_of is older than 36 months from your work, surface as
a freshness flag in the cited claim's context.

### 6g. Data provenance for re-analysis figures

If your survey reprocesses observational data, `notes/datasets.md`
required:
```markdown
## <dataset name>
- Source: <URL / DOI>
- Version: <version string>
- Download date: <ISO>
- Processing pipeline: <script path / hash>
- Citation: <DOI of dataset paper>
```
Without this, your "re-analysis figure" is unauditable — equivalent to
PRISMA-name-without-substance for empirical sciences.

## Step 7 — Finish-gate checklist

Before brain calls `finish()`, verify each item below. Adapt to chosen
review type per Step 1's relaxations.

1. ☐ `notes/scope.md` exists, written before any literature load;
   amendments in `notes/scope_amendments.md`
2. ☐ Review type declared and committed
3. ☐ Verification floor declared and **cleared** (anchor exemplar
   matched in your output)
4. ☐ Topic-ceiling honesty check completed (B-cap acknowledged if
   applicable)
5. ☐ Question stated in PICO/PECO/PICOS form
6. ☐ Eligibility criteria explicit; measured-but-excluded distinguished
   from not-measured
7. ☐ Information sources documented with dates and full search strategy
8. ☐ Selection process documented: screener count, dual-screening
   policy, conflict resolution
9. ☐ Risk-of-bias / quality appraisal at study level (or
   declared-skipped for scoping reviews)
10. ☐ Synthesis plan pre-specified
11. ☐ `notes/adjudication.md` exists with disagreement resolution log
    (universal blind spot — non-empty for any survey covering ≥10
    sources)
12. ☐ Certainty-of-evidence rating per load-bearing claim (GRADE / tier)
13. ☐ Flow diagram of identified → screened → eligible → included counts
14. ☐ `notes/excluded.md` exists with reason per excluded source
15. ☐ Citation budget ≤25/1000 words
16. ☐ All citations carry `tier:` field per Step 5
17. ☐ `notes/datasets.md` exists if any re-analysis figure is in report
18. ☐ Open problems concrete (each bound to named missing measurement /
    method / system)
19. ☐ Funding source / COI / retraction status checked for each cited
    primary work where applicable
20. ☐ search_current_as_of date noted for each cited SR / review

## Anti-patterns — symptoms of B-grade output

Brain should flag in self-review and rewrite. Frequencies validated
across the 240-review corpus.

### Top 12 anti-patterns by frequency

1. **"We comprehensively review..."** without a corpus boundary
   (27/31 CS surveys, ~80% across domains). Replace with bounded N +
   named selection rule.
2. **"We focus on" / "we prioritize" replacing inclusion criteria**
   (22/31 CS surveys). Unfalsifiable scope; replace with explicit yes/no
   tests.
3. **Performance numbers passed through without provenance flagging**
   (20/31 CS surveys). Every quoted score must carry
   `(self-reported / re-run / leaderboard) + setup`.
4. **Taxonomy figure as primary deliverable** (26/31 CS surveys).
   Removing the figure should leave a contribution; if not, B-grade.
5. **Application section without deployment outcome data** (18/31 CS
   surveys). Cut sections that lack measured outcomes.
6. **GitHub awesome list as audit substitute** (14/31 CS surveys).
   Curated link list = organize; extracted structured data + reproducible
   code = audit.
7. **PRISMA name-dropped without screening log** (1 explicit, ~3
   implicit per CS wave). **Worse than not invoking PRISMA.**
8. **"First comprehensive survey of X"** for non-disjoint X (6/31 CS
   surveys). Essentially a noise word in 2024-2026; drop or replace
   with specific differentiator.
9. **Disagreement-handling silently absent** (31/31 CS surveys, 12/30
   biology). The universal blind spot. Cleanest novelty axis if
   addressed.
10. **"Open questions for human decision" populated with brain's own
    punts** (e.g. "Should we re-weight the matrix?"). Section is for
    authority-bound questions only. Use `escalate_authority_bound` tool
    instead; don't use the section as catch-all.
11. **Re-summarizing already-known foundational systems in detail**
    when RESEARCH.md says reader knows them.
12. **"Some authors find X, others Y; further work needed"**
    (~10/30 biology, ~9/30 physics). Banned per 6c.

### Three failure-mode-specific anti-patterns

13. **Bibliometric counting without releasing count code** (Renewable
    Sustainable Energy Reviews modal pattern). The count is the
    contribution; if it's not reproducible, it's decoration.
14. **Dimensional/normalization mixing** (Renewable Sustainable Energy
    Reviews on LCOE; ML surveys on accuracy across benchmark variants).
    Numbers from different conditions tabulated without reconciliation.
15. **Citation laundering through "expert opinion"** — quoting Nature
    Reviews / NEJM Review Articles for quantitative claims as if they
    were primary research. Per Step 5: these are
    `expert-opinion-tier` and require corroboration.

## Genre-aware grading

A-grade in math is different from A-grade in CS is different from
A-grade in biology. Grade *within genre*, not uniformly:

- **Math A-grade**: re-derivation in unified notation OR new short proof
  OR theoretical-essay with sharp normative argument (Bull AMS allows
  the essay genre)
- **CS/ML A-grade**: bounded corpus + author-run measurements OR
  released extracted-feature data + screening log
- **Biology A-grade (rare)**: original quantitative cross-study
  re-analysis (e.g. Chang & Prakash dimensionless cellular-acceleration
  number) OR explicit competing-model adjudication with mechanistic
  predictions per dataset
- **Earth/environment A-grade**: dataset reprocessing pipeline
  documented + new figures from reprocessing
- **Engineering A-grade**: unified formal architecture subsuming prior
  approaches OR harmonized device/algorithm spec sheets across primary
  studies

The rubric varies but the discriminator is invariant: **independent
verification work present, beyond paper-trust narration.**

## Mapping to Sisyphus architecture

- **Cochrane "two independent reviewers" pattern** → already mapped to
  `tool_impl` + `tool_review` blind split (the fix for self-circular
  impl/test). Survey-time application: **`screen_dual_<batch>`**
  experiment type.
- **PRISMA artifact ledger** → `data/experiments/E*/runs/run_*/results.json`
  + `notes/experiments.md`. Each PRISMA artifact (scope.md, search log,
  screening table, excluded.md, bias matrix, GRADE summary, adjudication
  log) is a discrete file, not a prose section.
- **GRADE certainty per claim / tier system** → tag every load-bearing
  assertion in `notes/literature.md` with `certainty: {High|Moderate|Low|Very_low}`
  + `tier:` per Step 5. Brain reads when drafting; untagged claims
  inadmissible in report.
- **Authority-bound concern** → `escalate_authority_bound` tool. Use
  when scope adjudication requires modifying RESEARCH.md. Do **not**
  dump punted decisions into a generic "Open questions for human
  decision" section.
- **`notes/datasets.md`** (new artifact for narrative-with-re-analysis
  type) → tracks observational dataset provenance, versions, processing
  hashes; required before any re-analysis figure renders.
- **`notes/adjudication.md`** (new artifact, Copernicus-inspired) →
  public disagreement-resolution log; every cross-source contradiction
  + verdict + resolver-agent + evidence path.
- **`compile_latex` hook** → can verify presence of finish-gate
  artifacts (scope.md, datasets.md, adjudication.md, citation count vs
  body length, tier:-tagging on every cite) and emit warnings to brain
  pre-finish.

## Worked example — what the AI Scientist 2026 survey should have done

The actual run produced 1 audit (E1: AI-Researcher) + 4 synthesis
experiments (E2-E5). All 11 other systems were paper-trust. Cost $32,
graded B (with 1 element of A-grade in E1).

Under this skill, plan-time decisions:

1. **Type**: Audit / benchmark survey
2. **Floor declared**: Counting + Measurement (open-source systems
   admit both)
3. **Topic-ceiling honesty**: closed-source tier (Kosmos / Aletheia /
   Anthropic W2S / Claude Code internals / DeepMind tools) is
   structurally B-capped — declare in scope.md
4. **Plan**:

```
E1-E9: audit_<system> for each open-source: AI-Researcher, RepoAgent,
       LocAgent, RepoAudit, CompileAgent, AIDE, Agent-Lab,
       AutoResearchClaw, OpenHands. Closed-source: documented
       Not_inspectable.

E10-E13: benchmark_sample_<system> for each reported benchmark number:
       - Claude Code on 30-instance SWE-Bench-Verified sample
       - AIDE on 10-instance MLE-Bench-Lite sample
       - AI-Researcher on 5 Scientist-Bench tasks
       - LocAgent file Acc@5 on 30-instance SWE-Bench-Lite sample

E14: cross_paper_reconcile of "GitHub research capability" claims
     across systems (the capability matrix becomes a verified-by-audit
     artifact, not a paper-trust digest).

E15: code_repo_inspect for each of the 9 open-source systems.

E16: disagreement_resolution_log compilation across E1-E15 — the
     universal blind spot, addressed.

Synthesis experiment (E17): the architectural-comparison + failure-mode
     + SOTA chapters, drawing only on E1-E16 evidence.

Estimated cost: $200-400. Estimated grade: A-.
```

The discriminator isn't writing skill (the existing `skills/review/`
already covers prose). It's **plan-time experiment-type vocabulary**.
This skill is brain's vocabulary expansion.

## References

Detailed evidence and quoted excerpts:

- `research/interdisciplinary_protocols.md` — PRISMA 2020, PRISMA-ScR,
  Cochrane Handbook, GRADE, RoB 2, AMSTAR 2, Arksey-O'Malley scoping,
  Cochrane Rapid Reviews, Greenhalgh narrative-review counterpoint.
- `research/bio_med.md` — Nature Reviews family editorial framing;
  Cochrane CDSR; eClinicalMedicine SR worked examples; the 8 things
  narrative reviews skip.
- `research/cs_ml_math.md` — BetterBench (NeurIPS 2024), Leak-Cheat-Repeat
  (EACL 2024), Berkeley RDI benchmark exploits (2025), Acta Numerica
  unified-derivation pattern, modal LLM-agent surveys as B-grade.
- `research/physics_chem.md` — RMP Janus collab spin-glass review,
  Sherrington-Kirkpatrick NRP, Annual Review of Cond Matter exemplars,
  Chem Soc Rev, J Mater Chem B editorial guidance.
- `research/wave2/physics_broad.md` — 30 reviews from Living Reviews /
  RMP / NRP / Annu Rev Nuc Part Sci / ARA&A / Annu Rev Fluid Mech /
  Reports on Progress in Physics. 70% A-rate (Living Reviews norm).
- `research/wave2/chem_materials.md` — 30 reviews from Chem Rev / Chem
  Soc Rev / Nat Rev Chem / Nat Rev Mater / Annu Rev Phys Chem / Annu
  Rev Mater Res. 60% A-rate; cross-paper benchmark tables in 57%.
- `research/wave2/biology_broad.md` — 30 reviews from Nature Reviews
  Immunology / Microbiology / Neuroscience / MCB / Annu Rev Imm /
  Biochem / Cell-Dev / Neuro / Microbiol / Plant Bio / Trends. **2/30
  strict A** — the discriminator is hardest to clear in this venue.
- `research/wave2/cs_ml_broad.md` — 31 surveys from arXiv (cs.LG,
  cs.CL, cs.CV, cs.AI, cs.CR, cs.SE, cs.IR). **4/31 strict A (~13%)**.
  Critical finding: A-grade is topic-determined (open vs closed
  artifacts).
- `research/wave2/math_stats.md` — 28 surveys from Acta Numerica / Bull
  AMS / SIAM Review / Probab Surv / Annu Rev Stat / Stat Surv / FnT
  TCS. **24/28 A-grade** — Acta Numerica norm of unification holds.
  Genre-aware grading required (essays ≠ unification surveys).
- `research/wave2/earth_med.md` — 15 earth-environment + 15 clinical
  medicine reviews. Earth introduces a 3rd methodology mode
  (narrative-with-embedded-re-analysis); Cochrane is the verbatim
  template for autonomous-agent SR work. PRISMA adherence
  item-asymmetric (~7.5% on hard items).
- `research/wave2/social_eng.md` — 15 economics + 15 engineering
  reviews. **22/30 A or A-** — JEL norm of author re-estimation; AR
  Econ "stylized-fact tables"; Renewable Sustainable Energy Reviews
  confirmed B-modal venue.

External references (for brain to fetch on demand):

- PRISMA 2020 statement (Page et al.), https://pmc.ncbi.nlm.nih.gov/articles/PMC8007028/
- Cochrane Handbook ch. 8 (RoB 2), https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-08
- PRISMA-ScR (Tricco 2018), https://pubmed.ncbi.nlm.nih.gov/30178033/
- GRADE Working Group, https://www.gradeworkinggroup.org/
- BetterBench (Reuel et al. NeurIPS 2024), https://arxiv.org/abs/2411.12990
- Leak-Cheat-Repeat (Balloccu et al. EACL 2024), https://arxiv.org/abs/2402.03927
- Berkeley RDI benchmark exploits, https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/
- VLM-26K bibliometrics, https://arxiv.org/abs/2510.09586
- Lu et al. SLM survey, https://arxiv.org/abs/2409.15790
- OCL-SLR with public artifacts, https://arxiv.org/abs/2501.04897
- Greenhalgh "Time to challenge…", https://pmc.ncbi.nlm.nih.gov/articles/PMC6001568/
- Acta Numerica norm — see Vol 33 (2024), particularly Blanes-Casas-Murua
  splitting methods (arXiv:2401.01722) for the unified-Lie-series template
- JEL author re-estimation norm — Banerjee-Hanna-Olken-Sverdlin Lisker
  social protection (DOI 10.1257/jel.20241646) with openICPSR replication
