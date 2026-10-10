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
 * C24. what is spent is written to the project's usage log, and never past
 *    the run's own cost cap. Pinned on the real CLI with fetch stubbed (no
 *    key, no network), not on the source text of the install line.
 * C19. a dead run's .agent/unfunded.json does not lock the review out (only
 *    `luxas run` archived it); a live run's refuses before anything is spawned
 *    into that run's registry.
 * C6. a round whose reviewer gave no review exits 1 (not reviewed), not 3:
 *    a 3 sends the executor back to revise against no feedback.
 * C36. `--check` runs the finish gate's claim-table and report-integrity
 *    checks on the hand route, with no experiment id and nothing spent; the
 *    claim table is read even before report.tex exists, and counted once
 *    after it does.
 * C14. a later round reuses the earlier blind lines and still estimates the
 *    quantities whose inputs moved; --blind and --no-blind are what they say.
 * C60. --blind-lines <file> hands stored ESTIMATE(blind) lines to any round,
 *    round 1 included, and estimates nothing; an argument the script does not
 *    know is refused before the project is read, so a typo never reaches a
 *    paid estimator.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runExperimentReviewLoop } from "../src/tools/spawn-agent.ts";
import { importProblems, latestResults, nextReviewRound, priorBlindLines } from "./review_experiment.mts";
// Namespace import: an export that does not exist yet fails its own check instead of the whole file.
import * as reviewCli from "./review_experiment.mts";

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
// Inherits the real keys: only for invocations that stop before any spawn. Anything that can
// reach a model goes through isolatedCli (§C24).
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

console.log("\nC24. the review spends on the project's ledger and stops at the run's own cap");
// The real CLI, isolated: a fresh HOME, no inherited key or LUXAS_* setting, and fetch replaced
// (NODE_OPTIONS --import) by a stub that logs each URL and answers as an Anthropic message of
// 200k input tokens (~$0.80 on the opus reviewer). Always --no-blind (or --blind-lines): one stubbed reviewer call.
const isoRoot = mkdtempSync(join(tmpdir(), "review-exp-cli-"));
const STUB = join(isoRoot, "fetch-stub.mjs");
const STUB_LOG = join(isoRoot, "fetch.log");
const sseEvent = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const SSE = [
  sseEvent("message_start", { message: { id: "msg_stub", type: "message", role: "assistant", content: [], model: "claude-opus-5-5", stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 200_000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  sseEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "VERDICT: revise\nFEEDBACK: stub" } }),
  sseEvent("content_block_stop", { index: 0 }),
  sseEvent("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }),
  sseEvent("message_stop", {}),
].join("");
writeFileSync(STUB, [
  `import { appendFileSync } from "node:fs";`,
  `const SSE = ${JSON.stringify(SSE)};`,
  `globalThis.fetch = async (input) => {`,
  `  appendFileSync(process.env.STUB_FETCH_LOG, (typeof input === "string" ? input : input?.url ?? String(input)) + "\\n");`,
  `  return new Response(SSE, { status: 200, headers: { "content-type": "text/event-stream" } });`,
  `};`,
].join("\n") + "\n");
/** review_experiment.mts as a child process that cannot reach a provider; `calls` = the URLs it fetched. */
function isolatedCli(args: string[], env: Record<string, string> = {}): { code: number | null; out: string; err: string; calls: string[] } {
  writeFileSync(STUB_LOG, "");
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN)$/.test(k) && !k.startsWith("LUXAS_") && k !== "NODE_OPTIONS"));
  // --blind-lines estimates nothing either, and refuses --no-blind beside it.
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "scripts", "review_experiment.mts"), ...args, ...(args.includes("--no-blind") || args.includes("--blind-lines") ? [] : ["--no-blind"])], {
    cwd: ROOT, encoding: "utf-8", timeout: 60_000, killSignal: "SIGKILL",
    env: { ...inherited, HOME: mkdtempSync(join(isoRoot, "home-")), ANTHROPIC_API_KEY: "sk-ant-stub-not-a-key", DEEPSEEK_API_KEY: "sk-stub-not-a-key",
      STUB_FETCH_LOG: STUB_LOG, NODE_OPTIONS: `--import ${pathToFileURL(STUB).href}`, ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", calls: readFileSync(STUB_LOG, "utf-8").split("\n").filter(Boolean) };
}
/** A delivered experiment E1_x with `ledgerUsd` already on the project's ledger and an optional run_config.json. */
function deliveredProject(ledgerUsd: number, runConfig?: Record<string, unknown>): string {
  const d = mkdtempSync(join(isoRoot, "proj-"));
  writeFileSync(join(d, "RESEARCH.md"), "# q\n");
  mkdirSync(join(d, "data", "experiments", "E1_x", "runs", "run_1"), { recursive: true });
  writeFileSync(join(d, "data", "experiments", "E1_x", "runs", "run_1", "results.json"), JSON.stringify({ computed: { kappa: 4e-7, quantities: [quantity(3e-7)] } }));
  mkdirSync(join(d, ".agent"), { recursive: true });
  if (ledgerUsd > 0) writeFileSync(join(d, ".agent", "usage.log"), `1791281762641\tclaude-opus-5-5\tanthropic\t4\t174\t0\t51219\t${ledgerUsd.toFixed(8)}\n`);
  if (runConfig) writeFileSync(join(d, ".agent", "run_config.json"), JSON.stringify(runConfig, null, 2) + "\n");
  return d;
}
const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return undefined; } };
const LAUNCH = { model: "opus", profile: "dual", savedAt: "2026-10-01T00:00:00Z" };

