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

import { getModel, Type } from "@earendil-works/pi-ai/compat";
import { Agent } from "@earendil-works/pi-agent-core";
import { appendFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { getApiKey } from "./auth.js";
import { spawnAgent } from "./agents/spawn.js";
import { createSpawnToolFactory } from "./tools/spawn-agent.js";
import { readFileSafe } from "./utils.js";
import { buildClaimTable } from "./claims-table.js";
import { formatPIEstimateLines, piEstimateRule, type PIEstimate, obligationScope } from "./claims-review.js";

// PI system prompt is now in agents/definitions/pi.md
// Mode-specific blocks (survey/research/plan) are in agents/context-builders.ts

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PIVerdict {
  verdict: "continue" | "steer" | "stop";
  /** Set on the synthesized no-response verdicts: they are not verdicts and never change the STOP freeze. */
  placeholder?: boolean;
  /** Claims-first §3.5: the PI's own estimate per headline quantity (persisted as ESTIMATE lines). */
  estimates?: PIEstimate[];
  /** DISCRIMINATOR: lines the PI pre-registers (persisted verbatim). */
  discriminators?: string[];
  /** Quantity ids whose disclosure the PI countersigns (persisted as DISCLOSE-OK lines). */
  discloseOk?: string[];
  assessment: string;
  issues: string[];
  instructions: string;
}

export interface PIMonitorOptions {
  projectDir: string;
  fallbackInterval?: number;  // auto-trigger after N tool calls without review (default 50)
  onVerdict?: (verdict: PIVerdict, toolCallCount: number) => void;
  /** Restored from session JSONL for crash recovery. */
  initialState?: { totalToolCalls: number; lastReviewAt: number; reviewCount: number };
  /**
   * Fix γ: when `luxas run --directive "..."` started this session, pass that
   * verbatim string here. PI prepends it to its state with explicit framing so
   * PI can verify brain has addressed each clause of the directive against the
   * report/experiment artifacts — not brain's self-narrative. Closes the
   * structural hole where PI reads RESEARCH.md (which never contains the
   * directive) and rubber-stamps brain's "Ready to finish" milestone.
   */
  userDirective?: string;
}

// ---------------------------------------------------------------------------
// PI Review Tool — research agent calls this at milestones
// ---------------------------------------------------------------------------

export function createPIReviewTool(opts: PIMonitorOptions) {
  let totalToolCalls = opts.initialState?.totalToolCalls ?? 0;
  let lastReviewAt = opts.initialState?.lastReviewAt ?? 0;
  let reviewCount = opts.initialState?.reviewCount ?? 0;

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
      appendPIFeedback(feedbackPath, formatFeedback(verdict, totalToolCalls));

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
    /** Snapshot PI state for session persistence. */
    snapshotState() {
      return { piToolCalls: totalToolCalls, piLastReviewAt: lastReviewAt, piReviewCount: reviewCount };
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
        appendPIFeedback(feedbackPath, formatFeedback(verdict, toolCallCount));

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
  reviewCount?: number,
): Promise<PIVerdict> {
  const stateText = buildStateForPI(
    opts.projectDir,
    toolCallCount,
    milestoneInfo,
    reviewCount,
    opts.userDirective,
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
      estimates: Type.Optional(Type.Array(Type.Object({
        quantity: Type.String({ description: "quantity id from <claim_status>" }),
        value: Type.Number({ description: "your own estimate, by a route the experiment did not use" }),
        sigma: Type.Optional(Type.Number({ description: "your uncertainty on that estimate" })),
        route: Type.String({ description: "how you got it, ≤12 words" }),
      }), { description: "REQUIRED for a stop verdict when <claim_status> lists headline quantities: one entry per headline quantity. A PI that has not put its own number on the headline has not reviewed it." })),
      discriminators: Type.Optional(Type.Array(Type.String(), {
        description: 'Lines of the form "DISCRIMINATOR: <id> — if right: …; if wrong: …; computation: …" — the computation that would settle a disputed headline quantity, pre-registered before its result exists. REQUIRED on a "stop" verdict for EVERY headline quantity (referee pass): name the one computation a referee would demand before accepting that claim (a finer scan across the crux, a sensitivity the model never varied, the number at the operating point). A stop without them is downgraded to steer.',
      })),
      disclose_ok: Type.Optional(Type.Array(Type.String(), {
        description: "Quantity ids whose CLAIM-DISCLOSE (in notes/memory.md) you COUNTERSIGN as an honest, adequately hedged disclosure of an unresolved dispute. You are not the producer; the brain cannot countersign its own proposal.",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        verdict: string;
        assessment: string;
        issues: string[];
        instructions: string;
        estimates?: PIEstimate[];
        discriminators?: string[];
        disclose_ok?: string[];
      },
    ) {
      // Normalize case/whitespace; an unrecognized verdict string must NOT
      // silently pass as "continue" (a fail-open) — default the ambiguous
      // case to "steer".
      const v = params.verdict.trim().toLowerCase();
      result = {
        verdict: (["continue", "steer", "stop"].includes(v)
          ? v
          : "steer") as PIVerdict["verdict"],
        assessment: params.assessment,
        issues: params.issues ?? [],
        instructions: params.instructions ?? "",
        estimates: Array.isArray(params.estimates) ? params.estimates : undefined,
        discriminators: Array.isArray(params.discriminators) ? params.discriminators : undefined,
        discloseOk: Array.isArray(params.disclose_ok) ? params.disclose_ok.filter((s) => typeof s === "string") : undefined,
      };
      return {
        content: [{ type: "text" as const, text: "Verdict recorded." }],
        details: {},
      };
    },
  };

  // Visual review is delegated to the illustrator sub-agent (see reviewer.md).
  const fullStateText = stateText;

  const makeSpawnTool = createSpawnToolFactory(opts.projectDir, getApiKey);

  // Spawn PI agent via the centralized spawner. If it returns without calling
  // submit_verdict (transient model failure, ran out of turns, etc.), retry
  // once before treating the non-response as a signal.
  const spawnReviewer = () =>
    spawnAgent({
      name: "reviewer",
      templateVars: {},
      prompt: fullStateText,
      projectDir: opts.projectDir,
      getApiKey,
      toolOverrides: [verdictTool],
      contextExtra: { isSurvey, isPlanReview },
      parentAgentId: "brain",
      createSpawnTool: makeSpawnTool,
    });

  await spawnReviewer();
  if (result === null) await spawnReviewer();

  // A non-response must NOT silently pass as "continue" — that fail-open let
  // projects finish on a review that never happened (observed in 5/70 runs).
  // BUT that danger is specific to the FINISH/milestone gate. At the plan gate
  // (optional per design; downstream experiments are still independently
  // reviewed) a fail-closed "steer" on an infra non-completion deadlocks the
  // pipeline: a re-run hits the same failure (e.g. dual-profile pins the
  // reviewer to Anthropic while the producer profile still runs, so an
  // exhausted Anthropic balance fails every reviewer spawn) and brain can never
  // dispatch experiments. Branch: plan review proceeds with an honest
  // non-approval note; every other gate keeps the fail-closed steer.
  if (result) {
    // Claims-first §3.5: a stop without the PI's own estimate on every headline
    // quantity is downgraded to steer (fail-closed, never a deadlock).
    let final: PIVerdict = result;
    try {
      const table = buildClaimTable(opts.projectDir);
      if (table.declared) {
        const rule = piEstimateRule(final.verdict, final.estimates, obligationScope(table), final.discriminators);
        if (rule.issue) final = { ...final, verdict: rule.verdict, issues: [...final.issues, rule.issue] };
      }
    } catch (err) {
      // Never silent: a verdict that could not be checked against the claim
      // table says so in its own issues list.
      final = { ...final, issues: [...final.issues, `claim table could not be built for this review: ${(err as Error).message.slice(0, 100)}`] };
    }
    return final;
  }
  if (isPlanReview) {
    return {
      verdict: "continue",
      placeholder: true,
      assessment:
        "⚠️ PI plan-review did NOT complete: the reviewer produced no structured verdict after a retry " +
        "(typically a transient/credit/infra failure — e.g. the Anthropic-pinned reviewer is unfunded while " +
        "the producer profile still runs). This is NOT an endorsement of the plan. The plan gate is optional and " +
        "downstream experiments are still independently reviewed, so proceed rather than deadlock.",
      issues: [],
      instructions:
        "Proceed with experiment dispatch. Record in your pushback/notes that the plan PI-review could not run; " +
        "rely on your own RESEARCH.md cross-check and the downstream experiment_reviewer gates. Do not represent " +
        "the plan as PI-approved. Optionally retry request_pi_review later if the infra recovers.",
    };
  }
  return {
    verdict: "steer",
    placeholder: true,
    assessment:
      "⚠️ PI review did NOT complete: the reviewer produced no structured verdict after a retry. " +
      "This is not an approval. Re-run request_pi_review before proceeding; if it recurs, the PI " +
      "agent is failing to call submit_verdict.",
    issues: [],
    instructions:
      "Re-run the PI review. Do not treat this non-response as a passing verdict.",
  };
}

// ---------------------------------------------------------------------------
// State snapshot for PI (clean context — no conversation history)
// ---------------------------------------------------------------------------

/**
 * H9: collect every active directive for PI's audit. Same source ordering as
 * context.ts:collectActiveDirectives — runtime --directive first, then the
 * union of `notes/directives/*.md`. Kept private to pi-agent.ts to avoid a
 * circular dep with context.ts (which also has its own copy).
 */
const PI_MAX_DIRECTIVES = 6;
const PI_MAX_DIRECTIVE_BYTES = 3000;
function collectPIDirectives(
  projectDir: string,
  runtimeDirective: string | undefined,
): Array<{ source?: string; text: string }> {
  const out: Array<{ source?: string; text: string }> = [];
  if (runtimeDirective && runtimeDirective.trim()) {
    out.push({ source: "current --directive", text: runtimeDirective.trim().slice(0, PI_MAX_DIRECTIVE_BYTES) });
  }
  const dir = join(projectDir, "notes", "directives");
  if (existsSync(dir)) {
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort().reverse(); }
    catch { /* unreadable */ }
    for (const name of names) {
      if (out.length >= PI_MAX_DIRECTIVES) break;
      try {
        const raw = readFileSafe(join(dir, name)) ?? "";
        const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
        if (!body) continue;
        if (runtimeDirective && body === runtimeDirective.trim()) continue;
        out.push({ source: name.replace(/\.md$/, ""), text: body.slice(0, PI_MAX_DIRECTIVE_BYTES) });
      } catch { /* skip */ }
    }
  }
  return out;
}

function buildStateForPI(
  projectDir: string,
  toolCallCount?: number,
  milestoneInfo?: { milestone: string; questions?: string },
  reviewCount?: number,
  userDirective?: string,
): string {
  const parts: string[] = [];

  // Fix γ + H9: surface ALL active directives ABOVE the milestone so PI
  // audits the user's actual requirements, not just brain's framing of "what
  // I claim to have addressed." Sources: runtime --directive (transient) +
  // persisted notes/directives/*.md (H9 survives across resumes).
  // Fix H1: every clause needs an explicit per-item walk, not holistic
  // gestalt — PI's default-rubber-stamp behavior is the documented failure.
  const directives = collectPIDirectives(projectDir, userDirective);
  if (directives.length > 0) {
    parts.push(
      `# ⚠️ Active User Directive(s) — verify per-clause in artifacts\n\n` +
      directives.map((d, i) =>
        `**Directive ${i + 1}${d.source ? ` (${d.source})` : ""}:**\n` +
        `> ${d.text.replace(/\n/g, "\n> ")}`
      ).join("\n\n") +
      `\n\n**Your audit protocol (mandatory, not optional):**\n\n` +
      `1. **Enumerate every concrete clause / item in each directive above.** Bullets, ` +
      `numbers, "all N X", "every Y", named entities — write them out as a checklist ` +
      `in your assessment.\n` +
      `2. **For EACH clause, grep the artifacts for evidence:**\n` +
      `   - \`report/report.tex\` — does the section / table / paragraph for this clause exist?\n` +
      `   - \`data/experiments/E*/runs/run_*/results.json\` — if the clause demands simulation / ` +
      `experiment / verification, is there a corresponding non-trivial results.json (≥1 KB, ` +
      `containing fidelity/trajectories/measurements — NOT \`{"status":"excluded"}\`)?\n` +
      `   - \`notes/literature.md\` — if the directive says "don't blandly trust papers", ` +
      `did brain re-derive the claimed exclusions, or did it cite paper values as primary evidence?\n` +
      `3. **List per-clause status in your \`issues\`:** ✅ verified-by-artifact / 📝 narrated-only ` +
      `(prose in report, no underlying experiment) / 📐 analytical-exclusion (cited paper or ` +
      `derived; flag whether user's "don't blandly trust papers" tolerance allows this) / ` +
      `❌ absent.\n` +
      `4. **If any clause is 📝/❌, or if 📐 conflicts with the directive's "verify by simulation" ` +
      `language, return STEER with the specific failed clause quoted.** Brain's narrative ` +
      `framing in the milestone is NOT evidence — only the per-clause artifact walk is.\n`
    );
  }

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

  // Resource usage (review count only — cost/time intentionally omitted so PI judges on quality)
  if (reviewCount !== undefined) {
    parts.push(`# Resource Usage\n- Review count: ${reviewCount} (this is review #${reviewCount})`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Format PI feedback for pi_feedback.md
// ---------------------------------------------------------------------------

/**
 * Append-only persistence for PI feedback. Overwriting destroyed prior
 * rounds' instructions mid-run (observed: a ">=3 ramp shapes" instruction
 * silently vanished and the report shipped without it). Append keeps the
 * full instruction history auditable; parseLatestPIVerdict takes the LAST
 * verdict match so gate semantics are unchanged, and the context snapshot
 * truncates from the head so the newest reviews stay visible.
 */
function appendPIFeedback(path: string, section: string): void {
  const sep = existsSync(path) ? "\n\n---\n\n" : "";
  appendFileSync(path, sep + section);
}

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

  // Claims-first §3.5: ESTIMATE / DISCRIMINATOR lines, parsed by claims-table.ts
  // from this file (reviews/pi_feedback.md is in its read set).
  const claimLines = formatPIEstimateLines(verdict.estimates, verdict.discriminators);
  for (const id of verdict.discloseOk ?? []) if (/^[A-Za-z0-9_]+$/.test(id)) claimLines.push(`DISCLOSE-OK: ${id}`);
  if (claimLines.length > 0) lines.push("", "## Claim estimates", ...claimLines);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...(truncated)";
}
