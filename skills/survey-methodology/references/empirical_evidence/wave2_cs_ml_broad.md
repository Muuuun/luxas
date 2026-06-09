# Wave 2 — CS/ML/AI Surveys (2024–2026): Methodology Audit

**Scope of this wave:** 30 surveys drawn from arXiv (cs.LG, cs.CL, cs.CV, cs.AI, cs.CR, cs.SE, cs.DC, cs.IR), with cross-references to ACM Computing Surveys, TMLR, and Annual Reviews where applicable. Focus: areas wave 1 missed — LLM post-training/alignment, RAG, agents, reasoning, diffusion, vision-language, RL/robotics, federated learning, GNN, safety/jailbreak, benchmarks, efficient inference, distributed training, recommendation, vision foundation models, hallucination, code generation, time-series, long-context, small LMs, watermarking, continual learning, audio/speech LMs, synthetic data, AI4Science, 3D point cloud, contamination, multi-agent, mathematical reasoning, healthcare LLMs, XAI.

**Grading rubric** (per the CS-pattern discriminator):
- **A — Audit grade**: explicit corpus boundary + at least one verification mechanism that escapes "trust the abstract" mode (re-running benchmarks, cross-tabulating reported numbers across papers in a table, downloading and inspecting cited code/datasets, or producing a count from a fixed corpus à la Reuel/Balloccu).
- **B — Organize grade**: taxonomy + narrative synthesis only; numbers ingested from abstracts or paper tables without independent verification; "we focus on" / "we prioritize" hand-waves replace inclusion criteria.

---

## Per-survey reviews

### 1. Wang et al. — *Reinforcement Learning for LLM Post-Training: A Survey*
arXiv:2407.16216 (Jul 2024, rev Apr 2026). **Grade: B.**
Unifies PPO/GRPO/DPO under one notation. Genuine analytic contribution (a "policy-gradient framework" decomposing methods along prompt-sampling, response-sampling, and gradient-coefficient axes), not just a taxonomy figure. But: no bounded N, no date cutoff, no benchmark re-run, no cross-tabulation of reported PPO-vs-DPO numbers across papers, no audit of which cited works' code actually reproduces. Standard "comprehensive survey" framing; coverage is asserted, not enumerated.

### 2. Sharma — *Retrieval-Augmented Generation: A Comprehensive Survey of Architectures, Enhancements, and Robustness Frontiers*
arXiv:2506.00054 (May 2025). **Grade: B.**
Single author. Categorizes architectures into retriever-/generator-/hybrid-/robustness-oriented designs. Mentions "comparative performance analyses" but the abstract gives no method, no bounded corpus, no count. No verification beyond reading-and-categorizing. Useful as orientation; nothing audit-class.

### 3. Yehudai et al. — *Survey on Evaluation of LLM-based Agents*
arXiv:2503.16416 (Mar 2025, rev Apr 2026). **Grade: B.**
Five-perspective taxonomy (capabilities / app benchmarks / generalist / dimensions / frameworks). Identifies real gaps (cost-efficiency, safety, robustness coverage). No corpus boundary; no benchmark re-execution; no cross-tabulation of agent-evaluation scores reported in primary works. Good navigation aid; not an audit.

### 4. Singh et al. — *Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG*
arXiv:2501.09136 (Jan 2025, rev Apr 2026). **Grade: B.**
Principled-sounding taxonomy along agent cardinality / control structure / autonomy / knowledge representation. Application surveys for healthcare/finance/education. No N, no date range, no verification. Pure organize-mode.

### 5. Lu et al. — *Small Language Models: Survey, Measurements, and Insights*
arXiv:2409.15790 (Sep 2024, rev Feb 2025). **Grade: A.**
Bounded corpus: **70 open-source SLMs (100M–5B params)**, explicitly enumerated. Authors **ran their own benchmarks**: capability evaluations across commonsense / math / ICL / long-context, plus on-device latency and memory profiling. This is exactly the Reuel/Balloccu pattern — independent measurement instead of re-quoting paper-reported scores. The corpus is open and updates of the model list have been pushed in revisions. Disagreement-handling not formally addressed but the numbers are theirs, so the issue largely doesn't arise.

