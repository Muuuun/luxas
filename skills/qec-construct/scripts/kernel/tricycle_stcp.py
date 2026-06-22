"""Tricycle STCP verification and f_CCZ computation.

Verifies the Symmetric Triple Cup-Product (STCP) conditions for a tricycle code
and computes the f_CCZ trilinear function from Menon2025.
"""

from __future__ import annotations

import numpy as np
from math import prod


# ---------------------------------------------------------------------------
#  Group element encoding helpers
# ---------------------------------------------------------------------------

def _group_to_index(exponents, group_shape):
    """Convert a tuple of exponents to a flat integer index (mixed-radix)."""
    idx = 0
    for e, d in zip(exponents, group_shape):
        idx = idx * d + e
    return idx


def _index_to_group(idx, group_shape):
    """Convert a flat integer index back to a tuple of exponents."""
    exps = []
    for d in reversed(group_shape):
        exps.append(idx % d)
        idx //= d
    return tuple(reversed(exps))


def _build_add_table(group_shape):
    """Precompute n_G × n_G addition table (componentwise mod d_i)."""
    n_G = prod(group_shape)
    tuples = [_index_to_group(i, group_shape) for i in range(n_G)]
    add = np.zeros((n_G, n_G), dtype=np.int64)
    for i in range(n_G):
        ti = tuples[i]
        for j in range(n_G):
            tj = tuples[j]
            s = tuple((a + b) % d for a, b, d in zip(ti, tj, group_shape))
            add[i, j] = _group_to_index(s, group_shape)
    return add


def _encode_support(support, group_shape):
    """Convert list of exponent tuples to list of flat indices (deduplicated)."""
    seen = set()
    encoded = []
    for s in support:
        idx = _group_to_index(tuple(s), group_shape)
        if idx not in seen:
            seen.add(idx)
            encoded.append(idx)
    return encoded


def _shift_set(idx_set, shift_idx, add_table):
    """Return {g + shift_idx : g ∈ idx_set} as a set of flat indices."""
    return {int(add_table[g, shift_idx]) for g in idx_set}


# ---------------------------------------------------------------------------
#  Pre-orientation verification
# ---------------------------------------------------------------------------

def _verify_partition(support, a_in, a_out, name, group_shape):
    """Verify a_in ∪ a_out = support and a_in ∩ a_out = ∅.

    Returns (warnings, disjoint_ok, cover_ok).
    """
    support_set = set(_encode_support(support, group_shape))
    in_set = set(_encode_support(a_in, group_shape))
    out_set = set(_encode_support(a_out, group_shape))

    warnings = []
    disjoint = in_set.isdisjoint(out_set)
    if not disjoint:
        warnings.append(
            f"{name}_in and {name}_out are not disjoint; "
            f"overlap size = {len(in_set & out_set)}"
        )

    union = in_set | out_set
    covers = union == support_set
    if not covers:
        missing = support_set - union
        extra = union - support_set
        if missing:
            warnings.append(
                f"{name}_in ∪ {name}_out missing {len(missing)} elements "
                f"from support of {name}"
            )
        if extra:
            warnings.append(
                f"{name}_in ∪ {name}_out has {len(extra)} elements "
                f"not in support of {name}"
            )

    return warnings, disjoint, covers


# ---------------------------------------------------------------------------
#  STCP condition verification
# ---------------------------------------------------------------------------

