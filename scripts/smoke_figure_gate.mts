/**
 * smoke_figure_gate — compile_latex refuses figures that lint with ERRORs
 * (figures v2): PDF text-layer collisions/tiny text at the figure's print
 * width, plus save-time budget errors from the sidecar when the md5 matches.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { figureLintIssues, includeWidthInches, formatFigureLint } from "../src/tools/report.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
check("width: \\columnwidth → 3.4 in", includeWidthInches("width=\\columnwidth", false) === 3.4);
check("width: \\linewidth in figure* → 7 in", includeWidthInches("width=\\linewidth", true) === 7.0);
check("width: 0.5\\textwidth → 3.5 in", includeWidthInches("width=0.5\\textwidth", false) === 3.5);
check("width: 8cm → 3.15 in", Math.abs(includeWidthInches("width=8cm", false) - 8 / 2.54) < 1e-9);
check("width: none → column (3.4) / starred (7)", includeWidthInches("", false) === 3.4 && includeWidthInches("", true) === 7.0);

const dir = mkdtempSync(join(tmpdir(), "figgate-"));
mkdirSync(join(dir, "figures"));
const py = `
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt, numpy as np
x = np.linspace(0, 10, 50)
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x)); ax.set_xlabel("x (s)"); ax.set_ylabel("y (V)")
fig.savefig("${dir}/figures/clean.pdf", bbox_inches="tight"); plt.close(fig)
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x))
ax.text(5, 0, "label one is long", fontsize=9); ax.text(5.2, 0.02, "label two is long", fontsize=9)
fig.savefig("${dir}/figures/bad.pdf", bbox_inches="tight"); plt.close(fig)
fig, ax = plt.subplots(figsize=(3.4, 2.4))
for k in range(3): ax.plot(x, np.sin(x + k), label="s%d" % k)
ax.legend(loc="center")
fig.savefig("${dir}/figures/legend.pdf", bbox_inches="tight"); plt.close(fig)
`;
writeFileSync(join(dir, "make.py"), py);
const r = spawnSync("python3", [join(dir, "make.py")], { encoding: "utf-8", env: { ...process.env, PYTHONPATH: "skills/matplotlib-figures/lint_hook", MPLBACKEND: "Agg" } });
check("fixtures render with the save-time hook", r.status === 0, r.stderr.slice(-200));
check("sidecar written next to the figure", JSON.parse(readFileSync(join(dir, "figures", "legend.pdf.figlint.json"), "utf-8")).errors.some((e: string) => /legend covers/.test(e)));
writeFileSync(join(dir, "report.tex"), [
  "\\documentclass[twocolumn]{article}\\begin{document}",
  "\\begin{figure}\\includegraphics[width=\\columnwidth]{figures/clean.pdf}\\caption{ok}\\end{figure}",
  "\\begin{figure}\\includegraphics[width=\\columnwidth]{figures/bad}\\caption{bad}\\end{figure}",
  "\\begin{figure*}\\includegraphics[width=\\linewidth]{figures/legend.pdf}\\caption{legend}\\end{figure*}",
  "\\begin{figure}\\includegraphics{figures/missing.pdf}\\end{figure}",
  "\\end{document}",
].join("\n"));
delete process.env.LUXAS_FIGLINT_GATE;
const issues = figureLintIssues(dir, "report.tex");
check("clean figure passes", !issues.some((i) => i.file.includes("clean") && i.errors.length));
check("collision figure fails (extension-less include resolved to .pdf)", issues.some((i) => i.file === "figures/bad.pdf" && i.errors.some((e) => /collision/.test(e))), JSON.stringify(issues).slice(0, 300));
check("sidecar budget error (legend over data) merged into the gate", issues.some((i) => i.file.includes("legend") && i.errors.some((e) => /legend covers/.test(e))));
check("missing file is not this gate's job", !issues.some((i) => i.file.includes("missing")));
check("message names files and the reproduce command", /bad\.pdf[\s\S]*figlint-pdf/.test(formatFigureLint(issues)));
process.env.LUXAS_FIGLINT_GATE = "0";
check("LUXAS_FIGLINT_GATE=0 disables", figureLintIssues(dir, "report.tex").length === 0);
delete process.env.LUXAS_FIGLINT_GATE;
check("hardened bash exports LUXAS_ROOT (prompts reference $LUXAS_ROOT/skills/...)", /LUXAS_ROOT: process\.env\.LUXAS_ROOT \|\| LUXAS_ROOT/.test(readFileSync("src/tools/bash-hardened.ts", "utf-8")));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — figlint finally has a consumer: compile_latex.");
