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
import { existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { nameAgent } from "agentsmelt";
import { getApiKey } from "./auth.js";
import { spawnAgent } from "./agents/spawn.js";
import type { CostTracker } from "./hooks.js";
import { readFileSafe } from "./utils.js";

// PI system prompt is now in agents/definitions/pi.md
// Mode-specific blocks (survey/research/plan) are in agents/context-builders.ts

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
  let reviewCount = 0;

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
      reviewCount++;
      const verdict = await evaluateProgress(opts, totalToolCalls, {
        milestone: params.milestone,
        questions: params.questions,
      }, reviewCount);

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
    getReviewCount: () => reviewCount,
    getLastReviewAt: () => lastReviewAt,
    markReviewed() {
      reviewCount++;
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
    const currentReviewCount = piReview.getReviewCount() + 1; // will increment in markReviewed

    evaluateProgress(opts, toolCallCount, undefined, currentReviewCount)
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
// PDF → PNG rendering for visual review
// ---------------------------------------------------------------------------

function renderPdfPages(projectDir: string): string[] {
  const pdfPath = join(projectDir, "report", "report.pdf");
  if (!existsSync(pdfPath)) return [];

  const outDir = join(projectDir, "report", "review-pages");
  mkdirSync(outDir, { recursive: true });

  try {
    execSync(`pdftoppm -png -r 150 "${pdfPath}" "${join(outDir, "page")}"`,
      { timeout: 30_000, stdio: "pipe" });
  } catch {
    return [];
  }

  return readdirSync(outDir)
    .filter(f => f.endsWith(".png"))
    .sort()
    .map(f => join("report", "review-pages", f));
}

function cleanupReviewPages(projectDir: string): void {
  const outDir = join(projectDir, "report", "review-pages");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// One-shot PI Evaluation (Opus — flagship)
// ---------------------------------------------------------------------------

async function evaluateProgress(
  opts: PIMonitorOptions,
  toolCallCount: number,
  milestoneInfo?: { milestone: string; questions?: string },
  reviewCount?: number,
): Promise<PIVerdict> {
  const stateText = buildStateForPI(
    opts.projectDir,
    opts.costTracker,
    opts.startTime,
    toolCallCount,
    milestoneInfo,
    reviewCount,
  );

  // Read research goal to select the correct PI review mode (survey vs research)
  const researchGoal = readFileSafe(join(opts.projectDir, "RESEARCH.md")) ?? "";
  const isSurvey = /survey|review|综述|调研|整理|总结|比较|横向|进展/.test(researchGoal);
  const isPlanReview = milestoneInfo?.milestone?.toLowerCase().includes("plan") ?? false;

  let result: PIVerdict | null = null;

  // Verdict tool — passed as toolOverride to spawnAgent
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

  // Render PDF pages for visual inspection
  const pagePngs = renderPdfPages(opts.projectDir);

  // Append page list to state text if pages were rendered
  let fullStateText = stateText;
  if (pagePngs.length > 0) {
    fullStateText += "\n\n" +
      `# Report Pages for Visual Review (${pagePngs.length} pages)\n` +
      `You MUST use the read tool to view EACH page image below and check visual quality before submitting your verdict.\n` +
      `- Figure quality: labels readable at print size? Legends present? Fonts consistent?\n` +
      `- Layout: proper margins, no orphan lines, tables formatted correctly?\n` +
      `- Overall: does this look like a publishable document?\n\n` +
      pagePngs.map(p => `- ${p}`).join("\n");
  }

  // Spawn PI agent via the centralized spawner
  await spawnAgent({
    name: "reviewer",
    templateVars: {},
    prompt: fullStateText,
    projectDir: opts.projectDir,
    getApiKey,
    toolOverrides: [verdictTool],
    contextExtra: { isSurvey, isPlanReview },
    parentAgentId: "brain",
  });

  // Clean up rendered pages
  cleanupReviewPages(opts.projectDir);

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
  reviewCount?: number,
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

  // Research plan (if exists)
  const plan = readFileSafe(join(projectDir, "notes", "plan.md"));
  if (plan) {
    parts.push(`# Research Plan\n${plan}`);
  }

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

  // Report content — PI reads the clean version (refs resolved to numbers) if available.
  // Falls back to source report.tex if compile hasn't run yet.
  const cleanTexPath = join(projectDir, "report", ".compiled", "report-clean.tex");
  const sourceTexPath = join(projectDir, "report", "report.tex");
  const reportTex = readFileSafe(existsSync(cleanTexPath) ? cleanTexPath : sourceTexPath);
  if (reportTex) {
    parts.push(`# Report Draft (read this carefully before reviewing)\n${reportTex}`);
  }

  // Report status
  const hasTeX = existsSync(join(projectDir, "report", "report.tex"));
  const hasPdf = existsSync(join(projectDir, "report", "report.pdf"));
  const hasBib = existsSync(join(projectDir, "report", "references.bib"));
  parts.push(
    `# Report Status\n- report.tex: ${hasTeX ? "exists" : "not started"}\n- references.bib: ${hasBib ? "exists" : "not started"}\n- report.pdf: ${hasPdf ? "compiled" : "not compiled"}`,
  );

  // Lessons learned (auto-captured failures)
  const lessons = readFileSafe(join(projectDir, "notes", "lessons.md"));
  if (lessons && lessons.trim().length > 20) {
    parts.push(`# Lessons Learned\n${truncate(lessons, 2000)}`);
  }

  // Recent log entries
  const log = readFileSafe(join(projectDir, ".agent", "log.jsonl"));
  if (log) {
    const lines = log.trim().split("\n");
    const recent = lines.slice(-30);
    parts.push(
      `# Recent Actions (last ${recent.length} of ${lines.length} total)\n${recent.join("\n")}`,
    );
  }

  // Reference year distribution — only for survey/review tasks
  const isSurvey = goal ? /survey|review|综述|调研|整理|总结|比较|横向|进展/.test(goal) : false;
  if (isSurvey) {
    const bib = readFileSafe(join(projectDir, "report", "references.bib"));
    if (bib) {
      const yearCounts: Record<number, number> = {};
      const yearRe = /year\s*=\s*\{?\s*(\d{4})/g;
      let ym;
      while ((ym = yearRe.exec(bib)) !== null) {
        const y = parseInt(ym[1]);
        yearCounts[y] = (yearCounts[y] ?? 0) + 1;
      }
      const years = Object.keys(yearCounts).map(Number).sort();
      if (years.length > 0) {
        const total = Object.values(yearCounts).reduce((a, b) => a + b, 0);
        const currentYear = new Date().getFullYear();
        const recentCount = (yearCounts[currentYear] ?? 0) + (yearCounts[currentYear - 1] ?? 0);
        const recentPct = total > 0 ? Math.round((recentCount / total) * 100) : 0;
        const distLines = years.map(y => `  ${y}: ${yearCounts[y]}`);
        parts.push(
          `# Reference Year Distribution (${total} total, ${recentPct}% from ${currentYear - 1}-${currentYear})\n${distLines.join("\n")}`,
        );
      }
    }
  }

  // Resource usage — commented out so PI judges on quality, not cost/time.
  // Uncomment to let PI see resource consumption again.
  const resourceLines: string[] = [];
  if (reviewCount !== undefined) {
    resourceLines.push(`- Review count: ${reviewCount} (this is review #${reviewCount})`);
  }
  // if (costTracker) {
  //   resourceLines.push(`- Cost spent: $${costTracker.totalCost.toFixed(2)}`);
  //   resourceLines.push(
  //     `- Tokens: ${costTracker.totalInputTokens} in / ${costTracker.totalOutputTokens} out`,
  //   );
  // }
  // if (startTime) {
  //   const mins = ((Date.now() - startTime) / 60_000).toFixed(1);
  //   resourceLines.push(`- Time elapsed: ${mins} minutes`);
  // }
  // if (toolCallCount !== undefined) {
  //   resourceLines.push(`- Tool calls so far: ${toolCallCount}`);
  // }
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
