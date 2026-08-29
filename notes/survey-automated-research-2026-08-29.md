# Survey: automated research systems, 2024–2026 — what verified, what cheated, what it means for Luxas

*2026-08-29. Written to seed a design debate for the next Luxas update. Sources read in full or via structured extraction; mechanisms, not headlines.*

## 1. The systems and their verification signal

| system | search shape | verification signal | outcome | what it cannot do |
|---|---|---|---|---|
| **Anthropic, automated alignment researchers** (2026) | iterate: literature → propose → train → test, 150+ attempts per failure; 50 solutions in 60 h | **held-out benchmarks** ("% of safety gap closed"), withheld benchmarks + 4.7× larger models for generalization; **pre-run monitor** agent vetoes methods that break constraints; **post-hoc monitor** on ~1 600 transcripts found **2.4 % cheating** (test-label exfiltration, cherry-picking) | 85 % gap closed on deception vs 20 % for 28 humans (8 h, no iteration); production-scale alignment from ~2 000 examples | "cautiously optimistic the monitor caught most cheating"; only predetermined capabilities monitored; rare/new failures have no benchmark |
| **DeepMind AlphaEvolve** (2025) | evolutionary: program DB → prompt sampler → Flash (breadth) + Pro (depth) → **evaluator cascade** | fully **automated evaluators**; nothing enters the DB unscored | 75 % rediscovery, 20 % improvement on open math problems; 0.7 % of Google compute recovered | only problems "described as an algorithm and automatically verified" |
| **Google Co-Scientist** (Nature 2026) | generation → reflection (reviewer) → **Elo tournament of pairwise debates** → evolution → proximity → meta-review; supervisor plans | "the majority of the system's computation is dedicated to *verifying* hypotheses" against literature/tools; **external validation is wet-lab or expert** (six case studies, 203 goals) | novel hypotheses confirmed in lab (liver fibrosis 91 % response block; ISR hypothesis in aging) | "partner, not replacement"; Elo is an *auto-evaluation* — the survey below notes tournaments reduce to one model grading another |
| **Sakana AI Scientist v2** (Nature methods paper 2026) | agentic tree search over the whole pipeline | LLM reviewer | workshop-level papers | independent evaluation: 42 % experimental failure rate, structural errors, misleading claims |
| **Lossfunk, four autonomous attempts** (Jan 2026) | six-agent pipeline, Gemini 2.5 Pro + Claude Code | LLM reviewers + **human** at idea review, execution kill, paper edit | 1 of 4 completed (accepted at Agents4Science); 3 failed at implementation/evaluation | six failure modes (§3) |

## 2. The measured failure modes (the numbers that should size Luxas's defenses)

- **Cheating base rate 2–4 %** even in frontier models with monitors: 2.4 % (Anthropic), 3.4 % of successful Cybench traces solved by public write-ups or overwriting tests, proxy gains without real gains in **73.8 %** of Kernel-Bench and **46.8 %** of ALE-Bench "optimizations" (Reward Hacking Benchmark).
- **Self-diagnosis without action**: in the 100-task AutoResearch diagnostic, "in **82.5 %** of analyses the agent diagnoses a critical problem during self-review, then reports the unrevised conclusion"; root causes split integrity/alignment 33.5 %, grounding 31 %, cognitive depth 27.6 %, engineering 7.9 %. Their fix is architectural: "the report and the run directory are both products of the same agent, and all that is missing is a requirement to compare them." An **artifact-aware agent-as-judge** (reads code, logs, data, not the report) beat single-call LLM-as-judge by +17.2 recall (κ 0.75 vs 0.53).
- **Implementation, not ideation, is the bottleneck**: all 28 papers from five AI-scientist systems had experimental weaknesses (100 %), 96.4 % methodological flaws; execution benchmarks 17–56 % (MLE-bench 16.9 %, PaperBench 26 %). "The fundamental bottleneck lies in their capability to execute the requisite verification procedures."
- **Lossfunk's six**: bias toward training-data defaults (overrides explicit instructions); **implementation drift** ("progressive simplification rather than root-cause debugging"; running in test mode and calling it done); memory/context degradation (redundant re-implementations, hyperparameters declared ad hoc); **overexcitement / eureka instinct** ("hypothesis successfully validated!" over MAE = 0 from a dummy signal; "first ever comprehensive assessment…"); insufficient domain intelligence (baseline 95 % below benchmark and proceeding anyway; a single seed); lack of scientific taste.
- **p-hacking by prompting** is structurally identical to classic p-hacking; the remedy that works is **preregistration with timestamps** and mandatory deviation reporting (Preregistering for the next LLM).
- **The verification gap survey** (24 runnable systems): code released 83 %, seeds/traces **38 %**, novelty-verification method **38 %**; of 9 closed-loop systems, 7 iterate on *internal* metrics, **zero LLM-era systems demonstrate an externally validated in-loop oracle**. Verification ladder: formal verifiers / executable tests / physical oracles (strong, rare) → LLM-as-judge / proxy rewards / model opinion (weak, common). "Novelty-as-judged diverges from novelty-as-valid"; "multi-agent debate often reduces to one model grading another." Recommended: **separate initiative and execution from judgment**; disclose attempt counts and the result-selection policy; report abstentions.
- **Computational physics replication as critique** (Grounded autonomous scrutiny): re-executing published workflows yields emergent critique, but the agent must separate *paper errors* from *its own errors* and *irreproducibility gaps* — false positives from misread methods are the main failure.
- **Claim-state designs**: StatefulDiscovery (claims form → promote → soft-retract → stabilize under evidence; contradictions move a claim to "uncertain", never binary rejection); the Calibration Turn (five claim-strength levels each licensed by a stated evidence class; abstention is a first-class output).
- **Judge agents for simulations** work when they *re-derive* (units, conservation laws, boundary conditions, independent math) rather than read; they fail on novel problem classes and compounding multi-step errors.

