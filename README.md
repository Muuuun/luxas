<div align="center">

# Luxas

### An autonomous research agent that reads papers, runs experiments, and writes LaTeX reports — end to end.

<br>

Hand Luxas a research topic in `RESEARCH.md`. It will crawl the literature, download and read the papers, design and run simulations under independent-author test review, generate publication-grade figures, write a LaTeX report, submit it to adversarial review at both the content and the visual / typographic level, and produce a compiled PDF with real citations. It can run for hours, across crashes, without a human in the loop.

**Luxas is a harness, not a model.** The intelligence comes from Claude (Opus for planning and adversarial review, Sonnet for workers and audits, Haiku for mechanical fixes), OpenAI o3 for math, with optional family-wide redirect to DeepSeek-v4 (1M context, ~10× cheaper) or Kimi via one environment variable — including a separate vision profile so the figure pipeline keeps working when the text family is text-only. Luxas' job is to give that intelligence a durable workspace: file-backed memory, externalized brain state, detached sub-agent processes, an independent-author pattern that prevents self-review pathologies, and deterministic finish-gates that no prompt can talk its way past.

<br>

[![][node-shield]][node-link]
[![][typescript-shield]][ts-link]
[![][pi-mono-shield]][pi-mono-link]
[![][license-shield]][license-link]

<br>

> *"Il faut imaginer Sisyphe heureux."* — Albert Camus