def _check_stcp_conditions(in_set, out_set, n_G, add_table):
    """Check STCP conditions 1-3 for a single group algebra element.

    Conditions (empty free partition, Menon2025):
      1. |in| + |out| is even
      2. ∀ w ≠ id:  |in ∩ (in + w)| + |out ∩ (out + w)|  is even
      3. ∀ distinct v,w ≠ id:  |in ∩ (in+v) ∩ (in+w)| + |out ∩ (out+v) ∩ (out+w)|  is even

    Returns dict with bool for each condition.
    """
    in_s = set(in_set)
    out_s = set(out_set)

    # Condition 1: parity
    cond1 = ((len(in_s) + len(out_s)) % 2 == 0)

    # Condition 2
    cond2 = True
    for w in range(1, n_G):  # non-identity elements
        in_shifted = _shift_set(in_s, w, add_table)
        out_shifted = _shift_set(out_s, w, add_table)
        count_in = len(in_s & in_shifted)
        count_out = len(out_s & out_shifted)
        if (count_in + count_out) % 2 != 0:
            cond2 = False
            break

    # Condition 3
    cond3 = True
    if cond2:  # only check if cond2 passed (optimisation)
        for v in range(1, n_G):
            in_shifted_v = _shift_set(in_s, v, add_table)
            out_shifted_v = _shift_set(out_s, v, add_table)
            for w in range(v + 1, n_G):  # distinct, both non-identity
                in_shifted_w = _shift_set(in_s, w, add_table)
                out_shifted_w = _shift_set(out_s, w, add_table)

                count_in = len(in_s & in_shifted_v & in_shifted_w)
                count_out = len(out_s & out_shifted_v & out_shifted_w)
                if (count_in + count_out) % 2 != 0:
                    cond3 = False
                    break
            if not cond3:
                break

    return {"cond1": cond1, "cond2": cond2, "cond3": cond3}


# ---------------------------------------------------------------------------
#  f_CCZ computation helpers
# ---------------------------------------------------------------------------

def _convolve_odd_set(set1, set2, add_table):
    """Compute M = {g : |set1 ∩ (g - set2)| is odd}.

    Equivalently: count pairs (x∈set1, y∈set2) with x+y=g; return {g : count odd}.
    """
    n_G = add_table.shape[0]
    counts = np.zeros(n_G, dtype=np.int32)
    set1_list = list(set1)
    set2_list = list(set2)
    for x in set1_list:
        for y in set2_list:
            g = int(add_table[x, y])
            counts[g] += 1
    return {int(g) for g in range(n_G) if counts[g] % 2 == 1}


def _compute_fccz_stats(a_in, b_in, b_out, c_out, n_G, add_table):
    """Compute f_CCZ degree statistics and gate count.

    f_CCZ(p from block I, q from block II, r from block III)
      = |(M_ab + r) ∩ (M_ac + q) ∩ (M_bc + p)| mod 2
    where:
      M_ab = {g : |a_in ∩ (g - b_in)| odd}   [convolution a_in * b_in]
      M_ac = {g : |a_in ∩ (g - c_out)| odd}  [convolution a_in * c_out]
      M_bc = {g : |b_out ∩ (g - c_out)| odd} [convolution b_out * c_out]

    Returns:
        deg_I, deg_II, deg_III: arrays of length n_G with per-qubit CCZ degree
        gate_count: total number of CCZ gates
    """
    # Precompute M_ab, M_ac, M_bc
    M_ab = _convolve_odd_set(set(a_in), set(b_in), add_table)
    M_ac = _convolve_odd_set(set(a_in), set(c_out), add_table)
    M_bc = _convolve_odd_set(set(b_out), set(c_out), add_table)

    M_ab_list = list(M_ab)
    M_ac_list = list(M_ac)
    M_bc_list = list(M_bc)

    deg_I = np.zeros(n_G, dtype=np.int32)
    deg_II = np.zeros(n_G, dtype=np.int32)
    deg_III = np.zeros(n_G, dtype=np.int32)
    gate_count = 0

    # Precompute M_bc + p for all p (block III)
    M_bc_shifted = {}
    for p in range(n_G):
        M_bc_shifted[p] = {int(add_table[g, p]) for g in M_bc_list}

    # Precompute M_ac + q for all q (block II)
    M_ac_shifted = {}
    for q in range(n_G):
        M_ac_shifted[q] = {int(add_table[g, q]) for g in M_ac_list}

    for r in range(n_G):
        M_ab_r = {int(add_table[g, r]) for g in M_ab_list}
        for q in range(n_G):
            inter_rq = M_ab_r & M_ac_shifted[q]
            if not inter_rq:
                continue
            for p in range(n_G):
                if len(inter_rq & M_bc_shifted[p]) % 2 == 1:
                    deg_I[r] += 1
                    deg_II[q] += 1
                    deg_III[p] += 1
                    gate_count += 1

    return deg_I, deg_II, deg_III, gate_count


