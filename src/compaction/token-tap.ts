/**
 * Token Tap — lightweight token usage tracker that any agent can use.
 *
 * Subscribes to pi-agent-core's message_end events to capture the
 * latest context token count. Designed to feed ContextPacker.runCycle()
 * with the usageTokens parameter.
 */

export interface TokenTap {
  /** Token count from the most recent LLM response (0 until first event). */
  lastContextTokens: number;
  /**
   * Subscribe to an agent's events to capture token usage.
   * Returns an unsubscribe function.
   */
  install(agent: { subscribe: (fn: (e: any) => void) => () => void }): () => void;
}

function extractTokenCount(usage: any): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  // Fallback: input + output only. Do NOT add cacheRead/cacheWrite — for
  // Anthropic, input_tokens already includes cache_read_input_tokens.
  // Summing all four would double-count and trigger premature compaction.
  const sum = (usage.input ?? 0) + (usage.output ?? 0);
  return sum > 0 ? sum : 0;
}

export function createTokenTap(): TokenTap {
  const tap: TokenTap = {
    lastContextTokens: 0,
    install(agent) {
      return agent.subscribe((event: any) => {
        if (event.type === "message_end" && event.message?.usage) {
          const tokens = extractTokenCount(event.message.usage);
          if (tokens > 0) tap.lastContextTokens = tokens;
        }
      });
    },
  };
  return tap;
}
