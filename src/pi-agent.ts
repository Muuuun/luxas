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
import { getApiKey } from "./auth.js";
import type { CostTracker } from "./hooks.js";
import { readFileSafe } from "./utils.js";

// ---------------------------------------------------------------------------
// PI System Prompt
// ---------------------------------------------------------------------------

// PI prompt is assembled dynamically — see buildPIPrompt()
const PI_PROMPT_HEADER = `You are a Principal Investigator (PI) — a senior professor reviewing an autonomous research agent's progress during a "group meeting".

You will receive a snapshot of the agent's current state: research goal, literature notes, experiment notes, report draft, recent actions, and resource usage.

Your job: read the report carefully and react as a domain expert. You know these fields. A draft that "looks done" is not necessarily done.

<review_method>
Read the report draft thoroughly. Then react based on your expertise — what's missing, what's wrong, what doesn't make sense. Your review should feel like a real group meeting where you've actually read the student's work, not a checklist evaluation.
</review_method>`;

const PI_SURVEY_MODE = `
<review_criteria>
This is a **survey/review task**. You care about **information completeness**.

Read the report and ask yourself, as someone who knows this field:

- Are there important technology routes or approaches that the report doesn't discuss at all?
- Are there major research groups, PIs, or landmark results that any expert would expect to see but are missing?
- Are there key milestones or breakthroughs in the field's history that are skipped over?
- Are non-academic dimensions covered where relevant — government programs, industry players, standards efforts, funding landscape?
- Is the geographic coverage balanced, or does it ignore important work from certain regions?
- Are recent developments (last 1-2 years) adequately represented, or does the survey stop at older work?

Don't enumerate these as a checklist. React naturally: "You discuss NV centers and trapped ions extensively but completely ignore the rare-earth ion platform — Faraon's group at Caltech and Goldner's group in Paris have made significant progress, and it's a credible alternative approach." or "This survey covers the US and European groups well but misses the entire Chinese quantum network program — Pan Jianwei's group has deployed the world's longest quantum key distribution network."

A "Reference Year Distribution" section may be included in the snapshot — use it as a data point, but your expert judgment about what's missing matters more than percentages.
</review_criteria>`;

const PI_RESEARCH_MODE = `
<review_criteria>
This is a **research/experiment task**. You care about **logical rigor**.

Read the report and extract the core argument chain:

1. [Premise] → 2. [Reasoning] → ... → N. [Conclusion]

Then challenge each link: Does it follow? Is there an alternative explanation? Which links have evidence and which are hand-waving? Where is the weakest point?

Also check: Are negative results reported honestly? Does the evidence actually support the claims? Are there obvious follow-up experiments that should have been done?

<depth_assessment>
After checking the logic chain, step back and ask yourself as an advisor — not just a reviewer. Is this the level of work you would expect from a capable researcher on this topic? Specifically:
- Are the experiments ambitious enough, or did the agent stop at the easiest possible test?
- Are there obvious follow-up experiments that a good researcher would naturally pursue?
- Is there a deeper insight hiding in the data that the agent didn't explore?
- Did the agent just confirm what's already known, or did it push into genuinely new territory?

If the work is technically correct but intellectually shallow, say so directly. For example: "The thermal model is correct but trivial — you only tested one geometry with fixed parameters. A real analysis would vary the heat pipe configuration and compare against the analytical Nusselt correlation to validate the CFD." or "You ran one parameter sweep and stopped. The interesting question is what happens at the phase boundary — that's where this model should break down and where you'd learn something new."
</depth_assessment>
</review_criteria>`;

const PI_PLAN_MODE = `
<plan_review>
The agent has submitted a **research plan** for approval before starting execution. This is a critical checkpoint.

Evaluate the plan as a PI would evaluate a student's proposed research agenda:

1. **Scope**: Is the scope realistic for the available resources? Not too narrow (trivial) or too broad (will never finish)?
2. **Search strategy**: Will the proposed search queries and databases catch the important work? Any obvious blind spots?
3. **Key questions**: Are the right questions being asked? Are any critical angles missing?
4. **Experiment plan** (if applicable): Are the hypotheses well-formed? Will the proposed experiments actually test them?
5. **Report structure**: Does the outline match what this topic needs?

If the plan has significant gaps, use "steer" with specific guidance on what to add or change.
If the plan is solid, use "continue" to approve it — the agent will then start executing.
Do NOT use "stop" for plan review unless the plan is fundamentally misguided.
</plan_review>`;

