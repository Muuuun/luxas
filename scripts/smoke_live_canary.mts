/**
 * smoke_live_canary — does every model a production run routes to still work
 * through Luxas's REAL agent path, end to end? Billable (~$0.01), so it is a
 * `live` gate: `npm run test:live`, and the pi auto-updater runs it before any
 * upgrade may land (scripts/pi-autoupdate.sh).
 *
 * Offline gates cannot see a wire-format break. pi 0.87 changed the provider
 * context shape so that a raw Context silently lost its system prompt and
 * tools; only a cache-pin test that happened to exist noticed. Each probe here
 * needs all four legs to answer correctly:
 *   system prompt  the codeword exists only there;
 *   tool call      the nonce exists only in the `lookup` tool's result;
 *   tool result    the model must feed it back into `report`;
 *   exit           the loop ends via `finish` (the patched agent loop).
 *
 * Routing is `--profile dual` via src/profiles.ts, the same function
 * `luxas run` uses. A provider with no balance is reported as `unfunded` and
 * is not a failure: an empty account says nothing about the code. The gate
 * fails if any FUNDED route fails, or if nothing passed at all.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "@earendil-works/pi-ai/compat";

process.env.LUXAS_UNFUNDED_EXIT = "0"; // classify, don't exit
const { applyDualProfileEnv } = await import("../src/profiles.ts");
applyDualProfileEnv({ setBrain: true });
const { installUsageTracking, isUnfundedProviderError, readUsageTotals } = await import("../src/usage-log.ts");
const { listRoutedModels, resolveModelExact, spawnAgent } = await import("../src/agents/spawn.ts");
const { getApiKey } = await import("../src/auth.ts");

const dir = mkdtempSync(join(tmpdir(), "live-canary-"));
const log = join(dir, ".agent", "usage.log");
installUsageTracking(log, { maxCostUsd: 1 });

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const routes = listRoutedModels().filter((r) => !only || only.includes(r.id));

type Row = { model: string; provider: string; status: "pass" | "fail" | "unfunded"; detail: string };
const rows: Row[] = [];

for (const r of routes) {
  const codeword = `cw${randomBytes(3).toString("hex")}`;
  const nonce = `n${randomBytes(3).toString("hex")}`;
  let reported: string | null = null;
  const tools = [
    {
      name: "lookup", label: "lookup", description: "Returns the value you need.",
      parameters: Type.Object({}),
      async execute() { return { content: [{ type: "text" as const, text: `value=${nonce}` }], details: { success: true } }; },
    },
    {
      name: "report", label: "report", description: "Report your answer.",
      parameters: Type.Object({ answer: Type.String() }),
      async execute(_id: string, p: { answer: string }) { reported = p.answer; return { content: [{ type: "text" as const, text: "recorded" }], details: { success: true } }; },
    },
  ];
  const def = {
    name: "canary", description: "live canary", model: "sonnet", thinkingLevel: "low",
    toolSets: ["exit"], templates: [], spawn: { enabled: false }, maxTurns: 8,
    systemPromptTemplate: `You are a connectivity canary. The codeword is ${codeword}. Follow the task exactly and use tools for every step.`,
  };
  let key = r.id;
  try { resolveModelExact(key); } catch { key = `${r.provider}/${r.id}`; }
  let status: Row["status"] = "fail", detail = "";
  try {
    const res = await spawnAgent({
      name: "canary", resolveDefinition: () => def as any, exactModel: key, toolOverrides: tools,
      prompt: "Call `lookup` once. Then call `report` with answer exactly `<codeword>:<value>`, where <codeword> is from your instructions and <value> is what lookup returned after `value=`. Then call `finish`.",
      projectDir: dir, getApiKey, templateVars: {}, parentAgentId: "canary",
    });
    const want = `${codeword}:${nonce}`;
    if (reported === want) { status = "pass"; detail = `${res.exit?.toolCallCount ?? "?"} tool calls`; }
    else if (isUnfundedProviderError(res.exit?.errorMessage)) { status = "unfunded"; detail = String(res.exit?.errorMessage).slice(0, 90); }
    else detail = `reported=${JSON.stringify(reported)} want=${want} stop=${res.exit?.stopReason} ${String(res.exit?.errorMessage ?? "").slice(0, 120)}`;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (isUnfundedProviderError(msg)) { status = "unfunded"; detail = msg.slice(0, 90); } else detail = msg.slice(0, 160);
  }
  rows.push({ model: r.id, provider: r.provider, status, detail });
  console.log(`${status === "pass" ? "✓" : status === "unfunded" ? "○" : "✗ FAIL"} ${r.provider}/${r.id} — ${status}${detail ? ": " + detail : ""}`);
}

const failed = rows.filter((x) => x.status === "fail");
const passed = rows.filter((x) => x.status === "pass");
console.log(`\ncanary: ${passed.length} pass, ${failed.length} fail, ${rows.length - passed.length - failed.length} unfunded — $${readUsageTotals(log).cost.toFixed(4)}`);
if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
if (failed.length || !passed.length) { console.log("CANARY FAILED"); process.exit(1); }
console.log("ALL PASS — every funded route completes a system-prompt → tool → result → finish round trip.");
