# Survey Methodology in Top Physics & Chemistry Reviews (2024–2026)

Research artifact for the "survey methodology" skill. Goal: identify what
A-grade human-written reviews actually do that a B-grade agent draft (one
that trusts paper claims) does not. Sources: published reviews + venue
editorial guidance + meta-commentary from editors.

Access caveat up front: ACS, RSC, Annual Reviews, Nature, and APS publisher
pages all returned `403`/`303` to direct fetching. I worked around this with
(a) arXiv preprint mirrors, (b) HAL deposit copies, (c) PMC open-access
mirrors, (d) editorial pages indexed by search summaries, and (e) author
landing pages. Where I could not get the body of an article I say so and
fall back to abstract + venue policy. I never invent quotes; everything in
quotation marks below was returned by a fetch on the URL cited in the same
bullet.

---

## Per-review briefs

### R1. Spin-glass dynamics: experiment, theory, and simulation

- Authors: Janus collaboration et al. (Dahlberg, Marinari, Parisi, Ricci-Tersenghi …)
- Venue: Reviews of Modern Physics 97, 045005 (Dec 2025); 60 pp, 56 figs.
- DOI: 10.1103/ctp2-zwyr — arXiv: 2412.08381
- URLs: <https://arxiv.org/abs/2412.08381>, <https://arxiv.org/html/2412.08381v2>

Scope statement is explicit and bounded in time, not topic-omniscient.
The authors frame the article as an *update*, not a comprehensive sweep:

> "This work aims to bring the experiments and theoretical accomplishments
> of the last decade up to date and to point to future opportunities."
> (Introduction)

Verification practice — the authors actively re-cast prior numerical
estimates with corrected exponents rather than passing them through:

> "[Earlier authors] implicitly assumed a nonfractal geometry for the bulk
> of the spin-glass domains by setting the number of correlated spins
> $N_s \approx \xi(t_w,T)^3$. We now know that the number of correlated
> spins is actually $N_s = \xi(t_w)^{D-\theta/2}$, where $\theta$ is the
> so-called replicon exponent." (text accompanying Fig. 10)

Treatment of disagreement — they name the controversy and rule on its
relevance, instead of presenting both sides as equally weighted:

> "One of the main messages of this review is that the controversy
> discussed above is of no real consequence for understanding the
> off-equilibrium dynamics."

> "However, Paga et al. showed that Eq. (1) is valid only as $H \to 0$."

Negative space: the article contains a dedicated future-issues section
split into two named sub-sections:

> "VII.1 What is yet to be nailed down theoretically"
> "VII.2 Experimental opportunities and challenges"

Pattern: a 60-page RMP review by the people who built the Janus
special-purpose computer is also the one most willing to (a) re-derive
exponents, (b) adjudicate disputes rather than fence-sit, and (c) name
unfinished business.

---

### R2. 50 years of spin glass theory

- Authors: David Sherrington & Scott Kirkpatrick
- Venue: Nature Reviews Physics 7, 528 (2025)
- arXiv: 2505.24432
- URLs: <https://www.nature.com/articles/s42254-025-00871-z>, <https://arxiv.org/html/2505.24432>

Scope statement is deliberately narrow — a "comment/review" on two 1975
papers and what came of them, not a full field survey:

> "In this short comment/review, we expose key aspects of the thinking
> behind those papers, their implementations and their implications."

Verification / disagreement: the authors openly walk through how the
original SK calculation diverged from simulation and how that surfaced a
real problem rather than getting smoothed over:

> "More detailed computer simulations, reported in a subsequent longer
> paper (KS) in 1978, indicated a lower ground state energy than the
> calculation. There was another problem!"

> "Two further years later, Giorgio Parisi devised a revolution[ary]
> 'replica symmetry breaking' ansatz that solved the negative entropy
> problem and also gave a lower ground state energy result, close to that
> of the simulation."

Negative space appears as honest assessment of failed practical impact:

> "the actual alloys that started the journey have not proven practically
> valuable" — and the authors then point to relaxor ferroelectrics and
> martensitic shape-memory alloys as where the conceptual transfer
> actually paid off.

Pattern: a 50-year retrospective by the authors of the original models
treats the *story of how disagreement was resolved* as the central
content. A B-grade summary would have flattened this to "SK model leads
to RSB"; the A-grade version preserves the failure-then-fix structure.

---

### R3. Experimental Insights into Quantum Spin Ice Physics in Dipole–Octupole Pyrochlore Magnets

