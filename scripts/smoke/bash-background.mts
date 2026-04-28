/**
 * Smoke: L2b — run_in_background, auto-promote, and the four job-control
 * tools (job_status / job_output / job_wait / job_kill). Owner enforcement
 * also tested.
 *
 * Auto-promote uses a 2s budget (test seam) instead of the production 90s
 * so this completes in ~10s.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobOwnerAls } from "../../src/jobs/als.js";
import { readState } from "../../src/jobs/registry.js";
import { createHardenedBashTool } from "../../src/tools/bash-hardened.js";
import { createJobControlTools } from "../../src/tools/job-control.js";
import { pidAlive, sleep } from "../../src/utils.js";

let pass = 0, fail = 0;
function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function bad(label: string, detail?: string) {
  fail++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

const TEST_BUDGET_MS = 2000;

function getTool(tools: any[], name: string) {
  const t = tools.find(t => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), "luxas-bash-bg-"));
  const stragglers: number[] = [];
  process.on("exit", () => {
    for (const pid of stragglers) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });
  mkdirSync(join(projectDir, ".agent"), { recursive: true });

  const bash = createHardenedBashTool(projectDir, { foregroundBudgetMs: TEST_BUDGET_MS });
  const jobTools = createJobControlTools(projectDir);
  const jobStatus = getTool(jobTools, "job_status");
  const jobOutput = getTool(jobTools, "job_output");
  const jobWait = getTool(jobTools, "job_wait");
  const jobKill = getTool(jobTools, "job_kill");

  const runAs = <T>(agentId: string, fn: () => Promise<T>): Promise<T> =>
    jobOwnerAls.run({ agentId, agentType: "smoke", projectDir }, fn);

  // ── 1. run_in_background=true returns a handle immediately ────
  console.log("=== run_in_background=true ===");
  const t0 = Date.now();
  const bgRes: any = await runAs("agent-A", () =>
    bash.execute("call_bg", { command: "sleep 5", run_in_background: true } as any));
  const elapsed = Date.now() - t0;
  if (elapsed < 500) ok(`run_in_background returned in ${elapsed}ms (<500ms)`);
  else bad("run_in_background slow", `${elapsed}ms`);
  if (bgRes.details?.status === "running") ok("details.status === running");
  else bad("details.status", String(bgRes.details?.status));
  const bgJobId: string = bgRes.details?.jobId;
  if (bgJobId?.startsWith("job_")) ok("jobId returned in details");
  else bad("jobId missing", String(bgJobId));
  const bgState = readState(projectDir, bgJobId);
  if (bgState?.status === "running") ok("state.json status=running");
  else bad("state.json status", String(bgState?.status));
  if (bgState) stragglers.push(bgState.pid);

  // ── 2. job_status (single) and (list) ──────────────────────────
  console.log("\n=== job_status ===");
  const statusOne: any = await runAs("agent-A", () =>
    jobStatus.execute("call_status_1", { job_id: bgJobId } as any));
  if (/running/.test(statusOne.content[0].text)) ok("job_status(id) shows running");
  else bad("job_status(id) text", statusOne.content[0].text.slice(0, 200));

  const statusList: any = await runAs("agent-A", () =>
    jobStatus.execute("call_status_list", {} as any));
  if (statusList.details?.count === 1) ok("job_status() lists 1 owned job");
  else bad("job_status() count", String(statusList.details?.count));

  // ── 3. owner enforcement: agent-B can't see agent-A's job ─────
  console.log("\n=== owner enforcement ===");
  const foreign: any = await runAs("agent-B", () =>
    jobStatus.execute("call_foreign", { job_id: bgJobId } as any));
  if (/owned by agent-A, not agent-B/.test(foreign.content[0].text)) ok("foreign agent rejected on job_status(id)");
  else bad("foreign rejection text", foreign.content[0].text.slice(0, 200));

  const foreignList: any = await runAs("agent-B", () =>
    jobStatus.execute("call_foreign_list", {} as any));
  if (foreignList.details?.count === 0) ok("foreign agent sees 0 jobs in list");
  else bad("foreign list count", String(foreignList.details?.count));

  const foreignKill: any = await runAs("agent-B", () =>
    jobKill.execute("call_foreign_kill", { job_id: bgJobId } as any));
  if (/owned by agent-A/.test(foreignKill.content[0].text)) ok("foreign agent rejected on job_kill");
  else bad("foreign job_kill text", foreignKill.content[0].text.slice(0, 200));
  // Verify the foreign-rejected job is still alive
  if (pidAlive(bgState!.pid)) ok("foreign-rejected job still alive (no misfire)");
  else bad("foreign job_kill misfired");

  // ── 4. job_output ──────────────────────────────────────────────
  console.log("\n=== job_output ===");
  // Spawn a job that prints predictable lines so we can assert tail content.
  const printJob: any = await runAs("agent-A", () =>
    bash.execute("call_print", {
      command: "for i in $(seq 1 20); do echo line-$i; done; sleep 2",
      run_in_background: true,
    } as any));
  const printJobId: string = printJob.details.jobId;
  const printState = readState(projectDir, printJobId);
  if (printState) stragglers.push(printState.pid);
  await sleep(400); // let stdout flush
  const tailRes: any = await runAs("agent-A", () =>
    jobOutput.execute("call_tail", { job_id: printJobId, tail: 5 } as any));
  const tailText: string = tailRes.content[0].text;
  if (/line-16[\s\S]*line-17[\s\S]*line-18[\s\S]*line-19[\s\S]*line-20/.test(tailText)) ok("job_output tail returns last N lines");
  else bad("job_output tail content", tailText.slice(0, 200));

  // ── 5. job_wait blocks until completion ────────────────────────
  console.log("\n=== job_wait ===");
  const fastJob: any = await runAs("agent-A", () =>
    bash.execute("call_fast_bg", { command: "sleep 1", run_in_background: true } as any));
  const fastJobId: string = fastJob.details.jobId;
  const tWait0 = Date.now();
  const waitRes: any = await runAs("agent-A", () =>
    jobWait.execute("call_wait", { job_id: fastJobId, timeout: 5 } as any));
  const waitElapsed = Date.now() - tWait0;
  if (waitElapsed >= 800 && waitElapsed < 3000) ok(`job_wait blocked ~${waitElapsed}ms (job took 1s)`);
  else bad("job_wait elapsed", `${waitElapsed}ms`);
  if (/"status": "done"/.test(waitRes.content[0].text)) ok("job_wait returns done state");
  else bad("job_wait result text", waitRes.content[0].text.slice(0, 200));
  if (/"cause": "completed"/.test(waitRes.content[0].text)) ok("job_wait shows cause=completed");
  else bad("job_wait cause", waitRes.content[0].text.slice(0, 200));

  // ── 6. job_kill terminates a running job ───────────────────────
  console.log("\n=== job_kill ===");
  const killTarget: any = await runAs("agent-A", () =>
    bash.execute("call_kill_target", { command: "sleep 60", run_in_background: true } as any));
  const killJobId: string = killTarget.details.jobId;
  const killState = readState(projectDir, killJobId);
  if (!killState || !pidAlive(killState.pid)) bad("setup: kill target not running");
  await runAs("agent-A", () => jobKill.execute("call_kill", { job_id: killJobId } as any));
  await sleep(400);
  if (killState && !pidAlive(killState.pid)) ok("job_kill terminated process group");
  else { bad("job_kill did not terminate"); if (killState) stragglers.push(killState.pid); }
  await sleep(300); // let close handler commit terminal state
  const killEnd = readState(projectDir, killJobId);
  if (killEnd?.status === "done") ok("job_kill: state transitions to done");
  else bad("job_kill final status", String(killEnd?.status));

  // job_kill on already-terminal job is idempotent
  const killAgain: any = await runAs("agent-A", () =>
    jobKill.execute("call_kill_again", { job_id: killJobId } as any));
  if (/already terminal/.test(killAgain.content[0].text)) ok("job_kill idempotent on terminal job");
  else bad("job_kill idempotence", killAgain.content[0].text.slice(0, 200));

  // ── 7. foreground auto-promote at the test budget ──────────────
  console.log("\n=== foreground auto-promote ===");
  const tProm0 = Date.now();
  const promRes: any = await runAs("agent-A", () =>
    bash.execute("call_promote", { command: "sleep 5" } as any));  // foreground, no run_in_background
  const promElapsed = Date.now() - tProm0;
  // Should auto-promote at TEST_BUDGET_MS (2000ms), well before the 5s sleep finishes
  if (promElapsed >= TEST_BUDGET_MS && promElapsed < TEST_BUDGET_MS + 1500) {
    ok(`foreground auto-promoted at ~${promElapsed}ms (budget ${TEST_BUDGET_MS}ms)`);
  } else bad("auto-promote timing", `${promElapsed}ms`);
  if (promRes.details?.status === "running") ok("auto-promote details.status=running");
  else bad("auto-promote details.status", String(promRes.details?.status));
  const promJobId: string = promRes.details.jobId;
  const promState = readState(projectDir, promJobId);
  if (promState && pidAlive(promState.pid)) ok("auto-promoted job still alive after early return");
  else bad("auto-promoted job dead after early return");
  if (promState) stragglers.push(promState.pid);

  // ── 8. foreground completes within budget → normal result ──────
  console.log("\n=== foreground within budget ===");
  const fastFg: any = await runAs("agent-A", () =>
    bash.execute("call_fast_fg", { command: "echo quick" } as any));
  if (/quick/.test(fastFg.content[0].text)) ok("foreground within budget returns stdout");
  else bad("foreground stdout", fastFg.content[0].text.slice(0, 100));
  if (fastFg.details?.status === "done") ok("foreground within budget details.status=done");
  else bad("foreground done status", String(fastFg.details?.status));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("smoke crashed:", err); process.exit(2); });