[Quick Start](#quick-start) · [Switching Models](#switching-models) · [How It Works](#how-it-works) · [Agents](#agents) · [Tools](#tools) · [Skills](#skills) · [Safety](#safety) · [Requirements](#requirements) · [FAQ](#faq)

</div>

---

## What It Does

Give Luxas a topic. It will:

1. **Crawl the literature** — OpenAlex, arXiv, CrossRef, citation chains, web search, and an anti-detect browser for paywalled venues (PRL, Nature, Science).
2. **Download and read** — arXiv LaTeX source when available (so formulas and tables are preserved), PDF fallback otherwise. Per-paper extraction is delegated to short-lived `reader` sub-agents that write `notes/literature.d/<paper>.md` fragments, which a hook merges back into the canonical `notes/literature.md`.
3. **Design experiments under V5 split** — the `experiment` agent owns Design (list the tools needed) → Impl + Review (parallel `tool_impl` writes the script, `tool_review` writes blind tests against the description) → Integrate (run, gather, append `notes/experiments.md`). Auto-spawned `experiment_reviewer` does adversarial post-hoc audit (`satisfied` / `revise`).
4. **Derive math** — `math` sub-agent (OpenAI o3 + Wolfram Engine) for symbolic work the main brain shouldn't do inline.
5. **Author publication-grade figures** — `illustrator_write` writes the first-pass plot script from raw experiment data; `illustrator` polishes / regenerates with the hybrid Nano Banana + TikZ pipeline; `typesetter` audits how each figure floats in the rendered PDF.
6. **Write and compile LaTeX** — venue-specific styles, BibTeX, and figure-citation enforcement, with `provref` ensuring every numeric claim resolves to a JSON key.
7. **Submit to layered adversarial review** — `reviewer` (Opus PI persona) reads the project state and challenges findings on content; its `figure_finalize_loop` spawns `illustrator` (figure internals) and `typesetter` (PDF layout) before any STOP verdict.
8. **Finish only through deterministic gates** — `finish` is blocked unless: every `### E_N` heading in `notes/plan.md` has a matching `## L2.N` (or `## E_N`) in `notes/experiments.md` with `Status: Complete`, PI verdict is `stop` (or brain wrote a fresh pushback), `typesetter_notes.md` is `all-clear` and its `report_pdf_md5` matches the live PDF, ≥1 self-generated figure is included, and no background agents are still running. The reviewer is held to the same plan/experiments closure check before it can issue `stop`, so a "PI STOP after Pending → brain deadlocked" race is structurally impossible.

The CLI entry points are small: `luxas init`, `luxas run`, `luxas status`, `luxas list`, `luxas figures`. Everything else happens inside the harness.

---

## Quick Start

### Before you run — system dependencies

`npm install` alone is not enough; agents shell out to LaTeX, Python, and tmux. Install once:

```bash
# macOS
brew install --cask mactex      # or basictex for ~150MB instead of ~5GB
brew install poppler tmux python@3.11
pip3 install matplotlib numpy

# Linux (Debian/Ubuntu)
sudo apt install texlive-latex-extra texlive-fonts-recommended poppler-utils tmux python3-matplotlib python3-numpy
```

See [Requirements](#requirements) for optional extras (Wolfram, browser-use, provref).

### Install + first run

```bash
git clone https://github.com/Muuuun/luxas.git
cd luxas
npm install
npm link                              # makes `luxas` available globally
                                      # (skip if you'd rather prefix every cmd with `npx tsx src/index.ts`)

# Set at least one provider key (any of these works; mix & match for multi-model runs)
export ANTHROPIC_API_KEY="..."        # Claude (default)
# export DEEPSEEK_API_KEY="..."       # for --model deepseek-v4-pro or LUXAS_MODEL_PROFILE
# export KIMI_API_KEY="..."           # for LUXAS_VISION_MODEL_PROFILE=kimi-coding

# Initialize a new project from a one-line prompt (PI writes RESEARCH.md for you)
luxas init ~/research/reasoning --prompt "Survey LLM chain-of-thought reasoning"

# Or create RESEARCH.md by hand and run
luxas run ~/research/reasoning --model opus

# Check on a running or finished project
luxas status ~/research/reasoning

# Re-run only the figure / typesetter finalize loop (skip content review)
luxas figures ~/research/reasoning

# List every project Luxas has ever touched
luxas list
```

### Switching models

Every agent's model is declared in its `.md` frontmatter (`opus` / `sonnet` / `haiku` / `gpt-5.2` / `deepseek-v4-pro` / `deepseek-v4-flash` / `kimi-coding`). Three switching levers, in order of granularity:

```bash
# 1. Switch the brain only (sub-agents follow their own .md)
luxas run ~/research/x --model deepseek-v4-pro
luxas run ~/research/x --model opus

# 2. Switch the whole Anthropic family in one shot (haiku/sonnet/opus → profile)
LUXAS_MODEL_PROFILE=deepseek-v4-pro luxas run ~/research/x

# 3. Cheap text + capable vision (recommended for budget-bound runs)
LUXAS_MODEL_PROFILE=deepseek-v4-pro \
LUXAS_VISION_MODEL_PROFILE=kimi-coding \
  luxas run ~/research/x

# 4. Default (no env, no --model) → full Claude per frontmatter
luxas run ~/research/x
```

`LUXAS_MODEL_PROFILE` only redirects agents that declared `haiku/sonnet/opus` — provider-specific picks like `gpt-5.2` (the `math` agent's reasoning model) bypass on purpose. Vision-required agents (`illustrator`, `illustrator_write`, `typesetter`) need `LUXAS_VISION_MODEL_PROFILE` separately because DeepSeek-v4 is text-only; without it, those agents silently produce unverified figures. The resolution lives in `applyProfile()` in `src/agents/spawn.ts`.

Rough cost envelope per full run, **anecdotal — varies wildly with topic, literature depth, experiment count, and reviewer iterations**. After your first run check `<project>/.agent/usage.log` for the actual breakdown.

| Profile | Anecdotal $/run | Notes |
|---|---|---|
| Default (full Claude) | $20–80 (one runaway loop hit $70 before the 500-turn cap landed) | Best for content-heavy review work; only profile with Anthropic prompt caching |
| `MODEL_PROFILE=deepseek-v4-pro` + Kimi vision | $2–10 | Loses ephemeral `cache_control` (brain context rebuilds every turn); figures via Kimi |
| `--model opus` only | $20–80 | Lifts brain quality; sub-agents follow their own `.md` picks |

DeepSeek and Kimi keys: `DEEPSEEK_API_KEY` / `KIMI_API_KEY`, or `~/.sisyphus/auth.json` `{deepseek, kimi}`. See [Requirements](#requirements) for the full key matrix.

A run will populate the project directory with notes, downloaded papers, per-experiment artifacts, and a compiled PDF:

```
~/research/reasoning/
├── RESEARCH.md                 ← the only file you write (read-only for the agent)
├── notes/
│   ├── literature.md           ← agent-maintained literature ledger
│   ├── literature.d/           ← per-paper fragments (reader output, merged by hook)
│   ├── experiments.md          ← per-experiment L2.X sections (status: Complete/Pending) — brain-write-locked; only experiment agents append
│   ├── methodology.md          ← agent-maintained methodology ledger
│   ├── methodology.d/          ← per-paper methodology fragments
│   └── memory.md               ← freeform scratchpad
├── data/
│   ├── papers/                 ← downloaded sources (LaTeX preferred)
│   └── experiments/<EXP_ID>/   ← per-experiment dirs:
│       ├── scripts/            ← tool_impl scripts + plot_<topic>.py from illustrator_write
│       ├── tests/              ← tool_review tests (blind to impl)
│       └── runs/run_N/         ← run snapshots + results.json + raw data
├── report/
│   ├── report.tex
│   ├── references.bib
│   ├── provref.sty             ← provref shim (auto-embedded by init_report)
│   ├── figures/                ← canonical figures cited by report.tex + style_guide.md
│   └── report.pdf
├── reviews/
│   ├── pi_feedback.md          ← reviewer (PI) verdicts
│   ├── pi_pushback.md          ← brain's documented dissent (escape hatch for STEER → finish)
│   ├── illustrator_notes.md    ← figure-internal audit (frontmatter parsed by finish-gate)
│   └── typesetter_notes.md     ← PDF page-layout audit (md5-fresh + all-clear required to finish)
└── .agent/
    ├── log.jsonl               ← append-only session log
    ├── checkpoint.jsonl        ← brain state (survives crashes)
    ├── active-agents.json      ← live sub-agent registry (heartbeat-tracked)
    ├── usage.log               ← per-turn cost / token / model log
    └── conversations/          ← per-sub-agent JSONL (orphan recovery on resume)
```

---

## How It Works

### Five layers, assembled from pi-agent-core

Luxas vendors four [pi-mono](https://github.com/badlogic/pi-mono) packages (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`) as `.tgz` in `vendor/`. The harness assembles those primitives into a research-specific agent:

| Layer | File | Role |
|---|---|---|
| **1 — System prompt** | `src/agents/definitions/brain.md` | Three cache-controlled blocks: L1 = brain methodology body + smelt patches (1h cache), L2 = RESEARCH.md + skills + lessons (cache), L3 = `<active_agents>` + `<completed_artifacts>` + `<plan_status>` (mutable, in-place rebuild on sub-agent harvest / plan edit). |
| **2 — Tools** | `src/tools/` | Coding (`read`/`write`/`edit`/`bash`), `compile_latex`, `init_report`, `spawn_agent`, `idle`, `request_pi_review`, `figure-gen` (`generate_raster_component`, `compile_tikz`, `extract_pdf_figures`), `wolfram`, `finish`. |
| **3 — Context transform** | `src/context.ts` + `src/agents/context-builders.ts` | Per-agent dynamic context injection. Brain gets a research snapshot + a `<figure_convergence>` tag (re-hashed from `illustrator_notes.md` + `typesetter_notes.md` per turn, so the reviewer can short-circuit redundant audits). Two-stage compaction: 60K char warning → 80K hard compress with summary carry-over. |
| **4 — Hooks** | `src/hooks.ts` | Write-protects `RESEARCH.md`, enforces cost limit (`process.exit(1)` on exceed), rate-limits search APIs, appends every tool call to `log.jsonl`, snapshots brain state on every `turn_end`. |
| **5 — PI fallback monitor** | `src/pi-agent.ts` | Schedules the `reviewer` sub-agent on a step-count fallback (every 50 turns without a brain-triggered review) and on milestone tool calls. The reviewer agent itself lives in `src/agents/definitions/reviewer.md` — Opus persona that reads project state, runs the `figure_finalize_loop`, and submits a `continue` / `steer` / `stop` verdict to `reviews/pi_feedback.md`. |

### Stateless harness

**Nothing lives only in process memory.** The brain's token counts, cost, PI status, compaction markers, and sub-agent registry are all written to files on every turn. A crash mid-research is fully recoverable:

- **Brain state** — `session.ts` writes `StateEntry` records to the JSONL log; `deriveState()` reverse-scans on restart to reconstruct the agent's accounting before replaying the checkpoint.
- **Sub-agents** — spawned as detached Node.js processes via `subagent-runner.ts`. Each has its own conversation file under `.agent/conversations/` and a heartbeat. The brain talks to them through `active-agents.json`. If the brain dies, the sub-agents keep running. If a sub-agent dies, the brain notices via heartbeat timeout (90s grace at startup, 60s steady-state) and harvests whatever result it managed to write. On resume, orphan results are recovered into the brain's context.
- **`idle` tool** — when brain has spawned background agents and has no foreground work, `idle()` blocks the brain on the harness side at zero LLM cost (poll registry every 2s) and returns all completions in one tool output. Replaces the prior `[KEEP-ALIVE]` polling loop that burned an LLM turn per check.
- **Session log** — `log.jsonl` is append-only; `checkpoint.jsonl` is the replayable working memory. On a fresh `luxas run`, a finished session is archived (`.done-<timestamp>.jsonl`) and the next run starts clean.

The philosophy is: prompt is code, `.md` files are long-term memory, `checkpoint.jsonl` is working memory, and the report is the artifact. Every layer of state has a file on disk.

### V5 experiment workflow (Design → Impl + Review → Integrate)

The `experiment` agent doesn't write code itself. It:

1. **Designs** — lists each tool (name, ~100-word description, input signature, output shape, impl hint).
2. **Impl + Review (parallel, blind)** — for each tool, spawns `tool_impl` and `tool_review` together. `tool_impl` only sees the description and writes `scripts/<tool>.py`. `tool_review` only sees the description and writes `tests/test_<tool>.py`. Neither sees the other's output. The parent runs pytest as the only ground truth; on failure, `SendMessage` ferries the pytest output to `tool_impl` for fixes (3-revision cap).
3. **Integrate** — runs the validated tools, lands `data/experiments/<EXP_ID>/runs/run_N/results.json`, appends a `## L2.X — <topic>` section to `notes/experiments.md`.

The independent-author pattern blocks the self-circular failure mode where impl-and-test are written together (the impl redefines a field's semantics so its own self-reported value passes its own assertion). When `experiment` returns, the harness auto-spawns `experiment_reviewer` for an adversarial post-hoc audit; if its verdict is `revise`, the experiment is re-spawned with the feedback injected.

### Commitment ledger: plan as authority, PI gates closure

Two files form the project's commitment ledger:

- **`notes/plan.md`** — source of truth for what's promised. Each `### E_N` heading is a hard commitment.
- **`notes/experiments.md`** — audit log. Each `## L2.N` (or `## E_N`) section is the experiment agent's record, with `Status: Complete` / `Pending`.

Two aligned gates enforce closure between the two files, at different levels:

| Gate | Where | What it enforces |
|---|---|---|
| **`finish` tool gate** | `src/tools/index.ts` | Every `### E_N` in `plan.md` must have a matching `## L2.N` / `## E_N` in `experiments.md` with `Status: Complete`. Tool-layer hard block. |
| **PI STOP precondition** | `reviewer.md` `<verdict_rules>` | Reviewer cannot issue `stop` while any active plan `### E_N` is missing or non-Complete in `experiments.md`. Prompt-layer rule, mirrors the tool gate one layer up. |

The two gates are aligned: PI must clear the same condition before `stop` that `finish` enforces before exit. This eliminates the deadlock where PI issues `stop`, brain calls `finish`, gate blocks, and brain has no way to reconcile (it cannot write `experiments.md`).

**Three hard invariants follow:**

1. **brain cannot write `notes/experiments.md`.** The audit ledger is owned by experiment agents only, enforced via `safety.protectedFiles` in `brain.md` and a heredoc-bash escape block.
2. **Scope reduction is `plan.md`-only.** To drop an experiment, brain removes the `### E_N` heading from `plan.md` and re-runs `request_pi_review`. Prose like "(Descoped)" next to a heading does not remove it from active scope while the heading remains.
3. **`Deferred` is not a status.** Removed in Apr-26 after observed abuse as a soft escape hatch. Only `Complete` lets a `### E_N` exit active scope.

This design closes a class of failure modes observed live: brain wiping `experiments.md` to bypass the gate, brain marking experiments `Deferred` with weak justifications, brain writing prose-descope while keeping the heading, and PI issuing `stop` despite Pending entries (which then deadlocked `finish`).

### Finalize loop (figures + layout)

When the reviewer is about to vote `stop`, it first runs the `<figure_finalize_loop>` from `reviewer.md`:

1. Enumerate canonical figures from `report.tex` `\includegraphics`.
2. Spawn one `illustrator` per source script (parallel) to regenerate / restyle figures against `report/figures/style_guide.md`.
3. Spawn one global-audit `illustrator` to read every PNG and write `reviews/illustrator_notes.md` (figure-internal: palette / spines / typography / clipping).
4. Spawn one `typesetter` to rasterize `report/report.pdf` page by page and write `reviews/typesetter_notes.md` (document-level: figure floats vs first `\ref`, caption integrity, column overflow, missing-file red boxes).
5. Loop only breaks when **both** notes files report `status: all-clear`. Layout issues (which `illustrator` cannot fix) fold into PI's steer feedback for brain to address in the LaTeX source.

The `<figure_convergence>` tag in the reviewer's context is computed from both notes files plus a re-hash of every recorded artifact. If `converged`, the loop short-circuits — re-auditing unchanged artifacts is pure waste.

---

## Agent Definitions

Every agent lives in `src/agents/definitions/*.md`. Each file is YAML frontmatter (the config) + markdown body (the system prompt). **TypeScript interprets the frontmatter; it never hard-codes per-agent behaviour**. Adding an agent, changing permissions, or restricting its spawn reach is one `.md` edit.

### Example: `tool_impl.md` frontmatter

```yaml
---
name: tool_impl
description: >
  Writes impl scripts from a tool description, blind to the test agent.
model: sonnet
thinkingLevel: medium
toolSets: [coding]
templates: [PROJECT_DIR, EXPERIMENT_ID, TOOL_NAME]

spawn:
  enabled: false

safety:
  presets: [research_brief, report_surface, notes_ledger]
  allowedReadRoots: ["data/experiments/{{EXPERIMENT_ID}}"]
  writeOnExistingPolicy: block
---

You write ONE Python tool from its description...
```

### Frontmatter schema

| Field | Meaning |
|---|---|
| `name` | Unique identifier used by `spawn_agent` |
| `description` | Shown in the `spawn_agent` catalog that parent agents see |
| `model` | `opus` / `sonnet` / `haiku` / `gpt-5.2` / `deepseek-v4-pro` / `deepseek-v4-flash` / `kimi-coding` / `inherit`. Subject to `LUXAS_MODEL_PROFILE` redirect for the Anthropic tier. |
| `thinkingLevel` | `off` / `low` / `medium` / `high` |
| `toolSets` | Names from `src/agents/tool-sets.ts` (`coding`, `report`, `pi`, `wolfram`, `figure-gen`) |
| `contextBuilder` | Optional — name of a dynamic-context builder in `src/agents/context-builders.ts` |
| `templates` | Variable names the prompt body references as `{{VAR}}` |
| `spawn.enabled` | `true` = this agent can spawn sub-agents; `false` = leaf |
| `spawn.allowedTypes` | Whitelist of child agent types. Omit = allow any registered type |
| `safety.presets` | Names from `src/agents/safety-presets.ts` — groups of protected paths |
| `safety.protectedFiles` | Additional paths beyond those from presets |
| `safety.allowedReadRoots` | Restrict read scope (supports `{{VAR}}` templates). Omit = no restriction |
| `safety.writeOnExistingPolicy` | `block` (force `edit`) or `allow_as_read` (default: `block`) |

### Safety presets (`src/agents/safety-presets.ts`)

| Preset | Paths |
|---|---|
| `research_brief` | `RESEARCH.md` |
| `report_surface` | `report.tex`, `references.bib`, `notes/literature.md` |
| `notes_ledger` | `notes/experiments.md`, `notes/memory.md`, `notes/plan.md` |
| `experiment_scope` | `data/experiments/{{EXPERIMENT_ID}}` |

An agent composes presets to express its surface: `tool_impl` uses `[research_brief, report_surface, notes_ledger]` to block everything the experiment owns, then `allowedReadRoots` to scope it to its own experiment's dir.

### Load-time validation

Two checks run when `loadAgentDefinitions` parses the `.md` files:

- **Preset names** — unknown `safety.presets` entries hard-fail with filename context (typos don't silently degrade protection).
- **Spawn graph** — `validateSpawnGraph` runs DFS over the `spawn.allowedTypes` edges across all agents. A declared cycle throws at startup, not at runtime, with the full path (`brain → experiment → brain`).

### Spawn semantics

```ts
spawn_agent({ agent: "experiment", task: "Run 1000 MCMC samples on the Ising model at T=2.0",
              templateVars: { EXPERIMENT_ID: "E1_ising_mcmc" } })
spawn_agent({ agent: "search",     task: "Find recent work on energy-based models post-2024" })
spawn_agent({ agent: "fixer",      task: "compile_latex failed with 'undefined control sequence \\foo'" })
spawn_agent({ agent: "worker",     tasks: [...parallelTasks], background: true })
```

Three execution modes: **foreground** (blocks brain, returns result), **parallel** (`tasks: []` — N instances run concurrently, brain blocks on all), **background** (`background: true` — agent runs detached, result steered into brain on next harvest). The brain is hard-locked from calling `finish` while background agents are still running.

Sub-agent spawn depth is globally capped at **2** (`MAX_SPAWN_DEPTH` in `spawn.ts`).

---

## Agents

Fourteen agent types ship by default.

| Agent | Model | Role |
|---|---|---|
| **brain** | Opus (high) | Main research driver. Decomposes RESEARCH.md, surveys literature, sequences experiments, integrates results, writes the report, iterates on PI feedback. |
| **search** | Sonnet | Literature discovery — OpenAlex, arXiv, CrossRef, web, citation chains, anti-detect browser for paywalls. |
| **reader** | Sonnet | Per-paper extraction. Writes `notes/literature.d/<paper>.md` and `notes/methodology.d/<paper>.md` fragments; a post-spawn hook merges them back into the canonical ledgers. |
| **worker** | Sonnet | Lightweight parallel worker — batch downloads, file ops. |
| **experiment** | Opus (high) | 3-phase orchestrator (Design → Impl+Review → Integrate). Spawns `tool_impl` + `tool_review` per tool; never writes code itself. |
| **tool_impl** | Sonnet | Writes `scripts/<tool>.py` from the tool description only. Cannot read tests. |
| **tool_review** | Sonnet | Writes `tests/test_<tool>.py` from the tool description only. Cannot read impl. Asserts ground truth from inputs, not impl-self-reported outputs; ≥1 adversarial test per tool. |
| **experiment_reviewer** | Opus (medium) | Auto-spawned post-experiment. Reads the L2.X section, results, raw data, cited literature; verdict `satisfied` / `revise`. |
| **math** | OpenAI o3 | Symbolic derivation — integrals, ODEs/PDEs, Taylor expansions, dimensional analysis. Wolfram Engine via `wolframscript`; sympy fallback. |
| **illustrator** | Sonnet (high) | Visual designer with zero domain expertise. Two modes: **audit** (read figures + style guide, write `illustrator_notes.md` with 12-item checklist) and **generate** (edit `data/scripts/plot_*.py` in place + rerun, or pgfplots / hybrid Nano Banana + TikZ for schematics). |
| **illustrator_write** | Sonnet (medium) | Domain-aware first-pass plot script author. Reads raw NPZ/CSV from a run dir, writes `plot_<topic>.py`, runs it, lands the PDF + PNG at `report/figures/`. |
| **typesetter** | Sonnet (medium) | Document-level layout auditor. Rasterizes `report.pdf` via pdftoppm, reads each page image, writes `reviews/typesetter_notes.md`. Catches what `illustrator` cannot: figure floats, caption splits, column overflow, missing-file red boxes, orphan headings. Strictly orthogonal to `illustrator` (figures) and `reviewer` (content). |
| **reviewer** | Opus (medium) | Adversarial PI. Reads project state, challenges findings on content, runs the `figure_finalize_loop` (illustrator + typesetter) before any `stop` verdict. Returns `continue` / `steer` / `stop` to `reviews/pi_feedback.md`. |
| **fixer** | Haiku (low) | Mechanical LaTeX compile-error fixer. Single-edit + recompile loop. Brain delegates here instead of burning Opus tokens on syntax debugging. |

---

## Tools

Tool visibility is per-agent, controlled by `toolSets` in each `.md` definition.

**Brain tools** (`src/tools/index.ts`):

| Tool | What it does |
|---|---|
| `read` / `write` / `edit` / `bash` | File ops + shell (from `pi-coding-agent`, wrapped with read-before-edit + mtime staleness checks + fresh-excerpt recovery on edit failure) |
| `init_report` | Scaffolds `report/` with `report.tex`, `references.bib`, `figstyle.mplstyle`, and the embedded `provref.sty` shim |
| `compile_latex` | `pdflatex` + `bibtex`, with figure-citation enforcement and just-in-time provref validation before the final compile |
| `spawn_agent` | Generic agent spawner (foreground / parallel / background) |
| `idle` | Block on running background agents at zero LLM cost; harness polls the registry and returns all completions in one tool output |
| `request_pi_review` | Brain-triggered milestone review (alternative to the step-count fallback in `pi-agent.ts`) |
| `finish` | Marks research complete — gated on the full finish-gate stack (see [Safety](#safety)) |

**Sub-agent-only tool-sets** (`src/agents/tool-sets.ts`):

| Tool-set | Tools | Agents |
|---|---|---|
| `figure-gen` | `generate_raster_component` (Nano Banana + rembg), `compile_tikz` (pdflatex + optional pdftoppm preview), `extract_pdf_figures` (pdftoppm rasterize, used by `typesetter` to read PDF pages) | `illustrator`, `illustrator_write`, `typesetter` |
| `wolfram` | `wolfram` — `wolframscript` bridge for symbolic computation; sympy fallback | `math` |
| `pi` | reviewer-only tools (verdict submission, conversation pinning) | `reviewer` |
| `report` | `compile_latex`, `init_report` | `brain` |

### provref integration

Luxas is a sister project to [provref](https://github.com/Muuuun/provref), which stops the agent from typing numerical values directly into LaTeX. `init_report` embeds `provref.sty` into the report directory, and `compile_latex` runs `provref merge` + `provref check` before the final `pdflatex` pass. The brain writes `\resultref{run_5.accuracy}` instead of `87.3\%` — so every number in the published PDF is traceable to a JSON key in `data/experiments/<EXP>/runs/`. If the agent hallucinates a reference, the build fails loudly with "Did you mean...?" hints before any PDF is produced.

---

## Skills

Skills live in `skills/` and follow the Agent Skills standard (`SKILL.md` + scripts):

| Skill | What it's for |
|---|---|
| `skills/search/` | Paper discovery — `search` CLI (OpenAlex/arXiv/CrossRef + dedup + ranking), citation chains, arXiv LaTeX source download, figure extraction, Brave web search, anti-detect browser for paywalled venues |
| `skills/figure/` | Hybrid figure pipeline — Nano Banana raster components + rembg background strip + TikZ vector assembly. Includes 11 TikZ templates (quantikz / feynman / circuitikz / chemfig / pgfplots / energy_levels / phase_space / pulse_sequence / optical_setup / hybrid_panels) and per-domain palettes / pitfalls references |
| `skills/venue-specific/` | Formatting rules for 30+ top journals and conferences — Nature, Science, Cell, PRL, NEJM, Lancet, JACS, NeurIPS, ICML. Includes matching `figstyles/` (matplotlib) and `references/` (BibTeX) per venue |
| `skills/review/` | Survey / synthesis discipline — 10-domain style guide, anti-stacking rules, outline-first / synthesis-rewrite pipeline (sourced from the `review_style_skills` project) |
| `skills/survey-methodology/` | Methodology layer above `review/` — domain-specific survey construction (claim taxonomies, evidence weighting, coverage scoring) so a literature survey is a piece of analysis rather than an annotated bibliography |
| `skills/memory/` | Cross-project memory protocol — how to read/write `~/.sisyphus/memory.md` and the per-project `notes/` |

Supporting reference skills (`matplotlib-figures/`, `paper-figures/`) provide additional style guides and worked examples.

---

## Memory System

Luxas borrows the pre-compaction memory flush from OpenClaw, but stays file-based — no embeddings, no vector search.

**Per-project memory** (`notes/`):
- `literature.md`, `experiments.md`, `methodology.md`, `memory.md` — all maintained by the agent.
- `literature.d/` and `methodology.d/` — per-paper fragments written by `reader`; a post-spawn hook merges them back into the canonical ledgers atomically (~50 ms) so brain never sees stale aggregates.
- Every LLM call gets a fresh research-state snapshot injected via `context.ts`.
- Notes files are smart-truncated when they outgrow the budget: section headers stay as a table of contents, recent content is preserved verbatim.

**Cross-project memory** (`~/.sisyphus/`):
- `projects.json` — registry of every project Luxas has ever run (path, name, summary, total cost, tokens).
- `memory.md` — agent-writable global memory for cross-project insights.
- New projects automatically see a "Past Research Projects" section in their system context.
- `luxas list` dumps the registry with per-project summaries.

> **Note:** the user-data path is `~/.sisyphus/` (the project's original name). The rename to Luxas kept disk paths intact so existing memory and project history survived.

---

## Safety

Every constraint is a hook, a tool guard, a frontmatter-declared scope, or a finish-gate — not a prompt-level instruction. The brain cannot talk its way out of them.

| Limit | Default | Enforced by |
|---|---|---|
| Max cost per run | unbounded (pass `--max-cost` to set) — `process.exit(1)` on exceed | `hooks.ts` |
| Max LLM turns per run | 500 — `process.exit(1)` on exceed (replaced wall-clock 8h limit; observed $70 burn from a stuck retry loop) | `agent.ts` |
| PI review fallback interval | every 50 turns without a brain-triggered review | `pi-agent.ts` |
| Max sub-agent spawn depth | 2 | `agents/spawn.ts` |
| Spawn graph acyclicity | declared cycles throw at startup | `agents/registry.ts::validateSpawnGraph` |
| Max compaction failures before abort | 3 | `context.ts` |
| `RESEARCH.md` | write-protected (via `safety.presets: [research_brief]`) | declared in every writing agent's `.md` |
| Per-agent write scope | `safety.presets` + `safety.protectedFiles`; default `writeOnExistingPolicy: block` (forces `edit` over `write`) | compiled by `buildSafetyWrapper` from each agent's `.md` |
| Per-agent read scope | `safety.allowedReadRoots` with `{{VAR}}` templating (e.g. `tool_impl` / `tool_review` scoped to `data/experiments/{{EXPERIMENT_ID}}/`) | compiled by `buildSafetyWrapper` |
| `finish` gate stack | (a) no background agents running, (b) every `### E_N` in `notes/plan.md` has a matching `## L2.N` / `## E_N` in `notes/experiments.md` with `Status: Complete` (no `Deferred` escape hatch since Apr-26), (c) `report.pdf` exists, (d) ≥1 self-generated figure, (e) `typesetter_notes.md` status `all-clear` + `report_pdf_md5` matches live PDF, (f) PI verdict is `stop` (or `pi_pushback.md` mtime > `pi_feedback.md` mtime) | `tools/index.ts` |
| PI STOP precondition | Reviewer cannot issue `stop` while any active plan `### E_N` is missing or non-Complete in `experiments.md` — mirrors the `finish` gate one layer up so a "STOP after Pending" deadlock is structurally impossible | `agents/definitions/reviewer.md` `<verdict_rules>` |
| `notes/experiments.md` write lock | brain cannot write/edit/heredoc-bash this file — only experiment agents may append their own `## L2.N` sections | `safety.protectedFiles` + bash write-guard in `brain.md` |

The `finish` tool is the only clean exit. Anything else is a crash, and the stateless harness is designed to survive crashes. The PI-pushback escape exists so brain can defensibly disagree with PI without entering a dead loop — it must produce written justification fresher than the disputed feedback, and `maxTurns` caps any true runaway at bounded damage.

**The write scopes the table calls out are not TS code** — they live in the agent's own `.md` frontmatter. For example, `tool_impl.md` declares:

```yaml
safety:
  presets: [research_brief, report_surface, notes_ledger]
  allowedReadRoots: ["data/experiments/{{EXPERIMENT_ID}}"]
  writeOnExistingPolicy: block
```

`buildSafetyWrapper` compiles that declaration into the runtime tool-layer checks. Changing what an agent can write or read is an `.md` edit; `safety-wrappers.ts` has no agent names in it.

---

## Project Structure

```
luxas/
├── README.md
├── package.json
├── tsconfig.json
├── vendor/                         ← customized pi-mono .tgz bundles
├── patches/                        ← post-install patches for vendored pi-* packages
├── src/
│   ├── index.ts                    ← CLI entry (run / status / init / list / figures)
│   ├── agent.ts                    ← 5-layer brain assembly + L3 in-place rebuild + maxTurns kill
│   ├── auth.ts                     ← API key resolution (Anthropic / OpenAI / DeepSeek / Kimi / Brave; env + ~/.sisyphus/auth.json fallback)
│   ├── context.ts                  ← state injection + two-stage compaction
│   ├── compaction/                 ← message compaction pipeline
│   ├── hooks.ts                    ← safety + cost limit (process.exit) + logging + state snapshots
│   ├── session.ts                  ← JSONL session DAG + StateEntry + deriveState
│   ├── active-agents.ts            ← file-backed sub-agent registry (heartbeat + zombie detection)
│   ├── subagent-runner.ts          ← detached sub-agent process entry point
│   ├── pi-agent.ts                 ← PI fallback monitor (schedules reviewer spawns)
│   ├── extensions.ts               ← lifecycle event bus
│   ├── reminders.ts                ← state-aware reminder injection (figure / citation / PI)
│   ├── memory.ts                   ← cross-project registry + global memory
│   ├── methodology.ts              ← methodology ledger merge helpers
│   ├── notes-compaction.ts         ← smart-truncate notes files
│   ├── usage-log.ts                ← per-turn cost / token / model log + readUsageTotals
│   ├── transform.ts                ← cross-model message cleaning on resume
│   ├── edit-recovery.ts            ← fresh-excerpt recovery on edit failure
│   ├── messages.ts                 ← message helpers
│   ├── utils.ts                    ← expandTemplate + misc helpers
│   ├── agents/
│   │   ├── definitions/            ← the 14 agent .md files (name + schema + prompt)
│   │   ├── registry.ts             ← js-yaml parse + AgentDefinition + validateSpawnGraph + cache
│   │   ├── spawn.ts                ← buildAgentFromDefinition (assembles agent from .md config)
│   │   ├── tool-sets.ts            ← named tool-set factories (coding / report / pi / wolfram / figure-gen)
│   │   ├── context-builders.ts     ← per-agent dynamic context (brain L3 + figure_convergence)
│   │   ├── safety-presets.ts       ← named path groups (research_brief / report_surface / notes_ledger / experiment_scope)
│   │   └── safety-wrappers.ts      ← buildSafetyWrapper + createSafetyWrapper runtime enforcement
│   ├── tools/
│   │   ├── index.ts                ← finish-gate stack + idle + brain tool assembly
│   │   ├── spawn-agent.ts          ← generic agent spawner + post-experiment reviewer loop
│   │   ├── coding.ts               ← pi-coding-agent wrapper
│   │   ├── report.ts               ← compile_latex
│   │   ├── init-report.ts          ← scaffolds report/ with provref.sty embedded
│   │   ├── provref-utils.ts        ← provref merge + check wiring
│   │   ├── figure-gen.ts           ← Nano Banana + TikZ + extract_pdf_figures
│   │   └── wolfram.ts              ← wolframscript bridge (sympy fallback)
│   └── tui/                        ← Ink-based interactive dashboard
├── skills/
│   ├── search/                     ← paper search skill
│   ├── figure/                     ← hybrid figure pipeline + 11 TikZ templates
│   ├── venue-specific/             ← 30+ venue formatting specs
│   ├── review/                     ← survey/synthesis narrative discipline
│   ├── memory/                     ← cross-project memory protocol
│   ├── matplotlib-figures/         ← style guides + worked examples
│   └── paper-figures/              ← reference figures by domain
├── scripts/                        ← smoke tests (smoke_v5_defs, smoke_typesetter, smoke_spawn_cycle_static, …)
├── schemas/                        ← JSON schemas for state files
└── monitor/                        ← log-watching helpers
```

---

## Requirements

- **Node.js** 22+
- **`ANTHROPIC_API_KEY`** environment variable
- **LaTeX** — `pdflatex` + `bibtex` in `PATH`. On macOS, `brew install --cask mactex` or `basictex`. Matplotlib `text.usetex: True` (used by venue-specific figstyles) depends on this.
- **poppler** — `pdftoppm`, `pdftotext`, `pdfimages` (used by `extract_pdf_figures` and the `typesetter` agent to rasterize the report PDF)
- **Python 3.10+** with `matplotlib` and `numpy` — for experiments and plots
- **tmux** — every worker / experiment gets its own window for live observability
- **provref** (optional but recommended) — `npm i -g provref` for the merge / check steps during compilation
- **`WOLFRAM_APP_ID`** or local Wolfram Engine (optional) — for the math agent; falls back to sympy otherwise
- **`OPENAI_API_KEY`** (optional) — for the math agent (o3)
- **`DEEPSEEK_API_KEY`** (optional) — for `deepseek-v4-pro` / `deepseek-v4-flash` (1M context, dual Thinking/Non-Thinking modes via `api.deepseek.com/v1`). Set `LUXAS_MODEL_PROFILE=deepseek-v4-pro` to redirect every `haiku/sonnet/opus` agent family-wide — ~10× cheaper than Claude but loses Anthropic-style ephemeral `cache_control` (so brain context rebuilds on every turn). Best paired with `LUXAS_VISION_MODEL_PROFILE=kimi-coding` so the figure pipeline (DeepSeek is text-only) keeps producing verified visuals.
- **`KIMI_API_KEY`** (optional) — for `kimi-coding` (Moonshot Kimi K2). Used as the vision model in dual-profile runs (`LUXAS_VISION_MODEL_PROFILE=kimi-coding`); `illustrator` / `illustrator_write` / `typesetter` route here while everything else goes to DeepSeek.
- **`BRAVE_API_KEY`** (optional) — for web search in the search skill
- **browser-use** (optional) — anti-detect browser at `~/.browser-use-env/bin/browser-use` for paywalled sites
- **`GEMINI_API_KEY`** (optional) — for `generate_raster_component` (Nano Banana) in the hybrid figure pipeline

---

## FAQ

**What is Luxas in one sentence?**
A stateless, file-backed harness that drives Claude (and friends) through a multi-hour, multi-agent research pipeline from topic to compiled PDF, with adversarial self-review at content / figure-internal / PDF-layout layers and crash-recoverable state.

**How do I add a new agent?**
Drop a new `.md` into `src/agents/definitions/`. Declare `model`, `thinkingLevel`, `toolSets`, `templates`, `spawn`, and (if it writes to the project) `safety`. No TypeScript changes — `validateSpawnGraph` sanity-checks the graph on next startup and the new agent is immediately visible to `spawn_agent`.

**How is this different from a single long Claude Code session?**
Claude Code is one agent in one terminal. Luxas is a brain that spawns 13 sub-agent types (search / reader / worker / experiment / tool_impl / tool_review / experiment_reviewer / math / illustrator / illustrator_write / typesetter / reviewer / fixer; the brain itself brings the total to 14 agent types shipped), each routed to a separate model, run as detached processes, with safety limits enforced via hooks and declarative frontmatter rather than prompt. It maintains file-based notes across compaction, applies a two-tier commitment-ledger gate (PI STOP precondition + `finish` tool gate, both checking plan/experiments closure), and survives its own crashes.

**Why split `tool_impl` and `tool_review` instead of letting the experiment write both?**
Because letting one agent write impl + tests is the classic self-circular failure mode — the impl redefines a field's semantics so its own self-reported value passes its own assertion. Observed live: `max_pair_distance_um` got redefined as post-move distance = 0; tests passed; the tool was wrong. The blind-author split (tool_impl reads only the description; tool_review reads only the description; pytest is the only ground truth) blocks this.

**Why do `illustrator` and `typesetter` exist as separate agents?**
They audit orthogonal axes. `illustrator` reads single figure PNGs against a 12-item style checklist (palette / spines / typography / clipping). `typesetter` reads rasterized PDF pages for document-level issues (figure float distance, caption integrity, column overflow, missing-file red boxes). Conflating them into one agent either bloats one prompt with mixed concerns or leaves layout regressions invisible — observed live: a figure source-block was 30+ lines below its first `\ref` and floated to the wrong page; no agent flagged it until a human did.

**How is it different from LangGraph / CrewAI / AutoGPT?**
LangGraph has a graph state machine but expects you to build the graph. CrewAI is role-based but not built for long-running crash-recoverable sessions. AutoGPT is LLM-driven control flow, which is fragile. Luxas uses LLM-driven *content* work but file-backed, hook-enforced control flow. The brain decides what to do next by reading the state of the filesystem, not by holding a plan in its token window.

**Why vendor pi-mono instead of importing it?**
Custom patches to the agent loop, context transform, compaction, and hook lifecycle would be clumsy through a published package. Vendoring `.tgz` files gives full control over the runtime without a fork in git.

**What happens if I crash the brain mid-run?**
Re-run `luxas run <dir>`. The harness detects `checkpoint.jsonl`, replays the session, reconstructs brain state (cost / tokens / PI counters) from reverse-scanning `log.jsonl`, and resumes where it left off. Sub-agents that were running at crash time kept running (they're detached processes); their results are recovered into the brain's context on the next turn via the orphan-recovery path in `agent.ts`.

**Why does the reviewer run separately instead of inline?**
Because the brain asking itself "am I done?" is useless. A separate Opus instance with a different system prompt, no access to the brain's reasoning traces, and a forced `figure_finalize_loop` before any STOP verdict produces adversarial feedback at three layers (content + figure-internal + layout), not agreement. The reviewer writes to `reviews/pi_feedback.md`; that file is injected into the brain's next context, and `finish` is gated on its verdict.

**How does provref fit in?**
provref is a separate tool (see the sister repo) that prevents the agent from typing literal numbers into LaTeX — every numeric claim must resolve to a key in a JSON file, and the build fails if it doesn't. Luxas integrates it into `compile_latex` so the number-provenance guarantee comes for free.

**Does this actually work?**
It runs end-to-end on literature surveys and on small-scale computational research projects. Whether the output is *publication-quality* depends on the model, the topic, and the reviewer's feedback loop, not on the harness. No claims are made about SOTA.

---

## Security

Luxas runs Python, shell commands, and `pip install` autonomously inside the project directory; agents can spawn sub-agents that run detached processes for hours without supervision. Treat any project directory as if it were executed code: don't point Luxas at directories holding credentials, and don't run it as root. Credential surfaces are explicitly guarded — read/write/edit/bash tool wrappers block access to `~/.sisyphus/auth.json`, `~/.aws/credentials`, `~/.netrc`, `~/.ssh/id_*`, and common API-key environment variables (see `src/agents/safety-wrappers.ts`) — but this is defense-in-depth, not a sandbox.

If you find a security issue (sandbox escape, credential leak through an agent's output, command injection through a tool argument), please open a GitHub issue marked `security` rather than disclosing publicly first. There is no separate disclosure inbox at this point — the project is small enough that issues route to the maintainer directly.

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
