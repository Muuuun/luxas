/**
 * smoke_figlint_pdf — the PDF-layer linter catches what the reader sees
 * (collisions, clipping, tiny print-size text, dense labels) in ANY figure PDF
 * (matplotlib or TikZ), and figlint_core's composition budgets fire on the
 * shapes the pp-vs-ss run shipped (8-series spaghetti, legend over data, inset over data).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "figlint-pdf-"));
const py = `
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt, numpy as np
x = np.linspace(0, 10, 50)
# clean
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x)); ax.set_xlabel("x (s)"); ax.set_ylabel("y (V)")
fig.savefig("${dir}/clean.pdf", bbox_inches="tight"); plt.close(fig)
# colliding + tiny + dense
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x))
ax.text(5, 0, "label one is long", fontsize=9); ax.text(5.2, 0.02, "label two is long", fontsize=9)
for i in range(45): ax.text(i*0.2, -0.9 + (i%5)*0.05, "t%d" % i, fontsize=2)
fig.savefig("${dir}/bad.pdf", bbox_inches="tight"); plt.close(fig)
# budgets: 8 series + legend over data + inset over data
fig, ax = plt.subplots(figsize=(3.4, 2.4))
for k in range(8): ax.plot(x, np.sin(x + k/3), label="s%d" % k)
ax.legend(loc="center"); ax.text(1,0,"a"); ax.text(2,0,"b"); ax.text(3,0,"c"); ax.text(4,0,"d"); ax.text(6,0,"e")
ins = ax.inset_axes([0.3, 0.3, 0.4, 0.4]); ins.plot(x, x)
fig.savefig("${dir}/budget.pdf", bbox_inches="tight"); plt.close(fig)
# text over data vs text beside data
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x), lw=1.5)
ax.text(5.0, np.sin(5.0), "label ON the curve", ha="center", va="center", fontsize=9)
ax.annotate("label beside the curve", xy=(2, np.sin(2)), xytext=(2, -0.85), fontsize=8, ha="center")
fig.savefig("${dir}/overdata.pdf", bbox_inches="tight"); plt.close(fig)
# one annotation with a mathtext font switch must not collide with itself
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x))
ax.annotate("Best: F = 0.9967 at R = 2.0 um, $\\Omega$ = 160 MHz", xy=(1, -0.9), fontsize=8)
fig.savefig("${dir}/mathtext.pdf", bbox_inches="tight"); plt.close(fig)
`;
writeFileSync(join(dir, "make.py"), py);
const hook = "skills/matplotlib-figures/lint_hook";
const r = spawnSync("python3", [join(dir, "make.py")], { encoding: "utf-8", env: { ...process.env, PYTHONPATH: hook, MPLBACKEND: "Agg" } });
check("fixture PDFs render", r.status === 0, r.stderr.slice(-300));
const core = r.stderr;
check("figlint_core WARN: >6 series overlaid", /8 line series overlaid/.test(core), core.slice(-400));
check("figlint_core WARN: >4 annotations", /5 in-axes annotations/.test(core));
check("figlint_core ERROR: legend covers data", /legend covers \d+ data points/.test(core));
check("figlint_core ERROR: inset covers data", /inset covers \d+ data points/.test(core));
check("figlint_core ERROR: annotation over a data line", /annotation "label ON the curve" lies over a data line/.test(core), core.slice(-500));
check("figlint_core: a label beside the curve is not flagged", !/label beside the curve/.test(core));
const lint = (f: string, extra: string[] = []) => spawnSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", join(dir, f), "--json", ...extra], { encoding: "utf-8" });
const clean = lint("clean.pdf", ["--width", "3.4"]);
check("clean PDF: exit 0, no errors", clean.status === 0 && JSON.parse(clean.stdout).errors.length === 0, clean.stdout.slice(0, 200) + clean.stderr.slice(0, 200));
const bad = lint("bad.pdf", ["--width", "3.4"]);
const bj = JSON.parse(bad.stdout || "{}");
check("bad PDF: exit 2 with a collision", bad.status === 2 && bj.errors.some((e: string) => /collision "label (one|two) is long" ⊗ "label (one|two) is long"/.test(e)), bad.stdout.slice(0, 300));
check("bad PDF: tiny text at print width flagged", bj.errors.some((e: string) => /tiny text/.test(e)));
check("bad PDF: dense-text warning", bj.warnings.some((w: string) => /dense text/.test(w)));
check("print-width scaling: 2 pt text is fine at 2× width", (() => { const j = JSON.parse(lint("bad.pdf", ["--width", "12"]).stdout); return !j.errors.some((e: string) => /tiny/.test(e)); })());
const mt = JSON.parse(lint("mathtext.pdf", ["--width", "3.4"]).stdout || "{}");
check("mathtext font-switch fragments of one annotation are not a collision", (mt.errors ?? []).length === 0, JSON.stringify(mt.errors));
const missing = spawnSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", join(dir, "nope.pdf"), "--json"], { encoding: "utf-8" });
check("unreadable file: exit 3 with JSON", missing.status === 3 && /unreadable/.test(missing.stdout));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the PDF-layer lint sees what the reader sees; budgets fire on spaghetti.");
