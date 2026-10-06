#!/usr/bin/env tsx
/**
 * smoke_cache_breakpoint — the brain's history stays a cached prefix on Anthropic.
 *
 * Drives pi-ai's REAL Anthropic adapter (no network: onPayload captures the
 * request and aborts) for two consecutive brain turns, each ending in a
 * different <research_snapshot> trailer, and checks the property a cache hit
 * needs: the prefix that turn N marks is byte-for-byte a prefix of turn N+1.
 *
 * Without src/cache-breakpoint.ts the only history breakpoint sits on the
 * trailer, which the next turn does not contain — the "unpinned" check below
 * asserts that this is still how the adapter behaves, so the day pi-ai changes
 * it this gate says the pin is no longer needed instead of silently doubling up.
 *
 *   npx tsx scripts/smoke_cache_breakpoint.mts
 */
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { resolveModel } from "../src/agents/spawn.js";
import { pinHistoryBreakpoint } from "../src/cache-breakpoint.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_BRAIN_MODEL;
const model: any = resolveModel("sonnet", "brain");
const t = 1_700_000_000_000;
const tool = { name: "read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } };
const call = (id: string, path: string) => ({
  role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path } }],
  stopReason: "toolUse", timestamp: t, api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const result = (id: string, text: string) => ({
  role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: t,
});
const snapshot = (n: number) => ({ role: "user", content: `<research_snapshot>\nturn ${n} state\n</research_snapshot>`, timestamp: t });

const turn1 = [
  { role: "system", content: "You are the brain. ".repeat(40), tools: [tool], timestamp: t },
  { role: "user", content: "Research goal: gate", timestamp: t },
  call("toolu_01", "a.md"), result("toolu_01", "contents of a"),
];
const turn2 = [...turn1, call("toolu_02", "b.md"), result("toolu_02", "contents of b")];

/** What the adapter would send for this transcript, before and after the pin. */
async function payloadFor(history: any[], n: number, extra: Record<string, unknown> = {}, mdl: any = model): Promise<{ raw: any; pinned: any }> {
  let raw: any, pinned: any;
  try {
    const s: any = await streamSimple(mdl, { messages: [...history, snapshot(n)] } as any, {
      apiKey: "sk-ant-api03-offline-gate", ...extra,
      onPayload: (p: any) => { raw = structuredClone(p); pinned = pinHistoryBreakpoint(p); throw new Error("gate: stop before the network"); },
    } as any);
    const r = await s.result?.();
    if (!raw) console.log(`  (adapter stopped before the payload hook: ${String(r?.errorMessage).slice(0, 300)})`);
  } catch (e: any) { if (!raw) console.log(`  (adapter threw before the payload hook: ${String(e?.message).slice(0, 300)})`); }
  return { raw, pinned };
}

const blocksOf = (m: any): any[] => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]);
/** Flat [system…, tools…, message blocks…] with markers stripped, plus the index of each breakpoint. */
function flatten(p: any): { stream: string[]; marks: number[] } {
  const stream: string[] = [], marks: number[] = [];
  const push = (kind: string, b: any) => {
    const { cache_control, ...rest } = b;
    stream.push(kind + JSON.stringify(rest));
    if (cache_control) marks.push(stream.length - 1);
  };
  for (const b of p.system ?? []) push("S", b);
  for (const b of p.tools ?? []) push("T", b);
  for (const m of p.messages ?? []) for (const b of blocksOf(m)) push(`M:${m.role}:`, b);
  return { stream, marks };
}
/** Longest marked prefix of `a` that is also a prefix of `b` (how much turn b can read back). */
function reusable(a: { stream: string[]; marks: number[] }, b: { stream: string[] }): number {
  let best = -1;
  for (const mark of a.marks) {
    let same = true;
    for (let i = 0; i <= mark && same; i++) same = a.stream[i] === b.stream[i];
    if (same) best = Math.max(best, mark);
  }
  return best;
}

const a = await payloadFor(turn1, 1);
const b = await payloadFor(turn2, 2);

console.log("1. the adapter was reached");
check("turn 1 payload captured", !!a.raw?.messages?.length, JSON.stringify(Object.keys(a.raw ?? {})));
check("turn 2 payload captured", !!b.raw?.messages?.length);
if (!a.raw || !b.raw) { console.log("\ncannot continue"); process.exit(1); }

const rawA = flatten(a.raw), rawB = flatten(b.raw);
const historyEndA = rawA.stream.length - 2; // last block before the snapshot trailer
console.log("\n2. unpinned (pi-ai alone)");
check("pi-ai marks the snapshot trailer", rawA.marks.includes(rawA.stream.length - 1), `marks at ${rawA.marks.join(",")} of ${rawA.stream.length}`);
check("so turn 2 can read back nothing past the tool definitions", reusable(rawA, rawB) < historyEndA,
  `reusable up to block ${reusable(rawA, rawB)}, history ends at ${historyEndA}`);

console.log("\n3. pinned (src/cache-breakpoint.ts)");
check("turn 1 is pinned", !!a.pinned, "pinHistoryBreakpoint returned undefined");
check("turn 2 is pinned", !!b.pinned);
if (a.pinned && b.pinned) {
  const pinA = flatten(a.pinned), pinB = flatten(b.pinned);
  check("turn 2 can read back turn 1's whole history", reusable(pinA, pinB) === historyEndA,
    `reusable up to block ${reusable(pinA, pinB)}, history ends at ${historyEndA}`);
  check("what the model sees is unchanged", JSON.stringify(pinA.stream) === JSON.stringify(rawA.stream));
  check("the snapshot trailer is no longer a breakpoint (it was written every call and never read)",
    !pinA.marks.includes(pinA.stream.length - 1) && !pinB.marks.includes(pinB.stream.length - 1), `marks at ${pinA.marks.join(",")} of ${pinA.stream.length}`);
  check("the pin moves a marker, it does not add one", pinA.marks.length === rawA.marks.length, `${rawA.marks.length} → ${pinA.marks.length}`);
  check("at most 4 breakpoints (API limit)", pinA.marks.length <= 4 && pinB.marks.length <= 4, `${pinA.marks.length} / ${pinB.marks.length}`);
  check("the adapter's own payload object was not mutated", JSON.stringify(flatten(a.raw).marks) === JSON.stringify(rawA.marks));
}

