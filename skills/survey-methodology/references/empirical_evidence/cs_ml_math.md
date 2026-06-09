# Survey methodology in CS / ML / math (2024–2026): what verification practices distinguish A-grade from B-grade

Compiled for a survey-methodology skill aimed at autonomous research agents that currently trust paper claims rather than verify them. Focus: do reviews *audit* their primary sources, or only *organize* them?

---

## Per-review briefs

### 1. Reuel et al., "BetterBench: Assessing AI Benchmarks, Uncovering Issues, and Establishing Best Practices" — NeurIPS 2024 (Datasets & Benchmarks Track)

URL: https://arxiv.org/abs/2411.12990 ; HTML: https://arxiv.org/html/2411.12990v1 ; companion: https://betterbench.stanford.edu

**This is the cleanest A-grade exemplar in the corpus.** The contribution is not synthesis; it is a hand-audit of 24 benchmarks against 46 criteria.

- **Scope**: "16 FM and 8 non-FM benchmarks." Selection rule: "commonly used benchmarks, such as those that were recently reported by model developers." No PRISMA, but the rationale is named.
- **Criteria derivation**: 46 criteria from a literature review across "hardware, bioinformatics, environmental quality" plus "unstructured interviews with 20+ policymakers, model developers, benchmark developers, model users, and AI researchers."
- **Audit protocol — load-bearing**: "At least two authors independently reviewed each benchmark" using "official websites, papers, GitHub repositories." Calibration round: "three authors independently scored the same benchmark to … identify potential misinterpretations of the criteria." A third reviewer was the tie-breaker (never invoked).
- **Concrete reproducibility numbers** (not summarized, *counted*):
  - "**17 out of 24 benchmarks do not provide easy-to-run scripts to replicate the results** reported in the initial paper, and 4 out of 24 only provide scripts to replicate part of the results."
  - "**14 out of 24 benchmarks did not perform multiple evaluations of the same model or report statistical significance.**"
- **Original taxonomy**: 5-stage benchmark lifecycle (Design → Implementation → Documentation → Maintenance → Retirement), with "Retirement" honestly excluded because "we cannot assess the retirement of active benchmarks."
- **Statistical analysis on their own data**: report a significant correlation (p<0.001) between design and usability scores.

What an autonomous agent should learn: pre-register the audit dimensions; sample a fixed bounded set; have ≥2 raters; *count*, don't gesture.

### 2. Eitel-Porter, Hardy, Whittlestone et al., "Can We Trust AI Benchmarks? An Interdisciplinary Review of Current Issues in AI Evaluation" — AIES 2025 / arXiv 2502.06559

URL: https://arxiv.org/abs/2502.06559 ; OJS: https://ojs.aaai.org/index.php/AIES/article/download/36595/38733/40670

A meta-review (~100 publications, 2014-01-01 → 2024-12-31) explicitly *not* itself empirical, but with disciplined sourcing.

- **Scope rule**: citation-tracking, not keyword search. "began with well-cited papers problematizing benchmark use, then surveyed reference lists and citation patterns to expand their corpus iteratively." Explicit exclusion: "papers that merely propose new benchmarks without engaging in fundamental critique."
- **Honest about limits**: did not re-run benchmarks. Cites Reuel et al. 2024 *by number* — "only four [of 24 SOTA benchmarks] provided scripts to replicate the results and … no more than ten performed multiple evaluations or reported the statistical significance" — does not paraphrase or inflate.
- **Original contribution**: "nine reasons to be cautious with benchmarks" as a critique-organized taxonomy.
- **Citation discipline**: leads with the claim ("subtle variations in prompts, formatting or other implementation details can significantly impact … evaluations") then cites; not "Smith et al. (2023) showed …".

This is the gold standard for "synthesis-only" surveys: they don't pretend to verify, but they also don't *launder* second-hand statistics. Every number traces back to a primary count.

### 3. Balloccu, Schmidtová, Lango & Dušek, "Leak, Cheat, Repeat: Data Contamination and Evaluation Malpractices in Closed-Source LLMs" — EACL 2024 (Best Non-publicized Paper Award)

URL: https://aclanthology.org/2024.eacl-long.5/ ; arXiv: https://arxiv.org/abs/2402.03927 ; site: https://leak-llm.github.io/

A 255-paper systematic review whose contribution is the manual coding itself.

