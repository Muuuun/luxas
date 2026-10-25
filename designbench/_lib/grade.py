#!/usr/bin/env python3
"""Grade an AtomX design: recompute every number from design.json, never read the
agent's own figures except to compare them.

    grade.py RUN_DIR_OR_DESIGN.json [--bench na-advantage] [--cache PATH] [--no-search] [--json]

Needs quimb and cotengra (the designbench venv, see designbench/README.md) for
the tensor-network search; --no-search grades from the cache only.
"""
import argparse
import importlib.util
import json
import math
import os
import sys

# Loading input/compile.py would otherwise leave input/__pycache__, which
# bench_run then copies into every run directory.
sys.dont_write_bytecode = True
LIB = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(LIB)
sys.path.insert(0, LIB)
import budget as B      # noqa: E402
import hardness as H    # noqa: E402

DEFAULT_CACHE = os.path.expanduser("~/.sisyphus/designbench/tn_cache.json")

# claim -> (kind, tolerance). "ratio": |ln(claimed/recomputed)| <= ln(tol), both ways.
# "over": log10 quantities; only claims ABOVE ours by more than tol decades are
# inconsistent (overclaimed hardness). Below is "conservative": we cannot rule
# out that the agent knows a better attack than our search found.
CLAIM_TOL = {
    "fidelity": ("ratio", 1.10),
    "keep_probability": ("ratio", 1.05),
    "cycle_time_s": ("ratio", 1.10),
    "kept_samples": ("ratio", 1.25),
    "quantum_time_s": ("ratio", 1.30),
    "classical_time_s": ("over", 2.0),
    "score": ("over", 2.0),
}


def load_compiler(bench):
    path = os.path.join(ROOT, bench, "input", "compile.py")
    spec = importlib.util.spec_from_file_location(f"atomx_compile_{bench.replace('-', '_')}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_design(target):
    if os.path.isdir(target):
        p = os.path.join(target, "design.json")
        return p if os.path.exists(p) else None
    return target if os.path.exists(target) else None


def compare_claims(claims, rec):
    if claims is None:
        return {k: {"status": "missing"} for k in CLAIM_TOL}, 0.0
    out, ok = {}, 0
    for k, (kind, tol) in CLAIM_TOL.items():
        c, g = claims[k], rec.get(k)
        if g is None:
            out[k] = {"claimed": c, "status": "not checked"}
            continue
        if kind == "ratio":
            st = "consistent" if abs(math.log(c / g)) <= math.log(tol) else "inconsistent"
        else:
            cl = math.log10(c) if k == "classical_time_s" else c
            gl = math.log10(g) if k == "classical_time_s" else g
            st = "inconsistent" if cl - gl > tol else ("conservative" if gl - cl > tol else "consistent")
        out[k] = {"claimed": c, "recomputed": g, "status": st}
        ok += st != "inconsistent"
    checked = sum(1 for v in out.values() if v["status"] != "not checked")
    return out, (ok / checked if checked else None)


def grade(design_path, bench="na-advantage", cache_path=DEFAULT_CACHE, allow_search=True):
    comp = load_compiler(bench)
    hw = comp.load_hardware(os.path.join(ROOT, bench, "input", "hardware.json"))
    res = {"bench": bench, "design": design_path}
    if design_path is None:
        res.update(feasible=False, failure="no design.json", checks={}, score=None)
        return res
    try:
        with open(design_path) as f:
            design = json.load(f)
        circuit = comp.expand(design, hw)
    except (OSError, ValueError) as e:
        res.update(feasible=False, failure=f"unreadable: {e}", checks={"compile": "unreadable"}, score=None)
        return res
    except comp.CompileError as e:
        res.update(feasible=False, failure="compile", checks={"compile": str(e)}, score=None)
        return res
    b = B.budget(circuit, hw)
    reduced = H.reduce_sequence(H.gate_sequence(circuit))
    lc_ok, lc_full = H.light_cone_complete(reduced, circuit["n"])
    lim = hw["limits"]
    checks = {
        "compile": "ok",
        "run_time": "ok" if b["quantum_time_s"] <= lim["max_run_time_s"] else
                    f"{b['quantum_time_s']:.3g} s > {lim['max_run_time_s']} s",
        "noise": "ok" if b["errors_per_cycle_max"] is not None and b["errors_per_cycle_max"] <= lim["max_errors_per_cycle"] else
                 f"{b['errors_per_cycle_max']} errors per cycle > {lim['max_errors_per_cycle']}",
        "light_cone": "ok" if lc_ok else f"only {lc_full} of {circuit['n']} atoms see every input "
                                         f"(after cancelling gates that multiply to the identity)",
    }
    feasible = all(v == "ok" for v in checks.values())
    # The search takes minutes: only a design that can score gets one.
    cl = H.classical(circuit, b, hw, cache_path=cache_path, allow_search=allow_search and feasible, reduced=reduced)
    if cl["tn_missing"] and not feasible:
        cl["tn_skipped"] = "infeasible design: no search"
    score = None if cl["tn_missing"] else cl["log10_classical_time_s"] - math.log10(b["quantum_time_s"])
    rec = {k: b[k] for k in ("fidelity", "keep_probability", "cycle_time_s", "kept_samples", "quantum_time_s")}
    rec["classical_time_s"] = None if cl["tn_missing"] else 10 ** cl["log10_classical_time_s"]
    rec["score"] = score
    claims, acc = compare_claims(circuit["claims"], rec)
    res.update(feasible=feasible, failure=None if feasible else next(k for k, v in checks.items() if v != "ok"),
               checks=checks, score=score, budget=b, classical=cl, claims=claims, claims_accuracy=acc)
    return res


def line(r):
    if r.get("failure") and not r.get("budget"):
        why = r.get("checks", {}).get(r["failure"])
        return f"INFEASIBLE ({r['failure']}{': ' + why if why else ''})"
    b, c = r["budget"], r["classical"]
    s = "n/a (tensor-network cost not computed)" if r["score"] is None else f"{r['score']:.2f}"
    head = "FEASIBLE" if r["feasible"] else f"INFEASIBLE ({r['failure']}: {r['checks'][r['failure']]})"
    acc = r["claims_accuracy"]
    return (f"{head} S={s} | n={b['n']} F={b['fidelity']:.3g} keep={b['keep_probability']:.3f} "
            f"cycle={b['cycle_time_s']:.4f}s Tq={b['quantum_time_s']:.3g}s lambda_max={b['errors_per_cycle_max']} "
            f"| classical {c['method']} 10^{c['log10_classical_flops']:.1f} FLOPs "
            f"| claims {'missing' if acc is None and r['claims'] and all(v['status'] == 'missing' for v in r['claims'].values()) else acc}")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--bench", default="na-advantage")
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--no-search", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.cache:
        os.makedirs(os.path.dirname(os.path.abspath(a.cache)), exist_ok=True)
    r = grade(find_design(a.target), a.bench, a.cache, not a.no_search)
    print(json.dumps(r, indent=1, default=str) if a.json else line(r))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
