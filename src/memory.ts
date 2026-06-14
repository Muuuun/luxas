/**
 * Cross-project memory system.
 *
 * Global state lives in ~/.sisyphus/:
 *   memory.md      — Agent-maintained cross-project insights (freeform)
 *   projects.json  — Registry of all research projects with summaries
 *
 * Each project generates a summary on completion from its notes/ files.
 * New runs get a <past_research> digest (buildPastResearchDigest) injected
 * into the brain's semi-static system layer — see context.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { readFileSafe, deriveProjectTitle, originalRequestBlock, atomicWriteJson } from "./utils.js";

const SISYPHUS_DIR = join(homedir(), ".sisyphus");
const PROJECTS_FILE = join(SISYPHUS_DIR, "projects.json");
const GLOBAL_MEMORY_FILE = join(SISYPHUS_DIR, "memory.md");
const ARCHIVE_DIR = join(SISYPHUS_DIR, "archive");

export interface ProjectEntry {
  path: string;         // absolute path to project dir
  name: string;         // derived from RESEARCH.md first line
  created: string;      // ISO date
  lastRun: string;      // ISO date of last run
  summary: string;      // auto-generated summary from notes
  costUsd: number;      // total cost across all runs
  tokens: number;       // total tokens used
  lastRunFinished?: boolean; // false = last run exited blocked at a gate (resumable), not complete
}

// ── Registry ──────────────────────────────────────────────

function ensureDir(): void {
  mkdirSync(SISYPHUS_DIR, { recursive: true });
}

export function loadProjects(): ProjectEntry[] {
  if (!existsSync(PROJECTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
  } catch {
    // A corrupt/partial projects.json must NEVER silently become an empty
    // registry — the next registerProject would overwrite it, erasing every
    // other project. Quarantine the bad file (recoverable) and fail loud; a
    // later run then sees no file and starts a fresh registry instead of
    // clobbering the real one with a single entry.
    const quarantine = `${PROJECTS_FILE}.corrupt.${Date.now()}`;
    renameSync(PROJECTS_FILE, quarantine);
    throw new Error(
      `projects.json was corrupt; quarantined to ${quarantine}. ` +
      `Recover entries from it manually if needed, then re-run.`,
    );
  }
}

function saveProjects(projects: ProjectEntry[]): void {
  ensureDir();
  atomicWriteJson(PROJECTS_FILE, projects);
}

/**
 * Register a project in the global registry.
 * Called on `luxas init` and `luxas run`.
 */
export function registerProject(projectDir: string): ProjectEntry {
  const projects = loadProjects();

  // Check if already registered
  const existing = projects.find(p => p.path === projectDir);
  if (existing) return existing;

  const research = readFileSafe(join(projectDir, "RESEARCH.md"));
  const name = deriveProjectTitle(research);

  const entry: ProjectEntry = {
    path: projectDir,
    name,
    created: new Date().toISOString(),
    lastRun: new Date().toISOString(),
    summary: "",
    costUsd: 0,
    tokens: 0,
  };

  // Throwaway test projects must not pollute the registry that feeds the
  // <past_research> digest. macOS /tmp resolves to /private/tmp.
  if (isThrowawayPath(projectDir)) return entry;

  projects.push(entry);
  saveProjects(projects);
  return entry;
}

export function isThrowawayPath(projectDir: string): boolean {
  let real = projectDir;
  try { real = realpathSync(projectDir); } catch {}
  return /^(\/private)?\/tmp\//.test(real) || real.startsWith("/private/var/folders/");
}

/**
 * Update project after a run completes.
 * Generates summary from notes/ files, updates registry.
 */
export function updateProjectAfterRun(
  projectDir: string,
  costUsd: number,
  tokens: number,
  opts?: { finished?: boolean },
): void {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.path === projectDir);
  if (idx === -1) return;

  const entry = projects[idx];
  entry.lastRun = new Date().toISOString();
  entry.costUsd += costUsd;
  entry.tokens += tokens;
  if (opts?.finished !== undefined) entry.lastRunFinished = opts.finished;

  // Generate summary from project notes
  entry.summary = generateProjectSummary(projectDir);

  const research = readFileSafe(join(projectDir, "RESEARCH.md"));
  entry.name = deriveProjectTitle(research) || entry.name;

  projects[idx] = entry;
  saveProjects(projects);

  // Archive project notes + experiments to global memory
  archiveProjectNotes(projectDir, entry.name);
}

/**
 * Generate a compact summary from a project's notes files.
 * Extracts section headers + key conclusions.
 */
