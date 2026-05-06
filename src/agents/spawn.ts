/**
 * Agent Spawner — centralized function that creates and runs any agent
 * from a registry definition. Handles: definition lookup, template resolution,
 * tool assembly, safety wrappers, context builders, tracing, and usage tracking.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { nameAgent } from "agentsmelt";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompactionTransform, getContextWindow } from "../compaction/create-transform.js";
import type { TokenTap } from "../compaction/token-tap.js";
import { extractTextContent } from "../utils.js";
import { getDefinition, resolvePrompt, type AgentDefinition } from "./registry.js";
import { resolveToolSets } from "./tool-sets.js";
import { resolveContextBuilder } from "./context-builders.js";
import { buildSafetyWrapper, type SafetyRuntimeHooks } from "./safety-wrappers.js";
import { jobOwnerAls } from "../jobs/als.js";
import { classifyThrownStopReason, type SubAgentExit, type SubAgentStopReason, type FileTouchRecord } from "../active-agents.js";
import { cleanMessagesForModel } from "../transform.js";
import {
  createFileContextCache,
  type FileContextCache,
} from "./file-context-cache.js";
import {
  createRecentFilesProvider,
  createAuthoritativeArtifactsProvider,
  listAuthoritativeArtifactPaths,
} from "../compaction/attachments.js";

// Path to the canonical merge-notes script (same path logic as the
// MERGE_NOTES template var in src/agent.ts). Invoked after every reader
// completes so notes/literature.md and notes/methodology.md stay in sync
// with their per-paper fragment directories — without this, the search
// agent's final MERGE_NOTES step is the only sync point and brain-driven
// reader spawns leave both aggregates stale (retry loops and cite-key
// orphan false-positives).
const MERGE_NOTES_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "skills", "search", "scripts", "merge-notes",
);

// ── Model map ────────────────────────────────────────
//
// Tuple `[provider, modelId]` resolves via pi-ai's registry. Inline-object
// form bypasses the registry for models pi-ai doesn't ship yet.

type InlineModel = {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning?: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat?: Record<string, unknown>;
};

const MODEL_MAP: Record<string, [string, string] | InlineModel> = {
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
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4-Pro",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 1.667, output: 3.333, cacheRead: 0.139, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 393216,
  },
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.139, output: 0.278, cacheRead: 0.028, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 393216,
  },
  // Moonshot vision model — vision-capable; used for illustrator/typesetter
  // when running in --profile dual mode (deepseek text + kimi vision).
  // Endpoint is the Moonshot CN OpenAI-compat API; key is KIMI_API_KEY.
  k2p5: {
    id: "moonshot-v1-32k-vision-preview",
    name: "Moonshot v1 32k (vision)",
    api: "openai-completions",
    provider: "kimi-coding",
    baseUrl: "https://api.moonshot.cn/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.0, output: 3.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  },
};

// Anthropic tier names that participate in profile redirection. When
// LUXAS_MODEL_PROFILE is set (e.g. to "deepseek-v4-flash"), any agent that
// declared one of these in its frontmatter routes to the profile model
// instead. OpenAI / Codex tiers (gpt-5.2, o3, …) bypass — those are
// deliberate provider-specific picks (math agent's reasoning, etc.) that a
// family-level switch must not stomp.
const ANTHROPIC_TIERS = new Set(["haiku", "sonnet", "opus"]);

// Agents that need image inputs (figure rendering, page-layout audit).
// In dual-mode (LUXAS_VISION_MODEL_PROFILE set), these route to the vision
// model regardless of the family-level text profile, because deepseek-* is
// text-only and silently produces unverified figures otherwise.
const VISION_REQUIRED_AGENTS = new Set([
  "illustrator",
  "illustrator_write",
  "typesetter",
]);

function applyProfile(modelKey: string, agentName?: string): string {
  if (agentName && VISION_REQUIRED_AGENTS.has(agentName)) {
    const visionProfile = process.env.LUXAS_VISION_MODEL_PROFILE;
    if (visionProfile) return visionProfile;
  }
  const profile = process.env.LUXAS_MODEL_PROFILE;
  if (!profile) return modelKey;
  if (ANTHROPIC_TIERS.has(modelKey)) return profile;
  return modelKey;
}

export function resolveModel(modelKey: string, agentName?: string) {
  const effectiveKey = applyProfile(modelKey, agentName);
  const entry = MODEL_MAP[effectiveKey] ?? MODEL_MAP.sonnet;
  if (Array.isArray(entry)) return getModel(entry[0] as any, entry[1] as any);
  return entry as any;
}

// "Require any tool" tool_choice value, per provider+model. The brain and
// every sub-agent's streamFn calls this so the silent-exit guard (force a
// tool_use on every turn) sends the strongest tool-forcing value the
// underlying API actually accepts:
//
//   - anthropic            → "any"      (Anthropic-native)
//   - reasoning models     → "auto"     (deepseek-reasoner rejects forced
//                                        tool_choice with HTTP 400; we
//                                        accept the silent-exit risk Mu's
//                                        guard normally prevents — observed
//                                        rarely on Claude per d19ec9f's
//                                        comment)
//   - everything else      → "required" (OpenAI chat-completions spec since
//                                        Jun 2024; deepseek-chat + openai-
//                                        codex share that wire format)
export function pickRequireToolChoice(model: any): "any" | "required" | "auto" {
  if (model?.provider === "anthropic") return "any";
  if (model?.reasoning) return "auto";
  return "required";
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
   * Only used when `def.spawn.enabled` is true.
   */
  createSpawnTool?: (parentId: string, depth: number, allowedTypes?: string[]) => any;
  /**
   * Override for agent-definition lookup. Default is the production registry's
   * getDefinition. Meta-agents pass `getMetaDefinition` here so the same
   * spawn machinery drives both layers without a forked spawn module.
   */
  resolveDefinition?: (name: string) => AgentDefinition;
  /**
   * Runtime observer hooks threaded into the safety wrapper (and future
   * Phase 3 file-context sink). Foreground spawn and subagent-runner each
   * allocate their own hook instance so fileTouches are scoped to one run.
   */
  runtimeHooks?: SafetyRuntimeHooks;
  /**
   * Per-run length-truncation recovery state. When provided,
   * buildAgentFromDefinition's streamFn will read maxTokensCap from the
   * controller on every call so an outer retry loop (runWithLengthRecovery)
   * can bump the cap between attempts.
   */
  lengthRecovery?: LengthRecoveryController;
  /**
   * Continue-mode: revive an existing logical agent. agentId reuses the same
   * conv jsonl. messages are run through cleanMessagesForModel and replayed
   * into the new Agent. revisionNumber is 1-indexed; surfaces on
   * exit.revisionNumber for cap awareness.
   */
  resume?: {
    agentId: string;
    messages: any[];
    revisionNumber: number;
  };
}

