# Phase 2 real-provider verification

Date: 2026-04-24T09:39:34.384Z
Provider: Anthropic (direct API), model `claude-haiku-4-5-20251001`
Script: `scripts/spike_real_length_recovery.mts`

## Verdict: **B-LEVEL-SAFE**

All length-truncated experiments successfully continued via replaceMessages + continue(). Anthropic accepted the partial assistant (including thinking blocks when present) verbatim in the next request. No schema mitigation needed for Phase 2's current design.

## What was tested

The Phase 2 B-level recovery pattern sends a partial (stopReason=length)
assistant message back to the provider in the next request, with an isMeta
user marker appended, and expects continuation without a schema error. The
concern is that pi-agent-core's transformMessages does not strip length-
truncated content blocks — including any thinking blocks whose signature
was only valid for the un-truncated thinking. Mock smoke (PR-2) cannot
verify this; only a real provider can.

## Experiments

### A (text-only, no thinking)

- reasoning: `off`
- request 1 triggered length: yes
- partial content blocks: `text`
- thinking signed: no
- continuation request: **OK**
  - stopReason: `length`
  - first text (first 200 chars): `remarkable is its ubiquitous appearance throughout the natural world. From the spiraling chambers of nautilus shells to the arrangement of seeds in a sunflower's head, from the spiral patterns of gala`

### B (with low thinking)

- reasoning: `low`
- request 1 triggered length: yes
- partial content blocks: `thinking, text`
- thinking signed: yes
- continuation request: **OK**
  - stopReason: `stop`
  - first text (first 200 chars): `spirals and Fibonacci numbers. ⏎  ⏎ ## Sunflower Seed Heads: The Most Perfect Fibonacci Exhibition ⏎  ⏎ The sunflower seed head represents perhaps the most mathematically exquisite example of Fibonacci organi`

## Implications

No code change needed. Phase 2's current recovery flow is safe for production.

Phase 2b (A-level stream merge) can proceed whenever scheduled; the B-level
fallback remains valid.
