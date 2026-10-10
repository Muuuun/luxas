#!/usr/bin/env tsx
/**
 * smoke_brain_request — the request the ASSEMBLED brain sends, and the tool
 * calls it receives back, checked end to end through the real agent loop.
 *
 * Every other gate tests a part. This one builds the brain with
 * createResearchAgent, swaps only the network call for a scripted stream, and
 * looks at what would have gone to the provider.
 *
 * What it pins (all three shipped broken with every other gate green):
 *   1. the provider sees the system prompt and the tool declarations. pi 0.87
 *      moved both into a leading role:"system" transcript message, and the
 *      brain's convertToLlm dropped every role it did not list — the brain went
 *      out with 0 chars of prompt and 0 tools.
 *   2. brain tools receive their arguments. The loop calls
 *      execute(toolCallId, args, …); finish/idle declared execute(args), so
 *      `decline` and `timeout_ms` were read off the call id and never applied.
 *   3. an unknown model key is an error, not a silent reroute to sonnet.
 *
 * And (C48) that the brain's policy code keys only on tools the brain has:
 * rate limits, reminder flags and prune rules for run_experiment /
 * dispatch_workers / search_papers outlived those tools, and read as live
 * policy while they could never fire.
 *
 * And (C2) that a continued sub-agent sends its prompt: pi 0.87 keeps the
 * prompt in the leading role:"system" message, and restoring the transcript
 * over it sent every revision of tool_impl / tool_review with 0 chars.
 *
 * And (C26) that idle never waits out the brain's 1-hour cache: a wake more
 * than ~60 min after the previous request rewrites the whole context.
 *
 *   npx tsx scripts/smoke_brain_request.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// pi-ai does not export this subpath; reach it by file, like smoke_agent_loop_patches does for the loop.
const piAiRoot = fileURLToPath(new URL("../node_modules/@earendil-works/pi-ai", import.meta.url));
const { getCurrentSystemPrompt, getCurrentTools } = await import(`${piAiRoot}/dist/utils/transcript.js`);

const proj = mkdtempSync(join(tmpdir(), "luxas-brain-request-"));
mkdirSync(join(proj, "notes"), { recursive: true });
writeFileSync(join(proj, "RESEARCH.md"), "# gate\nA throwaway goal for an offline wiring gate.\n");
writeFileSync(join(proj, "notes", "memory.md"), "");

// Never let a real key or a real profile leak into an offline gate.
delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_BRAIN_MODEL;
// agent.ts reads this at import; §C26 expects the default 1-hour brain cache.
delete process.env.LUXAS_BRAIN_CACHE_RETENTION;

const { createResearchAgent } = await import("../src/agent.js");
const { resolveModel } = await import("../src/agents/spawn.js");

const { agent } = createResearchAgent({ projectDir: proj, maxCostUsd: 1 } as any);

// Scripted provider: turn 1 calls finish(decline=…) and idle(timeout_ms=…),
// turn 2 ends the loop with a non-transient error.
const seen: any[] = [];
let calls = 0;
const turn1 = {
  role: "assistant",
  stopReason: "toolUse",
  timestamp: Date.now(),
  content: [
    { type: "toolCall", id: "call_idle", name: "idle", arguments: { timeout_ms: 1 } },
    { type: "toolCall", id: "call_finish", name: "finish",
      arguments: { summary: "gate", decline: [{ leadId: "LEAD-GATE-1", reason: "offline gate" }] } },
  ],
};
const stop = { role: "assistant", content: [], stopReason: "error", errorMessage: "400 invalid_request: gate stop", timestamp: Date.now() };
(agent as any).streamFunction = async (_model: any, context: any) => {
  seen.push(context);
  const msg = calls++ === 0 ? turn1 : stop;
  return {
    async *[Symbol.asyncIterator]() { yield { type: msg.stopReason === "error" ? "error" : "done" }; },
    result: async () => msg,
  };
};

const guard = setTimeout(() => { console.log("  ✗ loop did not end within 60 s"); process.exit(1); }, 60_000);
try { await (agent as any).prompt("Research goal: gate"); } catch { /* the scripted error ends the run */ }
clearTimeout(guard);

