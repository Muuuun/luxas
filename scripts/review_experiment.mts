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
 *        [--no-blind]              skip blind estimates (a later round reuses round 1's)
 *        [--summary <file>]        the executor's closing message, shown to nobody but kept in the output
 *        [--max-usd N]             stop when THIS invocation has spent N (default 5)
 *
 * Exit: 0 satisfied · 3 revise · 2 not delivered / usage · 1 a spawn failed.
 * Billed: up to 3 blind estimates on the producer profile + one reviewer.
 * The spend is written to the project's .agent/usage.log like any sub-agent's
 * (the first live use, 2026-10-07, did not, and three reviews — $5 — were
 * missing from the project total that the run's cost cap reads).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getApiKey } from "../src/auth.js";
import { applyDualProfileEnv } from "../src/profiles.js";
import { quantityDeclarationProblems, routeLintProblems } from "../src/claims-review.js";
import { installUsageTracking, readUsageTotals } from "../src/usage-log.js";
import { createSpawnToolFactory, experimentDelivered, runExperimentReviewLoop } from "../src/tools/spawn-agent.js";

/** Next review round for this experiment: one past the highest persisted `_r<N>.md`. */
export function nextReviewRound(projectDir: string, experimentId: string): number {
  let max = 0;
  try {
    for (const f of readdirSync(join(projectDir, "reviews"))) {
      const m = f.match(/^experiment_review_(.+)_r(\d+)\.md$/);
      if (m && m[1] === experimentId) max = Math.max(max, Number(m[2]));
    }
  } catch { /* no reviews/ yet → round 1 */ }
  return max + 1;
}

/** The newest run's results.json, parsed; null when there is none. */
export function latestResults(projectDir: string, experimentId: string): { run: string; json: any } | null {
  const runs = join(projectDir, "data", "experiments", experimentId, "runs");
  let best: { run: string; n: number; json: any } | null = null;
  try {
    for (const r of readdirSync(runs)) {
      const n = Number((r.match(/^run_(\d+)$/) ?? [])[1]);
      if (!Number.isFinite(n)) continue;
      try { const json = JSON.parse(readFileSync(join(runs, r, "results.json"), "utf-8")); if (!best || n > best.n) best = { run: r, n, json }; }
      catch { /* a run without a parseable results.json is not the latest delivered one */ }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--profile", "--summary", "--max-usd"].includes(argv[i - 1] ?? ""));
  const [projectArg, experimentId] = positional;
  if (!projectArg || !experimentId) {
    console.error("usage: review_experiment.mts <projectDir> <EXPERIMENT_ID> [--profile dual|claude] [--no-blind] [--summary <file>] [--max-usd N]");
    process.exit(2);
  }
  const projectDir = resolve(projectArg);
  if (!existsSync(join(projectDir, "RESEARCH.md"))) { console.error(`not a Luxas project (no RESEARCH.md): ${projectDir}`); process.exit(2); }
  if (!experimentDelivered(projectDir, experimentId)) {
    console.error(`NOT DELIVERED: no parseable data/experiments/${experimentId}/runs/*/results.json — nothing to review, nothing spent.`);
    process.exit(2);
  }

  const profile = flag("--profile") ?? "dual";
  if (profile === "dual") applyDualProfileEnv({ setBrain: false });
  else if (profile !== "claude") { console.error(`unknown --profile "${profile}" (dual | claude)`); process.exit(2); }
  // One round per invocation: a REVISE must not re-spawn Luxas's own `experiment` on work it did not write.
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  if (argv.includes("--no-blind")) process.env.LUXAS_BLIND_ESTIMATE = "0";

  // Same ledger as the run's own sub-agents; the cap is this invocation's, on top of what the project has spent.
  const usageLog = join(projectDir, ".agent", "usage.log");
  const maxUsd = Number(flag("--max-usd") ?? 5);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) { console.error(`--max-usd must be a positive number, got "${flag("--max-usd")}"`); process.exit(2); }
  const spentBefore = readUsageTotals(usageLog).cost;
  installUsageTracking(usageLog, { maxCostUsd: spentBefore + maxUsd });

  const round = nextReviewRound(projectDir, experimentId);
  const problems = importProblems(projectDir, experimentId);
  const summaryFile = flag("--summary");
  const summary = summaryFile && existsSync(summaryFile) ? readFileSync(summaryFile, "utf-8").trim() : `(experiment ${experimentId} was executed outside the brain's spawn)`;
  console.error(`◈ review_experiment ${experimentId} — round ${round}, profile ${profile}, blind estimates ${process.env.LUXAS_BLIND_ESTIMATE === "0" ? "off" : "on"}`);
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
    },
  );
  const tail = result.output.slice(result.output.lastIndexOf("\n---\n[experiment_reviewer") + 1);
  process.stdout.write(tail.startsWith("---") ? tail : result.output);
  process.stdout.write("\n");
  if (problems.length) process.stdout.write(`\nWrite-time validation of results.json (never shown to the executor):\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
  const satisfied = /\[experiment_reviewer round \d+: SATISFIED\]/.test(result.output);
  console.error(`\n◈ ${satisfied ? "SATISFIED" : "REVISE"} — reviews/experiment_review_${experimentId}_r${round}.md — ${((Date.now() - t0) / 60000).toFixed(1)} min — project spend since start $${(readUsageTotals(usageLog).cost - spentBefore).toFixed(2)} (includes any concurrent writer)`);
  process.exit(!result.success ? 1 : satisfied ? 0 : 3);
}
