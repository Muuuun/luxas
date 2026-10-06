#!/usr/bin/env tsx
/**
 * smoke_solo_executor — LUXAS_EXPERIMENT_MODE=solo swaps the experiment's
 * EXECUTION (one strong agent instead of orchestrator + tool_impl + tool_review)
 * and nothing else: same agent name, same output contract, same review loop.
 * And an experiment that returns without results.json is sent back once before
 * any review money is spent.
 *
 *   npx tsx scripts/smoke_solo_executor.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro"; // the dual profile's producer
delete process.env.LUXAS_EXPERIMENT_MODE; delete process.env.LUXAS_EXECUTOR_MODEL;
process.env.LUXAS_BLIND_ESTIMATE = "0"; process.env.LUXAS_MAX_REVIEW_ITERATIONS = "0";

const { getDefinition, soloExperimentDefinition, SOLO_ROLE_BLOCK } = await import("../src/agents/registry.ts");
const { resolveModel } = await import("../src/agents/spawn.ts");
const { experimentDelivered, runExperimentReviewLoop } = await import("../src/tools/spawn-agent.ts");
const { buildSafetyWrapper } = await import("../src/agents/safety-wrappers.js");
const id = (m: any) => m?.id ?? m?.model?.id;

console.log("1. off: the orchestrated pipeline, unchanged");
const orch: any = getDefinition("experiment");
check("role_separation block present", /<role_separation strict="true">/.test(orch.systemPromptTemplate));
check("may spawn tool_impl and tool_review", ["tool_impl", "tool_review"].every((t) => orch.spawn.allowedTypes.includes(t)));
check("runs on the producer profile", id(resolveModel(orch.model, "experiment")) === "deepseek-v4-pro", id(resolveModel(orch.model, "experiment")));

console.log("\n2. on: one agent, same contract");
process.env.LUXAS_EXPERIMENT_MODE = "solo";
const solo: any = getDefinition("experiment");
check("still named experiment (the review loop, claims table and gates key on it)", solo.name === "experiment");
check("the orchestrator role block is replaced, not left beside the new one", !/<role_separation strict=/.test(solo.systemPromptTemplate) && !/You are an ORCHESTRATOR and INTEGRATOR/.test(solo.systemPromptTemplate) && solo.systemPromptTemplate.includes(SOLO_ROLE_BLOCK));
for (const anchor of ["Evidence Contract", "Acceptance criterion (frozen here", "computed.quantities", "cross_validation_plan", "premise_corrections", "notes/experiments.md"])
  check(`contract kept: "${anchor}"`, solo.systemPromptTemplate.includes(anchor));
check("cannot spawn tool_impl / tool_review", !solo.spawn.allowedTypes.includes("tool_impl") && !solo.spawn.allowedTypes.includes("tool_review"), solo.spawn.allowedTypes.join(","));
check("can still spawn ledger_writer and reader", ["ledger_writer", "reader"].every((t) => solo.spawn.allowedTypes.includes(t)));
check("the cached orchestrator definition was not mutated", (() => { delete process.env.LUXAS_EXPERIMENT_MODE; const again: any = getDefinition("experiment"); process.env.LUXAS_EXPERIMENT_MODE = "solo"; return /<role_separation/.test(again.systemPromptTemplate) && again.spawn.allowedTypes.includes("tool_impl") && again.safety.blockedBashWriteRoots.length === 2; })());
check("an experiment.md without the block is a hard error, not a silent orchestrator-without-helpers", (() => { try { soloExperimentDefinition({ ...orch, systemPromptTemplate: "no such block" }); return false; } catch (e: any) { return /role_separation/.test(String(e.message)); } })());

console.log("\n3. write permissions follow the role");
{
  const vars = { EXPERIMENT_ID: "E1_gate", PROJECT_DIR: "/p" };
  const expand = (s: any) => JSON.parse(JSON.stringify(s).replaceAll("{{EXPERIMENT_ID}}", vars.EXPERIMENT_ID));
  const tool = (name: string) => ({ name, execute: async () => ({ content: [{ type: "text", text: "WROTE" }] }) });
  const tryWrite = async (def: any, path: string) => {
    const [w] = buildSafetyWrapper(expand(def.safety))([tool("write")] as any, "/p") as any[];
    const r: any = await w.execute("c1", { path, content: "x" });
    return JSON.stringify(r).includes("WROTE");
  };
  check("solo: may write its own scripts/", await tryWrite(solo, "data/experiments/E1_gate/scripts/model.py"));
  check("solo: may write its own tests/", await tryWrite(solo, "data/experiments/E1_gate/tests/test_model.py"));
  check("solo: still cannot write RESEARCH.md", !(await tryWrite(solo, "RESEARCH.md")));
  check("solo: still cannot write another experiment's directory", !(await tryWrite(solo, "data/experiments/E2_other/scripts/x.py")));
  check("orchestrator: still cannot write scripts/ (that is tool_impl's job)", !(await tryWrite(orch, "data/experiments/E1_gate/scripts/model.py")));
}

console.log("\n4. routing");
const exec: any = resolveModel(solo.model, "experiment"), rep: any = resolveModel(getDefinition("replicator").model, "replicator");
check("the solo executor runs on claude-opus-5-5", id(exec) === "claude-opus-5-5", id(exec));
check("the blind replicator is a different vendor from the executor", !!rep?.provider && rep.provider !== exec.provider, `${rep?.provider} vs ${exec?.provider}`);
process.env.LUXAS_EXECUTOR_MODEL = "glm-5.3";
check("LUXAS_EXECUTOR_MODEL overrides", id(resolveModel(solo.model, "experiment")) === "glm-5.3");
delete process.env.LUXAS_EXECUTOR_MODEL;
check("tool_impl's own routing is untouched", id(resolveModel("opus", "tool_impl")) === "deepseek-v4-pro");

console.log("\n5. not delivered = sent back once, before any review");
const tmp = mkdtempSync(join(tmpdir(), "luxas-solo-gate-"));
const mk = (eid: string) => { const d = join(tmp, "data", "experiments", eid, "runs", "run_1"); mkdirSync(d, { recursive: true }); return join(d, "results.json"); };
check("no experiment directory → not delivered", !experimentDelivered(tmp, "E0_none"));
writeFileSync(mk("E1_torn"), "{ torn"); check("a torn results.json → not delivered", !experimentDelivered(tmp, "E1_torn"));
writeFileSync(mk("E2_list"), "[]"); check("a results.json that is not an object → not delivered", !experimentDelivered(tmp, "E2_list"));
writeFileSync(mk("E3_ok"), "{\"computed\":{}}"); check("an object → delivered", experimentDelivered(tmp, "E3_ok"));
async function loop(eid: string, onRespawn: () => void) {
  const prompts: string[] = [];
  const out: any = await runExperimentReviewLoop({ output: "first run", success: true }, {
    projectDir: tmp, mergedTemplateVars: { EXPERIMENT_ID: eid, PROJECT_DIR: tmp },
    baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: eid }, projectDir: tmp, getApiKey: () => undefined } as any,
    initialTask: "ORIGINAL TASK", getApiKey: () => undefined, makeSpawnTool: () => null,
    spawn: (async (o: any) => { prompts.push(o.prompt); onRespawn(); return { output: "second run", success: true }; }) as any,
  });
  return { prompts, out };
}
{
  mkdirSync(join(tmp, "data", "experiments", "E4_late", "runs"), { recursive: true });
  const r = await loop("E4_late", () => writeFileSync(mk("E4_late"), "{\"computed\":{}}"));
  check("returned without results.json → re-run exactly once", r.prompts.length === 1, `${r.prompts.length} spawns`);
  check("…told what is missing, to reuse its work, and given the original task", /Not delivered/.test(r.prompts[0] ?? "") && /Do not start over/.test(r.prompts[0] ?? "") && /ORIGINAL TASK/.test(r.prompts[0] ?? ""));
  check("…and once it delivers, the result goes on as normal", r.out.success && !/NOT DELIVERED/.test(r.out.output));
  const never = await loop("E5_never", () => {});
  check("still nothing after the retry → one retry, then reported as NOT DELIVERED", never.prompts.length === 1 && /NOT DELIVERED, not reviewed/.test(never.out.output), never.out.output.slice(-160));
  const fine = await loop("E3_ok", () => {});
  check("an experiment that delivered is not re-run", fine.prompts.length === 0, `${fine.prompts.length} spawns`);
}
rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
