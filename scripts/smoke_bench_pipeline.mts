#!/usr/bin/env tsx
/**
 * smoke_bench_pipeline — the measurement instrument measures.
 *
 * bench_run / bench_score / bench_compare decide whether a harness change was
 * worth making, so a scorer that passes a wrong report (or fails a right one)
 * is worse than no scorer. This gate feeds it hand-written reports whose
 * correct score is known, including the ones built to fool it. No model is
 * called.
 *
 *   npx tsx scripts/smoke_bench_pipeline.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBench, numbersIn } from "./bench_score.mts";
import { armModel, BARE_ARM_MODEL, baselinePrompt, buildRecord, appendRecord, classifyClaudeResult, listBenches, prepareRunDir } from "./bench_run.mts";
import { readLedger, summarize, render } from "./bench_compare.mts";
import * as benchRun from "./bench_run.mts";   // namespace: a missing export fails one check, not the whole file

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH = join(ROOT, "benchmarks");
const tmp = mkdtempSync(join(tmpdir(), "luxas-bench-gate-"));
function project(name: string, tex: string | null, bib = ""): string {
  const d = join(tmp, name);
  mkdirSync(join(d, "report"), { recursive: true });
  if (tex !== null) writeFileSync(join(d, "report", "report.tex"), tex);
  if (bib) writeFileSync(join(d, "report", "references.bib"), bib);
  return d;
}
const passed = (dir: string, bench: string) => { const s = scoreBench(dir, join(BENCH, bench)); return `${s.oracle?.passed}/${s.oracle?.total}`; };
const failed = (dir: string, bench: string) => scoreBench(dir, join(BENCH, bench)).oracle!.checks.filter((c) => !c.pass).map((c) => c.label.slice(0, 40));

console.log("1. every bench is machine-scoreable");
const benches = listBenches();
check("at least 4 benches", benches.length >= 4, `${benches.length}`);
for (const b of benches) {
  const md = readFileSync(join(BENCH, b, "ORACLE.md"), "utf-8");
  const m = md.match(/```oracle\s*\n([\s\S]*?)\n```/);
  let n = 0;
  try { n = JSON.parse(m![1]).checks.length; } catch { /* reported below */ }
  check(`${b}: oracle block parses with >= 3 checks`, n >= 3, `${n} checks`);
}

console.log("\n2. numbers are read the way reports write them");
const vals = (t: string) => numbersIn(t).map((n) => n.v);
check("LaTeX scientific notation", vals("p_L = 6 \\times 10^{-7}").some((v) => Math.abs(v - 6e-7) < 1e-12), JSON.stringify(vals("p_L = 6 \\times 10^{-7}")));
check("…and it is not also read as 6, 10 and 7", !vals("p_L = 6 \\times 10^{-7}").includes(10));
check("bare power of ten", vals("about $10^{-6}$ per state").some((v) => Math.abs(v - 1e-6) < 1e-12));
check("e-notation", vals("2.555e-4").some((v) => Math.abs(v - 2.555e-4) < 1e-12));
check("significant digits are counted from what was written", numbersIn("G = 42.66")[0].sig === 4 && numbersIn("about 43")[0].sig === 2);

console.log("\n3. bench-01: right, wrong, and built-to-fool reports");
const B1 = "bench-01-u233-gamow";
const good1 = project("b1-good", "We integrate the WKB exponent with the centrifugal term and find $G = 42.66$. The Q-value from AME2020 is 4.9087 MeV. The Viola--Seaborg systematics give 42.59.");
check("a correct report scores full", passed(good1, B1) === "4/4", `${passed(good1, B1)} failed: ${failed(good1, B1).join(" | ")}`);
const naive1 = project("b1-naive", "Neglecting the centrifugal barrier, WKB gives $G = 40.2$. Q = 4.9087 MeV (AME2020). Viola--Seaborg agrees.");
check("the no-centrifugal answer (40.2) fails the G check", failed(naive1, B1).some((l) => l.startsWith("Gamow factor")), passed(naive1, B1));
const stray1 = project("b1-stray", "See page 43 of the review. We did not compute G. Q is about 5 MeV.");
check("a stray '43' does not satisfy G = 42.6 (minSig)", failed(stray1, B1).some((l) => l.startsWith("Gamow factor")));
check("a rounded Q of 5 MeV does not satisfy Q = 4.9087", failed(stray1, B1).some((l) => l.startsWith("Q_alpha")));
const none = project("b1-none", null);
check("no report → 0, never a free pass", passed(none, B1) === "0/4", passed(none, B1));
const md1 = join(tmp, "b1-md"); mkdirSync(join(md1, "report"), { recursive: true });
writeFileSync(join(md1, "report", "report.md"), "G = 42.66, Q = 4.9087 MeV from AME2020; Viola-Seaborg cross-check 42.59.");
check("a Markdown report is read too (an arm without LaTeX still gets scored)", passed(md1, B1) === "4/4", passed(md1, B1));

