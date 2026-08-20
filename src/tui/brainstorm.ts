/**
 * Brainstorm agent — interactive research planning before the main agent runs.
 *
 * Adapted from Superpowers' brainstorming-first philosophy:
 * ask clarifying questions → propose research angles → generate RESEARCH.md.
 */

import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple, Type } from "@earendil-works/pi-ai/compat";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getApiKey } from "../auth.js";

const BRAINSTORM_PROMPT = `You are a research planning assistant helping the user define a clear, actionable research project.

Your goal: turn a rough topic into a well-structured RESEARCH.md that will guide an autonomous research agent.

Process:
1. Start by acknowledging the topic and asking 2-3 focused clarifying questions (one message, numbered list). Good questions to consider:
   - What specific aspect or angle interests them most?
   - What's the intended depth (broad survey vs. deep dive)?
   - Any known starting points, key papers, or specific methods?
   - What deliverables do they expect (survey, comparison, experimental validation)?
   - Any constraints (time period, subfield, methodology)?
2. After the user answers, you may ask 1-2 follow-up questions if critical aspects are still unclear. Don't over-ask — 1-2 rounds total is ideal.
3. When you have enough context, present a research brief summary and ask the user to confirm or adjust.
4. Once confirmed, call the finalize_brief tool to write the final RESEARCH.md.

Research brief format:
# <Clear, specific title>

## Goal
<1-2 paragraphs: what this research aims to achieve>

## Scope
<Bullet list: what's in scope and what's out of scope>

## Key Questions
<Numbered list of 3-7 specific research questions>

## Expected Deliverables
<What the final output should look like>

## Methodology Hints
<Relevant subfields, seminal papers, experimental approaches to consider>

Rules:
- Be conversational but efficient — respect the user's time
- If the topic is already very specific, skip to proposing the brief directly
- If the topic is vague, help narrow it down
- Write the final brief in English
- Keep it under 500 words
- Be specific and actionable, never vague`;

export interface BrainstormCallbacks {
  onText: (text: string) => void;
  onFinalized: (content: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export function createBrainstormAgent(projectDir: string, callbacks: BrainstormCallbacks) {
  const model = getModel("anthropic" as any, "claude-haiku-4-5-20251001" as any);

  const finalizeTool = {
    name: "finalize_brief",
    label: "Finalize Research Brief",
    description: "Write the finalized RESEARCH.md to disk. Call this only after the user has confirmed the research brief.",
    parameters: Type.Object({
      content: Type.String({ description: "The full RESEARCH.md content in markdown format" }),
    }),
    // AgentTool.execute receives `unknown`: the payload is model-supplied and
    // validated against `parameters` by the caller, so narrow here rather than
    // declaring a narrower parameter type the interface cannot guarantee.
    async execute(_toolCallId: string, params: unknown) {
      const { content } = params as { content: string };
      const researchPath = join(projectDir, "RESEARCH.md");
      writeFileSync(researchPath, content + "\n");
      callbacks.onFinalized(content);
      return {
        content: [{ type: "text" as const, text: "RESEARCH.md written successfully." }],
        details: {},
      };
    },
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: BRAINSTORM_PROMPT,
      model,
      thinkingLevel: "low" as any,
      tools: [finalizeTool],
    },
    // Required since 0.84: the loop no longer falls back to streamSimple.
    streamFn: streamSimple,
    getApiKey,
  });

  // Subscribe to events to capture agent text output
  agent.subscribe((event: any) => {
    if (event.type === "message_end") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const text = content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
        if (text) callbacks.onText(text);
      }
    }
  });

  return agent;
}
