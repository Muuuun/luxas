# Interdisciplinary review methodology — protocols and cross-cutting patterns

Research brief for the `survey methodology` skill. Two clusters: (A) what top
interdisciplinary review venues actually do, and (B) what the methodology
literature explicitly enforces. Cluster B is the actionable core for an
autonomous agent.

---

## Cluster A — top interdisciplinary review venues, 2024-2026

### Editorial framing across venues

Top "narrative-style" review venues (Nature Reviews family, Annual Reviews,
Reviews of Geophysics, Science/Nature/PNAS Perspectives) share one striking
property: **none require a documented PRISMA-style search strategy.** Validity
rests on editorial gatekeeping — invitation-only commissioning, domain-expert
peer review — not on a reproducible-search audit trail.

Self-descriptions:

- **Nature Reviews (Physics, Earth & Environment)**: "A Review is an
  authoritative, balanced survey ... The scope of a Review should be broad
  enough that it is not dominated by the work of a single research institution
  and particularly not by the authors' own work."
- **Nature Reviews Physics Perspectives**: "more forward-looking and/or
  speculative ... opinionated [but should] remain balanced ... no more than
  100 references."
- **Reviews of Geophysics** is invitation-only; the proposal must include "an
  analysis of recent similar review articles" — niche/novelty enforced
  pre-invitation rather than via a search log.
- **Annual Reviews** publishes invited reviews averaging ~150 references; the
  editorial process is the quality control.

### Per-review brief (illustrative)

**Nature Reviews Earth & Environment, "Challenges and opportunities in scaling
enhanced weathering for CDR" (2025).** No PRISMA section. Disagreement and
negative space are surfaced narratively — "estimates are influenced by method
choice"; "substantial model–observation discrepancies in absorption,
deposition and radiative forcing estimates" — and the closing is dominated by
open problems (carbon-transfer tracking, MRV frameworks). Representative of
the venue: disagreement is narrated rather than tabulated, and original
synthesis figures (re-drawn process schematics, cross-study compilations) are
expected.

### Cross-cutting patterns in Cluster A

1. **Search comprehensiveness is not documented.** None of the surveyed venues
   require disclosure of databases queried, search strings, or screening
   yields. Comprehensiveness is asserted via author authority + peer review.
2. **Disagreement is handled, but qualitatively.** Top reviews surface
   model-observation gaps, conflicting estimates, and method-dependence. They
   rarely tabulate effect sizes; they narrate the disagreement and attribute it
   to mechanism (data, model, method choice).
3. **Original synthesis is expected.** Re-drawn process schematics, cross-study
   compilations, and concept maps are standard. This is the dimension where
   "review" overlaps with "perspective" — the review's value-add is the
   author's framing, not just citation aggregation.
4. **Open problems are foregrounded.** Nature Reviews and Reviews of Geophysics
   reviews almost universally end with explicit "open questions" or "outlook"
   sections; the negative space is treated as a deliverable, not an admission.
5. **Authority + balance over auditability.** The validity argument is
   "invited expert + balanced + non-self-promoting," not "reproducible search."
   This is exactly the regime that Cluster B was designed as a corrective to.

---

## Cluster B — what systematic protocols ENFORCE that narrative reviews skip

This is the actionable section. The protocol literature converges on a small
set of mandatory steps. An autonomous agent can directly check off whether each
is satisfied.

### B.1 Definitions in one sentence each

- **Narrative review.** Author-driven synthesis with no requirement to document
  search, eligibility, or selection. Validity rests on author expertise and
  editorial gatekeeping.
- **Scoping review.** Maps breadth of evidence; uses a transparent search +
  charting protocol but **does not** appraise study quality. Built on the
  Arksey & O'Malley five stages; reported via PRISMA-ScR.
- **Systematic review.** Pre-specifies a protocol (PICO, search strategy,
  inclusion/exclusion, risk-of-bias tool) before data collection; reports per
  PRISMA 2020.
- **Umbrella review (overview of reviews).** Synthesizes multiple existing
  systematic reviews on a related question; primary unit of evidence is the
  systematic review itself; quality of included reviews assessed via
  AMSTAR 2.
- **Rapid review.** Systematic-review methodology with **explicitly declared
  shortcuts** (single-screener, single extractor, narrower databases) and
  declared trade-offs.

### B.2 The short-form PRISMA 2020 protocol — what 10 steps it actually requires

PRISMA 2020 is a 27-item reporting checklist over seven sections (Title,
Abstract, Introduction, Methods, Results, Discussion, Other information). The
load-bearing items, distilled to a workflow:

