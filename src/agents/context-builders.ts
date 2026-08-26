/**
 * Context builders — named functions that generate dynamic context
 * appended to an agent's system prompt at spawn time.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { buildClaimRegistry, renderClaimRegistry } from "../claims-registry.js";
import { readCareerStandards } from "../career.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  readFileSafe, smartTruncate, listFilesRecursive, ORIGINAL_REQUEST_HEADER,
  md5OrNull, parseAuditFrontmatter, extractFrontmatterBlock,
} from "../utils.js";
import { loadRegistry, type ActiveAgent } from "../active-agents.js";
import { parseCompileVerdict } from "../tools/report.js";
import { buildClaimTable, renderClaimTable } from "../claims-table.js";

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
  typesetter: buildTypesetterContext,
  report_writer: buildReportWriterContext,
  tool_impl: buildToolImplContext,
};

// ── Compute-methods registry injection (2026-07-13, debate-adjudicated) ──
//
// Experiment/tool_impl agents abandon field-standard tools over first-use
// friction (canonical: pairinteraction rejected as "requires manual database
// download" when the fix was the species string 'Yb174_mqdt'). Sheets in
// skills/compute-methods/ carry environment-verified frictions + smoke
// tests; this builder is their named consumer edge. Passive injection —
// zero marginal agent action, survives deadline pressure, fails toward the
// status quo when no sheet matches.
//
// Matching: frontmatter `match:` keywords (comma-separated, substring,
// case-insensitive) counted against RESEARCH.md + literature head + the
// spawn task (via contextExtra.task when available); ranked by hit count,
// filename as tiebreaker. Per adversarial review: NO alphabetical-first-two
// cap (a QEC-on-neutral-atom project must not shadow the rydberg sheet),
// per-sheet try/catch (a malformed sheet degrades to an index line, never
// crashes spawns), UNVERIFIED/STALE banners keyed off `verified:` dates so
// a rotten registry demotes itself instead of inverting trust.
const STALE_MS = 90 * 24 * 3600 * 1000;

interface MethodSheet { file: string; body: string; hits: number; banner: string }

function loadMethodSheets(projectDir: string, probe: string): MethodSheet[] {
  // skills/ lives in the Luxas repo, not the project; resolve relative to
  // this module (same convention as other skill consumers).
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "compute-methods");
  let files: string[] = [];
  try { files = readdirSync(skillsDir).filter((f) => f.endsWith(".md") && f !== "SKILL.md"); } catch { return []; }
  const probeLower = probe.toLowerCase();
  const out: MethodSheet[] = [];
  for (const f of files.sort()) {
    try {
      const raw = readFileSync(join(skillsDir, f), "utf-8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const matchLine = fm[1].match(/^match:\s*(.+)$/m);
      if (!matchLine) continue;
      const keywords = matchLine[1].split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
      const hits = keywords.filter((k) => probeLower.includes(k)).length;
      if (hits === 0) continue;
      const verified = fm[1].match(/^verified:\s*(\d{4}-\d{2}-\d{2})/m);
      let banner = "";
      if (!verified) {
        banner = "UNVERIFIED — hypotheses from docs, not tested in this environment. Treat as leads, not ground truth.";
      } else if (Date.now() - new Date(verified[1]).getTime() > STALE_MS) {
        banner = `STALE (verified ${verified[1]}) — versions may have moved; treat frictions as hints and re-run the smoke test.`;
      }
      out.push({ file: f, body: raw.slice(fm[0].length).trim(), hits, banner });
    } catch { /* malformed sheet — skip, never crash a spawn */ }
  }
  return out.sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file));
}

function buildMethodsRegistry(projectDir: string, extra: Record<string, any> | undefined, topN: number): string {
  const probeParts = [
    readFileSafe(join(projectDir, "RESEARCH.md")),
    readFileSafe(join(projectDir, "notes", "literature.md")).slice(0, 4000),
    String(extra?.task ?? ""),
  ];
  const sheets = loadMethodSheets(projectDir, probeParts.join("\n"));
  if (sheets.length === 0) return "";
  const shown = sheets.slice(0, topN);
  const rest = sheets.slice(topN).map((s) => s.file).join(", ");
  const blocks = shown.map((s) => {
    const head = s.banner ? `[${s.banner}]\n` : "";
    return `--- ${s.file} ---\n${head}${s.body}`;
  });
  return `<methods_registry>
Field-standard tools and their environment-verified first-use frictions for
this project's domain. A friction listed here is a usage bug with a known
fix, not a tool failure — do not abandon the tool for a listed friction.
Run the sheet's smoke test before concluding a tool is unusable.
${blocks.join("\n\n")}${rest ? `\n\n(other sheets, not matched as strongly: ${rest})` : ""}
</methods_registry>`;
}

