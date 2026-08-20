/**
 * Smoke test: prompt-cache breakpoints in the outgoing Anthropic request.
 *
 * Placement moved into pi-ai in 0.84: `TextContent.cacheControl` is gone and
 * `Context.systemPrompt` is a plain string, so Luxas no longer marks anything
 * itself. The Anthropic layer now marks the system prompt, the last tool
 * definition, and the last user content block — Claude Code's own layout,
 * capped at Anthropic's 4 breakpoints.
 *
 * What this pins is the part Luxas's cost model depends on: the system block
 * (L1+L2+L3, the big stable prefix) is cached, and the request never exceeds
 * four breakpoints. The mid-history breakpoint Luxas used to place by hand is
 * deliberately absent — see the note in context.ts injectSnapshot.
 *
 * The provider takes a `fetch` in its options, so the request is captured
 * through that seam rather than by monkey-patching a global.
 *
 * Run:  npx tsx scripts/smoke_cache_pin.mts
 */

import { getModel, streamAnthropic, type Context } from "@earendil-works/pi-ai/compat";

let capturedBody: any = null;

/** Minimal SSE the provider's parser accepts, so it settles instead of throwing. */
function sseResponse(): Response {
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
}

const capturingFetch = (async (_url: any, init: any) => {
	capturedBody = init?.body ? JSON.parse(init.body) : null;
	return sseResponse();
}) as any;

const context: Context = {
	systemPrompt: "LAYER_1_BRAIN_MD_STUB\n\nLAYER_2_RESEARCH_MD_STUB\n\nLAYER_3_SEMI_STATIC_STUB",
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
		{ role: "user", content: "penultimate message text", timestamp: 3 },
		{ role: "user", content: "trailer snapshot stub", timestamp: 4 },
	],
	tools: [
		{ name: "read", description: "read a file", parameters: { type: "object", properties: {} } as any },
		{ name: "finish", description: "finish the task", parameters: { type: "object", properties: {} } as any },
	],
};

const model = getModel("anthropic", "claude-sonnet-4-6");
const stream = streamAnthropic(model, context, {
	apiKey: "sk-ant-fake-for-smoketest",
	cacheRetention: "long",
	fetch: capturingFetch,
} as any);

try {
	await stream.result();
} catch {
	// The mocked response may reject downstream; only the captured body matters.
}

if (!capturedBody) {
	console.error("FAIL: no body captured");
	process.exit(1);
}

let ok = true;
const expect = (cond: boolean, label: string, detail = "") => {
	console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
	if (!cond) ok = false;
};

function findCacheControls(obj: any, path = "$"): string[] {
	const hits: string[] = [];
	if (obj && typeof obj === "object") {
		if (obj.cache_control) hits.push(path);
		for (const [k, v] of Object.entries(obj)) {
			if (k === "cache_control") continue;
			hits.push(...findCacheControls(v, `${path}.${k}`));
		}
	}
	return hits;
}

const pins = findCacheControls(capturedBody);
const system = capturedBody.system ?? [];
const sysPins = (Array.isArray(system) ? system : []).filter((b: any) => b?.cache_control).length;

// An API key sends one system block; OAuth prepends the Claude Code identity
// block and pins both. Either way every system block carries a breakpoint.
expect(Array.isArray(system) && system.length >= 1, "system prompt is sent as block(s)", JSON.stringify(system).slice(0, 120));
expect(sysPins === system.length && sysPins >= 1, "every system block is cache_control'd", `${sysPins}/${system.length}`);
expect(JSON.stringify(system).includes("LAYER_3_SEMI_STATIC_STUB"), "L3 rides inside the cached system block");

const lastTool = capturedBody.tools?.[capturedBody.tools.length - 1];
expect(!!lastTool?.cache_control, "last tool definition is pinned");
expect(!capturedBody.tools?.[0]?.cache_control, "only the LAST tool definition is pinned");

const msgs = capturedBody.messages ?? [];
const lastMsg = msgs[msgs.length - 1];
const lastBlock = Array.isArray(lastMsg?.content) ? lastMsg.content[lastMsg.content.length - 1] : null;
expect(!!lastBlock?.cache_control, "last user content block is pinned");

// The hard limit. Exceeding it is an API error, not a degraded cache.
expect(pins.length <= 4, "total breakpoints ≤ 4 (Anthropic hard limit)", `got ${pins.length}: ${pins.join(", ")}`);

// cacheRetention "long" buys a 1h TTL where the model supports it — worth
// having on 8h runs, and silently dropping it would be invisible in output.
const ttls = pins.map((p) => p).length;
const anyTtl = JSON.stringify(capturedBody).includes('"ttl":"1h"');
expect(anyTtl, 'cacheRetention "long" produced ttl 1h', `ttls seen: ${ttls}`);

if (!ok) {
	console.log("\n── full body ──");
	console.log(JSON.stringify(capturedBody, null, 2));
	process.exit(1);
}
console.log(`\nALL PASS — ${pins.length} breakpoints, placed by pi-ai.`);
