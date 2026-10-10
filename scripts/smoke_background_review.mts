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
 * C8. behavior: background ids are unique across brain processes, and the
 *    runner never appends to a transcript it did not start.
 * C7. behavior: a failed revision is reported as failed, keeping the last
 *    delivered output and the feedback it never answered; wiring: the runner
 *    records the last run's exit and contains a throw from the review.
 * C6. behavior: a reviewer that gave no review (provider error or refusal,
 *    empty turn, spawn that threw) is spawned once more; still silent, the
 *    round is NOT REVIEWED — never REVISE feedback that re-runs the
 *    experiment, and never a newer round that hides an earlier REVISE.
 * C12. behavior: a blind estimator, through its real wrapped tools, writes
 *    only blind/<QID>/ and can neither read nor write replication/ or another
 *    estimator's scratch; the cached replicator definition is not mutated.
 * C14. behavior: a re-dispatch of an experiment that already has r1..r3,
 *    called as the foreground and background callers call it, writes r4 (and
 *    r5 after a REVISE) without touching r1..r3, and re-estimates only the
 *    quantity whose inputs moved; wiring: neither caller passes a round.
 * C33. behavior: a round's blind estimators run at once, each on its own
 *    blind/<QID>/; their lines and notes come out in declaration order, and
 *    one that throws (even synchronously) costs only its own line.
 * F7. behavior: a markdown-bold VERDICT/FEEDBACK reply is read as its plain
 *    form: a bold REVISE persists "VERDICT: revise" with its FEEDBACK, which
 *    openReviewFindings binds; a bold SATISFIED ends the loop with no re-run;
 *    a bold "satisfied only after …" is still not satisfied.
 * F8. behavior: a results.json with bare NaN/Infinity (Python json.dump's
 *    default) is delivered, reviewed without a re-send, and read by the claim
 *    table (its NaN-valued declaration named as not finite, string contents
 *    untouched), also when a revision writes it; a truly corrupt file is not
 *    delivered and the re-send, the loop's NOT DELIVERED line and the CLI's
 *    say "not valid JSON" instead of "does not exist".
 * F12. behavior (in the C12 block): each blind estimator's task names its own
 *    blind/<QID>/ scratch dir, the same root its definition enforces, before
 *    the ESTIMATE-format instruction that must stay last.
 */
import cp, { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runExperimentReviewLoop, createSpawnAgentTool } from "../src/tools/spawn-agent.ts";
import * as spawnAgentModule from "../src/tools/spawn-agent.ts";
import { buildAgentFromDefinition } from "../src/agents/spawn.ts";
import { openReviewFindings } from "../src/claims-review.ts";
// Namespace import: an export that does not exist yet fails its own check instead of the whole file.
import * as claimsTableModule from "../src/claims-table.ts";
import * as registryModule from "../src/agents/registry.ts";
import { resolveToolSets } from "../src/agents/tool-sets.ts";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.ts";
import { expandTemplate } from "../src/utils.ts";

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

// C8. The bg counter lived in the brain process, so a resumed brain launched
// brain.experiment-bg-1 again and its runner appended a new experiment to the
// previous process's transcript (Dy: E2's solo run landed in E1's revision
// file, and a resume "recovered" E1's text as E2's result). Ids now come from
// disk; the runner refuses an existing session file.
{
  const p = mkdtempSync(join(tmpdir(), "bg-ids-"));
  const conv = join(p, ".agent", "conversations");
  mkdirSync(conv, { recursive: true });
  mkdirSync(join(p, ".agent", "runner-logs"), { recursive: true });
  const OLD1 = '{"type":"session","id":"old1"}\n{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"E1 revision (previous brain process)"}]}}\n';
  const OLD2 = '{"type":"session","id":"old2"}\n';
  writeFileSync(join(conv, "brain.experiment-bg-1.jsonl"), OLD1);
  writeFileSync(join(conv, "brain.experiment-bg-2.jsonl"), OLD2);
  // The restore empties the registry; the runner log written at launch still
  // remembers bg-4 (a replicator whose transcript was never written).
  writeFileSync(join(p, ".agent", "runner-logs", "brain.replicator-bg-4.err"), "");

  // No runner starts: node:child_process.spawn is stubbed for the launch.
  const launched: string[][] = [];
  const realSpawn = cp.spawn;
  (cp as any).spawn = (_cmd: string, args: string[]) => { launched.push(args); return { pid: 424242, unref() {}, on() {} }; };
  syncBuiltinESMExports();
  try {
    const tool = createSpawnAgentTool(p, {}, () => undefined, "brain", 0);
    const r1: any = await tool.execute("c8a", { agent: "experiment", task: "E2 task", background: true, templateVars: { EXPERIMENT_ID: "E2_x" } });
    const session = launched[0]?.[launched[0].indexOf("--session") + 1];
    check("C8 next background id is one past the highest on disk (bg-5)", r1.details?.agentId === "brain.experiment-bg-5", `got ${r1.details?.agentId}`);
    check("C8 the runner's --session names a file that does not exist yet", !!session && !existsSync(session), `session=${session}`);
    check("C8 the previous process's bg-1 transcript is byte-identical", readFileSync(join(conv, "brain.experiment-bg-1.jsonl"), "utf-8") === OLD1);
    check("C8 the previous process's bg-2 transcript is byte-identical", readFileSync(join(conv, "brain.experiment-bg-2.jsonl"), "utf-8") === OLD2);
    const r2: any = await tool.execute("c8b", { agent: "experiment", task: "E4 task", background: true, templateVars: { EXPERIMENT_ID: "E4_x" } });
    check("C8 a second launch in the same process gets bg-6", r2.details?.agentId === "brain.experiment-bg-6", `got ${r2.details?.agentId}`);
  } finally {
    (cp as any).spawn = realSpawn;
    syncBuiltinESMExports();
  }

  // A registered id with no file on disk counts too.
  const pReg = mkdtempSync(join(tmpdir(), "bg-ids-reg-"));
  mkdirSync(join(pReg, ".agent"), { recursive: true });
  writeFileSync(join(pReg, ".agent", "active-agents.json"), JSON.stringify([
    { id: "brain.reader-bg-9", name: "reader", task: "t", mode: "background", startedAt: Date.now(), conversationFile: "", status: "running" },
  ]));
  const next = (spawnAgentModule as any).nextBackgroundId;
  check("C8 an id in active-agents.json counts (bg-9 registered → bg-10)", typeof next === "function" && next(join(pReg, ".agent")) === "bg-10",
    typeof next === "function" ? `got ${next(join(pReg, ".agent"))}` : "nextBackgroundId not exported");

  // The runner's agent is the bg id, so its children hang under a parent that
  // has a transcript, and SPAWN_ID matches the registry entry.
  const savedMode = process.env.LUXAS_EXPERIMENT_MODE;
  delete process.env.LUXAS_EXPERIMENT_MODE;  // pipeline experiment: has a spawn tool
  try {
    let childParent: string | undefined;
    const built = buildAgentFromDefinition({
      name: "experiment", prompt: "x", projectDir: p,
      templateVars: { EXPERIMENT_ID: "E2_x", PROJECT_DIR: p },
      getApiKey: () => undefined, parentAgentId: "brain",
      agentId: "brain.experiment-bg-3",
      createSpawnTool: (parentId: string) => {
        childParent = parentId;
        return { name: "spawn_agent", label: "s", description: "s", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) };
      },
    } as any);
    check("C8 a built agent takes the id handed to it", built.agentId === "brain.experiment-bg-3", `got ${built.agentId}`);
    check("C8 its children's spawn tool is scoped to that id", childParent === "brain.experiment-bg-3", `got ${childParent}`);
  } catch (e: any) {
    check("C8 buildAgentFromDefinition with an explicit id (offline)", false, String(e?.message ?? e).slice(0, 200));
  } finally {
    if (savedMode === undefined) delete process.env.LUXAS_EXPERIMENT_MODE; else process.env.LUXAS_EXPERIMENT_MODE = savedMode;
  }
  // Scoped to the spawnOpts literal: jobOwnerAls.run elsewhere in the file
  // already says `agentId: args.id`.
  const runnerSrc = readFileSync("src/subagent-runner.ts", "utf-8");
  const spawnOptsLit = runnerSrc.match(/const spawnOpts: SpawnAgentOptions = \{[\s\S]*?\n {4}\};/)?.[0] ?? "";
  check("C8 the runner builds its agent under its own bg id (spawnOpts.agentId = args.id)", /\bagentId:\s*args\.id\b/.test(spawnOptsLit), spawnOptsLit ? "" : "spawnOpts literal not found");

  // The real runner, offline: an agent type with no definition never reaches a
  // model, so without the refusal it fails on the unknown type instead.
  const pRun = mkdtempSync(join(tmpdir(), "bg-runner-"));
  const id = "brain.no_such_agent-bg-1";
  const sess = join(pRun, ".agent", "conversations", `${id}.jsonl`);
  mkdirSync(dirname(sess), { recursive: true });
  const OLD = '{"type":"session","id":"prev"}\n';
  writeFileSync(sess, OLD);
  writeFileSync(join(pRun, ".agent", "active-agents.json"), JSON.stringify([
    { id, name: "no_such_agent", task: "t", mode: "background", startedAt: Date.now(), conversationFile: sess, status: "running" },
  ]));
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const run = spawnSync(process.execPath, ["--import=tsx", join(repo, "src", "subagent-runner.ts"),
    "--agent", "no_such_agent", "--task", "t", "--project", pRun, "--id", id, "--session", sess],
    { cwd: repo, encoding: "utf-8", timeout: 30_000 });
  let entry: any;
  try { entry = JSON.parse(readFileSync(join(pRun, ".agent", "active-agents.json"), "utf-8")).find((a: any) => a.id === id); } catch { /* reported below */ }
  check("C8 the runner refuses an existing session file (registry names the refusal)",
    run.status === 1 && entry?.status === "failed" && /refusing to append to existing session file/.test(entry?.result ?? ""),
    `exit=${run.status} status=${entry?.status} result=${String(entry?.result ?? run.stderr).slice(0, 200)}`);
  check("C8 the refused session file is byte-identical", readFileSync(sess, "utf-8") === OLD);

  check("C8 spawn-agent.ts has no per-process ++bgCounter", !/\+\+bgCounter/.test(readFileSync("src/tools/spawn-agent.ts", "utf-8")));
}

