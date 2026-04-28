/**
 * Smoke: hardened bash kills the entire process group on timeout.
 *
 * Reproduces the qLDPC hang: a shell spawns python which spawns sleep, then
 * sleeps itself. Without process-group kill, only the shell would die and
 * the python+sleep grandchildren would orphan. We verify that after the
 * timeout fires, all three processes are gone and state.json records the
 * timeout cause.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobOwnerAls } from "../../src/jobs/als.js";
import { listJobIds, jobStatePath, type JobState } from "../../src/jobs/registry.js";
import { createHardenedBashTool } from "../../src/tools/bash-hardened.js";
import { pidAlive, sleep } from "../../src/utils.js";

let pass = 0, fail = 0;
function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function bad(label: string, detail?: string) {
  fail++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), "luxas-bash-hang-"));
  process.on("exit", () => { try { rmSync(projectDir, { recursive: true, force: true }); } catch {} });
  mkdirSync(join(projectDir, ".agent"), { recursive: true });
  const bash = createHardenedBashTool(projectDir);

  // Shell -> python -> sleep grandchild. Python prints its own pid AND the
  // sleep grandchild's pid as separate lines so the smoke can detect both
  // (verifies process-group kill reaches the full tree, not just the leaf).
  const command = `python3 -c '
import os, subprocess, sys, time
p = subprocess.Popen(["sleep", "999"])
sys.stdout.write(f"PYPID {os.getpid()}\\nSLEEPPID {p.pid}\\n")
sys.stdout.flush()
time.sleep(999)
'`;

  console.log("=== process tree kill on timeout ===");

  // Kick off execute without awaiting — we want to inspect state.json mid-flight.
  const execPromise = jobOwnerAls.run(
    { agentId: "smoke-test", agentType: "smoke", projectDir },
    () => bash.execute("call_smoke_1", { command, timeout: 3 } as any),
  );

  // Wait long enough for python+sleep to spawn but not for the 3s timeout to fire.
  await sleep(1500);

  const ids = listJobIds(projectDir);
  if (ids.length !== 1) bad(`expected 1 job dir, got ${ids.length}`);
  else ok("job dir created");

  const jobId = ids[0];
  const stateMid = JSON.parse(readFileSync(jobStatePath(projectDir, jobId), "utf-8")) as JobState;

  if (stateMid.status === "running") ok("state.status=running mid-flight");
  else bad("state.status mid-flight", stateMid.status);
  if (stateMid.ownerAgentId === "smoke-test") ok("ownerAgentId captured from ALS");
  else bad("ownerAgentId", stateMid.ownerAgentId);
  if (stateMid.toolCallId === "call_smoke_1") ok("toolCallId persisted");
  else bad("toolCallId", String(stateMid.toolCallId));
  if (stateMid.timeoutSec === 3) ok("timeoutSec=3");
  else bad("timeoutSec", String(stateMid.timeoutSec));

  // Detached spawn → child is its own process-group leader. ps will report
  // pgid === pid; this is what reconcile's processIsOurs check relies on.
  const shellPid = stateMid.pid;
  let shellPgid = -1;
  try {
    const out = execFileSync("ps", ["-p", String(shellPid), "-o", "pgid="], { encoding: "utf-8" }).trim();
    shellPgid = Number(out);
  } catch { /* ignore */ }
  if (shellPgid === shellPid) ok("ps reports pgid === pid (process-group leader)");
  else bad("pgid !== pid via ps", `${shellPgid} vs ${shellPid}`);

  if (!pidAlive(shellPid)) bad("shell pid not alive mid-flight");
  else ok("shell alive mid-flight");

  // Python prints its own pid and the sleep grandchild's pid separately.
  const log = readFileSync(stateMid.logPath, "utf-8");
  const pyMatch = log.match(/PYPID (\d+)/);
  const sleepMatch = log.match(/SLEEPPID (\d+)/);
  if (!pyMatch || !sleepMatch) bad("PYPID/SLEEPPID lines missing from output.log", `log:\n${log.slice(0, 400)}`);
  const pyPid = pyMatch ? Number(pyMatch[1]) : -1;
  const sleepPid = sleepMatch ? Number(sleepMatch[1]) : -1;
  if (pyPid > 0 && sleepPid > 0 && pyPid !== sleepPid) ok("python and sleep are distinct pids");
  else bad("python and sleep pids not distinct", `py=${pyPid} sleep=${sleepPid}`);
  if (pyPid > 0 && pidAlive(pyPid)) ok("python alive mid-flight");
  else if (pyPid > 0) bad("python pid not alive", String(pyPid));
  if (sleepPid > 0 && pidAlive(sleepPid)) ok("sleep grandchild alive mid-flight");
  else if (sleepPid > 0) bad("sleep pid not alive", String(sleepPid));

  // Now wait for the timeout to actually fire.
  let rejectErr: any = null;
  try { await execPromise; } catch (e) { rejectErr = e; }
  if (rejectErr && /timed out/i.test(rejectErr.message)) ok("execute rejected with timeout error");
  else bad("expected timeout rejection", rejectErr ? rejectErr.message.slice(0, 200) : "no rejection");

  // Give the kill timer + close handlers a beat to flush.
  await sleep(500);

  // All three processes should now be dead.
  if (!pidAlive(shellPid)) ok("shell killed");
  else bad("shell still alive after timeout", String(shellPid));
  if (pyPid > 0 && !pidAlive(pyPid)) ok("python killed");
  else if (pyPid > 0) bad("python still alive after timeout", String(pyPid));
  if (sleepPid > 0 && !pidAlive(sleepPid)) ok("sleep grandchild killed");
  else if (sleepPid > 0) bad("sleep grandchild still alive after timeout", String(sleepPid));

  // Final state.json should reflect the timeout.
  const stateEnd = JSON.parse(readFileSync(jobStatePath(projectDir, jobId), "utf-8")) as JobState;
  if (stateEnd.status === "done") ok("final state.status=done");
  else bad("final state.status", stateEnd.status);
  if (stateEnd.cause === "timeout") ok("final state.cause=timeout");
  else bad("final state.cause", String(stateEnd.cause));
  if (stateEnd.endedAt && stateEnd.endedAt > stateMid.startedAt) ok("endedAt set");
  else bad("endedAt not advanced");

  // ── External SIGTERM is reported as failure, not silent success ──
  // Regression for a bug where (code === null, sig === "SIGTERM") fell
  // through to resolve() because the only failure check was
  // `code !== 0 && code !== null`.
  console.log("\n=== external SIGTERM rejects ===");
  const sigPromise = jobOwnerAls.run(
    { agentId: "smoke-test", agentType: "smoke", projectDir },
    () => bash.execute("call_smoke_2", { command: "sleep 30", timeout: 30 } as any),
  );
  await sleep(200);
  const ids2 = listJobIds(projectDir).filter(i => i !== jobId);
  if (ids2.length !== 1) bad(`expected 1 new job dir, got ${ids2.length}`);
  const sigJobId = ids2[0];
  const sigState = JSON.parse(readFileSync(jobStatePath(projectDir, sigJobId), "utf-8")) as JobState;
  try { process.kill(-sigState.pid, "SIGTERM"); } catch {}
  let sigErr: any = null;
  try { await sigPromise; } catch (e) { sigErr = e; }
  if (sigErr && /signal SIGTERM/.test(sigErr.message)) ok("external SIGTERM surfaced as rejection");
  else bad("external SIGTERM not rejected", sigErr ? sigErr.message.slice(0, 200) : "resolved successfully");
  const sigEnd = JSON.parse(readFileSync(jobStatePath(projectDir, sigJobId), "utf-8")) as JobState;
  if (sigEnd.cause === "signal" && sigEnd.signal === "SIGTERM") ok("state cause=signal, signal=SIGTERM");
  else bad("state cause/signal", `${sigEnd.cause}/${sigEnd.signal}`);

  // ── SIGTERM-ignoring child still gets killed by SIGKILL after grace ──
  // Regression for a bug where killGroupAndWait gated SIGKILL on the
  // leader's liveness, leaving a SIGTERM-ignoring child alive forever.
  console.log("\n=== SIGTERM-ignoring child gets SIGKILL'd ===");
  const ignoreCmd = `python3 -c '
import os, signal, sys, time
print(f"PYPID {os.getpid()}", flush=True)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(60)
'`;
  const ignorePromise = jobOwnerAls.run(
    { agentId: "smoke-test", agentType: "smoke", projectDir },
    () => bash.execute("call_ignore", { command: ignoreCmd, timeout: 3 } as any),
  );
  await sleep(800); // let python install the SIGTERM handler
  const ignoreIds = listJobIds(projectDir).filter(i => i !== jobId && i !== sigJobId);
  if (ignoreIds.length !== 1) bad(`expected 1 ignore-test job, got ${ignoreIds.length}`);
  const ignoreJobId = ignoreIds[0];
  const ignoreLog = readFileSync(JSON.parse(readFileSync(jobStatePath(projectDir, ignoreJobId), "utf-8")).logPath, "utf-8");
  const ignorePyMatch = ignoreLog.match(/PYPID (\d+)/);
  const ignorePyPid = ignorePyMatch ? Number(ignorePyMatch[1]) : -1;
  if (ignorePyPid > 0 && pidAlive(ignorePyPid)) ok("python with SIGTERM-ignore alive mid-flight");
  else bad("could not establish python with SIGTERM-ignore", String(ignorePyPid));

  let ignoreErr: any = null;
  try { await ignorePromise; } catch (e) { ignoreErr = e; }
  if (ignoreErr) ok("timeout fired on ignore test");
  else bad("ignore test resolved without timeout");
  await sleep(800); // let SIGKILL reap
  if (ignorePyPid > 0 && !pidAlive(ignorePyPid)) ok("SIGTERM-ignoring python killed (always-SIGKILL after grace)");
  else bad("SIGTERM-ignoring python still alive (gated-SIGKILL regression)");

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("smoke crashed:", err); process.exit(2); });
