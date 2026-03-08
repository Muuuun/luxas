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
} from "node:fs";
import { join } from "node:path";
import { KnowledgeStore } from "./knowledge/store.js";
import type { ResearchState } from "./types.js";

const STATE_FILE = "research-state.json";

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
  state.updated_at = Date.now();
  // Sync artifact counts from knowledge store
  const store = new KnowledgeStore(projectDir);
  const index = store.getIndex();
  state.artifacts = {
    subtopics_count: safeJsonArrayLen(join(projectDir, "data", "topics.json")),
    seed_papers_count: index.counts.discovered + index.counts.candidate,
    core_papers_count: index.counts.core,
    downloaded_count: index.counts.downloaded,
    extracted_count: index.counts.extracted,
    has_report_tex: existsSync(join(projectDir, "data", "reports", "survey_report.tex")),
    has_report_bib: existsSync(join(projectDir, "data", "reports", "references.bib")),
    has_report_pdf: existsSync(join(projectDir, "data", "reports", "survey_report.pdf")),
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
    "=== Session State ===",
    `Status: ${state.status}`,
    `Actions taken: ${state.actions_taken.length}`,
    `Brain calls: ${state.total_brain_calls}, Executor calls: ${state.total_executor_calls}`,
  ];

  // Recent actions (last 10)
  if (state.actions_taken.length > 0) {
    lines.push("", "=== Recent Actions (last 10) ===");
    for (const act of state.actions_taken.slice(-10)) {
      lines.push(`  [${act.result}] ${act.action}: ${act.reason}`);
      if (act.details) {
        lines.push(`    → ${act.details.slice(0, 200)}`);
      }
    }
  }

  lines.push("", "=== Knowledge Store ===", knowledgeSummary);

  return lines.join("\n");
}

export function ensureDataDirs(projectDir = "."): void {
  for (const dir of ["data/papers", "data/extractions", "data/relations", "data/reports"]) {
    mkdirSync(join(projectDir, dir), { recursive: true });
  }
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
