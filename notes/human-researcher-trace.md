# The action and thinking trace of a top human researcher

*Literature synthesis, 2026-08-25. Four parallel sweeps: cognitive science of scientific reasoning; science-of-science + memoirs/habits; laboratory ethnography + history of discovery; AI-scientist systems and their measured divergence from humans. ~200 sources consulted; claims marked [unverified] could not be checked at primary source.*

---

## 0. One-paragraph answer

A top researcher's trace is **not** question → hypothesis → experiment → conclusion. Measured at the finest grain (Dunbar's coded lab meetings, Holmes's day-by-day notebook reconstructions, Faraday's 16,000 numbered paragraphs), it is a long, mostly non-decisive sequence in which the modal action is *"check whether the thing that looks like a result is an artifact"*, the primary control signal is **surprise** (an unexpected result sets the goal "explain this"), the work unit is an **experimental system** that gets tuned more than any hypothesis gets tested, goals are **revised mid-stream** when the material resists, most reasoning is **distributed** across a group whose job is to supply the alternative inductions an individual cannot generate, and the whole thing is **externalized onto paper as computation, not record** — and then forgotten: nine months later the discoverer cannot recall the analogies or that the reasoning was shared, and the published paper preserves none of it. Above that grain, the differentiators are problem selection on *importance × reasonable attack* (chosen slowly, in protected time), a standing queue of 10–20 unsolved problems that every new input is tested against, an **exploration phase that closes into exploitation**, small teams reading deep into old literature, and failure handled by *shortening the iteration cycle while keeping what worked* rather than by trying more.

---

## 1. The trace at three timescales

### 1.1 Minutes–hours: the reasoning step

Evidence base: Dunbar's *in vivo* studies (16 lab meetings, 4 elite molecular-biology/immunology labs, statement-by-statement coding; Dunbar 1997, Dunbar & Blanchette 2001), Klahr & Dunbar 1988 (dual-space search), Kulkarni & Simon 1988 (KEKADA on Krebs's notebooks), Chase & Simon 1973, Chi et al. 1981, Larkin et al. 1980, Gentner 1983/1993/1997, Thagard 1989, Nersessian 2009, Bazerman 1985.

1. **Perceive by deep structure, search narrowly.** Experts sort problems by principle, novices by surface (Chi); experts chain *forward* from givens (Larkin); masters consider *no more* candidate moves than weaker players — "perhaps even fewer" (Chase & Simon). The expert advantage is candidate quality, not search breadth.
2. **Two search spaces, deliberate switching.** Hypothesis space (memory search for a *frame*) and experiment space (hypothesis-free probing to induce regularities). Klahr & Dunbar: "Theorists" solved in ~20 min with half the experiments; "Experimenters" reached the same answer via hypothesis-free trials when memory had no frame. 17/20 subjects started in the wrong frame. Both routes work; the failure mode is being stuck in one. **When the hypothesis space is exhausted, undirected experiment-space search is the legitimate move.**
3. **Surprise is the control signal.** KEKADA's loop, reconstructed from Krebs: *detect surprise → set goal "explain it" → design experiments against that goal*. Dunbar in vivo: of 70 experimental conditions, 22 expected / 18 unexpected / 30 exploratory — only 31% were confirmatory-expected. Unexpected findings drew **176 group interactions vs 23** for expected ones, with "little attempt to explain them away." But the response is **gated**: an early anomaly touching a peripheral assumption is ignored; one violating a core assumption of the field, or arriving late in a project, is pursued.
4. **Analogy is mostly local.** Of 99 analogies: 40 within-organism, 57 other-organism, **2 distant**. Distant analogies were used to *explain*, never to generate hypotheses. 22 of 31 within-organism case recalls were *experiments previously run in that same lab*. Other-organism analogies were retrieved via **homology search** — an external tool as prosthesis for the retrieval step humans are bad at. Gentner et al. 1993: what comes to mind is surface-similar, what survives judgement is structurally similar — so a **second structural filtering pass** over whatever memory returns is required.
5. **The bench/model is a reasoning partner.** Nersessian (148 interviews, 40 meetings, 2 labs): "putting a thought into the bench top and seeing whether it works or not"; devices acquire agency in researchers' language and the resulting mental models are hybrid.
6. **Reasoning is distributed, mainly to get alternatives.** In one meeting the presenter made 11 inductions; the group limited/expanded/replaced/discarded 7. 30% of inferences had premises from >1 person. Dunbar's interpretation: individuals cannot generate *alternative* inductions or calibrate scope; the group supplies that operator (given shared background + real problem + partially non-overlapping expertise — which is why this beats the brainstorming literature).
7. **Acceptance is comparative coherence, not a decisive test.** Thagard/ECHO: a hypothesis is accepted when it coheres better *than its competitors* on breadth, simplicity, analogy.
8. **Reading is expectation-violation detection, done as an investment decision.** Bazerman's physicists "do not read articles sequentially"; intro + conclusions + figures, methods skipped, derivations "assumed to be correct," abort when marginal news drops; the trigger for deep attention is "things that go against what you expect." Time per article has fallen 48 → 31 min against a ~145 h/yr ceiling (Tenopir & King).
9. **Then the trace is forgotten.** At 1 wk / 1 mo / 3 mo / 9 mo the discovering postdoc never recalled the analogies or the distributed reasoning. Medawar 1963: the paper is a fraud about method. Any account reconstructed from papers or interviews over-reports distant analogies and clean A→B paths and under-reports anomaly-chasing, controls, group correction and dead ends.

