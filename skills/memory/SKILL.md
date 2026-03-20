---
name: memory
description: Cross-project research memory. Read past project summaries, findings, and persistent insights across all Sisyphus research projects.
compatibility: Always available. No external dependencies.
allowed-tools: read write edit
---

# Memory Skill

Access persistent memory that spans across research projects.

## When to use

- Starting a new research project and want to check if past work is relevant
- Looking for papers, techniques, or code patterns from previous projects
- Saving cross-project insights (e.g., a useful method that applies broadly)

## Files

### ~/.sisyphus/projects.json

Project registry. JSON array of all past research projects:

```json
[
  {
    "path": "/absolute/path/to/project",
    "name": "Project title (from RESEARCH.md)",
    "created": "2026-03-19T...",
    "lastRun": "2026-03-19T...",
    "summary": "Auto-generated summary from notes/",
    "costUsd": 0.50,
    "tokens": 100000
  }
]
```

Read this to see what past research exists and their summaries.

### ~/.sisyphus/memory.md

Persistent cross-project memory. You can **read and write** this file.

Use it for:
- Insights that apply across projects (useful techniques, common pitfalls)
- Paper references worth remembering across projects
- Reusable code patterns or simulation approaches
- Connections between different research topics

### ~/.sisyphus/archive/<project_slug>/

Auto-archived copies of each project's notes and results. Created when a run completes.

```
~/.sisyphus/archive/
  rb87_tweezer_lossless/
    literature.md      ← literature review
    experiments.md     ← experiment results + key numbers
    memory.md          ← project scratchpad
    report.tex         ← final report source
  another_project/
    ...
```

Each file has a header comment with the original project name and source path.

## Workflow

1. `read ~/.sisyphus/projects.json` — see what past projects exist and their summaries
2. If a past project seems relevant, browse its archive: `read ~/.sisyphus/archive/<slug>/experiments.md`
3. Save cross-project insights to `~/.sisyphus/memory.md`