def _compute_logical_fccz(logical_ops_1, logical_ops_2, logical_ops_3,
                          a_in, b_in, b_out, c_out, group_shape, add_table):
    """Compute logical CCZ tensor T_{ijk} = f_CCZ(L1_i, L2_j, L3_k).

    Each logical operator is a list of exponent tuples (its support in G).
    f_CCZ for logical operators is the sum over constituent physical-qubit
    triples, mod 2.

    logical_ops_1 → block I (paired with a), logical_ops_2 → block II (b),
    logical_ops_3 → block III (c).
    """
    n_G = add_table.shape[0]
    M_ab = _convolve_odd_set(set(a_in), set(b_in), add_table)
    M_ac = _convolve_odd_set(set(a_in), set(c_out), add_table)
    M_bc = _convolve_odd_set(set(b_out), set(c_out), add_table)

    M_ab_list = list(M_ab)
    M_ac_list = list(M_ac)
    M_bc_list = list(M_bc)

    K1 = len(logical_ops_1)
    K2 = len(logical_ops_2)
    K3 = len(logical_ops_3)

    tensor = np.zeros((K1, K2, K3), dtype=np.uint8)

    for i, L1 in enumerate(logical_ops_1):
        L1_enc = set(_encode_support(L1, group_shape))
        for j, L2 in enumerate(logical_ops_2):
            L2_enc = set(_encode_support(L2, group_shape))
            for k, L3 in enumerate(logical_ops_3):
                L3_enc = set(_encode_support(L3, group_shape))
                total = 0
                for r in L1_enc:
                    M_ab_r = {int(add_table[g, r]) for g in M_ab_list}
                    for q in L2_enc:
                        M_ac_q = {int(add_table[g, q]) for g in M_ac_list}
                        inter_rq = M_ab_r & M_ac_q
                        if not inter_rq:
                            continue
                        for p in L3_enc:
                            M_bc_p = {int(add_table[g, p]) for g in M_bc_list}
                            if len(inter_rq & M_bc_p) % 2 == 1:
                                total ^= 1
                tensor[i, j, k] = total

    return tensor


# ---------------------------------------------------------------------------
#  Main entry point
# ---------------------------------------------------------------------------