export interface SpawnAgentResult {
  output: string;
  elapsed: number;
  success: boolean;
  /**
   * Structured completion metadata. Always populated for spawnAgent() (foreground
   * / parallel path); callers that invoked spawnAgent directly can inspect
   * `exit.stopReason` to decide retry policy without parsing output text.
   */
  exit: SubAgentExit;
  /**
   * Stable identity of the spawned (or continued) agent. Surfacing this to
   * callers is what makes spawn_agent(action="continue", id=...) usable —
   * without it the LLM has no way to refer back to a foreground sub-agent.
   * Same value as the agentId persisted in the conv jsonl filename.
   */
  agentId: string;
}

// ── Build agent from definition (shared by spawnAgent + subagent-runner) ──

export interface BuiltAgent {
  agent: InstanceType<typeof Agent>;
  agentId: string;
  definition: AgentDefinition;
  tokenTap: TokenTap;
  /**
   * Per-agent file-context cache populated via safety-wrapper hooks on
   * every successful read/write/edit. Consumed by the compaction
   * transform's recent-files attachment provider, but exposed here so
   * external callers can inspect session-scoped file state if needed.
   */
  fileContextCache: FileContextCache;
}

// ── Runtime-hook composition ────────────────────────────────────────

/** Combine several SafetyRuntimeHooks instances into one; undefined entries ignored. */
function mergeRuntimeHooks(
  ...hooks: (SafetyRuntimeHooks | undefined)[]
): SafetyRuntimeHooks {
  const defined = hooks.filter((h): h is SafetyRuntimeHooks => !!h);
  return {
    onFileTouched: (e) => { for (const h of defined) h.onFileTouched?.(e); },
    onFileContextEntry: (e) => { for (const h of defined) h.onFileContextEntry?.(e); },
  };
}

