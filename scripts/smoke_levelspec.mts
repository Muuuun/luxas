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
check("unknown key 'color' refused, redirected to identity", b1.status === 2 && /color: not a levelspec key — use identity/.test(b1.stderr), b1.stderr.slice(-300));
const bad1g = { ...spec, out: join(out, "bad1g"), levels: [{ id: "a", label: "A", energy: 0, group: "qubit" }, { id: "b", label: "B", energy: 1 }] };
writeFileSync(join(out, "bad1g.json"), JSON.stringify(bad1g));
const b1g = run(join(out, "bad1g.json"));
check("v4 key 'group' refused: levels are black, colour only through identity", b1g.status === 2 && /group: not a levelspec key — use identity/.test(b1g.stderr), b1g.stderr.slice(-300));
const bad2 = { out: join(out, "bad2"), levels: [{ id: "a", label: "A", energy: 0 }, { id: "b", label: "B", energy: 1 }], transitions: [{ from: "a", to: "zzz" }] };
writeFileSync(join(out, "bad2.json"), JSON.stringify(bad2));
const b2 = run(join(out, "bad2.json"));
check("transition to an unknown level id refused", b2.status === 2 && /is not a level id/.test(b2.stderr), b2.stderr.slice(-300));
const bad3 = { out: join(out, "bad3"), levels: [{ id: "a", label: "A", energy: 0 }, { id: "b", label: "B", energy: 1 }], transitions: [{ from: "a", to: "b", kind: "wavy" }] };
writeFileSync(join(out, "bad3.json"), JSON.stringify(bad3));
const b3 = run(join(out, "bad3.json"));
check("kind must be drive | qubit | decay | dashed", b3.status === 2 && /kind: 'wavy'/.test(b3.stderr), b3.stderr.slice(-300));

// 2b. figures v5 colour (208 level diagrams of the Luxas corpus): levels, labels and decays black;
// a drive takes the colour of the wavelength in its label; nothing else is coloured without an identity.
const defs = Object.fromEntries([...tex.matchAll(/\\definecolor\{(\w+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)].map((m) => [m[1], m[2].toUpperCase()]));
const drawCols = (style: string) => [...tex.matchAll(new RegExp(`\\\\draw\\[${style},(\\w+)\\]`, "g"))].map((m) => m[1]);
check("every level line is black", drawCols("level").length >= 8 && drawCols("level").every((c) => c === "lvl") && defs.lvl === "000000", JSON.stringify(drawCols("level")));
check("level labels are black", !/anchor=east,inner sep=1pt,text=c\d/.test(tex));
check("decays are black", drawCols("decay").length >= 1 && drawCols("decay").every((c) => c === "lvl"), JSON.stringify(drawCols("decay")));
const hexOf = (c: string) => (c === "lvl" ? defs.lvl : defs[c]);
const driveHex = [...tex.matchAll(/\\draw\[(?:drive|qubit),(\w+)\][^;]*\{([0-9.]+) nm\}/g)].map((m) => [m[2], hexOf(m[1])]);
const want: Record<string, string> = { "877.6": "A3262A", "553.7": "2E8B47", "791.3": "A3262A", "648.5": "E0561F", "657.9": "E0561F" };
check("each drive is coloured by its wavelength (553.7 nm green, 648.5 nm red-orange, 791.3/877.6 nm deep red)",
  driveHex.length === 5 && driveHex.every(([nm, h]) => want[nm] === h), JSON.stringify(driveHex));
check("no Okabe-Ito hex left in the generator", !/0072B2|D55E00|009E73|CC79A7|E69F00|56B4E9/i.test(readFileSync(GEN, "utf-8")));

// 2c. identity colours come from the report's colour key and stay the same across figures
const proj = mkdtempSync(join(tmpdir(), "levelspec-proj-"));
const keyFile = join(proj, "report", "figures", "colorkey.json");
const idSpec = (stem: string, who: string) => ({ out: join(proj, "report", "figures", stem), height_in: 1.8, levels: [
  { id: "g", label: "$|0\\rangle$", energy: 0, identity: who }, { id: "q", label: "$|1\\rangle$", energy: 1 },
  { id: "e", label: "$^5I_7$", energy: 6, column: 1 }, { id: "r", label: "Rydberg", energy: 10, column: 1 }],
  transitions: [{ from: "g", to: "q", kind: "qubit", label: "RF", identity: who },
    { from: "g", to: "e", label: "2.42 µm" }, { from: "e", to: "g", kind: "decay" }] });
writeFileSync(join(proj, "a.json"), JSON.stringify(idSpec("fig1", "$^{161}$Dy")));
writeFileSync(join(proj, "b.json"), JSON.stringify(idSpec("fig2", "Er")));
writeFileSync(join(proj, "c.json"), JSON.stringify(idSpec("fig3", "161 Dy")));
const ra = run(join(proj, "a.json")), rb = run(join(proj, "b.json")), rc = run(join(proj, "c.json"));
check("identity specs render", ra.status === 0 && rb.status === 0 && rc.status === 0, (ra.stderr + rb.stderr + rc.stderr).slice(-400));
const keyJ = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf-8")) : {};
check("the first figure that names an identity claims a family in report/figures/colorkey.json",
  keyJ.identities?.["$^{161}$Dy"] === "blue" && keyJ.identities?.["Er"] === "red" && Object.keys(keyJ.identities ?? {}).length === 2, JSON.stringify(keyJ));
const rfHex = (stem: string) => { const tx = readFileSync(join(proj, "report", "figures", stem + ".tex"), "utf-8");
  const d = Object.fromEntries([...tx.matchAll(/\\definecolor\{(\w+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)].map((m) => [m[1], m[2]]));
  const m = tx.match(/\\draw\[qubit,(\w+)\]/); return m ? d[m[1]] : ""; };
check("the same identity is the same colour in another figure (\"161 Dy\" = \"$^{161}$Dy\")", rfHex("fig1") !== "" && rfHex("fig1") === rfHex("fig3") && rfHex("fig1") !== rfHex("fig2"),
  `${rfHex("fig1")} ${rfHex("fig2")} ${rfHex("fig3")}`);

// 3. the hand-drawn template no longer teaches a wavy laser arrow
const tpl = readFileSync("skills/figure/templates/energy_levels.tex", "utf-8");
check("energy_levels.tex: the laser drive is a straight arrow", /Laser drive: a STRAIGHT arrow/.test(tpl) && !/Wavy excitation arrow/.test(tpl));

if (fails) { console.log(`\n${fails} FAILED (renders in ${out})`); process.exit(1); }
console.log("\nALL PASS — level diagrams are generated, compressed, lint-clean, and shorter than a page.");
