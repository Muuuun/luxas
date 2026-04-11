import type {
  PackingCharPlan,
  PackingLimits,
  PackingPressure,
  PackingWindowPlan,
} from "./types.js";

const DEFAULT_WINDOW_LIMIT = 200_000;
const DEFAULT_RESERVED_REPLY = 20_000;
const DEFAULT_WARNING_GAP = 20_000;
const DEFAULT_CONDENSE_GAP = 13_000;
const DEFAULT_MANUAL_GAP = 3_000;
const DEFAULT_WARNING_CHARS = 60_000;
const DEFAULT_CONDENSE_CHARS = 80_000;

export function buildWindowPlan(
  limits: PackingLimits = {},
): PackingWindowPlan {
  const windowLimit = limits.windowLimit ?? DEFAULT_WINDOW_LIMIT;
  const reservedReplyTokens =
    limits.reservedReplyTokens ?? DEFAULT_RESERVED_REPLY;
  const effectiveWindow = windowLimit - reservedReplyTokens;
  const warningGapTokens = limits.warningGapTokens ?? DEFAULT_WARNING_GAP;
  const condenseGapTokens = limits.condenseGapTokens ?? DEFAULT_CONDENSE_GAP;
  const manualGapTokens = limits.manualGapTokens ?? DEFAULT_MANUAL_GAP;
  return {
    windowLimit,
    reservedReplyTokens,
    warningGapTokens,
    condenseGapTokens,
    manualGapTokens,
    warningThreshold: effectiveWindow - warningGapTokens,
    condenseThreshold: effectiveWindow - condenseGapTokens,
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
