#!/usr/bin/env tsx
/**
 * smoke_failure_taxonomy — one classifier, and every layer reads it.
 *
 * Pins (a) the classes of the error strings this project has actually died on,
 * (b) that every layer that classifies holds the SAME RegExp objects rather
 * than copies that can drift (they had drifted: the agent loop did not retry a
 * 5xx that another layer matched), and (c) that the patched loop really
 * consults the published taxonomy — a 502 is retried only because of it.
 *
 *   npx tsx scripts/smoke_failure_taxonomy.mts
 */
import { fileURLToPath } from "node:url";
import { formatProviderError, normalizeProviderError } from "@earendil-works/pi-ai/utils/error-body";
import { classifyProviderError, TRANSIENT_RE, RATE_LIMIT_RE, UNFUNDED_RE } from "../src/failure-taxonomy.js";
import { TRANSIENT_RE as SPAWN_TRANSIENT_RE } from "../src/agents/spawn.js";
import { isUnfundedProviderError, UNFUNDED_PROVIDER_RE } from "../src/usage-log.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("1. classes");
// C45: pi-ai's formatProviderError puts a prefix before the status
// ("OpenAI API error (503): …", the gpt-6-astra brain route). Built with
// pi-ai's own formatter on SDK-shaped errors, so a change of shape there
// shows up here rather than as a run ended by a gateway blip.
function sdkErr(status: number, message: string, body?: object): Error {
  const e: any = new Error(message);
  e.status = status;
  if (body) e.error = body;
  return e;
}
const piFormat = (e: Error, prefix = "OpenAI API error") => formatProviderError(normalizeProviderError(e), prefix);
const PREFIXED_503 = piFormat(sdkErr(503, "503 status code (no body)"));
const CASES: Array<[string, string]> = [
  // unfunded — stop the whole run
  [`402: {"message":"Insufficient Balance"}`, "unfunded"],
  [`429: {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}`, "unfunded"],
  [`Your credit balance is too low to access the Anthropic API.`, "unfunded"],
  [`429 You exceeded your current quota, please check your plan and billing details. insufficient_quota`, "unfunded"],
  [`HTTP 402 Payment Required`, "unfunded"],
  // rate limit — minute-scale backoff
  [`429: {"code":"1302","message":"您的账户已达到速率限制，请您控制请求频率"}`, "rate_limit"],
  [`429 Too Many Requests`, "rate_limit"],
  // transient — re-stream the turn
  [`Connection error.`, "transient"],
  [`Request timed out.`, "transient"],
  [`fetch failed: terminated`, "transient"],
  [`502 Bad Gateway`, "transient"],
  [`503 {"error":{"message":"Service Unavailable"}}`, "transient"],
  [`500 Internal Server Error`, "transient"],
  [`529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, "transient"],
  [`status code 504`, "transient"],
  // fatal — retrying cannot help
  [`400 invalid_request: bad schema`, "fatal"],
  [`This model's maximum context length is 131072 tokens. However, you requested 150300 tokens`, "fatal"],
  [`401 Incorrect API key provided`, "fatal"],
  // a number that merely appears in the text is not a status
  [`400 Thinking mode does not support this tool_choice (request 402 of 500)`, "fatal"],
  [`tool output was 402 lines long`, "fatal"],
  [`prompt is too long: 215503 tokens > 200000 maximum`, "fatal"],
  [``, "fatal"],
  // C45: the status after a provider prefix, in pi-ai's "(NNN): " shape
  [PREFIXED_503, "transient"],
  [piFormat(sdkErr(502, "502 status code (no body)")), "transient"],
  [piFormat(sdkErr(500, "500 The server had an error while processing your request. Sorry about that!",
    { message: "The server had an error while processing your request. Sorry about that!", type: "server_error" })), "transient"],
  [piFormat(sdkErr(504, "504 status code (no body)"), "Azure OpenAI API error"), "transient"],
  [piFormat(sdkErr(402, "402 status code (no body)")), "unfunded"],
  [piFormat(sdkErr(429, "429 Rate limit reached", { message: "Rate limit reached", code: "rate_limit_exceeded" })), "rate_limit"],
  [piFormat(sdkErr(400, "400 Invalid schema", { message: "Invalid schema" })), "fatal"],
  // ...but a parenthesised number in prose, without the formatter's colon, is not
  [`400 {"message":"max_tokens must be <= (500)"}`, "fatal"],
];
check("C45: pi-ai's formatter still emits the prefixed shape",
  PREFIXED_503 === "OpenAI API error (503): 503 status code (no body)", PREFIXED_503);
for (const [text, want] of CASES) {
  const got = classifyProviderError(text);
  check(`${want.padEnd(10)} ← ${text.slice(0, 70) || "(empty)"}`, got === want, `got ${got}`);
}
check("accepts an Error object", classifyProviderError(new Error("ECONNRESET")) === "transient");

console.log("\n2. one owner");
check("spawn.ts re-exports the taxonomy's transient RegExp", SPAWN_TRANSIENT_RE === TRANSIENT_RE);
check("usage-log.ts UNFUNDED_PROVIDER_RE is the taxonomy's", UNFUNDED_PROVIDER_RE === UNFUNDED_RE);
check("usage-log.ts isUnfundedProviderError: bare 402 in prose is not unfunded", !isUnfundedProviderError("tool output was 402 lines long"));
const pub = (globalThis as any).__luxasFailureTaxonomy;
check("published on globalThis for the compiled loop", pub?.transient === TRANSIENT_RE && pub?.rateLimit === RATE_LIMIT_RE);

console.log("\n3. the patched loop reads it");
const loopPath = fileURLToPath(new URL("../node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js", import.meta.url));
const { runAgentLoop } = await import(loopPath);
const errMsg = (errorMessage: string) => ({ role: "assistant", content: [], stopReason: "error", errorMessage, timestamp: Date.now() });
const okMsg = { role: "assistant", content: [{ type: "text", text: "recovered" }], stopReason: "stop", timestamp: Date.now() };
async function callsFor(first: any): Promise<number> {
  let calls = 0;
  const fn = async () => {
    const msg = calls++ === 0 ? first : okMsg;
    return { async *[Symbol.asyncIterator]() { yield { type: msg.stopReason === "error" ? "error" : "done" }; }, result: async () => msg };
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  await runAgentLoop([{ role: "user", content: [{ type: "text", text: "go" }], timestamp: Date.now() }] as any,
    { systemPrompt: "s", messages: [], tools: [] } as any,
    { model: { provider: "test", id: "test" }, convertToLlm: (m: any[]) => m as any } as any,
    async () => {}, ac.signal, fn as any);
  clearTimeout(timer);
  return calls;
}
check("502 Bad Gateway is retried by the loop", (await callsFor(errMsg("502 Bad Gateway"))) >= 2);
check("Request timed out is retried by the loop", (await callsFor(errMsg("Request timed out."))) >= 2);
check("C45: a prefixed 503 is retried by the loop", (await callsFor(errMsg(PREFIXED_503))) >= 2);
check("a 400 still ends the turn", (await callsFor(errMsg("400 invalid_request: bad schema"))) === 1);
// The承重 half: with the taxonomy withdrawn the loop falls back to its literals,
// which do not know 5xx — proving the retry above came from the taxonomy.
(globalThis as any).__luxasFailureTaxonomy = undefined;
check("without the taxonomy the loop's own literals do NOT retry a 502", (await callsFor(errMsg("502 Bad Gateway"))) === 1);
(globalThis as any).__luxasFailureTaxonomy = pub;

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
