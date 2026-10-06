#!/usr/bin/env tsx
/**
 * cache_replay — how much of each brain request could Anthropic read back from
 * the previous one? Offline and free: nothing is sent.
 *
 * Takes a REAL project (its checkpoint, notes, directives), restores the brain
 * on a copy exactly as `luxas run` would, and drives it for a few turns with
 * scripted tool calls. Each request is built by pi-ai's real adapter and by
 * the brain's real onPayload (cache-breakpoint.ts), captured, and stopped
 * before the network. Consecutive requests are then compared block by block:
 * the reusable part is the longest prefix that ends on one of the earlier
 * request's breakpoints and is byte-identical in the later one.
 *
 * cache_probe.mts answers the same question with the real API on a toy
 * project; this one answers it on the real context for nothing, and names the
 * first block that differs — which is what you need to fix a miss.
 *
 * --in-place works on the directory itself instead of a copy (the gate
 * smoke_resume_request uses it on a throwaway project: one pass to write a
 * checkpoint, a second to resume from it). --command sets the scripted bash
 * call. --json prints one machine-readable line for that reader.
 *
 *   npx tsx scripts/cache_replay.mts <project-dir> [--model claude-opus-5-5] [--turns 5] [--in-place] [--command CMD] [--json]
 */
import { cpSync, mkdtempSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamSimple } from "@earendil-works/pi-ai/compat";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const src = process.argv[2];
if (!src || !existsSync(join(src, "RESEARCH.md"))) { console.error("usage: cache_replay.mts <project-dir> [--model M] [--turns N]"); process.exit(2); }
const modelKey = arg("--model", "claude-opus-5-5");
const turns = Number(arg("--turns", "5"));

const inPlace = process.argv.includes("--in-place");
const asJson = process.argv.includes("--json");
const command = arg("--command", "");
const proj = inPlace ? src : mkdtempSync(join(tmpdir(), "luxas-cache-replay-"));
if (!inPlace) for (const p of ["RESEARCH.md", "notes", "reviews", "report", ".agent/checkpoint.jsonl", ".agent/run_config.json"])
  if (existsSync(join(src, p))) cpSync(join(src, p), join(proj, p), { recursive: true });

delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_BRAIN_MODEL;
const { createResearchAgent } = await import("../src/agent.js");
const { agent, restore } = createResearchAgent({ projectDir: proj, maxCostUsd: 1, model: modelKey, maxTurns: turns + 3 } as any) as any;

const captured: any[] = [];
let done = false;
let restoredCount = 0;
let n = 0;
(agent as any).streamFunction = async (m: any, ctx: any, opts: any) => {
  let payload: any;
  try {
    const s: any = await streamSimple(m, ctx, { ...opts, apiKey: "sk-ant-api03-offline-replay",
      onPayload: (p: any) => { payload = opts?.onPayload?.(p, m) ?? p; payload = structuredClone(payload); throw new Error("replay: stop before the network"); } } as any);
    await s.result?.();
  } catch { /* expected */ }
  if (payload) captured.push(payload);
  n++;
  if (process.env.REPLAY_DEBUG && payload) console.log(`call ${n}: system=${JSON.stringify(payload.system ?? null).length}ch tools=${(payload.tools ?? []).length} msgs=${payload.messages.length} ctxMsgs=${ctx.messages?.length} ctxRoles=${(ctx.messages ?? []).slice(0, 3).map((x: any) => x.role).join(",")} first=${JSON.stringify(payload.messages[0]).slice(0, 160)}`);
  // Each scripted turn appends a note, so the snapshot changes like a live run's does.
  const msg = n > turns
    ? { role: "assistant", content: [], stopReason: "error", errorMessage: "400 invalid_request: replay stop" }
    : { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: `toolu_replay_${n}`, name: "bash", arguments: { command: command || `echo "- replay step ${n}" >> notes/memory.md` } }] };
  const full = { ...msg, timestamp: Date.now(), api: m.api, provider: m.provider, model: m.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  return { async *[Symbol.asyncIterator]() { yield { type: full.stopReason === "error" ? "error" : "done" }; }, result: async () => full };
};