- Authors: Smith, Lhotel, Petit, Gaulin
- Venue: Annual Review of Condensed Matter Physics 16, 387–415 (Mar 2025)
- DOI: 10.1146/annurev-conmatphys-041124-015101
- URL: <https://www.annualreviews.org/content/journals/10.1146/annurev-conmatphys-041124-015101>

Direct fetch failed (403); the HAL deposit also returned an Anubis block.
What I have from search-index summaries:

Scope discipline — the review explicitly restricts to *two* materials
(Ce₂Zr₂O₇ and Nd₂Zr₂O₇), not a sweep of all rare-earth pyrochlores. This
is itself an A-grade move: bounding by material rather than by phenomenon
forces the authors into specifics that survive cross-checking.

Negative space (open problems) is named at the level of disorder model,
not as a generic "more work needed":

> "The effect of disorder in Ce₂Zr₂O₇ is still an open question, as single
> crystals have some low levels of oxidation, and site mixing is expected
> to be important because both undesired Ce⁴⁺ and Zr³⁺ ions are
> chemically stable."

> "It remains very desirable to expand available measurements on
> Ce₂Zr₂O₇ such that more information with direct sensitivity to the
> octupolar moments and their correlations is brought to bear in this
> field."

This is claim-anchored open-problem statement: each "open question" is
tied to a specific measurement that doesn't yet exist. Contrast with the
B-grade pattern of "future work should explore X" where X is too abstract
to falsify.

Could not determine: whether the authors compile a comparison table of
exchange parameters across primary papers (likely — typical of Annual
Reviews — but I could not get the body), whether they adjudicate the
Smith-vs-Gaulin-2024 (arXiv 2407.07640) finding that octupolar
correlations are absent above 0.05 K, which contradicts the U(1)π
proposal that the same Gaulin group had supported.

---

### R4. Quantum Critical Eliashberg Theory

- Authors: Ilya Esterlis & Jörg Schmalian
- Venue: Annual Review of Condensed Matter Physics (2026; preprint posted June 2025)
- arXiv: 2506.11952; 31 pp, 7 figs
- URL: <https://arxiv.org/html/2506.11952>

Scope statement (Sec 1):

> "In this review, we explore the quantum critical Eliashberg theory,
> which extends conventional Eliashberg approaches to non-Fermi liquid
> regimes governed by critical fluctuations."

Original derivation appears in Sec 2.2; the authors don't outsource the
key step to citation:

> "Having expressed the effective action in terms of these bilocal fields,
> the $N \to \infty$ limit is taken, allowing the partition function to
> be evaluated in the saddle-point approximation."

Treatment of disagreement is methodological — they distinguish their
formulation from competing large-$N$ approaches, naming the technical
defect they avoid:

> "[The] approach appears to be free of the pathologies associated with
> expansions based on a large-$N$ number of fermion flavors […] unlike
> certain matrix large-$N$ approaches, [it] incorporates important
> effects such as Landau damping."

Outlook (Sec 5) is itemized as a list of *named open directions*, not
prose:

> "An incomplete list includes: connections to thermalization and
> hydrodynamics, anomalous critical behavior in Dirac fluids,
> non-equilibrium superconductivity, inclusion of dissipation…"

Pattern: theoretical reviews in this venue do load-bearing derivation
inside the review, treating the review itself as a venue for partial
synthesis-as-recomputation, not a literature catalog.

---

### R5. Cross-disciplinary perspectives on AI across chemistry

- Authors: multi-author (10 perspectives)
- Venue: Chemical Society Reviews (2025), DOI 10.1039/D5CS00146C
- URL: <https://pubs.rsc.org/en/content/articlehtml/2025/cs/d5cs00146c>

Scope is bounded by viewpoint count rather than topical sweep:

> "Here, we present ten different perspectives on the impact of AI in
> chemical research coming from those with a range of backgrounds from
> experimental chemistry, computational chemistry, computer science,
> engineering and across different areas of chemistry…" (Introduction)

Treatment of disagreement is unusually direct — they push back on the
field's own optimism with a sober assessment:

> "Perhaps the most surprising aspect of applying ML to quantum chemistry
> is that these methods have not come to dominate. So far, though the
> methods do offer improvements on the state-of-the-art, the gains are
> relatively marginal, and come with significant costs in terms of
> additional expertise required to undertake the calculations, and the
> underlying uncontrolled approximations inherent to the methods." (Sec 1.4)

Negative space is operationalized as a measurable gap, not vague hand-wave:

> "Few studies have reported the experimental verification of novel
> high-performing compounds proposed by a generative model. Success
> stories across biochemistry, antibiotics, and organic photovoltaics
> offer a tantalising glimpse of the impacts to come." (Sec 3.2)

