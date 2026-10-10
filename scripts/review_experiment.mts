#!/usr/bin/env tsx
/**
 * review_experiment — the harness review for an experiment that is ALREADY on
 * disk: write-time checks, blind estimates, one experiment_reviewer round.
 *
 * The review loop normally runs when an `experiment` agent spawned by brain
 * returns. An experiment executed outside that spawn never reaches it: one
 * run by `claude -p` (the executor the 2026-10-06 comparison measured — the
 * permission check that guards launching it also means brain cannot be the
 * one to launch it), or one left unreviewed by a run that died. This enters
 * the SAME function (runExperimentReviewLoop) from the command line, so the
 * blind estimate, the reviewer's obligation lines and the persisted
 * reviews/experiment_review_<EID>_r<N>.md are what a brain-spawned experiment
 * gets, and claims-table.ts / the finish gate read them unchanged.
 *
 * Two things differ, on purpose:
 *  - An outside executor writes results.json with its own file tool, so the
 *    write-time validation in safety-wrappers.ts never ran. It runs here
 *    first and is printed with the verdict, so it travels back to the
 *    executor together with the reviewer's feedback.
 *  - One round per invocation and no in-harness revision. On REVISE the
 *    feedback is printed and persisted; whoever executed the experiment
 *    revises it (for `claude -p`: --resume the same session with the
 *    feedback), then this is run again and writes the next round's file.
 *
 * Usage:
 *   npx tsx scripts/review_experiment.mts <projectDir> <EXPERIMENT_ID>
 *        [--profile dual|claude]   default dual, as `luxas run`
 *        [--no-blind]              estimate nothing (earlier rounds' blind lines still reach the reviewer)
 *        [--blind]                 estimate every headline id again, ignoring earlier rounds' lines
 *                                  (default, as for a re-dispatched experiment: an earlier blind line is
 *                                  reused while the inputs it was made against still match the declaration,
 *                                  and only the other ids are estimated)
 *        [--blind-lines <file>]    hand the reviewer exactly the ESTIMATE(blind) lines in <file> (an earlier review
 *                                  file will do) at any round, round 1 included, and estimate nothing; not with
 *                                  --blind or --no-blind
 *        [--summary <file>]        the executor's closing message, shown to nobody but kept in the output
 *        [--max-usd N]             stop when THIS invocation has spent N (default 5), or earlier at the run's own cap
 *        [--raise-run-cap N]       first raise the run's cap (run_config.json maxCost) to N; only upwards, above the ledger
 *   npx tsx scripts/review_experiment.mts <projectDir> --check
 *        the finish gate's claim-table and report-integrity checks only (finishCheck); no experiment id
 *        (one given is ignored), no model call, nothing written. The hand route never calls finish(), so
 *        this is where an unanswered REVISE or a malformed declaration shows up before the report.
 *
 * Any argument not listed above is refused before the project is read.
 *
 * Exit: 0 satisfied · 3 revise · 2 refused, nothing spent (not delivered / usage or an unknown argument /
 *       a --blind-lines file with no line / ledger at the run cap)
 *       · 1 not reviewed (the reviewer gave no review, twice), or a hard stop: the cap was hit, or the run is
 *       still live and stopping on an unfunded provider · 4 = --check found blocking issues (0 = none).
 * Billed: up to 3 blind estimates on the producer profile + one reviewer; --check is free.
 * The spend is written to the project's .agent/usage.log like any sub-agent's
 * (the first live use, 2026-10-07, did not, and three reviews — $5 — were
 * missing from the project total that the run's cost cap reads), and it stops
 * at that cap: run_config.json's maxCost, else the $250 backstop.
 * A review run while a run is live also shares its run-wide unfunded stop
 * (.agent/unfunded.json), in both directions.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getApiKey } from "../src/auth.js";
import { applyDualProfileEnv } from "../src/profiles.js";
import { experimentNumberOf, headlineDeclsFor, nextReviewRound, priorBlindLines, quantityDeclarationProblems, reusableBlindLine, routeLintProblems } from "../src/claims-review.js";
import { buildClaimTable, claimTableIssues, readResultsJson } from "../src/claims-table.js";
import { formatIntegrityIssues, reportIntegrityIssues, type IntegrityIssue } from "../src/tools/report-integrity.js";
import { findRunProcesses, parsePs, readRunPid } from "../src/stop-run.js";
import { archiveUnfundedSentinel, installUsageTracking, readUsageByAgent, readUsageTotals, UNFUNDED_SENTINEL } from "../src/usage-log.js";
import { SOFT_CAP_FRACTION } from "../src/hooks.js";
import { createSpawnToolFactory, experimentDeliveryProblem, runExperimentReviewLoop } from "../src/tools/spawn-agent.js";

// The loop numbers rounds and reads earlier blind lines with these same two.
export { nextReviewRound, priorBlindLines } from "../src/claims-review.js";

/**
 * What this round is handed and whether it may estimate. Default: every
 * earlier round's blind lines, with estimation on; the loop reuses a line
 * while its inputs match and estimates only the other ids. --blind: nothing
 * carried, every id estimated again. --no-blind: nothing estimated.
 * --blind-lines <file>: that file's ESTIMATE(blind) lines and nothing else, at
 * any round, with nothing estimated — stored estimates replayed into a review
 * (the with/without-blind-estimate measurement). `refuse` is set when the file
 * gives nothing to hand over or another blind flag contradicts it; estimation
 * is off then as well, so a caller that ignores it still pays no estimator.
 */
