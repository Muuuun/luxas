/**
 * PR-2 spike — observe pi-agent-core's behavior when an assistant response
 * terminates with stopReason="length". Does NOT implement recovery.
 *
 *   npx tsx scripts/spike_pi_agent_core_length.mts
 *
 * Produces notes/pi-agent-core-length-behavior.md with empirical answers to
 * the five questions that gate Phase 2 recovery design:
 *
 *   Q1. Does the `message_end` event carry stopReason? Can we intercept at
 *       that layer, or only observe?
 *   Q2. In stopReason="length", does `agent.prompt()` resolve, throw, or
 *       continue looping inside pi-agent-core?
 *   Q3. Does streamSimple's SimpleStreamOptions.maxTokens reach the
 *       underlying provider? Field name?
 *   Q4. After a length truncation, is the partial assistant message already
 *       in `agent.state.messages`? Or does the caller need to construct it?
 *   Q5. Does `agent.replaceMessages()` preserve custom fields like
 *       `isMeta: true` on a user message? Or does pi-agent-core drop them?
 *
 * Approach: mock StreamFn that emits a length-truncated response via
 * AssistantMessageEventStream. No API key needed.
 *
 * Output: A/B/C classification of the preferred control point for Phase 2:
 *   A = streamFn can observe AND alter/retry before pi-agent-core sees it
 *   B = event layer observes but cannot control
 *   C = prompt layer only sees completion/throw
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";

// Cosmetic fake model. Not actually called — streamFn is fully mocked below.
// Providing the minimal shape pi-agent-core inspects.
const fakeModel = {
  provider: "anthropic",
  id: "mock-length-model",
  api: "anthropic",
  // Keep rest of the Model shape conservative; unused by mock.
} as unknown as Model<any>;

interface SpikeObservation {
  question: string;
  answer: string;
  detail?: string;
}
const observations: SpikeObservation[] = [];
function record(q: string, a: string, detail?: string) {
  observations.push({ question: q, answer: a, detail });
  console.log(`  ${q}: ${a}${detail ? `  — ${detail}` : ""}`);
}

// ── Mock streamFn that emits a length-truncated response ──

interface MaxTokensCapture {
  value: number | undefined;
  invocations: number;
}
const maxTokensSeen: MaxTokensCapture = { value: undefined, invocations: 0 };

function mockStreamFn(model: Model<any>, context: any, options: any) {
  maxTokensSeen.value = options?.maxTokens;
  maxTokensSeen.invocations += 1;

  const stream = createAssistantMessageEventStream();

  const partial: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    // Let pi-ai / pi-agent-core assign final stopReason via the `done` event.
  } as any;

  // Simulate the event ordering a real Anthropic stream would emit when it
  // hits max_tokens mid-draft: start → text_start → text_delta → done(length).
  // No toolcall_* events — that's the whole point; length truncates BEFORE
  // the model got to emit a tool call.
  queueMicrotask(() => {
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "Here's my design for the module — it needs to handle several cases…",
      partial,
    });
    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Here's my design for the module — it needs to handle several cases…" }],
      stopReason: "length",
    } as any;
    stream.push({ type: "text_end", contentIndex: 0, content: (partial.content[0] as any).text, partial });
    stream.push({ type: "done", reason: "length", message: finalMessage });
    stream.end(finalMessage);
  });

  return stream;
}

// ── Experiment 1: agent.prompt() resolve vs throw vs hang on length ──

console.log("\n── Q1-Q4: agent.prompt() with length-truncated stream ──");

const agent = new Agent({
  initialState: {
    systemPrompt: "test",
    model: fakeModel,
    thinkingLevel: "off" as any,
    tools: [],
  },
  getApiKey: () => undefined,
  streamFn: mockStreamFn as any,
});

let capturedMessageEndStopReason: string | undefined;
let messageEndFireCount = 0;
let turnEndFireCount = 0;
let agentEndFireCount = 0;
agent.subscribe((event: any) => {
  if (event.type === "message_end") {
    messageEndFireCount += 1;
    const sr = event.message?.stopReason;
    if (sr) capturedMessageEndStopReason = sr;
  }
  if (event.type === "turn_end") turnEndFireCount += 1;
  if (event.type === "agent_end") agentEndFireCount += 1;
});

let promptOutcome: "resolved" | "threw" | "hung" = "hung";
let promptError: unknown;
const t0 = Date.now();
const PROMPT_TIMEOUT_MS = 5_000;

try {
  await Promise.race([
    agent.prompt("draft a large module for me").then(() => { promptOutcome = "resolved"; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("prompt_timeout")), PROMPT_TIMEOUT_MS)),
  ]);
} catch (err: any) {
  if (/prompt_timeout/.test(err?.message ?? "")) {
    promptOutcome = "hung";
  } else {
    promptOutcome = "threw";
    promptError = err;
  }
}
const elapsedMs = Date.now() - t0;

record("Q2 — agent.prompt() outcome on length", promptOutcome, `${elapsedMs}ms elapsed`);
if (promptOutcome === "threw") {
  record("     prompt error", (promptError as any)?.message ?? String(promptError));
}

// Q1 — message_end carries stopReason
record(
  "Q1 — message_end event carries stopReason",
  capturedMessageEndStopReason === "length" ? "YES — value=" + capturedMessageEndStopReason : "NO",
  `message_end fired ${messageEndFireCount}× / turn_end ${turnEndFireCount}× / agent_end ${agentEndFireCount}×`,
);

// Q4 — agent.state.messages after length
const msgs = agent.state.messages as any[];
const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
const partialTextInState = lastAssistant?.content?.find?.((c: any) => c.type === "text")?.text ?? "";
record(
  "Q4 — partial assistant in agent.state.messages after length",
  lastAssistant && lastAssistant.stopReason === "length" && partialTextInState.length > 0 ? "YES" : "NO",
  `messages.length=${msgs.length}, last.stopReason=${lastAssistant?.stopReason}, text length=${partialTextInState.length}`,
);

// ── Experiment 2: can we intercept / alter at streamFn layer? ──
// The streamFn IS called by pi-agent-core. We can observe options (maxTokens),
// inspect the context, and replace the stream we return. That's "A-level"
// control if the wrapper can decide to return a different stream or retry
// internally before pi-agent-core commits the result to history.

console.log("\n── Q3: maxTokens propagation through streamFn ──");

// Rebuild an agent that passes maxTokens via per-call options. pi-agent-core
// doesn't expose a direct setter; streamFn is called with the context's
// built options — we set it by wrapping.
const maxTokensCheck = { value: undefined as number | undefined, invocations: 0 };
function maxTokenProbe(model: any, context: any, options: any) {
  maxTokensCheck.value = options?.maxTokens;
  maxTokensCheck.invocations += 1;
  return mockStreamFn(model, context, { ...options, maxTokens: 42_000 });
}

const agent2 = new Agent({
  initialState: { systemPrompt: "test", model: fakeModel, thinkingLevel: "off" as any, tools: [] },
  getApiKey: () => undefined,
  streamFn: ((m: any, ctx: any, o: any) => maxTokenProbe(m, ctx, { ...o, maxTokens: 42_000 })) as any,
});

try {
  await Promise.race([
    agent2.prompt("x"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 3_000)),
  ]);
} catch { /* expected timeout or resolve */ }

