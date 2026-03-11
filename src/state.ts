/**
 * State management — research session state + knowledge store integration.
 *
 * Two concerns:
 * 1. Session state (research-state.json) — what the agent has done, safety counters
 * 2. Knowledge state (data/index.json + paper dirs) — what papers exist, their status
 *
 * The Brain sees both.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
  copyFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { KnowledgeStore } from "./knowledge/store.js";
import { AgentStore } from "./agents.js";
import type { ResearchState } from "./types.js";

const STATE_FILE = "research-state.json";

/** Canonical report directory — all report files should live here */
const CANONICAL_REPORT_DIR = join("data", "reports");

/** All directories where executors might place report files */
function reportSearchDirs(projectDir: string): string[] {
  return [
    join(projectDir, "data", "reports"),
    join(projectDir, "data", "report"),
    join(projectDir, "report"),
    join(projectDir, "reports"),
  ];
}

/**
 * Consolidate report files — move .tex, .bib, .pdf, and aux files
 * from non-canonical directories to data/reports/ (canonical).
 * Removes stale copies from non-canonical dirs to prevent confusion.
 */
export function consolidateReportFiles(projectDir = "."): void {
  const canonDir = join(projectDir, CANONICAL_REPORT_DIR);
  mkdirSync(canonDir, { recursive: true });

  const searchDirs = reportSearchDirs(projectDir);
  const reportExts = [".tex", ".bib", ".pdf", ".bbl", ".blg", ".aux", ".log", ".out", ".toc", ".synctex.gz"];

  for (const dir of searchDirs) {
    if (dir === canonDir || !existsSync(dir)) continue;

    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }

    let movedAny = false;
    for (const file of files) {
      if (!reportExts.some((ext) => file.endsWith(ext))) continue;

      const src = join(dir, file);
      const dst = join(canonDir, file);

      // If canonical already has a NEWER version, skip
      if (existsSync(dst)) {
        const srcMtime = statSync(src).mtimeMs;
        const dstMtime = statSync(dst).mtimeMs;
        if (dstMtime >= srcMtime) {
          // Delete the stale non-canonical copy
          try { unlinkSync(src); } catch { /* ignore */ }
          continue;
        }
      }

      // Move to canonical
      try {
        copyFileSync(src, dst);
        unlinkSync(src);
        movedAny = true;
      } catch { /* ignore */ }
    }

    if (movedAny) {
      console.log(`[state] Consolidated report files from ${dir.replace(projectDir + "/", "")} → ${CANONICAL_REPORT_DIR}`);
    }

    // Clean up empty non-canonical report dirs
    try {
      const remaining = readdirSync(dir);
      if (remaining.length === 0) {
        rmSync(dir, { recursive: true });
      }
    } catch { /* ignore */ }
  }
}

/**
 * Find report files — executors may create them with different names/directories.
 * Searches common patterns and returns resolved paths.
 */
export function findReportFiles(projectDir = "."): {
  texPath: string | null;
  bibPath: string | null;
  pdfPath: string | null;
  reportDir: string | null;
} {
  const searchDirs = reportSearchDirs(projectDir);

  let texPath: string | null = null;
  let bibPath: string | null = null;
  let pdfPath: string | null = null;
  let reportDir: string | null = null;

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }

    // Find .tex (prefer survey_report.tex, then main.tex, then any .tex)
    if (!texPath) {
      for (const name of ["survey_report.tex", "main.tex"]) {
        if (files.includes(name)) { texPath = join(dir, name); reportDir = dir; break; }
      }
      if (!texPath) {
        const anyTex = files.find((f) => f.endsWith(".tex"));
        if (anyTex) { texPath = join(dir, anyTex); reportDir = dir; }
      }
    }

    // Find .bib (prefer same dir as .tex)
    if (!bibPath) {
      for (const name of ["references.bib", "main.bib", "ref.bib"]) {
        if (files.includes(name)) { bibPath = join(dir, name); break; }
      }
      if (!bibPath) {
        const anyBib = files.find((f) => f.endsWith(".bib"));
        if (anyBib) bibPath = join(dir, anyBib);
      }
    }

    // Find .pdf (prefer survey_report.pdf, then main.pdf)
    if (!pdfPath) {
      for (const name of ["survey_report.pdf", "main.pdf"]) {
        if (files.includes(name)) { pdfPath = join(dir, name); break; }
      }
      if (!pdfPath) {
        const anyPdf = files.find((f) => f.endsWith(".pdf") && !f.startsWith("."));
        if (anyPdf) pdfPath = join(dir, anyPdf);
      }
    }
  }

  return { texPath, bibPath, pdfPath, reportDir };
}

