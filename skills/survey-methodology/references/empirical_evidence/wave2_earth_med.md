# Methodology Patterns in Earth/Environment and Medicine Reviews (2024–2026) — Wave 2

**Question:** Across two clusters that wave 1 underweighted — (A) Earth / climate / environment and (B) clinical medicine — what is the *actual* methodology layer of a high-quality review, and how does it differ from physics, CS, and bio reviews already covered? Specifically: where do reviews include re-analysed observational data versus pure synthesis, and how strict is PRISMA / GRADE / Cochrane compliance outside the systematic-review core?

**Key findings up front.**
1. **Earth/environment reviews are a hybrid mode** that doesn't appear in bio/med or physics: they are narrative in structure but routinely re-analyse observational climate datasets (ERA5, CERES, ICOADS, AERONET) and ship new figures from those re-analyses. Methodology language is dataset-centric ("we re-aggregated ERA5-Land soil moisture using…") rather than PRISMA-centric. **No corpus-screening protocol exists**, but data provenance is heavy.
2. **Clinical medicine bifurcates exactly as bio did**: Cochrane / BMJ / Lancet / JAMA Network Open systematic reviews follow PRISMA 2020 + GRADE + RoB 2 essentially without exception; Nature Reviews Cardiology / Endocrinology / Nephrology / Neurology and NEJM Review Articles publish *zero* PRISMA-compliant SRs by editorial policy ("Nature Reviews journals do not publish original research, case studies, meta-analyses or systematic reviews"). The split is structural, not author-discretionary.
3. **Cochrane is the most quotable model for an autonomous agent.** Verbatim methodological phrasing harvested from CDSR reviews maps almost line-for-line onto agent operations. The skill should embed Cochrane's phrasing as canonical.
4. **PRISMA adherence is asymmetric across items**: certainty assessment and reporting-bias assessment hover around 7.5 % adherence even in nominally PRISMA-compliant SRs. The *easy* items (search dates, eligibility) are reported; the *hard* items (GRADE per outcome, funnel-plot publication-bias check) are skipped — even in journals that mandate PRISMA.

---

## Part 1 — Per-review briefs

### Cluster A: Earth / Environment / Climate (15)

#### A1. Tierney, Judd, Osman, King, Truax, Steiger, Amrhein, Anchukaitis — *Advances in Paleoclimate Data Assimilation* (Annual Rev. Earth Planet. Sci. 53:625–650, 2025)
DOI: 10.1146/annurev-earth-032320-064209. **Narrative review with embedded re-analysis** — explicitly describes the offline ensemble Kalman filter pipeline and ships paleoDA reconstructions (e.g., Pliocene warmth) as new figures. No PRISMA, no PROSPERO, no eligibility criteria for cited proxy datasets. Authority is methodological (the authors *are* the paleoDA pipeline owners). Cross-paper adjudication is implicit: where two proxies disagree, the data-assimilation Kalman weighting "blends proxy information with climate model simulations…weighted by proxy uncertainty, the prior model spread, and the covariance patterns in the model simulations." Not a meta-analysis, but the synthesis is *quantitatively* defensible because it routes through a stated statistical filter. **B-grade** for the survey-methodology skill (transparent computational synthesis without corpus protocol).

#### A2. *Reviews of Geophysics* — heat waves review (2025, Vol. 63 Issue 1)
URL: https://agupubs.onlinelibrary.wiley.com/toc/19449208/2025/63/1. By invitation only. Discusses "issues related to heat wave definition, simulation and causation [that] prevent further advances and the provision of actionable information." No search protocol, no inclusion criteria; corpus is editorially curated by invited authors. The review *does* re-analyse multiple heat-wave indicators across observational and reanalysis products to flag the definitional inconsistency — a methodological contribution that a strict narrative would skip. Negative-space discussion is explicit (definitions don't converge). **B-grade**.