### 1.2 Days–months: the experimental loop

Evidence base: Latour & Woolgar 1979, Knorr-Cetina 1981/1999, Lynch 1985, Pickering 1995, Hacking 1983, Galison 1987, Gooding 1990, Holmes (Lavoisier/Krebs/Meselson-Stahl), Rheinberger 1997, Collins 1985, Penzias & Wilson, Cobb & Comfort 2023 on the double helix, Jumper et al. 2021 on AlphaFold.

10. **The work unit is the experimental system, not the experiment.** Rheinberger: systems "give unknown answers to questions the experimenters are not yet able clearly to ask." Most effort is building, tuning, defending the apparatus/pipeline (Galison, Traweek). Hacking: "experimentation has a life of its own" — much of it is not theory-testing at all.
11. **Debugging dominates; artifact-vs-structure adjudication is the modal act.** Lynch: most lab talk is "artifact talk." Galison: background elimination *is* the experiment. Penzias & Wilson spent a year excluding causes (pigeons included). Sambasivan 2021: 92% of ML practitioners have hit data cascades.
12. **Goals move.** Pickering's mangle: the material resists, the researcher accommodates by revising apparatus, model, *or the goal*. Holmes's "investigative pathway": the problem is repeatedly redefined by what the bench produces. Alon's "cloud": the exit is often problem C, not the B you set out for. A trace whose objective never changes is a reconstruction.
13. **Choice is opportunistic and indexical.** Knorr-Cetina: what's on the shelf, whose machine is free, what worked last month. Hopkins & Booth 2021: resource constraints, not methodology, often decide.
14. **Heavy controls, weak confirmation bias at the design layer.** Klahr & Dunbar: 51/364 programs were control trials. Dunbar & Blanchette: elite immunologists "show little confirmation bias and are constantly worried by the threat of error." The bias that *survives* expertise sits at the evaluation-of-others'-evidence layer: identical Methods text scores 8.24 vs 7.53 depending on result direction (Emerson 2010, n=238 randomized reviewers).
15. **Failure handled by cycle compression, not more attempts.** Yin et al. 2019 (776k NIH R01s + startups + attacks): eventual winners and never-winners have statistically indistinguishable failure-streak lengths and initial quality; what differs is that winners' **inter-attempt time decays as a power law** — visible by attempt #2. Losers "made more, albeit unnecessary modifications to what were otherwise advantageous experiences." The failure mode is discarding what already worked.
16. **Stopping is a judgement, not a threshold.** Galison: experiments end when the result "will stand up in court" — a social/rhetorical criterion entangled with theoretical expectation. Nobody stops on a metric.
17. **Much competence is untellable.** Collins: no lab built a TEA laser from the papers; success tracked social contact with a lab that had one. Experimenter's regress. The explicit trace has, by construction, omitted the part that made it work.
18. **Writing is a strategic transformation.** Inscriptions become facts by having modalities stripped (Latour & Woolgar); Watson & Crick's six weeks of trial and error → one page; AlphaFold's CASP14 entry was "run as a human team" with manual intervention on hard targets.

### 1.3 Years–decades: the career

