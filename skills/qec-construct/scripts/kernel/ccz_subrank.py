#!/usr/bin/env python3
"""Compute logical CCZ subrank K_CCZ for a tricycle code.

Given a constructed tricycle code (group_shape, H_X, H_Z, and partitions
a_in/a_out, b_in/b_out, c_in/c_out), this module:

1. Computes ker(H_Z) / im(H_X^T) to obtain logical X representatives.
2. Extracts the support of each representative on each of the three blocks
   (expressed as exponent tuples in the group G).
3. Builds the logical CCZ tensor T_{ijk} via the canonical f_CCZ trilinear
   form using GF(2) group-algebra convolutions.
4. Determines K_CCZ via greedy decomposition (or exact ILP for small k).
"""

from __future__ import annotations

import numpy as np
from math import prod
from typing import Tuple, List, Dict, Any, Set, Optional


# ============================================================================
# GF(2) linear algebra helpers
# ============================================================================

def _gf2_rref(M: np.ndarray) -> Tuple[np.ndarray, int]:
    """Row-reduced echelon form over GF(2).  Returns (R, rank)."""
    m, n = M.shape
    R = M.copy() % 2
    pivot_col = 0
    pivot_row = 0
    while pivot_row < m and pivot_col < n:
        found = None
        for i in range(pivot_row, m):
            if R[i, pivot_col]:
                found = i
                break
        if found is None:
            pivot_col += 1
            continue
        if found != pivot_row:
            R[[pivot_row, found]] = R[[found, pivot_row]]
        # Eliminate other rows
        for i in range(m):
            if i != pivot_row and R[i, pivot_col]:
                R[i] = (R[i] + R[pivot_row]) % 2
        pivot_row += 1
        pivot_col += 1
    return R, pivot_row


def _gf2_nullspace(M: np.ndarray) -> np.ndarray:
    """Basis of the nullspace of M over GF(2).  Returns (dim_null, n) array."""
    m, n = M.shape
    R, rank = _gf2_rref(M)

    # Find pivot columns
    pivot_cols: List[int] = []
    for i in range(rank):
        for j in range(n):
            if R[i, j]:
                pivot_cols.append(j)
                break
    free_cols = [j for j in range(n) if j not in pivot_cols]

    nullspace = np.zeros((len(free_cols), n), dtype=np.uint8)
    for idx, fc in enumerate(free_cols):
        nullspace[idx, fc] = 1
        for i, pc in enumerate(pivot_cols):
            nullspace[idx, pc] = R[i, fc]
    return nullspace


def _gf2_row_space_basis(M: np.ndarray) -> np.ndarray:
    """Basis of the row space of M over GF(2).  Returns (rank, n) array."""
    R, rank = _gf2_rref(M)
    return R[:rank].copy()


def _gf2_col_space_basis(M: np.ndarray) -> np.ndarray:
    """Basis of the column space of M over GF(2).  Returns (rank, n) array."""
    return _gf2_row_space_basis(M.T)


def _gf2_reduce(v: np.ndarray, basis: np.ndarray) -> np.ndarray:
    """Reduce v modulo the subspace spanned by *basis* (rows)."""
    if basis.shape[0] == 0:
        return v.copy() % 2
    R, rank = _gf2_rref(basis)
    result = v.copy() % 2
    for i in range(rank):
        for j in range(basis.shape[1]):
            if R[i, j]:
                if result[j]:
                    result = (result + R[i]) % 2
                break
    return result


def _gf2_is_in_span(v: np.ndarray, basis: np.ndarray) -> bool:
    """Return True if *v* lies in the GF(2) span of *basis* (rows)."""
    return not np.any(_gf2_reduce(v, basis))


def _gf2_quotient_basis(V_basis: np.ndarray, W_basis: np.ndarray) -> np.ndarray:
    """Basis of V / W over GF(2).

    V_basis, W_basis are (dim, n) arrays (rows = basis vectors).
    Returns a (dim_quot, n) array whose rows form a basis of the quotient.
    """
    n = V_basis.shape[1]
    current = W_basis.copy()
    quot_rows: List[np.ndarray] = []
    for i in range(V_basis.shape[0]):
        v = V_basis[i]
        if not _gf2_is_in_span(v, current):
            quot_rows.append(v.copy())
            if current.shape[0] == 0:
                current = v.reshape(1, -1)
            else:
                current = np.vstack([current, v])
    if not quot_rows:
        return np.zeros((0, n), dtype=np.uint8)
    return np.array(quot_rows, dtype=np.uint8)


