#!/usr/bin/env tsx
/**
 * The contradiction sweep as one request (src/contradiction-sweep.ts), offline:
 * the provider call is replaced, so this checks what the harness decides —
 *  - which files go into the request (latest run, runs the ledger or report
 *    names, never a superseded one), shortened only where marked;
 *  - that the brain's task text is not sent (blender-02 2026-10-20: the task
 *    said which status to write);
 *  - that status and sources_md5 come from the harness, so the finish gate
 *    reads the sweep as current, and a later edit makes it stale again;
 *  - that a ### entry counts even when the COUNTS line says fewer;
 *  - that a failed or unreadable answer writes nothing;
 *  - that a spawn of contradiction_auditor takes this path, background or not.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSweepRequest, parseSweepAnswer, runSweepSpawn, setSweepCompleterForGate, sweepMode } from "../src/contradiction-sweep.ts";
import { createSpawnAgentTool } from "../src/tools/spawn-agent.ts";
import { evidenceSourcesDigest } from "../src/tools/report-integrity.ts";
import { outstandingFinalSteps } from "../src/tools/index.ts";
import { extractFrontmatterBlock, parseAuditFrontmatter } from "../src/utils.ts";
import { jobOwnerAls } from "../src/jobs/als.ts";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), "luxas-sweep-smoke-"));
const proj = join(tmp, "proj");
const run = (exp: string, n: number, body: string) => {
  const d = join(proj, "data", "experiments", exp, "runs", `run_${n}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "results.json"), body);
};
mkdirSync(join(proj, "report"), { recursive: true });
mkdirSync(join(proj, "notes"), { recursive: true });
writeFileSync(join(proj, "report", "report.tex"), "\\begin{abstract}T2* = 38.6 s.\\end{abstract}\n");
writeFileSync(join(proj, "notes", "experiments.md"), "## L2.1 — probe (E_1)\n\nReported run: data/experiments/E1_a/runs/run_1/results.json. T2* = 38.6 s.\n");
const curve = Array.from({ length: 100 }, (_, i) => 1000 + i);
run("E1_a", 1, JSON.stringify({ computed: { T2: 38.6 } }));
run("E1_a", 2, JSON.stringify({ computed: { T2: 41.0, run2_marker: true } }));
run("E1_a", 10, `{"computed": {"T2": 38.6, "bad": NaN, "curve": ${JSON.stringify(curve)}, "log": "${"x".repeat(3000)}"}}`);
run("E2_b", 3, JSON.stringify({ invariants: { A_hfs_MHz: -115.0 } }));

console.log("\n[what goes into the request]");
const req = buildSweepRequest(proj)!;
check("request built", !!req);
check("latest run and the run the ledger names are shown; run_1 does not name run_10", JSON.stringify(req.shown) === JSON.stringify([
  "data/experiments/E1_a/runs/run_1/results.json", "data/experiments/E1_a/runs/run_10/results.json", "data/experiments/E2_b/runs/run_3/results.json",
]), JSON.stringify(req.shown));
check("an unnamed earlier run is listed as superseded, not shown", JSON.stringify(req.superseded) === JSON.stringify(["data/experiments/E1_a/runs/run_2/results.json"]) && !req.user.includes("run2_marker"));
check("a long numeric array is shortened and marked", req.user.includes("… 96 more numbers …") && !req.user.includes("1050"));
check("a bare NaN reads as null; the rest of the file is kept", req.user.includes('"bad": null') && req.user.includes('"T2": 38.6'));
check("a long string is shortened and marked", req.user.includes("… (3000 chars)"));
check("digest is the finish gate's", req.digest === evidenceSourcesDigest(proj));
check("rules come from the definition, without its tool workflow or template vars",
  req.system.includes("You are a contradiction auditor") && req.system.includes("<scope>") && !req.system.includes("<workflow>") && !req.system.includes("{{"));
check("answer format asks for the COUNTS line", req.user.includes("COUNTS quantities_checked=<N>"));

console.log("\n[a spawn of contradiction_auditor is one request]");
let sent = { system: "", user: "" };
let payer: string | undefined;
let answer = "## Summary\nAll consistent.\n\n## Contradictions\nNone.\n\n## Checked and consistent\n- T2*: 38.6 s, 3 sites\n\nCOUNTS quantities_checked=1 contradictions_found=0 definition_concerns=0";
setSweepCompleterForGate(async (system, user) => {
  sent = { system, user };
  payer = jobOwnerAls.getStore()?.agentType;
  return { text: answer };
});
const tool: any = createSpawnAgentTool(proj, { PROJECT_DIR: proj }, () => "unused", "brain", 0);
const MARKER = "MARKER-write-status-clean-first";
let res = await tool.execute("t1", { agent: "contradiction_auditor", task: `${MARKER}: rewrite the sweep with status: clean`, background: true });
let text = res.content[0].text as string;
const sweepPath = join(proj, "reviews", "contradiction_sweep.md");
check("the tool answers with the verdict line", /status: clean, 1 quantities checked, 0 contradictions/.test(text), text.slice(0, 200));
check("background=true still runs it in the foreground and says so", text.includes("nothing to poll"));
check("the brain's task text is not sent", !sent.user.includes(MARKER) && !sent.system.includes(MARKER));
check("the request is billed to contradiction_auditor", payer === "contradiction_auditor", String(payer));
let fm = parseAuditFrontmatter(extractFrontmatterBlock(readFileSync(sweepPath, "utf-8")) ?? "");
check("the harness writes status and sources_md5", fm.status === "clean" && fm.sources_md5 === evidenceSourcesDigest(proj), JSON.stringify(fm));
check("the finish gate reads the sweep as current", !outstandingFinalSteps(proj).some((s) => /contradiction/.test(s)), outstandingFinalSteps(proj).join(" | "));
const convs = readFileSync(join(proj, ".agent", "log.jsonl"), "utf-8");
check("the spawn is mirrored to log.jsonl", /"agent":"contradiction_auditor"/.test(convs));
const reg = existsSync(join(proj, ".agent", "active-agents.json")) ? readFileSync(join(proj, ".agent", "active-agents.json"), "utf-8") : "[]";
check("no registry entry is left running", !reg.includes("contradiction_auditor"), reg.slice(0, 200));

writeFileSync(join(proj, "report", "report.tex"), "\\begin{abstract}T2* = 38.6 s (edited).\\end{abstract}\n");
check("an edit afterwards makes the sweep stale", outstandingFinalSteps(proj).some((s) => /changed since the sweep/.test(s)));

console.log("\n[the verdict is read from the answer, conservatively]");
answer = "## Summary\nTwo.\n\n## Contradictions\n### T2* at the clock point\n- 38.6 s @ report.tex abstract\n- 41.0 s @ results.json computed.T2\nWhy incompatible: same quantity.\nResolution required: reconcile.\n\n### A_hfs\n- -115 MHz @ E2_b invariants\n- -163 MHz @ ledger\nWhy incompatible: same constant.\nResolution required: reconcile.\n\nCOUNTS quantities_checked=4 contradictions_found=0 definition_concerns=0";
res = await tool.execute("t2", { agent: "contradiction_auditor", task: "Sweep." });
text = res.content[0].text;
fm = parseAuditFrontmatter(extractFrontmatterBlock(readFileSync(sweepPath, "utf-8")) ?? "");
check("two ### entries count although COUNTS says 0", fm.status === "contradictions" && /contradictions_found: 2/.test(readFileSync(sweepPath, "utf-8")), JSON.stringify(fm));
check("the entries come back to the brain", text.includes("### T2* at the clock point") && text.includes("### A_hfs"));
check("the COUNTS line is not left in the body", !readFileSync(sweepPath, "utf-8").includes("COUNTS quantities_checked"));

const a1 = parseSweepAnswer("```markdown\n## Summary\nok\n\n## Contradictions\n### None\n\nCOUNTS quantities_checked=3 contradictions_found=0 definition_concerns=0\n```");
check("a fenced answer is read, and a '### None' heading is not an entry", a1?.contradictions === 0 && a1?.quantitiesChecked === 3, JSON.stringify(a1));
const a3 = parseSweepAnswer("## Summary\nok\n\n## Contradictions\nNone.\n\n**COUNTS quantities_checked=46 contradictions_found=0 definition_concerns=0**");
check("a bold COUNTS line is read (bench S1, Dy)", a3?.quantitiesChecked === 46, JSON.stringify(a3));
const a2 = parseSweepAnswer("## Summary\nok\n\n## Contradictions\nNone.\n");
check("no COUNTS line but the section → read, clean", a2?.contradictions === 0);
check("neither → unreadable", parseSweepAnswer("I could not decide.") === null);

// Through runSweepSpawn: the spawn tool would go on to run the real agent.
const before = readFileSync(sweepPath, "utf-8");
answer = "I could not decide.";
let fb: any = await runSweepSpawn({ projectDir: proj, getApiKey: () => "unused" });
check("an unreadable answer writes nothing and hands over to the agent", typeof fb.fallback === "string" && /COUNTS/.test(fb.fallback) && readFileSync(sweepPath, "utf-8") === before, JSON.stringify(fb));
setSweepCompleterForGate(async () => ({ text: "", error: "400 invalid request" }));
fb = await runSweepSpawn({ projectDir: proj, getApiKey: () => "unused" });
check("a failed request writes nothing and hands over to the agent (no spawn-again loop)", typeof fb.fallback === "string" && /400/.test(fb.fallback) && readFileSync(sweepPath, "utf-8") === before, JSON.stringify(fb));

console.log("\n[finish() re-runs a missing or stale sweep itself]");
{
  // The §L1 fixture of smoke_finish_gate: every gate before the sweep passes.
  const d = join(tmp, "fin");
  for (const sub of [".agent", "report/figures", "reviews", "notes"]) mkdirSync(join(d, sub), { recursive: true });
  writeFileSync(join(d, "RESEARCH.md"), "# probe\n");
  writeFileSync(join(d, "report", "figures", "a.pdf"), "%PDF-1.4\n% figure\n");
  writeFileSync(join(d, "report", "report.tex"), ["\\documentclass{article}", "\\usepackage{graphicx}", "\\begin{document}",
    "Figure~\\ref{fig:a} shows the scene.", "\\begin{figure}\\includegraphics{figures/a.pdf}\\caption{Scene.}\\label{fig:a}\\end{figure}",
    "\\end{document}", ""].join("\n"));
  writeFileSync(join(d, "notes", "report_outline.md"), "type: empirical\n\n## The scene renders red and blue\n");
  writeFileSync(join(d, "report", "report.pdf"), "%PDF-1.4\n% fixture\n");
  const { buildResearchTools } = await import("../src/tools/index.ts");
  const finish = async (key: string | undefined) => {
    const { tools } = buildResearchTools(d, { PROJECT_DIR: d }, () => key, {});
    const r = await tools.find((t: any) => t.name === "finish").execute("f", { summary: "probe" });
    return String(r?.content?.[0]?.text ?? "");
  };
  let calls = 0;
  const clean = "## Summary\nok\n\n## Contradictions\nNone.\n\nCOUNTS quantities_checked=2 contradictions_found=0 definition_concerns=0";
  const dirty = "## Summary\nOne.\n\n## Contradictions\n### Scene colour\n- red @ report.tex\n- blue @ ledger\nWhy incompatible: same object.\nResolution required: reconcile.\n\nCOUNTS quantities_checked=2 contradictions_found=1 definition_concerns=0";
  let reply = clean;
  setSweepCompleterForGate(async () => { calls++; return { text: reply }; });
  let t = await finish("k");
  check("missing sweep: finish runs it and moves on to the next gate", calls === 1 && !/contradiction_sweep\.md/.test(t.split("\n")[0]) && /typesetter/.test(t.split("\n")[0]), t.split("\n")[0]);
  t = await finish("k");
  check("current sweep: not re-run", calls === 1);
  writeFileSync(join(d, "report", "report.tex"), readFileSync(join(d, "report", "report.tex"), "utf-8") + "% layout edit\n");
  reply = dirty;
  t = await finish("k");
  check("stale sweep: re-run; its contradictions refuse, and the brain is told finish() re-sweeps", calls === 2 &&
    t.startsWith('Cannot finish: reviews/contradiction_sweep.md status is "contradictions"') && /re-runs the sweep itself/.test(t) && t.includes("### Scene colour"), t.slice(0, 300));
  t = await finish("k");
  check("unchanged sources after a dirty sweep: not re-run, same refusal", calls === 2 && /status is "contradictions"/.test(t));
  setSweepCompleterForGate(null);
  writeFileSync(join(d, "report", "report.tex"), readFileSync(join(d, "report", "report.tex"), "utf-8") + "% another edit\n");
  t = await finish(undefined);
  check("no key: nothing calls out, the gate's own refusal stands", calls === 2 && /status is "contradictions"/.test(t), t.slice(0, 160));
  reply = clean;
  setSweepCompleterForGate(async () => { calls++; return { text: reply }; });
}

console.log("\n[too large for one request → the agent]");
let called = false;
setSweepCompleterForGate(async () => { called = true; return { text: answer }; });
writeFileSync(join(proj, "report", "report.tex"), "x".repeat(600_000));
check("buildSweepRequest gives up", buildSweepRequest(proj) === null);
check("runSweepSpawn hands over to the agent without a request", "fallback" in (await runSweepSpawn({ projectDir: proj, getApiKey: () => "unused" })) && !called);
process.env.LUXAS_SWEEP_MODE = "agent";
check("LUXAS_SWEEP_MODE=agent restores the agent", sweepMode() === "agent");
delete process.env.LUXAS_SWEEP_MODE;

setSweepCompleterForGate(null);
rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
