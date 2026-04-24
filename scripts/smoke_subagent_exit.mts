/**
 * smoke_subagent_exit — verify PR-1 structured completion contract.
 *
 *   npx tsx scripts/smoke_subagent_exit.mts
 *
 * Tests three boundaries without requiring an API key:
 *   1. SafetyRuntimeHooks.onFileTouched fires on successful write/edit and
 *      carries (path, via, at).
 *   2. markDone / markFailed accept an optional SubAgentExit and round-trip
 *      it through active-agents.json.
 *   3. formatExitHint renders non-trivial exits as human-readable suffixes
 *      and returns empty for stopReason=stop.
 *
 * Scope: PR-1 contract only. Does NOT exercise stopReason capture during a
 * real agent loop — that is the PR-2 spike's responsibility.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import {
  addAgent,
  markDone,
  markFailed,
  loadRegistry,
  formatExitHint,
  type SubAgentExit,
} from "../src/active-agents.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const root = join(tmpdir(), `luxas-pr1-smoke-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(root, { recursive: true });

// ── 1. onFileTouched callback fires from safety wrapper ──
console.log("1. onFileTouched callback");

const touches: { path: string; via: string; at: number }[] = [];
const hooks = { onFileTouched: (e: any) => { touches.push(e); } };

// A bare-bones `write` tool that always succeeds. The wrapper's accounting
// (mtime bump, hooks) runs AFTER origExecute resolves.
const target = join(root, "out.txt");
const fakeWriteTool = {
  name: "write",
  execute: async (_id: string, params: { path: string; content: string }) => {
    writeFileSync(params.path, params.content);
    return { content: [{ type: "text", text: "wrote" }] };
  },
};

const wrapper = buildSafetyWrapper({
  protectedFiles: [],
  writeOnExistingPolicy: "allow_as_read",
  allowedWriteRoots: undefined,
});
if (!wrapper) throw new Error("buildSafetyWrapper returned undefined for a concrete config");

const wrapped = wrapper([fakeWriteTool as any], root, {}, hooks);
const wrappedWrite = wrapped[0];

await wrappedWrite.execute("id-1", { path: target, content: "hello" });

check("hook fired exactly once", touches.length === 1, `got ${touches.length}`);
check("hook carries path", touches[0]?.path === target, `got ${touches[0]?.path}`);
check("hook carries via=write", touches[0]?.via === "write");
check("hook carries timestamp", typeof touches[0]?.at === "number" && touches[0].at > 0);

// Negative: wrapper should NOT call hook when caller passes no hooks object.
const touches2: any[] = [];
const wrapped2 = wrapper([fakeWriteTool as any], root, {}, undefined);
await wrapped2[0].execute("id-2", { path: join(root, "out2.txt"), content: "x" });
check("no hook object = no callback", touches2.length === 0);

// ── 2. SubAgentExit round-trips through active-agents.json ──
console.log("\n2. SubAgentExit round-trip");

addAgent(root, {
  id: "test.agent-1",
  name: "test",
  task: "t",
  mode: "background",
  startedAt: Date.now(),
  conversationFile: "",
  status: "running",
});

const exit: SubAgentExit = {
  stopReason: "length",
  partialAssistantText: "def foo():\n    pass",
  filesTouched: [
    { path: join(root, "a.py"), via: "write", at: Date.now() - 100 },
    { path: join(root, "b.py"), via: "edit", at: Date.now() },
  ],
  elapsedMs: 12_345,
  toolCallCount: 7,
  lastContextTokens: 42_000,
  endedAt: new Date().toISOString(),
};

markDone(root, "test.agent-1", "final output", exit);
const after = loadRegistry(root);
const a1 = after.find((a) => a.id === "test.agent-1");

check("agent found after markDone", !!a1);
check("status set to done", a1?.status === "done");
check("exit persisted", !!a1?.exit);
check("exit.stopReason round-trips", a1?.exit?.stopReason === "length");
check("exit.filesTouched round-trips", a1?.exit?.filesTouched?.length === 2);
check("exit.partialAssistantText round-trips", a1?.exit?.partialAssistantText === "def foo():\n    pass");
check("exit.toolCallCount round-trips", a1?.exit?.toolCallCount === 7);

// Partial text truncation for large blobs
addAgent(root, {
  id: "test.agent-2",
  name: "test",
  task: "t",
  mode: "background",
  startedAt: Date.now(),
  conversationFile: "",
  status: "running",
});
const hugeExit: SubAgentExit = {
  stopReason: "length",
  partialAssistantText: "x".repeat(10_000),
  filesTouched: [],
  elapsedMs: 1,
  toolCallCount: 0,
  endedAt: new Date().toISOString(),
};
markDone(root, "test.agent-2", "", hugeExit);
const a2 = loadRegistry(root).find((a) => a.id === "test.agent-2");
const partialLen = a2?.exit?.partialAssistantText?.length ?? 0;
check("huge partialAssistantText truncated to ~4K", partialLen > 4_000 && partialLen < 4_100, `got ${partialLen}`);
check("truncation marker present", a2?.exit?.partialAssistantText?.includes("[truncated]") === true);

// markFailed also carries exit
addAgent(root, {
  id: "test.agent-3",
  name: "test",
  task: "t",
  mode: "background",
  startedAt: Date.now(),
  conversationFile: "",
  status: "running",
});
markFailed(root, "test.agent-3", "provider threw", {
  stopReason: "error",
  filesTouched: [],
  elapsedMs: 500,
  toolCallCount: 2,
  endedAt: new Date().toISOString(),
});
const a3 = loadRegistry(root).find((a) => a.id === "test.agent-3");
check("markFailed sets exit too", a3?.exit?.stopReason === "error");

// ── 3. formatExitHint rendering ──
console.log("\n3. formatExitHint");

check("stop → empty string",
  formatExitHint({
    stopReason: "stop", filesTouched: [], elapsedMs: 0, toolCallCount: 0, endedAt: "",
  }) === "");

check("undefined → empty string", formatExitHint(undefined) === "");

const hint = formatExitHint(exit);
check("length renders stopReason=length", hint.includes("stopReason=length"));
check("length renders filesTouched count", hint.includes("filesTouched=2"));
check("length renders toolCalls count", hint.includes("toolCalls=7"));
check("length renders touched list", hint.includes("write:") && hint.includes("edit:"));
check("length renders partial snippet", hint.includes("partial (first 500 chars)"));

// ── Summary ──
console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
