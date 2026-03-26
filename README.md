<p align="center">
  <img src="https://img.shields.io/badge/luxas-research--agent-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/pi--mono-custom--fork-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/typescript-5.5+-blue?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

<h1 align="center">Luxas</h1>
<p align="center"><i>Il faut imaginer Sisyphe heureux.</i></p>
<p align="center">An autonomous research agent built on a custom fork of pi-mono (pi-agent-core / pi-coding-agent).</p>

---

## What It Does

Give it a research topic. It autonomously searches, downloads, reads, and synthesizes 30+ papers, then produces a LaTeX PDF survey with proper citations — no human intervention required.

Luxas turns coding agents into **research agents** by adding:

- **5-layer architecture** on top of pi-agent-core (prompt → tools → context transform → hooks → PI monitor)
- **Parallel worker dispatch** — up to 8 agent sessions running simultaneously
- **Cross-session persistence** — crash-safe checkpoints, resume from any interruption
- **Adversarial self-review** — a PI monitor (Opus-tier) that challenges the agent's conclusions
- **Two-stage memory compaction** — graceful degradation when context fills up

---

## Built on Custom pi-mono

Luxas depends on a **vendored, customized fork** of the pi-mono packages — the same framework that powers Claude Code:

| Package | Version | Role |
|---------|---------|------|
| `@mariozechner/pi-agent-core` | 0.58.1 | Agent loop, tool lifecycle, hooks, LLM compaction, session DAG |
| `@mariozechner/pi-ai` | 0.58.1 | Model abstraction (Anthropic OAuth), provider routing |
| `@mariozechner/pi-coding-agent` | 0.58.1 | File tools (read/write/edit/bash), experiment agent |
| `@mariozechner/pi-tui` | 0.58.1 | Terminal UI framework (Ink-based) |

These live in `vendor/` as `.tgz` files and are installed as local dependencies. This gives us full control over the agent runtime without waiting for upstream releases.

### What We Build on Top of pi-mono

The 5-layer architecture assembles pi-mono primitives into a research-specific agent:

```
Layer 1  System Prompt (prompt.ts)
         └── Research methodology: hypothesis → experiment → discovery cycle

Layer 2  Tools (tools/)
         └── 7 tools: read/write/edit/bash + compile_latex + dispatch_workers + run_experiment
         └── Search skill (papers, citations, download, web, browser)
         └── PI review tool (request feedback from adversarial monitor)

Layer 3  Context Transform (context.ts)
         └── Injects research state (.md files) before every LLM call
         └── Two-stage compaction: 60K warning → 80K auto-compress

Layer 4  Hooks (hooks.ts)
         └── beforeToolCall: RESEARCH.md write-protection, cost/time limits, API rate limiting
         └── afterToolCall: JSONL session logging

Layer 5  PI Monitor (pi-agent.ts)
         └── GAN-like adversarial quality control (Opus flagship)
         └── Dual trigger: agent-initiated milestone review + step-count fallback
         └── Feedback injection: reviews/pi_feedback.md (persistent) + steer() (immediate)
```

