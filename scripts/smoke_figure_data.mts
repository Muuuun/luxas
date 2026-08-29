/**
 * smoke_figure_data — figures v3.1: a shipped figspec built on a coarse sweep (< 20 points)
 * or a highlighted series without σ is listed at finish (non-blocking `figure-data`);
 * points_note / sigma_note or dense data with σ clear it.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { figureDataIssues } from "../src/tools/report-integrity.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "figdata-"));
const E = "data/experiments/E1_x"; mkdirSync(join(dir, E, "figures"), { recursive: true }); mkdirSync(join(dir, E, "runs/run_1/data"), { recursive: true });
const csv = (name: string, n: number) => { writeFileSync(join(dir, E, "runs/run_1/data", name), "x,y,s\n" + Array.from({ length: n }, (_, i) => `${i},${i * 2},0.1`).join("\n") + "\n"); return `${E}/runs/run_1/data/${name}`; };
const coarse = csv("coarse.csv", 4), dense = csv("dense.csv", 25);
const spec = (name: string, x: string, extra: any = {}, sextra: any = {}) => writeFileSync(join(dir, E, "figures", `${name}.figspec.json`), JSON.stringify({ out: `report/figures/${name}`, ...extra, panels: [{ label: "a", series: [{ x: { csv: x, col: "x" }, y: { csv: x, col: "y" }, label: "s", ...sextra }], highlight: { series: 0, at: 1, label: "h" } }] }));

spec("figA", coarse);
let is = figureDataIssues(dir);
check("coarse sweep listed (4 points)", is.some((i) => /figA: series "s" has 4 points/.test(i.text)), is.map((i) => i.text.slice(0, 80)).join(" | "));
check("no σ on a highlighted series listed", is.some((i) => /figA: highlighted series "s" shows no σ/.test(i.text)));
check("all figure-data issues are non-blocking", is.every((i) => i.kind === "figure-data" && !i.blocking));

spec("figA", coarse, { points_note: "discrete lattice angles", sigma_note: "deterministic count" });
is = figureDataIssues(dir);
check("points_note + sigma_note clear both", is.length === 0, is.map((i) => i.text.slice(0, 80)).join(" | "));

spec("figA", dense, {}, { sigma: { csv: dense, col: "s" } });
is = figureDataIssues(dir);
check("dense sweep with σ: nothing listed", is.length === 0, is.map((i) => i.text.slice(0, 80)).join(" | "));

spec("figA", coarse, {}, { role: "model" });
check("model series exempt", figureDataIssues(dir).length === 0);
if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nall figure-data checks passed");