function generateProjectSummary(projectDir: string): string {
  const parts: string[] = [];

  // Literature notes — extract paper count and section headers
  const lit = readFileSafe(join(projectDir, "notes", "literature.md"));
  if (lit.length > 20) {
    const headers = lit.split("\n")
      .filter(l => l.match(/^#{2,4}\s/))
      .map(h => h.replace(/^#+\s*/, "").trim())
      .slice(0, 10);
    if (headers.length > 0) {
      parts.push(`Literature: ${headers.join("; ")}`);
    }
  }

  // Experiment notes — extract hypotheses, key findings, and important negative results
  const exp = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (exp.length > 20) {
    const keyLines = exp.split("\n")
      .filter(l => {
        const low = l.toLowerCase();
        return low.includes("hypothesis") || low.includes("result")
          || low.includes("conclusion") || low.includes("fidelity")
          || low.includes("key finding") || low.includes("cannot")
          || low.includes("confirmed") || low.includes("impractical")
          || low.includes("selectivity") || low.match(/^\*\*.*\*\*/);
      })
      .map(l => l.replace(/^[#*\s-]+/, "").trim())
      .filter(l => l.length > 10)
      .slice(0, 8);
    if (keyLines.length > 0) {
      parts.push(`Experiments: ${keyLines.join("; ")}`);
    }
  }

  // Memory scratchpad — include if substantive
  const mem = readFileSafe(join(projectDir, "notes", "memory.md"));
  if (mem.length > 50) {
    const headers = mem.split("\n")
      .filter(l => l.match(/^#{2,4}\s/))
      .map(h => h.replace(/^#+\s*/, "").trim())
      .slice(0, 5);
    if (headers.length > 0) {
      parts.push(`Notes: ${headers.join("; ")}`);
    }
  }

  // Report status
  if (existsSync(join(projectDir, "report", "report.pdf"))) {
    parts.push("Report: completed (PDF generated)");
  }

  return parts.join("\n") || "(no notes yet)";
}

// ── Archive ───────────────────────────────────────────────

/**
 * Archive a project's notes and experiment results to ~/.sisyphus/archive/<slug>/
 * so the memory skill can access them without knowing the original project path.
 *
 * Copies: notes/literature.md, notes/experiments.md, notes/memory.md
 * Each file gets a header with project name and path for context.
 */
function archiveProjectNotes(projectDir: string, projectName: string): void {
  const archiveDir = join(ARCHIVE_DIR, archiveSlug(projectDir));
  mkdirSync(archiveDir, { recursive: true });

  const notesFiles = [
    "notes/literature.md",
    "notes/experiments.md",
    "notes/memory.md",
  ];

  for (const relPath of notesFiles) {
    const src = join(projectDir, relPath);
    const content = readFileSafe(src);
    if (content.length > 20) {
      const dest = join(archiveDir, basename(relPath));
      const header = `<!-- Project: ${projectName} -->\n<!-- Source: ${src} -->\n<!-- Archived: ${new Date().toISOString()} -->\n\n`;
      writeFileSync(dest, header + content);
    }
  }

  // Also copy report.tex if it exists (for reference). The % header keeps it
  // re-homeable by provenance, like the .md files above.
  const reportSrc = join(projectDir, "report", "report.tex");
  if (existsSync(reportSrc)) {
    const header = `% Project: ${projectName}\n% Source: ${reportSrc}\n% Archived: ${new Date().toISOString()}\n`;
    writeFileSync(join(archiveDir, "report.tex"), header + readFileSafe(reportSrc));
  }
}

// ── Read path: past-research digest ───────────────────────

/**
 * Past projects worth surfacing to a new run: everything registered except
 * the current project, throwaway dirs, and never-completed entries (a
 * summary is only written after a run finishes).
 */
export function selectPastProjects(currentDir: string): ProjectEntry[] {
  return loadProjects()
    .filter(p =>
      p.path !== currentDir &&
      !isThrowawayPath(p.path) &&
      p.name !== "Untitled" &&
      p.summary.length > 0)
    .sort((a, b) => b.lastRun.localeCompare(a.lastRun));
}

const DIGEST_BUDGET = 12_000;
const INDEX_BUDGET = 3_000;

/**
 * Extract the actual research question from RESEARCH.md. Anchored on the
 * verbatim user request blockquote when present (renderResearchDoc shape);
 * for hand-written files, falls back to the FIRST paragraph only. Both
 * anchors keep the digest claim-free: humans prepend STATE sections and
 * append <feedback>/result notes with computed values, and "everything
 * non-header" extraction was verified to leak them. Angle brackets are
 * stripped so registry text can't smuggle tags into the <past_research>
 * block. Splits on literal "\n" too — the --prompt CLI path leaves them
 * unescaped in some files.
 */
function extractResearchQuestion(research: string): string {
  const feedbackAt = research.indexOf("<feedback>");
  const text = feedbackAt === -1 ? research : research.slice(0, feedbackAt);

  let region = originalRequestBlock(text);
  if (region === null) {
    // First paragraph: content lines until the first blank line after content.
    const lines: string[] = [];
    for (const raw of text.split(/\r?\n|\\n/)) {
      const t = raw.trim();
      if (!t) {
        if (lines.length > 0) break;
        continue;
      }
      if (t.startsWith("#") || /^_.*_$/.test(t)) continue;
      lines.push(t);
    }
    region = lines.join(" ");
  }

  const out: string[] = [];
  for (const raw of region.split(/\r?\n|\\n/)) {
    let line = raw.replace(/^(?:>\s*)+/, "").replace(/[<>]/g, " ").trim();
    if (!line || /^_.*_$/.test(line)) continue;
    line = line.replace(/^(hi|hello|hey|dear)[,!.\s]+luxas[,!.:：，\s]*/i, "").trim();
    if (line) out.push(line);
  }
  return out.join(" ").replace(/\s+/g, " ").slice(0, 300);
}

/** Char budget weighted for CJK: ~1 token/char vs ~1 token/4 chars for ASCII. */
function budgetWeight(s: string): number {
  const cjk = (s.match(/[　-鿿豈-﫿＀-￯]/g) ?? []).length;
  return s.length + 2 * cjk;
}

/**
 * Build the <past_research> digest injected into the brain's semi-static
 * system layer (context.ts). Deliberately claim-free: each entry carries the
 * project's NAME, DATE, PATH, and its RESEARCH QUESTION (start of
 * RESEARCH.md) — never findings or computed values. A wrong "fact" from a
 * past project can only enter the current run through an explicit, logged
 * read of that project's notes, where it sits next to its own limitations
 * and red-team sections.
 */
export function buildPastResearchDigest(currentDir: string): string {
  const past = selectPastProjects(currentDir);
  if (past.length === 0) return "";

  const entries: string[] = [];
  const index: string[] = [];
  let used = 0;

  for (const p of past) {
    // Project dirs get deleted; point dead entries at their archive copy so
    // the documented fallback is actually reachable (a dead path would just
    // ENOENT). Checked once per session — this digest is frozen at build.
    const live = existsSync(p.path);
    const research = live ? readFileSafe(join(p.path, "RESEARCH.md")) : "";
    const question = extractResearchQuestion(research);
    if (question && used < DIGEST_BUDGET) {
      const entry = `- **${p.name}** (${p.lastRun.slice(0, 10)})\n  notes: ${p.path}/notes/\n  question: ${question}`;
      entries.push(entry);
      used += budgetWeight(entry);
    } else {
      const where = live ? p.path : `${join(ARCHIVE_DIR, archiveSlug(p.path))} (archived; project dir gone)`;
      index.push(`- ${p.name} — ${where}`);
    }
  }

  let indexBlock = "";
  if (index.length > 0) {
    let lines = "";
    let indexUsed = 0;
    let shown = 0;
    for (const line of index) {
      const w = budgetWeight(line);
      if (indexUsed + w > INDEX_BUDGET) break;
      lines += line + "\n";
      indexUsed += w;
      shown++;
    }
    const omitted = index.length - shown;
    indexBlock = `\nOther past projects (name — path):\n${lines}` +
      (omitted > 0 ? `(+${omitted} more in ~/.sisyphus/projects.json)\n` : "");
  }

  return `<past_research>
Past research projects by this lab, newest first. Entries are the projects' RESEARCH QUESTIONS — not verified facts. If one is adjacent to the current goal, read its notes (experiments.md, literature.md, memory.md under the listed path) before commissioning overlapping literature searches or experiments. Treat everything inherited as a dated, unverified lead; honor any CORRECTIONS sections found there.

${entries.join("\n")}
${indexBlock}</past_research>`;
}

/**
 * Slug for ~/.sisyphus/archive/<slug>/. The sanitized basename strips
 * non-ASCII, so an all-CJK project name used to collapse to "" and every
 * such project overwrote the archive ROOT (last-writer-wins corruption).
 * A path hash makes the slug non-empty and unique per project dir.
 */
export function archiveSlug(projectDir: string): string {
  const base = basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 52);
  const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 6);
  return base ? `${base}_${hash}` : hash;
}

// Global memory file path — exposed for skill SKILL.md reference
export const GLOBAL_MEMORY_PATH = GLOBAL_MEMORY_FILE;
