/**
 * Research Agent — assembles the five layers on top of agent-core.
 *
 * Layer 1: System Prompt (prompt.ts)
 * Layer 2: Tools (tools/index.ts) + PI review tool
 * Layer 3: transformContext (context.ts)
 * Layer 4: Hooks (hooks.ts)
 * Layer 5: PI Monitor — adversarial quality reviewer (pi-agent.ts)
 *
 * Cross-cutting:
 * #1 LLM compaction, #2 API retry, #3 precise tokens, #4 parallel tools,
 * #5 session DAG, #6 cross-model transform, #7 custom messages, #8 extensions
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { buildResearchPrompt } from "./prompt.js";
import { buildResearchTools } from "./tools/index.js";
import { buildContextTransformer } from "./context.js";
import { buildResearchHooks } from "./hooks.js";
import { ReminderRegistry, builtinProviders } from "./reminders.js";
import { createPIReviewTool, setupPIFallbackMonitor } from "./pi-agent.js";
import { getApiKey } from "./auth.js";
import { convertToLlm } from "./messages.js";                    // #7: custom message types
import { cleanMessagesForModel } from "./transform.js";           // #6: cross-model compatibility
import { ExtensionBus } from "./extensions.js";                   // #8: extension system
import { Session, buildSessionContext } from "./session.js";      // #5: session DAG

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { PIVerdict } from "./pi-agent.js";

export interface ResearchAgentOptions {
  projectDir: string;
  model?: string;              // "sonnet" | "opus" | "haiku" (default: sonnet)
  thinkingLevel?: ThinkingLevel;
  maxCostUsd?: number;
  maxDurationMs?: number;
  piFallbackInterval?: number; // auto PI review after N steps without check-in (default 50, 0 to disable)
  onPIVerdict?: (verdict: PIVerdict, toolCallCount: number) => void;
}

const MODEL_MAP: Record<string, [string, string]> = {
  haiku: ["anthropic", "claude-haiku-4-5-20251001"],
  sonnet: ["anthropic", "claude-sonnet-4-6"],
  opus: ["anthropic", "claude-opus-4-6"],
};

export function createResearchAgent(opts: ResearchAgentOptions) {
  // Enforce absolute projectDir — all tools depend on this
  const projectDir = isAbsolute(opts.projectDir) ? opts.projectDir : resolve(opts.projectDir);

  // Main agent uses opus by default; workers/sub-agents use sonnet
  const modelKey = opts.model ?? "opus";
  const [provider, modelId] = MODEL_MAP[modelKey] ?? MODEL_MAP.opus;
  const model = getModel(provider as any, modelId as any);
  const workerModelKey = "sonnet";
  const workerModel = getModel(MODEL_MAP[workerModelKey][0] as any, MODEL_MAP[workerModelKey][1] as any);
  const thinkingLevel = opts.thinkingLevel ?? "medium";

  // Layer 1: System Prompt — now includes projectDir
  const systemPrompt = buildResearchPrompt(projectDir);

  // Reminder system — event-driven, per-turn quality nudges
  const reminders = new ReminderRegistry();
  for (const p of builtinProviders) reminders.register(p);

  // #8: Extension bus (created early — hooks and context both need it)
  const bus = new ExtensionBus();

  // Hooks must be created before tools so trackUsage can be threaded to sub-agents
  const hooks = buildResearchHooks({
    projectDir,
    maxCostUsd: opts.maxCostUsd,
    maxDurationMs: opts.maxDurationMs,
    reminders,
    bus,
  });

  // Check if PI already said STOP in a previous session (persisted in pi_feedback.md)
  const prevFeedback = existsSync(join(projectDir, "reviews", "pi_feedback.md"))
    ? readFileSync(join(projectDir, "reviews", "pi_feedback.md"), "utf-8")
    : "";
  if (prevFeedback.includes("## Verdict: STOP")) {
    hooks.setPIStopped();
  }

  // Layer 2: Tools (research tools + PI review tool)
  // Created after hooks so sub-agents can report costs via trackUsage
  // finish tool callback — set after agent is created (needs reference to agent)
  let finishCallback: (() => void) | undefined;
  const tools = buildResearchTools(projectDir, model, workerModel, getApiKey, hooks.trackUsage, {
    onFinish: () => finishCallback?.(),
  });

  const piMonitorOpts = {
    projectDir: projectDir,
    fallbackInterval: opts.piFallbackInterval ?? 50,
    costTracker: hooks.tracker,
    startTime: hooks.startTime,
    onVerdict: (verdict: PIVerdict, toolCallCount: number) => {
      // Enforce PI STOP — block non-finalization tools
      if (verdict.verdict === "stop") {
        hooks.setPIStopped();
      }
      opts.onPIVerdict?.(verdict, toolCallCount);
    },
  };

  const piReview = opts.piFallbackInterval !== 0
    ? createPIReviewTool(piMonitorOpts)
    : null;

  if (piReview) {
    tools.push(piReview.tool);
  }

  // Layer 3: transformContext — now with LLM compaction (#1), precise tokens (#3), extensions (#8)
  const transformContext = buildContextTransformer({
    projectDir: projectDir,
    model,
    getApiKey,
    tracker: hooks.tracker,
    bus,
    reminders,
  });

  // Assemble Agent
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
    },
    transformContext,
    convertToLlm,                         // #7: custom message types → LLM format
    toolExecution: "parallel",            // #4: parallel tool execution
    maxRetryDelayMs: 120_000,             // #2: API retry — cap at 2 min
    beforeToolCall: hooks.before,
    afterToolCall: hooks.after,
    getApiKey,
  });

  // Wire finish tool to abort the agent loop
  finishCallback = () => agent.abort();

  // #5: Session DAG — replaces raw appendFileSync checkpoint
  const agentDir = join(projectDir, ".agent");
  mkdirSync(agentDir, { recursive: true });
  const checkpointPath = join(agentDir, "checkpoint.jsonl");

  // Migrate legacy checkpoint format (raw messages without session header)
  if (existsSync(checkpointPath)) {
    try {
      const firstLine = readFileSync(checkpointPath, "utf-8").split("\n")[0];
      const parsed = JSON.parse(firstLine);
      if (parsed.type !== "session") {
        // Legacy format — rename and let Session.open create a fresh file
        renameSync(checkpointPath, checkpointPath + ".legacy");
      }
    } catch { /* corrupted — Session.open will overwrite */ }
  }

  const session = Session.open(checkpointPath, projectDir);
  let lastCheckpointedMsgCount = 0;

  // Track usage + emit events + persist messages to Session after each turn
  agent.subscribe((event: any) => {
    if (event.type === "message_update") {
      const msg = event.assistantMessageEvent;
      if (msg?.usage) {
        hooks.trackUsage(msg.usage);
        // #8: Emit usage_update event
        bus.emit({
          type: "usage_update",
          cost: hooks.tracker.totalCost,
          inputTokens: hooks.tracker.totalInputTokens,
          outputTokens: hooks.tracker.totalOutputTokens,
        });
      }
    }
    if (event.type === "message_end") {
      const msg = event.message;
      if (msg?.usage) {
        hooks.trackUsage(msg.usage);
      }
    }
    // #8: Emit turn events
    if (event.type === "turn_start") {
      bus.emit({ type: "turn_start" });
    }
    if (event.type === "turn_end") {
      const toolCalls = (event.message?.content ?? [])
        .filter((b: any) => b.type === "toolCall" || b.type === "tool_use").length;
      bus.emit({ type: "turn_end", message: event.message, toolCalls });
    }
    // Persist new messages to Session DAG after each completed turn
    if (event.type === "turn_end") {
      try {
        const messages = agent.state.messages;
        const newMessages = messages.slice(lastCheckpointedMsgCount)
          .filter((m: any) => {
            // Skip error responses — empty content with stopReason=error corrupts checkpoint
            if (m.role === "assistant" && m.stopReason === "error") return false;
            if (m.role === "assistant" && Array.isArray(m.content) && m.content.length === 0) return false;
            return true;
          });
        for (const m of newMessages) {
          session.appendMessage(m);
        }
        lastCheckpointedMsgCount = messages.length;
      } catch {}
    }
  });

  // Layer 5: PI fallback monitor (auto-triggers if agent doesn't request review)
  let piFallback: ReturnType<typeof setupPIFallbackMonitor> | null = null;
  if (piReview) {
    piFallback = setupPIFallbackMonitor(agent, piReview, piMonitorOpts);
  }

  // #6: Restore from Session DAG with cross-model message cleaning
  const currentModel = { provider, id: modelId };
  const hasCheckpoint = session.getEntries().length > 0;
  const restore = hasCheckpoint ? () => {
    try {
      const messages = buildSessionContext(session);
      if (messages.length > 0) {
        // #6: Clean messages for cross-model compatibility before restoring
        const cleaned = cleanMessagesForModel(messages, currentModel);

        // Inject resume directive so agent doesn't re-verify everything
        cleaned.push({
          role: "user",
          content: [
            `[SESSION RESUMED] You have been restored from a checkpoint with ${cleaned.length} messages.`,
            `Your current state is in the research snapshot above (notes, report, memory).`,
            `Do NOT re-verify or re-read files you already know about.`,
            `Do NOT rewrite notes/memory.md unless you have new information.`,
            `Continue working from where you left off — check the research snapshot and your last actions to determine what to do next.`,
            `If PI feedback says STOP, finalize and stop immediately.`,
          ].join("\n"),
          timestamp: Date.now(),
        });

        agent.replaceMessages(cleaned);
        lastCheckpointedMsgCount = cleaned.length;
        return cleaned.length;
      }
    } catch {}
    return 0;
  } : null;

  return { agent, hooks, bus, session, piFallback, restore, checkpointPath };
}
