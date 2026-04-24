# Phase 3b real-provider verification

Date: 2026-04-24T14:56:54.386Z
Provider: anthropic via https://new-api.lingowhale.com, model `claude-haiku-4-5-20251001`
Script: `scripts/spike_real_compaction.mts`

## Verdict: **PHASE-3B-LIVE-VERIFIED**

Compaction with real summarizer produced the correct rebuilt shape; the provider accepted it; the model's reply quoted the plan/memory/recent-file markers we embedded in the attachments, proving the attachments were delivered AND read.

## Compaction outcome

- mode: `condensed`
- removedCount: 7
- rebuilt.length: 9
- carryforward note (first 300 chars): `## Objective ⏎ Build a hybrid atom-ion qLDPC simulation pipeline. Current focus: implement BB84 code constructor, Stim syndrome-extraction circuit, and heterogeneous noise model for [[72,12,6]] and [[144,12,12]] codes. ⏎  ⏎ ## Important Facts ⏎ - Target codes: [[72,12,6]] and [[144,12,12]] BB codes ⏎ - Polyno`

## Attachments in rebuilt conversation

- <recent_files> at index 1: present
- <authoritative path="notes/plan.md"> at index 2: present
- <authoritative path="notes/memory.md"> at index 3: present

## Live verification reply (verbatim)

```
1. `ZEPHYR_PLAN_MARKER_7Q3`
2. `QUASAR_MEMORY_MARKER_KX9`
3. `src/solver.py` contains `NEBULA_RECENT_FILE_MARKER_J5`
```

- plan.md marker (`ZEPHYR_PLAN_MARKER_7Q3`) in reply: yes
- memory.md marker (`QUASAR_MEMORY_MARKER_KX9`) in reply: yes
- recent-file marker (`NEBULA_RECENT_FILE_MARKER_J5`) in reply: yes

## Implications

No code change needed. Phase 3b's carry-forward is functioning end-to-end: real summarizer, real providers, model accepts rebuilt shape and actually consumes the attachments.
