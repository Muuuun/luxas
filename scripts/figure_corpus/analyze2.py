"""Data-figure colour habits in the corpus.  python analyze2.py rows.jsonl [rows_eps.jsonl ...]

Only vector figures (drawing commands available, raster share < 0.2). Reports, per figure:
text colour, number of hue families used, pale fills, default-palette fingerprints, and the
lightness/chroma of the colours used for lines and markers.
"""
import collections, json, math, sys

import numpy as np

TAB10 = {"#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22",
         "#17becf"}
MATLAB = {"#0072bd", "#d95319", "#edb120", "#7e2f8e", "#77ac30", "#4dbeee", "#a2142f"}
OKABE = {"#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7"}
PURE = {"#ff0000", "#0000ff", "#00ff00", "#008000", "#ff00ff", "#00ffff", "#ffff00", "#800080", "#ffa500",
        "#000080", "#800000"}


def lab(h):
    rgb = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255
    a = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = M @ a / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L, A, B = 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


rows = []
for p in sys.argv[1:]:
    rows += [json.loads(l) for l in open(p)]
rows = [r for r in rows if r.get("kind") == "other" and not r.get("skip") and not r.get("err")]
V = [r for r in rows if not r.get("raster") and r.get("n_paths", 0) > 0 and (r.get("img_frac") or 0) < 0.2
     and r.get("shex") is not None]
print("data figure files", len(rows), "vector with colour detail", len(V), "papers", len({r["pid"] for r in V}))
for src in ("tex", "paper"):
    print(f"  {src}: {sum(r['src'] == src for r in V)}")

# text
tx = [r for r in V if sum((r.get("thex") or {}).values()) >= 10]
neutral_t = []
for r in tx:
    tot = sum(r["thex"].values())
    neu = sum(v for h, v in r["thex"].items() if lab(h)[1] < 10)
    neutral_t.append(neu / tot)
print(f"\nTEXT  figures with text: {len(tx)}; all text black/grey (>=98% of chars): {np.mean([t >= .98 for t in neutral_t]):.2f};"
      f" median neutral share {np.median(neutral_t):.2f}")

# hue families per figure (strokes + fills, weighted), 30-degree bins, count bins >= 8% of chromatic ink
nfam, pale_any, pale_area, Ls, Cs = [], [], [], [], []
for r in V:
    w = collections.Counter()
    for h, v in list((r.get("shex") or {}).items()) + [(h, v * 0.2) for h, v in (r.get("fhex") or {}).items()]:
        L, C, hue = lab(h)
        if C >= 12 and v > 0:
            w[int(hue // 30)] += v
            if L < 90:
                Ls.append(L); Cs.append(C)
    tot = sum(w.values())
    nfam.append(sum(1 for v in w.values() if tot and v / tot >= 0.08))
    pale = [(h, v) for h, v in (r.get("fhex") or {}).items() if lab(h)[0] >= 80 and 4 <= lab(h)[1] <= 35]
    pale_any.append(bool(pale))
c = collections.Counter(min(n, 5) for n in nfam)
print("\nHUE FAMILIES per vector data figure (bins >= 8% of chromatic ink):",
      " ".join(f"{k}{'+' if k == 5 else ''}:{c[k] / len(nfam):.2f}" for k in range(6)))
print(f"  <= 2 families: {np.mean([n <= 2 for n in nfam]):.2f}")
print(f"PALE TINTED FILLS (L>=80, 4<=C<=35) present: {np.mean(pale_any):.2f}")
print(f"LINE/MARKER colours: L median {np.median(Ls):.0f} (q25 {np.percentile(Ls, 25):.0f}, q75 {np.percentile(Ls, 75):.0f});"
      f" C median {np.median(Cs):.0f} (q25 {np.percentile(Cs, 25):.0f}, q75 {np.percentile(Cs, 75):.0f})")

# fingerprints
def has(r, S, k=2):
    cols = set((r.get("shex") or {})) | set((r.get("fhex") or {}))
    return len(cols & S) >= k


for name, S in (("matplotlib tab10", TAB10), ("MATLAB default", MATLAB), ("Okabe-Ito", OKABE), ("pure RGB/web names", PURE)):
    print(f"FINGERPRINT {name:20s} >=2 exact colours: {np.mean([has(r, S) for r in V]):.3f}")
none = np.mean([not any(has(r, S) for S in (TAB10, MATLAB, OKABE, PURE)) for r in V])
print(f"  none of these: {none:.3f}")
mono = np.mean([n == 0 for n in nfam])
print(f"BLACK/GREY ONLY data figures: {mono:.2f}")
for src in ("tex", "paper"):
    Vs = [r for r in V if r["src"] == src]
    if Vs:
        print(f"  [{src}] tab10 {np.mean([has(r, TAB10) for r in Vs]):.3f}  pure {np.mean([has(r, PURE) for r in Vs]):.3f}"
              f"  none {np.mean([not any(has(r, S) for S in (TAB10, MATLAB, OKABE, PURE)) for r in Vs]):.3f}")