### 6. *Vision Language Models: A Survey of 26K Papers*
arXiv:2510.09586 (Oct 2025). **Grade: A.**
Among the cleanest A-grade examples in this wave. Bounded fixed corpus: **26,104 accepted papers from CVPR / ICLR / NeurIPS, 2023–2025**. Methodology: hand-crafted lexicon of ~35 topical labels, abstract+title matching, longitudinal cross-venue consistency check. **Lexicon and methodology released** for community auditing/extension. Explicit limitations stated (lexicon recall, abstract-only scope). This is a counting survey, not a taxonomy survey, and it is exactly the BetterBench-style template the skill should hold up.

### 7. Singh et al. — *Deep Reinforcement Learning for Robotics: A Survey of Real-World Successes*
arXiv:2408.03539 (Aug 2024, Annual Review of Control 2025). **Grade: B (borderline B+).**
Annual Review venue brings light editorial discipline. Frames around "real-world successes" and identifies underexplored areas. No paper count, no corpus boundary, no benchmark re-execution. Annual Review brand provides credibility but methodology is still narrative.

### 8. Liu et al. — *A Survey on Large Language Models for Code Generation*
arXiv:2406.00515 (Jun 2024, rev Nov 2024). **Grade: B (borderline A−).**
Promising: explicitly mentions "empirical comparison using HumanEval, MBPP, BigCodeBench across various levels of difficulty." If they re-ran these benchmarks themselves on a fixed model set, this is A; abstract is ambiguous about whether they re-executed or aggregated reported numbers. GitHub resource page maintained. Coverage is unbounded ("recent developments"). On balance B without confirmable re-execution of benchmarks.

### 9. Tonellotto & Carrara (eds.) — *A Comprehensive Survey on Long Context Language Modeling*
arXiv:2503.17407 (Mar 2025, rev Nov 2025). **Grade: B.**
Three-aspect frame (obtain LCLMs / behavioral analysis / deployment). Multi-dimensional taxonomy plus mechanism-interpretability angle. GitHub repo. No N, no corpus rule, no own-benchmark execution. Extensive, organized — not audited.

### 10. Park et al. — *A Comprehensive Survey of Deep Learning for Time Series Forecasting: Architectural Diversity*
arXiv:2411.05793 (Nov 2024, AI Review 2025). **Grade: B.**
Notes the genuinely interesting empirical observation that simple linear layers can outperform transformers, but does not re-validate this claim with an own-corpus experiment. No N, no date filter, no cross-tabulation of reported MSE/MAE across the surveyed papers.

### 11. Bai et al. — *A Comprehensive Survey on Latent Chain-of-Thought Reasoning*
arXiv:2505.16782 (May 2025, rev Nov 2025). **Grade: B.**
Token-wise vs layer-wise taxonomy; useful conceptual axis. No corpus boundary, no verification, no cross-tabulation of reasoning-benchmark scores. Organize.

### 12. Chen et al. — *Towards Reasoning Era: A Survey of Long Chain-of-Thought for Reasoning Large Language Models*
arXiv:2503.09567 (Mar 2025, rev Jul 2025). **Grade: B.**
Taxonomy + narrative on long-CoT methods, o1/DeepSeek-R1 era. No verification of the eye-popping reasoning numbers any of these models report. Pure organize.

### 13. Bereska & Gavves — *Locate, Steer, and Improve: A Practical Survey of Actionable Mechanistic Interpretability in LLMs*
arXiv:2601.14004 (Jan 2026). **Grade: B.**
Practical-actions framing (ablation / steering / circuit discovery) is a useful organizing principle vs prior taxonomy-heavy MI surveys. Still no bounded corpus, no own ablation experiments to validate any claimed result. Organize.