console.log("\n4. bench-03 and bench-04: caveats, citations and traps");
const B3 = "bench-03-ftqc-ccz-conflict";
const good3 = project("b3-good", "From Table 1, Gidney reports $6 \\times 10^{-7}$; Claes tabulates $1.0 \\times 10^{-6}$, a ratio of 1.67. The two are normalised to different physical error rates, so the comparison is ill-posed.");
check("bench-03 correct report scores full", passed(good3, B3) === "5/5", `${passed(good3, B3)} failed: ${failed(good3, B3).join(" | ")}`);
const bad3 = project("b3-bad", "Gidney reports $6 \\times 10^{-7}$ and Claes $1 \\times 10^{-6}$ (ratio 1.67). These figures are directly comparable, so Gidney is cheaper.");
check("…and calling them directly comparable trips the trap and misses the caveat", failed(bad3, B3).length === 2, failed(bad3, B3).join(" | "));
const B4 = "bench-04-prior-art-positioning";
const good4 = project("b4-good", "The failure of perturbative $C_6$ is known \\cite{vaillant2012,sibalic2017,sibalic2016}.", "@article{vaillant2012, author={Vaillant, C. L.}, eprint={1203.3736}}\n@article{sibalic2017, author={Šibalić, N.}, title={ARC}}\n@misc{sibalic2016, eprint={1605.00259}}");
check("bench-04: priors found in the bibliography count", passed(good4, B4) === "4/4", `${passed(good4, B4)} failed: ${failed(good4, B4).join(" | ")}`);
const bad4 = project("b4-bad", "We show for the first time that perturbative $C_6$ vanishes on axis, a previously unreported artefact.");
check("bench-04: claiming novelty with no priors scores 0", passed(bad4, B4) === "0/4", passed(bad4, B4));

console.log("\n5. the baseline is not handed the answer");
for (const b of benches) {
  const prompt = baselinePrompt(readFileSync(join(BENCH, b, "RESEARCH.md"), "utf-8"));
  // Only the answer fields — labels and patterns legitimately contain years ("AME2020").
  const block = JSON.parse(readFileSync(join(BENCH, b, "ORACLE.md"), "utf-8").match(/```oracle\s*\n([\s\S]*?)\n```/)![1]);
  const oracleNums: number[] = block.checks.flatMap((c: any) => [c.target, c.a, c.b]).filter((v: any) => typeof v === "number");
  const leaked = oracleNums.filter((v) => numbersIn(prompt).some((n) => Math.abs(n.v - v) <= Math.abs(v) * 1e-6));
  check(`${b}: no oracle value appears in the prompt`, leaked.length === 0, leaked.join(", "));
}
// Made by calling prepareRunDir and listing what landed (until 2026-10-06 this
// counted copyFileSync calls in the source). A bench may now carry input/ files
// for the arm; ORACLE.md and anything that grades the run still never leave.
for (const b of benches) {
  const landed = readdirSync(prepareRunDir(join(tmp, "prepared"), "claude-code", b)).sort();
  check(`${b}: the run directory receives RESEARCH.md and nothing else from the bench`, JSON.stringify(landed) === JSON.stringify(["RESEARCH.md"]), landed.join(", "));
}
const withInput = join(tmp, "root-with-input");
mkdirSync(join(withInput, "b1", "input"), { recursive: true });
for (const [f, body] of [["RESEARCH.md", "# r\n"], ["ORACLE.md", "answer\n"], ["grader.py", "x\n"], ["reference.py", "x\n"], ["input/scene.dat", "data\n"]]) writeFileSync(join(withInput, "b1", f), body);
const landedInput = readdirSync(prepareRunDir(join(tmp, "prepared"), "claude-code", "b1", withInput)).sort();
check("a bench with input/ hands over RESEARCH.md and input/, never the oracle, grader or reference", JSON.stringify(landedInput) === JSON.stringify(["RESEARCH.md", "input"]), landedInput.join(", "));

