"""Per-figure colour measurements from paper PDFs (runs on the droplet).

python extract_figs.py LIST.txt OUTDIR [--workers 2]
LIST.txt: one PDF path per line. Writes OUTDIR/figs.jsonl (one row per figure caption),
OUTDIR/crops/*.png (level-scheme figures only, ~110 dpi), OUTDIR/done.txt (md5s processed).
Vector colours come from the PDF drawing commands; pixel colours from a 40-dpi render of the
figure region (caption excluded). Duplicate PDFs (same md5) are processed once.
"""
import hashlib, json, math, os, re, signal, sys, time
from multiprocessing import Pool

import numpy as np
import pymupdf

CAP = re.compile(r"^\s*(FIG\.|Fig\.|FIGURE|Figure|Extended Data Fig\.)\s*(S?\d+)\s*[.:|)\-–]", re.S)
LEVEL = re.compile(r"level (scheme|diagram|structure)|energy[- ]level|relevant (energy )?levels|"
                   r"level system|atomic levels|electronic levels|states? used|transitions? used|"
                   r"term (scheme|diagram)|grotrian", re.I)
SETUP = re.compile(r"set-?up|schematic|apparatus|illustration|sketch|cartoon|overview of the experiment|"
                   r"experimental (scheme|sequence|configuration)|layout", re.I)
TAB10 = {"#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
         "#bcbd22", "#17becf"}
OKABE = {"#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7"}


def lab(rgb):  # rgb in 0..1, array (...,3)
    a = np.asarray(rgb, float)
    a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = a @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    A = 500 * (f[..., 0] - f[..., 1])
    B = 200 * (f[..., 1] - f[..., 2])
    return L, A, B


def cls(rgb):
    """black / grey / white / chromatic(hue bin) for one colour tuple."""
    if rgb is None:
        return None
    L, A, B = (float(x) for x in lab(np.array(rgb[:3])))
    C = math.hypot(A, B)
    if C < 10:
        return "black" if L < 25 else ("white" if L > 95 else "grey")
    return "c%03d" % (int(math.degrees(math.atan2(B, A)) % 360) // 30 * 30)


def hexc(rgb):
    return "#%02x%02x%02x" % tuple(int(round(255 * max(0, min(1, v)))) for v in rgb[:3])


def top(d, n):
    return {k: round(v, 1) for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:n]}


def kind(cap):
    if LEVEL.search(cap):
        return "level"
    if SETUP.search(cap):
        return "setup"
    return "other"


def is_body(block, x0, x1):
    lines = [l for l in block.get("lines", [])]
    txt = " ".join("".join(s["text"] for s in l["spans"]) for l in lines)
    bx0, _, bx1, _ = block["bbox"]
    overlap = min(bx1, x1) - max(bx0, x0)
    return len(lines) >= 3 and len(txt) > 180 and overlap > 0.5 * (bx1 - bx0)


def regions(page):
    W, H = page.rect.width, page.rect.height
    d = page.get_text("dict")
    blocks = [b for b in d["blocks"] if b.get("type") == 0]
    out = []
    for b in blocks:
        txt = " ".join("".join(s["text"] for s in l["spans"]) for l in b["lines"]).strip()
        m = CAP.match(txt)
        if not m:
            continue
        cx0, cy0, cx1, cy1 = b["bbox"]
        if cx1 - cx0 > 0.55 * W:
            x0, x1 = 0.04 * W, 0.96 * W
        elif (cx0 + cx1) / 2 < W / 2:
            x0, x1 = 0.04 * W, 0.51 * W
        else:
            x0, x1 = 0.49 * W, 0.96 * W
        top = 0.04 * H
        for o in blocks:
            if o is b:
                continue
            ox0, oy0, ox1, oy1 = o["bbox"]
            if oy1 <= cy0 + 1 and oy1 > top and is_body(o, x0, x1):
                top = oy1
        if cy0 - top < 50:
            continue
        out.append((m.group(2), txt[:1200], pymupdf.Rect(x0, top, x1, cy0 - 1), blocks))
    return out


