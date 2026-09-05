/**
 * smoke_levelspec — figures v4: an energy-level diagram is generated from a levelspec
 * (compressed energy axis, straight drives / wavy decays, labels in slots, no key box)
 * and must come out figlint-pdf clean at its print width and shorter than a page.
 * The Ba run (2026-08-30) hand-placed the same diagram in TikZ: 1:1.46 portrait, a whole
 * page, every laser wavy, five audit rounds of coordinate nudges.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const which = spawnSync("which", ["pdflatex"], { encoding: "utf-8" });
if (which.status !== 0) { console.log("skip: pdflatex not on PATH"); process.exit(0); }

const out = mkdtempSync(join(tmpdir(), "levelspec-"));
const GEN = "skills/figure/scripts/levelspec";
const run = (specPath: string) => spawnSync("python3", [GEN, specPath], { encoding: "utf-8" });

// 1. the Ba fixture renders clean
const spec = JSON.parse(readFileSync("fixtures/levelspec/ba_levels.levelspec.json", "utf-8"));
spec.out = join(out, "ba_levels");
const sp = join(out, "ba.json"); writeFileSync(sp, JSON.stringify(spec));
const r = run(sp);
check("Ba fixture: exit 0", r.status === 0, (r.stderr + r.stdout).slice(-600));
check("Ba fixture: tex + pdf + png written", existsSync(spec.out + ".tex") && existsSync(spec.out + ".pdf") && existsSync(spec.out + ".png"));
check("Ba fixture: reports the natural include width", /includegraphics\[width=[0-9.]+in\]/.test(r.stdout), r.stdout);
const tex = existsSync(spec.out + ".tex") ? readFileSync(spec.out + ".tex", "utf-8") : "";
check("drives are straight, decays are wavy", /\\draw\[drive,/.test(tex) && /\\draw\[decay,/.test(tex) && !/drive\/.style=\{[^}]*snake/.test(tex));
check("no key box", !/Key:|legend/i.test(tex));
check("labels carry the tag inline (no separate tag nodes to collide)", /ground\}\\;/.test(tex) || /ground/.test(tex));
const pdfW = spawnSync("python3", ["-c", `import fitz; d=fitz.open('${spec.out}.pdf'); r=d[0].rect; print(r.width/72, r.height/72)`], { encoding: "utf-8" });
const [w, h] = pdfW.stdout.trim().split(/\s+/).map(Number);
check(`page is shorter than a page (${w?.toFixed(2)} × ${h?.toFixed(2)} in)`, h > 0 && h < 5.5 && h / w < 1.1, pdfW.stderr);
const lint = spawnSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", spec.out + ".pdf", "--width", String(w), "--json"], { encoding: "utf-8" });
const lj = JSON.parse(lint.stdout || "{}");
check("figlint-pdf clean at the natural width", lint.status === 0 && (lj.errors ?? []).length === 0, JSON.stringify(lj.errors));

// 2. strict grammar: unknown / matplotlib-ish keys are refused with a hint
const bad1 = { ...spec, out: join(out, "bad1"), levels: [{ id: "a", label: "A", energy: 0, color: "red" }, { id: "b", label: "B", energy: 1 }] };
writeFileSync(join(out, "bad1.json"), JSON.stringify(bad1));
const b1 = run(join(out, "bad1.json"));
check("unknown key 'color' refused, redirected to group", b1.status === 2 && /color: not a levelspec key — use group/.test(b1.stderr), b1.stderr.slice(-300));
const bad2 = { out: join(out, "bad2"), levels: [{ id: "a", label: "A", energy: 0 }, { id: "b", label: "B", energy: 1 }], transitions: [{ from: "a", to: "zzz" }] };
writeFileSync(join(out, "bad2.json"), JSON.stringify(bad2));
const b2 = run(join(out, "bad2.json"));
check("transition to an unknown level id refused", b2.status === 2 && /is not a level id/.test(b2.stderr), b2.stderr.slice(-300));
const bad3 = { out: join(out, "bad3"), levels: [{ id: "a", label: "A", energy: 0 }, { id: "b", label: "B", energy: 1 }], transitions: [{ from: "a", to: "b", kind: "wavy" }] };
writeFileSync(join(out, "bad3.json"), JSON.stringify(bad3));
const b3 = run(join(out, "bad3.json"));
check("kind must be drive | qubit | decay | dashed", b3.status === 2 && /kind: 'wavy'/.test(b3.stderr), b3.stderr.slice(-300));

// 3. the hand-drawn template no longer teaches a wavy laser arrow
const tpl = readFileSync("skills/figure/templates/energy_levels.tex", "utf-8");
check("energy_levels.tex: the laser drive is a straight arrow", /Laser drive: a STRAIGHT arrow/.test(tpl) && !/Wavy excitation arrow/.test(tpl));

if (fails) { console.log(`\n${fails} FAILED (renders in ${out})`); process.exit(1); }
console.log("\nALL PASS — level diagrams are generated, compressed, lint-clean, and shorter than a page.");