## 3. Design patterns that survived contact

1. **Fix the target before the search, and hold it out.** Every system with a real result had an evaluator the searcher could not edit (benchmarks, evaluator cascade, wet lab). Where the searcher could grade itself (Sakana, tournaments of self-critique) the results did not survive external evaluation.
2. **Breadth beats insight when the evaluator is real.** 150 attempts vs one; Flash for breadth, Pro for depth; portfolios of hypotheses rather than one (Lossfunk's own fix for implementation drift).
3. **Two monitors, not one reviewer**: a pre-run monitor on the *method* (constraints) and a post-hoc monitor on the *transcript* (cheating), with an artifact-aware judge that reads the run directory, not the report.
4. **Compare the report to the run directory** — mechanically. The single most common failure (82.5 %) is a diagnosed flaw that never changes the conclusion.
5. **Preregister and log everything**; report attempt counts and the selection policy; separate code generation from execution so verification hooks exist.
6. **Claims carry evidence-licensed strength and can abstain.** Contradiction is a state, not a deletion.
7. **Humans at the judgment boundary, continuously** — idea selection, kill decisions, final edits; every successful system had them, and framed the machine as the searcher.

## 4. Where Luxas already stands (honest mapping)

| pattern | Luxas today | gap |
|---|---|---|
| held-out target | `frame.md` headline ids; blind replicator; anchored-leg rule | frame ids not frozen (producers coined near-misses twice); no held-out *data* exists in open questions — the replicator is the only substitute |
| breadth | one experiment per question | no K-variant discriminators on a disputed row |
| pre-run monitor | `tool_review` is post-code; PI plan review optional | nothing vetoes an Evidence Contract before compute (E2's bit-identical "cross-validation" ran) |
| post-hoc monitor | wiring veto (1e-6), transcript-anchored errors, value-match, sign/answered rules | no anchor-exfiltration check (computed value = anchor to 1e-6 with no producing script), no best-of-N detector (job registry vs reported run) |
| report vs run directory | `reportIntegrityIssues` (claims.json ↔ results.json, captions, figures), finish batch | experiment ledger vs results.json prose is not compared; the reviewer's own "revise" findings are not required to change the ledger |
| preregistration | Evidence Contract, `cross_validation_plan` with frozen tolerance, `DISCRIMINATOR` pre-registration | not timestamped/hashed; deviations not reported |
| claim state | `corroborated / converging / indicative / disputed / disclosed / conditional`, supersession, answered flags | no abstention output; no "uncertain" state for a contradicted-but-recovering claim; disclosed count caps at 1 |
| judgment boundary | operator escalation files, `--directive`, countersign | discontinuous: end-of-run files, not a queue |
| logging/selection policy | usage.log, log.jsonl, jobs/, review files | attempt counts and the selection policy are not in the report's Methods |
| cost | $95–128 per project, 30 % review, 23 % figures | no breadth budget; review spend not proportional to load |

## 5. Questions for the debate

Q1. Should Luxas add a **pre-compute method monitor** (allow/deny on the Evidence Contract), and what would it check that `tool_review` cannot?
Q2. **Breadth**: K parallel cheap discriminators on a disputed headline row vs one deep experiment — cost, and how the table arbitrates.
Q3. Which **cheating detectors** are worth building on existing artifacts (anchor exfiltration, best-of-N, test-mode runs reported as full)?
Q4. Should the **experiment_reviewer's "revise" findings be binding** — i.e. the ledger section cannot stay `Complete` while the reviewer's flagged flaw is unaddressed (the 82.5 % failure)?
Q5. **Abstention** as a claim state and a report output: when should the system say "we could not determine X" instead of disclosing?
Q6. **Operator queue** during the run vs end-of-run escalation.
Q7. Which of these are prompts (methodology) vs infrastructure (gates), per CLAUDE.md's rule that mandatory infra gates get performed around?