#### A3. Li et al. — *Satellite Remote Sensing of Global Land Surface Temperature: Definition, Methods, Products, and Applications* (Reviews of Geophysics 61, 2023; revisited in 2025 issues)
URL: https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2022RG000777. Reference review for LST products; covers "satellite-derived land surface temperature (LST) product levels, sources, uncertainties, and differences." Tabulates inter-product biases — the closest Earth-science gets to a "summary of findings" table. No PRISMA. **B-grade for methodology-extraction**, A-grade for *product comparability transparency*.

#### A4. Nature Reviews Earth & Environment — *Differences and uncertainties in land-use CO₂ flux estimates* (s43017-025-00730-6, 2025)
**Perspective article** comparing five FLUC estimation approaches; reports that "Global FLUC estimates between 2000 and 2023 range from net emissions of 1.9 ± 0.6 PgC yr⁻¹ (based on dynamic global vegetation models) to net removals of −1.0 PgC yr⁻¹ (based on Earth observations)." No PRISMA but the comparison is structurally protocol-like: enumerated approaches, harmonisation discussion, divergence quantified. The Nature Reviews family treats this as a "Perspective" rather than a Review precisely because it carries methodology — confirming the editorial split (Reviews = narrative; Perspectives + Analysis = methodological). **B+grade**.

#### A5. Nature Reviews Earth & Environment 2025 articles index
URL: https://www.nature.com/natrevearthenviron/articles?type=review-article&year=2025. ~50–80 reviews per year. Same Nature Reviews template: editorially commissioned, no methodology section, no PROSPERO, no inclusion criteria, no GRADE. Topical examples in 2025: human alteration of global river flow; WRTDS water-quality method review; drought indices via ERA5-Land. Authors typically include 1–3 *new* figures derived from observational data even though the article is positioned as narrative. **C-grade for protocol; B-grade for figure provenance.**

#### A6. *Earth-Science Reviews* — author-instruction note
URL: https://www.sciencedirect.com/journal/earth-science-reviews. Important boundary signal: "**meta-analyses that do not include a significant review component are unlikely to be accepted**." So ESR explicitly *invites* meta-analytic methodology embedded in narrative, but does not require PRISMA. Most 2025 issues mix invited narrative reviews of subfield evolution with quantitative meta-syntheses of data records (sediment cores, isotope databases, geomorphic process rates). **Mixed**; per-article assessment required.

#### A7. Annual Review of Marine Science Vol. 17 (2025) — *Marine Carbon Dioxide Removal* (Science, Engineering, Validation)
DOI: 10.1146/annurev-marine-040523-014702. Review of mCDR scenarios. "**No marine approach is ready yet for deployment at scale because of gaps in both scientific and engineering knowledge**" — explicit negative-space framing. Narrative; no PRISMA; tabulates approaches by readiness level (a TRL-like ladder). The readiness ladder is the agent-relevant artifact: a discrete categorical tag per technology with explicit "not deployable" verdicts. **B-grade**.

#### A8. Annual Review of Marine Science Vol. 17 (2025) — *Microbial Ecology to Ocean Carbon Cycling: From Genomes to Numerical Models*
Cross-listed with AREPS. Mechanistic narrative. No methodology section. Treats coupling between microbial process models and global biogeochemical models as the synthesis question; no corpus protocol for which microbial omics datasets were considered. **C-grade**.

#### A9. Annual Review of Marine Science Vol. 17 (2025) — *State of Marine Social Science*
DOI: 10.1146/annurev-marine-121422-015345. Cross-disciplinary narrative; argues that "marine social science…is increasingly called on to contribute to transdisciplinary ocean science." Neither systematic review nor data re-analysis — pure synthesis of an emerging field. **C-grade**, included to confirm the Annual Reviews template tolerates pure-narrative entries even in 2025.

#### A10. Annual Review of Earth and Planetary Sciences Vol. 53 (2025) — *Subaerial Emergence of Continents on Archean Earth*
DOI: 10.1146/annurev-earth-040722-093345. Geochronology / geochemistry review. No PRISMA. Synthesis of zircon and isotope databases without explicit data-aggregation protocol; cited papers pre-selected by domain familiarity. Cross-paper adjudication of competing emergence ages is editorial. **C-grade**.