console.log("1. what the provider is sent");
check("the loop reached the provider", seen.length >= 1, `streamFn called ${seen.length}x`);
const first = seen[0]?.messages ?? [];
const sys: string = getCurrentSystemPrompt(first) ?? "";
const toolNames: string[] = (getCurrentTools(first) ?? []).map((t: any) => t.name);
check("system prompt reaches the provider", sys.length > 1000, `${sys.length} chars`);
check("it is the brain's prompt, not a stub", sys.length === (agent.state.systemPrompt ?? "").length,
  `sent ${sys.length}, agent holds ${(agent.state.systemPrompt ?? "").length}`);
check("every brain tool is declared", toolNames.length === agent.state.tools.length && toolNames.length > 0,
  `sent ${toolNames.length}, agent holds ${agent.state.tools.length}`);
for (const name of ["finish", "idle", "spawn_agent", "read", "edit", "bash"]) {
  check(`tool declared: ${name}`, toolNames.includes(name), `declared: ${toolNames.join(", ")}`);
}

console.log("\n2. tool calls arrive with their arguments");
check("the loop came back for a second turn after the tool calls", seen.length >= 2, `streamFn called ${seen.length}x`);
const memory = readFileSync(join(proj, "notes", "memory.md"), "utf-8");
check("finish(decline=[…]) is applied (FRONTIER-DECLINE written)",
  memory.includes("FRONTIER-DECLINE: LEAD-GATE-1"), JSON.stringify(memory.slice(0, 200)));
const results = (seen[1]?.messages ?? []).filter((m: any) => m.role === "toolResult");
check("both tool calls produced a result", results.length === 2, `${results.length} toolResult message(s)`);
// idle returns at once when nothing is running, so the loop's call above cannot
// show timeout_ms being read; pin the signature here and the behavior in §C26.
// (finish is covered by behavior above.)
const idleTool: any = agent.state.tools.find((t: any) => t.name === "idle");
check("idle.execute takes (toolCallId, args)", idleTool?.execute?.length === 2, `arity ${idleTool?.execute?.length}`);

console.log("\n  §C26 idle never waits a whole brain cache lifetime");
const toolsMod: any = await import("../src/tools/index.js");
check("tools/index.ts exports idleTimeoutMs", typeof toolsMod.idleTimeoutMs === "function", typeof toolsMod.idleTimeoutMs);
const idleTimeoutMs: (req: unknown, ret: "short" | "long") => number =
  typeof toolsMod.idleTimeoutMs === "function" ? toolsMod.idleTimeoutMs : () => NaN;
for (const [req, ret, want] of [
  [3_600_000, "long", 3_000_000], [7_200_000, "long", 3_000_000], [undefined, "long", 600_000],
  [2_000_000, "long", 2_000_000], [3_600_000, "short", 3_600_000], ["abc", "long", 600_000],
] as const) {
  const got = idleTimeoutMs(req, ret);
  check(`idleTimeoutMs(${JSON.stringify(req)}, "${ret}") = ${want}`, got === want, `got ${got}`);
}
// With the env unset both retentions build the same idle, so pin the wiring by source.
const buildCall = readFileSync(fileURLToPath(new URL("../src/agent.ts", import.meta.url)), "utf-8")
  .match(/buildResearchTools\(([\s\S]*?)\n\s*\);/)?.[1] ?? "";
check("agent.ts hands the brain's retention to buildResearchTools", /\bBRAIN_CACHE_RETENTION\b/.test(buildCall),
  buildCall ? buildCall.trim().slice(-120) : "call not found");

