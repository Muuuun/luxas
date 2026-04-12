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

import { mkdirSync, appendFileSync } from "node:fs";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { buildAgentFromDefinition, type SpawnAgentOptions } from "./agents/spawn.js";
import { Session, deriveState, buildSessionContext } from "./session.js";
import { markDone, markFailed, touchHeartbeat } from "./active-agents.js";
import { getApiKey } from "./auth.js";
import { extractTextContent } from "./utils.js";
import { cleanMessagesForModel } from "./transform.js";
import { installUsageTracking } from "./usage-log.js";

// ── Parse args ──────────────────────────────────────

function parseArgs(): { agent: string; task: string; project: string; id: string; session: string; "template-vars"?: string } {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    parsed[key] = args[i + 1] ?? "";
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

  // Usage tracking: append to shared usage.log (same file as main process)
  installUsageTracking(join(agentDir, "usage.log"));

  // Heartbeat: touch every 30s
  touchHeartbeat(agentDir, args.id);
  const heartbeatInterval = setInterval(() => {
    touchHeartbeat(agentDir, args.id);
  }, 30_000);

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

    // Build agent from definition (reuses the same logic as in-process spawnAgent)
    const spawnOpts: SpawnAgentOptions = {
      name: args.agent,
      prompt: args.task,
      projectDir,
      templateVars: {
        ...forwardedVars,
        PROJECT_DIR: projectDir,
      },
      getApiKey,
      parentAgentId: args.id.split(".").slice(0, -1).join(".") || "brain",
    };

    const { agent, agentId, definition, tokenTap } = buildAgentFromDefinition(spawnOpts);

    // Resolve the actual model for cross-model message cleaning
    const modelKey = definition.model === "inherit" ? "sonnet" : definition.model;
    const modelProvider = modelKey.startsWith("gpt") || modelKey.startsWith("o3") || modelKey.startsWith("o4") ? "openai" : "anthropic";

    // Session: open or create for crash recovery
    const session = Session.open(sessionFile, projectDir);
    const savedState = deriveState(session);
    let lastSavedMsgCount = 0;

    // Restore from checkpoint if available
    if (savedState && session.getEntries().length > 0) {
      const messages = buildSessionContext(session);
      if (messages.length > 0) {
        const cleaned = cleanMessagesForModel(messages, { provider: modelProvider, id: modelKey });
        cleaned.push({
          role: "user",
          content: `[SESSION RESUMED] Restored from checkpoint. Continue your task: ${args.task}`,
          timestamp: Date.now(),
        });
        agent.replaceMessages(cleaned);
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

    // Run
    await agent.prompt(args.task);

    // Extract output
    const messages = agent.state.messages;
    const lastAssistant = [...messages].reverse().find(
      (m: any) => m.role === "assistant",
    ) as any;
    const output = lastAssistant?.content
      ? extractTextContent(lastAssistant.content)
      : "(no output)";

    // Mark done in registry
    markDone(agentDir, args.id, output.slice(0, 50_000));

  } catch (err: any) {
    markFailed(agentDir, args.id, err.message || String(err));
  } finally {
    clearInterval(heartbeatInterval);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("subagent-runner fatal:", err);
  process.exit(1);
});
