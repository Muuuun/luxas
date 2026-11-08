"""Second pass: measure the EPS figure files that extract2.py skipped.

python eps_pass.py OUTDIR [--workers 2]
Reads OUTDIR/rows.jsonl, converts every row with skip == "eps" to PDF with epstopdf (in a temp
dir), measures it like any other vector figure and writes OUTDIR/rows_eps.jsonl.
"""
import json, os, random, subprocess, sys, tempfile
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract2  # noqa: E402


def one(row):
    out = dict(row)
    out.pop("skip", None)
    with tempfile.TemporaryDirectory() as td:
        pdf = os.path.join(td, "f.pdf")
        try:
            subprocess.run(["epstopdf", row["file"], "--outfile=" + pdf], capture_output=True, timeout=60, check=True)
            rnd = random.Random(row["file"]).random()
            key = os.path.basename(row["file"]).replace(".", "_")
            name = f"{row['pid']}_f{row['fig']}_{key}"[:120]
            crop = extract2.crop_name(name, row["kind"], rnd)
            out.update(extract2.measure_file(pdf, row["kind"], crop))
            out["from_eps"] = True
        except Exception as e:
            out["err"] = "eps: " + repr(e)[:150]
    return out


def init(o):
    extract2.OUT = o


if __name__ == "__main__":
    OUT = sys.argv[1]
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 2
    rows = [json.loads(l) for l in open(os.path.join(OUT, "rows.jsonl"))]
    todo = [r for r in rows if r.get("skip") == "eps" and r.get("file")]
    print(len(todo), "eps files", flush=True)
    with Pool(workers, initializer=init, initargs=(OUT,)) as pool, open(os.path.join(OUT, "rows_eps.jsonl"), "w") as fo:
        for i, r in enumerate(pool.imap_unordered(one, todo, chunksize=4)):
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")
            if i % 200 == 0:
                print(i, flush=True)
    print("done")
