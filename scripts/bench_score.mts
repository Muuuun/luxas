#!/usr/bin/env tsx
/**
 * bench_score — mechanical scoring of a finished benchmark run.
 *
 * Until now `benchmarks/<bench>/ORACLE.md` had exactly one consumer: the existence
 * check in smoke_benchmarks_discovery.mts. The A/B runner settled every
 * comparison by human blind vote on PDFs, which makes a component ablation
 * unreadable — you cannot ablate four mechanisms and eyeball twelve reports.
 * This is the reader: it turns a finished project dir into a comparable
 * numeric record, so arms can be diffed instead of ranked by taste.
 *
 * Usage:
 *   npx tsx scripts/bench_score.mts <project-dir> [--oracle <bench-dir>] [--json]
 *
 * Two halves, both bench-independent in code:
 *
 *   oracle  — checks declared in the "oracle" fenced block of ORACLE.md.
 *             Prose rubric stays beside it for the human reader; the block is
 *             the machine-readable half of the same claim.
 *   claims  — status distribution from buildClaimTable, which is what the
 *             ablated components are supposed to move. An arm that loses the
 *             blind estimator should lose `corroborated` rows: no second leg,
 *             no corroboration. That is the signal.
 *
 * Exit code is 0 whenever scoring succeeded, including for a bad report — this
 * is an instrument, not a gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { buildClaimTable, type ClaimStatus } from "../src/claims-table.ts";

type Check =
  | { kind: "value"; label: string; target: number; rtol?: number }
  | { kind: "discrepancy"; label: string; a: number; b: number; rtol?: number }
  | { kind: "trap"; label: string; patterns: string[] };

interface CheckResult { kind: string; label: string; pass: boolean; detail: string }

export interface BenchScore {
  project: string;
  bench: string | null;
  completion: { reportTex: boolean; reportPdf: boolean; claimsJson: boolean; experimentsWithResults: number };
  oracle: { checks: CheckResult[]; passed: number; total: number } | null;
  claims: {
    rows: number;
    headline: number;
    byStatus: Record<string, number>;
    headlineByStatus: Record<string, number>;
    corroboratedHeadlineFrac: number | null;
    estimateLegs: number;
  } | null;
  error?: string;
}

/** Vocabulary that counts as the report acknowledging two numbers disagree. */
const DISAGREEMENT_RE =
  /\b(disagree|discrepan\w+|inconsisten\w+|tension|differ\w* by|does not (?:agree|match)|do not (?:agree|match)|factor of|不一致|分歧|相差)\b/i;

