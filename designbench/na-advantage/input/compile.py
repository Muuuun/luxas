#!/usr/bin/env python3
"""AtomX-400 compiler: check that a design runs on the machine, and expand it.

    python3 compile.py DESIGN.json [--hardware HARDWARE.json] [--dump CIRCUIT.json]

Prints one line: `OK: ...` (exit 0) or `ERROR: ...` (exit 1). It checks the
format (FORMAT.md) and the geometry rules (MACHINE.md, "Geometry"). It does
not estimate fidelity, run time or classical cost.

--dump writes the expanded program: every step with the atoms it acts on, the
CZ pairs and unpaired atoms of every Rydberg pulse, and the gate drawn for
every atom by every local_random entry.

Standard library only.
"""
import argparse
import difflib
import json
import math
import os
import random
import sys

FORMAT = "atomx/1"
GATES = ("H", "X", "Y", "Z", "S", "SDG", "T", "TDG", "SX", "SY", "SW")
CLIFFORD = frozenset({"H", "X", "Y", "Z", "S", "SDG", "SX", "SY"})
TOP_KEYS = ("format", "atoms", "program", "claims", "notes")
CLAIM_KEYS = ("fidelity", "keep_probability", "cycle_time_s", "kept_samples",
              "quantum_time_s", "classical_time_s", "score")
OP_KEYS = {
    "global": ("op", "gate"),
    "local": ("op", "atoms", "gate", "gates"),
    "local_random": ("op", "set", "atoms", "seed", "no_repeat"),
    "move": ("op", "x", "y", "dx", "dy"),
    "rydberg": ("op",),
    "repeat": ("op", "times", "body"),
}
ND = 6  # positions are rounded to 1e-6 um after every move


class CompileError(Exception):
    pass


def here(name):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)


def load_hardware(path=None):
    with open(path or here("hardware.json")) as f:
        return json.load(f)


def _hint(word, legal):
    near = difflib.get_close_matches(str(word), list(legal), n=1)
    return f" (did you mean {near[0]!r}?)" if near else ""


def _unknown(keys, legal, where):
    for k in keys:
        if k not in legal:
            raise CompileError(f"{where}: unknown key {k!r}{_hint(k, legal)}; legal keys: {', '.join(legal)}")


def _num(v, where):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise CompileError(f"{where}: expected a finite number, got {v!r}")
    return float(v)


def _int(v, where, lo, hi):
    if isinstance(v, bool) or not isinstance(v, int):
        raise CompileError(f"{where}: expected an integer, got {v!r}")
    if v < lo or v > hi:
        raise CompileError(f"{where}: {v} is outside [{lo}, {hi}]")
    return v


def _gate(g, where):
    if g not in GATES:
        raise CompileError(f"{where}: unknown gate {g!r}{_hint(g, GATES)}; gates: {', '.join(GATES)}")
    return g


def _atoms_arg(v, n, where):
    if v == "all":
        return list(range(n))
    if not isinstance(v, list) or not v:
        raise CompileError(f"{where}: expected \"all\" or a non-empty list of atom indices")
    out = [_int(a, f"{where}[{k}]", 0, n - 1) for k, a in enumerate(v)]
    if len(set(out)) != len(out):
        raise CompileError(f"{where}: an atom index is listed twice")
    return sorted(out)


def _coords_arg(v, where):
    if v == "all":
        return None
    if not isinstance(v, list) or not v:
        raise CompileError(f"{where}: expected \"all\" or a non-empty list of coordinates in um")
    return {round(_num(c, f"{where}[{k}]"), ND) for k, c in enumerate(v)}


def parse_atoms(atoms, hw):
    s = hw["sites"]
    pitch = s["pitch_um"]
    if not isinstance(atoms, list) or len(atoms) < 2:
        raise CompileError("atoms: expected a list of at least 2 [x_um, y_um] trap sites")
    if len(atoms) > hw["limits"]["max_atoms"]:
        raise CompileError(f"atoms: {len(atoms)} atoms, the machine holds at most {hw['limits']['max_atoms']}")
    pos, seen = [], set()
    for i, a in enumerate(atoms):
        if not (isinstance(a, list) and len(a) == 2):
            raise CompileError(f"atoms[{i}]: expected [x_um, y_um]")
        x, y = _num(a[0], f"atoms[{i}][0]"), _num(a[1], f"atoms[{i}][1]")
        ix, iy = round(x / pitch), round(y / pitch)
        if abs(x - ix * pitch) > 1e-6 or abs(y - iy * pitch) > 1e-6 or not (0 <= ix < s["nx"] and 0 <= iy < s["ny"]):
            raise CompileError(f"atoms[{i}]: ({x:g}, {y:g}) is not a trap site; sites are (i*{pitch:g}, j*{pitch:g}) um "
                               f"for 0 <= i < {s['nx']}, 0 <= j < {s['ny']}")
        if (ix, iy) in seen:
            raise CompileError(f"atoms[{i}]: site ({x:g}, {y:g}) is already loaded")
        seen.add((ix, iy))
        pos.append((round(ix * pitch, ND), round(iy * pitch, ND)))
    return pos


