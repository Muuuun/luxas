/**
 * smoke_figplace — authoring-time label placement uses the linter's own
 * occupancy: candidates on a curve, on the legend, on another text are
 * rejected with a reason; the first free one is chosen; none → None (never a
 * silent bad placement).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "figplace-"));
writeFileSync(join(dir, "t.py"), `
import sys, json, numpy as np, matplotlib; matplotlib.use("Agg")
sys.path.insert(0, "skills/matplotlib-figures/lint_hook")
import matplotlib.pyplot as plt
from figplace import free_anchor, annotate_free
x = np.linspace(0, 10, 50)
fig, ax = plt.subplots(figsize=(3.4, 2.4)); ax.plot(x, np.sin(x), label="s"); ax.legend(loc="lower right")
ax.text(1.0, 0.8, "occupied text")
c = [(5.0, float(np.sin(5.0)), "center"), (8.5, -0.85, "center"), (1.2, 0.8, "left"), (2.0, -0.6, "center")]
choice, reasons = free_anchor(ax, "callout", c, fontsize=8, explain=True)
ann = annotate_free(ax, "callout", xy=(5, float(np.sin(5))), candidates=c, fontsize=8)
none = free_anchor(ax, "callout", c[:1], fontsize=8)
print(json.dumps({"choice": choice, "reasons": [r for _, r in reasons], "drawn": ann is not None and list(ann.get_position()), "none": none}))
`);
const r = spawnSync("python3", [join(dir, "t.py")], { encoding: "utf-8", env: { ...process.env, MPLBACKEND: "Agg" } });
check("helper runs", r.status === 0, r.stderr.slice(-300));
const j = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
check("on-curve candidate rejected: crosses a data line", /crosses a data line/.test(j.reasons?.[0] ?? ""), JSON.stringify(j));
check("on-legend candidate rejected: overlaps a box", /overlaps/.test(j.reasons?.[1] ?? ""));
check("on-text candidate rejected", j.reasons?.[2] !== null);
check("first free candidate chosen (2.0, -0.6)", Array.isArray(j.choice) && j.choice[0] === 2.0 && j.choice[1] === -0.6);
check("annotate_free draws at the chosen spot", Array.isArray(j.drawn) && j.drawn[0] === 2.0);
check("no free candidate → None, nothing drawn", j.none === null);
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — labels are placed with the linter's eyes, at write time.");