1. **Pre-register the protocol** (Item 24a): "Provide registration information
   for the review, including register name and registration number, or state
   that the review was not registered." Any later changes must be reported
   under Item 24c: "Describe and explain any amendments to information provided
   at registration or in the protocol."
2. **State the PICO/PECO/PICOS question** (Item 4): "use the Population,
   Intervention, Comparator, Outcome (PICO) framework or one of its variants."
3. **Specify eligibility criteria** (Item 5): "Specify all study
   characteristics used to decide whether a study was eligible." Distinguish
   "outcomes that were unmeasured versus unreported."
4. **Document information sources** (Item 6): databases, registers, websites,
   organizations, and the **dates each was searched**.
5. **Publish the full search strategy** (Item 7): "Provide the full line by
   line search strategy as run in each database" plus any limits and any
   peer-review of the search (e.g. PRESS checklist).
6. **Dual-reviewer screening with documented disagreement resolution** (Items
   8-9): how many reviewers, working independently, and conflict resolution.
7. **Risk-of-bias assessment** (Item 11): "Specify the tool(s) (and version)
   used to assess risk of bias" — methodological domains, whether overall
   judgments were made, number of independent reviewers.
8. **Synthesis methods** (Items 13a-f): pre-specify how studies will be
   grouped, what statistical methods (or non-statistical synthesis) will be
   used.
9. **Certainty of evidence assessment** (Items 15 and 22, new in PRISMA 2020):
   typically via GRADE.
10. **Report the PRISMA flow diagram + competing interests + data/code
    availability** (Items 16, 26, 27 — last is new in 2020): "indicate whether
    data, analytic code and other materials used in the review are publicly
    available."

The structural shift from PRISMA 2009 to PRISMA 2020: addition of (a) protocol
amendment reporting, (b) certainty-of-evidence reporting, (c) competing
interests, (d) data/code availability. The 2020 update was motivated because
"many innovations in the conduct of systematic reviews have occurred since
publication of the PRISMA 2009 statement ... To capture these advances in the
reporting of systematic reviews necessitated an update."

### B.3 The inclusion-protocol pattern — PICO and its variants

PICO is the load-bearing pre-registration object. Variants:

- **PICO** — Population, Intervention, Comparator, Outcome (clinical
  effects).
- **PECO** — Population, Exposure, Comparator, Outcome (epidemiology /
  environmental health where there is no intervention).
- **PICOS** — adds Study design as the explicit eligibility filter; "useful to
  tailor your eligibility criteria to a specific set of study designs, geared
  towards the evidence levels needed in the review."
- **PICo** (qualitative) — Population, phenomenon of Interest, Context.
- **CIMO**, **SPIDER**, **SPICE** — used in management, qualitative, and
  policy reviews respectively.

Cochrane distinguishes three **levels** of PICO: the Review PICO (eligibility
filter), the Comparison PICO (synthesis grouping), and the Included Study PICO
(per-study attributes). Pre-registering the Review PICO is what closes the
"cherry-picking" failure mode in B.5.

### B.4 Risk of bias — how it is operationalized

The current Cochrane standard is **RoB 2**, structured into five domains
(Cochrane Handbook chapter 8):

1. "bias arising from the randomization process"
2. "bias due to deviations from intended interventions"
3. "bias due to missing outcome data"
4. "bias in measurement of the outcome"
5. "bias in selection of the reported result"

Each domain is operationalized via **signaling questions** with response
options "Yes / Probably yes / Probably no / No / No information." The Handbook
explains that signaling questions "aim to provide a structured approach to
eliciting information relevant to an assessment of risk of bias." An algorithm
maps the signaling-question responses to one of three judgments — **"Low risk
of bias," "Some concerns," "High risk of bias"** — though assessors may
override with documented justification. For non-randomized studies the
parallel tool is ROBINS-I; for systematic reviews themselves, AMSTAR 2.

The actionable abstraction for an autonomous agent: do not produce a binary
"good study / bad study" judgment. Decompose into domains, answer
domain-specific signaling questions, then apply a documented mapping rule.

### B.5 Documented failure modes of narrative reviews

Direct quotes:

- **Cherry-picking**: narrative reviews "do not follow a systematic search
  strategy, which can make them prone to selection bias"; authors "might
  'cherry pick' certain primary research to bolster a certain opinion."
- **Confirmation bias**: "authors may inadvertently focus on literature that
  supports their own hypotheses or perspectives."
- **Irreproducibility**: "narrative reviews are typically less reproducible
  ... because they do not follow a specific set of procedures."
- **Inconsistent conclusions**: empirical comparisons show "narrative reviews
  including same studies reached different conclusions against each other."
