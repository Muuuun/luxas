#!/usr/bin/env tsx
/**
 * bench_run — run one ARM on the known-answer benches and record the number.
 *
 * The question this exists to answer, before any more harness is built: on the
 * same task, with the same deliverable, does Luxas beat a bare coding agent?
 * Until 2026-10-05 nothing measured it. benchmarks/ had oracles and a scorer,
 * but the only runner (reflect_ab.mts) compared Luxas against Luxas and
 * settled it by human vote on PDFs.
 *
 * Arms:
 *   claude-code   `claude -p` in an empty directory holding only RESEARCH.md.
 *                 No Luxas prompt, agents, gates or tools — the baseline.
 *   luxas         `luxas run` on the same directory (this checkout).
 *
 * Both arms get the same request and never see ORACLE.md: the run directory is
 * created outside the repo and only RESEARCH.md is copied into it.
 *
 * Every run appends one record to benchmarks/LEDGER.jsonl. Reader:
 * scripts/bench_compare.mts.
 *
 * Usage:
 *   npx tsx scripts/bench_run.mts --arm claude-code [--bench bench-01-u233-gamow|all]
 *        [--max-usd 3] [--model <id>] [--timeout-min 40] [--runs-dir <dir>] [--dry-run]
 *   npx tsx scripts/bench_run.mts --record <run-dir> --arm <arm> --bench <bench>
 *        [--cost <usd>] [--wall-sec <n>] [--model <id>]      # score a run made elsewhere (e.g. the droplet)
 *
 * This spends real money. --dry-run prints the plan and calls nothing.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBench } from "./bench_score.mts";
import { readUsageTotals } from "../src/usage-log.js";
import { readLastExit } from "../src/exit-state.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH_ROOT = join(ROOT, "benchmarks");
export const LEDGER = join(BENCH_ROOT, "LEDGER.jsonl");
export const ARMS = ["claude-code", "luxas"] as const;
export type Arm = (typeof ARMS)[number];

export interface LedgerRecord {
  ts: string;
  arm: string;
  bench: string;
  /** Short commit of this checkout, "+dirty" when the tree had uncommitted changes. */
  commit: string;
  model: string | null;
  costUsd: number | null;
  wallSec: number | null;
  /** How the run ended: the CLI's result subtype for claude-code, the exit kind (exit-state.ts) for luxas. */
  exit: string;
  reportTex: boolean;
  reportPdf: boolean;
  oraclePassed: number;
  oracleTotal: number;
  checks: Array<{ label: string; pass: boolean }>;
  runDir: string;
  note?: string;
}

/**
 * The deliverable contract, identical in substance to what Luxas produces, so
 * the scorer reads both arms the same way. Nothing here tells the baseline HOW
 * to do the science — that is the variable under test.
 */
export function baselinePrompt(request: string): string {
  return [
    "You are working alone in an empty project directory. Complete the research task below end to end.",
    "",
    request.trim(),
    "",
    "Deliverables, all inside the current directory:",
    "- report/report.tex — the report (LaTeX). If pdflatex is available, compile it to report/report.pdf.",
    "- report/references.bib — every source you cite.",
    "- any code and data you produce, under data/.",
    "",
    "Do the work yourself with the tools you have (shell, Python, web search). Do not ask questions; there is nobody to answer.",
    "State every headline number in the report text with its value and how it was obtained.",
  ].join("\n");
}

export function gitCommit(): string {
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).stdout.trim() || "unknown";
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf-8" }).stdout.trim() !== "";
  return dirty ? `${rev}+dirty` : rev;
}

export function listBenches(): string[] {
  return readdirSync(BENCH_ROOT)
    .filter((d) => statSync(join(BENCH_ROOT, d)).isDirectory() && existsSync(join(BENCH_ROOT, d, "RESEARCH.md")))
    .sort();
}

export function buildRecord(a: {
  arm: string; bench: string; runDir: string; model: string | null; costUsd: number | null; wallSec: number | null; exit: string; note?: string;
}): LedgerRecord {
  const s = scoreBench(a.runDir, join(BENCH_ROOT, a.bench));
  return {
    ts: new Date().toISOString(), arm: a.arm, bench: a.bench, commit: gitCommit(), model: a.model,
    costUsd: a.costUsd, wallSec: a.wallSec, exit: a.exit,
    reportTex: s.completion.reportTex, reportPdf: s.completion.reportPdf,
    oraclePassed: s.oracle?.passed ?? 0, oracleTotal: s.oracle?.total ?? 0,
    checks: (s.oracle?.checks ?? []).map((c) => ({ label: c.label, pass: c.pass })),
    runDir: a.runDir, ...(a.note ? { note: a.note } : {}),
  };
}

export function appendRecord(rec: LedgerRecord, ledger = LEDGER): void {
  appendFileSync(ledger, JSON.stringify(rec) + "\n");
}

function prepareRunDir(runsDir: string, arm: string, bench: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(runsDir, `${stamp}-${arm}-${bench}`);
  mkdirSync(dir, { recursive: true });
  // RESEARCH.md only. ORACLE.md never leaves the repo.
  copyFileSync(join(BENCH_ROOT, bench, "RESEARCH.md"), join(dir, "RESEARCH.md"));
  return dir;
}

