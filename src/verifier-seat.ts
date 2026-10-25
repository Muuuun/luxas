/**
 * Verifier seat — the replicator's check mode (2026-10-25).
 *
 * What a bare strong agent does not do on its own, measured over a week of
 * Dy and blender runs, is run the one computation that could refute its own
 * headline number: every error that reached a report was a self-consistent
 * wrong number (an extra 2π with every file regenerated to match; a floor the
 * shipped code no longer produces) or an attribution never tested with a
 * control. Readers do not catch those — verifier bench A1 (2026-10-20): a
 * bare Opus audit 8/8, the review stack 7/8, blind estimates 0 unique catches
 * and 2 false disputes, all on faults that left a contradicting receipt. A2:
 * on faults with no receipt, only the arm told to "recompute it yourself from
 * the physics and re-run the shipped code" caught them (2/2, 0 false, on a
 * clone of the project), and it was a hand-run script outside the loop.
 *
 * This module puts that arm in the loop as a seat: before each
 * experiment_reviewer round a replicator in MODE=check works on a throwaway
 * clone of the project (re-running a producer's build script overwrites its
 * results.json, so never in place) and does three things in order — recompute
 * each headline id by its own route BEFORE opening the producer's code, writing
 * replication/<id>/results.json in the schema the claim table already reads as
 * a computing leg; re-run the shipped code and compare with results.json; toggle
 * the cause in each causal sentence of the L2 Headline findings. Its
 * RECOMPUTED / RERUN / CONTROL lines go to the reviewer's obligation block and
 * into the persisted review; only files under replication/ come back.
 *
 * Switches: LUXAS_VERIFY_SEAT=check turns it on in place of the estimate-mode
 * replicators (default: estimate, today's behaviour; 0/none/off: no seat);
 * LUXAS_BLIND_ESTIMATE=0 still switches every seat off. LUXAS_SEAT_ENGINE=
 * claude-code runs the seat as `claude -p` on the subscription login (the
 * measured route) instead of an in-process pi agent on the API key.
 * LUXAS_CHECK_MODEL pins the model (default the measured claude-opus-5-5).
 *
 * Readers: tools/spawn-agent.ts runExperimentReviewLoop (the seat's one
 * production site); scripts/review_experiment.mts --seat; scripts/
 * verify_experiment.mts (the hand route, replacing audit_experiment.mts).
 * Gate: scripts/smoke_verifier_seat.mts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { QuantityDecl } from "./claims-table.js";
import { getDefinition, replicatorCheckDefinition, resolvePrompt } from "./agents/registry.js";
import { spawnAgent, type SpawnAgentOptions, type SpawnAgentResult } from "./agents/spawn.js";
import { appendUsage } from "./usage-log.js";
import { jobOwnerAls } from "./jobs/als.js";

export type SeatMode = "estimate" | "check" | "off";
export type SeatEngine = "pi" | "claude-code";

/** The measured model and effort (verifier bench A2/A3: RAR arm, 2 of 2 planted + 1 natural fault, 0 false findings). */
export const CHECK_MODEL_DEFAULT = "claude-opus-5-5";
export const CHECK_EFFORT_DEFAULT = "high";

/** Which seat runs before each reviewer round. LUXAS_BLIND_ESTIMATE=0 is the one master off switch (review_experiment --no-blind). */
export function seatMode(env: NodeJS.ProcessEnv = process.env): SeatMode {
  if (env.LUXAS_BLIND_ESTIMATE === "0") return "off";
  const v = String(env.LUXAS_VERIFY_SEAT ?? "estimate").trim().toLowerCase();
  if (v === "0" || v === "off" || v === "none") return "off";
  return v === "check" ? "check" : "estimate";
}

export function seatEngine(env: NodeJS.ProcessEnv = process.env): SeatEngine {
  return env.LUXAS_SEAT_ENGINE === "claude-code" ? "claude-code" : "pi";
}

export function checkModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.LUXAS_CHECK_MODEL || CHECK_MODEL_DEFAULT;
}

