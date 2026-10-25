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
 *   luxas         `luxas run` on the same directory (this checkout, or with
 *                 --luxas-root an export without the answer directories;
 *                 see luxasExportProblem).
 *
 * Both arms get the same request and never see ORACLE.md: the run directory is
 * created outside the repo and only RESEARCH.md is copied into it.
 *
 * Every run appends one record to benchmarks/LEDGER.jsonl. Reader:
 * scripts/bench_compare.mts.
 *
 * Bench roots. `benchmarks/` is the default and holds the report benches. It is
 * also the input of reflect_ab.mts, which runs every directory in it for up to
 * 40 billable minutes per side — so benches whose deliverable is a simulator
 * artifact, and which need that simulator installed, live in `simbench/` and
 * are selected with `--bench-root simbench`. A bench may carry an `input/`
 * directory; it is copied into the run directory beside RESEARCH.md.
 *
 * Usage:
 *   npx tsx scripts/bench_run.mts --arm claude-code [--bench bench-01-u233-gamow|all] [--bench-root simbench]
 *        [--max-usd 3] [--model <id>] [--effort <level>] [--timeout-min 40] [--runs-dir <dir>] [--dry-run]
 *        (claude-code runs on BARE_ARM_MODEL at BARE_ARM_EFFORT unless --model / --effort is given,
 *         never on the CLI's defaults; its transcript is kept as <run-dir>/claude_transcript.jsonl)
 *   npx tsx scripts/bench_run.mts --record <run-dir> --arm <arm> --bench <bench>
 *        [--cost <usd>] [--wall-sec <n>] [--model <id>]      # score a run made elsewhere (e.g. the droplet)
 *        [--routing KEY=VALUE ...]                           # luxas: each LUXAS_ROUTING_ENV variable that run had set
 *
 * This spends real money. --dry-run prints the plan and calls nothing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBench } from "./bench_score.mts";
import { readUsageTotals } from "../src/usage-log.js";
import { readLastExit, type ExitRecord } from "../src/exit-state.js";
import { parsePs, stopRun } from "../src/stop-run.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH_ROOT = join(ROOT, "benchmarks");
export const LEDGER = join(BENCH_ROOT, "LEDGER.jsonl");
export const ARMS = ["claude-code", "luxas"] as const;
export type Arm = (typeof ARMS)[number];
/**
 * The bare arm's model unless --model says otherwise. It was the CLI's own
 * default until 2026-10-09, when that default had moved from Opus 5.5 to Fable
 * 5.1 between two sessions: a "re-run" of three benches measured a different
 * model, and nothing printed before the money was spent said so.
 */
export const BARE_ARM_MODEL = "claude-opus-5-5";

/** The model a run is launched with. luxas without --model keeps `--profile dual`. */
export function armModel(arm: string, flag?: string): string | undefined {
  return flag ?? (arm === "claude-code" ? BARE_ARM_MODEL : undefined);
}

/**
 * The bare arm's effort unless --effort says otherwise. Until 2026-10-09 the
 * arm passed none: a run took whatever ~/.claude/settings.json held for its
 * model (modelSettings.<model>.effortLevel) and the row did not record it.
 * That file says xhigh for claude-opus-5-5 on 2026-10-09; what it said when
 * the first 20 ledger rows were made is not recorded anywhere. The same class
 * as the model default above; pinned to the value those rows most likely ran on.
 */
export const BARE_ARM_EFFORT = "xhigh";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** The effort a run is launched with. luxas sets effort per agent in its definitions, so it has none here. */
export function armEffort(arm: string, flag?: string): string | undefined {
  return arm === "claude-code" ? (flag ?? BARE_ARM_EFFORT) : undefined;
}

export interface LedgerRecord {
  ts: string;
  arm: string;
  bench: string;
  /** Short commit of this checkout, "+dirty" when the tree had uncommitted changes. */
  commit: string;
  model: string | null;
  /** claude-code only: the --effort the run was launched with. Absent on rows before 2026-10-09 (inherited from the CLI's settings, unrecorded). Reader: bench_compare's mixed-effort line. */
  effort?: string;
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
  /** Set when the provider ended the run (billing, outage), with its message. The row is kept; bench_compare does not count it. */
  aborted?: string;
  /** luxas only: the routing variables the run inherited from the launching shell (LUXAS_ROUTING_ENV). Reader: bench_compare's columns. */
  routing?: Record<string, string>;
}

