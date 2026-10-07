/**
 * smoke_review_experiment — an experiment executed outside the brain's spawn
 * gets the same harness review, one round at a time, without losing a round.
 *
 * scripts/review_experiment.mts enters runExperimentReviewLoop once per round
 * (2026-10-07: Dy E2–E4 were executed by `claude -p`, which the brain cannot
 * launch). What can go wrong there, and is pinned here with a stub spawner
 * (no model):
 *
 * 1. the round number: a second invocation must write _r2.md, not overwrite
 *    _r1.md — claims-table.ts reads every round's lines.
 * 2. a REVISE must not re-spawn Luxas's own `experiment` on work it did not
 *    write.
 * 3. the write-time validation the outside executor never saw is run.
 * 4. nothing is spent on an experiment that has not delivered.
 * 5. what is spent is written to the project's usage log.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runExperimentReviewLoop } from "../src/tools/spawn-agent.ts";
import { importProblems, latestResults, nextReviewRound, priorBlindLines } from "./review_experiment.mts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const projectDir = mkdtempSync(join(tmpdir(), "review-exp-"));
writeFileSync(join(projectDir, "RESEARCH.md"), "# q\n");
const EID = "E2_light_shift";
const runDir = (eid: string, run: string) => { const d = join(projectDir, "data", "experiments", eid, "runs", run); mkdirSync(d, { recursive: true }); return d; };
const review = (eid: string, n: number) => join(projectDir, "reviews", `experiment_review_${eid}_r${n}.md`);
const quantity = (uncertainty: unknown) => ({ id: "light_shift_kappa", key: "computed.kappa", headline: true, observable: "differential light shift over trap depth at 1064 nm (dimensionless)", uncertainty, uncertainty_source: "MC", inputs: { alpha_s_au: 184.4 } });

console.log("1. the next round is one past the highest persisted round of THIS experiment");
check("no reviews/ directory → round 1", nextReviewRound(projectDir, EID) === 1);
mkdirSync(join(projectDir, "reviews"), { recursive: true });
writeFileSync(review(EID, 1), "round one\n");
writeFileSync(review(EID, 3), "round three\n");
writeFileSync(review(`${EID}_extended`, 7), "another experiment whose id starts with this one\n");
writeFileSync(review("E12_light_shift", 9), "another experiment\n");
check("r1 and r3 exist → round 4 (other experiments' files are not counted)", nextReviewRound(projectDir, EID) === 4, String(nextReviewRound(projectDir, EID)));

console.log("\n2. a later round is persisted under its own number and revises nothing");
writeFileSync(join(runDir(EID, "run_1"), "results.json"), JSON.stringify({ computed: { kappa: 4e-7, quantities: [quantity(3e-7)] } }));
{
  process.env.LUXAS_BLIND_ESTIMATE = "0";
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  const calls: string[] = [];
  let reviewerPrompt = "";
  const BLIND = "ESTIMATE(blind): light_shift_kappa — 3.2e-7 ± 1.2e-7 via tensor shift — inputs: [alpha_s_au=184.4]";
  writeFileSync(review(EID, 3), `# round three\n\nBlind estimates:\n${BLIND}\n${BLIND}\n\nReviewer obligation lines:\nESTIMATE: light_shift_kappa — 4e-7 ± 3e-7 via the agent's MC\n`);
  const round3 = readFileSync(review(EID, 3), "utf-8");
  check("earlier rounds' blind lines are read back once each; the reviewer's own ESTIMATE line is not one", JSON.stringify(priorBlindLines(projectDir, EID)) === JSON.stringify([BLIND]), JSON.stringify(priorBlindLines(projectDir, EID)));
  const stub = async (opts: any) => {
    calls.push(opts.name);
    if (opts.name === "experiment_reviewer") reviewerPrompt = String(opts.prompt);
    return { elapsed: 1, success: true, agentId: `${opts.name}-x`, exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any,
      output: "VERDICT: revise\nFEEDBACK: the 532 nm sign is undetermined" };
  };
  const out = await runExperimentReviewLoop({ output: "executed outside", success: true }, {
    projectDir, mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: projectDir },
    baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir, getApiKey: () => undefined },
    initialTask: "", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: stub as any, startRound: 4, priorBlindLines: priorBlindLines(projectDir, EID),
  });
  check("the later-round reviewer is handed the earlier blind estimate, and no estimator ran", reviewerPrompt.includes(BLIND) && !calls.includes("replicator"), calls.join(","));
  check("…and it is persisted with this round too", readFileSync(review(EID, 4), "utf-8").includes(BLIND));
  check("the review lands in _r4.md", existsSync(review(EID, 4)) && /round 4/.test(readFileSync(review(EID, 4), "utf-8")), existsSync(review(EID, 4)) ? readFileSync(review(EID, 4), "utf-8").slice(0, 80) : "missing");
  check("earlier rounds are byte-identical", readFileSync(review(EID, 1), "utf-8") === "round one\n" && readFileSync(review(EID, 3), "utf-8") === round3);
  check("no _r1 was rewritten into existence elsewhere (_r2 still absent)", !existsSync(review(EID, 2)));
  check("the reviewer ran once and `experiment` was NOT re-spawned", calls.join(",") === "experiment_reviewer", calls.join(","));
  check("the output names the round and carries the feedback", /experiment_reviewer round 4: REVISE/.test(out.output) && out.output.includes("532 nm sign is undetermined"), out.output.slice(-200));
  delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
}

console.log("\n3. the write-time checks the outside executor never saw");
check("a clean declaration has no problems", importProblems(projectDir, EID).length === 0, importProblems(projectDir, EID).join(" | "));
writeFileSync(join(runDir("E3_malformed", "run_1"), "results.json"), JSON.stringify({ computed: { kappa: 4e-7, quantities: [{ ...quantity("3e-7"), id: "light_shift_kappa_string_sigma" }] } }));
check("a string uncertainty is reported, never coerced", importProblems(projectDir, "E3_malformed").some((p) => /uncertainty|numeric|string/i.test(p)), importProblems(projectDir, "E3_malformed").join(" | "));
writeFileSync(join(runDir("E4_bare", "run_1"), "results.json"), JSON.stringify({ computed: { x: 1 } }));
check("no computed.quantities[] is reported (nothing to estimate, no claim row)", importProblems(projectDir, "E4_bare").some((p) => /declares no computed\.quantities/.test(p)));
writeFileSync(join(runDir("E5_runs", "run_2"), "results.json"), JSON.stringify({ computed: { tag: "two" } }));
writeFileSync(join(runDir("E5_runs", "run_10"), "results.json"), JSON.stringify({ computed: { tag: "ten" } }));
writeFileSync(join(runDir("E5_runs", "run_11"), "results.json"), "{ not json");
check("the latest run is the highest NUMBER with a parseable results.json (run_10, not run_2 or the torn run_11)", latestResults(projectDir, "E5_runs")?.run === "run_10", String(latestResults(projectDir, "E5_runs")?.run));

console.log("\n4. the command refuses before spending anything");
const cli = (args: string[]): { code: number; err: string } => {
  try { execFileSync("npx", ["tsx", join(ROOT, "scripts", "review_experiment.mts"), ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LUXAS_MAX_REVIEW_ITERATIONS: "" } }); return { code: 0, err: "" }; }
  catch (e: any) { return { code: e.status ?? -1, err: String(e.stderr ?? "") }; }
};
mkdirSync(join(projectDir, "data", "experiments", "E6_empty", "runs", "run_1"), { recursive: true });
const nd = cli([projectDir, "E6_empty"]);
check("an experiment with no results.json → exit 2, NOT DELIVERED", nd.code === 2 && /NOT DELIVERED/.test(nd.err), `${nd.code} ${nd.err.slice(0, 120)}`);
const np = cli([join(projectDir, "data"), EID]);
check("a directory that is not a project → exit 2", np.code === 2 && /not a Luxas project/.test(np.err), `${np.code} ${np.err.slice(0, 120)}`);
const us = cli([projectDir]);
check("a missing experiment id → usage, exit 2", us.code === 2 && /usage:/.test(us.err), `${us.code} ${us.err.slice(0, 120)}`);
const bc = cli([projectDir, EID, "--max-usd", "lots"]);
check("a cap that is not a number → exit 2 before any spawn", bc.code === 2 && /--max-usd must be a positive number/.test(bc.err), `${bc.code} ${bc.err.slice(0, 120)}`);

console.log("\n5. the spend lands in the project's ledger");
// Wiring only (a behavioural check needs a paid model call): the first live use
// spent $5 that the project total — what the run's cost cap reads — never saw.
const src = readFileSync(join(ROOT, "scripts", "review_experiment.mts"), "utf-8");
check("usage tracking is installed on <project>/.agent/usage.log", /const usageLog = join\(projectDir, "\.agent", "usage\.log"\)/.test(src) && /installUsageTracking\(usageLog, \{ maxCostUsd: spentBefore \+ maxUsd \}\)/.test(src));
check("…before the review loop is entered", src.indexOf("installUsageTracking(usageLog") > 0 && src.indexOf("installUsageTracking(usageLog") < src.indexOf("await runExperimentReviewLoop("));

rmSync(projectDir, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log("\nALL PASS — an outside-executed experiment is reviewed round by round through the same loop.");
