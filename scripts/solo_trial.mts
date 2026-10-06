#!/usr/bin/env tsx
/**
 * solo_trial — one agent, one short prompt, one task directory, on Luxas's own
 * loop. The cell of the architecture comparison that Claude Code cannot fill:
 * the same single-agent shape on any model Luxas can route to (deepseek-v4-pro
 * here), so "is it the structure or the model" can be separated.
 *
 * The directory holds TASK.md and its inputs, exactly as given to the
 * `claude -p` arm; the prompt is that arm's prompt. Nothing of the Luxas
 * experiment workflow is used: no orchestrator, no tool_impl / tool_review.
 *
 *   npx tsx scripts/solo_trial.mts --dir <task dir> --model deepseek-v4-pro [--cap 3] [--turns 200]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dir = resolve(arg("--dir")!), model = arg("--model")!, cap = Number(arg("--cap", "3")), turns = Number(arg("--turns", "200"));
if (!existsSync(join(dir, "TASK.md")) || !existsSync(join(dir, "PROMPT.txt"))) { console.error("the task dir needs TASK.md and PROMPT.txt"); process.exit(2); }

mkdirSync(join(dir, ".agent"), { recursive: true });
process.env.LUXAS_PROJECT_DIR = dir;
const { installUsageTracking } = await import("../src/usage-log.ts");
installUsageTracking(join(dir, ".agent", "usage.log"), { maxCostUsd: cap });
const { spawnAgent, resolveModelExact } = await import("../src/agents/spawn.ts");
const { getApiKey } = await import("../src/auth.ts");
resolveModelExact(model);

const solo = () => ({
  name: "solo",
  description: "Bench-only: a single agent with coding tools and no Luxas workflow.",
  model: "opus", thinkingLevel: "high", toolSets: ["coding"], templates: ["PROJECT_DIR"],
  spawn: { enabled: false },
  systemPromptTemplate: "You are a research engineer working alone in {{PROJECT_DIR}}. Always `cd` there before running commands. Finish the job yourself: write the code, run it, check it, and write the deliverables the request names.",
  maxTurns: turns,
});
const t0 = Date.now();
const rec: any = { model, dir, started: new Date().toISOString() };
try {
  const r = await spawnAgent({ name: "solo", prompt: readFileSync(join(dir, "PROMPT.txt"), "utf-8"), projectDir: dir, getApiKey, exactModel: model,
    parentAgentId: "bench", templateVars: { PROJECT_DIR: dir }, resolveDefinition: solo as any } as any);
  rec.stopReason = r.exit?.stopReason; rec.errorMessage = r.exit?.errorMessage; rec.toolCalls = r.exit?.toolCallCount;
  writeFileSync(join(dir, "agent_output.md"), r.output ?? "");
} catch (e: any) { rec.stopReason = "harness_error"; rec.errorMessage = String(e?.message ?? e).slice(0, 500); }
rec.elapsedMs = Date.now() - t0;
let calls = 0, input = 0, output = 0, cost = 0;
try { for (const l of readFileSync(join(dir, ".agent", "usage.log"), "utf-8").trim().split("\n")) { const p = l.split("\t"); if (p.length < 8) continue; calls++; input += +p[3] + +p[5] + +p[6]; output += +p[4]; cost += +p[7]; } } catch { /* never reached a model */ }
Object.assign(rec, { calls, input, output, cost });
writeFileSync(join(dir, "trial.json"), JSON.stringify(rec, null, 2));
console.log(JSON.stringify(rec));