Additional cross-cutting features built on pi-agent-core primitives:
- **Session DAG** (#5) — structured conversation tree with compaction support
- **Cross-model transform** (#6) — clean messages when switching between Claude models
- **Extension bus** (#8) — lifecycle events (session, turn, compaction, experiment, PI feedback, cost)
- **Reminder system** — state-aware reminders injected into context
- **Notes compaction** — smart truncation of literature/experiment notes (keep headers + recent content)

---

## Quick Start

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
> Requires authenticated `claude` CLI (Anthropic OAuth or `ANTHROPIC_API_KEY`). For PDF output: `pdflatex`, `bibtex`, `pdftotext` (poppler).

---

## Architecture

```
                        ┌──────────────────────────┐
                        │     Brain (Claude Opus)    │
                        │  Reads state → decides     │
                        │  next action(s)            │
                        └────────────┬───────────────┘
                                     │ dispatch 1–8 parallel tasks
                        ┌────────────▼───────────────┐
                        │   Conductor (TypeScript)    │
                        │   State machine, checkpoints│
                        │   Safety limits, loop detect│
                        └────────────┬───────────────┘
                ┌────────────┬───────┴───────┬────────────┐
                ▼            ▼               ▼            ▼
          ┌──────────┐ ┌──────────┐   ┌──────────┐ ┌──────────┐
          │ Claude   │ │ Claude   │   │ Claude   │ │ Claude   │
          │ search   │ │ extract  │   │ download │ │ write    │
          └──────────┘ └──────────┘   └──────────┘ └──────────┘
```

**The Brain** is not a fixed pipeline. It reads current state (papers found, extractions done, report quality) and decides what to do next — it can go backwards, skip steps, or parallelize aggressively.

**The Conductor** dispatches tasks, saves state after each completion (crash-safe), detects loops, enforces rate limits, and validates reports before accepting "done".

**Workers** are coding agent sessions running on pi-agent-core. Each gets a scoped prompt and returns structured output.

---

## Research Tools

| Tool | Source | Description |
|------|--------|-------------|
| `read` / `write` / `edit` / `bash` | pi-coding-agent | File operations + shell |
| `compile_latex` | `tools/report.ts` | pdflatex + bibtex compilation |
| `dispatch_workers` | `tools/workers.ts` | Parallel lightweight agent dispatch |
| `run_experiment` | `tools/experiment.ts` | Launch coding agent for experiments |
| `search` (skill) | `skills/search/` | Papers (OpenAlex, arXiv, CrossRef), citation chains, download, BibTeX, web search, anti-detect browser |

---

## Project Layout

```
src/
  agent.ts           5-layer agent assembly
  prompt.ts          Layer 1: research methodology prompt
  tools/             Layer 2: tool definitions
  context.ts         Layer 3: state injection + compaction
  hooks.ts           Layer 4: safety + logging hooks
  pi-agent.ts        Layer 5: adversarial PI monitor
  session.ts         Session DAG with compaction
  extensions.ts      Lifecycle event bus
  reminders.ts       State-aware reminder injection
  tmux.ts            tmux window management for workers
  auth.ts            Anthropic OAuth PKCE
  tui/               Interactive terminal dashboard

skills/
  search/            Literature search skill
    scripts/
      search         Paper search + citation chains + web
      browse         Anti-detect browser (Cloudflare bypass)
      extract-figures  PDF figure extraction

vendor/              Customized pi-mono packages (.tgz)
```

Each research project follows this structure:

```
project/
  RESEARCH.md          Human-written research goal (read-only)
  notes/
    literature.md      Agent-maintained literature notes
    experiments.md     Agent-maintained experiment notes
    memory.md          Agent scratchpad (decisions, dead ends, insights)
  data/
    papers/            Downloaded papers (LaTeX source preferred)
    runs/              Numbered experiment snapshots
  report/
    report.tex         LaTeX survey
    references.bib     BibTeX database
    report.pdf         Compiled output
  reviews/
    pi_feedback.md     PI monitor feedback
  .agent/
    log.jsonl          Append-only session log
    checkpoint.jsonl   Crash-recovery checkpoint
```

---

## Safety Limits

| Limit | Default |
|-------|---------|
| Max cost per run | $50 |
| Max duration | 8 hours |
| Max steps | 50 |
| Consecutive failures before pause | 5 |
| Loop detection (same action repeat) | 4 |
| Max concurrent workers | 8 |
| RESEARCH.md | Write-protected |
| Report validation | Blocks "done" until PDF passes checks |

---

## Requirements

- **Node.js** 22+
- **claude** CLI (authenticated) — or `ANTHROPIC_API_KEY`
- **pdflatex** + **bibtex** (TeX Live)
- **pdftotext** + **pdfimages** (poppler)
- **tmux** (worker process management)
- **Python 3.10+** (optional, for experiments + figure generation)

---

<p align="center"><i>One must imagine Sisyphus happy.</i></p>
