#!/usr/bin/env tsx
/**
 * model_bench — which model should each Luxas role run on?
 *
 * Every trial runs the REAL agent definition, with its real tools, through the
 * real provider stack (spawnAgent + usage-log). The only difference from
 * production is `exactModel`, which bypasses routing, so each candidate sees
 * the same prompt. Scoring is against ground truth wherever one exists:
 *
 *   tool_review  mutation testing. The contestant writes tests from a real tool
 *                description; the tests must pass the reference implementation
 *                and should fail seeded mutants (the bug classes the corpus
 *                shipped: air/vacuum, g_u/g_l, units, autoionizing energies…).
 *   auditor      recall/precision on labelled defects of a finished run
 *                (notes/backtest-2026-09-24/). A fixed judge matches findings
 *                to labels; the judge's cost is logged separately.
 *   brain        RESEARCH.md → pipeline design, judged on oracle traps
 *                (bench-02: the perturbative C6(θ=0) artefact, fake legs,
 *                V ≡ ħΩ by construction…).
 *
 * A second question on the same items (2026-10-05): **does the Luxas
 * definition add anything over the bare model?** `--arms luxas,bare` runs each
 * model twice — once with the role's real definition, once with a
 * two-sentence prompt and the SAME tools, sandbox, task text and scorer. The
 * report then pairs the arms item by item (each mutant, each labelled defect,
 * each trap question). That is the only harness-vs-no-harness number this
 * project has; public leaderboards can rank models but none of them ran Luxas.
 * With both arms on one model, a same-family judge biases both equally.
 *
 * Each trial is a child process with its own sandbox and usage.log, so the
 * provider wrapper's cost accounting is exact per trial and a cost cap
 * (--cap, default $5) kills a runaway trial, not the sweep.
 *
 * Usage:
 *   npx tsx scripts/model_bench.mts validate
 *   npx tsx scripts/model_bench.mts run --role tool_review --models glm-5.3,anthropic/claude-opus-5 [--task kurucz_parse] [--reps 1] [--cap 5] [--judge kimi-k3] [--arms luxas,bare]
 *   npx tsx scripts/model_bench.mts report [--role R]
 *   npx tsx scripts/model_bench.mts rescore --sandbox <run dir> [--judge M]   # judge failed, agent work is fine
 *
 * Results append to ~/.sisyphus/model-bench/results.jsonl; sandboxes live in
 * ~/.sisyphus/model-bench/runs/. Fixtures: fixtures/model-bench/. Snapshots of
 * finished runs (auditor role) are fetched once into
 * ~/.sisyphus/model-bench/snapshots/<task>.tgz (see fixtures/model-bench/README.md).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "model-bench");
const HOME = join(homedir(), ".sisyphus", "model-bench");
const RESULTS = process.env.LUXAS_MODEL_BENCH_RESULTS || join(HOME, "results.jsonl");

export const ARMS = ["luxas", "bare"] as const;
export type Arm = (typeof ARMS)[number];

/**
 * The bare arm's whole system prompt. It states the deliverable (where the
 * output goes, so the same scorer can read it) and nothing about method —
 * method is what the Luxas definition claims to add.
 */
export const BARE_PROMPT: Record<string, string> = {
  tool_review: "You are a software engineer. Write pytest tests for the tool described in the task and save them where the task says. When the test file is written, call finish.",
  auditor: "You are a physicist. The working directory {{PROJECT_DIR}} holds a finished research project with a report under report/. Review it and find what is wrong with it. Write your findings to .audit/findings.md as a numbered list, then call finish.",
  brain: "You are a physicist planning a research project. You have no tools and no literature: answer in one message.",
};

type Role = "tool_review" | "auditor" | "brain";
const DEFAULT_TASK: Record<Role, string> = { tool_review: "kurucz_parse", auditor: "297nm", brain: "bench-02" };

function args(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1] ?? ""; i++; }
  return o;
}
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

async function registerBenchModels() {
  const { registerBenchModel } = await import("../src/agents/spawn.ts");
  const j = JSON.parse(readFileSync(join(FIX, "models.json"), "utf-8"));
  for (const [k, v] of Object.entries(j)) if (!k.startsWith("_")) registerBenchModel(k, v as any);
}