- **Scope**: 255 papers using OpenAI's ChatGPT/GPT-4 in their first year of release. From the abstract: "212 of them interacted with closed-source models, and out of these 212 papers, 90 (~42%) indirectly leaked data."
- **Original empirical work**: They reconstructed exposure: "the models have been globally exposed to approximately 4.7M samples from 263 benchmarks." This is a count derived from coding the 255-paper corpus — that *is* the experiment. Not synthesis.
- **Malpractice taxonomy** (named by them): "unfair or missing baseline comparisons, reproducibility issues, and authors' lack of awareness of the data usage policy."
- **Open artifact**: leak-llm.github.io is a contributable database, not just a static appendix.

The methodological move worth stealing: the survey's empirical contribution isn't running benchmarks but *quantifying methodological pathology in a fixed corpus*. An agent surveying a field can do the same — sample N papers, code each on a pre-registered rubric, report counts.

### 4. Berkeley RDI, "How We Broke Top AI Agent Benchmarks" — 2025

URL: https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/

Not a journal review but cited here because it is the *empirical foil* a good survey would cite. They built an "automated scanning agent that systematically audited eight among the most prominent AI agent benchmarks" — SWE-Bench, WebArena, OSWorld, GAIA, Terminal-Bench, FieldWorkArena, CAR-bench — and ran exploit attacks through the *official* evaluation pipelines.

Concrete failure-mode catalog (verbatim):
- **SWE-bench**: "Single 10-line `conftest.py` file achieved 100% on 500 instances without fixing bugs"
- **Terminal-Bench**: "100% on all 89 tasks using binary wrappers, zero actual solution code"
- **FieldWorkArena**: "validate() method checks only one thing: did the last message come from the assistant? ANY answer = 1.0"
- **WebArena**: "~100% by reading gold answers via `file://` URL navigation"
- **GAIA normalization**: "'Dr. Martin Luther King Jr.' / 'D.R M.A.R.T.I.N L.U.T.H.E.R K.I.N.G J.R' → both normalize to 'drmartinlutherkingjr' → Match"

A B-grade survey would cite "WebArena has reproducibility concerns." An A-grade survey copies the table above and cites it.

### 5. Mohammadi et al., "Evaluation and Benchmarking of LLM Agents: A Survey" — ACM SIGKDD 2025 / arXiv 2507.21504

URL: https://dl.acm.org/doi/10.1145/3711896.3736570 ; HTML: https://arxiv.org/html/2507.21504v1

Representative B-grade. New 2-D taxonomy, no verification.

- **Scope**: not stated. "This survey provides an in-depth overview of the emerging field of LLM agent evaluation" — no inclusion criteria, no date cutoff, no count.
- **Original work**: a taxonomy ("Evaluation Objectives × Evaluation Process") and that's it.
- **No re-runs, no cross-paper number comparison, no code inspection.** Tools (LangSmith, Azure AI Foundry) are *named* but not inspected.
- Mentions CORE-bench, PaperBench, BFCL, HAL leaderboard — but does not consolidate their numbers or check disagreements.

This is the modal LLM-agent survey. The new taxonomy is the deliverable; verification is not even attempted.

### 6. Yehudai et al., "A Survey on Evaluation of LLM-based Agents" — arXiv 2503.16416 (under review TMLR)

URL: https://arxiv.org/html/2503.16416

Same B-grade pattern, with a worth-quoting honest disclaimer.

- "To maintain clarity and focus, we prioritized works that illustrate key trends or address significant aspects of agent evaluation." (i.e., curation by author taste, not stated criteria.)
- "the selection of benchmarks and frameworks, while intended to be representative, is subject to the breadth of the field."
- Mitigation: "a continuously updated GitHub repository." This is the standard *post hoc* fix for unstated scope — the agent should note it but not treat it as equivalent to reproducible inclusion criteria.

### 7. Yu et al., "Evaluation of Retrieval-Augmented Generation: A Survey" + the 2025 follow-up — arXiv 2405.07437 / 2504.14891

URL: https://arxiv.org/html/2504.14891v1

Notable for *naming* a corpus but stopping at counting.

- **Scope is named**: "We crawled the collection of the papers since 2022 autumn with keywords about RAG in the accepted papers of the high-level conferences about NLP & AI … We finally amassed a total of 582 PDF manuscripts."
- **Original analysis**: "statistics of evaluation methods used across four different segments" via word frequency and paper counts (§6.1). Light meta-analysis, not benchmark re-runs.
- **No cross-paper number reconciliation, no code inspection.**
- New taxonomy: Internal vs External evaluation, decomposed into Relevance / Faithfulness / Correctness / Comprehensiveness.

### 8. De Ryck & Mishra, "Numerical analysis of physics-informed neural networks and related models in physics-informed machine learning" — Acta Numerica 33 (2024), pp. 633–713

