# Blind adversarial auditor: stage 1 result (2026-09-24)

**Setup.** Six finished runs that have a report.tex (bench02 has none). One fresh auditor per run with only `auditor-prompt.md`, a generic method: find the headline quantities, check each quantity's identity and completeness, estimate it independently, compare the report against the run's own evidence, check matched comparisons and independence. The auditors had no access to the backtest notes or the local repo; the backtest files were moved out of the shared scratchpad before launch. A separate scorer per run (`scorer-prompt.md`) matched findings to the backtest ground truth (`../bt-*.md`) and independently verified every unmatched finding on the droplet. Auditor and scorer model: Claude Opus 5.5 (Claude Code subagents), **not** the Luxas production stack.

## Numbers

| run | report-reaching defects found (strict / ½-partial) | headline-flipping defects found | new true defects G missed | false | unverifiable | BREAKS that are real |
|---|---|---|---|---|---|---|
| 297nm | 4 / 4.5 of 8 | 4 of 4 (E5 phase, pulse-shape "suppression", sin⁴θ, "power-cheap") | 5 | 0 | 2 | 4/4 |
| ba-qc | 3 / 3.5 of 5 | both (scattering, n-independent Ω) | 6 | 0 | 0 | 3/3 |
| y-tweezer | 5 / 6 of 8 | light shift, magic mask, 15 % leak, hyperfine gap | 7 | 0 | 0 | 5/5 (1 over-rated) |
| y-magic | 3 of 4 | f-sum bound, 2× continuum | 5 | 1 | 0 | 2/2 |
| XUV | 2 of 2 | σ omission, fake independence | 5 | 0 | 3 | 1/1 (over-rated) |
| pp-vs-ss | 3 / 3.5 of 6 | both (unmatched baseline, C6 zero absent at 2 µm) | 3 | 1 | 0 | 2/2 |
| **total** | **20 / 22.5 of 33 (61–68 %)** | **essentially all** | **31** | **2 of 59 findings (3 %)** | 5 | **17/17** |

The survey mechanisms M1–M7 caught about 3 of the ~13 headline defects mechanically (`../SUMMARY.md` §1).

## What it misses
- **Bookkeeping and provenance**: claims.json keys, the circular Numerov anchor (297 D5), 99.89 vs 99.909 consistency, σ copied from PI guesses, "human decisions" wording.
- **Defects that live only in superseded runs.** This is by design: a pre-finish auditor sees the final state.
- **Scaffold timing**: the y-magic headline flip was never reviewed.
- One repeated backwards claim (pp-vs-ss 60P lifetime) and one wrong branching assumption.

## Where it corrected our own ground truth
- ba-qc D2 was *not* fixed: the total-error numbers still use n-independent Ω, so the abstract's "3× better in total" is stale.
- In pp-vs-ss the C6 zero does not exist at 2 µm (+158 MHz from the run's own diagonalization); the backtest called it an unverified inference.
- y-tweezer: the filtered roots were anti-trapping, so the real gap is the missing upward terms in the excited-state SOS.
- ba-qc lifetime is 0.267 ms, outside the reported bracket.

## Cost
115–182 k tokens and 4–21 min per run (median ≈ 8 min), against runs costing $58–160.

## Caveats (why this is stage 1, not a decision)
1. **Model.** These are Opus 5.5 results. Production would run on the Luxas roster, where `claude-opus-5` refuses the review shape (`spawn.ts`) and the current reviewer tier is opus-4-6, which endorsed all of these defects as PI and reviewer. Whether the catches come from the *prompt* or the *model* is untested.
2. **Overfitting.** The method prompt names the three defect patterns found in these same seven runs. A holdout (older runs with no ground truth) can measure precision only.
3. **Consumer.** Finding a defect is half the job. Ship it together with the brain's obligation to act on findings, bounded so it cannot deadlock finish, per the producer–consumer rule. The 82.5 % "diagnose, then report unchanged" failure from Survey I applies directly.
