#!/usr/bin/env tsx
/**
 * bench_compare — the reader of benchmarks/LEDGER.jsonl.
 *
 * Turns the runs recorded by bench_run.mts into the one table the project has
 * been missing: per bench, each arm's oracle score, cost and wall time, side by
 * side. This is what "a change needs a number" points at.
 *
 * Usage:
 *   npx tsx scripts/bench_compare.mts [--ledger <file>] [--json] [--latest]
 *
 * --latest  use only each arm's most recent run per bench (default: all runs,
 *           reporting the mean and the spread — with n=1 a difference of one
 *           check is not a result, and the table says so).
 */
import { existsSync, readFileSync } from "node:fs";
import { LEDGER, type LedgerRecord } from "./bench_run.mts";

export function readLedger(path = LEDGER): LedgerRecord[] {
  if (!existsSync(path)) return [];
  const out: LedgerRecord[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return out;
}

export interface Cell {
  n: number;
  /** Mean fraction of oracle checks passed, 0..1. */
  score: number;
  scoreMin: number;
  scoreMax: number;
  /** Runs that produced a report at all. */
  reports: number;
  costUsd: number | null;
  wallSec: number | null;
  exits: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** The model that did the work: the first of a "+"-joined list (bench_run records the costliest first). */
const primaryModel = (r: LedgerRecord) => {
  const model = r.model ? r.model.split("+")[0] : "model not recorded";
  // A luxas run's executor and models also come from the routing variables it inherited: part of what the column is.
  const routing = Object.entries(r.routing ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k.replace(/^LUXAS_/, "").toLowerCase()}=${v}`).join(" ");
  return routing ? `${model}; ${routing}` : model;
};

/**
 * The column a run belongs to. An arm is one column while every run of it used
 * one model, and one column per model once it has been seen on two. On
 * 2026-10-09 three claude-code runs went out on Fable 5.1 and landed in the
 * column of twelve Opus 5.5 runs: "ALL n=15" was a mean over two models, and
 * three benches read as measured on a model that had never finished them.
 */
export function columnOf(all: LedgerRecord[]): (r: LedgerRecord) => string {
  const models = new Map<string, Set<string>>();
  for (const r of all) (models.get(r.arm) ?? models.set(r.arm, new Set()).get(r.arm)!).add(primaryModel(r));
  return (r) => (models.get(r.arm)!.size > 1 ? `${r.arm} (${primaryModel(r)})` : r.arm);
}

/** `arms` are the table's columns: see columnOf. */
export function summarize(all: LedgerRecord[], opts: { latest?: boolean } = {}): { benches: string[]; arms: string[]; cells: Record<string, Record<string, Cell>>; overall: Record<string, Cell>; aborted: (LedgerRecord & { column: string })[]; mixedEffort: Record<string, string[]> } {
  const col = columnOf(all);
  // A run the provider ended (billing, outage) says nothing about the arm, pass
  // or fail: counting only the ones that happened to pass would bias the mean
  // upward. They are listed under the table and left out of every cell.
  const aborted = all.filter((r) => r.aborted).map((r) => ({ ...r, column: col(r) }));
  const records = all.filter((r) => !r.aborted);
  const by = new Map<string, LedgerRecord[]>();
  for (const r of records) {
    const k = `${r.bench}\u0000${col(r)}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(r);
  }
  const cell = (rs: LedgerRecord[]): Cell => {
    const frac = rs.map((r) => (r.oracleTotal ? r.oraclePassed / r.oracleTotal : 0));
    const costs = rs.map((r) => r.costUsd).filter((c): c is number => typeof c === "number");
    const walls = rs.map((r) => r.wallSec).filter((c): c is number => typeof c === "number");
    const exits: Record<string, number> = {};
    for (const r of rs) exits[r.exit] = (exits[r.exit] ?? 0) + 1;
    return { n: rs.length, score: mean(frac), scoreMin: Math.min(...frac), scoreMax: Math.max(...frac), reports: rs.filter((r) => r.reportTex).length,
      costUsd: costs.length ? mean(costs) : null, wallSec: walls.length ? mean(walls) : null, exits };
  };
  const benches = [...new Set(records.map((r) => r.bench))].sort();
  const arms = [...new Set(records.map(col))].sort();
  const cells: Record<string, Record<string, Cell>> = {};
  const perArm: Record<string, LedgerRecord[]> = {};
  for (const b of benches) {
    cells[b] = {};
    for (const a of arms) {
      let rs = by.get(`${b}\u0000${a}`) ?? [];
      if (opts.latest && rs.length) rs = [rs.reduce((x, y) => (x.ts >= y.ts ? x : y))];
      if (!rs.length) continue;
      cells[b][a] = cell(rs);
      (perArm[a] ??= []).push(...rs);
    }
  }
  const overall: Record<string, Cell> = {};
  for (const a of arms) if (perArm[a]?.length) overall[a] = cell(perArm[a]);
  // bench_run records --effort since 2026-10-09. Rows before that carry none
  // and are left out of this test: what they ran at is not known from the row.
  const mixedEffort: Record<string, string[]> = {};
  for (const a of arms) {
    const seen = [...new Set((perArm[a] ?? []).map((r) => r.effort).filter((e): e is string => !!e))].sort();
    if (seen.length > 1) mixedEffort[a] = seen;
  }
  return { benches, arms, cells, overall, aborted, mixedEffort };
}

function fmt(c: Cell | undefined): string {
  if (!c) return "—";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const spread = c.n > 1 && c.scoreMin !== c.scoreMax ? ` (${pct(c.scoreMin)}–${pct(c.scoreMax)})` : "";
  const cost = c.costUsd === null ? "$?" : `$${c.costUsd.toFixed(2)}`;
  const wall = c.wallSec === null ? "?" : `${Math.round(c.wallSec / 60)}m`;
  return `${pct(c.score)}${spread} n=${c.n} ${cost} ${wall}${c.reports < c.n ? ` [${c.n - c.reports} no report]` : ""}`;
}

export function render(s: ReturnType<typeof summarize>): string {
  const cut = s.aborted.map((r) => `  ${r.column}/${r.bench}: ${r.oraclePassed}/${r.oracleTotal} when it was cut off after ${r.wallSec ?? "?"}s ("${r.aborted}")`);
  const cutLines = cut.length ? ["", "not counted — the provider ended these runs; run them again:", ...cut] : [];
  if (!s.benches.length) return ["ledger is empty — run scripts/bench_run.mts first", ...cutLines].join("\n");
  const head = ["bench", ...s.arms];
  const rows = s.benches.map((b) => [b, ...s.arms.map((a) => fmt(s.cells[b][a]))]);
  rows.push(["ALL", ...s.arms.map((a) => fmt(s.overall[a]))]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((x, i) => x.padEnd(w[i])).join("  ");
  const out = [line(head), w.map((n) => "-".repeat(n)).join("  "), ...rows.map(line)];
  out.push("", "score = mean fraction of ORACLE.md checks passed; cost and wall are per-run means.");
  const thin = s.arms.filter((a) => s.benches.some((b) => (s.cells[b][a]?.n ?? 0) === 1));
  if (thin.length) out.push(`n=1 cells present (${thin.join(", ")}): a one-check difference there is inside run-to-run noise, not a result.`);
  const missing = s.benches.flatMap((b) => s.arms.filter((a) => !s.cells[b][a]).map((a) => `${a}/${b}`));
  if (missing.length) out.push(`not yet run: ${missing.join(", ")}`);
  for (const [a, efforts] of Object.entries(s.mixedEffort)) out.push(`mixed effort in ${a}: runs at ${efforts.join(" and ")} share this column, so its mean is over two settings (rows before 2026-10-09 recorded none).`);
  out.push(...cutLines);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const li = argv.indexOf("--ledger");
  const s = summarize(readLedger(li >= 0 ? argv[li + 1] : LEDGER), { latest: argv.includes("--latest") });
  console.log(argv.includes("--json") ? JSON.stringify(s, null, 2) : render(s));
}
