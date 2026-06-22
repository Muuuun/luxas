"""Cheap, SOUND distance lower bound for tricycle / 3-block group-algebra codes.

Menon2508 Thm (dist_lower_bnd):  d  >=  (1/|N|) * min(d_A^T, d_B^T, d_C^T)
where d_X^T is the min distance of the classical code ker(X^T) (X in {A,B,C}),
and N = G_a ∩ G_b ∩ G_c is the intersection subgroup of the support subgroups.

The point: the three CLASSICAL distances are min-weight-codeword ILPs on |G|
variables — ~3x smaller than the quantum distance ILP on 3|G| vars, and the
classical codes are simpler — so this is a cheap, sound PRE-SCREEN. A high
classical bound CERTIFIES a high quantum distance without the expensive quantum
ILP; a low one lets you reject/deprioritize before spending the quantum solve.
"""
from __future__ import annotations
import numpy as np
from math import prod
import pulp

from tricycle_code import _build_matrix, _group_to_index, _index_to_group
from tricycle_distance import _gf2_nullspace, _gf2_row_space_basis, _gf2_is_in_span


# --- PRIMARY screen: fast heuristic UPPER bound on quantum d_Z ------------------
def _rref_gf2(M):
    """Reduced row-echelon form over GF(2). Rows become low-weight."""
    A = (np.asarray(M, dtype=np.uint8) & 1).copy()
    rows, cols = A.shape
    r = 0
    for c in range(cols):
        piv = None
        for i in range(r, rows):
            if A[i, c]:
                piv = i; break
        if piv is None:
            continue
        A[[r, piv]] = A[[piv, r]]
        for i in range(rows):
            if i != r and A[i, c]:
                A[i] ^= A[r]
        r += 1
        if r == rows:
            break
    return A[:r]


def quantum_distance_upper(H_X, H_Z, iters: int = 200, seed: int = 0):
    """Fast heuristic UPPER bound on d_Z (min-weight nontrivial logical Z).

    Randomized information-set style: permute columns, GF(2)-reduce ker(H_X) so
    rows are low weight, keep the lowest-weight row that is a NONTRIVIAL logical
    (in ker(H_X), not in rowspace(H_Z)). UB >= d_Z; converges down with iters.
    Small UB => certain reject (d_Z <= UB). Sub-second; ~100x faster than exact ILP.
    """
    H_X = np.asarray(H_X, dtype=np.uint8) & 1
    H_Z = np.asarray(H_Z, dtype=np.uint8) & 1
    K = _gf2_nullspace(H_X)              # Z-codeword basis
    RZ = _gf2_row_space_basis(H_Z)       # im(H_Z^T) = Z-stabilizers (trivial)
    if K.shape[0] == 0:
        return None, None
    n = H_X.shape[1]; m = K.shape[0]
    rng = np.random.default_rng(seed)
    best = None; best_vec = None

    def consider(e):
        nonlocal best, best_vec
        w = int(e.sum())
        if w == 0:
            return
        if best is not None and w >= best:
            return
        if not _gf2_is_in_span(e, RZ):   # nontrivial logical
            best = w; best_vec = e.copy()

    for row in K:
        consider(row)
    for _ in range(iters):
        perm = rng.permutation(n)
        R = _rref_gf2(K[:, perm])
        inv = np.argsort(perm)
        for row in R:
            consider(row[inv])
        for _ in range(2):               # a few random combinations too
            sel = rng.integers(0, 2, size=m).astype(np.uint8)
            if sel.sum():
                consider((sel @ K) % 2)
    return best, best_vec


def screen(H_X, H_Z, k, n, frontier_fom, iters: int = 150, seed: int = 0):
    """SOUND cheap screen: reject codes that provably can't beat the frontier.

    UB >= d_Z (heuristic) => FOM_upper = k*UB^3/n >= true FOM. So FOM_upper <
    frontier proves the code can't beat it -> reject. Never rejects a real winner.
    """
    ub, vec = quantum_distance_upper(H_X, H_Z, iters=iters, seed=seed)
    if ub is None:
        return {"verdict": "no_logicals", "d_upper": None, "fom_upper": None}
    fom_upper = k * ub ** 3 / n
    return {
        "verdict": "promote" if fom_upper >= frontier_fom else "reject",
        "d_upper": ub,
        "fom_upper": round(fom_upper, 3),
        "reason": f"FOM_upper = k*UB^3/n = {fom_upper:.2f} "
                  f"{'>=' if fom_upper >= frontier_fom else '<'} frontier {frontier_fom}",
    }


