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
