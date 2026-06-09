# Adjudication log — disagreement resolution

> **Required artifact.** Universal blind spot in 31/31 CS surveys, ~12/30
> biology reviews, ~9/30 physics reviews — fence-sitting on contradictions.
> Cleanest novelty axis the autonomous agent can exploit: maintain a
> public log of every cross-source disagreement and the resolution
> applied. Mirrors Copernicus open-review model where adjudication
> becomes a public artifact (the only journal mode that produces
> externally auditable disagreement records).

## Per-disagreement entry

For every cross-source contradiction encountered during literature review,
benchmark verification, or claim extraction, append an entry below.

```markdown
## D<N> — <one-line topic>

- timestamp: <ISO>
- topic: <short description, e.g. "AI-Researcher repo discovery capability">
- source A: <citation key>, claim: "<verbatim quote from source A>"
- source B: <citation key>, claim: "<verbatim quote from source B>"
- contradiction: <what specifically conflicts; setups / definitions / numbers>
- resolution policy applied: <one of:>
  - ruling — pick a side with reasoning
  - currently-unresolved — name experiment that would resolve
  - escalate-authority-bound — disagreement requires modifying RESEARCH.md
  - methodological-difference — both sides correct under their own assumptions; report both with provenance
- verdict / ruling: <verbatim ruling text>
- evidence path: <file:line citations supporting the ruling>
- resolver: <agent id; e.g. brain / experiment-E1 / experiment_reviewer>
```

## Worked examples

```markdown
## D1 — AI-Researcher claimed "sophisticated filtering algorithms"

- timestamp: 2026-05-02T11:23:00Z
- topic: AI-Researcher repo discovery
- source A: Tang2025 (paper abstract), claim: "sophisticated filtering algorithms select repositories based on star count, description relevance, and update recency"
- source B: own E1 audit of HKUDS/AI-Researcher source code, claim: "code_search.py implements GitHub Search API call with date filter only; quality assessment is delegated to an LLM prompt instructing the agent to prefer repos with more stars"
- contradiction: paper claims algorithmic filtering; code reveals LLM-prompt-only approach
- resolution policy applied: ruling
- verdict / ruling: Source B (source code) is authoritative. The paper's "sophisticated filtering algorithms" framing is over-claim; the implementation is a single GitHub API call with date filter, with quality scoring outsourced to an LLM prompt. The survey reports this as Partial / Refuted on the autonomous-discovery dimension.
- evidence path: data/experiments/E1_airesearcher_audit/runs/run_1/results.json:claim_verification.repo_discovery
- resolver: experiment-E1
```

```markdown
## D2 — Aletheia accuracy: 4 Erdős solved vs 6.5% on 700-problem eval

- timestamp: 2026-05-02T12:30:00Z
- topic: DeepMind Aletheia overall capability
- source A: Feng2026Aletheia, claim: "solved 4 Erdős problems autonomously"
- source B: Feng2026AletheiaFirstProof, claim: "6.5% accuracy on 700-problem systematic evaluation"
- contradiction: same system, dramatically different success rates
- resolution policy applied: methodological-difference
- verdict / ruling: Both true under their own setups. The 4-Erdős result is on hand-curated, system-friendly problems; the 6.5% is a representative-sample stress test. Report performance as bimodal: brilliant on a small subset, ineffective on most.
- evidence path: notes/literature.d/Feng2026Aletheia.md:headline_findings, notes/literature.d/Feng2026AletheiaFirstProof.md:systematic_eval
- resolver: brain
```

## What this artifact replaces

- The fence-sitting phrase "some authors find X, others find Y; further
  work is needed" — banned per SKILL.md §6c. Every such instance must
  produce a D<N> entry instead.
- Silent inheritance of the more favorable / more recent number when
  multiple primary sources disagree.

## Linking back to the report

Every section of the report that draws on a contradiction-resolved claim
must include a footnote or parenthetical pointer to the relevant D<N>
entry, e.g.:

> "AI-Researcher's repo discovery is best characterized as Partial:
> implementation uses single GitHub API call with date filter, with
> quality assessment LLM-mediated rather than algorithmic [adj. log D1]."
