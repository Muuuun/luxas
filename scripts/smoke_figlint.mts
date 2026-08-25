/**
 * Smoke test: figlint (the mechanical figure linter, 2026-08-24).
 *
 * Validated against the real production defect the day it was written:
 * plot_fom_comparison.py (single_photon_Rydberg E1) draws bars spanning
 * 1.27..840 ns on a LINEAR axis — figlint flags 663x. The fixtures here pin
 * the three checks and, critically, the false-positive discipline: edge
 * tick labels and bbox_inches="tight" saves must NOT error, because false
 * positives are how linters get ignored.
 *
 * Skips cleanly when python3/matplotlib is unavailable (CI-keyless parity).
 *
 * Run:  npx tsx scripts/smoke_figlint.mts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIGLINT = join(ROOT, "skills/matplotlib-figures/scripts/figlint");

const probe = spawnSync("python3", ["-c", "import matplotlib"], { encoding: "utf8" });
if (probe.status !== 0) { console.log("SKIP — python3/matplotlib unavailable"); process.exit(0); }

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
const run = (script: string) => {
	const d = mkdtempSync(join(tmpdir(), "figlint-"));
	const f = join(d, "plot.py");
	writeFileSync(f, script);
	const r = spawnSync("python3", [FIGLINT, f], { encoding: "utf8", cwd: d, timeout: 120_000 });
	rmSync(d, { recursive: true, force: true });
	return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

{ const r = run(`import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(0.5, 0.5, "label A here", transform=ax.transAxes)
ax.text(0.52, 0.5, "label B overlapping", transform=ax.transAxes)
fig.savefig("o.png")`);
	check("collision detected, exit 2", r.code === 2 && /collision/.test(r.out), r.out.slice(-200)); }

{ const r = run(`import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(1.3, 0.5, "off canvas", transform=ax.transAxes)
fig.savefig("o.png")`);
	check("clipped label detected", r.code === 2 && /clipped/.test(r.out), r.out.slice(-200)); }

{ const r = run(`import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(1.3, 0.5, "off canvas", transform=ax.transAxes)
fig.savefig("o.png", bbox_inches="tight")`);
	check('bbox_inches="tight" suppresses clip errors (canvas expands)', r.code === 0, r.out.slice(-200)); }

{ const r = run(`import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.barh([0,1,2,3,4], [1.27, 1.54, 6.6, 20, 840])
fig.savefig("o.png")`);
	check("the production defect: 660x on linear axis → WARN, exit 0", r.code === 0 && /LINEAR but positive data spans 6\d\dx/.test(r.out), r.out.slice(-250)); }

{ const r = run(`import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.barh([0,1,2,3,4], [1.27, 1.54, 6.6, 20, 840])
ax.set_xscale("log")
ax.set_title("FOM comparison")
fig.savefig("o.png", bbox_inches="tight")`);
	check("log-scale version is clean", r.code === 0 && /clean \(0 warning/.test(r.out), r.out.slice(-200)); }

// The savefig auto-hook (rung 4): hardened bash injects lint_hook onto
// PYTHONPATH, so any python plot script lints itself at save time with no
// re-execution and no opt-in. The prompt-mandated CLI was never invoked on
// the 297nm run; this path does not rely on being read.
{
	const HOOK = join(ROOT, "skills/matplotlib-figures/lint_hook");
	const runHooked = (script: string) => {
		const d = mkdtempSync(join(tmpdir(), "fighook-"));
		const f = join(d, "plot.py");
		writeFileSync(f, script);
		const r = spawnSync("python3", [f], { encoding: "utf8", cwd: d, timeout: 120_000,
			env: { ...process.env, PYTHONPATH: HOOK } });
		rmSync(d, { recursive: true, force: true });
		return { code: r.status, err: r.stderr ?? "", out: r.stdout ?? "" };
	};
	{
		const r = runHooked(`import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(0.5, 0.5, "label A here", transform=ax.transAxes)
ax.text(0.52, 0.5, "label B overlapping", transform=ax.transAxes)
fig.savefig("o.png")
print("SCIENCE-OK")
`);
		check("hook: collision reported on stderr at save time", /\[figlint\] ERROR .*collision/.test(r.err), r.err.slice(-200));
		check("hook: script exit code untouched, stdout intact", r.code === 0 && /SCIENCE-OK/.test(r.out));
	}
	{
		const r = runHooked(`print("no plotting here")
`);
		check("hook: non-matplotlib script completely silent", r.code === 0 && !/figlint/.test(r.err), r.err.slice(-150));
	}
	{
		const r = runHooked(`import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(0.1, 0.8, "clean", transform=ax.transAxes)
fig.savefig("o.png", bbox_inches="tight")
`);
		check("hook: clean tight save produces no figlint output", r.code === 0 && !/figlint/.test(r.err), r.err.slice(-150));
	}
}

// The archetype gallery is the elegance floor: every reference script must
// stay figlint-clean, or the exemplars teach the defects they exist to end.
{
	const refDir = join(ROOT, "skills/matplotlib-figures/references");
	const { readdirSync } = await import("node:fs");
	for (const f of readdirSync(refDir).filter((x: string) => x.endsWith(".py"))) {
		const d = mkdtempSync(join(tmpdir(), "figarch-"));
		const r = spawnSync("python3", [FIGLINT, join(refDir, f)], { encoding: "utf8", cwd: d, timeout: 120_000 });
		rmSync(d, { recursive: true, force: true });
		check(`archetype ${f} is figlint-clean`, r.status === 0, ((r.stdout ?? "") + (r.stderr ?? "")).slice(-200));
	}
}

console.log(failures === 0 ? "\nALL PASS — figlint catches the shipped defect classes without false positives." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