/** claude-code engine: the CLI's own --max-budget-usd (list price; the subscription is not billed per call). */
export function seatMaxUsd(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.LUXAS_SEAT_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

// ── the seat's lines ─────────────────────────────────────────────────────────

export interface SeatLine { kind: "RECOMPUTED" | "RERUN" | "CONTROL"; quantity: string; text: string }

// List markers, bold and backticks are stripped: the model writes "- **RERUN: …**" as often as the bare line
// (audit_experiment on bench A3 lost four lines to "BREAK" vs "BREAKS"; the same looseness here).
const SEAT_LEAD_RE = /^\s*(?:[-*•]\s+)?(?:\*\*|`)?\s*/;
const SEAT_PREFIX_RE = /^(RECOMPUTED|RERUN|CONTROL)\s*:\s*(\S+)/;

export function extractSeatLines(text: string): SeatLine[] {
  const out: SeatLine[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const body = raw.replace(SEAT_LEAD_RE, "").replace(/\s*(?:\*\*|`)\s*$/, "").trim();
    const m = body.match(SEAT_PREFIX_RE);
    if (!m) continue;
    const canon = body.replace(/^(RECOMPUTED|RERUN|CONTROL)\s*:\s*/, "$1: ");
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push({ kind: m[1] as SeatLine["kind"], quantity: m[2].replace(/[—:;,]+$/, ""), text: canon });
  }
  return out;
}

const DIFFER_RE = /;\s*differ\b/i;
const REFUTE_RE = /;\s*refutes?\b/i;

/** The lines that say something is wrong: a RERUN that differs, a CONTROL that refutes. */
export function seatBreaks(lines: SeatLine[]): SeatLine[] {
  return lines.filter((l) => (l.kind === "RERUN" && DIFFER_RE.test(l.text)) || (l.kind === "CONTROL" && REFUTE_RE.test(l.text)));
}

export function seatLinesSummary(lines: SeatLine[]): string {
  const rec = lines.filter((l) => l.kind === "RECOMPUTED").length;
  const reruns = lines.filter((l) => l.kind === "RERUN");
  const differ = reruns.filter((l) => DIFFER_RE.test(l.text)).length;
  const ctl = lines.filter((l) => l.kind === "CONTROL");
  const refute = ctl.filter((l) => REFUTE_RE.test(l.text)).length;
  return `${rec} recomputed, ${reruns.length} rerun (${reruns.length - differ} agree, ${differ} differ), ${ctl.length} control (${ctl.length - refute} support, ${refute} refute)`;
}

// ── the task ─────────────────────────────────────────────────────────────────

export interface CheckSeatTaskInput {
  experimentId: string;
  /** Headline declarations with a single numeric value (claims-review headlineDeclsFor). Values are never printed. */
  decls: QuantityDecl[];
  /** Declared headline ids the obligation leaves out (an object, a curve, past the cap): owed a RERUN, not a RECOMPUTED. */
  outOfScope: { id: string; key: string; why: string }[];
  round: number;
  /** The previous round's DISCRIMINATOR lines, to execute. */
  priorDiscriminators?: string[];
}

