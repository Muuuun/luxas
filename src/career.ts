/**
 * The career layer: the user's entire project history as accumulated
 * research identity — findings, corrections, open leads, and standards —
 * harvested MECHANICALLY from the structured artifacts each project already
 * produces, and injected as state (mechanism-ladder rung 5) into new runs.
 *
 * Why this exists (2026-08-25): the per-run dynamics now resemble a
 * researcher's week — premise tested, surprise chased, synthesis owned — but
 * nothing resembled a researcher's YEAR. A human carries "blockade-limited
 * at high n" into their next five projects; Luxas re-derived its own prior
 * results from zero. The raw material was already structured: claims.json
 * (graded findings), computed.premise_corrections (what the runs proved
 * wrong), FollowUp leads (the untaken forks). A career is a generated view
 * over them — same principle as the claim registry: harvest, never
 * hand-maintain; provenance on every line.
 *
 * Trust discipline is inherited from <past_research>: every career line is a
 * dated, INHERITED-UNVERIFIED lead. It shapes priors and Fermi estimates; it
 * enters a report only through this project's own evidence chain — the
 * finish gates enforce that independently.
 *
 * Layout (~/.sisyphus/career/):
 *   findings.jsonl     {project, date, claim_key, value, grade, text}
 *   corrections.jsonl  {project, date, premise, corrected, consequence}
 *   leads.jsonl        {project, date, lead_id, question}
 *   standards.md       standing review standards — the user's accumulated
 *                      dissatisfactions, appendable without code changes
 *                      (the "advisor memory": v1 of the 297nm report was
 *                      sound and insufficient, and only the USER noticed)
 *   harvested.json     project paths already harvested (idempotence)
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFollowUps, readFileSafe } from "./utils.js";
import { listExperimentDirs } from "./tools/report-integrity.js";

const CAREER_DIR = join(homedir(), ".sisyphus", "career");
const FINDINGS = join(CAREER_DIR, "findings.jsonl");
const CORRECTIONS = join(CAREER_DIR, "corrections.jsonl");
const LEADS = join(CAREER_DIR, "leads.jsonl");
const STANDARDS = join(CAREER_DIR, "standards.md");
const HARVESTED = join(CAREER_DIR, "harvested.json");

function ensureDir(): void { mkdirSync(CAREER_DIR, { recursive: true }); }

function loadHarvested(): string[] {
  try { return JSON.parse(readFileSync(HARVESTED, "utf-8")); } catch { return []; }
}

/** Harvest one finished project into the career ledgers. Idempotent. */
export function harvestCareer(projectDir: string): { findings: number; corrections: number; leads: number } | null {
  ensureDir();
  const done = loadHarvested();
  if (done.includes(projectDir)) return null;

  const research = readFileSafe(join(projectDir, "RESEARCH.md"));
  const name = (research.match(/^#\s+(.{1,90})/m)?.[1] ?? projectDir.split("/").pop() ?? "?").trim();
  const date = new Date().toISOString().slice(0, 10);
  let nf = 0, nc = 0, nl = 0;

  try {
    const cj = JSON.parse(readFileSafe(join(projectDir, "report", "claims.json")) || "[]");
    for (const c of (Array.isArray(cj) ? cj : [])) {
      if (!c || typeof c !== "object") continue;
      appendFileSync(FINDINGS, JSON.stringify({
        project: name, date, claim_key: c.claim_key ?? null, value: c.value ?? null,
        grade: c.grade ?? null, text: String(c.tex_context ?? "").slice(0, 200),
      }) + "\n");
      nf++;
    }
  } catch { /* no claims manifest — older project */ }

  for (const e of listExperimentDirs(projectDir)) {
    if (!e.latestResults) continue;
    try {
      const j = JSON.parse(readFileSync(e.latestResults, "utf-8"));
      for (const pc of (j?.computed?.premise_corrections ?? [])) {
        if (!pc || typeof pc !== "object") continue;
        appendFileSync(CORRECTIONS, JSON.stringify({
          project: name, date, premise: String(pc.premise ?? "").slice(0, 250),
          corrected: String(pc.corrected ?? "").slice(0, 250),
          consequence: String(pc.consequence ?? "").slice(0, 250),
        }) + "\n");
        nc++;
      }
    } catch { /* malformed elsewhere */ }
  }

  const ledger = readFileSafe(join(projectDir, "notes", "experiments.md"));
  if (ledger) {
    const ran = new Set<number>();
    for (const m of ledger.matchAll(/^##\s+(?:L2\.|E_?)(\d+)\b/gm)) ran.add(parseInt(m[1], 10));
    for (const l of parseFollowUps(ledger)) {
      if (l.isNone || ran.has(l.num)) continue;
      appendFileSync(LEADS, JSON.stringify({
        project: name, date, lead_id: l.leadId, question: String(l.question ?? "").slice(0, 250),
      }) + "\n");
      nl++;
    }
  }

  writeFileSync(HARVESTED, JSON.stringify([...done, projectDir], null, 1));
  return { findings: nf, corrections: nc, leads: nl };
}

/** Significant-token overlap match: no embeddings by design (CLAUDE.md). */
function tokens(t: string): Set<string> {
  return new Set(t.toLowerCase().replace(/[^a-z0-9一-鿿 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0; for (const x of a) if (b.has(x)) n++; return n;
}

function readJsonl(p: string): any[] {
  const out: any[] = [];
  try {
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip bad line */ }
    }
  } catch { /* absent */ }
  return out;
}

/**
 * Build the <career> block for a new project's semi-static context: the
 * findings, corrections, and open leads from ALL past projects that touch
 * this research question, plus the standing standards verbatim.
 */
export function buildCareerBlock(researchText: string, cap = 7000): string {
  const q = tokens(researchText);
  const pick = (rows: any[], text: (r: any) => string, min = 2) =>
    rows.map((r) => ({ r, s: overlap(q, tokens(text(r))) }))
      .filter((x) => x.s >= min).sort((a, b) => b.s - a.s).map((x) => x.r);

  const findings = pick(readJsonl(FINDINGS), (r) => `${r.text} ${r.claim_key ?? ""} ${r.project}`).slice(0, 12);
  const corrections = pick(readJsonl(CORRECTIONS), (r) => `${r.premise} ${r.corrected} ${r.project}`, 2).slice(0, 6);
  const leads = pick(readJsonl(LEADS), (r) => `${r.question} ${r.project}`, 2).slice(0, 8);
  const standards = readFileSafe(STANDARDS).trim();

  if (findings.length + corrections.length + leads.length === 0 && !standards) return "";
  const parts: string[] = [];
  if (findings.length) {
    parts.push("## Established findings (INHERITED-UNVERIFIED — priors and Fermi anchors, never report citations; re-derive through this project's evidence chain)\n" +
      findings.map((r) => `- [${r.project}, ${r.date}] ${r.text}${r.value !== null ? ` (= ${r.value}, grade ${r.grade})` : ""}`).join("\n"));
  }
  if (corrections.length) {
    parts.push("## Corrections you have already paid for (do not re-assume the premise)\n" +
      corrections.map((r) => `- [${r.project}, ${r.date}] believed: ${r.premise} → corrected: ${r.corrected}`).join("\n"));
  }
  if (leads.length) {
    parts.push("## Career frontier (open leads no project has run)\n" +
      leads.map((r) => `- [${r.project}, ${r.date}] ${r.lead_id}: ${r.question}`).join("\n"));
  }
  if (standards) {
    parts.push("## Standing standards (the user's accumulated review bar — binding)\n" + standards.slice(0, 2000));
  }
  let body = parts.join("\n\n");
  if (body.length > cap) body = body.slice(0, cap) + "\n…(career truncated at cap — ledgers at ~/.sisyphus/career/)";
  return `<career>\nThis user's research history, harvested from ${""}past projects' structured artifacts. It is who you have been.\n\n${body}\n</career>`;
}

/** Standards are the durable channel for user dissatisfaction — appended as
 * data, no code change. Injected into brain AND the PI reviewer. */
export function readCareerStandards(): string {
  return readFileSafe(STANDARDS).trim();
}
