/**
 * smoke_schematic_template — the label-slot TikZ template compiles and passes
 * figlint-pdf at full text width (no collisions, no clipped/tiny text).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "schematic-"));
copyFileSync("skills/figure/templates/schematic_slots.tex", join(dir, "s.tex"));
const pdflatex = ["pdflatex", "/Library/TeX/texbin/pdflatex", "/usr/bin/pdflatex"].find((p) => spawnSync(p, ["--version"], { encoding: "utf-8" }).status === 0);
check("pdflatex available", !!pdflatex);
const c = spawnSync(pdflatex!, ["-interaction=nonstopmode", "-halt-on-error", "s.tex"], { cwd: dir, encoding: "utf-8" });
check("template compiles", c.status === 0, (c.stdout || "").split("\n").filter((l) => /^!/.test(l)).join(" | ").slice(0, 300));
const l = spawnSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", join(dir, "s.pdf"), "--json", "--width", "7.0"], { encoding: "utf-8" });
const j = JSON.parse(l.stdout || "{}");
check("template is lint-clean at 7 in (no collisions / clipping / tiny text)", l.status === 0 && (j.errors ?? []).length === 0, JSON.stringify(j.errors ?? j));
check("template has the demo labels (≥ 5 text lines)", (j.lines ?? 0) >= 5, String(j.lines));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — schematics start from slots, not free-hand.");
