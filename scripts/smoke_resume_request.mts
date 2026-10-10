#!/usr/bin/env tsx
/**
 * smoke_resume_request — a RESUMED brain still sends its prompt and its tools,
 * and its history is still a cached prefix.
 *
 * Found on the Dy run (2026-10-06), with every other gate green:
 *   1. the first call after a resume has no token count yet, so compaction
 *      fell back to a fixed 80K-character cap and condensed a 24K-token
 *      history on a 1M-token window;
 *   2. the condensed context dropped the leading role:"system" message, which
 *      since pi 0.87 IS the system prompt and the tool declarations — the
 *      request went out with neither;
 *   3. from the next call on the history was un-condensed again, so nothing
 *      written to the cache was read back.
 *
 * And (F10) that a resumed brain sends the prompt it was just built with. The
 * checkpoint keeps the leading role:"system" message of the FIRST launch;
 * restoring it over the fresh one sent that launch's brain.md, unscoped
 * <past_research> and <global_memory> for the rest of the run, so no prompt
 * or privacy fix reached a project checkpointed before it.
 *
 * Offline: scripts/cache_replay.mts builds every request with the real brain,
 * the real compaction transform and pi-ai's real Anthropic adapter, and stops
 * before the network. Pass 1 runs a fresh project to write a checkpoint with a
 * history well past the old cap; pass 2 resumes from it.
 *
 *   npx tsx scripts/smoke_resume_request.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ContextPacker } from "../src/compaction/engine.js";
import { createBlockConversationAdapter } from "../src/compaction/adapter.js";
import { measurePressure, buildWindowPlan, buildCharPlan } from "../src/compaction/thresholds.js";
import * as AA from "../src/active-agents.js";
import { getDefinition, soloExperimentDefinition } from "../src/agents/registry.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));

console.log("1. condensing never folds the system message into the note");
{
  const big = "x".repeat(20_000);
  const messages: any[] = [{ role: "system", content: "You are the brain.", tools: [{ name: "read" }], timestamp: 1 }, { role: "user", content: [{ type: "text", text: "goal" }], timestamp: 1 }];
  for (let i = 0; i < 12; i++) {
    messages.push({ role: "assistant", content: [{ type: "toolCall", id: `t${i}`, name: "read", arguments: {} }], timestamp: 1 });
    messages.push({ role: "toolResult", toolCallId: `t${i}`, toolName: "read", content: [{ type: "text", text: big }], isError: false, timestamp: 1 });
  }
  const packer = new ContextPacker<any>({ adapter: createBlockConversationAdapter(), thresholds: { windowLimit: 60_000 }, keepTailMessages: 4 } as any);
  const out = await packer.runCycle({ messages, usageTokens: 55_000 });
  check("the fixture really condenses", out.mode === "condensed", out.mode);
  check("the system message is still first", out.messages[0]?.role === "system" && out.messages[0]?.tools?.length === 1, JSON.stringify(out.messages[0]).slice(0, 120));
  check("the carry-forward note comes right after it", JSON.stringify(out.messages[1]).includes("<carryforward_note>"));
  check("exactly one system message", out.messages.filter((m: any) => m.role === "system").length === 1);
}

console.log("\n2. without a token count the decision matches the token-based one");
{
  const plan = buildWindowPlan({ windowLimit: 1_000_000 }), chars = buildCharPlan({});
  check("200K chars on a 1M window: no condense (the old cap was 80K chars)", !measurePressure(undefined, 200_000, plan, chars).shouldCondense);
  check("…and no warning-level trimming either", !measurePressure(undefined, 200_000, plan, chars).shouldWarn);
  check("a history that would overflow still condenses", measurePressure(undefined, 3_000_000, plan, chars).shouldCondense);
  check("an explicitly configured char cap still wins", measurePressure(undefined, 50_000, plan, buildCharPlan({ condenseThresholdChars: 40_000 })).shouldCondense);
  const small = buildWindowPlan({ windowLimit: 200_000 });
  check("a 200K window condenses where its token rule would (~108K tokens)", measurePressure(undefined, 108_000 * 3, small, chars).shouldCondense && !measurePressure(undefined, 100_000 * 3, small, chars).shouldCondense);
}

// C30. When Dy was to be resumed (2026-10-07) three background experiments had
// finished on disk (run_3/results.json, three review rounds each) while the
// brain was down. The orphan loop read only the transcripts: it would have
// reported one "[Recovered]" with a different experiment's text (the
// per-process bg counter had appended a second spawn to an old file) and the
// other two "[Lost]", inviting the brain to re-dispatch finished work. It also
// dropped a still-live runner from the registry, so that runner's result could
// never be harvested.
const reconcileOrphans: ((projectDir: string, agentDir: string) => string[]) | undefined = (AA as any).reconcileOrphans;
const experimentIdFromPrompt: ((text: string) => string | null) | undefined = (AA as any).experimentIdFromPrompt;
const DEAD_PID = 2 ** 22 + 12345; // above every pid_max (macOS 99998, Linux ≤ 2^22)
const E1 = "E1_nuclear_encoding_field", E2 = "E2_tweezer_light_shift", E3 = "E3_control_readout";
const line42 = (eid: string) => `Your \`EXPERIMENT_ID\` (\`${eid}\`) names exactly ONE sub-question.`;
// A dead background experiment whose work is finished on disk. Its transcript has the
// Dy bg-1 shape: one session header, an E1 segment that ends in text, then the E2
// segment that never got past tool calls. The review rounds' verdicts differ so that
// "the first one found" and "the highest round" give different answers.
function writeFinishedExperiment(p: string, startedAt: number): AA.ActiveAgent {
  const conv = join(p, ".agent", "conversations", "brain.experiment-bg-1.jsonl");
  mkdirSync(dirname(conv), { recursive: true });
  writeFileSync(conv, [
    { type: "session", version: 1, id: "s1", timestamp: new Date(startedAt).toISOString(), cwd: p },
    { role: "system", content: `${line42(E1)} Write under data/experiments/${E1}/.` },
    { role: "user", content: [{ type: "text", text: "revise L2.1 (E_1)" }] },
    { role: "assistant", content: [{ type: "text", text: "FOREIGN-E1: I now have a complete picture of E1." }, { type: "toolCall", id: "a", name: "edit", arguments: {} }] },
    { role: "system", content: `${line42(E2)} Write under data/experiments/${E2}/.` },
    { role: "user", content: [{ type: "text", text: "# From notes/plan.md §E_2" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "toolCall", id: "b", name: "read", arguments: {} }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c", name: "bash", arguments: {} }] },
  ].map((e: any) => JSON.stringify(e.role ? { type: "message", message: e } : e)).join("\n") + "\n");
  mkdirSync(join(p, "reviews"), { recursive: true });
  for (const n of [1, 2, 3]) {
    const run = join(p, "data", "experiments", E2, "runs", `run_${n}`);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "results.json"), JSON.stringify({ experiment: E2, run: n }));
    writeFileSync(join(p, "reviews", `experiment_review_${E2}_r${n}.md`),
      `# experiment_reviewer — ${E2} round ${n}\n\n${n === 3 ? "## VERDICT: revise" : n === 1 ? "VERDICT: satisfied" : "VERDICT: revise"}\n`);
  }
  return { id: "brain.experiment-bg-1", name: "experiment", task: "# From notes/plan.md §E_2 (verbatim)", mode: "background",
    startedAt, conversationFile: conv, pid: DEAD_PID, status: "running", expected_artifact: "" };
}
// A background runner that outlived the brain: its pid answers and its heartbeat is fresh.
function liveRunner(agentDir: string, startedAt: number): AA.ActiveAgent {
  AA.touchHeartbeat(agentDir, "brain.search-bg-9");
  return { id: "brain.search-bg-9", name: "search", task: "live search", mode: "background", startedAt,
    conversationFile: join(agentDir, "conversations", "brain.search-bg-9.jsonl"), pid: process.pid, status: "running", expected_artifact: "" };
}

console.log("\nC30. resume reconciles the sub-agent registry against the disk");
{
  const p = mkdtempSync(join(tmpdir(), "luxas-c30-"));
  const agentDir = join(p, ".agent");
  const T0 = Date.now() - 3_600_000;
  let deadAlive = true; try { process.kill(DEAD_PID, 0); } catch { deadAlive = false; }
  check("C30 the fixture's dead pid is really dead", !deadAlive);

  const A = writeFinishedExperiment(p, T0);
  // B: a dead experiment with nothing delivered.
  const convB = join(agentDir, "conversations", "brain.experiment-bg-2.jsonl");
  writeFileSync(convB, [
    { type: "session", version: 1, id: "s2", timestamp: new Date(T0).toISOString(), cwd: p },
    { type: "message", message: { role: "system", content: line42(E3) } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "d", name: "read", arguments: {} }] } },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  mkdirSync(join(p, "data", "experiments", E3, "runs", "run_1"), { recursive: true });
  const B: AA.ActiveAgent = { id: "brain.experiment-bg-2", name: "experiment", task: "# From notes/plan.md §E_3 (verbatim)", mode: "background",
    startedAt: T0, conversationFile: convB, pid: DEAD_PID, status: "running", expected_artifact: "" };
  // C: a foreground revision of E1 killed with the brain. E1's newest results.json is
  // the previous run's, older than this spawn — it must not read as this spawn's work.
  const convC = join(agentDir, "conversations", "brain.experiment-7.jsonl");
  writeFileSync(convC, [
    { type: "spawn_init", agent: "experiment", task: "E_1", templateVars: { EXPERIMENT_ID: E1 }, timestamp: T0 - 7_200_000 },
    { role: "user", content: [{ type: "text", text: "E_1" }] },
    { role: "assistant", content: [{ type: "text", text: "E1 first pass delivered." }] },
    { type: "continue_init", newTask: "revise L2.1 (E_1)", timestamp: T0 },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  const resC = join(p, "data", "experiments", E1, "runs", "run_2", "results.json");
  mkdirSync(dirname(resC), { recursive: true });
  writeFileSync(resC, "{}");
  utimesSync(resC, new Date(T0 - 600_000), new Date(T0 - 600_000));
  const C: AA.ActiveAgent = { id: "brain.experiment-7", name: "experiment", task: "revise L2.1 (E_1)", mode: "foreground",
    startedAt: T0, conversationFile: convC, status: "running", expected_artifact: "" };
  const D = liveRunner(agentDir, T0);
  // E: finished before the brain died; the per-turn harvest delivers it with its exit hint.
  const E: AA.ActiveAgent = { id: "brain.reader-bg-4", name: "reader", task: "read 2301.07041", mode: "background", startedAt: T0,
    conversationFile: join(agentDir, "conversations", "brain.reader-bg-4.jsonl"), pid: DEAD_PID, status: "done", result: "E-RESULT", expected_artifact: "" };
  for (const a of [A, B, C, D, E]) AA.addAgent(agentDir, a);

  check("C30 active-agents exports reconcileOrphans", typeof reconcileOrphans === "function");
  const lines = typeof reconcileOrphans === "function" ? reconcileOrphans(p, agentDir) : [];
  const lineA = lines.find((l) => l.includes("§E_2")) ?? "";
  check("C30 A: 'Completed on disk: E2_… — run_3/results.json, last review r3 REVISE'",
    lineA.includes(`Completed on disk: ${E2} — run_3/results.json, last review r3 REVISE`), lineA.slice(0, 200) || lines.join(" | ").slice(0, 200));
  check("C30 A: not [Lost, and none of the earlier E1 segment's text", !!lineA && !lineA.includes("[Lost") && !lineA.includes("FOREIGN"), lineA.slice(0, 200));
  const lineB = lines.find((l) => l.includes("§E_3")) ?? "";
  check("C30 B (no results.json): today's [Lost: experiment] text", lineB.startsWith("[Lost: experiment]"), lineB.slice(0, 200));
  const lineC = lines.find((l) => l.includes("revise L2.1")) ?? "";
  check("C30 C (killed revision): never Completed, and says its results.json predates the spawn",
    !!lineC && !lineC.includes("Completed") && lineC.includes("predates this spawn"), lineC.slice(0, 300));
  check("C30 D (live pid, fresh heartbeat): reported still running", lines.some((l) => l.startsWith("[Still running: search] brain.search-bg-9")), lines.join(" | ").slice(0, 300));
  check("C30 E (done): left for the harvest, not reported here", !lines.some((l) => l.includes("E-RESULT") || l.includes(E.id)));
  const left = AA.loadRegistry(agentDir).map((a) => a.id).sort();
  check("C30 the registry afterwards holds exactly D and E", JSON.stringify(left) === JSON.stringify([E.id, D.id].sort()), left.join(","));
  check("C30 tryExtractResult reads only the last segment (A → null, not E1's text)", AA.tryExtractResult(A.conversationFile) === null,
    String(AA.tryExtractResult(A.conversationFile)).slice(0, 120));

  const exp = getDefinition("experiment");
  const extract = (t: string) => typeof experimentIdFromPrompt === "function" ? experimentIdFromPrompt(t.replaceAll("{{EXPERIMENT_ID}}", "E9_probe")) : undefined;
  check("C30 the experiment prompt names its id where the extractor looks (pipeline)", extract(exp.systemPromptTemplate) === "E9_probe", String(extract(exp.systemPromptTemplate)));
  check("C30 …and in the solo executor's prompt", extract(soloExperimentDefinition(exp).systemPromptTemplate) === "E9_probe");
  rmSync(p, { recursive: true, force: true });
}

console.log("\n3. the assembled brain, fresh and then resumed (claude-opus-5-5)");
const proj = mkdtempSync(join(tmpdir(), "luxas-resume-gate-"));
mkdirSync(join(proj, "notes"), { recursive: true });
writeFileSync(join(proj, "RESEARCH.md"), "# gate\nA throwaway goal for an offline wiring gate.\n");
writeFileSync(join(proj, "notes", "memory.md"), "# memory\n");
function replay(turns: number) {
  const env = { ...process.env }; delete env.LUXAS_MODEL_PROFILE; delete env.LUXAS_BRAIN_MODEL;
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "scripts", "cache_replay.mts"), proj, "--in-place", "--json", "--turns", String(turns),
    "--command", "seq 1 6000; echo \"- step\" >> notes/memory.md"], { encoding: "utf-8", timeout: 150_000, env });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("REPLAY_JSON "));
  if (!line) console.log(`  (replay produced no result: exit ${r.status} ${String(r.stderr).slice(-300)})`);
  return line ? JSON.parse(line.slice("REPLAY_JSON ".length)) : null;
}
// F10: the first request a brain built on `proj` sends, stopped in onPayload.
// Built in this process after both replays, so the resumed and the fresh brain
// read the same registry and project files.
async function firstRequest(resume: boolean): Promise<{ system: string; tools: string; toolCount: number } | null> {
  delete process.env.LUXAS_MODEL_PROFILE; delete process.env.LUXAS_BRAIN_MODEL;
  const { createResearchAgent } = await import("../src/agent.js");
  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  const { agent, restore } = createResearchAgent({ projectDir: proj, maxCostUsd: 1, model: "claude-opus-5-5", maxTurns: 3 } as any) as any;
  let payload: any = null;
  agent.streamFunction = async (m: any, ctx: any, opts: any) => {
    if (!payload) try {
      const s: any = await streamSimple(m, ctx, { ...opts, apiKey: "sk-ant-api03-offline-gate",
        onPayload: (p: any) => { payload = structuredClone(opts?.onPayload?.(p, m) ?? p); throw new Error("gate: stop before the network"); } } as any);
      await s.result?.();
    } catch { /* expected */ }
    const stop = { role: "assistant", content: [], stopReason: "error", errorMessage: "400 invalid_request: gate stop", timestamp: Date.now(),
      api: m.api, provider: m.provider, model: m.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: "error" }; }, result: async () => stop };
  };
  try {
    if (resume) {
      if (!restore || restore() === 0) return null;
      await agent.followUp({ role: "user", content: "Continue.", timestamp: Date.now() });
      await agent.continue();
    } else await agent.prompt("Research goal: gate");
  } catch { /* the scripted error ends it */ }
  if (!payload) return null;
  const system = Array.isArray(payload.system) ? payload.system.map((b: any) => b?.text ?? "").join("\n") : String(payload.system ?? "");
  const tools = (payload.tools ?? []).map(({ cache_control, ...t }: any) => t);
  return { system, tools: JSON.stringify(tools), toolCount: tools.length };
}
const fresh = replay(5);
check("pass 1 ran and wrote a checkpoint", !!fresh && fresh.rows.length >= 4 && existsSync(join(proj, ".agent", "checkpoint.jsonl")), JSON.stringify(fresh)?.slice(0, 200));
// F10: make the stored head one a brain launched before a prompt change would
// hold — another tenant's project in <past_research>, a <global_memory> block —
// and leave a stale redeclaration of `idle` mid-transcript, as a resume after a
// tool change writes one.
const ckpt = join(proj, ".agent", "checkpoint.jsonl");
const FOREIGN = "F10-FOREIGN-TENANT-QUESTION", GLOBAL_MEMORY = "F10-GLOBAL-MEMORY-LESSON", STALE_IDLE = "F10-STALE-IDLE";
const readEntries = (): any[] => existsSync(ckpt) ? readFileSync(ckpt, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
const messageEntries = () => readEntries().filter((e) => e.type === "message");
{
  const entries = readEntries();
  const head = entries.find((e) => e.type === "message" && e.message?.role === "system");
  const second = entries.filter((e) => e.type === "message" && e.message?.role === "assistant")[1];
  check("F10 fixture: pass 1 stored the prompt as the leading system message", typeof head?.message?.content === "string" && head.message.content.length > 10_000 && !!second);
  if (typeof head?.message?.content === "string" && second) {
    head.message.content += `\n\n<past_research>\n- **${FOREIGN}** (2026-09-03)\n  notes: /Users/studio/root/bbbbbbbbbbbb/projects/q/notes/\n  question: another tenant's research question\n</past_research>`
      + `\n\n<global_memory>\n- [other-project, 2026-09] ${GLOBAL_MEMORY}\n</global_memory>`;
    const delta = { type: "message", id: "f10-stale-delta", parentId: second.parentId, timestamp: new Date().toISOString(),
      message: { role: "system", content: "", toolsRemoved: [{ name: "idle" }],
        toolsAdded: [{ name: "idle", description: STALE_IDLE, parameters: { type: "object", properties: {} } }], timestamp: 1 } };
    second.parentId = delta.id;
    entries.splice(entries.indexOf(second), 0, delta);
    writeFileSync(ckpt, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}
const storedBefore = messageEntries().map((e) => JSON.stringify(e.message));
const storedSystem = messageEntries().filter((e) => e.message.role === "system").length;
// C30 wiring: the brain died with one experiment finished on disk and one runner still alive.
const projAgentDir = join(proj, ".agent");
const liveD = liveRunner(projAgentDir, Date.now() - 600_000);
for (const a of [writeFinishedExperiment(proj, Date.now() - 3_600_000), liveD]) AA.addAgent(projAgentDir, a);
const pass2Start = Date.now();
const resumed = replay(4);
check("pass 2 resumed from it", !!resumed && resumed.restored > 0, `restored ${resumed?.restored}`);
check("C30 the resume message reports the finished experiment as 'Completed on disk'", /Completed on disk/.test(resumed?.resumeText ?? ""),
  String(resumed?.resumeText ?? "(no resumeText)").split("--- Sub-agent recovery")[1]?.slice(0, 300) ?? String(resumed?.resumeText).slice(0, 120));
check("C30 after the resume the registry holds only the live runner", JSON.stringify(AA.loadRegistry(projAgentDir).map((a) => a.id)) === JSON.stringify([liveD.id]),
  AA.loadRegistry(projAgentDir).map((a) => a.id).join(","));
if (fresh && resumed) {
  const historyChars = resumed.rows[0].total - resumed.rows[0].systemChars;
  check("the resumed history is past the old 80K-char cap (else this proves nothing)", historyChars > 100_000, `${historyChars} chars`);
  for (const [name, run] of [["fresh", fresh], ["resumed", resumed]] as const) {
    check(`${name}: every request carries the system prompt`, run.rows.every((r: any) => r.systemChars > 10_000), run.rows.map((r: any) => r.systemChars).join(","));
    check(`${name}: every request declares tools`, run.rows.every((r: any) => r.tools > 5), run.rows.map((r: any) => r.tools).join(","));
    check(`${name}: nothing was condensed`, run.rows.every((r: any) => !r.condensed));
    check(`${name}: at most 4 breakpoints per request`, run.rows.every((r: any) => r.breakpoints.length <= 4));
  }
  const tail = resumed.rows.slice(1);
  check("resumed: each call can read back everything but its new turn (≥ 85% here)", tail.length >= 3 && tail.every((r: any) => r.reusable / r.total >= 0.85 && /assistant/.test(r.firstDiff)),
    tail.map((r: any) => `${Math.round(100 * r.reusable / r.total)}% (first diff ${r.firstDiff})`).join("; "));

  // F10: what pass 2 wrote back. A stale tool declaration kept in the transcript
  // makes pi declare the difference again; a restore counter off by the dropped
  // system messages re-appends history or skips the first new message.
  const after = messageEntries();
  const systemAfter = after.filter((e) => e.message.role === "system").length;
  check("F10 the resumed pass appended no system message to the checkpoint", systemAfter === storedSystem, `${storedSystem} stored, ${systemAfter} after`);
  const count = new Map<string, number>();
  for (const e of after) { const k = JSON.stringify(e.message); count.set(k, (count.get(k) ?? 0) + 1); }
  check("F10 …re-appended none of the stored messages", storedBefore.length > 0 && storedBefore.every((k) => count.get(k) === 1),
    `${storedBefore.filter((k) => count.get(k) !== 1).length} of ${storedBefore.length} not exactly once`);
  const toolTurns = resumed.rows.length - 1; // the last request gets the scripted error, which is not stored
  const own = after.filter((e) => e.message.timestamp >= pass2Start && e.message.role !== "system").length;
  check("F10 …and stored each of its own turns once", toolTurns >= 3 && own === 2 * toolTurns, `${own} messages stored for ${toolTurns} tool turns`);

  // The first request a brain built on this project sends, resumed and then
  // fresh, through pi-ai's real Anthropic adapter.
  const resumedReq = await firstRequest(true), freshReq = await firstRequest(false);
  const sysR = resumedReq?.system ?? "", sysF = freshReq?.system ?? "";
  let at = 0; while (at < sysR.length && sysR[at] === sysF[at]) at++;
  check("F10 resumed: the first request's system text is a fresh launch's", sysF.length > 10_000 && sysR === sysF,
    `resumed ${sysR.length} chars, fresh ${sysF.length}; first difference at ${at}: ${JSON.stringify(sysR.slice(at, at + 80))}`);
  check("F10 resumed: no other tenant's project and no <global_memory> from the stored head", !!resumedReq && !sysR.includes(FOREIGN) && !sysR.includes(GLOBAL_MEMORY));
  check("F10 resumed: tools declared as on a fresh launch", !!resumedReq && resumedReq.tools === freshReq?.tools && !resumedReq.tools.includes(STALE_IDLE),
    `${resumedReq?.toolCount} vs ${freshReq?.toolCount} tools${resumedReq?.tools.includes(STALE_IDLE) ? ", stale idle sent" : ""}`);
}
rmSync(proj, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
