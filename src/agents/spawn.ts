/**
 * Agent Spawner — centralized function that creates and runs any agent
 * from a registry definition. Handles: definition lookup, template resolution,
 * tool assembly, safety wrappers, context builders, tracing, and usage tracking.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { nameAgent } from "agentsmelt";
import { getModel } from "@mariozechner/pi-ai";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createCompactionTransform, getContextWindow } from "../compaction/create-transform.js";
import type { TokenTap } from "../compaction/token-tap.js";
import { extractTextContent } from "../utils.js";
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
  // OpenAI (standard API — requires OPENAI_API_KEY sk-...)
  o3: ["openai", "o3"],
  "o3-mini": ["openai", "o3-mini"],
  "o4-mini": ["openai", "o4-mini"],
  // OpenAI Codex (ChatGPT backend — works with Codex OAuth)
  "gpt-5.2": ["openai-codex", "gpt-5.2"],
  "gpt-5.2-codex": ["openai-codex", "gpt-5.2-codex"],
  "gpt-5.1": ["openai-codex", "gpt-5.1"],
  "gpt-5.1-codex-mini": ["openai-codex", "gpt-5.1-codex-mini"],
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
  createSpawnTool?: (parentId: string, depth: number, allowedSpawn?: string[]) => any;
}

export interface SpawnAgentResult {
  output: string;
  elapsed: number;
  success: boolean;
}

// ── Build agent from definition (shared by spawnAgent + subagent-runner) ──

export interface BuiltAgent {
  agent: InstanceType<typeof Agent>;
  agentId: string;
  definition: AgentDefinition;
  tokenTap: TokenTap;
}

export function buildAgentFromDefinition(opts: SpawnAgentOptions): BuiltAgent {
  const def = getDefinition(opts.name);

  const suffix = opts.instanceIndex !== undefined ? `-${opts.instanceIndex}` : "";
  const agentId = opts.parentAgentId
    ? `${opts.parentAgentId}.${opts.name}${suffix}`
    : `${opts.name}${suffix}`;
  const depth = opts.depth ?? 0;

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
    const spawnTool = opts.createSpawnTool(agentId, depth + 1, def.allowedSpawn);
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

  // 8. Build compaction transform (universal — every agent gets context compaction)
  const { transformContext, tokenTap } = createCompactionTransform({
    model,
    getApiKey: opts.getApiKey,
    thresholds: { windowLimit: getContextWindow(model) },
  });

  // 9. Create agent
  const agent = new Agent({
    initialState: {
      systemPrompt: fullPrompt,
      model,
      thinkingLevel: (def.thinkingLevel || "medium") as any,
      tools,
    },
    getApiKey: opts.getApiKey,
    transformContext,
  });
  nameAgent(agent, agentId, def.name);
  (agent as any).__smeltParent = opts.parentAgentId;

  // 10. Install token tracking (feeds packer with precise token counts after first turn)
  tokenTap.install(agent);

  return { agent, agentId, definition: def, tokenTap };
}

// ── Spawn (in-process mode) ─────────────────────────

export async function spawnAgent(opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const t0 = Date.now();

  try {
    const { agent, agentId } = buildAgentFromDefinition(opts);

    // 11. Set up incremental conversation persistence (crash-safe: written per turn, not at end)
    const convDir = join(opts.projectDir, ".agent", "conversations");
    mkdirSync(convDir, { recursive: true });
    const convPath = join(convDir, `${agentId}.jsonl`);
    let lastSavedMsgCount = 0;

    agent.subscribe((event: any) => {
      if (event.type === "turn_end") {
        try {
          const msgs = agent.state.messages;
          for (let i = lastSavedMsgCount; i < msgs.length; i++) {
            appendFileSync(convPath, JSON.stringify(msgs[i]) + "\n");
          }
          lastSavedMsgCount = msgs.length;
        } catch { /* conversation save must not crash the agent */ }
      }
    });

    // 12. Run
    await agent.prompt(opts.prompt);

    // 13. Extract output
    const messages = agent.state.messages;
    const lastAssistant = [...messages].reverse().find(
      (m: any) => m.role === "assistant",
    ) as any;
    const output = lastAssistant?.content
      ? extractTextContent(lastAssistant.content) || "(no output)"
      : "(no output)";

    // Usage tracking is handled automatically by the provider-level wrapper
    // (installUsageTracking in usage-log.ts). No manual accumulation needed.

    const elapsed = Date.now() - t0;
    return { output: output.slice(0, 50_000), elapsed, success: true };

  } catch (err: any) {
    const elapsed = Date.now() - t0;
    const msg = err.message || String(err);
    // Surface auth errors clearly
    if (msg.includes("API key") || msg.includes("authentication") || msg.includes("401") || msg.includes("getApiKey")) {
      return { output: `Agent "${opts.name}" failed: No API key. Set the appropriate env var (OPENAI_API_KEY, ANTHROPIC_API_KEY) or configure OAuth.\n\nOriginal error: ${msg}`, elapsed, success: false };
    }
    return { output: `Agent "${opts.name}" failed: ${msg}`, elapsed, success: false };
  }
}
