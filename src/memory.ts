/**
 * Cross-project memory system.
 *
 * Global state lives in ~/.sisyphus/:
 *   memory.md      — Agent-maintained cross-project insights (freeform)
 *   projects.json  — Registry of all research projects with summaries
 *
 * Each project generates a summary on completion from its notes/ files.
 * New projects see past research summaries in their context snapshot.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { readFileSafe, deriveProjectTitle } from "./utils.js";

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
    return [];
  }
}

function saveProjects(projects: ProjectEntry[]): void {
  ensureDir();
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
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

  projects.push(entry);
  saveProjects(projects);
  return entry;
}

/**
 * Update project after a run completes.
 * Generates summary from notes/ files, updates registry.
 */
export function updateProjectAfterRun(
  projectDir: string,
  costUsd: number,
  tokens: number,
): void {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.path === projectDir);
  if (idx === -1) return;

  const entry = projects[idx];
  entry.lastRun = new Date().toISOString();
  entry.costUsd += costUsd;
  entry.tokens += tokens;

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
  // Create a slug from the project directory name
  const slug = basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);

  const archiveDir = join(ARCHIVE_DIR, slug);
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

  // Also copy report.tex if it exists (for reference)
  const reportSrc = join(projectDir, "report", "report.tex");
  if (existsSync(reportSrc)) {
    copyFileSync(reportSrc, join(archiveDir, "report.tex"));
  }
}

// Global memory file path — exposed for skill SKILL.md reference
export const GLOBAL_MEMORY_PATH = GLOBAL_MEMORY_FILE;
