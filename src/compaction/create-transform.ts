/**
 * Compaction Transform Factory — creates a ready-to-use transformContext
 * function from ContextPacker + TokenTap. Works for any agent.
 *
 * Usage:
 *   const { transformContext, tokenTap } = createCompactionTransform({ model, getApiKey });
 *   const agent = new Agent({ ..., transformContext });
 *   tokenTap.install(agent);  // must call after construction
 */

import type { Model } from "@mariozechner/pi-ai";
import { createBlockConversationAdapter } from "./adapter.js";
import { ContextPacker } from "./engine.js";
import { createTokenTap } from "./token-tap.js";
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

    try {
      const result = await packer.runCycle({
        messages,
        usageTokens: tokenTap.lastContextTokens,
      });
      return result.messages;
    } catch {
      // Compaction failure (e.g. refill-loop, repeated summarizer errors)
      // must never crash the agent. Return messages unmodified and let the
      // agent continue — it may still function within the remaining context.
      return messages;
    }
  };

  return { transformContext, tokenTap, packer };
}
