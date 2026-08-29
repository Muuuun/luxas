/**
 * smoke_figure_spec_only — figures v3: an agent with `figureSpecOnly` cannot write a plotting
 * script (savefig / pyplot) or run one from bash; derive scripts and .figspec.json pass.
 * Live probe 2026-08-29: two of four illustrator_write spawns bypassed the prompt mandate.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSafetyWrapper, plottingScriptReason } from "../src/agents/safety-wrappers.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "speconly-"));
mkdirSync(join(dir, "data/experiments/E1_x/scripts"), { recursive: true });
mkdirSync(join(dir, "data/experiments/E1_x/figures"), { recursive: true });
const calls: string[] = [];
const fake = (name: string) => ({ name, execute: async (_id: string, params: any) => { calls.push(`${name}:${params.path ?? params.command}`); return { content: [{ type: "text", text: "ok" }] }; } });
const wrap = buildSafetyWrapper({ figureSpecOnly: true, writeOnExistingPolicy: "allow_as_read" })!;
const [w, b] = wrap([fake("write"), fake("bash")], dir, { EXPERIMENT_ID: "E1_x" });
// blocked() returns plain content prefixed "BLOCKED:" (no isError flag) — that prefix is the refusal signal.
const run = async (tool: any, params: any) => { const r = await tool.execute("t", params); const t = String(r?.content?.[0]?.text ?? ""); return /^BLOCKED:/.test(t) ? t : ""; };

const plot = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig.savefig('report/figures/x.pdf')\n";
const derive = "import numpy as np, csv\nA = np.logspace(0, 3, 50)\nwith open('data/experiments/E1_x/runs/run_1/data/model.csv', 'w') as f:\n    f.write('A,g\\n')\n";
check("unit: plotting script recognised", !!plottingScriptReason("data/experiments/E1_x/scripts/plot_x.py", plot));
check("unit: derive script (no matplotlib) is fine", !plottingScriptReason("data/experiments/E1_x/scripts/derive_x.py", derive));
check("unit: non-.py never matches", !plottingScriptReason("notes/x.md", plot));
const e1 = await run(w, { path: "data/experiments/E1_x/scripts/plot_x.py", content: plot });
check("write: plotting .py refused with the figspec hint", /refused: it plots/.test(e1) && /figspec/.test(e1), e1.slice(0, 120));
check("write: derive .py allowed", (await run(w, { path: "data/experiments/E1_x/scripts/derive_x.py", content: derive })) === "");
check("write: .figspec.json allowed", (await run(w, { path: "data/experiments/E1_x/figures/x.figspec.json", content: "{}" })) === "");
const e2 = await run(b, { command: "cat > data/experiments/E1_x/scripts/plot_x.py <<'EOF'\nimport matplotlib.pyplot as plt\nplt.savefig('x.pdf')\nEOF" });
check("bash: heredoc that writes a plotting script refused", /refused/.test(e2), e2.slice(0, 120));
const e3 = await run(b, { command: "python3 data/experiments/E1_x/scripts/plot_x.py" });
check("bash: running a plot_*.py refused", /refused/.test(e3), e3.slice(0, 120));
check("bash: rendering a spec allowed", (await run(b, { command: "python3 $LUXAS_ROOT/skills/matplotlib-figures/scripts/figspec data/experiments/E1_x/figures/x.figspec.json" })) === "");
check("bash: derive script allowed", (await run(b, { command: "python3 data/experiments/E1_x/scripts/derive_x.py" })) === "");
if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nall figure-spec-only checks passed");
