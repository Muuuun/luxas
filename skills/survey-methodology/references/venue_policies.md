# Venue editorial policies — citation-tier intelligence

> Use this when assigning the `tier:` field in
> `templates/literature_entry.md`. Editorial policies are explicit
> structural facts (not author discretion); ignore them and you'll
> mis-tier citations and let `expert-opinion-tier` claims into
> quantitative claim slots.

## Nature Reviews family — `expert-opinion-tier` by editorial rule

**The single most enforceable citation-tier rule.** Nature Reviews family
journals (Nature Reviews Genetics / Cancer / Drug Discovery / Molecular
Cell Biology / Immunology / Microbiology / Neuroscience / Endocrinology /
Cardiology / Nephrology / Neurology / Physics / Materials / Chemistry /
Earth & Environment) have an explicit, global editorial policy:

> **"Nature Reviews journals do not publish original research, case
> studies, meta-analyses or systematic reviews."**

Source: Nature.com browse pages for any Nature Reviews journal (verified
on Nature Reviews Cardiology / Endocrinology / Nephrology / Neurology /
Earth & Environment).

### Implication for the agent

- Default tier for any Nature Reviews article: **expert-opinion-tier**
- Quantitative claims sourced here require **corroboration from a
  `primary-empirical` or verified `systematic-review` source**
- Author authority is the validity argument; an autonomous agent has no
  parallel authority

### Carve-outs

Nature Reviews journals **do** publish Perspectives and Analysis article
types that *can* carry methodology. Tier these on a per-article basis:

- *Perspectives*: forward-looking opinion; usually `expert-opinion-tier`
  but check for embedded methodology
- *Analysis articles*: explicit data analysis; can be `primary-empirical`
  if the analysis is the contribution

Distinguish article *type* (Review / Perspective / Analysis / Comment /
Highlight / Methods Primer) within the journal name when assigning tier.

### Concrete: Nature Reviews Drug Discovery

NRDD is unusual in publishing **"analysis articles based on existing
datasets (e.g. metaanalysis)"** as a distinct article type — these *do*
carry methodology and can be `systematic-review` tier. Most NRDD Reviews
and Perspectives are still `expert-opinion-tier`.

## Annual Reviews — modal `expert-opinion-tier` with venue exceptions

Annual Reviews journals (Annu Rev Genet / Cell Biol / Neuro / Imm /
Microbiol / Plant Bio / Biochem / Phys Chem / Mater Res / Cond Matt
Phys / Nuc Part Sci / ARA&A / Fluid Mech / Earth Planet Sci / Marine /
Environ Resour / Econ / Stat Appl / Sociol / Psych / Polit Sci / Control
/ BME / etc.) — **invitation-only narrative reviews averaging ~150
references**.

Editorial process is the quality control; **no PRISMA, no PROSPERO**.

### Tier assignment

- Default: `expert-opinion-tier`
- **Exception**: Annual Review of Economics + Annual Review of Physical
  Chemistry + Annual Review of Heat Transfer routinely include author
  re-derivation / re-estimation / new figures from primary data; these
  *can* be `primary-empirical` or `primary-theoretical` per article
- **Exception**: Acta Numerica (technically not Annual Reviews but
  similar venue model) — the unification is itself the contribution;
  cite as `primary-theoretical`

### Venue-specific notes

- **Annual Review of Economics**: the JEL norm (author re-estimation
  with replication on openICPSR) is the modal pattern. ≥80% of 2024
  surveys here are A-grade. Cite numerical claims with confidence.
- **Annual Review of Physical Chemistry**: re-derivation is the venue
  norm. Re-derived equations are `primary-theoretical`.
- **Annual Review of Statistics and Its Application**: heterogeneous —
  some entries introduce new theorems (cohort-Shapley), others are
  field-overviews. Tier per-article.

## NEJM Review Articles — `clinical-decision-aid` (separate from SR)

NEJM publishes:

1. **Review Articles** (signed expert syntheses; NOT systematic reviews)
2. **Clinical Practice** (evidence-graded clinical-decision aids using
   NEJM's internal "Sources of Information" rubric, NOT PRISMA)
3. **Original Articles** (primary research)

For Review Articles + Clinical Practice: tier as **clinical-decision-aid**.
- Clinical-context citable for guidance / standard of care
- Quantitative claims need corroboration from `primary-empirical` or
  `systematic-review`

NEJM's grading rubric is internal and not externally verifiable against
a public protocol. Treat as a fourth template parallel to but distinct
from PRISMA SRs.

## Cochrane CDSR — verified `systematic-review`

Cochrane Database of Systematic Reviews is the gold standard.
PRISMA-compliant + RoB 2 + GRADE + PROSPERO registration are mandatory.

For citation:
- Tier: **systematic-review**
- BUT: still verify per-item per `prisma_protocols_distilled.md`
  (PRISMA-substance verification). Even Cochrane reviews are sometimes
  cited as canonical with searches 5+ years stale (`search_current_as_of`
  flag).

### Update lag is real

Cochrane CDSR review CD012620 (long-acting inhalers for advanced COPD,
network meta-analysis) was cited as 2025-canonical with **search current
to April 2018** — 7-year lag. Always check `search_current_as_of` before
treating Cochrane numbers as current.

## Lancet Commission — `expert-consensus`

Lancet Commissions (e.g., 2024 Commission on Obesity) are:
- Methodologically a consensus / commission report
- NOT a systematic review
- Use modified-Delphi-style endorsement rather than meta-analysis
- ≥75 medical organisations endorse the typical Commission

For citation:
- Tier: **expert-consensus**
- Citable for: definitions, frameworks, policy positions
- NOT citable for: effect sizes, pooled estimates, treatment efficacy

The Lancet Commission deliverable is a *categorical framework*
(preclinical vs clinical obesity diagnosis) — distinct from but parallel
in importance to GRADE itself.

## JEL / Journal of Economic Literature — `primary-empirical` modal

JEL surveys are commissioned with a strong original-contribution norm:
nearly every survey includes either (a) authors' own meta-analysis of
effect sizes harmonized to common scale, or (b) unifying formal model
that nests prior theoretical results.

For citation:
- Default tier: **primary-empirical** (because of embedded re-estimation)
- Replication packages on openICPSR increasingly attached
- A-grade rate among 2024 *JEL* surveys: ≥80% in our corpus

## Acta Numerica / Bull AMS / SIAM Review — `primary-theoretical`

Math-side equivalents:

- **Acta Numerica**: ~6 article-monographs/year; unification is the
  contract. 8/8 Vol 33-34 articles re-derive prior theorems under one
  notation. Tier: **primary-theoretical**.
- **Bulletin of the AMS**: invitation-only expository; two genres
  (re-derivation surveys + position essays). Both can be A-grade in
  their own genre. Tier: **primary-theoretical** for re-derivation
  surveys; tier essays case-by-case.
- **SIAM Review**: Survey & Research Spotlights section requires
  shared-benchmark adjudication of competing methods. Tier:
  **primary-empirical** (the benchmark re-runs are the contribution).

## Living Reviews series — `primary-theoretical` with versioning

Living Reviews in Relativity / Solar Physics / Computational
Astrophysics are continuously updated reference works:

- Re-derive prior results in print
- Correct mathematical errata in print on revision (e.g. Yunes-Siemens-
  Yagi 2025 explicitly corrected 2013 errors)
- Per-edition data updates against new observations

Cite with edition number; old editions may have superseded results.

Tier: **primary-theoretical**.

## Industry blogs / disclosures — `industry-disclosure`

DeepMind blog / alignment.anthropic.com / OpenAI roadmap interviews /
similar industry vendor disclosures.

Tier: **industry-disclosure**.

- Cite as `directional-not-replicated`
- Never as `primary-empirical`
- Independent replication rare or absent
- Examples: Aletheia (DeepMind), Automated W2S Researcher (Anthropic),
  OpenAI roadmap to "AI research intern" by Sept 2026

When the system being described is closed-source with no published paper,
this is the only available source — but tier accordingly. **Never let an
industry blog post substitute for a peer-reviewed primary citation in a
quantitative claim.**

## Live leaderboards — `leaderboard`

SWE-Bench Verified, MLE-Bench, Open LLM Leaderboard, HELM, etc.

Tier: **leaderboard**.

- Cite with **access date**
- Flag that numbers may have changed
- Do not present as snapshot-canonical
- Sample-verify if floor-relevant (cf. `benchmark_sample_<system>`
  experiment type)

## Renewable & Sustainable Energy Reviews — `expert-opinion-tier`

Notorious B-grade modal venue. PRISMA-style literature catalogs with
bibliometric tables and qualitative pros/cons. Effect sizes (LCOE,
capacity factor, energy density) reported as quoted from primary sources
without re-normalization to common assumptions.

Tier: **expert-opinion-tier** (despite PRISMA-style framing).

## How to use this file

When adding a citation to `notes/literature.d/<key>.md`:

1. Look up the venue here.
2. Apply the tier rule (default + carve-outs).
3. If the venue is not listed: default conservatively (`expert-opinion-tier`
   if narrative; `primary-empirical` only if peer-reviewed venue with
   explicit data + code release).
4. If the article type matters (e.g., Review vs Perspective vs Analysis
   in Nature Reviews family), apply the type-specific carve-out.
5. Record the tier rationale in the entry per
   `templates/literature_entry.md`.

This is the single highest-leverage step for preventing citation
laundering — quoting Nature Reviews / NEJM / industry blogs as if they
were primary research is the most common pathway to B-grade output.