// tool_impl gets ONLY the registry (top-1 sheet): it is the agent that picks
// the library, it is read-blocked outside its experiment dir (so "read on
// demand" cannot work), and it runs on the cheapest model tier.
function buildToolImplContext(projectDir: string, extra?: Record<string, any>): string {
  return buildMethodsRegistry(projectDir, extra, 1);
}

// ── Report-writer context (2026-07-12, SLM-incident debate) ──
//
// The report-synthesis turn is the mirror image of the ledger_writer turn:
// recorded knowledge becomes public claims, executed (pre-fix) by the brain
// at its most compaction-degraded moment. Observed failure: a ledger-rejected
// branch (computed into results.json as a conservative bound) was recalled
// from compacted memory and headlined. The fix is mechanical injection of the
// ENDORSEMENT layer at spawn time — full ledger + outline + PI feedback —
// and deliberate OMISSION of raw results.json: the raw store contains
// rejected/intermediate leaves, which is exactly the poison. Numbers reach
// the writer only through the ledger the ledger_writer curated.
function buildReportWriterContext(projectDir: string): string {
  const parts: string[] = [];
  const inject = (label: string, relPath: string, cap = 60_000) => {
    const raw = readFileSafe(join(projectDir, relPath));
    if (!raw) return;
    parts.push(`<${label} path="${relPath}">\n${smartTruncate(raw, cap)}\n</${label}>`);
  };
  inject("ledger", "notes/experiments.md");
  // The claim registry: the ONLY legal claim_key spellings, computed fresh
  // from results.json (never persisted, so never stale). The writer PICKS
  // keys from here; key invention is what produced 0/18 claims matching
  // their executed cross-validations. Write-time validation enforces it;
  // this injection is what makes compliance possible rather than punitive.
  {
    const reg = renderClaimRegistry(buildClaimRegistry(projectDir));
    if (reg) parts.push(reg);
  }
  // Claim status (claims-first §3.4 render caps): what the abstract may carry.
  try {
    const rendered = renderClaimTable(buildClaimTable(projectDir));
    if (rendered) parts.push(rendered + "\nRender caps: CORROBORATED may headline unhedged; CONVERGING / INDICATIVE only with a one-clause hedge naming σ and regime; DISPUTED and CONDITIONAL may not appear in the abstract or conclusion; DISCLOSED only with its countersigned hedge sentence.");
  } catch { /* legacy project */ }
  inject("outline", "notes/report_outline.md", 20_000);
  inject("pi_feedback", "reviews/pi_feedback.md", 20_000);
  // Literature: an INDEX of every entry, never a silent truncation. Real
  // literature.md files run 81-196KB against the old 40KB cap, and
  // smartTruncate kept the alphabetical tail — on single_photon_Rydberg the
  // writer saw at most half the corpus while <citation_keys> still listed
  // every key, so it could cite entries it never read. Cite-without-read is
  // how a prior's result gets claimed without positioning. The index carries
  // each entry's Core claim / Located results / Bears on this project lines
  // (the compact, load-bearing fields); the writer reads any full fragment
  // on demand with the read tool.
  {
    const litDir = join(projectDir, "notes", "literature.d");
    let entries: string[] = [];
    try {
      entries = readdirSync(litDir).filter((f) => f.endsWith(".md")).sort();
    } catch { /* no fragments */ }
    if (entries.length > 0) {
      const index: string[] = [];
      for (const f of entries) {
        const body = readFileSafe(join(litDir, f));
        const key = f.replace(/\.md$/, "");
        const pick = (field: string): string => {
          const m = body.match(new RegExp(`- \\*\\*${field}\\*\\*:([\\s\\S]*?)(?=\\n- \\*\\*|$)`));
          return m ? m[1].trim() : "";
        };
        const core = pick("Core claim");
        const located = pick("Located results");
        const bears = pick("Bears on this project");
        index.push(`### ${key}\n- Core claim: ${core || "(none recorded)"}` +
          (located ? `\n- Located results:\n${located}` : "") +
          (bears ? `\n- Bears on this project: ${bears}` : ""));
      }
      parts.push(`<literature_index total_entries="${entries.length}">\n` +
        `Every literature entry, indexed. Before drafting any contribution sentence, read the FULL fragment ` +
        `(notes/literature.d/<key>.md) of every entry whose Located results or Bears-on line touches the claim — ` +
        `the index is for finding them, not a substitute for reading them.\n\n` +
        index.join("\n\n") + `\n</literature_index>`);
    } else {
      // Legacy projects without fragments: fall back to the merged file, but
      // say exactly what was dropped instead of losing it silently.
      const raw = readFileSafe(join(projectDir, "notes", "literature.md"));
      if (raw) {
        const cap = 40_000;
        const note = raw.length > cap
          ? `\n[TRUNCATED: showing ${cap} of ${raw.length} chars — entries may be missing from view. ` +
            `Read notes/literature.md (or per-entry files) before citing anything not visible here.]`
          : "";
        parts.push(`<literature_notes path="notes/literature.md">${note}\n${smartTruncate(raw, cap)}\n</literature_notes>`);
      }
    }
  }
  // Available figure files + citation keys — so the writer references only
  // what exists (same discipline brain.md imposes, delivered as facts).
  try {
    const figs = readdirSync(join(projectDir, "report", "figures"))
      .filter((f) => /\.(pdf|png)$/.test(f));
    if (figs.length > 0) parts.push(`<available_figures>\n${figs.join("\n")}\n</available_figures>`);
  } catch { /* none yet */ }
  try {
    const keys = readdirSync(join(projectDir, "notes", "literature.d"))
      .filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    if (keys.length > 0) parts.push(`<citation_keys>\n${keys.join("\n")}\n</citation_keys>`);
  } catch { /* none */ }
  return parts.join("\n\n");
}