export function loadState(projectDir = "."): ResearchState {
  const path = join(projectDir, STATE_FILE);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf-8"));
  }
  return {
    topic: "",
    goal: "",
    status: "running",
    actions_taken: [],
    artifacts: {
      subtopics_count: 0,
      seed_papers_count: 0,
      core_papers_count: 0,
      downloaded_count: 0,
      extracted_count: 0,
      has_report_tex: false,
      has_report_bib: false,
      has_report_pdf: false,
    },
    started_at: Date.now(),
    updated_at: Date.now(),
    total_brain_calls: 0,
    total_executor_calls: 0,
  };
}

export function saveState(state: ResearchState, projectDir = "."): void {
  mkdirSync(projectDir, { recursive: true });
  state.updated_at = Date.now();
  // Sync artifact counts from knowledge store — recount from filesystem
  // to avoid stale counts caused by parallel executors racing on index.json
  const store = new KnowledgeStore(projectDir);
  const index = store.getIndex();
  store.saveIndex(index); // recounts downloaded/extracted from actual files
  const reportFiles = findReportFiles(projectDir);
  state.artifacts = {
    subtopics_count: safeJsonArrayLen(join(projectDir, "data", "topics.json")),
    seed_papers_count: index.counts.discovered + index.counts.candidate,
    core_papers_count: index.counts.core,
    downloaded_count: index.counts.downloaded,
    extracted_count: index.counts.extracted,
    has_report_tex: reportFiles.texPath !== null,
    has_report_bib: reportFiles.bibPath !== null,
    has_report_pdf: reportFiles.pdfPath !== null,
  };
  const path = join(projectDir, STATE_FILE);
  writeFileSync(path, JSON.stringify(state, null, 2));
}

/**
 * Build the full context string for the Brain.
 * Combines session state + knowledge store summary.
 */
export function buildBrainContext(projectDir = "."): string {
  const state = loadState(projectDir);
  const store = new KnowledgeStore(projectDir);
  const knowledgeSummary = store.summarizeForBrain();

  const lines: string[] = [
    `<session status="${state.status}" actions="${state.actions_taken.length}" brain_calls="${state.total_brain_calls}" executor_calls="${state.total_executor_calls}">`,
  ];

  // Recent actions (last 10)
  if (state.actions_taken.length > 0) {
    lines.push("<recent_actions>");
    for (const act of state.actions_taken.slice(-10)) {
      lines.push(`  [${act.result}] ${act.action}: ${act.reason}`);
      if (act.details) {
        lines.push(`    → ${act.details.slice(0, 200)}`);
      }
    }
    lines.push("</recent_actions>");
  }

  lines.push("</session>");

  // Report validation — always show issues so Brain can't miss them
  const reportFiles = findReportFiles(projectDir);
  const reportIssues = validateReport(projectDir);
  if (reportFiles.texPath) {
    lines.push(`<report_files tex="${reportFiles.texPath}" bib="${reportFiles.bibPath ?? "MISSING"}" pdf="${reportFiles.pdfPath ?? "MISSING"}" />`);
  }
  if (reportIssues.length > 0) {
    lines.push("<report_validation status=\"FAILED\">");
    for (const issue of reportIssues) {
      lines.push(`  ⚠ ${issue}`);
    }
    lines.push("</report_validation>");
  } else if (state.artifacts.has_report_tex) {
    lines.push("<report_validation status=\"PASSED\" />");
  }

  lines.push("<knowledge>", knowledgeSummary, "</knowledge>");

  // Custom agents
  const agentStore = new AgentStore(projectDir);
  const agentSummary = agentStore.summarizeForBrain();
  lines.push("<agents>", agentSummary, "</agents>");

  return lines.join("\n");
}