// C7. A REVISE'd experiment whose revision failed came back as the revision's
// failure text alone: the delivered run's output and the reviewer's feedback
// were gone, a provider-errored revision (success:true, stopReason=error —
// what spawnAgent returns for a 400 or a refusal) bought another reviewer
// round on unchanged work, and the background runner marked the whole thing
// done under the FIRST run's clean exit.
{
  const savedImages = process.env.LUXAS_REVIEW_IMAGES;
  process.env.LUXAS_REVIEW_IMAGES = "0";
  const okExit = { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any;
  const FB = "the observable is |gg> return";
  async function c7run(revisions: Array<"threw" | "provider-error" | "ok">) {
    const p = mkdtempSync(join(tmpdir(), "bg-c7-"));
    mkdirSync(join(p, "data", "experiments", EID, "runs", "run_1"), { recursive: true });
    writeFileSync(join(p, "data", "experiments", EID, "runs", "run_1", "results.json"), "{\"computed\":{}}");
    const seen: string[] = [];
    let rev = 0;
    const c7stub = async (opts: any) => {
      seen.push(opts.name);
      if (opts.name === "experiment_reviewer") return { elapsed: 1, success: true, agentId: "r", exit: okExit, output: `VERDICT: revise\nFEEDBACK: FB-${seen.length} ${FB}` };
      const kind = revisions[rev++] ?? "ok";
      // What spawnAgent returns when its own try caught a throw (spawn.ts catch).
      if (kind === "threw") return { elapsed: 1, success: false, agentId: "e", exit: { ...okExit, stopReason: "error" }, output: `Agent "experiment" failed: EEXIST: file already exists` };
      // A provider error ends the agent gracefully: success:true, stopReason=error.
      if (kind === "provider-error") return { elapsed: 1, success: true, agentId: "e", exit: { ...okExit, stopReason: "error", errorMessage: "400 invalid_request_error" }, output: "(no output)" };
      return { elapsed: 1, success: true, agentId: "e", exit: okExit, output: `REVISION-${rev}-OUTPUT` };
    };
    const out: any = await runExperimentReviewLoop({ output: "FIRST-RUN: headline 3.1e-3", success: true, exit: okExit }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: EID },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir: p, getApiKey: () => undefined },
      initialTask: "run E1", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: c7stub as any,
    });
    return { seen: seen.join(","), out };
  }
  try {
    {
      const { seen, out } = await c7run(["threw"]);
      check("C7a revision threw: no reviewer round after it", seen === "experiment_reviewer,experiment", seen);
      check("C7a keeps the delivered run's output", out.output.includes("FIRST-RUN: headline 3.1e-3"), out.output.slice(0, 160));
      check("C7a keeps the reviewer's FEEDBACK", out.output.includes(`FB-1 ${FB}`), out.output.slice(0, 160));
      check("C7a says the revision failed, and why", /REVISE — the revision run failed/.test(out.output) && out.output.includes("EEXIST"), out.output.slice(0, 300));
      check("C7a reported as failed (success=false, exit.stopReason=error)", out.success === false && out.exit?.stopReason === "error", `success=${out.success} stop=${out.exit?.stopReason}`);
    }
    {
      const { seen, out } = await c7run(["provider-error"]);
      check("C7b provider-errored revision: no reviewer round paid on unchanged work", seen === "experiment_reviewer,experiment", seen);
      check("C7b keeps the delivered run's output and FEEDBACK", out.output.includes("FIRST-RUN: headline 3.1e-3") && out.output.includes(`FB-1 ${FB}`), out.output.slice(0, 160));
      check("C7b names the provider error", out.output.includes("400 invalid_request_error"), out.output.slice(0, 300));
      check("C7b reported as failed (success=false, exit.stopReason=error)", out.success === false && out.exit?.stopReason === "error", `success=${out.success} stop=${out.exit?.stopReason}`);
    }
    {
      const { seen, out } = await c7run(["ok", "threw"]);
      check("C7c second revision failed: stops there", seen === "experiment_reviewer,experiment,experiment_reviewer,experiment", seen);
      check("C7c keeps the LAST delivered output (revision 1) and round 2's FEEDBACK", out.output.includes("REVISION-1-OUTPUT") && out.output.includes(`FB-3 ${FB}`), out.output.slice(0, 200));
      check("C7c reported as failed", out.success === false);
    }
  } finally {
    if (savedImages === undefined) delete process.env.LUXAS_REVIEW_IMAGES; else process.env.LUXAS_REVIEW_IMAGES = savedImages;
  }

  // The runner records the last run's exit, and a throw out of the review
  // (filesystem, claim table) keeps the delivered output instead of reaching
  // the outer catch's markFailed.
  const runner = readFileSync("src/subagent-runner.ts", "utf-8");
  check("C7d runner does not record the pre-review exit", !/markDone\([^\n]*,\s*firstExit\)/.test(runner));
  check("C7d runner records the reviewed exit (exit = reviewed.exit ?? firstExit)", /\bexit = reviewed\.exit \?\? firstExit\b/.test(runner));
  const loopAt = runner.indexOf("await runExperimentReviewLoop(");
  const tryAt = runner.lastIndexOf("try {", loopAt);
  check("C7d runner wraps the review loop in its own try (opened after firstExit)", loopAt > 0 && tryAt > runner.indexOf("const firstExit"), `loop@${loopAt} try@${tryAt}`);
  const doneAt = runner.indexOf("markDone(agentDir, args.id, output.slice", loopAt);
  check("C7d a throw from the review still ends in markDone, never markFailed", doneAt > loopAt && !runner.slice(tryAt, doneAt).includes("markFailed("), `done@${doneAt}`);
}