/**
 * Variables that decide which executor and which models a `luxas run` uses.
 * runLuxas passes the launching shell's environment through, so a solo run on
 * an Opus executor and a pipeline run on DeepSeek both recorded
 * `profile:dual` and would have shared one column.
 */
export const LUXAS_ROUTING_ENV = ["LUXAS_EXPERIMENT_MODE", "LUXAS_EXECUTOR_MODEL", "LUXAS_BRAIN_MODEL", "LUXAS_TOOL_REVIEW_MODEL", "LUXAS_READER_MODEL", "LUXAS_REVIEW_ARTIFACTS", "LUXAS_REVIEW_IMAGES", "LUXAS_BLIND_ESTIMATE"] as const;
export function luxasRouting(env: NodeJS.ProcessEnv = process.env): Record<string, string> | undefined {
  const set = LUXAS_ROUTING_ENV.filter((k) => env[k] !== undefined && env[k] !== "").map((k) => [k, String(env[k])] as const);
  return set.length ? Object.fromEntries(set) : undefined;
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

export function gitCommit(root: string = ROOT): string {
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim() || "unknown";
  // The ledger itself is left out: it is tracked, so every run made the tree
  // dirty and stamped every later row +dirty until someone committed it.
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)benchmarks/LEDGER.jsonl"], { cwd: root, encoding: "utf-8" }).stdout.trim() !== "";
  return dirty ? `${rev}+dirty` : rev;
}

export function listBenches(root = BENCH_ROOT): string[] {
  return readdirSync(root)
    .filter((d) => statSync(join(root, d)).isDirectory() && existsSync(join(root, d, "RESEARCH.md")))
    .sort();
}

export function buildRecord(a: {
  arm: string; bench: string; runDir: string; model: string | null; effort?: string; costUsd: number | null; wallSec: number | null; exit: string; note?: string; aborted?: string; routing?: Record<string, string>; benchRoot?: string;
  /** The code the run used when it was not this checkout (--luxas-root): the export's stamp. */
  commit?: string;
}): LedgerRecord {
  const s = scoreBench(a.runDir, join(a.benchRoot ?? BENCH_ROOT, a.bench));
  return {
    ts: new Date().toISOString(), arm: a.arm, bench: a.bench, commit: a.commit ?? gitCommit(), model: a.model, ...(a.effort ? { effort: a.effort } : {}),
    costUsd: a.costUsd, wallSec: a.wallSec, exit: a.exit,
    reportTex: s.completion.reportTex, reportPdf: s.completion.reportPdf,
    oraclePassed: s.oracle?.passed ?? 0, oracleTotal: s.oracle?.total ?? 0,
    checks: (s.oracle?.checks ?? []).map((c) => ({ label: c.label, pass: c.pass })),
    runDir: a.runDir, ...(a.note ? { note: a.note } : {}), ...(a.aborted ? { aborted: a.aborted } : {}), ...(a.routing ? { routing: a.routing } : {}),
  };
}

export function appendRecord(rec: LedgerRecord, ledger = LEDGER): void {
  appendFileSync(ledger, JSON.stringify(rec) + "\n");
}

export function prepareRunDir(runsDir: string, arm: string, bench: string, root = BENCH_ROOT): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(runsDir, `${stamp}-${arm}-${bench}`);
  mkdirSync(dir, { recursive: true });
  // RESEARCH.md and the bench's input/ files only. ORACLE.md, the grader and
  // the reference never leave the repo.
  copyFileSync(join(root, bench, "RESEARCH.md"), join(dir, "RESEARCH.md"));
  if (existsSync(join(root, bench, "input"))) cpSync(join(root, bench, "input"), join(dir, "input"), { recursive: true });
  return dir;
}

/**
 * How a `claude -p --output-format json` run ended. The CLI keeps
 * subtype "success" when the provider ends the run: on 2026-10-06 three runs
 * died on "Credit balance is too low" (is_error, terminal_reason "api_error")
 * and were recorded as exit=success, one of them 0/8 after 101 seconds. That is
 * not a measurement of the arm, so it is marked aborted. Running out of the
 * run's own --max-budget-usd is the arm's outcome and is not.
 */
