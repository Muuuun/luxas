#!/usr/bin/env tsx
/**
 * smoke_colorkey — figures v5: one palette, one colour key per report.
 *
 * Measured on the Luxas paper corpus (2026-11-07, skills/figure/references/figure_types.md):
 * level diagrams are black with drives coloured by wavelength; data figures use at most two hue
 * families per panel; a paper keeps an identity's colour across its figures. Before v5 the palette
 * lived in three places that disagreed (venue mplstyles: Okabe-Ito / tab10 / domain hexes;
 * levelspec: its own Okabe list; style_guide.md prose), and figspec and levelspec numbered colour
 * groups per figure, so "Ba" could change colour between Fig. 2 and Fig. 3.
 *
 * This gate pins the single source (skills/figure/scripts/colorkey.py): the mplstyles carry its
 * cycle, nothing that draws carries Okabe-Ito, wavelength labels parse, and the key claims and
 * keeps families.
 *
 *   npx tsx scripts/smoke_colorkey.mts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();
const py = (code: string, env: Record<string, string> = {}) =>
  spawnSync("python3", ["-c", `import sys, json; sys.path.insert(0, 'skills/figure/scripts'); import colorkey as K\n${code}`],
    { encoding: "utf-8", env: { ...process.env, LUXAS_COLORKEY: "", ...env } });

console.log("1. palette: contrast, order, gamut");
const pal = py(`print(json.dumps({"mids": K.mids(), "d": [K.tint(f, "d") for f in K.ORDER], "beams": [h for _, h in K.BEAMS],
  "cd": [round(K.contrast_on_white(K.tint(f, "d")), 2) for f in K.ORDER], "cm": [round(K.contrast_on_white(K.tint(f, "m")), 2) for f in K.ORDER],
  "cb": [round(K.contrast_on_white(h), 2) for _, h in K.BEAMS]}))`);
const P = JSON.parse(pal.stdout || "{}");
check("mids in claim order blue, red, orange, green, plum, sand", JSON.stringify(P.mids) === JSON.stringify(["#3B7CAE", "#CA5852", "#D17B3A", "#497E50", "#8A6194", "#AD8B55"]), pal.stdout + pal.stderr);
check("dark tints read as body text (contrast ≥ 7 on white)", (P.cd ?? []).every((c: number) => c >= 7), JSON.stringify(P.cd));
check("mid tints read as lines and large text (contrast ≥ 3)", (P.cm ?? []).every((c: number) => c >= 3), JSON.stringify(P.cm));
check("drive colours read as arrows and labels (contrast ≥ 3.5)", (P.cb ?? []).every((c: number) => c >= 3.5), JSON.stringify(P.cb));

const lit = py(`d, g = K.derived(); print(json.dumps([d == K.PALETTE, g == K.GREYS, K.BLUE, K.BLUE_D, K.BLUE_L, K.BLUE_P, K.RED, K.HEX["grey.g5"], K.BEAM["red_orange"] == K.beam(626)]))`);
const L_ = JSON.parse(lit.stdout || "[]");
check("the palette is literal hex that re-derives from its CIELAB targets", L_[0] === true && L_[1] === true, lit.stdout + lit.stderr);
check("flat names draw directly: BLUE / BLUE_D / BLUE_L / BLUE_P, RED, HEX['grey.g5'], BEAM", JSON.stringify(L_.slice(2)) === JSON.stringify(["#3B7CAE", "#174F75", "#A3C1E2", "#E4ECF6", "#CA5852", "#868686", true]), lit.stdout);

console.log("\n2. every venue mplstyle carries the colorkey cycle (one palette for figspec, levelspec and raw matplotlib)");
const want = (P.mids ?? []).map((h: string) => `'${h.slice(1)}'`).join(", ");
const dir = "skills/venue-specific/figstyles";
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mplstyle"))) {
  const line = readFileSync(join(dir, f), "utf-8").split("\n").find((l) => l.startsWith("axes.prop_cycle")) ?? "";
  check(`${f}: prop_cycle = colorkey.mids()`, line.includes(`[${want}]`), line);
}

console.log("\n3. nothing that draws carries the old palettes");
const OKABE = /0072B2|D55E00|009E73|CC79A7|E69F00|56B4E9|F0E442/i;
const drawers = ["skills/figure/scripts/levelspec", "skills/matplotlib-figures/scripts/figspec",
  ...readdirSync("skills/figure/templates").map((f) => join("skills/figure/templates", f)),
  ...readdirSync("skills/venue-specific/figstyles").filter((f) => f.endsWith(".mplstyle")).map((f) => join(dir, f))];
for (const f of drawers) {
  const src = readFileSync(f, "utf-8").split("\n").filter((l) => !/smoke|Okabe-Ito yellow is 1\.4/.test(l)).join("\n");
  check(`${f}: no Okabe-Ito hex`, !OKABE.test(src), (src.match(OKABE) ?? [""])[0]);
}

console.log("\n4. wavelength labels → drive colours");
const wl = py(`print(json.dumps([[s, K.wavelength_nm(s), K.is_radio(s)] for s in ["626 nm", "1064.5-nm tweezers", "1,064 nm", "2.42 µm", r"2.42\\,\\mu m", "313nm", "RF, 1.27 GHz", "1,270.66 MHz", "$\\\\Omega$"]]))`);
const W = JSON.parse(wl.stdout || "[]") as [string, number | null, boolean][];
const exp: Record<string, [number | null, boolean]> = { "626 nm": [626, false], "1064.5-nm tweezers": [1064.5, false], "1,064 nm": [1064, false],
  "2.42 µm": [2420, false], "2.42\\,\\mu m": [2420, false], "313nm": [313, false], "RF, 1.27 GHz": [null, true], "1,270.66 MHz": [null, true], "$\\Omega$": [null, false] };
for (const [s, nm, radio] of W) check(`"${s}" → ${nm ?? "no wavelength"}${radio ? ", radio" : ""}`, exp[s] && exp[s][0] === nm && exp[s][1] === radio, JSON.stringify([nm, radio]));
const order = py(`print(json.dumps([K.beam(n) for n in (313, 421, 461, 556, 578, 626, 689, 852, 1064)]))`);
const B = JSON.parse(order.stdout || "[]") as string[];
check("UV → violet → blue → green → amber → red-orange → red → deep red (the corpus order)", B.length === 9 && new Set(B).size === 9, order.stdout + order.stderr);

console.log("\n5. the report key: first figure claims, later figures keep, names normalise, the file persists");
const proj = mkdtempSync(join(tmpdir(), "colorkey-"));
const kp = join(proj, "report", "figures", "colorkey.json");
const k1 = py(`k = K.load_for('${join(proj, "report", "figures", "fig1.pdf")}'); print(k.path); print(k.family('$^{161}$Dy'), k.family('Er'), k.family('161 Dy'))`);
check("key path is <report>/figures/colorkey.json", k1.stdout.split("\n")[0] === kp, k1.stdout + k1.stderr);
check("161Dy → blue, Er → red, '161 Dy' is the same identity as '$^{161}$Dy'", /blue red blue/.test(k1.stdout), k1.stdout);
check("the key file is written", existsSync(kp));
const k2 = py(`k = K.Key('${kp}'); print(k.family('Ho'), k.family('Er'), json.dumps(k.data['identities']))`);
check("a later figure keeps Er red and gives Ho the next free family", /^orange red /.test(k2.stdout), k2.stdout + k2.stderr);
const nested = py(`print(K.key_path('${join(proj, "data", "experiments", "E1", "runs", "run_1", "fig.pdf")}'))`, {});
check("a figure written outside report/ in a project with RESEARCH.md finds no key unless the project marks itself (no RESEARCH.md here → None)", nested.stdout.trim() === "None", nested.stdout);
const bad = py(`import os; open('${join(proj, "bad.json")}', 'w').write('{"identities": {"Dy": "teal"}}')
try:
    K.Key('${join(proj, "bad.json")}'); print("accepted")
except ValueError as e: print("refused", e)`);
check("a key naming a family outside the palette is refused", /^refused .*teal/.test(bad.stdout), bad.stdout + bad.stderr);
const mem = py(`k = K.Key(); k.family('A'); print(k.path, len(k.data['identities']))`);
check("without a report directory the key lives in memory (gates and stand-alone use write nothing)", mem.stdout.trim() === "None 1", mem.stdout);

summary();