# ============================================================================
# Group-element helpers (flat-index ↔ exponent tuples)
# ============================================================================

def _flat_to_tuple(idx: int, group_shape: Tuple[int, ...]) -> Tuple[int, ...]:
    """Convert a flat group index to an exponent tuple (mixed-radix)."""
    exps: List[int] = []
    for d in reversed(group_shape):
        exps.append(idx % d)
        idx //= d
    return tuple(reversed(exps))


def _tuple_to_flat(t: Tuple[int, ...], group_shape: Tuple[int, ...]) -> int:
    """Convert an exponent tuple to a flat group index."""
    idx = 0
    for e, d in zip(t, group_shape):
        idx = idx * d + e
    return idx


def _group_add(a: int, b: int, group_shape: Tuple[int, ...]) -> int:
    """Add two group elements (flat indices), componentwise mod group_shape."""
    ta = _flat_to_tuple(a, group_shape)
    tb = _flat_to_tuple(b, group_shape)
    s = tuple((ea + eb) % d for ea, eb, d in zip(ta, tb, group_shape))
    return _tuple_to_flat(s, group_shape)


def _group_sub(a: int, b: int, group_shape: Tuple[int, ...]) -> int:
    """Subtract b from a (componentwise mod group_shape)."""
    ta = _flat_to_tuple(a, group_shape)
    tb = _flat_to_tuple(b, group_shape)
    s = tuple((ea - eb) % d for ea, eb, d in zip(ta, tb, group_shape))
    return _tuple_to_flat(s, group_shape)


# ============================================================================
# GF(2) group-algebra convolution
# ============================================================================

def _subset_to_bool(exponents: List[Tuple[int, ...]],
                    group_shape: Tuple[int, ...]) -> np.ndarray:
    """Convert a list of exponent tuples to a boolean array of size |G|."""
    n_G = prod(group_shape)
    arr = np.zeros(n_G, dtype=bool)
    for t in exponents:
        arr[_tuple_to_flat(t, group_shape)] = True
    return arr


def _convolve_gf2(A_bool: np.ndarray, B_bool: np.ndarray,
                  group_shape: Tuple[int, ...]) -> np.ndarray:
    """Convolution A ⋆ B in the GF(2) group algebra of G.

    Returns a boolean array of size |G| where entry x is 1 iff
    Σ_{y∈G} A(y)·B(x−y) ≡ 1 (mod 2).

    Complexity O(|A|·|B|) where |A|,|B| are support sizes.
    """
    n_G = prod(group_shape)
    A_idx = np.where(A_bool)[0]
    B_idx = np.where(B_bool)[0]
    result = np.zeros(n_G, dtype=bool)
    for a in A_idx:
        for b in B_idx:
            c = _group_add(a, b, group_shape)
            result[c] = not result[c]  # toggle (XOR)
    return result


# ============================================================================
# f_CCZ logical tensor
# ============================================================================

