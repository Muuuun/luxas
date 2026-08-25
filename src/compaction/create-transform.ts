/**
 * Compaction Transform Factory — creates a ready-to-use transformContext
 * function from ContextPacker + TokenTap. Works for any agent.
 *
 * Usage:
 *   const { transformContext, tokenTap } = createCompactionTransform({ model, getApiKey });
 *   const agent = new Agent({ ..., transformContext });
 *   tokenTap.install(agent);  // must call after construction
 */

import type { Model } from "@earendil-works/pi-ai/compat";
import { createBlockConversationAdapter } from "./adapter.js";
import { ContextPacker } from "./engine.js";
import { createTokenTap } from "./token-tap.js";
import { overflowBackstop } from "./overflow-backstop.js";
import type { TokenTap } from "./token-tap.js";
import type {
  CarryforwardLedger,
  ContextPackerOptions,
  PackingCallbacks,
  PackingLimits,
  SnipPolicy,
  SummarizerSettings,
  ToolPrunePolicy,
} from "./types.js";
import type { AttachmentProvider } from "./attachments.js";

/** Extract contextWindow from a Model, avoiding raw `as any` casts at call sites. */
export function getContextWindow(model: Model<any>): number | undefined {
  return (model as any).contextWindow as number | undefined;
}

export interface CompactionTransformOptions {
  /** Model used for LLM-based summarization. If omitted, compaction uses heuristic fallback only. */
  model?: Model<any>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  thresholds?: PackingLimits;
  toolPrune?: ToolPrunePolicy;
  snip?: SnipPolicy;
  /** Partial summarizer settings — model and apiKey are filled automatically. */
  summarizer?: Partial<Omit<SummarizerSettings, "model" | "apiKey">>;
  callbacks?: PackingCallbacks<any>;
  ledger?: CarryforwardLedger;
  /**
   * Phase 3b carry-forward attachment providers. Each is invoked once per
   * successful compact; their output is spliced into the rebuilt message
   * array between the compact preamble and the retained tail. See
   * src/compaction/attachments.ts for the standard providers
   * (createRecentFilesProvider, createAuthoritativeArtifactsProvider).
   */
  attachmentProviders?: AttachmentProvider<any>[];
}

export interface CompactionTransformResult {
  transformContext: (messages: any[], signal?: AbortSignal) => Promise<any[]>;
  tokenTap: TokenTap;
  packer: ContextPacker<any>;
}

export function createCompactionTransform(
  opts: CompactionTransformOptions,
): CompactionTransformResult {
  const adapter = createBlockConversationAdapter();
  const tokenTap = createTokenTap();

  // Mutable options object — we hold the reference so we can set summarizer
  // lazily after apiKey is resolved (apiKey resolution is async, but packer
  // construction is sync).
  const packerOpts: ContextPackerOptions<any> = {
    adapter,
    thresholds: opts.thresholds,
    toolPrune: opts.toolPrune,
    snip: opts.snip,
    callbacks: opts.callbacks,
    ledger: opts.ledger,
    attachmentProviders: opts.attachmentProviders,
  };

  const packer = new ContextPacker(packerOpts);

  // Summarizer lazy init: resolve apiKey once on first turn, then never again.
  // If no model or no apiKey, packer falls back to heuristicNote automatically.
  const provider: string = opts.model ? ((opts.model as any).provider ?? "anthropic") : "anthropic";
  let summarizerResolved = !opts.model || !opts.getApiKey;

  async function ensureSummarizer(): Promise<void> {
    if (summarizerResolved) return;
    summarizerResolved = true;
    const raw = await opts.getApiKey!(provider);
    if (!raw) return;
    packerOpts.summarizer = {
      model: opts.model!,
      apiKey: raw,
      ...opts.summarizer,
    };
  }

  const transformContext = async (messages: any[]): Promise<any[]> => {
    await ensureSummarizer();

    // Overflow backstop on BOTH sides of packing (see overflow-backstop.ts):
    // pre-pack bounds the summarizer's own LLM call — the 297nm run died 3×
    // because condensing an over-window history sent that raw history to the
    // summarizer; post-pack bounds the final request (the condense tail has
    // no per-message size cap).
    const bounded = overflowBackstop(messages, opts.model);

    try {
      const result = await packer.runCycle({
        messages: bounded,
        usageTokens: tokenTap.lastContextTokens,
      });
      return overflowBackstop(result.messages, opts.model);
    } catch {
      // Compaction failure (e.g. refill-loop, repeated summarizer errors)
      // must never crash the agent. Return the BOUNDED messages (never the
      // raw over-window history) and let the agent continue.
      return bounded;
    }
  };

  return { transformContext, tokenTap, packer };
}
