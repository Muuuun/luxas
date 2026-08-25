/**
 * Research dynamics as STATE, not prose — the three mechanisms the human-trace
 * literature (notes/human-researcher-trace.md, 2026-08-25) says a top
 * researcher runs and measured AI agents lack. Each is a typed channel:
 * the experiment records a structured field in results.json; the block below
 * surfaces it, untruncated, in the brain's per-turn snapshot (and read-only in
 * the experiment's context) until an explicit disposition is recorded. Same
 * pattern as premise_corrections / research_frontier: prose parks, state
 * interrupts. Everything here is deterministic over equal disk state — no
 * timestamps, no elapsed counters — so the L3 cache equality holds.
 *
 *  1. stopping_signal   — epistemic stopping rule. Zero published systems have
 *     one; all stop on budget (PaperBench: "all agents failed to strategize";
 *     RE-Bench: 4× human at 2h → ½ human at 32h). Galison: an experiment ends
 *     when the result "would stand up in court" = the next iteration cannot
 *     move the verdict. Encoded: two consecutive runs whose headline moved by
 *     less than the acceptance criterion's resolution → forced fork
 *     ship / change-hypothesis / change-experiment-space (Klahr & Dunbar's
 *     dual-space switch is the third arm).
 *
 *  2. undispositioned_anomalies — surprise as control signal (KEKADA on Krebs;
 *     Dunbar: 176 vs 23 group interactions on unexpected vs expected results)
 *     with Dunbar's gating: a peripheral anomaly may be PARKED with a reason,
 *     one that touches the headline must be PURSUED or EXPLAINED. Re-surfaced
 *     every turn because anomaly detection decays over horizon ("cognitive
 *     tunneling", InquiTree 2026) — the block re-primes what attention drops.
 *
 *  3. iteration_lineage — cycle compression over rebuild (Yin et al. 2019,
 *     Nature 575: winners and losers fail equally often; losers "made more,
 *     albeit unnecessary modifications to what were otherwise advantageous
 *     experiences"). A run_N≥1 that inherits nothing from a run that produced
 *     a verdict is the measured loser pattern. Warning tier: surfaced, not
 *     gated.
 *
 * Producer contract (results.json, written by the experiment in Phase 3):
 *   computed.iteration = { headline_key, headline_value, resolution,
 *                          inherited_from: "run_M" | null, kept: [..], changed: [..] }
 *   computed.anomalies = [{ observable, predicted, observed, affects_headline,
 *                           disposition?: "pursued"|"explained"|"parked", reason? }]
 * Brain-side dispositions (notes/memory.md):
 *   STOP-ACK: <EID>@run_<N> — ship|change-hypothesis|change-experiment-space: <why>
 *   ANOMALY-ACK: <EID>#<idx> — pursued|explained|parked: <why>
 */

import { join } from "node:path";
import { readFileSafe } from "./utils.js";
import { listExperimentDirs, listExperimentRuns, type ExperimentRun } from "./tools/report-integrity.js";

const s = (v: unknown, n: number) => String(v ?? "?").slice(0, n);

function memoryOf(projectDir: string): string {
  return readFileSafe(join(projectDir, "notes", "memory.md")) ?? "";
}

function iterationOf(run: ExperimentRun): any | null {
  const it = run.results?.computed?.iteration;
  return it && typeof it === "object" ? it : null;
}

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

// ── 1. Epistemic stopping ──────────────────────────────────────────────────

export interface Plateau { id: string; latestRun: number; key: string; values: number[]; resolution: number }

/** Experiments whose last two headline deltas both fall under the criterion's resolution. */
export function detectPlateaus(projectDir: string): Plateau[] {
  const out: Plateau[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    const runs = listExperimentRuns(e.dir);
    if (runs.length < 3) continue;
    const tail = runs.slice(-3).map(iterationOf);
    if (tail.some(it => !it)) continue;
    const vals = tail.map(it => num(it.headline_value));
    const res = num(tail[2].resolution);
    if (vals.some(v => v === null) || res === null || res <= 0) continue;
    const [a, b, c] = vals as number[];
    if (Math.abs(b - a) < res && Math.abs(c - b) < res) {
      out.push({ id: e.id, latestRun: runs[runs.length - 1].n, key: s(tail[2].headline_key, 80), values: [a, b, c], resolution: res });
    }
  }
  return out;
}

export function buildStoppingSignal(projectDir: string): string {
  try {
    const memory = memoryOf(projectDir);
    const rows = detectPlateaus(projectDir)
      .filter(p => !memory.includes(`STOP-ACK: ${p.id}@run_${p.latestRun}`))
      .map(p => `- [${p.id}@run_${p.latestRun}] ${p.key}: ${p.values.join(" → ")} (resolution ${p.resolution})`);
    if (rows.length === 0) return "";
    return `<stopping_signal priority="high">\n` +
      `The last TWO iterations of these experiments moved the headline by less than the acceptance\n` +
      `criterion's resolution: the next iteration cannot change the verdict. Iterating the same design\n` +
      `again is spending budget, not doing research. Before any re-spawn of the experiment, record in\n` +
      `notes/memory.md exactly one of:\n` +
      `  STOP-ACK: <EID>@run_<N> — ship: <the verdict stands as evidence>\n` +
      `  STOP-ACK: <EID>@run_<N> — change-hypothesis: <the frame is wrong; new hypothesis>\n` +
      `  STOP-ACK: <EID>@run_<N> — change-experiment-space: <no frame fits; run a hypothesis-free sweep and induce>\n` +
      `A later run_N+1 re-opens this decision under a new key.\n\n${rows.join("\n")}\n</stopping_signal>`;
  } catch {
    return "";
  }
}

