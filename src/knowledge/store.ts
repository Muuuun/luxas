/**
 * Knowledge Store — read/write rules for the paper repository.
 *
 * Rules:
 * 1. Every paper gets a directory: data/papers/{safe_id}/
 * 2. meta.json is written on discovery (immutable after that)
 * 3. status.json tracks the funnel stage (discovered → candidate → core → excluded)
 * 4. Only core papers get: source download, extraction.json
 * 5. index.json is the single source of truth for "what papers exist and their status"
 * 6. Relations (citations, claims) are global, not per-paper
 * 7. Excluded papers keep their directory (audit trail) but are skipped by all operations
 *
 * Naming: paper_id is sanitized to filesystem-safe names (replace / with _)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type {
  PaperMeta,
  PaperStatus,
  PaperStatusRecord,
  PaperExtraction,
  PaperNotes,
  CitationEdge,
  CrossClaim,
  ResearchIndex,
  ExcludeReason,
} from "./schema.js";

export class KnowledgeStore {
  private dataDir: string;

  constructor(projectDir = ".") {
    this.dataDir = join(projectDir, "data");
  }

  // ============================================================
  // Index — central registry
  // ============================================================

  getIndex(): ResearchIndex {
    const path = join(this.dataDir, "index.json");
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      // Normalize: executors may store papers as objects {title, stage, ...}
      // instead of plain status strings. Convert to canonical format.
      if (raw.papers) {
        for (const [id, val] of Object.entries(raw.papers)) {
          if (typeof val === "object" && val !== null) {
            const obj = val as Record<string, unknown>;
            // Extract status from stage/status field
            raw.papers[id] = (obj.stage || obj.status || "discovered") as string;
          }
        }
      }
      return raw;
    }
    return {
      topic: "",
      goal: "",
      created_at: Date.now(),
      updated_at: Date.now(),
      counts: { discovered: 0, candidate: 0, core: 0, excluded: 0, downloaded: 0, extracted: 0 },
      papers: {},
    };
  }

  saveIndex(index: ResearchIndex): void {
    index.updated_at = Date.now();
    // Recount from papers map
    const counts = { discovered: 0, candidate: 0, core: 0, excluded: 0, downloaded: 0, extracted: 0 };
    for (const status of Object.values(index.papers)) {
      counts[status]++;
    }
    // Count downloaded and extracted from filesystem
    for (const id of Object.keys(index.papers)) {
      if (index.papers[id] === "core") {
        const dir = this.paperDir(id);
        if (this.hasDownloadedContent(id)) counts.downloaded++;
        if (existsSync(join(dir, "extraction.json"))) counts.extracted++;
      }
    }
    index.counts = counts;
    this.writeJson(join(this.dataDir, "index.json"), index);
  }

  initIndex(topic: string, goal: string): ResearchIndex {
    const index = this.getIndex();
    index.topic = topic;
    index.goal = goal;
    index.created_at = Date.now();
    this.saveIndex(index);
    // Ensure directories
    mkdirSync(join(this.dataDir, "papers"), { recursive: true });
    mkdirSync(join(this.dataDir, "relations"), { recursive: true });
    mkdirSync(join(this.dataDir, "reports"), { recursive: true });
    return index;
  }

  // ============================================================
  // Paper CRUD
  // ============================================================

  /**
   * Add a newly discovered paper. Does nothing if already known.
   * Returns true if this is a new paper, false if duplicate.
   */
  addPaper(meta: PaperMeta): boolean {
    const index = this.getIndex();
    if (index.papers[meta.paper_id] !== undefined) {
      return false; // Already known
    }

    // Create paper directory
    const dir = this.paperDir(meta.paper_id);
    mkdirSync(dir, { recursive: true });

    // Write meta (immutable)
    this.writeJson(join(dir, "meta.json"), {
      ...meta,
      discovered_at: meta.discovered_at || Date.now(),
    });

    // Set initial status
    this.writeJson(join(dir, "status.json"), {
      status: "discovered",
      reason: `Found via ${meta.source}`,
      decided_by: "system",
      updated_at: Date.now(),
    } satisfies PaperStatusRecord);

    // Update index
    index.papers[meta.paper_id] = "discovered";
    this.saveIndex(index);
    return true;
  }

  /**
   * Promote a paper to a new status.
   * discovered → candidate → core (forward only, unless excluding)
   */
  setPaperStatus(
    paperId: string,
    status: PaperStatus,
    reason: string,
    decidedBy = "brain",
    excludeReason?: ExcludeReason,
  ): void {
    const dir = this.paperDir(paperId);
    if (!existsSync(dir)) {
      throw new Error(`Paper not found: ${paperId}`);
    }

    const record: PaperStatusRecord = {
      status,
      reason,
      decided_by: decidedBy,
      updated_at: Date.now(),
    };
    if (excludeReason) {
      record.exclude_reason = excludeReason;
    }
    this.writeJson(join(dir, "status.json"), record);

    // Update index
    const index = this.getIndex();
    index.papers[paperId] = status;
    this.saveIndex(index);
  }

  /**
   * Batch promote: evaluate a list of papers and set their status.
   */
  promotePapers(decisions: Array<{ paper_id: string; status: PaperStatus; reason: string }>): void {
    const index = this.getIndex();
    for (const d of decisions) {
      const dir = this.paperDir(d.paper_id);
      if (!existsSync(dir)) continue;

      this.writeJson(join(dir, "status.json"), {
        status: d.status,
        reason: d.reason,
        decided_by: "brain",
        updated_at: Date.now(),
      } satisfies PaperStatusRecord);

      index.papers[d.paper_id] = d.status;
    }
    this.saveIndex(index);
  }

  // ============================================================
  // Queries — list papers by status
  // ============================================================

  /** Get all paper IDs with a specific status */
  getPaperIds(status?: PaperStatus): string[] {
    const index = this.getIndex();
    if (!status) return Object.keys(index.papers);
    return Object.entries(index.papers)
      .filter(([_, s]) => s === status)
      .map(([id]) => id);
  }

  /** Get full metadata for a paper */
  getPaperMeta(paperId: string): PaperMeta | null {
    const dir = this.paperDir(paperId);
    const path = join(dir, "meta.json");
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    // Normalize: executors may use "id" instead of "paper_id"
    if (!raw.paper_id && raw.id) {
      raw.paper_id = raw.id;
    }
    if (!raw.paper_id) {
      raw.paper_id = paperId;
    }
    return raw;
  }

  /** Get metadata for all papers with a status */
  getPapers(status?: PaperStatus): PaperMeta[] {
    return this.getPaperIds(status)
      .map((id) => this.getPaperMeta(id))
      .filter((m): m is PaperMeta => m !== null);
  }

  /** Get paper status */
  getPaperStatus(paperId: string): PaperStatusRecord | null {
    const path = join(this.paperDir(paperId), "status.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  /** Check if a paper exists (any status) */
  hasPaper(paperId: string): boolean {
    const index = this.getIndex();
    return index.papers[paperId] !== undefined;
  }

  // ============================================================
  // Extraction — structured info from core papers
  // ============================================================

  saveExtraction(paperId: string, extraction: PaperExtraction): void {
    const dir = this.paperDir(paperId);
    if (!existsSync(dir)) {
      throw new Error(`Paper not found: ${paperId}`);
    }
    extraction.extracted_at = Date.now();
    this.writeJson(join(dir, "extraction.json"), extraction);
  }

  getExtraction(paperId: string): PaperExtraction | null {
    const path = join(this.paperDir(paperId), "extraction.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  /** Get all extractions (only from core papers that have been extracted) */
  getAllExtractions(): Array<{ paper_id: string; meta: PaperMeta; extraction: PaperExtraction }> {
    const results: Array<{ paper_id: string; meta: PaperMeta; extraction: PaperExtraction }> = [];
    for (const id of this.getPaperIds("core")) {
      const meta = this.getPaperMeta(id);
      const extraction = this.getExtraction(id);
      if (meta && extraction) {
        results.push({ paper_id: id, meta, extraction });
      }
    }
    return results;
  }

  /** Get core papers that have NOT been extracted yet */
  getUnextractedPapers(): PaperMeta[] {
    return this.getPaperIds("core")
      .filter((id) => !existsSync(join(this.paperDir(id), "extraction.json")))
      .map((id) => this.getPaperMeta(id))
      .filter((m): m is PaperMeta => m !== null);
  }

  /** Get core papers that have NOT been downloaded yet (or have empty source dirs) */
  getUndownloadedPapers(): PaperMeta[] {
    return this.getPaperIds("core")
      .filter((id) => !this.hasDownloadedContent(id))
      .map((id) => this.getPaperMeta(id))
      .filter((m): m is PaperMeta => m !== null);
  }

  /** Check if a paper actually has downloaded content (not just an empty source/ dir) */
  hasDownloadedContent(paperId: string): boolean {
    const sourceDir = join(this.paperDir(paperId), "source");
    if (!existsSync(sourceDir)) return false;
    try {
      const files = readdirSync(sourceDir);
      return files.length > 0;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Notes — agent observations
  // ============================================================

  addNote(paperId: string, observation: string): void {
    const dir = this.paperDir(paperId);
    const path = join(dir, "notes.json");
    const notes: PaperNotes = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : { observations: [], flags: [], related_to: [], updated_at: 0 };

    notes.observations.push(observation);
    notes.updated_at = Date.now();
    this.writeJson(path, notes);
  }

  addFlag(paperId: string, flag: string): void {
    const dir = this.paperDir(paperId);
    const path = join(dir, "notes.json");
    const notes: PaperNotes = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : { observations: [], flags: [], related_to: [], updated_at: 0 };

    if (!notes.flags.includes(flag)) {
      notes.flags.push(flag);
    }
    notes.updated_at = Date.now();
    this.writeJson(path, notes);
  }

  // ============================================================
  // Relations — citations and cross-paper claims
  // ============================================================

  addCitation(from: string, to: string, context?: string): void {
    const path = join(this.dataDir, "relations", "citations.json");
    const edges: CitationEdge[] = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : [];

    // Deduplicate
    if (edges.some((e) => e.from === from && e.to === to)) return;

    edges.push({ from, to, context });
    this.writeJson(path, edges);
  }

  getCitations(): CitationEdge[] {
    const path = join(this.dataDir, "relations", "citations.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  /** Get papers that cite a given paper */
  getCitedBy(paperId: string): string[] {
    return this.getCitations()
      .filter((e) => e.to === paperId)
      .map((e) => e.from);
  }

  /** Get papers that a given paper cites */
  getReferencesOf(paperId: string): string[] {
    return this.getCitations()
      .filter((e) => e.from === paperId)
      .map((e) => e.to);
  }

  addClaim(claim: CrossClaim): void {
    const path = join(this.dataDir, "relations", "claims.json");
    const claims: CrossClaim[] = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : [];

    claims.push({ ...claim, updated_at: Date.now() });
    this.writeJson(path, claims);
  }

  getClaims(): CrossClaim[] {
    const path = join(this.dataDir, "relations", "claims.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  // ============================================================
  // Context generation — feed to Brain
  // ============================================================

  /**
   * Generate a text summary of the knowledge store for the Brain.
   * This is what the Brain reads to understand the current state.
   */
  summarizeForBrain(): string {
    const index = this.getIndex();
    const lines: string[] = [
      `Research: ${index.topic}`,
      `Goal: ${index.goal}`,
      "",
      `Papers: ${index.counts.discovered} discovered, ${index.counts.candidate} candidates, ` +
        `${index.counts.core} core, ${index.counts.excluded} excluded`,
      `Downloaded: ${index.counts.downloaded}, Extracted: ${index.counts.extracted}`,
    ];

    // Core papers with extraction status
    const corePapers = this.getPapers("core");
    if (corePapers.length > 0) {
      lines.push("", "=== Core Papers ===");
      for (const p of corePapers) {
        const hasExtraction = existsSync(join(this.paperDir(p.paper_id), "extraction.json"));
        const hasSource = this.hasDownloadedContent(p.paper_id);
        const flags = [
          hasSource ? "DL" : "no-dl",
          hasExtraction ? "EXT" : "no-ext",
        ].join(",");
        lines.push(
          `  [${flags}] [${p.year || "?"}] ${p.title} (${p.citation_count} cites)`,
        );
      }
    }

    // Candidates waiting for evaluation
    const candidates = this.getPapers("candidate");
    if (candidates.length > 0) {
      lines.push("", `=== ${candidates.length} Candidates awaiting evaluation ===`);
      for (const p of candidates.slice(0, 10)) {
        lines.push(`  [${p.year || "?"}] ${p.title}`);
      }
      if (candidates.length > 10) {
        lines.push(`  ... and ${candidates.length - 10} more`);
      }
    }

    // Discovered but not yet evaluated
    const discovered = this.getPapers("discovered");
    if (discovered.length > 0) {
      lines.push("", `=== ${discovered.length} Discovered (not yet evaluated) ===`);
    }

    // Gaps: core papers without downloads or extractions
    const undownloaded = this.getUndownloadedPapers();
    const unextracted = this.getUnextractedPapers();
    if (undownloaded.length > 0) {
      lines.push("", `=== ${undownloaded.length} core papers NOT downloaded (need download) ===`);
      for (const p of undownloaded) {
        const sourceDir = join(this.paperDir(p.paper_id), "source");
        const hasEmptyDir = existsSync(sourceDir);
        const label = hasEmptyDir ? "FAILED (empty source/)" : "not attempted";
        lines.push(`  [${label}] ${p.paper_id}: ${p.title}`);
        if (p.arxiv_id) lines.push(`    arXiv: ${p.arxiv_id}`);
        if (p.doi) lines.push(`    DOI: ${p.doi}`);
      }
    }
    if (unextracted.length > 0) {
      lines.push("", `=== ${unextracted.length} core papers NOT extracted ===`);
    }

    // Claims for cross-validation
    const claims = this.getClaims();
    if (claims.length > 0) {
      lines.push("", `=== ${claims.length} Cross-paper claims tracked ===`);
      for (const c of claims.slice(0, 5)) {
        lines.push(
          `  "${c.claim.slice(0, 80)}" — ` +
            `${c.supporting.length} support, ${c.contradicting.length} contradict`,
        );
      }
    }

    // Report status
    const reportsDir = join(this.dataDir, "reports");
    const hasTex = existsSync(join(reportsDir, "survey_report.tex"));
    const hasBib = existsSync(join(reportsDir, "references.bib"));
    const hasPdf = existsSync(join(reportsDir, "survey_report.pdf"));
    lines.push("", `Report: tex=${hasTex}, bib=${hasBib}, pdf=${hasPdf}`);

    return lines.join("\n");
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /** Get the directory for a paper */
  paperDir(paperId: string): string {
    const safe = paperId.replace(/[/\\:*?"<>|]/g, "_");
    return join(this.dataDir, "papers", safe);
  }

  /** Get the source directory for a paper (where LaTeX/PDF is stored) */
  paperSourceDir(paperId: string): string {
    return join(this.paperDir(paperId), "source");
  }

  private writeJson(path: string, data: unknown): void {
    const dir = join(path, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }
}