const capOf = (d: string, maxUsd: number) => typeof reviewCli.reviewCostCap === "function" ? reviewCli.reviewCostCap(d, maxUsd) : undefined;
const at70 = capOf(deliveredProject(69, { ...LAUNCH, maxCost: 70 }), 5);
check("maxCost 70, ledger $69, --max-usd 5 → this invocation stops at the run's $70, not $74", at70?.cap === 70 && at70?.runCap === 70, JSON.stringify(at70) ?? "reviewCostCap is not exported");
const noCfg = capOf(deliveredProject(69), 5);
check("no run_config.json → ledger + --max-usd ($74), under the $250 backstop", noCfg?.cap === 74 && noCfg?.runCap === 250 && noCfg?.runCapSource === "backstop", JSON.stringify(noCfg) ?? "reviewCostCap is not exported");
const past = capOf(deliveredProject(6, { ...LAUNCH, maxCost: 5 }), 5);
check("ledger $6 past a $5 run cap → refused, naming the run cap and how to raise it", !!past?.refuse && /run cap/.test(past.refuse) && /--raise-run-cap/.test(past.refuse), JSON.stringify(past) ?? "reviewCostCap is not exported");
{
  const d = deliveredProject(6, { ...LAUNCH, maxCost: 5 });
  const cfgFile = join(d, ".agent", "run_config.json");
  const raised = typeof reviewCli.raiseRunCap === "function" ? reviewCli.raiseRunCap(d, 11) : undefined;
  const cfg = readJson(cfgFile);
  check("raising the run cap rewrites maxCost and keeps model, profile and savedAt (what a resume inherits)",
    !!raised && !("error" in raised) && cfg?.maxCost === 11 && cfg?.model === "opus" && cfg?.profile === "dual" && cfg?.savedAt === LAUNCH.savedAt, `${JSON.stringify(raised)} → ${JSON.stringify(cfg)}`);
  check("…and the run cap read back is the raised one, from run_config.json", reviewCli.runCap?.(d)?.cap === 11 && /run_config\.json$/.test(String(reviewCli.runCap?.(d)?.source)), JSON.stringify(reviewCli.runCap?.(d)));
  const before = readFileSync(cfgFile, "utf-8");
  const lower = reviewCli.raiseRunCap?.(d, 8);
  const underLedger = reviewCli.raiseRunCap?.(deliveredProject(6), 6);
  check("a 'raise' below the current cap or not above the ledger is refused and writes nothing (lowering is `luxas run --max-cost`)",
    !!lower && "error" in lower && !!underLedger && "error" in underLedger && readFileSync(cfgFile, "utf-8") === before, `${JSON.stringify(lower)} ${JSON.stringify(underLedger)}`);
}

