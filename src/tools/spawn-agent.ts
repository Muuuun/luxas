/**
 * spawn_agent tool — the single generic tool for spawning sub-agents.
 *
 * Modes:
 *   - Foreground (default): brain blocks until agent finishes, gets result as tool output
 *   - Background (background=true): agent runs async, brain continues working,
 *     result injected via steer() when done
 *   - Parallel (tasks=[]): multiple agents run concurrently, brain blocks until all finish
 */

import { Type } from "@earendil-works/pi-ai/compat";
import type { Agent as AgentType } from "@earendil-works/pi-agent-core";
import { spawn } from "node:child_process";
import { spawnAgent, type SpawnAgentOptions } from "../agents/spawn.js";
import { listAgentDescriptions, getDefinition } from "../agents/registry.js";
import { addAgent, removeAgent, loadRegistry, isAlive, markFailed, tryExtractResult, formatExitHint, parseConvJsonl } from "../active-agents.js";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { join, dirname, sep as pathSep } from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive } from "../utils.js";
import { buildClaimTable } from "../claims-table.js";
import { blindEstimateTask, extractBlindEstimate, extractReviewerLines, headlineDeclsFor, persistReview, reviewCompleteness, reviewerObligationBlock } from "../claims-review.js";

// Primary defense against path-escape via LLM-supplied id; the realpath check
// in handleContinue is defense-in-depth in case this regex is ever widened.
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;

// Module-scope: spawn-agent tools are rebuilt per brain turn (see tools/index.ts),
// so a closure-local counter would reset and collide across turns. Keeping this
// at module scope gives every background spawn in the process a unique bg id.
let bgCounter = 0;

interface ContinueContext {
  projectDir: string;
  agentDir: string;
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
  parentAgentId?: string;
  makeSpawnTool: (parentId: string, childDepth: number, childAllowedTypes?: string[]) => any;
}

function errResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { success: false } };
}

function continueErr(body: string) {
  return errResult(`spawn_agent(action="continue"): ${body}`);
}

// O_EXCL lock with PID-staleness reclaim. Returns null on success (caller
// unlinks on release); returns a reason string on failure (suitable for
// surfacing to the LLM).
//
// Divergence from active-agents.ts:withRegistryLock: that one wraps a sync
// mutator on a single registry file with mtime-staleness + Atomics.wait
// retry. This one is per-agent path, held for the full async spawn duration,
// PID-staleness. Different enough that a shared helper would be cosmetic.
function acquireLock(lockPath: string): string | null {
  const writeOurPid = () => {
    const fd = openSync(lockPath, "wx");
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
  };
  try {
    writeOurPid();
    return null;
  } catch (err: any) {
    if (err.code !== "EEXIST") return err.message;
  }
  // EEXIST: probe holder PID. Dead → reclaim. Alive → bail.
  let holderPid: number | null = null;
  try {
    const n = Number(readFileSync(lockPath, "utf-8").trim());
    if (Number.isFinite(n) && n > 0) holderPid = n;
  } catch { /* lock vanished — treat as stale */ }
  if (holderPid !== null && pidAlive(holderPid)) {
    return `lock held by live pid=${holderPid} (delete ${lockPath} manually if you're sure)`;
  }
  try { unlinkSync(lockPath); } catch { /* race with another reclaimer */ }
  try {
    writeOurPid();
    return null;
  } catch (err: any) {
    return `acquisition failed after stale-reclaim: ${err.message}`;
  }
}

