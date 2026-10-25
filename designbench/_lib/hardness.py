"""Classical cost of reproducing an AtomX design's samples (MACHINE.md, "Classical cost").

Three attacks, all on the expanded circuit, with no charge for memory (this
favors the classical side):
  statevector     all 2^n amplitudes at once: 8 * 2^n * G FLOPs for G gates
  tensor network  one amplitude at a time: the cheapest single-amplitude
                  contraction our search finds (quimb simplification + cotengra
                  hyper-optimizer)
  stabilizer      N^3 * 2^(0.228 t) per amplitude for t non-Clifford gates

The tensor-network number is an upper bound on what a better search would
find, so a design's score is only as good as our search. It is cached by
circuit hash because the search takes minutes. Slicing to a memory limit was
tried and dropped (2026-10-23): plain slicing of the best unsliced tree added
10 decades on a 10x10 grid and none on a hypercube, an artefact of the
search, not of the circuits.
"""
import hashlib
import json
import math
import os
import random
import time

CLIFFORD = frozenset({"H", "X", "Y", "Z", "S", "SDG", "SX", "SY"})
QUIMB_GATE = {"H": "H", "X": "X", "Y": "Y", "Z": "Z", "S": "S", "SDG": "SDG", "T": "T", "TDG": "TDG",
              "SX": "X_1_2", "SY": "Y_1_2", "SW": "W_1_2"}
STAB_EXPONENT = 0.228
STAB_TRIVIAL_LOG10 = 12.0   # FLOPs per amplitude
TN_VERSION = "tn-1"  # bump when the search settings change: it keys the cache

_R = 0.5 ** 0.5
_W = complex(_R, _R)            # (1 + i)/sqrt(2)
MAT = {                          # up to global phase, as in MACHINE.md
    "H": ((_R, _R), (_R, -_R)),
    "X": ((0, 1), (1, 0)),
    "Y": ((0, -1j), (1j, 0)),
    "Z": ((1, 0), (0, -1)),
    "S": ((1, 0), (0, 1j)),
    "SDG": ((1, 0), (0, -1j)),
    "T": ((1, 0), (0, _W)),
    "TDG": ((1, 0), (0, _W.conjugate())),
    "SX": ((_R, -1j * _R), (-1j * _R, _R)),
    "SY": ((_R, -_R), (_R, _R)),
    "SW": ((_R, -_W * _R), (_W.conjugate() * _R, _R)),
}
_PAULI = (MAT["X"], MAT["Y"], MAT["Z"])


def _mul(a, b):
    return ((a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]),
            (a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]))


def _dag(a):
    return tuple(tuple(complex(a[j][i]).conjugate() for j in (0, 1)) for i in (0, 1))


def _close(a, b, tol=1e-9):
    return all(abs(a[i][j] - b[i][j]) < tol for i in (0, 1) for j in (0, 1))


def is_identity(u):
    return abs(u[0][1]) < 1e-9 and abs(u[1][0]) < 1e-9 and abs(u[0][0] - u[1][1]) < 1e-9


def is_clifford(u):
    """u maps X and Z to signed Paulis under conjugation."""
    for p in (MAT["X"], MAT["Z"]):
        q = _mul(_mul(u, p), _dag(u))
        if not any(_close(q, s) or _close(q, tuple(tuple(-x for x in row) for row in s)) for s in _PAULI):
            return False
    return True


def gate_sequence(circuit):
    """[(gate, qubits), ...] in program order: what the machine runs."""
    n, seq = circuit["n"], []
    for s in circuit["steps"]:
        if s["kind"] == "1q":
            if s["mode"] == "global":
                seq.extend((s["gate"], (q,)) for q in range(n))
            else:
                seq.extend((g, (a,)) for a, g in s["gates"])
        elif s["kind"] == "rydberg":
            seq.extend(("CZ", (a, b)) for a, b in s["pairs"])
    return seq


def _merged_name(u):
    return "U:" + ",".join(f"{z.real:.9f}{z.imag:+.9f}j" for row in u for z in (complex(row[0]), complex(row[1])))


def reduce_sequence(seq):
    """What the attacker simulates: the machine's sequence with the gates that
    multiply to the identity removed (MACHINE.md, "Classical cost").

    Each run of single-qubit gates on an atom with no CZ on that atom in
    between becomes one gate, and is dropped if it is the identity up to
    phase; two CZs on the same pair with nothing on either atom in between
    cancel. Repeated until nothing changes, so a circuit followed by its
    inverse reduces to nothing. Positions are kept: when nothing cancels or
    merges the result is the input, entry for entry. Returns
    [(name, qubits, matrix or None), ...]; a merged gate is named "U:<entries>".
    """
    ops = [[g, tuple(q), None if g == "CZ" else MAT[g]] for g, q in seq]
    alive = [True] * len(ops)
    changed = True
    while changed:
        changed = False
        runs = {}                                   # qubit -> indices of its current 1q run
        def close_run(q):
            nonlocal changed
            idx = runs.pop(q, [])
            if not idx:
                return
            u = ops[idx[0]][2]
            for i in idx[1:]:
                u = _mul(ops[i][2], u)
            if is_identity(u):
                for i in idx:
                    alive[i] = False
                changed = True
            elif len(idx) > 1:
                for i in idx[:-1]:
                    alive[i] = False
                ops[idx[-1]] = [_merged_name(u), ops[idx[-1]][1], u]
                changed = True
        for i, (g, qs, _) in enumerate(ops):
            if not alive[i]:
                continue
            if g == "CZ":
                for q in qs:
                    close_run(q)
            else:
                runs.setdefault(qs[0], []).append(i)
        for q in list(runs):
            close_run(q)
        stack = {}
        for i, (g, qs, _) in enumerate(ops):
            if not alive[i]:
                continue
            if g == "CZ":
                a, b = qs
                ta, tb = stack.get(a, []), stack.get(b, [])
                if ta and tb and ta[-1] == tb[-1] and ops[ta[-1]][0] == "CZ" and set(ops[ta[-1]][1]) == {a, b}:
                    alive[ta[-1]] = alive[i] = False
                    ta.pop()
                    tb.pop()
                    changed = True
                    continue
            for q in qs:
                stack.setdefault(q, []).append(i)
    return [(g, qs, m) for (g, qs, m), ok in zip(ops, alive) if ok]


