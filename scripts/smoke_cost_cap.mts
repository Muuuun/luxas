/**
 * smoke_cost_cap — the cost cap is enforced where cost is RECORDED (usage-log),
 * not only in the brain's beforeToolCall hook. Regression for 2026-08-26:
 * a `--max-cost 5` run reached $13 while the brain sat inside one foreground
 * experiment spawn and never made another tool call.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiProvider, registerApiProvider } from "@earendil-works/pi-ai/compat";
import { appendUsage, enforceCostCap, setCostCap, installUsageTracking, readUsageTotals } from "../src/usage-log.ts";
import * as UL from "../src/usage-log.ts";
import * as RE from "./review_experiment.mts";
import { jobOwnerAls } from "../src/jobs/als.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const entry = (cost: number) => ({ timestamp: 1, model: "m", provider: "p", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost });

// §C23 needs a provider that the REAL wrapper wraps, so it is registered before
// the first installUsageTracking below; its rows land on that log (usage2.log).
const fakeC23 = (): any => ({
  result: () => new Promise((r) => setTimeout(() => r({ stopReason: "stop", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } } }), 5)),
  [Symbol.asyncIterator]: async function* () {},
});
registerApiProvider({ api: "fake-c23" as any, stream: fakeC23, streamSimple: fakeC23 }, "smoke_cost_cap");

const dir = mkdtempSync(join(tmpdir(), "cost-cap-"));
const log = join(dir, "usage.log");
let exits: number[] = [];
const exit = (c: number) => { exits.push(c); };

appendUsage(log, entry(2));
check("no cap set → never exits", enforceCostCap(log, exit) === false && exits.length === 0);

setCostCap(log, 5);
appendUsage(log, entry(2.5));
check("under the cap → no exit", enforceCostCap(log, exit) === false && exits.length === 0, `total ${readUsageTotals(log).cost}`);
appendUsage(log, entry(1));
check("over the cap → exit(1)", enforceCostCap(log, exit) === true && exits[0] === 1, `total ${readUsageTotals(log).cost}`);

exits = [];
setCostCap(log, undefined);
check("cap cleared → no exit", enforceCostCap(log, exit) === false && exits.length === 0);

const log2 = join(dir, "usage2.log");
installUsageTracking(log2, { maxCostUsd: 1 });
appendUsage(log2, entry(3));
check("installUsageTracking(opts.maxCostUsd) sets the cap", enforceCostCap(log2, exit) === true);
exits = [];
installUsageTracking(log2, { maxCostUsd: 10 });
check("re-install (already installed) still updates the cap", enforceCostCap(log2, exit) === false, "cap should now be 10 > 3");

// The wrapper must call enforceCostCap right after appendUsage — a static
// check on the source so the wiring cannot silently disappear.
const src = readFileSync("src/usage-log.ts", "utf-8");
const i = src.indexOf("appendUsage(logPath, {");
check("stream wrapper enforces the cap after each usage record", i > 0 && /enforceCostCap\(logPath\)/.test(src.slice(i, i + 800)));
const agentSrc = readFileSync("src/agent.ts", "utf-8");
check("brain passes --max-cost (with $250 backstop) into usage tracking", /installUsageTracking\(usageLogPath, \{ maxCostUsd: opts\.maxCostUsd \?\? 250 \}\)/.test(agentSrc));
const runnerSrc = readFileSync("src/subagent-runner.ts", "utf-8");
check("background runner reads maxCost from run_config.json", /run_config\.json/.test(runnerSrc) && /installUsageTracking\(join\(agentDir, "usage\.log"\), \{ maxCostUsd/.test(runnerSrc));
const indexSrc = readFileSync("src/index.ts", "utf-8");
check("luxas run persists maxCost into run_config.json", /maxCost: maxCost \?\? null/.test(indexSrc));
check("a bare resume inherits maxCost from run_config.json (never widens to the backstop)", /maxCost === undefined && typeof saved\.maxCost === "number"[\s\S]{0,200}maxCost = saved\.maxCost/.test(indexSrc));

// unfunded provider → fatal, not transient
{
  const { isUnfundedProviderError } = await import("../src/usage-log.ts");
  check("unfunded: Anthropic credit message", isUnfundedProviderError("400 {\"type\":\"error\",\"error\":{\"message\":\"Your credit balance is too low to access the Anthropic API.\"}}"));
  check("unfunded: DeepSeek 402 Insufficient Balance", isUnfundedProviderError("402: {\"message\":\"Insufficient Balance\"}"));
  check("not unfunded: overloaded / rate limit / network", !isUnfundedProviderError("529 overloaded_error") && !isUnfundedProviderError("429 rate_limit_error") && !isUnfundedProviderError("fetch failed"));
  // The exact string from ba-qc's 71 dead tool_review turns (HTTP 429, not 402).
  check("unfunded: GLM 429 code 1113 余额不足", isUnfundedProviderError('429: {"code":"1113","message":"余额不足或无可用资源包,请充值。"}'));
  check("unfunded: Kimi 429 account suspended", isUnfundedProviderError('429: {"message":"Your account org-x <ak-y> is suspended, please check your plan and billing details","type":"exceeded_current_quota_error"}'));
  check("unfunded: OpenAI 'no credits remaining'", isUnfundedProviderError("You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing"));
  check("not unfunded: GLM 429 code 1302 rate limit", !isUnfundedProviderError('429: {"code":"1302","message":"您的账户已达到速率限制，请您控制请求频率"}'));
  const src2 = readFileSync("src/usage-log.ts", "utf-8");
  check("stream wrapper exits on an unfunded error (LUXAS_UNFUNDED_EXIT=0 opts out)", /isUnfundedProviderError\(msg\?\.errorMessage\)[\s\S]{0,800}process\.exit\(1\)/.test(src2) && /LUXAS_UNFUNDED_EXIT/.test(src2));
}

// unfunded is RUN-WIDE: a detached background runner that hits it must stop
// the brain and its siblings too, not only itself.
{
  const { writeUnfundedSentinel, enforceUnfundedSentinel, archiveUnfundedSentinel, unfundedSentinelPath } = await import("../src/usage-log.ts");
  const d = mkdtempSync(join(tmpdir(), "unfunded-"));
  const lp = join(d, "usage.log");
  let code: number | null = null;
  check("no sentinel → other processes keep running", enforceUnfundedSentinel(lp, (c) => { code = c; }) === false && code === null);
  writeUnfundedSentinel(lp, "zai", '429: {"code":"1113","message":"余额不足"}');
  check("sentinel written next to usage.log", existsSync(unfundedSentinelPath(lp)));
  check("sentinel present → every process refuses its next model call", enforceUnfundedSentinel(lp, (c) => { code = c; }) === true && code === 1);
  const archived = archiveUnfundedSentinel(d);
  code = null;
  check("luxas run archives the sentinel so a topped-up resume is not stopped", !!archived && existsSync(archived!) && !existsSync(unfundedSentinelPath(lp)) && enforceUnfundedSentinel(lp, (c) => { code = c; }) === false);
  const src3 = readFileSync("src/usage-log.ts", "utf-8");
  check("stream wrapper checks the sentinel before paying for a call", /return \(model: any, context: any, options: any\) => \{[\s\S]{0,200}enforceUnfundedSentinel\(logPath\)/.test(src3));
  check("stream wrapper writes the sentinel before exiting on unfunded", /writeUnfundedSentinel\(logPath[\s\S]{0,700}process\.exit\(1\)/.test(src3));
  check("luxas run archives a stale sentinel on start", /archiveUnfundedSentinel\(join\(projectDir, "\.agent"\)\)/.test(readFileSync("src/index.ts", "utf-8")));
}

// §C23 — every usage row names the agent that paid for it (fields 9–10), so a
// review's own spend can be told from a live run's on the ledger they share.
// Every total stays positional on fields 0–7.
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const rowsOf = (p: string) => readFileSync(p, "utf-8").trim().split("\n").map((l) => l.split("\t"));
  const model: any = { api: "fake-c23", provider: "fakeprov", id: "fake-model" };
  const call = () => getApiProvider("fake-c23" as any)!.streamSimple(model, {} as any, {}).result();
  const before = rowsOf(log2).length;
  await jobOwnerAls.run({ agentId: "brain.experiment-bg-1", agentType: "experiment", projectDir: dir }, async () => {
    await new Promise((r) => setImmediate(r)); // a hop, as the agent loop takes before its call
    await call();
  });
  await call();
  const rows = rowsOf(log2).slice(before);
  check("C23: a row paid inside an agent's scope carries its id and type (fields 9–10), through the real wrapper",
    rows.length === 2 && rows[0].length === 10 && rows[0][7] === "0.50000000" && rows[0][8] === "brain.experiment-bg-1" && rows[0][9] === "experiment", JSON.stringify(rows));
  check("C23: a row paid outside any agent is 'unattributed' in both fields, never 'brain'",
    rows[1]?.length === 10 && rows[1][8] === "unattributed" && rows[1][9] === "unattributed", JSON.stringify(rows[1]));

  const mixed = join(dir, "mixed.log");
  writeFileSync(mixed, [
    "1\tm\tp\t1\t1\t0\t0\t2.00000000",
    "2\tm\tp\t1\t1\t0\t0\t3.00000000\tbrain.experiment-a.tool_impl-b\ttool_impl",
    "3\tm\tp\t1\t1\t0\t0\t0.25000000\tunattributed\tunattributed",
  ].join("\n") + "\n");
  const mt = readUsageTotals(mixed);
  check("C23: readUsageTotals over a mixed 8/10-field file = the sum of the cost column", near(mt.cost, 5.25) && mt.calls === 3, JSON.stringify(mt));

  // One review_experiment invocation (since 1000) on a ledger a live run also writes.
  const P = "review_experiment.E2_x.";
  const reviewRows = [
    "10\tclaude-opus-5-5\tanthropic\t1\t1\t0\t0\t60.00000000", // written before attribution
    `1001\tdeepseek-v4-pro\tdeepseek\t1\t1\t0\t0\t0.40000000\t${P}blind-estimate-q.replicator-ab12cd\treplicator`,
    `1002\tdeepseek-v4-pro\tdeepseek\t1\t1\t0\t0\t0.30000000\t${P}blind-estimate-p.replicator-ef34gh\treplicator`,
    `1003\tclaude-opus-5-5\tanthropic\t1\t1\t0\t0\t0.90000000\t${P}experiment-review-1.experiment_reviewer-zz99yy\texperiment_reviewer`,
    "1004\tdeepseek-v4-pro\tdeepseek\t1\t1\t0\t0\t2.55000000\tbrain.experiment-q.tool_impl-a1\ttool_impl", // the run, concurrently
  ]; // $64.15
  const ledger = (rs: string[]) => rs.join("\n") + "\n";
  const byAgent = join(dir, "by-agent.log");
  writeFileSync(byAgent, ledger([
    ...reviewRows,
    `900\tclaude-opus-5-5\tanthropic\t1\t1\t0\t0\t5.00000000\t${P}experiment-review-1.experiment_reviewer-old\texperiment_reviewer`, // an earlier invocation
    "1005\tclaude-opus-5-5\tanthropic\t1\t1\t0\t0\t0.80000000\treview_experiment.E2_xy.experiment-review-1.experiment_reviewer-k\texperiment_reviewer", // another experiment's review
  ]));
  if (typeof (UL as any).readUsageByAgent !== "function") check("C23: usage-log exports readUsageByAgent", false, "not exported");
  else {
    const got = (m: Map<string, { cost: number; calls: number }>, k: string) => m.get(k) ?? { cost: NaN, calls: 0 };
    const mine: Map<string, { cost: number; calls: number }> = (UL as any).readUsageByAgent(byAgent, { since: 1000, idPrefix: P });
    check("C23: readUsageByAgent(since, idPrefix) sums one invocation per agent type: replicator $0.70 (2 calls), experiment_reviewer $0.90 (1)",
      near(got(mine, "replicator").cost, 0.7) && got(mine, "replicator").calls === 2 && near(got(mine, "experiment_reviewer").cost, 0.9) && got(mine, "experiment_reviewer").calls === 1, JSON.stringify([...mine]));
    check("C23: ...and leaves out the run's concurrent tool_impl, an earlier invocation and E2_xy's review",
      mine.size === 2 && !mine.has("tool_impl") && !mine.has("(pre-attribution)"), JSON.stringify([...mine]));
    const all: Map<string, { cost: number; calls: number }> = (UL as any).readUsageByAgent(byAgent);
    check("C23: unfiltered, legacy 8-field rows sit under '(pre-attribution)'",
      near(got(all, "(pre-attribution)").cost, 60) && got(all, "(pre-attribution)").calls === 1 && near(got(all, "experiment_reviewer").cost, 6.7) && got(all, "tool_impl").calls === 1, JSON.stringify([...all]));
  }

  if (typeof (RE as any).spendReport !== "function") check("C23: review_experiment exports spendReport", false, "not exported");
  else {
    const spendReport: (p: string, eid: string, since: number) => string = (RE as any).spendReport;
    const proj = mkdtempSync(join(tmpdir(), "c23-spend-"));
    mkdirSync(join(proj, ".agent"));
    writeFileSync(join(proj, ".agent", "usage.log"), ledger(reviewRows));
    writeFileSync(join(proj, ".agent", "run_config.json"), JSON.stringify({ maxCost: 70 }));
    const inside = spendReport(proj, "E2_x", 1000);
    const mineLine = inside.split("\n").find((l) => /replicator/.test(l)) ?? "";
    check("C23: spendReport gives this review's spend by agent type, apart from the concurrent writer",
      /replicator \$0\.70/.test(mineLine) && /experiment_reviewer \$0\.90/.test(mineLine) && !/tool_impl/.test(mineLine) && /tool_impl \$2\.55/.test(inside), inside);
    check("C23: ledger $64.15 of a $70 cap → a bare resume starts INSIDE the finalization freeze; --max-cost overrides",
      /\$64\.15/.test(inside) && /\$70 cap/.test(inside) && /INSIDE/.test(inside) && /--max-cost/.test(inside), inside);
    rmSync(join(proj, ".agent", "run_config.json"));
    const backstop = spendReport(proj, "E2_x", 1000);
    check("C23: no maxCost → names the $250 backstop, and a resume starts normally", /\$250 backstop/.test(backstop) && /normally/.test(backstop) && !/INSIDE/.test(backstop), backstop);
    writeFileSync(join(proj, ".agent", "usage.log"), ledger([...reviewRows, "1006\tm\tp\t1\t1\t0\t0\t6.85000000\tbrain\tbrain"])); // $71.00
    writeFileSync(join(proj, ".agent", "run_config.json"), JSON.stringify({ maxCost: 70 }));
    const killed = spendReport(proj, "E2_x", 1000);
    check("C23: ledger $71 past a $70 cap → the resume is killed at its first paid call; --max-cost overrides",
      /\$71\.00/.test(killed) && /killed at its first paid call/.test(killed) && /--max-cost/.test(killed) && !/INSIDE/.test(killed), killed);
    rmSync(proj, { recursive: true, force: true });
  }
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the cost cap fires at the usage record, in every agent.");