def close_pairs(pos, r):
    """All pairs (i, j, d) with i < j and distance d < r."""
    cells = {}
    for i, (x, y) in enumerate(pos):
        cells.setdefault((math.floor(x / r), math.floor(y / r)), []).append(i)
    out = []
    for (cx, cy), members in cells.items():
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                other = cells.get((cx + ox, cy + oy))
                if not other:
                    continue
                for i in members:
                    for j in other:
                        if j > i:
                            d = math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1])
                            if d < r:
                                out.append((i, j, d))
    return sorted(out)


def _pulse(pos, geo, where):
    partners, pairs = {}, []
    for i, j, d in close_pairs(pos, geo["isolated_min"]):
        if d > geo["pair_max"]:
            raise CompileError(f"{where}: atoms {i} and {j} are {d:.3f} um apart during a Rydberg pulse, between "
                               f"pair_max {geo['pair_max']:g} and isolated_min {geo['isolated_min']:g} um (partial blockade)")
        partners.setdefault(i, []).append(j)
        partners.setdefault(j, []).append(i)
        pairs.append([i, j])
    for a in sorted(partners):
        if len(partners[a]) > 1:
            raise CompileError(f"{where}: atom {a} is within pair_max of atoms {sorted(partners[a])}; "
                               f"a Rydberg pulse entangles atoms in pairs only")
    return pairs, [a for a in range(len(pos)) if a not in partners]


def _move(pos, op, hw, where):
    for k in ("x", "y", "dx", "dy"):
        if k not in op:
            raise CompileError(f"{where}: move needs \"x\", \"y\", \"dx\" and \"dy\"; missing {k!r}")
    xs, ys = _coords_arg(op["x"], f"{where}.x"), _coords_arg(op["y"], f"{where}.y")
    dx, dy = _num(op["dx"], f"{where}.dx"), _num(op["dy"], f"{where}.dy")
    if dx == 0 and dy == 0:
        raise CompileError(f"{where}: dx and dy are both 0")
    sel = [i for i, (x, y) in enumerate(pos) if (xs is None or x in xs) and (ys is None or y in ys)]
    if not sel:
        raise CompileError(f"{where}: the selection picks up no atom (positions are matched to 1e-6 um)")
    f = hw["field_um"]
    new = list(pos)
    for i in sel:
        x, y = round(pos[i][0] + dx, ND), round(pos[i][1] + dy, ND)
        if not (f["xmin"] <= x <= f["xmax"] and f["ymin"] <= y <= f["ymax"]):
            raise CompileError(f"{where}: atom {i} would leave the field, to ({x:g}, {y:g}) um")
        new[i] = (x, y)
    gap = hw["geometry_um"]["min_separation"]
    for i, j, d in close_pairs(new, gap):
        raise CompileError(f"{where}: atoms {i} and {j} end {d:.3f} um apart, closer than min_separation {gap:g} um")
    return new, sel, (dx, dy)


def parse_claims(c):
    if c is None:
        return None
    if not isinstance(c, dict):
        raise CompileError("claims: expected an object")
    _unknown(c.keys(), CLAIM_KEYS, "claims")
    missing = [k for k in CLAIM_KEYS if k not in c]
    if missing:
        raise CompileError(f"claims: missing {', '.join(missing)}")
    out = {}
    for k in CLAIM_KEYS:
        v = _num(c[k], f"claims.{k}")
        if k != "score" and v <= 0:
            raise CompileError(f"claims.{k}: expected a positive number, got {v!r}")
        out[k] = v
    return out


