import type { Model } from "@earendil-works/pi-ai/compat";

export interface PackingWindowPlan {
  windowLimit: number;
  reservedReplyTokens: number;
  warningGapTokens: number;
  condenseGapTokens: number;
  manualGapTokens: number;
  warningThreshold: number;
  condenseThreshold: number;
  blockingThreshold: number;
}

export interface PackingCharPlan {
  warningThreshold: number;
  condenseThreshold: number;
}

export interface PackingLimits {
  windowLimit?: number;
  reservedReplyTokens?: number;
  warningGapTokens?: number;
  condenseGapTokens?: number;
  manualGapTokens?: number;
  warningThresholdChars?: number;
  condenseThresholdChars?: number;
}

export interface PackingMutableState {
  stepIndex: number;
  lastCondenseStep: number;
  refillStreak: number;
  failureStreak: number;
  warningRaised: boolean;
  carryforwardNote?: string;
}

export interface PackingPressure {
  usingTokens: boolean;
  observedSize: number;
  warningThreshold: number;
  condenseThreshold: number;
  blockingThreshold?: number;
  shouldWarn: boolean;
  shouldCondense: boolean;
  isBlocked: boolean;
}

export interface PackingCallbacks<TMessage> {
  onWarning?: (payload: {
    observedSize: number;
    threshold: number;
    usingTokens: boolean;
  }) => Promise<void> | void;
  onTrim?: (payload: {
    source: "tool-prune" | "snip";
    freedUnits: number;
    keptRecentToolOutputs?: number;
  }) => Promise<void> | void;
  onBeforeCondense?: (payload: {
    messages: TMessage[];
    observedSize: number;
  }) => Promise<void> | void;
  onAfterCondense?: (payload: {
    note: string;
    removedCount: number;
  }) => Promise<void> | void;
  onCleanup?: (payload: { mode: "warning" | "condense" }) => Promise<void> | void;
}

export interface ToolPrunePolicy {
  keepRecentToolOutputs?: number;
  placeholderText?: string;
  /**
   * Whitelist of tools whose old outputs may be replaced with a placeholder.
   * When omitted, DEFAULT_PRUNABLE_TOOL_NAMES applies (read/bash/grep/glob).
   * Pre-Phase 3c, an omitted/empty list was interpreted as "prune anything"
   * — a latent bug that would have clobbered stateful tool results like
   * spawn_agent / write / edit once Phase 3b started relying on history.
   */
  eligibleToolNames?: Iterable<string>;
  /**
   * Hard blacklist. Tools listed here are NEVER pruned, even if they appear
   * in `eligibleToolNames`. Defaults to NEVER_PRUNE_TOOL_NAMES (stateful
   * tools whose text payload carries agent-visible artifacts: spawn_agent,
   * request_pi_review, finish, write, edit).
   */
  neverPruneToolNames?: Iterable<string>;
  minimumCharsToReplace?: number;
}

export interface SnipPolicy {
  keepRecentMessages?: number;
  placeholderText?: string;
  minimumCharsToSnip?: number;
  maxMessagesToSnip?: number;
}

export interface CarryforwardLedger {
  readSnapshot?: () => Promise<CarryforwardSnapshot | null> | CarryforwardSnapshot | null;
  markApplied?: (snapshot: CarryforwardSnapshot) => Promise<void> | void;
}

export interface CarryforwardSnapshot {
  note: string;
  anchorMessageId?: string;
}

export interface SummarizerSettings {
  model: Model<any>;
  apiKey: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  dropFractionOnRetry?: number;
  maxMessageTextChars?: number;
  /** Override the system prompt sent to the summarizer LLM. */
  systemPrompt?: string;
  /** Override the template used when creating a fresh carry-forward note (no previous note). */
  freshNoteTemplate?: string;
  /** Override the template used when updating an existing carry-forward note. */
  updateNoteTemplate?: string;
}

export interface BlockLike {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  toolCallId?: string;
  input?: unknown;
}

export interface ConversationAdapter<TMessage> {
  getRole(message: TMessage): string;
  getMessageId?(message: TMessage): string | undefined;
  getBlocks(message: TMessage): BlockLike[];
  getPlainText(message: TMessage): string;
  isToolOutcome(message: TMessage): boolean;
  getToolOutcomeCallId(message: TMessage): string | undefined;
  getToolOutcomeName(message: TMessage): string | undefined;
  isToolCall(message: TMessage): boolean;
  getToolCallId(message: TMessage): string | undefined;
  replaceToolOutcomeText(message: TMessage, text: string): TMessage;
  replacePlainText(message: TMessage, text: string): TMessage;
  createMissingToolOutcomeStub(payload: {
    toolCallId: string;
    sourceMessage: TMessage;
  }): TMessage;
  createCarryforwardMessage(payload: {
    note: string;
    removedCount: number;
    trigger: "automatic" | "manual";
    sizeBefore: number;
    usingTokens: boolean;
  }): TMessage;
  createPreambleMessages?(payload: {
    note: string;
    removedCount: number;
  }): TMessage[];
}

export interface ContextPackerOptions<TMessage> {
  adapter: ConversationAdapter<TMessage>;
  thresholds?: PackingLimits;
  charFallback?: PackingCharPlan;
  toolPrune?: ToolPrunePolicy;
  snip?: SnipPolicy;
  summarizer?: SummarizerSettings;
  callbacks?: PackingCallbacks<TMessage>;
  ledger?: CarryforwardLedger;
  keepTailMessages?: number;
  refillWindowSteps?: number;
  refillLimit?: number;
  condenseFailureLimit?: number;
  /**
   * Post-compact attachment providers (Phase 3b). Each provider is invoked
   * once per successful compact; their output is inserted between the
   * compact's preamble and the retained tail:
   *
   *   rebuilt = [carryforward, ...preamble, ...attachments, ...retained]
   *
   * Providers are expected to produce attachment-style user messages
   * (see src/compaction/attachments.ts for concrete shapes). A throwing
   * provider is isolated — its output is skipped but the compact still
   * completes.
   */
  attachmentProviders?: import("./attachments.js").AttachmentProvider<TMessage>[];
}

export interface RunPackingInput<TMessage> {
  messages: TMessage[];
  trigger?: "automatic" | "manual";
  usageTokens?: number;
}

export interface TrimOutcome<TMessage> {
  messages: TMessage[];
  freedUnits: number;
  modified: boolean;
}

export interface IntegrityOutcome<TMessage> {
  messages: TMessage[];
  removedMessages: number;
  insertedMessages: number;
  modified: boolean;
}

export interface CondenseOutcome<TMessage> {
  mode: "none" | "trimmed" | "condensed";
  messages: TMessage[];
  pressure: PackingPressure;
  note?: string;
  removedCount?: number;
}
