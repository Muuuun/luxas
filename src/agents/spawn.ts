/**
 * Agent Spawner — centralized function that creates and runs any agent
 * from a registry definition. Handles: definition lookup, template resolution,
 * tool assembly, safety wrappers, context builders, tracing, and usage tracking.
 */

import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompactionTransform, getContextWindow } from "../compaction/create-transform.js";
import type { TokenTap } from "../compaction/token-tap.js";
import { extractTextContent } from "../utils.js";
import { getDefinition, loadAgentDefinitions, resolvePrompt, type AgentDefinition } from "./registry.js";
import { resolveToolSets } from "./tool-sets.js";
import { resolveContextBuilder } from "./context-builders.js";
import { buildSafetyWrapper, type SafetyRuntimeHooks } from "./safety-wrappers.js";
import { jobOwnerAls } from "../jobs/als.js";
import { recordAgentOutcome } from "../agent-liveness.js";
import { addAgent, removeAgent, classifyThrownStopReason, type SubAgentExit, type SubAgentStopReason, type FileTouchRecord } from "../active-agents.js";
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
  /** pi-ai thinking-level → provider reasoning_effort (null = send none). */
  thinkingLevelMap?: Record<string, string | null>;
  /**
   * The model 400s on forced tool choice (`tool_choice` "any"/"tool"). Luxas
   * sends a forced choice every turn as its silent-exit guard, so such a model
   * must get "auto" instead or every single turn fails. See pickRequireToolChoice.
   */
  noForcedToolChoice?: boolean;
};

// DeepSeek V4 (docs 2026-08: api-docs.deepseek.com/quick_start/pricing).
// v4-pro is DeepSeek's most capable model (server revision 0813); nothing
// newer is exposed. `compat` mirrors pi-ai's own catalog entry so thinking
// mode is requested explicitly (`thinking: {type: "enabled"}`) and
// reasoning_content is echoed back on assistant turns as the API requires;
// `thinkingLevelMap` sends reasoning_effort only for the levels DeepSeek
// defines ("high" / "max"). Prices are the documented PEAK rates so the cost
// cap never under-counts (the catalog lists off-peak).
const DEEPSEEK_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
} as const;
const DEEPSEEK_THINKING: Record<string, string | null> = { minimal: null, low: null, medium: null, high: "high", max: "max" };