const guard = setTimeout(() => { console.log("replay timed out"); report(); process.exit(1); }, 120_000);
process.on("exit", () => report());
try {
  const restored = restore ? restore() : 0;
  restoredCount = restored;
  if (!asJson) console.log(`project ${inPlace ? "" : "copy "}${proj}\nmodel ${modelKey}, restored ${restored} checkpoint messages`);
  if (restored > 0) { await agent.followUp({ role: "user", content: "Continue your research from where you left off.", timestamp: Date.now() }); await agent.continue(); }
  else await agent.prompt("Research goal: replay");
} catch { /* the scripted error ends it */ }
clearTimeout(guard);
process.exit(0);

function flatten(p: any) {
  const stream: { key: string; chars: number; what: string }[] = [], marks: number[] = [];
  const push = (what: string, b: any) => {
    const { cache_control, ...rest } = b ?? {};
    const key = what.split("#")[0] + JSON.stringify(rest);
    stream.push({ key, chars: key.length, what });
    if (cache_control) marks.push(stream.length - 1);
  };
  (p.system ?? []).forEach((b: any, i: number) => push(`system#${i}`, b));
  (p.tools ?? []).forEach((b: any, i: number) => push(`tool#${b?.name ?? i}`, b));
  (p.messages ?? []).forEach((m: any, i: number) => {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    if (!blocks.length) push(`msg${i}:${m.role}:(empty)#`, { ...m });
    blocks.forEach((b: any, j: number) => push(`msg${i}:${m.role}:${b?.type}#${j}`, b));
  });
  return { stream, marks };
}

function report() {
  if (done) return; done = true;
  const flat = captured.map(flatten);
  const rows = flat.map((f, i) => {
    const total = f.stream.reduce((a, b) => a + b.chars, 0);
    const p = captured[i];
    const base = { call: i + 1, total, systemChars: JSON.stringify(p.system ?? "").length, tools: (p.tools ?? []).length,
      condensed: JSON.stringify(p.messages?.[0] ?? "").includes("<carryforward_note>"),
      breakpoints: f.marks.map((k) => f.stream[k].what.split("#")[0]) };
    if (i === 0) return { ...base, reusable: null as number | null, firstDiff: null as string | null };
    const prev = flat[i - 1];
    let same = 0;
    while (same < prev.stream.length && same < f.stream.length && prev.stream[same].key === f.stream[same].key) same++;
    const usable = Math.max(-1, ...prev.marks.filter((k) => k < same));
    const reusable = f.stream.slice(0, usable + 1).reduce((a, b) => a + b.chars, 0);
    return { ...base, reusable, firstDiff: same < f.stream.length ? `${f.stream[same].what} (block ${same} of ${f.stream.length})` : "none" };
  });
  const later = rows.slice(1);
  const hitRate = later.length ? later.reduce((a, r) => a + (r.reusable ?? 0), 0) / later.reduce((a, r) => a + r.total, 0) : null;
  if (asJson) { console.log("REPLAY_JSON " + JSON.stringify({ restored: restoredCount, hitRate, rows })); return; }
  if (rows.length < 2) { console.log(`only ${rows.length} request(s) captured — nothing to compare`); return; }
  console.log("\ncall  total_k  reusable_k  hit    breakpoints                first block that differs from the previous call");
  for (const r of rows) {
    const where = r.breakpoints.join(" ");
    if (r.reusable === null) { console.log(`${String(r.call).padEnd(5)} ${(r.total / 1000).toFixed(1).padEnd(8)} ${"—".padEnd(11)} ${"—".padEnd(6)} ${where}`); continue; }
    console.log(`${String(r.call).padEnd(5)} ${(r.total / 1000).toFixed(1).padEnd(8)} ${(r.reusable / 1000).toFixed(1).padEnd(11)} ${(100 * r.reusable / r.total).toFixed(0).padStart(3)}%   ${where.padEnd(26)} ${r.firstDiff}${r.condensed ? "  [condensed]" : ""}${r.tools === 0 ? "  [NO TOOLS SENT]" : ""}`);
  }
  console.log(`\nreadable from cache after the first call: ${(100 * hitRate!).toFixed(1)}% of request characters (a proxy for tokens)`);
}
