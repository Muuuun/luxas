#!/usr/bin/env tsx
/**
 * smoke_edit_noop_guard — the brain's `edit` must reach disk, and the no-op
 * guard must fire only on a real no-op.
 *
 * Two bugs live here, one after the other:
 *
 *   Bug E (BOM investigation): brain called edit with oldText === newText and
 *   got the misleading "oldText not found". The no-op guard was added to name
 *   the slip directly.
 *
 *   The guard's own regression (measured 2026-09-22 over the 08-25..09-20
 *   runs): it read only the LEGACY top-level oldText/newText, while
 *   pi-coding-agent's canonical shape is `edits: [{oldText,newText}, …]`.
 *   Every canonical call arrived as "" === "" and was blocked with a message
 *   insisting the tool was fine and "Do NOT record this as a tool bug".
 *   yttrium-magic-wavelengths-20260906 died on exactly that (four identical
 *   blocked \bibliography edits → operator escalation, report.tex unchanged
 *   at line 108); pp-vs-ss-gate-packing-20260826 recorded "the `edit` tool has
 *   been broken all session" in two escalation notes.
 *
 * Case 5 is the one that would have caught it: drive the REAL edit tool
 * end-to-end and assert the bytes on disk changed. A guard that only inspects
 * block messages cannot tell "correctly refused" from "silently swallowed".
 *
 * Case 7 (C1) is the half case 1 cannot see: pi-agent-core turns every
 * resolved execute into isError:false, so the wrapper's isError reached
 * nothing — log.jsonl, the transcript and the provider all saw a success.
 * It runs the installed agent loop (brain, a spawn.ts sub-agent, and the
 * monitor) and asserts the block arrives as a failure everywhere.
 *
 *   npx tsx scripts/smoke_edit_noop_guard.mts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { getDefinition } from "../src/agents/registry.js";
import { buildAgentFromDefinition } from "../src/agents/spawn.js";
import { buildResearchHooks } from "../src/hooks.js";
import { createCodingToolsForProject } from "../src/tools/coding.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

const tmp = mkdtempSync(join(tmpdir(), "luxas-edit-noop-"));
try {
  writeFileSync(join(tmp, "memory.md"), "# Memory\n");

  // Stub edit tool — captures whether the underlying execute was called.
  let underlyingCalled = false;
  const stubEdit = {
    name: "edit",
    label: "edit",
    description: "stub",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      underlyingCalled = true;
      return { content: [{ type: "text", text: "ok" }] };
    },
  };

  // Allow writes anywhere under tmp so the no-op guard is the gate that fires.
  const wrap = buildSafetyWrapper({
    protectedFiles: [],
    allowedWriteRoots: [tmp],
  });
  if (!wrap) throw new Error("buildSafetyWrapper returned undefined");

  const [wrapped] = wrap([stubEdit], tmp, {}, undefined);
  const textOf = (r: any) => r?.content?.[0]?.text ?? "";

  console.log("1. oldText === newText is rejected before underlying execute");
  underlyingCalled = false;
  const res1: any = await wrapped.execute("call-1", {
    path: "memory.md",
    oldText: "Note: PDF was broken, keeping PNG.",
    newText: "Note: PDF was broken, keeping PNG.",
  });
  const text1 = textOf(res1);
  check("returned an error result", /No-op edit|oldText === newText/i.test(text1),
    `text="${text1.slice(0, 120)}"`);
  check("did NOT call underlying execute", underlyingCalled === false);
  check("error mentions appending guidance", /append|anchor|read the file/i.test(text1),
    `text="${text1.slice(0, 120)}"`);
  check("wrapper return carries isError:true (the flag surfaceReturnedIsError reads; §7 checks it reaches the loop and the log)",
    res1?.isError === true, `isError=${res1?.isError}`);

  console.log("\n2. oldText !== newText still goes through (path-not-cached path)");
  underlyingCalled = false;
  const res2: any = await wrapped.execute("call-2", {
    path: "memory.md",
    oldText: "# Memory",
    newText: "# Memory\n\nNote: appended.",
  });
  // Should hit the read-before-edit gate (since we never read), NOT the no-op.
  const text2 = textOf(res2);
  check("no-op guard did NOT fire on differing text",
    !/No-op edit/i.test(text2),
    `text="${text2.slice(0, 120)}"`);
  check("hit a different gate (read-before-edit)",
    /must read|read the file|read tool/i.test(text2),
    `text="${text2.slice(0, 120)}"`);

  console.log("\n3. empty oldText === empty newText also rejected");
  underlyingCalled = false;
  const res3: any = await wrapped.execute("call-3", {
    path: "memory.md",
    oldText: "",
    newText: "",
  });
  check("empty no-op also rejected", /No-op edit/i.test(textOf(res3)),
    `text="${textOf(res3).slice(0, 120)}"`);

  console.log("\n4. canonical edits[] shape is NOT mistaken for a no-op (y-magic repro)");
  underlyingCalled = false;
  const res4: any = await wrapped.execute("call-4", {
    path: "report.tex",
    edits: [{
      oldText: "\\bibliography{references}",
      newText: "{\\footnotesize\\bibliography{references}}",
    }],
  });
  const text4 = textOf(res4);
  check("no-op guard did NOT fire on an edits[] call",
    !/No-op edit/i.test(text4),
    `text="${text4.slice(0, 160)}"`);
  check("no-op message does not accuse the agent of a slip",
    !/not a tool fault/i.test(text4),
    `text="${text4.slice(0, 160)}"`);

  console.log("\n4b. edits[] sent as a JSON string is normalized too");
  const res4b: any = await wrapped.execute("call-4b", {
    path: "report.tex",
    edits: JSON.stringify([{ oldText: "a-real-anchor-line", newText: "changed" }]),
  });
  check("JSON-string edits[] not mistaken for a no-op",
    !/No-op edit/i.test(textOf(res4b)), `text="${textOf(res4b).slice(0, 160)}"`);

  console.log("\n4c. an all-no-op edits[] IS still rejected");
  const res4c: any = await wrapped.execute("call-4c", {
    path: "memory.md",
    edits: [{ oldText: "same", newText: "same" }, { oldText: "also", newText: "also" }],
  });
  check("all-no-op edits[] rejected", /No-op edit/i.test(textOf(res4c)),
    `text="${textOf(res4c).slice(0, 160)}"`);

  console.log("\n4d. a MIXED edits[] (one no-op, one real) is not thrown away");
  const res4d: any = await wrapped.execute("call-4d", {
    path: "memory.md",
    edits: [{ oldText: "same", newText: "same" }, { oldText: "# Memory", newText: "# Notes" }],
  });
  check("mixed edits[] not rejected as a no-op", !/No-op edit/i.test(textOf(res4d)),
    `text="${textOf(res4d).slice(0, 160)}"`);

  console.log("\n4e. an edit carrying no replacement gets a shape message, not a no-op message");
  const res4e: any = await wrapped.execute("call-4e", { path: "memory.md", edits: [] });
  const text4e = textOf(res4e);
  check("named as a shape problem", /carried no replacements/i.test(text4e),
    `text="${text4e.slice(0, 160)}"`);
  check("shows the accepted shape", /edits: \[\{oldText, newText\}/.test(text4e),
    `text="${text4e.slice(0, 160)}"`);

  console.log("\n5. END-TO-END: a wrapped edit on the REAL tool changes bytes on disk");
  const real = join(tmp, "report.tex");
  writeFileSync(real, "\\documentclass{article}\n\\begin{document}\nhi\n\\bibliography{references}\n\\end{document}\n");
  const realTools = wrap(createCodingToolsForProject(tmp), tmp, {}, undefined);
  const realRead = realTools.find((t: any) => t.name === "read");
  const realEdit = realTools.find((t: any) => t.name === "edit");
  check("read + edit tools are present", !!realRead && !!realEdit);

  await realRead.execute("read-1", { path: real });
  let editErr: string | undefined;
  let editRes: any;
  try {
    editRes = await realEdit.execute("edit-1", {
      path: real,
      edits: [{
        oldText: "\\bibliography{references}",
        newText: "{\\footnotesize\\bibliography{references}}",
      }],
    });
  } catch (e: any) { editErr = e?.message || String(e); }

  const after = readFileSync(real, "utf-8");
  check("edit did not throw", editErr === undefined, `err=${String(editErr).slice(0, 200)}`);
  check("edit result is not a BLOCKED result",
    !/BLOCKED/.test(textOf(editRes)), `text="${textOf(editRes).slice(0, 200)}"`);
  check("FILE ON DISK CHANGED (the y-magic assertion)",
    after.includes("{\\footnotesize\\bibliography{references}}"),
    `file still: ${JSON.stringify(after.split("\n").find((l) => l.includes("bibliography")))}`);

  console.log("\n6. END-TO-END: a multi-edit call applies every replacement");
  const multi = join(tmp, "multi.md");
  writeFileSync(multi, "alpha\nbeta\ngamma\n");
  await realRead.execute("read-2", { path: multi });
  await realEdit.execute("edit-2", {
    path: multi,
    edits: [
      { oldText: "alpha", newText: "ALPHA" },
      { oldText: "gamma", newText: "GAMMA" },
    ],
  });
  const afterMulti = readFileSync(multi, "utf-8");
  check("both replacements landed",
    afterMulti.includes("ALPHA") && afterMulti.includes("GAMMA"),
    `file=${JSON.stringify(afterMulti)}`);
  check("untouched line preserved", afterMulti.includes("beta"), `file=${JSON.stringify(afterMulti)}`);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// ── 7 (C1): a block reaches the loop, the log and the transcript as a failure ──
// Offline: every model turn below is scripted, and fetch is refused outright.
(globalThis as any).fetch = async () => { throw new Error("smoke_edit_noop_guard §7: network blocked"); };
const asst = (content: any[], stopReason: string) => ({ role: "assistant", content, stopReason, timestamp: Date.now() });
const scripted = (turns: any[]) => {
  const fn: any = async () => {
    const m = turns[Math.min(fn.calls++, turns.length - 1)];
    return { async *[Symbol.asyncIterator]() { yield { type: "done", message: m }; }, result: async () => m };
  };
  fn.calls = 0;
  return fn;
};
const tmp7 = mkdtempSync(join(tmpdir(), "luxas-edit-noop-7-"));

console.log("\n7a. brain loop: a wrapper block and a refused finish are logged as failures");
{
  const proj = join(tmp7, "brain");
  mkdirSync(join(proj, "notes"), { recursive: true });
  mkdirSync(join(proj, ".agent"), { recursive: true });
  writeFileSync(join(proj, "notes/memory.md"), "# Memory\nline A\n");
  const tools: any[] = buildSafetyWrapper(getDefinition("brain").safety)!(
    createCodingToolsForProject(proj), proj, { PROJECT_DIR: proj, SISYPHUS_DIR: join(tmp7, "sisyphus") }, undefined);
  // Stand-in for the brain's finish tool, one return shape per call id (src/tools/index.ts).
  const finishReturns: Record<string, any> = {
    fd: { content: [{ type: "text", text: "finish() deferred: background agent(s) were still running. Waited and harvested:\n\nE1 done" }] },
    f1: { content: [{ type: "text", text: "\nCannot finish: report/report.pdf does not exist.\nCompile first." }] },
    f2: { content: [{ type: "text", text: "Research complete: x" }], details: { success: true } },
  };
  tools.push({ name: "finish", label: "finish", description: "f", parameters: { type: "object", properties: {} },
    execute: async (id: string) => finishReturns[id] });
  tools.push({ name: "boom", label: "boom", description: "b", parameters: { type: "object", properties: {} },
    execute: async () => { throw new Error("ModuleNotFoundError: No module named 'scipy'"); } });
  const busEvents: any[] = [];
  const hooks = buildResearchHooks({ projectDir: proj, maxCostUsd: 1000,
    bus: { emit: async (e: any) => { busEvents.push(e); } } as any });
  const results: Record<string, any> = {};
  const stream = scripted([
    asst([
      { type: "toolCall", id: "noop", name: "edit", arguments: { path: "notes/memory.md", edits: [{ oldText: "line A", newText: "line A" }] } },
      { type: "toolCall", id: "rd", name: "read", arguments: { path: "notes/memory.md" } },
      { type: "toolCall", id: "real", name: "edit", arguments: { path: "notes/memory.md", edits: [{ oldText: "line A", newText: "line B" }] } },
      { type: "toolCall", id: "thrown", name: "boom", arguments: {} },
      { type: "toolCall", id: "fd", name: "finish", arguments: {} },
      { type: "toolCall", id: "f1", name: "finish", arguments: {} },
    ], "toolUse"),
    asst([{ type: "toolCall", id: "f2", name: "finish", arguments: {} }], "toolUse"),
    asst([{ type: "text", text: "unreachable: the passing finish ends the loop" }], "stop"),
  ]);
  await runAgentLoop(
    [{ role: "user", content: [{ type: "text", text: "go" }], timestamp: Date.now() }] as any,
    { systemPrompt: "s", messages: [], tools } as any,
    { model: { provider: "anthropic", id: "claude-opus-5-5", api: "anthropic-messages" }, convertToLlm: (m: any[]) => m,
      toolExecution: "sequential", beforeToolCall: hooks.before, afterToolCall: hooks.after } as any,
    async (ev: any) => { if (ev.type === "message_end" && ev.message?.role === "toolResult") results[ev.message.toolCallId] = ev.message; },
    undefined,
    stream,
  );
  const log = readFileSync(join(proj, ".agent/log.jsonl"), "utf8").trim().split("\n")
    .map((l) => JSON.parse(l)).filter((e) => e.type === "tool_call");
  const by = (tool: string, i = 0) => log.filter((e) => e.tool === tool)[i];
  const row = (r: any) => JSON.stringify(r)?.slice(0, 240);

  check("blocked no-op edit: toolResult.isError === true (what the provider is sent)",
    results.noop?.isError === true, `isError=${results.noop?.isError}`);
  check("blocked no-op edit: log success:false", by("edit", 0)?.success === false, row(by("edit", 0)));
  check("blocked no-op edit: errorCategory safety_block", by("edit", 0)?.errorCategory === "safety_block",
    `cat=${by("edit", 0)?.errorCategory}`);
  check("blocked no-op edit: BLOCKED text reaches the model unchanged",
    /^BLOCKED: No-op edit/.test(results.noop?.content?.[0]?.text ?? ""), `text=${String(results.noop?.content?.[0]?.text).slice(0, 80)}`);

  check("refused finish: log success:false", by("finish", 1)?.success === false, row(by("finish", 1)));
  check("refused finish: errorCategory finish_refused", by("finish", 1)?.errorCategory === "finish_refused",
    `cat=${by("finish", 1)?.errorCategory}`);
  check("refused finish: errorMessage is the first gate line",
    by("finish", 1)?.errorMessage === "Cannot finish: report/report.pdf does not exist.", `msg=${by("finish", 1)?.errorMessage}`);
  check("refused finish: NOT sent as provider is_error (a gate is a turn, not a fault)",
    results.f1?.isError === false, `isError=${results.f1?.isError}`);
  check("deferred finish: logged success:false as finish_deferred",
    by("finish", 0)?.success === false && by("finish", 0)?.errorCategory === "finish_deferred", row(by("finish", 0)));
  check("deferred finish: NOT sent as provider is_error", results.fd?.isError === false, `isError=${results.fd?.isError}`);

  check("control: passing finish logged success:true", by("finish", 2)?.success === true, row(by("finish", 2)));
  check("control: passing finish ended the loop (Patch B unaffected)", stream.calls === 2, `model calls=${stream.calls}`);
  check("control: real edit isError false + logged success",
    results.real?.isError === false && by("edit", 1)?.success === true, row(by("edit", 1)));
  check("control: real edit reached disk", readFileSync(join(proj, "notes/memory.md"), "utf8").includes("line B"));
  check("control: a thrown error is still logged with its category",
    by("boom")?.success === false && by("boom")?.errorCategory === "python_import", row(by("boom")));

  const lessons = existsSync(join(proj, "notes/lessons.md")) ? readFileSync(join(proj, "notes/lessons.md"), "utf8") : "";
  check("lessons.md: only the thrown error, never a safety block or a finish gate",
    /boom — python_import/.test(lessons) && !/edit —|finish —/.test(lessons), `lessons=${JSON.stringify(lessons.slice(0, 200))}`);
  const failures = busEvents.filter((e) => e.type === "tool_failure").map((e) => e.tool);
  check("bus tool_failure: only the thrown error", failures.join(",") === "boom", `tool_failure=${failures.join(",")}`);
}

console.log("\n7b. sub-agent: a spawn.ts-built tool_review's blocked write");
{
  const proj = join(tmp7, "sub");
  mkdirSync(join(proj, "notes"), { recursive: true });
  mkdirSync(join(proj, "data/experiments/E1_gate/tests"), { recursive: true });
  writeFileSync(join(proj, "notes/experiments.md"), "# ledger\n");
  const built: any = buildAgentFromDefinition({
    name: "tool_review", templateVars: { PROJECT_DIR: proj, EXPERIMENT_ID: "E1_gate", TOOL_NAME: "t" },
    prompt: "go", projectDir: proj, getApiKey: () => "stub",
  } as any);
  const agent: any = built.agent;
  agent.streamFunction = scripted([
    asst([{ type: "toolCall", id: "w", name: "write", arguments: { path: "notes/experiments.md", content: "clobber" } }], "toolUse"),
    asst([{ type: "text", text: "done" }], "stop"),
  ]);
  await agent.prompt("go");
  const tr = agent.state.messages.find((m: any) => m.role === "toolResult" && m.toolCallId === "w");
  check("sub-agent blocked write: toolResult.isError === true", tr?.isError === true,
    `isError=${tr?.isError} text=${String(tr?.content?.[0]?.text).slice(0, 60)}`);
  check("sub-agent blocked write: BLOCKED text kept", /^BLOCKED:/.test(String(tr?.content?.[0]?.text ?? "")));
  check("ledger untouched", readFileSync(join(proj, "notes/experiments.md"), "utf8") === "# ledger\n");
}

// Last on purpose: the monitor runner and the provider swap below are process-global
// (installUsageTracking, registerApiProvider, env keys, HOME).
console.log("\n7c. monitor: a read outside its root reaches tool_end and the session as a failure");
{
  for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET/i.test(k)) delete process.env[k];
  process.env.HOME = join(tmp7, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  const compat: any = await import("@earendil-works/pi-ai/compat");
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  let turn = 0;
  const fake = (model: any) => {
    const head = { api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage };
    const msg = turn++ === 0
      ? { ...head, role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "r1", name: "read", arguments: { path: "/etc/hosts" } }] }
      : { ...head, role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] };
    return { async *[Symbol.asyncIterator]() { yield { type: "done", message: msg }; }, result: async () => msg };
  };
  for (const p of compat.getApiProviders()) compat.registerApiProvider({ api: p.api, stream: fake, streamSimple: fake }, "smoke-edit-noop-7c");

  const proj = join(tmp7, "mon");
  mkdirSync(join(proj, ".agent"), { recursive: true });
  writeFileSync(join(proj, "RESEARCH.md"), "# smoke\n");
  const { runMonitorTurn } = await import("../src/monitor-runner.js");
  const out: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (s: any) => { out.push(String(s)); return true; };
  let code: number | undefined;
  try { code = await runMonitorTurn({ project: proj, message: "status?", json: true } as any); }
  finally { (process.stdout as any).write = realWrite; }
  const events = out.join("").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const end = events.find((e: any) => e.type === "tool_end" && e.id === "r1");
  const sessPath = join(proj, ".agent/monitor/session.jsonl");
  const sess = existsSync(sessPath) ? readFileSync(sessPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const tr = sess.map((e: any) => e.message ?? e).find((m: any) => m?.role === "toolResult" && m.toolCallId === "r1");
  check("monitor turn ran offline on the scripted provider", code === 0 && turn === 2, `exit=${code} model calls=${turn}`);
  check("monitor read outside root: BLOCKED text", /BLOCKED/.test(String(end?.result ?? "")), `result=${String(end?.result).slice(0, 80)}`);
  check("monitor read outside root: tool_end ok:false", end?.ok === false, `ok=${end?.ok}`);
  check("monitor read outside root: session toolResult isError:true", tr?.isError === true, `isError=${tr?.isError}`);
}
try { rmSync(tmp7, { recursive: true, force: true }); } catch {}

summary();