export function buildAgentFromDefinition(opts: SpawnAgentOptions): BuiltAgent {
  const def = (opts.resolveDefinition ?? getDefinition)(opts.name);

  // Continue-mode reuses the prior agentId verbatim so the resumed run
  // appends to the same conv jsonl — one tool ↔ one jsonl ↔ one logical
  // agent. instanceIndex makes parallel batches predictable (-0, -1, …);
  // otherwise we want a random suffix so independent foreground spawns of
  // the same agent type (one reader per paper) don't collide on a shared
  // conversation file.
  const suffix = opts.instanceIndex !== undefined
    ? `-${opts.instanceIndex}`
    : `-${Math.random().toString(36).slice(2, 8)}`;
  const agentId = opts.resume?.agentId
    ?? (opts.parentAgentId
      ? `${opts.parentAgentId}.${opts.name}${suffix}`
      : `${opts.name}${suffix}`);
  const depth = opts.depth ?? 0;

  // 1. Resolve model
  const modelKey = opts.modelOverride ?? def.model;
  const model = modelKey === "inherit" ? resolveModel("sonnet", opts.name) : resolveModel(modelKey, opts.name);

  // 2. Resolve system prompt with template variables
  // Inject SPAWN_ID = agentId so prompts can include the spawn-unique id in
  // output paths (e.g. reviews/illustrator_notes.{{SPAWN_ID}}.md) — prevents
  // single-writer races when multiple instances of the same agent type run
  // concurrently. Caller-supplied templateVars take precedence.
  const templateVarsWithSpawn = { SPAWN_ID: agentId, ...opts.templateVars };
  const systemPrompt = resolvePrompt(def, templateVarsWithSpawn);

  // 3. Build tools from tool-sets
  let tools = resolveToolSets(def.toolSets, opts.projectDir);

  // 4. Apply safety wrapper if defined.
  // Create a per-run FileContextCache and wire it into the wrapper's
  // onFileContextEntry hook. The same cache feeds the compaction
  // transform's recent-files attachment provider (step 8) — one cache,
  // two consumers (safety enforcement + compaction carry-forward).
  const fileContextCache = createFileContextCache();
  const fileContextHooks: SafetyRuntimeHooks = {
    onFileContextEntry: ({ absPath, entry }) => { fileContextCache.set(absPath, entry); },
  };
  const mergedHooks = mergeRuntimeHooks(opts.runtimeHooks, fileContextHooks);

  const wrapper = buildSafetyWrapper(def.safety);
  if (wrapper) {
    tools = wrapper(tools, opts.projectDir, templateVarsWithSpawn, mergedHooks);
  }

  // 5. Add tool overrides (e.g., PI verdict tool)
  if (opts.toolOverrides) {
    tools = [...tools, ...opts.toolOverrides];
  }

  // 6. Spawn tool (gated on the definition + global depth cap)
  if (def.spawn.enabled && depth < MAX_SPAWN_DEPTH && opts.createSpawnTool) {
    const spawnTool = opts.createSpawnTool(agentId, depth + 1, def.spawn.allowedTypes);
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

  // 8. Build compaction transform (universal — every agent gets context
  // compaction). Attachment providers are the Phase 3b carry-forward path:
  //   - recent files come from the fileContextCache populated by the
  //     safety wrapper's hooks above
  //   - authoritative artifacts (plan.md/memory.md/methodology.md/…) are
  //     read from disk at compact time so they survive lossy summary
  //
  // Paths covered by authoritative providers are excluded from the recent-
  // files provider so the same file doesn't appear twice in the rebuilt
  // conversation.
  const authoritativePaths = listAuthoritativeArtifactPaths(opts.projectDir);
  const { transformContext, tokenTap } = createCompactionTransform({
    model,
    getApiKey: opts.getApiKey,
    thresholds: { windowLimit: getContextWindow(model) },
    attachmentProviders: [
      createRecentFilesProvider(fileContextCache, {
        projectDir: opts.projectDir,
        excludePaths: authoritativePaths,
      }),
      createAuthoritativeArtifactsProvider({ projectDir: opts.projectDir }),
    ],
  });

  // 9. Create agent
  // streamFn wrapper: force toolChoice: "any" — see detailed note in src/agent.ts
  // (brain agent). Same rationale applies to every sub-agent (reader, experiment,
  // tool_impl, tool_review, reviewer, illustrator, math, etc.): a thinking-only
  // or length-truncated response with no tool_use silently terminates the
  // sub-agent via pi-agent-core's `toolCalls.length === 0` exit. Forcing
  // tool_use at the provider level eliminates this failure mode uniformly.
  //
  // If a lengthRecovery controller is attached, the streamFn reads its current
  // maxTokensCap on every call. The outer retry loop sets LARGE_CAP on the
  // first recovery attempt and resets to provider default afterward — the
  // closure always sees the latest value without rebuilding the Agent.
  const agent = new Agent({
    initialState: {
      systemPrompt: fullPrompt,
      model,
      thinkingLevel: (def.thinkingLevel || "medium") as any,
      tools,
    },
    getApiKey: opts.getApiKey,
    transformContext,
    streamFn: (m, ctx, streamOpts) => {
      const cap = opts.lengthRecovery?.state.maxTokensCap;
      const merged: any = { ...streamOpts, toolChoice: pickRequireToolChoice(m) };
      if (cap !== undefined) merged.maxTokens = cap;
      return streamSimple(m, ctx, merged);
    },
  });
  nameAgent(agent, agentId, def.name);
  (agent as any).__smeltParent = opts.parentAgentId;

  // 10. Install token tracking (feeds packer with precise token counts after first turn)
  tokenTap.install(agent);

  return { agent, agentId, definition: def, tokenTap, fileContextCache };
}

// ── Length-truncation recovery (B-level outer retry controller) ────

/**
 * Continuation prompt shown to the model as an isMeta user message when a
 * response got cut off by max_tokens. Structural marker, not instructional —
 * short on purpose so it doesn't re-program the model's behavior beyond
 * "resume from the cut". The actual "break into smaller pieces" hint lives
 * in the text because the model can usefully act on it.
 */
export const LENGTH_RECOVERY_CONTINUE_PROMPT =
  "[auto] Your previous response was truncated at max_tokens. Continue from exactly where you were cut off. " +
  "Do not restart, do not recap. If the remaining work is large, split it into smaller tool calls (write a " +
  "skeleton first, then extend via edit) so each call fits.";

/** Cap for the first recovery attempt — give the model one chance at more room. */
export const LENGTH_RECOVERY_LARGE_CAP = 64_000;

/** Total recovery attempts after the initial prompt resolves with stopReason=length. */
export const LENGTH_RECOVERY_MAX_ATTEMPTS = 3;

export interface LengthRecoveryState {
  /** undefined → provider default; set to LENGTH_RECOVERY_LARGE_CAP on first recovery. */
  maxTokensCap?: number;
  /** True after the first "raise cap" attempt. Subsequent attempts reset cap to default. */
  triedLargeCap: boolean;
  /** How many recovery attempts have been committed (capped at LENGTH_RECOVERY_MAX_ATTEMPTS). */
  attemptsUsed: number;
}

export interface LengthRecoveryController {
  readonly state: LengthRecoveryState;
  setLargeCap(): void;
  resetCap(): void;
  markAttempt(): void;
}

export function createLengthRecoveryController(): LengthRecoveryController {
  const state: LengthRecoveryState = { maxTokensCap: undefined, triedLargeCap: false, attemptsUsed: 0 };
  return {
    state,
    setLargeCap() { state.maxTokensCap = LENGTH_RECOVERY_LARGE_CAP; state.triedLargeCap = true; },
    resetCap() { state.maxTokensCap = undefined; },
    markAttempt() { state.attemptsUsed += 1; },
  };
}

function lastAssistantStopReason(agent: InstanceType<typeof Agent>): string | undefined {
  const msgs = agent.state.messages as any[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") return msgs[i].stopReason;
  }
  return undefined;
}

/**
 * Run agent.prompt(initialPrompt) with automatic length-truncation recovery.
 *
 * Strategy (B-level outer retry, per Phase 2 design):
 *   1. First attempt: default cap (controller state untouched).
 *   2. If stopReason === "length" and attemptsUsed < MAX:
 *      - First recovery: raise cap to LARGE_CAP, inject isMeta continue marker, continue().
 *      - Subsequent recoveries: reset cap to default, same marker, continue().
 *   3. Stop when stopReason !== "length" OR attemptsUsed === MAX.
 *
 * The final state reflects the last attempt — if all attempts were length,
 * the SubAgentExit contract will carry stopReason="length" up to the parent
 * (PR-1), which is then responsible for deciding task-level retry policy.
 *
 * Uses agent.continue() after the first prompt so no duplicate user-prompt
 * message is appended for the resume — the isMeta marker we insert via
 * replaceMessages() is the new last message, and continue() runs the loop
 * starting from there.
 */
export async function runWithLengthRecovery(
  agent: InstanceType<typeof Agent>,
  initialPrompt: string,
  recovery: LengthRecoveryController,
): Promise<void> {
  await agent.prompt(initialPrompt);
  await driveAgentWithLengthRecovery(agent, recovery);
}

/**
 * Continue-mode counterpart to runWithLengthRecovery. Caller has already
 * loaded prior messages via agent.replaceMessages(...) and we drive a fresh
 * turn keyed by `newUserMessage`. The new message is a real user task, NOT
 * isMeta — it carries actual semantic payload (pytest output, fix request).
 * Counting/marker bookkeeping is the caller's job (continue_init in the conv
 * jsonl); this function only drives the loop.
 */
export async function continueWithLengthRecovery(
  agent: InstanceType<typeof Agent>,
  newUserMessage: string,
  recovery: LengthRecoveryController,
): Promise<void> {
  await agent.followUp({
    role: "user",
    content: newUserMessage,
    timestamp: Date.now(),
  } as any);
  await agent.continue();
  await driveAgentWithLengthRecovery(agent, recovery);
}

/**
 * Inner length-recovery loop shared by initial spawn (runWithLengthRecovery)
 * and continue (continueWithLengthRecovery). Repeats while the last assistant
 * message stopped at max_tokens AND we have remaining attempts. The injected
 * "continue from cut" marker IS isMeta — it's structural noise, not a task.
 */
async function driveAgentWithLengthRecovery(
  agent: InstanceType<typeof Agent>,
  recovery: LengthRecoveryController,
): Promise<void> {
  while (
    recovery.state.attemptsUsed < LENGTH_RECOVERY_MAX_ATTEMPTS &&
    lastAssistantStopReason(agent) === "length"
  ) {
    recovery.markAttempt();
    if (!recovery.state.triedLargeCap) {
      recovery.setLargeCap();
    } else {
      recovery.resetCap();
    }

    const messages = agent.state.messages as any[];
    agent.replaceMessages([
      ...messages,
      { role: "user", content: LENGTH_RECOVERY_CONTINUE_PROMPT, isMeta: true, timestamp: Date.now() } as any,
    ]);
    await agent.continue();
  }
}

// ── Completion metadata helpers ─────────────────────

/**
 * Map pi-ai's stop reason vocabulary to the SubAgentExit contract.
 * pi-ai emits: "stop" | "length" | "toolUse" | "error" | "aborted" | undefined.
 * "toolUse" is an intermediate signal inside pi-agent-core's loop; a terminal
 * "toolUse" on the final assistant message is unexpected and mapped to
 * "unknown" rather than faking one of the canonical outcomes.
 */
function normalizeStopReason(raw: unknown): SubAgentStopReason {
  switch (raw) {
    case "stop": return "stop";
    case "length": return "length";
    case "error": return "error";
    case "aborted": return "killed";
    default: return "unknown";
  }
}

/**
 * Soft cap on the number of unique (path, via) records kept in memory.
 * Bounded by unique artifacts, not raw touches — an agent that edits the
 * same file 10k times stays at one entry, but one that writes 10k distinct
 * files stops collecting after this many. The cap applies post-dedup so
 * repeated writes to a single file can't squeeze out later unique artifacts.
 */
const MAX_UNIQUE_FILE_TOUCHES = 500;

const touchKey = (path: string, via: "write" | "edit"): string => `${path}\0${via}`;

/**
 * Per-run collector for sub-agent completion metadata. Encapsulates the
 * fileTouches buffer, hook wiring, and agent/tokenTap captures that both
 * spawnAgent and subagent-runner need, so the call sites reduce to:
 *
 *     const collector = createSubAgentExitCollector(Date.now());
 *     const { agent, tokenTap } = buildAgentFromDefinition({ ..., runtimeHooks: collector.runtimeHooks });
 *     collector.attach(agent, tokenTap);
 *     // ... run agent ...
 *     const exit = collector.finalize();   // or collector.finalize(stopReason) in catch
 *
 * If a LengthRecoveryController is attached via attachRecovery(), finalize()
 * will populate SubAgentExit.recoveryAttemptsUsed from the controller state.
 */
export interface SubAgentExitCollector {
  readonly runtimeHooks: SafetyRuntimeHooks;
  attach(agent: InstanceType<typeof Agent>, tokenTap: TokenTap): void;
  attachRecovery(recovery: LengthRecoveryController): void;
  /**
   * Continue-mode bookkeeping: record the 1-indexed revisionNumber for THIS
   * run so finalize() can stamp it onto the SubAgentExit. Initial spawns
   * leave it unset and exit.revisionNumber stays undefined.
   */
  attachRevisionNumber(n: number): void;
  finalize(overrideStopReason?: SubAgentStopReason): SubAgentExit;
}

export function createSubAgentExitCollector(t0: number): SubAgentExitCollector {
  // Dedup-on-push: Map keyed by (path, via) with latest `at` wins. Bounds
  // the buffer by unique artifacts, so repeated writes to the same file
  // don't starve later unique artifacts of their slot. A file that is both
  // written and later edited keeps two records since the key is (path, via).
  const touches = new Map<string, FileTouchRecord>();
  let agent: InstanceType<typeof Agent> | null = null;
  let tokenTap: TokenTap | null = null;
  let recovery: LengthRecoveryController | null = null;
  let revisionNumber: number | undefined;

  return {
    runtimeHooks: {
      onFileTouched: (e) => {
        const key = touchKey(e.path, e.via);
        if (!touches.has(key) && touches.size >= MAX_UNIQUE_FILE_TOUCHES) return;
        touches.set(key, e);
      },
    },
    attach(a, t) { agent = a; tokenTap = t; },
    attachRecovery(r) { recovery = r; },
    attachRevisionNumber(n) { revisionNumber = n; },
    finalize(overrideStopReason) {
      const ordered = [...touches.values()].sort((a, b) => a.at - b.at);
      const exit = buildSubAgentExit(agent, t0, ordered, tokenTap, overrideStopReason);
      if (recovery && recovery.state.attemptsUsed > 0) {
        exit.recoveryAttemptsUsed = recovery.state.attemptsUsed;
      }
      if (revisionNumber !== undefined) {
        exit.revisionNumber = revisionNumber;
      }
      return exit;
    },
  };
}

/**
 * Build a SubAgentExit from an Agent instance + side-channel data (elapsed,
 * touches, tokenTap). Safe to call in both the success and error paths —
 * returns best-effort values (stopReason "unknown" is valid). Does not throw.
 */
export function buildSubAgentExit(
  agent: InstanceType<typeof Agent> | null,
  t0: number,
  fileTouches: FileTouchRecord[],
  tokenTap: TokenTap | null,
  overrideStopReason?: SubAgentStopReason,
): SubAgentExit {
  let stopReason: SubAgentStopReason = overrideStopReason ?? "unknown";
  let partialAssistantText: string | undefined;
  let toolCallCount = 0;

  if (agent) {
    try {
      const messages = agent.state.messages as any[];
      // stopReason: from the last assistant message if not overridden.
      if (!overrideStopReason) {
        const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          stopReason = normalizeStopReason(lastAssistant.stopReason);
          if (stopReason === "length") {
            partialAssistantText = extractTextContent(lastAssistant.content ?? []) || undefined;
          }
        }
      }
      // toolCallCount: sum across all assistant messages — parent heuristics
      // (e.g. "sub-agent made 0 tool calls" = suspect) care about totals.
      for (const m of messages) {
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b && typeof b === "object" && (b.type === "toolCall" || b.type === "tool_use")) {
              toolCallCount++;
            }
          }
        }
      }
    } catch { /* best-effort — exit contract tolerates missing fields */ }
  }

  return {
    stopReason,
    partialAssistantText,
    // Input is expected to already be deduped+sorted by the collector. Direct
    // callers that bypass the collector are responsible for normalizing.
    filesTouched: fileTouches,
    elapsedMs: Date.now() - t0,
    toolCallCount,
    lastContextTokens: tokenTap?.lastContextTokens,
    endedAt: new Date().toISOString(),
  };
}

