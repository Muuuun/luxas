/**
 * smoke_length_recovery — Phase 2 B-level outer retry controller.
 *
 *   npx tsx scripts/smoke_length_recovery.mts
 *
 * Scenarios:
 *   1. length → length → stop     (recovers on attempt 2)
 *   2. length × 4                  (exhausts MAX_ATTEMPTS, final exit still length)
 *   3. stop on first attempt       (controller untouched, recoveryAttemptsUsed undefined)
 *
 * Also verifies:
 *   - Large cap is set on the first recovery attempt, default on subsequent.
 *   - Resume marker with isMeta=true is injected via replaceMessages before
 *     each continue().
 *   - SubAgentExit.recoveryAttemptsUsed is populated by the collector when
 *     recovery is attached and attemptsUsed > 0.
 *
 * Uses a stateful mock streamFn — no API call. Relies on the pi-agent-core
 * behavior empirically confirmed by scripts/spike_pi_agent_core_length.mts:
 *   - prompt() resolves cleanly on stopReason=length
 *   - partial assistant is in state.messages after resolve
 *   - continue() runs the loop from current state if last msg is user
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";

import {
  createSubAgentExitCollector,
  createLengthRecoveryController,
  runWithLengthRecovery,
  LENGTH_RECOVERY_LARGE_CAP,
  LENGTH_RECOVERY_MAX_ATTEMPTS,
  LENGTH_RECOVERY_CONTINUE_PROMPT,
} from "../src/agents/spawn.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const fakeModel = { provider: "anthropic", id: "mock", api: "anthropic" } as unknown as Model<any>;

/**
 * Build a mock streamFn that emits a scripted sequence of terminal reasons
 * on successive invocations. Also records the maxTokens observed on each
 * call so the assertion side can see whether recovery bumped the cap.
 */
function makeMockStreamFn(reasons: ("length" | "stop")[]) {
  const maxTokensObserved: (number | undefined)[] = [];
  let callIdx = 0;

  const streamFn = (_m: any, _ctx: any, opts: any) => {
    maxTokensObserved.push(opts?.maxTokens);
    const reason = reasons[callIdx] ?? "stop";
    callIdx += 1;

    const stream = createAssistantMessageEventStream();
    const text = reason === "length"
      ? `draft segment ${callIdx} (would continue past this but max_tokens cut it)`
      : `final segment ${callIdx} — done.`;
    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason: reason,
    } as any;

    queueMicrotask(() => {
      const partial: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "" }] } as any;
      stream.push({ type: "start", partial });
      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
      stream.push({ type: "done", reason: reason as any, message: finalMessage });
      stream.end(finalMessage);
    });

    return stream;
  };

  return { streamFn, maxTokensObserved, callIdx: () => callIdx };
}

function buildAgent(streamFn: any) {
  return new Agent({
    initialState: { systemPrompt: "test", model: fakeModel, thinkingLevel: "off" as any, tools: [] },
    getApiKey: () => undefined,
    streamFn,
  });
}

// ── 1. Recovers on attempt 2: length → length → stop ──────────────────────

console.log("1. length → length → stop (recovers)");

{
  const { streamFn, maxTokensObserved } = makeMockStreamFn(["length", "length", "stop"]);
  const recovery = createLengthRecoveryController();
  // Re-implement the streamFn with recovery-aware cap (mimicking what
  // buildAgentFromDefinition's streamFn does in production):
  const capAwareStream = (m: any, ctx: any, o: any) => {
    const cap = recovery.state.maxTokensCap;
    const merged: any = { ...o, toolChoice: "any" };
    if (cap !== undefined) merged.maxTokens = cap;
    return streamFn(m, ctx, merged);
  };
  const agent = buildAgent(capAwareStream);
  const collector = createSubAgentExitCollector(Date.now());
  collector.attach(agent, null as any);
  collector.attachRecovery(recovery);

  await runWithLengthRecovery(agent, "write a module", recovery);

  const exit = collector.finalize();
  check("final stopReason is stop", exit.stopReason === "stop", `got ${exit.stopReason}`);
  check("recoveryAttemptsUsed = 2", exit.recoveryAttemptsUsed === 2, `got ${exit.recoveryAttemptsUsed}`);

  // Cap trace: attempt 0 = undefined, attempt 1 = LARGE_CAP, attempt 2 = undefined
  check("cap trace: [undef, LARGE, undef]",
    maxTokensObserved[0] === undefined
      && maxTokensObserved[1] === LENGTH_RECOVERY_LARGE_CAP
      && maxTokensObserved[2] === undefined,
    `got [${maxTokensObserved.join(", ")}]`);

  // History shape: [user task, assistant length, user marker, assistant length, user marker, assistant stop]
  const msgs = agent.state.messages as any[];
  const userMessages = msgs.filter((m) => m.role === "user");
  const markerMessages = userMessages.filter((m) => m.isMeta === true);
  check("two isMeta resume markers present", markerMessages.length === 2, `got ${markerMessages.length}`);
  check("marker content matches LENGTH_RECOVERY_CONTINUE_PROMPT",
    markerMessages.every((m) => m.content === LENGTH_RECOVERY_CONTINUE_PROMPT));
}