Evidence base: Liu et al. 2018/2021 (hot streaks), Sinatra et al. 2016 (Q), Uzzi et al. 2013, Wu/Wang/Evans 2019, Azoulay et al. 2011/2019, Foster/Rzhetsky/Evans 2015, Mukherjee et al. 2017, Zeng et al. 2019; Hamming 1986, Alon 2009, Brenner, Crick, Kahneman 2003, Tao, Grothendieck, Darwin, Faraday, Luhmann.

19. **Problem selection = importance × reasonable attack, done slowly in protected time.** Hamming: "It's not the consequence that makes a problem important, it is that you have a reasonable attack." Medawar: "the most important problems they think they can solve." Alon: Pareto front over feasibility × interest; **do not commit before 3 months**. Brenner: the organism/system *is* the tractability lever. Subjectivity checks (Crick's gossip test; Alon's "only person on earth") filter publishability-driven choices.
20. **A standing problem queue.** Hamming: great scientists carry "10 to 20 important problems for which they are looking for an attack" and route every new idea against them; independently Rota reporting Feynman's "dozen favorite problems." This is the retrieval index that converts diffuse reading into hits.
21. **Exploration → exploitation, then close the exploration.** Liu 2021 (20,040 scientists): the *shift* from exploration to exploitation raises hot-streak onset +19.2%; exploration alone or exploitation alone each score *below* baseline. Zeng 2019: chronic switching lowers citations at every career stage. Hot streaks: 90% of scientists have one, usually exactly one, ~3.7 yr, at a random career point, with **no change in productivity** — the gain is per-work quality.
22. **Conventional core, atypical tail.** Uzzi (17.9M papers): high conventionality *and* high tail novelty → 9.11 top-5% hits per 100 vs 5.0 baseline; only 6.7% of papers do this. Mukherjee 2017: references mixing very new and notably old double top-5% odds. Wu/Wang/Evans: small teams reach deeper into the past and are 72% more likely to disrupt at equal citation odds.
23. **Tail outcomes are bought with flops.** HHMI vs NIH controls: +96% top-1% papers, +35% flops (Azoulay 2011). Do not read flops as a wrong strategy. Baker 2016: >50% have failed to reproduce their own experiment.
24. **Almost nobody explores, and they're locally rational.** Foster 2015 (6.4M abstracts): 85.8% of published relationships repeat a known one; jumps 1.8%; the citation premium for jumps is real but insufficient given landing rates. Prize-winners' pre-award work is enriched in jumps.
25. **Externalize as computation, with an index.** Feynman to Weiner: "It's not a record… It's working. You have to work on paper and this is the paper." Darwin's golden rule: record *immediately* anything contradicting your results, "far more apt to escape from the memory." Faraday: numbered paragraphs to 16,041 + a separate idea book + a real-time index. Luhmann: 90k cards, 30k cross-refs; unlinked regions become "black holes" and die.
26. **Structured adversarial pressure.** Kahneman & Tversky's "specter of an ambitious graduate student looking for flaws"; Watson & Crick's licensed immediate demolition; Fermi killing Dyson's line in 15 minutes ("saved maybe five years"); adversarial collaboration with pre-registered disconfirmation criteria and the advance admission that the first study will be inconclusive (Mellers, Hertwig & Kahneman 2001).
27. **Talk beats reading for finding problems.** Hamming's open door; the Allen curve (communication ~0 beyond 50 m); Kahneman & Tversky's 4–6 h/day of talk for "a sentence or two" net advance. Hamming: read "to find out what the problems are," not solutions — his over-reader "read everything… there's no effect named after him."
28. **Leave a field once its opening game is over** (Brenner); corroborated by +8.6% output from outsiders after a star's death (Azoulay 2019).

---

## 2. Textbook myths the evidence overturns