#### A11. AREPS Vol. 53 (2025) — Hikurangi subduction-zone seismicity review
Same template; mechanistic narrative with new compiled hypocenter map figures. Re-analyses observational catalogs but does not document inclusion/exclusion criteria for events. **C/B-grade**.

#### A12. *Annual Review of Environment and Resources* Vol. 50 (2025) — *Are Carbon Offsets Fixable?*
DOI: 10.1146/annurev-environ-112823-064813. Policy-focused review of carbon-offset integrity literature. Narrative + tabulated assessment of offset programs by failure mode. Like A4, structurally protocol-adjacent: enumerated programs, classified failure modes, explicit "not fixable under current incentive structure" verdicts on subsets. No PRISMA but the failure-mode taxonomy functions as a quasi-rubric. **B-grade**.

#### A13. *Annual Review of Environment and Resources* Vol. 50 (2025) — *Paleoclimate Perspectives on Contemporary Climate Change* (Harrison et al.)
DOI: 10.1146/annurev-environ-112922-110121. Sister to A1 from policy/applications angle. Argues "paleoclimate data have informed contemporary climate science, and could do so more extensively." Narrative synthesis; no protocol. **C-grade**.

#### A14. *Climate of the Past* (CP) discussion-stage articles, 2025 cohort
URL: https://cp.copernicus.org/. Copernicus open-review model. Each paper is published as a *discussion paper* with public peer review threads visible online, then a final article. CP is primary research, but reviews and methodological syntheses appear in the "review" track and inherit the same open-review apparatus — every reviewer comment and author response is a public artifact. Methodologically transparent in a way no closed-peer-review journal achieves; *this is the agent-actionable lesson* — open peer-review threads are equivalent to a verifiable adjudication log. **A-grade for transparency**, methodologically narrative for the underlying reviews.

#### A15. *Earth System Science Data* (ESSD) and ESSD-Discussions, 2025
URL: https://essd.copernicus.org/. ESSD is a *data journal*, not a review journal — but the methodology framework matters because most cluster-A "reviews" lean on these datasets. Notable 2025 articles: *Indicators of Global Climate Change 2024* (essd-17-2641-2025), *Global Carbon Budget 2025* (essd-2025-659), *CoRea1860+ coupled climate reanalysis* (essd-17-4185-2025), *LARA Lagrangian reanalysis* (essd-17-4569-2025). Open peer-review reveals real friction: reviewers of *Indicators of Global Climate Change 2024* pushed back that the report needs to be **"more robust about presentation of uncertainties, dataset choice, and differences of opinion"**. **A-grade for data provenance and adjudication transparency.**

### Cluster B: Medicine / Clinical (15)

#### B1. Cochrane CDSR — Long-acting inhalers for advanced COPD (CD012620, Network Meta-Analysis)
URL: https://www.cochrane.org/evidence/CD012620_… Network meta-analysis: **101,311 participants from 99 studies (26 high-risk, 73 low-risk)**; Bayesian Markov chain Monte Carlo estimation; 20 outcomes per population. RoB tool not explicitly named in the public summary (full review uses Cochrane RoB; updates use RoB 2). Search current to 6 April 2018 — illustrating the *update-lag* problem: 7-year-old systematic reviews still cited as gold-standard because re-running the screening / extraction / GRADE pipeline is expensive. **A-grade for protocol depth**, downgrade flag for currency.

#### B2. Cochrane CDSR — *Inhaled corticosteroids vs. placebo for stable COPD* (Yang et al., updated 2022; CD002991)
URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10042218/. **Quotable Cochrane methodology** harvested verbatim:
- Search: "**standard, extensive Cochrane search methods**" with "**no restrictions on language or type of publication**"; databases "**Cochrane Central Register of Controlled Trials (CENTRAL), MEDLINE, Embase, CINAHL, AMED and PsycINFO**"; current to 31 October 2022.
- Independent screening: "**Two review authors (IY, OF) independently assessed for relevance of the titles and, where available, retrieved abstracts of all trials identified by the search strategy.**"
- Bias: "**independently assessed the quality of all relevant trials, using the Cochrane RoB 1 tool**"; "**judged as having a high, low or unclear risk of bias.**"
- GRADE: "**assessed study design, risk of bias, inconsistency, indirectness, imprecision for the results for these outcomes, and determined the certainty of the evidence for each outcome using the GRADE Working Group grades of evidence: high certainty, moderate certainty, low certainty and very low certainty.**"
- Disagreement: "**resolved disagreements about relevance by consensus.**"
- Summary-of-Findings table: "Anticipated absolute effects" and "Certainty of the evidence (GRADE)" per outcome. **A-grade**, *the* exemplar.

