<div align="center">

# Luxas

### Autonomous research agent — reads papers, runs experiments, writes LaTeX reports end to end.

<br>

Give Luxas a topic in `RESEARCH.md`. It crawls the literature, downloads and reads papers, designs and runs experiments under blind impl/test split, generates publication-grade figures, writes a LaTeX report, submits it to adversarial content + figure + layout review, and produces a compiled PDF with real citations. Multi-hour, crash-recoverable, no human in the loop.

**Luxas is a harness, not a model.** The intelligence comes from Claude (Opus / Sonnet / Haiku across roles) and OpenAI o3 for math, with one-line family-wide redirect to DeepSeek-v4 (~10× cheaper, 1M context) or Kimi via an env variable. Luxas' job is to give that intelligence a durable workspace: file-backed memory, externalized brain state, detached sub-agent processes, an independent-author pattern that blocks self-review pathologies, and deterministic finish-gates that no prompt can talk past.

<br>

[![][node-shield]][node-link]
[![][typescript-shield]][ts-link]
[![][pi-mono-shield]][pi-mono-link]
[![][license-shield]][license-link]

[Quick Start](#quick-start) · [Switching Models](#switching-models) · [How It Works](#how-it-works) · [Agents](#agents) · [Skills](#skills) · [Safety](#safety) · [Security](#security) · [Requirements](#requirements) · [FAQ](#faq)

</div>

---

## Quick Start

### Before you run — system dependencies

`npm install` alone is not enough; agents shell out to LaTeX, Python, and tmux. Install once:

```bash
# macOS
brew install --cask mactex   # or basictex for ~150MB
brew install poppler tmux python@3.11
pip3 install matplotlib numpy

# Linux (Debian/Ubuntu)
sudo apt install texlive-latex-extra texlive-fonts-recommended poppler-utils tmux python3-matplotlib python3-numpy
```

### Install + first run

```bash
git clone https://github.com/Muuuun/luxas.git && cd luxas
npm install && npm link    # `luxas` now on PATH; skip & use `npx tsx src/index.ts` instead

export ANTHROPIC_API_KEY="..."        # default; also DEEPSEEK_API_KEY / KIMI_API_KEY for non-Claude

luxas init ~/research/x --prompt "Survey LLM chain-of-thought reasoning"
luxas run  ~/research/x --model opus
luxas status  ~/research/x      # check progress
luxas figures ~/research/x      # rerun only figure / typesetter loop
luxas list                      # all projects Luxas has ever touched
```

### Switching models

```bash
luxas run ~/research/x                          # default — every agent uses its declared frontmatter model (full Claude)
luxas run ~/research/x --profile dual           # canonical preset: deepseek-v4-pro for text + k2p5 (Moonshot Kimi) for vision
luxas run ~/research/x --model deepseek-v4-pro  # same family-wide redirect as --profile dual but no vision override (figures break)
luxas run ~/research/x --model opus             # brain-only override (sub-agents follow their own .md)
```

`--profile dual` and any `--model deepseek-*` redirect every agent that declared `haiku/sonnet/opus` to the deepseek model via `applyProfile()` in `src/agents/spawn.ts`. Provider-specific picks (`gpt-5.2` for the `math` agent, `o3` for reasoning) bypass — those are deliberate. Vision-required agents (`illustrator` / `illustrator_write` / `typesetter`) need a separate vision profile because DeepSeek is text-only; `--profile dual` sets it for you (`k2p5` → Moonshot Kimi).

Anecdotal cost per full run (check `<project>/.agent/usage.log` for real numbers):

| Profile | $/run | Notes |
|---|---|---|
| Default (full Claude) | $20–80 | Best content quality; only profile with Anthropic prompt caching |
| `--profile dual` (DeepSeek text + Kimi vision) | $2–10 | Loses ephemeral `cache_control`; figures via Kimi |

---

## How It Works

### Five layers, assembled from pi-agent-core

Luxas vendors four [pi-mono](https://github.com/badlogic/pi-mono) packages as `.tgz` in `vendor/` and assembles them into a research agent:

| Layer | File | Role |
|---|---|---|
| **System prompt** | `src/agents/definitions/brain.md` | 3 cache-controlled blocks — methodology + smelt patches (1h cache), RESEARCH.md + skills (cache), `<active_agents>` + `<plan_status>` (mutable, in-place rebuild) |
| **Tools** | `src/tools/` | `read`/`write`/`edit`/`bash`, `compile_latex`, `init_report`, `spawn_agent`, `idle`, `request_pi_review`, figure-gen, `wolfram`, `finish` |
| **Context transform** | `src/context.ts` | Per-agent dynamic context, two-stage compaction (60K warning → 80K compress with summary carry-over) |
| **Hooks** | `src/hooks.ts` | RESEARCH.md write-protect, cost limit (`process.exit` on exceed), search rate limit, per-turn logging, state snapshots |
| **PI fallback monitor** | `src/pi-agent.ts` | Schedules `reviewer` sub-agent every 50 turns and on milestone tool calls — Opus persona that reads project state and submits `continue` / `steer` / `stop` to `reviews/pi_feedback.md` |

### Stateless harness — every layer of state has a file

Brain accounting (cost, tokens, PI counters, compaction markers) is reverse-scanned from `log.jsonl` on restart. Sub-agents are detached Node processes with their own conversation files; brain talks to them via `active-agents.json` and harvests via heartbeat + orphan recovery on resume. The `idle` tool blocks the brain at zero LLM cost while background work runs. Per-project memory lives in `notes/*.md` (smart-truncated when over budget); cross-project memory in `~/.sisyphus/{projects.json,memory.md}` is auto-injected into new project context.

### V5 experiment workflow (Design → Impl + Review → Integrate)

The `experiment` agent doesn't write code itself. It (1) **designs** by listing each tool (name, description, input/output shape), (2) for each tool spawns `tool_impl` (writes `scripts/<tool>.py` from description only) and `tool_review` (writes `tests/test_<tool>.py` from description only) in parallel, blind to each other — pytest is the only ground truth, with `SendMessage` ferrying failures back to `tool_impl` for fixes (3-revision cap), (3) **integrates** by running validated tools, landing `data/experiments/<EXP_ID>/runs/run_N/results.json`, appending a `## L2.X` section to `notes/experiments.md`. After return, the harness auto-spawns `experiment_reviewer` for adversarial post-hoc audit (`satisfied` / `revise`).

The blind impl+test split blocks the self-circular failure where impl-and-test are written together (the impl redefines a field's semantics so its self-reported value passes its own assertion — observed live: `max_pair_distance_um` got redefined as post-move distance = 0; tests passed; the tool was wrong).

### Commitment ledger: plan as authority, PI gates closure

`notes/plan.md` is the commitment source of truth — each `### E_N` heading is a hard commitment. `notes/experiments.md` is the audit log — each `## L2.N` section is the experiment agent's record with `Status: Complete` / `Pending`. Two aligned gates enforce closure: the `finish` tool blocks unless every `### E_N` has a matching `## L2.N` with `Status: Complete`, and the reviewer cannot issue `stop` while any active plan `### E_N` is missing or non-Complete. Aligned at both layers, so a "STOP after Pending → brain deadlocked" race is structurally impossible.

Two more invariants: scope reduction is `plan.md`-only — prose like "(Descoped)" next to an `### E_N` heading does not remove it; and `Deferred` is not a status (removed Apr-26 after observed abuse as a soft escape hatch). The brain-write-lock on `notes/experiments.md` (only experiment agents may append) is the [Safety](#safety) table's `notes/experiments.md write lock` row.

### Finalize loop (figures + layout)

Before any `stop` verdict, the reviewer runs `<figure_finalize_loop>`: enumerate `\includegraphics` from `report.tex`, spawn one `illustrator` per source script to regenerate against `report/figures/style_guide.md`, one global-audit `illustrator` for figure-internals (palette / spines / typography / clipping) → `reviews/illustrator_notes.md`, one `typesetter` to rasterize the PDF page-by-page for document-level issues (float distance, caption integrity, column overflow, missing-file red boxes) → `reviews/typesetter_notes.md`. Loop breaks only when both notes report `status: all-clear`; the `<figure_convergence>` tag in reviewer context short-circuits re-audits of unchanged artifacts.

---

## Agents

14 agent types — `brain` plus 13 sub-agent kinds. Each lives in `src/agents/definitions/<name>.md` (YAML frontmatter + markdown body); adding an agent or changing its permissions is one `.md` edit. Three execution modes from `spawn_agent`: **foreground** (blocks, returns result), **parallel** (`tasks: [...]` — N concurrent), **background** (`background: true` — detached, harvested on next turn). Spawn depth capped at 2 (`MAX_SPAWN_DEPTH` in `src/agents/spawn.ts`).

| Agent | Model | Role |
|---|---|---|
| **brain** | Opus (high) | Main driver. Decomposes RESEARCH.md, surveys literature, sequences experiments, writes the report, iterates on PI feedback |
| **search** | Sonnet | Literature discovery — OpenAlex / arXiv / CrossRef / citation chains / web / anti-detect browser for paywalls |
| **reader** | Sonnet | Per-paper extraction → `notes/literature.d/<paper>.md` fragments; hook merges back into canonical `notes/literature.md` |
| **worker** | Sonnet | Lightweight parallel worker — batch downloads, file ops |
| **experiment** | Opus (high) | V5 orchestrator (Design → Impl+Review → Integrate). Spawns tool_impl + tool_review per tool; never writes code itself |
| **tool_impl** | Sonnet | Writes `scripts/<tool>.py` from the description only. Cannot read tests |
| **tool_review** | Sonnet | Writes `tests/test_<tool>.py` from the description only. Cannot read impl. ≥1 adversarial test per tool |
| **experiment_reviewer** | Opus (medium) | Auto-spawned post-experiment. Reads L2.X section, results, cited literature; verdict `satisfied` / `revise` |
| **math** | OpenAI o3 | Symbolic derivation via Wolfram Engine (`wolframscript`); sympy fallback |
| **illustrator** | Sonnet (high) | Figure-internal audit + regeneration. Hybrid Gemini-image (Nano Banana) raster + TikZ pipeline; 11 templates |
| **illustrator_write** | Sonnet (medium) | Domain-aware first-pass plot script from raw experiment data |
| **typesetter** | Sonnet (medium) | Document-level layout auditor. Rasterizes PDF pages → notes; catches float distance, caption split, column overflow |
| **reviewer** | Opus (medium) | Adversarial PI. Runs `figure_finalize_loop` before any `stop`. Returns `continue` / `steer` / `stop` |
| **fixer** | Haiku (low) | Mechanical LaTeX compile-error fixer — single-edit + recompile loop |

### Defining an agent

Each `.md` is YAML frontmatter + system prompt body. Key fields:

```yaml
name: tool_impl
model: sonnet                                  # opus|sonnet|haiku|gpt-5.2|deepseek-v4-pro|deepseek-v4-flash|k2p5|inherit
thinkingLevel: medium                          # off|low|medium|high
toolSets: [coding]                             # named tool-set factories
templates: [PROJECT_DIR, EXPERIMENT_ID, TOOL_NAME]
spawn: { enabled: false }                      # or { allowedTypes: [reader, math] }
safety:
  presets: [research_brief, report_surface, notes_ledger]
  allowedReadRoots: ["data/experiments/{{EXPERIMENT_ID}}"]
  writeOnExistingPolicy: block
```

`buildSafetyWrapper` compiles this into runtime tool-layer checks. `validateSpawnGraph` runs DFS on `allowedTypes` edges at startup and throws on declared cycles. Adding an agent or changing scope is an `.md` edit; no TypeScript change required.

---

## Skills

Skills live in `skills/` (Agent Skills standard: `SKILL.md` + scripts):

| Skill | What it's for |
|---|---|
| `search/` | Paper discovery — OpenAlex/arXiv/CrossRef, citation chains, arXiv LaTeX source, figure extraction, Brave web search, anti-detect browser |
| `figure/` | Hybrid figure pipeline — Gemini-image (Nano Banana) raster + rembg background strip + TikZ vector assembly, 11 TikZ templates, per-domain palettes/pitfalls |
| `venue-specific/` | 30+ journal/conference styles (Nature, Science, PRL, NeurIPS, ICML) with matching matplotlib styles + BibTeX |
| `review/` | Survey discipline — 10-domain style guide, anti-stacking rules, outline-first/synthesis-rewrite pipeline |
| `survey-methodology/` | Methodology above `review/` — claim taxonomies, evidence weighting, coverage scoring |
| `memory/` | Cross-project memory protocol — `~/.sisyphus/memory.md` + per-project `notes/` |

---

## Safety

Every constraint is a hook, a tool guard, a frontmatter-declared scope, or a finish-gate — not a prompt instruction. Brain cannot talk its way out.

| Limit | Default | Enforced by |
|---|---|---|
| Max cost per run | unbounded (`--max-cost` to set); `process.exit(1)` on exceed | `hooks.ts` |
| Max LLM turns | 500 (replaced wall-clock 8h after a $70 stuck-loop) | `agent.ts` |
| PI review fallback | every 50 turns without a brain-triggered review | `pi-agent.ts` |
| Max sub-agent spawn depth | 2 | `agents/spawn.ts` |
| Spawn graph acyclicity | declared cycles throw at startup | `agents/registry.ts::validateSpawnGraph` |
| `RESEARCH.md` write-protect | declared `safety.presets: [research_brief]` | every writing agent's `.md` |
| Per-agent read/write scope | `safety.presets` + `protectedFiles` + `allowedReadRoots`; default `writeOnExistingPolicy: block` | compiled by `buildSafetyWrapper` |
| `finish` gate stack | no bg agents + every `### E_N` Complete in `experiments.md` + report.pdf exists + ≥1 self-generated figure + `typesetter_notes.md` `all-clear` + PI verdict `stop` or fresh `pi_pushback.md` | `tools/index.ts` |
| PI STOP precondition | reviewer cannot `stop` while any active `### E_N` is non-Complete — mirrors finish gate one layer up | `reviewer.md` `<verdict_rules>` |
| `notes/experiments.md` write lock | brain cannot write/edit/heredoc-bash; only experiment agents may append | `safety.protectedFiles` + bash write-guard |

The `finish` tool is the only clean exit; anything else is a crash and the harness is designed to survive crashes. The `pi_pushback.md` escape lets brain defensibly disagree with PI (must be written *fresher* than the disputed feedback).

---

## Requirements

- **Node.js** 22+
- **`ANTHROPIC_API_KEY`** (default; alternatives below)
- **LaTeX** — `pdflatex` + `bibtex` in PATH (`brew install --cask mactex` / `apt install texlive-latex-extra`)
- **poppler** — `pdftoppm`, `pdftotext`, `pdfimages` (for `typesetter` rasterization)
- **Python 3.10+** with `matplotlib` and `numpy`
- **tmux** — every worker/experiment gets its own window for live observability
- **`OPENAI_API_KEY`** (optional) — for the `math` agent (o3)
- **`DEEPSEEK_API_KEY`** / **`KIMI_API_KEY`** (optional) — see [Switching Models](#switching-models)
- **`wolframscript`** on PATH (optional) — `math` agent's Wolfram Engine bridge; falls back to sympy otherwise
- **`BRAVE_API_KEY`** (optional) — web search in the search skill
- **`GEMINI_API_KEY`** (optional) — Gemini image generation (Nano Banana) for the hybrid figure pipeline
- **browser-use** (optional) — anti-detect browser at `~/.browser-use-env/bin/browser-use` for paywalled venues
- **provref** (optional) — `npm i -g provref` for `\resultref{...}` number-provenance during compilation

---

## FAQ

**How is this different from a single long Claude Code session?**
Claude Code is one agent in one terminal. Luxas is a brain spawning 13 sub-agent types (see [Agents](#agents)) as detached processes, with safety via hooks + declarative frontmatter, file-based notes across compaction, a two-tier finish gate (PI STOP precondition + tool gate, both checking plan/experiments closure), and crash-recovery.

**How do I add a new agent?**
Drop a new `.md` into `src/agents/definitions/`. Declare `model`, `thinkingLevel`, `toolSets`, `templates`, `spawn`, and (if it writes) `safety`. No TypeScript change — `validateSpawnGraph` sanity-checks the graph on next startup; the agent is immediately visible to `spawn_agent`.

**Why do `illustrator` and `typesetter` exist as separate agents?**
They audit orthogonal axes. `illustrator` reads single figure PNGs against a 12-item style checklist; `typesetter` reads rasterized PDF pages for document-level issues (figure float distance, caption integrity, column overflow). Conflating them either bloats one prompt or leaves layout regressions invisible — observed live: a figure source-block 30+ lines below its first `\ref` floated to the wrong page; no agent flagged it until a human did.

**What happens if I crash the brain mid-run?**
Re-run `luxas run <dir>`. The harness detects `checkpoint.jsonl`, replays the session, reconstructs brain state (cost / tokens / PI counters) from reverse-scanning `log.jsonl`, and resumes. Sub-agents kept running (they're detached); their results are recovered on the next turn via orphan recovery in `agent.ts`.

**Why does the reviewer run separately instead of inline?**
Brain asking itself "am I done?" is useless. A separate Opus instance with no access to the brain's reasoning traces and a forced `figure_finalize_loop` before any STOP produces adversarial feedback at three layers (content + figure-internal + layout), not agreement. Its verdict lands in `reviews/pi_feedback.md` and `finish` is gated on it.

**Does this actually work?**
It runs end-to-end on literature surveys and small-scale computational research. Whether output is *publication-quality* depends on model, topic, and reviewer feedback loop — not on the harness. No SOTA claims.

---

## Security

Luxas runs Python, shell commands, and `pip install` autonomously inside project directories; sub-agents are detached processes that may run for hours unsupervised. Treat any project directory as if it were executed code: don't point Luxas at directories holding credentials, and don't run as root. Credential surfaces are guarded — read/write/edit/bash wrappers block access to `~/.sisyphus/auth.json`, `~/.aws/credentials`, `~/.netrc`, `~/.ssh/id_*`, and common API-key env vars (`src/agents/safety-wrappers.ts`) — but this is defense-in-depth, not a sandbox.

Security issues (sandbox escape, credential leak through agent output, command injection through a tool argument): open a GitHub issue tagged `security` rather than disclosing publicly first.

---

## Acknowledgments

Built on [pi-mono](https://github.com/badlogic/pi-mono) by [Mario Zechner](https://mariozechner.at/). Prompt evolution via [AgentSmelt](https://github.com/Muuuun/agentsmelt). Number provenance via [provref](https://github.com/Muuuun/provref).

## License

MIT — see [LICENSE](LICENSE).

<br>

<div align="center"><i>One must imagine Luxas happy.</i></div>

[node-shield]: https://img.shields.io/badge/node-22+-4dc9f6?style=flat-square&labelColor=0a0e14&logo=node.js&logoColor=4dc9f6
[node-link]: https://nodejs.org/
[typescript-shield]: https://img.shields.io/badge/typescript-5.5+-7dd8f8?style=flat-square&labelColor=0a0e14&logo=typescript&logoColor=7dd8f8
[ts-link]: https://www.typescriptlang.org/
[pi-mono-shield]: https://img.shields.io/badge/pi--mono-vendored-b0e8ff?style=flat-square&labelColor=0a0e14
[pi-mono-link]: https://github.com/badlogic/pi-mono
[license-shield]: https://img.shields.io/badge/license-MIT-b0e8ff?style=flat-square&labelColor=0a0e14
[license-link]: LICENSE
