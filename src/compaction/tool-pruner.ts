import type {
  ConversationAdapter,
  ToolPrunePolicy,
  TrimOutcome,
} from "./types.js";

const DEFAULT_KEEP_RECENT = 10;
const DEFAULT_PLACEHOLDER =
  "[earlier tool output cleared to reduce context load — re-run the tool if the raw output is needed]";
const DEFAULT_MINIMUM_CHARS = 200;

/**
 * Default whitelist of tools whose old outputs may be replaced with a
 * placeholder when over the keepRecent window. All of these produce
 * idempotent / stateless / stale-after output (the agent can re-run and
 * get the same or newer result). Lowercase to match tool.name as exported
 * by pi-coding-agent and Sisyphus's own tool definitions.
 */
export const DEFAULT_PRUNABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "bash",
  "grep",
  "glob",
]);

/**
 * Hard blacklist: tools whose output carries agent-visible state or artifact
 * references that would be destroyed by placeholder replacement. These never
 * prune regardless of the whitelist. Write/edit results include post-edit
 * excerpts the model may reference; spawn_agent results inject sub-agent
 * outcomes the parent reasons against; request_pi_review / finish carry
 * verdict state.
 */
export const NEVER_PRUNE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "spawn_agent",
  "request_pi_review",
  "finish",
  "write",
  "edit",
]);

// Log unknown tool names once per process so repeated compactions don't spam
// stderr. The warning surfaces missing tools in either the whitelist or the
// blacklist — conservative default keeps them unpruned, but a human should
// decide whether to add them.
const loggedUnknownTools = new Set<string>();

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

  // Resolve whitelist. Explicit empty iterable is respected (caller asked
  // for nothing-is-prunable); unset falls back to DEFAULT_PRUNABLE_TOOL_NAMES.
  const eligibleToolNames = policy.eligibleToolNames !== undefined
    ? new Set(policy.eligibleToolNames)
    : DEFAULT_PRUNABLE_TOOL_NAMES;
  const neverPruneToolNames = policy.neverPruneToolNames !== undefined
    ? new Set(policy.neverPruneToolNames)
    : NEVER_PRUNE_TOOL_NAMES;

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

    // Blacklist always wins. Whitelist is required for pruning. Unknown
    // tools (not in either set) log once and fall through as not-prunable.
    const blacklisted = neverPruneToolNames.has(toolName);
    const whitelisted = eligibleToolNames.has(toolName);
    if (!blacklisted && !whitelisted && toolName && !loggedUnknownTools.has(toolName)) {
      loggedUnknownTools.add(toolName);
      console.error(
        `[tool-pruner] tool "${toolName}" is neither in eligibleToolNames nor neverPruneToolNames — defaulting to not-prunable. ` +
        `Add it to one of those sets to silence this warning.`,
      );
    }
    const isEligible = whitelisted && !blacklisted;

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
