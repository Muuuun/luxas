/**
 * smoke_cache_pin_luxas — Luxas-shaped request, checked against Anthropic's
 * 4-breakpoint hard limit (the 400 we hit on 2026-04-18).
 *
 * Since pi-ai 0.84 every breakpoint is placed by the provider, so the layout
 * for a Luxas request is:
 *   1. systemPrompt — one merged block (brain.md + smelt + RESEARCH.md +
 *      skills + lessons), the big stable prefix
 *   2. last tool definition
 *   3. the research_snapshot trailer, as the last user content block
 *
 * The mid-history breakpoint Luxas used to place before the trailer is gone:
 * TextContent lost `cacheControl` and the provider always marks the LAST user
 * block. The budget invariant this file exists for still holds, and it is now
 * the provider's job to keep it — which is exactly why it stays checked.
 */

import { getModel, streamAnthropic, type Context } from "@earendil-works/pi-ai/compat";

let capturedBody: any = null;
// The provider accepts a `fetch` in its options; use that seam rather than
// monkey-patching a global the Anthropic SDK may not read.
const capturingFetch = (async (_url: any, init: any) => {
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

// Luxas's actual shape: one merged system string + history + snapshot trailer.
const systemPrompt = "MERGED_L1_L2_L3_STUB (brain.md + smelt + RESEARCH.md + skills + lessons)";

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
    { role: "user", content: "last conversation message before snapshot", timestamp: 3 },
    // The research_snapshot trailer injectSnapshot appends; the provider pins it.
    { role: "user", content: "<research_snapshot>...</research_snapshot>", timestamp: 4 },
  ],
  tools: [
    { name: "read", description: "read a file", parameters: { type: "object", properties: {} } as any },
    { name: "finish", description: "finish the task", parameters: { type: "object", properties: {} } as any },
  ],
};

const model = getModel("anthropic", "claude-sonnet-4-6");
const stream = streamAnthropic(model, context, { apiKey: "sk-ant-fake", cacheRetention: "long", fetch: capturingFetch } as any);
try { await stream.result(); } catch {}

if (!capturedBody) { console.error("FAIL: no body captured"); process.exit(1); }

function findCacheControls(obj: any, path = "$"): string[] {
  const hits: string[] = [];
  if (obj && typeof obj === "object") {
    if (obj.cache_control) hits.push(path);
    for (const [k, v] of Object.entries(obj)) { if (k === "cache_control") continue; hits.push(...findCacheControls(v, `${path}.${k}`)); }
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

expect(sysBlockCount === 1, "system is 1 merged block (API-key path; OAuth prepends a second)");
expect(pins.length === 3, "exactly 3 cache_control pins (system + last tool + trailer)");
expect(pins.length < 4, "strictly under Anthropic's 4-pin hard limit (no 400 on request)");
const sysPins = pins.filter(p => p.startsWith("$.system.")).length;
expect(sysPins === 1, "system has exactly 1 pin");
const msgPins = pins.filter(p => p.startsWith("$.messages.")).length;
expect(msgPins === 1, "exactly 1 message pin — the trailer, not a mid-history block");
const lastIdx = (capturedBody.messages?.length ?? 0) - 1;
expect(pins.some(p => p.startsWith(`$.messages.${lastIdx}.`)), "the message pin is on the LAST message");

if (!ok) {
  console.log("\n── full body for debugging ──");
  console.log(JSON.stringify(capturedBody, null, 2));
  process.exit(1);
}
console.log("\nALL PASS — Luxas layout has exactly 3 pins, 1 under the hard limit.");