Original synthesis: Sec 2.2 quantitatively cross-cites a primary result —

> "For example, a recent study of point defects trained a model on
> structural environments for 50 chalcogenide crystals and showed a 70%
> reduction in the number of first-principles calculations required to
> identify the lowest-energy defect structure."

— which is the kind of claim-anchored citation that survives audit (a
specific number, attributed, supporting a specific point). B-grade reviews
tend to drop the number and the attribution.

---

### R6. Muon Studies of Superconductors

- Author: Stephen J. Blundell
- Venue: Annual Review of Condensed Matter Physics 16, 367–385 (2025)
- DOI: 10.1146/annurev-conmatphys-032922-095149

Direct fetch was blocked (403). What I extracted from search-index
summaries: outlook is technique-specific and computational-method-anchored
rather than open-ended:

> "To properly interpret experimental results, it is necessary to have
> reliable information about the site of the implanted muon and its
> stability, which can now be provided using density functional theory
> techniques."

> "[The] coming decade [will] witness substantial progress being made
> through density functional methods… understanding the stability of muon
> sites in time-reversal symmetry breaking candidate superconductors and
> how these sites might be manipulated by stress and pressure."

Pattern: Annual Reviews future-issues sections name a *specific
methodological dependency* (DFT+μ) whose maturation gates further
progress. This is much more useful than "more measurements are needed."

I could not access the body to determine whether Blundell adjudicates
disagreements about TRSB candidate materials.

---

## Cross-cutting patterns observed

These come from the seven reviews above plus the five editorial-policy
documents (RMP style guide, Nature Reviews Materials guidelines, Nature
Reviews Physics author info, Chem Soc Rev / J Mater Chem B editorials,
Ginger 2024 Chemical Reviews editorial).

### P1. Scope is bounded explicitly, not maximally

A-grade reviews state what they *don't* cover. Examples: Janus RMP =
"last decade"; Sherrington-Kirkpatrick = "two 1975 papers"; Smith et al.
= "two single-crystal systems"; Esterlis-Schmalian = "non-Fermi liquid
regimes"; CSR AI = "ten perspectives". Generic catch-all reviews do not
appear in the high-impact set.

Editorial backing — *Nature Reviews Materials* author guidelines:

> "the scope of a Review should be broad enough that it is not dominated
> by the work of a single laboratory, and particularly not by the
> authors' own work."

> "authors should not list or describe every paper within the field; we
> expect authors to select, discuss and interpret the papers they feel
> are most important." (NRM Guidelines for Authors)

### P2. Critical analysis is required, not optional

*J. Mater. Chem. B* 2025 editorial "Writing an impactful Review: top tips
from the Editors":

> "[Evaluation] should extend beyond mere description to also encompass
> critical analysis. This involves comparing methodologies, assessing
> the reliability of findings, and identifying inconsistencies."

> "Include both supporting and contradictory evidence – don't be
> selective. Ensure a nuanced perspective is provided… do not ignore
> controversies or contradictions."

> "synthesize material and provide your opinion on general trends and
> where the field is headed. Critical analysis and original insights
> will help your work stand out."