// (A) the ledger is already at the run cap: refused before anything is spent.
{
  const d = deliveredProject(6, { ...LAUNCH, maxCost: 5 });
  const ledger = readFileSync(join(d, ".agent", "usage.log"));
  const r = isolatedCli([d, "E1_x"]);
  check("(A) ledger $6, run cap $5 → exit 2 naming the run cap, with no model call", r.code === 2 && /run cap/.test(r.err) && /nothing spent/.test(r.err) && r.calls.length === 0, `exit ${r.code}, ${r.calls.length} stub call(s): ${r.err.slice(-300)}`);
  check("…it prints the exact rerun command with --raise-run-cap ceil(ledger + --max-usd)", r.err.includes(`npx tsx scripts/review_experiment.mts ${d} E1_x --no-blind --raise-run-cap 11`), r.err.slice(-300));
  check("…the ledger is byte-identical and no review file was written", Buffer.compare(ledger, readFileSync(join(d, ".agent", "usage.log"))) === 0 && !existsSync(join(d, "reviews")));
}
// (B) one paid call crosses the run cap: killed at the run's $70, not at ledger + --max-usd.
{
  const d = deliveredProject(69.5, { ...LAUNCH, maxCost: 70 });
  const r = isolatedCli([d, "E1_x"]);
  check("(B) ledger $69.50, run cap $70 → killed at the first call that crosses $70", r.code === 1 && /Cost limit exceeded.*> \$70\b/.test(r.err) && r.calls.length === 1, `exit ${r.code}, ${r.calls.length} stub call(s): ${r.err.slice(-300)}`);
}
// (C) what the review spends is on the project's ledger — the number the run's cap reads.
{
  const d = deliveredProject(0);
  const r = isolatedCli([d, "E1_x"]);
  const rows = (existsSync(join(d, ".agent", "usage.log")) ? readFileSync(join(d, ".agent", "usage.log"), "utf-8") : "").split("\n").filter(Boolean);
  check("(C) the stubbed reviewer call is one row on <project>/.agent/usage.log", r.calls.length === 1 && rows.length === 1 && rows[0].split("\t")[3] === "200000", `exit ${r.code}, ${r.calls.length} stub call(s), rows ${JSON.stringify(rows)}: ${r.err.slice(-200)}`);
}
// (D) --raise-run-cap: an operator's deliberate raise is persisted and the review proceeds under it.
{
  const d = deliveredProject(6, { ...LAUNCH, maxCost: 5 });
  const bad = isolatedCli([d, "E1_x", "--raise-run-cap", "5.5"]);
  check("(D) --raise-run-cap not above the ledger → exit 2, no model call, run_config.json untouched", bad.code === 2 && bad.calls.length === 0 && readJson(join(d, ".agent", "run_config.json"))?.maxCost === 5, `exit ${bad.code}, ${bad.calls.length} stub call(s): ${bad.err.slice(-200)}`);
  const ok = isolatedCli([d, "E1_x", "--raise-run-cap", "11"]);
  const cfg = readJson(join(d, ".agent", "run_config.json"));
  check("…--raise-run-cap 11 → the review runs, maxCost 11 is persisted with the launch's profile and model",
    ok.calls.length === 1 && cfg?.maxCost === 11 && cfg?.profile === "dual" && cfg?.model === "opus", `exit ${ok.code}, ${ok.calls.length} stub call(s), ${JSON.stringify(cfg)}: ${ok.err.slice(-200)}`);
  check("…and it says a run live right now keeps its launch cap until restarted", /keeps its launch cap/.test(ok.err), ok.err.slice(0, 400));
}

