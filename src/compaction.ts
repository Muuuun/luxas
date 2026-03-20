/**
 * LLM-based context compaction for Sisyphus.
 *
 * #1: Replace heuristic summarizeMessages() with LLM-generated summaries.
 * Pattern from pi-coding-agent/compaction.ts, adapted for research context.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";

// ── Prompts (adapted from pi-coding-agent + research-specific sections) ──

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant for an autonomous research agent (Sisyphus). Your task is to read a conversation and produce a structured summary. Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const RESEARCH_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the research.

Use this EXACT format:

## Research Goal
[Current understanding of the research goal]

## Literature Findings
- [Key papers read, with citation keys and core findings]
- [Or "(none yet)" if no papers read]

## Experiments Conducted
- [For each experiment: Hypothesis → Setup → Result → Interpretation]
- [Include EXACT numerical results, formulas, and parameter values]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Dead Ends
- [Approaches tried that didn't work, and WHY]
- [Or "(none)" if no dead ends encountered]

## Progress
### Done
- [x] [Completed tasks/analyses]

### In Progress
- [ ] [Current work]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [File paths, parameter values, formulas, physical constants needed to continue]
- [Exact wavelengths, intensities, fidelity values, error budget numbers]
- [Or "(none)" if not applicable]

Keep each section concise but preserve ALL quantitative results. Preserve exact file paths, formula expressions, and numerical values — these are the agent's long-term memory.`;

const RESEARCH_UPDATE_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new experiments, literature, decisions, and context
- UPDATE Progress: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE all exact numerical results, file paths, and formulas
- If something is no longer relevant, you may remove it
- If an earlier result was found to be WRONG, mark it clearly and add the correction

Use the same EXACT format as the original summary:

## Research Goal
## Literature Findings
## Experiments Conducted
## Key Decisions
## Dead Ends
## Progress
### Done / In Progress
## Next Steps
## Critical Context

Keep each section concise. Preserve exact file paths, formulas, and numerical values.`;

// ── Conversation serialization ───────────────────────────

function serializeConversation(messages: any[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : (msg.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
      if (text.trim()) parts.push(`[User]: ${text.slice(0, 2000)}`);
    } else if (msg.role === "assistant") {
      const blocks = typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : (msg.content ?? []);

      for (const block of blocks) {
        if (block.type === "text" && block.text?.trim()) {
          parts.push(`[Assistant]: ${block.text.slice(0, 2000)}`);
        } else if (block.type === "toolCall" || block.type === "tool_use") {
          const args = block.input ? JSON.stringify(block.input).slice(0, 200) : "";
          parts.push(`[Tool Call]: ${block.name}(${args})`);
        }
      }
    } else if (msg.role === "toolResult") {
      const text = (msg.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      const preview = text.slice(0, 1000);
      const suffix = text.length > 1000 ? "... (truncated)" : "";
      parts.push(`[Tool Result]: ${preview}${suffix}`);
    }
  }

  return parts.join("\n\n");
}

// ── LLM summary generation ──────────────────────────────

export async function generateResearchSummary(
  messages: any[],
  model: Model<any>,
  apiKey: string,
  previousSummary?: string,
  signal?: AbortSignal,
): Promise<string> {
  const conversationText = serializeConversation(messages);

  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
    promptText += RESEARCH_UPDATE_PROMPT;
  } else {
    promptText += RESEARCH_SUMMARIZATION_PROMPT;
  }

  const response = await completeSimple(model, {
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() }],
    tools: [],
  }, {
    maxTokens: 4096,
    signal,
    apiKey,
  } as any);

  return response.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

// ── Heuristic fallback (kept for resilience) ────────────

export function heuristicSummary(messages: any[]): string {
  const toolCalls: string[] = [];
  const findings: string[] = [];

  for (const m of messages) {
    if (m.role === "assistant" && m.content) {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;

      for (const b of blocks as any[]) {
        if (b.type === "tool_use" || b.type === "toolCall") {
          const args = b.input ? JSON.stringify(b.input).slice(0, 100) : "";
          toolCalls.push(`${b.name}(${args})`);
        }
      }

      const text = (blocks as any[])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");

      if (text) {
        const keyLines = text.split("\n").filter((line: string) => {
          const l = line.toLowerCase();
          return l.includes("result") || l.includes("found") || l.includes("conclusion")
            || l.includes("hypothesis") || l.includes("decided") || l.includes("key ")
            || l.includes("important") || l.includes("error") || l.includes("fidelity")
            || l.match(/^\s*[-•*]\s/) || l.match(/^\s*\d+\./);
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