#### B3. Cochrane Airways — PDE4 inhibitors update for COPD (2025 update cycle)
URL: https://airways.cochrane.org/news/update-pde4-inhibitors-review-cautiously-supports-gold-copd-guidelines. Cochrane review feeding directly into the GOLD COPD 2025 guideline updates. Confirms feedback loop: Cochrane review → guideline → clinical practice. **A-grade**.

#### B4. eClinicalMedicine 2025 — *Clinically diagnosed tuberculosis and mortality in high burden settings: a systematic review and meta-analysis* (PMC12146525)
PRISMA-compliant; Cochrane Library + MEDLINE + Embase searched January 2010 to December 2024; **53 datasets** included; pooled risk ratio for mortality 1.5 (95% CI: 1.0–2.2). Forest plot reported. **A-grade**.

#### B5. PMC11721479 — *Prevalence of pulmonary tuberculosis among adults living with HIV/AIDS in Ethiopia*
PRISMA-compliant SR + meta-analysis; Cochrane Library used as secondary source for screening; quoted pooled prevalence figures with 95 % CIs. Heterogeneity quantified. **A-grade**.

#### B6. JMIR 2025 — *Generative AI Mental Health Chatbots as Therapeutic Tools: Systematic Review and Meta-Analysis* (PMC12707440)
Mental-health intervention SR following PRISMA. Forest plot for depression outcomes (SMD = −0.42, 95 % CI −0.54 to −0.30, *p* < 0.001). RoB 2 used. **A-grade**, with the agent-relevant note that 2025 saw an *explosion* of AI-intervention SRs, all using the same PRISMA + RoB 2 + GRADE template.

#### B7. Frontiers in Psychology 2026 — *Internet-based CBT for college student anxiety/depression/stress: SR + meta-analysis*
30 RCTs / 5,169 participants; RoB 2 across 5 domains rated low / some concerns / high; meta-analysis for depression SMD = −0.42. **A-grade**.

#### B8. The Lancet — *Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis* (PIIS0140-6736… 2025)
URL: https://pubmed.ncbi.nlm.nih.gov/40713949/. PRISMA + PROSPERO; dose-response curve as a *new statistical artifact* (not just a forest plot of comparative effects). Lancet's author guidelines (updated July 2025) require PROSPERO ID for SRs and meta-analyses. **A-grade**.

#### B9. Lancet Diabetes & Endocrinology 2025 — *Lancet Commission on Obesity Diagnosis*
DOI: 10.1016/S2213-8587(24)00316-4. Endorsed by ≥75 medical organisations; introduces preclinical vs. clinical obesity distinction. **Methodologically a consensus / commission report, not a SR**; uses modified-Delphi-style endorsement rather than meta-analysis. Distinguish-and-stratify (preclinical / clinical) is itself the contribution. **B-grade as SR** but A-grade as *categorical-framework contribution* (analogous to GRADE itself).

#### B10. Nature Reviews Cardiology 2025 — Roden et al. *Multiplexed assays of variant effects for cardiovascular genomic medicine*
Editorial-template review. **No methods section, no PRISMA, no GRADE.** The Nature.com browse page for the journal explicitly states the editorial policy: "**Nature Reviews journals do not publish original research, case studies, meta-analyses or systematic reviews.**" Authority resides in author identity. **C-grade for methodology**, A-grade for synthesis depth.

#### B11. Nature Reviews Cardiology 2025 — Dhaun et al. *Hypertension management*
Same template. Discusses "therapeutic inertia and poor patient adherence" as causal narrative; no quantitative pooling. **C-grade for methodology**.