def _compute_f_ccz_tensor(
    L1: List[Set[int]],    # supports (flat indices) for block I logical X ops
    L2: List[Set[int]],    # supports for block II
    L3: List[Set[int]],    # supports for block III
    M_ab: np.ndarray,      # boolean array: a_in ⋆ b_in  (size n_G)
    M_ac: np.ndarray,      # boolean array: a_in ⋆ c_out
    M_bc: np.ndarray,      # boolean array: b_out ⋆ c_out
    group_shape: Tuple[int, ...],
) -> Tuple[np.ndarray, int]:
    """Compute logical CCZ tensor T and physical CCZ gate count.

    T_{ijk} = Σ_{p∈L1_i, q∈L2_j, r∈L3_k}
                |(M_ab+r) ∩ (M_ac+q) ∩ (M_bc+p)|  (mod 2)

    Returns (T, ccz_gate_count) where ccz_gate_count is the integer sum
    of all intersection sizes (before mod 2) — the total number of
    physical CCZ triples across all logical operators.
    """
    k1, k2, k3 = len(L1), len(L2), len(L3)
    n_G = prod(group_shape)
    T = np.zeros((k1, k2, k3), dtype=np.uint8)
    ccz_gate_count = 0

    # Precompute shifted versions of M_ab, M_ac, M_bc for fast intersection.
    # M_ab_plus[g][x] = 1  iff  x ∈ M_ab + g  i.e. x-g ∈ M_ab.
    M_ab_plus: List[np.ndarray] = []
    M_ac_plus: List[np.ndarray] = []
    M_bc_plus: List[np.ndarray] = []

    for g in range(n_G):
        g_t = _flat_to_tuple(g, group_shape)
        s_ab = np.zeros(n_G, dtype=bool)
        s_ac = np.zeros(n_G, dtype=bool)
        s_bc = np.zeros(n_G, dtype=bool)
        for x in range(n_G):
            x_t = _flat_to_tuple(x, group_shape)
            xmg = tuple((x_t[i] - g_t[i]) % group_shape[i]
                        for i in range(len(group_shape)))
            xmg_idx = _tuple_to_flat(xmg, group_shape)
            s_ab[x] = M_ab[xmg_idx]
            s_ac[x] = M_ac[xmg_idx]
            s_bc[x] = M_bc[xmg_idx]
        M_ab_plus.append(s_ab)
        M_ac_plus.append(s_ac)
        M_bc_plus.append(s_bc)

    for i in range(k1):
        for j in range(k2):
            for k in range(k3):
                val_mod2 = 0
                for p in L1[i]:
                    for q in L2[j]:
                        for r in L3[k]:
                            # Intersection in GF(2) group algebra
                            inter = (M_ab_plus[r] &
                                     M_ac_plus[q] &
                                     M_bc_plus[p])
                            cnt = int(np.count_nonzero(inter))
                            ccz_gate_count += cnt
                            if cnt % 2 == 1:
                                val_mod2 ^= 1
                T[i, j, k] = val_mod2

    return T, ccz_gate_count


# ============================================================================
# K_CCZ subrank computation
# ============================================================================

def _kccz_greedy(T: np.ndarray) -> Tuple[int, List[Tuple[int, int, int]]]:
    """Greedy decomposition of the logical CCZ tensor.

    Iteratively picks a unit entry, removes all entries sharing any of its
    three indices, and repeats.  Returns (K_CCZ, decomposition list).
    """
    # Collect all non-zero (i,j,k) as a set
    entries: Set[Tuple[int, int, int]] = set()
    idxs = np.where(T != 0)
    for i, j, k in zip(idxs[0], idxs[1], idxs[2]):
        entries.add((int(i), int(j), int(k)))

    decomposition: List[Tuple[int, int, int]] = []

    while entries:
        # Pick any entry (first from iteration)
        i0, j0, k0 = next(iter(entries))
        decomposition.append((i0, j0, k0))

        # Remove all entries sharing i0, j0, or k0
        to_remove = {(i, j, k) for (i, j, k) in entries
                     if i == i0 or j == j0 or k == k0}
        entries -= to_remove

    return len(decomposition), decomposition


def _kccz_ilp(T: np.ndarray) -> Tuple[int, List[Tuple[int, int, int]]]:
    """Exact K_CCZ via integer linear programming (maximum 3D matching).

    Uses PuLP with the default CBC solver.
    """
    import pulp

    k1, k2, k3 = T.shape

    # Collect non-zero entries
    variables: Dict[Tuple[int, int, int], pulp.LpVariable] = {}
    entries: List[Tuple[int, int, int]] = []
    idxs = np.where(T != 0)
    for i, j, k in zip(idxs[0], idxs[1], idxs[2]):
        ijk = (int(i), int(j), int(k))
        entries.append(ijk)
        variables[ijk] = pulp.LpVariable(f"x_{i}_{j}_{k}", cat="Binary")

    if not entries:
        return 0, []

    prob = pulp.LpProblem("K_CCZ_ILP", pulp.LpMaximize)

    # Objective: maximize sum of selected entries
    prob += pulp.lpSum(variables[ijk] for ijk in entries)

    # Constraints: at most one entry per i, per j, per k
    for i in range(k1):
        prob += (pulp.lpSum(variables[ijk] for ijk in entries if ijk[0] == i)
                 <= 1, f"row_{i}")

    for j in range(k2):
        prob += (pulp.lpSum(variables[ijk] for ijk in entries if ijk[1] == j)
                 <= 1, f"col_{j}")

    for k in range(k3):
        prob += (pulp.lpSum(variables[ijk] for ijk in entries if ijk[2] == k)
                 <= 1, f"tube_{k}")

    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    if pulp.LpStatus[prob.status] != "Optimal":
        # Fall back to greedy if ILP fails
        return _kccz_greedy(T)

    K = int(pulp.value(prob.objective))
    decomposition = [ijk for ijk in entries
                     if pulp.value(variables[ijk]) > 0.5]

    return K, decomposition