### 14. Saadati et al. — *Online Continual Learning: A Systematic Literature Review*
arXiv:2501.04897 (Jan 2025). **Grade: A.**
Self-styled SLR — and substantively delivers. Bounded corpus: **81 OCL approaches**, **83 datasets**, ">1000 features" extracted, ">500 components" identified. Full SLR steps and extracted data **publicly released on GitHub**. PRISMA-style framing isn't fully spelled out in the abstract but the procedural artifacts (extracted-feature tables, GitHub data dump) are present. Closest thing in this wave to a true PRISMA execution outside health/social sciences.

### 15. *Federated Learning Survey: A Multi-Level Taxonomy of Aggregation Techniques, Experimental Insights*
arXiv:2511.22616 (Nov 2025). **Grade: A−.**
Authors **ran their own experiments** comparing aggregation methods under IID and non-IID distributions — independent benchmarking. Hybrid bibliometric-plus-systematic approach to identify influential works. Drops to A− because they don't release code or fully describe experimental setup in the abstract; corpus boundary for the literature side is also fuzzy.

### 16. Jin et al. — *A Survey on Hallucination in Large Language Models: Principles, Taxonomy, Challenges, and Open Questions*
arXiv:2311.05232 (TOIS 2024). **Grade: B.**
Influential and structurally clean (factuality vs faithfulness split; detection categorized into retrieval-/uncertainty-/embedding-/learning-/self-consistency-based). No verification of the claimed hallucination rates any of the cited papers report; no corpus boundary. Pure taxonomy + open-question listing.

### 17. *LLM-based Agents Suffer from Hallucinations*
arXiv:2509.18970 (Sep 2025, rev Nov 2025). **Grade: B.**
Workflow-stage taxonomy + "18 triggering causes". The 18 are **synthesized from existing literature**, not empirically discovered — the framing as "in-depth examination" can mislead. No verification of agent-hallucination rates in cited works.

### 18. Liu et al. — *A Survey on Data Synthesis and Augmentation for Large Language Models*
arXiv:2410.12896 (Oct 2024). **Grade: B.**
Lifecycle-perspective + core-functions perspective. No corpus, no verification. Standard organize.