// ── Spawn (in-process mode) ─────────────────────────

export async function spawnAgent(opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const collector = createSubAgentExitCollector(Date.now());
  const recovery = createLengthRecoveryController();
  collector.attachRecovery(recovery);
  if (opts.resume) {
    collector.attachRevisionNumber(opts.resume.revisionNumber);
  }
  const isResume = !!opts.resume;

  // Hoisted so the catch block can still surface an id when build throws.
  let agentId: string = opts.resume?.agentId ?? "";

  try {
    const built = buildAgentFromDefinition({
      ...opts,
      runtimeHooks: collector.runtimeHooks,
      lengthRecovery: recovery,
    });
    const { agent, tokenTap } = built;
    agentId = built.agentId;
    collector.attach(agent, tokenTap);

    const convDir = join(opts.projectDir, ".agent", "conversations");
    mkdirSync(convDir, { recursive: true });
    const convPath = join(convDir, `${agentId}.jsonl`);

    // Birth/revision marker eagerly so the jsonl exists even if the first
    // turn throws (otherwise: ghost agents where parent jsonl never appears).
    // spawn_init carries templateVars so a future continue can recover scope;
    // continue_init has no such payload — the marker only delimits revision
    // boundaries, the count itself is derivable from how many such lines exist.
    if (isResume) {
      appendFileSync(convPath, JSON.stringify({
        type: "continue_init",
        newTask: opts.prompt.slice(0, 2000),
        timestamp: Date.now(),
      }) + "\n");
    } else {
      appendFileSync(convPath, JSON.stringify({
        type: "spawn_init",
        agent: opts.name,
        task: opts.prompt.slice(0, 2000),
        parentAgentId: opts.parentAgentId,
        templateVars: opts.templateVars,
        timestamp: Date.now(),
      }) + "\n");
    }

    // Resume MUST replaceMessages before subscribing — otherwise the first
    // turn_end re-appends the full prior history and doubles the jsonl.
    if (isResume) {
      const currentModel = (agent.state as any).model;
      const cleaned = cleanMessagesForModel(opts.resume!.messages, {
        provider: currentModel?.provider,
        id: currentModel?.id,
      });
      agent.replaceMessages(cleaned);
    }
    let lastSavedMsgCount = (agent.state.messages as any[]).length;

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

    await jobOwnerAls.run(
      { agentId, agentType: opts.name, projectDir: opts.projectDir },
      () => isResume
        ? continueWithLengthRecovery(agent, opts.prompt, recovery)
        : runWithLengthRecovery(agent, opts.prompt, recovery),
    );

    // Reader post-hook: rebuild notes/methodology.md + notes/literature.md
    // from their per-paper fragment dirs so both aggregates stay fresh
    // after any single reader spawn. Without this, brain-driven readers
    // (which bypass search's final MERGE_NOTES step) leave the ledgers
    // stale — findUnprocessedPapers retry-loops on methodology.md, and
    // the citation-integrity reminder flags cite_keys as orphan against
    // literature.md even when the fragment exists. merge-notes is
    // idempotent and atomic, ~50ms.
    if (opts.name === "reader") {
      try {
        execFileSync("node", [MERGE_NOTES_SCRIPT, opts.projectDir], {
          stdio: "pipe",
          timeout: 10_000,
        });
      } catch { /* merge failure must not fail the spawn */ }
    }

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

    const exit = collector.finalize();
    return { output: output.slice(0, 50_000), elapsed: exit.elapsedMs, success: true, exit, agentId };

  } catch (err: any) {
    const msg = err.message || String(err);
    // classifyThrownStopReason distinguishes user-initiated abort (SIGINT/
    // agent.abort() → "killed") from real failures ("error").
    const exit = collector.finalize(classifyThrownStopReason(err));
    // Surface auth errors clearly
    if (msg.includes("API key") || msg.includes("authentication") || msg.includes("401") || msg.includes("getApiKey")) {
      return {
        output: `Agent "${opts.name}" failed: No API key. Set the appropriate env var (OPENAI_API_KEY, ANTHROPIC_API_KEY) or configure OAuth.\n\nOriginal error: ${msg}`,
        elapsed: exit.elapsedMs,
        success: false,
        exit,
        agentId,
      };
    }
    return { output: `Agent "${opts.name}" failed: ${msg}`, elapsed: exit.elapsedMs, success: false, exit, agentId };
  }
}