console.log("\nC19. a dead run's unfunded sentinel is archived; a live run's refuses the review before any spawn");
check("review_experiment exports clearStaleUnfundedSentinel", typeof reviewCli.clearStaleUnfundedSentinel === "function", typeof reviewCli.clearStaleUnfundedSentinel);
{
  const SENTINEL = JSON.stringify({ provider: "deepseek", message: "402: Insufficient Balance", pid: 1, at: "2026-10-09T00:00:00Z" }) + "\n";
  // A pid that existed and is reaped: what run.pid holds after the run died.
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid!;
  const unfundedProject = (runPid: number | null): string => {
    const d = deliveredProject(0);
    if (runPid !== null) writeFileSync(join(d, ".agent", "run.pid"), JSON.stringify({ pid: runPid, startedAt: 1 }));
    writeFileSync(join(d, ".agent", "unfunded.json"), SENTINEL);
    return d;
  };
  const sentinelState = (d: string) => {
    const ag = join(d, ".agent");
    const archived = readdirSync(ag).filter((f) => /^unfunded\..+\.json$/.test(f));
    return { kept: existsSync(join(ag, "unfunded.json")) && readFileSync(join(ag, "unfunded.json"), "utf-8") === SENTINEL,
      gone: !existsSync(join(ag, "unfunded.json")), archived, spawned: existsSync(join(ag, "active-agents.json")) };
  };

  const clean = deliveredProject(0);
  const none = reviewCli.clearStaleUnfundedSentinel?.(clean, "");
  check("no sentinel → nothing archived, nothing live, nothing written", JSON.stringify(none) === JSON.stringify({ archived: null, livePids: [] }) && readdirSync(join(clean, ".agent")).length === 0, JSON.stringify(none));
  const injected = unfundedProject(deadPid);
  const viaPs = reviewCli.clearStaleUnfundedSentinel?.(injected, `  4242 node /x/src/agents/subagent-runner.ts ${injected} --agent tool_impl\n`);
  check("a ps row of the run's subagent-runner → that pid is live and the sentinel is kept", JSON.stringify(viaPs?.livePids) === "[4242]" && viaPs?.archived === null && sentinelState(injected).kept, JSON.stringify(viaPs));

  const dead = unfundedProject(deadPid);
  const rDead = isolatedCli([dead, "E1_x"]);
  const sDead = sentinelState(dead);
  check("dead run.pid + sentinel → archived under unfunded.<ts>.json with its provenance, and the review reaches the model",
    rDead.calls.length >= 1 && sDead.gone && sDead.archived.length === 1 && readFileSync(join(dead, ".agent", sDead.archived[0] ?? "-"), "utf-8") === SENTINEL && /stopped on an unfunded provider/.test(rDead.err),
    `exit ${rDead.code}, ${rDead.calls.length} stub call(s), ${JSON.stringify(sDead)}: ${rDead.err.slice(-300)}`);
  const noPid = unfundedProject(null);
  const rNoPid = isolatedCli([noPid, "E1_x"]);
  const sNoPid = sentinelState(noPid);
  check("no run.pid + sentinel → archived too, and the review reaches the model", rNoPid.calls.length >= 1 && sNoPid.gone && sNoPid.archived.length === 1,
    `exit ${rNoPid.code}, ${rNoPid.calls.length} stub call(s), ${JSON.stringify(sNoPid)}: ${rNoPid.err.slice(-300)}`);

  // run.pid = this smoke: alive for the whole child run.
  const live = unfundedProject(process.pid);
  const rLive = isolatedCli([live, "E1_x"]);
  const sLive = sentinelState(live);
  check("live run.pid + sentinel → exit 1 naming the live pid, nothing spent, sentinel kept, no phantom entry in the run's active-agents.json",
    rLive.code === 1 && rLive.calls.length === 0 && sLive.kept && sLive.archived.length === 0 && !sLive.spawned && !existsSync(join(live, "reviews")) && new RegExp(`UNFUNDED: the run is still live \\(pid ${process.pid}\\)`).test(rLive.err),
    `exit ${rLive.code}, ${rLive.calls.length} stub call(s), ${JSON.stringify(sLive)}: ${rLive.err.slice(-300)}`);

  // run.pid is dead but a detached subagent-runner of that run is still mid-tool: what `luxas stop` would kill.
  const orphanProject = unfundedProject(deadPid);
  const orphan = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "subagent-runner", orphanProject], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  let rOrphan: ReturnType<typeof isolatedCli>;
  try { rOrphan = isolatedCli([orphanProject, "E1_x"]); } finally { orphan.kill("SIGKILL"); }
  const sOrphan = sentinelState(orphanProject);
  check("dead run.pid but a live subagent-runner of the run → exit 1 naming it, nothing spent, sentinel kept, no phantom entry",
    rOrphan.code === 1 && rOrphan.calls.length === 0 && sOrphan.kept && !sOrphan.spawned && new RegExp(`pid ${orphan.pid}\\b`).test(rOrphan.err),
    `exit ${rOrphan.code}, ${rOrphan.calls.length} stub call(s), ${JSON.stringify(sOrphan)}: ${rOrphan.err.slice(-300)}`);

  const badFlag = unfundedProject(deadPid);
  const rBad = isolatedCli([badFlag, "E1_x", "--max-usd", "lots"]);
  check("a refused invocation (--max-usd lots) → exit 2 and the sentinel is left untouched", rBad.code === 2 && sentinelState(badFlag).kept && sentinelState(badFlag).archived.length === 0,
    `exit ${rBad.code}, ${JSON.stringify(sentinelState(badFlag))}: ${rBad.err.slice(-200)}`);

  // The fetch stub answers as Anthropic; the --no-blind review's one reviewer call is the only fetch there should be.
  const urls = [rDead, rNoPid, rLive, rOrphan, rBad].flatMap((r) => r.calls);
  check("every fetch was the stubbed Anthropic reviewer call — no other provider or URL was tried", urls.every((u) => /^https:\/\/api\.anthropic\.com\/v1\/messages\b/.test(u)), urls.join(" | "));
}

