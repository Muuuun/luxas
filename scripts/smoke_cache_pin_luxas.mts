/**
 * smoke_cache_pin_luxas — Luxas-specific variant of smoke_cache_pin.
 *
 * Our post-refactor layout has exactly 3 cache_control breakpoints per
 * request (well under Anthropic's 4-pin hard limit):
 *   1. systemPrompt (one merged block: brain.md + smelt + RESEARCH.md +
 *      skills + lessons — see agent.ts)
 *   2. last message before the snapshot trailer (pinned in
 *      injectSnapshot → context.ts) so conversation history survives
 *      turn-over-turn snapshot deltas
 *   3. snapshot trailer (auto-pinned by pi-ai)
 *
 * Anything that adds a 4th system pin or a second mid-history pin would
 * push us over budget again, causing the 400 we hit on 2026-04-18.
 */

import { getModel, streamAnthropic, type Context, type TextContent } from "@mariozechner/pi-ai";

let capturedBody: any = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: any, init: any) => {
  capturedBody = init?.body ? JSON.parse(init.body) : null;
  const sse = [
    `event: message_start`,
    `data: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}`,
    ``,
    `event: message_delta`,
    `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}`,
    ``,
    `event: message_stop`,
    `data: {"type":"message_stop"}`,
    ``,
  ].join("\n");
  return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}) as any;

// Luxas's actual shape post-refactor: 1 merged system block + history + snapshot.
const systemPrompt: TextContent[] = [
  { type: "text", text: "MERGED_L1_L2_STUB (brain.md + smelt + RESEARCH.md + skills + lessons)", cacheControl: { type: "ephemeral" } },
];

const context: Context = {
  systemPrompt,
  messages: [
    { role: "user", content: "first question", timestamp: 1 },
    {
      role: "assistant",
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      content: [{ type: "text", text: "first answer" }],
      timestamp: 2,
    },
    // Mid-history user pinned by injectSnapshot (the cached history segment).
    {
      role: "user",
      content: [{ type: "text", text: "last conversation message before snapshot", cacheControl: { type: "ephemeral" } }],
      timestamp: 3,
    },
    // The research_snapshot trailer — pi-ai auto-pins this.
    { role: "user", content: "<research_snapshot>...</research_snapshot>", timestamp: 4 },
  ],
};

const model = getModel("anthropic", "claude-sonnet-4-6");
const stream = streamAnthropic(model, context, { apiKey: "sk-ant-fake", cacheRetention: "long" });
try { await stream.result(); } catch {}
globalThis.fetch = realFetch;

if (!capturedBody) { console.error("FAIL: no body captured"); process.exit(1); }

function findCacheControls(obj: any, path = "$"): string[] {
  const hits: string[] = [];
  if (obj && typeof obj === "object") {
    if (obj.cache_control) hits.push(path);
    for (const [k, v] of Object.entries(obj)) hits.push(...findCacheControls(v, `${path}.${k}`));
  }
  return hits;
}

const pins = findCacheControls(capturedBody);
const sysBlockCount = Array.isArray(capturedBody.system) ? capturedBody.system.length : (capturedBody.system ? 1 : 0);

console.log(`system blocks:          ${sysBlockCount}`);
console.log(`message count:          ${capturedBody.messages?.length}`);
console.log(`total cache_control:    ${pins.length}`);
console.log(`pin locations:`);
for (const p of pins) console.log(`  ${p}`);

let ok = true;
const expect = (cond: boolean, msg: string) => { console.log((cond ? "✓ " : "✗ ") + msg); if (!cond) ok = false; };

expect(sysBlockCount === 1, "system is 1 merged block");
expect(pins.length === 3, "exactly 3 cache_control pins (L1L2 + history + trailer)");
expect(pins.length < 4, "strictly under Anthropic's 4-pin hard limit (no 400 on request)");
const sysPins = pins.filter(p => p.startsWith("$.system.")).length;
expect(sysPins === 1, "system has exactly 1 pin");

if (!ok) {
  console.log("\n── full body for debugging ──");
  console.log(JSON.stringify(capturedBody, null, 2));
  process.exit(1);
}
console.log("\nALL PASS — Luxas layout has exactly 3 pins, 1 under the hard limit.");