URL: https://www.cambridge.org/core/journals/acta-numerica/article/A059C6E13478F0F7C70EC7C976716F9F ; preprint: https://arxiv.org/abs/2402.10926

The math-side contrast. A different *kind* of verification — proofs, not benchmarks — but the underlying discipline is structurally identical.

- **Scope is the unifying frame**: "Our goal is to critically analyze PINNs and its variants with a view to ascertain when they can be applied and what are the limits to their applicability."
- **Original framework**: a unified error decomposition (approximation + stability + generalization + training). Not a re-shuffle of existing categories — a new analytical scaffold against which prior bounds are *re-derived* in consistent notation.
- **Numerical verification**: "Numerical results are also presented to illustrate the theory." A math-survey analogue of running benchmarks.
- **Headline finding from the survey itself**: "training errors [are] a key bottleneck which can adversely affect the overall performance" — i.e., the survey produces a domain claim, not just a map.

Acta Numerica's house style is the math-domain analog of BetterBench: the survey's value is in the unifying re-derivation, not in coverage breadth. An expository math survey that just lists theorems would not be invited.

### 9. (Paywalled / not fully accessed) Zhang et al., "Deep Learning for Code Intelligence: Survey, Benchmark and Toolkit" — ACM Computing Surveys 56(9), 2024

URL: https://dl.acm.org/doi/10.1145/3664597 (paywalled at full text)

The title alone signals the rare CS-side A-grade move: the deliverable includes a re-implementation benchmark and an open toolkit, not just a taxonomy. Search-result excerpt: "publicly releases source code and data resources to provide the community with a ready-to-use benchmark, facilitating evaluation and comparison." Worth seeking out as a template; could not verify the methodology section directly here.

---

## Cross-cutting patterns

### Pattern 1: There are two fundamentally different survey species

| | A-grade ("audit") | B-grade ("organize") |
|---|---|---|
| Examples | BetterBench (Reuel 2024), Leak-Cheat-Repeat (Balloccu 2024), Can-We-Trust (2502.06559), De Ryck & Mishra (Acta Numerica 2024), Berkeley RDI 2025 | Mohammadi 2025, Yehudai 2025, Yu 2024/2025, most ACM Computing Surveys LLM-agent surveys |
| Original contribution | a count, an audit, a unified framework, an exploit, a re-derivation | a taxonomy diagram |
| Scope rule | named, bounded, often N=fixed | "we prioritized works that illustrate key trends" |
| Cross-paper numbers | reconciled in tables, conflicts flagged | listed without cross-check |
| Citation discipline | claim-first | author-first |

A useful working definition: **a survey is A-grade if removing the new taxonomy leaves a contribution.** B-grade surveys collapse to nothing without their figure-1 taxonomy.

### Pattern 2: Nobody actually re-runs benchmarks

Across the 8 reviewed survey-style papers, **none re-ran the benchmarks they discuss**. The closest analogues are:
1. *Counting* properties of a fixed corpus (Balloccu 255 papers, Reuel 24 benchmarks).
2. *Auditing* benchmarks adversarially (Berkeley RDI — but this is a separate research artifact, not a "survey").
3. *Unifying* prior numerical theorems under one notation and presenting confirming experiments (De Ryck & Mishra).

For an autonomous-research agent, the practical implication: full re-execution of every cited benchmark is *not* the norm even in A-grade venues. The realistic verification bar is:
- count properties of a bounded, named corpus,
- reconcile reported numbers when they appear in ≥2 sources,
- inspect code repos for "is there a script? does the README's `pip install` resolve?" (cheap, almost no one does this),
- flag specific failure modes with primary citations rather than paraphrases.

### Pattern 3: Cross-paper number reconciliation is almost universally absent

In the 7 ML/agent surveys reviewed, *zero* present a "this paper says X on benchmark B; that paper says Y on the same benchmark; here is why." Yu et al. (RAG) get closest by aggregating evaluation-metric usage frequency, but never compare *scores*.

The Reuel-style move ("of 24 benchmarks, X had property P") is unusual and high-leverage. An agent's survey skill should aim to produce at least one such count.

### Pattern 4: Taxonomies are cheap; honest scope is rare

Every B-grade survey proposes a new taxonomy. A-grade surveys also propose taxonomies, but they pair them with a numbered audit. The discriminator is the audit, not the taxonomy.

The closest thing to "honest scope" outside Reuel and Balloccu is Yu et al.'s "we crawled … 582 PDF manuscripts." It's not full PRISMA but it's reproducible enough that another team could re-derive a similar corpus. Compare to Yehudai's "we prioritized works that illustrate key trends" — which is non-falsifiable.

