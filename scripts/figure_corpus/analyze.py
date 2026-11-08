"""Summaries of rows.jsonl from extract2.py.  python analyze.py rows.jsonl [out.json]"""
import collections, json, math, sys

import numpy as np

rows = [json.loads(l) for l in open(sys.argv[1])]
rows = [r for r in rows if r.get("kind") and not r.get("skip") and not r.get("err")]
print("figure-file rows", len(rows), "papers", len({r["pid"] for r in rows}))
NEUTRAL = {"black", "grey", "white"}


def share(d, keys=NEUTRAL):
    tot = sum(d.values())
    return None if tot == 0 else sum(v for k, v in d.items() if k in keys) / tot


def q(a):
    a = [x for x in a if x is not None]
    if not a:
        return "n=0"
    p = np.percentile(a, [25, 50, 75])
    return f"n={len(a)} q25={p[0]:.3f} med={p[1]:.3f} q75={p[2]:.3f}"


out = {}
for kind in ("level", "setup", "other"):
    R = [r for r in rows if r["kind"] == kind]
    V = [r for r in R if not r.get("raster") and r.get("n_paths", 0) > 0 and (r.get("img_frac") or 0) < 0.2]
    print(f"\n=== {kind}: files {len(R)}  papers {len({r['pid'] for r in R})}  vector {len(V)}")
    # text colour
    tx = [share(r["texts"]) for r in V if sum(r["texts"].values()) >= 10]
    print(" text chars neutral share:", q(tx), " figs with all text neutral(>=0.98):",
          f"{np.mean([t >= 0.98 for t in tx]):.2f}" if tx else "-")
    hs = [share(r["hseg"]) for r in V if sum(r["hseg"].values()) >= 3]
    print(" horizontal segments neutral share:", q(hs), " figs all neutral:",
          f"{np.mean([h >= 0.98 for h in hs]):.2f}" if hs else "-")
    st = [share(r["strokes"]) for r in V if sum(r["strokes"].values()) > 0]
    print(" stroke length neutral share:", q(st))
    print(" px_chrom (all files):", q([r.get("px_chrom") for r in R]))
    print(" px_ink   (all files):", q([r.get("px_ink") for r in R]))
    print(" chromatic px L:", q([r.get("px_chromL") for r in R]), " C:", q([r.get("px_chromC") for r in R]))
    hue = np.sum([r["px_hue"] for r in R if r.get("px_hue")], axis=0)
    if np.sum(hue):
        print(" hue share by 30deg bins (Lab h):", " ".join(f"{30 * i}:{v / hue.sum():.2f}" for i, v in enumerate(hue)))
    if kind == "other":
        t10 = [r.get("tab10", 0) for r in V]
        ok = [r.get("okabe", 0) for r in V]
        print(" vector data figs with >=3 exact tab10 colours:", f"{np.mean([t >= 3 for t in t10]):.3f}",
              " >=2:", f"{np.mean([t >= 2 for t in t10]):.3f}", " okabe>=2:", f"{np.mean([o >= 2 for o in ok]):.3f}")
    # most used exact colours, counted once per paper
    for fld in ("shex", "fhex", "thex", "hhex"):
        per_paper = collections.defaultdict(set)
        for r in V:
            for h in (r.get(fld) or {}):
                per_paper[h].add(r["pid"])
        top = sorted(per_paper.items(), key=lambda kv: -len(kv[1]))[:30]
        print(f" top {fld} (papers):", " ".join(f"{h}:{len(p)}" for h, p in top))
    out[kind] = dict(files=len(R), vector=len(V))
if len(sys.argv) > 2:
    json.dump(out, open(sys.argv[2], "w"), indent=1)