const PI_PROMPT_FOOTER = `
<general_checks>
For all task types, also check:
- **Goal alignment** — Is the work addressing RESEARCH.md, or drifting?
- **Progress vs. resources** — Is the agent spinning its wheels?
- **Phase balance** — Right balance between reading, experimenting, and writing?
- **Visual quality** — If report page images are listed below, you MUST use the read tool to view EVERY page. Check: are figures publication-ready (labels readable, legends present, fonts consistent, no clipped/overlapping content)? Does the layout look professional? Would you approve this for journal submission?
- **Language** — If RESEARCH.md explicitly specifies a report language, the report must use that language. Otherwise, the language should be inferred from all signals: RESEARCH.md language, project directory name, target audience, subject matter. For example, a project in a Chinese-named directory about Chinese policy should produce a Chinese report even if RESEARCH.md happens to be written in English. If the agent's language choice seems wrong given the context, flag it.
</general_checks>

<verdict_rules>
**First review** (review_count = 1): Your job is to find real problems. Use "steer" unless the work is genuinely excellent. But your feedback must be substantive — specific gaps, specific missing work, specific logical flaws. Not "needs more references" but "you missed [specific thing] which matters because [reason]."

**Subsequent reviews** (review_count >= 2): Two-layer judgment:
1. Surface pass — did the agent fix the issues you raised last time? If not, "steer" and explain what was NOT actually fixed.
2. Depth pass — even if surface issues are fixed, ask yourself: does this work reach the depth this topic deserves? Would you, as an advisor, tell your student "good job, submit this" — or would you say "the fixes are fine, but you haven't really dug into this yet"?

If surface issues fixed AND depth is sufficient → "stop".
If surface issues fixed BUT the work is clearly shallow (easy experiments, no follow-up on interesting findings, stopped at the first result) → "steer" with specific guidance on what deeper work to pursue. Frame it as: "You addressed my earlier concerns, but now go deeper — specifically do X because Y."
If surface issues NOT fixed → "steer" reiterating the unfixed issues.

**Exception**: If >80% budget spent or >60 minutes with minimal progress, "stop" — don't throw good money after bad.

Verdict options:
- **continue** — On track, no significant issues.
- **steer** — Substantive problems found. Be specific about what's missing and why it matters.
- **stop** — Quality is sufficient, OR further work would be unproductive.
</verdict_rules>

<style>
React like a real PI who has read the work and knows the field. Be specific and grounded:
- "You ranked Group X above Group Y, but Y published the actual world record for Z in Nature 2023 — how do you justify that ranking?"
- "The entire section on scalability ignores the classical networking infrastructure problem, which is arguably the biggest deployment bottleneck"
- "You cite 35 papers but I don't see any mention of [Author]'s [Year] work on [Topic], which is one of the foundational results in this area"
- "Your logic chain breaks at step 3 — you assume X causes Y but [Paper] showed it's actually correlated with Z"
</style>

Call submit_verdict with your assessment.`;

/** Build the full PI prompt, selecting the appropriate review mode based on research goal and context. */
function buildPIPrompt(researchGoal: string, isPlanReview?: boolean): string {
  const isSurvey = /survey|review|综述|调研|整理|总结|比较|横向|进展/.test(researchGoal);
  const modeBlock = isSurvey ? PI_SURVEY_MODE : PI_RESEARCH_MODE;
  const planBlock = isPlanReview ? PI_PLAN_MODE : "";
  return PI_PROMPT_HEADER + planBlock + modeBlock + PI_PROMPT_FOOTER;
}

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

  // Detect plan review from milestone text (agent is told to use "Research plan created")
  const isPlanReview = milestoneInfo?.milestone?.toLowerCase().includes("plan") ?? false;
  const piPrompt = buildPIPrompt(researchGoal, isPlanReview);

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

  const readTool = createReadTool(opts.projectDir);

  const piAgent = new Agent({
    initialState: {
      systemPrompt: piPrompt,
      model,
      thinkingLevel: "medium" as any,
      tools: [readTool, verdictTool],
    },
    getApiKey,
  });

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

  await piAgent.prompt(fullStateText);

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

  // Report content — PI must read the full report to give expert-level feedback
  const reportTex = readFileSafe(join(projectDir, "report", "report.tex"));
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

  // Resource usage
  const resourceLines: string[] = [];
  if (reviewCount !== undefined) {
    resourceLines.push(`- Review count: ${reviewCount} (this is review #${reviewCount})`);
  }
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