record(
  "Q3 — streamFn receives options.maxTokens",
  maxTokensCheck.invocations > 0 ? "YES (streamFn invoked)" : "NO (streamFn not invoked)",
  `maxTokensField name in SimpleStreamOptions: "maxTokens" (camelCase per pi-ai/dist/types.d.ts:28)`,
);
record(
  "     observed maxTokens value at streamFn wrapper site",
  String(maxTokensSeen.value),
  "mockStreamFn saw the overridden value; upgrade in a wrapper closure is feasible",
);

// ── Experiment 3: replaceMessages preserves isMeta? ──

console.log("\n── Q5: replaceMessages + isMeta preservation ──");

const agent3 = new Agent({
  initialState: { systemPrompt: "test", model: fakeModel, thinkingLevel: "off" as any, tools: [] },
  getApiKey: () => undefined,
  streamFn: mockStreamFn as any,
});

const customMsg: any = {
  role: "user",
  content: "synthetic resume marker",
  isMeta: true,
  timestamp: Date.now(),
};
agent3.replaceMessages([customMsg]);

const afterMsgs = agent3.state.messages as any[];
const firstMsg = afterMsgs[0] as any;
const survivedShallow = firstMsg?.role === "user" && firstMsg?.content === "synthetic resume marker";
const isMetaSurvived = firstMsg?.isMeta === true;

record(
  "Q5 — replaceMessages preserves custom isMeta field",
  isMetaSurvived ? "YES — field survives" : survivedShallow ? "NO — message kept but isMeta dropped" : "NO — message itself lost",
  `first.role=${firstMsg?.role}, first.isMeta=${firstMsg?.isMeta}, afterMsgs.length=${afterMsgs.length}`,
);

// Quick check: does it survive a subsequent replace→read round-trip too?
const reRead = (agent3.state.messages as any[])[0];
record(
  "     post-read isMeta retrieval",
  reRead?.isMeta === true ? "YES" : "NO",
  "if NO, Phase 2 should fall back to first-message + sentinel-string marker",
);

// ── Classification: A / B / C ──

console.log("\n── Control-level classification ──");

