/**
 * Agent Spawner — centralized function that creates and runs any agent
 * from a registry definition. Handles: definition lookup, template resolution,
 * tool assembly, safety wrappers, context builders, tracing, and usage tracking.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { nameAgent } from "agentsmelt";
import { getModel } from "@mariozechner/pi-ai";
import { getDefinition, resolvePrompt, type AgentDefinition } from "./registry.js";
import { resolveToolSets } from "./tool-sets.js";
import { resolveContextBuilder } from "./context-builders.js";
import { resolveSafetyWrapper } from "./safety-wrappers.js";

// ── Model map ────────────────────────────────────────

const MODEL_MAP: Record<string, [string, string]> = {
  // Anthropic
  haiku: ["anthropic", "claude-haiku-4-5-20251001"],
  sonnet: ["anthropic", "claude-sonnet-4-6"],
  opus: ["anthropic", "claude-opus-4-6"],
  // OpenAI
  o3: ["openai", "o3"],
  "o3-mini": ["openai", "o3-mini"],
  "o4-mini": ["openai", "o4-mini"],
};

function resolveModel(modelKey: string) {
  const entry = MODEL_MAP[modelKey] ?? MODEL_MAP.sonnet;
  return getModel(entry[0] as any, entry[1] as any);
}

// ── Max spawn depth ──────────────────────────────────

const MAX_SPAWN_DEPTH = 2;

// ── Spawn options ────────────────────────────────────

export interface SpawnAgentOptions {
  /** Agent definition name (must exist in registry). */
  name: string;
  /** Template variables for prompt resolution (e.g., PROJECT_DIR). */
  templateVars: Record<string, string>;
  /** Task prompt sent to the agent. */
  prompt: string;
  /** Project directory (for tool creation). */
  projectDir: string;
  /** API key resolver. */
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
  /** Usage tracking callback (costs roll up to parent). */
  trackUsage?: (usage: any) => void;
  /** Override the definition's default model. */
  modelOverride?: string;
  /** Additional tools to include (e.g., PI's verdict tool). */
  toolOverrides?: any[];
  /** Extra data passed to the context builder. */
  contextExtra?: Record<string, any>;
  /** Current spawn depth (for recursion tracking). */
  depth?: number;
  /** Parent agent ID (for trace chain). */
  parentAgentId?: string;
  /** Instance index (for parallel spawning, e.g., worker-0, worker-1). */
  instanceIndex?: number;
  /**
   * Factory for the spawn_agent tool — injected by spawn-agent.ts to avoid circular imports.
   * Only used when the definition has canSpawn: true.
   */
  createSpawnTool?: (parentId: string, depth: number) => any;
}

export interface SpawnAgentResult {
  output: string;
  elapsed: number;
  success: boolean;
}

// ── Spawn ────────────────────────────────────────────

export async function spawnAgent(opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const def = getDefinition(opts.name);
  const t0 = Date.now();

  // Build hierarchical agent ID for tracing (use '.' separator, not '/' — agentsmelt uses IDs in file paths)
  const suffix = opts.instanceIndex !== undefined ? `-${opts.instanceIndex}` : "";
  const agentId = opts.parentAgentId
    ? `${opts.parentAgentId}.${opts.name}${suffix}`
    : `${opts.name}${suffix}`;
  const depth = opts.depth ?? 0;

  try {
    // 1. Resolve model
    const modelKey = opts.modelOverride ?? def.model;
    const model = modelKey === "inherit" ? resolveModel("sonnet") : resolveModel(modelKey);

    // 2. Resolve system prompt with template variables
    const systemPrompt = resolvePrompt(def, opts.templateVars);

    // 3. Build tools from tool-sets
    let tools = resolveToolSets(def.toolSets, opts.projectDir);

    // 4. Apply safety wrapper if defined
    const wrapper = resolveSafetyWrapper(def.safetyWrapper);
    if (wrapper) {
      tools = wrapper(tools, opts.projectDir);
    }

    // 5. Add tool overrides (e.g., PI verdict tool)
    if (opts.toolOverrides) {
      tools = [...tools, ...opts.toolOverrides];
    }

    // 6. If canSpawn and within depth limit, inject spawn_agent tool for recursion
    if (def.canSpawn && depth < MAX_SPAWN_DEPTH && opts.createSpawnTool) {
      const spawnTool = opts.createSpawnTool(agentId, depth + 1);
      tools = [...tools, spawnTool];
    }

    // 7. Build dynamic context if context builder is defined
    let fullPrompt = systemPrompt;
    const contextBuilder = resolveContextBuilder(def.contextBuilder);
    if (contextBuilder) {
      const context = contextBuilder(opts.projectDir, opts.contextExtra);
      if (context) {
        fullPrompt += "\n\n" + context;
      }
    }

    // 8. Create agent
    const agent = new Agent({
      initialState: {
        systemPrompt: fullPrompt,
        model,
        thinkingLevel: (def.thinkingLevel || "medium") as any,
        tools,
      },
      getApiKey: opts.getApiKey,
    });
    nameAgent(agent, agentId, def.name);
    // Set parent for trace chain
    (agent as any).__smeltParent = opts.parentAgentId;

    // 9. Run
    await agent.prompt(opts.prompt);

    // 10. Extract output
    const messages = agent.state.messages;
    const lastAssistant = [...messages].reverse().find(
      (m: any) => m.role === "assistant",
    ) as any;
    const output = lastAssistant?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") ?? "(no output)";

    // 11. Track usage
    if (opts.trackUsage) {
      for (const m of agent.state.messages) {
        if ((m as any).role === "assistant" && (m as any).usage) {
          opts.trackUsage((m as any).usage);
        }
      }
    }

    const elapsed = Date.now() - t0;
    return { output: output.slice(0, 50_000), elapsed, success: true };

  } catch (err: any) {
    const elapsed = Date.now() - t0;
    const msg = err.message || String(err);
    // Surface auth errors clearly
    if (msg.includes("API key") || msg.includes("authentication") || msg.includes("401") || msg.includes("getApiKey")) {
      return { output: `Agent "${opts.name}" failed: No API key for provider "${def.model}". Set the appropriate env var (OPENAI_API_KEY, ANTHROPIC_API_KEY) or configure OAuth.\n\nOriginal error: ${msg}`, elapsed, success: false };
    }
    return { output: `Agent "${opts.name}" failed: ${msg}`, elapsed, success: false };
  }
}
