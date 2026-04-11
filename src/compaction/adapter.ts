import type { BlockLike, ConversationAdapter } from "./types.js";

export interface BlockConversationMessage {
  role: string;
  content?: string | BlockLike[];
  timestamp?: number | string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  [key: string]: unknown;
}

function cloneMessage<TMessage>(message: TMessage): TMessage {
  return structuredClone(message);
}

/** Check whether a message is an OpenAI-style user message wrapping tool_result blocks. */
function hasNestedToolResults(message: BlockConversationMessage): boolean {
  if (message.role !== "user" || !Array.isArray(message.content)) return false;
  return message.content.some((b: any) => b.type === "tool_result");
}

export function createBlockConversationAdapter<
  TMessage extends BlockConversationMessage,
>(): ConversationAdapter<TMessage> {
  return {
    getRole(message) {
      return message.role;
    },
    getMessageId(message) {
      return typeof message.id === "string" ? message.id : undefined;
    },
    getBlocks(message) {
      if (typeof message.content === "string") {
        return message.content
          ? [{ type: "text", text: message.content }]
          : [];
      }
      return Array.isArray(message.content) ? message.content : [];
    },
    getPlainText(message) {
      if (typeof message.content === "string") return message.content;
      const blocks = Array.isArray(message.content) ? message.content : [];

      // OpenAI nested tool_result: extract text from tool_result blocks
      if (hasNestedToolResults(message)) {
        return blocks
          .filter((b: any) => b.type === "tool_result")
          .map((b: any) => {
            if (typeof b.content === "string") return b.content;
            if (Array.isArray(b.content)) {
              return b.content
                .filter((c: any) => c.type === "text" && typeof c.text === "string")
                .map((c: any) => c.text)
                .join("\n");
            }
            return "";
          })
          .join("\n");
      }

      return blocks
        .filter(block => block.type === "text" && typeof block.text === "string")
        .map(block => block.text)
        .join("\n");
    },
    isToolOutcome(message) {
      // Native pi-agent-core format
      if (message.role === "toolResult") return true;
      // OpenAI nested format: role=user with tool_result content blocks
      return hasNestedToolResults(message);
    },
    getToolOutcomeCallId(message) {
      if (message.role === "toolResult") {
        return typeof message.toolCallId === "string" ? message.toolCallId : undefined;
      }
      // OpenAI nested: first tool_result block's tool_use_id
      if (hasNestedToolResults(message)) {
        const block = (message.content as any[]).find((b: any) => b.type === "tool_result");
        return block?.tool_use_id as string | undefined;
      }
      return undefined;
    },
    getToolOutcomeName(message) {
      if (message.role === "toolResult") {
        return typeof message.toolName === "string" ? message.toolName : undefined;
      }
      return undefined;
    },
    isToolCall(message) {
      if (message.role !== "assistant") return false;
      return this.getBlocks(message).some(
        b => b.type === "tool_use" || b.type === "toolCall",
      );
    },
    getToolCallId(message) {
      if (message.role !== "assistant") return undefined;
      const block = this.getBlocks(message).find(
        b => b.type === "tool_use" || b.type === "toolCall",
      );
      if (!block) return undefined;
      return typeof block.id === "string"
        ? block.id
        : typeof block.toolCallId === "string"
          ? block.toolCallId
          : undefined;
    },
    replaceToolOutcomeText(message, text) {
      const next = cloneMessage(message);

      if (next.role === "toolResult") {
        next.content = [{ type: "text", text }] as any;
        return next;
      }

      // OpenAI nested: replace content inside each tool_result block
      if (Array.isArray(next.content)) {
        next.content = (next.content as any[]).map((b: any) => {
          if (b.type !== "tool_result") return b;
          return { ...b, content: [{ type: "text", text }] };
        }) as any;
      }
      return next;
    },
    replacePlainText(message, text) {
      const next = cloneMessage(message);
      next.content = [{ type: "text", text }] as any;
      return next;
    },
    createMissingToolOutcomeStub(payload) {
      return {
        role: "toolResult",
        toolCallId: payload.toolCallId,
        content: [
          {
            type: "text",
            text: "[result omitted from earlier condensed context — consult the carry-forward note or re-run the tool if needed]",
          },
        ],
        timestamp: Date.now(),
      } as TMessage;
    },
    createCarryforwardMessage(payload) {
      const meta = [
        `trigger=${payload.trigger}`,
        `removed=${payload.removedCount}`,
        `size_before=${payload.sizeBefore} ${payload.usingTokens ? "tokens" : "chars"}`,
      ].join(", ");

      return {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `<carryforward_note>\n${payload.note}\n</carryforward_note>\n\n` +
              `[Context condensed (${meta}). ${payload.removedCount} earlier messages were folded into the note above.]`,
          },
        ],
        timestamp: Date.now(),
      } as TMessage;
    },
    createPreambleMessages(payload) {
      return [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text:
                "I have reviewed the carried-forward state and will continue from the latest preserved context.",
            },
          ],
          timestamp: Date.now(),
        } as TMessage,
      ];
    },
  };
}
