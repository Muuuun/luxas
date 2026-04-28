/**
 * Agent-facing tools for observing and controlling background bash jobs
 * (run_in_background=true or auto-promoted at FOREGROUND_BUDGET_MS).
 *
 * Ownership: every tool reads currentJobOwner() from ALS and refuses to
 * operate on jobs whose ownerAgentId doesn't match. An agent only sees its
 * own jobs. Parent visibility into child jobs is a separate concern (Owner
 * Exit Gate / sub-agent contract); not bundled here so the tools stay
 * predictable and an agent can't accidentally signal a sibling's process.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { Type, type Static } from "@sinclair/typebox";
import {
  readState, listJobsByOwner, safeKillJob, waitForJob,
  type JobState,
} from "../jobs/registry.js";
import { currentJobOwner } from "../jobs/als.js";

/**
 * Bound on bytes read from output.log when serving job_output. Background
 * jobs producing GB-scale logs would OOM a `readFileSync` tail. We read at
 * most this many bytes from the end of the file and slice into lines from
 * there. The agent's `tail` parameter still applies inside the window.
 */
const MAX_TAIL_BYTES = 256 * 1024;

function summarize(state: JobState): {
  id: string; status: string; cause: string | null;
  ownerAgentId: string; pid: number; startedAt: number;
  endedAt: number | null; deadlineAt: number;
  command: string; logPath: string;
} {
  return {
    id: state.id,
    status: state.status,
    cause: state.cause,
    ownerAgentId: state.ownerAgentId,
    pid: state.pid,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    deadlineAt: state.deadlineAt,
    command: state.command.length > 200 ? state.command.slice(0, 200) + "…" : state.command,
    logPath: state.logPath,
  };
}

function errResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

function ownerOrError(): { agentId: string; projectDir: string } | { err: string } {
  const owner = currentJobOwner();
  if (!owner) return { err: "Tool called outside an agent context (no job owner in ALS)." };
  return { agentId: owner.agentId, projectDir: owner.projectDir };
}

function loadOwnedJob(jobId: string): { state: JobState; projectDir: string } | { err: string } {
  const owner = ownerOrError();
  if ("err" in owner) return owner;
  const state = readState(owner.projectDir, jobId);
  if (!state) return { err: `Job ${jobId} not found.` };
  if (state.ownerAgentId !== owner.agentId) {
    return { err: `Job ${jobId} is owned by ${state.ownerAgentId}, not ${owner.agentId}.` };
  }
  return { state, projectDir: owner.projectDir };
}

// ── job_status ─────────────────────────────────────────

const statusSchema = Type.Object({
  job_id: Type.Optional(Type.String({
    description: "When provided, return that specific job's full state. When omitted, list all jobs you own.",
  })),
});

function createJobStatusTool() {
  return {
    name: "job_status",
    label: "job_status",
    description:
      "Inspect bash jobs. With job_id: returns that job's status, cause, exit code, signal, deadline, log path. " +
      "Without job_id: lists every job you've launched. Restricted to jobs you own.",
    parameters: statusSchema,
    execute: async (
      _toolCallId: string,
      params: Static<typeof statusSchema>,
    ) => {
      const owner = ownerOrError();
      if ("err" in owner) return errResult(owner.err);
      if (params.job_id) {
        const r = loadOwnedJob(params.job_id);
        if ("err" in r) return errResult(r.err);
        return { content: [{ type: "text", text: JSON.stringify(summarize(r.state), null, 2) }], details: {} };
      }
      const jobs = listJobsByOwner(owner.projectDir, owner.agentId).map(summarize);
      const text = jobs.length === 0
        ? "(no jobs)"
        : jobs.map(j => `${j.id}\t${j.status}${j.cause ? `/${j.cause}` : ""}\tpid=${j.pid}\t${j.command}`).join("\n");
      return { content: [{ type: "text", text }], details: { count: jobs.length } };
    },
  };
}

// ── job_output ─────────────────────────────────────────

const outputSchema = Type.Object({
  job_id: Type.String({ description: "Job id from a prior bash call or job_status." }),
  tail: Type.Optional(Type.Number({
    description: "Return the last N lines of the log. Default 100.",
  })),
});

/**
 * Bounded tail read: open the log, seek to size - MAX_TAIL_BYTES, read up
 * to MAX_TAIL_BYTES, drop the (possibly truncated) first line if we didn't
 * start at offset 0, then slice the last `tail` lines from what remains.
 * Memory cost is bounded by MAX_TAIL_BYTES regardless of file size.
 */
function readTail(logPath: string, tail: number): { text: string; sizeBytes: number; truncated: boolean } {
  const sizeBytes = statSync(logPath).size;
  const startOffset = Math.max(0, sizeBytes - MAX_TAIL_BYTES);
  const readLen = sizeBytes - startOffset;
  const buf = Buffer.alloc(readLen);
  const fd = openSync(logPath, "r");
  try {
    if (readLen > 0) readSync(fd, buf, 0, readLen, startOffset);
  } finally {
    closeSync(fd);
  }
  let text = buf.toString("utf-8");
  if (startOffset > 0) {
    const nl = text.indexOf("\n");
    text = nl >= 0 ? text.slice(nl + 1) : "";
  }
  const lines = text.split("\n");
  const sliceFrom = Math.max(0, lines.length - tail - (lines[lines.length - 1] === "" ? 1 : 0));
  return {
    text: lines.slice(sliceFrom).join("\n"),
    sizeBytes,
    truncated: startOffset > 0,
  };
}

