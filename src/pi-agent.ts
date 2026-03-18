/**
 * PI Agent — adversarial quality monitor (GAN-like discriminator).
 *
 * Simulates a Principal Investigator who reviews research progress like a
 * "group meeting" (组会). Two trigger modes:
 *
 *   1. Milestone-driven: research agent calls request_pi_review tool when it
 *      completes a milestone (literature done, experiment finished, draft ready).
 *      PI feedback returns as tool result — natural conversation flow.
 *
 *   2. Step-count fallback: if the agent hasn't requested review after many
 *      tool calls, PI is triggered automatically via steer().
 *
 * PI uses the strongest flagship model with clean context (reads project files
 * directly, no shared conversation history with the research agent).
 */

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getApiKey } from "./auth.js";
import type { CostTracker } from "./hooks.js";
import { readFileSafe } from "./utils.js";

// ---------------------------------------------------------------------------
// PI System Prompt
// ---------------------------------------------------------------------------

const PI_PROMPT = `You are a Principal Investigator (PI) — a senior professor reviewing an autonomous research agent's progress during a "group meeting".

You will receive a snapshot of the agent's current state: research goal, literature notes, experiment notes, report status, recent actions, resource usage, and the agent's own milestone summary (if it requested this review).

Your job: evaluate the research like a real PI would in a weekly group meeting.

## Evaluation Criteria

1. **Goal alignment** — Is the work addressing the stated research goal, or drifting into tangents?
2. **Progress vs. resources** — Is progress proportional to cost/time spent?
3. **Literature coverage** — Are key subfields, seminal papers, and recent work covered? Blind spots?
4. **Methodology soundness** — Is the experimental design appropriate? Flawed assumptions?
5. **Circular behavior** — Repeating actions without progress? Stuck on something?
6. **Phase balance** — Right balance between reading, experimenting, and writing?
7. **Writing readiness** — Time to start/continue the report?
8. **Quality bar** — Would the current work pass peer review? What's missing?

## Verdict

- **continue** — On track. Brief encouragement + any minor suggestions.
- **steer** — Needs course correction. Be specific about what to change and why.
- **stop** — Wrap up. Either quality is sufficient, or direction is unproductive — explain which.

## Style

Be a demanding but constructive PI. Be specific, not vague:
- "Literature review covers X and Y well, but completely misses Z which is central — search for [specific terms]"
- "3 experiments run but none test the core hypothesis from RESEARCH.md — redesign around [specific question]"
- "Good coverage. Draft the introduction and related work sections now while the literature is fresh"
- "60% budget spent, no report started — stop all new experiments, write up what you have"
- "The agent is cycling between the same 3 search queries — switch to citation chaining from [paper X]"

Call submit_verdict with your assessment.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PIVerdict {
  verdict: "continue" | "steer" | "stop";
  assessment: string;
  issues: string[];
  instructions: string;
}

export interface PIMonitorOptions {
  projectDir: string;
  fallbackInterval?: number;  // auto-trigger after N tool calls without review (default 50)
  costTracker?: CostTracker;
  startTime?: number;
  onVerdict?: (verdict: PIVerdict, toolCallCount: number) => void;
}

// ---------------------------------------------------------------------------
// PI Review Tool — research agent calls this at milestones
// ---------------------------------------------------------------------------

export function createPIReviewTool(opts: PIMonitorOptions) {
  let totalToolCalls = 0;
  let lastReviewAt = 0;

  const tool = {
    name: "request_pi_review",
    label: "Request PI Review",
    description:
      "Request a review from the PI (Principal Investigator) at a research milestone. " +
      "Call this when you complete a significant phase: finished initial literature survey, " +
      "completed a key experiment, drafted a report section, or need strategic guidance. " +
      "Include a brief summary of what you accomplished and any questions for the PI.",
    parameters: Type.Object({
      milestone: Type.String({
        description:
          "Brief description of what milestone was reached (e.g. 'Completed literature survey of 15 papers on topic X')",
      }),
      questions: Type.Optional(
        Type.String({
          description:
            "Any specific questions for the PI (e.g. 'Should I pursue direction A or B?')",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { milestone: string; questions?: string },
    ) {
      const verdict = await evaluateProgress(opts, totalToolCalls, {
        milestone: params.milestone,
        questions: params.questions,
      });

      lastReviewAt = totalToolCalls;

      // Persist feedback
      const feedbackPath = join(opts.projectDir, "reviews", "pi_feedback.md");
      mkdirSync(join(opts.projectDir, "reviews"), { recursive: true });
      writeFileSync(feedbackPath, formatFeedback(verdict, totalToolCalls));

      opts.onVerdict?.(verdict, totalToolCalls);

      // Return verdict as tool result — agent sees it naturally
      const parts = [`**PI Verdict: ${verdict.verdict.toUpperCase()}**\n`, verdict.assessment];
      if (verdict.issues.length > 0) {
        parts.push("\n\n**Issues:**");
        for (const issue of verdict.issues) parts.push(`- ${issue}`);
      }
      if (verdict.instructions) {
        parts.push(`\n\n**Instructions:**\n${verdict.instructions}`);
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
        details: { verdict: verdict.verdict },
      };
    },
  };

  return {
    tool,
    /** Call from subscribe to track tool count and get fallback trigger info */
    tick(): { shouldAutoTrigger: boolean } {
      totalToolCalls++;
      const stepsSinceReview = totalToolCalls - lastReviewAt;
      const threshold = opts.fallbackInterval ?? 50;
      return { shouldAutoTrigger: stepsSinceReview >= threshold };
    },
    getToolCallCount: () => totalToolCalls,
    getLastReviewAt: () => lastReviewAt,
    markReviewed() {
      lastReviewAt = totalToolCalls;
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback monitor — auto-triggers PI when agent hasn't requested review
// ---------------------------------------------------------------------------

export function setupPIFallbackMonitor(
  researchAgent: Agent,
  piReview: ReturnType<typeof createPIReviewTool>,
  opts: PIMonitorOptions,
): { getLastVerdict: () => PIVerdict | null } {
  let isEvaluating = false;
  let lastVerdict: PIVerdict | null = null;

  researchAgent.subscribe((event: any) => {
    if (event.type !== "tool_execution_end") return;

    const { shouldAutoTrigger } = piReview.tick();

    if (!shouldAutoTrigger || isEvaluating) return;
    isEvaluating = true;

    const toolCallCount = piReview.getToolCallCount();

    evaluateProgress(opts, toolCallCount)
      .then((verdict) => {
        lastVerdict = verdict;
        piReview.markReviewed();

        // Persist
        const feedbackPath = join(opts.projectDir, "reviews", "pi_feedback.md");
        mkdirSync(join(opts.projectDir, "reviews"), { recursive: true });
        writeFileSync(feedbackPath, formatFeedback(verdict, toolCallCount));

        opts.onVerdict?.(verdict, toolCallCount);

        // Auto-triggered: inject via steer since agent didn't ask
        const feedbackText = [
          `[PI FEEDBACK — Scheduled Review (${toolCallCount} steps without check-in)]`,
          "",
          verdict.assessment,
        ];
        if (verdict.issues.length > 0) {
          feedbackText.push("", "Issues:");
          for (const issue of verdict.issues) feedbackText.push(`- ${issue}`);
        }
        if (verdict.instructions) {
          feedbackText.push("", "Instructions:", verdict.instructions);
        }

        if (verdict.verdict === "steer" || verdict.verdict === "stop") {
          researchAgent.steer({
            role: "user",
            content: feedbackText.join("\n"),
            timestamp: Date.now(),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        isEvaluating = false;
      });
  });

  return { getLastVerdict: () => lastVerdict };
}

// ---------------------------------------------------------------------------
// One-shot PI Evaluation (Opus — flagship)
// ---------------------------------------------------------------------------

async function evaluateProgress(
  opts: PIMonitorOptions,
  toolCallCount: number,
  milestoneInfo?: { milestone: string; questions?: string },
): Promise<PIVerdict> {
  const stateText = buildStateForPI(
    opts.projectDir,
    opts.costTracker,
    opts.startTime,
    toolCallCount,
    milestoneInfo,
  );

  const model = getModel("anthropic" as any, "claude-opus-4-6" as any);

  let result: PIVerdict | null = null;

  const verdictTool = {
    name: "submit_verdict",
    label: "Submit PI Verdict",
    description: "Submit your assessment of the research progress.",
    parameters: Type.Object({
      verdict: Type.String({
        description:
          'One of: "continue" (on track), "steer" (needs correction), "stop" (wrap up)',
      }),
      assessment: Type.String({
        description: "Overall assessment in 2-3 sentences",
      }),
      issues: Type.Array(Type.String(), {
        description: "Specific issues found (empty array if none)",
      }),
      instructions: Type.String({
        description:
          "Specific actionable instructions for the research agent (empty string if continuing as-is)",
      }),
    }),
    async execute(
      _toolCallId: string,
      params: {
        verdict: string;
        assessment: string;
        issues: string[];
        instructions: string;
      },
    ) {
      result = {
        verdict: (["continue", "steer", "stop"].includes(params.verdict)
          ? params.verdict
          : "continue") as PIVerdict["verdict"],
        assessment: params.assessment,
        issues: params.issues ?? [],
        instructions: params.instructions ?? "",
      };
      return {
        content: [{ type: "text" as const, text: "Verdict recorded." }],
        details: {},
      };
    },
  };

  const piAgent = new Agent({
    initialState: {
      systemPrompt: PI_PROMPT,
      model,
      thinkingLevel: "medium" as any,
      tools: [verdictTool],
    },
    getApiKey,
  });

  await piAgent.prompt(stateText);

  return (
    result ?? {
      verdict: "continue",
      assessment: "PI evaluation did not produce a structured verdict.",
      issues: [],
      instructions: "",
    }
  );
}

// ---------------------------------------------------------------------------
// State snapshot for PI (clean context — no conversation history)
// ---------------------------------------------------------------------------

function buildStateForPI(
  projectDir: string,
  costTracker?: CostTracker,
  startTime?: number,
  toolCallCount?: number,
  milestoneInfo?: { milestone: string; questions?: string },
): string {
  const parts: string[] = [];

  // Agent's milestone report (if triggered by agent)
  if (milestoneInfo) {
    parts.push(`# Agent's Milestone Report\n${milestoneInfo.milestone}`);
    if (milestoneInfo.questions) {
      parts.push(`\n**Questions for PI:** ${milestoneInfo.questions}`);
    }
  } else {
    parts.push(
      "# Scheduled Review\nThis is an automatic check-in — the agent has not requested a review after many steps.",
    );
  }

  // Research goal
  const goal = readFileSafe(join(projectDir, "RESEARCH.md"));
  parts.push(`# Research Goal\n${goal || "(RESEARCH.md not found)"}`);

  // Literature progress
  const lit = readFileSafe(join(projectDir, "notes", "literature.md"));
  parts.push(
    `# Literature Notes\n${lit ? truncate(lit, 5000) : "(empty — no literature review yet)"}`,
  );

  // Experiment progress
  const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
  parts.push(
    `# Experiment Notes\n${exp ? truncate(exp, 5000) : "(empty — no experiments yet)"}`,
  );

  // Report content (if exists)
  const reportTex = readFileSafe(join(projectDir, "report", "report.tex"));
  if (reportTex) {
    parts.push(`# Report Draft\n${truncate(reportTex, 5000)}`);
  }

  // Report status
  const hasTeX = existsSync(join(projectDir, "report", "report.tex"));
  const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
  const hasBib = existsSync(join(projectDir, "report", "references.bib"));
  parts.push(
    `# Report Status\n- report.tex: ${hasTeX ? "exists" : "not started"}\n- references.bib: ${hasBib ? "exists" : "not started"}\n- report.pdf: ${hasPdf ? "compiled" : "not compiled"}`,
  );

  // Recent log entries
  const log = readFileSafe(join(projectDir, ".agent", "log.jsonl"));
  if (log) {
    const lines = log.trim().split("\n");
    const recent = lines.slice(-30);
    parts.push(
      `# Recent Actions (last ${recent.length} of ${lines.length} total)\n${recent.join("\n")}`,
    );
  }

  // Resource usage
  const resourceLines: string[] = [];
  if (costTracker) {
    resourceLines.push(`- Cost spent: $${costTracker.totalCost.toFixed(2)}`);
    resourceLines.push(
      `- Tokens: ${costTracker.totalInputTokens} in / ${costTracker.totalOutputTokens} out`,
    );
  }
  if (startTime) {
    const mins = ((Date.now() - startTime) / 60_000).toFixed(1);
    resourceLines.push(`- Time elapsed: ${mins} minutes`);
  }
  if (toolCallCount !== undefined) {
    resourceLines.push(`- Tool calls so far: ${toolCallCount}`);
  }
  if (resourceLines.length > 0) {
    parts.push(`# Resource Usage\n${resourceLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Format PI feedback for pi_feedback.md
// ---------------------------------------------------------------------------

function formatFeedback(verdict: PIVerdict, toolCallCount: number): string {
  const lines = [
    `# PI Feedback`,
    ``,
    `Last reviewed: ${new Date().toISOString()} (after ${toolCallCount} tool calls)`,
    ``,
    `## Verdict: ${verdict.verdict.toUpperCase()}`,
    ``,
    `## Assessment`,
    verdict.assessment,
  ];

  if (verdict.issues.length > 0) {
    lines.push("", "## Issues");
    for (const issue of verdict.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (verdict.instructions) {
    lines.push("", "## Instructions", verdict.instructions);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...(truncated)";
}
