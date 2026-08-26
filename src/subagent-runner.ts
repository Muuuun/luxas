#!/usr/bin/env node
/**
 * Subagent Runner — independent process entry point for long-running sub-agents.
 *
 * Spawned by brain via child_process.spawn({ detached: true }).
 * Has its own session JSONL for crash recovery, heartbeat file for liveness,
 * and writes result to active-agents.json on completion.
 *
 * Usage:
 *   node --import=tsx src/subagent-runner.ts \
 *     --agent worker --task "read paper X" \
 *     --project /path/to/project --id brain.worker-bg-1 \
 *     --session .agent/conversations/brain.worker-bg-1.jsonl
 */

import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { buildAgentFromDefinition, createSubAgentExitCollector, createLengthRecoveryController, runWithLengthRecovery, type SpawnAgentOptions } from "./agents/spawn.js";
import { Session, deriveState, buildSessionContext } from "./session.js";
import { markDone, markFailed, touchHeartbeat, classifyThrownStopReason } from "./active-agents.js";
import { getApiKey } from "./auth.js";
import { extractTextContent } from "./utils.js";
import { cleanMessagesForModel } from "./transform.js";
import { installUsageTracking } from "./usage-log.js";
import { createSpawnToolFactory } from "./tools/spawn-agent.js";
import { jobOwnerAls } from "./jobs/als.js";

// Match agent.ts: default Anthropic prompt-cache TTL to 5m.
// Subagents are separate processes, so the env var must be set here too.
process.env.PI_CACHE_RETENTION ||= "short";

// Defense in depth: strip API-key env vars in this child process too. The
// parent (brain) already strips before spawning, so by the time we get here
// these are already absent — but if a sub-agent is launched out-of-band
// (manual invocation, future entry point), this guarantees the same posture.
// Keys come back via the auth.json file fallback in src/auth.ts.
for (const k of [
  "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY",
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN", "GITHUB_PAT",
]) {
  delete process.env[k];
}

// Match agent.ts: raise the SIGTERM/SIGINT listener cap so parallel
// sub-spawns (e.g. experiment fanning out to tool_impl + tool_review) don't
// trigger MaxListenersExceededWarning. Each subagent runs in its own process
// so the cap applies per process independently.
process.setMaxListeners(200);

// ── Parse args ──────────────────────────────────────

function parseArgs(): { agent: string; task: string; project: string; id: string; session: string; "template-vars"?: string; resume?: boolean } {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    // Boolean flag: --resume (no value follows)
    if (key === "resume") {
      parsed.resume = true;
      continue;
    }
    parsed[key] = args[i + 1] ?? "";
    i++;
  }
  for (const k of ["agent", "task", "project", "id", "session"]) {
    if (!parsed[k]) {
      console.error(`Missing required arg: --${k}`);
      process.exit(1);
    }
  }
  return parsed as any;
}