def counts(reduced):
    t = sum(1 for g, _, m in reduced if g != "CZ" and not (g in CLIFFORD or (g.startswith("U:") and is_clifford(m))))
    return {"gates": len(reduced), "non_clifford": t, "cz": sum(1 for g, _, _ in reduced if g == "CZ")}


def light_cone_complete(reduced, n):
    """(complete, number of complete atoms): every atom's final state depends
    on every atom's initial state through the CZs that survive reduction."""
    reach = [1 << i for i in range(n)]
    for g, qs, _ in reduced:
        if g == "CZ":
            a, b = qs
            reach[a] = reach[b] = reach[a] | reach[b]
    full = (1 << n) - 1
    k = sum(1 for r in reach if r == full)
    return k == n, k


def circuit_hash(n, reduced):
    h = hashlib.sha256()
    h.update(json.dumps([n, [(g, list(qs)) for g, qs, _ in reduced]], separators=(",", ":")).encode())
    return h.hexdigest()


def tn_cost(n, reduced, repeats=32, seed=0):
    import numpy as np
    import quimb.tensor as qtn
    import cotengra as ctg
    circ = qtn.Circuit(n)
    for g, qs, m in reduced:
        if g == "CZ" or g in QUIMB_GATE:
            circ.apply_gate("CZ" if g == "CZ" else QUIMB_GATE[g], *qs)
        else:
            circ.apply_gate_raw(np.array(m, dtype=complex), qs)
    random.seed(seed)
    np.random.seed(seed)
    t0 = time.time()
    opt = ctg.HyperOptimizer(methods=["greedy", "kahypar"], max_repeats=repeats, max_time=None,
                             minimize="flops", parallel=False, progbar=False)
    tree = circ.amplitude_rehearse("0" * n, simplify_sequence="ADCRS", optimize=opt)["tree"]
    return {"log10_flops": math.log10(max(tree.contraction_cost(), 1)), "width_log2": tree.contraction_width(),
            "search_s": round(time.time() - t0, 1), "settings": TN_VERSION}


def load_cache(path):
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_cache(path, cache):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def classical(circuit, b, hw, cache_path=None, allow_search=True, reduced=None):
    """Classical time to reproduce b['kept_samples'] samples at fidelity b['fidelity']."""
    ref = hw["reference_classical_machine"]
    n = circuit["n"]
    if reduced is None:
        reduced = reduce_sequence(gate_sequence(circuit))
    c = counts(reduced)
    out = {"gates": c["gates"], "non_clifford": c["non_clifford"],
           "gates_before_reduction": len(gate_sequence(circuit))}
    out["log10_statevector_flops"] = math.log10(8.0) + n * math.log10(2.0) + math.log10(max(c["gates"], 1))
    out["log10_stabilizer_flops"] = 3 * math.log10(n) + STAB_EXPONENT * c["non_clifford"] * math.log10(2.0)
    key = f"{TN_VERSION}:{circuit_hash(n, reduced)}"
    # Below STAB_TRIVIAL_LOG10 a per-amplitude stabilizer attack is already
    # cheap: no tensor-network search can change the verdict, so none is run.
    trivial = out["log10_stabilizer_flops"] <= STAB_TRIVIAL_LOG10
    cache = load_cache(cache_path)
    tn = cache.get(key)
    if tn is None and allow_search and not trivial:
        tn = tn_cost(n, reduced)
        if cache_path:
            cache[key] = tn
            save_cache(cache_path, cache)
    out["tn"] = tn
    out["circuit_hash"] = key
    out["tn_skipped"] = "stabilizer attack already trivial" if trivial and tn is None else None
    per_amp = [out["log10_stabilizer_flops"]] + ([tn["log10_flops"]] if tn else [])
    out["log10_flops_per_amplitude"] = min(per_amp)
    out["per_amplitude_method"] = "tensor-network" if tn and tn["log10_flops"] <= out["log10_stabilizer_flops"] else "stabilizer"
    log10_sampling = math.log10(b["kept_samples"] * b["fidelity"]) + out["log10_flops_per_amplitude"]
    methods = {"per-amplitude": log10_sampling, "statevector": out["log10_statevector_flops"]}
    best = min(methods, key=methods.get)
    out["method"] = out["per_amplitude_method"] if best == "per-amplitude" else "statevector"
    out["log10_classical_flops"] = methods[best]
    out["log10_classical_time_s"] = methods[best] - math.log10(ref["flops_per_s"])
    out["tn_missing"] = tn is None and not trivial
    return out
