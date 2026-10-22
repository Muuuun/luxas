#!/usr/bin/env tsx
/**
 * smoke_solo_executor — LUXAS_EXPERIMENT_MODE=solo swaps the experiment's
 * EXECUTION (one strong agent instead of orchestrator + tool_impl + tool_review)
 * and nothing else: same agent name, same output contract, same review loop.
 * And an experiment that returns without results.json is sent back once before
 * any review money is spent. §6: scripts/solo_trial.mts, the harness that
 * measures this executor against claude -p (C64), refuses an unfair pair.
 *
 *   npx tsx scripts/smoke_solo_executor.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

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
// [C43] Nobody independent writes the solo executor's tests, so the tests it
// writes cannot be what clears its own completion gate (<solo_mode> already calls
// them hygiene, not evidence). The pipeline keeps tool_review's tests as evidence.
{
  const BULLET_RE = /^- \*\*Passing tests\*\*[^\n]*$/m, STATUS = "all tools pass pytest, results.json exists";
  const gateBlock = (s: string) => s.match(/<evidence_completion_gate strict="true">[\s\S]*?<\/evidence_completion_gate>/)?.[0] ?? "";
  const soloGate = gateBlock(solo.systemPromptTemplate), orchGate = gateBlock(orch.systemPromptTemplate);
  const xval = (s: string) => (s.match(/cross_validation/g) ?? []).length;
  check("[C43] solo: the completion gate asks for an executed computation, not passing tests", !!soloGate && !/Passing tests/.test(soloGate) && soloGate.includes("executed computation"), soloGate ? (soloGate.match(/^- \*\*[^*]+\*\*/gm) ?? []).join(" | ") : "no gate block");
  check("[C43] solo: the Status line does not make pytest the completion signal", !/pass pytest/.test(solo.systemPromptTemplate));
  check("[C43] off: the pipeline's gate bullet and Status line are unchanged", /Passing tests/.test(orchGate) && orch.systemPromptTemplate.includes(STATUS));
  check("[C43] solo: no cross_validation obligation is added to the gate", xval(soloGate) === xval(orchGate), `${xval(soloGate)} vs ${xval(orchGate)}`);
  const drifted = (template: string, names: RegExp) => { try { soloExperimentDefinition({ ...orch, systemPromptTemplate: template }); return false; } catch (e: any) { return names.test(String(e.message)); } };
  check("[C43] a moved 'Passing tests' bullet is a hard error naming it", drifted(orch.systemPromptTemplate.replace(BULLET_RE, ""), /Passing tests/));
  check("[C43] a moved Status phrase is a hard error naming it", drifted(orch.systemPromptTemplate.replace(STATUS, ""), /all tools pass pytest/));
}

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

