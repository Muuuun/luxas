import type {
  ConversationAdapter,
  ToolPrunePolicy,
  TrimOutcome,
} from "./types.js";

const DEFAULT_KEEP_RECENT = 10;
const DEFAULT_PLACEHOLDER =
  "[earlier tool output cleared to reduce context load — re-run the tool if the raw output is needed]";
const DEFAULT_MINIMUM_CHARS = 200;

export function pruneHistoricToolOutputs<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  policy: ToolPrunePolicy = {},
): TrimOutcome<TMessage> {
  const keepRecentToolOutputs =
    policy.keepRecentToolOutputs ?? DEFAULT_KEEP_RECENT;
  const placeholderText = policy.placeholderText ?? DEFAULT_PLACEHOLDER;
  const minimumCharsToReplace =
    policy.minimumCharsToReplace ?? DEFAULT_MINIMUM_CHARS;
  const eligibleToolNames = new Set(policy.eligibleToolNames ?? []);

  const toolNameByCallId = new Map<string, string>();
  for (const message of messages) {
    if (adapter.getRole(message) !== "assistant") continue;
    for (const block of adapter.getBlocks(message)) {
      if (block.type !== "tool_use" && block.type !== "toolCall") continue;
      const callId =
        typeof block.id === "string"
          ? block.id
          : typeof block.toolCallId === "string"
            ? block.toolCallId
            : undefined;
      if (callId && typeof block.name === "string") {
        toolNameByCallId.set(callId, block.name);
      }
    }
  }

  let seenToolOutputs = 0;
  let freedUnits = 0;
  let changed = false;
  const nextMessages = new Array<TMessage>(messages.length);

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (!adapter.isToolOutcome(message)) {
      nextMessages[index] = message;
      continue;
    }

    seenToolOutputs++;
    if (seenToolOutputs <= keepRecentToolOutputs) {
      nextMessages[index] = message;
      continue;
    }

    const toolName =
      adapter.getToolOutcomeName(message) ??
      toolNameByCallId.get(adapter.getToolOutcomeCallId(message) ?? "") ??
      "";
    const existingText = adapter.getPlainText(message);
    const isEligible =
      eligibleToolNames.size === 0 || eligibleToolNames.has(toolName);

    if (
      !isEligible ||
      existingText.length < minimumCharsToReplace ||
      existingText === placeholderText
    ) {
      nextMessages[index] = message;
      continue;
    }

    freedUnits += Math.max(0, existingText.length - placeholderText.length);
    nextMessages[index] = adapter.replaceToolOutcomeText(
      message,
      placeholderText,
    );
    changed = true;
  }

  return {
    messages: changed ? nextMessages : messages,
    freedUnits,
    modified: changed,
  };
}