console.log("\n6. ledger round trip and the table");
const ledger = join(tmp, "LEDGER.jsonl");
const rec = (arm: string, dir: string, bench: string, cost: number) => appendRecord(buildRecord({ arm, bench, runDir: dir, model: "m", costUsd: cost, wallSec: 600, exit: "success" }), ledger);
rec("claude-code", good1, B1, 1.0); rec("claude-code", naive1, B1, 2.0); rec("luxas", good1, B1, 8.0); rec("luxas", none, B3, 4.0);
writeFileSync(ledger, readFileSync(ledger, "utf-8") + "{ torn line\n");
const s = summarize(readLedger(ledger));
check("records survive a torn line", readLedger(ledger).length === 4);
check("mean over repeated runs", Math.abs(s.cells[B1]["claude-code"].score - (1 + 0.75) / 2) < 1e-9, String(s.cells[B1]["claude-code"].score));
check("mean cost per run", s.cells[B1]["claude-code"].costUsd === 1.5);
check("a run with no report counts as 0 and is flagged", s.cells[B3]["luxas"].score === 0 && s.cells[B3]["luxas"].reports === 0);
check("--latest keeps only the newest run", summarize(readLedger(ledger), { latest: true }).cells[B1]["claude-code"].n === 1);
const table = render(s);
check("the table warns that n=1 differences are noise", /n=1 cells present/.test(table));
check("the table lists arm/bench pairs not yet run", /not yet run: claude-code\/bench-03/.test(table), table.split("\n").slice(-2).join(" / "));
check("an empty ledger says so instead of printing an empty table", /ledger is empty/.test(render(summarize([]))));
// 2026-10-06: three bare runs died on "Credit balance is too low"; the CLI still said subtype "success".
const cutOff = classifyClaudeResult({ subtype: "success", is_error: true, terminal_reason: "api_error", result: "Credit balance is too low" });
check("a run the provider ended is not exit=success, and carries the provider's message", cutOff.exit === "error:api_error" && cutOff.aborted === "Credit balance is too low");
check("a finished run is exit=success and not aborted", JSON.stringify(classifyClaudeResult({ subtype: "success", is_error: false })) === JSON.stringify({ exit: "success" }));
check("running out of the run's own budget is the arm's outcome, not an abort", classifyClaudeResult({ subtype: "error_max_budget_usd", is_error: true }).aborted === undefined && classifyClaudeResult({ subtype: "error_max_budget_usd", is_error: true }).exit === "error_max_budget_usd");
check("a crash with no JSON is recorded as such", classifyClaudeResult(null, null, 143).exit === "no-json(exit 143)" && classifyClaudeResult(null, { code: "ETIMEDOUT", message: "x" }).exit === "error:ETIMEDOUT");
appendRecord(buildRecord({ arm: "claude-code", bench: B3, runDir: none, model: "m", costUsd: 0.2, wallSec: 101, ...cutOff }), ledger);
appendRecord(buildRecord({ arm: "claude-code", bench: B1, runDir: good1, model: "m", costUsd: 9.0, wallSec: 900, ...cutOff }), ledger);
const s2 = summarize(readLedger(ledger));
check("an aborted run is left out of its cell, whether its artifact passed or not", s2.cells[B1]["claude-code"].n === 2 && s2.cells[B1]["claude-code"].costUsd === 1.5 && s2.cells[B3]["claude-code"] === undefined && s2.aborted.length === 2);
check("the table lists aborted runs with the provider's message, and still says the pair is not yet run",
  /not counted — the provider ended these runs/.test(render(s2)) && /claude-code\/bench-03[^\n]*Credit balance is too low/.test(render(s2)) && /not yet run: claude-code\/bench-03/.test(render(s2)), render(s2).split("\n").slice(-4).join(" / "));
// 2026-10-09: the CLI's default model had moved; three re-runs joined the column of twelve runs on another model.
check("the bare arm runs on a pinned model, --model overrides it, and luxas keeps its profile",
  armModel("claude-code") === BARE_ARM_MODEL && armModel("claude-code", "x") === "x" && armModel("luxas") === undefined && armModel("luxas", "y") === "y");