export function classifyClaudeResult(j: any, spawnError?: { code?: string; message: string } | null, status?: number | null): { exit: string; aborted?: string } {
  if (spawnError) return { exit: `error:${spawnError.code ?? spawnError.message}` };
  if (!j) return { exit: `no-json(exit ${status})` };
  if (j.is_error === true && j.terminal_reason === "api_error") return { exit: "error:api_error", aborted: (String(j.result ?? "").trim() || "api_error").slice(0, 200) };
  return { exit: String(j.subtype ?? (j.is_error ? "error" : "success")) };
}

/**
 * The bare arm's command line, minus the binary. Whatever is not on this line
 * is inherited from the operator's CLI settings, so the model and the effort
 * are. stream-json prints every message as one stdout line: with "json" and
 * --no-session-persistence a run left its last message and nothing to audit
 * (fifteen 100% runs, none of which could be re-read).
 */
export function claudeArgs(request: string, o: { maxUsd: number; model?: string; effort?: string; keepSession?: boolean }): string[] {
  const args = [
    "-p", baselinePrompt(request),
    "--output-format", "stream-json", "--verbose",
    "--max-budget-usd", String(o.maxUsd),
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch",
    "--strict-mcp-config",          // no MCP servers: the baseline is the bare CLI
    "--no-session-persistence",     // the transcript is kept in the run directory, not under ~/.claude
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
  ];
  // --keep-session: the session is also stored under ~/.claude, so a later
  // `claude -p --resume <id> --fork-session` from the run directory can continue
  // it (the surprisebench long design's B phase forks each run twice).
  return o.keepSession ? args.filter((a) => a !== "--no-session-persistence") : args;
}

/** The last `type: "result"` line of a stream-json transcript: the object "--output-format json" used to print alone. */
export function claudeResultLine(transcript: string): any {
  let j: any = null;
  for (const line of transcript.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { const x = JSON.parse(line); if (x?.type === "result") j = x; } catch { /* a torn last line after a timeout */ }
  }
  return j;
}

/**
 * spawnSync with the arm in a process group of its own (perl setpgrp, then
 * exec), so reapArm can kill what the arm left running.
 */
