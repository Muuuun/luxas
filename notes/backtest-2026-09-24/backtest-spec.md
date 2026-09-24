# Backtest spec: would the proposed mechanisms have caught the defects in past Luxas traces?

## Goal
Decide, from real trace evidence, which of 7 candidate mechanisms would actually have caught research-quality defects in past Luxas runs. We build only what catches real defects. Your job is one project (or two). Be an honest counterfactual auditor, NOT an advocate.

## Access (read-only!)
- `ssh luxas` (user muqiao). Projects under `/Users/muqiao/Documents/sisyphus-projects/`. Always use absolute paths / `cd` inside the ssh command. Remote shell is bash; local shell is zsh (unquoted $VAR does not word-split locally).
- **NEVER** modify, move, or delete anything on the droplet. **NEVER** run `luxas`, `npx`, any python experiment, or anything that bills. No `pkill`. Reading files, grep, jq, python one-liners that only read are fine.
- Do NOT copy `data/papers/`. Analyze on-box.
- Useful artifacts per project: `notes/{experiments.md,frame.md,plan.md,memory.md,lessons.md,literature.md}`, `notes/escalations/*.md`, `notes/directives/`, `reviews/*.md` (pi_feedback.md, experiment_review_*), `data/experiments/<EID>/{scripts,tests,runs/run_N/results.json}`, `report/{report.tex,claims.json}`, `.agent/{log.jsonl,usage.log,conversations/,jobs/}`.
- Local repo (for code context only): `/Users/muqiao/Documents/Sisyphus` (src/, notes/architecture-review-2026-08-26.md, notes/route-confession-2026-09-22.md, fixtures/).

## Step 1 — Defect catalog
List every **research-quality defect** in the project that has **ground truth**, meaning at least one of:
(a) a later experiment, operator directive, escalation note, reviewer/PI finding, or supersession explicitly established it was wrong, and you checked that the finding is sound;
(b) you can establish it yourself definitively from the artifacts (e.g. a script computes a different observable than its label; a stored scalar contradicts the script's own inputs; a value is hard-coded; units/σ mislabeled; two "independent" legs import the same Hamiltonian builder).
Also list **process defects that damaged research quality**: an experiment never independently reviewed, tests never written, a run that could not finish, or a reviewer finding that was raised and then ignored.
Do NOT list vague "could be better" items. Aim for completeness over the headline quantities. 3–15 defects is typical.

For each defect record: id, one-line description, where (file:line or artifact), which agent + which model produced it (check `.agent/usage.log` / conversations / jobs), whether it reached report.tex/abstract, how/if it was eventually caught and by what, cost/time lost if visible.

## Step 2 — Counterfactual verdicts
For each defect × mechanism, give **CATCH / MAYBE / MISS / N/A** + one-sentence reason pointing to a concrete artifact.
- **CATCH** = the mechanism fires *mechanically* given artifacts that existed at the time (a harness check trips, a number mismatches). Hindsight does not count: you know the answer, the agent did not.
- **MAYBE** = it fires only if an agent makes the right judgment call (e.g. picks the right limiting case, the right anchor).
- **MISS** = it would not fire even if implemented as specified.
- If an **existing** Luxas mechanism already caught it, say so (the new mechanism's marginal value is then lower).

### The mechanisms (implement-as-specified, judge exactly these)
- **M1 anchor pilot**: before any new computation, each experiment must reproduce ≥1 *published* number using the same code path/method it will use for new results; harness writes `computed X±σ vs published Y (source)` and blocks the experiment on mismatch beyond tolerance. For verdicts, state which published number would have been the natural anchor and whether one exists in `notes/literature.md` or is standard knowledge. If no suitable anchor exists for that experiment, say so — that is a cost of M1.
- **M2 independence by construction**: each cross-validation leg declares its operator/Hamiltonian (small-N matrix), basis, units, and method class (analytic / exact-diag / time-evolution / perturbative / literature). Harness rejects INDEPENDENT/agreement credit if both legs share method class or share an H-construction module in their import graph; also diffs each leg's operator against the one declared in frame.md. Note: it catches wrong physics only if frame.md's definition is right.
- **M3 execution receipts + provenance**: every value in claims.json/report must be found in an output file produced by a logged script execution; a value equal to a literature value without a receipt, or a constant hard-coded in a script and returned as a result, is blocked.
- **M4 failure routing**: failures classified infra (429/402/timeout/cost) / implementation / design / hypothesis; infra failures retried with backoff or provider switch and never converted into "skip + disclose"; impl→tool_impl, design→experiment, hypothesis→brain.
- **M5 per-experiment review at finish**: finish blocks unless every EID cited in claims.json has an experiment_review file; reviewer reads logs + scripts (not just ledger); any analysis the reviewer requested must map to a results.json key or the dependent claim is downgraded.
- **M6 harness-written cross-project memory**: lessons auto-extracted at finish/escalation/kill of *earlier* projects and injected into later ones. CATCH only if an earlier project (by date) contains a concrete lesson that would have prevented this defect — name it.
- **M7 physics-invariant tests**: tool_review must write ≥1 limiting-case/analytic-limit test and ≥1 SymPy dimension/units check per tool. Name the limit that would have exposed the defect and whether it is one a blind test author would plausibly choose from the tool description.

## Step 3 — False-positive / cost side
For each mechanism, in THIS project: would it have blocked or slowed legitimate work? (e.g. M1: how many experiments have no reasonable published anchor; M2: how many legit cross-validations would be downgraded; M5: extra reviews needed; M3: legit values that would lack receipts.) Also: would any mechanism have created a new deadlock (finish can't pass)?

## Step 4 — Model attribution
For each defect, which model authored the defective step. We want to test the claim "base model explains more than scaffold".

## Output
Write the full result to the output path given in your task as Markdown with: defect table; verdict matrix (defects × M1–M7); false-positive notes; model attribution; and a 5-line summary ("in this project, mechanism X would have caught N of M ground-truth defects mechanically, …"). Then reply with just that 5-line summary plus the file path.
