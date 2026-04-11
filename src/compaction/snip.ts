import type {
  ConversationAdapter,
  SnipPolicy,
  TrimOutcome,
} from "./types.js";

const DEFAULT_KEEP_RECENT_MESSAGES = 12;
const DEFAULT_PLACEHOLDER =
  "[earlier long-form text trimmed to preserve context budget — consult the carry-forward note if the full wording is needed]";
const DEFAULT_MINIMUM_CHARS = 800;
const DEFAULT_MAX_MESSAGES = 6;

export function snipHistoricText<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  policy: SnipPolicy = {},
): TrimOutcome<TMessage> {
  const keepRecentMessages =
    policy.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES;
  const placeholderText = policy.placeholderText ?? DEFAULT_PLACEHOLDER;
  const minimumCharsToSnip =
    policy.minimumCharsToSnip ?? DEFAULT_MINIMUM_CHARS;
  const maxMessagesToSnip = policy.maxMessagesToSnip ?? DEFAULT_MAX_MESSAGES;

  let snippedCount = 0;
  let freedUnits = 0;
  let modified = false;
  const nextMessages = [...messages];
  const protectedStart = Math.max(0, messages.length - keepRecentMessages);

  for (let index = 0; index < protectedStart; index++) {
    if (snippedCount >= maxMessagesToSnip) break;
    const message = messages[index]!;
    const role = adapter.getRole(message);
    if (role !== "assistant" && role !== "user") continue;
    if (adapter.isToolOutcome(message) || adapter.isToolCall(message)) continue;

    const plain = adapter.getPlainText(message);
    if (
      plain.length < minimumCharsToSnip ||
      plain === placeholderText
    ) {
      continue;
    }

    nextMessages[index] = adapter.replacePlainText(message, placeholderText);
    freedUnits += Math.max(0, plain.length - placeholderText.length);
    snippedCount++;
    modified = true;
  }

  return {
    messages: modified ? nextMessages : messages,
    freedUnits,
    modified,
  };
}
