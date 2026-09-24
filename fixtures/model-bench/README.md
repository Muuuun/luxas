# Model bench fixtures

Inputs for `scripts/model_bench.mts`, which answers one question: **which model should each Luxas role run on?** Models change faster than our routing, so this is meant to be re-run: when a new model appears, run its column only and compare it against the cached results.

These fixtures are deliberately **not** under `benchmarks/`. Any subdirectory there with a RESEARCH.md becomes a billable 40-minute A/B run.

## Principle

Score against ground truth, not taste.

| role | fixture | score | ground truth |
|---|---|---|---|
| `tool_review` | `tool_review/<tool>/`: `task.md` (a real tool contract from the corpus), `reference.py`, `mutants/*.py`, `gold_test.py` | fraction of mutants killed, **given** that the contestant's tests pass the reference (otherwise 0) | the mutants are the bug classes the corpus actually shipped |
| `auditor` | `auditor/definition.md` (method prompt from the blind-auditor test) + `auditor/<run>/labels.json` | weighted recall of labelled defects (weight 3 = flips a headline), plus counts of false / unmatched findings | `notes/backtest-2026-09-24/` backtest + blind-audit scoring, with every label verified on the droplet |
| `brain` | `brain/<bench>/traps.json` | weighted yes/no on trap questions, answered by a judge that holds the bench's ORACLE.md | production failures on the same RESEARCH.md (`notes/model-routing-2026-09-06.md` §3) |

Every trial runs the real agent definition and tools through `spawnAgent` with `exactModel`, which bypasses routing. It runs in its own sandbox and child process, with its own `usage.log` and a cost cap. Every bench agent also gets the `finish` exit tool and a turn cap. Anthropic models are forced to call a tool on every turn, so without `finish` a definition cannot end its loop on them. That is a configuration fact, not a model-quality signal.

A provider with no balance is recorded as `unfunded` and never scored.

## Setup

```bash
npx tsx scripts/model_bench.mts validate      # mutants killable, snapshots present
```

Fetch auditor snapshots once. Exclude papers, agent logs, PDFs and virtualenvs:

```bash
ssh luxas 'cd <remote from labels.json> && tar czf - --exclude=data/papers --exclude=.agent --exclude="*.pdf" \
  --exclude=__pycache__ --exclude=.pytest_cache --exclude=".venv*" --exclude=reviews/typesetter_pages .' \
  > ~/.sisyphus/model-bench/snapshots/<task>.tgz
```

## Run

```bash
npx tsx scripts/model_bench.mts run --role tool_review --models anthropic/claude-sonnet-5,glm-5.3 --reps 2 --cap 3
npx tsx scripts/model_bench.mts run --role auditor --models anthropic/claude-opus-5 --judge kimi-k3 --cap 5
npx tsx scripts/model_bench.mts report
```

A model is either a `MODEL_MAP` key (`src/agents/spawn.ts`), a `provider/id` from pi-ai's catalog, or an entry in `models.json`.

## Judges

Judges are needed only for `auditor` (matching findings to labels) and `brain` (trap questions). **The judge panel must include a vendor with no contestant**, because same-family bias is measured and large (`notes/model-routing-2026-09-06.md` §2). Use `--judge` accordingly. A result judged by a contestant's own family must be read as provisional.

## Adding fixtures

- **tool_review**: take a real `spawn_init` task from `.agent/conversations/*tool_review*.jsonl`. Make the spec unambiguous; the fixture must not punish a correct reading. Take the reference from the run after checking it yourself. Write mutants modelled on corpus bugs. `gold_test.py` must pass the reference and kill every mutant: an equivalent mutant is a fixture bug.
- **auditor**: add the defect set to `auditor/<run>/labels.json` from a backtest + scored blind audit. Keep only labels someone verified.
- **brain**: add `brain/<bench>/traps.json` with yes/no questions whose answers are about the design as written.