def measure(page, rect, label_blocks, crop_path, cap_txt):
    row = {}
    t0 = time.time()
    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    if len(drawings) > 60000:
        drawings = []
        row["drawings_skipped"] = True
    strokes, fills, hseg = {}, {}, {}
    exact = set()
    shex, fhex, hhex, thex = {}, {}, {}, {}
    n_paths = 0
    for p in drawings:
        r = p.get("rect")
        if r is None or not rect.intersects(r):
            continue
        n_paths += 1
        sc, fc = p.get("color"), p.get("fill")
        w = p.get("width") or 0.5
        length = 0.0
        for it in p["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                seg = math.hypot(b.x - a.x, b.y - a.y)
                length += seg
                if sc is not None and abs(b.y - a.y) < 0.4 and 8 < abs(b.x - a.x) < 0.45 * rect.width:
                    k = cls(sc)
                    hseg[k] = hseg.get(k, 0) + 1
                    hhex[hexc(sc)] = hhex.get(hexc(sc), 0) + 1
            elif it[0] == "re":
                rr = it[1]
                length += 2 * (rr.width + rr.height)
                if fc is not None and rr.height < 2.5 and 8 < rr.width < 0.45 * rect.width:
                    k = cls(fc)
                    hseg[k] = hseg.get(k, 0) + 1
            elif it[0] == "c":
                length += math.hypot(it[4].x - it[1].x, it[4].y - it[1].y)
        if sc is not None and p.get("type") in ("s", "fs"):
            k = cls(sc)
            strokes[k] = strokes.get(k, 0) + length * w
            exact.add(hexc(sc))
            shex[hexc(sc)] = shex.get(hexc(sc), 0) + length * w
        if fc is not None and p.get("type") in ("f", "fs"):
            area = r.width * r.height
            k = cls(fc)
            if k != "white":
                fills[k] = fills.get(k, 0) + area
                fhex[hexc(fc)] = fhex.get(hexc(fc), 0) + area
            exact.add(hexc(fc))
    texts = {}
    for b in label_blocks:
        for l in b["lines"]:
            for s in l["spans"]:
                if not s["text"].strip() or not rect.contains(pymupdf.Rect(s["bbox"])):
                    continue
                c = s["color"]
                rgb = ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255
                k = cls(rgb)
                texts[k] = texts.get(k, 0) + len(s["text"].strip())
                thex[hexc(rgb)] = thex.get(hexc(rgb), 0) + len(s["text"].strip())
    try:
        img_area = sum(pymupdf.Rect(i["bbox"]).intersect(rect).get_area() for i in page.get_image_info())
    except Exception:
        img_area = 0.0
    row.update(n_paths=n_paths, strokes=strokes, fills=fills, hseg=hseg, texts=texts,
               img_frac=round(img_area / max(rect.get_area(), 1), 3),
               tab10=len(exact & TAB10), okabe=len(exact & OKABE),
               shex=top(shex, 12), fhex=top(fhex, 8), hhex=top(hhex, 6), thex=top(thex, 6))
    pix = page.get_pixmap(clip=rect, dpi=40, colorspace=pymupdf.csRGB, alpha=False)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3) / 255.0
    L, A, B = lab(a.reshape(-1, 3))
    C = np.hypot(A, B)
    ink = L < 92
    chrom = C > 15
    h = (np.degrees(np.arctan2(B[chrom], A[chrom])) % 360) // 30
    row.update(px_ink=round(float(ink.mean()), 4), px_chrom=round(float(chrom.mean()), 4),
               px_hue=np.bincount(h.astype(int), minlength=12).tolist() if chrom.any() else [0] * 12,
               px_chromL=round(float(np.median(L[chrom])), 1) if chrom.any() else None,
               px_chromC=round(float(np.median(C[chrom])), 1) if chrom.any() else None)
    if crop_path:
        page.get_pixmap(clip=rect, dpi=110, alpha=False).save(crop_path)
    row["sec"] = round(time.time() - t0, 2)
    return row


def timeout(*_):
    raise TimeoutError


def one(path):
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(90)
    rows = []
    try:
        md5 = hashlib.md5(open(path, "rb").read()).hexdigest()
        doc = pymupdf.open(path)
        meta_title = (doc.metadata or {}).get("title") or ""
        npages = doc.page_count
        if npages > 80:
            return md5, [{"md5": md5, "path": path, "skip": "pages>80", "pages": npages}]
        for pno in range(npages):
            page = doc[pno]
            for num, cap, rect, blocks in regions(page):
                k = kind(cap)
                crop = os.path.join(OUT, "crops", f"{md5[:12]}_p{pno + 1}_f{num}.png") if k == "level" else None
                try:
                    m = measure(page, rect, blocks, crop, cap)
                except TimeoutError:
                    raise
                except Exception as e:
                    m = {"err": repr(e)[:200]}
                rows.append(dict(md5=md5, path=path, title=meta_title[:200], page=pno + 1, fig=num, kind=k,
                                 cap=cap[:600], rect=[round(v, 1) for v in rect], pw=page.rect.width,
                                 crop=os.path.basename(crop) if crop else None, **m))
        return md5, rows
    except TimeoutError:
        return None, [{"path": path, "skip": "timeout", "partial": len(rows)}] + rows
    except Exception as e:
        return None, [{"path": path, "skip": "error", "err": repr(e)[:200]}]
    finally:
        signal.alarm(0)


def init(out):
    global OUT
    OUT = out


if __name__ == "__main__":
    lst, OUT = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 2
    os.makedirs(os.path.join(OUT, "crops"), exist_ok=True)
    paths = [l.strip() for l in open(lst) if l.strip()]
    # dedupe by (size, basename) before hashing; md5 dedupe inside
    seen_sz, uniq = set(), []
    for p in paths:
        try:
            k = (os.path.getsize(p), os.path.basename(p))
        except OSError:
            continue
        if k not in seen_sz:
            seen_sz.add(k)
            uniq.append(p)
    done = set(open(os.path.join(OUT, "done.txt")).read().split()) if os.path.exists(os.path.join(OUT, "done.txt")) else set()
    print(f"{len(paths)} paths, {len(uniq)} unique by size+name", flush=True)
    seen_md5 = set(done)
    t0 = time.time()
    with Pool(workers, initializer=init, initargs=(OUT,), maxtasksperchild=50) as pool, \
            open(os.path.join(OUT, "figs.jsonl"), "a") as fo, open(os.path.join(OUT, "done.txt"), "a") as fd:
        for i, (md5, rows) in enumerate(pool.imap_unordered(one, uniq, chunksize=4)):
            if md5 and md5 in seen_md5:
                continue  # same md5 -> same crop names, already on disk
            if md5:
                seen_md5.add(md5)
                fd.write(md5 + "\n")
            for r in rows:
                fo.write(json.dumps(r) + "\n")
            if i % 200 == 0:
                fo.flush(); fd.flush()
                print(f"{i}/{len(uniq)} {time.time() - t0:.0f}s", flush=True)
    print("done", time.time() - t0)