async function handleContinue(
  params: { id?: string; task?: string; templateVars?: Record<string, string> },
  ctx: ContinueContext,
): Promise<{ content: { type: "text"; text: string }[]; details: any }> {
  if (!params.id) return continueErr("`id` is required.");
  if (!params.task) return continueErr("`task` is required.");
  if (!AGENT_ID_RE.test(params.id)) {
    return continueErr(`invalid id "${params.id}". Allowed characters: [A-Za-z0-9._-].`);
  }
  if (params.templateVars && Object.keys(params.templateVars).length > 0) {
    return continueErr("templateVars are recovered from the original spawn_init marker — do not pass them again.");
  }

  const convDir = join(ctx.projectDir, ".agent", "conversations");
  const convPath = join(convDir, `${params.id}.jsonl`);

  // realpath throws ENOENT for missing files — doubles as our "no conv file" check.
  let resolvedDir: string;
  let resolvedPath: string;
  try {
    resolvedDir = realpathSync(convDir);
    resolvedPath = realpathSync(convPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return continueErr(`no conversation file for "${params.id}". Use action="spawn" to start fresh.`);
    }
    return continueErr(`path resolution failed for "${params.id}": ${err.message}`);
  }
  if (!resolvedPath.startsWith(resolvedDir + pathSep)) {
    return continueErr(`id "${params.id}" resolves outside the conversations dir.`);
  }

  // Lock BEFORE parse so two parallel continues can't both compute the same
  // revisionNumber off the same prior continueInits.length snapshot. With the
  // lock first, the second caller fails fast at acquireLock and never reads
  // a stale transcript.
  const lockPath = `${convPath}.lock`;
  const lockErr = acquireLock(lockPath);
  if (lockErr) return continueErr(`"${params.id}" lock acquisition failed: ${lockErr}.`);

  try {
    const { spawnInit, messages, continueInits } = parseConvJsonl(convPath);
    if (!spawnInit) {
      // Distinguish "background agent" (Session-wrapper schema) from "no marker
      // at all": the former is a known-unsupported case worth naming explicitly.
      let hint = "Use action=\"spawn\" instead.";
      try {
        const head = readFileSync(convPath, "utf-8").slice(0, 4096);
        if (/"type":\s*"session"/.test(head) || /"type":\s*"message"/.test(head)) {
          hint = "This looks like a background-agent transcript (Session wrapper format). action=\"continue\" only supports foreground/parallel-spawned agents.";
        }
      } catch { /* best-effort hint only */ }
      return continueErr(`"${params.id}" has no spawn_init marker. ${hint}`);
    }
    if (messages.length === 0) {
      return continueErr(`"${params.id}" has spawn_init but zero messages — original spawn likely failed before any turn. Re-spawn fresh.`);
    }

    // Cross-parent reach-in would let one agent steer another's children.
    const callerParent = ctx.parentAgentId ?? "brain";
    if (spawnInit.parentAgentId !== callerParent) {
      return continueErr(
        `"${params.id}" was spawned by "${spawnInit.parentAgentId ?? "(unknown)"}", not by you ("${callerParent}"). ` +
        `Only the original parent can continue an agent.`,
      );
    }

    let def;
    try {
      def = getDefinition(spawnInit.agent);
    } catch (err: any) {
      return continueErr(`agent type "${spawnInit.agent}" referenced by "${params.id}" is no longer registered. ${err.message}`);
    }

    // Required templateVars must be recoverable. Without them the safety
    // wrapper's path scopes (e.g. EXPERIMENT_ID embedded in allowedWriteRoots)
    // would silently widen — refuse rather than gamble with blast radius.
    const recoveredTemplateVars = spawnInit.templateVars ?? {};
    const missing = (def.templates ?? [])
      .filter(t => t !== "PROJECT_DIR" && !(t in recoveredTemplateVars));
    if (missing.length > 0) {
      return continueErr(
        `cannot recover required template variables [${missing.join(", ")}] for "${params.id}" — ` +
        `the original spawn_init predates templateVars persistence. Spawn fresh with action="spawn", passing them explicitly.`,
      );
    }

    const mergedTemplateVars: Record<string, string> = {
      ...recoveredTemplateVars,
      PROJECT_DIR: ctx.projectDir,
    };
    const revisionNumber = continueInits.length + 1;
    const result = await spawnAgent({
      name: spawnInit.agent,
      templateVars: mergedTemplateVars,
      prompt: params.task,
      projectDir: ctx.projectDir,
      getApiKey: ctx.getApiKey,
      parentAgentId: callerParent,
      createSpawnTool: ctx.makeSpawnTool,
      resume: { agentId: params.id, messages, revisionNumber },
    });

    const elapsedSec = Math.floor(result.elapsed / 1000);
    const header = `[agent continue: id=${params.id}, revision=${revisionNumber}, elapsed=${elapsedSec}s, success=${result.success}]`;
    const text = `${header}\n\n${result.output}${formatExitHint(result.exit, ctx.projectDir)}`;
    return {
      content: [{ type: "text" as const, text }],
      details: {
        elapsed: result.elapsed,
        success: result.success,
        exit: slimExit(result.exit),
        agentId: result.agentId,
        revisionNumber,
      },
    };
  } finally {
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}

// Project SubAgentExit to a slim shape for tool result `details` payloads.
// `partialAssistantText` can be MB-scale on length-truncated runs and there's
// no consumer for it inside the tool result envelope (callers that want it
// can fish it out of the in-memory result via the spawnAgent API).
function slimExit(exit: any) {
  return {
    stopReason: exit?.stopReason,
    elapsedMs: exit?.elapsedMs,
    toolCallCount: exit?.toolCallCount,
    lastContextTokens: exit?.lastContextTokens,
    recoveryAttemptsUsed: exit?.recoveryAttemptsUsed,
    revisionNumber: exit?.revisionNumber,
    endedAt: exit?.endedAt,
    filesTouched: exit?.filesTouched,
    errorMessage: exit?.errorMessage,
  };
}

// Zombie sweep threshold: subagent-runner touches the heartbeat every 30s
// (subagent-runner.ts:93). 5 minutes of silence = 10 missed beats = the
// runner is dead, whatever the registry entry claims.
const ZOMBIE_HEARTBEAT_MS = 5 * 60_000;

export function getActiveBackgroundAgents(projectDir?: string) {
  if (!projectDir) return [];
  const agentDir = join(projectDir, ".agent");
  const out: ReturnType<typeof loadRegistry> = [];
  for (const a of loadRegistry(agentDir)) {
    // done/failed entries await collection — they must not block finish().
    if (a.status && a.status !== "running") continue;
    // Liveness check (2026-07-09): a "running" entry whose markDone/markFailed
    // never fired is otherwise immortal — observed: 3 entries with heartbeats
    // 4h stale blocked finish() 357× until the 500-turn cap killed the run.
    // The isAlive machinery existed all along; this gate just never used it.
    if (!isAlive(agentDir, a.id, ZOMBIE_HEARTBEAT_MS)) {
      let stderrTail = "";
      try {
        const raw = readFileSync(join(agentDir, "runner-logs", `${a.id.replace(/[/\\]/g, "_")}.err`), "utf-8").trim();
        if (raw) stderrTail = `\nRunner stderr (tail):\n${raw.slice(-2000)}`;
      } catch { /* no forensics file — pre-capture spawn */ }
      markFailed(agentDir, a.id,
        "zombie-swept: heartbeat stale >5min — runner died without a completion callback" + stderrTail);
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Helper for callers (pi-agent.ts, runFigures) that need to pass a
 * `createSpawnTool` factory into `spawnAgent` without background capability.
 */
export function createSpawnToolFactory(
  projectDir: string,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
) {
  return (parentId: string, childDepth: number, childAllowedTypes?: string[]) =>
    createSpawnAgentTool(projectDir, {}, getApiKey, parentId, childDepth, undefined, childAllowedTypes);
}

export function createSpawnAgentTool(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  parentAgentId?: string,
  depth?: number,
  /** Reference to the parent Agent instance — needed for steer() on background completion */
  parentAgent?: AgentType,
  /** If set, restricts which sub-agent names this parent may spawn. */
  allowedTypes?: string[],
) {
  const agentDir = join(projectDir, ".agent");
  const luxasRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const allAgents = listAgentDescriptions();
  const agents = allowedTypes
    ? allAgents.filter(a => allowedTypes.includes(a.name))
    : allAgents;
  const agentCatalog = agents
    .map(a => `- **${a.name}**: ${a.description}${a.canSpawn ? " (can spawn sub-agents)" : ""}`)
    .join("\n");

  const SpawnParams = Type.Object({
    agent: Type.Optional(Type.String({
      description: `Agent type to spawn. Available: ${agents.map(a => a.name).join(", ")}. Required for action="spawn" (default); ignored for action="status" / action="continue" (the agent type is recovered from the spawn_init marker of the referenced id).`,
    })),
    task: Type.Optional(Type.String({
      description: 'For action="spawn": the initial task. For action="continue": the new user message (e.g. pytest output + fix request) to deliver to the previously-spawned agent. Use this OR `tasks` (array form). Required for single/background spawns and for continue.',
    })),
    tasks: Type.Optional(Type.Array(Type.String(), {
      description: "For parallel execution: array of tasks. Spawns one agent instance per task, runs them concurrently. Mutually exclusive with a singular `task`. Only valid for action=\"spawn\".",
    })),
    background: Type.Optional(Type.Boolean({
      description: "Run in background — you continue working while this agent runs. Results are delivered back as a message when done. Use for long-running tasks (sub-brain, complex experiments) that you don't need to wait for.",
    })),
    thinkingLevel: Type.Optional(Type.String({
      description: 'Override thinking level: "off", "low", "medium", "high". Defaults to the agent definition\'s level.',
    })),
    action: Type.Optional(Type.String({
      description:
        '"spawn" (default), "status", or "continue".\n' +
        '  - spawn: create a new agent (provide `agent` + `task`/`tasks`).\n' +
        '  - status: query a background agent (provide `id`).\n' +
        '  - continue: deliver a follow-up `task` to a previously-spawned FOREGROUND or PARALLEL agent identified by `id`. Reloads the agent\'s prior conversation transcript so it retains its working memory of what it wrote and considered. Use this for tool_impl revision loops — calling spawn again with a new task creates a cold-start agent with no memory of prior attempts and tends to produce a Frankenstein file across uncoordinated rewrites. The result\'s exit.revisionNumber tracks how many continues this agent has had (1-indexed); enforce your per-tool revision cap from that. NOT supported for background agents (their transcripts use a different schema).',
    })),
    id: Type.Optional(Type.String({
      description: 'Agent ID. Required when action="status" or action="continue". Foreground/parallel/background spawns return their agentId in the result text — copy it from there.',
    })),
    templateVars: Type.Optional(Type.Record(Type.String(), Type.String(), {
      description: 'Per-call template variables substituted into the sub-agent\'s system prompt (e.g. {PAPER_ID: "2301.07041"} for the reader agent). PROJECT_DIR is always injected automatically; do not set it here. Forwarded through to both foreground and background spawns. For action="continue" templateVars are recovered from the original spawn_init marker — do NOT pass them again.',
    })),
  });

  /**
   * Factory for creating a spawn_agent tool scoped to a specific parent.
   * Used by spawn.ts when the parent's `spawn.enabled` is true to give
   * sub-agents their own spawn tool.
   */
  function makeSpawnTool(parentId: string, childDepth: number, childAllowedTypes?: string[]): any {
    // Sub-agents don't get background capability (no parentAgent ref to steer)
    return createSpawnAgentTool(projectDir, templateVars, getApiKey, parentId, childDepth, undefined, childAllowedTypes);
  }

  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    description:
      "Spawn a sub-agent to handle a task. Choose the agent type based on the task.\n\n" +
      "Available agents:\n" + agentCatalog + "\n\n" +
      "For parallel work spawning the SAME agent with multiple task strings (shared template vars), use `tasks`:\n" +
      'spawn_agent(agent="worker", tasks=["read paper A", "read paper B"])\n\n' +
      "To spawn multiple instances with DIFFERENT template vars (e.g. one reader per PAPER_ID), emit multiple spawn_agent calls in the same turn — the harness runs tool calls in parallel:\n" +
      'spawn_agent(agent="reader", task="Read paper 2301.07041", templateVars={PAPER_ID: "2301.07041"})\n' +
      'spawn_agent(agent="reader", task="Read paper 2405.12345", templateVars={PAPER_ID: "2405.12345"})\n\n' +
      "For long-running tasks, use `background: true` — you continue working while the agent runs.\n" +
      "Results are delivered back as a message when done. Good for sub-brain research tasks.\n" +
      'spawn_agent(agent="brain", task="investigate sub-topic X in depth", background=true)\n\n' +
      "Common mistakes to avoid:\n" +
      '  ✗ spawn_agent(agent="worker", tasks=[{"task": "..."}])    — `tasks` must be string[], not object[]\n' +
      '  ✗ spawn_agent(action={"type": "spawn", agent: "..."})    — no `action` wrapper; pass fields at top level\n' +
      '  ✗ spawn_agent(agent="worker", task=["a", "b"])            — `task` is a single string; use `tasks` for arrays\n' +
      "If you need to pass multiple sub-instructions to one agent, concatenate them into a single string using " +
      "newlines or bullet points inside `task`.",
    parameters: SpawnParams,

    async execute(
      _toolCallId: string,
      params: { agent?: string; task?: string; tasks?: string[]; background?: boolean; thinkingLevel?: string; action?: string; id?: string; templateVars?: Record<string, string> },
    ) {
      const action = params.action ?? "spawn";
      if (action !== "spawn" && action !== "status" && action !== "continue") {
        return errResult(`spawn_agent: unknown action "${action}". Allowed: "spawn", "status", "continue".`);
      }

      if (action === "continue") {
        return await handleContinue(
          params,
          { projectDir, agentDir, getApiKey, parentAgentId, makeSpawnTool },
        );
      }

      // ── Status query ──
      if (action === "status") {
        if (!params.id) return errResult('spawn_agent(action="status"): `id` is required.');
        const reg = loadRegistry(agentDir);
        const entry = reg.find(a => a.id === params.id);
        if (!entry) {
          return errResult(`No active agent with id "${params.id}".`);
        }
        const alive = isAlive(agentDir, params.id);
        const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000);
        const status = entry.status === "done" ? "done" : entry.status === "failed" ? "failed" : alive ? "running" : "dead";

        // For completed agents the frozen `entry.result` + structured `entry.exit`
        // are authoritative — they came from markDone/markFailed and reflect the
        // terminal state. Fall back to the live conversation preview only for
        // still-running agents (or entries with no result yet).
        const terminalBody = (entry.status === "done" || entry.status === "failed")
          ? (entry.result || (entry.status === "failed" ? "Unknown error" : "(no output)"))
          : null;
        const recent = terminalBody ?? tryExtractResult(entry.conversationFile);
        const bodyLabel = terminalBody !== null ? "Final result" : "Last completed turn";

        const lines = [
          `Agent: ${entry.id}`,
          `Status: ${status} (${elapsed}s)`,
          `Task: ${entry.task}`,
          recent ? `\n${bodyLabel}:\n${recent.slice(0, 5000)}` : "\nNo output yet.",
        ];
        const body = lines.join("\n") + formatExitHint(entry.exit, projectDir);
        return { content: [{ type: "text" as const, text: body }], details: { success: true, exit: slimExit(entry.exit) } };
      }

      // Spawn-only from here: require agent name explicitly.
      if (!params.agent) {
        return errResult('spawn_agent: `agent` is required for action="spawn".');
      }

      try {
        getDefinition(params.agent);
      } catch (err: any) {
        return errResult(err.message);
      }

      // Normalize `task` / `tasks` into a single list. Downstream code only
      // reads taskList; the string-vs-array distinction is surface syntax.
      const taskList: string[] = params.tasks && params.tasks.length > 0
        ? params.tasks
        : params.task !== undefined
          ? [params.task]
          : [];
      if (taskList.length === 0) {
        return errResult('spawn_agent: must provide either `task` (string) or `tasks` (non-empty array of strings).');
      }
      if (params.background && taskList.length > 1) {
        return errResult('spawn_agent: `background` mode expects a single task. Spawn each background task with its own call.');
      }

      if (allowedTypes && !allowedTypes.includes(params.agent)) {
        return errResult(`spawn_agent: agent "${params.agent}" is not whitelisted for this parent. Allowed: ${allowedTypes.join(", ")}.`);
      }

      // Merge per-call templateVars over the factory defaults (PROJECT_DIR etc).
      // The factory defaults win for PROJECT_DIR to avoid letting a caller
      // redirect the sub-agent at a different project.
      const mergedTemplateVars = {
        ...(params.templateVars ?? {}),
        ...templateVars,
      };
      const baseOpts: Omit<SpawnAgentOptions, "prompt" | "instanceIndex"> = {
        name: params.agent,
        templateVars: mergedTemplateVars,
        projectDir,
        getApiKey,
        parentAgentId: parentAgentId ?? "brain",
        depth: depth ?? 0,
        createSpawnTool: makeSpawnTool,
      };

      if (params.thinkingLevel) {
        const def = getDefinition(params.agent);
        if (params.thinkingLevel !== def.thinkingLevel) {
          if (params.thinkingLevel === "high") {
            baseOpts.modelOverride = "opus";
          }
        }
      }

      // ── Background mode — independent process ──
      if (params.background) {
        const task = taskList[0];
        const bgId = `bg-${++bgCounter}`;
        const taskPreview = task.slice(0, 80);
        const agentId = `${parentAgentId ?? "brain"}.${params.agent}-${bgId}`;
        const convFile = join(agentDir, "conversations", `${agentId}.jsonl`);

        // Forward the merged templateVars to the subprocess so background
        // spawns see the same vars as foreground. PROJECT_DIR is re-injected
        // by the subagent-runner and stripped here to keep callers from
        // redirecting the sub-agent at a different project.
        const bgTemplateVars: Record<string, string> = { ...mergedTemplateVars };
        delete bgTemplateVars.PROJECT_DIR;

        const args = [
          "--import=tsx",
          join(luxasRoot, "src", "subagent-runner.ts"),
          "--agent", params.agent,
          "--task", task,
          "--project", projectDir,
          "--id", agentId,
          "--session", convFile,
        ];
        if (Object.keys(bgTemplateVars).length > 0) {
          args.push("--template-vars", JSON.stringify(bgTemplateVars));
        }

        // Crash forensics (2026-07-10): stdio:"ignore" discarded every crash's
        // stack trace — including V8 OOM aborts, which no in-process handler
        // can catch. The runner's own last-resort console.error existed all
        // along and wrote to /dev/null. Reader of these files: the failure
        // report in getActiveBackgroundAgents' zombie sweep path and whoever
        // triages the next death.
        let stdio: ("ignore" | number)[] = ["ignore", "ignore", "ignore"];
        let errFd: number | null = null;
        try {
          const logDir = join(agentDir, "runner-logs");
          mkdirSync(logDir, { recursive: true });
          errFd = openSync(join(logDir, `${agentId.replace(/[/\\]/g, "_")}.err`), "a");
          stdio = ["ignore", errFd, errFd];
        } catch { /* forensics must not block the spawn */ }
        const child = spawn("node", args, {
          detached: true,
          stdio,
        });
        if (errFd !== null) { try { closeSync(errFd); } catch { /* child holds its own copy */ } }
        child.unref();

        // Mirror to log.jsonl so studio's SSE tail surfaces background spawns
        // immediately. Background spawns bypass spawn.ts (they exec a detached
        // node subagent-runner.ts), so the spawn.ts mirror doesn't fire here.
        // Shape matches hooks.ts plus phase:"started"; snake_case agent_id /
        // parent_agent_id matches studio's pickSpawnTarget.
        try {
          appendFileSync(
            join(agentDir, "log.jsonl"),
            JSON.stringify({
              type: "tool_call",
              tool: "spawn_agent",
              phase: "started",
              args: { agent: params.agent, agent_id: agentId, parent_agent_id: parentAgentId, background: true },
              success: true,
              timestamp: new Date().toISOString(),
            }) + "\n",
          );
        } catch { /* observability must not crash the spawn */ }

        addAgent(agentDir, {
          id: agentId,
          name: params.agent,
          task: taskPreview,
          mode: "background",
          startedAt: Date.now(),
          conversationFile: convFile,
          pid: child.pid,
          status: "running",
        });

        return {
          content: [{ type: "text" as const, text: `Background agent "${params.agent}" launched as independent process (${agentId}, pid=${child.pid}). It will survive if this session crashes.\nTask: ${taskPreview}\nUse spawn_agent(action="status", id="${agentId}") to check progress.` }],
          details: { backgroundId: bgId, agentId, pid: child.pid, success: true },
        };
      }

      // ── Parallel mode ──
      if (taskList.length > 1) {
        const results = await Promise.all(
          taskList.map((task, i) =>
            spawnAgent({ ...baseOpts, prompt: task, contextExtra: { task }, instanceIndex: i })
          ),
        );

        const summary = results.map((r, i) => {
          const icon = r.success ? "✓" : "✗";
          const secs = Math.floor(r.elapsed / 1000);
          return `## Task ${i + 1} ${icon} (${secs}s) [agent: ${r.agentId}]\n\n${r.output}${formatExitHint(r.exit, projectDir)}`;
        }).join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: summary }],
          details: {
            results: results.map(r => ({
              elapsed: r.elapsed,
              success: r.success,
              exit: slimExit(r.exit),
              agentId: r.agentId,
            })),
          },
        };
      }

      // ── Foreground mode (default) ──
      const initialTask = taskList[0];
      let result = await spawnAgent({ ...baseOpts, prompt: initialTask, contextExtra: { task: initialTask } });

      // Auto-review loop: after any foreground experiment completes, spawn
      // the experiment_reviewer to audit its L2 section + results + cited
      // literature. If the reviewer votes revise, re-run the experiment
      // with the feedback injected as a follow-up task. Bounded at 3
      // iterations to cap cost. Replaces the old self-written "### Red
      // team" section — the independent-auditor pattern (same as the
      // tool_impl / tool_review split) prevents template-filling
      // self-deflection.
      if (params.agent === "experiment" && result.success) {
        const experimentId = mergedTemplateVars.EXPERIMENT_ID;
        if (experimentId) {
          // Env-configurable. Default 3 preserves prior behavior.
          // Set LUXAS_MAX_REVIEW_ITERATIONS=1 for compute-heavy runs (Monte
          // Carlo sims) where 3 rounds × hours/round burns wallclock budget
          // and increases deepseek emit-tool-use bug risk. Set to 0 to skip
          // the auto-review loop entirely.
          const envCap = parseInt(process.env.LUXAS_MAX_REVIEW_ITERATIONS ?? "", 10);
          const MAX_REVIEW_ITERATIONS = Number.isFinite(envCap) && envCap >= 0 ? envCap : 3;

          // Claims-first §3.5: the blind estimate is produced by the HARNESS
          // before the reviewer runs — "preregistered" cannot be enforced
          // inside one agent turn. A `replicator` in estimate mode sees the
          // observable sentence and input values only; its ESTIMATE(blind)
          // line is handed to the reviewer and persisted with the review so
          // claims-table.ts can read it. LUXAS_BLIND_ESTIMATE=0 disables.
          const claimNotes: string[] = [];
          const scopeFor = () => {
            try { return headlineDeclsFor(buildClaimTable(projectDir), experimentId); }
            catch (err) { claimNotes.push(`[claim-table MALFORMED: ${(err as Error).message.slice(0, 120)} — no blind estimate or reviewer obligation could be computed]`); return []; }
          };
          let headlineDecls = scopeFor();
          let headlineIds = [...new Set(headlineDecls.map((d) => d.id))];
          const blindLines: string[] = [];
          if (MAX_REVIEW_ITERATIONS > 0 && process.env.LUXAS_BLIND_ESTIMATE !== "0") {
            for (const decl of headlineDecls) {
              try {
                const est = await spawnAgent({
                  name: "replicator",
                  projectDir,
                  templateVars: { ...mergedTemplateVars, QUANTITY_ID: decl.id, MODE: "estimate" },
                  prompt: blindEstimateTask(decl),
                  getApiKey,
                  parentAgentId: `${parentAgentId ?? "brain"}.blind-estimate-${decl.id}`,
                  depth: (depth ?? 0) + 1,
                  createSpawnTool: makeSpawnTool,
                });
                const line = extractBlindEstimate(est.output ?? "", decl.id);
                if (line) blindLines.push(line);
                else claimNotes.push(`[blind estimator for ${decl.id} returned no ESTIMATE(blind) line]`);
              } catch (err) { claimNotes.push(`[blind estimator for ${decl.id} failed: ${(err as Error).message.slice(0, 100)}]`); }
            }
          }
          let obligation = reviewerObligationBlock(headlineIds, blindLines);
          // MAX=0 short-circuits the loop body and falls through to return.
          for (let round = 1; round <= MAX_REVIEW_ITERATIONS; round++) {
            const reviewResult = await spawnAgent({
              name: "experiment_reviewer",
              projectDir,
              templateVars: { ...mergedTemplateVars },
              prompt:
                `Audit the completed experiment with EXPERIMENT_ID=${experimentId}. ` +
                `Read the matching L2 section in notes/experiments.md, its ` +
                `data/experiments/${experimentId}/runs/run_N/results.json, the referenced ` +
                `raw_data files, and the cited literature fragments under notes/literature.d/. ` +
                `Return a VERDICT: satisfied or VERDICT: revise with actionable FEEDBACK per ` +
                `your system prompt.` + obligation,
              getApiKey,
              parentAgentId: `${parentAgentId ?? "brain"}.experiment-review-${round}`,
              depth: (depth ?? 0) + 1,
              createSpawnTool: makeSpawnTool,
            });

            const verdictText = reviewResult.output ?? "";
            // Persist the reviewer's obligation lines (it has no write tool).
            // An incomplete review keeps its VERDICT/FEEDBACK (a substantive
            // critique is never discarded for a missing ritual line) but its
            // attestations are withheld and the quantities are NO REVIEW.
            const reviewLines = extractReviewerLines(verdictText);
            const missing = reviewCompleteness(reviewLines, headlineIds);
            const verdictLineMatch = verdictText.match(/^\s*#{0,6}\s*VERDICT:\s*\w+.*$/im);
            try { persistReview(projectDir, experimentId, round, blindLines, reviewLines, verdictLineMatch ? verdictLineMatch[0].trim() : "VERDICT: (none)", missing); }
            catch (err) { claimNotes.push(`[review persistence failed round ${round}: ${(err as Error).message.slice(0, 100)}]`); }
            if (missing.length > 0) claimNotes.push(`[experiment_reviewer round ${round}: NO REVIEW for ${missing.join(", ")} — DISCRIMINATOR/SCALING lines missing; attestations withheld]`);
            // Anchor to a standalone verdict line — reviewer.md emits
            // "VERDICT: satisfied" as the LAST line. The old substring match
            // false-passed on prose like "I cannot return VERDICT: satisfied"
            // or "VERDICT: satisfied only after fixing X".
            const satisfied = /^\s*#{0,6}\s*VERDICT:\s*satisfied\b[.\s]*$/im.test(verdictText);
            if (satisfied) {
              result = {
                ...result,
                output:
                  result.output +
                  `\n\n---\n[experiment_reviewer round ${round}: SATISFIED]` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
              };
              break;
            }

            // Extract FEEDBACK block (machine contract with reviewer).
            const feedbackMatch = verdictText.match(/FEEDBACK:\s*([\s\S]*?)$/i);
            const feedback = feedbackMatch ? feedbackMatch[1].trim() : verdictText.trim();

            if (round === MAX_REVIEW_ITERATIONS) {
              result = {
                ...result,
                output:
                  result.output +
                  `\n\n---\n[experiment_reviewer round ${round}: REVISE but iteration cap reached — accepting current state with open issues]\n\nOutstanding reviewer feedback:\n${feedback}` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
              };
              break;
            }

            // Re-run the experiment with feedback as a follow-up task.
            // Tell the experiment agent explicitly to iterate on existing
            // artifacts rather than start fresh.
            const revisionTask =
              `# Revision round ${round} — experiment_reviewer voted REVISE.\n\n` +
              `Your previous run's L2 section + results.json have been audited. ` +
              `Address these issues, iterating on existing data/experiments/${experimentId}/ ` +
              `artifacts (scripts, tests, runs/). Do NOT start from scratch; reuse or extend.\n\n` +
              `## Reviewer feedback\n\n${feedback}\n\n` +
              `## Original task (for reference)\n\n${initialTask}`;
            result = await spawnAgent({ ...baseOpts, prompt: revisionTask, contextExtra: { task: revisionTask } });
            if (!result.success) break;
            // The revision may have re-declared quantities: recompute the
            // obligation scope for the next round (blind lines are reused).
            headlineDecls = scopeFor();
            headlineIds = [...new Set(headlineDecls.map((d) => d.id))];
            obligation = reviewerObligationBlock(headlineIds, blindLines);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: `[agent: ${result.agentId}]\n${result.output}${formatExitHint(result.exit, projectDir)}` }],
        details: { elapsed: result.elapsed, success: result.success, exit: slimExit(result.exit), agentId: result.agentId },
      };
    },

    _makeSpawnTool: makeSpawnTool,
  };
}