export function blindPlan(argv: string[], projectDir: string, experimentId: string): { prior: string[]; estimate: boolean; refuse?: string } {
  const at = argv.indexOf("--blind-lines");
  if (at < 0) return {
    prior: argv.includes("--blind") ? [] : priorBlindLines(projectDir, experimentId),
    estimate: !argv.includes("--no-blind"),
  };
  const refuse = (why: string) => ({ prior: [] as string[], estimate: false, refuse: `${why} — nothing spent` });
  const other = argv.filter((a) => a === "--blind" || a === "--no-blind");
  if (other.length) return refuse(`--blind-lines cannot be combined with ${[...new Set(other)].join(" or ")}: it hands the reviewer that file's lines and estimates nothing`);
  const file = argv[at + 1];
  if (!file || file.startsWith("--")) return refuse("--blind-lines needs a file");
  let text: string;
  try { text = readFileSync(file, "utf-8"); }
  catch (err) { return refuse(`--blind-lines ${file} could not be read (${(err as Error).message.slice(0, 120)})`); }
  // Matched as priorBlindLines matches a round file, so a whole earlier review can be handed over.
  const lines = [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => /^ESTIMATE\(blind\):/.test(l)))];
  if (!lines.length) return refuse(`--blind-lines ${file} holds no ESTIMATE(blind) line, so the reviewer would be handed none`);
  return { prior: lines, estimate: false };
}

/** Flags that take a value, and flags that stand alone; any other argument starting with "-" is refused. */
const VALUE_FLAGS = ["--profile", "--blind-lines", "--summary", "--max-usd", "--raise-run-cap"];
const BARE_FLAGS = ["--blind", "--no-blind", "--check"];

/**
 * The first argument the CLI would otherwise drop, as one line; null when argv is clean. Checked before the
 * project is read: an ignored --noblind (or "no-blind", a third positional) ran the paid estimators it was
 * typed to switch off.
 */
export function argvProblem(argv: string[]): string | null {
  let positionals = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) return `${a} needs a value`;
      i++;
    } else if (a.startsWith("-")) {
      if (!BARE_FLAGS.includes(a)) return `unknown flag "${a}"`;
    } else if (++positionals > 2) return `unexpected argument "${a}" (a flag without its dashes?)`;
  }
  return null;
}

