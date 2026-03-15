/**
 * Project discovery and creation — finds research projects on disk.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { ensureDataDirs } from "../state.js";

export interface ProjectInfo {
  /** Clean display name derived from directory */
  displayName: string;
  /** Raw directory name */
  name: string;
  /** Absolute path to project directory */
  dir: string;
  /** Research topic (full prompt text) */
  topic: string;
  /** Current status */
  status: "running" | "paused" | "done" | "failed";
  /** Last update timestamp */
  updatedAt: number;
  /** Paper counts */
  corePapers: number;
  /** Has PDF report */
  hasPdf: boolean;
  /** Absolute path to PDF report (if exists) */
  pdfPath: string | null;
}

/**
 * Discover research projects in a base directory.
 * Scans 1 level deep for directories containing research-state.json.
 */
export function discoverProjects(baseDir: string): ProjectInfo[] {
  const projects: ProjectInfo[] = [];

  if (!existsSync(baseDir)) return projects;

  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return projects;
  }

  for (const name of entries) {
    const dir = join(baseDir, name);
    const stateFile = join(dir, "research-state.json");

    if (!existsSync(stateFile)) continue;

    try {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      const hasPdf = state.artifacts?.has_report_pdf ?? false;
      const pdfPath = findPdf(dir);
      projects.push({
        displayName: cleanDirName(name),
        name,
        dir,
        topic: state.topic || name,
        status: state.status || "paused",
        updatedAt: state.updated_at || 0,
        corePapers: state.artifacts?.core_papers_count ?? 0,
        hasPdf: hasPdf || pdfPath !== null,
        pdfPath,
      });
    } catch {
      // Corrupted state file, skip
    }
  }

  // Sort by most recently updated
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

/** Convert directory name to clean display name */
function cleanDirName(name: string): string {
  return name
    .replace(/^(agentic_)?research_/, "") // strip legacy prefix if any
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Search common locations for the report PDF */
function findPdf(dir: string): string | null {
  const candidates = [
    join(dir, "data", "reports", "survey_report.pdf"),
    join(dir, "data", "reports", "main.pdf"),
    join(dir, "data", "report", "survey_report.pdf"),
    join(dir, "data", "report", "main.pdf"),
    join(dir, "report", "main.pdf"),
    join(dir, "report", "survey_report.pdf"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Generate a creative short project name using Claude Haiku.
 * Falls back to simple slugification if the API call fails.
 */
function generateProjectName(topic: string): string {
  try {
    const prompt = `Give me a single creative, short (1-3 words) project codename for a research project about: "${topic}".
Rules: lowercase, no spaces (use underscores), no quotes, no explanation, just the name. Examples: "quantum_maze", "neural_tide", "fold_oracle".`;

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const stdout = execFileSync(
      "claude",
      ["-p", "--model", "claude-haiku-4-5-20251001", "--max-turns", "1"],
      {
        input: prompt,
        timeout: 15000,
        encoding: "utf-8",
        env,
        maxBuffer: 1024 * 1024,
      },
    ).trim();

    // Parse JSON output if present
    let raw = stdout;
    try {
      const data = JSON.parse(stdout);
      raw = data.result ?? stdout;
    } catch { /* plain text */ }

    // Sanitize: keep only alphanumeric and underscores
    const clean = raw
      .replace(/[^a-z0-9_]/gi, "")
      .toLowerCase()
      .slice(0, 30);
    if (clean.length >= 2) return clean;
  } catch {
    // Haiku unavailable, fall through to fallback
  }
  // Fallback: simple slugify
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
}

/**
 * Create a new research project directory with initialized state.
 * Returns the absolute path to the created directory.
 */
export function createProject(baseDir: string, topic: string): string {
  const dirName = generateProjectName(topic);
  const dir = join(baseDir, dirName);

  mkdirSync(dir, { recursive: true });

  // Initialize state
  const state = {
    topic,
    goal: `Produce a comprehensive LaTeX survey report on "${topic}" with proper citations, compiled to PDF.`,
    status: "paused",
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

  writeFileSync(join(dir, "research-state.json"), JSON.stringify(state, null, 2));
  ensureDataDirs(dir);

  return dir;
}

/**
 * Rename a project directory using a Haiku-generated codename.
 * Returns { oldDir, newDir, newName } on success, or throws on failure.
 */
export function autoRenameProject(project: ProjectInfo): { oldDir: string; newDir: string; newName: string } {
  const newSlug = generateProjectName(project.topic);
  const parent = dirname(project.dir);
  const newDir = join(parent, newSlug);

  if (newDir === project.dir) {
    throw new Error("Generated name is the same as current name");
  }
  if (existsSync(newDir)) {
    throw new Error(`Directory already exists: ${newSlug}`);
  }

  renameSync(project.dir, newDir);
  return { oldDir: project.dir, newDir, newName: cleanDirName(newSlug) };
}