/** The task handed to the check-mode replicator: observables and input VALUES only, phases in order, the three line formats. */
export function checkSeatTask(o: CheckSeatTaskInput): string {
  const rep = `data/experiments/${o.experimentId}/replication`;
  const prior = o.priorDiscriminators ?? [];
  const inputsOf = (d: QuantityDecl) => Object.entries(d.inputs).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    `Verifier seat, check mode — experiment ${o.experimentId}, review round ${o.round}. You work on a clone of the project: files you write under ${rep}/ are carried back, nothing else is, and nothing you run here can damage the real project.`,
    ``,
    `Headline quantities with a single numeric value. You are NOT shown the producer's values — compute each by your own route first, then open the producer's code.`,
    ...(o.decls.length
      ? o.decls.map((d) => `- ${d.id} — key ${d.key}\n  OBSERVABLE: ${d.observable ?? "(no observable sentence recorded — compute the quantity the id names and say what definition you assumed)"}\n  INPUTS (values the producer used; treat as given): ${inputsOf(d) || "(none declared)"}`)
      : ["- (none with a single numeric value)"]),
    ...(o.outOfScope.length
      ? [``, `Headline quantities with no single number at their key (an object, a curve, or past the cap). Every scalar the L2 section quotes for one of these is a headline number too: a RECOMPUTED line is OWED for each (tag it <id>/<scalar>), derived by your own route BEFORE you open the producer's code, exactly as for the ids above — a re-run of the shipped code is not a recomputation. RERUN each one's key as well. (The replication file is optional for these; there is no declared id to table them under.)`,
        ...o.outOfScope.map((x) => `- ${x.id} — key ${x.key} (${x.why})`)]
      : []),
    ``,
    `Order — the order is the method:`,
    `(1) Blind recompute, BEFORE reading data/experiments/${o.experimentId}/scripts/, runs/, tests/ or the L2 section of notes/experiments.md: derive each quantity from its observable sentence, the inputs above and the physics by a route of your own, run it, and write ${rep}/<id>/results.json as {"quantity": "<id>", "value": <number>, "sigma": <number>, "route": "<one sentence: formalism / approximation>", "script": "replication/<id>/<file>.py", "inputs": {"<id>": <value used>}} with the script beside it (use <id>-2/ if <id>/ already holds a results.json; never edit an existing one).`,
    `(2) Then re-run the shipped code for every headline key listed above, as shipped — do not edit it — and compare its output with the value the latest run's results.json reports there. No shipped script producing the number is a differ. Then do the same for every OTHER number the L2 section's Headline findings quote that no listed id covers (a lifetime, a rate, a count stated as a result): find the shipped script that produces it and RERUN it under the ledger's own name for it; a number no shipped script produces is a differ ("no script produces it").`,
    `(3) Then read the L2 Headline findings and, for each causal or attributive sentence ("X limits Y", "the floor comes from Z"), toggle the named cause (zero it, swap the model, change the parameter) in your own copy or by re-running the shipped code without it, and say whether the effect moves as claimed.`,
    prior.length ? `(4) Then execute the reviewer's discriminators below.` : `(4) none this round.`,
    ...(prior.length
      ? [``, `Reviewer DISCRIMINATOR lines from round ${o.round - 1} — execute the computation each names and report it as CONTROL: D<n> — claim: "<the line, shortened>" — computed <what>: <result>; supports|refutes:`,
        ...prior.map((l, i) => `D${i + 1}: ${l}`)]
      : []),
    ``,
    `Budget: about 20 minutes. A computation longer than 3 minutes goes to the background with a poll that returns within 3 minutes; never wait in one foreground call. Prefer a cheap exact route over a slow faithful one.`,
    ``,
    `Finish with the result lines — exact prefixes, one per line, nothing after them:`,
    `RECOMPUTED: <id> — <value> ± <sigma> via <route in ≤12 words> — inputs: [<id>=<value>, ...]`,
    `RERUN: <id> — code gives <value>; results.json says <value>; agree|differ — <script you ran>`,
    `CONTROL: <tag> — claim: "<the ledger sentence, shortened>" — toggled <what>: <result>; supports|refutes`,
    `agree = within the producer's stated uncertainty, or 1 % when none is stated. One RERUN per headline id; one RECOMPUTED per id you computed; one CONTROL per sentence you tested. Numbers only from computations in this session.`,
  ].join("\n");
}

// ── the clone ────────────────────────────────────────────────────────────────

/**
 * A clone of the project for the seat to work in. APFS clones (cp -c) are
 * instant and share blocks; `--reflink=auto` does the same on btrfs/xfs and
 * falls back to a full copy on ext4 (the droplet — data/papers is the cost).
 * `.agent/` is dropped: the live run's log, registry and transcripts carry the
 * producer's numbers and are nothing the seat should read.
 */
