/**
 * Drop-in replacement for pi-coding-agent's bash. The upstream tool spawns
 * detached and kills the process group, but it has no default timeout
 * (`timeout?: number` with explicit "no default") and goes straight to
 * SIGKILL with no grace. This wrapper forces a 600s default, gives 2s
 * SIGTERM grace, persists every invocation under .agent/jobs/<id>/, and
 * supports two backgrounding modes:
 *
 *   - run_in_background=true: returns a handle immediately; the agent
 *     uses job_status / job_output / job_wait / job_kill to observe.
 *   - foreground (default): waits for completion; if the call hasn't
 *     finished within FOREGROUND_BUDGET_MS (90s), auto-promotes to a
 *     handle so the agent's turn isn't blocked indefinitely. The
 *     in-process timer/close handlers stay wired — the deadline still
 *     fires, the terminal state.json still gets written.
 *
 * Process-group semantics: spawn(..., { detached: true }) makes the child
 * the leader of a new process group on POSIX. process.kill(-pid, sig)
 * then reaches the whole group, killing shell + python + grandchildren
 * together. Without `detached`, a negative-pid kill targets *our* group
 * and SIGTERMs the agent itself.
 */

import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { totalmem } from "node:os";
import { Type, type Static } from "@sinclair/typebox";
import {
  truncateTail, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import {
  newJobId, jobLogPath, writeState, SIGTERM_GRACE_MS,
  type JobState, type JobCause,
} from "../jobs/registry.js";
import { currentJobOwner } from "../jobs/als.js";

const DEFAULT_TIMEOUT_SEC = 600;
const MAX_TIMEOUT_SEC = 30 * 60;
export const FOREGROUND_BUDGET_MS = 90_000;

// Per-experiment memory ceiling, auto-sized to the machine: cap experiment-tier
// python at 75% of total RAM so a runaway allocation fails with a clean
// MemoryError instead of the kernel OOM-killer (which takes down the whole run —
// brain + every sibling experiment — as it did 2026-07-02). 75% leaves headroom
// for the brain, sibling experiments, and the inbox/studio services.
const EXPERIMENT_MEM_CAP_KB = Math.floor((totalmem() / 1024) * 0.75);

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({
    description: `Optional timeout in seconds. Default ${DEFAULT_TIMEOUT_SEC}s, max ${MAX_TIMEOUT_SEC}s. ` +
      `On timeout the entire process group is killed (SIGTERM, 2s grace, SIGKILL).`,
  })),
  run_in_background: Type.Optional(Type.Boolean({
    description:
      `When true, return a job handle immediately without waiting for the command to finish. ` +
      `Use job_status / job_output / job_wait / job_kill to observe. ` +
      `Foreground (default) auto-promotes to a handle if the command hasn't finished in ${FOREGROUND_BUDGET_MS / 1000}s.`,
  })),
});

type BashParams = Static<typeof bashSchema>;

export interface BashOptions {
  /**
   * Override foreground budget (test seam). Production uses
   * FOREGROUND_BUDGET_MS; smokes set a shorter value to exercise auto-
   * promote in real time.
   */
  foregroundBudgetMs?: number;
}

interface BashResult {
  truncation?: ReturnType<typeof truncateTail>;
  jobId?: string;
  logPath?: string;
  status?: "running" | "done" | "failed";
}