console.log("\nC6. the exit code says whether the round was reviewed");
{
  process.env.LUXAS_BLIND_ESTIMATE = "0";
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  const ok = { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any;
  // Round 2 of an experiment whose round 1 was REVISE, as the CLI runs it; every reviewer spawn returns `reply`.
  const round2 = async (reply: any): Promise<string> => {
    const d = deliveredProject(0);
    mkdirSync(join(d, "reviews"), { recursive: true });
    writeFileSync(join(d, "reviews", "experiment_review_E1_x_r1.md"), "# experiment_reviewer — E1_x round 1\n\nVERDICT: revise\n\nFEEDBACK:\nThe 532 nm sign is undetermined because the vector polarizability is omitted.\n");
    const out = await runExperimentReviewLoop({ output: "executed outside", success: true }, {
      projectDir: d, mergedTemplateVars: { EXPERIMENT_ID: "E1_x", PROJECT_DIR: d },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: "E1_x" }, projectDir: d, getApiKey: () => undefined },
      initialTask: "", getApiKey: () => undefined, makeSpawnTool: () => null, startRound: 2,
      spawn: (async () => ({ elapsed: 1, agentId: "r", exit: ok, ...reply })) as any,
    });
    return out.output;
  };
  const code = (o: string) => typeof reviewCli.reviewExitCode === "function" ? reviewCli.reviewExitCode(o) : "reviewExitCode is not exported";
  const dead = await round2({ success: true, output: "(no output)", exit: { ...ok, stopReason: "error", errorMessage: "529 overloaded_error" } });
  check("a reviewer that gave no review (twice) → exit 1, not 3", code(dead) === 1, `${code(dead)}: ${JSON.stringify(dead.slice(-200))}`);
  const satisfied = await round2({ success: true, output: "VERDICT: satisfied" });
  check("SATISFIED → exit 0", code(satisfied) === 0, `${code(satisfied)}: ${JSON.stringify(satisfied.slice(-200))}`);
  const revise = await round2({ success: true, output: "VERDICT: revise\nFEEDBACK: the 532 nm sign is still undetermined" });
  check("REVISE → exit 3", code(revise) === 3, `${code(revise)}: ${JSON.stringify(revise.slice(-200))}`);
  delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
}

console.log("\nC36. --check: the finish gate's claim-table and report-integrity checks, without an experiment id and at $0");
check("review_experiment exports finishCheck", typeof reviewCli.finishCheck === "function", typeof reviewCli.finishCheck);
{
  const finishCheck = (d: string) => typeof reviewCli.finishCheck === "function" ? reviewCli.finishCheck(d) : undefined;
  const brief = (issues: { blocking: boolean; text: string }[] | undefined) => issues ? JSON.stringify(issues.map((i) => `${i.blocking ? "B" : "-"} ${i.text.slice(0, 90)}`)) : "finishCheck is not exported";
  // Every key empty, on top of isolatedCli's fresh HOME and stubbed fetch: --check must not need one.
  const noKeys = Object.fromEntries([...Object.keys(process.env).filter((k) => /_API_KEY$/.test(k)), "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"].map((k) => [k, ""]));

  // (a) §2 left E2's round 4 at REVISE with its finding nowhere in the ledger, and there is no report/:
  // reportIntegrityIssues returns [] before report.tex exists, so the claim table must be read on its own.
  const issues = finishCheck(projectDir);
  const open = issues?.find((i) => i.blocking && /\[review-open\] E2\b/.test(i.text));
  check("(a) no report/: E2's unanswered REVISE is a blocking [review-open] E2 issue", !!open, brief(issues));

  // (b) with report.tex, reportIntegrityIssues already folds the claim-table issues in: no double count.
  const withReport = mkdtempSync(join(tmpdir(), "review-exp-report-"));
  cpSync(projectDir, withReport, { recursive: true });
  mkdirSync(join(withReport, "report"), { recursive: true });
  writeFileSync(join(withReport, "report", "report.tex"), "\\documentclass{article}\\begin{document}\\begin{abstract}We study a light shift.\\end{abstract}Body.\\end{document}\n");
  const withTex = finishCheck(withReport);
  const copies = open && withTex ? withTex.filter((i) => i.text === open.text).length : -1;
  check("(b) with report/report.tex added, that issue is listed exactly once", copies === 1, `${copies} cop(ies): ${brief(withTex)}`);
  rmSync(withReport, { recursive: true, force: true });

  // (c) the CLI with NO experiment id. Never with a delivered id: before C36 that was a billed review.
  const agentDir = join(projectDir, ".agent");
  const had = { usage: existsSync(join(agentDir, "usage.log")), jobs: existsSync(join(agentDir, "jobs")) };
  const reviewsBefore = readdirSync(join(projectDir, "reviews")).sort().join(",");
  const r = isolatedCli([projectDir, "--check"], noKeys);
  check("(c) --check without an experiment id → exit 4, the [review-open] issue on stdout, and the subset label",
    r.code === 4 && r.out.includes("[review-open]") && r.out.includes("does NOT mean finish() would pass"), `exit ${r.code}: ${(r.out + r.err).slice(0, 400)}`);
  check("…and nothing spent: no fetch, no usage.log or jobs/ created, reviews/ unchanged",
    r.calls.length === 0 && existsSync(join(agentDir, "usage.log")) === had.usage && existsSync(join(agentDir, "jobs")) === had.jobs && readdirSync(join(projectDir, "reviews")).sort().join(",") === reviewsBefore,
    `${r.calls.length} fetch(es), usage.log ${existsSync(join(agentDir, "usage.log"))}, jobs ${existsSync(join(agentDir, "jobs"))}`);

  // (d) a declared headline quantity whose latest round is SATISFIED, no report/: clean.
  const clean = deliveredProject(0);
  mkdirSync(join(clean, "reviews"), { recursive: true });
  writeFileSync(join(clean, "reviews", "experiment_review_E1_x_r1.md"), "# experiment_reviewer — E1_x round 1\n\nREVIEW-COMPLETE\nVERDICT: satisfied\n");
  const cleanIssues = finishCheck(clean);
  check("(d) a clean project → finishCheck has no blocking issue", !!cleanIssues && !cleanIssues.some((i) => i.blocking), brief(cleanIssues));
  const rc = isolatedCli([clean, "--check"], noKeys);
  check("…and --check exits 0 with no fetch", rc.code === 0 && rc.calls.length === 0, `exit ${rc.code}, ${rc.calls.length} fetch(es): ${(rc.out + rc.err).slice(0, 300)}`);

  // (e) a review round (stubbed reviewer: REVISE) ends with one line from the same checks — counting the
  // [review-open] E1 that round just wrote — and the exit code stays the round's.
  const rr = isolatedCli([deliveredProject(0), "E1_x"]);
  const line = rr.out.match(/^finish-gate subset: (\d+) blocking issue\(s\) mention E1 \((\d+) in the project\) — run --check$/m);
  check("(e) a REVISE round ends with 'finish-gate subset: 1 blocking issue(s) mention E1 (1 in the project)' and still exits 3",
    rr.code === 3 && line?.[1] === "1" && line?.[2] === "1", `exit ${rr.code}: ${rr.out.slice(-400)}`);
}

