/**
 * Context builders — named functions that generate dynamic context
 * appended to an agent's system prompt at spawn time.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSafe, smartTruncate, listFilesRecursive } from "../utils.js";

export type ContextBuilder = (projectDir: string, extra?: Record<string, any>) => string;

const CONTEXT_BUILDERS: Record<string, ContextBuilder> = {
  experiment: buildExperimentContext,
  reviewer: buildPIContext,
};

export function resolveContextBuilder(name: string | undefined): ContextBuilder | undefined {
  if (!name) return undefined;
  return CONTEXT_BUILDERS[name];
}

export function registerContextBuilder(name: string, builder: ContextBuilder): void {
  CONTEXT_BUILDERS[name] = builder;
}

// ── Experiment context (extracted from experiment.ts) ──

function buildExperimentContext(projectDir: string): string {
  const parts: string[] = [];

  // 1. Project file tree
  const allFiles = listFilesRecursive(projectDir)
    .map(f => f.replace(projectDir + "/", ""))
    .filter(f => !f.startsWith(".agent/") && !f.includes("node_modules"));
  parts.push(`<project_structure>\n${allFiles.join("\n")}\nYou can read any of these files with the read tool.\n</project_structure>`);

  // 2. RESEARCH.md
  const researchMd = readFileSafe(join(projectDir, "RESEARCH.md"));
  if (researchMd) {
    parts.push(`<research_goal readonly="true">\n${smartTruncate(researchMd, 2000)}\n</research_goal>`);
  }

  // 3. Experiment notes
  const expNotes = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (expNotes && expNotes.trim().length > 20) {
    parts.push(`<experiment_notes readonly="true">\n${smartTruncate(expNotes, 3000)}\n</experiment_notes>`);
  }

  // 4. Literature notes
  const litNotes = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (litNotes && litNotes.trim().length > 20) {
    parts.push(`<literature_notes readonly="true">\n${smartTruncate(litNotes, 2000)}\n</literature_notes>`);
  }

  // 5. Agent memory
  const memory = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (memory && memory.trim().length > 20) {
    parts.push(`<agent_memory readonly="true">\n${smartTruncate(memory, 1500)}\n</agent_memory>`);
  }

  // 6. Existing scripts with content preview
  const scriptsDir = join(projectDir, "data", "scripts");
  const scripts = listFilesRecursive(scriptsDir)
    .filter(f => /\.(py|jl|m|sh|ts|js)$/.test(f))
    .slice(0, 12);

  if (scripts.length > 0) {
    parts.push("<existing_scripts>");
    for (const script of scripts) {
      const relPath = script.replace(projectDir + "/", "");
      try {
        const content = readFileSync(script, "utf-8");
        const lines = content.split("\n");
        const preview = lines.slice(0, 60).join("\n");
        const suffix = lines.length > 60 ? `\n... (${lines.length} total lines — use read tool for full file)` : "";
        parts.push(`<script path="${relPath}" lines="${lines.length}">\n${preview}${suffix}\n</script>`);
      } catch {
        parts.push(`<script path="${relPath}">use read tool to view</script>`);
      }
    }
    parts.push("</existing_scripts>");
  }

  // 7. Report structure preview
  const reportTex = readFileSafe(join(projectDir, "report", "report.tex"));
  if (reportTex) {
    const sections = reportTex.split("\n")
      .filter(l => /\\section|\\subsection|\\subsubsection/.test(l))
      .map(l => l.trim());
    if (sections.length > 0) {
      parts.push(`<report_structure readonly="true">\n${sections.join("\n")}\nUse read tool for full content.\n</report_structure>`);
    }
  }

  if (parts.length === 0) return "";

  return [
    ...parts,
    ``,
    `<code_consistency>`,
    `1. REVIEW existing scripts before writing new code. Reuse correct code, fix incorrect code.`,
    `2. In your output, include a "Consistency Check" section listing which scripts you reviewed and whether they were correct.`,
    `</code_consistency>`,
  ].join("\n");
}

// ── PI context (extracted from pi-agent.ts) ──

function buildPIContext(projectDir: string, extra?: Record<string, any>): string {
  const isSurvey = extra?.isSurvey ?? false;
  const isPlanReview = extra?.isPlanReview ?? false;

  const parts: string[] = [];

  if (isPlanReview) {
    parts.push(PI_PLAN_MODE);
  }
  parts.push(isSurvey ? PI_SURVEY_MODE : PI_RESEARCH_MODE);

  return parts.join("\n");
}

// PI mode blocks (moved from pi-agent.ts)

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

Don't enumerate these as a checklist. React naturally.

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

If the work is technically correct but intellectually shallow, say so directly.
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
