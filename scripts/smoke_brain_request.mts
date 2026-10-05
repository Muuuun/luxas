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
 *   npx tsx scripts/smoke_brain_request.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
// idle returns at once when nothing is running, so timeout_ms has no offline
// behavior to observe; pin the signature the loop calls it with instead.
// (finish is covered by behavior above.)
const idleTool: any = agent.state.tools.find((t: any) => t.name === "idle");
check("idle.execute takes (toolCallId, args)", idleTool?.execute?.length === 2, `arity ${idleTool?.execute?.length}`);

console.log("\n3. unknown model key");
let threw = "";
try { resolveModel("no-such-model-xyz", "brain"); } catch (e: any) { threw = String(e?.message ?? e); }
check("resolveModel throws instead of falling back to sonnet", threw.includes("no-such-model-xyz"), threw.slice(0, 120) || "returned a model");
process.env.LUXAS_BRAIN_MODEL = "typo-model";
threw = "";
try { resolveModel("sonnet", "brain"); } catch (e: any) { threw = String(e?.message ?? e); }
delete process.env.LUXAS_BRAIN_MODEL;
check("a mistyped LUXAS_BRAIN_MODEL is an error", threw.includes("typo-model"), threw.slice(0, 120) || "returned a model");

rmSync(proj, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