// ── sandboxes ────────────────────────────────────────────────────────────────

const BENCH_EID = "E_bench";

function prepareSandbox(role: Role, task: string, dir: string) {
  mkdirSync(join(dir, ".agent"), { recursive: true });
  if (role === "tool_review") {
    const e = join(dir, "data", "experiments", BENCH_EID);
    mkdirSync(join(e, "scripts"), { recursive: true });
    mkdirSync(join(e, "tests"), { recursive: true });
    copyFileSync(join(FIX, "tool_review", task, "stub.py"), join(e, "scripts", `${task}.py`));
  } else if (role === "auditor") {
    const tgz = join(HOME, "snapshots", `${task}.tgz`);
    if (!existsSync(tgz)) throw new Error(`missing snapshot ${tgz} — see fixtures/model-bench/README.md`);
    const r = spawnSync("tar", ["xzf", tgz, "-C", dir], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`untar ${tgz}: ${r.stderr}`);
    mkdirSync(join(dir, ".audit"), { recursive: true });
  }
}

// ── trial (child process) ────────────────────────────────────────────────────

async function trial(o: Record<string, string>) {
  const role = o.role as Role, model = o.model, task = o.task, dir = o.sandbox;
  const arm: Arm = o.arm === "bare" ? "bare" : "luxas";
  process.env.LUXAS_PROJECT_DIR = dir;
  const { installUsageTracking } = await import("../src/usage-log.ts");
  installUsageTracking(join(dir, ".agent", "usage.log"), { maxCostUsd: Number(o.cap || 5) });
  await registerBenchModels();
  const { spawnAgent, resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getDefinition } = await import("../src/agents/registry.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const t0 = Date.now();
  const rec: any = { role, model, task, arm, started: new Date().toISOString() };
  try {
    resolveModelExact(model); // fail fast on an unknown id
    // Every bench agent gets the `finish` exit tool and a turn cap. Anthropic
    // models are sent tool_choice "any" on every turn (pickRequireToolChoice),
    // so a definition without `exit` could not end its loop on them; that is
    // a routing/config fact, not model quality, and would swamp the signal.
    const benchDef = (name: string) => {
      const d = name === "adversarial_auditor" ? auditorDefinition() : getDefinition(name);
      // bare arm: same tools, safety, model tier and turn cap — only the prompt
      // (and any injected context) is replaced.
      const prompt = arm === "bare" ? { systemPromptTemplate: BARE_PROMPT[role], contextBuilder: undefined } : {};
      return { ...d, ...prompt, toolSets: d.toolSets.includes("exit") ? d.toolSets : [...d.toolSets, "exit"], maxTurns: d.maxTurns ?? 80 };
    };
    if (role === "brain") {
      const { completeSimple } = await import("@earendil-works/pi-ai/compat");
      const m: any = resolveModelExact(model);
      const { system, user } = brainPrompt(task, arm);
      const res: any = await completeSimple(m, {
        systemPrompt: system,
        messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
        tools: [],
      }, {
        maxTokens: Math.min(64000, m.maxTokens ?? 64000), apiKey: await getApiKey(m.provider),
        // glm-5.3 cannot think "off" (400 code 1210: use low, high or max), and
        // no reasoning option is sent as "off". Other providers keep the call
        // shape the earlier rows were measured with.
        ...(m.provider === "glm" ? { reasoning: "high" } : {}),
      } as any);
      const text = (res?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
      writeFileSync(join(dir, "design.md"), text);
      rec.stopReason = res?.stopReason; rec.errorMessage = res?.errorMessage; rec.outputChars = text.length;
    } else {
      const name = role === "auditor" ? "adversarial_auditor" : "tool_review";
      const prompt = role === "auditor"
        ? "Audit this finished research run per your instructions. Write .audit/findings.md, then call finish."
        : readFileSync(join(FIX, "tool_review", task, "task.md"), "utf-8").replaceAll("{{EXPERIMENT_ID}}", BENCH_EID);
      const r = await spawnAgent({
        name, prompt, projectDir: dir, getApiKey, exactModel: model, parentAgentId: "bench",
        templateVars: { PROJECT_DIR: dir, EXPERIMENT_ID: BENCH_EID, TOOL_NAME: task },
        resolveDefinition: benchDef as any,
      });
      rec.stopReason = r.exit?.stopReason; rec.errorMessage = r.exit?.errorMessage; rec.toolCalls = r.exit?.toolCallCount;
      writeFileSync(join(dir, "agent_output.md"), r.output ?? "");
    }
  } catch (e: any) {
    rec.stopReason = "harness_error"; rec.errorMessage = String(e?.message ?? e).slice(0, 500);
  }
  rec.elapsedMs = Date.now() - t0;
  writeFileSync(join(dir, "trial.json"), JSON.stringify(rec, null, 2));
}

function auditorDefinition() {
  return {
    name: "adversarial_auditor",
    description: "Bench-only: adversarial audit of a finished run (notes/backtest-2026-09-24/blind-auditor).",
    model: "opus", thinkingLevel: "high", toolSets: ["coding"], templates: ["PROJECT_DIR"],
    spawn: { enabled: false },
    safety: { allowedWriteRoots: [".audit/"] },
    systemPromptTemplate: readFileSync(join(FIX, "auditor", "definition.md"), "utf-8"),
    maxTurns: 80,
  };
}

function brainPrompt(task: string, arm: Arm = "luxas") {
  const traps = JSON.parse(readFileSync(join(FIX, "brain", task, "traps.json"), "utf-8"));
  const brain = readFileSync(join(ROOT, "src", "agents", "definitions", "brain.md"), "utf-8");
  const section = (tag: string) => (brain.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) ?? [""])[0];
  const system = arm === "bare" ? BARE_PROMPT.brain : [
    "You are the brain of Luxas, an autonomous physics research system. You decompose a research request into experiments that other agents will run. Methodology excerpts from your production prompt follow.",
    section("framing_phase"), section("decomposition"), section("claim_status_dispatch"),
    "For this task you have no tools and no literature: produce the full pipeline design in one answer.",
  ].join("\n\n");
  const user = readFileSync(join(ROOT, traps.research), "utf-8") + `

---
Produce the pipeline design as Markdown:
1. **Frame**: question type(s), deliverable object, headline quantity ids, premises.
2. **Experiment chain**: for each experiment give Question / Approach / Leg A / Leg B (the independent cross-check) / Discriminator / Falsifier / Stop-kill criterion / Figure candidate.
3. **E1 tool decomposition**: each tool's input signature and output semantics.
4. **Three traps** specific to this problem that could make the answer wrong while every check passes.`;
  return { system, user };
}

// ── scoring (parent) ─────────────────────────────────────────────────────────

function pytest(dir: string, testFile: string) {
  rmSync(join(dir, "data", "experiments", BENCH_EID, "scripts", "__pycache__"), { recursive: true, force: true });
  const r = spawnSync("python3", ["-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", testFile], {
    cwd: join(dir, "data", "experiments", BENCH_EID), encoding: "utf-8", timeout: 180_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return { ok: r.status === 0, tail: (r.stdout + r.stderr).split("\n").slice(-6).join("\n") };
}

function scoreToolReview(task: string, dir: string) {
  const tests = join(dir, "data", "experiments", BENCH_EID, "tests");
  const files = existsSync(tests) ? readdirSync(tests).filter((f) => /^test_.*\.py$/.test(f)) : [];
  if (!files.length) return { score: 0, note: "no test file written" };
  const target = join(dir, "data", "experiments", BENCH_EID, "scripts", `${task}.py`);
  const src = join(FIX, "tool_review", task);
  copyFileSync(join(src, "reference.py"), target);
  const ref = pytest(dir, "tests");
  if (!ref.ok) return { score: 0, passes_reference: false, note: "tests FAIL the reference implementation", tail: ref.tail };
  const killed: string[] = [], survived: string[] = [];
  for (const m of readdirSync(join(src, "mutants")).sort()) {
    copyFileSync(join(src, "mutants", m), target);
    (pytest(dir, "tests").ok ? survived : killed).push(m.replace(/\.py$/, ""));
  }
  copyFileSync(join(src, "reference.py"), target);
  const n = killed.length + survived.length;
  const items = Object.fromEntries([...killed.map((m) => [m, 1]), ...survived.map((m) => [m, 0])]);
  return { score: killed.length / n, passes_reference: true, killed: killed.length, mutants: n, survived, items };
}

async function judge(judgeModel: string, system: string, user: string, _logDir: string) {
  // The parent process only ever judges, so one process-wide judge log (the
  // provider wrapper installs once) and a before/after delta per call keep
  // judge spend out of the contestant's usage.log.
  const { installUsageTracking, readUsageTotals } = await import("../src/usage-log.ts");
  const log = join(HOME, "judge-usage.log");
  installUsageTracking(log);
  const before = readUsageTotals(log).cost;
  await registerBenchModels();
  const { resolveModelExact } = await import("../src/agents/spawn.ts");
  const { getApiKey } = await import("../src/auth.ts");
  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
  const m: any = resolveModelExact(judgeModel);
  const res: any = await completeSimple(m, {
    systemPrompt: system, messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }], tools: [],
  }, { maxTokens: 32000, apiKey: await getApiKey(m.provider) } as any);
  const text = (res?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error(`judge returned no JSON (stopReason=${res?.stopReason} ${res?.errorMessage ?? ""})`);
  return { parsed: JSON.parse(json[0]), cost: readUsageTotals(log).cost - before };
}

const credit = (v: unknown) => { const s = String(v ?? "").toUpperCase(); return s === "FOUND" || s === "YES" ? 1 : s === "PARTIAL" ? 0.5 : 0; };

async function scoreAuditor(task: string, dir: string, judgeModel: string) {
  const f = join(dir, ".audit", "findings.md");
  if (!existsSync(f)) return { score: 0, note: "no .audit/findings.md" };
  const labels = JSON.parse(readFileSync(join(FIX, "auditor", task, "labels.json"), "utf-8"));
  const system = "You score an audit of a physics research run against a list of known, verified defects. Be literal and strict: a finding matches a defect only if it identifies the same error by the same mechanism. Reply with JSON only.";
  const user = `KNOWN DEFECTS (id, weight, text):\n${labels.defects.map((d: any) => `- ${d.id} (w${d.weight}): ${d.text}`).join("\n")}\n\nKNOWN UNVERIFIABLE CLAIMS:\n${labels.unverifiable.map((u: string) => `- ${u}`).join("\n")}\n\nKNOWN FALSE CLAIMS:\n${(labels.known_false ?? []).map((u: string) => `- ${u}`).join("\n") || "(none)"}\n\nAUDIT TO SCORE:\n${readFileSync(f, "utf-8").slice(0, 60000)}\n\nReturn JSON: {"defects": {"<id>": "FOUND"|"PARTIAL"|"MISSED", ...}, "findings": [{"id": "F1", "match": "<defect id>"|"UNVERIFIABLE"|"FALSE"|"UNMATCHED", "severity": "BREAKS"|"WEAKENS"|"MINOR"}]}`;
  const { parsed, cost } = await judge(judgeModel, system, user, dir);
  let got = 0, total = 0, headlineGot = 0, headlineTotal = 0;
  for (const d of labels.defects) {
    const v = parsed.defects?.[d.id] ?? "MISSED";
    const c = v === "FOUND" ? 1 : v === "PARTIAL" ? 0.5 : 0;
    got += c * d.weight; total += d.weight;
    if (d.weight >= 3) { headlineGot += c; headlineTotal++; }
  }
  const findings = parsed.findings ?? [];
  const count = (k: string) => findings.filter((x: any) => x.match === k).length;
  return {
    score: got / total, weighted_recall: got / total, headline_recall: headlineGot / headlineTotal,
    findings: findings.length, false: count("FALSE"), unmatched: count("UNMATCHED"), unverifiable: count("UNVERIFIABLE"),
    per_defect: parsed.defects, judge: judgeModel, judge_cost: cost,
    items: Object.fromEntries(labels.defects.map((d: any) => [d.id, credit(parsed.defects?.[d.id])])),
  };
}

async function scoreBrain(task: string, dir: string, judgeModel: string) {
  const f = join(dir, "design.md");
  const design = existsSync(f) ? readFileSync(f, "utf-8") : "";
  if (design.length < 500) return { score: 0, note: "no design produced" };
  const traps = JSON.parse(readFileSync(join(FIX, "brain", task, "traps.json"), "utf-8"));
  const oracle = readFileSync(join(ROOT, traps.source.split(" ")[0].replace("RESEARCH.md", "ORACLE.md")), "utf-8");
  const system = "You grade a research pipeline design against known failure modes of this exact problem. Answer each question about the DESIGN AS WRITTEN (not what it might do). Reply with JSON only.";
  const user = `ORACLE (what went wrong / right in production):\n${oracle}\n\nDESIGN:\n${design.slice(0, 60000)}\n\nQUESTIONS:\n${traps.questions.map((q: any) => `${q.id}: ${q.q}`).join("\n")}\n\nReturn JSON: {"answers": {"T1": "yes"|"no"|"partial", ...}, "fabrications": ["<any physical number or fact stated as established that is wrong>"]}`;
  const { parsed, cost } = await judge(judgeModel, system, user, dir);
  let got = 0, total = 0;
  for (const q of traps.questions) {
    const a = String(parsed.answers?.[q.id] ?? "no").toLowerCase();
    got += (a === "yes" ? 1 : a === "partial" ? 0.5 : 0) * q.weight; total += q.weight;
  }
  return { score: got / total, answers: parsed.answers, fabrications: parsed.fabrications ?? [], judge: judgeModel, judge_cost: cost,
    items: Object.fromEntries(traps.questions.map((q: any) => [q.id, credit(parsed.answers?.[q.id])])) };
}

function usageOf(dir: string) {
  const p = join(dir, ".agent", "usage.log");
  const t = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  if (!existsSync(p)) return t;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const c = line.split("\t");
    if (c.length < 8) continue;
    t.input += +c[3] || 0; t.output += +c[4] || 0; t.cacheRead += +c[5] || 0; t.cacheWrite += +c[6] || 0; t.cost += +c[7] || 0; t.calls++;
  }
  return t;
}

// ── commands ─────────────────────────────────────────────────────────────────

async function run(o: Record<string, string>) {
  const role = o.role as Role;
  if (!DEFAULT_TASK[role]) throw new Error(`--role must be one of ${Object.keys(DEFAULT_TASK).join(", ")}`);
  const task = o.task || DEFAULT_TASK[role];
  const models = (o.models ?? "").split(",").filter(Boolean);
  const reps = Number(o.reps || 1), cap = o.cap || "5", judgeModel = o.judge || "kimi-k3";
  const arms = (o.arms || o.arm || "luxas").split(",").filter(Boolean) as Arm[];
  const badArm = arms.filter((a) => !(ARMS as readonly string[]).includes(a));
  if (badArm.length) throw new Error(`--arms must be from ${ARMS.join(", ")}; got ${badArm.join(", ")}`);
  mkdirSync(join(HOME, "runs"), { recursive: true });
  for (const model of models) for (const arm of arms) for (let rep = 1; rep <= reps; rep++) {
    const dir = join(HOME, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}_${role}_${task}_${slug(model)}_${arm}_r${rep}`);
    mkdirSync(dir, { recursive: true });
    prepareSandbox(role, task, dir);
    console.log(`▶ ${role}/${task} × ${model} [${arm}] (rep ${rep}) → ${dir}`);
    const child = spawnSync("npx", ["tsx", fileURLToPath(import.meta.url), "trial", "--role", role, "--model", model, "--task", task, "--sandbox", dir, "--cap", cap, "--arm", arm], {
      cwd: ROOT, stdio: ["ignore", "inherit", "pipe"], timeout: 3 * 3600_000, encoding: "utf-8",
    });
    process.stderr.write(child.stderr ?? "");
    const t: any = existsSync(join(dir, "trial.json")) ? JSON.parse(readFileSync(join(dir, "trial.json"), "utf-8"))
      : { role, model, task, arm, stopReason: child.status === 1 ? "killed_by_cap_or_fatal" : "no_trial_record", exitCode: child.status };
    // A provider with no balance is an infrastructure fact, not a model score:
    // record it, never score it, and skip this model's remaining reps.
    const unfunded = join(dir, ".agent", "unfunded.json");
    if (existsSync(unfunded)) {
      const u = JSON.parse(readFileSync(unfunded, "utf-8"));
      appendFileSync(RESULTS, JSON.stringify({ ...t, rep, sandbox: dir, stopReason: "unfunded", errorMessage: u.message, score: null, usage: usageOf(dir), at: new Date().toISOString() }) + "\n");
      console.log(`  UNFUNDED (${u.provider}): ${String(u.message).slice(0, 120)} — skipping ${model}`);
      break;
    }
    // Hitting --cap is a cost fact, not a quality score: no output exists to
    // score. Report it as such (and raise --cap if the role needs it).
    if (!existsSync(join(dir, "trial.json")) && /Cost limit exceeded/.test(child.stderr ?? "")) {
      const rec = { ...t, rep, sandbox: dir, stopReason: "cost_cap", score: null, note: `hit --cap $${cap} before producing output`, usage: usageOf(dir), at: new Date().toISOString() };
      appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
      console.log(`  COST CAP: $${rec.usage.cost.toFixed(3)} after ${rec.usage.calls} calls, no output — not scored`);
      continue;
    }
    let s: any;
    try {
      s = role === "tool_review" ? scoreToolReview(task, dir)
        : role === "auditor" ? await scoreAuditor(task, dir, judgeModel)
        : await scoreBrain(task, dir, judgeModel);
    } catch (e: any) { s = { score: null, note: `scoring failed: ${String(e?.message ?? e).slice(0, 300)}` }; }
    const rec = { ...t, rep, sandbox: dir, usage: usageOf(dir), ...s, at: new Date().toISOString() };
    appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
    console.log(`  score=${s.score == null ? "—" : s.score.toFixed(3)}  cost=$${rec.usage.cost.toFixed(3)}  calls=${rec.usage.calls}  ${(t.elapsedMs / 60000 || 0).toFixed(1)} min  stop=${t.stopReason}${s.note ? "  (" + s.note + ")" : ""}`);
  }
}

/** Per-item credit of a result row. Rows written before `items` existed are rebuilt from what they recorded. */
export function itemsOf(r: any): Record<string, number> | null {
  if (r.items && typeof r.items === "object") return r.items;
  if (r.per_defect) return Object.fromEntries(Object.entries(r.per_defect).map(([k, v]) => [k, credit(v)]));
  if (r.answers) return Object.fromEntries(Object.entries(r.answers).map(([k, v]) => [k, credit(v)]));
  // tool_review rows from before `items` recorded only the survivors; the full list is the fixture's.
  if (r.role === "tool_review" && Array.isArray(r.survived) && r.passes_reference) {
    const dir = join(FIX, "tool_review", r.task, "mutants");
    if (existsSync(dir)) return Object.fromEntries(readdirSync(dir).map((m) => m.replace(/\.py$/, "")).map((m) => [m, r.survived.includes(m) ? 0 : 1]));
  }
  return null;
}

export interface PairedCell {
  key: string; nLuxas: number; nBare: number; luxas: number; bare: number; delta: number;
  /** Items where the Luxas arm's mean credit is higher / lower / equal. null when a side has no per-item record. */
  better: number | null; worse: number | null; same: number | null;
  costLuxas: number; costBare: number;
}

/** Luxas definition vs bare prompt, same role/task/model, paired item by item. */
export function pairArms(rows: any[]): PairedCell[] {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const groups = new Map<string, { luxas: any[]; bare: any[] }>();
  for (const r of rows) {
    if (r.score == null) continue; // unfunded / cost-cap rows are facts about infrastructure, not scores
    const k = `${r.role}/${r.task}\t${r.model}`;
    const g = groups.get(k) ?? groups.set(k, { luxas: [], bare: [] }).get(k)!;
    (r.arm === "bare" ? g.bare : g.luxas).push(r);
  }
  const out: PairedCell[] = [];
  for (const [key, g] of [...groups].sort()) {
    if (!g.luxas.length || !g.bare.length) continue;
    const perItem = (rs: any[]) => {
      const acc = new Map<string, number[]>();
      for (const r of rs) { const it = itemsOf(r); if (!it) return null; for (const [id, c] of Object.entries(it)) acc.set(id, [...(acc.get(id) ?? []), c]); }
      return new Map([...acc].map(([id, cs]) => [id, mean(cs)]));
    };
    const L = perItem(g.luxas), B = perItem(g.bare);
    let better: number | null = null, worse: number | null = null, same: number | null = null;
    if (L && B) {
      better = worse = same = 0;
      for (const id of new Set([...L.keys(), ...B.keys()])) {
        const d = (L.get(id) ?? 0) - (B.get(id) ?? 0);
        if (d > 1e-9) better++; else if (d < -1e-9) worse++; else same++;
      }
    }
    const l = mean(g.luxas.map((r) => r.score)), b = mean(g.bare.map((r) => r.score));
    out.push({ key, nLuxas: g.luxas.length, nBare: g.bare.length, luxas: l, bare: b, delta: l - b, better, worse, same,
      costLuxas: mean(g.luxas.map((r) => r.usage?.cost ?? 0)), costBare: mean(g.bare.map((r) => r.usage?.cost ?? 0)) });
  }
  return out;
}

/** Two-sided sign-test p-value for `better` vs `worse` (ties dropped). */
export function signTestP(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0) return 1;
  const k = Math.min(better, worse);
  let tail = 0, c = 1;
  for (let i = 0; i <= k; i++) { tail += c; c = (c * (n - i)) / (i + 1); }
  return Math.min(1, (2 * tail) / 2 ** n);
}

export function renderReport(rows: any[]): string {
  const L: string[] = [];
  const key = (r: any) => `${r.role}/${r.task}\t${r.model}\t${r.arm ?? "luxas"}`;
  const groups = new Map<string, any[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  L.push("role/task\tmodel\tarm\tn\tscore\t$/trial\tmin/trial\tfailures");
  for (const [k, rs] of [...groups].sort()) {
    const ok = rs.filter((r) => r.score != null);
    const fails = rs.filter((r) => r.stopReason && !["stop", "end_turn", "toolUse", "length", "unknown"].includes(r.stopReason)).map((r) => r.stopReason);
    L.push(`${k}\t${rs.length}\t${mean(ok.map((r) => r.score)).toFixed(3)}\t${mean(rs.map((r) => r.usage?.cost ?? 0)).toFixed(3)}\t${mean(rs.map((r) => (r.elapsedMs ?? 0) / 60000)).toFixed(1)}\t${fails.join(",") || "-"}`);
  }
  const pairs = pairArms(rows);
  if (pairs.length) {
    L.push("", "Luxas definition vs bare prompt (same model, tools, task and scorer):");
    L.push("role/task\tmodel\tluxas\tbare\tdelta\titems better/worse/same\tsign-test p\t$luxas\t$bare");
    let tb = 0, tw = 0;
    for (const c of pairs) {
      const items = c.better === null ? "n/a (no per-item record)" : `${c.better}/${c.worse}/${c.same}`;
      const p = c.better === null ? "—" : signTestP(c.better, c.worse!).toFixed(2);
      if (c.better !== null) { tb += c.better; tw += c.worse!; }
      L.push(`${c.key}\t${c.luxas.toFixed(3)} (n=${c.nLuxas})\t${c.bare.toFixed(3)} (n=${c.nBare})\t${c.delta >= 0 ? "+" : ""}${c.delta.toFixed(3)}\t${items}\t${p}\t${c.costLuxas.toFixed(2)}\t${c.costBare.toFixed(2)}`);
    }
    L.push(`all paired items: ${tb} better, ${tw} worse — sign-test p = ${signTestP(tb, tw).toFixed(3)}`);
    L.push("Read p > 0.05 as 'no difference shown', not as 'no difference'. Items within one task share a run, so they are not fully independent: the p-value is optimistic.");
    if (pairs.some((c) => c.nLuxas < 3 || c.nBare < 3)) L.push("Some cells have fewer than 3 runs per arm: run-to-run variation is not yet separated from the arm effect.");
  }
  return L.join("\n");
}

function report(o: Record<string, string>) {
  if (!existsSync(RESULTS)) { console.log("no results yet"); return; }
  const rows = latestPerSandbox(readFileSync(RESULTS, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))).filter((r) => !o.role || r.role === o.role);
  console.log(renderReport(rows));
}

/** A re-scored trial appends a second row for the same sandbox; the report reads the last one. */
export function latestPerSandbox(rows: any[]): any[] {
  const last = new Map<string, number>();
  rows.forEach((r, i) => { if (r.sandbox) last.set(r.sandbox, i); });
  return rows.filter((r, i) => !r.sandbox || last.get(r.sandbox) === i);
}

/**
 * Score a finished trial again without re-running it — for the case where the
 * agent did its work and the JUDGE call failed (two auditor trials lost their
 * score to a judge connection error on 2026-10-06, $3.18 of agent work each
 * time). Appends a new row; `report` keeps the latest row per sandbox.
 */
async function rescore(o: Record<string, string>) {
  const dir = resolve(o.sandbox), judgeModel = o.judge || "kimi-k3";
  const t: any = JSON.parse(readFileSync(join(dir, "trial.json"), "utf-8"));
  const prior = readFileSync(RESULTS, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.sandbox === dir).pop();
  let s: any;
  try {
    s = t.role === "tool_review" ? scoreToolReview(t.task, dir) : t.role === "auditor" ? await scoreAuditor(t.task, dir, judgeModel) : await scoreBrain(t.task, dir, judgeModel);
  } catch (e: any) { s = { score: null, note: `scoring failed: ${String(e?.message ?? e).slice(0, 300)}` }; }
  const rec = { ...t, rep: prior?.rep ?? 1, sandbox: dir, usage: usageOf(dir), ...s, rescored: true, at: new Date().toISOString() };
  appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  console.log(`${t.role}/${t.task} × ${t.model} [${t.arm ?? "luxas"}]  score=${s.score == null ? "—" : s.score.toFixed(3)}${s.note ? "  (" + s.note + ")" : ""}`);
}

function validate() {
  let bad = 0;
  for (const t of readdirSync(join(FIX, "tool_review"))) {
    const r = spawnSync("python3", [join(FIX, "tool_review", t, "gold_test.py")], { encoding: "utf-8" });
    console.log(`${r.status === 0 ? "✓" : "✗"} tool_review/${t}\n${r.stdout.trim().split("\n").map((l) => "    " + l).join("\n")}`);
    bad += r.status === 0 ? 0 : 1;
  }
  for (const t of readdirSync(join(FIX, "auditor")).filter((d) => existsSync(join(FIX, "auditor", d, "labels.json")))) {
    const l = JSON.parse(readFileSync(join(FIX, "auditor", t, "labels.json"), "utf-8"));
    const snap = existsSync(join(HOME, "snapshots", `${t}.tgz`));
    console.log(`${snap ? "✓" : "✗"} auditor/${t}: ${l.defects.length} labelled defects, snapshot ${snap ? "present" : "MISSING"}`);
    bad += snap ? 0 : 1;
  }
  for (const t of readdirSync(join(FIX, "brain"))) {
    const tr = JSON.parse(readFileSync(join(FIX, "brain", t, "traps.json"), "utf-8"));
    const ok = existsSync(join(ROOT, tr.research));
    console.log(`${ok ? "✓" : "✗"} brain/${t}: ${tr.questions.length} trap questions`);
    bad += ok ? 0 : 1;
  }
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (cmd === "trial") await trial(o);
  else if (cmd === "run") await run(o);
  else if (cmd === "report") report(o);
  else if (cmd === "rescore") await rescore(o);
  else if (cmd === "validate") validate();
  else { console.error("usage: model_bench.mts validate | run --role R --models a,b [--task T --reps N --cap USD --judge M --arms luxas,bare] | report [--role R]"); process.exit(2); }
}