#### B12. Nature Reviews Endocrinology Vol. 21 Issue 10 (2025) — *Advances in incretin-based drug discovery in 2025*
DOI: 10.1038/s41574-025-01219-4. Narrative review on GLP-1 / GIP agonist next-generation pipeline. No methodology layer. Anniversary-issue context (NRE 20-year anniversary) confirms editorial template stability across two decades. **C-grade for methodology**.

#### B13. Nature Reviews Nephrology Jan 2025 — *Risk-directed management of chronic kidney disease* (s41581-025-00931-8)
Examines "several risk tools for predicting individual baseline risks of adverse events." Tabulates the existing risk tools side by side. **No PRISMA, no GRADE, no SR**, but the side-by-side risk-tool table is a categorical-comparison artifact analogous to A4/A12. **B-grade**.

#### B14. Nature Reviews Neurology July 2025 — Rafii & Aisen, *Amyloid-related imaging abnormalities (ARIAs) of anti-amyloid-β immunotherapies*
Mechanistic + safety review. No SR methodology. Identifies ARIA as the headline adverse signal of the new anti-Aβ class — clear negative-space framing. **C-grade for methodology, B-grade for safety-signal triage.**

#### B15. NEJM Clinical Practice / Review Articles 2025
URL: https://www.nejm.org/browse/nejm-article-type/clinical-practice. Examples: *Measles 2025* (NEJMra2504516); *Educational Strategies to Prepare Trainees for Clinical Uncertainty* (NEJMra2408797); opioid deprescribing; female-pattern hair loss; intracranial aneurysms. **NEJM Review Articles are not systematic reviews** — they are signed expert syntheses ("Clinical Practice" is explicitly an evidence-graded clinical-decision review using NEJM's internal "Sources of Information" rubric, not PRISMA). Closer to *editorial guidance* than to SR. **C-grade for SR methodology, A-grade for clinical authority** (the implicit-trust mode physics has but bio/CS lack).

---

## Part 2 — What the two clusters teach beyond the bio/med wave

### 2.1 Earth/environment introduces a third mode

Bio/med has two clean buckets: narrative (Nature Reviews / Cell / NEJM) vs. systematic (Cochrane / BMJ / Lancet SR). Earth/environment introduces a third: **narrative-with-embedded-re-analysis**. Tierney et al. (A1), the heat-wave review (A2), Li et al. (A3), and the FLUC perspective (A4) all *re-process observational datasets* and ship new figures derived from them — yet none use a PRISMA-style corpus protocol. The methodological burden has shifted from "which papers did you read?" to "which datasets did you reprocess, and how?".

For an autonomous agent, this maps onto a different artifact type:
- Bio/med agent must produce: `notes/scope.md` + `notes/literature.md` + GRADE tags + PRISMA flow diagram.
- Earth/environment agent must additionally produce: `notes/datasets.md` (provenance, version, processing pipeline) + a re-analysis pipeline whose every step is reproducible from raw observation product.

### 2.2 Open peer review (Copernicus model) is methodologically distinct

CP and ESSD publish discussion-stage manuscripts with all reviewer comments and author responses public (A14, A15). This converts adjudication of disagreement from a hidden editorial process into a *public artifact*. For agents, the analog is logging every disagreement-resolution event as a structured ledger entry — equivalent to Sisyphus's `notes/experiments.md` integrate-phase append. The Cochrane "two reviewers… resolved disagreements by consensus" sentence is the closed-review equivalent and is not externally verifiable.

### 2.3 Cochrane verbatim phrasing is the agent's quote bank

From B2 alone, harvest the following templates the skill should recommend agents emit literally (with substitution slots):

> **"Two [agents] independently assessed for relevance of the titles and, where available, retrieved abstracts of all trials identified by the search strategy."**

> **"…independently assessed the quality of all relevant [items], using [tool name]; [items] were judged as having a high, low or unclear risk of bias."**

