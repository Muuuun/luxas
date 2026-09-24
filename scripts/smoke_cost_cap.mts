/**
 * smoke_cost_cap — the cost cap is enforced where cost is RECORDED (usage-log),
 * not only in the brain's beforeToolCall hook. Regression for 2026-08-26:
 * a `--max-cost 5` run reached $13 while the brain sat inside one foreground
 * experiment spawn and never made another tool call.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendUsage, enforceCostCap, setCostCap, installUsageTracking, readUsageTotals } from "../src/usage-log.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const entry = (cost: number) => ({ timestamp: 1, model: "m", provider: "p", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost });

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
  check("stream wrapper writes the sentinel before exiting on unfunded", /writeUnfundedSentinel\(logPath[\s\S]{0,400}process\.exit\(1\)/.test(src3));
  check("luxas run archives a stale sentinel on start", /archiveUnfundedSentinel\(join\(projectDir, "\.agent"\)\)/.test(readFileSync("src/index.ts", "utf-8")));
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the cost cap fires at the usage record, in every agent.");
