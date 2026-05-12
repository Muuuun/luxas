# Contributing to Luxas

Bug fix, new agent type, skill polish, doc fix — all welcome. Read this once before opening a PR.

## Local setup

```bash
git clone https://github.com/Muuuun/luxas.git && cd luxas
npm install && npm link          # `luxas` on PATH; or use `npx tsx src/index.ts`
```

`npm install` is not enough. Agents shell out to LaTeX, Python, and tmux:

```bash
# macOS
brew install --cask mactex       # or basictex for ~150MB
brew install poppler tmux python@3.11
pip3 install matplotlib numpy

# Linux (Debian/Ubuntu)
sudo apt install texlive-latex-extra texlive-fonts-recommended poppler-utils tmux python3-matplotlib python3-numpy
```

Plus at least one provider key: `ANTHROPIC_API_KEY` (default), `DEEPSEEK_API_KEY`, or `KIMI_API_KEY`. See [README](README.md#switching-models) for the model-switching matrix.

## The vendored pi-mono model

Luxas vendors four [pi-mono](https://github.com/badlogic/pi-mono) packages as `.tgz` under `vendor/` rather than depending on a published npm package. Reasons:

- pi-mono evolves alongside Luxas, and breaking changes need to land atomically with our prompt + safety-wrapper edits
- `patches/*.sh` hot-patches small upstream bugs (`postinstall` runs them); these would be awkward to maintain as a fork
- The harness has to control the exact pi-agent-core version because `agent.ts` reverse-scans `log.jsonl` for state and the schema isn't yet a public surface

Practical implication for contributors: **don't expect `@mariozechner/pi-agent-core` to upgrade with `npm update`**. If you need a newer pi-mono, talk to the maintainer first — the `.tgz` swap is coordinated.

## Layout

```
src/
  agent.ts              5-layer brain assembly + maxTurns + cost cap
  agents/
    definitions/*.md    14 agent definitions (YAML frontmatter + prompt body)
    spawn.ts            buildAgentFromDefinition — compiles .md → runtime agent
    registry.ts         loadAgentDefinitions + validateSpawnGraph (cycle check)
    safety-{presets,wrappers}.ts   read/write scope enforcement
    tool-sets.ts        named tool-set factories (coding / report / pi / wolfram / figure-gen)
    context-builders.ts per-agent dynamic context injection
  tools/                spawn_agent, finish, compile_latex, init_report, idle, …
  hooks.ts              cost limit + per-turn logging + safety hooks
  pi-agent.ts           reviewer scheduling (every 50 turns + milestone tool calls)
  session.ts            JSONL log + deriveState
  active-agents.ts      sub-agent registry (file-backed, heartbeat, orphan recovery)
  context.ts            two-stage compaction (60K warn → 80K compress)
  meta-agents/          reflect / reflect_light / reflect_validate — currently disabled in
                        production (post_session_hook is renamed `.disabled`); invokable
                        manually via scripts/invoke_meta_agent.mts. Don't add new
                        production callers here without coordinating.
scripts/
  smoke_*.mts           single-concern regression tests, one file per bug class
skills/                 Agent Skills (search, figure, venue-specific, review, memory)
vendor/                 pi-mono .tgz packages
patches/                post-install hot-patches for pi-mono
```

## Common changes

### Adding a new agent type

1. Drop `src/agents/definitions/<name>.md` with YAML frontmatter (see [README's Defining an agent](README.md#defining-an-agent)) + system-prompt body
2. If the parent agent should spawn it, add the name to that parent's `spawn.allowedTypes` list
3. If it needs a new safety profile, declare `safety.presets` referencing entries in `src/agents/safety-presets.ts` (or add a new preset there)
4. Run `npx tsx scripts/smoke_agent_defs.mts` to verify the def loads, the wrapper builds, and the spawn graph stays acyclic
5. No TypeScript changes required for normal agent additions

### Changing an existing agent's prompt

Edit the `.md`. The harness loads agent definitions at startup; restart any running `luxas` session to pick up changes. Watch for breaking changes to `templates` — every caller has to pass the new variable.

### Adding a tool

1. Add the tool definition under `src/tools/` (use existing ones as the shape)
2. Wire it into the relevant tool-set in `src/agents/tool-sets.ts`
3. Add safety guards in `src/agents/safety-wrappers.ts` if the tool can write to sensitive paths

### Adding a skill

Skills live under `skills/<name>/` with the standard `SKILL.md` + `scripts/` layout. They're shell-callable from agents (`bash` tool). See `skills/search/` for the canonical pattern.

## Testing

There's no CI yet (planned). Run the relevant smoke scripts manually before opening a PR:

```bash
npx tsc --noEmit                                          # type-check everything
node_modules/.bin/tsx scripts/smoke_agent_defs.mts        # agent def loading
node_modules/.bin/tsx scripts/smoke_atomic_counter.mts    # state.ts concurrency
node_modules/.bin/tsx scripts/smoke_meta_registry.mts     # meta-agent defs (if touched)
# Plus any scripts/smoke_<area>.mts that maps to the bug class you're fixing
```

If you fixed a bug, add a `scripts/smoke_<descriptive_name>.mts` that would have caught it. One file per bug class — that's the convention.

## Commit + PR conventions

- **No `Co-Authored-By` trailers.** No "Generated with Claude Code" footer. Author and committer should be your own GitHub identity. This is checked by review.
- **One concern per commit.** Mixing an agent prompt change with a tool refactor and a CI tweak in one commit makes review hard.
- **Subject line ≤ 70 chars**, lowercase area prefix: `agent: …`, `tools: …`, `scripts: …`, `README: …`, `skills/figure: …`.
- **Body explains *why*, not *what***. The diff shows what.
- **PR description**: one-paragraph summary + a short test plan ("ran `tsx scripts/smoke_X.mts`; manually exercised flow Y").

## Reporting issues

- Bugs / unexpected behavior: open a GitHub issue with the failing command + your provider + a paste of `<project>/.agent/log.jsonl` (last ~50 lines is usually enough — strip API keys / personal info first).
- Security vulnerabilities (sandbox escape, credential leak, command injection through a tool argument): same flow but tag with `security` and refrain from posting reproducers publicly until the fix lands.
- Feature requests: open an issue, but please first check whether the existing agent + skill architecture already supports it. Many "feature" asks turn out to be one `.md` edit on an existing agent.

## License

By contributing, you agree your contributions are licensed under the MIT License (see [LICENSE](LICENSE)).
