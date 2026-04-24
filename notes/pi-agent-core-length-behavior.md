# pi-agent-core length-truncation behavior (PR-2 spike)

Empirical observations of how pi-agent-core (@mariozechner/pi-agent-core) and
pi-ai (@mariozechner/pi-ai) handle `stopReason = "length"` on a sub-agent turn.
Produced by `scripts/spike_pi_agent_core_length.mts` using a mock
AssistantMessageEventStream — no API call.

Spike date: 2026-04-24T06:47:24.598Z
pi-agent-core: inspected at `node_modules/@mariozechner/pi-agent-core/dist/`
pi-ai: inspected at `node_modules/@mariozechner/pi-ai/dist/`

## Observed answers

- **Q2 — agent.prompt() outcome on length**: resolved  
  _1ms elapsed_
- **Q1 — message_end event carries stopReason**: YES — value=length  
  _message_end fired 2× / turn_end 1× / agent_end 1×_
- **Q4 — partial assistant in agent.state.messages after length**: YES  
  _messages.length=2, last.stopReason=length, text length=67_
- **Q3 — streamFn receives options.maxTokens**: YES (streamFn invoked)  
  _maxTokensField name in SimpleStreamOptions: "maxTokens" (camelCase per pi-ai/dist/types.d.ts:28)_
- **     observed maxTokens value at streamFn wrapper site**: 42000  
  _mockStreamFn saw the overridden value; upgrade in a wrapper closure is feasible_
- **Q5 — replaceMessages preserves custom isMeta field**: YES — field survives  
  _first.role=user, first.isMeta=true, afterMsgs.length=1_
- **     post-read isMeta retrieval**: YES  
  _if NO, Phase 2 should fall back to first-message + sentinel-string marker_
- **Phase 2 preferred control level**: A  
  _streamFn wrapper is invoked per turn with full control over the returned Assista…_

## Classification: **A**

streamFn wrapper is invoked per turn with full control over the returned AssistantMessageEventStream. Wrapper can buffer upstream events, detect `done.reason === 'length'`, and issue a continuation request (with raised maxTokens or a resume prompt) before emitting a combined `done` downstream. prompt() resolves cleanly so pi-agent-core won't preempt the recovery.

## Key source-level facts (that drove the answers)

- **pi-ai stopReason vocabulary** (`pi-ai/dist/providers/anthropic.js:mapStopReason`):
  - Anthropic `end_turn` / `pause_turn` / `stop_sequence` → `"stop"`
  - Anthropic `max_tokens` → `"length"`
  - Anthropic `tool_use` → `"toolUse"`
  - Anthropic `refusal` → `"error"`
  - Signal abort → `"aborted"`

- **pi-ai terminal event split** (`pi-ai/dist/types.d.ts:AssistantMessageEvent`):
  - `done` carries `reason: "stop" | "length" | "toolUse"`  ← **length goes here**
  - `error` carries `reason: "aborted" | "error"`

- **pi-agent-core loop early-exit condition** (`pi-agent-core/dist/agent-loop.js:106`):
  ```js
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    await emit({ type: "turn_end", message, toolResults: [] });
    await emit({ type: "agent_end", messages: newMessages });
    return;
  }
  ```
  `"length"` is **NOT** in this early-exit set. It flows through to the
  `toolCalls.filter(...)` check below. A length-truncated response has no
  toolCall blocks (model didn't reach the tool_use event), so `hasMoreToolCalls`
  is false and the inner while loop exits. prompt() then resolves.

- **Partial assistant retention** (`pi-agent-core/dist/agent-loop.js:105`):
  `newMessages.push(message)` runs before the stopReason check, so the
  length-truncated AssistantMessage (with whatever text content arrived before
  the truncation) **is already in agent.state.messages**.

- **maxTokens field name** (`pi-ai/dist/types.d.ts:28`):
  `StreamOptions.maxTokens?: number` (camelCase). `SimpleStreamOptions` extends
  `StreamOptions`, so `streamSimple(model, ctx, { maxTokens: N })` works directly.
  Provider-specific wire formats (`max_tokens` vs `max_completion_tokens`) are
  handled inside the provider adapters via `OpenAICompletionsCompat.maxTokensField`.

## Phase 2 implication

A-level gives us the richest option: streamFn wrapper can detect `done.reason ===
"length"` mid-stream, swap upstream with a continuation stream (resume message +
raised maxTokens), and merge the two `done` events into a combined final message
that pi-agent-core commits to history as a single turn — **invisible to callers**.

Caveat: buffering the upstream stream before replaying/continuing requires holding
the whole AssistantMessageEvent sequence in memory (cost is bounded by max_tokens).
Error handling is also non-trivial — the inner continuation can itself truncate.

**Fallback** if A-level is judged too complex for Phase 2: outer retry controller
is still available (B-level). That keeps the "multiple turns with resume marker"
behavior visible in the conversation history instead of hiding it.

## What PR-2 did NOT do

- No recovery logic implemented. This is **observation only**.
- No real provider API calls — all measurements use a mock streamFn.
- Cross-check against a real length-truncated Anthropic request is recommended
  before landing Phase 2, specifically to confirm that the real streams produce the
  same event ordering (start → text_* → done.reason="length") under max_tokens=1.
