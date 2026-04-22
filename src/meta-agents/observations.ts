/**
 * Schema + validator for the meta-state JSONL logs that reflect_light writes
 * and reflect consumes. Manual validation (no Zod dep) — 30 lines, pinning
 * the contract between the two agents so malformed writes don't silently
 * poison deep review.
 *
 * Parse semantics: read a file line-by-line, skip+log malformed lines,
 * return the valid subset. A corrupt line should never crash downstream.
 */

import { readFileSync, existsSync } from "node:fs";

// ── Observation (written by reflect_light) ──────────────────────────────

export type SessionOutcome = "clean_finish" | "degraded_finish" | "stuck";

export interface Observation {
  ts: string;
  session_id: string;
  outcome: SessionOutcome;
  pattern: string;
  evidence: string;
  proposed_target: string;
}

const OUTCOMES: readonly SessionOutcome[] = ["clean_finish", "degraded_finish", "stuck"];

export function parseObservation(line: string): Observation | null {
  let obj: any;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.ts !== "string") return null;
  if (typeof obj.session_id !== "string") return null;
  if (!OUTCOMES.includes(obj.outcome)) return null;
  if (typeof obj.pattern !== "string" || obj.pattern.length === 0) return null;
  if (typeof obj.evidence !== "string") return null;
  if (typeof obj.proposed_target !== "string") return null;
  return obj as Observation;
}

// ── Support signal (written by reflect_light when it matches pending) ────

export interface SupportSignal {
  ts: string;
  session_id: string;
  pending_rev: string;
  item_ref: string;
}

export function parseSupport(line: string): SupportSignal | null {
  let obj: any;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.ts !== "string") return null;
  if (typeof obj.session_id !== "string") return null;
  if (typeof obj.pending_rev !== "string") return null;
  if (typeof obj.item_ref !== "string") return null;
  return obj as SupportSignal;
}

// ── JSONL file readers ───────────────────────────────────────────────────

export interface LoadResult<T> {
  valid: T[];
  skipped: number;
  skippedLines: string[];
}

export function loadObservations(path: string): LoadResult<Observation> {
  return loadJsonl(path, parseObservation);
}

export function loadSupport(path: string): LoadResult<SupportSignal> {
  return loadJsonl(path, parseSupport);
}

function loadJsonl<T>(path: string, parse: (line: string) => T | null): LoadResult<T> {
  if (!existsSync(path)) return { valid: [], skipped: 0, skippedLines: [] };
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const valid: T[] = [];
  const skippedLines: string[] = [];
  for (const line of lines) {
    const parsed = parse(line);
    if (parsed) valid.push(parsed);
    else skippedLines.push(line);
  }
  return { valid, skipped: skippedLines.length, skippedLines };
}
