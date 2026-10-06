# A/B benchmarks for the meta-agent loop

`scripts/reflect_ab.mts` runs every subdirectory here that holds a
`RESEARCH.md` — once per side (`main` vs `meta/pending`), up to
`AB_REPLICATES` tries each — and pairs the resulting PDFs blind for the user's
vote. A bench that never produces a PDF on either side contributes nothing, so
every task here is scoped to finish inside the runner's 40-minute cap.

## Design rule: known answer, independent oracle

Each task is a question Luxas has already answered in production with a
**two-method cross-validation that agreed** (see `ORACLE.md` beside each
`RESEARCH.md`). That gives a free external check: a report is good to the
extent its headline number lands on the oracle, independently of how it reads.
Tasks were chosen to exercise three different capabilities, so a prompt change
that helps one and hurts another shows up as a split vote rather than noise.

| bench | capability under test | oracle |
|---|---|---|
| 01 U-233 Gamow factor | numerical physics + calibration against a database | G ≈ 42.6 (WKB ↔ Viola-Seaborg, 0.2% apart) |
| 02 Rb P-state blockade leakage | ab-initio pair interaction + analytic-vs-numeric control | p₂(r₀) = 0.248 analytic vs 0.39 TDSE — a documented *discrepancy* to be explained, not resolved |
| 03 CCZ-magic-state claim conflict | literature contradiction adjudication, no new computation | two published figures of merit that cannot both hold |

## Voting

The A/B pair lands in `~/.sisyphus/reflect-inbox/current/`; read both PDFs,
check the headline against `ORACLE.md`, and write `choice: a|b|tie` to
`VOTE.md`. The feedback daemon does the rest.

## Adding a bench

Copy an existing directory. Keep the request narrow enough for 40 minutes and
record the oracle with its two methods and a citation; a bench without an
oracle is just a prompt comparison.

## Measuring an arm against the oracle (2026-10-05)

The A/B runner above compares Luxas with Luxas and is settled by a human vote.
It cannot say whether Luxas is better than not having Luxas. This can:

```bash
npx tsx scripts/bench_run.mts --arm claude-code --bench all --max-usd 3   # bare `claude -p`, the baseline
npx tsx scripts/bench_run.mts --arm luxas       --bench all --max-usd 10  # this checkout, --profile dual
npx tsx scripts/bench_compare.mts                                         # the table
```

Both arms get the same `RESEARCH.md` in an empty directory outside the repo and
never see `ORACLE.md`. Each run is scored by `scripts/bench_score.mts` against
the `oracle` block and appended to `benchmarks/LEDGER.jsonl` (commit, model,
cost, wall time, how it ended, every check). A run made elsewhere — on the
droplet, say — is added with `bench_run.mts --record <run-dir> --arm … --bench …`.

**The rule this makes possible: a harness change that claims to improve
results comes with a row in the ledger, before and after.** Not for bug fixes
or anything `npm test` already decides — for changes whose only justification
is "the reports get better". Until the two arms have been run a few times
each, nobody knows which side of the baseline Luxas is on, so nobody knows
whether such a change is worth making.

What the number does and does not mean:

- It is the fraction of oracle checks a report passes: values within
  tolerance, required caveats and citations present, named traps avoided. It
  is lenient — a correct number anywhere in the report counts — so it rewards
  getting the science right and says nothing about whether the report reads
  well. The blind vote still owns that.
- One run per cell is an anecdote. `bench_compare` prints the spread and says
  so when a cell has n=1. Three runs per cell is the least that supports a
  claim; a one-check difference at n=1 is noise.
- Four tasks, all short and all from this project's own history. A win here
  is necessary, not sufficient.
