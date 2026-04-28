/**
 * Smoke: sweepJobs handles the during-session cases.
 *
 *   A. running, deadline future, pid alive, owner alive   → healthy, leave alone
 *   B. running, pid gone                                    → done, cause=process_gone_since_last_sweep
 *   C. running, deadline passed, ours                       → killed, cause=sweep_deadline_killed
 *   D. running, deadline passed, unverifiable               → orphaned, cause=pid_reuse_or_unverifiable
 *   E. running, deadline future, pid alive, owner gone      → killed, cause=owner_gone
 *
 * Plus the race guard: if a record's status flips between sweep's read
 * and write, sweep skips and the in-process writer wins.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepJobs, writeState, jobStatePath, type JobState } from "../../src/jobs/registry.js";
import { pidAlive, sleep } from "../../src/utils.js";
import { seedRunning } from "../test-helpers/seed-job.js";

let pass = 0, fail = 0;
function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function bad(label: string, detail?: string) {
  fail++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), "luxas-bash-sweep-"));
  // Track every detached process so the exit handler can kill stragglers
  // (cases A and R intentionally leave processes alive for assertions).
  const stragglers: number[] = [];
  process.on("exit", () => {
    for (const pid of stragglers) {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });
  mkdirSync(join(projectDir, ".agent"), { recursive: true });

  const future = Date.now() + 10 * 60_000;
  const past = Date.now() - 1000;
  const readJob = (id: string) => JSON.parse(readFileSync(jobStatePath(projectDir, id), "utf-8")) as JobState;

  // Case A: healthy in-flight job — sweep must not touch it.
  const aliveA = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveA.unref();
  stragglers.push(aliveA.pid!);
  await sleep(200);
  seedRunning(projectDir, { id: "job_AAAAAAAAA", pid: aliveA.pid!, command: "sleep 30", deadlineAt: future });

  // Case B: pid is gone — sweep must mark done.
  const dead = spawn("/bin/bash", ["-c", "true"], { detached: true, stdio: "ignore" });
  await new Promise<void>(r => dead.on("close", () => r()));
  await sleep(50);
  seedRunning(projectDir, { id: "job_BBBBBBBBB", pid: dead.pid!, command: "true", deadlineAt: future });

  // Case C: deadline passed, ours — sweep must kill + mark done.
  const aliveC = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveC.unref();
  stragglers.push(aliveC.pid!);
  await sleep(200);
  seedRunning(projectDir, { id: "job_CCCCCCCCC", pid: aliveC.pid!, command: "sleep 30", deadlineAt: past });

  // Case D: deadline passed, unverifiable — sweep must orphan, NOT kill.
  const aliveD = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveD.unref();
  stragglers.push(aliveD.pid!);
  await sleep(200);
  seedRunning(projectDir, { id: "job_DDDDDDDDD", pid: aliveD.pid!, command: "definitely-not-the-real-command-XYZ", deadlineAt: past });

  // Case E: owner-gone — bash still alive, deadline still future, but the
  // recorded ownerProcessPid no longer exists. Sweep must kill the bash
  // group rather than wait for the deadline.
  const aliveE = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveE.unref();
  stragglers.push(aliveE.pid!);
  // Use a definitely-dead owner pid: spawn-and-die.
  const ownerCorpse = spawn("/bin/bash", ["-c", "true"], { detached: true, stdio: "ignore" });
  const deadOwnerPid = ownerCorpse.pid!;
  await new Promise<void>(r => ownerCorpse.on("close", () => r()));
  await sleep(50);
  seedRunning(projectDir, {
    id: "job_EEEEEEEEE",
    pid: aliveE.pid!,
    command: "sleep 30",
    deadlineAt: future,
    ownerProcessPid: deadOwnerPid,
  });

  const summary = await sweepJobs(projectDir);

  if (summary.scanned === 5) ok("scanned 5 jobs");
  else bad("scanned", String(summary.scanned));
  if (summary.healthy === 1) ok("healthy=1 (case A)");
  else bad("healthy", String(summary.healthy));
  if (summary.markedDone === 1) ok("markedDone=1 (case B)");
  else bad("markedDone", String(summary.markedDone));
  if (summary.killedDeadline === 1) ok("killedDeadline=1 (case C)");
  else bad("killedDeadline", String(summary.killedDeadline));
  if (summary.unverifiable === 1) ok("unverifiable=1 (case D)");
  else bad("unverifiable", String(summary.unverifiable));
  if (summary.killedOwnerless === 1) ok("killedOwnerless=1 (case E)");
  else bad("killedOwnerless", String(summary.killedOwnerless));

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
  else bad("case C: process still alive");
  // Stragglers list catches any survivors at exit.

  const stateD = readJob("job_DDDDDDDDD");
  if (stateD.status === "orphaned" && stateD.cause === "pid_reuse_or_unverifiable")
    ok("case D: orphaned/pid_reuse_or_unverifiable");
  else bad("case D status/cause", `${stateD.status}/${stateD.cause}`);
  if (pidAlive(aliveD.pid!)) ok("case D: ambiguous process untouched");
  else bad("case D: process was killed (misfire)");

  const stateE = readJob("job_EEEEEEEEE");
  if (stateE.status === "done" && stateE.cause === "owner_gone")
    ok("case E: done/owner_gone");
  else bad("case E status/cause", `${stateE.status}/${stateE.cause}`);
  if (!pidAlive(aliveE.pid!)) ok("case E: bash group killed when owner gone");
  else bad("case E: bash still alive after sweep");

  // Idempotence — second sweep is a no-op on the now-terminal records.
  const summary2 = await sweepJobs(projectDir);
  if (summary2.markedDone === 0 && summary2.killedDeadline === 0 && summary2.killedOwnerless === 0 && summary2.unverifiable === 0 && summary2.healthy === 1)
    ok("sweep is idempotent");
  else bad("sweep not idempotent", JSON.stringify(summary2));

  // Race guard: pre-flip a record to done before sweep runs. Sweep's outer
  // `state.status !== "running"` check exits early; the inner `commit()`
  // re-read guard isn't deterministically reachable from a smoke (would
  // need a synchronous scheduler hook), so we assert the observable: the
  // pre-flipped cause survives a sweep tick without being clobbered.
  const idR = "job_RRRRRRRRR";
  const aliveR = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveR.unref();
  stragglers.push(aliveR.pid!);
  await sleep(200);
  seedRunning(projectDir, { id: idR, pid: aliveR.pid!, command: "sleep 30", deadlineAt: past });
  const seeded = readJob(idR);
  writeState(projectDir, { ...seeded, status: "done", endedAt: Date.now(), cause: "completed" });
  const summary3 = await sweepJobs(projectDir);
  const stateR = readJob(idR);
  if (stateR.cause === "completed") ok("race: pre-flipped record kept its cause (no clobber)");
  else bad("race: cause clobbered", String(stateR.cause));
  if (summary3.killedDeadline === 0) ok("race: no spurious kill on already-done record");
  else bad("race: killedDeadline", String(summary3.killedDeadline));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("smoke crashed:", err); process.exit(2); });
