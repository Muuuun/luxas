"""Position and within-paper consistency.  python analyze3.py rows_all.jsonl

1. By figure position (Fig. 1 / 2 / 3 / 4+): share of setup/level kinds, raster share (renders,
   photos, colormaps), chromatic pixel share, hue families.
2. Within a paper: for papers with >= 3 vector figures, how much of each figure's chromatic ink
   is drawn in colours (exact hex) that also appear in another figure of the same paper; number of
   distinct chromatic colours per paper; whether the same hue family keeps the same hex.
"""
import collections, json, math, sys

import numpy as np


def lab(h):
    rgb = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255
    a = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = M @ a / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L, A, B = 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


rows = [json.loads(l) for l in open(sys.argv[1])]
rows = [r for r in rows if r.get("kind") and not r.get("skip") and not r.get("err")]


def fignum(r):
    try:
        return int(str(r.get("fig")).lstrip("S"))
    except ValueError:
        return None


def pos(n):
    return None if n is None else ("1" if n == 1 else "2" if n == 2 else "3" if n == 3 else "4+")


print("=== by position (one row per figure FILE; tex figures can have several files)")
# collapse to one record per (paper, figure number)
figs = collections.defaultdict(list)
for r in rows:
    n = fignum(r)
    if n is not None and str(r.get("fig")).isdigit():
        figs[(r["pid"], n)].append(r)
by = collections.defaultdict(list)
for (pid, n), rs in figs.items():
    by[pos(n)].append(rs)
for p in ("1", "2", "3", "4+"):
    F = by[p]
    kinds = collections.Counter()
    for rs in F:
        ks = {r["kind"] for r in rs}
        kinds["level" if "level" in ks else "setup" if "setup" in ks else "other"] += 1
    raster = np.mean([any(r.get("raster") or (r.get("img_frac") or 0) > 0.3 for r in rs) for rs in F])
    chrom = np.median([np.mean([r.get("px_chrom") or 0 for r in rs]) for rs in F])
    print(f" Fig {p:2s}: n={len(F):5d}  level {kinds['level'] / len(F):.2f}  setup {kinds['setup'] / len(F):.2f}"
          f"  data {kinds['other'] / len(F):.2f}  has raster/render {raster:.2f}  chromatic px median {chrom:.3f}")

print("\n=== within-paper consistency (vector figures with colour detail)")
papers = collections.defaultdict(list)
for r in rows:
    if r.get("shex") is not None and not r.get("raster") and (r.get("img_frac") or 0) < 0.2:
        papers[r["pid"]].append(r)
reuse, ncols, fam_stable, same_paper_n = [], [], [], 0
for pid, rs in papers.items():
    byfig = collections.defaultdict(dict)
    for r in rs:
        for h, v in list((r.get("shex") or {}).items()) + list((r.get("fhex") or {}).items()):
            if lab(h)[1] >= 12:
                byfig[r.get("fig")][h] = byfig[r.get("fig")].get(h, 0) + v
    byfig = {k: v for k, v in byfig.items() if v}
    if len(byfig) < 3:
        continue
    same_paper_n += 1
    allc = collections.Counter()
    for k, d in byfig.items():
        for h in d:
            allc[h] += 1
    ncols.append(len(allc))
    for k, d in byfig.items():
        tot = sum(d.values())
        if tot <= 0:
            continue
        shared = sum(v for h, v in d.items() if allc[h] >= 2)
        reuse.append(shared / tot)
    # per hue family (30 deg bin): how many distinct hex values does the paper use?
    fam = collections.defaultdict(set)
    for k, d in byfig.items():
        for h in d:
            fam[int(lab(h)[2] // 30)].add(h)
    fam_stable.append(np.mean([len(s) for s in fam.values()]))
print(f" papers with >=3 coloured vector figures: {same_paper_n}")
print(f" share of a figure's chromatic ink in colours reused in another figure of the same paper: "
      f"median {np.median(reuse):.2f}, q25 {np.percentile(reuse, 25):.2f}, q75 {np.percentile(reuse, 75):.2f}")
print(f"   figures where >= 80% of colour is reused: {np.mean([x >= .8 for x in reuse]):.2f};"
      f" where < 20% is reused: {np.mean([x < .2 for x in reuse]):.2f}")
print(f" distinct chromatic hex colours per paper: median {np.median(ncols):.0f}, q25 {np.percentile(ncols, 25):.0f},"
      f" q75 {np.percentile(ncols, 75):.0f}")
print(f" distinct hex values per 30-degree hue bin per paper: median {np.median(fam_stable):.1f}")