/** The newest run's results.json, parsed; null when there is none. */
export function latestResults(projectDir: string, experimentId: string): { run: string; json: any } | null {
  const runs = join(projectDir, "data", "experiments", experimentId, "runs");
  let best: { run: string; n: number; json: any } | null = null;
  try {
    for (const r of readdirSync(runs)) {
      const n = Number((r.match(/^run_(\d+)$/) ?? [])[1]);
      if (!Number.isFinite(n)) continue;
      // A run without a readable results.json is not the latest delivered one.
      const json = readResultsJson(join(runs, r, "results.json"));
      if (json !== undefined && (!best || n > best.n)) best = { run: r, n, json };
    }
  } catch { /* no runs/ */ }
  return best ? { run: best.run, json: best.json } : null;
}

/** What the write hook would have told the executor, had it written through Luxas. */
export function importProblems(projectDir: string, experimentId: string): string[] {
  const out: string[] = [];
  try { out.push(...quantityDeclarationProblems(projectDir, experimentId)); }
  catch (err) { out.push(`quantity declarations could not be validated: ${(err as Error).message.slice(0, 160)}`); }
  const latest = latestResults(projectDir, experimentId);
  if (latest) {
    try { out.push(...routeLintProblems(latest.json?.computed)); }
    catch (err) { out.push(`cross-validation routes could not be checked: ${(err as Error).message.slice(0, 160)}`); }
    if (!Array.isArray(latest.json?.computed?.quantities) || latest.json.computed.quantities.length === 0)
      out.push(`${latest.run}/results.json declares no computed.quantities[] — nothing can be blind-estimated and the claim table has no row for this experiment`);
  }
  return [...new Set(out)];
}

/**
 * The finish gate's claim-table and report-integrity issues, read-only: no model call, no usage row, no
 * gate_fires.jsonl line. reportIntegrityIssues returns [] until report/report.tex exists and folds the
 * claim table in once it does, so the table is read here as well and each text is kept once. Claim-table
 * issues are pushback-exempt there, and here.
 */
export function finishCheck(projectDir: string): IntegrityIssue[] {
  const issues = reportIntegrityIssues(projectDir);
  try {
    for (const ci of claimTableIssues(projectDir)) issues.push({ kind: "claim-status", blocking: ci.blocking, pushbackExempt: true, text: ci.text });
  } catch (err) {
    issues.push({ kind: "claim-status", blocking: false, text: `claim table could not be built: ${(err as Error).message.slice(0, 120)}` });
  }
  const seen = new Set<string>();
  return issues.filter((i) => !seen.has(i.text) && !!seen.add(i.text));
}

