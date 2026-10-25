"""Fixture sanity: the reference must pass, and every mutant must be killable.

Not shown to any bench contestant. Run by scripts/model_bench.mts `validate`.
"""
import importlib.util, os, sys, tempfile

def load(path):
    spec = importlib.util.spec_from_file_location("kp", path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

REC = {
    "ground_bb":  "   403.9822 -0.131 39.00       0.000  1.5 5s2 4d a2D   24746.574  2.5 s1D)5p y2D  8.36 -5.96 -7.68K06  0 0  0 0.000  0 0.000                      798 1088     0",
    "excited_bb": "   600.0000 -1.000 39.00     530.354  2.5 5s2 4d a2D   17200.000  1.5 x lab  1 1 1",
    "b_to_ai":    "   123.8476 -3.407 39.00       0.000  1.5 5s2 4d a2D  -80744.412  1.5 z(2P)2P300  9.07 -5.90 -7.71K06  0 0",
    "ai_lower":   "   156.3303 -3.074 39.00  -74496.286  1.5 O(1S)2D126   10529.163  0.5 5s2 5p z2P  7.86",
    "junk":       "# this is a header line with no numbers",
}

def edlen_vac(wl_air_nm):
    s2 = (1.0 / (wl_air_nm * 1e-3)) ** 2
    n = 1 + 1e-8 * (8342.54 + 2406147 / (130 - s2) + 15998 / (38.9 - s2))
    lam = wl_air_nm * n
    s2 = (1.0 / (lam * 1e-3)) ** 2
    n = 1 + 1e-8 * (8342.54 + 2406147 / (130 - s2) + 15998 / (38.9 - s2))
    return wl_air_nm * n

def A(wl_vac, log_gf, ju):
    return 0.66702e16 / (wl_vac * 10) ** 2 * 10 ** log_gf / (2 * ju + 1)

def check(mod):
    """Return list of failed assertions (empty = passes)."""
    fails = []
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x.lines")
        open(p, "w").write("\n".join(REC.values()) + "\n")
        try:
            rows = mod.parse_kurucz(p)
        except Exception as e:
            return [f"raised {e!r}"]
    def near(a, b, r=1e-6): return abs(a - b) <= r * max(abs(b), 1e-300)
    by = {(round(r["E_lower_cm"], 3), round(r["J_upper"], 1), round(r["log_gf"], 3)): r for r in rows}
    if len(rows) != 3: fails.append(f"expected 3 rows (ai-lower dropped, junk skipped), got {len(rows)}")
    g = by.get((0.0, 2.5, -0.131))
    if not g: fails.append("ground bound-bound line missing")
    else:
        v = edlen_vac(403.9822)
        if not near(g["wl_vac_nm"], v, 1e-9): fails.append("vacuum wavelength")
        if not near(g["A_s1"], A(v, -0.131, 2.5), 1e-9): fails.append("A value")
        if abs(1e7 / v - 24746.574) > 0.2: fails.append("fixture: Edlen does not reproduce the level energy")
        if g["E_upper_cm"] != 24746.574: fails.append("bound upper energy must be the stored value")
    ai = by.get((0.0, 1.5, -3.407))
    if not ai: fails.append("bound->autoionizing line missing")
    elif not near(ai["E_upper_cm"], 0.0 + 1e7 / edlen_vac(123.8476), 1e-9): fails.append("autoionizing upper energy reconstruction")
    ex = by.get((530.354, 1.5, -1.0))
    if not ex: fails.append("excited bound-bound line missing")
    elif not near(ex["A_s1"], A(edlen_vac(600.0), -1.0, 1.5), 1e-9): fails.append("A uses upper J")
    order = [(r["E_lower_cm"], r["E_upper_cm"]) for r in rows]
    if order != sorted(order): fails.append("not sorted by (E_lower, E_upper)")
    return fails

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    bad = 0
    f = check(load(os.path.join(here, "reference.py")))
    print(("OK " if not f else "FAIL ") + "reference", f); bad += bool(f)
    for m in sorted(n for n in os.listdir(os.path.join(here, "mutants")) if n.endswith(".py")):
        f = check(load(os.path.join(here, "mutants", m)))
        print(("killable " if f else "EQUIVALENT ") + m, f[:2]); bad += not f
    sys.exit(1 if bad else 0)