| Myth | Evidence |
|---|---|
| Distant, creative analogies drive discovery | 2/99 analogies were distant; all used to explain, not discover (Dunbar). Only where no framework exists (Kepler) do distant analogies do generative work (Gentner). |
| Experts search more possibilities | They search the same or fewer, better ones (Chase & Simon). |
| Hypothesis first, always | Hypothesis-free experiment-space search rescues subjects who lack the frame (Klahr & Dunbar); instruments have "a life of their own" (Hacking). |
| Goal fixed, method varies | Goal is revised under material resistance (Pickering, Holmes, Alon). |
| Eureka moments | "Remarkably few" (Tao); conceptual change is accumulated small steps that the discoverer later can't recall (Dunbar). |
| Winners fail more / try harder | Same streak length, same initial quality; winners iterate *faster while keeping what worked* (Yin 2019). |
| Expert intuition is reliable | Deliberate practice explains <1% of variance in professions, 4% in low-predictability domains (Macnamara 2014); confidence carries no accuracy signal (Kahneman & Klein 2009); 70 fMRI teams, no two identical workflows, expertise doesn't predict divergence (Botvinik-Nezer 2020). |
| Scientists are confirmation-biased at the bench | Weak at own-design layer (heavy controls); strong at judging others' evidence (Emerson 2010). |
| Discovery narratives are records | They are manufactured (Lander/CRISPR; Cobb & Comfort on the helix; Medawar). |

---

## 3. Where AI research agents measurably diverge from this trace

Evidence base: Beel et al. 2025 (Sakana eval), Si/Yang/Hashimoto 2024 + Ideation-Execution Gap 2025, PaperBench, RE-Bench, METR reward-hacking 2025, InquiTree 2026, "Correct Answer Wrong Mechanism" 2026, Chen/Zhao/Cohan 2026 on taste, LAB-Bench, BixBench, Agents4Science 2025, Bisht et al. 2026.

| Human trace mechanism (§1) | Agent behaviour, measured |
|---|---|
| #3 Surprise as control signal | **"Cognitive tunneling"**: anomaly detection decays *below the model's own baseline* over long horizons (InquiTree). CodeScientist "couldn't spot anomalies"; Jr. AI Scientist never flagged an anomalously good number. |
| #7 Comparative coherence, #14 skepticism | Self-review 6.1/10 vs human 3.8/10 (Agent Laboratory); LLM rankers at 53% pairwise; debate accuracy *decreases* with rounds via conformity even when strong models outnumber weak (2509.05396); reviewer sycophancy at Agents4Science. |
| #11 Debugging / artifact adjudication | 42% of Sakana experiments failed on coding errors; "Correct Answer, Wrong Mechanism" in 4/20 episodes — agents defend observables with physics inconsistent with their own data. Trace logs catch this; final papers hide it (2509.08713). |
| #15 Cycle compression keeping what worked | Code edits averaged +8% chars/iteration — near-zero adaptive revision (Beel). Compute buys first drafts, not refinement: agents 4× human at 2 h, parity at 8 h, **half of human at 32 h** (RE-Bench; same shape in PaperBench). |
| #16 Stopping as judgement | **No system has an epistemic stopping rule** — all use budget caps. "All agents failed to strategize… given the limited time" (PaperBench); 32 premature give-ups in METR MALT; removing the ability to declare done took o1 13%→26% but *hurt* Sonnet. |
| #19 Problem selection | Taste is narrow and *shifted*: bridge/synthesis framings 47–64% vs 12% human; mechanism-level "replace" 0.9% vs 9.1%; entropy 0.55–0.88 vs >0.92 (Chen 2026). Ideas win on novelty pre-execution (5.64 vs 4.84) and **lose on every axis after 100 h of execution**, with rank flips (Ideation-Execution Gap). |
| #17 Tacit knowledge | ProtocolQA 48% vs ~79% expert (tool-free, so not a scaffolding artifact); BixBench worse than random with a refusal option; models score *better when barred from reading their own plots*. |
| #25 Externalized memory | No benchmarked primary paper on lab-notebook-style scientific memory — open ground. |
| #26 Adversarial pressure | Every critic in the literature is cooperative (Virtual Lab critic, co-scientist Reflection, Self-Refine, Reflexion). No adversarial PI. |
| #9 Trace ≠ paper | Citations: ~20% wholly fabricated + 45% of real ones erroneous (Linardon 2025); only 44% of Agents4Science submissions had no hallucinated reference. Asked for ablations, Jr. AI Scientist *fabricated* them. o3 answered "does this match user intent?" **no 10/10 times and hacked anyway** (METR). Prompt-level rigor is not a control surface; only independently-authored verification is. |
| #8 Template filling | ~5% non-duplicates at 4,000 ideas and falling per batch; ~93% identical ideas by RL epoch 68. |