const ledger2 = join(tmp, "LEDGER2.jsonl");
const on = (model: string, dir: string, bench: string, extra: object = {}) => appendRecord(buildRecord({ arm: "claude-code", bench, runDir: dir, model, costUsd: 1.0, wallSec: 60, exit: "success", ...extra }), ledger2);
on("model-a", good1, B1); on("model-a", good1, B1); on("model-b+helper", naive1, B1); on("model-a", none, B3, cutOff);
const s3 = summarize(readLedger(ledger2));
const colA = "claude-code (model-a)", colB = "claude-code (model-b)";
check("one arm on two models is two columns, and neither mean includes the other's runs",
  JSON.stringify(s3.arms) === JSON.stringify([colA, colB]) && s3.cells[B1][colA].n === 2 && s3.cells[B1][colA].score === 1 && s3.cells[B1][colB].n === 1 && s3.cells[B1][colB].score === 0.75 && s3.overall[colA].n === 2 && s3.overall[colB].n === 1,
  JSON.stringify(s3.arms) + " " + JSON.stringify(s3.overall));
check("an aborted run is listed under its own model's column", /claude-code \(model-a\)\/bench-03[^\n]*Credit balance is too low/.test(render(s3)), render(s3).split("\n").slice(-2).join(" / "));
check("the committed ledger, if present, parses", !existsSync(join(BENCH, "LEDGER.jsonl")) || readLedger().every((r) => typeof r.arm === "string" && typeof r.oracleTotal === "number"));

console.log("\n7. a run the provider ended is aborted on BOTH arms");
const blank = benchRun.classifyClaudeResult({ subtype: "success", is_error: true, terminal_reason: "api_error", result: "" });
check("an api_error with an empty result is still aborted, with a non-empty reason", typeof blank.aborted === "string" && blank.aborted.length > 0, JSON.stringify(blank));
const runLuxas = (benchRun as any).runLuxas as undefined | ((dir: string, o: any, spawn?: any) => { exit: string; aborted?: string });
check("bench_run exports runLuxas with an injectable spawner", typeof runLuxas === "function");
const ledger7 = join(tmp, "LEDGER7.jsonl");
appendRecord(buildRecord({ arm: "claude-code", bench: B1, runDir: none, model: "m", costUsd: 0.2, wallSec: 101, ...blank }), ledger7);
const luxasEnding = (kind: string, detail: string, ended: { status: number | null; error?: { code: string; message: string } } = { status: 1 }) => {
  const dir = join(tmp, `lx-${kind}-${detail ? "d" : "blank"}${ended.error ? "-" + ended.error.code : ""}`); mkdirSync(dir, { recursive: true });
  // What `luxas run` leaves when it ends this way (exit-state.ts record shape); no process is launched.
  const stub = (_cmd: string, args: string[]) => {
    mkdirSync(join(args[2], ".agent"), { recursive: true });
    writeFileSync(join(args[2], ".agent", "last_exit.json"), JSON.stringify({ kind, detail, ts: Date.now(), pid: process.pid, finished: kind === "finished", lastErrTransient: kind === "provider_transient" }));
    return { status: ended.status, stdout: "", stderr: "", error: ended.error };
  };
  return { dir, res: runLuxas ? runLuxas(dir, { maxUsd: 3, timeoutMin: 1 }, stub) : { exit: "n/a" } as { exit: string; aborted?: string; routing?: Record<string, string> } };
};
for (const [kind, detail] of [["provider_unfunded", "deepseek: Insufficient Balance"], ["provider_transient", "502 Bad Gateway"], ["provider_unfunded", ""]] as const) {
  const { dir, res } = luxasEnding(kind, detail);
  check(`luxas ${kind}${detail ? "" : " (no detail)"} is exit=${kind} and aborted with a non-empty reason`, res.exit === kind && typeof res.aborted === "string" && res.aborted.length > 0, JSON.stringify(res));
  appendRecord(buildRecord({ arm: "luxas", bench: B1, runDir: dir, model: "profile:dual", costUsd: 0.1, wallSec: 30, ...(res as any) }), ledger7);
}
for (const kind of ["budget_exhausted", "provider_error", "finished", "stopped_unfinished"]) {
  const { res } = luxasEnding(kind, "x");
  check(`luxas ${kind} is the arm's outcome, not an abort`, res.exit === kind && res.aborted === undefined, JSON.stringify(res));
}
// Two edges of runLuxas that only hand-built records exercised: a runLuxas that dropped the routing, and a
// classifyLuxasExit without its spawn-error line, both passed every check of this gate (review 2026-10-09).
const killed = luxasEnding("finished", "x", { status: null, error: { code: "ETIMEDOUT", message: "spawnSync ETIMEDOUT" } }).res;
check("a luxas run the bench timeout killed is error:ETIMEDOUT, whatever exit record is in its directory", killed.exit === "error:ETIMEDOUT" && killed.aborted === undefined, JSON.stringify(killed));
const modeBefore = process.env.LUXAS_EXPERIMENT_MODE;
process.env.LUXAS_EXPERIMENT_MODE = "solo";
const routed = luxasEnding("finished", "routed").res;
if (modeBefore === undefined) delete process.env.LUXAS_EXPERIMENT_MODE; else process.env.LUXAS_EXPERIMENT_MODE = modeBefore;
check("runLuxas puts the launching shell's routing on its result (it becomes the row's column)", routed.routing?.LUXAS_EXPERIMENT_MODE === "solo", JSON.stringify(routed));
const s7 = summarize(readLedger(ledger7));
check("provider-ended runs of both arms are left out of every cell", s7.cells[B1] === undefined && s7.aborted.map((r) => r.arm).sort().join(",") === "claude-code,luxas,luxas,luxas",
  `cells=${JSON.stringify(Object.keys(s7.cells[B1] ?? {}))} aborted=${s7.aborted.map((r) => r.arm).join(",")}`);

