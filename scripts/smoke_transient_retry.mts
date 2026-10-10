#!/usr/bin/env tsx
/**
 * Smoke: one owner for transient provider retry (C49).
 *
 * Sessions 5 and 7 ended on a single network blip (`Connection error.`,
 * `Request timed out.`). The first fix retried inside usage-log.ts's provider
 * wrapper, on a REJECTING result() — but pi-ai's EventStream.result() only
 * ever resolves: every adapter delivers a failure as an error event plus a
 * resolved stopReason="error" message. That retry never ran on a real failure;
 * the one that does is the patched agent loop
 * (patches/pi-agent-core-no-tool-retry-guard.sh, Patch C/E). This pins:
 *   1. usage-log.ts exports no retry helper to call by mistake;
 *   2. the usage wrapper hides no retry layer: a rejecting result() reaches the
 *      caller after one provider call, without a 10/30/60 s wait;
 *   3. the real composed path (installed wrapper + streamWithRetry + patched
 *      loop) re-streams a transient and a 5xx once, a 400 never, and bills
 *      each attempt once;
 *   4. the phrases the old wrapper was written for classify the same way on
 *      the one classifier (the rest are in smoke_failure_taxonomy §1).
 *
 *   npx tsx scripts/smoke_transient_retry.mts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, registerApiProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import * as usageLog from "../src/usage-log.js";
import { classifyProviderError } from "../src/failure-taxonomy.js";
import { streamWithRetry } from "../src/agents/spawn.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// A scripted provider. Each call either succeeds or fails the way every pi-ai
// adapter fails: an error event, and result() resolves to the stopReason="error"
// message. In reject mode a failing call's result() rejects instead — no pi-ai
// provider does that; it is here only to show that nothing under the loop retries.
const API = "c49-smoke";
let script: Array<string | null> = [];
let calls = 0;
let rejectMode = false;
const message = (stopReason: "stop" | "error", errorMessage?: string) => ({
  role: "assistant", content: stopReason === "error" ? [] : [{ type: "text", text: "ok" }],
  api: API, provider: API, model: "m",
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
  stopReason, errorMessage, timestamp: Date.now(),
});
function scripted(): any {
  const errText = script[Math.min(calls, script.length - 1)];
  calls++;
  const s = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (errText) s.push({ type: "error", reason: "error", error: message("error", errText) } as any);
    else s.push({ type: "done", reason: "stop", message: message("stop") } as any);
    s.end();
  });
  if (rejectMode && errText) return { [Symbol.asyncIterator]: () => s[Symbol.asyncIterator](), result: () => Promise.reject(new Error(errText)) };
  return s;
}
// Before installUsageTracking: it wraps the providers registered when it runs.
registerApiProvider({ api: API, stream: scripted, streamSimple: scripted } as any, "smoke");
const tmp = mkdtempSync(join(tmpdir(), "luxas-c49-"));
const logPath = join(tmp, ".agent", "usage.log");
usageLog.installUsageTracking(logPath);
const model: any = { api: API, provider: API, id: "m" };
const usageLines = () => existsSync(logPath) ? readFileSync(logPath, "utf-8").split("\n").filter(Boolean).length : 0;

console.log("C49 §1. usage-log.ts exports no retry helper");
for (const name of ["withTransientRetry", "isTransientError"]) check(`no ${name} export`, !(name in usageLog));

console.log("\nC49 §2. the usage wrapper is not a retry layer");
{
  rejectMode = true; script = ["Connection error.", null]; calls = 0;
  const t0 = Date.now();
  let threw = false;
  try { await streamSimple(model, { messages: [] } as any, {}).result(); } catch { threw = true; }
  const ms = Date.now() - t0;
  rejectMode = false;
  check("a rejecting result() reaches the caller after one provider call, without a 10/30/60 s wait",
    threw && calls === 1 && ms < 2000, `threw=${threw}, calls=${calls}, ${ms} ms`);
}

console.log("\nC49 §3. the live path: installed wrapper + streamWithRetry + patched agent loop");
async function drive(firstError: string): Promise<{ calls: number; last: any; lines: number }> {
  script = [firstError, null]; calls = 0;
  const before = usageLines();
  let last: any;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  await runAgentLoop([{ role: "user", content: [{ type: "text", text: "go" }], timestamp: Date.now() }] as any,
    { systemPrompt: "s", messages: [], tools: [] } as any,
    { model, convertToLlm: (m: any[]) => m } as any,
    async (e: any) => { if (e.type === "message_end" && e.message?.role === "assistant") last = e.message; },
    ac.signal, (m: any, c: any, o: any) => streamWithRetry(m, c, o));
  clearTimeout(timer);
  return { calls, last, lines: usageLines() - before };
}
{
  const r = await drive("Connection error.");
  check("a transient error event is re-streamed once and the turn recovers",
    r.calls === 2 && r.last?.stopReason === "stop", `calls=${r.calls}, last=${r.last?.stopReason}`);
  check("each attempt is billed once in usage.log", r.lines === 2, `lines=${r.lines}`);
}
{
  const r = await drive("502 Bad Gateway");
  check("a 5xx is re-streamed (the taxonomy reaches the loop)", r.calls === 2, `calls=${r.calls}`);
}
{
  const r = await drive("400 invalid_request: bad schema");
  check("a 400 is not retried", r.calls === 1 && r.last?.stopReason === "error", `calls=${r.calls}, last=${r.last?.stopReason}`);
}

console.log("\nC49 §4. the old wrapper's phrases, on the one classifier");
const CASES: Array<[unknown, string]> = [
  [new Error("ETIMEDOUT"), "transient"],
  [new Error("ECONNREFUSED"), "transient"],
  [new Error("socket hang up"), "transient"],
  [new Error("network error"), "transient"],
  [new Error("HTTP 503 Service Unavailable"), "transient"],
  [new Error("Anthropic overloaded (529)"), "transient"],
  [new Error("rate_limit_error: 1000 RPM exceeded"), "rate_limit"],
  [new Error("authentication_error: invalid API key"), "fatal"],
  [new Error("permission_denied"), "fatal"],
  [new Error("Tool execution failed"), "fatal"],
  [new Error("malformed JSON"), "fatal"],
  [undefined, "fatal"],
  [null, "fatal"],
  ["plain string", "fatal"],
];
for (const [err, want] of CASES) {
  const got = classifyProviderError(err);
  const text = err instanceof Error ? err.message : String(err);
  check(`${want.padEnd(10)} ← ${text}`, got === want, `got ${got}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