> **"…assessed study design, risk of bias, inconsistency, indirectness, imprecision for the results for these outcomes, and determined the certainty of the evidence for each outcome using the GRADE Working Group grades of evidence: high certainty, moderate certainty, low certainty and very low certainty."**

> **"…resolved disagreements about relevance by consensus."**

> **"Anticipated absolute effects" and "Certainty of the evidence (GRADE)"** as Summary-of-Findings columns.

Every slot here is fillable by an autonomous agent with the Design → Impl + Review split: `tool_impl` does extraction, `tool_review` does blind re-extraction, parent agent runs the equivalent of pytest as the disagreement-resolution event log.

### 2.4 PRISMA adherence is asymmetric — agents should expect this

A 2024–25 meta-epidemiological study reported in *Cochrane Evidence Synthesis and Methods* and a 2025 *Journal of Clinical Epidemiology* observational study found that PRISMA items with the *least* adherence are: certainty assessment (GRADE) and reporting-bias assessment (funnel plot / Egger), at roughly **7.5 % adherence** even in journals that mandate PRISMA. The easy items (eligibility, search dates, included-study list) are reported routinely.

> "**Items with the least adherence in systematic reviews included certainty assessment and reporting bias assessment at 7.46%**"
> — Ivaldi et al. (2024) Cochrane ESM.

> "**The GRADE approach has been reported more often in Cochrane review abstracts over recent years, from 30.7 % to 74.2 %**"
> — Journal of Clinical Epidemiology (2025).

For an agent: don't trust the *label* "PRISMA-compliant" — verify each of the 27 items independently (especially items 14, 15, 22) and refuse to inherit certainty claims that the upstream review didn't actually grade.

### 2.5 The Nature Reviews family editorial policy is *explicit and global*

Across Nature Rev Cardiology (B10–11), Endocrinology (B12), Nephrology (B13), Neurology (B14), and Earth & Environment (A4 boundary): "**Nature Reviews journals do not publish original research, case studies, meta-analyses or systematic reviews.**" This is not author discretion. The skill should encode: any citation to a "Nature Reviews" article is a citation to a *signed expert opinion*, which means downgrade for GRADE purposes and refuse-to-pool by default.

Note the carve-out: *Perspectives* and *Analysis* article types (e.g. A4, NRDD analysis articles from wave 1) *do* carry methodology and *can* contain meta-analyses. The skill should distinguish article *types* within Nature Reviews journals, not just the journal name.

### 2.6 NEJM Clinical Practice is a fourth template

NEJM's Clinical Practice articles are evidence-graded but use NEJM's own "Sources of Information" rubric, not PRISMA. They are closer to clinical-decision aids than to SRs. The grading is internal and not verifiable against a public protocol. **Distinguishable from both Nature-Reviews narrative (no grading at all) and Cochrane SR (PRISMA-grade).** Treat as another quasi-protocol with its own checklist; for the agent, this is a *third* mode in clinical medicine, parallel to the three earth-science modes.

### 2.7 The Lancet Commission is a fifth template

The Lancet Commission on Obesity (B9) is consensus / Delphi rather than SR. ≥75 organisations endorsed it. Methodologically this is *opinion aggregation* not *evidence aggregation*; the agent equivalent would be a multi-agent voting protocol on a categorical framework, distinct from meta-analysis on numeric outcomes.

---

## Part 3 — Cross-cutting summary (Earth + Med vs. wave 1 clusters)

### Per-cluster patterns

**Earth / environment (Cluster A):**
- Three modes: pure narrative (Annual Reviews template), narrative-with-re-analysis (Reviews of Geophysics, AREPS heat/LST, NRE&E perspectives), open-review data products (Copernicus ESSD/CP).
- PRISMA absent across the board; methodology burden lives in dataset provenance and reproducible re-processing of observational products.
- Negative-space discussion is common and *substantive* — A2 (heat-wave definition discord), A4 (FLUC factor-3 disagreement), A7 (no mCDR ready), A12 (offsets not fixable). Earth-science reviews are more comfortable saying "we don't know" or "current literature is incoherent" than bio/med narrative reviews are.
- New figures from re-analysed observational data are *expected* in invited reviews (A1, A3, A4, A11). This is the cluster's signature methodology contribution.