console.log("\nC14. a later round reuses earlier blind lines and estimates only what moved; --blind / --no-blind");
{
  const blindPlan = (argv: string[], d: string, eid: string) => typeof reviewCli.blindPlan === "function" ? reviewCli.blindPlan(argv, d, eid) : undefined;
  const d = deliveredProject(0);
  const BLIND = "ESTIMATE(blind): light_shift_kappa — 3.2e-7 ± 1.2e-7 via tensor shift — inputs: [alpha_s_au=184.4]";
  const first = blindPlan([], d, "E1_x");
  check("round 1, no flag → nothing carried, estimation on", JSON.stringify(first) === JSON.stringify({ prior: [], estimate: true }), JSON.stringify(first) ?? "blindPlan is not exported");
  mkdirSync(join(d, "reviews"), { recursive: true });
  writeFileSync(join(d, "reviews", "experiment_review_E1_x_r1.md"), `# experiment_reviewer — E1_x round 1\n\nBlind estimates:\n${BLIND}\n\nVERDICT: revise\n`);
  const later = blindPlan([], d, "E1_x");
  check("round 2, no flag → round 1's blind lines are carried and estimation stays ON (the loop re-estimates what moved)",
    JSON.stringify(later?.prior) === JSON.stringify([BLIND]) && later?.estimate === true, JSON.stringify(later) ?? "blindPlan is not exported");
  const again = blindPlan(["--blind"], d, "E1_x");
  check("--blind → nothing carried, every id estimated again", JSON.stringify(again) === JSON.stringify({ prior: [], estimate: true }), JSON.stringify(again));
  const off = blindPlan(["--no-blind"], d, "E1_x");
  check("--no-blind → estimation off, earlier lines still handed to the reviewer", off?.estimate === false && JSON.stringify(off?.prior) === JSON.stringify([BLIND]), JSON.stringify(off));
  const src = readFileSync(join(ROOT, "scripts", "review_experiment.mts"), "utf-8");
  check("the CLI takes the plan from blindPlan, with no round-based switch-off of its own",
    /blindPlan\(argv, projectDir, experimentId\)/.test(src) && !/round > 1[^\n]*LUXAS_BLIND_ESTIMATE/.test(src));

  // The plan through the loop, as the CLI enters it: inputs unchanged → the earlier line is reused, no estimator.
  const savedBlind = process.env.LUXAS_BLIND_ESTIMATE;
  delete process.env.LUXAS_BLIND_ESTIMATE;
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  try {
    const calls: string[] = [];
    let prompt = "";
    const ok = { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any;
    const out = await runExperimentReviewLoop({ output: "executed outside", success: true }, {
      projectDir: d, mergedTemplateVars: { EXPERIMENT_ID: "E1_x", PROJECT_DIR: d },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: "E1_x" }, projectDir: d, getApiKey: () => undefined },
      initialTask: "", getApiKey: () => undefined, makeSpawnTool: () => null,
      startRound: nextReviewRound(d, "E1_x"), priorBlindLines: later?.prior ?? [],
      spawn: (async (o: any) => {
        calls.push(o.name);
        if (o.name === "experiment_reviewer") prompt = String(o.prompt);
        return { elapsed: 1, agentId: "r", success: true, exit: ok, output: "VERDICT: satisfied" };
      }) as any,
    });
    const r2 = join(d, "reviews", "experiment_review_E1_x_r2.md");
    check("…through the loop with estimation on: no estimator for the unmoved id, the reviewer and _r2.md carry round 1's line",
      calls.join(",") === "experiment_reviewer" && prompt.includes(BLIND) && existsSync(r2) && readFileSync(r2, "utf-8").includes(BLIND) && /reused from earlier rounds: light_shift_kappa/.test(out.output),
      `${calls.join(",")} | ${JSON.stringify(out.output.slice(-160))}`);
  } finally {
    if (savedBlind === undefined) delete process.env.LUXAS_BLIND_ESTIMATE; else process.env.LUXAS_BLIND_ESTIMATE = savedBlind;
    delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
  }
}

