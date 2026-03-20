<p align="center">
  <img src="https://img.shields.io/badge/sisyphus-meta--agent-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/typescript-5.5+-blue?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

<h1 align="center">Sisyphus</h1>
<p align="center"><i>Il faut imaginer Sisyphe heureux.</i></p>
<p align="center">Orchestrates coding agents (Claude Code, Codex) to do autonomous research.</p>

---

### The Idea

Coding agents like Claude Code and Codex are great at executing tasks — but research requires something more: planning what to read, deciding what matters, coordinating dozens of parallel efforts, and iterating on quality across sessions.

Sisyphus turns coding agents into **research agents**. It wraps them with an orchestration layer that handles the parts they weren't built for:

- **Autonomous planning** — a Brain reads state and decides what to do next, adapting strategy as it learns
- **Parallel execution** — up to 8 agent sessions running simultaneously (searching, downloading, extracting)
- **Cross-session persistence** — interrupt anytime, resume where you left off
- **Multi-agent mixing** — use Claude and Codex on the same project, each where it's strongest
- **Self-review loops** — the system evaluates its own output and iterates until quality is satisfactory

Give it a topic. It discovers, reads, and synthesizes 30+ papers, then produces a LaTeX PDF survey with proper citations — no human intervention required.

---

### Quick Start

```bash
# Install
git clone https://github.com/Muuuun/Sisyphus.git
cd Sisyphus
npm install

# Optional: enable anti-detect browser (bypasses Cloudflare on PRL, Science, Nature, etc.)
npm run setup:browser

# Run a research survey
npx tsx src/index.ts run "Large Language Model Reasoning"

# Use Codex as the brain
npx tsx src/index.ts run "Diffusion Models" --brain codex

# Resume interrupted work
npx tsx src/index.ts resume

# Refine existing research
npx tsx src/index.ts refine "add more papers about chain-of-thought"

# Interactive TUI dashboard
npx tsx src/index.ts tui
```

> [!TIP]
> Requires `claude` CLI (authenticated). Optionally `codex` CLI for OpenAI models. For PDF compilation: `pdflatex`, `bibtex`, `pdftotext` (poppler).

---

### How It Works

```
                        ┌──────────────────────────┐
                        │  Brain (Claude or Codex)  │
                        │  Reads state → decides    │
                        │  next action(s)           │
                        └────────────┬─────────────┘
                                     │ 1–8 parallel tasks
                        ┌────────────▼─────────────┐
                        │  Conductor (TypeScript)   │
                        │  Dispatches, tracks,      │
                        │  saves state, enforces    │
                        │  safety limits            │
                        └────────────┬─────────────┘
                ┌────────────┬───────┴───────┬────────────┐
                ▼            ▼               ▼            ▼
          ┌──────────┐ ┌──────────┐   ┌──────────┐ ┌──────────┐
          │ Claude   │ │ Claude   │   │ Codex    │ │ Claude   │
          │ Session  │ │ Session  │   │ Session  │ │ Session  │
          │ search   │ │ extract  │   │ download │ │ write    │
          └──────────┘ └──────────┘   └──────────┘ └──────────┘
```

**The Brain** doesn't follow a fixed pipeline. It looks at what exists (papers found, papers downloaded, extractions done, report quality) and decides what to do next. It can go backwards, skip steps, change strategy, or parallelize aggressively.

**The Conductor** dispatches tasks, saves state after each completion (crash-safe), detects loops, enforces rate limits, and keeps the Brain honest (validates reports before accepting "done").

**The Executors** are vanilla coding agent sessions (`claude -p` or `codex exec`). They get a prompt, do their work, return output. Sisyphus adds the research orchestration on top.

---

### Multi-Agent Support

Sisyphus can use different coding agents for different roles:

| Role | Claude | Codex |
|------|--------|-------|
| **Brain** (planner) | `--brain claude` (default) | `--brain codex` |
| **Executor** (worker) | Most tasks | Alternative perspective |

Switch at runtime in the TUI with `/brain codex` or `/brain claude`.

The Brain also selects **model tiers** per task:

| Tier | Claude Model | Codex Model | Use Case |
|------|-------------|-------------|----------|
| `cheap` | Haiku | o4-mini | Download, compile, mechanical tasks |
| `fast` | Sonnet | o4-mini | Search, extract, evaluate |
| `think` | Opus | o3 | Write report, deep analysis |

---

### TUI Dashboard

Launch with `npx tsx src/tui.tsx` or `npx tsx src/index.ts tui`.

- **Project management** — create, list, switch between research projects
- **Real-time activity** — Brain thinking, executor tasks, live progress
- **Slash commands** — `/new`, `/run`, `/resume`, `/refine`, `/brain`, `/help`
- **Usage tracking** — token counts, cost, rate limit utilization
- **Keyboard shortcuts** — `Ctrl+J/K` projects, `Ctrl+O` open PDF, `Tab` focus, `Esc` interrupt

---

### Research Pipeline

The Brain autonomously manages this paper funnel:

```
discovered → candidate → core → excluded
                          │
                    download source (LaTeX preferred, PDF fallback)
                          │
                    extract structured data (methods, results, figures)
                          │
                    cross-validate claims across papers
                          │
                    write LaTeX survey with \cite{} references
                          │
                    compile to PDF → self-review → iterate
```

Each paper lives in `data/papers/{id}/` with metadata, extraction, source files, and figures.

The Brain can also define **custom sub-agents** with specialized system prompts (e.g., a domain expert reviewer) that persist across tasks.

---

### Safety Limits

| Limit | Value |
|-------|-------|
| Max steps per run | 50 |
| Max consecutive failures | 5 (auto-pause) |
| Same action repeat | 4 (loop detection) |
| Max concurrent tasks | 8 |
| Report validation | Blocks "done" until PDF passes checks |

---

### Project Structure

```
src/
  index.ts          CLI entry point
  conductor.ts      Agentic loop — Brain → Execute → Evaluate → Repeat
  brain.ts          Autonomous decision-making (claude -p / codex exec)
  terminal.ts       Subprocess execution + parallel session pool
  state.ts          State management + report validation
  events.ts         Event bus (decouples orchestration from rendering)
  agents.ts         Custom agent store
  types.ts          Core type definitions
  knowledge/
    store.ts        Paper repository + extraction digest
    schema.ts       Paper funnel schemas
  tools/
    semantic-scholar.ts   S2 API (search + citations)
    arxiv.ts              arXiv API search
    downloader.ts         Paper download (LaTeX-first)
    reader.ts             LaTeX/PDF text extraction
    extractor.ts          LLM-powered structured extraction
    snowball.ts           Citation chain expansion
    figures.ts            Figure extraction + verification
  tui/
    app.tsx          Root TUI component
    sidebar.tsx      Project list + stats
    activity.tsx     Real-time agent activity
    input-bar.tsx    Command input with autocomplete
    projects.ts      Project discovery
```

---

### Requirements

- **Node.js** 22+
- **claude** CLI (authenticated) — primary agent
- **codex** CLI (optional) — for OpenAI-backed brain/executor
- **pdflatex** + **bibtex** (TeX Live or similar)
- **pdftotext** + **pdfimages** (poppler)
- **Python 3.9+** + **seleniumbase** (optional, for anti-detect browser — `npm run setup:browser`)

---

<p align="center"><i>One must imagine Sisyphus happy.</i></p>