// ── 2. Exhausts MAX_ATTEMPTS: length repeatedly ───────────────────────────

console.log("\n2. length × 4 (exhausts max attempts)");

{
  const reasons = Array(10).fill("length");
  const { streamFn, maxTokensObserved } = makeMockStreamFn(reasons as any);
  const recovery = createLengthRecoveryController();
  const capAwareStream = (m: any, ctx: any, o: any) => {
    const cap = recovery.state.maxTokensCap;
    const merged: any = { ...o, toolChoice: "any" };
    if (cap !== undefined) merged.maxTokens = cap;
    return streamFn(m, ctx, merged);
  };
  const agent = buildAgent(capAwareStream);
  const collector = createSubAgentExitCollector(Date.now());
  collector.attach(agent, null as any);
  collector.attachRecovery(recovery);

  await runWithLengthRecovery(agent, "long task", recovery);
  const exit = collector.finalize();

  check("final stopReason still length after exhaustion", exit.stopReason === "length");
  check(`recoveryAttemptsUsed capped at ${LENGTH_RECOVERY_MAX_ATTEMPTS}`,
    exit.recoveryAttemptsUsed === LENGTH_RECOVERY_MAX_ATTEMPTS,
    `got ${exit.recoveryAttemptsUsed}`);
  check(`stream invoked exactly ${LENGTH_RECOVERY_MAX_ATTEMPTS + 1}× (1 initial + ${LENGTH_RECOVERY_MAX_ATTEMPTS} recoveries)`,
    maxTokensObserved.length === LENGTH_RECOVERY_MAX_ATTEMPTS + 1,
    `got ${maxTokensObserved.length}`);

  // First recovery LARGE, subsequent default — even though all still fail.
  check("first recovery used LARGE_CAP",
    maxTokensObserved[1] === LENGTH_RECOVERY_LARGE_CAP,
    `got ${maxTokensObserved[1]}`);
  check("subsequent recoveries fell back to default (undefined)",
    maxTokensObserved.slice(2).every((c) => c === undefined),
    `got [${maxTokensObserved.slice(2).join(", ")}]`);

  // partialAssistantText populated because final stopReason is length.
  check("partialAssistantText populated on exhausted length exit",
    typeof exit.partialAssistantText === "string" && exit.partialAssistantText.length > 0,
    `got ${JSON.stringify(exit.partialAssistantText)?.slice(0, 60)}`);
}

// ── 3. No length: clean path untouched ────────────────────────────────────

console.log("\n3. stop on first attempt (recovery untouched)");

{
  const { streamFn, maxTokensObserved } = makeMockStreamFn(["stop"]);
  const recovery = createLengthRecoveryController();
  const capAwareStream = (m: any, ctx: any, o: any) => {
    const cap = recovery.state.maxTokensCap;
    const merged: any = { ...o, toolChoice: "any" };
    if (cap !== undefined) merged.maxTokens = cap;
    return streamFn(m, ctx, merged);
  };
  const agent = buildAgent(capAwareStream);
  const collector = createSubAgentExitCollector(Date.now());
  collector.attach(agent, null as any);
  collector.attachRecovery(recovery);

  await runWithLengthRecovery(agent, "small task", recovery);
  const exit = collector.finalize();

  check("stopReason is stop", exit.stopReason === "stop");
  check("recoveryAttemptsUsed omitted (no recovery ran)",
    exit.recoveryAttemptsUsed === undefined,
    `got ${exit.recoveryAttemptsUsed}`);
  check("triedLargeCap is false", recovery.state.triedLargeCap === false);
  check("stream invoked exactly once", maxTokensObserved.length === 1);
  check("no maxTokens cap passed (provider default)",
    maxTokensObserved[0] === undefined,
    `got ${maxTokensObserved[0]}`);

  const msgs = agent.state.messages as any[];
  const markerMessages = msgs.filter((m) => m.role === "user" && m.isMeta === true);
  check("no isMeta markers injected", markerMessages.length === 0);
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
