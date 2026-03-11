<p align="center">
  <img src="https://img.shields.io/badge/sisyphus-autonomous%20research-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/typescript-5.5+-blue?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

<h1 align="center">Sisyphus</h1>
<p align="center"><i>Il faut imaginer Sisyphe heureux.</i></p>
<p align="center">An autonomous research agent that produces LaTeX survey reports with proper citations, compiled to PDF.</p>

---

### What is Sisyphus?

Sisyphus is a fully autonomous research agent. Give it a topic and it will:

1. **Discover** papers via Semantic Scholar and arXiv
2. **Evaluate** relevance, promote the best to core
3. **Download** LaTeX source (PDF fallback)
4. **Extract** structured data — methods, results, benchmarks, figures
5. **Write** a LaTeX survey report with `\cite{}` references
6. **Compile** to PDF via `pdflatex` + `bibtex`
7. **Self-review** and iterate until quality is satisfactory

No fixed pipeline. The Brain decides what to do next based on actual state — it can go back, retry, change strategy, or parallelize up to 8 tasks.

---

### Quick Start

```bash
# Install
git clone https://github.com/Muuuun/Sisyphus.git
cd Sisyphus
npm install

# Run on a topic
npx tsx src/index.ts run "Large Language Model Reasoning"

# Resume interrupted research
npx tsx src/index.ts resume

# Refine existing research
npx tsx src/index.ts refine "add more papers about chain-of-thought"

# Check status
npx tsx src/index.ts status

# Interactive TUI dashboard
npx tsx src/index.ts tui
```

> [!TIP]
> Sisyphus requires `claude` CLI installed and authenticated. It also needs `pdflatex`, `bibtex`, and `pdftotext` (poppler) for report compilation.

---

### TUI Dashboard

Launch with `npx tsx src/tui.tsx` or the `tui` command.

- **Project management** — create, list, switch between research projects
- **Real-time activity** — see Brain thinking, executor tasks running, live progress
- **Slash commands** — `/new`, `/run`, `/resume`, `/refine`, `/help`
- **Usage tracking** — token counts, cost, rate limit utilization
- **Keyboard shortcuts** — `Ctrl+J/K` switch projects, `Tab` focus, `Esc` interrupt

---

### Architecture

```
Brain (claude -p, Sonnet)
    │
    ├── Reads current state (papers, extractions, report)
    ├── Decides next action(s) — not a fixed sequence
    ├── Can issue 1-8 parallel tasks
    │
    ▼
Conductor (TypeScript orchestrator)
    │
    ├── Dispatches tasks to SessionPool
    ├── Each task runs as a claude -p subprocess
    ├── Saves state after each task (crash-safe)
    ├── Checks safety limits (loops, failures, rate limits)
    └── Repeats until Brain says "done"
```

**Key design decisions:**

- **Agentic, not pipelined** — Brain can go backwards, skip steps, change strategy
- **Parallel-first** — up to 8 concurrent tasks (download, extract, search in parallel)
- **State = filesystem** — `research-state.json` + `data/` directory is the source of truth
- **Resumable** — interrupt anytime, `resume` picks up where it left off
- **Model tiering** — Haiku for mechanical tasks, Sonnet for most work, Opus for deep analysis

---

### Paper Funnel

```
discovered → candidate → core → excluded
                          │
                    download source
                          │
                    extract structured data
                          │
                    include in report
```

Each paper lives in `data/papers/{id}/` with:

| File | Purpose |
|------|---------|
| `meta.json` | Title, authors, year, IDs (immutable) |
| `status.json` | Funnel stage + reason |
| `extraction.json` | Methods, results, benchmarks, claims |
| `source/` | Downloaded LaTeX or PDF |
| `figures/` | Extracted images + manifest |

---

### Custom Agents

The Brain can define project-specific sub-agents for specialized tasks:

```json
{
  "id": "quantum_reviewer",
  "name": "Quantum Computing Reviewer",
  "system_prompt": "You are an expert in quantum error correction...",
  "default_model": "think"
}
```

Agents persist in `data/agents.json` and are reusable across tasks.

---

### Safety Limits

| Limit | Value |
|-------|-------|
| Max steps per run | 50 |
| Max consecutive failures | 5 (auto-pause) |
| Same action repeat | 4 (loop detection) |
| Max concurrent tasks | 8 |
| Daemon retries | 10 |

---

### Project Structure

```
src/
  index.ts          CLI entry point
  conductor.ts      Agentic loop orchestrator
  brain.ts          Autonomous decision-making (claude -p)
  terminal.ts       Subprocess execution + live status
  state.ts          State management + report validation
  events.ts         Event bus (decouples rendering)
  agents.ts         Custom agent store
  types.ts          Core type definitions
  knowledge/
    store.ts        Paper repository API
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
- **claude** CLI (authenticated)
- **pdflatex** + **bibtex** (TeX Live or similar)
- **pdftotext** + **pdfimages** (poppler)

---

### Scripts

```bash
./run.sh "topic"      # Single run
./run.sh              # Resume
./daemon.sh "topic"   # Auto-retry daemon mode
```

---

<p align="center"><i>One must imagine Sisyphus happy.</i></p>
