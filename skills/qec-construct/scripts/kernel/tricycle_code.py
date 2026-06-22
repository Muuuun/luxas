"""Tricycle code construction: parity check matrices from F_2[G] group algebra elements.

Given a finite Abelian group G = Z_{d1} × ... × Z_{dk} and three group algebra
elements a, b, c, constructs H_X and H_Z, verifies the CSS condition, and
computes the number of logical qubits k.
"""

import numpy as np
from math import prod


def _group_to_index(exponents, group_shape):
    """Convert a tuple of exponents to a flat integer index via mixed-radix.

    Example: group_shape=(2,2,4), exponents=(1,0,3) → 1*8 + 0*4 + 3 = 11.
    """
    idx = 0
    for e, d in zip(exponents, group_shape):
        idx = idx * d + e
    return idx


def _index_to_group(idx, group_shape):
    """Convert a flat integer index back to a tuple of exponents.

    Example: group_shape=(2,2,4), idx=11 → (1,0,3).
    """
    exps = []
    for d in reversed(group_shape):
        exps.append(idx % d)
        idx //= d
    return tuple(reversed(exps))


def _build_matrix(support, group_shape):
    """Build the n_G × n_G binary matrix for a group algebra element.

    For a = Σ g_i, the matrix A has A[α, β] = 1 iff α·β^{-1} is in the support
    of a.  In the Abelian group (additive notation): A[idx(β+g), idx(β)] = 1
    for each g in the support and every β ∈ G.

    Duplicate support elements are deduplicated via mod-2 cancellation.
    """
    n_G = prod(group_shape)

    # Deduplicate: track elements that appear an odd number of times (F_2).
    odd = set()
    for g in support:
        g_tuple = tuple(g)
        if g_tuple in odd:
            odd.remove(g_tuple)
        else:
            odd.add(g_tuple)

    if not odd:
        raise ValueError(
            "Support is empty after deduplication "
            "(all elements cancelled mod 2)"
        )

    A = np.zeros((n_G, n_G), dtype=np.uint8)

    # Precompute all β → tuple mappings once.
    beta_tuples = [_index_to_group(i, group_shape) for i in range(n_G)]

    for g_tuple in odd:
        # For each β, α = β + g  (componentwise mod each d_i).
        shift = np.zeros(n_G, dtype=np.int64)
        for i, beta in enumerate(beta_tuples):
            alpha = tuple((b + g) % d for b, g, d in zip(beta, g_tuple, group_shape))
            shift[i] = _group_to_index(alpha, group_shape)
        A[shift, np.arange(n_G)] ^= 1

    return A


def _gf2_rank(matrix):
    """Compute the GF(2) rank of a binary matrix via Gaussian elimination.

    Uses uint8 rows and XOR for row operations.  Produces reduced row-echelon
    form in-place on a copy.
    """
    m, n = matrix.shape
    A = matrix.copy()
    rank = 0
    col = 0

    while col < n and rank < m:
        # Find a pivot row.
        pivot = None
        for r in range(rank, m):
            if A[r, col]:
                pivot = r
                break

        if pivot is None:
            col += 1
            continue

        # Swap pivot row into position.
        if pivot != rank:
            A[[rank, pivot]] = A[[pivot, rank]]

        # Eliminate this column from all *other* rows.
        for r in range(m):
            if r != rank and A[r, col]:
                A[r] ^= A[rank]

        rank += 1
        col += 1

    return rank


def construct_tricycle(
    group_shape: tuple,
    support_a: list,
    support_b: list,
    support_c: list,
) -> dict:
    """Construct tricycle code parity check matrices and compute logical qubits.

    Parameters
    ----------
    group_shape : tuple of ints
        Orders of the cyclic factors, e.g. (2, 2, 4) for Z_2 × Z_2 × Z_4.
    support_a, support_b, support_c : list of tuple of ints
        Group algebra elements as lists of exponent tuples in their support.

    Returns
    -------
    dict with keys:
        H_X, H_Z : binary parity check matrices (uint8)
        n, n_G, k, rank_X, rank_Z, css_verified
    """
    # -- Validate inputs --------------------------------------------------
    if not support_a or not support_b or not support_c:
        raise ValueError("Empty support list")

    k_dim = len(group_shape)
    for name, supp in [("support_a", support_a),
                       ("support_b", support_b),
                       ("support_c", support_c)]:
        for s in supp:
            if len(s) != k_dim:
                raise ValueError(
                    f"Element {s} in {name} has {len(s)} components, "
                    f"but group_shape {group_shape} has {k_dim} dimensions"
                )
            for e, d in zip(s, group_shape):
                if not (0 <= e < d):
                    raise ValueError(
                        f"Exponent {e} out of range [0, {d}) "
                        f"in element {s} of {name}"
                    )

    # -- Build the three group-algebra matrices ---------------------------
    A = _build_matrix(support_a, group_shape)
    B = _build_matrix(support_b, group_shape)
    C = _build_matrix(support_c, group_shape)

    n_G = prod(group_shape)
    n = 3 * n_G
    Z = np.zeros((n_G, n_G), dtype=np.uint8)

    # H_X = [A^T  B^T  C^T]   shape (n_G, 3 n_G)
    H_X = np.hstack([A.T, B.T, C.T]).astype(np.uint8)

    # H_Z = [[C, 0, A],
    #        [0, C, B],
    #        [B, A, 0]]       shape (3 n_G, 3 n_G)
    H_Z = np.vstack([
        np.hstack([C, Z, A]),
        np.hstack([Z, C, B]),
        np.hstack([B, A, Z]),
    ]).astype(np.uint8)

    # -- CSS condition ----------------------------------------------------
    css_check = (H_X @ H_Z.T) % 2
    css_verified = not np.any(css_check)

    # -- Ranks and logical qubit count ------------------------------------
    rank_X = _gf2_rank(H_X)
    rank_Z = _gf2_rank(H_Z)
    k_val = n - rank_X - rank_Z

    return {
        "H_X": H_X,
        "H_Z": H_Z,
        "n": n,
        "n_G": n_G,
        "k": k_val,
        "rank_X": rank_X,
        "rank_Z": rank_Z,
        "css_verified": css_verified,
    }
