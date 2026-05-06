#!/usr/bin/env tsx
/**
 * smoke_bash_status_truth — verify hardened bash sets `status: "failed"` on
 * non-zero exit / signal / timeout instead of the historical lying "done".
 *
 * Bug B from the BOM investigation: bash-hardened.ts hardcoded `status: "done"`
 * in commitTerminal regardless of exit code, so brain reading active-agents
 * couldn't tell a clean exit from a crashed background job.
 *
 *   npx tsx scripts/smoke_bash_status_truth.mts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobOwnerAls } from "../src/jobs/als.js";
import { createHardenedBashTool } from "../src/tools/bash-hardened.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

const tmp = mkdtempSync(join(tmpdir(), "luxas-bash-truth-"));
try {
  const bash = createHardenedBashTool(tmp);
  const owner = { agentId: "smoke-test", agentType: "smoke", projectDir: tmp };

  console.log("1. clean exit (true)");
  const okResult = await jobOwnerAls.run(owner, () =>
    bash.execute("call-1", { command: "true" } as any),
  );
  check(`status === "done" on clean exit`, okResult.details.status === "done",
    `got ${okResult.details.status}`);
  if (okResult.details.jobId) {
    const stateFile = join(tmp, ".agent", "jobs", okResult.details.jobId, "state.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      check(`state.json status === "done"`, state.status === "done", `got ${state.status}`);
    }
  }

  console.log("\n2. non-zero exit (false)");
  let crashErr: any;
  try {
    await jobOwnerAls.run(owner, () =>
      bash.execute("call-2", { command: "false" } as any),
    );
    check("rejected on non-zero exit", false, "should have thrown");
  } catch (e: any) {
    crashErr = e;
    check("rejected on non-zero exit", true);
  }
  // The promise rejects — the result obj isn't returned, but the state.json
  // committed before reject should reflect "failed". Find the most recent job.
  const jobsDir = join(tmp, ".agent", "jobs");
  if (existsSync(jobsDir)) {
    const dirs = readdirSync(jobsDir)
      .map(name => ({ name, mtime: statSync(join(jobsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const lastJob = dirs[0].name;
    const stateFile = join(jobsDir, lastJob, "state.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      check(`state.json status === "failed" on exit code 1`,
        state.status === "failed", `got ${state.status}`);
      check(`state.json exitCode === 1`, state.exitCode === 1, `got ${state.exitCode}`);
    }
  }

  console.log("\n3. exit 137 (simulated crash via explicit code)");
  try {
    await jobOwnerAls.run(owner, () =>
      bash.execute("call-3", { command: "exit 137" } as any),
    );
    check("rejected on exit 137", false, "should have thrown");
  } catch (e: any) {
    check("rejected on exit 137", true);
  }
  if (existsSync(jobsDir)) {
    const dirs = readdirSync(jobsDir)
      .map(name => ({ name, mtime: statSync(join(jobsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const lastJob = dirs[0].name;
    const stateFile = join(jobsDir, lastJob, "state.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      check(`state.json status === "failed" on exit 137`,
        state.status === "failed", `got ${state.status}`);
    }
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
