/**
 * smoke_background_review — every experiment gets the harness review, whatever
 * path it finished on.
 *
 * Regression for 2026-09-24 (notes/backtest-2026-09-24/SUMMARY.md §2): the
 * auto-review loop lived inline in spawn_agent's FOREGROUND branch; background
 * spawns returned before reaching it. 5 of the last 7 runs spawned experiments
 * in background, and yttrium-tweezer's E1–E4 were never reviewed — where every
 * physics defect that reached its abstract lived.
 *
 * 1. behavior: runExperimentReviewLoop re-runs a REVISE'd experiment and
 *    persists each round's review file (stub spawner, no model).
 * 2. behavior: parallel `tasks` for agent="experiment" are refused, not
 *    silently unreviewed.
 * 3. wiring: the detached background runner calls the same loop and returns
 *    its output.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExperimentReviewLoop, createSpawnAgentTool } from "../src/tools/spawn-agent.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

process.env.LUXAS_BLIND_ESTIMATE = "0";
delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;

const projectDir = mkdtempSync(join(tmpdir(), "bg-review-"));
const EID = "E1_test";
// This gate is about the REVIEW loop, so its experiment has delivered: since
// 2026-10-06 an experiment with no results.json is sent back before any review
// (smoke_solo_executor §5 covers that path).
mkdirSync(join(projectDir, "data", "experiments", EID, "runs", "run_1"), { recursive: true });
writeFileSync(join(projectDir, "data", "experiments", EID, "runs", "run_1", "results.json"), "{\"computed\":{}}");
const calls: string[] = [];
let reviewRound = 0;
const stub = async (opts: any) => {
  calls.push(opts.name);
  const base = { elapsed: 1, success: true, agentId: `${opts.name}-x`, exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any };
  if (opts.name === "experiment_reviewer") {
    reviewRound++;
    return { ...base, output: reviewRound === 1 ? "VERDICT: revise\nFEEDBACK: the observable is |gg> return, not gate fidelity" : "VERDICT: satisfied" };
  }
  if (opts.name === "experiment") return { ...base, output: `revised: ${String(opts.prompt).includes("observable is |gg>") ? "saw feedback" : "no feedback"}` };
  return { ...base, output: "" };
};

// 1. REVISE → re-run → satisfied
{
  const out = await runExperimentReviewLoop({ output: "first run", success: true }, {
    projectDir,
    mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: projectDir },
    baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir, getApiKey: () => undefined },
    initialTask: "run E1",
    getApiKey: () => undefined,
    makeSpawnTool: () => null,
    spawn: stub as any,
  });
  check("reviewer ran twice (revise, then satisfied)", calls.filter((c) => c === "experiment_reviewer").length === 2, calls.join(","));
  check("experiment re-ran once, with the reviewer's feedback in its task", calls.filter((c) => c === "experiment").length === 1 && out.output.includes("revised: saw feedback"), out.output.slice(0, 200));
  check("final output carries the SATISFIED verdict", /experiment_reviewer round 2: SATISFIED/.test(out.output));
  check("each round's review file is persisted", existsSync(join(projectDir, "reviews", `experiment_review_${EID}_r1.md`)) && existsSync(join(projectDir, "reviews", `experiment_review_${EID}_r2.md`)));
}

// failed experiment → nothing to review
{
  calls.length = 0;
  const out = await runExperimentReviewLoop({ output: "died", success: false }, {
    projectDir, mergedTemplateVars: { EXPERIMENT_ID: EID }, baseOpts: { name: "experiment", projectDir, getApiKey: () => undefined },
    initialTask: "t", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: stub as any,
  });
  check("a failed experiment is returned unreviewed", calls.length === 0 && out.output === "died");
}

// 2. parallel experiments refused
{
  const tool = createSpawnAgentTool(projectDir, {}, () => undefined, "brain", 0);
  const r: any = await tool.execute("t1", { agent: "experiment", tasks: ["a", "b"], templateVars: { EXPERIMENT_ID: EID } });
  const text = r.content?.[0]?.text ?? "";
  check("parallel tasks for agent=experiment are refused", r.details?.success === false && /not supported for agent="experiment"/.test(text), text.slice(0, 160));
}

// 3. the background runner uses the same loop
{
  const runner = readFileSync("src/subagent-runner.ts", "utf-8");
  check("subagent-runner imports runExperimentReviewLoop", /import \{[^}]*runExperimentReviewLoop[^}]*\} from "\.\/tools\/spawn-agent\.js"/.test(runner));
  check("subagent-runner reviews agent=experiment and returns the reviewed output",
    /args\.agent === "experiment"[\s\S]{0,200}runExperimentReviewLoop\(/.test(runner) && /output = reviewed\.output/.test(runner) && /markDone\(agentDir, args\.id, output\.slice/.test(runner));
  const fg = readFileSync("src/tools/spawn-agent.ts", "utf-8");
  check("foreground path uses the same loop (no second inline copy)", /params\.agent === "experiment"\) \{\s*result = await runExperimentReviewLoop\(/.test(fg) && (fg.match(/name: "experiment_reviewer"/g) ?? []).length === 1);
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — foreground and background experiments get the same harness review.");