/** The exit code for one round's loop output: 0 satisfied · 1 not reviewed · 3 revise. A 3 sends the executor back to revise, so no review must never read as one. */
export function reviewExitCode(output: string): 0 | 1 | 3 {
  if (/\[experiment_reviewer round \d+: NOT REVIEWED/.test(output)) return 1;
  return /\[experiment_reviewer round \d+: SATISFIED\]/.test(output) ? 0 : 3;
}

/** The cap every in-process tracker falls back to without --max-cost (hooks.ts, agent.ts, subagent-runner.ts). */
const BACKSTOP_USD = 250;

/** The run's cost cap: run_config.json's maxCost when set, else the backstop a bare `luxas run` would use. Source is project-relative. */
export function runCap(projectDir: string): { cap: number; source: string } {
  try {
    const maxCost = JSON.parse(readFileSync(join(projectDir, ".agent", "run_config.json"), "utf-8"))?.maxCost;
    if (typeof maxCost === "number" && Number.isFinite(maxCost) && maxCost > 0) return { cap: maxCost, source: ".agent/run_config.json" };
  } catch { /* no run_config.json: the backstop */ }
  return { cap: BACKSTOP_USD, source: "backstop" };
}

const shellArg = (a: string) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;

/**
 * This invocation's cap: --max-usd on top of the ledger, never past the run's own cap. The ledger
 * is the run's, so a review that crosses the cap leaves the run killed at its next paid call.
 * At or past the cap already, `refuse` says so; `rerun` (the CLI arguments) completes the command it prints.
 */
export function reviewCostCap(projectDir: string, maxUsd: number, rerun?: string[]): { spent: number; runCap: number; runCapSource: string; cap: number; refuse?: string } {
  const spent = readUsageTotals(join(projectDir, ".agent", "usage.log")).cost;
  const run = runCap(projectDir);
  const budget = { spent, runCap: run.cap, runCapSource: run.source, cap: Math.min(spent + maxUsd, run.cap) };
  if (spent < run.cap) return budget;
  const args = rerun ? rerun.map(shellArg).join(" ") : `${shellArg(projectDir)} <EXPERIMENT_ID>`;
  return { ...budget, refuse:
    `run cap: the project ledger is at $${spent.toFixed(2)}, at or past the run's $${run.cap} cap (${run.source}) — nothing spent. ` +
    `A review now would be killed after its first paid call, as a bare \`luxas run\` resume would. To review anyway, raise the run's cap (a resume inherits it):\n` +
    `  npx tsx scripts/review_experiment.mts ${args} --raise-run-cap ${Math.ceil(spent + maxUsd)}` };
}

/**
 * --raise-run-cap: write N as run_config.json's maxCost, keeping what a resume inherits (model,
 * profile, savedAt). Only upwards and above the ledger — lowering the cap is `luxas run --max-cost`.
 */
export function raiseRunCap(projectDir: string, n: number): { cap: number; previous: { cap: number; source: string } } | { error: string } {
  const file = join(projectDir, ".agent", "run_config.json");
  const spent = readUsageTotals(join(projectDir, ".agent", "usage.log")).cost;
  const previous = runCap(projectDir);
  if (!Number.isFinite(n) || n <= spent || n < previous.cap)
    return { error: `--raise-run-cap ${n} refused: it must be above the ledger ($${spent.toFixed(2)}) and at least the current run cap ($${previous.cap}, ${previous.source}); lowering the cap is \`luxas run --max-cost\`` };
  let cfg: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf-8"));
      if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not a JSON object");
      cfg = j;
    } catch (err) { return { error: `--raise-run-cap refused: ${file} is unreadable (${(err as Error).message.slice(0, 120)}) and holds what a resume inherits` }; }
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    // Renamed into place: a live run's context reads this file every turn.
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...cfg, maxCost: n }, null, 2) + "\n");
    renameSync(`${file}.tmp`, file);
  } catch (err) { return { error: `--raise-run-cap could not write ${file}: ${(err as Error).message.slice(0, 160)}` }; }
  return { cap: n, previous };
}

/**
 * The end line's spend, read from the payer on each usage row: what this invocation's agents paid
 * (every one is spawned under "review_experiment.<EID>.") apart from other writers in the same window,
 * the ledger against the run's cap, and what a bare `luxas run` resume would meet at that ledger.
 * `since` is taken before usage tracking starts. A second review of the same EID at once counts as this one.
 */
export function spendReport(projectDir: string, experimentId: string, since: number): string {
  type Spend = Map<string, { cost: number; calls: number }>;
  const usageLog = join(projectDir, ".agent", "usage.log");
  const mine = readUsageByAgent(usageLog, { since, idPrefix: `review_experiment.${experimentId}.` });
  const others = readUsageByAgent(usageLog, { since });
  for (const [type, v] of mine) {
    const o = others.get(type)!; // `mine` is a subset of the window
    o.cost -= v.cost; o.calls -= v.calls;
    if (o.calls <= 0) others.delete(type);
  }
  const sum = (m: Spend) => [...m.values()].reduce((s, v) => s + v.cost, 0);
  const list = (m: Spend) => [...m].sort((a, b) => b[1].cost - a[1].cost)
    .map(([type, v]) => `${type} $${v.cost.toFixed(2)} (${v.calls} call${v.calls === 1 ? "" : "s"})`).join(", ");
  const spent = readUsageTotals(usageLog).cost;
  const run = runCap(projectDir);
  const capText = run.source === "backstop" ? `the $${run.cap} backstop (no maxCost in .agent/run_config.json)` : `the run's $${run.cap} cap (${run.source})`;
  const pct = Math.round(SOFT_CAP_FRACTION * 100);
  const freezeAt = run.cap * SOFT_CAP_FRACTION;
  // As hooks.ts and usage-log.ts enforce them: the freeze from the soft cap on, the kill once a paid call takes the ledger past the cap.
  const resume = spent >= run.cap
    ? "at or past the cap, so a bare `luxas run` resume would be killed at its first paid call"
    : spent >= freezeAt
      ? `past the ${pct}% mark ($${freezeAt.toFixed(2)}), so a bare \`luxas run\` resume would start INSIDE the finalization freeze (landing only, no new experiments or searches)`
      : `$${(freezeAt - spent).toFixed(2)} before the ${pct}% finalization freeze, so a bare \`luxas run\` resume would start normally`;
  return [
    `this review: $${sum(mine).toFixed(2)}${mine.size ? ` — ${list(mine)}` : " (no paid call)"}`,
    `other writers in the same window: ${others.size ? `$${sum(others).toFixed(2)} — ${list(others)}` : "none"}`,
    `project ledger $${spent.toFixed(2)} of ${capText}: ${resume}. \`luxas run --max-cost N\` overrides the cap.`,
  ].join("\n");
}