def verify_stcp(
    group_shape: tuple,
    support_a: list,
    support_b: list,
    support_c: list,
    partition_a: tuple,
    partition_b: tuple,
    partition_c: tuple,
    logical_x_reps: dict | None = None,
) -> dict:
    """Verify STCP conditions and compute f_CCZ for a tricycle code.

    Parameters
    ----------
    group_shape : tuple of ints
        Orders of cyclic factors, e.g. (2, 2, 4) for Z_2 × Z_2 × Z_4.
    support_a, support_b, support_c : list of tuple of ints
        Group algebra elements as exponent-tuple lists.
    partition_a, partition_b, partition_c : tuple of (list, list)
        Each is (in_part, out_part) for the corresponding element.
    logical_x_reps : dict or None
        Optional.  Keys "block1", "block2", "block3"; each value is a list of
        logical X operator supports (each support is a list of exponent tuples).

    Returns
    -------
    dict with keys:
        stcp_verified, conditions, ccz_degree_max, ccz_gate_count,
        ccz_nontrivial, logical_tensor
    """
    n_G = prod(group_shape)
    add_table = _build_add_table(group_shape)

    # -- 0. Validate and encode partitions ---------------------------------
    # AMBIGUITY: the description says to handle non-empty free partitions
    # correctly, but only specifies the STCP conditions for empty free
    # partitions (Menon2025 weight-4 codes). The conditions for non-empty
    # free partitions are not given; we implement only the empty-free case.
    all_warnings = []

    def _encode(lst):
        return _encode_support(lst, group_shape)

    # Verify partitions
    for name, support, (a_in, a_out) in [
        ("a", support_a, partition_a),
        ("b", support_b, partition_b),
        ("c", support_c, partition_c),
    ]:
        warns, disj, cov = _verify_partition(support, a_in, a_out, name, group_shape)
        all_warnings.extend(warns)
        if not disj and not cov:
            raise ValueError(
                f"{name}_in and {name}_out must be disjoint and cover the support "
                f"of {name}; got overlap={not disj}, cover={cov}"
            )
        elif not disj:
            raise ValueError(
                f"{name}_in and {name}_out must be disjoint; overlap found"
            )
        elif not cov:
            raise ValueError(
                f"{name}_in ∪ {name}_out must equal support of {name}"
            )

    a_in = _encode(partition_a[0])
    a_out = _encode(partition_a[1])
    b_in = _encode(partition_b[0])
    b_out = _encode(partition_b[1])
    c_in = _encode(partition_c[0])
    c_out = _encode(partition_c[1])

    # -- 1. STCP conditions -------------------------------------------------
    cond_a = _check_stcp_conditions(a_in, a_out, n_G, add_table)
    cond_b = _check_stcp_conditions(b_in, b_out, n_G, add_table)
    cond_c = _check_stcp_conditions(c_in, c_out, n_G, add_table)

    stcp_verified = all([
        cond_a["cond1"], cond_a["cond2"], cond_a["cond3"],
        cond_b["cond1"], cond_b["cond2"], cond_b["cond3"],
        cond_c["cond1"], cond_c["cond2"], cond_c["cond3"],
    ])

    conditions = {"a": cond_a, "b": cond_b, "c": cond_c}

    # -- 2. f_CCZ computation ------------------------------------------------
    # AMBIGUITY: the description says "store sparsely or summarized" for
    # n_G ≤ 100 and "compute only degree statistics" for n_G > 100.
    # We compute degree stats and gate count in both regimes via the same
    # algorithm; for n_G ≤ 100 the full tensor could be stored but the
    # output schema only requires aggregate statistics.
    deg_I, deg_II, deg_III, gate_count = _compute_fccz_stats(
        a_in, b_in, b_out, c_out, n_G, add_table
    )

    ccz_degree_max = int(max(
        deg_I.max(), deg_II.max(), deg_III.max()
    ))
    ccz_gate_count = int(gate_count)

    # -- 3. Logical CCZ ------------------------------------------------------
    ccz_nontrivial = None
    logical_tensor = None

    if logical_x_reps is not None:
        L1 = logical_x_reps.get("block1", [])
        L2 = logical_x_reps.get("block2", [])
        L3 = logical_x_reps.get("block3", [])

        if L1 and L2 and L3:
            logical_tensor = _compute_logical_fccz(
                L1, L2, L3,
                a_in, b_in, b_out, c_out, group_shape, add_table
            )
            ccz_nontrivial = bool(np.any(logical_tensor))
        else:
            # At least one block has no logical operators → trivial
            K = max(len(L1), len(L2), len(L3))
            logical_tensor = np.zeros((K, K, K), dtype=np.uint8)
            ccz_nontrivial = False

    return {
        "stcp_verified": stcp_verified,
        "conditions": conditions,
        "ccz_degree_max": ccz_degree_max,
        "ccz_gate_count": ccz_gate_count,
        "ccz_nontrivial": ccz_nontrivial,
        "logical_tensor": logical_tensor,
    }
