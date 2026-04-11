import type {
  PackingCharPlan,
  PackingLimits,
  PackingPressure,
  PackingWindowPlan,
} from "./types.js";

const DEFAULT_WINDOW_LIMIT = 200_000;
const DEFAULT_RESERVED_REPLY = 20_000;
const DEFAULT_MANUAL_GAP = 3_000;
const DEFAULT_WARNING_CHARS = 60_000;
const DEFAULT_CONDENSE_CHARS = 80_000;

/**
 * Micro-compaction (warning) triggers at a fixed absolute cap regardless of
 * context window size. This prevents cost blowup on large-window models
 * (Opus 4.6 / Sonnet 4.6 = 1M tokens) where the old gap-based thresholds
 * would only trigger at 960K+.
 *
 * Full condense triggers at 60% of effective window — aggressive enough to
 * keep costs manageable but leaves headroom for the LLM to work.
 */
const MICRO_COMPACTION_CAP = 160_000;
const CONDENSE_RATIO = 0.6;

export function buildWindowPlan(
  limits: PackingLimits = {},
): PackingWindowPlan {
  const windowLimit = limits.windowLimit ?? DEFAULT_WINDOW_LIMIT;
  const reservedReplyTokens =
    limits.reservedReplyTokens ?? DEFAULT_RESERVED_REPLY;
  const effectiveWindow = windowLimit - reservedReplyTokens;
  const manualGapTokens = limits.manualGapTokens ?? DEFAULT_MANUAL_GAP;

  // Condense at 60% of effective window
  const condenseThreshold = Math.floor(effectiveWindow * CONDENSE_RATIO);
  // Micro-compaction: fixed 160K cap, but never above 85% of condense threshold
  const warningThreshold = Math.min(MICRO_COMPACTION_CAP, Math.floor(condenseThreshold * 0.85));

  return {
    windowLimit,
    reservedReplyTokens,
    // Store gap values for backward compatibility (some code reads these)
    warningGapTokens: effectiveWindow - warningThreshold,
    condenseGapTokens: effectiveWindow - condenseThreshold,
    manualGapTokens,
    warningThreshold,
    condenseThreshold,
    blockingThreshold: effectiveWindow - manualGapTokens,
  };
}

export function buildCharPlan(limits: PackingLimits = {}): PackingCharPlan {
  return {
    warningThreshold:
      limits.warningThresholdChars ?? DEFAULT_WARNING_CHARS,
    condenseThreshold:
      limits.condenseThresholdChars ?? DEFAULT_CONDENSE_CHARS,
  };
}

export function measurePressure(
  observedTokenCount: number | undefined,
  observedCharCount: number,
  windowPlan: PackingWindowPlan,
  charPlan: PackingCharPlan,
): PackingPressure {
  if (typeof observedTokenCount === "number" && observedTokenCount > 0) {
    return {
      usingTokens: true,
      observedSize: observedTokenCount,
      warningThreshold: windowPlan.warningThreshold,
      condenseThreshold: windowPlan.condenseThreshold,
      blockingThreshold: windowPlan.blockingThreshold,
      shouldWarn: observedTokenCount >= windowPlan.warningThreshold,
      shouldCondense: observedTokenCount >= windowPlan.condenseThreshold,
      isBlocked: observedTokenCount >= windowPlan.blockingThreshold,
    };
  }

  return {
    usingTokens: false,
    observedSize: observedCharCount,
    warningThreshold: charPlan.warningThreshold,
    condenseThreshold: charPlan.condenseThreshold,
    shouldWarn: observedCharCount >= charPlan.warningThreshold,
    shouldCondense: observedCharCount >= charPlan.condenseThreshold,
    isBlocked: false,
  };
}
