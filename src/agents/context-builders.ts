/**
 * Context builders — named functions that generate dynamic context
 * appended to an agent's system prompt at spawn time.
 */

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSafe, smartTruncate, listFilesRecursive, ORIGINAL_REQUEST_HEADER } from "../utils.js";
import { loadRegistry, type ActiveAgent } from "../active-agents.js";

export type ContextBuilder = (projectDir: string, extra?: Record<string, any>) => string;

// ── Shared script loading ────────────────────────────
//
// Both buildExperimentContext and buildPIContext expose the project's
// simulation scripts to the agent. They share the same "list + read + count
// lines" core; only the envelope and the full-inline policy differ.

const SCRIPT_EXTENSIONS = /\.(py|jl|m|sh|ts|js|R)$/;

interface ScriptFile { relPath: string; content: string; lines: number; }

function collectScripts(projectDir: string, opts: { maxFiles?: number } = {}): ScriptFile[] {
  const scriptsDir = join(projectDir, "data", "scripts");
  const all = listFilesRecursive(scriptsDir)
    .filter(f => SCRIPT_EXTENSIONS.test(f))
    .sort();
  const selected = opts.maxFiles ? all.slice(0, opts.maxFiles) : all;
  const result: ScriptFile[] = [];
  for (const full of selected) {
    try {
      const content = readFileSync(full, "utf-8");
      result.push({
        relPath: full.replace(projectDir + "/", ""),
        content,
        lines: content.split("\n").length,
      });
    } catch {}
  }
  return result;
}

function renderScriptPreview(entry: ScriptFile, previewLines: number): string {
  const lines = entry.content.split("\n");
  const preview = lines.slice(0, previewLines).join("\n");
  const suffix = lines.length > previewLines
    ? `\n... (${lines.length - previewLines} more lines — use read tool for full file)`
    : "";
  return preview + suffix;
}