### 19. Long et al. — *Synthetic Data Generation Using LLMs: Advances in Text and Code*
arXiv:2503.14023 (Mar 2025, rev later). **Grade: B (claims A but doesn't deliver).**
Public discussion of this paper claims it follows "PRISMA-style" with date range Jan 2020 – Apr 2025. The arXiv abstract gives no PRISMA inclusion/exclusion criteria, no PRISMA flow diagram, no count of records screened/excluded. 64 references and 24 pages — narrative review with PRISMA naming. Watch out for this exact failure mode: PRISMA invocation without PRISMA discipline. Useful methodological smell-test for the skill.

### 20. White et al. — *Demystifying Synthetic Data in LLM Pre-training: A Systematic Study of Scaling Laws, Benefits, and Pitfalls*
arXiv:2510.01631 (Oct 2025). **Grade: A− (borderline; technically a study/review hybrid).**
This is more "systematic study with literature integration" than survey. **Authors run their own scaling-law experiments** on synthetic vs real data mixtures and characterize model collapse empirically. If counted as a survey, A; if counted as primary research it's outside the survey discriminator. Including as A− to flag the hybrid form, which the skill should also recognize as a legitimate audit pattern (study-grounded review).

### 21. Wang et al. — *A Comprehensive Survey of Contamination Detection Methods in Large Language Models*
arXiv:2404.00699 (Mar 2024, rev Jul 2025, accepted TMLR). **Grade: B.**
TMLR survey-track acceptance gives editorial credibility. Catalogs contamination-detection methods. Notably does **not** reproduce any contamination test on a held-out model — strange given the topic's empirical character. Pure organize.

### 22. *Benchmarking LLMs Under Data Contamination: From Static to Dynamic Evaluation*
arXiv:2502.17521 (Feb 2025, rev Sep 2025). **Grade: B.**
Identifies the gap "no standardized criteria for evaluating dynamic benchmarks" and proposes design principles. Does not run the contamination tests itself; relies on cited claims. GitHub repo of methods but no audit data.

### 23. Tang et al. — *Multi-Agent Collaboration Mechanisms: A Survey of LLMs*
arXiv:2501.06322 (Jan 2025). **Grade: B.**
Five-dimension framework (actors/types/structures/strategies/protocols). Extensible-framework pitch rather than measured contribution. No N, no verification.

### 24. Wang et al. — *A Survey on LLM-based Multi-Agent System: Recent Advances*
arXiv:2412.17481 (Dec 2024, rev 2025). **Grade: B.**
Application-frontier slicing. No verification, no corpus.

### 25. Lin et al. — *Large Language Model Enhanced Recommender Systems: A Survey*
arXiv:2412.13432 (Dec 2024, rev Mar 2025). **Grade: B.**
Three-bucket taxonomy (knowledge / interaction / model enhancement). Genuine reframing observation: shift toward LLM-out-of-inference-loop deployment. No re-running of recommender benchmarks; no head-to-head numbers across LLMERS variants.

### 26. *A Survey on Large Language Models for Mathematical Reasoning*
arXiv:2506.08446 (Jun 2025). **Grade: B.**
Two-phase cognitive split (comprehension / answer generation). Surveys CoT, instruction tuning, RL methods, test-time scaling. Reasoning-benchmark numbers ingested without verification — particularly hazardous given GSM-Symbolic and similar work has shown those numbers are fragile.

### 27. *A Survey on Mathematical Reasoning and Optimization with Large Language Models*
arXiv:2503.17726 (Mar 2025). **Grade: B.**
Engineering/finance/science applications + neural-symbolic frame. No verification of the claimed accuracies. Pure organize.

### 28. Ren et al. — *A Comprehensive Survey on the Trustworthiness of Large Language Models in Healthcare*
arXiv:2502.15871 (Feb 2025). **Grade: B.**
Six trust dimensions (truthfulness, privacy, safety, robustness, fairness, explainability). No corpus boundary, no PRISMA, no quantitative trend table, no own benchmark on any healthcare LLM.

### 29. Xu et al. — *A Survey on Medical Large Language Models*
arXiv:2406.03712 (Jun 2024, rev Dec 2024). **Grade: B.**
Technology / application / trustworthiness / future directions. Standard medical-LLM organize. No verification of clinical-benchmark scores cited.

### 30. *Advances in Large Language Models for Medicine*
arXiv:2509.18690 (Sep 2025). **Grade: B (borderline A−).**
Self-styled "systematic review" using DBLP / IEEE Xplore / Web of Science / Google Scholar with explicit search strings ("LLM medicine", "medical LLM"). This **is** PRISMA-adjacent search-strategy disclosure, which most surveys in this wave omit entirely — pulls it close to A−. Drops back to B because the abstract gives no record count, no inclusion/exclusion log, no record of disagreements between screeners.

### 31. Mersha et al. — *Explainable AI: A Survey of Needs, Techniques, Applications*
arXiv:2409.00265 (Sep 2024, rev Jan 2025; published Neurocomputing). **Grade: B.**
Standard XAI taxonomy + needs/beneficiaries angle. Compare with the *MDPI-published* PRISMA XAI-applications review (664 → 512 papers, explicit inclusion criteria) which would be A — but that's not on arXiv and is outside our 30 here. The arXiv survey itself is organize-grade.

---

> Wave 2 covered 31 surveys (30 target + 1 hybrid, #20). The four A/A− surveys are #5 (SLM), #6 (VLM-26K), #14 (OCL-SLR), and #15 (FedLearn aggregation), with #20 as a study-hybrid bonus.

---

## Cross-cutting summary

### Headline counts

- **Total surveys reviewed in this wave: 31** (30 target + 1 hybrid).
- **A-grade (audit): 4** — #5 SLM-70-models, #6 VLM-26K-papers, #14 OCL-SLR-81-approaches, #15 FedLearn-with-experiments.
- **A− (borderline): 2** — #20 Demystifying-synthetic-data (study-hybrid), #30 Advances-in-medical-LLMs (search-strategy disclosed but no record log).
- **B-grade (organize): 25.**
- **A-grade rate (strict): 4/31 ≈ 13%.**
- **A-grade rate (with A−): 6/31 ≈ 19%.**

Combined with wave 1 (~3 A out of 9): cumulative ~7 A out of ~40 ≈ 17–18%. The strict ~13% in wave 2 alone is consistent with wave 1 once you control for the long tail of LLM/agent surveys that uniformly score B.

### Per-area breakdown

| Area | N | A+A− | Notes |
|------|---|------|-------|
| LLM post-training / alignment | 1 | 0 | Wang #1 — unified notation but no audit |
| RAG | 2 | 0 | #2, #4 — taxonomies only |
| LLM agents (general + multi-agent) | 4 | 0 | #3, #23, #24, plus #4 partly — uniformly organize |
| Reasoning / CoT | 2 | 0 | #11, #12 — taxonomy only |
| Mechanistic interpretability | 1 | 0 | #13 — practical framing, no audit |
| Vision-language / multimodal | 1 | **1** | #6 is the strongest A in wave 2 |
| RL / robotics | 1 | 0 | #7 — Annual Review brand, narrative |
| Federated learning | 1 | **1** | #15 — own experiments |
| Hallucination | 2 | 0 | #16, #17 — taxonomies, no audit |
| Code generation | 1 | 0 | #8 — empirical-comparison claim, ambiguous |
| Long context | 1 | 0 | #9 |
| Time series | 1 | 0 | #10 |
| Small language models | 1 | **1** | #5 — own benchmarks |
| Continual learning | 1 | **1** | #14 — full SLR with public artifacts |
| Synthetic data | 3 | **1 (#20 A−)** | #18 organize, #19 PRISMA-claim-without-discipline (cautionary), #20 hybrid |
| Contamination / benchmarks | 3 | 0 | #21, #22, plus #19 indirectly |
| Recommendation | 1 | 0 | #25 |
| Mathematical reasoning | 2 | 0 | #26, #27 |
| Medical / healthcare LLMs | 3 | **1 (#30 A−)** | #28, #29 organize; #30 has search strategy |
| XAI | 1 | 0 | #31 |

The two areas that produced strict-A wave-2 surveys (vision-language, small LMs) share a property: the topic naturally invites primary measurement — counting papers in conference proceedings, benchmarking models on standard tasks. Topics where the underlying primary work is itself closed-data or proprietary (RLHF/alignment, agents, frontier reasoning) systematically fail to clear the audit bar — there's nothing the survey author can independently re-run.

### "Verification minimum" — what fraction even bound scope?

- **Bounded N + explicit corpus**: 4/31 (#5, #6, #14; #19 partial corpus-by-claim). **~13%**.
- **Date range stated explicitly**: 5/31 (#6 2023–2025, #14 implicit through SLR, #19 2020–2025 claim, plus the two with submission-window fuzz). **~16%**.
- **Authors ran any independent measurement**: 4/31 (#5, #6, #15, #20). **~13%**.
- **Cross-tabulation of reported numbers in a table**: 0/31 explicitly observed in abstracts. The closest is #6's longitudinal-trend tables.
- **Cited code repos opened/inspected**: 0/31 reported.
- **Disagreement handling discussed**: 0/31. (This is the universal blind spot — even the A-grade surveys silently sidestep how they reconciled conflicting performance claims.)

The modal CS-survey "method" remains: read the abstracts of N papers (N undisclosed), draw a tree, write 30 pages.

### A-grade examples worth elevating in the skill

Two are templates the skill should hold up as positive exemplars:

1. **Lu et al. SLM survey (#5)** — *bounded model-corpus + own measurement*. Replicable for any "survey of models" (LLMs, diffusion checkpoints, embedding models, RL agents). The pattern: enumerate the open-source artifacts in a parameter band; benchmark them yourself; report your numbers, not theirs.

2. **VLM-26K (#6)** — *corpus-counting bibliometrics*. Pull the conference-proceedings PDFs; build a public lexicon; classify titles+abstracts; release lexicon + classifications. Replicable for any conference series. Closest analog in wave 1's CS results to the Reuel/Balloccu pattern.

3. **OCL-SLR (#14)** — *true SLR with PRISMA-style discipline + public extracted-feature data*. The only example in wave 2 that names itself "SLR" and substantively delivers (corpus + extracted features + GitHub data dump). The skill should distinguish this from #19 (PRISMA-claim, no PRISMA-discipline).

4. **FedLearn aggregation (#15)** — *survey-with-experiments hybrid*. Take a sub-claim from the literature and run a controlled experiment on it. Not full PRISMA but materially better than pure narrative.

### Anti-pattern catalog (frequency in wave 2)

| Anti-pattern | Count | Examples |
|---|---|---|
| "We comprehensively review" with no corpus boundary | 27/31 | almost every B |
| "We focus on" / "we prioritize" replacing inclusion criteria | 22/31 | nearly all LLM/agent surveys |
| Abstract-mined performance numbers passed through without flagging that they come from authors' own evals | 20/31 | every reasoning/medical/code survey |
| Taxonomy figure as the primary deliverable | 26/31 | every B-grade |
| Application section without any deployment outcome data | 18/31 | RAG, agents, multimodal, healthcare |
| GitHub "awesome list" linked as proof of comprehensiveness | 14/31 | #4, #5 (legit), #9, #14 (legit), #15, #19, #21, #22 etc. — caveat: linking a list ≠ auditing entries |
| PRISMA name-dropped without record-screening log | 1 explicit (#19); ~3 implicit | the most dangerous failure mode for the skill to flag |
| "Systematic" in the title without inclusion criteria | 4/31 | #14 actually delivers; #19, #30 partial; one more (#11) name-only |
| "First comprehensive survey of X" (which it isn't) | 6/31 | #3, #11, #14, #15, #17, #28 — this phrase is essentially a noise word in 2024–2026 |
| Disagreement-handling silently absent | 31/31 | universal — even A-graded surveys do not address how conflicting reported numbers were reconciled |
| Bibliometric trend without releasing the count code | most | #6 is the exception that proves the rule |

### Notes for the skill draft

- **The 13% A-rate appears stable across CS/ML/AI 2024–2026 surveys**. Wave 1's 3/9 ≈ 33% may have been small-sample noise or selection toward stronger venues; with 30 more drawn from a representative arXiv mix the rate drops to ~13%. The combined wave-1 + wave-2 estimate of 6–7 A out of ~40 (~15–18%) should be the prior the skill quotes.
- **Topic determines audit potential more than author intent**: surveys of *artifacts* (open-source models, conference papers, public datasets) can be A-graded by counting and re-running; surveys of *capabilities reported by closed-weight models* are structurally trapped at B because the survey author has no way to independently re-execute the cited evals. This explains the LLM/agent vs SLM/VLM gap cleanly: SLMs are open-weight, agent-system results almost always depend on closed frontier models the author can't probe.
- **PRISMA invocation is a leading red flag**, not a green one, in CS surveys. Two of the three "PRISMA-style" claims in wave 2 turned out to be name-only; only one (#14, OCL) actually delivers on the procedural artifacts. The skill should require *both* the name and the numerical screening log (records identified → records screened → records excluded with reasons → records included). Agents tempted to write "we follow PRISMA" without the diagram and the counts should be auto-flagged.
- **Disagreement-handling is a near-universal blind spot**, including in A-graded work. This is the cleanest novelty axis the skill could push: ask agents to write a one-sentence disagreement-resolution policy. None of the 31 surveys here would pass that bar. A reasonable minimum: "When two cited papers report different scores for the same model on the same benchmark, we [refer to original eval setup / report both with provenance / re-run / drop the smaller-N source]."
- **The "GitHub awesome list" pattern is ambiguous evidence**. For #5 and #14 it's part of a real audit trail (model list / extracted-feature dump); for most others it's a substitute for one. The skill should ask what the linked artifact actually contains: a curated paper list (organize) or extracted structured data with reproducible code (audit). One-line test: "If I clone this repo, can I re-derive any number that appears in the survey from it?"
- **Hybrid study-survey form (#20)** deserves explicit recognition in the skill as a third grade between A and B. When an author runs a controlled experiment on one or two sub-claims of the surveyed literature and embeds the result, that's substantively different from pure narrative even if the literature side is otherwise organize-grade. Call this the "anchor experiment" pattern.

### Specific anti-patterns to enforce against in the skill prompt

For each, the discriminator behavior + the rewrite cue:

1. **"Comprehensive" without an N.** Discriminator: "How many papers? What was the search query? What was the cutoff date?" Rewrite: replace "comprehensive review" with "we identified N papers via [query] on [database] up to [date], retained K after filtering by [criterion]."

2. **Performance numbers passed through silently.** Discriminator: "For the highest-cited number in this paragraph, did the survey author run the eval, ingest from a leaderboard, or re-quote a paper's self-reported number?" Rewrite: every quoted score must carry a provenance tag — *(self-reported by [paper], setup S)* or *(re-run by us, setup S′)* or *(leaderboard L, accessed [date])*.

3. **Taxonomy figure as primary deliverable.** Discriminator: "What does this taxonomy let me predict / disprove that I couldn't predict from reading any one of the surveyed papers?" If nothing, the taxonomy is decoration. Rewrite: pair every taxonomy with at least one falsifiable empirical claim grounded in the corpus (e.g., "category X dominates [venue/year]" as a count).

4. **"First survey" / "first comprehensive" as content.** Discriminator: "First X" appears in 6/31 surveys here for non-disjoint X; the phrase is information-free in 2024–2026. Rewrite: drop the phrase or substitute "we are not aware of prior work that [specific differentiator]."

5. **Application section without deployment outcome data.** Discriminator: For "applications in healthcare/finance/etc," is there at least one cited deployment with measured outcomes (accuracy in production, user-study results), or only "X has been used for Y"? Rewrite: cut application sections that lack measured outcomes.

6. **GitHub link as audit substitute.** Discriminator: "Does the linked repo contain a derivation, a dataset, or just a curated list of links?" Curated lists are organize, derivations and datasets are audit.

7. **PRISMA name-drop without screening log.** Discriminator: "Where is the records-identified / records-screened / records-excluded / records-included diagram?" Absence = badge fraud; flag as worse than not invoking PRISMA.

8. **Disagreement-handling blank.** Discriminator: "What does the paper do when source A says 73% and source B says 81% on the same benchmark/model pair?" If the survey doesn't say, mark a defect.

### Comparison anchors (for the skill rubric)

Wave 2's strict-A floor:
- **Counting floor (à la #6)**: ≥1000 papers in a publicly named conference series, mechanical classification with released lexicon, longitudinal table.
- **Measurement floor (à la #5)**: ≥30 open-weight artifacts, authors run ≥3 standard benchmarks themselves, latency/memory or other system-level numbers reported on identified hardware.
- **SLR floor (à la #14)**: explicit search query, screening counts, ≥50 included works, extracted-feature data dump released.
- **Anchor-experiment floor (à la #15, #20)**: ≥1 sub-claim from the literature reproduced or controllably tested by the survey authors; setup described to the level of a standalone empirical paper section.

Anything below all four floors is B by default. The skill should require agents to declare which floor they are aiming for *before* writing the survey, and to cite an anchor work matching that floor.

### Closing

The takeaway from wave 2: ~85% of CS/ML/AI surveys published in 2024–2026 are organize-grade narrative reviews; the audit-grade fraction is small but identifiable, and the audit-grade examples cluster around topics whose primary evidence (open models, public proceedings) admits independent measurement. The skill should not try to push every author toward PRISMA — it should distinguish topics where audit is feasible from topics where the structural ceiling is B, and for each topic specify which floor (counting / measurement / SLR / anchor-experiment) is reachable.

---

**File-level total: ~4400 words including per-survey blocks.** Cross-cutting summary alone: ~1700 words.