def _pairwise_disjoint_exists(T: np.ndarray) -> bool:
    """Return True if T has at least two non-zero entries with
    pairwise-disjoint indices (i1≠i2, j1≠j2, k1≠k2)."""
    idxs = np.where(T != 0)
    entries = list(zip(idxs[0], idxs[1], idxs[2]))
    m = len(entries)
    for a in range(m):
        i1, j1, k1 = entries[a]
        for b in range(a + 1, m):
            i2, j2, k2 = entries[b]
            if i1 != i2 and j1 != j2 and k1 != k2:
                return True
    return False


# ============================================================================
# Public API
# ============================================================================

def compute_ccz_subrank(
    group_shape: Tuple[int, ...],
    H_X: np.ndarray,
    H_Z: np.ndarray,
    partition_a: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
    partition_b: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
    partition_c: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
    use_exact: bool = False,
) -> Dict[str, Any]:
    """Compute logical CCZ subrank K_CCZ for a tricycle code.

    Parameters
    ----------
    group_shape : tuple of int
        Shape of the Abelian group G = Z_{d1} × … × Z_{dk}.
    H_X : np.ndarray, shape (n_G, 3*n_G), dtype uint8
        X-check matrix.
    H_Z : np.ndarray, shape (3*n_G, 3*n_G), dtype uint8
        Z-operator matrix.
    partition_a : (in_list, out_list) of exponent tuples for block a (I).
    partition_b : (in_list, out_list) for block b (II).
    partition_c : (in_list, out_list) for block c (III).
    use_exact : bool
        If True and max(k1,k2,k3) ≤ 15, use ILP for exact K_CCZ.

    Returns
    -------
    dict with keys:
        K_CCZ, K_CCZ_method, logical_tensor, k1, k2, k3,
        logical_x_block1, logical_x_block2, logical_x_block3,
        subrank_decomposition, ccz_gate_count
    """
    n_G = prod(group_shape)

    # ---- 1. Logical X quotient space V/W --------------------------------
    # V = ker(H_Z)
    V_basis = _gf2_nullspace(H_Z)                # (dim_V, 3*n_G)

    # W = im(H_X^T) — column space of H_X^T
    H_XT = H_X.T                                  # (3*n_G, n_G)
    W_basis = _gf2_col_space_basis(H_XT)          # (dim_W, 3*n_G)

    # Quotient basis V / W
    quot_basis = _gf2_quotient_basis(V_basis, W_basis)  # (K, 3*n_G)
    K = quot_basis.shape[0]

    # ---- 2. Extract per-block supports (exponent tuples) ----------------
    # Block I: columns 0 .. n_G-1
    # Block II: columns n_G .. 2*n_G-1
    # Block III: columns 2*n_G .. 3*n_G-1
    block1_start, block1_end = 0, n_G
    block2_start, block2_end = n_G, 2 * n_G
    block3_start, block3_end = 2 * n_G, 3 * n_G

    def _vec_support_exponents(vec: np.ndarray,
                               start: int, end: int) -> List[Tuple[int, ...]]:
        """Return exponent tuples for indices in [start, end) where vec==1."""
        indices = np.where(vec[start:end] == 1)[0]
        return [_flat_to_tuple(int(idx), group_shape) for idx in indices]

    def _vec_support_flat_set(vec: np.ndarray,
                              start: int, end: int) -> Set[int]:
        """Return flat indices (0..n_G-1) where vec==1 within [start, end)."""
        return {int(idx) for idx in np.where(vec[start:end] == 1)[0]}

    logical_x_block1: List[List[Tuple[int, ...]]] = []
    logical_x_block2: List[List[Tuple[int, ...]]] = []
    logical_x_block3: List[List[Tuple[int, ...]]] = []

    L1_flat: List[Set[int]] = []
    L2_flat: List[Set[int]] = []
    L3_flat: List[Set[int]] = []

    for r in range(K):
        vec = quot_basis[r]

        sup1 = _vec_support_exponents(vec, block1_start, block1_end)
        sup2 = _vec_support_exponents(vec, block2_start, block2_end)
        sup3 = _vec_support_exponents(vec, block3_start, block3_end)

        logical_x_block1.append(sup1)
        logical_x_block2.append(sup2)
        logical_x_block3.append(sup3)

        L1_flat.append(_vec_support_flat_set(vec, block1_start, block1_end))
        L2_flat.append(_vec_support_flat_set(vec, block2_start, block2_end))
        L3_flat.append(_vec_support_flat_set(vec, block3_start, block3_end))

    k1 = k2 = k3 = K

    # ---- 3. Build M_ab, M_ac, M_bc via GF(2) convolutions --------------
    a_in_list, a_out_list = partition_a
    b_in_list, b_out_list = partition_b
    c_in_list, c_out_list = partition_c

    a_in_bool = _subset_to_bool(a_in_list, group_shape)
    b_in_bool = _subset_to_bool(b_in_list, group_shape)
    a_out_bool = _subset_to_bool(a_out_list, group_shape)
    b_out_bool = _subset_to_bool(b_out_list, group_shape)
    c_in_bool = _subset_to_bool(c_in_list, group_shape)
    c_out_bool = _subset_to_bool(c_out_list, group_shape)

    # AMBIGUITY: The description names a_in ⋆ b_in, a_in ⋆ c_out,
    # b_out ⋆ c_out.  We follow these pairings exactly.  Note that the
    # "converse" pairings (a_out, b_out, c_in) are unused; they belong
    # to the dual STCP form.
    M_ab = _convolve_gf2(a_in_bool, b_in_bool, group_shape)
    M_ac = _convolve_gf2(a_in_bool, c_out_bool, group_shape)
    M_bc = _convolve_gf2(b_out_bool, c_out_bool, group_shape)

    # ---- 4. Compute logical CCZ tensor ----------------------------------
    logical_tensor, ccz_gate_count = _compute_f_ccz_tensor(
        L1_flat, L2_flat, L3_flat,
        M_ab, M_ac, M_bc,
        group_shape,
    )

    # ---- 5. Determine K_CCZ ---------------------------------------------
    if not np.any(logical_tensor):
        K_CCZ = 0
        K_CCZ_method = "trivial_zero"
        subrank_decomposition = []
    elif not _pairwise_disjoint_exists(logical_tensor):
        K_CCZ = 1
        K_CCZ_method = "pairwise_check"
        # In this case the decomposition has a single entry (any non-zero)
        idxs = np.where(logical_tensor != 0)
        subrank_decomposition = [(int(idxs[0][0]), int(idxs[1][0]), int(idxs[2][0]))]
    else:
        # Decide between greedy and ILP
        max_k = max(k1, k2, k3)
        if use_exact and max_k <= 15:
            K_CCZ, subrank_decomposition = _kccz_ilp(logical_tensor)
            K_CCZ_method = "exact_ilp"
        else:
            K_CCZ, subrank_decomposition = _kccz_greedy(logical_tensor)
            K_CCZ_method = "greedy"

    return {
        "K_CCZ": K_CCZ,
        "K_CCZ_method": K_CCZ_method,
        "logical_tensor": logical_tensor,
        "k1": k1,
        "k2": k2,
        "k3": k3,
        "logical_x_block1": logical_x_block1,
        "logical_x_block2": logical_x_block2,
        "logical_x_block3": logical_x_block3,
        "subrank_decomposition": subrank_decomposition,
        "ccz_gate_count": ccz_gate_count,
    }


def has_kccz_one(
    group_shape: Tuple[int, ...],
    H_X: np.ndarray,
    H_Z: np.ndarray,
    partition_a: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
    partition_b: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
    partition_c: Tuple[List[Tuple[int, ...]], List[Tuple[int, ...]]],
) -> bool:
    """Return True iff K_CCZ = 1.

    K_CCZ = 1 means the logical CCZ tensor has at least one non-zero
    entry and no two non-zero entries have pairwise-disjoint (i,j,k).
    """
    result = compute_ccz_subrank(
        group_shape, H_X, H_Z,
        partition_a, partition_b, partition_c,
        use_exact=False,
    )
    return result["K_CCZ"] == 1