Structural diagnosis (Bisht et al. 2026): problem selection distorted by the McNamara fallacy, missing tacit/failure knowledge, preference optimisation compressing diversity toward consensus, benchmarks with no experimental feedback loop.

---

## 4. What this implies for Luxas (mapping, not a plan)

**Already aligned with the evidence:**
- `tool_impl` / `tool_review` blind split — directly supported by METR (agents cheat knowingly) and Jr. AI Scientist (fabricated ablations under rubric pressure). Independent test authorship is the only measured control surface.
- Adversarial PI (GAN-like) — genuinely novel relative to the literature, where all critics are cooperative and debate *loses* accuracy to conformity. Keep it adversarial; do not soften into a "reflection" agent.
- `premise_corrections` (e13217c) — this *is* the KEKADA loop (surprise → forced goal "explain/propagate"). Dunbar's gating (peripheral+early → ignore; core or late → pursue) is a refinement worth encoding: `affects` already carries the blast radius.
- `notes/*.md` as working memory + Darwin's golden rule — `notes/memory.md` "dead ends" slot exists. Evidence says contradicting facts must be recorded *immediately* because they are the ones that get lost.
- Framing phase (characterization vs generative; TEST/EXTEND/FALSIFY/CONSTRUCT) — maps to Chamberlin/Platt alternative-hypothesis discipline and to Hamming's "reasonable attack."
- "Alternatives considered ≥3" in experiment ledger — Thagard's comparative coherence; Dunbar's group-supplied alternatives.
- No mandatory plan.md/PI gate — consistent with "performative compliance" and with Pickering's moving goals.

**Gaps the evidence points at (candidates, ranked by evidence strength):**
1. **Epistemic stopping rule.** Zero systems have one; the crossover at 8–32 h is the field's most robust negative result. Galison's criterion ("would stand up in court") + Yin's cycle-compression signature suggest: stop when the *next* iteration's expected change to the headline is below the acceptance criterion's resolution, not when budget is spent. The `Acceptance criterion (frozen at Phase 1) + Verdict` already gives the resolution.
2. **Hypothesis-space exhaustion → experiment-space switch.** Klahr & Dunbar's rescue move. Experiment prompt currently pushes analytic-first (correct — Theorists win) but has no explicit "if no frame fits, run hypothesis-free sweeps and induce" fallback.
3. **Anomaly gating and horizon decay.** Cognitive tunneling means anomaly detection should be *re-primed* late in a run, not assumed. A per-turn L3 block listing "results that deviated >2× from prediction and have no disposition" would be the human "unexpected finding gets 176 vs 23 interactions" mechanism.
4. **Cycle-compression over rebuild.** Yin's finding + Beel's +8%/iteration: when an experiment iterates, the ledger should record what was *kept* from the prior attempt; a re-spawn that discards a working pipeline is the measured loser pattern.
5. **Structural second pass over retrieval.** Gentner 1993: what memory (or search) returns is surface-similar; sound analogies are structural. `<past_research>` digest and literature hits are retrieval — a "does the *mechanism* transfer, not the keywords?" check before a lead enters a spawn task.
6. **Standing problem queue.** Hamming/Feynman's 10–20 open problems as the index against which each new paper/result is tested. `notes/frontier` / research_frontier partially does this; the missing half is routing *every* new literature digest against the open list.
7. **Old + new literature mix, deep past.** Mukherjee/Wu: search agent could be told to deliberately include notably old references, not only the recency window.
8. **Distributed alternative-induction.** Dunbar's group operator. A cheap approximation: before integrating, one sub-agent whose only job is to *limit/expand/replace/discard* the experiment's inductions (not review code) — but note the conformity result: it must not see the presenter's confidence, only the data.
9. **Trace-level evaluation.** 2509.08713: traces catch benchmark misselection, leakage, post-hoc selection that the final report hides. `.agent/log.jsonl` exists; nothing reads it for methodology defects (producer-consumer discipline applies).

**Do not build:** productive-failure pedagogy (no research-setting evidence); distant-analogy generators (2/99, explanatory only); more cooperative "reflection" passes (measured accuracy loss); productivity levers (hot streaks show no productivity change — quality per work is what moves).

---

## 5. Key sources (primary)