console.log("\n8. the bare arm states its effort and leaves a transcript");
const bare = benchRun as any;
check("bench_run exports claudeArgs, armEffort, BARE_ARM_EFFORT and an injectable runClaudeCode",
  typeof bare.claudeArgs === "function" && typeof bare.armEffort === "function" && typeof bare.BARE_ARM_EFFORT === "string" && typeof bare.runClaudeCode === "function");
const cc: string[] = bare.claudeArgs ? bare.claudeArgs("req", { maxUsd: 3, model: "m", effort: "high" }) : [];
const flag = (k: string) => (cc.includes(k) ? cc[cc.indexOf(k) + 1] : undefined);
check("the command line carries the model AND the effort (neither is left to the CLI's settings)", flag("--model") === "m" && flag("--effort") === "high", cc.slice(2).join(" "));
check("…and asks for the whole conversation, not only its last message", flag("--output-format") === "stream-json" && cc.includes("--verbose"), `--output-format ${flag("--output-format")}`);
check("the bare arm has a pinned effort, --effort overrides it, and luxas has none",
  !!bare.armEffort && bare.armEffort("claude-code") === bare.BARE_ARM_EFFORT && bare.armEffort("claude-code", "low") === "low" && bare.armEffort("luxas") === undefined && bare.armEffort("luxas", "high") === undefined);
const resultObj = { type: "result", subtype: "success", is_error: false, total_cost_usd: 1.25, modelUsage: { helper: { costUSD: 0.05 }, "model-x": { costUSD: 1.2 } }, result: "done" };
const lines = [JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }), JSON.stringify(resultObj)];
const bareRun = (name: string, out: { stdout: string; error?: any; status?: number }, effort = "high") => {
  const dir = join(tmp, name); mkdirSync(dir, { recursive: true });
  let seen: string[] = [];
  const stub = (_cmd: string, args: string[]) => { seen = args; return { status: out.status ?? 0, stdout: out.stdout, stderr: "", error: out.error }; };
  const res = bare.runClaudeCode ? bare.runClaudeCode(dir, "req", { maxUsd: 3, model: "model-x", effort, timeoutMin: 1 }, stub) : { exit: "n/a" };
  const kept = existsSync(join(dir, "claude_transcript.jsonl")) ? readFileSync(join(dir, "claude_transcript.jsonl"), "utf-8") : null;
  return { dir, res, seen, kept };
};
const fin = bareRun("cc-finished", { stdout: lines.join("\n") + "\n" });
check("a finished run: result read from the transcript's last result line (exit, cost, costliest model first)",
  fin.res.exit === "success" && fin.res.aborted === undefined && fin.res.costUsd === 1.25 && fin.res.model === "model-x+helper", JSON.stringify(fin.res));