- **No quality appraisal**: "they also generally lack formal quality
  assessment of included studies."

**Counterpoint** (Greenhalgh et al., "Time to challenge the spurious hierarchy
of systematic over narrative reviews"):

- "The term 'systematic' is thus by no means synonymous with 'high-quality.'"
- Systematic reviews "privilege only that which is common ... amongst a
  rigidly defined subset of the available body of work."
- Mechanical systematic reviews can produce "aggregations of findings" that
  add "limited value" and risk "legitimising ... a narrow and unexciting
  research agenda."
- High-quality narrative review still has obligations: "the author ... must
  authentically represent ... both the underpinning evidence ... and how this
  evidence has been drawn upon"; analysis should be "perspectival, with the
  interpreter transparently positioned."

Implication: even narrative reviews owe (i) explicit positioning of the
interpreter, (ii) explicit account of how evidence was selected, (iii)
explicit acknowledgement of evidence not selected.

### B.6 Scoping vs umbrella vs rapid — methodological deltas

**Scoping review (Arksey & O'Malley five stages, enhanced by Levac et al. and
JBI; reported via PRISMA-ScR, 20 essential + 2 optional items, Tricco et al.
2018):**

1. Identifying the research question.
2. Identifying relevant studies.
3. Study selection.
4. Charting the data (formal data-charting form).
5. Collating, summarizing, and reporting results.
6. (Optional, recommended by Levac/JBI) Stakeholder consultation.

Distinguishing feature: scoping reviews "are generally conducted to provide an
overview of the existing evidence regardless of methodological quality or risk
of bias. Therefore, the included sources of evidence are typically not
critically appraised." Use when "the paucity of randomized controlled trials
makes it difficult for researchers to undertake systematic reviews," when
mapping a heterogeneous emerging field, or to scope whether a full systematic
review is warranted.

**Umbrella review.** "An umbrella review is a cluster of existing systematic
reviews on a shared topic, also known as an overview of reviews. An umbrella
review's most characteristic feature is that this type of evidence synthesis
only considers for inclusion the highest level of evidence, namely other
systematic reviews and meta-analyses." Use when "numerous systematic reviews
exist on related topics" or when "rapid high-quality evidence is needed for
policy decisions." Quality assessment of included reviews via **AMSTAR 2**.
Note the open methodological problem: handling **overlap** between included
systematic reviews (same primary studies counted more than once).

**Rapid review** (Cochrane Rapid Reviews Methods Group, 26-recommendation
interim guidance). Explicitly trades rigor for speed. Allowed shortcuts,
provided they are declared:

- "screen a proportion (e.g., 20%) of records dually at the title/abstract
  level until sufficient reviewer agreement is achieved, then proceed with
  single-reviewer screening";
- single-reviewer full-text screening;
- "single-data extraction only on the most relevant data points";
- "single-risk of bias assessment on the most important outcomes."

Accepted trade-off: "shortcuts may come with increased risk (e.g., missing one
or more relevant studies, increasing data extraction errors). Therefore,
piloting the steps of the review process with the team members that will
perform them is essential in rapid reviews."

### B.7 GRADE — certainty of evidence

GRADE (Grading of Recommendations Assessment, Development and Evaluation) is
the dominant framework for the certainty-of-evidence requirement (PRISMA 2020
items 15 and 22). Key properties:

- Certainty defined as "the certainty that the true effect, accuracy measure,
  or association lies on one side of a particular threshold, or in a particular
  range."
- Four-level rating: **High / Moderate / Low / Very low.**
- RCTs start at High; non-randomized studies start at Low.
- Rating is **down-graded** for: risk of bias, inconsistency, indirectness,
  imprecision, publication bias.
- Rating may be **up-graded** for non-randomized evidence with: large effect,
  dose-response, plausible confounding that would reduce the observed effect.

The agent-actionable kernel: do not summarize a body of evidence as merely
"strong/weak." Instead, anchor on study design, then explicitly enumerate the
five down-grading factors and any up-grading factors.

### B.8 The minimum auditable-review checklist (synthesized)

If the agent is producing or auditing a review, the following 10 items are the
intersection of PRISMA 2020, Cochrane, JBI, and PRISMA-ScR. They apply with
known relaxations to scoping (skip risk of bias) and rapid (declare shortcuts)
reviews; they are non-negotiable for systematic reviews; and Greenhalgh argues
several of them (1, 2, 5, 9) should hold even for narrative reviews.

