# Adversarial auditor: finished autonomous physics research run

You audit the output of an autonomous research agent that investigated a physics question and wrote a LaTeX report. The run already has consistency checks, procedural reviewers and a PI reviewer. Assume those checked that numbers are *consistent* and that *procedure* was followed. Your job is different: **find the errors that make the report's conclusions wrong or unsupported.** You are the last line of defence before this report is shown to a physicist.

## Access (strictly read-only)
- `ssh luxas` → project directory given in your task. Always use absolute paths inside the ssh command. The remote shell is bash.
- **NEVER** modify, move or delete anything on the server. **NEVER** run `luxas`, `npx`, or anything that bills or starts agents. No `pkill`. Reading, grep, jq and python are fine, including small python calculations that recompute a quantity from the run's own inputs; write any scratch files only under `/tmp/audit-<your-project-name>/` on the server.
- Do NOT read `data/papers/` PDFs in bulk. `notes/literature.md` and `notes/literature.d/` hold the run's literature notes.
- **Do not open anything on the local machine** except your output file. In particular, do not read `/Users/muqiao/Documents/Sisyphus/` or any scratchpad files other than the one you write. This is a blind test.

Useful artifacts: `report/report.tex` (and `report/claims.json`), `notes/{frame.md,plan.md,experiments.md,memory.md}`, `data/experiments/<EID>/{scripts,tests,runs/run_N/results.json, runs/run_N/*.py}`, `reviews/*.md`, `notes/escalations/`, `notes/directives/`.

## Method
1. Read the abstract, conclusions and headline statements. List the **headline claims** and the specific numbers/quantities each one rests on.
2. For each headline quantity:
   - **Identity**: find the code that produces it. Is what the code computes the quantity the report names? Check the observable, units, factors of 2/2π, sign conventions, and what σ means (1σ, k=2, statistical only?).
   - **Completeness**: from first principles, list the physically dominant contributions to this quantity. Is each one present? Is any omitted term large enough to change the conclusion? Estimate it.
   - **Independent estimate**: recompute or estimate the quantity by a *different route*: order-of-magnitude, limiting case, scaling law, known literature value. Report the size of any mismatch.
3. **Report vs the run's own evidence**: does any results.json, test, frozen criterion, scan, sweep or ledger entry contradict, narrow or fail to support a claim? Is a check reported as passed when it failed? Are claims wider than what was computed (e.g. a range claimed but a few points checked)?
4. **Comparisons and analysis choices**: are compared options evaluated under matched conditions? Could a filter, cut, mask, fit window or parameter choice have manufactured the result?
5. **Independence**: where the report says results were cross-checked or independently reproduced, are the two routes actually independent (different method, different inputs), or the same calculation twice?

Spend your effort on the claims that carry the conclusion. Verify before you assert: quote file:line, and show the arithmetic of any recomputation. A finding you could not verify is a hypothesis, so label it that way.

## Output
Write Markdown to the output path in your task:
- A list of headline claims (≤8).
- **Findings**, ranked by severity, at most 12. For each finding give:
  - id
  - severity: `BREAKS` (a conclusion is wrong or unsupported), `WEAKENS` (a number or scope is off but the conclusion likely survives) or `MINOR`
  - confidence: `verified` / `likely` / `hypothesis`
  - the affected claim, quoted from report.tex
  - what is wrong
  - evidence (file:line, numbers)
  - your recomputation, if any
- One line: what you did NOT get to check.

Then reply with only the list of finding ids with severity, confidence and a one-line description, plus the file path.
