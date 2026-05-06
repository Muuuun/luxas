/**
 * Project discovery and creation — finds research projects on disk.
 *
 * A project is a directory containing RESEARCH.md.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { Session } from "../session.js";

export interface ProjectInfo {
  displayName: string;
  name: string;
  dir: string;
  topic: string;
  status: "running" | "paused" | "done" | "idle";
  updatedAt: number;
  /** Session stats */
  totalActions: number;
  decisions: number;
  /** Has PDF report */
  hasPdf: boolean;
  pdfPath: string | null;
}

/**
 * Discover research projects in a base directory.
 * Scans 1 level deep for directories containing RESEARCH.md.
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
    const researchMd = join(dir, "RESEARCH.md");

    if (!existsSync(researchMd)) continue;

    try {
      const topic = readFileSync(researchMd, "utf-8").trim().split("\n")[0]
        .replace(/^#\s*/, "").slice(0, 100) || name;

      // Get session stats
      const logFile = join(dir, ".agent", "log.jsonl");
      let totalActions = 0;
      let decisions = 0;
      let status: ProjectInfo["status"] = "idle";
      let updatedAt = 0;

      if (existsSync(logFile)) {
        try {
          const session = Session.open(logFile, dir);
          const stats = session.stats();
          totalActions = stats.totalActions;
          decisions = stats.decisions;
          updatedAt = statSync(logFile).mtimeMs;
          // Infer status from session
          if (stats.lastAction?.includes("(success)")) status = "paused";
          if (stats.lastAction?.includes("(failed)")) status = "paused";
          if (totalActions > 0) status = "paused";
        } catch { /* ignore corrupted log */ }
      }

      const pdfPath = findPdf(dir);

      projects.push({
        displayName: cleanDirName(name),
        name,
        dir,
        topic,
        status,
        updatedAt,
        totalActions,
        decisions,
        hasPdf: pdfPath !== null,
        pdfPath,
      });
    } catch {
      // Skip corrupted projects
    }
  }

  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

function cleanDirName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findPdf(dir: string): string | null {
  const candidates = [
    join(dir, "report", "report.pdf"),
    join(dir, "report", "main.pdf"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function generateProjectName(topic: string): Promise<string> {
  // Simple slug generation (no LLM call)
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
}

/**
 * Create a new research project with RESEARCH.md.
 * Used by CLI `luxas init` — writes a simple template.
 */
export async function createProject(baseDir: string, topic: string): Promise<string> {
  const dirName = await generateProjectName(topic);
  const dir = join(baseDir, dirName);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "RESEARCH.md"), `# ${topic}\n\nProduce a comprehensive LaTeX survey report on "${topic}" with proper citations, compiled to PDF.\n`);
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "literature.md"), "# Literature Notes\n\n");
  writeFileSync(join(dir, "notes", "experiments.md"), "# Experiment Notes\n\n");

  for (const d of ["data/papers", "data/experiments", "report", "reviews", ".agent"]) {
    mkdirSync(join(dir, d), { recursive: true });
  }

  return dir;
}

/**
 * Create project directory shell without RESEARCH.md.
 * Used by the brainstorm flow — the brainstorm agent writes RESEARCH.md.
 */
export async function createProjectShell(baseDir: string, topic: string): Promise<string> {
  const dirName = await generateProjectName(topic);
  const dir = join(baseDir, dirName);

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "literature.md"), "# Literature Notes\n\n");
  writeFileSync(join(dir, "notes", "experiments.md"), "# Experiment Notes\n\n");

  for (const d of ["data/papers", "data/experiments", "report", "reviews", ".agent"]) {
    mkdirSync(join(dir, d), { recursive: true });
  }

  return dir;
}

export async function autoRenameProject(project: ProjectInfo): Promise<{ oldDir: string; newDir: string; newName: string }> {
  const newSlug = await generateProjectName(project.topic);
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