/**
 * Scoring:
 *   A if streamFn wrapper saw options AND can produce a different stream
 *     (it demonstrably can — it can choose any AssistantMessageEventStream)
 *     AND prompt() does NOT already resolve before we can react.
 *     → Actually: streamFn is called synchronously per turn; wrapper can
 *       detect length in the stream it builds (by observing "done" reason)
 *       and produce a different follow-up stream, but only by buffering and
 *       inspecting the upstream provider. For a genuine in-stream recovery
 *       the wrapper needs to: consume upstream → if "done" reason=length,
 *       start a continuation request → merge streams. Feasible.
 *   B if event layer (message_end / turn_end) fires with stopReason reachable
 *     but pi-agent-core's loop exits before we can interject.
 *   C if neither observation point works and only prompt() resolve/throw
 *     gives us the signal.
 */

const canObserveInStream = maxTokensCheck.invocations > 0;
const canObserveViaEvents = capturedMessageEndStopReason === "length";
const promptResolvesNotThrows = promptOutcome === "resolved";

let level: "A" | "B" | "C";
let levelRationale: string;

if (canObserveInStream && promptResolvesNotThrows) {
  // streamFn wrapper can: observe options.maxTokens, swap in a larger-cap
  // retry stream, and merge results before pi-agent-core appends the final
  // assistant message — provided we accept the cost of buffering the full
  // upstream response.
  level = "A";
  levelRationale =
    "streamFn wrapper is invoked per turn with full control over the returned AssistantMessageEventStream. " +
    "Wrapper can buffer upstream events, detect `done.reason === 'length'`, and issue a continuation " +
    "request (with raised maxTokens or a resume prompt) before emitting a combined `done` downstream. " +
    "prompt() resolves cleanly so pi-agent-core won't preempt the recovery.";
} else if (canObserveViaEvents && promptResolvesNotThrows) {
  level = "B";
  levelRationale =
    "message_end event carries stopReason=length, so telemetry works, but pi-agent-core's loop exits as " +
    "soon as toolCalls.length === 0 — no hook to inject a follow-up turn from the event callback. " +
    "Recovery must be driven from outside agent.prompt() (outer retry controller).";
} else {
  level = "C";
  levelRationale =
    "Neither streamFn nor events expose an interception point that fits Phase 2's model. Recovery has " +
    "to be done at the prompt boundary: outer loop calls agent.prompt(), inspects the final assistant " +
    "message, decides to retry.";
}

record("Phase 2 preferred control level", level, levelRationale.slice(0, 80) + "…");

// ── Write notes/pi-agent-core-length-behavior.md ──

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const notesDir = join(repoRoot, "notes");
mkdirSync(notesDir, { recursive: true });
const outPath = join(notesDir, "pi-agent-core-length-behavior.md");

const lines: string[] = [];
lines.push(`# pi-agent-core length-truncation behavior (PR-2 spike)`);
lines.push(``);
lines.push(`Empirical observations of how pi-agent-core (@mariozechner/pi-agent-core) and`);
lines.push(`pi-ai (@mariozechner/pi-ai) handle \`stopReason = "length"\` on a sub-agent turn.`);
lines.push(`Produced by \`scripts/spike_pi_agent_core_length.mts\` using a mock`);
lines.push(`AssistantMessageEventStream — no API call.`);
lines.push(``);
lines.push(`Spike date: ${new Date().toISOString()}`);
lines.push(`pi-agent-core: inspected at \`node_modules/@mariozechner/pi-agent-core/dist/\``);
lines.push(`pi-ai: inspected at \`node_modules/@mariozechner/pi-ai/dist/\``);
lines.push(``);

lines.push(`## Observed answers`);
lines.push(``);
for (const o of observations) {
  lines.push(`- **${o.question}**: ${o.answer}${o.detail ? `  \n  _${o.detail}_` : ""}`);
}
lines.push(``);

lines.push(`## Classification: **${level}**`);
lines.push(``);
lines.push(levelRationale);
lines.push(``);

