/**
 * Smoke test: verify the cache_control pin flow through pi-mono's Anthropic
 * provider. Mocks global fetch, feeds a hand-built Context with:
 *   - systemPrompt: TextContent[] (2 blocks, each with cacheControl)
 *   - one pinned user message in the middle of history
 *   - a plain trailer user message that should get auto-pinned
 *
 * Expected API request body:
 *   - params.system: 2 blocks, both cache_control
 *   - one mid-conversation user text block with cache_control (our explicit pin)
 *   - last user message text block with cache_control (auto-added by pi-ai)
 *   - total cache_control <= 4
 *
 * Run:  npx tsx scripts/smoke_cache_pin.mts
 */

import { getModel, streamAnthropic, type Context, type TextContent } from "@mariozechner/pi-ai";

// Capture the outgoing request body and short-circuit with a minimal SSE
// stream so the provider doesn't actually hit Anthropic.
let capturedBody: any = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
	capturedBody = init?.body ? JSON.parse(init.body) : null;
	// Emit a minimal SSE stream pi-ai's parser accepts, so it resolves
	// cleanly instead of crashing before we can inspect the body.
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
	return new Response(sse, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}) as any;

const systemPrompt: TextContent[] = [
	{ type: "text", text: "LAYER_1_BRAIN_MD_STUB", cacheControl: { type: "ephemeral" } },
	{ type: "text", text: "LAYER_2_RESEARCH_MD_STUB", cacheControl: { type: "ephemeral" } },
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
		// Mid-history user message with MANUAL pin (simulates injectSnapshot's
		// "breakpoint before snapshot" strategy).
		{
			role: "user",
			content: [
				{ type: "text", text: "penultimate message text", cacheControl: { type: "ephemeral" } },
			],
			timestamp: 3,
		},
		// Trailer — pi-ai will auto-add cache_control here.
		{ role: "user", content: "trailer snapshot stub", timestamp: 4 },
	],
};

const model = getModel("anthropic", "claude-sonnet-4-6");
const stream = streamAnthropic(model, context, {
	apiKey: "sk-ant-fake-for-smoketest",
	cacheRetention: "long",
});

try {
	await stream.result();
} catch {
	// stream may reject on our mocked response; we only care about captured body
}
globalThis.fetch = realFetch;

if (!capturedBody) {
	console.error("FAIL: no body captured");
	process.exit(1);
}

// ── Assertions ───────────────────────────────────────
function findCacheControls(obj: any, path = "$"): string[] {
	const hits: string[] = [];
	if (obj && typeof obj === "object") {
		if (obj.cache_control) hits.push(path);
		for (const [k, v] of Object.entries(obj)) {
			hits.push(...findCacheControls(v, `${path}.${k}`));
		}
	}
	return hits;
}

const pins = findCacheControls(capturedBody);
const sysBlockCount = Array.isArray(capturedBody.system) ? capturedBody.system.length : (capturedBody.system ? 1 : 0);
const sysPins = Array.isArray(capturedBody.system)
	? capturedBody.system.filter((b: any) => b.cache_control).length
	: 0;

console.log("── captured params summary ──");
console.log(`system blocks:           ${sysBlockCount}`);
console.log(`system blocks w/ pin:    ${sysPins}`);
console.log(`message count:           ${capturedBody.messages?.length}`);
console.log(`total cache_control:     ${pins.length}`);
console.log(`pin locations:`);
for (const p of pins) console.log(`  ${p}`);

let ok = true;
const expect = (cond: boolean, msg: string) => {
	console.log((cond ? "✓ " : "✗ ") + msg);
	if (!cond) ok = false;
};

expect(sysBlockCount === 2, "system has 2 blocks");
expect(sysPins === 2, "both system blocks have cache_control");
expect(pins.length >= 3, "total pins ≥ 3 (system x2 + at least 1 message)");
expect(pins.length <= 4, "total pins ≤ 4 (Anthropic hard limit)");
// Middle user message pin should survive (not the last message).
const hasMidPin = pins.some(p => p.startsWith("$.messages.") && !p.startsWith(`$.messages.${capturedBody.messages.length - 1}`));
expect(hasMidPin, "mid-history pin survived (bp2 is live)");
// Last message should also have one (auto-add).
const hasLastPin = pins.some(p => p.startsWith(`$.messages.${capturedBody.messages.length - 1}.`));
expect(hasLastPin, "last message auto-pinned (bp3)");

if (!ok) {
	console.log("\n── full body for debugging ──");
	console.log(JSON.stringify(capturedBody, null, 2));
	process.exit(1);
}
console.log("\nALL PASS — 3-segment cache pins are wired correctly.");