### Pattern 5: Code inspection is the largest unaddressed gap

Of the surveys reviewed, **only Berkeley RDI actually opens repos and runs code**. Reuel et al. *check* whether scripts exist (the 17/24 number) but don't run them. Every LLM-agent survey lists frameworks (LangChain, AutoGPT, LangSmith) without checking that the README's claims match the code. This is the cheapest available verification and the most-skipped.

### Pattern 6: Citation grammar correlates with rigor

A-grade: "subtle variations in prompts, formatting or other implementation details can significantly impact the performance and validity of evaluations" (claim-first; Can-We-Trust 2502.06559).

B-grade: "Smith et al. (2023) propose a framework that …" (author-first, content-empty).

This reads like a stylistic quibble but it's diagnostic: claim-first citation forces the writer to commit to *what is true*; author-first lets the writer hide behind attribution.

### Pattern 7: Math expository surveys (Acta Numerica, Bull. AMS) verify by re-derivation

In math, the equivalent of "running the benchmark" is re-proving the result, often in newly-unified notation. De Ryck & Mishra's Acta Numerica article does exactly this: PINNs error analysis is reorganized as approximation + stability + generalization + training, with prior results re-cast into the framework. This is the original contribution; the "survey" framing is incidental.

Bull. AMS expository articles (which I could not fetch a 2024–2026 specimen of due to a 403) are by-invitation only, with the implicit norm that an expository article must offer either a unified perspective or a new proof. Coverage alone is not publishable.

---

## Honest list of what's paywalled / unverified

- **Bull. AMS recent articles** (`pubs.ams.org/journals/bull/2025-62-03/...`): 403 forbidden. Could not extract a 2024–2026 specimen directly.
- **SIAM Review "Modeling Still Matters" (Lambert et al. 2024, 23M1563967)**: 403 forbidden. Search-result excerpt confirmed the paper releases a reproducible interactive notebook for all numerical experiments — i.e., A-grade reproducibility for a non-survey article — but I could not verify the methodology language directly.
- **ACM Computing Surveys "Deep Learning for Code Intelligence" (3664597)**: 403 forbidden on full text. Methodology inferred from search-result snippets only; the claim that they *re-implement* baselines in a unified toolkit is consistent with the title and abstract excerpt but should be verified before citing.
- **TMLR survey-track papers**: TMLR's "Survey Certification" criteria are documented (`jmlr.org/tmlr/papers/`) but I did not find a single 2024–2025 TMLR-survey-certified paper that audits benchmarks empirically. The certification appears to mean "thorough/insightful synthesis," which by the A/B framing above is closer to the B-grade ceiling. Worth a deeper dive than I did.
- **Annual Review of Statistics 2024–2025**: Found the table of contents but did not deep-dive a single article. Coverage themes (epidemics, differential privacy, gene-environment interactions) suggest these are domain-overview reviews more like B-grade taxonomies than benchmark audits.
- **Communications of the ACM 2024–2025**: CACM "review articles" are by invitation and shorter than journal surveys; I did not identify a specimen with audit-style methodology in the time available. Their April 2025 piece on AI evaluation methods is on-topic but framed as opinion, not survey.
- **Balloccu et al. EACL paper full text**: ACL Anthology HTML rendering did not surface the methodology section in my fetches; I rely on the abstract + companion site + Plank's award citation for the 255-paper / 4.7M-sample / 263-benchmark numbers. The exact selection-criteria paragraph would be worth quoting verbatim before publishing.

---

## Bottom line for the survey-skill prompt

If the goal is to push an autonomous agent off pure synthesis and toward verification, the four behaviours that distinguish A-grade from B-grade in this corpus are:

1. **Bound the corpus and name the rule** — Reuel's "24 commonly-used benchmarks" or Balloccu's "255 papers using ChatGPT/GPT-4 in year 1" beats Yehudai's "we prioritized works that illustrate key trends."
2. **Produce at least one count, not just a taxonomy** — "17/24 lack replication scripts" is a survey contribution; "we propose a 2-D evaluation taxonomy" is not.
3. **Reconcile cross-paper numbers when ≥2 sources report them** — not a single ML survey reviewed does this.
4. **Open the code repo** — checking whether `README.md` matches the actual entrypoint is cheap and almost universally skipped; Berkeley RDI shows the upside.

A fifth, softer rule: **lead with the claim, cite second**. The grammatical discipline forces the writer to take an epistemic position rather than launder it through attribution.