// ── Main ────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const projectDir = isAbsolute(args.project) ? args.project : resolve(args.project);
  process.env.LUXAS_PROJECT_DIR = projectDir;  // see src/index.ts — same contract for detached subagent processes
  const agentDir = join(projectDir, ".agent");
  const sessionFile = isAbsolute(args.session) ? args.session : join(projectDir, args.session);

  mkdirSync(dirname(sessionFile), { recursive: true });
  const processStartTime = Date.now();

  // Usage tracking: append to shared usage.log (same file as main process).
  // The cost cap comes from run_config.json (written by `luxas run`); without
  // it a detached runner would be the one place the cap is never checked.
  let maxCostUsd: number | undefined;
  try {
    const cfg = JSON.parse(readFileSync(join(agentDir, "run_config.json"), "utf-8"));
    if (typeof cfg.maxCost === "number" && Number.isFinite(cfg.maxCost)) maxCostUsd = cfg.maxCost;
  } catch { /* no run_config: fall back to the hooks default below */ }
  installUsageTracking(join(agentDir, "usage.log"), { maxCostUsd: maxCostUsd ?? 250 });

  // Heartbeat: touch every 30s
  touchHeartbeat(agentDir, args.id);
  const heartbeatInterval = setInterval(() => {
    touchHeartbeat(agentDir, args.id);
  }, 30_000);

  // Crash forensics (2026-07-10, debate-adjudicated): anything thrown OUTSIDE
  // the awaited chain — floating promises from subscribe callbacks, timers,
  // socket errors — exits node without reaching the catch below, leaving a
  // "running" registry entry whose heartbeat just goes stale (observed: 3
  // runners died this way in 10 minutes, killing E6; zero bytes of evidence
  // because stderr was stdio:"ignore" until the same commit). Mark the death
  // with its reason, log it (stderr now lands in .agent/runner-logs/), and
  // exit — a post-crash runner whose heartbeat interval keeps ticking would
  // mask its own death from the liveness sweep.
  const die = (kind: string) => (err: unknown) => {
    const msg = `${kind}: ${(err as any)?.stack || String(err)}`;
    try { markFailed(agentDir, args.id, msg.slice(0, 4000)); } catch { /* registry locked/corrupt — stderr still records it */ }
    console.error(`subagent-runner ${msg}`);
    process.exit(1);
  };
  process.on("uncaughtException", die("uncaughtException"));
  process.on("unhandledRejection", die("unhandledRejection"));

  // Collector + recovery controller are declared here so the catch block can
  // still finalize() when buildAgentFromDefinition / agent.prompt throws
  // before attach(). Recovery also outlives the try because its attempt count
  // should be reflected in the exit even if a later attempt threw.
  const exitCollector = createSubAgentExitCollector(processStartTime);
  const lengthRecovery = createLengthRecoveryController();
  exitCollector.attachRecovery(lengthRecovery);

  try {
    // Parse forwarded templateVars from the spawning parent (e.g. PAPER_ID for
    // the reader). Fail fast — an agent spawned without its required vars
    // would silently no-op on unresolved {{…}} in its system prompt.
    let forwardedVars: Record<string, string> = {};
    if (args["template-vars"]) {
      try {
        const parsed = JSON.parse(args["template-vars"]);
        if (!parsed || typeof parsed !== "object") throw new Error("expected JSON object");
        forwardedVars = parsed;
      } catch (err) {
        console.error(`Invalid --template-vars JSON: ${(err as any)?.message ?? err}`);
        process.exit(1);
      }
    }

    // Background agents that declare `spawn.enabled: true` need their own
    // spawn_agent tool so they can delegate to children. Without createSpawnTool,
    // buildAgentFromDefinition silently omits the spawn tool — the agent then
    // falls back to bash heredoc workarounds (observed on qLDPC bg-2 E3 run,
    // 2026-04-19).
    const makeSpawnTool = createSpawnToolFactory(projectDir, getApiKey);
    const spawnOpts: SpawnAgentOptions = {
      name: args.agent,
      prompt: args.task,
      contextExtra: { task: args.task },
      projectDir,
      templateVars: {
        ...forwardedVars,
        PROJECT_DIR: projectDir,
      },
      getApiKey,
      parentAgentId: args.id.split(".").slice(0, -1).join(".") || "brain",
      createSpawnTool: makeSpawnTool,
      runtimeHooks: exitCollector.runtimeHooks,
      lengthRecovery,
    };

    const { agent, agentId, definition, tokenTap } = buildAgentFromDefinition(spawnOpts);
    exitCollector.attach(agent, tokenTap);

    // Resolve the actual model for cross-model message cleaning
    const modelKey = definition.model === "inherit" ? "sonnet" : definition.model;
    const modelProvider = modelKey.startsWith("gpt") || modelKey.startsWith("o3") || modelKey.startsWith("o4") ? "openai" : "anthropic";

    // Session: open or create for crash recovery
    const session = Session.open(sessionFile, projectDir);
    const savedState = deriveState(session);
    let lastSavedMsgCount = 0;

    // Restore from checkpoint ONLY when explicitly resuming a crashed/detached
    // session. Without this gate, any reuse of a conversation file path would
    // replay the full prior history into the new agent, causing O(N²) token
    // blow-up (see plans/cheerful-weaving-flurry.md).
    if (args.resume && savedState && session.getEntries().length > 0) {
      const messages = buildSessionContext(session);
      if (messages.length > 0) {
        const cleaned = cleanMessagesForModel(messages, { provider: modelProvider, id: modelKey });
        cleaned.push({
          role: "user",
          content: `[SESSION RESUMED] Restored from checkpoint. Continue your task: ${args.task}`,
          timestamp: Date.now(),
        });
        agent.state.messages = cleaned;
        lastSavedMsgCount = cleaned.length;
      }
    }

    // Per-turn persistence: messages + state
    agent.subscribe((event: any) => {
      if (event.type === "turn_end") {
        try {
          const msgs = agent.state.messages;
          for (let i = lastSavedMsgCount; i < msgs.length; i++) {
            session.appendMessage(msgs[i]);
          }
          lastSavedMsgCount = msgs.length;

          // Write state snapshot for crash recovery
          session.append({
            type: "state" as const,
            cost: 0, inputTokens: 0, outputTokens: 0,
            lastContextTokens: tokenTap.lastContextTokens, startTime: processStartTime,
            piStopped: false, piToolCalls: 0, piLastReviewAt: 0, piReviewCount: 0,
          });
        } catch { /* must not crash the agent */ }
      }
    });

    // Run with automatic length-truncation recovery. Scoped under this
    // sub-agent's owner identity (matches the in-process branch in
    // spawn.ts) so bash jobs persist with this agent's id, not "brain".
    await jobOwnerAls.run(
      { agentId: args.id, agentType: args.agent, projectDir },
      () => runWithLengthRecovery(agent, args.task, lengthRecovery),
    );

    // Extract output. extractTextContent can return "" even when content
    // exists (e.g., assistant message that was all thinking blocks + tool_use
    // but no text). Normalize to the sentinel so parent harvest always sees
    // a non-empty result — its truthy-result gate would otherwise leak this
    // agent in the registry forever.
    const messages = agent.state.messages;
    const lastAssistant = [...messages].reverse().find(
      (m: any) => m.role === "assistant",
    ) as any;
    const output = (lastAssistant?.content ? extractTextContent(lastAssistant.content) : "") || "(no output)";

    // Mark done in registry (with structured exit)
    markDone(agentDir, args.id, output.slice(0, 50_000), exitCollector.finalize());

  } catch (err: any) {
    // If buildAgentFromDefinition itself threw, the collector never got an
    // attach() call — finalize() still returns a valid SubAgentExit with
    // "unknown" (or the override) stopReason.
    const msg = err?.message || String(err);
    markFailed(agentDir, args.id, msg, exitCollector.finalize(classifyThrownStopReason(err)));
  } finally {
    clearInterval(heartbeatInterval);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("subagent-runner fatal:", err);
  process.exit(1);
});
