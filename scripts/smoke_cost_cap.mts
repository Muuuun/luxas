/**
 * smoke_cost_cap — the cost cap is enforced where cost is RECORDED (usage-log),
 * not only in the brain's beforeToolCall hook. Regression for 2026-08-26:
 * a `--max-cost 5` run reached $13 while the brain sat inside one foreground
 * experiment spawn and never made another tool call.
 */
import { mkdtempSync, readFileSync } from "node:fs";
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

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the cost cap fires at the usage record, in every agent.");
