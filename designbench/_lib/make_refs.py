#!/usr/bin/env python3
"""Reference and planted designs for designbench/na-advantage, and the numbers
each must grade to.

    make_refs.py [--bench na-advantage]

Writes reference/<name>/design.json and reference/expected.json. The budget
numbers in expected.json come from analytic_budget() below: per-layer event
counts written out by hand from how each design is built, a second
implementation of MACHINE.md that does not call budget.py. The gate holds
budget.py to it.

  ref-grid-rcs       the Google-style design moved to atoms: 2D nearest-neighbour
                     RCS, ABCD pairing by row/column shifts
  ref-hypercube-rcs  the same gates on hypercube connectivity (Bluvstein et al.
                     2024 realised hypercube IQP this way), one pass
  ref-hypercube-deep the same with six more layers: what the week allows
  bad-runtime        ref-grid-rcs run far deeper: too few samples in a week
  bad-noise          ref-hypercube-rcs with extra single-qubit layers: more than
                     0.5 errors per cycle (strong-noise phase)
  bad-clifford       ref-grid-rcs without SW: a Clifford circuit
  bad-blockade       ref-grid-rcs with a 5 um pairing shift: partial blockade
  bad-lightcone      ref-grid-rcs pairing along rows only: ten separate chains
  bad-claims         ref-hypercube-rcs with the claims a careless budget gives:
                     gate errors only, lost shots kept, a statevector per sample
  bad-mirror         an 8x8 hypercube circuit followed by its inverse: the
                     machine runs 12 layers, the attacker simulates nothing
  bad-trivial        ref-hypercube-rcs with diagonal gates only: |0> throughout
"""
import argparse
import json
import math
import os
import sys

sys.dont_write_bytecode = True   # see grade.py
LIB = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(LIB)
RCS_SET = ["SX", "SY", "SW"]


def rnd(seed, gate_set=RCS_SET, atoms="all"):
    return {"op": "local_random", "set": list(gate_set), "atoms": atoms, "seed": seed, "no_repeat": True}


def shift(axis, coords, d):
    other = "y" if axis == "x" else "x"
    return {"op": "move", axis: coords, other: "all", ("dx" if axis == "x" else "dy"): d,
            ("dy" if axis == "x" else "dx"): 0}


def pair_layer(axis, coords, d):
    """Shift the selected columns (axis x) or rows (axis y) by d, pulse, shift back."""
    back = [round(c + d, 6) for c in coords]
    return [shift(axis, coords, d), {"op": "rydberg"}, shift(axis, back, -d)]


# ---- 2D grid RCS ---------------------------------------------------------

def grid_patterns(L, pitch, d):
    even = [pitch * i for i in range(0, L - 1, 2)]
    odd = [pitch * i for i in range(1, L - 1, 2)]
    return {"A": ("x", even, d), "B": ("x", odd, d), "C": ("y", even, d), "D": ("y", odd, d)}