// C6. A reviewer that gave no review was read as REVISE: its "(no output)" —
// what spawnAgent returns for a refusal, a 529/429 that outlived the retries,
// or an empty turn — became the revision's feedback, the experiment re-ran on
// it, and at the cap the brain was told "accepting current state with open
// issues". A dead round 2 also became the "latest round" and hid round 1's
// REVISE from the finish gate.
{
  const savedImages = process.env.LUXAS_REVIEW_IMAGES;
  process.env.LUXAS_REVIEW_IMAGES = "0";
  const ex = (stopReason: string, errorMessage?: string) => ({ stopReason, errorMessage, filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" }) as any;
  const DEAD: Record<string, any> = {
    "provider error / refusal": { success: true, output: "(no output)", exit: ex("error", "The model refused to complete the request") },
    "empty end_turn": { success: true, output: "(no output)", exit: ex("stop") },
    "spawn threw": { success: false, output: 'Agent "experiment_reviewer" failed: boom', exit: ex("error") },
  };
  const BLIND = "ESTIMATE(blind): kappa — 3.2e-7 ± 1.2e-7 via tensor shift — inputs: [alpha_s_au=184.4]";
  const c6project = (eid: string) => {
    const p = mkdtempSync(join(tmpdir(), "bg-c6-"));
    mkdirSync(join(p, "data", "experiments", eid, "runs", "run_1"), { recursive: true });
    writeFileSync(join(p, "data", "experiments", eid, "runs", "run_1", "results.json"), "{\"computed\":{}}");
    return p;
  };
  /** The loop with a stub whose n-th reviewer spawn returns replies[n] (the last one repeats). */
  async function c6run(p: string, eid: string, replies: any[], extra: Record<string, unknown> = {}) {
    const seen: string[] = [];
    let n = 0;
    const c6stub = async (opts: any) => {
      seen.push(opts.name);
      if (opts.name === "experiment_reviewer") return { elapsed: 1, agentId: `r${n}`, ...replies[Math.min(n++, replies.length - 1)] };
      return { elapsed: 1, success: true, agentId: "e", exit: ex("stop"), output: "re-ran" };
    };
    const out: any = await runExperimentReviewLoop({ output: "FIRST-RUN", success: true }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: eid, PROJECT_DIR: p },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: eid }, projectDir: p, getApiKey: () => undefined },
      initialTask: "run", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: c6stub as any, ...extra,
    });
    return { seen: seen.join(","), out };
  }
  try {
    for (const [label, dead] of Object.entries(DEAD)) {
      const p = c6project(EID);
      const { seen, out } = await c6run(p, EID, [dead], { priorBlindLines: [BLIND] });
      const files = existsSync(join(p, "reviews")) ? readdirSync(join(p, "reviews")) : [];
      const r1 = join(p, "reviews", `experiment_review_${EID}_r1.md`);
      const r1text = existsSync(r1) ? readFileSync(r1, "utf-8") : "";
      check(`C6 ${label}: the reviewer is spawned once more and the experiment never re-runs`, seen === "experiment_reviewer,experiment_reviewer", seen);
      check(`C6 ${label}: reported NOT REVIEWED, never REVISE or outstanding feedback`,
        /NOT REVIEWED/.test(out.output) && !/REVISE/.test(out.output) && !/Outstanding reviewer feedback/.test(out.output), JSON.stringify(out.output.slice(-200)));
      check(`C6 ${label}: success stays true (the experiment did deliver)`, out.success === true);
      check(`C6 ${label}: only _r1.md is written, and it keeps the blind estimate`, files.length === 1 && r1text.includes(BLIND), files.join(","));
      check(`C6 ${label}: its verdict line names why there is no review`, /^VERDICT: \(none — reviewer gave no review: .+\)$/m.test(r1text), (r1text.match(/^VERDICT:.*$/m) ?? ["missing"])[0]);
    }
    {
      const p = c6project(EID);
      const { seen, out } = await c6run(p, EID, [DEAD["provider error / refusal"], { success: true, output: "VERDICT: satisfied", exit: ex("stop") }]);
      check("C6 a retried reviewer's SATISFIED is round 1's verdict, with no re-run", seen === "experiment_reviewer,experiment_reviewer" && /round 1: SATISFIED/.test(out.output), `${seen} | ${JSON.stringify(out.output.slice(-120))}`);
    }
    {
      const E7 = "E7_mask";
      const p = c6project(E7);
      mkdirSync(join(p, "reviews"), { recursive: true });
      writeFileSync(join(p, "reviews", `experiment_review_${E7}_r1.md`), `# experiment_reviewer — ${E7} round 1\n\nREVIEW-COMPLETE\nVERDICT: revise\n\nFEEDBACK:\nThe headline kappa uses the scalar polarizability only and omits the tensor term that dominates at 532 nm.\n`);
      const before = openReviewFindings(p).get("E7")?.round;
      process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
      try { await c6run(p, E7, [DEAD["provider error / refusal"]], { startRound: 2 }); }
      finally { delete process.env.LUXAS_MAX_REVIEW_ITERATIONS; }
      const after = openReviewFindings(p).get("E7");
      check("C6 a NOT REVIEWED round 2 cannot hide round 1's REVISE from openReviewFindings",
        before === 1 && existsSync(join(p, "reviews", `experiment_review_${E7}_r2.md`)) && after?.round === 1, `before=${before} after=${after?.round}`);
    }
    const gave = (spawnAgentModule as any).reviewerGaveNoReview;
    check("C6 a terse prose critique, or an errored reply that carries a VERDICT, is still a review",
      typeof gave === "function" && gave({ success: true, output: "Wrong sign on kappa.", exit: ex("stop") }) === null
        && gave({ success: true, output: "VERDICT: revise\nFEEDBACK: x", exit: ex("error") }) === null,
      typeof gave === "function" ? "" : "reviewerGaveNoReview not exported");
  } finally {
    if (savedImages === undefined) delete process.env.LUXAS_REVIEW_IMAGES; else process.env.LUXAS_REVIEW_IMAGES = savedImages;
  }
}