// ── 2. Anomaly disposition ─────────────────────────────────────────────────

export interface OpenAnomaly {
  id: string; idx: number; observable: string; predicted: string; observed: string;
  affectsHeadline: boolean; disposition: string | null; reason: string | null;
}

/** Anomalies lacking a disposition, plus PARKED ones that touch the headline (Dunbar's gate). */
export function listOpenAnomalies(projectDir: string): OpenAnomaly[] {
  const memory = memoryOf(projectDir);
  const out: OpenAnomaly[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    if (!e.latestResults) continue;
    let j: any;
    try { j = JSON.parse(readFileSafe(e.latestResults) ?? ""); } catch { continue; }
    const list = j?.computed?.anomalies;
    if (!Array.isArray(list)) continue;
    list.forEach((a: any, idx: number) => {
      if (!a || typeof a !== "object") return;
      if (memory.includes(`ANOMALY-ACK: ${e.id}#${idx}`)) return;
      const disposition = typeof a.disposition === "string" ? a.disposition : null;
      const affectsHeadline = a.affects_headline === true;
      const open = disposition === null
        || !["pursued", "explained", "parked"].includes(disposition)
        || (disposition === "parked" && affectsHeadline);
      if (!open) return;
      out.push({
        id: e.id, idx, observable: s(a.observable, 100), predicted: s(a.predicted, 80), observed: s(a.observed, 80),
        affectsHeadline, disposition, reason: typeof a.reason === "string" ? a.reason.slice(0, 160) : null,
      });
    });
  }
  return out;
}

export function buildUndispositionedAnomalies(projectDir: string, audience: "brain" | "experiment" = "brain"): string {
  try {
    const open = listOpenAnomalies(projectDir);
    if (open.length === 0) return "";
    const rows = open.map(a =>
      `- [${a.id}#${a.idx}]${a.affectsHeadline ? " HEADLINE" : ""} ${a.observable}: predicted ${a.predicted}, observed ${a.observed}` +
      (a.disposition ? `\n    recorded disposition: ${a.disposition}${a.reason ? ` — ${a.reason}` : ""} (parked anomalies that affect the headline are NOT closable by parking)` : "\n    no disposition recorded")
    );
    const how = audience === "experiment"
      ? `Close each by writing "disposition" ("pursued" | "explained" | "parked") and "reason" on the entry\n` +
        `in results.json. "parked" is legal only for entries with affects_headline=false; an entry that\n` +
        `touches the headline must be pursued (a run that tests it) or explained (a mechanism, with evidence).`
      : `Close each by a line in notes/memory.md:\n` +
        `  ANOMALY-ACK: <EID>#<idx> — pursued|explained|parked: <why>\n` +
        `"parked" is legal only for entries that do NOT affect a headline. A HEADLINE anomaly is either\n` +
        `pursued (dispatch the run) or explained (name the mechanism and where its evidence lives).`;
    return `<undispositioned_anomalies priority="high">\n` +
      `Results that deviated from their prediction and have no disposition. This is the surprise\n` +
      `channel: an unexpected result sets the goal "explain this" — it is not a Limitations footnote.\n` +
      `${how}\nEntries stay here every turn until closed; attention to anomalies decays with run length,\n` +
      `this block does not.\n\n${rows.join("\n")}\n</undispositioned_anomalies>`;
  } catch {
    return "";
  }
}

// ── 3. Iteration lineage ───────────────────────────────────────────────────

export interface LineageRow { id: string; run: number; inheritedFrom: string | null; kept: string[]; rebuild: boolean; untracked: boolean }

export function listLineage(projectDir: string): LineageRow[] {
  const out: LineageRow[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    const runs = listExperimentRuns(e.dir);
    if (runs.length < 2) continue;
    for (let i = 1; i < runs.length; i++) {
      const it = iterationOf(runs[i]);
      const prevVerdict = String(runs[i - 1].results?.verdict ?? "");
      const prevHadResult = ["confirmed", "refuted", "inconclusive"].includes(prevVerdict) || runs[i - 1].results?.computed !== undefined;
      const inheritedFrom = typeof it?.inherited_from === "string" ? it.inherited_from : null;
      const kept = Array.isArray(it?.kept) ? it.kept.map((k: unknown) => s(k, 60)) : [];
      out.push({
        id: e.id, run: runs[i].n, inheritedFrom, kept,
        untracked: it === null,
        rebuild: it !== null && inheritedFrom === null && prevHadResult,
      });
    }
  }
  return out;
}

export function buildIterationLineage(projectDir: string): string {
  try {
    const rows = listLineage(projectDir);
    if (rows.length === 0) return "";
    const lines = rows.map(r => {
      const tag = r.rebuild ? " [REBUILD]" : r.untracked ? " [UNTRACKED]" : "";
      const body = r.untracked ? "no computed.iteration recorded"
        : r.inheritedFrom ? `inherits ${r.inheritedFrom}; kept: ${r.kept.length ? r.kept.join(", ") : "(none listed)"}`
        : "inherits nothing";
      return `- [${r.id} run_${r.run}]${tag} ${body}`;
    });
    const flagged = rows.filter(r => r.rebuild).length;
    return `<iteration_lineage>\n` +
      `What each re-run of an experiment carried over from the run before it. The measured loser\n` +
      `pattern is not failing more often — it is discarding what already worked and rebuilding. A\n` +
      `[REBUILD] run inherited nothing from a run that had produced a verdict; when re-spawning, name\n` +
      `in the task what is inherited (pipeline, calibration, data, passing tests) and what changes.\n` +
      (flagged ? `${flagged} rebuild(s) flagged.\n` : "") +
      `\n${lines.join("\n")}\n</iteration_lineage>`;
  } catch {
    return "";
  }
}