console.log("\n4. left alone when it should be");
check("no snapshot trailer → untouched", pinHistoryBreakpoint({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "x" }] }, { role: "user", content: [{ type: "text", text: "next", cache_control: { type: "ephemeral" } }] }] }) === undefined);
check("caching off (no marker) → untouched", pinHistoryBreakpoint({ messages: [{ role: "user", content: "hi" }, { role: "user", content: "<research_snapshot>s</research_snapshot>" }] }) === undefined);
check("OpenAI-shaped payload → untouched", pinHistoryBreakpoint({ input: [{ role: "user", content: "x" }] }) === undefined);
{
  // OAuth requests already carry four breakpoints; a fifth is a 400.
  const cc = { type: "ephemeral" };
  const four = {
    system: [{ type: "text", text: "id", cache_control: cc }, { type: "text", text: "prompt", cache_control: cc }],
    tools: [{ name: "read", cache_control: cc }],
    messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] },
      { role: "user", content: [{ type: "text", text: "<research_snapshot>s</research_snapshot>", cache_control: cc }] }],
  };
  const out = pinHistoryBreakpoint(four);
  check("a request already at four breakpoints stays at four", !!out && flatten(out).marks.length === 4 && !!out.system[0].cache_control, out ? `${flatten(out).marks.length}` : "undefined");
  check("…and the history breakpoint is one of them", !!out?.messages?.[0]?.content?.[0]?.cache_control);
}

console.log("\n5. the brain's cache outlives its waits");
{
  // The brain waits on the agents it spawns; 15% of its steps in the ba run
  // came back after the 5-minute lifetime and rewrote the whole prefix.
  const long = await payloadFor(turn1, 1, { cacheRetention: "long" });
  const ttls = (p: any) => [...(p?.system ?? []), ...(p?.tools ?? []), ...(p?.messages ?? []).flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))]
    .map((b: any) => b?.cache_control).filter(Boolean).map((c: any) => c.ttl);
  check("cacheRetention 'long' reaches the adapter as ttl 1h", ttls(long.raw).length > 0 && ttls(long.raw).every((t) => t === "1h"), JSON.stringify(ttls(long.raw)));
  check("the moved history breakpoint keeps the 1h ttl", !!long.pinned && ttls(long.pinned).every((t) => t === "1h"), JSON.stringify(ttls(long.pinned)));
  check("the default is still the 5-minute cache", ttls(a.raw).every((t) => t === undefined), JSON.stringify(ttls(a.raw)));
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/agent.ts", import.meta.url), "utf-8");
  check("agent.ts: the brain's stream call asks for it", /streamWithRetry\(m, ctx, \{[^}]*cacheRetention: BRAIN_CACHE_RETENTION/.test(src));
  check("agent.ts: LUXAS_BRAIN_CACHE_RETENTION=short reverts", /LUXAS_BRAIN_CACHE_RETENTION === "short" \? "short" : "long"/.test(src));
  const sub = readFileSync(new URL("../src/subagent-runner.ts", import.meta.url), "utf-8");
  check("sub-agents stay on the 5-minute cache", /PI_CACHE_RETENTION \|\|= "short"/.test(sub) && !/cacheRetention/.test(sub));
}

console.log("\n6. the model the brain actually runs on (claude-opus-5-5)");
{
  // pi-ai shapes this model's request differently: empty role:"system" effort
  // markers are interleaved and one FOLLOWS the trailer. The pin used to
  // require the trailer to be the last message, so on 5.5 it returned
  // undefined and the Dy run re-wrote its whole history on every brain call —
  // while sections 1-5, on sonnet, were green.
  const o55: any = resolveModel("claude-opus-5-5", "brain");
  const oa = await payloadFor(turn1, 1, { reasoning: "medium" }, o55);
  const ob = await payloadFor(turn2, 2, { reasoning: "medium" }, o55);
  check("payloads captured", !!oa.raw?.messages?.length && !!ob.raw?.messages?.length);
  if (oa.raw && ob.raw) {
    const shape = oa.raw.messages.map((m: any) => m.role).join(",");
    console.log(`  (request roles: ${shape})`);
    check("turn 1 is pinned", !!oa.pinned, "pinHistoryBreakpoint returned undefined");
    check("turn 2 is pinned", !!ob.pinned);
    if (oa.pinned && ob.pinned) {
      const pa = flatten(oa.pinned), pb = flatten(ob.pinned), ra = flatten(oa.raw);
      const trailerAt = ra.stream.findIndex((x) => x.includes("<research_snapshot>"));
      check("turn 2 can read back turn 1's whole history", reusable(pa, pb) === trailerAt - 1, `reusable up to block ${reusable(pa, pb)}, history ends at ${trailerAt - 1}`);
      check("the trailer is not a breakpoint", !pa.marks.includes(trailerAt), `marks ${pa.marks.join(",")}, trailer ${trailerAt}`);
      check("what the model sees is unchanged", JSON.stringify(pa.stream) === JSON.stringify(ra.stream));
      check("at most 4 breakpoints", pa.marks.length <= 4);
    }
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