export function ensureDataDirs(projectDir = "."): void {
  for (const dir of ["data/papers", "data/extractions", "data/relations", "data/reports"]) {
    mkdirSync(join(projectDir, dir), { recursive: true });
  }
}

/**
 * Validate that the LaTeX report is structurally complete.
 * Searches multiple possible file locations (executors use different names).
 * Returns a list of issues (empty = valid).
 */
export function validateReport(projectDir = "."): string[] {
  // First: consolidate scattered report files to canonical directory
  consolidateReportFiles(projectDir);

  const { texPath, bibPath, pdfPath, reportDir } = findReportFiles(projectDir);
  const issues: string[] = [];

  // 1. Check .tex exists and is non-empty
  if (!texPath) {
    issues.push("MISSING_TEX: no .tex file found in data/reports/ or data/report/");
    return issues; // can't check further
  }
  const tex = readFileSync(texPath, "utf-8");
  if (tex.trim().length < 500) {
    issues.push(`TEX_TOO_SHORT: ${texPath} is only ${tex.trim().length} chars (expected >500)`);
  }

  // 2. Check .tex and .bib are in the SAME directory
  if (bibPath && reportDir && dirname(bibPath) !== reportDir) {
    const relTex = texPath.replace(projectDir + "/", "");
    const relBib = bibPath.replace(projectDir + "/", "");
    issues.push(`SPLIT_REPORT: .tex in ${relTex} but .bib in ${relBib} — they MUST be in the same directory for bibtex to work`);
  }

  // 3. Check .tex references a .bib file that actually exists in the same dir
  const bibRefMatch = tex.match(/\\bibliography\{([^}]+)\}/);
  if (bibRefMatch && reportDir) {
    const bibRefName = bibRefMatch[1].trim();
    const expectedBibPath = join(reportDir, bibRefName + ".bib");
    if (!existsSync(expectedBibPath)) {
      const relDir = reportDir.replace(projectDir + "/", "");
      issues.push(`MISSING_BIB_IN_DIR: .tex references \\bibliography{${bibRefName}} but ${relDir}/${bibRefName}.bib does NOT exist`);
    }
  }

  // 4. Check essential LaTeX structure
  if (!tex.includes("\\documentclass")) {
    issues.push("MISSING_STRUCTURE: no \\documentclass");
  }
  if (!tex.includes("\\begin{document}")) {
    issues.push("MISSING_STRUCTURE: no \\begin{document}");
  }
  if (!tex.includes("\\end{document}")) {
    issues.push("MISSING_STRUCTURE: no \\end{document}");
  }
  if (!tex.includes("\\title{")) {
    issues.push("MISSING_STRUCTURE: no \\title{}");
  }

  // 5. BibTeX checks
  if (!bibPath) {
    issues.push("MISSING_BIB: no .bib file found — report has NO bibliography");
  } else {
    const bib = readFileSync(bibPath, "utf-8");
    const bibEntries = (bib.match(/@\w+\s*\{/g) || []).length;
    if (bibEntries === 0) {
      issues.push("EMPTY_BIB: .bib file has 0 entries");
    } else if (bibEntries < 5) {
      issues.push(`SPARSE_BIB: .bib file has only ${bibEntries} entries (expected >=5)`);
    }
  }

  // 6. Check \cite usage in .tex
  const citeMatches = tex.match(/\\cite[tp]?\{[^}]+\}/g) || [];
  if (citeMatches.length === 0) {
    issues.push("NO_CITATIONS: .tex has 0 \\cite{} commands");
  }

  // 7. Check \bibliography or \addbibresource
  const hasBibCmd = tex.includes("\\bibliography{") || tex.includes("\\addbibresource{");
  if (!hasBibCmd) {
    issues.push("NO_BIB_COMMAND: .tex has no \\bibliography{} or \\addbibresource{} — BibTeX won't process");
  }

  // 8. Check bibliographystyle (for traditional bibtex)
  if (tex.includes("\\bibliography{") && !tex.includes("\\bibliographystyle{")) {
    issues.push("NO_BIB_STYLE: .tex uses \\bibliography{} but has no \\bibliographystyle{}");
  }

  // 9. PDF exists and freshness
  if (!pdfPath) {
    issues.push("MISSING_PDF: no compiled PDF found — report not compiled");
  } else {
    const texMtime = statSync(texPath).mtimeMs;
    const pdfMtime = statSync(pdfPath).mtimeMs;
    if (pdfMtime < texMtime) {
      issues.push("STALE_PDF: PDF is older than .tex — needs recompilation");
    }
  }

  // 10. Check for sections (a real survey should have sections)
  const sectionCount = (tex.match(/\\section\{/g) || []).length;
  if (sectionCount < 2) {
    issues.push(`FEW_SECTIONS: only ${sectionCount} \\section{} (expected >=2 for a survey)`);
  }

  // 11. Cross-check: verify \cite keys exist in .bib
  if (bibPath && citeMatches.length > 0) {
    const bib = readFileSync(bibPath, "utf-8");
    // Extract all cite keys from \cite{key1,key2,...}
    const citeKeys = new Set<string>();
    for (const m of citeMatches) {
      const inner = m.replace(/\\cite[tp]?\{/, "").replace("}", "");
      for (const k of inner.split(",")) {
        const trimmed = k.trim();
        if (trimmed) citeKeys.add(trimmed);
      }
    }
    // Extract all bib entry keys
    const bibKeys = new Set<string>();
    const bibKeyMatches = bib.matchAll(/@\w+\s*\{\s*([^,\s]+)/g);
    for (const m of bibKeyMatches) {
      bibKeys.add(m[1]);
    }
    // Find missing keys
    const missing = [...citeKeys].filter((k) => !bibKeys.has(k));
    if (missing.length > 0) {
      issues.push(`BROKEN_CITATIONS: ${missing.length} \\cite keys not in .bib: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`);
    }
  }

  // 12. PDF content check — detect unresolved references in actual PDF text
  // This catches incomplete compilation (missing bibtex step or missing 2nd pdflatex).
  // Check ALL PDFs found in any report directory, not just the "best" one.
  const allPdfs: string[] = [];
  for (const dir of reportSearchDirs(projectDir)) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".pdf") && !f.startsWith(".")) {
          allPdfs.push(join(dir, f));
        }
      }
    } catch { /* ignore */ }
  }

  for (const pdf of allPdfs) {
    try {
      const pdfText = execSync(`pdftotext "${pdf}" -`, {
        timeout: 15_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // natbib unresolved citations render as [? ] or [? ? ] or [? ? ? ]
      const unresolvedNatbib = (pdfText.match(/\[\s*\?[\s?]*\]/g) || []).length;
      // Standard LaTeX unresolved cross-refs render as ??
      const unresolvedXrefs = (pdfText.match(/(?:Section|Figure|Table|Eq\.|Equation|Chapter)\s*\?\?/gi) || []).length;

      if (unresolvedNatbib > 0 || unresolvedXrefs > 0) {
        const relPath = pdf.replace(projectDir + "/", "");
        issues.push(
          `UNRESOLVED_REFS_IN_PDF(${relPath}): ${unresolvedNatbib} unresolved citations [?], ${unresolvedXrefs} unresolved cross-refs (Section ??). ` +
          `Compilation was incomplete. MUST run in the report dir: pdflatex main.tex && bibtex main && pdflatex main.tex && pdflatex main.tex`
        );
      }
    } catch {
      // pdftotext not available or failed — skip
    }
  }

  return issues;
}

function safeJsonArrayLen(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}