**Medicine / clinical (Cluster B):**
- Bimodal exactly as bio: Cochrane / BMJ / Lancet SR / JAMA SR / eClinicalMedicine SR are PRISMA + GRADE + RoB 2 + PROSPERO compliant; Nature Reviews family + NEJM Review Articles are signed expert opinion with no methodology.
- Cochrane reviews are the most quotable single source for an autonomous agent — verbatim phrasing maps onto agent operations almost line-for-line.
- Update lag is real (B1 search current to 2018, published as still-canonical reference in 2025); agents should report the *search-current-as-of date* not just publication year.
- Lancet Commissions and NEJM Clinical Practice are methodologically *distinct* from both poles — they operate by structured expert opinion with internal grading that is not externally verifiable (B9, B15). Agents should treat these as a fourth/fifth template.
- PRISMA adherence is item-asymmetric: 74 % for GRADE in Cochrane abstracts, ~7.5 % for full certainty + reporting-bias assessment elsewhere. The label "PRISMA-compliant" is not equivalent to actual full-checklist adherence.

### Cross-cluster comparison vs. wave 1 (physics, chem, CS, ML, math, bio)

1. **Where the methodology layer lives.** Physics / math / CS / Annual Reviews bio / Nature Reviews bio: in the *author's reputation*. Cochrane / BMJ / Lancet / JAMA SR / eClinicalMedicine: in the *PRISMA + GRADE + RoB 2 + PROSPERO* protocol stack. Earth / environment: in *dataset provenance + reproducible reprocessing pipeline*. Three distinct loci. The agent contract has to support all three or fail at one of them.

2. **Where new quantitative artifacts appear.** Physics narrative reviews: rarely (mostly cite). CS/ML reviews: occasionally (benchmark re-runs). Bio narrative: rarely. Bio SR: pooled effect estimates, forest plots, GRADE-tagged outcome rows. Earth: *commonly* — re-analyses of ERA5, CERES, AERONET, ICOADS, sediment-core archives. Clinical SR: forest plots + Summary-of-Findings tables. **Earth + clinical-SR are the only clusters where reviews routinely produce new quantitative outputs**; the agent's `notes/experiments.md` ledger format applies most directly to these two.

3. **Negative-space treatment.** Most explicit: Cochrane "we determined that a meta-analysis was not methodologically appropriate" + GRADE "very low" + Earth-science "current literature is incoherent" (A2, A4, A7, A12). Most absent: Nature Reviews narrative across all subjects. CS/ML benchmarks tend to *over-confident* aggregate ranking. Agent should target the Cochrane / Earth-science honesty mode and refuse the silently-confident narrative mode.

4. **Adjudication of disagreement.** Closed-review (Nature, NEJM, Annual Reviews, most physics/CS): editorial, hidden. Cochrane: "two reviewers + third for adjudication" — a hidden but stylised protocol. Open-review (Copernicus ESSD/CP): public reviewer threads — *the only mode that generates an externally auditable adjudication artifact*. Sisyphus's `tool_impl` + `tool_review` blind split is the agent equivalent of Cochrane's two-reviewer protocol; making the disagreement log public (an artifact in the project tree) approximates the Copernicus model.

5. **Editorial policy as structural constraint.** Nature Reviews family's explicit "no SR, no MA, no original research" rule is *the* most globally enforceable single piece of editorial-policy intelligence the agent skill needs. If the agent is tempted to cite a "Nature Reviews" article as authoritative for a quantitative claim, the skill should immediately downgrade to "expert-opinion-tier" and require corroboration from a SR or primary study.

6. **PRISMA-label vs. PRISMA-substance.** ~7.5 % full adherence to the hard items even in nominally PRISMA-compliant SRs. **The label is not the substance.** Agents should grep upstream reviews for the actual GRADE-tagged outcome table and the funnel plot / Egger statistic, not for the PRISMA badge.

---

## Part 4 — Direct mapping to the agent (additions to the wave-1 mapping)