export function resolveContextBuilder(name: string | undefined): ContextBuilder | undefined {
  if (!name) return undefined;
  return CONTEXT_BUILDERS[name];
}

export function registerContextBuilder(name: string, builder: ContextBuilder): void {
  CONTEXT_BUILDERS[name] = builder;
}

// ── Experiment context (extracted from experiment.ts) ──

function buildExperimentContext(projectDir: string, extra?: Record<string, any>): string {
  const parts: string[] = [];

  // 0. Compute-methods registry (top-2 sheets) — see buildMethodsRegistry.
  const registry = buildMethodsRegistry(projectDir, extra, 2);
  if (registry) parts.push(registry);

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

  // 3b. Claim status (claims-first §3.7): the project's quantity ids and
  //     their status. Reuse an existing id when you re-estimate a quantity —
  //     the estimate histories must join; a near-duplicate id is rejected at
  //     write time.
  try {
    const rendered = renderClaimTable(buildClaimTable(projectDir));
    if (rendered) parts.push(rendered + "\nReuse these ids in computed.quantities[] when your experiment estimates the same observable.");
  } catch (err) {
    parts.push(`<claim_status>\n- MALFORMED: ${(err as Error).message.slice(0, 120)}\n</claim_status>`);
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

// Brain's execution-state snapshot — emitted as part of the per-turn trailer
// (see context.ts). Must stay deterministic over equal state so when two
// consecutive turns happen to have identical active-agents + artifacts state,
// the trailer string is byte-identical and the Anthropic cache can hit.
function buildBrainContext(projectDir: string, _extra?: Record<string, any>): string {
  const agentDir = join(projectDir, ".agent");
  const registry = loadRegistry(agentDir);
  const running = registry.filter((a) => a.status === "running");

  // No timestamps or elapsed counters — a turn-varying delta poisons the
  // equal-state invariant and forces an Anthropic re-encode every turn.
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
  const roots = ["design", "data/experiments", "circuits", "report/figures"];
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

// ── Typesetter context ──
//
// Deterministic suspects from the engine log, injected at spawn time. The
// 2026-07-02 audit passed a page whose table overlapped the neighbouring
// column ("[N/A] No table") — an open-ended 10-item × 8-page checklist
// dilutes attention. The engine already measured every ≥20pt overflow;
// hand the auditor that list. Attention direction ONLY: the auditor
// confirms visual form, it does not adjudicate whether the defect exists
// (vision must never overrule the log — Kimi hallucinates [pass]).

function buildTypesetterContext(projectDir: string): string {
  const v = parseCompileVerdict(join(projectDir, "report"));
  if (v.logMissing) return "";
  const suspects: string[] = [];
  for (const h of [...v.overfull].sort((a, b) => b.pt - a.pt)) {
    suspects.push(`- ${h.file} line ${h.line} (${h.ctx}): ${h.pt.toFixed(1)}pt (~${(h.pt / 28.45).toFixed(1)} cm) of content extends past the column edge — find the page rendering this source region and record what it collides with`);
  }
  for (const s of v.stuck) {
    suspects.push(`- a float${s.line !== null ? ` near source line ${s.line}` : ""} could not be placed — look for a figure/table missing from the pages or dumped at the document end`);
  }
  if (suspects.length === 0) return "";
  return `<compile_log_suspects>
The LaTeX engine measured these defects in the compiled PDF — they are facts from the compile log, not hypotheses. Locate each one's visual form on the rendered pages and report it under the matching checklist item. Your audit does NOT adjudicate whether they exist: a page that "looks fine" means you have not found the right page yet.
${suspects.join("\n")}
</compile_log_suspects>`;
}

// ── PI context (extracted from pi-agent.ts) ──

function buildPIContext(projectDir: string, extra?: Record<string, any>): string {
  const isSurvey = extra?.isSurvey ?? false;
  const isPlanReview = extra?.isPlanReview ?? false;
  const isFigureOnly = extra?.isFigureOnly ?? false;

  const parts: string[] = [];

  // The user's standing standards — accumulated review dissatisfactions,
  // recorded as data (~/.sisyphus/career/standards.md). v1 of the 297nm
  // report passed every mechanical gate and this reviewer, and only the USER
  // called it insufficient; each such call lands here so the bar persists
  // across projects without a code change.
  {
    const std = readCareerStandards();
    if (std) parts.push(`<standing_standards binding="true">\n${std.slice(0, 2500)}\n</standing_standards>`);
  }

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
  // Claim status + the PI's own obligation (claims-first §3.5): a stop
  // verdict without an estimate per headline quantity is downgraded to steer.
  try {
    const table = buildClaimTable(projectDir);
    const rendered = renderClaimTable(table);
    if (rendered) {
      parts.push(rendered);
      parts.push(`<pi_claim_obligation>\nFor every headline quantity above ([H]), put YOUR OWN number on it before you judge: submit_verdict.estimates = [{quantity, value, sigma, route}] by a route the experiment did not use (a limit, a benchmark in a nearby regime rescaled, a napkin formula — run one read/grep-informed calculation, do not restate the producer's value). For any DISPUTED or CONDITIONAL headline row, also submit a discriminators[] line: "DISCRIMINATOR: <id> — if right: …; if wrong: …; computation: …" naming the computation that would settle it. A "stop" without estimates for every headline quantity is recorded as "steer".\n</pi_claim_obligation>`);
    }
  } catch { /* legacy project */ }

  const codeBlock = buildProjectCodeBlock(projectDir);
  if (codeBlock) parts.push(codeBlock);

  parts.push(buildFigureConvergenceBlock(projectDir));

  return parts.join("\n\n");
}

/**
 * Find the most-recently-written illustrator notes file. Each illustrator
 * spawn writes to reviews/illustrator_notes.{spawn_id}.md so concurrent runs
 * don't stomp each other (e.g. one bootstrap spawn + one regen spawn writing
 * to the same path → bootstrap wins, regen status is invisible). Returns
 * the absolute path to the latest, or the legacy single-file path if no
 * per-spawn files exist (older projects pre-namespacing fall back gracefully).
 */
function findLatestIllustratorNotes(projectDir: string): string {
  const dir = join(projectDir, "reviews");
  const legacy = join(dir, "illustrator_notes.md");
  try {
    const candidates = readdirSync(dir)
      .filter((n) => /^illustrator_notes\..+\.md$/.test(n))
      .map((n) => {
        const p = join(dir, n);
        return { p, mtime: statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length > 0) return candidates[0].p;
  } catch {}
  return legacy;
}

// ── Figure convergence check ─────────────────────────
// Short-circuits the reviewer's figure_finalize_loop when every file listed
// in reviews/illustrator_notes.md frontmatter still hashes to the recorded
// value — avoids re-auditing figures that already converged in a prior
// reviewer session. See <figure_finalize_loop> Step 0 in reviewer.md.

function buildFigureConvergenceBlock(projectDir: string): string {
  // Visual convergence covers TWO orthogonal audits:
  //   illustrator_notes.{spawn_id}.md — figure-internal (palette / axes / etc.)
  //                                     per-spawn so concurrent runs don't stomp
  //   typesetter_notes.md             — document-level layout (floats / overflow)
  // "converged" requires BOTH all-clear AND every recorded md5 still matches.
  // If typesetter audit is missing but report.pdf exists, the loop must run.
  const illustratorPath = findLatestIllustratorNotes(projectDir);
  const typesetterPath = join(projectDir, "reviews", "typesetter_notes.md");
  const reportPdfPath = join(projectDir, "report", "report.pdf");
  const reportPdfExists = existsSync(reportPdfPath);

  const illustratorRaw = readFileSafe(illustratorPath);
  const typesetterRaw = readFileSafe(typesetterPath);

  if (!illustratorRaw && (!reportPdfExists || !typesetterRaw)) {
    return `<figure_convergence>none</figure_convergence>`;
  }

  // Parse illustrator side
  let illustratorOK = false;
  let illustratorAt = "unknown";
  const drift: string[] = [];
  if (illustratorRaw) {
    const block = extractFrontmatterBlock(illustratorRaw);
    if (block) {
      const fm = parseAuditFrontmatter(block);
      illustratorAt = fm.audited_at ?? "unknown";
      if (fm.status !== "all-clear") {
        drift.push(`illustrator_notes.md: prior-audit-had-issues`);
      } else {
        const check = (rel: string, expected: string) => {
          const cur = md5OrNull(join(projectDir, rel));
          if (cur === null) drift.push(`${rel}: missing`);
          else if (cur !== expected) drift.push(`${rel}: changed`);
        };
        if (fm.style_guide_md5) check("report/figures/style_guide.md", fm.style_guide_md5);
        for (const [rel, h] of Object.entries(fm.canonical_figures ?? {})) check(rel, h);
        for (const [rel, h] of Object.entries(fm.plot_scripts ?? {})) check(rel, h);
        illustratorOK = drift.length === 0;
      }
    } else {
      drift.push(`illustrator_notes.md: no frontmatter`);
    }
  } else {
    drift.push(`illustrator_notes.md: missing`);
  }

  // Parse typesetter side — only required if report.pdf exists. Hash the
  // PDF at most once (used for the freshness compare; not used for the
  // existence probe, which is a cheap existsSync above).
  let typesetterOK = false;
  let typesetterAt = "unknown";
  if (reportPdfExists) {
    if (typesetterRaw) {
      const block = extractFrontmatterBlock(typesetterRaw);
      if (block) {
        const fm = parseAuditFrontmatter(block);
        typesetterAt = fm.audited_at ?? "unknown";
        if (fm.status !== "all-clear") {
          drift.push(`typesetter_notes.md: prior-audit-had-issues`);
        } else if (!fm.report_pdf_md5) {
          drift.push(`typesetter_notes.md: missing report_pdf_md5`);
        } else if (md5OrNull(reportPdfPath) !== fm.report_pdf_md5) {
          drift.push(`report/report.pdf: changed since typesetter audit`);
        } else {
          typesetterOK = true;
        }
      } else {
        drift.push(`typesetter_notes.md: no frontmatter`);
      }
    } else {
      drift.push(`typesetter_notes.md: missing (report.pdf exists, layout unaudited)`);
    }
  } else {
    // No PDF compiled yet: typesetter audit not required for convergence,
    // but illustrator side still has to be clean for the cache to fire.
    typesetterOK = true;
  }

  if (illustratorOK && typesetterOK) {
    const at = reportPdfExists ? `${illustratorAt} (typesetter ${typesetterAt})` : illustratorAt;
    return `<figure_convergence>converged audited_at="${at}"</figure_convergence>`;
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
The agent has submitted a **research plan** for approval before starting execution. This is a critical checkpoint and the single most load-bearing review moment in the pipeline — the plan is forwarded verbatim to every experiment agent downstream, so anything compressed here propagates to all of them.

Evaluate the plan as a PI would evaluate a student's proposed research agenda. Start with noun-preservation (most common silent failure), then scope/strategy:

0. **Noun-preservation (check FIRST).** Open RESEARCH.md's verbatim user-request block. Enumerate every concrete deliverable noun the user named (examples across domains: a circuit, a layout, a spec, a protocol, a schedule, a dataset, a benchmark, a binary, a diagram — anything that has an independent file-level existence). For each such noun, walk plan.md:
   (a) Does any sub-question **section title** preserve the noun? Or was it retitled to a summary framing ("summary of X", "estimate of X", "comparison of X", "analysis of X", "overview of X", "assessment of X")?
   (b) Does any sub-question **body** require producing the noun as a deliverable output file, not merely reasoning *about* the noun to extract metrics?
   If user said "X" and plan says "summary of X" anywhere, flag with the exact before/after pair, and STEER. This is the most common silent failure: user names artifact → plan retitles to a metric about that artifact → every downstream experiment produces metrics, and the artifact itself never gets built. Because plan is forwarded verbatim, you are the last defence.

1. **Scope**: Is the scope realistic for the available resources?
2. **Search strategy**: Will the proposed search queries catch the important work?
3. **Key questions**: Are the right questions being asked?
4. **Experiment plan**: Are the hypotheses well-formed? Will the proposed experiments actually test them?
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