def expand(design, hw=None):
    """The design as the machine runs it. Raises CompileError."""
    hw = hw or load_hardware()
    if not isinstance(design, dict):
        raise CompileError("design: expected a JSON object")
    _unknown(design.keys(), TOP_KEYS, "design")
    if design.get("format") != FORMAT:
        raise CompileError(f"format: expected {FORMAT!r}, got {design.get('format')!r}")
    pos = parse_atoms(design.get("atoms"), hw)
    n = len(pos)
    prog = design.get("program")
    if not isinstance(prog, list) or not prog:
        raise CompileError("program: expected a non-empty list of steps")
    claims = parse_claims(design.get("claims"))
    limit = hw["limits"]["max_steps"]
    steps = []
    state = {"pos": pos, "last": [None] * n, "count": {}}

    def run(ops, path):
        for k, op in enumerate(ops):
            where = f"{path}[{k}]"
            if not isinstance(op, dict) or "op" not in op:
                raise CompileError(f"{where}: expected an object with an \"op\" key")
            kind = op["op"]
            if kind not in OP_KEYS:
                raise CompileError(f"{where}: unknown op {kind!r}{_hint(kind, OP_KEYS)}; ops: {', '.join(OP_KEYS)}")
            _unknown(op.keys(), OP_KEYS[kind], where)
            if kind == "repeat":
                times = _int(op.get("times"), f"{where}.times", 1, limit)
                body = op.get("body")
                if not isinstance(body, list) or not body:
                    raise CompileError(f"{where}.body: expected a non-empty list of steps")
                for r in range(times):
                    run(body, f"{where}.body(repetition {r + 1})")
                continue
            if len(steps) >= limit:
                raise CompileError(f"program: more than {limit} steps after expanding repeats")
            if kind == "global":
                steps.append({"kind": "1q", "mode": "global", "gate": _gate(op.get("gate"), f"{where}.gate")})
            elif kind == "local":
                if ("gates" in op) == ("gate" in op or "atoms" in op):
                    raise CompileError(f"{where}: local takes either \"atoms\" with \"gate\", or \"gates\"")
                if "gates" in op:
                    g = op["gates"]
                    if not isinstance(g, dict) or not g:
                        raise CompileError(f"{where}.gates: expected an object mapping atom index to gate")
                    out = []
                    for a, name in g.items():
                        if not (isinstance(a, str) and a.isdigit()):
                            raise CompileError(f"{where}.gates: key {a!r} is not an atom index")
                        out.append([_int(int(a), f"{where}.gates[{a}]", 0, n - 1), _gate(name, f"{where}.gates[{a}]")])
                    out.sort()
                else:
                    if "atoms" not in op or "gate" not in op:
                        raise CompileError(f"{where}: local with \"atoms\" also needs \"gate\"")
                    name = _gate(op["gate"], f"{where}.gate")
                    out = [[a, name] for a in _atoms_arg(op["atoms"], n, f"{where}.atoms")]
                steps.append({"kind": "1q", "mode": "local", "gates": out})
            elif kind == "local_random":
                gs = op.get("set")
                if not isinstance(gs, list) or len(gs) < 2 or len(set(map(str, gs))) != len(gs):
                    raise CompileError(f"{where}.set: expected a list of at least 2 distinct gates")
                for g in gs:
                    _gate(g, f"{where}.set")
                atoms = _atoms_arg(op.get("atoms", "all"), n, f"{where}.atoms")
                seed = _int(op.get("seed"), f"{where}.seed", 0, 2**63 - 1)
                no_rep = op.get("no_repeat", False)
                if not isinstance(no_rep, bool):
                    raise CompileError(f"{where}.no_repeat: expected true or false")
                c = state["count"].get(id(op), 0)
                state["count"][id(op)] = c + 1
                rng = random.Random(f"{seed}:{c}")
                out = []
                for a in atoms:
                    cands = [g for g in gs if not (no_rep and state["last"][a] == g)]
                    g = cands[rng.randrange(len(cands))]
                    state["last"][a] = g
                    out.append([a, g])
                steps.append({"kind": "1q", "mode": "local", "gates": out})
            elif kind == "move":
                new, sel, (dx, dy) = _move(state["pos"], op, hw, where)
                state["pos"] = new
                steps.append({"kind": "move", "atoms": sel, "dx": dx, "dy": dy, "distance_um": math.hypot(dx, dy)})
            else:  # rydberg
                pairs, unpaired = _pulse(state["pos"], hw["geometry_um"], where)
                steps.append({"kind": "rydberg", "pairs": pairs, "unpaired": unpaired})

    run(prog, "program")
    return {"n": n, "atoms": [list(p) for p in pos], "steps": steps, "claims": claims}


def summary(c):
    pulses = [s for s in c["steps"] if s["kind"] == "rydberg"]
    return (f"{c['n']} atoms, {len(c['steps'])} steps, {len(pulses)} Rydberg pulses, "
            f"{sum(len(s['pairs']) for s in pulses)} CZ pairs" + ("" if c["claims"] else "; no claims block yet"))


def main(argv):
    ap = argparse.ArgumentParser(description="Check and expand an AtomX-400 design.")
    ap.add_argument("design")
    ap.add_argument("--hardware", default=None)
    ap.add_argument("--dump", default=None, help="write the expanded program to this file")
    a = ap.parse_args(argv)
    try:
        with open(a.design) as f:
            design = json.load(f)
    except (OSError, ValueError) as e:
        print(f"ERROR: cannot read {a.design}: {e}")
        return 1
    try:
        c = expand(design, load_hardware(a.hardware))
    except CompileError as e:
        print(f"ERROR: {e}")
        return 1
    if a.dump:
        with open(a.dump, "w") as f:
            json.dump({k: c[k] for k in ("n", "atoms", "steps")}, f)
    print(f"OK: {summary(c)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