def grid_rcs(L, cycles, order="ACBD", gate_set=RCS_SET, d=8.0, pitch=10.0, seed=100):
    pats = grid_patterns(L, pitch, d)
    atoms = [[pitch * i, pitch * j] for j in range(L) for i in range(L)]
    block = []
    for k, p in enumerate(order):
        block.append(rnd(seed + k, gate_set))
        block.extend(pair_layer(*pats[p]))
    prog = []
    if cycles // len(order):
        prog.append({"op": "repeat", "times": cycles // len(order), "body": block})
    for k in range(cycles % len(order)):
        prog.append(rnd(seed + 50 + k, gate_set))
        prog.extend(pair_layer(*pats[order[k]]))
    prog.append(rnd(seed + 99, gate_set))
    return {"format": "atomx/1", "atoms": atoms, "program": prog}


# ---- hypercube RCS -------------------------------------------------------

def hypercube_layers(cols, rows, pitch=10.0, gap=2.0):
    out = []
    for k in range(int(math.log2(cols))):
        out.append(("x", [pitch * c for c in range(cols) if not (c >> k) & 1], pitch * 2 ** k - gap))
    for k in range(int(math.log2(rows))):
        out.append(("y", [pitch * r for r in range(rows) if not (r >> k) & 1], pitch * 2 ** k - gap))
    return out


def hypercube_rcs(cols, rows, rounds, extra_local=0, extra_layers=0, gate_set=RCS_SET, pitch=10.0, seed=200):
    """rounds full passes over the hypercube dimensions, then the first
    extra_layers dimensions once more."""
    atoms = [[pitch * c, pitch * r] for r in range(rows) for c in range(cols)]
    layers = hypercube_layers(cols, rows, pitch)
    body = []
    for k, layer in enumerate(layers):
        for e in range(1 + extra_local):
            body.append(rnd(seed + 10 * k + e, gate_set))
        body.extend(pair_layer(*layer))
    prog = [{"op": "repeat", "times": rounds, "body": body}]
    for k in range(extra_layers):
        prog.append(rnd(seed + 500 + k, gate_set))
        prog.extend(pair_layer(*layers[k]))
    prog.append(rnd(seed + 99, gate_set))
    return {"format": "atomx/1", "atoms": atoms, "program": prog}


# ---- analytic budget (independent of budget.py) ----------------------------

def move_us(hw, dist):
    return hw["duration_us"]["move_overhead"] + 2 * math.sqrt(dist / hw["move_acceleration_um_per_us2"])


def analytic_budget(layers, n, local_layers_per_cycle, final_local, hw):
    """layers: one (moved_atoms, pairs, unpaired, shift_um) per Rydberg pulse, in order.
    The program is, per layer: local_layers_per_cycle local layers on all n
    atoms (a number, or one number per layer), shift, pulse, shift back; then
    one final local layer on all atoms. A cycle ends at its pulse (MACHINE.md),
    so the shift back of layer k is in cycle k+1, and the last shift back and
    the final layer are in the last cycle."""
    e, L, du = hw["error"], hw["loss"], hw["duration_us"]
    t2 = hw["t2_s"] * 1e6
    per = local_layers_per_cycle if isinstance(local_layers_per_cycle, list) else [local_layers_per_cycle] * len(layers)
    log_f = log_keep = 0.0
    total_us = 0.0
    lam = []
    carry_err = carry_us = 0.0          # the previous layer's shift back
    for (moved, pairs, unpaired, dist), loc in zip(layers, per):
        dur = loc * du["local_1q"] + move_us(hw, dist) + du["rydberg"]
        err = (loc * n * e["local_1q"] + moved * e["move"]
               + pairs * e["cz"] + unpaired * e["rydberg_unpaired"])
        lam.append(carry_err + err + n * (carry_us + dur) / t2)
        carry_err, carry_us = moved * e["move"], move_us(hw, dist)
        log_f += (loc * n * math.log1p(-e["local_1q"]) + 2 * moved * math.log1p(-e["move"])
                  + pairs * math.log1p(-e["cz"]) + unpaired * math.log1p(-e["rydberg_unpaired"]))
        log_keep += 2 * moved * math.log1p(-L["move"]) + 2 * pairs * math.log1p(-L["cz_per_atom"])
        total_us += dur + move_us(hw, dist)
    lam[-1] += carry_err + n * carry_us / t2
    if final_local:
        total_us += du["local_1q"]
        log_f += n * math.log1p(-e["local_1q"])
        lam[-1] += n * e["local_1q"] + n * du["local_1q"] / t2
    log_f += n * (math.log1p(math.expm1(-total_us / t2)) + math.log1p(-e["prep"]) + math.log1p(-e["meas"]))
    log_keep += n * (-total_us * 1e-6 / hw["vacuum_lifetime_s"])
    f, keep = math.exp(log_f), math.exp(log_keep)
    cycle = hw["shot_overhead_s"]["prepare"] + total_us * 1e-6 + hw["shot_overhead_s"]["image"]
    kept = math.ceil(hw["limits"]["significance_sigma"] ** 2 / f ** 2)
    return {"fidelity": f, "keep_probability": keep, "cycle_time_s": cycle, "kept_samples": kept,
            "quantum_time_s": kept / keep * cycle, "errors_per_cycle_max": max(lam), "circuit_us": total_us}


def grid_layers(L, cycles, order="ACBD", d=8.0):
    even, odd = len(range(0, L - 1, 2)), len(range(1, L - 1, 2))
    per = {"A": (even * L, even * L, L * L - 2 * even * L, d), "B": (odd * L, odd * L, L * L - 2 * odd * L, d)}
    per["C"], per["D"] = per["A"], per["B"]
    return [per[order[c % len(order)]] for c in range(cycles)]


def hypercube_analytic_layers(cols, rows, rounds, extra_layers=0, pitch=10.0, gap=2.0):
    n = cols * rows
    one = [(n // 2, n // 2, 0, pitch * 2 ** k - gap) for k in range(int(math.log2(cols)))]
    one += [(n // 2, n // 2, 0, pitch * 2 ** k - gap) for k in range(int(math.log2(rows)))]
    return one * rounds + one[:extra_layers]


INVERSE = {"H": "H", "T": "TDG", "TDG": "T", "S": "SDG", "SDG": "S", "X": "X", "Y": "Y", "Z": "Z"}


def mirror(design, layers, comp, hw):
    """design followed by its exact inverse, gate by gate. Its gates must have
    inverses in the gate set (INVERSE). Every pair_layer is its own inverse."""
    steps = comp.expand(design, hw)["steps"]
    singles = [s for s in steps if s["kind"] == "1q"]   # R1 .. Rk, Rfinal
    inv = lambda s: {"op": "local", "gates": {str(a): INVERSE[g] for a, g in s["gates"]}}
    prog = list(design["program"]) + [inv(singles[-1])]
    for k in reversed(range(len(layers))):
        prog.extend(pair_layer(*layers[k]))
        prog.append(inv(singles[k]))
    return {"format": "atomx/1", "atoms": design["atoms"], "program": prog}


# ---- the set ------------------------------------------------------------

GRID = dict(L=8, cycles=16)
CUBE = dict(cols=16, rows=8, rounds=1)
DEEP_EXTRA = 6   # 13 layers: F 0.6 %, 6 days, the last ones that fit a week


def build(hw):
    L, cyc = GRID["L"], GRID["cycles"]
    c, r, rd = CUBE["cols"], CUBE["rows"], CUBE["rounds"]
    designs, ana = {}, {}
    designs["ref-grid-rcs"] = grid_rcs(L, cyc)
    ana["ref-grid-rcs"] = analytic_budget(grid_layers(L, cyc), L * L, 1, True, hw)
    designs["ref-hypercube-rcs"] = hypercube_rcs(c, r, rd)
    ana["ref-hypercube-rcs"] = analytic_budget(hypercube_analytic_layers(c, r, rd), c * r, 1, True, hw)
    designs["ref-hypercube-deep"] = hypercube_rcs(c, r, rd, extra_layers=DEEP_EXTRA)
    ana["ref-hypercube-deep"] = analytic_budget(hypercube_analytic_layers(c, r, rd, DEEP_EXTRA), c * r, 1, True, hw)
    designs["bad-runtime"] = grid_rcs(L, 3 * cyc)
    ana["bad-runtime"] = analytic_budget(grid_layers(L, 3 * cyc), L * L, 1, True, hw)
    designs["bad-noise"] = hypercube_rcs(c, r, 1, extra_local=2)
    ana["bad-noise"] = analytic_budget(hypercube_analytic_layers(c, r, 1), c * r, 3, True, hw)
    designs["bad-clifford"] = grid_rcs(L, cyc, gate_set=["SX", "SY"])
    ana["bad-clifford"] = ana["ref-grid-rcs"]
    designs["bad-blockade"] = grid_rcs(L, cyc, d=5.0)
    designs["bad-lightcone"] = grid_rcs(L, cyc, order="AB")
    ana["bad-lightcone"] = analytic_budget(grid_layers(L, cyc, order="AB"), L * L, 1, True, hw)
    designs["bad-claims"] = hypercube_rcs(c, r, rd)
    # A circuit and its inverse: the machine runs 12 layers, the state is |0>.
    comp = load_compiler()
    fwd = hypercube_rcs(8, 8, 1, gate_set=["H", "T"])
    designs["bad-mirror"] = mirror(fwd, hypercube_layers(8, 8), comp, hw)
    one = hypercube_analytic_layers(8, 8, 1)
    ana["bad-mirror"] = analytic_budget(one + one[::-1], 64, [1] * 6 + [2] + [1] * 5, True, hw)
    # Only diagonal gates on |0>: every CZ and phase acts trivially.
    designs["bad-trivial"] = hypercube_rcs(c, r, rd, gate_set=["T", "S", "Z"])
    ana["bad-trivial"] = ana["ref-hypercube-rcs"]
    return designs, ana


def load_compiler():
    import importlib.util
    spec = importlib.util.spec_from_file_location("atomx_compile_refs", os.path.join(ROOT, "na-advantage", "input", "compile.py"))
    comp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(comp)
    return comp


def claims_from(a, classical_time_s):
    return {"fidelity": a["fidelity"], "keep_probability": a["keep_probability"], "cycle_time_s": a["cycle_time_s"],
            "kept_samples": a["kept_samples"], "quantum_time_s": a["quantum_time_s"],
            "classical_time_s": classical_time_s, "score": math.log10(classical_time_s / a["quantum_time_s"])}


def careless_claims(design, hw, a):
    """What an agent gets if it multiplies only gate errors, forgets that lost
    shots are discarded, and redoes a full statevector simulation per sample."""
    e = hw["error"]
    n = len(design["atoms"])
    rounds, layers = CUBE["rounds"], int(math.log2(CUBE["cols"])) + int(math.log2(CUBE["rows"]))
    gates = rounds * layers * (n + n // 2) + n
    f = (1 - e["cz"]) ** (rounds * layers * n // 2) * (1 - e["local_1q"]) ** ((rounds * layers + 1) * n)
    kept = math.ceil(25 / f ** 2)
    cycle = a["cycle_time_s"]
    tq = kept * cycle
    tcl = kept * 8 * 2.0 ** n * gates / hw["reference_classical_machine"]["flops_per_s"]
    return {"fidelity": f, "keep_probability": a["keep_probability"], "cycle_time_s": cycle,
            "kept_samples": kept, "quantum_time_s": tq, "classical_time_s": tcl, "score": math.log10(tcl / tq)}


EXPECT = {
    "ref-grid-rcs": {"feasible": True},
    "ref-hypercube-rcs": {"feasible": True},
    "ref-hypercube-deep": {"feasible": True},
    "bad-runtime": {"feasible": False, "failure": "run_time"},
    "bad-noise": {"feasible": False, "failure": "noise"},
    "bad-clifford": {"feasible": True, "method": "stabilizer", "score_below": 0.0},
    "bad-blockade": {"feasible": False, "failure": "compile", "message": "partial blockade"},
    "bad-lightcone": {"feasible": False, "failure": "light_cone"},
    "bad-mirror": {"feasible": False, "failure": "light_cone"},
    "bad-trivial": {"feasible": True, "method": "tensor-network", "score_below": 0.0},
    "bad-claims": {"feasible": True, "claims": {
        "fidelity": "inconsistent", "keep_probability": "consistent", "cycle_time_s": "consistent",
        "kept_samples": "inconsistent", "quantum_time_s": "inconsistent", "classical_time_s": "inconsistent",
        "score": "inconsistent"}},
}


def classical_time(design, a, hw, bench, cache_path):
    """The classical time the grader's attacks give, from the committed search
    cache only (None when the circuit has no entry). The reference claims use
    it, so they are 'consistent' by construction: the classical claims are not
    an independent check, the budget claims are."""
    sys.path.insert(0, LIB)
    import hardness
    comp = load_compiler()
    circuit = comp.expand({k: v for k, v in design.items() if k != "claims"}, hw)
    c = hardness.classical(circuit, a, hw, cache_path=cache_path, allow_search=False)
    return None if c["tn_missing"] else 10 ** c["log10_classical_time_s"]


def build_all(bench, hw):
    cache_path = os.path.join(bench, "reference", "tn_cache.json")
    designs, ana = build(hw)
    missing = []
    for name in ("ref-grid-rcs", "ref-hypercube-rcs", "ref-hypercube-deep", "bad-runtime", "bad-noise",
                 "bad-clifford", "bad-lightcone", "bad-mirror", "bad-trivial"):
        t = classical_time(designs[name], ana[name], hw, bench, cache_path)
        if t is None:
            t = 1.0  # placeholder; the gate checks no classical claim of an infeasible design
            if EXPECT[name].get("feasible"):
                missing.append(name)
        designs[name]["claims"] = claims_from(ana[name], t)
    designs["bad-blockade"]["claims"] = claims_from(ana["ref-grid-rcs"], 1.0)
    designs["bad-claims"]["claims"] = careless_claims(designs["bad-claims"], hw, ana["ref-hypercube-rcs"])
    ana["bad-claims"] = ana["ref-hypercube-rcs"]
    exp = {"grid": GRID, "cube": CUBE, "deep_extra": DEEP_EXTRA,
           "designs": {name: dict(EXPECT[name], analytic=ana.get(name)) for name in designs}}
    return designs, exp, missing


def same(a, b):
    """Equal as JSON, floats to 1e-9 relative: the claims are computed, and the
    droplet's Python 3.12 / numpy 2.4 gave ref-hypercube-rcs a score one ulp
    off the Mac's 3.9 / 2.0 (1.6661800267830729 vs 1.666180026783073), which
    made every committed reference read as stale there (2026-10-25)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b or math.isclose(a, b, rel_tol=1e-9, abs_tol=0.0)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", default="na-advantage")
    ap.add_argument("--check", action="store_true", help="compare with the committed files instead of writing")
    a = ap.parse_args(argv)
    bench = os.path.join(ROOT, a.bench)
    with open(os.path.join(bench, "input", "hardware.json")) as f:
        hw = json.load(f)
    designs, exp, missing = build_all(bench, hw)
    ref = os.path.join(bench, "reference")
    if a.check:
        bad = []
        for name, d in designs.items():
            p = os.path.join(ref, name, "design.json")
            if not os.path.exists(p) or not same(json.load(open(p)), json.loads(json.dumps(d))):
                bad.append(name)
        p = os.path.join(ref, "expected.json")
        if not os.path.exists(p) or not same(json.load(open(p)), json.loads(json.dumps(exp))):
            bad.append("expected.json")
        print("make_refs --check: " + ("OK" if not bad and not missing else
              f"stale {', '.join(bad) or '-'}; no search result for {', '.join(missing) or '-'}"))
        return 1 if bad or missing else 0
    for name, d in designs.items():
        os.makedirs(os.path.join(ref, name), exist_ok=True)
        with open(os.path.join(ref, name, "design.json"), "w") as f:
            json.dump(d, f, indent=1)
    with open(os.path.join(ref, "expected.json"), "w") as f:
        json.dump(exp, f, indent=1)
    print(f"wrote {len(designs)} designs to {os.path.relpath(ref)}")
    if missing:
        print(f"no search result yet for {', '.join(missing)}: run grade.py on them with "
              f"--cache {os.path.relpath(os.path.join(ref, 'tn_cache.json'))}, then make_refs.py again")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
