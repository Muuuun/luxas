"""Corpus-wide figure measurements, paper by paper (runs on the droplet).

python extract2.py OUTDIR ROOT [ROOT ...] [--workers 2]
Finds every */data/papers/<id>/ dir (arXiv source: .tex + figure files) and every loose
*/data/papers/*.pdf (a full paper). One paper id is processed once.
 - source dirs: figure environments are parsed from the .tex; each included file is measured and
   tagged with its caption, so kind (level / setup / other) comes from the caption + file name;
 - full-paper PDFs: captions found on the page, the region above each caption is measured.
Writes OUTDIR/rows.jsonl and OUTDIR/crops/ (every level-kind figure, plus 1 in 40 of the rest).
"""
import glob, hashlib, json, os, random, re, signal, sys, time
from multiprocessing import Pool

import numpy as np
import pymupdf
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_figs import CAP, LEVEL, SETUP, lab, measure, regions  # noqa: E402

Image.MAX_IMAGE_PIXELS = 200_000_000
FNAME_LEVEL = re.compile(r"level|scheme|energ|grotrian|transition", re.I)
GFX = re.compile(r"\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}")
FIGENV = re.compile(r"\\begin\{(figure\*?|wrapfigure)\}(.*?)\\end\{\1\}", re.S)
EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".eps")


def pid_of(name):
    n = name.lower().replace("arxiv:", "").replace("arxiv_", "")
    return re.sub(r"v\d+$", "", n)


def balanced(s, i):
    depth = 0
    for j in range(i, min(len(s), i + 6000)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1:j]
    return s[i + 1:i + 1500]