export function groupSpawnSync(cmd: string, args: string[], opts: Parameters<typeof spawnSync>[2]): ReturnType<typeof spawnSync> {
  return spawnSync("perl", ["-e", 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or die "exec $ARGV[0]: $!\\n"', cmd, ...args], opts as any);
}

/**
 * Kill everything an arm left behind: its process group, and any process whose
 * command line names the run directory (one that left the group). 2026-10-06:
 * a `blender -b … measure_flange.py` from the claude-code arm held a core for
 * six days, and 18 of 20 ledger rows were timed beside it.
 */
export function reapArm(dir: string, groupPid?: number): number[] {
  const killed: number[] = [];
  if (groupPid) { try { process.kill(-groupPid, "SIGKILL"); killed.push(-groupPid); } catch { /* the group is already empty */ } }
  let rows: { pid: number; args: string }[] = [];
  try { rows = parsePs(execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" })); } catch { return killed; }
  // Both spellings: on macOS /var and /tmp are links into /private, and a
  // shell started there names the resolved path ($PWD is getcwd()).
  const paths = [...new Set([resolve(dir), (() => { try { return realpathSync(dir); } catch { return resolve(dir); } })()])];
  const names = (args: string) => paths.some((d) => args.includes(d + "/") || args.endsWith(" " + d) || args.includes(" " + d + " "));
  for (const p of rows) {
    if (p.pid === process.pid || p.pid === process.ppid) continue;
    if (!names(p.args)) continue;
    try { process.kill(p.pid, "SIGKILL"); killed.push(p.pid); } catch { /* already gone */ }
  }
  return killed;
}

export function runClaudeCode(dir: string, request: string, o: { maxUsd: number; model?: string; effort?: string; timeoutMin: number; keepSession?: boolean }, spawn: typeof spawnSync = groupSpawnSync as typeof spawnSync) {
  const t0 = Date.now();
  const r = spawn("claude", claudeArgs(request, o), { cwd: dir, encoding: "utf-8", timeout: o.timeoutMin * 60_000, maxBuffer: 512 * 1024 * 1024 });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  reapArm(dir, r.pid);
  // Written after the process has ended (the arm never sees it) and whatever
  // ended it: a timeout or a provider abort leaves the transcript up to there.
  writeFileSync(join(dir, "claude_transcript.jsonl"), r.stdout ?? "");
  if (r.stderr) writeFileSync(join(dir, "claude_stderr.txt"), r.stderr);
  const j = claudeResultLine(r.stdout ?? "");
  writeFileSync(join(dir, "claude_result.json"), j ? JSON.stringify(j) + "\n" : "");
  // Costliest first: bench_compare takes the first as the model that did the work.
  const model = j?.modelUsage ? Object.entries<any>(j.modelUsage).sort((a, b) => (b[1]?.costUSD ?? 0) - (a[1]?.costUSD ?? 0)).map(([k]) => k).join("+") : (o.model ?? null);
  return { costUsd: typeof j?.total_cost_usd === "number" ? j.total_cost_usd : null, wallSec, model, effort: o.effort, ...classifyClaudeResult(j, r.error as any, r.status) };
}

export const LUXAS_ABORT_KINDS: ReadonlySet<string> = new Set(["provider_unfunded", "provider_transient"]);
export function classifyLuxasExit(last: Pick<ExitRecord, "kind" | "detail"> | null, spawnError?: { code?: string; message: string } | null, status?: number | null): { exit: string; aborted?: string } {
  if (spawnError) return { exit: `error:${spawnError.code ?? spawnError.message}` };
  if (!last) return { exit: `no-exit-record(exit ${status})` };
  if (LUXAS_ABORT_KINDS.has(last.kind)) return { exit: last.kind, aborted: ((last.detail ?? "").trim() || last.kind).slice(0, 200) };
  return { exit: last.kind };
}

/**
 * Why a --luxas-root directory cannot be run from, or null. It must be an
 * export: stamped with the commit it came from (.luxas-export), with node_modules,
 * and without the directories that hold answers. Make one with
 *   C=$(git stash create); C=${C:-HEAD}; mkdir -p X
 *   git archive "$C" -- . ':(exclude)simbench' ':(exclude)benchmarks' ':(exclude)notes' ':(exclude)fixtures' | tar -x -C X
 *   ln -s "$PWD/node_modules" X/node_modules; git rev-parse --short "$C" > X/.luxas-export
 */
export function luxasExportProblem(root: string): string | null {
  if (!existsSync(join(root, "src", "index.ts"))) return "no src/index.ts — not a Luxas tree";
  if (!existsSync(join(root, ".luxas-export"))) return "no .luxas-export stamp — the row could not say which code ran";
  if (!existsSync(join(root, "node_modules", ".bin", "tsx"))) return "no node_modules/.bin/tsx";
  const leaks = ["simbench", "benchmarks", "notes", "fixtures"].filter((d) => existsSync(join(root, d)));
  return leaks.length ? `holds ${leaks.join(", ")} — every agent shell can read them through $LUXAS_ROOT` : null;
}

export function runLuxas(dir: string, o: { maxUsd: number; model?: string; timeoutMin: number; luxasRoot?: string }, spawn: typeof spawnSync = groupSpawnSync as typeof spawnSync) {
  // --luxas-root: run from an export of the checkout that leaves out the
  // answers (simbench graders and references, benchmarks/ oracles, notes/).
  // Every agent shell has LUXAS_ROOT, and from this checkout it can read them.
  const root = o.luxasRoot ? resolve(o.luxasRoot) : ROOT;
  const tsx = join(root, "node_modules", ".bin", "tsx");
  const args = [join(root, "src", "index.ts"), "run", dir, "--max-cost", String(o.maxUsd), ...(o.model ? ["--model", o.model] : ["--profile", "dual"])];
  const t0 = Date.now();
  const r = spawn(tsx, args, { cwd: root, encoding: "utf-8", timeout: o.timeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  // Background agents outlive the brain process; stop them before anything else is read.
  try { stopRun(dir, { log: () => {} }); } catch { /* not a project: nothing ran */ }
  reapArm(dir, r.pid);
  writeFileSync(join(dir, "luxas_stdout.txt"), (r.stdout ?? "") + "\n--- stderr ---\n" + (r.stderr ?? ""));
  let costUsd: number | null = null;
  try { costUsd = readUsageTotals(join(dir, ".agent", "usage.log")).cost; } catch { /* no usage log: the run never reached a model */ }
  let model: string | null = o.model ?? null;
  try { const cfg = JSON.parse(readFileSync(join(dir, ".agent", "run_config.json"), "utf-8")); model = cfg.profile ? `profile:${cfg.profile}` : (cfg.model ?? model); } catch { /* */ }
  return { costUsd, wallSec, model, routing: luxasRouting(), ...classifyLuxasExit(readLastExit(dir), r.error as any, r.status) };
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * The line printed before anything is launched: what a billable run is about to
 * be, in the terms its ledger row will carry. For the luxas arm that includes the
 * routing: `model=profile:dual` is printed for a pipeline run on the default
 * brain and for a solo run on Opus alike, and they are two columns of the table.
 */
export function planLine(a: { arm: string; model: string | null; effort?: string; benches: string[]; maxUsd: number; timeoutMin: number; runsDir: string; commit: string; routing?: Record<string, string> }): string {
  const routing = a.arm === "luxas" ? ` routing=${a.routing ? Object.entries(a.routing).map(([k, v]) => `${k}=${v}`).join(",") : "none"}` : "";
  return `arm=${a.arm} model=${a.model ?? "profile:dual"}${a.effort ? ` effort=${a.effort}` : ""}${routing} benches=${a.benches.join(",")} max-usd=${a.maxUsd}/run (worst case $${(a.maxUsd * a.benches.length).toFixed(2)}) timeout=${a.timeoutMin}min runs-dir=${a.runsDir} commit=${a.commit}`;
}

/**
 * The row `--record` writes for a run made elsewhere. That run's routing is not in
 * this shell's environment, so it is stated: `--routing KEY=VALUE`, repeated, keys
 * outside LUXAS_ROUTING_ENV dropped. Without it a solo run recorded from the droplet
 * landed in the plain `luxas` column with the pipeline runs, the mix-up the routing
 * field was added to end.
 */
export function recordedRow(a: { arm: string; bench: string; recordDir: string; argv: string[]; benchRoot?: string }): LedgerRecord {
  const num = (n: string) => { const v = arg(n, a.argv); return v === undefined ? null : Number(v); };
  const stated: Record<string, string> = {};
  a.argv.forEach((flag, i) => {
    const m = flag === "--routing" ? (a.argv[i + 1] ?? "").match(/^([A-Z_]+)=(.*)$/) : null;
    if (m) stated[m[1]] = m[2];
  });
  const routing = luxasRouting(stated);
  return buildRecord({
    arm: a.arm, bench: a.bench, runDir: resolve(a.recordDir), model: arg("--model", a.argv) ?? null, effort: arg("--effort", a.argv),
    costUsd: num("--cost"), wallSec: num("--wall-sec"), benchRoot: a.benchRoot, exit: arg("--exit", a.argv) ?? "recorded",
    note: "recorded from an existing run directory", ...(routing ? { routing } : {}),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arm = arg("--arm", argv);
  const benchArg = arg("--bench", argv) ?? "all";
  const dry = argv.includes("--dry-run");
  const recordDir = arg("--record", argv);
  if (!arm) { console.error("usage: bench_run.mts --arm claude-code|luxas [--bench <name>|all] [--bench-root DIR] [--max-usd N] [--model M] [--effort L] [--timeout-min N] [--runs-dir DIR] [--luxas-root DIR] [--keep-session] [--dry-run]\n       bench_run.mts --record <run-dir> --arm <arm> --bench <bench> [--cost N] [--wall-sec N] [--model M] [--effort L] [--routing KEY=VALUE ...]"); process.exit(2); }
  const benchRoot = resolve(arg("--bench-root", argv) ?? BENCH_ROOT);
  if (!existsSync(benchRoot)) { console.error(`--bench-root ${benchRoot} does not exist`); process.exit(2); }
  const all = listBenches(benchRoot);
  const benches = benchArg === "all" ? all : benchArg.split(",").map((b) => all.find((x) => x === b || x.startsWith(b)) ?? b);
  const unknown = benches.filter((b) => !all.includes(b));
  if (unknown.length) { console.error(`unknown bench: ${unknown.join(", ")}. Available: ${all.join(", ")}`); process.exit(2); }

  if (recordDir) {
    if (benches.length !== 1) { console.error("--record needs exactly one --bench"); process.exit(2); }
    const rec = recordedRow({ arm, bench: benches[0], recordDir, argv, benchRoot });
    if (arm === "luxas" && !rec.routing) console.error(`warning: recorded without routing: this row will share a column with pipeline runs. If the run had any of ${LUXAS_ROUTING_ENV.join(", ")} set, pass --routing KEY=VALUE for each.`);
    appendRecord(rec);
    console.log(`${rec.arm} ${rec.bench}: oracle ${rec.oraclePassed}/${rec.oracleTotal} → ${LEDGER}`);
    process.exit(0);
  }

  if (!(ARMS as readonly string[]).includes(arm)) { console.error(`--arm must be one of ${ARMS.join(", ")} (use --record for anything else)`); process.exit(2); }
  const maxUsd = Number(arg("--max-usd", argv) ?? "3");
  const timeoutMin = Number(arg("--timeout-min", argv) ?? "40");
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || !Number.isFinite(timeoutMin) || timeoutMin <= 0) { console.error("--max-usd and --timeout-min must be positive numbers"); process.exit(2); }
  const model = armModel(arm, arg("--model", argv));
  const effortFlag = arg("--effort", argv);
  if (effortFlag !== undefined && (arm !== "claude-code" || !(EFFORTS as readonly string[]).includes(effortFlag))) { console.error(`--effort is one of ${EFFORTS.join(", ")} and applies to --arm claude-code only (luxas sets effort per agent)`); process.exit(2); }
  const effort = armEffort(arm, effortFlag);
  const keepSession = argv.includes("--keep-session");
  if (keepSession && arm !== "claude-code") { console.error("--keep-session applies to --arm claude-code only"); process.exit(2); }
  const runsDir = resolve(arg("--runs-dir", argv) ?? join(homedir(), ".sisyphus", "bench-runs"));
  const luxasRoot = arg("--luxas-root", argv);
  const exportProblem = luxasRoot ? luxasExportProblem(luxasRoot) : null;
  if (luxasRoot && arm !== "luxas") { console.error("--luxas-root applies to --arm luxas only"); process.exit(2); }
  if (exportProblem) { console.error(`--luxas-root ${luxasRoot}: ${exportProblem}`); process.exit(2); }
  const commit = luxasRoot ? readFileSync(join(luxasRoot, ".luxas-export"), "utf-8").trim() : gitCommit();

  console.log(planLine({ arm, model, effort, benches, maxUsd, timeoutMin, runsDir, commit, routing: luxasRouting() }));
  if (dry) { console.log("dry run — nothing launched"); process.exit(0); }

  for (const bench of benches) {
    const dir = prepareRunDir(runsDir, arm, bench, benchRoot);
    const request = readFileSync(join(dir, "RESEARCH.md"), "utf-8");
    console.log(`\n▶ ${arm} ${bench} → ${dir}`);
    const res = arm === "claude-code" ? runClaudeCode(dir, request, { maxUsd, model, effort, timeoutMin, keepSession }) : runLuxas(dir, { maxUsd, model, timeoutMin, luxasRoot });
    const rec = buildRecord({ arm, bench, runDir: dir, benchRoot, ...res, ...(luxasRoot ? { commit } : {}) });
    appendRecord(rec);
    console.log(`  exit=${rec.exit} cost=${rec.costUsd === null ? "?" : "$" + rec.costUsd.toFixed(2)} wall=${rec.wallSec}s report=${rec.reportTex} pdf=${rec.reportPdf} oracle=${rec.oraclePassed}/${rec.oracleTotal}`);
    if (rec.aborted) console.log(`  ABORTED by the provider ("${rec.aborted}") — recorded, not counted. Fix the cause and run this bench again.`);
    for (const c of rec.checks) console.log(`    [${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
  }
  console.log(`\nrecorded in ${LEDGER} — compare with: npx tsx scripts/bench_compare.mts`);
}