export function cloneProjectForSeat(projectDir: string, experimentId: string): string {
  const project = resolve(projectDir);
  if (!existsSync(join(project, "data", "experiments", experimentId))) throw new Error(`cannot clone ${project}: no data/experiments/${experimentId}/`);
  const base = realpathSync(mkdtempSync(join(tmpdir(), `luxas-seat-${experimentId.replace(/[^A-Za-z0-9_-]/g, "_")}-`)));
  const clone = join(base, "project");
  try {
    execFileSync("cp", process.platform === "darwin" ? ["-Rc", project, clone] : ["-R", "--reflink=auto", project, clone], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    // A socket or fifo stops cp after the files around it were copied; the tree the seat needs decides.
    if (!existsSync(join(clone, "data", "experiments", experimentId)) || !existsSync(join(clone, "notes"))) {
      rmSync(base, { recursive: true, force: true });
      throw new Error(`could not clone ${project}: ${String((err as any)?.stderr ?? (err as Error).message).trim().slice(0, 200)}`);
    }
  }
  rmSync(join(clone, ".agent"), { recursive: true, force: true });
  return clone;
}

/** Removes the clone and the temp directory that holds it. */
export function removeSeatClone(clone: string): void {
  const base = dirname(clone);
  if (basename(clone) === "project" && basename(base).startsWith("luxas-seat-")) rmSync(base, { recursive: true, force: true });
  else rmSync(clone, { recursive: true, force: true });
}

// ── harvest ──────────────────────────────────────────────────────────────────

const legOf = (file: string): Record<string, unknown> | null => {
  try {
    const j = JSON.parse(readFileSync(file, "utf-8"));
    return j && typeof j === "object" && !Array.isArray(j) && typeof j.quantity === "string" && typeof j.value === "number" ? j : null;
  } catch { return null; }
};
/** The same leg, stamps aside (the project's copy carries model + seat the clone's does not). */
const sameLeg = (a: string, b: string): boolean => {
  if (!existsSync(a) || !existsSync(b)) return false;
  const x = legOf(a), y = legOf(b);
  if (!x || !y) return readFileSync(a).equals(readFileSync(b));
  const strip = (j: Record<string, unknown>) => { const { model: _m, seat: _s, ...rest } = j; return JSON.stringify(rest); };
  return strip(x) === strip(y);
};

/**
 * Carries the seat's replication/ output back into the project: a new
 * <name>/ directory whole (its script with it), an edited existing one beside
 * the original as <name>-2 (never over a brain-dispatched replicator's file),
 * the shared replication/results.json only when the project has none, nothing
 * else. Each carried results.json is stamped with the model and seat:"check"
 * (claims-table.ts reads the stamp: the estimator-only rule does not drop it).
 */
export function harvestSeatReplications(clone: string, projectDir: string, experimentId: string, model: string): { harvested: { rel: string; quantity: string }[]; notes: string[] } {
  const harvested: { rel: string; quantity: string }[] = [];
  const notes: string[] = [];
  const src = join(clone, "data", "experiments", experimentId, "replication");
  const dst = join(projectDir, "data", "experiments", experimentId, "replication");
  if (!existsSync(src)) return { harvested, notes };
  const stamp = (file: string): string => {
    const j = legOf(file)!;
    if (typeof j.model !== "string") j.model = model;
    j.seat = "check";
    writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
    return String(j.quantity);
  };
  const shared = join(src, "results.json");
  if (existsSync(shared)) {
    if (existsSync(join(dst, "results.json"))) {
      if (!sameLeg(shared, join(dst, "results.json"))) notes.push("replication/results.json: the seat wrote the shared file, which the project already has — left out (per-id directories are the seat's place)");
    } else if (!legOf(shared)) notes.push("replication/results.json written by the seat is not {quantity: string, value: number} JSON — left out");
    else {
      mkdirSync(dst, { recursive: true });
      copyFileSync(shared, join(dst, "results.json"));
      harvested.push({ rel: "replication/results.json", quantity: stamp(join(dst, "results.json")) });
    }
  }
  let entries: string[] = [];
  try { entries = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { /* unreadable */ }
  for (const name of entries) {
    const srcFile = join(src, name, "results.json");
    if (!existsSync(srcFile)) continue; // scratch without a result: nothing for the table
    let twins: string[] = [];
    try { twins = readdirSync(dst).filter((n) => n === name || (n.startsWith(`${name}-`) && /^\d+$/.test(n.slice(name.length + 1)))); } catch { /* no replication/ in the project yet */ }
    if (twins.some((t) => sameLeg(srcFile, join(dst, t, "results.json")))) continue; // already in the project, or untouched by the seat
    if (!legOf(srcFile)) { notes.push(`replication/${name}/results.json written by the seat is not {quantity: string, value: number} JSON — left out`); continue; }
    let target = name;
    if (existsSync(join(dst, name))) for (let n = 2; ; n++) { if (!existsSync(join(dst, `${name}-${n}`))) { target = `${name}-${n}`; break; } }
    mkdirSync(dst, { recursive: true });
    cpSync(join(src, name), join(dst, target), { recursive: true });
    harvested.push({ rel: `replication/${target}`, quantity: stamp(join(dst, target, "results.json")) });
  }
  return { harvested, notes };
}

// ── claude-code engine ───────────────────────────────────────────────────────

export interface ClaudeCodeRun {
  output: string;
  costUsd: number;
  turns: number;
  durationMs: number;
  /** The CLI's apiKeySource: "none" = the subscription login paid. */
  login: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  terminal: string;
  isError: boolean;
}

/**
 * The seat's answer and what it cost, from a stream-json transcript. A session
 * with background jobs emits several result rows: "I'll continue once the
 * simulation finishes" (23 turns), a few one-turn waits, then the answer (23
 * turns again — bench C1 a3-01, where the first row won a most-turns tie and
 * the catch read as no lines). The answer is the LAST row that carries a seat
 * line; with none, the last of the rows with the most turns. The cost is the
 * largest total (it is cumulative).
 */
export function readClaudeCodeResult(transcript: string): ClaudeCodeRun | null {
  const rows: any[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  const results = rows.filter((r) => r?.type === "result");
  if (!results.length) return null;
  const withLines = results.filter((r) => extractSeatLines(String(r.result ?? "")).length > 0);
  const pool = withLines.length ? withLines : results;
  const main = pool.reduce((a, b) => ((b.num_turns ?? 0) >= (a.num_turns ?? 0) ? b : a));
  const init = rows.find((r) => r?.type === "system" && r?.subtype === "init");
  const u = main.usage ?? {};
  return {
    output: String(main.result ?? ""),
    costUsd: Math.max(...results.map((r) => Number(r.total_cost_usd ?? 0))),
    turns: Number(main.num_turns ?? 0),
    durationMs: Number(main.duration_ms ?? 0),
    login: String(init?.apiKeySource ?? "unknown"),
    usage: { input: Number(u.input_tokens ?? 0), output: Number(u.output_tokens ?? 0), cacheRead: Number(u.cache_read_input_tokens ?? 0), cacheWrite: Number(u.cache_creation_input_tokens ?? 0) },
    terminal: String(main.terminal_reason ?? ""),
    isError: main.is_error === true,
  };
}

/** Everything the child left behind: its process group, and any process whose command line names the clone. */
function reapClone(clone: string, groupPid?: number): void {
  if (groupPid) { try { process.kill(-groupPid, "SIGKILL"); } catch { /* the group is already empty */ } }
  let ps = "";
  try { ps = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" }); } catch { return; }
  const paths = [...new Set([resolve(clone), (() => { try { return realpathSync(clone); } catch { return resolve(clone); } })()])];
  for (const row of ps.split("\n")) {
    const m = row.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]), args = m[2];
    if (pid === process.pid || pid === process.ppid) continue;
    if (!paths.some((d) => args.includes(d + "/") || args.endsWith(" " + d) || args.includes(" " + d + " "))) continue;
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

export interface ClaudeCodeSeatOptions {
  clone: string;
  task: string;
  systemPrompt: string;
  model: string;
  effort: string;
  maxUsd: number;
  timeoutMin: number;
  /** The gate's fake; default `claude` on PATH. */
  claudeBin?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * `claude -p` in the clone, on the subscription login (ANTHROPIC_API_KEY is
 * not passed on: the CLI prefers it when set, and a $2 list-price seat would
 * then be $2 of cash), with the check render as its system prompt and the
 * tools the seat needs — Write/Edit for its replication/ files. In its own
 * process group, reaped afterwards (bench_run 2026-10-06: a child held a core
 * for six days).
 */
export function runClaudeCodeSeat(o: ClaudeCodeSeatOptions): { transcript: string; run: ClaudeCodeRun | null; status: number | null; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(o.env ?? {}) };
  delete env.ANTHROPIC_API_KEY;
  const bin = o.claudeBin ?? "claude";
  const args = [
    "-p", o.task, "--append-system-prompt", o.systemPrompt,
    "--model", o.model, "--effort", o.effort,
    "--output-format", "stream-json", "--verbose",
    "--max-budget-usd", String(o.maxUsd),
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash", "Read", "Glob", "Grep", "Write", "Edit",
    "--strict-mcp-config", "--no-session-persistence",
  ];
  const spawnOpts = { cwd: o.clone, env, encoding: "utf-8" as const, timeout: o.timeoutMin * 60_000, maxBuffer: 512 * 1024 * 1024 };
  let r = spawnSync("perl", ["-e", 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or die "exec $ARGV[0]: $!\\n"', bin, ...args], spawnOpts);
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") r = spawnSync(bin, args, spawnOpts); // no perl: no group, still runs
  reapClone(o.clone, r.pid);
  const transcript = String(r.stdout ?? "");
  return { transcript, run: readClaudeCodeResult(transcript), status: r.status, stderr: String(r.stderr ?? "") + (r.error ? ` ${r.error.message}` : "") };
}

function recordSeatUsage(projectDir: string, agentId: string, model: string, run: ClaudeCodeRun): void {
  // Cash only when a key paid; on the subscription the row keeps the tokens and a zero (the ledger is cash; the list price is in the notes).
  const cash = run.login !== "none";
  jobOwnerAls.run({ agentId, agentType: "replicator", projectDir }, () => appendUsage(join(projectDir, ".agent", "usage.log"), {
    timestamp: Date.now(), model, provider: cash ? "anthropic-cli" : "anthropic-cli-subscription",
    input: run.usage.input, output: run.usage.output, cacheRead: run.usage.cacheRead, cacheWrite: run.usage.cacheWrite, cost: cash ? run.costUsd : 0,
  }));
}

// ── the seat ─────────────────────────────────────────────────────────────────

export interface VerifierSeatInput extends CheckSeatTaskInput {
  projectDir: string;
  engine?: SeatEngine;
  model?: string;
  effort?: string;
  /** claude-code engine: the CLI's budget (list). */
  maxUsd?: number;
  timeoutMin?: number;
  getApiKey: SpawnAgentOptions["getApiKey"];
  /** pi engine; injectable for the gate. Default spawnAgent. */
  spawn?: (opts: SpawnAgentOptions) => Promise<SpawnAgentResult>;
  makeSpawnTool?: SpawnAgentOptions["createSpawnTool"];
  parentAgentId?: string;
  depth?: number;
  mergedTemplateVars?: Record<string, string>;
  /** claude-code engine, gate only. */
  claudeBin?: string;
  env?: NodeJS.ProcessEnv;
  /** Leave the clone on disk (verify_experiment --keep-clone). */
  keepClone?: boolean;
  /** false: report what the seat wrote without carrying it back. */
  harvest?: boolean;
}

export interface VerifierSeatResult {
  engine: SeatEngine;
  model: string;
  lines: SeatLine[];
  harvested: { rel: string; quantity: string }[];
  notes: string[];
  clone: string;
  output: string;
  durationMs: number;
  /** claude-code engine: the CLI's list-price total. */
  listCostUsd?: number;
  login?: string;
  transcriptPath?: string;
  agentId?: string;
}

/**
 * One seat run for one experiment and round: clone, run the engine, read the
 * lines, carry replication/ back, remove the clone — on return, on throw, and
 * on process.exit (the hard cost cap ends a run from inside a model call).
 */
export async function runVerifierSeat(o: VerifierSeatInput): Promise<VerifierSeatResult> {
  const engine = o.engine ?? seatEngine();
  const model = o.model ?? checkModel();
  const effort = o.effort ?? CHECK_EFFORT_DEFAULT;
  const task = checkSeatTask(o);
  const ids = [...new Set([...o.decls.map((d) => d.id), ...o.outOfScope.map((x) => x.id)])];
  const clone = cloneProjectForSeat(o.projectDir, o.experimentId);
  const drop = () => { if (!o.keepClone) removeSeatClone(clone); };
  process.once("exit", drop);
  const t0 = Date.now();
  const notes: string[] = [];
  try {
    const vars = { ...(o.mergedTemplateVars ?? {}), PROJECT_DIR: clone, EXPERIMENT_ID: o.experimentId, QUANTITY_ID: ids.join(", "), MODE: "check", ROUTE: "" };
    let output = "";
    let listCostUsd: number | undefined, login: string | undefined, transcriptPath: string | undefined, agentId: string | undefined;
    if (engine === "claude-code") {
      agentId = `${o.parentAgentId ?? "harness"}.verifier-seat-r${o.round}-${Math.random().toString(36).slice(2, 8)}`;
      const systemPrompt = resolvePrompt(replicatorCheckDefinition(getDefinition("replicator")), { SPAWN_ID: agentId, ...vars });
      const dir = join(o.projectDir, ".agent", "verifier-seat");
      mkdirSync(dir, { recursive: true });
      transcriptPath = join(dir, `${o.experimentId}_r${o.round}_${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
      const r = runClaudeCodeSeat({ clone, task, systemPrompt, model, effort, maxUsd: o.maxUsd ?? seatMaxUsd(), timeoutMin: o.timeoutMin ?? 40, claudeBin: o.claudeBin, env: o.env });
      writeFileSync(transcriptPath, r.transcript);
      if (!r.run) throw new Error(`verifier seat (claude-code) did not complete: no result row — ${(r.stderr.trim().slice(-300) || `exit ${r.status}`)}`);
      output = r.run.output; listCostUsd = r.run.costUsd; login = r.run.login;
      recordSeatUsage(o.projectDir, agentId, model, r.run);
      if (login !== "none") notes.push(`billed to an API key (apiKeySource=${login}), not the subscription: $${listCostUsd.toFixed(2)} entered the ledger as cash`);
      if (r.run.isError || (r.run.terminal && r.run.terminal !== "completed")) notes.push(`the CLI ended with ${r.run.terminal || "an error"}; the lines are what it had by then`);
    } else {
      const spawn = o.spawn ?? spawnAgent;
      const res = await spawn({
        name: "replicator", projectDir: o.projectDir, workDir: clone, templateVars: vars, prompt: task, getApiKey: o.getApiKey,
        parentAgentId: `${o.parentAgentId ?? "brain"}.verifier-seat-r${o.round}`, depth: o.depth, createSpawnTool: o.makeSpawnTool,
        exactModel: model,
        resolveDefinition: (n) => (n === "replicator" ? replicatorCheckDefinition(getDefinition("replicator")) : getDefinition(n)),
      });
      output = res.output ?? ""; agentId = res.agentId;
      if (!res.success) throw new Error(`verifier seat (pi) failed: ${output.replace(/\s+/g, " ").slice(0, 200)}`);
      const stop = res.exit?.stopReason;
      if (stop === "error" || stop === "killed") notes.push(`the seat ended with stopReason ${stop}${res.exit?.errorMessage ? `: ${res.exit.errorMessage.slice(0, 120)}` : ""}; the lines are what it had by then`);
    }
    const lines = extractSeatLines(output);
    if (!lines.length) notes.push("the seat returned no RECOMPUTED / RERUN / CONTROL line");
    const h = o.harvest === false ? { harvested: [] as { rel: string; quantity: string }[], notes: [] as string[] } : harvestSeatReplications(clone, o.projectDir, o.experimentId, model);
    notes.push(...h.notes);
    for (const l of lines) if (l.kind === "RECOMPUTED" && o.harvest !== false && !h.harvested.some((x) => x.quantity === l.quantity)) notes.push(`RECOMPUTED ${l.quantity} has no replication/<dir>/results.json behind it — a line for the reviewer, not a table leg`);
    return { engine, model, lines, harvested: h.harvested, notes, clone, output, durationMs: Date.now() - t0, listCostUsd, login, transcriptPath, agentId };
  } finally {
    process.removeListener("exit", drop);
    drop();
  }
}
