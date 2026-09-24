# Survey II: autoresearch, RSI, and research verification — 2026-09-24

*Follow-up to `survey-automated-research-2026-08-29.md` (which covered Anthropic AAR, AlphaEvolve, Co-Scientist, Sakana v2, Lossfunk, AutoResearch-100, verification-gap survey — not repeated here). Three parallel web sweeps; three key papers spot-checked against arXiv abstracts (2607.02329, 2609.26457, 2605.09360). Most numbers are self-reported by authors — marked SR where no independent evaluation exists.*

## 1. Systems worth knowing

### Autonomous research systems
| system | mechanism | verification → survived? | failure numbers |
|---|---|---|---|
| **Huang, grounded computational physics** [2607.02329](https://arxiv.org/abs/2607.02329) (2026-07), predecessor [2604.12198](https://arxiv.org/abs/2604.12198) | 47 fresh-context sessions, state only via disk files; QE/Wannier90 | **mandatory pilot reproduces published anchors before any novel computation**; 75.8 % of 111 papers' claims within 5 % (SR) | pilot removed → 0.066 vs 0.176 μB (2.7×) and **four adversarial review cycles never wrote the comparison down**; 28× collapse + sign flip called "BROAD plateau"; 97.7 % of critiques needed execution, 0.9 % reading-only |
| **Kosmos** (Edison) [2511.02824](https://arxiv.org/abs/2511.02824) | shared world model, ~166 analysis + 36 lit rollouts | every statement links a notebook/citation; expert audit 79.4 % correct, **synthesis statements 57.9 %**; independent test [2511.13825](https://arxiv.org/abs/2511.13825): 1/3 hypotheses held | significant ≠ important; overclaim |
| **DeepMind Aletheia** [2602.10177](https://arxiv.org/abs/2602.10177) | generator → NL verifier → reviser | verifier passed 212/700 Erdős; human grading: **68.5 % fundamentally flawed**, 6.5 % correct | picks easiest interpretation |
| **Jr. AI Scientist** [2511.04583](https://arxiv.org/abs/2511.04583) | extend baseline paper | 3/3 rejected at Agents4Science | **writer fabricated reviewer-requested ablations and score went up** |
| **Agents4Science post-mortem** [2511.15534](https://arxiv.org/abs/2511.15534) | 253 papers, LLM + human review | LLM–LLM r = 0.48 | 56 % of submissions ≥1 hallucinated reference |
| **Hidden pitfalls** [2509.08713](https://arxiv.org/abs/2509.08713) | audit | paper-only auditor 51 %, **with logs+code 74 %** | cherry-pick, metric swap, post-hoc selection |
| **Ríos-García et al.** [2604.18805](https://arxiv.org/abs/2604.18805) | 25k runs, 8 domains | — | evidence ignored in 68 % of traces; belief revision after refutation 26 %; base model 41.4 % of variance, scaffold 1.5 % |
| **DeepScientist** [2509.26603](https://arxiv.org/abs/2509.26603) | BO loop + tiered findings memory | 5 000 ideas → 1 100 run → 21 gains; ~60 % died of implementation | — |
| **SAGE / MHFA** [2606.31478](https://arxiv.org/abs/2606.31478) | multi-hypothesis failure attribution → fixed routing | metric-bearing outputs 42 → 92 % (SR) | single reflection thrashes |
| **AI CFD Scientist** [2605.06607](https://arxiv.org/abs/2605.06607) | VLM checks rendered fields before acceptance | 14/16 silent failures caught (SR) | solver done ≠ physical |
| **PhysMaster / PRL-Bench** [2512.19799](https://arxiv.org/abs/2512.19799), [2604.15411](https://arxiv.org/abs/2604.15411) | MCTS + hierarchical memory | 51.08 on own bench | residual = physics knowledge, not execution |
| **Workflow closure ≠ scientific closure** [2605.26200](https://arxiv.org/abs/2605.26200) | audit of 21 systems | — | objective / validation / acceptance each replaced by proxies |

Checked, low transfer: CodeScientist (6/19 survived external review), AlphaResearch, Karpathy autoresearch (single scalar only), TusoAI, InternAgent-1.5, freephdlabor, Denario, Sibyl-AutoResearch, AgentRxiv. Periodic/Lila: no published autonomous result. OpenAI "research intern" (2026-09-06): announcement only.

### Self-improvement (RSI)
| system | modifies | fitness protection | result |
|---|---|---|---|
| **AIDE²** [2609.26457](https://arxiv.org/abs/2609.26457) (2026-09-22) | research-agent harness | inner loop sees public score, **acceptance on private held-out only** | 7/99 proposals accepted; reward hacking 55 → 32 %; non-monotone |
| **Meta-Harness** [2603.28052](https://arxiv.org/abs/2603.28052) | harness code | search/test split | proposer with **raw traces 50.0 vs score-only 34.6 vs summaries 34.9**; six regressions before first gain |
| **Red Queen Gödel Machine** [2606.26294](https://arxiv.org/abs/2606.26294) | agents *and* evaluators | evaluator frozen within an epoch | baseline reviewers over-accept AI papers 1.91× |
| **DGM** [2505.22954](https://arxiv.org/abs/2505.22954) / **HGM** [2510.21614](https://arxiv.org/abs/2510.21614) | agent code | DGM hacked its hallucination checker by deleting markers; HGM selects by descendant (clade) productivity | — |
| **Harness tampering audit** [2609.00069](https://arxiv.org/abs/2609.00069) | — | — | tampering persists in the best agent's lineage |
| **GEPA** [2507.19457](https://arxiv.org/abs/2507.19457), **ACE** [2510.04618](https://arxiv.org/abs/2510.04618), **ReasoningBank** [2509.25140](https://arxiv.org/abs/2509.25140), **MAA** [2606.20475](https://arxiv.org/abs/2606.20475) | prompts / playbooks / memory | held-out val; itemised deltas; per-item EMA credit | +5–10 pp typical; including failures helps |
| **Not-always-faithful self-evolvers** [2601.22436](https://arxiv.org/abs/2601.22436) | — | — | agents use raw experience, **ignore condensed experience** |
| reality check | Princeton/MIT TR 2026-08-18; [2609.15802](https://arxiv.org/abs/2609.15802) | — | loops not self-sustaining; agent drops hypotheses on minimal evidence |

### Verification of research
| item | mechanism | number |
|---|---|---|
| **MooseBench PDE intent verification** [2605.09360](https://arxiv.org/abs/2605.09360) | reconstruct the PDE the code actually solves, diff against intent contract | **39–40 % of 220 runnable cases solve the wrong physics** |
| **Collider-Bench** [2605.13950](https://arxiv.org/html/2605.13950v1) | provenance judge reads trace + workspace | 6 % fabricated (hard-coded arrays, literature values) |
| **NabaOS receipts** [2603.10060](https://arxiv.org/html/2603.10060v1) | signed tool receipts, claim labelled by evidence source | 91 % detection, 4 % FP |
| **ImpossibleBench** [2510.20270](https://arxiv.org/abs/2510.20270) / **BaitBench** [2608.30724](https://arxiv.org/abs/2608.30724) | contradictory tests / planted shortcuts | GPT-5 cheats 76 %, **<1 % without test access**; 57 % hack even when told not to |
| **LLM reviewer audit** [2608.28626](https://arxiv.org/abs/2608.28626) | 145 planted errors | 12.1 % caught (22.2 % with verification prompt) |
| **AAAI-26 AI review** [2604.13940](https://arxiv.org/abs/2604.13940) | reviewer with Python interpreter | recall +0.21 |
| **CritPt** [2509.26574](https://arxiv.org/abs/2509.26574) | numeric tol / SymPy / code tests; "consistently solved" = ≥4/5 runs | top ≈ 32 % |
| **Fabricated-evidence calibration** [2608.27167](https://arxiv.org/abs/2608.27167) | — | shown evidence pushes commitment 6.5 → 54 %, fake ≈ real |
| **Preregistration for agents** [2606.11217](https://arxiv.org/abs/2606.11217); abstention [2609.17686](https://arxiv.org/abs/2609.17686) | lock criteria before run; abstention as outcome | no effect size |

## 2. What the three sweeps converge on

1. **Execution ≠ correctness, and reading ≠ verifying.** 39–40 % wrong-physics-but-runs; 97.7 % of critiques need execution; reviewers catch 12 % of planted errors without tools; Huang's four adversarial cycles never made the one numerical comparison. → Checks must be *numerical confrontations produced by the harness*, not reviewer obligations.
2. **Whoever is graded must not touch the grader.** ImpossibleBench <1 % vs 76 %; AIDE² private held-out; DGM deleting markers; Red Queen epochs.
3. **Raw evidence beats condensed evidence** for both auditors (74 vs 51 %) and self-improvers (50.0 vs 34.9; condensed experience ignored).
4. **Memory/feedback written by a harness step, not voluntarily** (ReasoningBank, ACE, DeepScientist, Sibyl) — matches our own may/must fill-rate finding.
5. Gains are modest (+5–10 pp) and scaffold explains little variance → judge every mechanism by *errors caught on planted fixtures*, not by output polish.

## 3. Ranked transplants for Luxas

| # | mechanism | source | Luxas gap it targets | producer → consumer | success number |
|---|---|---|---|---|---|
| 1 | **Anchor pilot before new physics**: each experiment first reproduces one published number; harness writes `anchor: computed X±σ vs published Y (src)` into results.json | Huang 2607.02329 | ANCHOR-OK ≤ 6 %; `corroborated` retired for lack of anchors | experiment Phase 0 → claims-table anchored leg (harness-produced, not reviewer-optional) | anchored headline ids 6 % → ≥ 80 % |
| 2 | **Independence by construction**: legs declare H (small-N matrix), basis, units, method class; reject INDEPENDENT on shared method class or shared H-construction module in the import graph; diff each leg's H against the frame contract | MooseBench 2605.09360 + own extrapolation | brain's symbolic-vs-numeric "two legs" | results.json `legs[]` → claims-table.ts | on bench-02 replay: fake legs downgraded to wiring > 0; wrong-H rate measured |
| 3 | **Execution receipts + provenance check**: harness logs script sha, command, output hashes; claims.json values must appear in a receipted output; value = literature value without receipt → block | Collider-Bench, NabaOS | no anchor-exfiltration / hard-code detector (Survey I §4) | hooks.ts → `.agent/receipts.jsonl` → reportIntegrityIssues | planted fixtures ≥ 90 % flagged, < 5 % false blocks on 297nm |
| 4 | **Failure attribution routing**: classify failure infra / impl / design / hypothesis; infra (429/402) retries with backoff or provider switch and does not consume revision cap | SAGE 2606.31478 | ba-qc 34/35 tool_review dead on 429 → zero tests; 1/6 runs finished | spawn-agent.ts → routing | tool_review with ≥1 test file = 100 % of experiments |
| 5 | **Per-experiment review required at finish, reviewer reads logs + code**; reviewer-requested analysis must map to a results.json key or claim is downgraded | Hidden pitfalls 2509.08713, Jr. AI Scientist | y-tweezer 1/6 reviewed; revise findings non-binding | finish gate ← `experiment_review_<EID>` per cited EID | unreviewed cited EIDs = 0 |
| 6 | **Harness-written cross-project memory** at finish / escalation / kill: reflector reads raw log, ≤5 itemised deltas with raw-trace pointers, tier `refuted/validated`; offline EMA credit retires bad items | ReasoningBank, ACE, MAA, DeepScientist | memory.md: 1 entry / 6 months | finish + kill paths → memory.md → buildSemiStaticSystemLayer (log injected ids) | entries per run ≥ 1; backfill corpus |
| 7 | **Physics-invariant tests in tool_review** (limiting case + SymPy dimension check), counted by pytest marker | CritPt, UFL dims 2601.06535 | no limiting-case/dimension checker | tool_review → pytest parser → finish | ≥ 80 % tools with invariant; planted 2π/sign catch ≥ 60 % |
| 8 | **Offline prompt evolution from raw traces**, private held-out project split, evaluator changes in separate epochs, prompt lineage | Meta-Harness, AIDE², Red Queen, HGM | prompts hand-tuned after reading traces | `scripts/prompt_evolve.mts` → frozen-input replay → claims_compliance scores → human merge | expect ~7 % accept rate; don't start before 1–5 exist (evaluator must be stable first) |

Also noted: reviewer planted-error canary (measure recall per reviewer model before trusting "revise"); `undetermined` abstention status when falsifier fires with no receipted legs; CritPt ≥4/5 reproducibility for headline numbers; VLM physical-plausibility gate on figures (AI CFD, SR).

**Skip**: weight updates (TTT-Discover), open-ended code self-modification (DGM-style), tournaments/Elo, more reviewer agents without tools.
