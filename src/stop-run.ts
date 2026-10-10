/**
 * `luxas stop <project-dir>` — stop a running research project cleanly.
 *
 * Why this exists (2026-08-28): a $60-capped run was "stopped" by killing the
 * pid the operator had noted — the `npx tsx` wrapper. The node child it had
 * exec'd kept running the brain for six more hours (uncapped, since the
 * resumed process predated the cap fix) and reached $95. `.agent/run.pid`
 * records the CHILD pid; background sub-agents (`subagent-runner`) are
 * separate processes again. Stopping a run means: the run.pid process, plus
 * every process whose command line names the project directory — never the
 * caller itself, and nothing at all for a dir that is not a project.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readUsageTotals } from "./usage-log.js";

export interface ProcRow { pid: number; args: string }

/** Parse `ps -eo pid=,args=` output into rows. */
export function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), args: m[2] });
  }
  return rows;
}

const SUBCOMMANDS = new Set(["run", "status", "init", "list", "stop", "figures", "monitor", "models", "login"]);

/**
 * The luxas subcommand a command line invokes, or null: the first entry-script
 * token (…/index.ts, …/index.js, …/luxas) followed by a known subcommand.
 * Free-text flag values are never scanned — a run whose directive says
 * "please stop E3" or "luxas stop" is a run, not a stop.
 */
function luxasSubcommand(args: string): string | null {
  const head = args.split(/\s--(?:task|directive|message|prompt)(?:\s|=|$)/)[0];
  const toks = head.split(/\s+/);
  for (let i = 0; i + 1 < toks.length; i++) {
    if (/(?:^|\/)(?:index\.[tj]s|luxas)$/.test(toks[i]) && SUBCOMMANDS.has(toks[i + 1])) return toks[i + 1];
  }
  return null;
}

/**
 * Pids belonging to a project's run: the run.pid process (if alive per the
 * table) and any runner process whose args name the project directory at a
 * path boundary (DIR-v2 is another project) — excluding the caller, its
 * ancestors' obvious wrappers (ssh/bash/sh lines that merely MENTION the
 * path), and anything whose luxas subcommand is itself `stop`.
 */
export function findRunProcesses(rows: ProcRow[], projectDir: string, runPid: number | null, selfPid: number): number[] {
  const dir = resolve(projectDir).replace(/\/+$/, "");
  const namesDir = new RegExp(`(?:^|[\\s='"])${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s/'"])`);
  const out = new Set<number>();
  for (const r of rows) {
    if (r.pid === selfPid) continue;
    // run.pid is the run by definition, whatever its argv happens to say.
    if (runPid !== null && r.pid === runPid) { out.add(r.pid); continue; }
    if (luxasSubcommand(r.args) === "stop") continue;
    const isRunner = /index\.(ts|js) run\b|subagent-runner|tsx .*index\.(ts|js)|dist\/index\.js/.test(r.args);
    if (isRunner && namesDir.test(r.args)) out.add(r.pid);
  }
  return [...out].sort((a, b) => a - b);
}

export function readRunPid(projectDir: string): number | null {
  try {
    const j = JSON.parse(readFileSync(join(projectDir, ".agent", "run.pid"), "utf-8"));
    return typeof j.pid === "number" && j.pid > 0 ? j.pid : null;
  } catch { return null; }
}

function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

/**
 * Why `luxas stop` must not act on this dir, or null for a project. Any dir
 * above a project is a path prefix of its runs' argv, and the luxas checkout
 * (the documented cwd, so where a forgotten argument lands) is in every run's
 * script path: stopping either SIGKILLs every run on the machine. A project
 * is what `luxas run` accepts (RESEARCH.md) or a dir a run registered in
 * (.agent/run.pid); a bare .agent/ is not one, since the checkout has one.
 */
function notAProject(projectDir: string): string | null {
  if (projectDir.trim() === "") return "the project dir is empty";
  const dir = resolve(projectDir);
  if (dirname(dir) === dir) return `${dir} is the filesystem root`;
  if (existsSync(join(dir, "RESEARCH.md")) || readRunPid(dir) !== null) return null;
  return `${dir} is not a Luxas project (no RESEARCH.md, no .agent/run.pid)`;
}

export function stopRun(projectDir: string, opts: { graceMs?: number; log?: (s: string) => void } = {}): { killed: number[]; survivors: number[]; costUsd: number; refused?: string } {
  const log = opts.log ?? ((s: string) => console.error(s));
  const refused = notAProject(projectDir);
  if (refused) {
    log(`✗ Refusing to stop: ${refused}. Nothing was signalled — pass the project dir: luxas stop <project-dir>`);
    return { killed: [], survivors: [], costUsd: 0, refused };
  }
  const dir = resolve(projectDir);
  const ps = () => parsePs(execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" }));
  const runPid = readRunPid(dir);
  const targets = findRunProcesses(ps(), dir, runPid !== null && alive(runPid) ? runPid : null, process.pid);
  if (targets.length === 0) { log(`Nothing running for ${dir}.`); }
  for (const pid of targets) { try { process.kill(pid, "SIGTERM"); log(`SIGTERM ${pid}`); } catch { /* gone */ } }
  const deadline = Date.now() + (opts.graceMs ?? 4000);
  while (Date.now() < deadline && targets.some(alive)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  const survivors = targets.filter(alive);
  for (const pid of survivors) { try { process.kill(pid, "SIGKILL"); log(`SIGKILL ${pid}`); } catch { /* gone */ } }
  const left = findRunProcesses(ps(), dir, null, process.pid);
  const costUsd = readUsageTotals(join(dir, ".agent", "usage.log")).cost;
  log(`Stopped ${targets.length} process(es); ${left.length} still matching. Spend so far: $${costUsd.toFixed(2)}. Checkpoint is live — \`luxas run ${dir}\` resumes (cap inherited from run_config.json).`);
  return { killed: targets, survivors: left, costUsd };
}