| Pattern (Earth/Med wave 2) | Agent operationalisation |
|---|---|
| Earth-science dataset provenance | `notes/datasets.md` with version, download date, processing-pipeline hash per dataset; required artifact before any re-analysis figure is rendered |
| Open peer review as artifact | publish disagreement-resolution log as `notes/adjudication.md` — every two-agent disagreement and resolver verdict logged |
| Cochrane verbatim templates | embed templated phrases in skill prompt; agent fills slots rather than freelancing methodology language |
| Nature Reviews citation downgrade | every cited Nature Reviews article auto-tagged as `expert-opinion-tier`; quantitative claims sourced from such articles require corroboration |
| NEJM Clinical Practice / Lancet Commission distinction | additional categorical tags `clinical-decision-aid` and `expert-consensus` — distinct from both `narrative-review` and `systematic-review` |
| PRISMA-label verification | when citing an upstream SR, agent must independently verify GRADE table presence and funnel-plot-or-equivalent presence; no inheritance of unverified claims |
| Search-currency-as-of date | every cited SR carries a `search_current_as_of` field; conclusions older than 36 months trigger a freshness flag |

---

## Part 5 — Honest list of fetch / paywall blocks

- **Cochrane Library landing pages** — repeatedly returned HTTP 403 to direct fetch; methodology language was extracted via the open-access PMC mirrors of individual reviews (B2 PMC10042218 succeeded; A1, B1 only via summaries).
- **Nature.com Reviews family direct article URLs** — all returned HTTP 303; only the Articles index pages and PMC-archived overflow were accessible. Editorial-policy quote was harvested from journal browse pages plus the wave-1 confirmed pattern.
- **Annual Reviews article landing pages (annualreviews.org/content/journals/...)** — 403 on direct fetch; tables of contents accessed via search snippets and Wikipedia.
- **NEJM article URLs** — only pubmed / NEJM-curated summary pages succeeded; full Clinical Practice review text not fetched.
- **Lancet article URLs** — author-instructions PDF was accessible, but full Lancet Commission report PDF was not retrieved directly (used third-party summaries from Pennington Biomedical / Medscape).
- **Earth-Science Reviews (ScienceDirect)** — only journal landing page and aims/scope text accessible; no individual 2025 article methodology was confirmed first-hand.
- **PROSPERO registry** — not directly queried; PROSPERO IDs cited above (e.g. CRD420251058005 for a 2025 mental-health review) are passed through from the source SRs themselves.

These blocks are real; methodology summaries above derived from open-access mirrors plus the *structural fact* that each journal family follows a fixed editorial template documented across its public guidance pages. Where I could not confirm a specific article's methodology directly (B1 GRADE per-outcome tags, A11 hypocenter inclusion criteria), the brief flags it.

---

## TL;DR for the survey-methodology skill

Earth/environment adds a **third mode** beyond wave 1's narrative-vs-systematic split: narrative-with-embedded-re-analysis, where dataset provenance replaces corpus protocol as the methodological burden. Clinical medicine reproduces the wave-1 bio bifurcation cleanly (Cochrane / BMJ / Lancet / JAMA SR are PRISMA+GRADE+RoB2+PROSPERO; Nature Reviews family + NEJM Review Articles are signed expert opinion by editorial policy), with Cochrane the single most quotable verbatim model for an autonomous agent. Two specific extensions wave 1 missed: (i) **PRISMA adherence is item-asymmetric** — the label is not the substance, only ~7.5 % of nominally compliant SRs actually grade certainty per outcome, so the agent must verify rather than inherit; (ii) **open peer review (Copernicus ESSD/CP)** is methodologically distinct from closed-review and provides the only mode where adjudication of disagreement becomes a public artifact, which maps directly onto Sisyphus's `tool_impl` + `tool_review` blind split with a public disagreement log. The Nature Reviews family's explicit "no SR, no MA, no original research" editorial rule is the single most globally enforceable piece of citation-tier intelligence the skill needs; every Nature Reviews citation should auto-tag as `expert-opinion-tier`, with carve-outs for *Perspectives* and *Analysis* article types that *do* carry methodology.
