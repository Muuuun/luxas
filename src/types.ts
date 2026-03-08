/**
 * Core type definitions for Sisyphus.
 *
 * No fixed pipeline. The Brain decides what to do next based on state.
 */

export interface ResearchState {
  topic: string;
  goal: string;
  status: "running" | "paused" | "done" | "failed";
  actions_taken: ActionRecord[];
  artifacts: ArtifactSummary;
  started_at: number;
  updated_at: number;
  total_brain_calls: number;
  total_executor_calls: number;
}

/** Record of every action the agent has taken */
export interface ActionRecord {
  action: string;
  reason: string;
  result: "success" | "partial" | "failed";
  details: string;
  timestamp: number;
}

/** Summary of what artifacts exist (updated after each action) */
export interface ArtifactSummary {
  subtopics_count: number;
  seed_papers_count: number;
  core_papers_count: number;
  downloaded_count: number;
  extracted_count: number;
  has_report_tex: boolean;
  has_report_bib: boolean;
  has_report_pdf: boolean;
}

/** What the Brain decides to do next — can be one task or multiple parallel tasks */
export interface BrainDecision {
  /** Overall reasoning */
  reason: string;
  /** Is the research done? */
  done: boolean;
  /** Tasks to execute (1 = sequential, >1 = parallel) */
  tasks: TaskSpec[];
}

/** A single executable task */
export interface TaskSpec {
  action: ActionName;
  executor_prompt: string;
  tool: ToolName;
  /** Model tier: "fast" = sonnet (simple tasks), "think" = opus (complex reasoning) */
  model: ModelTier;
  timeout: number;
}

/** All possible actions the agent can take */
export type ActionName =
  | "decompose_topic"
  | "search_papers"
  | "search_more_papers"
  | "expand_citations"
  | "judge_relevance"
  | "download_papers"
  | "extract_paper"
  | "extract_more_papers"
  | "cross_validate"
  | "write_report"
  | "refine_report"
  | "compile_report"
  | "fix_compilation"
  | "assess_quality"
  | "fill_gaps"
  | "done";

export type ToolName = "claude" | "codex";

/** Model tier for cost/quality tradeoff */
export type ModelTier = "fast" | "think" | "cheap";