// One agent that stays running for the whole wait: startedAt in the future, so
// the zombie sweep (now - startedAt > 90 s) never fires. A virtual clock turns
// the poll loop's hour into milliseconds.
mkdirSync(join(proj, ".agent"), { recursive: true });
const registry = join(proj, ".agent", "active-agents.json");
writeFileSync(registry, JSON.stringify([
  { id: "brain.experiment-gate", name: "experiment", task: "gate", mode: "background", status: "running", startedAt: 8.64e15, conversationFile: "" },
]));
async function idleFor(args: Record<string, unknown>): Promise<{ waited: number; text: string }> {
  const realNow = Date.now, realSetTimeout = globalThis.setTimeout;
  let v = 1_000_000;
  Date.now = () => v;
  (globalThis as any).setTimeout = (fn: any, ms = 0) => { v += ms; return realSetTimeout(fn, 0); };
  try {
    const r = await idleTool.execute("call_idle_c26", args);
    return { waited: v - 1_000_000, text: String(r?.content?.[0]?.text ?? "") };
  } finally { Date.now = realNow; (globalThis as any).setTimeout = realSetTimeout; }
}
const capped = await idleFor({ timeout_ms: 3_600_000 });
check("idle(timeout_ms=3_600_000) wakes inside the cache (<= 3,002,500 virtual ms)", capped.waited <= 3_002_500,
  `waited ${capped.waited} ms`);
check("…and tells the brain to call idle again", capped.text.includes("call idle again"), capped.text.slice(0, 200));
const short = await idleFor({ timeout_ms: 2_000 });
check("a request under the cap is honoured and does not mention it",
  short.waited <= 2_500 && !short.text.includes("call idle again"), `waited ${short.waited} ms: ${short.text.slice(0, 200)}`);
rmSync(registry, { force: true });

console.log("\n3. unknown model key");
let threw = "";
try { resolveModel("no-such-model-xyz", "brain"); } catch (e: any) { threw = String(e?.message ?? e); }
check("resolveModel throws instead of falling back to sonnet", threw.includes("no-such-model-xyz"), threw.slice(0, 120) || "returned a model");
process.env.LUXAS_BRAIN_MODEL = "typo-model";
threw = "";
try { resolveModel("sonnet", "brain"); } catch (e: any) { threw = String(e?.message ?? e); }
delete process.env.LUXAS_BRAIN_MODEL;
check("a mistyped LUXAS_BRAIN_MODEL is an error", threw.includes("typo-model"), threw.slice(0, 120) || "returned a model");

