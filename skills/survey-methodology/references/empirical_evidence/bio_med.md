# Methodology Patterns in Top Bio/Med Reviews (2024–2026)

**Question:** What does the methodology layer of a high-quality biology/medicine review actually do, and what — specifically — separates protocol-driven systematic reviews from elite narrative reviews (Nature Reviews / Cell / NEJM)? The goal is to extract patterns that are *structurally enforceable* by an autonomous research agent.

**Key finding up front.** Elite narrative reviews (Nature Reviews family, Cell reviews) have *no* methodology section, no search strategy, no inclusion criteria, no quality grading, no cross-paper adjudication protocol. Their authority comes from author reputation. Systematic reviews (Cochrane, JAMA SR, BMJ SR, PRISMA-compliant Frontiers/Springer) have all of these and they are *structurally checkable*. **The systematic-review protocol stack (PRISMA 2020 + GRADE + RoB2/ROBINS-I) is the directly applicable model for an autonomous agent because each step is a discrete artifact a tool can verify.**

---

## Part 1 — Per-review briefs

### Bucket A: Elite narrative reviews (no methodology layer)

#### A1. Nature Reviews Genetics 2025 — fine-mapping, MAVE, CRISPR-imaging reviews
URL: https://www.nature.com/nrg/articles?type=review-article&year=2025

These reviews (Li & Zhou on fine-mapping; McEwen et al. on MAVE; Zhu et al. on CRISPR DNA/RNA imaging) are framed as expert syntheses with no published search protocol. The journal's own "Reviews & Analysis" page describes them as expert overviews; there is no eligibility-criteria item, no PROSPERO registration, no PRISMA flow diagram. Quality judgments about cited papers are encoded *implicitly* in which studies are foregrounded vs. relegated to a single citation.

#### A2. Nature Reviews Cancer 2025 — m6A, TAMs, phagocytic checkpoints, ER stress, deconvolution methods
URL: https://www.nature.com/nrc/articles?type=review-article&year=2025

38 reviews published in 2025. Same pattern: editorially commissioned, expert author, no methods section. Even the *deconvolution methods* review — which is explicitly a "practical guide for cancer researchers to select deconvolution methods" — does not state which deconvolution papers it included or excluded. Reproducibility of the synthesis (would another author land on the same set of recommended methods?) is not testable.

#### A3. Nature Reviews Drug Discovery 2025 (232 articles)
URL: https://www.nature.com/nrd/articles?year=2025

NRDD does publish a distinct article type — "**analysis articles based on existing datasets (e.g. metaanalysis)**" (Wikipedia entry on the journal) — which *do* carry methodology. But its standard Reviews and Perspectives do not. The mixed model is interesting: the journal recognizes that some questions need protocol, but treats most reviews as expert opinion.

#### A4. Nature Reviews Molecular Cell Biology 2025 — centriole architecture (Gönczy), ESCRT (Burigotto & Carlton), TGN carriers (Watson et al.)
URL: https://www.nature.com/nrm/articles?year=2025

Mechanistic / structural reviews. No PICO, no eligibility criteria, no risk-of-bias appraisal of cited cryo-EM or cell-imaging papers. Conflict adjudication when two structural papers disagree (e.g. competing models of complex assembly) is editorial, not protocol-driven.

#### A5. Frontiers in Oncology 2025 — "Expanding horizons of cancer immunotherapy" (representative non-elite narrative review)
URL: https://www.frontiersin.org/journals/oncology/articles/10.3389/fonc.2025.1511560/full

This piece names its corpus — "**A review of literature from the past ten years across PubMed, Scopus, and Web of Science focused on immunotherapy strategies**" — but provides *no* inclusion/exclusion criteria, no count of records screened, no risk-of-bias tool, no GRADE rating, no quantitative pooling. WebFetch verdict: "This is a **narrative review** with structured tables organizing clinical trial data and mechanistic summaries, not a systematic review." This is the modal failure mode: claimed scope, no protocol.

