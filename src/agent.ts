/**
 * Research Agent — assembles the four layers on top of agent-core.
 *
 * Layer 1: System Prompt (prompt.ts)
 * Layer 2: Tools (tools/index.ts)
 * Layer 3: transformContext (context.ts)
 * Layer 4: Hooks (hooks.ts)
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { buildResearchPrompt } from "./prompt.js";
import { buildResearchTools } from "./tools/index.js";
import { buildContextTransformer } from "./context.js";
import { buildResearchHooks } from "./hooks.js";
import { getApiKey } from "./auth.js";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export interface ResearchAgentOptions {
  projectDir: string;
  model?: string;              // "sonnet" | "opus" | "haiku" (default: sonnet)
  thinkingLevel?: ThinkingLevel;
  maxCostUsd?: number;
  maxDurationMs?: number;
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

  // Layer 2: Tools
  const tools = buildResearchTools(opts.projectDir, model, getApiKey);

  // Layer 3: transformContext
  const transformContext = buildContextTransformer(opts.projectDir);

  // Layer 4: Hooks
  const hooks = buildResearchHooks({
    projectDir: opts.projectDir,
    maxCostUsd: opts.maxCostUsd,
    maxDurationMs: opts.maxDurationMs,
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
    toolExecution: "sequential" as any, // research tools may have side effects
    beforeToolCall: hooks.before,
    afterToolCall: hooks.after,
    getApiKey,
  });

  // Track usage from agent events
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
  });

  return { agent, hooks };
}