function formatTrailer(
  trunc: ReturnType<typeof truncateTail>,
  fullOutput: string,
  logPath: string,
): string {
  const startLine = trunc.totalLines - trunc.outputLines + 1;
  const endLine = trunc.totalLines;
  let head: string;
  if (trunc.lastLinePartial) {
    const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
    head = `Showing last ${formatSize(trunc.outputBytes)} of line ${endLine} (line is ${lastLineSize})`;
  } else if (trunc.truncatedBy === "lines") {
    head = `Showing lines ${startLine}-${endLine} of ${trunc.totalLines}`;
  } else {
    head = `Showing lines ${startLine}-${endLine} of ${trunc.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
  }
  return `\n\n[${head}. Full output: ${logPath}]`;
}

export function createHardenedBashTool(cwd: string, opts?: BashOptions) {
  const foregroundBudgetMs = opts?.foregroundBudgetMs ?? FOREGROUND_BUDGET_MS;
  return {
    name: "bash",
    label: "bash",
    description:
      `Execute a bash command in the current working directory. Returns stdout and stderr ` +
      `(merged in chronological order; full transcript also written to .agent/jobs/<id>/output.log). ` +
      `Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. ` +
      `Default timeout ${DEFAULT_TIMEOUT_SEC}s, max ${MAX_TIMEOUT_SEC}s — on timeout the entire ` +
      `process group is killed. Set run_in_background=true to return a job handle immediately ` +
      `(observe via job_status/job_output/job_wait/job_kill); otherwise foreground auto-promotes ` +
      `to a handle after ${foregroundBudgetMs / 1000}s.`,
    parameters: bashSchema,
    execute: (
      toolCallId: string,
      params: BashParams,
      signal?: AbortSignal,
      onUpdate?: (partial: { content: any[]; details?: BashResult }) => void,
    ): Promise<{ content: any[]; details: BashResult }> => {
      const requested = params.timeout ?? DEFAULT_TIMEOUT_SEC;
      const timeoutSec = Math.min(Math.max(1, requested), MAX_TIMEOUT_SEC);
      const runInBackground = params.run_in_background === true;

      const owner = currentJobOwner();
      const ownerAgentId = owner?.agentId ?? "unknown";
      const ownerAgentType = owner?.agentType ?? "unknown";
      const projectDir = owner?.projectDir ?? cwd;

      // Cap address space for the python-heavy experiment-tier agents only;
      // brain/light bash runs node tools (search) that reserve huge virtual
      // address space, so leave it uncapped. See EXPERIMENT_MEM_CAP_KB above.
      const cmd = /experiment|tool_impl|tool_review/i.test(ownerAgentType)
        ? `ulimit -v ${EXPERIMENT_MEM_CAP_KB} 2>/dev/null; ${params.command}`
        : params.command;

      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", cmd], {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const pid = child.pid;
        if (!pid) {
          reject(new Error("Failed to spawn bash: no pid"));
          return;
        }

        const jobId = newJobId();
        const startedAt = Date.now();
        const logPath = jobLogPath(projectDir, jobId);

        const initialState: JobState = {
          id: jobId,
          ownerAgentId, ownerAgentType,
          ownerProcessPid: process.pid,
          toolCallId: toolCallId ?? null,
          command: params.command,
          cwd,
          pid,
          startedAt,
          deadlineAt: startedAt + timeoutSec * 1000,
          timeoutSec,
          status: "running",
          endedAt: null, exitCode: null, signal: null, cause: null,
          logPath,
        };
        writeState(projectDir, initialState);  // creates the job dir
        const logStream: WriteStream = createWriteStream(logPath);

        const chunks: Buffer[] = [];
        let chunksBytes = 0;
        const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

        // Two independent one-shot flags: the promise can resolve early
        // (run_in_background or 90s foreground budget) while the in-process
        // close handler still has to commit the terminal state.json. They
        // cannot collapse into a single `settled` flag.
        let promiseSettled = false;
        let stateCommitted = false;
        const settlePromise = (value: { content: any[]; details: BashResult }): void => {
          if (promiseSettled) return;
          promiseSettled = true;
          resolve(value);
        };
        const rejectPromise = (err: Error): void => {
          if (promiseSettled) return;
          promiseSettled = true;
          reject(err);
        };
        const commitTerminal = (next: JobState): void => {
          if (stateCommitted) return;
          stateCommitted = true;
          writeState(projectDir, next);
        };

        let updatePending = false;
        const flushUpdate = () => {
          updatePending = false;
          if (!onUpdate || promiseSettled) return;
          const text = Buffer.concat(chunks).toString("utf-8");
          const trunc = truncateTail(text);
          onUpdate({
            content: [{ type: "text", text: trunc.content || "" }],
            details: { truncation: trunc.truncated ? trunc : undefined, jobId, logPath, status: "running" },
          });
        };

        const handleData = (data: Buffer) => {
          logStream.write(data);
          chunks.push(data);
          chunksBytes += data.length;
          while (chunksBytes > maxChunksBytes && chunks.length > 1) {
            const removed = chunks.shift()!;
            chunksBytes -= removed.length;
          }
          if (onUpdate && !promiseSettled && !updatePending) {
            updatePending = true;
            setImmediate(flushUpdate);
          }
        };
        child.stdout?.on("data", handleData);
        child.stderr?.on("data", handleData);

        let timedOut = false;
        let aborted = false;
        let killTimer: NodeJS.Timeout | null = null;

        const killGroup = () => {
          try { process.kill(-pid, "SIGTERM"); } catch { /* group may already be exiting */ }
          if (killTimer) return;
          killTimer = setTimeout(() => {
            try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
          }, SIGTERM_GRACE_MS);
          killTimer.unref?.();
        };

        const timeoutHandle = setTimeout(() => { timedOut = true; killGroup(); }, timeoutSec * 1000);
        const onAbort = () => { aborted = true; killGroup(); };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        const handleResult = (): { content: any[]; details: BashResult } => ({
          content: [{
            type: "text",
            text:
              `Job ${jobId} running in background (pid ${pid}, deadline ${timeoutSec}s). ` +
              `Use job_wait/job_status/job_output to observe, job_kill to terminate. Log: ${logPath}`,
          }],
          details: { jobId, logPath, status: "running" },
        });

        // run_in_background=true: settle the promise immediately. The child
        // keeps running, child.on("close") still fires later and writes the
        // terminal state.json (rejectPromise/settlePromise are no-ops by then).
        if (runInBackground) {
          settlePromise(handleResult());
        }

        // Foreground budget: if the command hasn't finished in
        // foregroundBudgetMs, auto-promote so the agent's turn isn't blocked
        // for the full timeoutSec. The process keeps running.
        const budgetTimer = !runInBackground
          ? setTimeout(() => settlePromise(handleResult()), foregroundBudgetMs)
          : null;
        budgetTimer?.unref?.();

        child.on("error", (err) => {
          clearTimeout(timeoutHandle);
          if (budgetTimer) clearTimeout(budgetTimer);
          if (killTimer) clearTimeout(killTimer);
          if (signal) signal.removeEventListener("abort", onAbort);
          logStream.end();
          commitTerminal({
            ...initialState,
            status: "failed", endedAt: Date.now(),
            exitCode: null, signal: null,
            cause: `spawn_error:${(err as any)?.code ?? err.message}` as JobCause,
          });
          rejectPromise(err);
        });

        child.on("close", (code, sig) => {
          clearTimeout(timeoutHandle);
          if (budgetTimer) clearTimeout(budgetTimer);
          if (killTimer) clearTimeout(killTimer);
          if (signal) signal.removeEventListener("abort", onAbort);
          logStream.end();

          const fullOutput = Buffer.concat(chunks).toString("utf-8");
          const trunc = truncateTail(fullOutput);
          let outputText = trunc.content || "(no output)";
          if (trunc.truncated) outputText += formatTrailer(trunc, fullOutput, logPath);

          const cause: JobCause = timedOut ? "timeout"
            : aborted ? "aborted"
            : sig ? "signal"
            : "completed";

          // status reflects success: only "done" if exited cleanly with code 0
          // and no signal/timeout/abort. Anything else is "failed" so callers
          // (job_status, brain reading active-agents) see the truth instead of
          // a lying "done" on a crashed job.
          const finalStatus: "done" | "failed" =
            (code === 0 && !sig && !timedOut && !aborted) ? "done" : "failed";

          commitTerminal({
            ...initialState,
            status: finalStatus, endedAt: Date.now(),
            exitCode: code, signal: sig ?? null, cause,
          });

          const details: BashResult = {
            truncation: trunc.truncated ? trunc : undefined,
            jobId, logPath, status: finalStatus,
          };

          if (timedOut) {
            const err: any = new Error(
              (outputText ? outputText + "\n\n" : "") +
              `Command timed out after ${timeoutSec} seconds (process group killed). Job ${jobId}, log at ${logPath}.`,
            );
            err.details = details;
            rejectPromise(err);
            return;
          }
          if (aborted) {
            rejectPromise(new Error((outputText ? outputText + "\n\n" : "") + "Command aborted"));
            return;
          }
          if (code !== 0 && code !== null) {
            rejectPromise(new Error(outputText + `\n\nCommand exited with code ${code}` + (sig ? ` (signal ${sig})` : "")));
            return;
          }
          if (sig) {
            rejectPromise(new Error((outputText ? outputText + "\n\n" : "") + `Command killed by signal ${sig}`));
            return;
          }
          settlePromise({ content: [{ type: "text", text: outputText }], details });
        });
      });
    },
  };
}