console.log("\n5b. declarations fixed in place, once, before any review (step 0, 2026-10-22)");
// blender-02 run 2: E1's results.json (written by a python script, so the
// write-time hook never saw it) had an array key and an object key; the brain
// paid a whole re-run ($4.5) to fix them. The producer fixes them in place.
{
  const saved = { b: process.env.LUXAS_BLIND_ESTIMATE, i: process.env.LUXAS_REVIEW_IMAGES };
  process.env.LUXAS_BLIND_ESTIMATE = "0"; process.env.LUXAS_REVIEW_IMAGES = "0";
  const declared = (eid: string, key: string, extra = "") =>
    writeFileSync(mk(eid), `{"computed":{"edge":[2,2,2],"edge_x":2.0,"rate":NaN,${extra}"quantities":[{"id":"box_edge","key":"${key}","observable":"edge length, m","uncertainty":0}]}}`);
  async function declLoop(eid: string, fix: () => void, opts: { outside?: boolean } = {}) {
    const names: string[] = [], prompts: string[] = [];
    const out: any = await runExperimentReviewLoop({ output: "FIRST RUN SUMMARY", success: true }, {
      projectDir: tmp, mergedTemplateVars: { EXPERIMENT_ID: eid, PROJECT_DIR: tmp },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: eid }, projectDir: tmp, getApiKey: () => undefined } as any,
      initialTask: "ORIGINAL TASK", getApiKey: () => undefined, makeSpawnTool: () => null, executorOutside: opts.outside,
      spawn: (async (o: any) => {
        names.push(o.name); prompts.push(o.prompt);
        if (o.name === "experiment") { fix(); return { output: "fixed the keys", success: true }; }
        return { output: "REVIEW-COMPLETE\nVERDICT: satisfied", success: true };
      }) as any,
    });
    return { names, prompts, out };
  }
  const tmpDecl = tmp;
  declared("E6_array", "computed.edge");
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "1"; // one reviewer round, to see the order
  const a = await declLoop("E6_array", () => declared("E6_array", "computed.edge_x"));
  process.env.LUXAS_MAX_REVIEW_ITERATIONS = "0"; // the rest: no review round, so the note must travel on its own
  const sent = a.prompts.filter((p) => /Declarations to fix in place/.test(p));
  check("an array key → sent back to the producer exactly once, before the reviewer", sent.length === 1 && a.names[0] === "experiment" && a.names.includes("experiment_reviewer"), a.names.join(","));
  check("…told the problem, bookkeeping only, and given the original task", /is not a finite number/.test(sent[0] ?? "") && /Do NOT recompute/.test(sent[0] ?? "") && /ORIGINAL TASK/.test(sent[0] ?? ""), (sent[0] ?? "").slice(0, 200));
  check("…the experiment's own summary is what the brain gets, with a note that it was fixed", /^FIRST RUN SUMMARY/.test(a.out.output) && /declaration problem\(s\) fixed in place by the producer before review/.test(a.out.output), a.out.output.slice(-300));
  declared("E7_stuck", "computed.edge");
  const b = await declLoop("E7_stuck", () => {});
  check("not fixed after the one send-back → no second send-back; the brain is told what is open", b.names.filter((n) => n === "experiment").length === 1 && /still open: E7: quantities\[0\]/.test(b.out.output), b.out.output.slice(-300));
  declared("E8_nan", "computed.rate");
  const c = await declLoop("E8_nan", () => {});
  check("a key whose leaf is NaN is a failed computation, not bookkeeping → not sent back", !c.names.includes("experiment"), c.names.join(","));
  declared("E9_hand", "computed.edge");
  const d = await declLoop("E9_hand", () => {}, { outside: true });
  check("executorOutside (review_experiment.mts) → nothing sent back, no experiment spawned", !d.names.includes("experiment"), d.names.join(","));
  mkdirSync(join(tmpDecl, ".agent"), { recursive: true });
  writeFileSync(join(tmpDecl, ".agent/run_config.json"), JSON.stringify({ maxCost: 100 }));
  writeFileSync(join(tmpDecl, ".agent/usage.log"), "1788000000000\tm\tp\t1\t1\t0\t0\t95\n");
  const { setCostCap } = await import("../src/usage-log.ts");
  setCostCap(join(tmpDecl, ".agent/usage.log"), 100);
  declared("E10_late", "computed.edge");
  const e = await declLoop("E10_late", () => {});
  setCostCap(join(tmpDecl, ".agent/usage.log"), undefined);
  check("past the 90% freeze → not sent back, and the note says why", !e.names.includes("experiment") && /not sent back — past the 90% cost freeze/.test(e.out.output), e.out.output.slice(-300));
  for (const [k, v] of [["LUXAS_BLIND_ESTIMATE", saved.b], ["LUXAS_REVIEW_IMAGES", saved.i]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
rmSync(tmp, { recursive: true, force: true });

console.log("\n6. [C64] solo_trial: a recorded, refusable two-arm harness");
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const TRIAL = join(ROOT, "scripts", "solo_trial.mts"), TSX = join(ROOT, "node_modules", ".bin", "tsx");
  // A namespace import: before C64 the module ran its main on import (and threw on the missing --dir).
  let T: any = {}, importErr = "";
  try { T = await import("./solo_trial.mts"); } catch (e: any) { importErr = String(e?.code ?? e?.message ?? e).slice(0, 120); }
  check("importing solo_trial runs nothing (main is behind the argv guard)", !importErr, importErr);
  const fn = (k: string) => (...a: any[]) => { try { return typeof T[k] === "function" ? T[k](...a) : undefined; } catch { return undefined; } };
  const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
  const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } };
  const root = mkdtempSync(join(tmpdir(), "luxas-c64-gate-"));
  const PROMPT = "Read TASK.md. It's all there: `results.json` and REPORT.md, no $HOME paths.\n";
  const task = (name: string, extra: (d: string) => void = () => {}) => {
    const d = join(root, name); mkdirSync(join(d, "refs"), { recursive: true });
    writeFileSync(join(d, "TASK.md"), "Do X.\n"); writeFileSync(join(d, "PROMPT.txt"), PROMPT); extra(d); return d;
  };
  const cli = (args: string[]) => spawnSync(TSX, [TRIAL, ...args], { encoding: "utf-8", timeout: 60_000 });
  const child = (name: string, body: string) => {
    const script = join(root, `${name}.mts`);
    writeFileSync(script, `import { mkdirSync } from "node:fs";\nconst T = await import(${JSON.stringify(TRIAL)});\nconst U = await import(${JSON.stringify(join(ROOT, "src", "usage-log.ts"))});\n${body}\n`);
    return spawnSync(TSX, [script], { encoding: "utf-8", timeout: 60_000 });
  };

  // (1) Only task inputs: a dir an earlier arm worked in starts the next arm with its outputs.
  const fresh = fn("freshDirProblems");
  const clean = task("clean");
  check("fresh: TASK.md + PROMPT.txt + refs/ passes", JSON.stringify(fresh(clean)) === "[]", JSON.stringify(fresh(clean)));
  for (const [what, mk] of [
    ["results.json", (d: string) => writeFileSync(join(d, "results.json"), "{}")],
    ["REPORT.md", (d: string) => writeFileSync(join(d, "REPORT.md"), "# done")],
    ["scripts", (d: string) => mkdirSync(join(d, "scripts"))],
    [".agent/usage.log", (d: string) => { mkdirSync(join(d, ".agent")); writeFileSync(join(d, ".agent", "usage.log"), "1\tm\tp\t1\t1\t0\t0\t9.99\n"); }],
  ] as const) {
    const p = fresh(task(`used-${what.replace(/\W/g, "")}`, mk));
    check(`fresh: a dir holding ${what} is refused`, Array.isArray(p) && p.some((x: string) => x.includes(what)), JSON.stringify(p));
  }
  check("fresh: a dir without PROMPT.txt is refused", (fresh(task("noprompt", (d) => rmSync(join(d, "PROMPT.txt")))) ?? []).some((x: string) => x.includes("PROMPT.txt")));
  check("fresh: --print-cc's own record does not make a dir used", JSON.stringify(fresh(task("armed", (d) => { mkdirSync(join(d, ".agent")); writeFileSync(join(d, ".agent", "cc_arm.json"), "{}"); }))) === "[]");
  // An unknown model cannot reach a provider: if a refusal below regressed, the child dies on resolveModelExact, not on a bill.
  const used = cli(["--dir", join(root, "used-resultsjson"), "--model", "no-such-model", "--cap", "1"]);
  check("CLI: a used dir is refused with exit 2, naming what is there", used.status === 2 && /results\.json/.test(used.stderr), `exit ${used.status}: ${used.stderr.slice(-160)}`);
  const nocap = cli(["--dir", task("nocap"), "--model", "no-such-model"]);
  check("CLI: --cap is required (no silent $3)", nocap.status === 2 && /--cap/.test(nocap.stderr), `exit ${nocap.status}: ${nocap.stderr.slice(-160)}`);
  const parsed = fn("parseTrialArgs")(["--dir", clean, "--model", "claude-opus-5-5", "--cap", "9"]);
  check("defaults: --thinking high (today's value), --turns 400", parsed?.thinking === "high" && parsed?.turns === 400 && parsed?.cap === 9, JSON.stringify(parsed));

  // (2) What the arm ran under is on record, not reconstructed afterwards.
  const rec = fn("newTrialRecord")(clean, { arm: "solo", model: "claude-opus-5-5", thinking: "medium", cap: 9, turns: 400, systemPrompt: "SYSTEM" });
  check("record: thinking, cap and turns as given", rec?.thinking === "medium" && rec?.cap === 9 && rec?.turns === 400, JSON.stringify(rec));
  check("record: the Luxas commit and a dirty flag", /^[0-9a-f]{40}$/.test(rec?.commit ?? "") && typeof rec?.dirty === "boolean");
  check("record: sha256 of the PROMPT.txt bytes and of the system prompt", rec?.promptSha === sha(readFileSync(join(clean, "PROMPT.txt"))) && rec?.systemSha === sha("SYSTEM"));
  check("record: the fresh check it passed", JSON.stringify(rec?.fresh) === "[]");
  const def = fn("soloDefinition")("medium", 400);
  check("--thinking becomes the definition's thinkingLevel, --turns its maxTurns", def?.thinkingLevel === "medium" && def?.maxTurns === 400);

  // (3) The claude -p arm: same prompt bytes, effort and cap.
  const cc: string[] = fn("ccArmArgs")(PROMPT, { thinking: "high", cap: 9 }) ?? [];
  const after = (f: string) => cc.includes(f) ? cc[cc.indexOf(f) + 1] : undefined;
  check("cc: -p carries the PROMPT.txt bytes with no preamble", cc[0] === "-p" && cc[1] === PROMPT);
  check("cc: --model claude-opus-5-5, --effort and --max-budget-usd from the solo arm's settings", after("--model") === "claude-opus-5-5" && after("--effort") === "high" && after("--max-budget-usd") === "9", cc.slice(2).join(" "));
  check("cc: stream-json + --verbose, acceptEdits, no MCP, the six tools", after("--output-format") === "stream-json" && cc.includes("--verbose") && after("--permission-mode") === "acceptEdits" && cc.includes("--strict-mcp-config") && cc.slice(cc.indexOf("--allowedTools") + 1).join(" ") === "Bash Read Write Edit Glob Grep");
  const sh = spawnSync("/bin/sh", ["-c", `set -- ${fn("shellCommand")(cc) ?? ""}; printf %s "$2"`], { encoding: "utf-8" });
  check("cc: the printed command gives the shell the same prompt bytes", sh.stdout === PROMPT, JSON.stringify(sh.stdout.slice(0, 60)));

  // (4) The usage tracker ends a trial with process.exit; trial.json must survive it.
  const killed = task("capkill"), klog = join(killed, ".agent", "usage.log");
  const k = child("capkill", [
    `const rec = T.newTrialRecord(${JSON.stringify(killed)}, { arm: "solo", model: "claude-opus-5-5", thinking: "high", cap: 1, turns: 400 });`,
    `mkdirSync(${JSON.stringify(join(killed, ".agent"))}, { recursive: true }); U.setCostCap(${JSON.stringify(klog)}, 1);`,
    `T.armTrialRecord(${JSON.stringify(killed)}, rec);`,
    `U.appendUsage(${JSON.stringify(klog)}, { timestamp: Date.now(), model: "claude-opus-5-5", provider: "anthropic", input: 3, output: 5, cacheRead: 7, cacheWrite: 11, cost: 2.5 });`,
    `U.enforceCostCap(${JSON.stringify(klog)});`, `console.log("SURVIVED");`,
  ].join("\n"));
  const kt = readJson(join(killed, "trial.json"));
  check("cap kill: the real enforceCostCap exits 1", k.status === 1 && /Cost limit exceeded/.test(k.stderr) && !/SURVIVED/.test(k.stdout), `exit ${k.status}: ${k.stderr.slice(-160)}`);
  check("cap kill: trial.json is still written, stopReason budget_exhausted", kt?.stopReason === "budget_exhausted", JSON.stringify(kt));
  check("cap kill: …with the usage.log totals by class", kt?.cost === 2.5 && kt?.calls === 1 && JSON.stringify(kt?.tokens) === JSON.stringify({ input: 3, output: 5, cacheRead: 7, cacheWrite: 11 }), JSON.stringify(kt?.tokens));
  const broke = task("unfunded"), blog = join(broke, ".agent", "usage.log");
  child("unfunded", [
    `const rec = T.newTrialRecord(${JSON.stringify(broke)}, { arm: "solo", model: "claude-opus-5-5", thinking: "high", cap: 1, turns: 400 });`,
    `mkdirSync(${JSON.stringify(join(broke, ".agent"))}, { recursive: true }); T.armTrialRecord(${JSON.stringify(broke)}, rec);`,
    `U.writeUnfundedSentinel(${JSON.stringify(blog)}, "anthropic", "Your credit balance is too low"); process.exit(1);`,
  ].join("\n"));
  const bt = readJson(join(broke, "trial.json"));
  check("unfunded exit: trial.json says provider_unfunded and is marked aborted", bt?.stopReason === "provider_unfunded" && /credit balance/.test(bt?.aborted ?? ""), JSON.stringify(bt));

  // (5) A pair is compared only when nothing but the arm differs.
  const pair = fn("pairProblems");
  const tokens = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
  const a = { arm: "solo", model: "claude-opus-5-5", thinking: "high", cap: 9, promptSha: "a".repeat(64), fresh: [], tokens, cost: 1, elapsedMs: 60_000, delivered: true };
  const b = { ...a, arm: "claude-p", cost: 3 };
  check("pair: matched arms pass", JSON.stringify(pair(a, b)) === "[]", JSON.stringify(pair(a, b)));
  for (const [label, patch] of [["effort", { thinking: "xhigh" }], ["cap", { cap: 5 }], ["PROMPT.txt", { promptSha: "b".repeat(64) }], ["model", { model: "claude-fable-5-1" }]] as const)
    check(`pair: refused when the ${label} differs`, (pair(a, { ...b, ...patch }) ?? []).some((x: string) => x.includes(label)), JSON.stringify(pair(a, { ...b, ...patch })));
  check("pair: refused when a dir failed the fresh check, or has none on record", (pair(a, { ...b, fresh: ["results.json"] }) ?? []).length > 0 && (pair({ ...a, fresh: undefined }, b) ?? []).length > 0);
  check("pair: an arm the provider aborted is not a measurement", (pair(a, { ...b, aborted: "Credit balance is too low" }) ?? []).length > 0);
  check("pair: costs repriced from token counts with one table (billed $1 vs $3, same tokens → 1.00x)", (fn("pairReport")(a, b, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }) ?? []).some((l: string) => /\$29\.20/.test(l)) && (fn("pairReport")(a, b, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }) ?? []).some((l: string) => /1\.00x/.test(l)));

  // (6) Delivered = a results.json object and a non-empty REPORT.md, in the task dir itself.
  const flat = fn("deliveredFlat");
  const out = (name: string, results: string | null, report: string | null) => task(name, (d) => { if (results !== null) writeFileSync(join(d, "results.json"), results); if (report !== null) writeFileSync(join(d, "REPORT.md"), report); });
  check("delivered: a torn results.json is not", flat(out("torn", "{ torn", "# r")) === false);
  check("delivered: a results.json that is not an object is not", flat(out("list", "[]", "# r")) === false);
  check("delivered: an empty REPORT.md is not", flat(out("emptyreport", "{}", "  \n")) === false);
  check("delivered: an object and a report are", flat(out("ok", "{\"x\":1}", "# r")) === true);

  // (9) --ingest-cc: the same record from the stream-json result line; a provider abort is not a success.
  const pre = { arm: "claude-p", model: "claude-opus-5-5", thinking: "high", cap: 9, promptSha: "a".repeat(64), fresh: [] };
  const result = (o: object) => [JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5-5" }), "{ not json", JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 60_000, num_turns: 12, total_cost_usd: 1.5,
    modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40, costUSD: 1.4 }, "claude-haiku-4-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.1 } }, ...o })].join("\n");
  const ing = fn("ccTrialRecord")(pre, result({}), out("ingested", "{}", "# r"));
  check("ingest: stop reason, wall time, billed cost, tokens by class across models", ing?.stopReason === "success" && !ing?.aborted && ing?.elapsedMs === 60_000 && ing?.cost === 1.5 && ing?.calls === 12 && JSON.stringify(ing?.tokens) === JSON.stringify({ input: 11, output: 22, cacheRead: 30, cacheWrite: 40, cacheWrite1h: 0 }) && ing?.delivered === true, JSON.stringify(ing));
  const abortedCc = fn("ccTrialRecord")(pre, result({ is_error: true, terminal_reason: "api_error", result: "Credit balance is too low" }), clean);
  check("ingest: a provider abort reported as subtype success is error:api_error, aborted", abortedCc?.stopReason === "error:api_error" && /Credit balance/.test(abortedCc?.aborted ?? ""), JSON.stringify(abortedCc));
  // The CLI can report the abort with result: "" — an empty reason must still mark the run aborted, or it is paired as a measurement.
  const abortedEmpty = fn("ccTrialRecord")(pre, result({ is_error: true, terminal_reason: "api_error", result: "" }), clean);
  check("ingest: a provider abort with an empty result string is still aborted", !!abortedEmpty?.aborted && (pair(a, { ...b, ...abortedEmpty }) ?? []).some((x: string) => /aborted by the provider/.test(x)), JSON.stringify(abortedEmpty));
  const torn = fn("ccTrialRecord")(pre, "{\"type\":\"system\"}\n", clean);
  check("ingest: a transcript with no result line is not a success", !!torn && torn.stopReason !== "success", JSON.stringify(torn));
  check("ingest: 1-hour cache writes (TTL not pinned) make the pair refuse", (pair(a, fn("ccTrialRecord")(pre, result({ usage: { cache_creation: { ephemeral_1h_input_tokens: 500 } } }), clean) ?? {}) ?? []).some((x: string) => /1-hour/.test(x)));
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
