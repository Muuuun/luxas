/**
 * smoke_figspec — figures v3/v4: the data figures of the pp-vs-ss run (fig2–fig8) plus a
 * v4 fixture (fig9: panel tags, colour groups, where-filter, reference role, envelope)
 * rendered from declarative specs; every PDF must pass figlint-pdf at its print width with
 * 0 errors and the renderer must exit 0. Then the strict grammar: matplotlib vocabulary is
 * refused with the figspec word to use; a label the renderer cannot place is exit 2 AND a
 * sidecar error the compile gate reads (the Ba run's specs used `style`/`legend`/`title`
 * and the renderer ignored them silently — that silence is what sent the run to matplotlib).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const out = mkdtempSync(join(tmpdir(), "figspec-"));
const env = { ...process.env, FIGSPEC_STYLE: "fixtures/figspec/figstyle.mplstyle" };
const FIGSPEC = "skills/matplotlib-figures/scripts/figspec";
const widths: Record<string, number> = { fig2: 3.4, fig3: 3.4, fig4: 3.4, fig5: 7.0, fig6: 3.4, fig7: 7.0, fig8: 3.4, fig9: 7.0 };
for (const f of Object.keys(widths)) {
  const spec = readFileSync(`fixtures/figspec/${f}.figspec.json`, "utf-8").replaceAll("OUT/", out + "/");
  const sp = join(out, `${f}.json`); writeFileSync(sp, spec);
  const r = spawnSync("python3", [FIGSPEC, sp], { env, encoding: "utf-8" });
  check(`${f}: renders with exit 0`, r.status === 0 && existsSync(join(out, `${f}.pdf`)), (r.stderr || "").slice(-400));
  if (r.status !== 0) continue;
  let lint = "", code = 0;
  try { lint = execFileSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", join(out, `${f}.pdf`), "--width", String(widths[f])], { stdio: ["ignore", "pipe", "pipe"] }).toString(); }
  catch (e: any) { code = e.status ?? 1; lint = String(e.stdout ?? "") + String(e.stderr ?? ""); }
  check(`${f}: figlint-pdf clean at ${widths[f]} in`, code === 0 && !/ERROR/.test(lint), lint.split("\n").filter((l) => /ERROR|WARN/.test(l)).join(" | ").slice(0, 300));
  const side = JSON.parse(readFileSync(join(out, `${f}.pdf.figlint.json`), "utf-8"));
  check(`${f}: sidecar written with no errors`, side.source === "figspec" && side.errors.length === 0 && typeof side.md5 === "string");
}

// v4 semantics on fig9: the tag is on the page, the where-filter selected 4 Rb rows, groups share a hue
const txt = spawnSync("python3", ["-c", `import fitz; print(fitz.open('${join(out, "fig9.pdf")}')[0].get_text())`], { encoding: "utf-8" }).stdout;
check("fig9: panel tags are drawn", /T = 4 K/.test(txt) && /T = 300 K/.test(txt), txt.slice(0, 200));
check("fig9: direct labels, no legend text block; the shared group word is a header over short variants", /\bBa\b/.test(txt) && /\b2 W\b/.test(txt) && /\b20 mW\b/.test(txt) && !/Ba, 2 W/.test(txt) && /Rb, Cs, Yb/.test(txt), txt.replace(/\n/g, "|").slice(0, 300));
const probe = spawnSync("python3", ["-c", `
import json, sys
sys.argv = ['x']
src = open('${FIGSPEC}').read().split('if __name__')[0]
exec(src)
spec = json.load(open('${join(out, "fig9.json")}')); validate(spec); _resolve(spec)
rb = spec['panels'][1]['series'][0]
print(len(rb['x']), sorted(rb['x'].tolist()))
`], { encoding: "utf-8" });
check("where-filter: {atom: Rb, l: 0} keeps exactly the 4 Rb l=0 rows", /^4 \[40\.0, 50\.0, 60\.0, 80\.0\]/.test(probe.stdout.trim()), probe.stdout + probe.stderr.slice(-300));

// strict grammar
const base = JSON.parse(readFileSync("fixtures/figspec/fig3.figspec.json", "utf-8"));
function refuse(name: string, mutate: (s: any) => void, re: RegExp) {
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, name); mutate(s);
  const p = join(out, name + ".json"); writeFileSync(p, JSON.stringify(s));
  const r = spawnSync("python3", [FIGSPEC, p], { env, encoding: "utf-8" });
  check(`refused: ${name}`, r.status === 2 && re.test(r.stderr) && !existsSync(join(out, name + ".pdf")), (r.stderr || "").slice(-300));
}
refuse("legend-key", (s) => { s.panels[0].legend = { loc: "upper right" }; }, /legend: not a figspec key — use nothing — series are labelled directly/);
refuse("style-key", (s) => { s.panels[0].series[0].style = { color: "#2166ac", linestyle: "--" }; }, /style: not a figspec key — use linestyle .* and group/);
refuse("title-key", (s) => { s.panels[0].title = "4 K"; }, /title: not a figspec key — use tag/);
refuse("annotations-key", (s) => { s.panels[0].annotations = [{ text: "T = 4 K", x: 1, y: 1 }]; }, /annotations: not a figspec key — use highlight .* or tag/);
refuse("typo-key", (s) => { s.panels[0].serie = s.panels[0].series; delete s.panels[0].series; }, /serie: unknown key — did you mean "series"\?/);
refuse("bad-role", (s) => { s.panels[0].series[0].role = "refrence"; }, /role: 'refrence' — data \| model \| envelope \| reference/);
refuse("six-series", (s) => { for (let i = 0; i < 5; i++) s.panels[0].series.push({ ...s.panels[0].series[0], label: "s" + i }); }, /6 foreground series on one axes \(max 5\)/);
// v4.2: references have their own budget (≤ 4, drawn individually), claim callouts ≤ 2 per panel
refuse("five-references", (s) => { for (let i = 0; i < 5; i++) s.panels[0].series.push({ ...s.panels[0].series[0], label: "r" + i, role: "reference" }); }, /5 reference series on one axes \(max 4\)/);
refuse("three-callouts", (s) => { s.panels[0].highlight = [1, 2, 3].map((k) => ({ series: 0, at: 10 * k, label: "c" + k })); }, /3 callouts \(max 2 per panel\)/);
refuse("long-callout", (s) => { s.panels[0].highlight = { series: 0, at: 30, label: "this callout is a whole sentence that belongs in the caption" }; }, /a callout is ≤ 5 words/);
{
  // A purpose-built roomy panel: this checks the v4.2 FEATURES (reference budget, two callouts,
  // e-notation typesetting, no colour-blind warning between two greys), not the placer's luck in a
  // crowded fixture — matplotlib's text metrics differ by version and 3.11 packs fig3 tighter than 3.9.
  const spec: any = {
    out: join(out, "refs4"), width: "double",
    panels: [{
      label: "a", xlabel: "$x$", ylabel: "$y$", xlim: [0, 100], ylim: [0, 12],
      series: [
        { x: { linspace: [0, 100, 40] }, y: { expr: "1e-5 + 0.01*x" }, label: "this work", group: "W" },
        { x: { linspace: [0, 100, 40] }, y: { expr: "2 + 0.01*x" }, label: "variant", group: "W" },
        ...[0, 1, 2, 3].map((i) => ({ x: { linspace: [0, 100, 40] }, y: { expr: `${4 + 1.6 * i} + 0.005*x` }, label: "R" + i, role: "reference" })),
      ],
      highlight: [{ series: 0, at: 20, label: "{y:.2e}" }, { series: 1, at: 70, label: "above R0" }],
    }],
  };
  writeFileSync(join(out, "refs4.json"), JSON.stringify(spec));
  const r = spawnSync("python3", [FIGSPEC, join(out, "refs4.json")], { env, encoding: "utf-8" });
  check("two foreground + four grey references + two callouts: renders with exit 0", r.status === 0, (r.stderr || "").slice(-400));
  const probe = spawnSync("python3", ["-c", `
import json, sys; sys.argv=['x']
exec(open('${FIGSPEC}').read().split('if __name__')[0])
spec = json.load(open('${join(out, "refs4.json")}')); validate(spec); render(_resolve(spec), spec['out'])
texts = [t.get_text() for t in LAST_FIG.axes[0].texts]
print("PROBE", any('times10^{' in t for t in texts), any('above R0' in t for t in texts), [w for w in FINDINGS['warnings'] if 'colour-blind' in w], FINDINGS['errors'])
`], { env, encoding: "utf-8" });
  const last = (probe.stdout.trim().split("\n").filter((l) => l.startsWith("PROBE")).pop() ?? "");
  check("both callouts drawn; e-notation typeset as ×10^; two greys are not a colour-blind clash", /^PROBE True True \[\] \[\]$/.test(last), probe.stdout + probe.stderr.slice(-300));
}
refuse("bad-where", (s) => { s.panels[0].series[0].x.where = { nope: 1 }; }, /where: column 'nope' not in/);
// figures v4.1 — Nature methodology
refuse("sigma-without-kind", (s) => { s.panels[0].series[0].sigma = { expr: "0.05*y" }; }, /sigma_kind: required with sigma — sd \| sem \| ci95/);
refuse("bad-width", (s) => { s.width = "triple"; }, /spec.width: 'triple' — single \(89 mm\) \| 1.5 \(120 mm\) \| double/);
{
  const h = JSON.parse(readFileSync("fixtures/figspec/fig6.figspec.json", "utf-8").replaceAll("OUT/", out + "/"));
  const mk = (name: string, mut: (p: any) => void, re: RegExp) => {
    const t = JSON.parse(JSON.stringify(h)); t.out = join(out, name); mut(t.panels[0]);
    writeFileSync(join(out, name + ".json"), JSON.stringify(t));
    const r = spawnSync("python3", [FIGSPEC, join(out, name + ".json")], { env, encoding: "utf-8" });
    check(`refused: ${name}`, r.status === 2 && re.test(r.stderr), (r.stderr || "").slice(-300));
  };
  mk("cmap-jet", (p) => { p.cmap = "jet"; }, /cmap: 'jet' is banned — a rainbow map has no perceptual order/);
  mk("cmap-diverging-unsigned", (p) => { p.cmap = "RdBu_r"; }, /is a diverging map — say "diverging": true/);
  // diverging on a signed quantity: centred on zero, symmetric limits
  const t = JSON.parse(JSON.stringify(h)); t.out = join(out, "diverging"); t.panels[0].diverging = true; t.panels[0].zlim = undefined;
  t.panels[0].z = [[-0.4, 0.1], [0.2, 0.9]]; t.panels[0].x = [1, 2]; t.panels[0].y = [1, 2]; t.panels[0].contours = undefined; t.panels[0].highlight = undefined;
  writeFileSync(join(out, "diverging.json"), JSON.stringify(t));
  const probe = spawnSync("python3", ["-c", `
import json, sys; sys.argv=['x']
exec(open('${FIGSPEC}').read().split('if __name__')[0])
spec = json.load(open('${join(out, "diverging.json")}')); validate(spec); render(_resolve(spec), spec['out'])
qm = [c for c in LAST_FIG.axes[0].collections if hasattr(c, 'get_clim')][0]
print(qm.get_clim(), qm.get_cmap().name)
`], { env, encoding: "utf-8" });
  check("diverging heatmap: RdBu_r centred on zero with symmetric limits", /\(-0\.9, 0\.9\) RdBu_r/.test(probe.stdout.trim()), probe.stdout + probe.stderr.slice(-300));
}
// text contrast (WCAG 4.5) and red–green confusability helpers
{
  const probe = spawnSync("python3", ["-c", `
import sys; sys.argv=['x']
exec(open('${FIGSPEC}').read().split('if __name__')[0])
print(round(_contrast(_text_color('#F0E442')), 2), _text_color('#0072B2'), _confusable('#d62728', '#2ca02c'), _confusable('#0072B2', '#D55E00'))
`], { env, encoding: "utf-8" });
  const [c, blue, rg, bo] = probe.stdout.trim().split(/\s+/);
  check("label contrast: Okabe-Ito yellow is darkened to ≥ 4.5 on white; blue untouched", Number(c) >= 4.5 && blue === "#0072b2", probe.stdout + probe.stderr.slice(-200));
  check("deuteranopia model: tab10 red/green confusable, Okabe-Ito blue/vermillion not", rg === "True" && bo === "False", probe.stdout);
}
// a red–green pair on the same axes (APS tab10 palette) is separated by line style, with a warning
{
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, "redgreen");
  s.panels[0].series = [0, 1, 2].map((i) => ({ x: { logspace: [1, 1000, 40] }, y: { expr: "(1+" + i + "*0.2)*x**(1/6)" }, label: "s" + i }));
  s.panels[0].highlight = undefined; s.panels[0].bands = undefined; s.panels[0].reflines = undefined; s.panels[0].ylim = [0.5, 5];
  writeFileSync(join(out, "redgreen.json"), JSON.stringify(s));
  const r = spawnSync("python3", [FIGSPEC, join(out, "redgreen.json")], { env: { ...process.env, FIGSPEC_STYLE: "skills/venue-specific/figstyles/physics-aps.mplstyle" }, encoding: "utf-8" });
  check("tab10 red beside green: renders, third series restyled, colour-blind warning", r.status === 0 && /same to a red–green colour-blind reader — drawn with a different line style/.test(r.stderr), (r.stderr || "").slice(-300));
}
// shared y across a row when panels plot the same quantity; column layouts show x tick labels once
{
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, "sharey"); s.layout = "row"; s.width = "double";
  const p2 = JSON.parse(JSON.stringify(s.panels[0])); p2.label = "b"; p2.highlight = undefined; p2.ylim = [0.7, 3.5]; s.panels[0].label = "a"; s.panels.push(p2);
  writeFileSync(join(out, "sharey.json"), JSON.stringify(s));
  const probe = spawnSync("python3", ["-c", `
import json, sys; sys.argv=['x']
exec(open('${FIGSPEC}').read().split('if __name__')[0])
spec = json.load(open('${join(out, "sharey.json")}')); validate(spec); render(_resolve(spec), spec['out'])
a, b = LAST_FIG.axes[0], LAST_FIG.axes[1]
print(a.get_ylim() == b.get_ylim(), all(not t.get_visible() for t in b.get_yticklabels()), repr(b.get_ylabel()), round(b.get_ylim()[1], 2))
spec = json.load(open('${join(out, "fig4.json")}')); validate(spec); render(_resolve(spec), spec['out'] + '_probe')
top, bot = LAST_FIG.axes[0], LAST_FIG.axes[-1]
print(all(not t.get_visible() for t in top.get_xticklabels()), repr(top.get_xlabel()), bool(bot.get_xlabel()))
`], { env, encoding: "utf-8" });
  const lines = probe.stdout.trim().split("\n").filter((l) => /^(True|False)/.test(l));
  check("row with one quantity: y shared (union of limits), second panel has no y tick labels or title", /^True True '' 3\.\d+/.test(lines[0] ?? ""), probe.stdout + probe.stderr.slice(-300));
  check("stacked column: x tick labels only on the bottom panel, one x title", /^True '' True/.test(lines[1] ?? ""), probe.stdout);
}
// Nature venue style: panel letters 8 pt bold, in-figure text ≤ 7 pt; 1.5-column width
{
  const r = spawnSync("python3", [FIGSPEC, join(out, "fig9.json")], { env: { ...process.env, FIGSPEC_STYLE: "skills/venue-specific/figstyles/nature-science.mplstyle" }, encoding: "utf-8" });
  const sizes = spawnSync("python3", ["-c", `
import fitz; p = fitz.open('${join(out, "fig9.pdf")}')[0]; out = {}
for b in p.get_text('dict')['blocks']:
    for l in b.get('lines', []):
        for sp in l['spans']:
            t = sp['text'].strip()
            if t: out[t] = max(out.get(t, 0), round(sp['size'], 1))
print(out.get('(a)'), max(v for k, v in out.items() if k not in ('(a)', '(b)')))
`], { encoding: "utf-8" });
  check("Nature style: panel letters 8 pt, all other text ≤ 7 pt", r.status === 0 && /^8\.0 7\.0/.test(sizes.stdout.trim()), sizes.stdout + (r.stderr || "").slice(-200));
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, "w15"); s.width = "1.5";
  writeFileSync(join(out, "w15.json"), JSON.stringify(s));
  const r2 = spawnSync("python3", [FIGSPEC, join(out, "w15.json")], { env, encoding: "utf-8" });
  const w = Number(spawnSync("python3", ["-c", `import fitz; print(fitz.open('${join(out, "w15.pdf")}')[0].rect.width/72)`], { encoding: "utf-8" }).stdout);
  check("1.5-column width renders ≈ 4.7 in (" + w.toFixed(2) + ")", r2.status === 0 && w > 4.3 && w < 5.2 && /include at width=4\.72in/.test(r2.stdout), r2.stdout + (r2.stderr || "").slice(-200));
}
// sigma_kind reaches the caption: renderer prints the sentence and stores it in the sidecar
{
  const r = spawnSync("python3", [FIGSPEC, join(out, "fig8.json")], { env, encoding: "utf-8" });
  const side = JSON.parse(readFileSync(join(out, "fig8.pdf.figlint.json"), "utf-8"));
  check("sigma_kind: 'caption must state: shaded band, ±1 s.d.' printed and in the sidecar", /caption must state: shaded band, ±1 s\.d\./.test(r.stdout) && (side.caption ?? []).some((c: string) => /±1 s\.d\./.test(c)), r.stdout + JSON.stringify(side.caption));
}

// linestyle aliases are accepted
{
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, "alias"); s.panels[0].series[0].linestyle = "--";
  writeFileSync(join(out, "alias.json"), JSON.stringify(s));
  const r = spawnSync("python3", [FIGSPEC, join(out, "alias.json")], { env, encoding: "utf-8" });
  check("linestyle \"--\" accepted as dashed", r.status === 0, (r.stderr || "").slice(-300));
}

// a label that cannot be placed: exit 2, figure still written, sidecar carries the error (compile gate reads it)
{
  const s = JSON.parse(readFileSync("fixtures/figspec/fig2.figspec.json", "utf-8").replaceAll("OUT/", out + "/")); s.out = join(out, "unfit");
  s.panels[0].highlight = { series: 1, at: 25, label: "$C_6 \\approx 0$ at $24.65^\\circ$" };   // the label fig2 carried until v4: never fit, silently dropped
  writeFileSync(join(out, "unfit.json"), JSON.stringify(s));
  const r = spawnSync("python3", [FIGSPEC, join(out, "unfit.json")], { env, encoding: "utf-8" });
  const side = existsSync(join(out, "unfit.pdf.figlint.json")) ? JSON.parse(readFileSync(join(out, "unfit.pdf.figlint.json"), "utf-8")) : { errors: [] };
  check("unplaceable label: exit 2 with a 'shorten the label' message", r.status === 2 && /highlight label did not fit: .* shorten the label/.test(r.stderr), (r.stderr || "").slice(-300));
  check("unplaceable label: PDF written for inspection, sidecar error for the compile gate", existsSync(join(out, "unfit.pdf")) && side.errors.some((e: string) => /did not fit/.test(e)), JSON.stringify(side));
}

// a page-tall column figure is refused by the print-size model
{
  const s = JSON.parse(JSON.stringify(base)); s.out = join(out, "tall"); s.layout = "column"; s.width = "single";
  s.panels = [0, 1, 2, 3].map((i) => ({ ...JSON.parse(JSON.stringify(base.panels[0])), label: "abcd"[i], highlight: undefined }));
  writeFileSync(join(out, "tall.json"), JSON.stringify(s));
  const r = spawnSync("python3", [FIGSPEC, join(out, "tall.json")], { env, encoding: "utf-8" });
  check("four stacked panels: capped at 6 in and warned/errored rather than 9 in tall", r.status === 0 || /prints .* in tall/.test(r.stderr), (r.stderr || "").slice(-300));
  const pdfH = spawnSync("python3", ["-c", `import fitz; print(fitz.open('${join(out, "tall.pdf")}')[0].rect.height/72)`], { encoding: "utf-8" }).stdout.trim();
  check(`stacked column height capped (${Number(pdfH).toFixed(1)} in ≤ 6.6)`, Number(pdfH) <= 6.6, pdfH);
}

if (fails) { console.log(`\n${fails} failure(s) (renders in ${out})`); process.exit(1); }
console.log("\nall figspec checks passed — strict grammar, v4 vocabulary, sidecar for the compile gate");
