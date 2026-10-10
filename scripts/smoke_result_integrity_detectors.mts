/**
 * smoke_result_integrity_detectors — v3 D3: (a) a computed value equal to a
 * literature `invariants` leaf to 1e-6 with no job that ran the experiment's
 * scripts is capped at indicative (reproduction with a job is not); (b) several
 * runs with no stated selection policy raise a non-blocking selection-policy issue.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaimTable, experimentRanScripts } from "../src/claims-table.ts";
import { reportIntegrityIssues } from "../src/tools/report-integrity.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
delete process.env.LUXAS_ANCHOR_EXFIL;
function project(opts: { value: number; job?: boolean; runs?: number; policy?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "detect-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "frame.md"), "# F\n\n## Headline quantities\n- `c6_ss_43`\n");
  const base = join(dir, "data", "experiments", "E1_x");
  for (let k = 1; k <= (opts.runs ?? 1); k++) {
    mkdirSync(join(base, "runs", `run_${k}`), { recursive: true });
    writeFileSync(join(base, "runs", `run_${k}`, "results.json"), JSON.stringify({
      invariants: { c6_ss_43s_low2012: { value_ghz_um6: -2.441, source: "Low2012", anchored_to: "Rb 43S vdW" } },
      computed: { quantities: [{ id: "c6_ss_43", key: "computed.c6_ss_43", headline: true, observable: "Rb 43S+43S van der Waals C6 in GHz um^6, signed, negative = attractive", uncertainty: 0.05, inputs: {} }], c6_ss_43: opts.value },
    }));
  }
  writeFileSync(join(dir, "notes", "experiments.md"), `# Experiments\n\n## L2.1 — x\n\n**Status:** Complete\n${opts.policy ? "runs executed: 3; reported: run_3 because last converged\n" : ""}`);
  writeFileSync(join(dir, "report.tex"), "\\documentclass{article}\\begin{document}x\\end{document}");
  mkdirSync(join(dir, "report"), { recursive: true }); writeFileSync(join(dir, "report", "report.tex"), "\\documentclass{article}\\begin{document}x\\end{document}");
  if (opts.job) {
    mkdirSync(join(dir, ".agent", "jobs", "job_abc123def456"), { recursive: true });
    writeFileSync(join(dir, ".agent", "jobs", "job_abc123def456", "state.json"), JSON.stringify({ id: "job_abc123def456", ownerAgentId: "brain.experiment-x", ownerAgentType: "experiment", ownerProcessPid: 1, toolCallId: null, command: "cd " + dir + " && python3 data/experiments/E1_x/scripts/c6.py", cwd: dir, pid: 2, startedAt: 1, deadlineAt: 2, timeoutSec: 60, status: "done", endedAt: 2, exitCode: 0, signal: null, cause: "completed", logPath: "x" }));
  }
  return dir;
}
const row = (d: string) => buildClaimTable(d).rows.find((r) => r.id === "c6_ss_43")!;

const exfil = row(project({ value: -2.441 }));
check("value == invariant to 1e-6, no job → capped with the exfiltration reason", exfil.status === "indicative" && exfil.reasons.some((x) => /equals literature input invariants\.c6_ss_43s_low2012\.value_ghz_um6 to 1e-6 with no job/.test(x)), exfil.reasons.join(" | "));
const repro = row(project({ value: -2.441, job: true }));
check("same value with a job that ran the scripts → reproduction, not capped", !repro.reasons.some((x) => /with no job/.test(x)) && repro.reasons.some((x) => /reproduction, not exfiltration/.test(x)), repro.reasons.join(" | "));
check("experimentRanScripts sees the job", experimentRanScripts(project({ value: 1, job: true }), "E1_x") && !experimentRanScripts(project({ value: 1 }), "E1_x"));
const honest = row(project({ value: -2.397 }));
check("a computed value 1.8% off the anchor is not flagged", !honest.reasons.some((x) => /literature input/.test(x)));
process.env.LUXAS_ANCHOR_EXFIL = "0";
check("LUXAS_ANCHOR_EXFIL=0 disables", !row(project({ value: -2.441 })).reasons.some((x) => /literature input/.test(x)));
delete process.env.LUXAS_ANCHOR_EXFIL;

const multi = reportIntegrityIssues(project({ value: -2.397, runs: 3 }));
check("3 runs, no policy line → non-blocking selection-policy issue", multi.some((i) => i.kind === "selection-policy" && !i.blocking && /3 runs/.test(i.text)), JSON.stringify(multi.map((i) => i.kind)));
const stated = reportIntegrityIssues(project({ value: -2.397, runs: 3, policy: true }));
check("policy stated in the ledger → no issue", !stated.some((i) => i.kind === "selection-policy"));
check("single run → no issue", !reportIntegrityIssues(project({ value: -2.397 })).some((i) => i.kind === "selection-policy"));

// §C40 — 5d anchors a cross_validation value in ANY job's output, so a reviewer
// or replicator that cats results.json anchors every value in it. A value only a
// verifier ever printed is disclosed (non-blocking); 5d's blocking is unchanged.
const CAT = Symbol("cat results.json");
type XJob = { type: string | null; cmd: string; out: string | typeof CAT };
const XV_RESULTS = "data/experiments/E2_x/runs/run_1/results.json";
function xvalProject(jobs: XJob[] | null, entries: Array<[string, number, number]> = [["c6", 1.2345, 1.2401]]): string {
  const dir = mkdtempSync(join(tmpdir(), "c40-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "experiments.md"), "# Experiments\n\n## L2.2 — x\n\n**Status:** Complete\n");
  mkdirSync(join(dir, "data", "experiments", "E2_x", "runs", "run_1"), { recursive: true });
  const results = JSON.stringify({ computed: { cross_validation: entries.map(([k, a, b]) => (
    { claim_key: k, value_a: a, method_a: "pairinteraction", value_b: b, method_b: "perturbative sum", tolerance_rel: 0.05 })) } }, null, 2);
  writeFileSync(join(dir, XV_RESULTS), results);
  mkdirSync(join(dir, "report"), { recursive: true });
  writeFileSync(join(dir, "report", "report.tex"), "\\documentclass{article}\\begin{document}x\\end{document}");
  (jobs ?? []).forEach((j, k) => {
    const id = `job_${String(k).padStart(12, "0")}`;
    const jd = join(dir, ".agent", "jobs", id);
    mkdirSync(jd, { recursive: true });
    if (j.type !== null) writeFileSync(join(jd, "state.json"), JSON.stringify({ id, ownerAgentId: `brain.${j.type}-1`, ownerAgentType: j.type, command: j.cmd, status: "done" }));
    writeFileSync(join(jd, "output.log"), j.out === CAT ? results : j.out);
  });
  return dir;
}
const C40_LINE = /appears only in verifier output|not transcript-anchored by any producer job/;
function xval(jobs: XJob[] | null, entries?: Array<[string, number, number]>) {
  const iss = reportIntegrityIssues(xvalProject(jobs, entries));
  const disc = iss.filter((i) => C40_LINE.test(i.text));
  return { iss, disc, lines: disc.flatMap((i) => i.text.split("\n")), blocking: iss.filter((i) => i.blocking) };
}
const sig = (r: ReturnType<typeof xval>) => JSON.stringify(r.blocking.map((i) => [i.kind, i.text]));
const impl = (out: string): XJob => ({ type: "tool_impl", cmd: "python3 data/experiments/E2_x/scripts/c6.py", out });

const vOnly = xval([impl("c6 (pairinteraction) = 1.2345\n"), { type: "replicator", cmd: `cat ${XV_RESULTS}`, out: CAT }]);
const both = xval([impl("c6 = 1.2345\nc6 perturbative = 1.2401\n")]);
check("C40 (1) value_b printed only by a replicator cat → non-blocking disclosure names E2/c6 and 1.2401",
  vOnly.disc.length === 1 && vOnly.disc.every((i) => i.kind === "disclosure" && !i.blocking)
    && vOnly.lines.some((l) => /E2\/c6: value 1\.2401 appears only in verifier output/.test(l))
    && !vOnly.lines.some((l) => /1\.2345|not transcript-anchored by any producer/.test(l)),
  JSON.stringify(vOnly.iss.map((i) => [i.kind, i.blocking, i.text.slice(0, 160)])));
check("C40 (1) blocking issues identical to the producer-prints-both fixture", vOnly.blocking.length === both.blocking.length && sig(vOnly) === sig(both),
  `${sig(vOnly)} vs ${sig(both)}`);
check("C40 (2) producer job prints both values → no disclosure", both.disc.length === 0, JSON.stringify(both.disc.map((i) => i.text)));
const ext = xval([{ type: "experiment_reviewer", cmd: `cat ${XV_RESULTS}`, out: CAT }]);
const extLines = ext.lines.filter((l) => /not transcript-anchored by any producer job/.test(l));
check("C40 (3) only an experiment_reviewer echo → exactly one experiment line, no per-value line",
  extLines.length === 1 && /E2: cross_validation values not transcript-anchored by any producer job: executed outside Luxas or narrated/.test(extLines[0])
    && !ext.lines.some((l) => /appears only in verifier output/.test(l)) && ext.disc.every((i) => !i.blocking),
  JSON.stringify(ext.lines));
check("C40 (3) blocking issues unchanged by the disclosure", sig(ext) === sig(both), `${sig(ext)} vs ${sig(both)}`);
const none = xval([impl("c6 = 1.2345\n")]);
check("C40 (4) no job prints 1.2401 → 5d still blocks, no disclosure line names it",
  none.blocking.some((i) => /Cross-validation integrity failure/.test(i.text) && /E2\/c6: value\(s\) 1\.2401 not found/.test(i.text))
    && !none.lines.some((l) => /1\.2401/.test(l)),
  JSON.stringify(none.iss.map((i) => [i.kind, i.blocking, i.text.slice(0, 120)])));
check("C40 (5) no .agent/jobs (legacy) → no disclosure", xval(null).disc.length === 0);
check("C40 (6) a tool_impl job that also cats results.json counts as producer → no disclosure",
  xval([{ type: "tool_impl", cmd: `python3 data/experiments/E2_x/scripts/c6.py && cat ${XV_RESULTS}`, out: CAT }]).disc.length === 0);
check("C40 (7) a job with no state.json, or owner \"unknown\", counts as producer → no disclosure",
  xval([{ type: null, cmd: "", out: CAT }]).disc.length === 0 && xval([{ type: "unknown", cmd: "", out: CAT }]).disc.length === 0);
check("C40 (8) an *_auditor echo is verifier output → one experiment line",
  xval([{ type: "contradiction_auditor", cmd: `cat ${XV_RESULTS}`, out: CAT }]).lines.filter((l) => /^ *- E2: cross_validation values not transcript-anchored/.test(l)).length === 1);
const many = Array.from({ length: 10 }, (_, k): [string, number, number] => [`q${k}`, 1.1 + k, 7.7 + k]);
const capped = xval([impl(many.map(([, a]) => `${a}`).join("\n")), { type: "reviewer", cmd: `cat ${XV_RESULTS}`, out: CAT }], many);
check("C40 (9) ten verifier-only values → 8 lines plus '... and 2 more' in one issue",
  capped.disc.length === 1 && capped.lines.filter((l) => /appears only in verifier output/.test(l)).length === 8 && capped.lines.some((l) => /\.\.\. and 2 more/.test(l)),
  JSON.stringify(capped.lines));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — a literature number read back is not a computation; N runs need a stated policy; a value only a verifier printed is disclosed.");
