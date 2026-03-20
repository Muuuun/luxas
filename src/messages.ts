/**
 * Custom message types for Sisyphus research agent.
 * Extends pi-agent-core's message system with research-specific types.
 *
 * #7: Custom message types (from pi-coding-agent pattern)
 */

import type { Message } from "@mariozechner/pi-ai";

// ── Custom message types ─────────────────────────────────

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  previousSummary?: string;
  timestamp: number;
}

export interface ExperimentResultMessage {
  role: "experimentResult";
  hypothesis: string;
  result: "confirmed" | "refuted" | "inconclusive";
  summary: string;
  newFiles: string[];
  elapsed: number;
  timestamp: number;
}

export interface PIFeedbackMessage {
  role: "piFeedback";
  verdict: "continue" | "redirect" | "wrap_up";
  feedback: string;
  timestamp: number;
}

// Custom message type union (used by convertToLlm at runtime)
export type SisyphusCustomMessage =
  | CompactionSummaryMessage
  | ExperimentResultMessage
  | PIFeedbackMessage;

// ── Convert custom messages to LLM-compatible format ─────

export function convertToLlm(messages: any[]): Message[] {
  return messages
    .map((m: any): Message | undefined => {
      switch (m.role) {
        case "compactionSummary":
          return {
            role: "user",
            content: [{
              type: "text",
              text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${m.summary}\n</summary>`,
            }],
            timestamp: m.timestamp,
          } as any;
        case "experimentResult":
          return {
            role: "user",
            content: [{
              type: "text",
              text: `[Experiment Result] Hypothesis: ${m.hypothesis}\nOutcome: ${m.result}\n${m.summary}`,
            }],
            timestamp: m.timestamp,
          } as any;
        case "piFeedback":
          return {
            role: "user",
            content: [{
              type: "text",
              text: `[PI FEEDBACK — ${m.verdict}]\n${m.feedback}`,
            }],
            timestamp: m.timestamp,
          } as any;
        case "user":
        case "assistant":
        case "toolResult":
          return m;
        default:
          return undefined;
      }
    })
    .filter((m): m is Message => m !== undefined);
}
