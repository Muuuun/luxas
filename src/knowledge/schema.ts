/**
 * Knowledge Store — schema definitions.
 *
 * Manages research papers like a code repository:
 * - Each paper has its own directory (like a module)
 * - Papers go through a funnel: discovered → candidate → core → excluded
 * - Only core papers get full treatment (download, extract)
 * - Central index tracks everything
 *
 * Directory structure:
 *
 *   data/
 *     index.json                    ← central registry (like package.json)
 *     topics.json                   ← subtopic decomposition
 *     papers/
 *       {paper_id}/
 *         meta.json                 ← identity: title, authors, year, ids
 *         status.json               ← funnel stage + reason
 *         extraction.json           ← structured extraction (only for core)
 *         notes.json                ← agent observations, quality flags
 *         source/                   ← downloaded LaTeX / PDF (only for core)
 *     relations/
 *       citations.json              ← who cites whom
 *       claims.json                 ← cross-paper claim tracking
 *     reports/
 *       survey_report.tex
 *       references.bib
 *       survey_report.pdf
 */

// ============================================================
// Paper funnel — like git staging
// ============================================================

/**
 * discovered  = found via search, only title/abstract known
 * candidate   = looks relevant from abstract, worth investigating
 * core        = confirmed relevant, download + extract
 * excluded    = explicitly rejected with reason (like .gitignore)
 */
export type PaperStatus = "discovered" | "candidate" | "core" | "excluded";

/**
 * Why a paper was excluded. Keeps the audit trail.
 */
export type ExcludeReason =
  | "off_topic"           // not relevant to the research question
  | "duplicate"           // same paper, different ID
  | "too_old"             // outside the time range of interest
  | "insufficient_info"   // can't find full text, no abstract
  | "low_quality"         // predatory journal, retracted, etc.
  | "tangential";         // related but not directly relevant

// ============================================================
// Paper metadata — identity card
// ============================================================

export interface PaperMeta {
  /** Semantic Scholar ID (primary key) */
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  citation_count: number;
  arxiv_id: string | null;
  doi: string | null;
  abstract: string;
  /** How we found this paper */
  source: "search" | "citation_forward" | "citation_backward" | "manual";
  /** When we first discovered it */
  discovered_at: number;
}

// ============================================================
// Paper status — funnel tracking
// ============================================================

export interface PaperStatusRecord {
  status: PaperStatus;
  reason: string;
  /** Who made this decision: "brain" | "rule" | "human" */
  decided_by: string;
  updated_at: number;
  /** For excluded papers: why */
  exclude_reason?: ExcludeReason;
}

// ============================================================
// Structured extraction — only for core papers
// ============================================================

export interface PaperExtraction {
  title: string;
  core_method: string;
  key_results: string[];
  benchmarks: Benchmark[];
  limitations: string[];
  open_problems: string[];
  compared_methods: string[];
  improvements_over_prior: string;
  dependencies: string[];
  /** Key claims we want to cross-validate */
  claims: Claim[];
  /** Figures available in this paper (extracted alongside content) */
  figures: FigureMeta[];
  /** Extraction quality self-assessment */
  confidence: "high" | "medium" | "low";
  extracted_at: number;
}

/** Metadata about a figure, extracted alongside paper content */
export interface FigureMeta {
  /** Filename in data/papers/{id}/figures/ */
  filename: string;
  /** Original figure number/label in the paper (e.g., "Figure 3", "fig:architecture") */
  label: string;
  /** What this figure actually shows (written by the extractor who READ the paper) */
  description: string;
  /** Which section of the paper this figure belongs to */
  section: string;
  /** How useful for a survey report: "key" = must include, "useful" = nice to have, "skip" = not worth it */
  relevance: "key" | "useful" | "skip";
}

export interface Benchmark {
  name: string;
  metric: string;
  score: string;
  comparison: string;
}

export interface Claim {
  /** What the paper claims */
  statement: string;
  /** Evidence type: "experimental" | "theoretical" | "empirical" | "anecdotal" */
  evidence: string;
  /** Which section of the paper */
  section: string;
}

// ============================================================
// Agent notes — observations, quality flags
// ============================================================

export interface PaperNotes {
  /** Free-form observations from the agent */
  observations: string[];
  /** Quality flags */
  flags: string[];
  /** Related paper IDs the agent noticed */
  related_to: string[];
  updated_at: number;
}

// ============================================================
// Relations — cross-paper connections
// ============================================================

export interface CitationEdge {
  from: string;   // paper_id that cites
  to: string;     // paper_id that is cited
  /** Optional: the context sentence around the citation */
  context?: string;
}

export interface CrossClaim {
  /** The claim being tracked */
  claim: string;
  /** Paper that makes the claim */
  source_paper: string;
  /** Papers that support / contradict / are neutral */
  supporting: string[];
  contradicting: string[];
  neutral: string[];
  /** Agent's assessment */
  verdict: string;
  updated_at: number;
}

// ============================================================
// Central index — the manifest
// ============================================================

export interface ResearchIndex {
  /** Research topic */
  topic: string;
  goal: string;
  created_at: number;
  updated_at: number;
  /** Paper counts by status */
  counts: {
    discovered: number;
    candidate: number;
    core: number;
    excluded: number;
    downloaded: number;
    extracted: number;
  };
  /** All paper IDs with their current status (quick lookup) */
  papers: Record<string, PaperStatus>;
}