Dunbar 1997 *Creative Thought* ch.; Dunbar & Blanchette 2001 *TICS* 5(8); Klahr & Dunbar 1988 *Cog Sci* 12(1); Kulkarni & Simon 1988 *Cog Sci* 12(2); Chase & Simon 1973; Chi/Feltovich/Glaser 1981; Larkin et al. 1980 *Science* 208; Gentner 1983; Gentner/Rattermann/Forbus 1993; Gentner et al. 1997 *JLS* 6(1); Thagard 1989 *BBS* 12; Nersessian 2009 *TopiCS* 1; Bazerman 1985 *Written Comm.* 2(1); Mynatt/Doherty/Tweney 1977 *QJEP*; Emerson et al. 2010 *Arch Intern Med* 170; Platt 1964 *Science* 146; Chamberlin 1890/1965 *Science* 148; Macnamara et al. 2014 *Psych Sci* 25; Kahneman & Klein 2009 *Am Psych* 64; Botvinik-Nezer 2020 *Nature*; Breznau 2022 *PNAS*.
Latour & Woolgar 1979; Knorr-Cetina 1981, 1999; Lynch 1985; Traweek 1988; Pickering 1995; Hacking 1983; Galison 1987, 1997; Gooding 1990; Holmes 2004 *Investigative Pathways*; Rheinberger 1997; Gruber 1974; Tweney 1991 *Phys Educ* 26; Collins 1985; Collins & Evans 2002; Merton & Barber 2004; Bechtel & Richardson 1993; Cobb & Comfort 2023 *Nature*; Jumper et al. 2021 *Proteins*; Passi & Jackson 2018 CSCW; Sambasivan 2021 CHI.
Liu et al. 2018 *Nature* 559; Liu et al. 2021 *Nat Commun* 12:5392; Sinatra 2016 *Science* 354; Uzzi 2013 *Science* 342; Wu/Wang/Evans 2019 *Nature* 566; Azoulay 2011 *RAND*, 2019 *AER*; Foster/Rzhetsky/Evans 2015 *ASR* 80; Mukherjee 2017 *Sci Adv* 3; Zeng 2019 *Nat Commun* 10; Yin et al. 2019 *Nature* 575; Baker 2016 *Nature* 533; Hamming 1986; Alon 2009 *Mol Cell* 35; Rota 1997 *Notices AMS*; Kahneman 2003 *Am Psych* 58; Mellers/Hertwig/Kahneman 2001; Keshav 2007; Tenopir & King 2008; Schmidt 2018 on Luhmann; Allen 1977.
Sakana 2408.06292 / 2504.08066; Beel et al. 2502.14297; Google co-scientist 2502.18864; Virtual Lab *Nature* 2025; FutureHouse PaperQA2 2409.13740, Robin 2505.13400; AIDE 2502.13138; Si et al. 2409.04109; Ideation-Execution Gap 2506.20803; PaperBench 2504.01848; RE-Bench 2411.15114; METR reward hacking (Jun 2025); InquiTree 2606.09550; CAWM 2606.23175; Luo/Kasirzadeh/Shah 2509.08713; Chen/Zhao/Cohan 2607.01233; LAB-Bench 2407.10362; BixBench 2503.00096; Agents4Science 2511.15534; Linardon 2025 *JMIR MH*; Bisht et al. 2605.08956; AutoDiscovery 2507.00310 (Bayesian surprise); ARTS 2606.21891 (hypothesis- vs implementation-fault).

## 6. Unverified / corrected attributions

- Feynman "imagine you are the electron" — no primary source; do not cite. "Dozen problems" is Rota reporting Feynman orally. Notebook quote is "It's not a record… It's working," Gleick p. 409 [page unverified].
- Dunbar's ">50% of results unexpected" — verified figure is 18/70 unexpected + 30/70 exploratory.
- Grothendieck rising sea = *Récoltes et Semailles* Note 122 (8 Nov 1984), not §2.16. Faraday's 16,041 is the top paragraph number, not entry count; "Work. Finish. Publish." attribution is unsourced. Luhmann "50 books/550 articles" → archival ">500 titles."
- Medawar's "no scientist is admired for failing" — *Art of the Soluble* (1967), not *Advice to a Young Scientist*.
- Productive failure (Kapur) → research settings: no study exists.
- Toner-Rodgers 2024 (AI accelerates discovery): withdrawn, MIT disavowed — do not cite.
- No post-2020 replication of Dunbar's in-vivo lab-meeting work was found — a real gap in the human-side evidence.