/**
 * A run that stopped on an unfunded provider leaves .agent/unfunded.json behind and only `luxas run`
 * archives it, so every review's first model call would be refused for good. Archive it (renamed,
 * provenance kept) unless a process of the run is still live — what `luxas stop` would kill: then
 * the stop is in progress and the sentinel stays. `psOut` replaces `ps -eo pid=,args=` for the gate.
 */
export function clearStaleUnfundedSentinel(projectDir: string, psOut?: string): { archived: string | null; livePids: number[] } {
  const agentDir = join(projectDir, ".agent");
  if (!existsSync(join(agentDir, UNFUNDED_SENTINEL))) return { archived: null, livePids: [] };
  const runPid = readRunPid(projectDir);
  let alive = false;
  if (runPid !== null) { try { process.kill(runPid, 0); alive = true; } catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; } }
  let rows: ReturnType<typeof parsePs> = [];
  try { rows = parsePs(psOut ?? execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" })); } catch { /* no ps: run.pid alone decides */ }
  // run.pid dead but a detached subagent-runner of that run still mid-tool counts as live.
  const live = new Set(findRunProcesses(rows, projectDir, alive ? runPid : null, process.pid));
  if (alive && runPid !== null) live.add(runPid);
  if (live.size) return { archived: null, livePids: [...live].sort((a, b) => a - b) };
  return { archived: archiveUnfundedSentinel(agentDir), livePids: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const usage = "usage: review_experiment.mts <projectDir> <EXPERIMENT_ID> [--profile dual|claude] [--blind | --no-blind | --blind-lines <file>] [--summary <file>] [--max-usd N] [--raise-run-cap N]\n" +
    "       review_experiment.mts <projectDir> --check";
  const argProblem = argvProblem(argv);
  if (argProblem) { console.error(`${argProblem} — nothing spent\n${usage}`); process.exit(2); }
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const isPositional = (a: string, i: number) => !a.startsWith("--") && !VALUE_FLAGS.includes(argv[i - 1] ?? "");
  const positional = argv.filter(isPositional);
  const [projectArg, experimentId] = positional;
  if (!projectArg) { console.error(usage); process.exit(2); }
  const projectDir = resolve(projectArg);
  if (!existsSync(join(projectDir, "RESEARCH.md"))) { console.error(`not a Luxas project (no RESEARCH.md): ${projectDir}`); process.exit(2); }
  // Before the experiment id is required and before anything that can spend, write or set the profile.
  if (argv.includes("--check")) {
    const issues = finishCheck(projectDir);
    const blocking = issues.filter((i) => i.blocking);
    // In full: on the hand route this is the only reader of the disclosures the report must carry.
    const disclosures = issues.filter((i) => !i.blocking && i.kind === "disclosure");
    const other = issues.length - blocking.length - disclosures.length;
    const text = [
      "finish() subset — claim table + report integrity only. A clean result does NOT mean finish() would pass: finish() also requires a compiled PDF with figures, plan/synthesis/lead disposition, language, contradiction sweep, typesetter, a fresh PI verdict and liveness.",
      blocking.length ? `${blocking.length} blocking issue(s):\n\n${formatIntegrityIssues(blocking)}` : "no blocking issue in this subset",
      ...(disclosures.length ? [`${disclosures.length} non-blocking disclosure(s):\n\n${formatIntegrityIssues(disclosures)}`] : []),
      `${other} other non-blocking issue(s) not shown`,
    ].join("\n\n");
    // Flushed before exiting: stdout to a pipe is asynchronous on macOS and a long list would be cut.
    await new Promise<void>((done) => process.stdout.write(`${text}\n`, () => done()));
    process.exit(blocking.length ? 4 : 0);
  }
  if (!experimentId) { console.error(usage); process.exit(2); }
  // An argument mistake, so ahead of the delivery check and of everything that spends, writes or archives.
  const plan = blindPlan(argv, projectDir, experimentId);
  if (plan.refuse) { console.error(plan.refuse); process.exit(2); }
  const notDelivered = experimentDeliveryProblem(projectDir, experimentId);
  if (notDelivered) {
    console.error(`NOT DELIVERED: ${notDelivered} — nothing to review, nothing spent.`);
    process.exit(2);
  }

  const profile = flag("--profile") ?? "dual";
  if (profile === "dual") applyDualProfileEnv({ setBrain: false });
  else if (profile !== "claude") { console.error(`unknown --profile "${profile}" (dual | claude)`); process.exit(2); }
  // One round per invocation: a REVISE must not re-spawn Luxas's own `experiment` on work it did not write.
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";

  // Same ledger as the run's own sub-agents; the cap is this invocation's, on top of what the project has spent.
  const usageLog = join(projectDir, ".agent", "usage.log");
  const maxUsd = Number(flag("--max-usd") ?? 5);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) { console.error(`--max-usd must be a positive number, got "${flag("--max-usd")}"`); process.exit(2); }
  if (argv.includes("--raise-run-cap")) {
    if (!Number.isFinite(Number(flag("--raise-run-cap")))) { console.error(`--raise-run-cap must be a number, got "${flag("--raise-run-cap")}"`); process.exit(2); }
    const raised = raiseRunCap(projectDir, Number(flag("--raise-run-cap")));
    if ("error" in raised) { console.error(raised.error); process.exit(2); }
    console.error(`↑ run cap raised to $${raised.cap} in .agent/run_config.json (was $${raised.previous.cap}, ${raised.previous.source}); a \`luxas run\` resume inherits it. ` +
      `A run live right now keeps its launch cap until it is restarted (background experiments it starts from now on read the new one).`);
  }
  // Never past the run's own cap: refused before any spawn when the ledger is already there.
  const budget = reviewCostCap(projectDir, maxUsd, [projectDir, experimentId, ...argv.filter((a, i) => !isPositional(a, i))]);
  if (budget.refuse) { console.error(budget.refuse); process.exit(2); }
  // After every other refusal, so a refused invocation never consumes the sentinel; before any spawn,
  // so a live run's registry gets no phantom agent.
  const unfunded = clearStaleUnfundedSentinel(projectDir);
  if (unfunded.livePids.length) {
    console.error(`UNFUNDED: the run is still live (pid ${unfunded.livePids.join(", ")}) and stopping on an unfunded provider (.agent/${UNFUNDED_SENTINEL}). ` +
      `Wait for it to exit or \`luxas stop\` it, top up, then review — nothing spent.`);
    process.exit(1);
  }
  if (unfunded.archived) console.error(`↺ The last run stopped on an unfunded provider (${unfunded.archived}). Reviewing anyway — make sure it was topped up.`);
  const startedAt = Date.now(); // every row this invocation pays for is stamped at or after it
  installUsageTracking(usageLog, { maxCostUsd: budget.cap });

  const round = nextReviewRound(projectDir, experimentId);
  if (!plan.estimate) process.env.LUXAS_BLIND_ESTIMATE = "0";
  // For the start line only; the loop decides the same way and notes any id it caps or finds settled.
  let decls: ReturnType<typeof headlineDeclsFor> = [];
  try { decls = headlineDeclsFor(buildClaimTable(projectDir), experimentId); } catch { /* the loop reports a malformed table */ }
  const reusedCount = decls.filter((d) => reusableBlindLine(plan.prior, d)).length;
  const toEstimate = process.env.LUXAS_BLIND_ESTIMATE === "0" ? "0 (off)" : String(decls.length - reusedCount);
  const problems = importProblems(projectDir, experimentId);
  const summaryFile = flag("--summary");
  const summary = summaryFile && existsSync(summaryFile) ? readFileSync(summaryFile, "utf-8").trim() : `(experiment ${experimentId} was executed outside the brain's spawn)`;
  const capNote = budget.cap < budget.spent + maxUsd
    ? `cost cap $${budget.cap.toFixed(2)} — the run's cap ($${budget.runCap}, ${budget.runCapSource}) binds before --max-usd ${maxUsd}: $${(budget.cap - budget.spent).toFixed(2)} left`
    : `cost cap $${budget.cap.toFixed(2)} = ledger $${budget.spent.toFixed(2)} + --max-usd ${maxUsd} (the run's $${budget.runCap} cap, ${budget.runCapSource}, binds only when that sum exceeds it)`;
  const handed = flag("--blind-lines") ? `handed from ${flag("--blind-lines")}: ${plan.prior.length}` : `reused ${reusedCount}`;
  console.error(`◈ review_experiment ${experimentId} — round ${round}, profile ${profile}, blind estimates ${handed} / estimating ${toEstimate}, ${capNote}`);
  if (problems.length) console.error(`◈ write-time checks the executor never saw (${problems.length}):\n${problems.map((p) => `  - ${p.split("\n")[0].slice(0, 300)}`).join("\n")}`);
  else console.error("◈ write-time checks: clean");

  const templateVars = { PROJECT_DIR: projectDir, EXPERIMENT_ID: experimentId };
  const t0 = Date.now();
  const result = await runExperimentReviewLoop(
    { output: summary, success: true },
    {
      projectDir,
      mergedTemplateVars: templateVars,
      // Never used here: delivery was checked above and one round means no revision spawn.
      baseOpts: { name: "experiment", templateVars, projectDir, getApiKey },
      initialTask: "",
      getApiKey,
      parentAgentId: `review_experiment.${experimentId}`,
      depth: 0,
      makeSpawnTool: createSpawnToolFactory(projectDir, getApiKey),
      startRound: round,
      priorBlindLines: plan.prior,
    },
  );
  const tail = result.output.slice(result.output.lastIndexOf("\n---\n[experiment_reviewer") + 1);
  process.stdout.write(tail.startsWith("---") ? tail : result.output);
  process.stdout.write("\n");
  if (problems.length) process.stdout.write(`\nWrite-time validation of results.json (never shown to the executor):\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
  // The hand route never calls finish(): say whether this experiment still blocks it. Advisory only.
  try {
    const e = experimentNumberOf(experimentId);
    const blocking = finishCheck(projectDir).filter((i) => i.blocking);
    const mine = blocking.filter((i) => i.text.includes(experimentId) || (e !== null && new RegExp(`\\b${e}\\b`).test(i.text)));
    process.stdout.write(`\nfinish-gate subset: ${mine.length} blocking issue(s) mention ${e ?? experimentId} (${blocking.length} in the project) — run --check\n`);
  } catch { /* never changes the exit code */ }
  const code = reviewExitCode(result.output);
  console.error(`\n◈ ${code === 0 ? "SATISFIED" : code === 1 ? "NOT REVIEWED" : "REVISE"} — reviews/experiment_review_${experimentId}_r${round}.md — ${((Date.now() - t0) / 60000).toFixed(1)} min\n` +
    spendReport(projectDir, experimentId, startedAt).split("\n").map((l) => `  ${l}`).join("\n"));
  process.exit(code);
}
