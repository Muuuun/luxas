/**
 * Shared smoke helper: write a `running` job record so reconcile/sweep
 * smokes can drive the registry without spinning up a real bash invocation.
 */

import { join } from "node:path";
import { writeState } from "../../src/jobs/registry.js";

export interface SeedRunningOptions {
  id: string;
  pid: number;
  command: string;
  /** Defaults to 10 minutes in the future (healthy window). */
  deadlineAt?: number;
  ownerAgentId?: string;
  ownerAgentType?: string;
  /** Defaults to current process.pid (the test runner) so sweep treats it as alive-owner. */
  ownerProcessPid?: number;
}

export function seedRunning(projectDir: string, opts: SeedRunningOptions): void {
  const now = Date.now();
  writeState(projectDir, {
    id: opts.id,
    pid: opts.pid,
    command: opts.command,
    ownerAgentId: opts.ownerAgentId ?? "smoke-test",
    ownerAgentType: opts.ownerAgentType ?? "smoke",
    ownerProcessPid: opts.ownerProcessPid ?? process.pid,
    toolCallId: null,
    cwd: projectDir,
    startedAt: now - 5000,
    deadlineAt: opts.deadlineAt ?? now + 600_000,
    timeoutSec: 600,
    status: "running",
    endedAt: null, exitCode: null, signal: null, cause: null,
    logPath: join(projectDir, ".agent", "jobs", opts.id, "output.log"),
  });
}
