/**
 * Drop-in replacement for pi-coding-agent's bash. The upstream tool spawns
 * detached and kills the process group, but it has no default timeout
 * (`timeout?: number` with explicit "no default") and goes straight to
 * SIGKILL with no grace. This wrapper forces a 600s default, gives 2s
 * SIGTERM grace, and persists every invocation under .agent/jobs/<id>/.
 *
 * Process-group semantics: spawn(..., { detached: true }) makes the child
 * the leader of a new process group on POSIX (this is the documented
 * Node.js behavior; there is no setpgid API in node — `detached: true` is
 * how you get it). process.kill(-pid, sig) then reaches the whole group,
 * killing shell + python + grandchildren together. Without `detached`, a
 * negative-pid kill targets *our* group and SIGTERMs the agent itself.
 */

import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
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

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({
    description: `Optional timeout in seconds. Default ${DEFAULT_TIMEOUT_SEC}s, max ${MAX_TIMEOUT_SEC}s. ` +
      `On timeout the entire process group is killed (SIGTERM, 2s grace, SIGKILL).`,
  })),
});

type BashParams = Static<typeof bashSchema>;

interface BashResult {
  truncation?: ReturnType<typeof truncateTail>;
  jobId?: string;
  logPath?: string;
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

export function createHardenedBashTool(cwd: string) {
  return {
    name: "bash",
    label: "bash",
    description:
      `Execute a bash command in the current working directory. Returns stdout and stderr ` +
      `(merged in chronological order; full transcript also written to .agent/jobs/<id>/output.log). ` +
      `Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. ` +
      `Default timeout ${DEFAULT_TIMEOUT_SEC}s, max ${MAX_TIMEOUT_SEC}s — on timeout the entire ` +
      `process group is killed.`,
    parameters: bashSchema,
    execute: (
      toolCallId: string,
      params: BashParams,
      signal?: AbortSignal,
      onUpdate?: (partial: { content: any[]; details?: BashResult }) => void,
    ): Promise<{ content: any[]; details: BashResult }> => {
      const requested = params.timeout ?? DEFAULT_TIMEOUT_SEC;
      const timeoutSec = Math.min(Math.max(1, requested), MAX_TIMEOUT_SEC);

      // Falls back to "unknown" if a bash call slips past wrapping (smoke
      // tests, direct tool invocation). Production paths are wrapped in
      // jobOwnerAls.run() at every agent entry point.
      const owner = currentJobOwner();
      const ownerAgentId = owner?.agentId ?? "unknown";
      const ownerAgentType = owner?.agentType ?? "unknown";
      const projectDir = owner?.projectDir ?? cwd;

      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", params.command], {
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

        // setImmediate-coalesced onUpdate. Without this, a high-throughput
        // stdout (pip install logs, training output) triggers a full
        // Buffer.concat + truncateTail on every chunk → O(N²) in chunk
        // count. Coalescing collapses bursts into one notify per tick.
        let updatePending = false;
        const flushUpdate = () => {
          updatePending = false;
          if (!onUpdate) return;
          const text = Buffer.concat(chunks).toString("utf-8");
          const trunc = truncateTail(text);
          onUpdate({
            content: [{ type: "text", text: trunc.content || "" }],
            details: { truncation: trunc.truncated ? trunc : undefined, jobId, logPath },
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
          if (onUpdate && !updatePending) {
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

        // Both `error` and `close` can fire on Node (e.g. ENOENT spawn → error
        // then close with code=null). The settled flag guarantees a single
        // termination path: one writeState, one logStream.end, one settle.
        let settled = false;
        const finalize = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          if (killTimer) clearTimeout(killTimer);
          if (signal) signal.removeEventListener("abort", onAbort);
          logStream.end();
          fn();
        };

        child.on("error", (err) => finalize(() => {
          writeState(projectDir, {
            ...initialState,
            status: "done", endedAt: Date.now(),
            exitCode: null, signal: null,
            cause: `spawn_error:${(err as any)?.code ?? err.message}` as JobCause,
          });
          reject(err);
        }));

        child.on("close", (code, sig) => finalize(() => {
          const fullOutput = Buffer.concat(chunks).toString("utf-8");
          const trunc = truncateTail(fullOutput);
          let outputText = trunc.content || "(no output)";
          if (trunc.truncated) outputText += formatTrailer(trunc, fullOutput, logPath);

          const cause: JobCause = timedOut ? "timeout"
            : aborted ? "aborted"
            : sig ? "signal"
            : "completed";

          writeState(projectDir, {
            ...initialState,
            status: "done", endedAt: Date.now(),
            exitCode: code, signal: sig ?? null, cause,
          });

          const failureDetails: BashResult = { truncation: trunc.truncated ? trunc : undefined, jobId, logPath };

          if (timedOut) {
            const err: any = new Error(
              (outputText ? outputText + "\n\n" : "") +
              `Command timed out after ${timeoutSec} seconds (process group killed). Job ${jobId}, log at ${logPath}.`,
            );
            err.details = failureDetails;
            reject(err);
            return;
          }
          if (aborted) {
            reject(new Error((outputText ? outputText + "\n\n" : "") + "Command aborted"));
            return;
          }
          if (code !== 0 && code !== null) {
            reject(new Error(outputText + `\n\nCommand exited with code ${code}` + (sig ? ` (signal ${sig})` : "")));
            return;
          }
          if (sig) {
            // External signal (e.g. SIGTERM from outside the agent stack):
            // code is null and we never went through timedOut/aborted, but the
            // command did not complete normally. Report as failure so callers
            // don't treat a killed command as a successful no-op.
            reject(new Error((outputText ? outputText + "\n\n" : "") + `Command killed by signal ${sig}`));
            return;
          }
          resolve({ content: [{ type: "text", text: outputText }], details: failureDetails });
        }));
      });
    },
  };
}