const MODEL_MAP: Record<string, [string, string] | InlineModel> = {
  // Claude Fable 5.1 — selectable, NOT wired into any profile (2026-09-04).
  // pi-ai's catalog has claude-fable-5 but not 5.1, and asking getModel for the
  // 5.1 id returns a hollow object with an undefined id, so it needs a real
  // entry here.
  //
  // Two things had to be true before it could run in this harness at all:
  //  1. `noForcedToolChoice` — it 400s on the forced tool choice Luxas sends
  //     every turn. That is the structural blocker, fixed in pickRequireToolChoice.
  //  2. Refusals. It declines a cluster of neutral-atom physics REVIEW prompts
  //     with `stop_reason: "refusal"`, `category: "cyber"`, zero output — the
  //     same content opus-4-6 and sonnet-5 answer normally. Measured: 4 of 5
  //     representative Luxas tasks passed (blind-test authoring, derivation,
  //     report prose, experiment design); the review-shaped one refused, while
  //     the same shape about chemistry passed. The documented remedy works —
  //     `anthropic-beta: server-side-fallback-2026-07-01` + `fallbacks:"default"`
  //     rescued the refused prompt, served by claude-opus-4-8 — but it needs a
  //     beta header pi-ai's anthropic path does not expose today. Until that is
  //     wired, a refusal arrives as an EMPTY assistant turn with no explanation.
  //     Do not route the reviewer layer here.
  "claude-fable-5-1": {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    contextWindow: 1000000,
    maxTokens: 128000,
    noForcedToolChoice: true,
  },
  // Anthropic. Bumped to the 5 tier 2026-09-04; the previous pins
  // (sonnet-4-6 / opus-4-6) had stood untouched since 2026-03-31 and predated
  // both models. Live-probed the same day with `tool_choice: {type: "any"}` +
  // adaptive thinking — the exact shape pickRequireToolChoice sends — and both
  // returned clean tool_use. pi-ai's bundled catalog already carries correct
  // pricing for them, so cost accounting needed no new entry.
  //   sonnet 4-6 → 5 : $3/$15 → $2/$10 per M, and a tokenizer that billed 552
  //                    input tokens where 4-6 billed 652 on an identical prompt.
  //   opus   4-6 → 5 : same $5/$25, 484 tokens where 4-6 billed 652.
  // NOT claude-fable-5-1: it rejects forced tool choice outright
  // (`tool_choice: type "tool" and "any" are not supported for this model`),
  // and that is the mechanism of the silent-exit guard. Adopting it means
  // reworking pickRequireToolChoice to "auto" + a prompt instruction first.
  // The haiku pin keeps its date suffix only because pi-ai's catalog lists it;
  // current guidance is to use the bare `claude-haiku-4-5`.
  haiku: ["anthropic", "claude-haiku-4-5-20251001"],
  sonnet: ["anthropic", "claude-sonnet-5"],
  // opus stays on 4.6. claude-opus-5 was pinned here for ~2 h on 2026-09-04 and
  // REVERTED the same day: it refuses ordinary neutral-atom physics review with
  // `stop_reason: "refusal"`, `category: "cyber"` and zero output tokens.
  // Measured on the real E6 adjudication prompt from the Ba trace
  // (notes/figure-pipeline-review-2026-09-02.md §4.7a):
  //     claude-opus-5     header → refusal/cyber,  full task → refusal/cyber
  //     claude-opus-4-6   header → end_turn,       full task → end_turn
  //     claude-sonnet-5   header → end_turn,       full task → end_turn
  //     claude-sonnet-4-6 header → end_turn,       full task → end_turn
  // The trigger is the framing prose ("you are reviewing a computational physics
  // result… decide whether the claim should ship"), not the CSV — the data alone
  // and a generic Rydberg question both pass. This tier feeds reviewer /
  // experiment_reviewer / ledger_writer, whose entire job is that shape of task,
  // and Luxas has NO refusal handling: a refusal returns empty content, so the
  // PI layer would silently produce nothing and burn its turn budget.
  // Re-pin to opus-5 only together with the server-side `fallbacks` parameter
  // (platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).
  opus: ["anthropic", "claude-opus-4-6"],
  // OpenAI (standard API — requires OPENAI_API_KEY sk-...)
  o3: ["openai", "o3"],
  "o3-mini": ["openai", "o3-mini"],
  "o4-mini": ["openai", "o4-mini"],
  // OpenAI Codex (ChatGPT backend — works with Codex OAuth). pi-ai 0.84's
  // catalog dropped the 5.1/5.2 tiers; these are the shipped successors.
  "gpt-5.6-terra": ["openai-codex", "gpt-5.6-terra"],
  "gpt-5.6-luna": ["openai-codex", "gpt-5.6-luna"],
  "gpt-5.5": ["openai-codex", "gpt-5.5"],
  "gpt-5.4": ["openai-codex", "gpt-5.4"],
  "gpt-5.4-mini": ["openai-codex", "gpt-5.4-mini"],
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4-Pro",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 393216,
    compat: { ...DEEPSEEK_COMPAT },
    thinkingLevelMap: { ...DEEPSEEK_THINKING },
  },
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 393216,
    compat: { ...DEEPSEEK_COMPAT },
    thinkingLevelMap: { ...DEEPSEEK_THINKING },
  },
  // DeepSeek's multimodal model — the vision half of --profile dual since
  // 2026-09-02 (announcement: api-docs.deepseek.com/news/news260821).
  // Same endpoint, key and wire format as the text producers, so a dual run
  // now needs ONE provider instead of two; that is the point of the switch.
  // Kimi K2.5 (below) started returning 404 mid-run on 2026-08-31 and every
  // illustrator/illustrator_write/typesetter spawn died on turn 1 for the rest
  // of the Ba run while the reviewer kept spawning audits nobody could act on
  // (notes/figure-pipeline-review-2026-09-02.md §3.6).
  //
  // Live-probed 2026-09-02 against the real endpoint:
  //  - image + tools + thinking + tool_choice="auto" → tool_calls, 5 s. This is
  //    the production shape, reached because `reasoning: true` makes
  //    pickRequireToolChoice return "auto".
  //  - the SAME call with tool_choice="required" → 400 "Thinking mode does not
  //    support this tool_choice". Never set reasoning:false here, or the
  //    silent-exit guard will force "required" and every turn 400s.
  //  - reasoning eats the output budget before content appears (a tall
  //    schematic spent 9179 of 9500 completion tokens on reasoning), so
  //    maxTokens must stay large — same lesson K2.5 taught.
  //  - an image bills as ~384 input tokens (doc: "up to 384 tokens each").
  "deepseek-v4-flash-vision-exp": {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek-V4-Flash-Vision (exp)",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    input: ["text", "image"],
    // Documented PEAK rates (same tier as v4-flash) so the cost cap never
    // under-counts; image tokens bill as input.
    cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 393216,
    compat: { ...DEEPSEEK_COMPAT },
    thinkingLevelMap: { ...DEEPSEEK_THINKING },
  },
  // Kimi vision model — the vision half of --profile dual until 2026-09-02,
  // kept as an opt-in escape hatch (LUXAS_VISION_MODEL_PROFILE=k2p5) only.
  // WARNING: this id returned `404 Not found the model kimi-k2.5 or Permission
  // denied` on the production account from 2026-08-31 08:07 UTC. Re-verify
  // against /v1/models before selecting it.
  // Endpoint is the Moonshot CN OpenAI-compat API; key is KIMI_API_KEY.
  // Cheapest vision-capable Kimi (¥0.7/4.0/21 per M, 2026-06 pricing); the
  // previous moonshot-v1-32k-vision-preview (32k ctx / 4k out) could not hold
  // a coding agent — every spawn died on token-limit 400s, then 429s.
  // K2.5 is a thinking model: budget maxTokens generously, reasoning eats
  // output tokens before content appears (2k budget → empty content).
  k2p5: {
    id: "kimi-k2.5",
    name: "Kimi K2.5 (vision)",
    api: "openai-completions",
    provider: "kimi-coding",
    baseUrl: "https://api.moonshot.cn/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.56, output: 2.92, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    // Moonshot rejects role:"developer" with "400 tokenization failed";
    // pi-ai sends it for reasoning models unless told otherwise. The other
    // params pi-ai adds (store:false, reasoning_effort, max_completion_tokens)
    // were live-verified accepted 2026-06; re-verify on pi-ai bumps.
    compat: { supportsDeveloperRole: false },
  },
  // GLM-5.3-Flash (Zhipu / bigmodel) — the ONLY GLM model that accepts images.
  // glm-5.3, glm-5.2, glm-5.1 and glm-4.7 are text-only and reject image content
  // outright (`1210 messages.content.type 参数非法，取值范围 ['text']`); the older
  // vision ids glm-4.5v / glm-4.6v work but audit worse (see below). The catalog
  // endpoint does not list the *v ids at all — probe, don't trust /models.
  //
  // Live-probed 2026-09-03 against the real endpoint:
  //  - image + tools works with tool_choice "auto" AND "required" (unlike the
  //    deepseek vision entry, which 400s on "required"); reasoning_content is
  //    returned, so `reasoning: true` is honest and yields "auto" anyway.
  //  - rejects role:"developer" (`1214 角色信息不正确`) — same as glm-5.2.
  //  - max_tokens ceiling is exactly 131072 (the API names the range on error).
  //  - benchmarked best of four models on the figure-audit task: it alone caught
  //    the ionization line striking through the Rydberg label and the ambiguous
  //    wavelength-to-arrow assignment. Cheapest too, at ~$0.003/audit against
  //    sonnet's $0.011. Its cost is latency: ~116 s mean, 187 s worst, vs
  //    sonnet's 12 s. See notes/figure-pipeline-review-2026-09-02.md §4.7b.
  //  - prices are FULL list ($0.15 / $0.50 / $0.03 cache-read per M). A 50%
  //    launch promotion runs to 2026-09-09; quoting the promo rate would make
  //    the cost cap under-count the moment it expires.
  "glm-5.3-flash": {
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash (vision)",
    api: "openai-completions",
    provider: "glm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.15, output: 0.50, cacheRead: 0.03, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 131072,
    compat: { supportsDeveloperRole: false },
  },
  // GLM-5.3 (Zhipu / bigmodel) — the flagship that runs tool_review since
  // 2026-09-04, replacing glm-5.2. Text-only: it rejects image content
  // (`1210 … 取值范围 ['text']`), which is correct for this role — tool_review
  // reads a tool description and writes pytest, it never looks at a figure.
  //
  // This move was made on the user's instruction, not on measured evidence:
  // no blind-test-authoring benchmark was run comparing it to 5.2. What IS
  // verified (live, 2026-09-04): the id resolves, tool calling works with
  // tool_choice "auto" and "required", reasoning_content is returned, and the
  // max_tokens ceiling is 131072 (the API names the range on error).
  // It is also ~26% DEARER than 5.2 ($1.40/$4.40 vs $1.11/$3.89 per M), so the
  // cost cap will bite marginally sooner on experiment-heavy runs.
  //
  // Unlike glm-5.2 and glm-5.3-flash, glm-5.3 *accepts* role:"developer"
  // rather than rejecting it with `1214 角色信息不正确`. supportsDeveloperRole
  // is nevertheless kept false so every model on this provider behaves
  // identically and the known-good system-role path is used.
  "glm-5.3": {
    id: "glm-5.3",
    name: "GLM-5.3",
    api: "openai-completions",
    provider: "glm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    reasoning: true,
    input: ["text"],
    // docs.z.ai/guides/overview/pricing, 2026-09-04: $1.40 in / $0.26 cached /
    // $4.40 out per M. No promotional discount on this tier.
    cost: { input: 1.40, output: 4.40, cacheRead: 0.26, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 131072,
    compat: { supportsDeveloperRole: false },
  },
  // GLM-5.2 (Zhipu / bigmodel) — ran tool_review until 2026-09-04, kept as the
  // rollback target (LUXAS_TOOL_REVIEW_MODEL=glm-5.2). Still live on the
  // account. Formerly documented as running "the non-PI reviewer agents"
  // (experiment_reviewer, tool_review). OpenAI-compat endpoint; key is the
  // "glm" slot in ~/.sisyphus/auth.json (getApiKey("glm")). A reasoning model
  // — like kimi it rejects role:"developer", so supportsDeveloperRole:false.
  "glm-5.2": {
    id: "glm-5.2",
    name: "GLM-5.2",
    api: "openai-completions",
    provider: "glm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    reasoning: true,
    input: ["text"],
    // List price 8 / 28 / 2 RMB per-M (input/output/cache-read), converted to
    // the "$" unit the usage log displays at ~7.2 RMB/USD (same magnitude as the
    // deepseek-v4-pro entry). 1M usable context, 128K max output.
    cost: { input: 1.11, output: 3.89, cacheRead: 0.28, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 131072,
    compat: { supportsDeveloperRole: false },
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
// model regardless of the family-level text profile, because the deepseek
// TEXT models are text-only and silently produce unverified figures otherwise.
// Since 2026-09-02 the destination is deepseek's own multimodal model, so the
// split is now within one provider rather than across two.
const VISION_REQUIRED_AGENTS = new Set([
  "illustrator",
  "illustrator_write",
  "typesetter",
]);

// Verifier agents must NOT share the producer's prior — a verifier on the same
// family as the producer defeats independent review: in production, deepseek
// tool_impl AND deepseek blind tests carried the same wrong hyperfine
// constants, and deepseek reviewers passed them. So the checking layer is
// pinned off the producer profile. Two destinations:
//
//  PI ("reviewer", spawned by pi-agent.ts) keeps its declared Anthropic tier —
//  the flagship adversarial monitor stays on Claude unconditionally.
const PI_REVIEWER_AGENTS = new Set([
  "reviewer",
  // experiment_reviewer moved here from GLM (2026-07-05, interpretation-fidelity
  // study, github.com/Muuuun/interpretation-fidelity): its duties include
  // auditing negative-result claims, and GLM-5.2's blind-tested hard-error rate
  // on exactly that claim class is 95% (n=20) vs opus 40% — it cannot catch
  // what it commits itself. Its mechanical half (ledger-vs-results.json fraud
  // checks) worked fine on GLM; the epistemic half is the load-bearing one.
  "experiment_reviewer",
  // ledger_writer writes the L2 conclusions — the ONE turn where computed
  // facts become recorded knowledge, and the turn the producer model fails at
  // (deepseek: 100% hard-error on search-failure interpretation, n=20).
  "ledger_writer",
]);
//  tool_review stays on GLM — a third prior, independent of BOTH the
//  deepseek producer AND the Anthropic PI, routed there UNCONDITIONALLY
//  (every profile). It authors BLIND TESTS whose arbiter is pytest, not its
//  own judgment, so GLM's weak epistemic-interpretation dimension is not
//  exposed in this role; its family diversity is what makes the impl/review
//  split real (same-family impl+test passed the same wrong constants).
//  The tier moved 5.2 → 5.3 on 2026-09-04 by user instruction. No blind-test
//  benchmark was run to justify it, so LUXAS_TOOL_REVIEW_MODEL exists as the
//  one-env-var rollback (=glm-5.2) if test quality regresses. Watch for it in
//  the pytest pass/fail pattern, not in the model's prose.
const GLM_REVIEWER_AGENTS = new Set([
  "tool_review",
]);

function applyProfile(modelKey: string, agentName?: string): string {
  // figure_auditor (figures v2, 2026-08-28) keeps a vision model that can
  // actually see — the cheap vision profile "passed" five broken figures.
  // Override only via LUXAS_VISION_AUDIT_MODEL_PROFILE; never the text profile.
  // `--profile dual` deliberately leaves this unset so the auditor keeps its
  // Anthropic tier: since 2026-09-03 the drawing agents are glm-5.3-flash, and
  // an auditor on the drawing model is not an independent eye. GLM scored best
  // of four auditing in isolation, but it shares the producer's blind spots
  // (it omitted 4 K / 300 K panel labels when drawing, and did not flag their
  // absence when auditing). Point this var at a family that is not drawing.
  if (agentName === "figure_auditor") return process.env.LUXAS_VISION_AUDIT_MODEL_PROFILE || modelKey;
  if (agentName && VISION_REQUIRED_AGENTS.has(agentName)) {
    const visionProfile = process.env.LUXAS_VISION_MODEL_PROFILE;
    if (visionProfile) return visionProfile;
  }
  // Non-PI reviewers always run on GLM (independent prior); PI keeps its
  // declared Anthropic tier. Both checked before the producer-profile downgrade.
  if (agentName && GLM_REVIEWER_AGENTS.has(agentName)) return process.env.LUXAS_TOOL_REVIEW_MODEL || "glm-5.3";
  if (agentName && PI_REVIEWER_AGENTS.has(agentName)) return modelKey;
  const profile = process.env.LUXAS_MODEL_PROFILE;
  if (!profile) return modelKey;
  if (ANTHROPIC_TIERS.has(modelKey)) return profile;
  return modelKey;
}

// F5-lite — transient-error retry wrapper around streamSimple. The pi-coding-agent
// package has _isRetryableError catching `connection error / fetch failed / ECONNRESET
// / terminated / etc.` and applying exp backoff at agent-session.js:1859, but
// sub-agents spawned via pi-agent-core directly (every Sisyphus brain + sub-agent)
// bypass that layer. Result: a transient DeepSeek network blip during a long-running
// brain session terminates the process silently. This wrapper replicates pi-coding-
// agent's regex + backoff at THIS layer (Sisyphus's streamFn) so the retry applies
// uniformly to brain and every spawned agent.
//
// Scope: this catches only SYNCHRONOUS THROWS whose message matches TRANSIENT_RE.
// It does NOT catch a graceful stopReason="error" message, because pi-ai's
// streamSimple returns an UN-CONSUMED EventStream — the fetch runs in a detached
// IIFE and a mid-stream rejection ("terminated") becomes an error EVENT that only
// materializes when pi-agent-core drains the stream, downstream of this return.
// result.stopReason is always undefined here. That class is retried in the agent
// loop itself — patches/pi-agent-core-no-tool-retry-guard.sh (Patch C).
//
// Up to 3 attempts (1s, 2s, 4s backoff). Non-transient errors / non-error stops
// pass through unchanged.
export const TRANSIENT_RE = /connection.?error|connection.?refused|fetch failed|terminated|other side closed|stream aborted|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|overloaded/i;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function streamWithRetry(
  model: any,
  ctx: any,
  opts: any,
): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      // Graceful stopReason="error" is handled downstream (see header note).
      return await streamSimple(model, ctx, opts);
    } catch (e: any) {
      // Case (a): thrown error
      lastErr = e;
      const msg = e?.message ?? String(e);
      if (!TRANSIENT_RE.test(msg) || i >= RETRY_DELAYS_MS.length) throw e;
      try { process.stderr.write(`[stream-retry ${i + 1}/${RETRY_DELAYS_MS.length}] thrown: ${msg.slice(0, 120)}\n`); } catch { /* */ }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  // Should be unreachable — either we returned or threw above.
  if (lastErr) throw lastErr;
  throw new Error("streamWithRetry: unreachable");
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
/**
 * Every distinct model this run will actually reach, with the agents that reach
 * it — the input to the freshness/liveness check (src/model-check.ts).
 *
 * Resolution goes through applyProfile, so this reflects the LIVE routing under
 * whatever profile env is set, not the frontmatter tiers. That is the point: a
 * model nothing routes to cannot break a run, and the Ba run died on exactly
 * the model the frontmatter did not name (kimi, reached only via the vision
 * profile override).
 */
export function listRoutedModels(): { provider: string; id: string; usedBy: string[] }[] {
  const byId = new Map<string, { provider: string; id: string; usedBy: string[] }>();
  let defs: Map<string, AgentDefinition>;
  try { defs = loadAgentDefinitions(); } catch { return []; }
  for (const [name, def] of defs) {
    let m: any;
    try { m = resolveModel(def.model, name); } catch { continue; }
    const id = String(m?.id ?? m?.model?.id ?? "");
    const provider = String(m?.provider ?? "anthropic");
    if (!id) continue;
    const row = byId.get(id) ?? { provider, id, usedBy: [] };
    row.usedBy.push(name);
    byId.set(id, row);
  }
  return [...byId.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

export function pickRequireToolChoice(model: any): "any" | "required" | "auto" {
  // Claude Fable/Mythos 5.1 reject forced tool choice outright:
  //   400 `tool_choice: type "tool" and "any" are not supported for this model.`
  // Luxas sends a forced choice on EVERY turn (the silent-exit guard), so
  // without this branch every turn on those models is a hard 400. They are
  // reasoning models that reliably call tools under "auto"; the guard's job is
  // then carried by the prompt instruction plus the maxTurns cap.
  // Verified live 2026-09-04. The id test is the safety net for tuple-form
  // models, which carry no inline flag.
  if (model?.noForcedToolChoice === true) return "auto";
  if (/\b(fable|mythos)\b/.test(String(model?.id ?? "").replace(/-/g, " "))) return "auto";
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
      // F5-lite: replace bare streamSimple with retry-on-transient-error wrapper.
      return streamWithRetry(m, ctx, merged);
    },
  });
  (agent as any).__smeltParent = opts.parentAgentId;

  // 10. Install token tracking (feeds packer with precise token counts after first turn)
  tokenTap.install(agent);

  // 11. Per-sub-agent turn budget. Brain has its own 500-turn cap in src/agent.ts;
  // every sub-agent spawned here gets the cap declared in its frontmatter
  // (def.maxTurns). On overrun we abort the agent (not process.exit, since this
  // is one sub-agent inside a larger brain session) — `runWithLengthRecovery`
  // returns; the SubAgentExit contract carries stopReason="killed" upward.
  //
  // Why this exists: providers that force tool_choice="required" (Kimi,
  // deepseek-chat, openai chat — anything that isn't anthropic native or a
  // reasoning model — see pickRequireToolChoice) cannot emit a text-only
  // finish turn. If the prompt's natural exit is "say done, no tool call",
  // those agents loop indefinitely. Observed 2026-05-13: typesetter on
  // moonshot-v1-32k-vision-preview spun 50 min / 37 tool calls writing the
  // same already-written file over and over because tool_choice="required"
  // wouldn't let it emit the text-only "Wrote ... (status: all-clear)" exit
  // the prompt promised. The maxTurns cap is the catch-all safety net for
  // this and any similar tar-pit pattern, regardless of root cause.
  if (def.maxTurns !== undefined) {
    const cap = def.maxTurns;
    let turnCount = 0;
    agent.subscribe((event: any) => {
      if (event.type === "turn_end") {
        turnCount++;
        if (turnCount > cap) {
          console.error(
            `[spawn] ${def.name} turn budget exceeded: ${turnCount} > ${cap}. Aborting sub-agent.`,
          );
          agent.abort();
        }
      }
    });
  }

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
 * state.messages assignment is the new last message, and continue() runs the loop
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
 * loaded prior messages via agent.state.messages = ...) and we drive a fresh
 * turn keyed by `newUserMessage`. The new message is a real user task, NOT
 * isMeta — it carries actual semantic payload (pytest output, fix request).
 * Counting/marker bookkeeping is the caller's job (continue_init in the conv
 * jsonl; this function only drives the loop.
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
    agent.state.messages = [
      ...messages,
      { role: "user", content: LENGTH_RECOVERY_CONTINUE_PROMPT, isMeta: true, timestamp: Date.now() } as any,
    ];
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
  let errorMessage: string | undefined;
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
          // Capture provider's errorMessage so parent harvest can distinguish
          // terminal classes (402/429/auth) from transients (F5 retries those).
          if (stopReason === "error" && typeof (lastAssistant as any).errorMessage === "string") {
            errorMessage = (lastAssistant as any).errorMessage.slice(0, 500);
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
    errorMessage,
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
  // Hoisted so catch can remove the registry entry on failure paths.
  let registered = false;

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

    // Observability: surface the spawn IMMEDIATELY so studio's SSE tail of
    // log.jsonl and SpawnTree don't show "frozen" while a multi-hour subagent
    // runs. Two writes:
    //   1. log.jsonl tool_call entry (mirrors hooks.ts shape) — makes the
    //      spawn visible in the chat timeline. After-hook in hooks.ts will
    //      write the matching completion entry on return; studio dedupes
    //      visually by spawn target.
    //   2. active-agents.json registry — populates SpawnTree right pane.
    //      Background spawns already register in spawn-agent.ts; this covers
    //      foreground + parallel that bypass that branch.
    // Field naming: snake_case (agent_id / parent_agent_id) matches studio's
    // pickSpawnTarget (luxas-studio components/ConversationView.tsx:645) so
    // clicking the chip drills into the child's conversation.
    const agentDir = join(opts.projectDir, ".agent");
    try {
      appendFileSync(
        join(agentDir, "log.jsonl"),
        JSON.stringify({
          type: "tool_call",
          tool: "spawn_agent",
          phase: "started",
          args: { agent: opts.name, agent_id: agentId, parent_agent_id: opts.parentAgentId },
          success: true,
          timestamp: new Date().toISOString(),
        }) + "\n",
      );
    } catch { /* observability must not crash the spawn */ }
    try {
      addAgent(agentDir, {
        id: agentId,
        name: opts.name,
        task: opts.prompt.slice(0, 200),
        mode: opts.instanceIndex !== undefined ? "parallel" : "foreground",
        startedAt: Date.now(),
        conversationFile: convPath,
        status: "running",
      });
      registered = true;
    } catch { /* observability must not crash the spawn */ }

    // Resume MUST assign state.messages before subscribing — otherwise the first
    // turn_end re-appends the full prior history and doubles the jsonl.
    if (isResume) {
      const currentModel = (agent.state as any).model;
      const cleaned = cleanMessagesForModel(opts.resume!.messages, {
        provider: currentModel?.provider,
        id: currentModel?.id,
      });
      agent.state.messages = cleaned;
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
    if (registered) try { removeAgent(agentDir, agentId); } catch { /* registry is best-effort */ }
    // Liveness: a graceful stopReason="error" reaches HERE with success:true —
    // the agent object exists, it just never produced anything because the
    // provider answered 429/404. That is precisely how a dead verifier stayed
    // invisible for a whole run, so the ledger keys on stopReason, not on the
    // success flag. Consumers: agent-liveness.ts (finish gate, brain context).
    recordAgentOutcome(opts.projectDir, opts.name, exit.stopReason !== "error", exit.errorMessage);
    return { output: output.slice(0, 50_000), elapsed: exit.elapsedMs, success: true, exit, agentId };

  } catch (err: any) {
    const msg = err.message || String(err);
    // classifyThrownStopReason distinguishes user-initiated abort (SIGINT/
    // agent.abort() → "killed") from real failures ("error").
    const exit = collector.finalize(classifyThrownStopReason(err));
    if (registered && agentId) try { removeAgent(join(opts.projectDir, ".agent"), agentId); } catch { /* registry is best-effort */ }
    // "killed" is an operator abort, not a capability failure — don't count it.
    if (exit.stopReason !== "killed") recordAgentOutcome(opts.projectDir, opts.name, false, exit.errorMessage ?? msg);
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