1. **Pre-registered protocol** (or, for narrative, an explicit positioning
   statement of the author's stance and selection logic).
2. **Pre-specified question** in PICO/PECO/PICOS form.
3. **Explicit eligibility criteria** distinguishing measured-but-excluded vs
   not-measured.
4. **Documented search**: databases, dates, full search strings, peer review
   of the search.
5. **Documented selection**: screener count, dual-screening policy, conflict
   resolution.
6. **Risk-of-bias / quality appraisal** at study level (RoB 2 / ROBINS-I /
   AMSTAR 2) with documented domain-level judgments. Skipped in scoping
   reviews; declared-as-skipped in rapid reviews.
7. **Pre-specified synthesis plan** (statistical model, subgroup/sensitivity
   analyses, or non-statistical synthesis approach).
8. **Disagreement handling** explicit — between studies, between reviewers,
   between included reviews (in umbrella reviews).
9. **Certainty-of-evidence rating** (GRADE).
10. **PRISMA flow diagram + protocol amendments + competing interests +
    data/code availability statement.**

### B.9 Where Cluster A and Cluster B diverge — the actionable summary

| Dimension                         | Top narrative reviews (Cluster A)         | Systematic-review protocols (Cluster B) |
| --------------------------------- | ----------------------------------------- | --------------------------------------- |
| Search documented                 | No                                        | Yes (line-by-line)                      |
| Pre-registered protocol           | No                                        | Yes (PROSPERO, OSF)                     |
| Eligibility criteria             | Implicit                                  | Pre-specified (PICO/PECO)               |
| Risk-of-bias appraisal            | No (relies on author judgment)            | Yes (RoB 2 / ROBINS-I / AMSTAR 2)       |
| Certainty-of-evidence rating      | No                                        | Yes (GRADE)                             |
| Disagreement handling             | Narrative                                 | Statistical + tabular                   |
| Original synthesis figures        | Yes (expected)                            | Optional                                |
| Open-problems section             | Yes (expected)                            | Often present, less foregrounded        |
| Validity argument                 | Author authority + editorial gatekeeping  | Auditable, reproducible workflow        |

The actionable lesson for the skill: the agent should choose review type
**explicitly** based on goal (mapping vs effect-estimation vs synthesizing
syntheses vs urgent decision support), and then commit to the corresponding
protocol — not mix-and-match. A "narrative review" produced by an autonomous
agent without author authority inherits all of Cluster B's failure modes
(cherry-picking, confirmation bias, irreproducibility) without inheriting the
editorial-gatekeeping defenses, so the agent's default should be at minimum
PRISMA-ScR-grade documentation even when producing a narrative-style output.

---

## Sources

Cluster A:
- Nature Reviews Earth & Environment, https://www.nature.com/natrevearthenviron/
- Nature Reviews Earth & Environment 2025 enhanced weathering review, https://www.nature.com/articles/s43017-025-00713-7
- Nature Reviews Physics, https://www.nature.com/natrevphys/
- Annual Reviews, https://www.annualreviews.org/
- Reviews of Geophysics, https://agupubs.onlinelibrary.wiley.com/journal/19449208

Cluster B:
- PRISMA 2020 statement (Page et al.), https://pmc.ncbi.nlm.nih.gov/articles/PMC8007028/
- PRISMA 2020 explanation and elaboration, https://pmc.ncbi.nlm.nih.gov/articles/PMC8005925/
- PRISMA 2020 checklist, https://www.prisma-statement.org/prisma-2020-checklist
- PRISMA-ScR (Tricco et al. 2018), https://pubmed.ncbi.nlm.nih.gov/30178033/
- Cochrane Handbook, ch. 8 (RoB 2), https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-08
- Arksey & O'Malley framework + Levac enhancement, https://pmc.ncbi.nlm.nih.gov/articles/PMC2954944/
- Cochrane Rapid Reviews Methods Group, https://pmc.ncbi.nlm.nih.gov/articles/PMC7557165/
- Umbrella reviews methodology, https://pmc.ncbi.nlm.nih.gov/articles/PMC9884555/
- GRADE Working Group, https://www.gradeworkinggroup.org/ ; clarification paper, https://pmc.ncbi.nlm.nih.gov/articles/PMC6542664/
- Greenhalgh et al. "Time to challenge the spurious hierarchy", https://pmc.ncbi.nlm.nih.gov/articles/PMC6001568/
- Why systematic rather than narrative review, https://pmc.ncbi.nlm.nih.gov/articles/PMC4504929/
- Ioannidis 2005, https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0020124
- PICO/PECO/PICOS, https://pubmed.ncbi.nlm.nih.gov/32253195/ ; https://www.cochranelibrary.com/about-pico
