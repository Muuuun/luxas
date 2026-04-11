import { completeSimple } from "@mariozechner/pi-ai";
import { extractTextContent } from "../utils.js";
import { peelOldestRounds } from "./rounds.js";
import type {
  ConversationAdapter,
  SummarizerSettings,
} from "./types.js";

const NOTE_WRITER_SYSTEM = `You compress conversation state for a tool-using autonomous assistant.
Do not continue the task.
Do not answer any questions from the transcript.
Do not call tools.
Return plain text only.`;

const FRESH_NOTE_TEMPLATE = `Write a carry-forward note that allows another assistant instance to continue the same task safely.

Use this exact structure:

## Objective
[The active task and user intent]

## Important Facts
- [Concrete facts, constraints, identifiers, paths, values]

## Work Completed
- [Completed actions with outcomes]

## Open Problems
- [Unresolved issues and why they matter]

## Active Files And Artifacts
- [Files, commands, documents, outputs worth preserving]

## Immediate Next Moves
1. [Most likely next action]
2. [Next action after that]

## Critical Continuity
- [Anything that would cause drift if forgotten]

Be compact, but preserve exact identifiers, file paths, error names, and numeric values.`;

const UPDATE_NOTE_TEMPLATE = `Update the existing carry-forward note using the new transcript above.

Rules:
- Preserve still-valid information from the previous note
- Add new completed work, new facts, and new blockers
- Refresh "Immediate Next Moves" so they match the latest state
- Preserve exact identifiers, file paths, error names, and numeric values
- Remove stale or disproven items only when clearly superseded

Use the same exact structure as the previous note.`;

function looksTooLarge(error: unknown): boolean {
  const text = String((error as Error | undefined)?.message ?? error ?? "")
    .toLowerCase();
  return (
    text.includes("prompt is too long") ||
    text.includes("prompt_too_long") ||
    text.includes("context_length_exceeded") ||
    text.includes("input length")
  );
}

function renderMessageText<TMessage>(
  message: TMessage,
  adapter: ConversationAdapter<TMessage>,
  maxMessageTextChars: number,
): string {
  const role = adapter.getRole(message);
  const plain = adapter.getPlainText(message).slice(0, maxMessageTextChars);
  if (plain.trim().length > 0) {
    return `[${role}] ${plain}`;
  }

  const blocks = adapter.getBlocks(message);
  const rendered = blocks
    .map(block => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "tool_use" || block.type === "toolCall") {
        const head = typeof block.name === "string" ? block.name : "tool";
        const args =
          block.input === undefined ? "" : JSON.stringify(block.input).slice(0, 200);
        return `[tool-call] ${head}(${args})`;
      }
      return `[${block.type}]`;
    })
    .join("\n");

  return `[${role}] ${rendered.slice(0, maxMessageTextChars)}`;
}

function renderTranscript<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  maxMessageTextChars: number,
): string {
  return messages
    .map(message => renderMessageText(message, adapter, maxMessageTextChars))
    .join("\n\n");
}

export async function writeCarryforwardNote<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
  settings: SummarizerSettings,
  previousNote?: string,
  signal?: AbortSignal,
): Promise<string> {
  let workingSet = messages;
  let retryCount = 0;
  const maxRetries = settings.maxRetries ?? 3;
  const dropFraction = settings.dropFractionOnRetry ?? 0.25;
  const maxMessageTextChars = settings.maxMessageTextChars ?? 6_000;

  const systemPrompt = settings.systemPrompt ?? NOTE_WRITER_SYSTEM;
  const freshTemplate = settings.freshNoteTemplate ?? FRESH_NOTE_TEMPLATE;
  const updateTemplate = settings.updateNoteTemplate ?? UPDATE_NOTE_TEMPLATE;

  while (true) {
    const transcript = renderTranscript(
      workingSet,
      adapter,
      maxMessageTextChars,
    );

    let promptText = `<transcript>\n${transcript}\n</transcript>\n\n`;
    if (previousNote) {
      promptText += `<previous_note>\n${previousNote}\n</previous_note>\n\n`;
      promptText += updateTemplate;
    } else {
      promptText += freshTemplate;
    }

    try {
      const response = await completeSimple(
        settings.model,
        {
          systemPrompt,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: promptText }],
              timestamp: Date.now(),
            },
          ],
          tools: [],
        },
        {
          apiKey: settings.apiKey,
          maxTokens: settings.maxOutputTokens ?? 20_000,
          signal,
        } as any,
      );
      return extractTextContent(response.content);
    } catch (error) {
      if (!looksTooLarge(error) || retryCount >= maxRetries) {
        throw error;
      }
      retryCount++;
      const shrunken = peelOldestRounds(workingSet, adapter, dropFraction);
      if (!shrunken) throw error;
      workingSet = shrunken;
    }
  }
}

/**
 * Heuristic fallback when LLM summarization fails.
 * Extracts tool call names and key text lines — zero API calls.
 */
export function heuristicNote<TMessage>(
  messages: TMessage[],
  adapter: ConversationAdapter<TMessage>,
): string {
  const toolCalls: string[] = [];
  const findings: string[] = [];

  for (const m of messages) {
    if (adapter.getRole(m) !== "assistant") continue;

    for (const block of adapter.getBlocks(m)) {
      if (block.type === "tool_use" || block.type === "toolCall") {
        const name = typeof block.name === "string" ? block.name : "tool";
        const args = block.input ? JSON.stringify(block.input).slice(0, 100) : "";
        toolCalls.push(`${name}(${args})`);
      }
    }

    const text = adapter.getPlainText(m);
    if (text) {
      const keyLines = text.split("\n").filter((line: string) => {
        const l = line.toLowerCase();
        return l.includes("result") || l.includes("found") || l.includes("conclusion")
          || l.includes("hypothesis") || l.includes("decided") || l.includes("key ")
          || l.includes("important") || l.includes("error") || l.includes("fidelity")
          || l.match(/^\s*[-\u2022*]\s/) || l.match(/^\s*\d+\./);
      });
      for (const line of keyLines.slice(0, 5)) {
        const trimmed = line.trim().slice(0, 300);
        if (trimmed.length > 15) findings.push(trimmed);
      }
      if (keyLines.length === 0 && text.length > 30) {
        findings.push(text.slice(0, 400).replace(/\n/g, " "));
      }
    }
  }

  const parts: string[] = [`Summary of ${messages.length} earlier messages:`];
  if (toolCalls.length > 0) {
    const names = toolCalls.map(c => c.split("(")[0]);
    const compacted: string[] = [];
    let i = 0;
    while (i < names.length) {
      const name = names[i];
      let count = 1;
      while (i + count < names.length && names[i + count] === name) count++;
      compacted.push(count > 1 ? `${name}(x${count})` : name);
      i += count;
    }
    parts.push(`\nTools used: ${compacted.join(", ")}`);
  }
  if (findings.length > 0) {
    parts.push(`\nKey findings:\n${findings.slice(0, 20).map(f => `- ${f}`).join("\n")}`);
  }
  return parts.join("\n");
}