const CONTEXT_BUILDERS: Record<string, ContextBuilder> = {
  brain: buildBrainContext,
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
  const scripts = collectScripts(projectDir, { maxFiles: 12 });
  if (scripts.length > 0) {
    parts.push("<existing_scripts>");
    for (const s of scripts) {
      parts.push(`<script path="${s.relPath}" lines="${s.lines}">\n${renderScriptPreview(s, 60)}\n</script>`);
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

  // 8. Prior design/*.md artifacts (committed specs from earlier experiment
  //    sessions). Surfaces so repeated spawns don't re-enumerate alternatives.
  const designFiles = listFilesRecursive(join(projectDir, "design"))
    .filter(f => f.endsWith(".md"))
    .sort();
  if (designFiles.length > 0) {
    parts.push("<design_artifacts readonly=\"true\">");
    parts.push("Prior engineering decisions committed in design/*.md by earlier sessions. Read them before enumerating alternatives or picking parameters — do NOT re-derive already-committed specs. Use the read tool for the full file when a preview below is relevant.");
    for (const full of designFiles) {
      try {
        const content = readFileSync(full, "utf-8");
        const entry: ScriptFile = {
          relPath: full.replace(projectDir + "/", ""),
          content,
          lines: content.split("\n").length,
        };
        parts.push(`<design_file path="${entry.relPath}" lines="${entry.lines}">\n${renderScriptPreview(entry, 40)}\n</design_file>`);
      } catch {}
    }
    parts.push("</design_artifacts>");
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

// Brain's Layer 3 — execution-state snapshot mutated on sub-agent harvest
// or notes/plan.md edit. Must stay deterministic over equal state: any
// timestamp or counter baked into the output would defeat the equality
// short-circuit in rebuildLayer3IfChanged and force a cache miss per rebuild.
function buildBrainContext(projectDir: string, _extra?: Record<string, any>): string {
  const agentDir = join(projectDir, ".agent");
  const registry = loadRegistry(agentDir);
  const running = registry.filter((a) => a.status === "running");

  // NOTE: no timestamp or other turn-varying content embedded here — any
  // per-call delta would poison rebuildLayer3IfChanged's equality short-circuit
  // and force an Anthropic re-encode on every trigger. Rebuild events are
  // traced via bus.emit(layer3_rebuilt).
  return [
    renderActiveAgents(running),
    renderCompletedArtifacts(projectDir),
    renderPlanStatus(projectDir),
  ].filter((s) => s.length > 0).join("\n\n");
}

function renderActiveAgents(running: ActiveAgent[]): string {
  if (running.length === 0) {
    return `<active_agents count="0">\nNo sub-agents currently running. Safe to spawn.\n</active_agents>`;
  }

  // startedAt NOT rendered — it bakes current time into the string and would
  // invalidate rebuildLayer3IfChanged's equality check on every call. Use
  // spawn_agent(action="status", id=...) if wall-clock progress is needed.
  const rows = running.map((a) => {
    const taskTrunc = a.task.length > 200 ? a.task.slice(0, 200) + "…" : a.task;
    const expected = a.expected_artifact ? a.expected_artifact : "(not declared)";
    return `- ${a.id} [${a.name}, ${a.mode}]\n    Task: ${taskTrunc}\n    Expected artifact: ${expected}`;
  });

  return `<active_agents count="${running.length}">\nBefore spawning a new sub-agent, check this list. Do NOT re-spawn an agent whose expected artifact matches one here.\n\n${rows.join("\n")}\n</active_agents>`;
}

function renderCompletedArtifacts(projectDir: string): string {
  const roots = ["design", "data/runs", "circuits", "report/figures"];
  const collected: { rel: string; size: number; mtime: number }[] = [];

  for (const root of roots) {
    for (const f of listFilesRecursive(join(projectDir, root))) {
      try {
        const st = statSync(f);
        collected.push({
          rel: f.replace(projectDir + "/", ""),
          size: st.size,
          mtime: st.mtimeMs,
        });
      } catch {}
    }
  }

  if (collected.length === 0) {
    return `<completed_artifacts count="0">\nNo artifacts on disk yet.\n</completed_artifacts>`;
  }

  collected.sort((a, b) => b.mtime - a.mtime);
  const MAX = 80;
  const shown = collected.slice(0, MAX);
  const more = collected.length > MAX ? `\n... (${collected.length - MAX} more files, use bash/ls to enumerate)` : "";
  const rows = shown.map((a) => `- ${a.rel} (${(a.size / 1024).toFixed(1)} KB)`);

  return `<completed_artifacts count="${collected.length}">\nFiles produced on disk. If an expected spawn artifact matches one here, read the existing file before re-spawning.\n\n${rows.join("\n")}${more}\n</completed_artifacts>`;
}

function renderPlanStatus(projectDir: string): string {
  const planPath = join(projectDir, "notes", "plan.md");
  const raw = readFileSafe(planPath);
  if (!raw || raw.trim().length === 0) {
    return `<plan_status>\nnotes/plan.md does not exist yet.\n</plan_status>`;
  }

  // Heuristic: count L2 sub-question headers (### Q or ### C or similar markers)
  // and artifact path mentions to estimate completion.
  const subqMatches = raw.match(/^\s*-?\s*\*\*Q[0-9]+[a-z]?.*?\*\*/gm) || [];
  const artifactMatches = raw.match(/→\s*[`"]?[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+/g) || [];

  const hash = createHash("md5").update(raw).digest("hex").slice(0, 8);
  const lines = raw.split("\n").length;

  // Extract PI feedback status marker if present
  const piVerdictMatch = raw.match(/PI\s+verdict[:\s]+(continue|steer|stop)/i);
  const piVerdict = piVerdictMatch ? piVerdictMatch[1].toLowerCase() : "unknown";

  return `<plan_status hash="${hash}" lines="${lines}">\nnotes/plan.md snapshot: ${subqMatches.length} Q-style sub-questions, ${artifactMatches.length} artifact paths mentioned.\nLast PI verdict parsed from plan.md: ${piVerdict}.\nUse read tool for full plan — this block shows only summary counts for quick reference.\n</plan_status>`;
}

// ── PI context (extracted from pi-agent.ts) ──

function buildPIContext(projectDir: string, extra?: Record<string, any>): string {
  const isSurvey = extra?.isSurvey ?? false;
  const isPlanReview = extra?.isPlanReview ?? false;
  const isFigureOnly = extra?.isFigureOnly ?? false;

  const parts: string[] = [];

  // Figure-only mode (luxas figures CLI): inject PI_FIGURE_MODE, skip normal sections.
  if (isFigureOnly) {
    parts.push(PI_FIGURE_MODE);
    const styleDomain = extra?.styleDomain;
    if (typeof styleDomain === "string" && styleDomain.length > 0) {
      parts.push(
        `<style_domain_override>The user passed --style-domain ${styleDomain} via the CLI. Skip P0 auto-detection: write "${styleDomain}" to notes/figure_domain.txt and proceed.</style_domain_override>`,
      );
    }
    parts.push(buildFigureConvergenceBlock(projectDir));
    return parts.join("\n\n");
  }

  if (isPlanReview) {
    parts.push(PI_PLAN_MODE);
  }
  parts.push(isSurvey ? PI_SURVEY_MODE : PI_RESEARCH_MODE);

  // Classify RESEARCH.md format once, up-front. Post-2026-04 projects are
  // verbatim-only (brain owns scope derivation); a legacy layer of projects
  // had an opus-synthesized plan appended below the verbatim block. Emitting
  // an explicit signal means the PI prompt doesn't have to parse a conditional
  // "if section present / else" sentence at inference time.
  const researchMd = readFileSafe(join(projectDir, "RESEARCH.md"));
  const userRequestLocator = researchMd.includes(ORIGINAL_REQUEST_HEADER)
    ? `the "${ORIGINAL_REQUEST_HEADER}" section of RESEARCH.md (the verbatim user input — this is the ground-truth ask; any plan.md derivation below is brain's, not the user's)`
    : `the entire RESEARCH.md file (this is a legacy project with no dedicated verbatim section)`;
  parts.push(`<user_request_locator>${userRequestLocator}</user_request_locator>`);

  // Field methodology standard — auto-extracted from downloaded literature by
  // the reader agent. Lets the PI compare the project's actual work against
  // what standard papers in the field do, instead of judging only by report
  // completeness.
  const method = readFileSafe(join(projectDir, "notes", "methodology.md"));
  if (method && method.trim().length > 40) {
    parts.push(`<field_methodology_standard>
This was extracted from the papers the project has downloaded into
data/papers/. Treat it as a REVIEW BASELINE for judging methodology rigor —
BUT subordinate to the user's original request (see \`<user_request_locator>\`
above). When the PI-synthesized plan disagrees with the user's request, the
request wins. If the user's request is specific and concrete, the project
only has to answer THAT question well; the field standard below is advisory,
and you flag gaps only when they undermine the user's own ask. If the user's
request is open-ended (design / feasibility / investigate without a narrow
target), the field standard is load-bearing — the agent is implicitly on the
hook for what competent work in the field looks like, and you should call
out methodology gaps even when the written report looks complete.
${smartTruncate(method, 4000)}
</field_methodology_standard>`);
  }

  // Full project code assembly — the report-surface view alone is not enough
  // to catch methodology shortcuts. Read the actual simulation scripts and
  // cross-check against the rigor bar from <field_methodology_standard>.
  const codeBlock = buildProjectCodeBlock(projectDir);
  if (codeBlock) parts.push(codeBlock);

  parts.push(buildFigureConvergenceBlock(projectDir));

  return parts.join("\n\n");
}

// ── Figure convergence check ─────────────────────────
// Short-circuits the reviewer's figure_finalize_loop when every file listed
// in reviews/illustrator_notes.md frontmatter still hashes to the recorded
// value — avoids re-auditing figures that already converged in a prior
// reviewer session. See <figure_finalize_loop> Step 0 in reviewer.md.

function md5OrNull(fullPath: string): string | null {
  try {
    return createHash("md5").update(readFileSync(fullPath)).digest("hex");
  } catch {
    return null;
  }
}

interface Frontmatter {
  status?: string;
  audited_at?: string;
  style_guide_md5?: string;
  canonical_figures?: Record<string, string>;
  plot_scripts?: Record<string, string>;
}

// Fixed-schema parser (js-yaml is not a dep). Tolerates tabs/CRLF; indented
// entries under `canonical_figures:` / `plot_scripts:` go into the
// corresponding map, everything else is a top-level scalar.
function parseFrontmatter(block: string): Frontmatter {
  const out: Frontmatter = {};
  let section: "canonical_figures" | "plot_scripts" | null = null;
  for (const raw of block.replace(/\r/g, "").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indented = /^[\t ]/.test(raw);
    if (!indented) {
      section = null;
      const m = raw.match(/^(\w+)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === "canonical_figures" || key === "plot_scripts") {
        section = key;
        out[key] = {};
      } else if (value && (key === "status" || key === "audited_at" || key === "style_guide_md5")) {
        out[key] = value.trim().replace(/^["']|["']$/g, "");
      }
    } else if (section) {
      const m = raw.match(/^[\t ]+(.+?)\s*:\s*(.+)$/);
      if (m) out[section]![m[1].trim()] = m[2].trim();
    }
  }
  return out;
}

function buildFigureConvergenceBlock(projectDir: string): string {
  const notesPath = join(projectDir, "reviews", "illustrator_notes.md");
  const raw = readFileSafe(notesPath);
  if (!raw) return `<figure_convergence>none</figure_convergence>`;

  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return `<figure_convergence>none</figure_convergence>`;

  const fm = parseFrontmatter(m[1]);
  if (fm.status !== "all-clear") {
    return `<figure_convergence>stale reason="prior-audit-had-issues"</figure_convergence>`;
  }

  const drift: string[] = [];
  const check = (rel: string, expected: string) => {
    const cur = md5OrNull(join(projectDir, rel));
    if (cur === null) drift.push(`${rel}: missing`);
    else if (cur !== expected) drift.push(`${rel}: changed`);
  };
  if (fm.style_guide_md5) check("report/figures/style_guide.md", fm.style_guide_md5);
  for (const [rel, h] of Object.entries(fm.canonical_figures ?? {})) check(rel, h);
  for (const [rel, h] of Object.entries(fm.plot_scripts ?? {})) check(rel, h);

  if (drift.length === 0) {
    return `<figure_convergence>converged audited_at="${fm.audited_at ?? "unknown"}"</figure_convergence>`;
  }
  return `<figure_convergence>stale reason="${drift.join("; ")}"</figure_convergence>`;
}

// Full-inline budget for PI code assembly. Opus (1M ctx) comfortably holds
// ~400 KB of source alongside the rest of the snapshot; realistic projects
// have a few hundred KB of scripts total. Below this, PI sees every line —
// that's the whole point of the layering fix. Above, per-file preview.
const PI_CODE_FULL_INLINE_BUDGET = 400_000;
const PI_CODE_PREVIEW_LINES = 60;

function buildProjectCodeBlock(projectDir: string): string | null {
  const entries = collectScripts(projectDir);
  if (entries.length === 0) return null;

  const totalChars = entries.reduce((n, e) => n + e.content.length, 0);
  const full = totalChars <= PI_CODE_FULL_INLINE_BUDGET;
  const mode = full ? "full" : "preview";

  const blocks = entries.map(e => {
    const body = full ? e.content : renderScriptPreview(e, PI_CODE_PREVIEW_LINES);
    return `=== ${e.relPath} (${e.lines} lines) ===\n${body}`;
  });

  return `<project_code mode="${mode}" files="${entries.length}" total_chars="${totalChars}">
The actual simulation / experiment code the project produced. Check this
against <field_methodology_standard>. Common methodology tells worth flagging:

- Comments like "phenomenological", "simplified model", "TODO proper" that
  disagree with how the report frames the work
- Different noise models / sample counts between baseline and treatment (not a
  fair comparison)
- Hardcoded error rates or shot counts well below the field's rigor bar
- Missing key demonstrations that the field considers standard

${blocks.join("\n\n")}
</project_code>`;
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
- **Methodology gap check** (user-request-gated): The ground-truth deliverable is at \`<user_request_locator>\` above — read it first. If the user's request is specific and concrete, judge the work primarily against THAT request — the \`<field_methodology_standard>\` block is advisory and you only flag a gap if it undermines the user's own ask. If the user's request is open-ended (design / feasibility / investigate without a narrow target), treat the field standard as load-bearing: open \`<project_code>\` and the experiment notes, and check whether what the code *actually does* matches what the report *claims it does* and what the field standard *expects*. The failure mode to catch is: a methodologically weaker implementation dressed in a complete-looking report — e.g. the report's terminology is stronger than the code's actual behavior, or a baseline and a treatment are compared under asymmetric assumptions, or a demonstration that the field treats as standard is absent entirely. Derive the specifics from \`<field_methodology_standard>\` yourself; do not rely on pre-supplied examples.

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

const PI_FIGURE_MODE = `
<figure_only_pass>
You are in **figure-only mode** (triggered by \`luxas figures\` CLI).

Three imperatives — they override everything else in your system prompt:
1. DO NOT review content, methodology, or the report text.
2. DO NOT call \`submit_verdict\` (that's the normal-mode tool).
3. DO NOT view figure images yourself — delegate to illustrator sub-agents.

Execute the procedure in \`<figure_finalize_loop>\` below. When it exits
(Summary all-clear OR 3-round cap reached), you MUST call the tool
\`figure_done(rounds, remaining_issues, summary)\` as your final action.
This is the figure-only equivalent of \`submit_verdict\` — without it the
process will not terminate.
</figure_only_pass>`;
