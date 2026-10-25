# Architecture notes

The long-form companion to the [README](../README.md). The README says what Luxas does; this page says how, agent by agent and gate by gate. Design history and the reasoning behind each decision live in [idea.md](../idea.md).

- [Layers](#layers)
- [State lives in files](#state-lives-in-files)
- [Experiment workflow](#experiment-workflow)
- [Claims and verification](#claims-and-verification)
- [Report, figures and the finish gates](#report-figures-and-the-finish-gates)
- [Agents](#agents)
- [Skills](#skills)
- [Safety](#safety)
- [Models and profiles](#models-and-profiles)
- [Comparison](#comparison)
- [Requirements](#requirements)
- [FAQ](#faq)

## Layers

Luxas vendors four [pi-mono](https://github.com/badlogic/pi-mono) packages as `.tgz` files under `vendor/` and assembles them into a research agent:

| Layer | File | Role |
|---|---|---|
| **System prompt** | `src/agents/definitions/brain.md` | Research methodology in cache-controlled blocks: the methodology body, then `RESEARCH.md` + skills, then the mutable `<active_agents>` / `<claim_status>` state |
| **Tools** | `src/tools/` | `read` / `write` / `edit` / `bash`, `compile_latex`, `init_report`, `spawn_agent`, `idle`, `request_pi_review`, `finish` |
| **Context transform** | `src/context.ts` | Per-agent dynamic context before every LLM call, directives from `notes/directives/`, two-stage compaction with a summary carry-over |
| **Hooks** | `src/hooks.ts` | `RESEARCH.md` write-protect, cost cap with a finalization freeze at 90 %, per-turn JSONL logging |
| **PI monitor** | `src/pi-agent.ts` | Spawns the `reviewer` on brain-requested milestones and on a step-count fallback; the verdict (`continue` / `steer` / `stop`) lands in `reviews/pi_feedback.md` |

## State lives in files

The harness is stateless. Brain accounting (cost, tokens, PI counters, compaction markers) is reconstructed from `.agent/log.jsonl` and `.agent/usage.log` on restart. Sub-agents are detached Node processes with their own conversation files; the brain tracks them through `.agent/active-agents.json` and harvests their results on the next turn, including after a crash. The `idle` tool parks the brain at zero LLM cost while background work runs.

Per-project memory is `notes/*.md` (literature, experiments ledger, free notes), smart-truncated when it grows past budget. Cross-project memory is `~/.sisyphus/projects.json`, a registry of every project with a summary; a claim-free digest of past projects is injected into new runs, isolated per tenant.

Kill the process at any point and `luxas run <dir>` resumes from disk. There is no vector store and no embedding index.

## Experiment workflow

The `experiment` agent writes no code. Three phases:

1. **Design.** List each tool the experiment needs: name, purpose, input and output shape, implementation hint.
2. **Impl + Review.** For every tool, spawn `tool_impl` (writes `scripts/<tool>.py` from the description alone) and `tool_review` (writes `tests/test_<tool>.py` from the description alone) in parallel. Neither may read the other's output; the wrappers enforce the read roots. Pytest is the only ground truth. Failures go back to `tool_impl` as messages, with a cap of three revisions.
3. **Integrate.** Run the validated tools, write `data/experiments/<EXP_ID>/runs/run_N/results.json`, and record the analysis as a `## L2.N` section in `notes/experiments.md` (headline findings, alternatives considered, red team, limitations, open questions).

The blind split exists because of an observed failure: when one agent wrote both the implementation and its test, it redefined a field's meaning so that its self-reported value passed its own assertion. Tests now derive expected values from the inputs, never from fields the implementation reports, and at least one test per tool must defeat a trivial stub.

Two opt-in executor modes replace the three-agent flow with a single strong agent that writes its own code: `LUXAS_EXPERIMENT_MODE=solo` (in-process) and `LUXAS_EXPERIMENT_MODE=claude-code` (one `claude -p` run per experiment, with `LUXAS_CC_AUTH=subscription|api`). The review loop, the claim table and the finish gates are the same in every mode.

## Claims and verification

A quantity, not an experiment, is the unit of research state.

- `results.json` declares `computed.quantities[]`: id, value, σ, the observable sentence and the input values used.
- Before each review round the harness spawns a `replicator` per headline quantity. It sees the observable and the inputs, never the producer's number, script or narrative, and returns a blind estimate by its own route.
- `experiment_reviewer` then audits the L2 section, the results and the cited literature with the blind estimates in hand, and returns `satisfied` or `revise` (three rounds at most, a fresh reviewer each round).
- `src/claims-table.ts` collects every estimate of the same id (own value, cross-validation, other experiments, blind estimates, reviewer lines) and grades it: `converging` when an independent leg agrees within σ, `disputed` when one disagrees, `conditional` when a leg is missing. A disputed row blocks `finish()` until another route settles it: a route-differing replication or another experiment, never a re-run of the same one.
- Opt-in `LUXAS_VERIFY_SEAT=check` replaces the blind estimate with a verifier that recomputes each headline quantity, re-runs the shipped code on a clone of the project and toggles each causal claim's stated cause.

## Report, figures and the finish gates

`report_writer` turns the ledger into `report.tex` in a fresh context, so the synthesis is not done by a compaction-degraded brain. Numbers in the prose carry `quantity_id`s and the integrity check refuses a value that no result file holds.

Data figures go through one strict renderer, `figspec` (energy-level diagrams through `levelspec`). The renderer measures composition itself: too many series, series outside the limits, labels that do not fit and dead zones are errors, written to a `.figlint.json` sidecar that `compile_latex` reads. `figure_auditor` then looks at the rendered PNG with a vision model and reports what a referee would reject, split into blocking and cosmetic; only blocking items trigger a fix, and the loop is capped at two rounds. `typesetter` rasterizes the compiled PDF page by page and audits layout: float distance, caption placement, column overflow, missing-figure boxes.

Before `finish()` the harness runs a one-request contradiction sweep: it reads `report.tex`, the ledger and every experiment's latest results and asks one model to diff the quantities they share. `finish()` itself refuses until every experiment has been reviewed, no headline quantity is disputed, the sweep is current, `report.pdf` compiles with at least one self-generated figure, the typesetter notes are clear, and the PI verdict is `stop`. When refused it lists every outstanding check at once. Three refusals on the same gate write `notes/escalations/needs-operator.md` and exit cleanly.

## Agents

Twenty-one definitions live in `src/agents/definitions/<name>.md` (YAML frontmatter plus a markdown body). `spawn_agent` runs them in the foreground, in parallel (`tasks: [...]`) or detached in the background; spawn depth is capped at two. The tier column is what the definition declares; `--profile dual` remaps `opus` / `sonnet` / `haiku` to DeepSeek and GLM as described under [Models and profiles](#models-and-profiles).

| Agent | Tier | Role |
|---|---|---|
| **brain** | opus | Main driver. Decomposes `RESEARCH.md`, dispatches everything below, writes the report, calls `finish()` |
| **search** | sonnet | Literature intake: OpenAlex / arXiv / CrossRef / citation chains / web / anti-detect browser; spawns readers |
| **reader** | haiku | Reads one paper and writes `notes/literature.d/<key>.md`; the only legitimate source of cite keys |
| **worker** | sonnet | Lightweight parallel worker for batch downloads and file work |
| **experiment** | opus | Three-phase orchestrator (design, impl + review, integrate); writes no code |
| **tool_impl** | sonnet | Writes `scripts/<tool>.py` from the description only; cannot read `tests/` |
| **tool_review** | sonnet | Writes `tests/test_<tool>.py` from the description only; cannot read `scripts/` |
| **ledger_writer** | opus | Turns an experiment's computed facts into its `## L2.N` section in one pass |
| **replicator** | opus | Blind estimate or replication of one declared quantity from its inputs alone; `check` mode recomputes and re-runs |
| **experiment_reviewer** | opus | Adversarial per-experiment audit after each run; `satisfied` / `revise` |
| **reviewer** | opus | The PI. Reads project state, challenges findings, returns `continue` / `steer` / `stop` |
| **report_writer** | opus | Fresh-context prose writer for `report.tex` |
| **contradiction_auditor** | sonnet | Pre-finish diff of every shared quantity across ledger, results and report (now one request, see above) |
| **prior_art_auditor** | opus | Positions each contribution sentence against the closest prior result, with locators |
| **illustrator_write** | sonnet | Makes one figure from one brief via `figspec`, `levelspec` or TikZ; never raw matplotlib |
| **illustrator** | sonnet | Style-consistency audit and regeneration of existing figures |
| **figure_auditor** | sonnet | Reads rendered figures with a vision model after the lint; blocking vs cosmetic |
| **typesetter** | sonnet | Document-level layout audit of the compiled PDF, page by page |
| **fixer** | haiku | Mechanical LaTeX compile-error fixer, one edit and recompile at a time |
| **math** | gpt-5.6-terra | Symbolic derivation with Wolfram Engine when present, sympy otherwise |
| **monitor** | sonnet | Read-only sidecar you can talk to during a run (`luxas monitor`); its one write is a directive file the brain reads next turn |

### Defining an agent

```yaml
name: tool_impl
model: sonnet                      # opus | sonnet | haiku | an explicit provider id
thinkingLevel: medium
toolSets: [coding]
safety:
  presets: [research_brief, report_surface, notes_ledger]
  allowedReadRoots: ["data/experiments/{{EXPERIMENT_ID}}"]
  blockedReadRoots: ["data/experiments/{{EXPERIMENT_ID}}/tests"]
  allowedWriteRoots: ["data/experiments/{{EXPERIMENT_ID}}/scripts/"]
  writeOnExistingPolicy: block
spawn: { enabled: false }          # or { allowedTypes: [reader, math] }
templates: [PROJECT_DIR, EXPERIMENT_ID, TOOL_NAME]
```

`buildSafetyWrapper` compiles the `safety` block into runtime checks on every tool call. `validateSpawnGraph` walks the `allowedTypes` edges at startup and throws on a cycle. Adding an agent or changing its scope is a `.md` edit; growth of `brain.md` and `experiment.md` is registered in `prompt-budget.json` and gated.

## Skills

Skills follow the Agent Skills layout (`skills/<name>/SKILL.md` plus scripts) and are injected into the agents that need them:

| Skill | What it is for |
|---|---|
| `search/` | Paper discovery: OpenAlex / arXiv / CrossRef, citation chains, arXiv LaTeX source, BibTeX, web search, anti-detect browser for paywalled venues |
| `matplotlib-figures/` | Data figures through `figspec`, the strict renderer that lints its own composition |
| `figure/` | Energy-level diagrams through `levelspec`, TikZ schematics, per-domain palettes and pitfalls |
| `paper-figures/` | Extracting figures from downloaded papers for surveys |
| `venue-specific/` | 30+ journal and conference styles with matching matplotlib styles and BibTeX conventions |
| `narrative/` | Article-type templates and the revision protocol that keeps outline, prose and figures coherent |
| `review/` | Survey discipline: ten-domain style guide, anti-stacking rules, outline-first pipeline |
| `survey-methodology/` | Claim taxonomies, evidence weighting, coverage scoring |
| `compute-methods/` | Friction sheets for simulators (Blender today; COMSOL, Zemax, SolidWorks drafts) and the `simrun` remote runner |
| `qec-construct/` | Verifier-in-the-loop construction of quantum error-correcting codes |
| `memory/` | Reading past projects' notes and recording corrections |

## Safety

Every constraint is a hook, a tool guard, a frontmatter-declared scope or a finish gate. None of them is a prompt instruction.

| Limit | Default | Enforced by |
|---|---|---|
| Cost per run | $250 hard cap (`--max-cost` to lower); from 90 % only the agents needed to land the report may be spawned | `hooks.ts` |
| LLM turns per run | 500 | `agent.ts` |
| Sub-agent spawn depth | 2 | `agents/spawn.ts` |
| Spawn graph | declared cycles throw at startup | `agents/registry.ts` |
| `RESEARCH.md` | write-protected for every agent | `safety.presets: [research_brief]` |
| Per-agent read / write scope | `allowedReadRoots`, `blockedReadRoots`, `allowedWriteRoots`, `writeOnExistingPolicy: block` | `buildSafetyWrapper` |
| `notes/experiments.md` | brain cannot write it; only experiment-side agents append | `safety.protectedFiles` + bash write guard |
| `finish()` | the gate stack described [above](#report-figures-and-the-finish-gates); refusals list every outstanding check | `tools/index.ts` |
| Blocked tool calls | logged as failed calls (`tool_block`), visible to the model and in `log.jsonl` | `safety-wrappers.ts` |

`finish()` is the only clean exit; anything else is a crash, and the harness is built to survive crashes. The brain may disagree with the PI by writing `reviews/pi_pushback.md`, which must be fresher than the feedback it disputes.

## Models and profiles

```bash
luxas run ~/research/x                        # --profile dual (default)
luxas run ~/research/x --profile claude       # every agent on Anthropic
LUXAS_BRAIN_MODEL=claude-opus-5-5 luxas run ~/research/x   # dual producers, Opus orchestrator
```

`--profile dual` routes text agents to `deepseek-v4-pro`, the reader and drawing agents to `deepseek-flash`, and the figure audit to `glm-5.3-flash`; `applyProfile()` in `src/agents/spawn.ts` does the remap. The brain is the one slot that should not follow the producers' profile: on its own decomposition task `deepseek-v4-pro` ranked last on every channel of a three-way bench, so when Anthropic credit is available the measured runs used an Opus brain. `luxas models` prints the live routing, including any model renames that were adopted automatically after a capability probe.

Keys are read from the environment: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GLM_API_KEY` (or `ZHIPUAI_API_KEY`), `OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`.

## Comparison

Luxas is research-domain-specific, with a compiled PDF and real citations as the deliverable; file-backed and crash-recoverable; and multi-model with one flag.

| | Luxas | AI Scientist (Sakana) | LangGraph | CrewAI | Claude Code |
|---|---|---|---|---|---|
| Control flow | file-based, hook-enforced gates | scripted pipeline | declarative graph you build | role-based crew | one chat session |
| Crash-recoverable | ✓ replays from `log.jsonl` | ✗ | ✓ via checkpointer | ✗ | ✗ |
| Detached sub-agents | ✓ Node processes, harvested on resume | ✗ | in-process | in-process | ✗ |
| Multi-model | Claude + DeepSeek + GLM + OpenAI via one flag | OpenAI / Anthropic | DIY | DIY | Anthropic |
| Output | LaTeX PDF with per-number provenance | LaTeX paper from ML experiments | whatever you wire | whatever you wire | text + code |
| Literature survey | ✓ OpenAlex / arXiv / CrossRef / browser | ✗ | ✗ | ✗ | ✗ |
| Independent verification | blind estimates, blind tests, claim table, three review layers | one reviewer agent | none built in | none built in | none |

**Use Luxas** when you have a research topic, want a literature survey or a small computational study, and the deliverable is a compiled report with real citations and figures that runs unattended for hours. **Do not use Luxas** as a general agent framework for arbitrary tasks (use LangGraph or pi-agent-core directly) or for an interactive coding session (use Claude Code).

## Requirements

- Node.js 22+
- LaTeX: `pdflatex` and `bibtex` on PATH
- poppler: `pdftoppm`, `pdftotext`, `pdfimages`
- Python 3.10+ with `matplotlib` and `numpy`
- tmux
- At least one provider key (see [Models and profiles](#models-and-profiles))
- Optional: `wolframscript` for the `math` agent, `GEMINI_API_KEY` for raster figure generation, browser-use at `~/.browser-use-env/bin/browser-use` for paywalled venues, `provref` for `\resultref` provenance

## FAQ

**How much does a run cost?** Tens of dollars is typical; the spread is dominated by topic depth and the number of review rounds. The hard cap is $250 by default and `--max-cost` lowers it. Every run's real spend is in `<project>/.agent/usage.log`.

**How is this different from one long Claude Code session?** Claude Code is one agent in one chat. Luxas is a brain dispatching twenty kinds of sub-agents as detached processes, with file-based state, blind verification of every headline number, and finish gates that are code.

**What happens if the process dies mid-run?** Run `luxas run <dir>` again. The harness finds the checkpoint, rebuilds brain state from the logs and resumes. Detached sub-agents kept running; their results are harvested on the next turn, and experiments already complete on disk are reported as complete.

**Why do the reviewers run as separate agents?** A brain asking itself "am I done?" agrees with itself. A separate reviewer with no access to the brain's reasoning, a blind estimator that never sees the producer's number, and a vision model reading the compiled pages produce disagreement, which is the only feedback worth paying for.

**Does it work?** Nine end-to-end runs are in the [gallery](https://luxas.im/gallery): they compile, cite real papers, include self-generated figures and converged under review. Whether a report is publication-quality depends on the model, the topic and the number of review rounds, not on the harness. No SOTA claims.
