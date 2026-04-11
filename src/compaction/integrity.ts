import type {
  ConversationAdapter,
  IntegrityOutcome,
} from "./types.js";

/**
 * Collect ALL tool call IDs from an assistant message's blocks.
 * A single assistant message may contain multiple tool_use/toolCall blocks.
 */
function collectToolCallIds<TMessage>(
  message: TMessage,
  adapter: ConversationAdapter<TMessage>,
): string[] {
  if (adapter.getRole(message) !== "assistant") return [];
  const ids: string[] = [];
  for (const block of adapter.getBlocks(message)) {
    if (block.type !== "tool_use" && block.type !== "toolCall") continue;
    const id =
      typeof block.id === "string"
        ? block.id
        : typeof block.toolCallId === "string"
          ? block.toolCallId
          : undefined;
    if (id) ids.push(id);
  }
  return ids;
}

export function repairMessageIntegrity<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
): IntegrityOutcome<TMessage> {
  // First pass: track which tool call IDs have matching results
  const hasOutcome = new Set<string>();
  for (const message of messages) {
    if (!adapter.isToolOutcome(message)) continue;
    const callId = adapter.getToolOutcomeCallId(message);
    if (callId) hasOutcome.add(callId);
  }

  // Second pass: build repaired array, inserting stubs immediately after
  // the assistant message that issued orphaned tool calls
  const repaired: TMessage[] = [];
  let removedMessages = 0;
  let insertedMessages = 0;
  const allExpected = new Set<string>();

  for (const message of messages) {
    const callIds = collectToolCallIds(message, adapter);
    if (callIds.length > 0) {
      for (const id of callIds) allExpected.add(id);
      repaired.push(message);

      // Insert stubs right after this assistant message for any calls missing results
      for (const id of callIds) {
        if (!hasOutcome.has(id)) {
          repaired.push(
            adapter.createMissingToolOutcomeStub({
              toolCallId: id,
              sourceMessage: message,
            }),
          );
          insertedMessages++;
        }
      }
      continue;
    }

    if (adapter.isToolOutcome(message)) {
      const callId = adapter.getToolOutcomeCallId(message);
      if (!callId || !allExpected.has(callId)) {
        removedMessages++;
        continue;
      }
      repaired.push(message);
      continue;
    }

    repaired.push(message);
  }

  return {
    messages:
      removedMessages > 0 || insertedMessages > 0 ? repaired : messages,
    removedMessages,
    insertedMessages,
    modified: removedMessages > 0 || insertedMessages > 0,
  };
}