// C12. Blind estimators ran under the replicator's replicate-mode scope: on Dy
// 8 of 11 wrote replication/results.json (which the claim table then counted
// as a second leg), 5 of those were overwritten, and the next estimator read
// it seconds later. The stub replicator builds the REAL wrapped coding tools from
// the definition the loop hands it and replays those moves.
{
  const savedBlind = process.env.LUXAS_BLIND_ESTIMATE;
  const savedImages = process.env.LUXAS_REVIEW_IMAGES;
  const savedIter = process.env.LUXAS_MAX_REVIEW_ITERATIONS;
  delete process.env.LUXAS_BLIND_ESTIMATE;
  process.env.LUXAS_REVIEW_IMAGES = "0";
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  const { getDefinition } = registryModule;
  const p = mkdtempSync(join(tmpdir(), "bg-c12-"));
  const X = `data/experiments/${EID}`;
  mkdirSync(join(p, "notes"), { recursive: true });
  // "kappa" and "kappa_532": a sibling's scratch prefix must not block its longer-named neighbour.
  writeFileSync(join(p, "notes", "frame.md"), "# F\n\n## Headline quantities\n- `kappa`\n- `kappa_532`\n");
  mkdirSync(join(p, X, "runs", "run_1"), { recursive: true });
  const q = (id: string, v: number) => ({ id, key: `computed.${id}`, headline: true, observable: `${id} in Hz`, uncertainty: 0.1 * v, inputs: { x: 1 } });
  writeFileSync(join(p, X, "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [q("kappa", 10), q("kappa_532", 20)], kappa: 10, kappa_532: 20 } }));
  // A brain-dispatched replicate-mode result, and an earlier round's estimator scratch.
  mkdirSync(join(p, X, "replication"), { recursive: true });
  writeFileSync(join(p, X, "replication", "results.json"), JSON.stringify({ quantity: "qz", value: 10.2, sigma: 0.5, route: "MARKER_REPLICATE_MODE", script: "replication/r.py" }));
  mkdirSync(join(p, X, "blind", "qold"), { recursive: true });
  writeFileSync(join(p, X, "blind", "qold", "prev.txt"), "MARKER_EARLIER_ESTIMATOR\n");
  const snap = (dir: string) => readdirSync(dir).sort().map((f) => `${f}\n${readFileSync(join(dir, f), "utf-8")}`).join("\n--\n");
  const replBefore = snap(join(p, X, "replication"));
  const cachedBefore = JSON.stringify(getDefinition("replicator").safety);

  const text = (r: any) => (r?.content ?? []).map((c: any) => c.text ?? "").join(" ");
  const refused = (r: any) => r?.isError === true && /^BLOCKED:/.test(text(r));
  /** A root covers a path when the path is the root or lies under it. */
  const covers = (roots: string[], path: string) => roots.some((r) => { const b = r.replace(/\/$/, ""); return path === b || path.startsWith(b + "/"); });
  const spawns: Array<{ q: string; passed: boolean; write: string[]; read: string[]; task: string; m: Record<string, any> }> = [];
  const c12stub = async (opts: any) => {
    const base = { elapsed: 1, success: true, agentId: `${opts.name}-x`, exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any };
    if (opts.name === "experiment_reviewer") return { ...base, output: "VERDICT: satisfied" };
    if (opts.name !== "replicator") return { ...base, output: "" };
    // What buildAgentFromDefinition does with the definition it resolves.
    const def = (opts.resolveDefinition ?? getDefinition)("replicator");
    const tv: Record<string, string> = { SPAWN_ID: "c12", ...opts.templateVars };
    const tools = buildSafetyWrapper(def.safety)!(resolveToolSets(def.toolSets, p), p, tv);
    const run = async (name: string, args: any) => {
      try { return await tools.find((t: any) => t.name === name).execute("c12", args); }
      catch (e: any) { return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] }; }
    };
    const Q = tv.QUANTITY_ID;
    const rp = `${X}/replication/results.json`;
    const m: Record<string, any> = {};
    m.writeRepl = await run("write", { path: `${X}/replication/est_${Q}.py`, content: "print(1)\n" });
    m.redirect = await run("bash", { command: `echo '{"quantity":"${Q}","value":99,"sigma":1,"route":"napkin"}' > ${rp}` });
    m.cat = await run("bash", { command: `cat ${rp}` });
    m.read = await run("read", { path: rp });
    m.scratch = await run("write", { path: `${X}/blind/${Q}/est.py`, content: `# MARKER_SCRATCH_${Q}\nprint(1)\n` });
    m.readOwn = await run("read", { path: `${X}/blind/${Q}/est.py` });
    m.bashOwn = await run("bash", { command: `echo 1 > ${X}/blind/${Q}/out.txt && cat ${X}/blind/${Q}/out.txt` });
    m.catOld = await run("bash", { command: `cat ${X}/blind/qold/prev.txt` });
    m.readOld = await run("read", { path: `${X}/blind/qold/prev.txt` });
    if (Q === "kappa_532") {
      m.catSib = await run("bash", { command: `cat ${X}/blind/kappa/est.py` });
      m.readSib = await run("read", { path: `${X}/blind/kappa/est.py` });
    }
    const exp = (rs?: string[]) => (rs ?? []).map((r) => expandTemplate(r, tv));
    spawns.push({ q: Q, passed: typeof opts.resolveDefinition === "function", write: exp(def.safety?.allowedWriteRoots), read: exp(def.safety?.allowedReadRoots), task: String(opts.prompt ?? ""), m });
    return { ...base, output: `ESTIMATE(blind): ${Q} — 10 ± 2 via napkin — inputs: [x=1]` };
  };
  try {
    await runExperimentReviewLoop({ output: "first run", success: true }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: p },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir: p, getApiKey: () => undefined },
      initialTask: "run E1", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: c12stub as any,
    });
    // Pushed as each finishes, and they run at once (C33 checks the order that matters).
    check("C12 both headline quantities got a blind estimator", spawns.map((s) => s.q).sort().join(",") === "kappa,kappa_532", spawns.map((s) => s.q).join(","));
    check("C12 every estimator spawn carries a per-spawn resolveDefinition", spawns.length === 2 && spawns.every((s) => s.passed));
    for (const s of spawns) {
      check(`C12 ${s.q}: write roots are exactly its own scratch`, JSON.stringify(s.write) === JSON.stringify([`${X}/blind/${s.q}/`]), JSON.stringify(s.write));
      check(`C12 ${s.q}: no replication/ in its write or read roots`, !covers(s.write, `${X}/replication/x`) && !covers(s.read, `${X}/replication/x`), JSON.stringify(s.read));
      check(`C12 ${s.q}: write tool refused under replication/ (nothing created)`, refused(s.m.writeRepl) && !existsSync(join(p, X, "replication", `est_${s.q}.py`)), text(s.m.writeRepl).slice(0, 120));
      check(`C12 ${s.q}: bash redirect into replication/results.json refused`, refused(s.m.redirect), text(s.m.redirect).slice(0, 120));
      check(`C12 ${s.q}: bash cat of replication/results.json refused, nothing seen`, refused(s.m.cat) && !/MARKER_REPLICATE_MODE|napkin/.test(text(s.m.cat)), text(s.m.cat).slice(0, 120));
      check(`C12 ${s.q}: read tool on replication/results.json refused`, refused(s.m.read) && !/MARKER_REPLICATE_MODE|napkin/.test(text(s.m.read)), text(s.m.read).slice(0, 120));
      check(`C12 ${s.q}: its scratch file lands in blind/${s.q}/`, !refused(s.m.scratch) && existsSync(join(p, X, "blind", s.q, "est.py")), text(s.m.scratch).slice(0, 120));
      check(`C12 ${s.q}: it can read its own scratch back`, !refused(s.m.readOwn) && text(s.m.readOwn).includes(`MARKER_SCRATCH_${s.q}`), text(s.m.readOwn).slice(0, 120));
      check(`C12 ${s.q}: bash in its own scratch works`, !refused(s.m.bashOwn) && existsSync(join(p, X, "blind", s.q, "out.txt")), text(s.m.bashOwn).slice(0, 120));
      check(`C12 ${s.q}: an earlier round's scratch (blind/qold/) is unreadable by bash and read`,
        refused(s.m.catOld) && refused(s.m.readOld) && !/MARKER_EARLIER_ESTIMATOR/.test(text(s.m.catOld) + text(s.m.readOld)), text(s.m.catOld).slice(0, 120));
    }
    const second = spawns.find((s) => s.q === "kappa_532");
    check("C12 the second estimator's read roots exclude the first's scratch", !!second && !covers(second.read, `${X}/blind/kappa/est.py`), JSON.stringify(second?.read));
    check("C12 the second estimator's bash cat of the first's scratch is refused",
      !!second && refused(second.m.catSib) && !/MARKER_SCRATCH_kappa\b/.test(text(second.m.catSib)), text(second?.m.catSib).slice(0, 120));
    check("C12 the second estimator's read of the first's scratch is refused", !!second && refused(second.m.readSib), text(second?.m.readSib).slice(0, 120));
    // F12. The estimate render no longer names replication/, and nothing else
    // named the scratch root: the first write was spent learning it from a BLOCKED.
    for (const s of spawns) {
      const named = s.task.match(/^Scratch files: (\S+) is the only place you can write/m)?.[1];
      check(`F12 ${s.q}: its task names its scratch dir, the root its definition enforces`, !!named && s.write.length === 1 && named === s.write[0] && named === `${X}/blind/${s.q}/`, `${named} vs ${JSON.stringify(s.write)}`);
      const lines = s.task.trimEnd().split("\n");
      check(`F12 ${s.q}: the scratch line comes before the ESTIMATE format, which stays last`,
        s.task.indexOf("Scratch files: ") >= 0 && s.task.indexOf("Scratch files: ") < s.task.indexOf("Your LAST line must be exactly:") && lines[lines.length - 1].startsWith(`ESTIMATE(blind): ${s.q} — `),
        JSON.stringify(lines.slice(-3)));
    }
    check("F12 the second estimator's task does not name the first's scratch", !!second && !second.task.includes(`${X}/blind/kappa/`), second?.task.slice(-400));
    check("C12 replication/ is byte-identical after the loop", snap(join(p, X, "replication")) === replBefore, snap(join(p, X, "replication")).slice(0, 200));
    const r1 = join(p, "reviews", `experiment_review_${EID}_r1.md`);
    const r1text = existsSync(r1) ? readFileSync(r1, "utf-8") : "";
    check("C12 both ESTIMATE(blind) lines still reach the review file", /ESTIMATE\(blind\): kappa —/.test(r1text) && /ESTIMATE\(blind\): kappa_532 —/.test(r1text), r1text.slice(0, 200));
    check("C12 the cached replicator definition is not mutated", JSON.stringify(getDefinition("replicator").safety) === cachedBefore);
    const scoped = (registryModule as any).replicatorEstimateDefinition;
    let threw = false;
    try { scoped(getDefinition("replicator"), "../replication", []); } catch { threw = true; }
    check("C12 replicatorEstimateDefinition refuses a slug that could leave blind/", typeof scoped === "function" && threw, typeof scoped === "function" ? "" : "replicatorEstimateDefinition not exported");
  } finally {
    if (savedBlind === undefined) delete process.env.LUXAS_BLIND_ESTIMATE; else process.env.LUXAS_BLIND_ESTIMATE = savedBlind;
    if (savedImages === undefined) delete process.env.LUXAS_REVIEW_IMAGES; else process.env.LUXAS_REVIEW_IMAGES = savedImages;
    if (savedIter === undefined) delete process.env.LUXAS_MAX_REVIEW_ITERATIONS; else process.env.LUXAS_MAX_REVIEW_ITERATIONS = savedIter;
  }
}

