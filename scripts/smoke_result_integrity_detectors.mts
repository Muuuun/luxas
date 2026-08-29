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
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — a literature number read back is not a computation; N runs need a stated policy.");