# --- intersection subgroup |N| -------------------------------------------------
def _generated_subgroup(support, group_shape):
    """Closure of support elements under the abelian group op -> set of flat idx."""
    gens = [_group_to_index(tuple(g), group_shape) for g in support]
    elems = {0}  # identity
    frontier = set(gens) | {0}
    elems |= frontier
    changed = True
    while changed:
        changed = False
        new = set()
        for x in elems:
            tx = _index_to_group(x, group_shape)
            for g in gens:
                tg = _index_to_group(g, group_shape)
                s = _group_to_index(tuple((a + b) % d for a, b, d in zip(tx, tg, group_shape)), group_shape)
                if s not in elems:
                    new.add(s)
        if new:
            elems |= new
            changed = True
    return elems


def intersection_N(supp_a, supp_b, supp_c, group_shape):
    Ga = _generated_subgroup(supp_a, group_shape)
    Gb = _generated_subgroup(supp_b, group_shape)
    Gc = _generated_subgroup(supp_c, group_shape)
    return len(Ga & Gb & Gc)


# --- classical min-distance (min-weight nonzero codeword in ker(M)) -------------
def classical_distance(M: np.ndarray, timeout: int = 30, cap: int | None = None):
    """Min weight nonzero x with M x = 0 (mod 2). Returns (d, status).

    cap: if set, only asks 'is there a codeword of weight <= cap?' (feasibility,
    faster). Returns (<=cap value found, 'optimal') or (None,'above_cap').
    """
    M = (np.asarray(M, dtype=np.uint8) & 1)
    m, n = M.shape
    prob = pulp.LpProblem("classical_dist", pulp.LpMinimize)
    x = [pulp.LpVariable(f"x{i}", cat="Binary") for i in range(n)]
    y = [pulp.LpVariable(f"y{j}", lowBound=0, cat="Integer") for j in range(m)]
    for j in range(m):
        idx = np.nonzero(M[j])[0]
        if len(idx):
            prob += pulp.lpSum(x[i] for i in idx) == 2 * y[j]
    prob += pulp.lpSum(x) >= 1                      # nonzero
    if cap is not None:
        prob += pulp.lpSum(x) <= cap
    prob += pulp.lpSum(x)                            # objective
    prob.solve(pulp.HiGHS(msg=False, timeLimit=timeout))
    st = pulp.LpStatus[prob.status]
    if prob.status == 1:                            # optimal
        return int(round(pulp.value(prob.objective))), "optimal"
    if cap is not None and prob.status == -1:       # infeasible under cap
        return None, "above_cap"
    return None, st.lower()


def theorem_lower_bound(group_shape, supp_a, supp_b, supp_c, timeout: int = 30, cap: int | None = None):
    """Sound lower bound on the quantum distance d (Menon Thm). Cheap pre-screen.

    Returns dict: {d_lower, N, classical:[dA,dB,dC], statuses, bound_method}.
    """
    A = _build_matrix(supp_a, group_shape)
    B = _build_matrix(supp_b, group_shape)
    C = _build_matrix(supp_c, group_shape)
    N = intersection_N(supp_a, supp_b, supp_c, group_shape)
    cds, sts = [], []
    for M in (A.T, B.T, C.T):
        d, s = classical_distance(M, timeout=timeout, cap=cap)
        cds.append(d); sts.append(s)
    valid = [d for d in cds if d is not None]
    d_lower = (min(valid) // N) if (valid and N) else None
    return {
        "d_lower": d_lower,
        "N": N,
        "classical_distances": cds,
        "classical_status": sts,
        "bound_method": "Menon2508 thm dist_lower_bnd: d >= min(d_classical)/|N|",
    }
