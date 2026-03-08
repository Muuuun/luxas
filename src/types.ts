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
  /** Optional: use a custom agent (prepend its system_prompt) */
  agent_id?: string;
}

/** Project-specific custom agent definition */
export interface AgentDefinition {
  /** Unique identifier (e.g., "latex_expert", "quantum_reviewer") */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this agent specializes in */
  description: string;
  /** System prompt prepended to every task using this agent */
  system_prompt: string;
  /** Preferred model tier */
  default_model: ModelTier;
  /** When this agent was created */
  created_at: number;
}

/** All possible actions the agent can take */
export type ActionName =
  | "decompose_topic"
  | "search_papers"
  | "search_more_papers"
  | "expand_citations"
  | "evaluate_papers"
  | "judge_relevance"
  | "download_papers"
  | "extract_paper"
  | "extract_more_papers"
  | "extract_figures"
  | "cross_validate"
  | "write_report"
  | "refine_report"
  | "compile_report"
  | "fix_compilation"
  | "assess_quality"
  | "fill_gaps"
  | "define_agent"
  | "custom"
  | "done";

export type ToolName = "claude" | "codex";

/** Model tier for cost/quality tradeoff */
export type ModelTier = "fast" | "think" | "cheap";