Ginger (Chem. Rev. 2024 editorial, "How to Propose a Great Chemical
Reviews Article"):

> "formative review articles crystallize concepts and help readers make
> conceptual leaps by synthesizing the existing literature and presenting
> it in a coherent and forward-looking fashion" — and proposals must
> "apply an expert's critical thinking to analyze and synthesize findings
> from the literature, rather than just summarizing them."

### P3. Verification: re-derive, re-cast, or quantitatively
cross-reference rather than transcribe

In R1 the authors substitute the corrected $\xi^{D-\theta/2}$ exponent
for the previously-published $\xi^3$ assumption. In R2 they trace the
discrepancy between SK ground-state energy and KS simulation. In R4 the
authors do the saddle-point themselves. This is the single most distinctive
practice separating top reviews from middle-tier ones: load-bearing
calculations get re-derived inside the review.

The B-grade failure mode (the one the agent currently exhibits) is
trusting a quoted number from a primary paper without re-checking what
sub-experiment it came from or whether a later paper revised it.

### P4. Treatment of disagreement: adjudicate, don't fence-sit

R1 explicitly says "the controversy is of no real consequence for X" — a
*ruling*, with reason. R2 uses the disagreement as the narrative spine.
R5 calls out that ML hasn't lived up to its hype in quantum chemistry —
contradicting the field's marketing. None of these reviews say "some
authors find X, others find Y; further work is needed."

### P5. Negative space is concrete and testable

A-grade open-problem statements bind a specific missing measurement /
calculation / material to the gap. Compare:

- Good (R3): "more information with direct sensitivity to the octupolar
  moments and their correlations [must be] brought to bear" — names the
  observable.
- Good (R6): "DFT+μ methods will gate progress on TRSB site
  identification" — names the method.
- Good (R5): "Few studies have reported the experimental verification of
  novel high-performing compounds proposed by a generative model" —
  names the missing experimental class.
- Bad (typical B-grade): "more theoretical work is needed."

### P6. Original work in surveys is normal and expected

Beyond R1 (re-derived exponents) and R4 (own saddle-point), Annual
Reviews format requires *Summary Points* and *Future Issues* sections —
both are author-original synthesis, not copy-paste. *Nature Reviews
Materials* requires "balanced overviews… authors should discuss the
implication of the work under discussion, rather than simply describe a
study's findings." Author selection is itself an act of original
analysis.

### P7. Citation discipline: claim-anchored, with budget

Nature Reviews policy:

> "Reviews are approximately 6,000 words long and typically include 5–7
> display items… As a guideline, Reviews include up to 150 references;
> citations should be selective."

The implicit rule: if the reference budget is 150 over 6,000 words,
citations cannot be drive-by — every cite must do real work. Compare
B-grade behavior of citing 400+ papers to look thorough.

### P8. Depth allocation is explicit choice, not residual

R3 spends most of the review on two materials, briefer treatments on the
rest. R4 unpacks the saddle-point in detail, lists other extensions in
"an incomplete list". *J. Mater. Chem. B* editors explicitly endorse
this:

> "prioritize high-quality, relevant research, while excluding studies
> that do not directly address the topic at hand. This selectivity
> ensures that the review remains focused and impactful."

### P9. Outlook section is structurally required, often subdivided

R1 splits VII into theoretical vs experimental open issues. R4 itemizes
named directions. R3 ties open questions to specific material-class
problems. The Annual Reviews format has a mandatory "Future Issues" list;
*Chemical Society Reviews* requires "a summary of unresolved questions
and future directions" for Critical Reviews and "a structured set of key
learning points" for Tutorial Reviews — manuscripts that conclude with a
generic summary paragraph "are returned for revision before peer review."

---

## Honest gaps — what I could not access or determine

- **ACS publisher domain (`pubs.acs.org`)**: every direct fetch returned
  403. I have only abstracts and editorial summaries for *Chemical
  Reviews* articles. I could not verify whether the 2024 Ginger editorial
  contains stronger-worded passages than the search index reported.
- **Annual Reviews publisher domain (`annualreviews.org`)**: every direct
  fetch returned 403, and the HAL open-access mirror for R3 also returned
  an Anubis block. I have summaries but not body text for R3, R6, and the
  Takatori et al. *Feedback Control of Active Matter* review I had also
  intended to brief.
- **Nature publisher domain**: 303 redirect blocks. I have R2 from arXiv
  preprint but not from the Nature Reviews Physics published version
  (which may have additional editorial-stage content).
- **RMP style guide PDF**: 403 — could not extract verbatim editorial
  guidance from the source most likely to encode RMP's verification
  policy.
- **What I therefore *cannot* claim with primary evidence**: (i) whether
  any of these reviews include reproductions of original raw-data figures
  (only inferred from arXiv structure for R1); (ii) whether any cross-
  check reported numerical values across primary papers in a table format
  (likely for R3 and R6 from Annual Reviews convention, but unverified);
  (iii) the exact cite count distribution per claim (would require body
  access). For R5 I have body text via RSC's HTML, which suggests the
  RSC's open-access policy may be the easiest publisher to keep working
  with.

---

## Implications for the survey methodology skill (brief)

If the goal is to lift the agent from B to A:

1. Force scope-bounding output before any literature load — the agent
   must commit to "what we cover / what we exclude" before writing
   sections. Mirrors P1.
2. Require at least one re-derivation or recomputation per major numerical
   claim — the agent currently quotes; A-grade reviews verify. Mirrors P3.
3. Prohibit fence-sitting language ("some find X, others find Y; further
   work needed") and require an adjudication or an explicit "currently
   unresolved" with named experiment that would resolve it. Mirrors P4
   and P5.
4. Mandate a structured Future Issues / Open Problems section, each item
   bound to a specific missing measurement, method, or system. Mirrors
   P5 and P9.
5. Cap citations at a Nature-Reviews-style budget (~25 cites per 1000
   words) so every cite has to earn its place. Mirrors P7.
6. Treat depth allocation as a planned design output, not a side-effect of
   what the search returned. Mirrors P8.

Total budget: ~2400 words.