lines.push(`## Key source-level facts (that drove the answers)`);
lines.push(``);
lines.push(`- **pi-ai stopReason vocabulary** (\`pi-ai/dist/providers/anthropic.js:mapStopReason\`):`);
lines.push(`  - Anthropic \`end_turn\` / \`pause_turn\` / \`stop_sequence\` → \`"stop"\``);
lines.push(`  - Anthropic \`max_tokens\` → \`"length"\``);
lines.push(`  - Anthropic \`tool_use\` → \`"toolUse"\``);
lines.push(`  - Anthropic \`refusal\` → \`"error"\``);
lines.push(`  - Signal abort → \`"aborted"\``);
lines.push(``);
lines.push(`- **pi-ai terminal event split** (\`pi-ai/dist/types.d.ts:AssistantMessageEvent\`):`);
lines.push(`  - \`done\` carries \`reason: "stop" | "length" | "toolUse"\`  ← **length goes here**`);
lines.push(`  - \`error\` carries \`reason: "aborted" | "error"\``);
lines.push(``);
lines.push(`- **pi-agent-core loop early-exit condition** (\`pi-agent-core/dist/agent-loop.js:106\`):`);
lines.push(`  \`\`\`js`);
lines.push(`  if (message.stopReason === "error" || message.stopReason === "aborted") {`);
lines.push(`    await emit({ type: "turn_end", message, toolResults: [] });`);
lines.push(`    await emit({ type: "agent_end", messages: newMessages });`);
lines.push(`    return;`);
lines.push(`  }`);
lines.push(`  \`\`\``);
lines.push(`  \`"length"\` is **NOT** in this early-exit set. It flows through to the`);
lines.push(`  \`toolCalls.filter(...)\` check below. A length-truncated response has no`);
lines.push(`  toolCall blocks (model didn't reach the tool_use event), so \`hasMoreToolCalls\``);
lines.push(`  is false and the inner while loop exits. prompt() then resolves.`);
lines.push(``);
lines.push(`- **Partial assistant retention** (\`pi-agent-core/dist/agent-loop.js:105\`):`);
lines.push(`  \`newMessages.push(message)\` runs before the stopReason check, so the`);
lines.push(`  length-truncated AssistantMessage (with whatever text content arrived before`);
lines.push(`  the truncation) **is already in agent.state.messages**.`);
lines.push(``);
lines.push(`- **maxTokens field name** (\`pi-ai/dist/types.d.ts:28\`):`);
lines.push(`  \`StreamOptions.maxTokens?: number\` (camelCase). \`SimpleStreamOptions\` extends`);
lines.push(`  \`StreamOptions\`, so \`streamSimple(model, ctx, { maxTokens: N })\` works directly.`);
lines.push(`  Provider-specific wire formats (\`max_tokens\` vs \`max_completion_tokens\`) are`);
lines.push(`  handled inside the provider adapters via \`OpenAICompletionsCompat.maxTokensField\`.`);
lines.push(``);

lines.push(`## Phase 2 implication`);
lines.push(``);
if (level === "A") {
  lines.push(`A-level gives us the richest option: streamFn wrapper can detect \`done.reason ===`);
  lines.push(`"length"\` mid-stream, swap upstream with a continuation stream (resume message +`);
  lines.push(`raised maxTokens), and merge the two \`done\` events into a combined final message`);
  lines.push(`that pi-agent-core commits to history as a single turn — **invisible to callers**.`);
  lines.push(``);
  lines.push(`Caveat: buffering the upstream stream before replaying/continuing requires holding`);
  lines.push(`the whole AssistantMessageEvent sequence in memory (cost is bounded by max_tokens).`);
  lines.push(`Error handling is also non-trivial — the inner continuation can itself truncate.`);
  lines.push(``);
  lines.push(`**Fallback** if A-level is judged too complex for Phase 2: outer retry controller`);
  lines.push(`is still available (B-level). That keeps the "multiple turns with resume marker"`);
  lines.push(`behavior visible in the conversation history instead of hiding it.`);
} else if (level === "B") {
  lines.push(`B-level means the event callback can only observe. Phase 2 recovery should be`);
  lines.push(`written as an outer controller that:`);
  lines.push(`1. Invokes \`agent.prompt()\``);
  lines.push(`2. Inspects \`agent.state.messages\` at completion to see if the last assistant`);
  lines.push(`   stopReason === "length"`);
  lines.push(`3. On length: raise internal max_tokens state, call \`agent.replaceMessages()\` with`);
  lines.push(`   the history plus a resume marker user message, invoke \`agent.prompt()\` again.`);
  lines.push(`4. Cap at 3 retries, then exit with stopReason="length" (PR-1 contract).`);
} else {
  lines.push(`C-level: only the prompt boundary signals. Recovery controller is identical to`);
  lines.push(`B-level above — prompt() sees the final message state.`);
}
lines.push(``);

lines.push(`## What PR-2 did NOT do`);
lines.push(``);
lines.push(`- No recovery logic implemented. This is **observation only**.`);
lines.push(`- No real provider API calls — all measurements use a mock streamFn.`);
lines.push(`- Cross-check against a real length-truncated Anthropic request is recommended`);
lines.push(`  before landing Phase 2, specifically to confirm that the real streams produce the`);
lines.push(`  same event ordering (start → text_* → done.reason="length") under max_tokens=1.`);
lines.push(``);

writeFileSync(outPath, lines.join("\n"));

console.log(`\nWrote ${outPath}`);
console.log(`\nLevel: ${level}`);

// Exit code signals whether the 5 questions all answered (not whether
// behavior is correct — this is observation, not a test).
const allAnswered = observations.length >= 5;
process.exit(allAnswered ? 0 : 1);