console.log("\n4. §C48 every tool name the brain's policy keys on is a brain tool");
const brainTools = new Set<string>(agent.state.tools.map((t: any) => t.name));
const srcText = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf-8");
const hooksSrc = srcText("hooks.ts");
const keyed = new Set<string>();
for (const m of hooksSrc.matchAll(/\b(?:toolName|name)\s*[!=]==\s*"([a-z_]+)"/g)) keyed.add(m[1]);
const rateTable = hooksSrc.match(/rateLimits[^=]*=\s*\{([^}]*)\}/);
if (rateTable) for (const m of rateTable[1].matchAll(/^\s*([a-z_]+)\s*:/gm)) keyed.add(m[1]);
const { FINALIZATION_TOOLS } = await import("../src/hooks.js");
for (const n of FINALIZATION_TOOLS) keyed.add(n);
// An empty scan would pass every check below; make regex rot visible.
check("the hooks.ts scan found tool names", keyed.size >= 5, `${keyed.size} found`);
for (const n of [...keyed].sort()) check(`hooks.ts keys on a brain tool: ${n}`, brainTools.has(n));
const { COMPACTABLE_TOOLS } = (await import("../src/context.js")) as any;
check("context.ts exports COMPACTABLE_TOOLS", COMPACTABLE_TOOLS instanceof Set);
for (const n of [...(COMPACTABLE_TOOLS ?? [])].sort()) {
  check(`COMPACTABLE_TOOLS entry is a brain tool: ${n}`, brainTools.has(n));
}
// A provider whose flag nobody sets is a reminder that can never show.
const setters = new Set([...hooksSrc.matchAll(/setFlag\("([a-z_]+)"/g)].map((m) => m[1]));
const flagsRead = new Set([...srcText("reminders.ts").matchAll(/flags\.get\("([a-z_]+)"\)/g)].map((m) => m[1]));
check("the reminders.ts scan found flags", flagsRead.size > 0, `${flagsRead.size} found`);
for (const f of [...flagsRead].sort()) check(`reminder flag ${f} has a setter in hooks.ts`, setters.has(f));

console.log("\n5. §C2 a continued sub-agent (spawn_agent action=\"continue\") still sends its prompt");
// spawnAgent builds its own Agent, so the streamFunction swap above cannot
// reach it. Replace every pi-ai API provider with a scripted one instead; the
// real adapters, keys and network are never touched.
for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET/i.test(k)) delete process.env[k];
delete process.env.LUXAS_EXPERIMENT_MODE;
(globalThis as any).fetch = async () => { throw new Error("gate: network blocked"); };
const { getApiProviders, registerApiProvider } = await import("@earendil-works/pi-ai/compat");
const subSent: any[][] = [];
const scripted = (model: any, ctx: any) => {
  subSent.push(ctx.messages);
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }], api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, result: async () => msg };
};
for (const p of getApiProviders()) registerApiProvider({ api: p.api, stream: scripted, streamSimple: scripted } as any, "gate-continue");

const cproj = mkdtempSync(join(tmpdir(), "luxas-continue-gate-"));
for (const d of ["notes", "data/experiments/E1_gate/scripts", "data/experiments/E1_gate/tests"]) mkdirSync(join(cproj, d), { recursive: true });
writeFileSync(join(cproj, "RESEARCH.md"), "# gate\nA throwaway goal for an offline wiring gate.\n");
const { createSpawnAgentTool } = await import("../src/tools/spawn-agent.js");
const spawnTool: any = createSpawnAgentTool(cproj, { PROJECT_DIR: cproj }, () => "offline", "brain.experiment-gate", 1, undefined, ["tool_impl"]);
// "pymatching" selects a methods sheet, which only the spawn task can select.
const r1 = await spawnTool.execute("c1", { agent: "tool_impl", task: "Implement tool foo: decode with pymatching.", templateVars: { EXPERIMENT_ID: "E1_gate", TOOL_NAME: "foo" } });
const subId = r1.details?.agentId;
const fresh = subSent.at(-1) ?? [];
const freshSys: string = getCurrentSystemPrompt(fresh) ?? "";
const freshTools = (getCurrentTools(fresh) ?? []).map((t: any) => t.name).sort().join(",");
check("the fresh spawn sends the tool_impl prompt (else this proves nothing)", freshSys.length > 1000, `${freshSys.length} chars`);
// The tag alone is not evidence: tool_impl.md names <methods_registry> in its own text.
const sheet = "--- qec-circuits.md ---";
check("…with the sheet the task selects in it", freshSys.includes(sheet));

// A continue that bails before the provider leaves the fresh request last in
// subSent, and every check below would compare the fresh prompt with itself.
const nBefore2 = subSent.length;
const r2 = await spawnTool.execute("c2", { action: "continue", id: subId, task: "Tests failed:\nE assert foo(1) == 2" });
check("the continue reached the provider (else this proves nothing)", subSent.length > nBefore2 && r2.details?.revisionNumber === 1,
  `${subSent.length - nBefore2} request(s), revision ${r2.details?.revisionNumber}: ${String(r2.content?.[0]?.text).slice(0, 120)}`);