def clean(t):
    t = re.sub(r"\\(textbf|textit|emph|mathrm|text|textrm|bf|it|label|ref|cite|citep|citet)\b\*?", " ", t)
    t = re.sub(r"[{}$\\]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def tex_figures(d):
    texs = sorted(glob.glob(os.path.join(d, "**", "*.tex"), recursive=True))[:40]
    figs = []
    for tf in texs:
        try:
            s = open(tf, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        s = re.sub(r"(?<!\\)%.*", "", s)
        gpaths = [os.path.dirname(tf)] + [os.path.join(os.path.dirname(tf), g) for g in
                                          re.findall(r"\{([^{}]+/)\}", " ".join(re.findall(r"\\graphicspath\{(.*?)\}\s*$", s, re.M)))]
        for m in FIGENV.finditer(s):
            body = m.group(2)
            c = re.search(r"\\caption\s*(?:\[[^\]]*\])?\s*\{", body)
            cap = clean(balanced(body, c.end() - 1)) if c else ""
            files = []
            for g in GFX.findall(body):
                g = g.strip()
                for base in gpaths:
                    cand = os.path.normpath(os.path.join(base, g))
                    hits = [cand] if os.path.splitext(cand)[1].lower() in EXTS and os.path.exists(cand) else \
                        [cand + e for e in EXTS if os.path.exists(cand + e)]
                    if hits:
                        files.append(hits[0])
                        break
            figs.append((cap, files))
    return figs


def kindof(cap, fname):
    if LEVEL.search(cap) or FNAME_LEVEL.search(os.path.basename(fname)):
        return "level"
    if SETUP.search(cap):
        return "setup"
    return "other"


def raster_stats(path, crop):
    im = Image.open(path)
    im.draft("RGB", (600, 600))
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    small = im.copy()
    small.thumbnail((500, 500))
    a = np.asarray(small, float) / 255
    L, A, B = lab(a.reshape(-1, 3))
    C = np.hypot(A, B)
    chrom = C > 15
    h = (np.degrees(np.arctan2(B[chrom], A[chrom])) % 360) // 30
    if crop:
        im.thumbnail((1000, 1000))
        im.save(crop)
    return dict(px_ink=round(float((L < 92).mean()), 4), px_chrom=round(float(chrom.mean()), 4),
                px_hue=np.bincount(h.astype(int), minlength=12).tolist() if chrom.any() else [0] * 12,
                px_chromL=round(float(np.median(L[chrom])), 1) if chrom.any() else None,
                px_chromC=round(float(np.median(C[chrom])), 1) if chrom.any() else None)


def measure_file(path, kind, crop):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".eps":
        return {"skip": "eps"}
    if ext in (".png", ".jpg", ".jpeg"):
        r = raster_stats(path, crop)
        r["raster"] = True
        return r
    doc = pymupdf.open(path)
    page = doc[0]
    blocks = [b for b in page.get_text("dict")["blocks"] if b.get("type") == 0]
    r = measure(page, page.rect, blocks, crop, "")
    r["pages"] = doc.page_count
    return r


def timeout(*_):
    raise TimeoutError


def crop_name(key, kind, rnd):
    if kind == "level" or rnd < 1 / 40:
        return os.path.join(OUT, "crops", ("L_" if kind == "level" else "O_") + key + ".png")
    return None


def do_dir(job):
    d, project = job
    rows = []
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(240)
    pid = pid_of(os.path.basename(d))
    rnd = random.Random(pid)
    try:
        figs = tex_figures(d)
        used = set()
        for i, (cap, files) in enumerate(figs):
            for j, f in enumerate(files):
                used.add(f)
                k = kindof(cap, f)
                key = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{pid}_f{i + 1}_{j}")[:120]
                row = dict(pid=pid, project=project, src="tex", fig=i + 1, nfiles=len(files), file=f, kind=k,
                           cap=cap[:600])
                try:
                    signal.alarm(60)
                    row.update(measure_file(f, k, crop_name(key, k, rnd.random())))
                except TimeoutError:
                    row["skip"] = "timeout"
                except Exception as e:
                    row["err"] = repr(e)[:160]
                if row.get("crop") is None:
                    row.pop("crop", None)
                rows.append(row)
        if not figs:  # no tex: full-paper PDFs inside the dir
            for f in sorted(glob.glob(os.path.join(d, "**", "*.pdf"), recursive=True))[:5]:
                rows += paper_rows(f, project, pid, rnd)
        return pid, rows
    except TimeoutError:
        return pid, rows + [{"pid": pid, "skip": "dir-timeout"}]
    except Exception as e:
        return pid, rows + [{"pid": pid, "skip": "error", "err": repr(e)[:160]}]
    finally:
        signal.alarm(0)


def paper_rows(f, project, pid, rnd):
    rows = []
    try:
        doc = pymupdf.open(f)
    except Exception as e:
        return [{"pid": pid, "file": f, "skip": "open", "err": repr(e)[:120]}]
    if doc.page_count < 3 or doc.page_count > 60:
        return [{"pid": pid, "file": f, "skip": f"pages={doc.page_count}"}]
    for pno in range(doc.page_count):
        page = doc[pno]
        for num, cap, rect, blocks in regions(page):
            k = kindof(cap, "")
            key = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{pid}_p{pno + 1}_f{num}")[:120]
            row = dict(pid=pid, project=project, src="paper", fig=num, file=f, page=pno + 1, kind=k, cap=cap[:600])
            try:
                signal.alarm(60)
                row.update(measure(page, rect, blocks, crop_name(key, k, rnd.random()), cap))
            except TimeoutError:
                row["skip"] = "timeout"
            except Exception as e:
                row["err"] = repr(e)[:160]
            rows.append(row)
    return rows


def do_loose(job):
    f, project = job
    signal.signal(signal.SIGALRM, timeout)
    try:
        md5 = hashlib.md5(open(f, "rb").read()).hexdigest()
    except OSError:
        return None, []
    rnd = random.Random(md5)
    try:
        return md5, paper_rows(f, project, "pdf:" + md5[:12], rnd)
    except TimeoutError:
        return md5, [{"pid": "pdf:" + md5[:12], "skip": "timeout"}]
    finally:
        signal.alarm(0)


def run(job):
    return do_dir(job[:2]) if job[2] == "dir" else do_loose(job[:2])


def init(out):
    global OUT
    OUT = out


def project_of(p):
    m = re.search(r"/([^/]+)/(?:project/)?data/papers/", p)
    return m.group(1) if m else "?"


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    workers = 2
    if "--workers" in args:
        i = args.index("--workers")
        workers = int(args[i + 1])
        del args[i:i + 2]
    OUT, roots = args[0], args[1:]
    os.makedirs(os.path.join(OUT, "crops"), exist_ok=True)
    dirs, loose = {}, []
    for root in roots:
        for papers in glob.glob(os.path.join(root, "**", "data", "papers"), recursive=True):
            for e in sorted(os.listdir(papers)):
                p = os.path.join(papers, e)
                if os.path.isdir(p):
                    dirs.setdefault(pid_of(e), p)
                elif e.lower().endswith(".pdf"):
                    loose.append(p)
    seen = set()
    if os.path.exists(os.path.join(OUT, "done.txt")):
        seen = set(open(os.path.join(OUT, "done.txt")).read().split())
    jobs = [(p, project_of(p), "dir") for k, p in dirs.items() if k not in seen]
    sz = {}
    for p in loose:
        try:
            sz.setdefault((os.path.getsize(p), os.path.basename(p)), p)
        except OSError:
            pass
    jobs += [(p, project_of(p), "loose") for p in sz.values()]
    print(f"{len(dirs)} paper dirs, {len(sz)} loose pdfs, {len(jobs)} jobs", flush=True)
    t0 = time.time()
    with Pool(workers, initializer=init, initargs=(OUT,), maxtasksperchild=40) as pool, \
            open(os.path.join(OUT, "rows.jsonl"), "a") as fo, open(os.path.join(OUT, "done.txt"), "a") as fd:
        for i, (key, rows) in enumerate(pool.imap_unordered(run, jobs, chunksize=2)):
            if key is None or key in seen:
                continue
            seen.add(key)
            fd.write(key + "\n")
            for r in rows:
                fo.write(json.dumps(r, ensure_ascii=False) + "\n")
            if i % 100 == 0:
                fo.flush()
                fd.flush()
                print(f"{i}/{len(jobs)} {time.time() - t0:.0f}s", flush=True)
    print("done", round(time.time() - t0))