function runClaudeCode(dir: string, request: string, o: { maxUsd: number; model?: string; timeoutMin: number }) {
  const args = [
    "-p", baselinePrompt(request),
    "--output-format", "json",
    "--max-budget-usd", String(o.maxUsd),
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch",
    "--strict-mcp-config",          // no MCP servers: the baseline is the bare CLI
    "--no-session-persistence",
    ...(o.model ? ["--model", o.model] : []),
  ];
  const t0 = Date.now();
  const r = spawnSync("claude", args, { cwd: dir, encoding: "utf-8", timeout: o.timeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(dir, "claude_result.json"), r.stdout ?? "");
  if (r.stderr) writeFileSync(join(dir, "claude_stderr.txt"), r.stderr);
  let j: any = null;
  try { j = JSON.parse(r.stdout); } catch { /* timeout or crash: no JSON */ }
  const exit = r.error ? `error:${(r.error as any).code ?? r.error.message}` : j ? String(j.subtype ?? (j.is_error ? "error" : "success")) : `no-json(exit ${r.status})`;
  const model = j?.modelUsage ? Object.keys(j.modelUsage).join("+") : (o.model ?? null);
  return { costUsd: typeof j?.total_cost_usd === "number" ? j.total_cost_usd : null, wallSec, exit, model };
}

function runLuxas(dir: string, o: { maxUsd: number; model?: string; timeoutMin: number }) {
  const tsx = join(ROOT, "node_modules", ".bin", "tsx");
  const args = [join(ROOT, "src", "index.ts"), "run", dir, "--max-cost", String(o.maxUsd), ...(o.model ? ["--model", o.model] : ["--profile", "dual"])];
  const t0 = Date.now();
  const r = spawnSync(tsx, args, { cwd: ROOT, encoding: "utf-8", timeout: o.timeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(dir, "luxas_stdout.txt"), (r.stdout ?? "") + "\n--- stderr ---\n" + (r.stderr ?? ""));
  let costUsd: number | null = null;
  try { costUsd = readUsageTotals(join(dir, ".agent", "usage.log")).cost; } catch { /* no usage log: the run never reached a model */ }
  const last = readLastExit(dir);
  const exit = r.error ? `error:${(r.error as any).code ?? r.error.message}` : (last?.kind ?? `no-exit-record(exit ${r.status})`);
  let model: string | null = o.model ?? null;
  try { const cfg = JSON.parse(readFileSync(join(dir, ".agent", "run_config.json"), "utf-8")); model = cfg.profile ? `profile:${cfg.profile}` : (cfg.model ?? model); } catch { /* */ }
  return { costUsd, wallSec, exit, model };
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arm = arg("--arm", argv);
  const benchArg = arg("--bench", argv) ?? "all";
  const dry = argv.includes("--dry-run");
  const recordDir = arg("--record", argv);
  if (!arm) { console.error("usage: bench_run.mts --arm claude-code|luxas [--bench <name>|all] [--max-usd N] [--model M] [--timeout-min N] [--runs-dir DIR] [--dry-run]\n       bench_run.mts --record <run-dir> --arm <arm> --bench <bench> [--cost N] [--wall-sec N] [--model M]"); process.exit(2); }
  const all = listBenches();
  const benches = benchArg === "all" ? all : benchArg.split(",").map((b) => all.find((x) => x === b || x.startsWith(b)) ?? b);
  const unknown = benches.filter((b) => !all.includes(b));
  if (unknown.length) { console.error(`unknown bench: ${unknown.join(", ")}. Available: ${all.join(", ")}`); process.exit(2); }

  if (recordDir) {
    if (benches.length !== 1) { console.error("--record needs exactly one --bench"); process.exit(2); }
    const num = (n: string) => { const v = arg(n, argv); return v === undefined ? null : Number(v); };
    const rec = buildRecord({ arm, bench: benches[0], runDir: resolve(recordDir), model: arg("--model", argv) ?? null, costUsd: num("--cost"), wallSec: num("--wall-sec"), exit: arg("--exit", argv) ?? "recorded", note: "recorded from an existing run directory" });
    appendRecord(rec);
    console.log(`${rec.arm} ${rec.bench}: oracle ${rec.oraclePassed}/${rec.oracleTotal} → ${LEDGER}`);
    process.exit(0);
  }

  if (!(ARMS as readonly string[]).includes(arm)) { console.error(`--arm must be one of ${ARMS.join(", ")} (use --record for anything else)`); process.exit(2); }
  const maxUsd = Number(arg("--max-usd", argv) ?? "3");
  const timeoutMin = Number(arg("--timeout-min", argv) ?? "40");
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || !Number.isFinite(timeoutMin) || timeoutMin <= 0) { console.error("--max-usd and --timeout-min must be positive numbers"); process.exit(2); }
  const model = arg("--model", argv);
  const runsDir = resolve(arg("--runs-dir", argv) ?? join(homedir(), ".sisyphus", "bench-runs"));

  console.log(`arm=${arm} benches=${benches.join(",")} max-usd=${maxUsd}/run (worst case $${(maxUsd * benches.length).toFixed(2)}) timeout=${timeoutMin}min runs-dir=${runsDir} commit=${gitCommit()}`);
  if (dry) { console.log("dry run — nothing launched"); process.exit(0); }

  for (const bench of benches) {
    const dir = prepareRunDir(runsDir, arm, bench);
    const request = readFileSync(join(dir, "RESEARCH.md"), "utf-8");
    console.log(`\n▶ ${arm} ${bench} → ${dir}`);
    const res = arm === "claude-code" ? runClaudeCode(dir, request, { maxUsd, model, timeoutMin }) : runLuxas(dir, { maxUsd, model, timeoutMin });
    const rec = buildRecord({ arm, bench, runDir: dir, ...res });
    appendRecord(rec);
    console.log(`  exit=${rec.exit} cost=${rec.costUsd === null ? "?" : "$" + rec.costUsd.toFixed(2)} wall=${rec.wallSec}s report=${rec.reportTex} pdf=${rec.reportPdf} oracle=${rec.oraclePassed}/${rec.oracleTotal}`);
    for (const c of rec.checks) console.log(`    [${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
  }
  console.log(`\nrecorded in ${LEDGER} — compare with: npx tsx scripts/bench_compare.mts`);
}