// C14. Rounds were numbered per dispatch: the brain re-dispatching an
// experiment that already had r1..r3 started again at r1 and overwrote the
// rounds claims-table and openReviewFindings read, and paid a blind estimate
// again for every quantity whose inputs had not moved. Called here with the
// foreground caller's exact argument set (no startRound, no priorBlindLines).
{
  const savedBlind = process.env.LUXAS_BLIND_ESTIMATE;
  const savedImages = process.env.LUXAS_REVIEW_IMAGES;
  const savedIter = process.env.LUXAS_MAX_REVIEW_ITERATIONS;
  delete process.env.LUXAS_BLIND_ESTIMATE;
  process.env.LUXAS_REVIEW_IMAGES = "0";
  const E = "E1_light_shift";
  const BX = "ESTIMATE(blind): kappa_x — 3.2e-7 ± 1.2e-7 via tensor shift scaling — inputs: [alpha_s_au=184.4]";
  // shift_y's inputs have moved since this line was written (450 → 900).
  const BY_STALE = "ESTIMATE(blind): shift_y — 1.9 ± 0.5 via harmonic trap napkin — inputs: [depth_uk=450]";
  const BY_FRESH = "ESTIMATE(blind): shift_y — 2.1 ± 0.4 via fresh route — inputs: [depth_uk=900]";
  const c14project = () => {
    const p = mkdtempSync(join(tmpdir(), "bg-c14-"));
    writeFileSync(join(p, "RESEARCH.md"), "# q\n");
    const run = join(p, "data", "experiments", E, "runs", "run_1");
    mkdirSync(run, { recursive: true });
    const q = (id: string, key: string, inputs: Record<string, number>) => ({ id, key, headline: true, observable: `${id} observable (dimensionless)`, uncertainty: 1e-7, uncertainty_source: "MC", inputs });
    writeFileSync(join(run, "results.json"), JSON.stringify({ computed: {
      kappa: 4e-7, shift: 2.0,
      quantities: [q("kappa_x", "computed.kappa", { alpha_s_au: 184.4 }), q("shift_y", "computed.shift", { depth_uk: 900 })],
    } }));
    mkdirSync(join(p, "reviews"), { recursive: true });
    writeFileSync(join(p, "reviews", `experiment_review_${E}_r1.md`), `# experiment_reviewer — ${E} round 1\n\nBlind estimates:\n${BX}\n${BY_STALE}\n\nVERDICT: revise\n\nFEEDBACK:\nround one feedback sentence that is long enough to count here.\n`);
    writeFileSync(join(p, "reviews", `experiment_review_${E}_r2.md`), `# round 2\n${BX}\n${BY_STALE}\nVERDICT: revise\n`);
    writeFileSync(join(p, "reviews", `experiment_review_${E}_r3.md`), `# round 3\n${BX}\n${BY_STALE}\nVERDICT: revise\n`);
    return p;
  };
  const rev = (p: string, n: number) => join(p, "reviews", `experiment_review_${E}_r${n}.md`);
  const readRev = (p: string, n: number) => existsSync(rev(p, n)) ? readFileSync(rev(p, n), "utf-8") : "";
  const LINES = "DISCRIMINATOR: kappa_x — a; b; c\nSCALING: kappa_x — expected 1 in I; observed not swept\nDISCRIMINATOR: shift_y — a; b; c\nSCALING: shift_y — expected 1 in U; observed not swept\n";
  /** The loop, called as spawn-agent.ts's foreground branch calls it; reviewer replies are `verdicts` in order. */
  async function c14run(p: string, verdicts: string[], replicatorOutput = (q: string) => `ESTIMATE(blind): ${q} — 2.1 ± 0.4 via fresh route — inputs: []`) {
    const calls: string[] = [];
    const prompts: string[] = [];
    let n = 0;
    const c14stub = async (o: any) => {
      calls.push(o.name === "replicator" ? `replicator:${o.templateVars?.QUANTITY_ID}` : o.name);
      const base = { elapsed: 1, success: true, agentId: `${o.name}-x`, exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any };
      if (o.name === "replicator") return { ...base, output: replicatorOutput(o.templateVars.QUANTITY_ID) };
      if (o.name === "experiment_reviewer") {
        prompts.push(String(o.prompt));
        const v = verdicts[Math.min(n++, verdicts.length - 1)];
        return { ...base, output: `${LINES}VERDICT: ${v}${v === "revise" ? "\nFEEDBACK: the re-dispatched round still has the sign wrong somewhere." : ""}` };
      }
      return { ...base, output: "revised" };
    };
    const projectDir = p, mergedTemplateVars = { EXPERIMENT_ID: E, PROJECT_DIR: p }, initialTask = "run E1 again";
    const baseOpts = { name: "experiment", templateVars: { EXPERIMENT_ID: E }, projectDir: p, getApiKey: () => undefined };
    const getApiKey = () => undefined, parentAgentId = "brain", depth = 0, makeSpawnTool = () => null;
    const out: any = await runExperimentReviewLoop({ output: "re-dispatched run", success: true }, {
      projectDir, mergedTemplateVars, baseOpts, initialTask,
      getApiKey, parentAgentId, depth, makeSpawnTool, spawn: c14stub as any,
    });
    return { calls: calls.join(","), prompts, out };
  }
  try {
    {
      process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
      const p = c14project();
      const before = [1, 2, 3].map((n) => readRev(p, n));
      const { calls, prompts, out } = await c14run(p, ["revise"]);
      const r4 = readRev(p, 4);
      check("C14 the re-dispatch writes r4, headed round 4", /round 4\b/.test(r4), r4 ? r4.slice(0, 80) : "r4 missing");
      check("C14 r1..r3 are byte-identical", [1, 2, 3].every((n, i) => readRev(p, n) === before[i]), [1, 2, 3].filter((n, i) => readRev(p, n) !== before[i]).map((n) => `r${n} rewritten`).join(","));
      check("C14 the replicator ran for shift_y only (kappa_x's inputs have not moved)", calls === "replicator:shift_y,experiment_reviewer", calls);
      check("C14 r4 carries kappa_x's earlier line and shift_y's fresh one, not the stale one", r4.includes(BX) && r4.includes(BY_FRESH) && !r4.includes(BY_STALE), r4.slice(0, 400));
      check("C14 the reviewer is handed the same two lines, not the stale one", prompts.length === 1 && prompts[0].includes(BX) && prompts[0].includes(BY_FRESH) && !prompts[0].includes(BY_STALE), prompts[0]?.slice(-400));
      check("C14 the output says which estimates were reused", out.output.includes("[blind estimates reused from earlier rounds: kappa_x]"), out.output.slice(-200));
    }
    {
      // The re-estimate returned nothing: the stale line stays (the table calls it incomparable), never silently nothing.
      process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
      const p = c14project();
      const { calls, out } = await c14run(p, ["revise"], () => "(no output)");
      const r4 = readRev(p, 4);
      check("C14 a failed re-estimate keeps the stale line in r4 and says the estimator returned none",
        calls === "replicator:shift_y,experiment_reviewer" && r4.includes(BX) && r4.includes(BY_STALE) && /blind estimator for shift_y returned no ESTIMATE\(blind\) line/.test(out.output), `${calls} | ${r4.slice(0, 300)}`);
    }
    {
      // r1 estimated kappa_x before its inputs moved, r3 again after: r3's line is reused and r1's stays in r1.
      process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
      const p = c14project();
      const BX_OLD = "ESTIMATE(blind): kappa_x — 9.9e-7 ± 1e-7 via tensor shift scaling — inputs: [alpha_s_au=120]";
      writeFileSync(rev(p, 1), `# experiment_reviewer — ${E} round 1\n\nBlind estimates:\n${BX_OLD}\n${BY_STALE}\n\nVERDICT: revise\n`);
      const { calls, prompts } = await c14run(p, ["revise"]);
      const r4 = readRev(p, 4);
      check("C14 a stale earlier line of a reused id is not carried into r4 or the reviewer prompt",
        calls === "replicator:shift_y,experiment_reviewer" && r4.includes(BX) && !r4.includes(BX_OLD) && !prompts[0]?.includes(BX_OLD) && readRev(p, 1).includes(BX_OLD), `${calls} | ${r4.slice(0, 300)}`);
    }
    {
      // At the default cap: a REVISE re-runs the experiment once and the next round is r5.
      delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
      const p = c14project();
      const before = [1, 2, 3].map((n) => readRev(p, n));
      const { calls, out } = await c14run(p, ["revise", "satisfied"]);
      check("C14 REVISE at the default cap: r4 revise → one experiment re-run → r5 satisfied",
        calls === "replicator:shift_y,experiment_reviewer,experiment,experiment_reviewer" && /VERDICT: revise/.test(readRev(p, 4)) && /round 5\b/.test(readRev(p, 5)) && /VERDICT: satisfied/.test(readRev(p, 5)) && /experiment_reviewer round 5: SATISFIED/.test(out.output) && !existsSync(rev(p, 6)),
        `${calls} | ${JSON.stringify(out.output.slice(-160))}`);
      check("C14 …and r1..r3 are still byte-identical", [1, 2, 3].every((n, i) => readRev(p, n) === before[i]));
    }
    // The default is what the brain gets: neither caller may pin the round.
    const fg = readFileSync("src/tools/spawn-agent.ts", "utf-8");
    const fgAt = fg.indexOf("result = await runExperimentReviewLoop(result, {");
    const fgCall = fgAt >= 0 ? fg.slice(fgAt, fg.indexOf("});", fgAt)) : "";
    const runnerSrc = readFileSync("src/subagent-runner.ts", "utf-8");
    const bgAt = runnerSrc.indexOf("await runExperimentReviewLoop(");
    const bgCall = bgAt >= 0 ? runnerSrc.slice(bgAt, runnerSrc.indexOf("});", bgAt)) : "";
    check("C14 neither the foreground call nor the background runner passes startRound or priorBlindLines",
      !!fgCall && !!bgCall && !/startRound|priorBlindLines/.test(fgCall + bgCall), `fg ${fgCall.length} chars, bg ${bgCall.length} chars`);
  } finally {
    if (savedBlind === undefined) delete process.env.LUXAS_BLIND_ESTIMATE; else process.env.LUXAS_BLIND_ESTIMATE = savedBlind;
    if (savedImages === undefined) delete process.env.LUXAS_REVIEW_IMAGES; else process.env.LUXAS_REVIEW_IMAGES = savedImages;
    if (savedIter === undefined) delete process.env.LUXAS_MAX_REVIEW_ITERATIONS; else process.env.LUXAS_MAX_REVIEW_ITERATIONS = savedIter;
  }
}