function parseOracleBlock(benchDir: string): { checks: Check[]; raw: string } | null {
  const p = join(benchDir, "ORACLE.md");
  if (!existsSync(p)) return null;
  const md = readFileSync(p, "utf8");
  const m = md.match(/```oracle\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  const parsed = JSON.parse(m[1]);
  if (!Array.isArray(parsed?.checks)) throw new Error("oracle block has no checks[] array");
  return { checks: parsed.checks as Check[], raw: m[1] };
}

/** Every number that appears anywhere in the report surface or the claims ledger. */
function harvestNumbers(projectDir: string): number[] {
  const out: number[] = [];
  const tex = join(projectDir, "report", "report.tex");
  if (existsSync(tex)) {
    for (const m of readFileSync(tex, "utf8").matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)) {
      const v = Number(m[0]);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  const cj = join(projectDir, "report", "claims.json");
  if (existsSync(cj)) {
    try {
      const arr = JSON.parse(readFileSync(cj, "utf8"));
      for (const c of Array.isArray(arr) ? arr : []) if (typeof c?.value === "number") out.push(c.value);
    } catch { /* malformed ledger is reported by completion, not here */ }
  }
  return out;
}

function reportText(projectDir: string): string {
  const tex = join(projectDir, "report", "report.tex");
  return existsSync(tex) ? readFileSync(tex, "utf8") : "";
}

function hit(nums: number[], target: number, rtol: number): boolean {
  const tol = Math.abs(target) * rtol;
  return nums.some((n) => Math.abs(n - target) <= tol);
}

function runChecks(checks: Check[], projectDir: string): CheckResult[] {
  const nums = harvestNumbers(projectDir);
  const text = reportText(projectDir);
  return checks.map((c): CheckResult => {
    if (c.kind === "value") {
      const rtol = c.rtol ?? 0.1;
      const ok = hit(nums, c.target, rtol);
      return { kind: c.kind, label: c.label, pass: ok, detail: ok ? `found ${c.target} +/-${rtol * 100}%` : `no number within ${rtol * 100}% of ${c.target}` };
    }
    if (c.kind === "discrepancy") {
      const rtol = c.rtol ?? 0.1;
      const ha = hit(nums, c.a, rtol);
      const hb = hit(nums, c.b, rtol);
      const flagged = DISAGREEMENT_RE.test(text);
      const ok = ha && hb && flagged;
      const missing = [!ha && `${c.a}`, !hb && `${c.b}`, !flagged && "no disagreement language"].filter(Boolean).join(", ");
      return { kind: c.kind, label: c.label, pass: ok, detail: ok ? `both values present and disagreement flagged` : `missing: ${missing}` };
    }
    // trap: passing means the trap was AVOIDED
    const firedBy = c.patterns.filter((p) => new RegExp(p, "i").test(text));
    return { kind: c.kind, label: c.label, pass: firedBy.length === 0, detail: firedBy.length === 0 ? "trap not triggered" : `matched: ${firedBy.join(" | ")}` };
  });
}

function countExperimentsWithResults(projectDir: string): number {
  const root = join(projectDir, "data", "experiments");
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const e of readdirSync(root)) {
    const runs = join(root, e, "runs");
    if (!existsSync(runs) || !statSync(runs).isDirectory()) continue;
    if (readdirSync(runs).some((r) => existsSync(join(runs, r, "results.json")))) n++;
  }
  return n;
}

export function scoreBench(projectDir: string, benchDir?: string): BenchScore {
  const score: BenchScore = {
    project: projectDir,
    bench: benchDir ? basename(benchDir) : null,
    completion: {
      reportTex: existsSync(join(projectDir, "report", "report.tex")),
      reportPdf: existsSync(join(projectDir, "report", "report.pdf")),
      claimsJson: existsSync(join(projectDir, "report", "claims.json")),
      experimentsWithResults: countExperimentsWithResults(projectDir),
    },
    oracle: null,
    claims: null,
  };

  if (benchDir) {
    const blk = parseOracleBlock(benchDir);
    if (blk) {
      const checks = runChecks(blk.checks, projectDir);
      score.oracle = { checks, passed: checks.filter((c) => c.pass).length, total: checks.length };
    }
  }

  try {
    const table = buildClaimTable(projectDir);
    const headlineSet = new Set(table.headline);
    const byStatus: Record<string, number> = {};
    const headlineByStatus: Record<string, number> = {};
    let legs = 0;
    for (const r of table.rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      legs += r.estimates.length;
      if (headlineSet.has(r.id)) headlineByStatus[r.status] = (headlineByStatus[r.status] ?? 0) + 1;
    }
    const hTotal = Object.values(headlineByStatus).reduce((a, b) => a + b, 0);
    score.claims = {
      rows: table.rows.length,
      headline: hTotal,
      byStatus,
      headlineByStatus,
      corroboratedHeadlineFrac: hTotal === 0 ? null : (headlineByStatus["corroborated"] ?? 0) / hTotal,
      estimateLegs: legs,
    };
  } catch (err) {
    score.error = `claim table: ${(err as Error).message}`;
  }
  return score;
}

function render(s: BenchScore): string {
  const L: string[] = [];
  L.push(`project: ${s.project}${s.bench ? `   bench: ${s.bench}` : ""}`);
  const c = s.completion;
  L.push(`completion: tex=${c.reportTex} pdf=${c.reportPdf} claims.json=${c.claimsJson} experiments_with_results=${c.experimentsWithResults}`);
  if (s.oracle) {
    L.push(`oracle: ${s.oracle.passed}/${s.oracle.total}`);
    for (const r of s.oracle.checks) L.push(`  [${r.pass ? "PASS" : "FAIL"}] ${r.kind}: ${r.label} — ${r.detail}`);
  } else {
    L.push("oracle: (no machine-readable block; add an oracle fence to ORACLE.md)");
  }
  if (s.claims) {
    const q = s.claims;
    const frac = q.corroboratedHeadlineFrac === null ? "n/a" : `${(q.corroboratedHeadlineFrac * 100).toFixed(0)}%`;
    L.push(`claims: rows=${q.rows} headline=${q.headline} estimate_legs=${q.estimateLegs} corroborated_headline=${frac}`);
    L.push(`  all:      ${JSON.stringify(q.byStatus)}`);
    L.push(`  headline: ${JSON.stringify(q.headlineByStatus)}`);
  }
  if (s.error) L.push(`error: ${s.error}`);
  return L.join("\n");
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const json = args.includes("--json");
  const oi = args.indexOf("--oracle");
  const benchDir = oi >= 0 ? args[oi + 1] : undefined;
  const projectDir = args.find((a) => !a.startsWith("--") && a !== benchDir);
  if (!projectDir) {
    console.error("usage: bench_score.mts <project-dir> [--oracle <bench-dir>] [--json]");
    process.exit(2);
  }
  const s = scoreBench(projectDir, benchDir);
  console.log(json ? JSON.stringify(s, null, 2) : render(s));
}