const cont = subSent[nBefore2] ?? [];
const contSys: string = getCurrentSystemPrompt(cont) ?? "";
check("the continued call sends the system prompt", contSys.length > 1000, `${contSys.length} chars`);
check("…and it is the tool_impl prompt", contSys.slice(0, 400) === freshSys.slice(0, 400));
check("…byte-identical to the fresh spawn prompt (methods sheet included)", contSys === freshSys,
  `fresh ${freshSys.length} vs continued ${contSys.length}; continued has the sheet=${contSys.includes(sheet)}`);
check("the system message leads the continued request", cont[0]?.role === "system", `first role ${cont[0]?.role}`);
check("the continued call declares the same tools", (getCurrentTools(cont) ?? []).map((t: any) => t.name).sort().join(",") === freshTools);
const convPath = join(cproj, ".agent", "conversations", `${subId}.jsonl`);
const sysLines = readFileSync(convPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e: any) => e.role === "system");
check("the transcript gains no role:\"system\" line", sysLines.length === 0, `${sysLines.length} system line(s)`);

// Every transcript continued before the fix holds this shape after continue_init
// (all 5 in the Dy run): an empty system message re-declaring the tools.
appendFileSync(convPath, JSON.stringify({ type: "continue_init", newTask: "legacy", timestamp: 1 }) + "\n"
  + JSON.stringify({ role: "system", content: "", toolsAdded: [{ name: "read", description: "x", parameters: { type: "object" } }], timestamp: 2 }) + "\n"
  + JSON.stringify({ role: "user", content: "legacy", timestamp: 3 }) + "\n"
  + JSON.stringify({ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", api: "x", provider: "x", model: "x", timestamp: 4 }) + "\n");
const nBefore3 = subSent.length;
const r3 = await spawnTool.execute("c3", { action: "continue", id: subId, task: "Tests failed again." });
// Two continue_init markers precede it: c2's and the legacy one.
check("the legacy continue reached the provider (else this proves nothing)", subSent.length > nBefore3 && r3.details?.revisionNumber === 3,
  `${subSent.length - nBefore3} request(s), revision ${r3.details?.revisionNumber}: ${String(r3.content?.[0]?.text).slice(0, 120)}`);
const legacy = subSent[nBefore3] ?? [];
const legacySys: string = getCurrentSystemPrompt(legacy) ?? "";
check("a legacy transcript (empty system message inside) still sends the prompt", legacySys.length > 1000, `${legacySys.length} chars`);
check("…in exactly one system message", legacy.filter((m: any) => m.role === "system").length === 1,
  `${legacy.filter((m: any) => m.role === "system").length}`);

// The marker keeps only the task's first 2000 characters. A task that names its
// method late must still rebuild the same prompt on continue.
const lateTask = "Implement tool bar. " + "Keep the interface small and the output a flat JSON object. ".repeat(40) + "Decode with pymatching.";
const rl = await spawnTool.execute("c4", { agent: "tool_impl", task: lateTask, templateVars: { EXPERIMENT_ID: "E1_gate", TOOL_NAME: "bar" } });
const lateFreshSys: string = getCurrentSystemPrompt(subSent.at(-1) ?? []) ?? "";
check("a task naming its method after character 2000 gets the sheet (else this proves nothing)",
  lateTask.indexOf("pymatching") > 2000 && lateFreshSys.includes(sheet), `keyword at ${lateTask.indexOf("pymatching")}`);
const nBefore5 = subSent.length;
await spawnTool.execute("c5", { action: "continue", id: rl.details?.agentId, task: "Tests failed:\nE assert bar(1) == 2" });
const lateContSys: string = getCurrentSystemPrompt(subSent[nBefore5] ?? []) ?? "";
check("…and its continue rebuilds the same prompt, sheet included", subSent.length > nBefore5 && lateContSys === lateFreshSys,
  `fresh ${lateFreshSys.length} vs continued ${lateContSys.length}; continued has the sheet=${lateContSys.includes(sheet)}`);
rmSync(cproj, { recursive: true, force: true });

rmSync(proj, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
