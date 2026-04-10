<div align="center">

# Luxas

### An autonomous research agent that reads papers, runs experiments, and writes LaTeX reports — end to end.

<br>

Hand Luxas a research topic in `RESEARCH.md`. It will crawl the literature, download and read the papers, run simulations in a sandbox, maintain its own notes, submit its own work for adversarial review, and produce a compiled PDF with real citations and real figures. It can run for hours, across crashes, without a human in the loop.

**Luxas is a harness, not a model.** The intelligence comes from Claude (Opus for planning, Sonnet for workers, Haiku for mechanical fixes) and OpenAI o3 for math. Luxas' job is to give that intelligence a durable workspace: file-backed memory, externalized brain state, detached sub-agent processes, and a reviewer loop that challenges the brain's own conclusions. When the brain crashes, the work survives. When sub-agents crash, the brain keeps going.

<br>

[![][node-shield]][node-link]
[![][typescript-shield]][ts-link]
[![][pi-mono-shield]][pi-mono-link]
[![][license-shield]][license-link]

<br>

> *"Il faut imaginer Sisyphe heureux."* — Albert Camus

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Agents](#agents) · [Stateless Harness](#stateless-harness) · [Safety](#safety) · [FAQ](#faq)

</div>

---

## What It Does

Give Luxas a topic. It will:

1. **Crawl the literature** — OpenAlex, arXiv, CrossRef, citation chains, web search, and an anti-detect browser for paywalled venues (PRL, Nature, Science).
2. **Download and read** — arXiv LaTeX source when available (so formulas and tables are preserved), PDF fallback otherwise.
3. **Take structured notes** — `notes/literature.md` for paper summaries, `notes/experiments.md` for runs, `notes/memory.md` for freeform scratch.
4. **Run experiments** — spawn a coding sub-agent with its own tmux window; every run is a snapshot in `data/runs/run_N/`.
5. **Derive math** — spawn the math sub-agent (o3 + Wolfram Engine) for symbolic work the main brain shouldn't do inline.
6. **Generate figures** — spawn the illustrator (Claude prompt engineering + Gemini image generation) for schematics, plus matplotlib for data plots.
7. **Write and compile LaTeX** — with venue-specific style files, BibTeX, and figure-citation enforcement.
8. **Submit to adversarial review** — the reviewer (a "PI" persona) reads the current state, challenges the findings, and returns a verdict. Feedback is injected into the brain's context.
9. **Iterate until it passes** — or until it hits a cost/time limit, which you set.

The CLI entry points are small: `luxas init`, `luxas run`, `luxas status`, `luxas list`, `luxas login`. Everything else happens inside the harness.

---

## Quick Start

```bash
git clone https://github.com/Muuuun/luxas.git
cd luxas
npm install

# Authenticate (Anthropic OAuth — or set ANTHROPIC_API_KEY)
npx tsx src/index.ts login

# Initialize a new project from a one-line prompt (PI writes RESEARCH.md for you)
npx tsx src/index.ts init ~/research/reasoning --prompt "Survey LLM chain-of-thought reasoning"

# Or create RESEARCH.md by hand and run
npx tsx src/index.ts run ~/research/reasoning --model opus

# Check on a running or finished project
npx tsx src/index.ts status ~/research/reasoning

# List every project Luxas has ever touched
npx tsx src/index.ts list
```

A run will populate the project directory with notes, downloaded papers, experiment snapshots, and a compiled PDF:

```
~/research/reasoning/
├── RESEARCH.md                 ← the only file you write (read-only for the agent)
├── notes/
│   ├── literature.md           ← agent-maintained literature notes
│   ├── experiments.md          ← agent-maintained experiment log
│   └── memory.md               ← freeform scratchpad
├── data/
│   ├── papers/                 ← downloaded sources (LaTeX preferred)
│   ├── scripts/                ← experiment code
│   └── runs/run_0, run_1, ...  ← immutable numbered run snapshots
├── report/
│   ├── report.tex
│   ├── references.bib
│   ├── provref.sty             ← provref shim (auto-embedded by init_report)
│   └── report.pdf              ← what you actually wanted
├── reviews/
│   └── pi_feedback.md          ← reviewer verdicts
└── .agent/
    ├── log.jsonl               ← append-only session log
    ├── checkpoint.jsonl        ← brain state (survives crashes)
    └── active-agents.json      ← live sub-agent registry
```

---

## How It Works

### Five layers, assembled from pi-agent-core

Luxas vendors four [pi-mono](https://github.com/badlogic/pi-mono) packages (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`) as `.tgz` in `vendor/`. The harness assembles those primitives into a research-specific agent:

| Layer | File | Role |
|---|---|---|
| **1 — System prompt** | `src/agents/definitions/brain.md` | Research methodology: read → hypothesize → experiment → analyze → iterate. Sub-agent definitions (`search.md`, `worker.md`, …) live alongside it. |
| **2 — Tools** | `src/tools/` | Coding tools (`read`/`write`/`edit`/`bash`), `compile_latex`, `init_report`, `spawn_agent`, `image_gen`, `wolfram`, `finish`. |
| **3 — Context transform** | `src/context.ts` | Injects research state (note files + sub-agent status + reviewer feedback) before every LLM call. Two-stage compaction: 60K char warning, 80K hard compress with summary carry-over. |
| **4 — Hooks** | `src/hooks.ts` | Write-protects `RESEARCH.md`, enforces cost/time/step limits, rate-limits search APIs, appends every tool call to `log.jsonl`, snapshots brain state on every `turn_end`. |
| **5 — Reviewer** | `src/pi-agent.ts` | Adversarial Opus-tier "PI" that reviews progress on milestones (brain-triggered) or on a step-count fallback (harness-triggered), writes to `reviews/pi_feedback.md`, and steers the brain via in-context injection. |

### Stateless harness

The most recent architectural shift (commit `f50dbce`): **nothing lives only in process memory**. The brain's token counts, cost, PI status, compaction markers, and sub-agent registry are all written to files on every turn. A crash mid-research is fully recoverable:

- **Brain state** → `session.ts` writes `StateEntry` records to the JSONL log; `deriveState()` reverse-scans on restart to reconstruct the agent's accounting before replaying the checkpoint.
- **Sub-agents** → spawned as detached Node.js processes via `subagent-runner.ts`. Each has its own checkpoint file and heartbeat; the brain talks to them through `active-agents.json`. If the brain dies, the sub-agents keep running. If a sub-agent dies, the brain notices via heartbeat timeout and harvests whatever result it managed to write.
- **Session log** → `log.jsonl` is append-only; `checkpoint.jsonl` is the replayable working memory. On a fresh `luxas run`, a finished session is archived (`.done-<timestamp>.jsonl`) and the next run starts clean.

This is the opposite of a long-lived Python process that holds everything in RAM. The philosophy is: prompt is code, `.md` files are long-term memory, `checkpoint.jsonl` is working memory, and the report is the artifact. Every layer of state has a file on disk.

### Generic `spawn_agent`

Earlier versions had one tool per agent type (`search_literature`, `dispatch_workers`, `run_experiment`, …). The current design is a single `spawn_agent` tool that reads the agent catalog from `src/agents/definitions/*.md` and dispatches by name. Adding a new agent is one `.md` file — frontmatter declares the model, thinking level, tool-sets, safety wrapper, template variables, and whether it can spawn further sub-agents.

```ts
spawn_agent({ agent: "experiment", task: "Run 1000 MCMC samples on the Ising model at T=2.0" })
spawn_agent({ agent: "search",     task: "Find recent work on energy-based models post-2024" })
spawn_agent({ agent: "fixer",      task: "compile_latex failed with 'undefined control sequence \\foo'" })
spawn_agent({ agent: "worker",     tasks: [...parallelTasks], background: true })
```

Three execution modes: **foreground** (blocks brain, returns result), **parallel** (`tasks: []` — N instances run concurrently, brain blocks on all), **background** (`background: true` — agent runs detached, result injected into the brain's context via `steer()` when done). The brain is hard-locked from calling `finish` while background agents are still running.

---

## Agents

Eight agent types ship by default. All definitions live in `src/agents/definitions/` as YAML-frontmatter + markdown files.

| Agent | Model | Role |
|---|---|---|
| **brain** | Opus (high) | Main research driver. Plans, delegates, writes the report, iterates on PI feedback. |
| **search** | Sonnet | Dedicated literature search — OpenAlex, arXiv, CrossRef, web, citation chains, anti-detect browser for paywalls. |
| **worker** | Sonnet | Lightweight parallel worker — batch paper reading, data extraction, file downloads. |
| **experiment** | Opus (high) | Full coding agent for simulations. Safety-wrapped: read-before-edit enforced, protected files (`report.tex`, `references.bib`, `notes/`) are off-limits. |
| **reviewer** | Opus (medium) | Adversarial PI. Reads project state, challenges findings, returns `continue` / `steer` / `stop`. |
| **math** | OpenAI `gpt-5.2` (o3) | Symbolic derivation — integrals, ODEs/PDEs, Taylor expansions, dimensional analysis. Has Wolfram Engine access via `wolframscript`. Falls back to Opus if Codex OAuth is unavailable. |
| **illustrator** | Sonnet | Scientific schematics — energy-level diagrams, experimental setups, flowcharts. Claude does the prompt engineering; Gemini generates the image. |
| **fixer** | Haiku (low) | Mechanical LaTeX compile-error fixer. Single-edit + recompile loop. Brain delegates here instead of burning Opus tokens on syntax debugging. |

The brain can spawn any of them; sub-brains are allowed up to depth 2 for deeply nested research tasks. Every sub-agent gets its own tmux window, which makes debugging a live run an exercise in watching tmux panes rather than reading logs.

---

## Tools

Tool visibility is per-agent, controlled by `toolSets` in each agent definition. The brain sees a focused set; specialized sub-agents get additional tools.

**Brain tools** (`src/tools/index.ts`):

| Tool | What it does |
|---|---|
| `read` / `write` / `edit` / `bash` | File ops + shell (from `pi-coding-agent`, wrapped with read-before-edit + mtime staleness checks + fresh-excerpt recovery on edit failure) |
| `init_report` | Scaffolds `report/` with `report.tex`, `references.bib`, and the embedded `provref.sty` shim |
| `compile_latex` | `pdflatex` + `bibtex`, with figure-citation enforcement and just-in-time provref validation before the final compile |
| `spawn_agent` | Generic agent spawner (foreground / parallel / background; see above) |
| `finish` | Marks research complete. Hard-blocked until `report.pdf` exists and no background agents are still running. |

**Sub-agent-only tool-sets** (`src/agents/tool-sets.ts`):

| Tool-set | Tool | Agents |
|---|---|---|
| `wolfram` | `wolfram` — `wolframscript` bridge for symbolic computation; falls back to `sympy` when the engine is not installed | `math` |
| `imagegen` | `image_gen` — Gemini image generation | `illustrator` |
| `pi` | reviewer-only read tools | `reviewer` |

### provref integration

Luxas is a sister project to [provref](https://github.com/Muuuun/provref), which stops the agent from typing numerical values directly into LaTeX. `init_report` embeds `provref.sty` into the report directory, and `compile_latex` runs `provref merge` + `provref check` before the final `pdflatex` pass. The brain is encouraged (via system prompt) to write `\resultref{run_5.accuracy}` instead of `87.3\%` — so every number in the published PDF is traceable to a JSON key in `data/runs/`. If the agent hallucinates a reference, the build fails loudly with "Did you mean…?" hints before any PDF is produced. See the provref README for the full story.

---

## Skills

Skills live in `skills/` and follow the Agent Skills standard (`SKILL.md` + scripts):

| Skill | What it's for |
|---|---|
| `skills/search/` | Paper discovery — `search` CLI (OpenAlex/arXiv/CrossRef + dedup + ranking), citation chains, arXiv LaTeX source download, figure extraction (`extract-figures` script), Brave web search, anti-detect browser for paywalled venues |
| `skills/venue-specific/` | Formatting rules for 30+ top journals and conferences — Nature, Science, Cell, PRL, NEJM, Lancet, JACS, NeurIPS, ICML, and more. Includes matching `figstyles/` (matplotlib) and `references/` (BibTeX) per venue. |
| `skills/memory/` | Luxas' own cross-project memory protocol — how to read/write `~/.sisyphus/memory.md` and the per-project `notes/`. |

---

## Memory System

Luxas borrows the pre-compaction memory flush from OpenClaw, but stays file-based — no embeddings, no vector search.

**Per-project memory** (`notes/`):
- `literature.md`, `experiments.md`, `memory.md` — all maintained by the agent.
- Every LLM call gets a fresh research-state snapshot injected via `context.ts`.
- Notes files are smart-truncated when they outgrow the budget: section headers stay as a table of contents, recent content is preserved verbatim.

**Cross-project memory** (`~/.sisyphus/`):
- `projects.json` — registry of every project Luxas has ever run (path, name, summary, total cost, tokens).
- `memory.md` — agent-writable global memory for cross-project insights.
- New projects automatically see a "Past Research Projects" section in their system context.
- `luxas list` dumps the registry with per-project summaries.

The Sisyphus → Luxas rename (commit `ec04179`) kept the user-data path (`~/.sisyphus/`) intact, so existing memory and project history survived the brand change.

---

## Safety

Every constraint is a hook or a tool guard, not a prompt-level instruction. The brain cannot talk its way out of them.

| Limit | Default | Enforced by |
|---|---|---|
| Max cost per run | unbounded (pass `maxCostUsd` to set) | `hooks.ts` |
| Max duration | 8 hours | `hooks.ts` |
| PI review fallback interval | every 50 steps without a brain-triggered review | `agent.ts` |
| Max sub-agent spawn depth | 2 | `agents/spawn.ts` |
| Max compaction failures before abort | 3 | `context.ts` |
| `RESEARCH.md` | write-protected | `hooks.ts` |
| Experiment agent protected files | `report.tex`, `references.bib`, `notes/*` | `agents/safety-wrappers.ts` |
| Read-before-edit on brain | enforced with mtime staleness + fresh-excerpt recovery | `agents/safety-wrappers.ts` |
| `report.pdf` exists before `finish` | enforced | `tools/index.ts` |
| No background agents still running at `finish` | enforced | `tools/index.ts` |

The `finish` tool is the only clean exit. Anything else is a crash, and the stateless harness is designed to survive crashes.

---

## Project Structure

```
luxas/
├── README.md                   ← you are here
├── CLAUDE.md                   ← project instructions for Claude Code
├── idea.md                     ← design rationale (read when in doubt)
├── package.json
├── tsconfig.json
├── vendor/                     ← customized pi-mono .tgz bundles
├── patches/                    ← post-install patches for vendored pi-* packages
├── src/
│   ├── index.ts                ← CLI entry (run/status/init/list/login)
│   ├── agent.ts                ← 5-layer brain assembly
│   ├── auth.ts                 ← Anthropic OAuth PKCE + key resolution
│   ├── context.ts              ← state injection + two-stage compaction
│   ├── compaction.ts           ← message compaction policy
│   ├── hooks.ts                ← safety + logging + state snapshots
│   ├── session.ts              ← JSONL session DAG + StateEntry
│   ├── active-agents.ts        ← file-backed sub-agent registry
│   ├── subagent-runner.ts      ← standalone sub-agent entry point
│   ├── pi-agent.ts             ← reviewer lifecycle (milestone + fallback)
│   ├── extensions.ts           ← lifecycle event bus
│   ├── reminders.ts            ← state-aware reminder injection
│   ├── memory.ts               ← cross-project registry + global memory
│   ├── messages.ts             ← cross-model message transforms
│   ├── notes-compaction.ts     ← smart truncation for notes files
│   ├── transform.ts            ← context transform helpers
│   ├── utils.ts
│   ├── agents/
│   │   ├── definitions/        ← brain.md, search.md, worker.md, experiment.md,
│   │   │                          reviewer.md, math.md, illustrator.md, fixer.md
│   │   ├── registry.ts         ← loads + caches agent definitions
│   │   ├── spawn.ts            ← buildAgentFromDefinition (shared by tool + runner)
│   │   ├── tool-sets.ts        ← named tool-set factories
│   │   ├── context-builders.ts ← per-agent dynamic context
│   │   └── safety-wrappers.ts  ← runtime tool safety constraints
│   ├── tools/
│   │   ├── index.ts            ← tool assembly for the brain
│   │   ├── spawn-agent.ts      ← generic agent spawner
│   │   ├── coding.ts           ← pi-coding-agent wrapper
│   │   ├── report.ts           ← compile_latex
│   │   ├── init-report.ts      ← scaffolds report/ with provref.sty embedded
│   │   ├── provref-utils.ts    ← provref merge + check wiring
│   │   ├── image-gen.ts        ← Gemini image generation
│   │   └── wolfram.ts          ← wolframscript bridge (sympy fallback)
│   └── tui/                    ← Ink-based interactive dashboard
├── skills/
│   ├── search/                 ← paper search skill
│   ├── venue-specific/         ← 30+ venue formatting specs
│   └── memory/                 ← cross-project memory protocol
├── schemas/                    ← JSON schemas for state files
└── monitor/                    ← log-watching helpers
```

---

## Requirements

- **Node.js** 22+
- **`claude` CLI** authenticated (Anthropic OAuth) — or `ANTHROPIC_API_KEY` in the environment
- **LaTeX** — `pdflatex` + `bibtex` in `PATH`. On macOS, `brew install --cask mactex` or `basictex` (Luxas will auto-install `basictex` if it's missing). Matplotlib `text.usetex: True` (used by the venue-specific figstyles) depends on this.
- **pdftotext** + **pdfimages** (poppler) — for PDF figure extraction
- **Python 3.10+** with `matplotlib` and `numpy` — for experiments and plots
- **tmux** — every worker/experiment gets its own window for live observability
- **provref** (optional but recommended) — `npm i -g provref` for the merge/check steps during compilation
- **`WOLFRAM_APP_ID`** or local Wolfram Engine (optional) — for the math agent; it falls back to sympy otherwise
- **`BRAVE_API_KEY`** (optional) — for web search in the search skill
- **browser-use** (optional) — anti-detect browser at `~/.browser-use-env/bin/browser-use` for paywalled sites

---

## FAQ

**What is Luxas in one sentence?**
A stateless, file-backed harness that drives Claude (and friends) through a multi-hour, multi-agent research pipeline from topic to compiled PDF, with adversarial self-review and crash-recoverable state.

**How is this different from a single long Claude Code session?**
Claude Code is one agent in one terminal. Luxas is a brain that spawns eight kinds of sub-agents (search, worker, experiment, reviewer, math, illustrator, fixer, sub-brain) as detached processes, routes each to a different model, enforces safety limits via hooks rather than prompts, maintains file-based notes across compaction, and survives its own crashes. The brain does research planning; the sub-agents do bounded, parallelizable work.

**How is it different from LangGraph / CrewAI / AutoGPT?**
LangGraph has a graph state machine but expects you to build the graph. CrewAI is role-based but not built for long-running crash-recoverable sessions. AutoGPT is LLM-driven control flow, which is fragile. Luxas uses LLM-driven *content* work but file-backed, hook-enforced control flow. The brain decides what to do next by reading the state of the filesystem, not by holding a plan in its token window.

**Why vendor pi-mono instead of importing it?**
Custom patches to the agent loop, context transform, compaction, and hook lifecycle would be clumsy through a published package. Vendoring `.tgz` files gives full control over the runtime without a fork in git.

**Why is the sub-agent list hardcoded if adding one is "one .md file"?**
The definitions are hardcoded in the `src/agents/definitions/` directory, but the spawn tool reads them at startup from disk. You can drop a new `.md` file in and the brain will see it on the next run. No code changes needed unless the new agent needs a brand-new tool-set or safety wrapper.

**What happens if I crash the brain mid-run?**
Re-run `luxas run <dir>`. The harness detects `checkpoint.jsonl`, replays the session, reconstructs brain state (cost/tokens/PI counters) from reverse-scanning `log.jsonl`, and resumes where it left off. Sub-agents that were running at crash time kept running (they're detached processes); their results are harvested on the next turn.

**Why does the reviewer run separately instead of inline?**
Because the brain asking itself "am I done?" is useless. A separate Opus instance with a different system prompt and no access to the brain's reasoning traces produces adversarial feedback, not agreement. The reviewer writes to `reviews/pi_feedback.md` and that file is injected into the brain's next context.

**How does provref fit in?**
provref is a separate tool (see the sister repo) that prevents the agent from typing literal numbers into LaTeX — every numeric claim must resolve to a key in a JSON file, and the build fails if it doesn't. Luxas integrates it into `compile_latex` so the number-provenance guarantee comes for free. It is not a replacement for code review of the experiment scripts; it only closes the manuscript-to-data gap.

**Does this actually work?**
It runs end-to-end on literature surveys and on small-scale computational research projects. Whether the output is *publication-quality* depends on the model, the topic, and the reviewer's feedback loop, not on the harness. The harness' job is to stay upright for long enough that the model has a chance to produce good work — and to not burn your entire budget on mechanical errors. No claims are made about SOTA. Read the idea.md for the honest design rationale.

**Why the Sisyphus name in `~/.sisyphus/`?**
It's the previous name. The rename (Sisyphus → Luxas) kept user data paths intact so existing memory and project history survived. The repo, CLI, and docs now use Luxas; disk state still says Sisyphus.

**Where do I report bugs?**
Open an issue on GitHub. `idea.md` has the most candid version of what's working and what isn't.

---

## Acknowledgments

Built on [pi-mono](https://github.com/badlogic/pi-mono) by [Mario Zechner](https://mariozechner.at/). Prompt evolution via [AgentSmelt](https://github.com/Muuuun/agentsmelt). Number provenance via [provref](https://github.com/Muuuun/provref).

## License

MIT — see [LICENSE](LICENSE).

<br>

<div align="center"><i>One must imagine Luxas happy.</i></div>

<!-- Link Definitions -->
[node-shield]: https://img.shields.io/badge/node-22+-4dc9f6?style=flat-square&labelColor=0a0e14&logo=node.js&logoColor=4dc9f6
[node-link]: https://nodejs.org/
[typescript-shield]: https://img.shields.io/badge/typescript-5.5+-7dd8f8?style=flat-square&labelColor=0a0e14&logo=typescript&logoColor=7dd8f8
[ts-link]: https://www.typescriptlang.org/
[pi-mono-shield]: https://img.shields.io/badge/pi--mono-vendored-b0e8ff?style=flat-square&labelColor=0a0e14
[pi-mono-link]: https://github.com/badlogic/pi-mono
[license-shield]: https://img.shields.io/badge/license-MIT-b0e8ff?style=flat-square&labelColor=0a0e14
[license-link]: LICENSE