check("…the whole transcript is in the run directory, tool calls included", fin.kept !== null && fin.kept.split("\n").filter(Boolean).length === 3 && fin.kept.includes('"tool_use"'), String(fin.kept).slice(0, 80));
check("…launched with the effort it reports", fin.seen[fin.seen.indexOf("--effort") + 1] === "high" && fin.res.effort === "high", JSON.stringify(fin.res));
const cut = bareRun("cc-cut", { stdout: lines.slice(0, 2).join("\n") + "\n" + JSON.stringify({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", result: "Credit balance is too low" }) + "\n" });
check("a provider-ended run is still aborted when read from a transcript", cut.res.exit === "error:api_error" && cut.res.aborted === "Credit balance is too low", JSON.stringify(cut.res));
const torn = bareRun("cc-timeout", { stdout: lines.slice(0, 2).join("\n") + '\n{"type":"assist', error: { code: "ETIMEDOUT", message: "spawnSync claude ETIMEDOUT" }, status: null as any });
check("a timeout keeps the transcript up to the kill and is not read as a result", torn.res.exit === "error:ETIMEDOUT" && torn.res.costUsd === null && torn.kept !== null && torn.kept.includes('"tool_use"'), JSON.stringify(torn.res));
const ledger8 = join(tmp, "LEDGER8.jsonl");
const row8 = (effort: string | undefined, dir: string, model = "model-x") => appendRecord(buildRecord({ arm: "claude-code", bench: B1, runDir: dir, model, costUsd: 1, wallSec: 60, exit: "success", ...(effort ? { effort } : {}) } as any), ledger8);
row8(undefined, good1); row8("xhigh", good1);
check("the ledger row carries the effort", (readLedger(ledger8)[1] as any).effort === "xhigh" && !("effort" in readLedger(ledger8)[0]));
const s8a: any = summarize(readLedger(ledger8));
check("a row that recorded no effort beside one that did is not called mixed", JSON.stringify(s8a.mixedEffort ?? null) === "{}" && !/mixed effort/.test(render(s8a)), JSON.stringify(s8a.mixedEffort));
row8("high", naive1);
const s8b: any = summarize(readLedger(ledger8));
check("two recorded efforts in one column are named under the table", JSON.stringify(s8b.mixedEffort?.["claude-code"]) === JSON.stringify(["high", "xhigh"]) && /mixed effort in claude-code: runs at high and xhigh/.test(render(s8b)), render(s8b).split("\n").slice(-2).join(" / "));

console.log("\n9. a luxas run's routing is on its ledger row and decides its column");
// runLuxas passes the launching shell's environment to `luxas run`: a solo run on an Opus executor and a
// pipeline run on DeepSeek both recorded profile:dual and would have been averaged together.
const routingOf = (benchRun as any).luxasRouting as undefined | ((env: Record<string, string | undefined>) => Record<string, string> | undefined);
check("bench_run exports luxasRouting", typeof routingOf === "function");
check("nothing set → no routing field; unrelated variables are not recorded", !!routingOf && routingOf({ HOME: "/x", LUXAS_PROJECT_DIR: "/p" }) === undefined);
const soloEnv = { LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5", LUXAS_PROJECT_DIR: "/p", LUXAS_EXECUTOR_MODEL: "" };
check("the executor mode and the brain model are recorded; an empty variable is not", !!routingOf && JSON.stringify(routingOf(soloEnv)) === JSON.stringify({ LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }), JSON.stringify(routingOf?.(soloEnv)));
const ledger9 = join(tmp, "LEDGER9.jsonl");
const lx = (routing: Record<string, string> | undefined, dir: string) => appendRecord(buildRecord({ arm: "luxas", bench: B1, runDir: dir, model: "profile:dual", costUsd: 5, wallSec: 900, exit: "finished", ...(routing ? { routing } : {}) } as any), ledger9);
lx(undefined, good1); lx({ LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }, naive1);
check("the row carries it", JSON.stringify((readLedger(ledger9)[1] as any).routing) === JSON.stringify({ LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }) && !("routing" in readLedger(ledger9)[0]));
const s9 = summarize(readLedger(ledger9));
check("a pipeline run and a solo run are two columns, each with its own mean",
  JSON.stringify(s9.arms) === JSON.stringify(["luxas (profile:dual)", "luxas (profile:dual; brain_model=claude-opus-5-5 experiment_mode=solo)"]) && s9.cells[B1][s9.arms[0]].score === 1 && s9.cells[B1][s9.arms[1]].score === 0.75, JSON.stringify(s9.arms));

// A run made elsewhere is recorded with `--record`; its routing is not in this shell, so it is stated.
const recordedRow = (benchRun as any).recordedRow as undefined | ((a: { arm: string; bench: string; recordDir: string; argv: string[] }) => any);
check("bench_run exports recordedRow (the row --record writes)", typeof recordedRow === "function");
const recSolo = recordedRow?.({ arm: "luxas", bench: B1, recordDir: naive1, argv: ["--model", "profile:dual", "--cost", "5", "--routing", "LUXAS_EXPERIMENT_MODE=solo", "--routing", "LUXAS_BRAIN_MODEL=claude-opus-5-5", "--routing", "HOME=/x", "--routing", "not-a-pair"] });
check("--record keeps the stated routing, and only routing variables", JSON.stringify(recSolo?.routing) === JSON.stringify({ LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }) && recSolo?.costUsd === 5, JSON.stringify(recSolo?.routing));
check("--record with no --routing writes a row without the field", !!recordedRow && !("routing" in recordedRow({ arm: "luxas", bench: B1, recordDir: good1, argv: ["--model", "profile:dual"] })));
if (recSolo) appendRecord(recSolo, ledger9);
const s9b = summarize(readLedger(ledger9));
check("a recorded solo run lands in the solo column, not beside the pipeline runs", s9b.cells[B1][s9.arms[0]]?.n === 1 && s9b.cells[B1][s9.arms[1]]?.n === 2, JSON.stringify(Object.fromEntries(Object.entries(s9b.cells[B1] ?? {}).map(([k, v]: any) => [k, v.n]))));

// Before a billable run the launcher prints what it is about to be. For the luxas arm `model=profile:dual` alone
// said the same for a pipeline run on the default brain and for a solo run on Opus: two columns of the table.
const planLine = (benchRun as any).planLine as undefined | ((a: object) => string);
const plan = (arm: string, routing?: Record<string, string>) => planLine?.({ arm, model: arm === "luxas" ? null : "claude-opus-5-5", effort: arm === "luxas" ? undefined : "xhigh", benches: [B1], maxUsd: 25, timeoutMin: 40, runsDir: "/r", commit: "abc", routing }) ?? "(bench_run does not export planLine)";
check("the line printed before a luxas run names the routing it will be recorded under", plan("luxas", { LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }) === `arm=luxas model=profile:dual routing=LUXAS_EXPERIMENT_MODE=solo,LUXAS_BRAIN_MODEL=claude-opus-5-5 benches=${B1} max-usd=25/run (worst case $25.00) timeout=40min runs-dir=/r commit=abc`, plan("luxas", { LUXAS_EXPERIMENT_MODE: "solo", LUXAS_BRAIN_MODEL: "claude-opus-5-5" }));
check("…says so when none is set (the profile's defaults), and the bare arm's line is what it was", / routing=none benches=/.test(plan("luxas")) && plan("claude-code") === `arm=claude-code model=claude-opus-5-5 effort=xhigh benches=${B1} max-usd=25/run (worst case $25.00) timeout=40min runs-dir=/r commit=abc`, `${plan("luxas")} | ${plan("claude-code")}`);

console.log("\n10. a bench run is not a past project");
// `luxas run` registers its directory in ~/.sisyphus/projects.json and a finished entry is shown to later runs
// as past research. A second run of a bench task would be handed the first one's notes path.
// This section holds the path test. That registerProject and selectPastProjects act on it is held in
// smoke_prompt_assembly (C84a), where HOME is redirected and a registry can be written.
const { isThrowawayPath } = await import("../src/memory.ts");
const { homedir } = await import("node:os");
check("the default runs directory is a throwaway path (so never registered or surfaced: C84a)", isThrowawayPath(join(homedir(), ".sisyphus", "bench-runs", "2026-10-09T00-00-00-luxas-blender-02-lit-scene")));
check("an ordinary project directory still is", !isThrowawayPath(join(homedir(), "research", "dy-clock")));

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
