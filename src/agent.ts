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
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildResearchPrompt } from "./prompt.js";
import { buildResearchTools } from "./tools/index.js";
import { buildContextTransformer } from "./context.js";
import { buildResearchHooks } from "./hooks.js";
import { createPIReviewTool, setupPIFallbackMonitor } from "./pi-agent.js";
import { getApiKey } from "./auth.js";
import { convertToLlm } from "./messages.js";                    // #7: custom message types
import { cleanMessagesForModel } from "./transform.js";           // #6: cross-model compatibility
import { ExtensionBus } from "./extensions.js";                   // #8: extension system

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
  const modelKey = opts.model ?? "sonnet";
  const [provider, modelId] = MODEL_MAP[modelKey] ?? MODEL_MAP.sonnet;
  const model = getModel(provider as any, modelId as any);
  const thinkingLevel = opts.thinkingLevel ?? "medium";

  // Layer 1: System Prompt
  const systemPrompt = buildResearchPrompt();

  // Layer 2: Tools (research tools + PI review tool)
  const tools = buildResearchTools(opts.projectDir, model, getApiKey);

  const piMonitorOpts = {
    projectDir: opts.projectDir,
    fallbackInterval: opts.piFallbackInterval ?? 50,
    costTracker: undefined as any, // set below after hooks
    startTime: undefined as any,
    onVerdict: opts.onPIVerdict,
  };

  const piReview = opts.piFallbackInterval !== 0
    ? createPIReviewTool(piMonitorOpts)
    : null;

  if (piReview) {
    tools.push(piReview.tool);
  }

  // Layer 4: Hooks (before context transformer — tracker needed for token thresholds)
  const hooks = buildResearchHooks({
    projectDir: opts.projectDir,
    maxCostUsd: opts.maxCostUsd,
    maxDurationMs: opts.maxDurationMs,
  });

  // #8: Extension bus
  const bus = new ExtensionBus();

  // Layer 3: transformContext — now with LLM compaction (#1), precise tokens (#3), extensions (#8)
  const transformContext = buildContextTransformer({
    projectDir: opts.projectDir,
    model,
    getApiKey,
    tracker: hooks.tracker,
    bus,
  });

  // Wire cost tracker into PI monitor
  piMonitorOpts.costTracker = hooks.tracker;
  piMonitorOpts.startTime = hooks.startTime;

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

  // Track usage + emit events + auto-checkpoint after each turn
  const agentDir = join(opts.projectDir, ".agent");
  mkdirSync(agentDir, { recursive: true });
  const checkpointPath = join(agentDir, "checkpoint.jsonl");
  let lastCheckpointedMsgCount = 0;

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
    // Append new messages to checkpoint after each completed turn
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
        if (newMessages.length > 0) {
          const lines = newMessages.map((m: any) => JSON.stringify(m)).join("\n") + "\n";
          appendFileSync(checkpointPath, lines);
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

  // #6: Restore from checkpoint with cross-model message cleaning
  const currentModel = { provider, id: modelId };
  const hasCheckpoint = existsSync(checkpointPath);
  const restore = hasCheckpoint ? () => {
    try {
      const lines = readFileSync(checkpointPath, "utf-8").trim().split("\n");
      const messages: any[] = [];
      for (const line of lines) {
        if (!line) continue;
        try { messages.push(JSON.parse(line)); } catch { /* skip corrupted line */ }
      }
      if (messages.length > 0) {
        // #6: Clean messages for cross-model compatibility before restoring
        const cleaned = cleanMessagesForModel(messages, currentModel);
        agent.replaceMessages(cleaned);
        lastCheckpointedMsgCount = cleaned.length;
        return cleaned.length;
      }
    } catch {}
    return 0;
  } : null;

  return { agent, hooks, bus, piFallback, restore, checkpointPath };
}
