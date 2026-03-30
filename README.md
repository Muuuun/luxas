# Luxas — Autonomous Research Agent

<p align="center">
  <strong><i>Il faut imaginer Sisyphe heureux.</i></strong>
</p>

<p align="center">
  <a href="https://github.com/Muuuun/luxas"><img src="https://img.shields.io/github/last-commit/Muuuun/luxas?style=for-the-badge" alt="Last commit"></a>
  <a href="https://github.com/Muuuun/luxas"><img src="https://img.shields.io/badge/pi--mono-custom--fork-orange?style=for-the-badge" alt="pi-mono"></a>
  <a href="https://github.com/Muuuun/luxas"><img src="https://img.shields.io/badge/typescript-5.5+-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**Luxas** is an autonomous research agent that reads papers, synthesizes findings, and writes LaTeX survey reports — end to end, no human intervention. Give it a topic; get back a compiled PDF with 30+ cited papers, structured chapters, and extracted figures.

Built on a **vendored, customized fork** of [pi-mono](https://github.com/badlogic/pi-mono), an open-source agent framework by Mario Zechner.

## How it works

```
                  ┌─────────────────────────────────┐
                  │     Research Agent (Brain)        │
                  │     pi-agent-core · Claude Opus   │
                  │     reads state → decides next    │
                  └───────────────┬─────────────────┘
                                  │ tool calls
                  ┌───────────────▼─────────────────┐
                  │     Hooks + Context Transform     │
                  │     safety · logging · state      │
                  └───────────────┬─────────────────┘
           ┌───────────┬─────────┴─────────┬───────────┐
           ▼           ▼                   ▼           ▼
     ┌───────────┐ ┌───────────┐   ┌───────────┐ ┌───────────┐
     │  Search   │ │  Worker   │…  │  Worker   │ │ Experiment│
     │ Sub-Agent │ │ Sub-Agent │   │ Sub-Agent │ │ Sub-Agent │
     └───────────┘ └───────────┘   └───────────┘ └───────────┘
           all pi-agent-core Agent instances (not CLI subprocesses)
```

The **Brain** is not a fixed pipeline. It reads current state — papers found, extractions done, report quality — and decides what to do next. It can go backwards, skip steps, or parallelize aggressively.

**Sub-Agents** are spawned via tool calls (`search_literature`, `dispatch_workers`, `run_experiment`). Each is a full `new Agent()` with its own tools, model config, and tmux window. Usage rolls up to the parent.

## Quick start

```bash
git clone https://github.com/Muuuun/luxas.git
cd luxas
npm install

# Run a research survey
npx tsx src/index.ts run "Large Language Model Reasoning"

# Resume interrupted work
npx tsx src/index.ts resume

# Interactive TUI dashboard
npx tsx src/index.ts tui
```

> [!TIP]
> Requires authenticated `claude` CLI (Anthropic OAuth or `ANTHROPIC_API_KEY`).
> For PDF output: `pdflatex`, `bibtex`, `pdftotext` (poppler).

## Custom pi-mono runtime

Luxas vendors four pi-mono packages as `.tgz` in `vendor/`, giving full control over the agent runtime:

| Package | Role |
|---------|------|
| `pi-agent-core` | Agent loop, tool lifecycle, hooks, LLM compaction, session DAG |
| `pi-ai` | Model abstraction, provider routing, Anthropic OAuth |
| `pi-coding-agent` | File tools (read / write / edit / bash), experiment agent |
| `pi-tui` | Terminal UI framework (Ink-based) |

## 5-layer architecture

Luxas assembles pi-mono primitives into a research-specific agent:

| Layer | File | What it does |
|-------|------|-------------|
| **1. System Prompt** | `agents/definitions/brain.md` | Research methodology: hypothesis → experiment → discovery cycle |
| **2. Tools** | `tools/` | Coding tools + `compile_latex` + `spawn_agent` (generic agent spawner) |
| **3. Context Transform** | `context.ts` | Injects research state (`.md` files) before every LLM call; two-stage compaction (60K warn → 80K compress) |
| **4. Hooks** | `hooks.ts` | `RESEARCH.md` write-protection, cost/time limits, API rate limiting, JSONL session logging |
| **5. Reviewer** | `pi-agent.ts` | Adversarial quality control (Opus-tier); dual trigger: milestone review + step-count fallback; feedback via `reviews/pi_feedback.md` |

Cross-cutting features:
- **Session DAG** — structured conversation tree with compaction support.
- **Cross-model transform** — clean messages when switching between Claude models (drop encrypted thinking, fix orphaned tool calls).
- **Extension bus** — lifecycle events: session, turn, compaction, experiment, PI feedback, cost.
- **Notes compaction** — smart truncation of literature/experiment notes (keep headers + recent content).
- **Reminder system** — state-aware reminders injected into context.

## Tools

| Tool | Description |
|------|-------------|
| `read` / `write` / `edit` / `bash` | File operations + shell (from pi-coding-agent) |
| `compile_latex` | pdflatex + bibtex compilation with figure citation enforcement |
| `spawn_agent` | Generic agent spawner — brain decides which agent type to spawn (search, worker, experiment, reviewer, or sub-brain) |
| `request_pi_review` | Request feedback from the adversarial reviewer |
| `finish` | Mark research complete (blocked until PDF passes validation) |

## Agent definitions

Each agent is defined as a `.md` file in `src/agents/definitions/`:

| Agent | Model | Description |
|-------|-------|-------------|
| `brain` | opus | Main research brain — plans, delegates, writes reports |
| `search` | sonnet | Searches academic databases, citation chains, web |
| `worker` | sonnet | Lightweight agent for parallel tasks (reading papers, extracting data) |
| `experiment` | opus | Full coding agent for simulations (safety-wrapped) |
| `reviewer` | opus | Adversarial PI reviewer — challenges findings, returns verdict |

Agents are defined using YAML frontmatter + markdown body (system prompt). Adding a new agent = creating one `.md` file. Brain can spawn any defined agent, including sub-brains for complex tasks (max depth: 2).

## Search skill

The search skill (`skills/search/`) handles literature discovery:

- **Paper search** — OpenAlex, arXiv, CrossRef with deduplication and ranking.
- **Citation chains** — forward and backward citation traversal.
- **Download** — arXiv LaTeX source (preferred) or PDF fallback.
- **Figure extraction** — render PDF pages, crop figures, generate `manifest.json`.
- **Web search** — Brave Search API for grey literature and project pages.
- **Anti-detect browser** — Cloudflare bypass for paywalled sites (PRL, Science, Nature).

## Project structure

```
src/
  agent.ts           5-layer brain assembly
  agents/
    definitions/     agent .md files (brain, search, worker, experiment, reviewer)
    registry.ts      loads + caches agent definitions
    spawn.ts         generic agent spawner (used by spawn_agent tool)
    tool-sets.ts     named tool-set factories
    context-builders.ts  dynamic context injection
    safety-wrappers.ts   runtime tool safety constraints
  tools/
    spawn-agent.ts   the single spawn_agent tool
    report.ts        compile_latex tool
    coding.ts        pi-coding-agent wrapper
  context.ts         state injection + compaction
  hooks.ts           safety + logging hooks
  pi-agent.ts        reviewer lifecycle (milestone + fallback triggers)
  session.ts         session DAG with compaction
  extensions.ts      lifecycle event bus
  reminders.ts       state-aware reminder injection
  auth.ts            Anthropic OAuth PKCE
  tui/               interactive terminal dashboard

skills/
  search/            literature search skill
    scripts/
      search         paper search + citation chains + web
      browse         anti-detect browser
      extract-figures  PDF figure extraction

vendor/              customized pi-mono packages (.tgz)
```

Each research project:

```
project/
  RESEARCH.md            research goal (read-only, human-written)
  notes/
    literature.md        agent-maintained literature notes
    experiments.md       agent-maintained experiment notes
    memory.md            agent scratchpad
  data/
    papers/              downloaded papers (LaTeX source preferred)
    runs/                numbered experiment snapshots
  report/
    report.tex           LaTeX survey
    references.bib       BibTeX database
    report.pdf           compiled output
  reviews/
    pi_feedback.md       PI monitor feedback
  .agent/
    log.jsonl            append-only session log
    checkpoint.jsonl     crash-recovery checkpoint
```

## Safety

| Limit | Default |
|-------|---------|
| Max cost per run | $50 |
| Max duration | 8 hours |
| Max agent steps | 50 |
| Consecutive failures before pause | 5 |
| Loop detection (same action repeat) | 4× |
| Max concurrent workers | 8 |
| `RESEARCH.md` | Write-protected |
| Report validation | Blocks `finish` until PDF passes checks |

## Requirements

- **Node.js** 22+
- **claude** CLI (authenticated) — or `ANTHROPIC_API_KEY`
- **pdflatex** + **bibtex** (TeX Live)
- **pdftotext** + **pdfimages** (poppler)
- **Python 3.10+** (optional — experiments + figure generation)
- **`BRAVE_API_KEY`** (optional — web search)

## Acknowledgments

Built on [pi-mono](https://github.com/badlogic/pi-mono) by [Mario Zechner](https://mariozechner.at/).

<p align="center"><i>One must imagine Sisyphus happy.</i></p>