// C33. A round's blind estimators ran one after another: at 15–37 min per
// quantity on deepseek-v4-pro (Dy), three headline quantities held the
// reviewer, and the experiment's return to brain, for up to an hour and a half,
// although since C12 none can read or write another's scratch. The stub's
// first-declared estimator finishes last, so declaration order and completion
// order disagree.
{
  const saved = {
    LUXAS_BLIND_ESTIMATE: process.env.LUXAS_BLIND_ESTIMATE,
    LUXAS_BLIND_ESTIMATE_CAP: process.env.LUXAS_BLIND_ESTIMATE_CAP,
    LUXAS_REVIEW_IMAGES: process.env.LUXAS_REVIEW_IMAGES,
    LUXAS_MAX_REVIEW_ITERATIONS: process.env.LUXAS_MAX_REVIEW_ITERATIONS,
  };
  delete process.env.LUXAS_BLIND_ESTIMATE;
  delete process.env.LUXAS_BLIND_ESTIMATE_CAP;
  process.env.LUXAS_REVIEW_IMAGES = "0";
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  const { getDefinition } = registryModule;
  const X = `data/experiments/${EID}`;
  const QIDS = ["qa", "qb", "qc"];
  const DELAY: Record<string, number> = { qa: 120, qb: 60, qc: 10 };
  const c33project = () => {
    const p = mkdtempSync(join(tmpdir(), "bg-c33-"));
    mkdirSync(join(p, "notes"), { recursive: true });
    writeFileSync(join(p, "notes", "frame.md"), "# F\n\n## Headline quantities\n" + QIDS.map((q) => `- \`${q}\``).join("\n") + "\n");
    mkdirSync(join(p, X, "runs", "run_1"), { recursive: true });
    const q = (id: string, v: number) => ({ id, key: `computed.${id}`, headline: true, observable: `${id} in Hz`, uncertainty: 0.1 * v, inputs: { x: 1 } });
    writeFileSync(join(p, X, "runs", "run_1", "results.json"),
      JSON.stringify({ computed: { quantities: QIDS.map((id, i) => q(id, 10 * (i + 1))), ...Object.fromEntries(QIDS.map((id, i) => [id, 10 * (i + 1)])) } }));
    return p;
  };
  type Fail = "async-throw" | "sync-throw" | "no-line";
  async function c33run(fail: Record<string, Fail> = {}) {
    const p = c33project();
    let inFlight = 0, maxInFlight = 0, reviewerPrompt = "";
    const write: Record<string, string[]> = {};
    const base = { elapsed: 1, success: true, agentId: "c33-x", exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any };
    const asyncStub = async (o: any) => {
      if (o.name === "experiment_reviewer") { reviewerPrompt = String(o.prompt); return { ...base, output: "VERDICT: satisfied" }; }
      if (o.name !== "replicator") return { ...base, output: "" };
      const Q = o.templateVars.QUANTITY_ID;
      const def = (o.resolveDefinition ?? getDefinition)("replicator");
      write[Q] = (def.safety?.allowedWriteRoots ?? []).map((r: string) => expandTemplate(r, { SPAWN_ID: "c33", ...o.templateVars }));
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, DELAY[Q]));
        if (fail[Q] === "async-throw") throw new Error(`429 rate limited (stub ${Q})`);
        return { ...base, output: fail[Q] === "no-line" ? "(no output)" : `route...\nESTIMATE(blind): ${Q} — ${DELAY[Q]} ± 5 via napkin — inputs: [x=1]` };
      } finally { inFlight--; }
    };
    // Not async: throws before any promise exists, as a synchronous bug in spawnAgent's set-up would.
    const stub = (o: any) => {
      if (o.name === "replicator" && fail[o.templateVars.QUANTITY_ID] === "sync-throw") throw new Error("sync set-up failure (stub)");
      return asyncStub(o);
    };
    let out: any, rejected = "";
    try {
      out = await runExperimentReviewLoop({ output: "first run", success: true }, {
        projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: p },
        baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir: p, getApiKey: () => undefined },
        initialTask: "run E1", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: stub as any,
      });
    } catch (e: any) { rejected = String(e?.message ?? e); }
    const r1 = join(p, "reviews", `experiment_review_${EID}_r1.md`);
    const order = (s: string) => [...s.matchAll(/ESTIMATE\(blind\): (\w+)/g)].map((m) => m[1]).join(",");
    return { maxInFlight, write, rejected, output: String(out?.output ?? ""), fileOrder: order(existsSync(r1) ? readFileSync(r1, "utf-8") : ""), promptOrder: order(reviewerPrompt) };
  }
  try {
    {
      const r = await c33run();
      check("C33 a round's three estimators run at once", r.maxInFlight === 3, `maxInFlight=${r.maxInFlight}`);
      check("C33 the reviewer gets the ESTIMATE(blind) lines in declaration order, not completion order", r.promptOrder === "qa,qb,qc", r.promptOrder || r.rejected);
      check("C33 …and so does the r1 file", r.fileOrder === "qa,qb,qc", r.fileOrder || r.rejected);
      check("C33 each concurrent estimator's write roots are exactly its own blind/<QID>/",
        QIDS.every((q) => JSON.stringify(r.write[q]) === JSON.stringify([`${X}/blind/${q}/`])), JSON.stringify(r.write));
    }
    for (const mode of ["async-throw", "sync-throw"] as const) {
      const r = await c33run({ qb: mode });
      check(`C33 ${mode} in the middle estimator: the loop returns, satisfied`, !r.rejected && /experiment_reviewer round 1: SATISFIED/.test(r.output), r.rejected || r.output.slice(-200));
      check(`C33 ${mode}: the other two lines survive, in order, to the reviewer and r1`, r.promptOrder === "qa,qc" && r.fileOrder === "qa,qc", `${r.promptOrder} | ${r.fileOrder}`);
      check(`C33 ${mode}: the output says qb's estimator failed`, /\[blind estimator for qb failed: /.test(r.output), r.output.slice(-300));
    }
    {
      // qc's note is ready first (10 ms) and qa's last (120 ms).
      const r = await c33run({ qa: "async-throw", qc: "no-line" });
      const iA = r.output.indexOf("[blind estimator for qa failed: ");
      const iC = r.output.indexOf("[blind estimator for qc returned no ESTIMATE(blind) line]");
      check("C33 the estimators' notes come out in declaration order too", !r.rejected && r.fileOrder === "qb" && iA >= 0 && iC > iA, `${r.rejected} qa@${iA} qc@${iC} file=${r.fileOrder}`);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// F7. 67 of 345 final experiment_reviewer replies (DeepSeek, April–June) bold
// the verdict: "**VERDICT: revise**" / "**FEEDBACK:**". The loop read that as
// REVISE, but the round was persisted as "VERDICT: (none)", so the finish gate
// counted it as no vote and never bound its issues; "**VERDICT: satisfied**"
// missed the satisfied test and paid for a re-run of the experiment.
{
  const saved = { LUXAS_REVIEW_IMAGES: process.env.LUXAS_REVIEW_IMAGES, LUXAS_MAX_REVIEW_ITERATIONS: process.env.LUXAS_MAX_REVIEW_ITERATIONS };
  process.env.LUXAS_REVIEW_IMAGES = "0";
  const E4 = "E4_gate";
  const ISSUE = "The headline CZ error of 3.1e-3 omits the Doppler dephasing term, which the CSV shows dominates above 10 uK.";
  const ex = (stopReason: string) => ({ stopReason, filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" }) as any;
  /** The loop on a fresh delivered E4: the first reviewer reply is `reply`, any later one is a plain SATISFIED. */
  async function f7run(reply: string, max: string | undefined, stopReason = "stop") {
    const p = mkdtempSync(join(tmpdir(), "bg-f7-"));
    mkdirSync(join(p, "data", "experiments", E4, "runs", "run_1"), { recursive: true });
    writeFileSync(join(p, "data", "experiments", E4, "runs", "run_1", "results.json"), "{\"computed\":{}}");
    if (max === undefined) delete process.env.LUXAS_MAX_REVIEW_ITERATIONS; else process.env.LUXAS_MAX_REVIEW_ITERATIONS = max;
    const seen: string[] = [];
    let n = 0;
    const f7stub = async (o: any) => {
      seen.push(o.name);
      if (o.name === "experiment_reviewer") return { elapsed: 1, success: true, agentId: `r${n}`, exit: ex(n === 0 ? stopReason : "stop"), output: n++ === 0 ? reply : "VERDICT: satisfied" };
      return { elapsed: 1, success: true, agentId: "e", exit: ex("stop"), output: "re-ran" };
    };
    const out: any = await runExperimentReviewLoop({ output: "FIRST-RUN", success: true }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: E4, PROJECT_DIR: p },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: E4 }, projectDir: p, getApiKey: () => undefined },
      initialTask: "run E4", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: f7stub as any,
    });
    const r1 = join(p, "reviews", `experiment_review_${E4}_r1.md`);
    return { p, seen: seen.join(","), output: String(out.output), r1: existsSync(r1) ? readFileSync(r1, "utf-8") : "" };
  }
  const verdictOf = (t: string) => (t.match(/^.*VERDICT.*$/m) ?? ["(no VERDICT line)"])[0];
  try {
    const REVISE: Record<string, string> = {
      "**VERDICT: revise**": `I checked the CSV.\n\n**VERDICT: revise**\n\n**FEEDBACK:**\n- Issue 1: ${ISSUE}`,
      "**VERDICT:** revise": `I checked the CSV.\n\n**VERDICT:** revise\n**FEEDBACK**: - Issue 1: ${ISSUE}`,
    };
    for (const [label, reply] of Object.entries(REVISE)) {
      // MAX=1 is how scripts/review_experiment.mts runs a round.
      const r = await f7run(reply, "1");
      const f = openReviewFindings(r.p).get("E4");
      check(`F7 ${label}: r1 persists the canonical "VERDICT: revise"`, /^VERDICT: revise$/m.test(r.r1), verdictOf(r.r1));
      check(`F7 ${label}: r1 keeps its FEEDBACK as the canonical block`, r.r1.includes(`\nFEEDBACK:\n- Issue 1: ${ISSUE}`), JSON.stringify(r.r1.slice(r.r1.indexOf("FEEDBACK") - 4)));
      check(`F7 ${label}: openReviewFindings binds round 1's Issue 1`, f?.round === 1 && !!f?.issues[0]?.text.includes("Doppler dephasing"), f ? `round=${f.round} issue1=${f.issues[0]?.text.slice(0, 60)}` : "no open finding for E4");
      check(`F7 ${label}: the loop's outstanding feedback starts at the issue, not at a "**"`,
        r.output.includes(`REVISE but iteration cap reached`) && r.output.includes(`Outstanding reviewer feedback:\n- Issue 1: ${ISSUE}`), JSON.stringify(r.output.slice(-260)));
    }
    const SATISFIED: Record<string, string> = {
      "**VERDICT: satisfied**": "All checks pass.\n\n---\n\n**VERDICT: satisfied**",
      "### **VERDICT:** satisfied": "All checks pass.\n\n### **VERDICT:** satisfied",
      "**VERDICT: satisfied.**": "All checks pass.\n\n**VERDICT: satisfied.**",
    };
    for (const [label, reply] of Object.entries(SATISFIED)) {
      const r = await f7run(reply, undefined);
      check(`F7 ${label}: SATISFIED in round 1, the experiment is not re-run`, r.seen === "experiment_reviewer" && /experiment_reviewer round 1: SATISFIED/.test(r.output), `${r.seen} | ${JSON.stringify(r.output.slice(-120))}`);
      check(`F7 ${label}: r1 persists the canonical "VERDICT: satisfied"`, /^VERDICT: satisfied\.?$/m.test(r.r1), verdictOf(r.r1));
    }
    {
      // Same contract as the plain line: a qualified satisfied is a REVISE.
      const r = await f7run("**VERDICT: satisfied** only after the Doppler term is added to the budget.", "1");
      check("F7 a bold \"satisfied only after …\" is not SATISFIED", !/SATISFIED/.test(r.output) && /REVISE but iteration cap reached/.test(r.output), JSON.stringify(r.output.slice(-200)));
    }
    {
      // An errored reply that carries a verdict is a review (C6); bold or not.
      const r = await f7run("All checks pass.\n\n**VERDICT: satisfied**", undefined, "error");
      check("F7 an errored reply with a bold verdict is a review: no second reviewer spawn", r.seen === "experiment_reviewer" && /round 1: SATISFIED/.test(r.output), `${r.seen} | ${JSON.stringify(r.output.slice(-120))}`);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// F8. Python's json.dump writes bare NaN / Infinity / -Infinity by default, and
// JSON.parse rejects them: 10 of 224 local experiments had no parseable
// results.json for that reason alone. The loop called such a file "does not
// exist" and re-sent the experiment, and a revision that wrote one dropped its
// headline ids from the next round's obligation.
{
  const saved = { LUXAS_REVIEW_IMAGES: process.env.LUXAS_REVIEW_IMAGES, LUXAS_MAX_REVIEW_ITERATIONS: process.env.LUXAS_MAX_REVIEW_ITERATIONS, LUXAS_BLIND_ESTIMATE: process.env.LUXAS_BLIND_ESTIMATE };
  process.env.LUXAS_REVIEW_IMAGES = "0";
  process.env.LUXAS_BLIND_ESTIMATE = "0";
  delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
  const E8 = "E8_magic";
  const OBS = "polarizability ratio at 1064.5 nm (NaN-free; -Infinity would mean no magic point)";
  const FIT_NOTE = `chi2 is "NaN" when the fit fails; -Infinity dB means no signal`;
  // As json.dump(indent=2) writes it; the same tokens also sit inside strings, one of them escaped.
  const PY_NAN = `{
  "computed": {
    "alpha_ratio": 1.0034,
    "e_per_s": NaN,
    "d_min": Infinity,
    "floor_db": -Infinity,
    "fit_note": "chi2 is \\"NaN\\" when the fit fails; -Infinity dB means no signal",
    "quantities": [
      {"id": "alpha_ratio", "key": "computed.alpha_ratio", "headline": true, "observable": "${OBS}", "uncertainty": 0.002, "inputs": {"lambda_nm": 1064.5}},
      {"id": "e_per_s", "key": "computed.e_per_s", "observable": "photon scattering rate per atom in 1/s", "uncertainty": 0.1}
    ]
  }
}
`;
  const ex = { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any;
  const runFile = (p: string, run: string) => join(p, "data", "experiments", E8, "runs", run, "results.json");
  const project = (run1?: string) => {
    const p = mkdtempSync(join(tmpdir(), "bg-f8-"));
    writeFileSync(join(p, "RESEARCH.md"), "# q\n");
    mkdirSync(dirname(runFile(p, "run_1")), { recursive: true });
    if (run1 !== undefined) writeFileSync(runFile(p, "run_1"), run1);
    return p;
  };
  /** The loop on E8: `reviewer` answers round n; `onExperiment` is what a re-sent or revised experiment does on disk. */
  async function f8run(p: string, reviewer: (n: number) => string, onExperiment: () => void = () => {}) {
    const seen: string[] = [], tasks: string[] = [], reviewerPrompts: string[] = [];
    const f8stub = async (o: any) => {
      seen.push(o.name);
      if (o.name === "experiment_reviewer") {
        reviewerPrompts.push(String(o.prompt));
        return { elapsed: 1, success: true, agentId: "r", exit: ex, output: reviewer(reviewerPrompts.length) };
      }
      tasks.push(String(o.prompt));
      onExperiment();
      return { elapsed: 1, success: true, agentId: "e", exit: ex, output: "results.json is already there; nothing to add." };
    };
    const out: any = await runExperimentReviewLoop({ output: "FIRST-RUN", success: true }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: E8, PROJECT_DIR: p },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: E8 }, projectDir: p, getApiKey: () => undefined },
      initialTask: "run E8", getApiKey: () => undefined, makeSpawnTool: () => null, spawn: f8stub as any,
    });
    return { seen: seen.join(","), tasks, reviewerPrompts, output: String(out.output) };
  }
  const harnessTail = (s: string) => s.slice(s.lastIndexOf("[harness"));
  try {
    {
      const p = project(PY_NAN);
      const r = await f8run(p, () => "VERDICT: satisfied");
      check("F8 a NaN/Infinity results.json is delivered", spawnAgentModule.experimentDelivered(p, E8) === true);
      check("F8 …and reviewed without re-sending the experiment", r.seen === "experiment_reviewer" && /experiment_reviewer round 1: SATISFIED/.test(r.output) && !/NOT DELIVERED/.test(r.output),
        `${r.seen} | ${r.tasks[0]?.split("\n")[0] ?? ""}`);
      check("F8 …against its headline id (the claim table read the file)", /<claim_obligation>[\s\S]*Headline quantities in your scope: alpha_ratio\b/.test(r.reviewerPrompts[0] ?? ""), (r.reviewerPrompts[0] ?? "").slice(-200));
      const t = claimsTableModule.buildClaimTable(p);
      const alpha = t.decls.find((d) => d.id === "alpha_ratio");
      check("F8 the claim table reads its finite quantity, with no 'unparseable' line", alpha?.value === 1.0034 && !t.malformed.some((m) => /unparseable/.test(m)),
        `alpha=${alpha?.value} malformed=${t.malformed.join(" | ").slice(0, 200)}`);
      check("F8 a declaration whose value is NaN is named as not a finite number", t.malformed.some((m) => /\(e_per_s\) key computed\.e_per_s is not a finite number/.test(m)), t.malformed.join(" | ").slice(0, 200));
      check("F8 NaN/-Infinity inside strings are untouched", alpha?.observable === OBS, JSON.stringify(alpha?.observable));
      const read = (claimsTableModule as any).readResultsJson;
      const j = typeof read === "function" ? read(runFile(p, "run_1")) : undefined;
      check("F8 readResultsJson maps the bare tokens to null and keeps escaped strings",
        j?.computed?.e_per_s === null && j?.computed?.d_min === null && j?.computed?.floor_db === null && j?.computed?.alpha_ratio === 1.0034 && j?.computed?.fit_note === FIT_NOTE,
        typeof read === "function" ? JSON.stringify(j?.computed ?? j).slice(0, 200) : "readResultsJson is not exported from claims-table.ts");
      check("F8 readResultsJson is undefined for a missing file", typeof read === "function" && read(runFile(p, "run_9")) === undefined);
    }
    {
      // run_1 parses; the revision's run_2 carries a NaN in a field no declaration reads.
      const decl = { id: "cz_error", key: "computed.err", headline: true, observable: "CZ gate error", uncertainty: 1e-3, inputs: { Omega_MHz: 5 } };
      const p = project(JSON.stringify({ computed: { err: 1.2e-2, quantities: [decl] } }));
      const r = await f8run(p, (n) => n === 1 ? "VERDICT: revise\nFEEDBACK:\n- Issue 1: the CZ error omits the Doppler term." : "VERDICT: satisfied", () => {
        mkdirSync(dirname(runFile(p, "run_2")), { recursive: true });
        writeFileSync(runFile(p, "run_2"), `{"computed": {"err": 0.0061, "fit_chi2": NaN, "quantities": [${JSON.stringify(decl)}]}}`);
      });
      check("F8 a revision that writes NaN keeps the next round's obligation", r.seen === "experiment_reviewer,experiment,experiment_reviewer" && /Headline quantities in your scope: cz_error\b/.test(r.reviewerPrompts[1] ?? ""),
        `${r.seen} | ${(r.reviewerPrompts[1] ?? "").slice(-200)}`);
    }
    {
      const p = project(`{"computed": {"err": 0.01, "quantities": [`);
      const r = await f8run(p, () => "VERDICT: satisfied");
      const head = r.tasks[0]?.split("\n")[0] ?? "";
      check("F8 a truly corrupt results.json is not delivered: re-sent once, never reviewed", spawnAgentModule.experimentDelivered(p, E8) === false && r.seen === "experiment", r.seen);
      check("F8 …the re-send names the file as not valid JSON, not as missing", /runs\/run_1\/results\.json is not valid JSON/.test(head) && !/does not exist/.test(r.tasks[0] ?? ""), head);
      check("F8 …and the loop's NOT DELIVERED line says why", /NOT DELIVERED/.test(harnessTail(r.output)) && /not valid JSON/.test(harnessTail(r.output)), harnessTail(r.output).slice(0, 300));
      // Exits at the delivery check, before any spend; no keys and a scratch HOME besides, so it could not spend if it got further.
      const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN/.test(k) && !k.startsWith("LUXAS_")));
      const cli = spawnSync(join(repo, "node_modules", ".bin", "tsx"), [join(repo, "scripts", "review_experiment.mts"), p, E8, "--no-blind"],
        { cwd: repo, encoding: "utf-8", timeout: 60_000, killSignal: "SIGKILL", env: { ...env, HOME: mkdtempSync(join(tmpdir(), "bg-f8-home-")) } });
      check("F8 review_experiment's NOT DELIVERED line says the file is not valid JSON", cli.status === 2 && /NOT DELIVERED: .*runs\/run_1\/results\.json is not valid JSON/.test(cli.stderr ?? ""),
        `exit=${cli.status} ${String(cli.stderr ?? "").slice(0, 200)}`);
    }
    {
      const r = await f8run(project(), () => "VERDICT: satisfied");
      const head = r.tasks[0]?.split("\n")[0] ?? "";
      check("F8 no results.json at all: the re-send says so, not that it is invalid", /no results\.json/.test(head) && !/not valid JSON/.test(r.tasks[0] ?? ""), head);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — foreground and background experiments get the same harness review.");