console.log("\nC60. --blind-lines hands stored blind estimates to any round, round 1 included, and estimates nothing; argument mistakes are refused first");
{
  const blindPlan = (argv: string[], d: string, eid: string) => typeof reviewCli.blindPlan === "function" ? reviewCli.blindPlan(argv, d, eid) : undefined;
  const argvProblem = (argv: string[]) => typeof reviewCli.argvProblem === "function" ? reviewCli.argvProblem(argv) : "argvProblem is not exported";
  // Made against an alpha_s that has since moved (184.4 now): with estimation on, the loop would estimate this id
  // again, so no replicator call below means --blind-lines switched estimation off, not that the line was reusable.
  const STORED = "ESTIMATE(blind): light_shift_kappa — 3.1e-7 ± 1.1e-7 via scalar + tensor polarizability — inputs: [alpha_s_au=170]";
  // A whole earlier review file, as the measurement hands it over: only its ESTIMATE(blind) lines count, once each.
  const linesFile = join(isoRoot, "stored_E1_x_r1.md");
  writeFileSync(linesFile, `# experiment_reviewer — E1_x round 1\n\nBlind estimates:\n${STORED}\n${STORED}\n\nReviewer obligation lines:\nESTIMATE: light_shift_kappa — 4e-7 ± 3e-7 via the agent's MC\n\nVERDICT: revise\n`);
  const noLines = join(isoRoot, "no_blind_lines.md");
  writeFileSync(noLines, "# experiment_reviewer — E1_x round 1\n\nESTIMATE: light_shift_kappa — 4e-7 ± 3e-7 via the agent's MC\nVERDICT: revise\n");

  // (i) the plan, then the loop entered with it as the CLI enters it.
  const d = deliveredProject(0);
  const plan = blindPlan(["--blind-lines", linesFile], d, "E1_x");
  check("(i) round 1 (no reviews/) with --blind-lines → prior = the file's ESTIMATE(blind) lines, once each, and estimation off",
    JSON.stringify(plan) === JSON.stringify({ prior: [STORED], estimate: false }), JSON.stringify(plan) ?? "blindPlan is not exported");
  const savedBlind = process.env.LUXAS_BLIND_ESTIMATE;
  delete process.env.LUXAS_BLIND_ESTIMATE;
  if (plan && !plan.estimate) process.env.LUXAS_BLIND_ESTIMATE = "0";
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1";
  try {
    const calls: string[] = [];
    let prompt = "";
    const ok = { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } as any;
    await runExperimentReviewLoop({ output: "executed outside", success: true }, {
      projectDir: d, mergedTemplateVars: { EXPERIMENT_ID: "E1_x", PROJECT_DIR: d },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: "E1_x" }, projectDir: d, getApiKey: () => undefined },
      initialTask: "", getApiKey: () => undefined, makeSpawnTool: () => null,
      startRound: 1, priorBlindLines: plan?.prior ?? [],
      spawn: (async (o: any) => {
        calls.push(o.name);
        if (o.name === "experiment_reviewer") prompt = String(o.prompt);
        return { elapsed: 1, agentId: "r", success: true, exit: ok, output: "VERDICT: revise\nFEEDBACK: stub" };
      }) as any,
    });
    const r1 = join(d, "reviews", "experiment_review_E1_x_r1.md");
    check("…through the loop at round 1: no replicator, and the reviewer prompt and _r1.md carry the stored line",
      calls.join(",") === "experiment_reviewer" && prompt.includes(STORED) && existsSync(r1) && readFileSync(r1, "utf-8").includes(STORED),
      `calls ${calls.join(",")}; prompt has it ${prompt.includes(STORED)}; _r1.md ${existsSync(r1) ? readFileSync(r1, "utf-8").includes(STORED) : "missing"}`);
  } finally {
    if (savedBlind === undefined) delete process.env.LUXAS_BLIND_ESTIMATE; else process.env.LUXAS_BLIND_ESTIMATE = savedBlind;
    delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
  }

  // (ii) nothing to hand over is refused, never read as "no prior lines".
  const empty = blindPlan(["--blind-lines", noLines], d, "E1_x");
  check("(ii) a lines file with no ESTIMATE(blind) line → refused, nothing estimated", !!empty?.refuse && /no ESTIMATE\(blind\) line/.test(empty.refuse) && empty.estimate === false, JSON.stringify(empty));
  const absent = blindPlan(["--blind-lines", join(isoRoot, "absent.md")], d, "E1_x");
  check("…and so is a file that cannot be read", !!absent?.refuse && absent.estimate === false, JSON.stringify(absent));
  // Not delivered, so no version of the CLI can reach a model with it.
  mkdirSync(join(d, "data", "experiments", "E7_pending", "runs", "run_1"), { recursive: true });
  const rEmpty = isolatedCli([d, "E7_pending", "--blind-lines", noLines]);
  check("…the CLI exits 2 naming it, ahead of the delivery check, with no fetch", rEmpty.code === 2 && /no ESTIMATE\(blind\) line/.test(rEmpty.err) && rEmpty.calls.length === 0,
    `exit ${rEmpty.code}, ${rEmpty.calls.length} fetch(es): ${rEmpty.err.slice(-200)}`);

  // (iii) an argument the script does not know, before the project is even read.
  const typo = isolatedCli([join(d, "data"), "E1_x", "--noblind"]);
  check("(iii) --noblind on a directory that is not a project → exit 2 'unknown flag', ahead of the project check, no fetch",
    typo.code === 2 && /unknown flag/.test(typo.err) && typo.err.includes("--noblind") && typo.calls.length === 0, `exit ${typo.code}, ${typo.calls.length} fetch(es): ${typo.err.slice(-200)}`);
  check("…argvProblem: every known flag, with its value, is clean",
    argvProblem(["p", "E1_x", "--profile", "claude", "--blind-lines", "f.md", "--summary", "s.md", "--max-usd", "5", "--raise-run-cap", "9"]) === null &&
    argvProblem(["p", "E1_x", "--blind"]) === null && argvProblem(["p", "E1_x", "--no-blind"]) === null && argvProblem(["p", "--check"]) === null,
    String(argvProblem(["p", "E1_x", "--profile", "claude", "--blind-lines", "f.md", "--summary", "s.md", "--max-usd", "5", "--raise-run-cap", "9"])));
  const slips = [["p", "E1_x", "--blind-lines"], ["p", "E1_x", "--blind-lines", "--no-blind"], ["p", "E1_x", "--max-usd=5"], ["p", "E1_x", "-no-blind"], ["p", "E1_x", "no-blind"]];
  check("…a value flag with no value, --flag=value, a single-dash flag and a third positional are each refused",
    slips.every((a) => typeof argvProblem(a) === "string" && argvProblem(a) !== "argvProblem is not exported"), JSON.stringify(slips.map((a) => argvProblem(a))));

  // (iv) --blind-lines decides the blind estimates alone.
  const both = blindPlan(["--blind-lines", linesFile, "--blind"], d, "E1_x");
  check("(iv) --blind-lines with --blind → refused, nothing estimated", !!both?.refuse && /combined with --blind\b/.test(both.refuse) && both.estimate === false, JSON.stringify(both));
  const dv = deliveredProject(0);
  const rBoth = isolatedCli([dv, "E1_x", "--blind-lines", linesFile, "--no-blind"]);
  check("…with --no-blind on a delivered experiment → exit 2 naming both, no fetch, no review written",
    rBoth.code === 2 && /--blind-lines/.test(rBoth.err) && /--no-blind/.test(rBoth.err) && rBoth.calls.length === 0 && !existsSync(join(dv, "reviews")),
    `exit ${rBoth.code}, ${rBoth.calls.length} fetch(es): ${rBoth.err.slice(-200)}`);

  // (v) the CLI end to end. --profile claude keeps every model on the stubbed Anthropic endpoint should an estimator run.
  const de = deliveredProject(0);
  const rLines = isolatedCli([de, "E1_x", "--blind-lines", linesFile, "--profile", "claude"]);
  const r1 = join(de, "reviews", "experiment_review_E1_x_r1.md");
  check("(v) the CLI at round 1 with --blind-lines → one fetch (the reviewer; no estimator), exit 3 on the stub's REVISE, _r1.md carries the stored line",
    rLines.code === 3 && rLines.calls.length === 1 && existsSync(r1) && readFileSync(r1, "utf-8").includes(STORED) && /round 1,[^\n]*estimating 0 \(off\)/.test(rLines.err),
    `exit ${rLines.code}, ${rLines.calls.length} fetch(es), _r1.md ${existsSync(r1)}: ${rLines.err.slice(0, 300)}`);
}

rmSync(projectDir, { recursive: true, force: true });
rmSync(isoRoot, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log("\nALL PASS — an outside-executed experiment is reviewed round by round through the same loop.");
