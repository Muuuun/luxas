/**
 * Research Agent — assembles the four layers on top of agent-core.
 *
 * Layer 1: System Prompt (prompt.ts)
 * Layer 2: Tools (tools/index.ts) + PI review tool
 * Layer 3: transformContext (context.ts)
 * Layer 4: Hooks (hooks.ts)
 * Layer 5: PI Monitor — adversarial quality reviewer (pi-agent.ts)
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

  // Layer 3: transformContext
  const transformContext = buildContextTransformer(opts.projectDir);

  // Layer 4: Hooks
  const hooks = buildResearchHooks({
    projectDir: opts.projectDir,
    maxCostUsd: opts.maxCostUsd,
    maxDurationMs: opts.maxDurationMs,
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
    toolExecution: "sequential" as any, // research tools may have side effects
    beforeToolCall: hooks.before,
    afterToolCall: hooks.after,
    getApiKey,
  });

  // Track usage + auto-checkpoint after each turn
  const agentDir = join(opts.projectDir, ".agent");
  mkdirSync(agentDir, { recursive: true });
  const checkpointPath = join(agentDir, "checkpoint.jsonl");
  let lastCheckpointedMsgCount = 0;

  agent.subscribe((event: any) => {
    if (event.type === "message_update") {
      const msg = event.assistantMessageEvent;
      if (msg?.usage) {
        hooks.trackUsage(msg.usage);
      }
    }
    if (event.type === "message_end") {
      const msg = event.message;
      if (msg?.usage) {
        hooks.trackUsage(msg.usage);
      }
    }
    // Append new messages to checkpoint after each completed turn
    if (event.type === "turn_end") {
      try {
        const messages = agent.state.messages;
        const newMessages = messages.slice(lastCheckpointedMsgCount);
        if (newMessages.length > 0) {
          const lines = newMessages.map((m: any) => JSON.stringify(m)).join("\n") + "\n";
          appendFileSync(checkpointPath, lines);
          lastCheckpointedMsgCount = messages.length;
        }
      } catch {}
    }
  });

  // Layer 5: PI fallback monitor (auto-triggers if agent doesn't request review)
  let piFallback: ReturnType<typeof setupPIFallbackMonitor> | null = null;
  if (piReview) {
    piFallback = setupPIFallbackMonitor(agent, piReview, piMonitorOpts);
  }

  // Restore from checkpoint if available
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
        agent.replaceMessages(messages);
        lastCheckpointedMsgCount = messages.length;
        return messages.length;
      }
    } catch {}
    return 0;
  } : null;

  return { agent, hooks, piFallback, restore, checkpointPath };
}
