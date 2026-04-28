/**
 * Smoke: reconcileOnStartup correctly classifies leftover bash jobs.
 *
 *   A. pid is gone           → mark done, cause=process_gone_during_outage
 *   B. pid alive AND ours    → SIGTERM/SIGKILL the group, mark done, cause=reconcile_orphan_killed
 *   C. pid alive, wrong cmd  → mark orphaned (no kill), cause=pid_reuse_or_unverifiable
 *
 * Case C asserts the misfire-safety guarantee: when ownership cannot be
 * verified (pid reuse, missing ps), reconcile must leave the process
 * untouched and surface it for human cleanup.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileOnStartup, jobStatePath, type JobState } from "../../src/jobs/registry.js";
import { pidAlive, sleep } from "../../src/utils.js";
import { seedRunning } from "../test-helpers/seed-job.js";

let pass = 0, fail = 0;
function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function bad(label: string, detail?: string) {
  fail++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), "luxas-bash-resume-"));
  const stragglers: number[] = [];
  process.on("exit", () => {
    for (const pid of stragglers) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });
  mkdirSync(join(projectDir, ".agent"), { recursive: true });

  // Case A: spawn-and-die yields a guaranteed used-then-freed pid.
  const dead = spawn("/bin/bash", ["-c", "true"], { detached: true, stdio: "ignore" });
  const deadPid = dead.pid!;
  await new Promise<void>(r => dead.on("close", () => r()));
  await sleep(50);
  seedRunning(projectDir, { id: "job_aaaaaa111111", pid: deadPid, command: "echo gone-pid" });

  // Case B: bash -c with a single command exec-replaces into "sleep 30",
  // so ps -o command= reports "sleep 30" — exact match with state.command.
  const aliveB = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveB.unref();
  stragglers.push(aliveB.pid!);
  await sleep(200);
  if (!pidAlive(aliveB.pid!)) bad("setup: case B child died early");
  seedRunning(projectDir, { id: "job_bbbbbb222222", pid: aliveB.pid!, command: "sleep 30" });

  // Case C: same kind of process, mismatched recorded command. Reconcile
  // must classify orphaned without killing.
  const aliveC = spawn("/bin/bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  aliveC.unref();
  stragglers.push(aliveC.pid!);
  await sleep(200);
  seedRunning(projectDir, { id: "job_cccccc333333", pid: aliveC.pid!, command: "definitely-not-the-real-command-XYZ" });

  const summary = await reconcileOnStartup(projectDir);

  if (summary.scanned === 3) ok("scanned 3 jobs");
  else bad("scanned", String(summary.scanned));
  if (summary.markedDone === 1) ok("markedDone=1 (case A)");
  else bad("markedDone", String(summary.markedDone));
  if (summary.killedOrphans === 1) ok("killedOrphans=1 (case B)");
  else bad("killedOrphans", String(summary.killedOrphans));
  if (summary.unverifiable === 1) ok("unverifiable=1 (case C)");
  else bad("unverifiable", String(summary.unverifiable));

  const readJob = (id: string) => JSON.parse(readFileSync(jobStatePath(projectDir, id), "utf-8")) as JobState;

  const stateA = readJob("job_aaaaaa111111");
  if (stateA.status === "done" && stateA.cause === "process_gone_during_outage") ok("case A: done/process_gone_during_outage");
  else bad("case A status/cause", `${stateA.status}/${stateA.cause}`);

  const stateB = readJob("job_bbbbbb222222");
  if (stateB.status === "done" && stateB.cause === "reconcile_orphan_killed") ok("case B: done/reconcile_orphan_killed");
  else bad("case B status/cause", `${stateB.status}/${stateB.cause}`);

  await sleep(300);
  if (!pidAlive(aliveB.pid!)) ok("case B: process killed by reconcile");
  else bad("case B: process still alive", String(aliveB.pid));

  const stateC = readJob("job_cccccc333333");
  if (stateC.status === "orphaned" && stateC.cause === "pid_reuse_or_unverifiable") ok("case C: orphaned/pid_reuse_or_unverifiable");
  else bad("case C status/cause", `${stateC.status}/${stateC.cause}`);

  if (pidAlive(aliveC.pid!)) ok("case C: ambiguous process untouched");
  else bad("case C: process was killed (misfire — conservative path violated)");
  // Stragglers exit handler catches any survivors.

  const summary2 = await reconcileOnStartup(projectDir);
  if (summary2.alreadyDone === 3 && summary2.markedDone === 0 && summary2.killedOrphans === 0) {
    ok("reconcile is idempotent");
  } else {
    bad("idempotence broken", JSON.stringify(summary2));
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("smoke crashed:", err); process.exit(2); });
