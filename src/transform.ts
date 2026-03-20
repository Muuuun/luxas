/**
 * Cross-model message compatibility for checkpoint restore.
 *
 * #6: transformMessages (from pi-ai pattern)
 *
 * When restoring messages created by Model A but running Model B:
 * - Redacted thinking blocks → dropped (encrypted, model-specific)
 * - Plain thinking blocks → downgraded to text
 * - Orphaned tool calls → get synthetic error results
 * - Error/aborted assistant messages → skipped
 */

export function cleanMessagesForModel(
  messages: any[],
  currentModel: { provider: string; id: string },
): any[] {
  const result: any[] = [];
  const pendingToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "assistant") {
      // Skip errored/aborted messages
      if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;

      const isSameModel =
        msg.provider === currentModel.provider && msg.model === currentModel.id;

      if (!isSameModel && Array.isArray(msg.content)) {
        // Clean thinking blocks and thought signatures for cross-model compatibility
        msg.content = msg.content.flatMap((block: any) => {
          if (block.type === "thinking") {
            if (block.redacted) return []; // Drop cross-model redacted thinking
            if (!block.thinking?.trim()) return [];
            return [{ type: "text", text: `[Previous reasoning]: ${block.thinking}` }];
          }
          if ((block.type === "toolCall" || block.type === "tool_use") && block.thoughtSignature) {
            const { thoughtSignature, ...rest } = block;
            return [rest];
          }
          return [block];
        });
      }

      // Track tool calls for orphan detection
      for (const block of msg.content ?? []) {
        if (block.type === "toolCall" || block.type === "tool_use") {
          pendingToolCallIds.add(block.id);
        }
      }

      if (msg.content?.length > 0) result.push(msg);
    } else if (msg.role === "toolResult") {
      pendingToolCallIds.delete(msg.toolCallId);
      result.push(msg);
    } else {
      // Insert synthetic tool results for orphaned tool calls before user messages
      if (msg.role === "user" && pendingToolCallIds.size > 0) {
        for (const id of pendingToolCallIds) {
          result.push({
            role: "toolResult",
            toolCallId: id,
            content: [{ type: "text", text: "No result (session interrupted)" }],
            isError: true,
            timestamp: Date.now(),
          });
        }
        pendingToolCallIds.clear();
      }
      result.push(msg);
    }
  }

  // Handle any remaining orphaned tool calls at the end
  if (pendingToolCallIds.size > 0) {
    for (const id of pendingToolCallIds) {
      result.push({
        role: "toolResult",
        toolCallId: id,
        content: [{ type: "text", text: "No result (session interrupted)" }],
        isError: true,
        timestamp: Date.now(),
      });
    }
  }

  return result;
}
