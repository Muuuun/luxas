import type { ConversationAdapter } from "./types.js";

export function countMessageChars<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
): number {
  let total = 0;
  for (const message of messages) {
    const plain = adapter.getPlainText(message);
    if (plain.length > 0) {
      total += plain.length;
      continue;
    }
    const blocks = adapter.getBlocks(message);
    total += JSON.stringify(blocks).length;
  }
  return total;
}

export function findTailStart<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  keepTailMessages: number,
): number | null {
  let boundary = Math.max(1, messages.length - keepTailMessages);
  // Stop scanning 2 messages before the end — we need the split point (assistant)
  // plus at least one retained message after it.
  const limit = messages.length - 2;
  while (boundary < limit) {
    if (adapter.getRole(messages[boundary]!) === "assistant") {
      return boundary;
    }
    boundary++;
  }
  // No valid assistant boundary found — caller should skip this compaction cycle
  // to avoid breaking tool_use/tool_result pairs.
  return null;
}

export function groupByAssistantRounds<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
): TMessage[][] {
  const groups: TMessage[][] = [];
  let current: TMessage[] = [];

  for (const message of messages) {
    if (
      current.length > 0 &&
      adapter.getRole(message) === "assistant" &&
      adapter.getRole(current[current.length - 1]!) !== "assistant"
    ) {
      groups.push(current);
      current = [];
    }
    current.push(message);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

export function peelOldestRounds<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  dropFraction: number,
): TMessage[] | null {
  const rounds = groupByAssistantRounds(messages, adapter);
  if (rounds.length < 2) return null;

  const roundsToDrop = Math.max(1, Math.floor(rounds.length * dropFraction));
  const remainder = rounds.slice(roundsToDrop).flat();
  return remainder.length > 0 ? remainder : null;
}
