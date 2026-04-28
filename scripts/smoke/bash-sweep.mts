/**
 * Smoke: sweepJobs handles the four during-session cases.
 *
 *   A. running, deadline future, pid alive       → healthy, leave alone
 *   B. running, pid gone                          → done, cause=process_gone_since_last_sweep
 *   C. running, deadline passed, ours             → killed, cause=sweep_deadline_killed
 *   D. running, deadline passed, unverifiable     → orphaned, cause=pid_reuse_or_unverifiable
 *
 * Plus the race guard: if a record's status flips between sweep's read
 * and write, sweep skips and the in-process writer wins.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sweepJobs, writeState, jobStatePath, type JobState,
} from "../../src/jobs/registry.js";
import { pidAlive, sleep } from "../../src/utils.js";

let pass = 0, fail = 0;
function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function bad(label: string, detail?: string) {
  fail++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), "luxas-bash-sweep-"));
  process.on("exit", () => { try { rmSync(projectDir, { recursive: true, force: true }); } catch {} });
  mkdirSync(join(projectDir, ".agent"), { recursive: true });

  const seedRunning = (id: string, pid: number, command: string, deadlineAt: number) => {
    writeState(projectDir, {
      id, pid, command, deadlineAt,
      ownerAgentId: "smoke-test",
      ownerAgentType: "smoke",
      toolCallId: null,
      cwd: projectDir,
      startedAt: Date.now() - 5000,
      timeoutSec: 600,
      status: "running",
      endedAt: null, exitCode: null, signal: null, cause: null,
      logPath: join(projectDir, ".agent", "jobs", id, "output.log"),
    });
  };

  const future = Date.now() + 10 * 60_000;
  const past = Date.now() - 1000;
  const readJob = (id: string) => JSON.parse(readFileSync(jobStatePath(projectDir, id), "utf-8")) as JobState;

  // Case A: healthy in-flight job — sweep must not touch it.
  const aliveA = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveA.unref();
  await sleep(200);
  seedRunning("job_AAAAAAAAA", aliveA.pid!, "sleep 30", future);

  // Case B: pid is gone — sweep must mark done.
  const dead = spawn("/bin/bash", ["-c", "true"], { detached: true, stdio: "ignore" });
  await new Promise<void>(r => dead.on("close", () => r()));
  await sleep(50);
  seedRunning("job_BBBBBBBBB", dead.pid!, "true", future);

  // Case C: deadline passed, ours — sweep must kill + mark done.
  const aliveC = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveC.unref();
  await sleep(200);
  seedRunning("job_CCCCCCCCC", aliveC.pid!, "sleep 30", past);

  // Case D: deadline passed, unverifiable — sweep must orphan, NOT kill.
  const aliveD = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveD.unref();
  await sleep(200);
  seedRunning("job_DDDDDDDDD", aliveD.pid!, "definitely-not-the-real-command-XYZ", past);

  const summary = await sweepJobs(projectDir);

  if (summary.scanned === 4) ok("scanned 4 jobs");
  else bad("scanned", String(summary.scanned));
  if (summary.healthy === 1) ok("healthy=1 (case A)");
  else bad("healthy", String(summary.healthy));
  if (summary.markedDone === 1) ok("markedDone=1 (case B)");
  else bad("markedDone", String(summary.markedDone));
  if (summary.killedDeadline === 1) ok("killedDeadline=1 (case C)");
  else bad("killedDeadline", String(summary.killedDeadline));
  if (summary.unverifiable === 1) ok("unverifiable=1 (case D)");
  else bad("unverifiable", String(summary.unverifiable));

  // Per-case state assertions
  const stateA = readJob("job_AAAAAAAAA");
  if (stateA.status === "running") ok("case A: still running (untouched)");
  else bad("case A status", stateA.status);

  const stateB = readJob("job_BBBBBBBBB");
  if (stateB.status === "done" && stateB.cause === "process_gone_since_last_sweep")
    ok("case B: done/process_gone_since_last_sweep");
  else bad("case B status/cause", `${stateB.status}/${stateB.cause}`);

  const stateC = readJob("job_CCCCCCCCC");
  if (stateC.status === "done" && stateC.cause === "sweep_deadline_killed")
    ok("case C: done/sweep_deadline_killed");
  else bad("case C status/cause", `${stateC.status}/${stateC.cause}`);

  await sleep(300);
  if (!pidAlive(aliveC.pid!)) ok("case C: process killed");
  else { bad("case C: process still alive"); try { process.kill(-aliveC.pid!, "SIGKILL"); } catch {} }

  const stateD = readJob("job_DDDDDDDDD");
  if (stateD.status === "orphaned" && stateD.cause === "pid_reuse_or_unverifiable")
    ok("case D: orphaned/pid_reuse_or_unverifiable");
  else bad("case D status/cause", `${stateD.status}/${stateD.cause}`);
  if (pidAlive(aliveD.pid!)) ok("case D: ambiguous process untouched");
  else bad("case D: process was killed (misfire)");

  // Idempotence — second sweep is a no-op on the now-terminal records.
  const summary2 = await sweepJobs(projectDir);
  if (summary2.markedDone === 0 && summary2.killedDeadline === 0 && summary2.unverifiable === 0 && summary2.healthy === 1)
    ok("sweep is idempotent");
  else bad("sweep not idempotent", JSON.stringify(summary2));

  // Race guard: pre-flip a record to done after seeding it as running. This
  // simulates the in-process close handler racing the sweep's commit.
  // Re-read guard inside sweep should detect and skip without a clobber.
  const idR = "job_RRRRRRRRR";
  const aliveR = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveR.unref();
  await sleep(200);
  seedRunning(idR, aliveR.pid!, "sleep 30", past);
  // Flip to "done" under sweep's feet by writing directly:
  const seeded = readJob(idR);
  writeState(projectDir, { ...seeded, status: "done", endedAt: Date.now(), cause: "completed" });
  const summary3 = await sweepJobs(projectDir);
  // case R is already done at scan time, so we expect alreadyDone-style skip
  // (sweep returns early via `state.status !== "running"`, no raceSkipped).
  // raceSkipped fires when status flips between read and write — that path
  // is hard to reproduce deterministically; assert only that nothing
  // additional happened (no kill, no clobber).
  const stateR = readJob(idR);
  if (stateR.cause === "completed") ok("race: pre-flipped record kept its cause (no clobber)");
  else bad("race: cause clobbered", String(stateR.cause));
  if (summary3.killedDeadline === 0) ok("race: no spurious kill on already-done record");
  else bad("race: killedDeadline", String(summary3.killedDeadline));
  try { process.kill(-aliveR.pid!, "SIGKILL"); } catch {}

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("smoke crashed:", err); process.exit(2); });