function createJobOutputTool() {
  return {
    name: "job_output",
    label: "job_output",
    description:
      `Read tail of a job's output.log. Default 100 lines. Reads at most ${MAX_TAIL_BYTES / 1024}KB ` +
      `from the end of the log regardless of total size — long-running jobs with GB-scale logs are safe. ` +
      `Restricted to jobs you own.`,
    parameters: outputSchema,
    execute: async (
      _toolCallId: string,
      params: Static<typeof outputSchema>,
    ) => {
      const r = loadOwnedJob(params.job_id);
      if ("err" in r) return errResult(r.err);
      const tail = Math.max(1, Math.min(10_000, params.tail ?? 100));
      if (!existsSync(r.state.logPath)) {
        return errResult(`Log file missing: ${r.state.logPath}`);
      }
      const { text, sizeBytes, truncated } = readTail(r.state.logPath, tail);
      const truncNote = truncated ? `; window=last ${MAX_TAIL_BYTES / 1024}KB` : "";
      const header = `[${r.state.id} ${r.state.status}${r.state.cause ? `/${r.state.cause}` : ""}; ` +
        `${sizeBytes} bytes total; tail=${tail}${truncNote}]\n`;
      return {
        content: [{ type: "text", text: header + text }],
        details: { jobId: r.state.id, sizeBytes, truncated },
      };
    },
  };
}

// ── job_wait ───────────────────────────────────────────

const waitSchema = Type.Object({
  job_id: Type.String({ description: "Job id to wait on." }),
  timeout: Type.Optional(Type.Number({
    description: "Max seconds to block. Default 300.",
  })),
});

function createJobWaitTool() {
  return {
    name: "job_wait",
    label: "job_wait",
    description:
      "Block until the given job leaves the `running` state, or `timeout` seconds elapse. " +
      "Returns the final status and a short log tail. Restricted to jobs you own.",
    parameters: waitSchema,
    execute: async (
      _toolCallId: string,
      params: Static<typeof waitSchema>,
    ) => {
      const owner = ownerOrError();
      if ("err" in owner) return errResult(owner.err);
      const initial = readState(owner.projectDir, params.job_id);
      if (!initial) return errResult(`Job ${params.job_id} not found.`);
      if (initial.ownerAgentId !== owner.agentId) {
        return errResult(`Job ${params.job_id} is owned by ${initial.ownerAgentId}, not ${owner.agentId}.`);
      }
      const timeoutMs = Math.max(1, Math.min(3600, params.timeout ?? 300)) * 1000;
      const final = await waitForJob(owner.projectDir, params.job_id, timeoutMs);
      if (!final) return errResult(`Job ${params.job_id} record disappeared mid-wait.`);
      if (final.status === "running") {
        return errResult(
          `job_wait timed out after ${timeoutMs / 1000}s; job ${params.job_id} still running. ` +
          `Either job_kill it or call job_wait again with a longer timeout.`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(summarize(final), null, 2) }],
        details: { jobId: final.id, status: final.status, cause: final.cause },
      };
    },
  };
}

// ── job_kill ───────────────────────────────────────────

const killSchema = Type.Object({
  job_id: Type.String({ description: "Job id to kill." }),
});

function createJobKillTool() {
  return {
    name: "job_kill",
    label: "job_kill",
    description:
      "Send SIGTERM to the job's process group (2s grace, then SIGKILL). " +
      "Idempotent on already-terminal jobs. Restricted to jobs you own.",
    parameters: killSchema,
    execute: async (
      _toolCallId: string,
      params: Static<typeof killSchema>,
    ) => {
      const r = loadOwnedJob(params.job_id);
      if ("err" in r) return errResult(r.err);
      if (r.state.status !== "running") {
        return {
          content: [{ type: "text", text: `Job ${params.job_id} already terminal (${r.state.status}/${r.state.cause}). No action.` }],
          details: { jobId: params.job_id, status: r.state.status },
        };
      }
      // safeKillJob verifies the live process group still matches our
      // recorded command before signalling — defends against killing a
      // recycled pid that now belongs to an unrelated process.
      const result = await safeKillJob(r.state);
      if (!result.killed) {
        return {
          content: [{ type: "text", text: `Did not kill job ${params.job_id} (pid ${r.state.pid}): ${result.reason}.` }],
          details: { jobId: params.job_id, killed: false, reason: result.reason },
        };
      }
      // Don't write state.json here — let the in-process child.on("close")
      // commit the terminal state with the actual exit code/signal. If the
      // close handler is somehow not wired (orphan pid), sweep will pick it
      // up within 15s with cause=process_gone_since_last_sweep.
      return {
        content: [{ type: "text", text: `Killed job ${params.job_id} (pid ${r.state.pid}).` }],
        details: { jobId: params.job_id, killed: true },
      };
    },
  };
}

export function createJobControlTools(_projectDir: string): any[] {
  // Tools read projectDir from ALS at execute time, so we don't capture it
  // here. The factory takes projectDir for symmetry with other tool sets.
  return [
    createJobStatusTool(),
    createJobOutputTool(),
    createJobWaitTool(),
    createJobKillTool(),
  ];
}