#### A6. PMC12468534 — single-cell / spatial transcriptomics TME review (2025)
URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC12468534/

WebFetch: "**The document lacks a dedicated methodology section describing search strategies, inclusion/exclusion criteria, or quality assessment procedures. There is no mention of GRADE ratings or systematic evaluation protocols.**" Opens with "This review explores the advanced techniques that are transforming our comprehension of cancer" — exploratory framing typical of narrative format.

### Bucket B: Systematic reviews (full methodology layer)

#### B1. Cochrane: Long et al. 2025/26 — interventions to promote cardiac rehabilitation utilisation
URL: https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD007131.pub5/full

47 studies, 10,803 participants, evidence current to March 2025. Cochrane standard: protocol pre-registered, dual independent screening, RoB2 + GRADE summary-of-findings table, narrative + quantitative synthesis, explicit handling of missing data and disagreements. (Source via search index; full text 403'd in fetch but methodology format is fixed by the Cochrane Handbook v6.5.)

#### B2. Therapeutic anti-cancer vaccines SR (eClinicalMedicine 2025, PMC12305733)
URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC12305733/

Quoted methodology:
- Search: "**Embase, MEDLINE, Web of Science Core Collection, and ClinicalTrials.gov**" with "**no language restriction for articles published from the inception of the database up to May 2025**".
- Inclusion: "**All prospective clinical trial studies were included with no restrictions on the type of therapeutic anti-cancer vaccines, participants age, sex, race, or country of origin**."
- Exclusion (explicit): "**Studies reporting only in vitro and/or in vivo results...case reports, case series, review articles, case–control, retrospective cohort, and single-arm studies were excluded**."
- Bias: "**All the included RCTs were assessed for bias using the Cochrane Handbook for Systematic Review of Interventions, version 6.2 and Cochrane risk-of-bias tool**."
- Honest negative result: authors deliberately did *not* meta-analyse because — "**Given the substantial heterogeneity across the included studies, we determined that a meta-analysis was not methodologically appropriate**." (This is the kind of self-restraint a narrative review would not perform.)

#### B3. ICI vs vaccines comparative SR & meta-analysis (PMC12030876, 2025)
URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC12030876/

- "**The Cochrane Hand book for Systematic Reviews of Interventions and the Preferred Reporting Items for Systematic Reviews and Meta-Analyses (PRISMA) were used in this systematic review and meta-analysis**" — protocol registered as PROSPERO CRD42025639024.
- Date range and language explicit: "January 1, 2010 through December 31, 2024, limited to English-language publications".
- Cross-paper adjudication via formal heterogeneity statistic: "**the I² statistic to quantify the degree of variability across studies**" — reported I² = 12 % (ICIs) and 0 % (vaccines).
- Risk of bias: "**The Cochrane Risk of Bias (RoB) tool was exclusively utilized to evaluate the risk of bias in the included studies**" across six domains (randomization, allocation concealment, blinding, outcome assessment, attrition, selective reporting).

#### B4. ICI-beyond-progression pooled analysis (MDPI J. Clin. Med. 14:6680, 2025)
URL: https://www.mdpi.com/2077-0383/14/18/6680

Search: "**PubMed/MEDLINE, Embase, and the Cochrane Library were searched from inception to 31 March 2025**". Quality: "**Newcastle–Ottawa Scale (observational designs) and the Cochrane Risk-of-Bias tool (randomized trials)**." Notable: tool choice is matched to study design, not one-size-fits-all.

#### B5. Greenhalgh et al. 2018, "Time to challenge the spurious hierarchy of systematic over narrative reviews?" (PMC6001568)
URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC6001568/

Used here as the boundary-defining text. Quoted:
- "**A legitimate criticism of narrative reviews is that they may 'cherry pick' evidence to bolster a particular perspective**."
- "**The defining characteristic of a systematic review in the Cochrane sense is the use of a predetermined structured method to search, screen, select, appraise and summarise study findings to answer a narrowly focused research question**."
- "**Conventional systematic reviews address narrowly focused questions; their key contribution is summarising data**" while "**Narrative reviews provide interpretation and critique; their key contribution is deepening understanding**."

The agent-relevant takeaway: narrative-review failures (cherry-picking, irreproducible selection) are *exactly* the failure mode of an autonomous agent that "trusts paper claims rather than verifying them." The remedy is the predetermined structured method.

---

## Part 2 — What PRISMA / Cochrane / GRADE actually enforce that narrative reviews skip

### PRISMA 2020 — the 27 enforceable items

(Extracted verbatim from PMC8007028 fetch.)

A narrative review writes prose about a topic. A PRISMA-compliant SR must produce **discrete artifacts** at each step. Each is something an agent tool can emit and a reviewer tool can check:

| PRISMA item | Artifact required | Why agents skip it |
|---|---|---|
| 5 — Eligibility criteria | "**Specify the inclusion and exclusion criteria for the review and how studies were grouped for syntheses**" | Agent grabs whatever the search returns |
| 6 — Information sources | "**Specify all databases, registers, websites, organisations, reference lists and other sources searched**" | Agent doesn't enumerate sources |
| 7 — Search strategy | "**Present the full search strategies for all databases, registers and websites, including filters and limits**" | Agent doesn't log queries |
| 8 — Selection process | "**Specify methods to decide whether studies met inclusion criteria, including reviewer numbers and independence**" | Agent uses 1 reviewer (itself), no independence |
| 11 — Risk of bias | "**Specify methods used to assess risk of bias in included studies, including tool details**" | Agent treats all cited papers as equally credible |
| 13d — Synthesis methods | "**Describe any methods used to synthesise results and provide a rationale**" | Agent narratively summarizes without rule |
| 13e — Heterogeneity | "**Describe any methods used to explore possible causes of heterogeneity**" | Agent doesn't notice when studies disagree |
| 14 — Reporting bias | "**Describe any methods used to assess risk of bias due to missing results in a synthesis**" | Agent never asks what's *not* in the literature |
| 15 — Certainty assessment | "**Describe any methods used to assess certainty in the body of evidence**" | Agent has no GRADE-equivalent confidence ladder |
| 16b — Excluded studies | "**Cite studies that might appear to meet inclusion criteria, but which were excluded, and explain why**" | Agent never explains exclusions |
| 24a — Registration | "**Provide registration information for the review**" | No pre-commitment, so post-hoc fitting is invisible |

### GRADE — the verifiable confidence ladder

(Extracted from CDC ACIP GRADE Handbook fetch, plus search.)

GRADE forces every claim into one of four buckets — **High / Moderate / Low / Very Low** — with explicit reasons.

- **High:** "We are very confident that the true effect lies close to that of the estimate of the effect."
- **Very Low:** "We have very little confidence in the effect estimate: the true effect is likely to be substantially different from the estimate."

Five **downgrade** domains (each a checkable test):
1. **Risk of bias** — RoB2 for RCTs, ROBINS-I for non-randomized. ROBINS-I "**assesses selection bias and confounding as an integral part of the evaluation process, unlike most other risk of bias tools for NRS**."
2. **Inconsistency** — unexplained variability across studies, quantified by I² (a 0–100 % statistic; B3 above shows it in action).
3. **Indirectness** — PICO mismatch between primary studies and review question.
4. **Imprecision** — checked against "**Optimal Information Size (OIS), akin to a sample size calculation for a single, adequately powered trial**".
5. **Publication bias** — funnel plots, Egger test; "**because proving publication bias is inherently difficult, GRADE recommends downgrading by only one level when suspected**."

Three **upgrade** domains for non-RCTs: large effect, dose-response, plausible-confounding-would-reduce-effect.

For an agent: GRADE is a literal checklist of categorical outputs. Every claim → tag. Every tag → reason. If the agent cannot produce a tag, the claim does not enter the report.

### Cochrane Handbook v6.5 — the workflow

The Cochrane Handbook is a fixed playbook. Independent dual screening, dual extraction, dual bias rating, third-reviewer adjudication of disagreements ("**two reviewers working independently to assess risk of bias for each RCT, and discrepancies resolved with a third reviewer when necessary**" — quoted from B2). Mandatory Summary-of-Findings tables that GRADE-rate every prespecified outcome. PROSPERO pre-registration (PROSPERO is "**an international database of prospectively registered systematic reviews**") so deviations are auditable.

For a single-agent system the "two independent reviewers" pattern can be enacted as a **tool_impl + tool_review**-style split: one agent extracts, a *blind* second agent re-extracts from the same source, and a third resolves disagreement — directly analogous to Sisyphus's blind impl/test split that solved the self-circular problem in tool development.

---

## Part 3 — Cross-cutting patterns

### Pattern 1: scope is pre-committed or it doesn't exist
PRISMA item 5 + PROSPERO. Without a pre-registered scope, the corpus drifts to confirm whatever conclusion the author finds attractive. **Agent counterpart:** write `notes/scope.md` *before* search; freeze and gate edits behind explicit "scope amendment" entries.

### Pattern 2: every cited claim carries an evidence tag
GRADE forces claim → certainty tag. Narrative reviews carry no tag, so a 1995 underpowered observational trial sits next to a 2024 50,000-patient RCT in the same prose paragraph. **Agent counterpart:** tag every claim in `notes/literature.md` with one of {RCT-large, RCT-small, observational, mechanistic-in-vitro, single-cohort, preprint, retracted}. No tag → not citable.

### Pattern 3: quantitative cross-paper adjudication via I² and forest plots
B3 reports "I² = 12 %" for ICIs and "I² = 0 %" for vaccines — the I² statistic decides whether the studies agree enough to pool. **Agent counterpart:** for any claim where N≥3 papers report a comparable quantity, compute and report dispersion (range, SD, or, if numeric, I²-equivalent). When dispersion is high, *adjudicate explicitly* — don't average and move on.

### Pattern 4: explicit excluded-but-relevant list (PRISMA 16b)
SRs cite the studies that *almost* qualified and explain why. This is the agent's most-skipped behavior — confirmation bias surfaces here. **Agent counterpart:** maintain `notes/excluded.md` with reason per excluded study.

### Pattern 5: design-matched bias tool (B4)
B4 uses Newcastle–Ottawa for observational, RoB2 for RCTs. Narrative reviews use no tool; an agent treating an in-vitro overexpression study as equivalent to a Phase III RCT is the paper-version of this failure. **Agent counterpart:** classify each cited paper by design before extraction; lock the bias tool to design class.

### Pattern 6: honest non-pooling (B2)
B2 actively *refused* to meta-analyse: "we determined that a meta-analysis was not methodologically appropriate." This is the rarest positive behavior. An agent that can correctly say "the literature is too heterogeneous to summarize numerically" outperforms one that always produces a confident summary statistic. **Agent counterpart:** explicit "do-not-pool" predicate with criteria (heterogeneous outcomes, populations, or measurement scales).

### Pattern 7: COI / funding source treatment
Cochrane chapter 7 (industry-funded studies) requires extraction of funding source and tracking it as a covariate in sensitivity analysis. Nature Reviews family captures it only in author-disclosure footers, not as data. **Agent counterpart:** funding source is a metadata field on every cited study, surfaced in `notes/literature.md`.

### Pattern 8: reproducibility / replication flagging
PRISMA does not have a dedicated "is this finding replicated?" item — but a 2025 PRISMA extension under development, **PRITERS (Preferred Reporting Items for Replication of Systematic Reviews)**, is starting to address this. For now, GRADE's "inconsistency" downgrade catches non-replication indirectly. **Agent counterpart:** explicit `replicated: yes/no/single-paper/contradicted` field on every load-bearing claim.

### Pattern 9: retracted-paper hygiene
Not formally codified in PRISMA but implicit in updated-search-date items (item 7) and risk-of-bias review. **Agent counterpart:** before citing, query Retraction Watch / Crossref retraction flag; refuse retracted citations or flag them as such with reason for inclusion.

---

## Part 4 — Direct mapping to the agent

| Human SR step | Agent operationalization |
|---|---|
| PROSPERO registration | Pre-commit `notes/scope.md` (PICO, eligibility, search) before any search call |
| Dual independent screening | Spawn a `screen_review` blind agent; parent adjudicates disagreements (mirrors Sisyphus's `tool_impl` / `tool_review` split) |
| RoB2 / ROBINS-I | A `bias_assess` tool keyed on study-design class; output is a categorical record per paper |
| GRADE certainty per outcome | Each claim in the draft carries a {High/Moderate/Low/Very Low} tag with the downgrade reasons enumerated |
| I² heterogeneity | When N≥3 numeric estimates of the same quantity exist, run a dispersion calc; gate prose summaries on I² ≤ threshold |
| PRISMA flow diagram | Identified → Screened → Eligible → Included counts auto-generated from `notes/literature.md` |
| Summary-of-Findings table | A required artifact at integrate phase — one row per prespecified outcome with effect estimate, certainty, and N |
| Conflict-of-interest treatment | `funding` field per study; sensitivity check that conclusions hold under industry-funded subset removal |

The agent-side payoff: each of these is a discrete, hookable artifact. Unlike "be more rigorous in prose," they fail loudly when missing.

---

## Part 5 — Honest list of paywall / fetch blocks

- **Nature.com direct article URLs (s41576-, s41573- prefixes)** — all returned HTTP 303 redirects without resolving. Could not fetch full text of NRG, NRD, NRMCB, NR Cancer reviews directly. Methodology extraction relied on Nature's own listing pages plus the structural fact that these journals do not publish methodology sections.
- **Cochrane Library full-text endpoint** — 403 on the cardiac-rehabilitation review fetch. Methodology summary above derives from the Cochrane Handbook v6.5 standard format which all CDSR reviews follow.
- **PRISMA-statement.org** — checklist landing page does not display the items inline; obtained the 27-item list via PMC8007028 instead.
- **NEJM original review articles** — no successful fetches; NEJM Evidence does run an "**Original Article**" track that includes systematic reviews per the journal's stated scope, but specific 2025 examples could not be retrieved.
- **Cell.com review articles** — not directly fetched; pattern inferred from Frontiers/PMC narrative reviews of similar editorial positioning, which is a known gap.
- **Annual Review of Biochemistry / Cell Biology** — only the journal homepage and metadata pages were accessible; no specific 2025 article methodology was confirmed.
- **GRADE downgrade-domain technical thresholds** — partially blocked (CDC handbook chapter 7 fetch returned high-level descriptions only; specific I² thresholds, OIS calculations, funnel-plot procedures live in chapters 8–10 not retrieved). The numbers in Part 2 (I² = 12 %, etc.) come from the actual SR fetches in B3 rather than from the GRADE handbook itself.

---

## TL;DR for the survey-methodology skill

Adopt the **PRISMA + GRADE + Cochrane** trio as the agent's methodology contract, not the Nature Reviews narrative model. The narrative model is unenforceable by construction — even when written by domain leaders it fails Greenhalgh's "cherry-pick" criticism, and an autonomous agent has no editorial reputation to substitute. The systematic-review stack succeeds *because* every step emits a discrete, checkable artifact, which maps cleanly onto Sisyphus's per-experiment directories and `notes/experiments.md` ledger pattern: pre-committed scope, design-tagged literature ledger, blind dual-screening via spawned reviewer agents, GRADE-tagged claims gating prose, and an honest "do-not-pool" predicate with explicit criteria.
