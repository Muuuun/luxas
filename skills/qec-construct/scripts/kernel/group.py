"""General finite-group substrate for 3-block group-algebra (tricycle) codes —
abelian AND non-abelian. The construction is GENERAL; validity (CSS, gate) is
CHECKED by the sound verifiers, never assumed. Non-abelian is the explicitly
under-explored region (Tiew2026: the abelian d<=2 obstruction need not apply).

A group is an explicit multiplication table over elements 0..|G|-1 (identity=0),
plus an inverse table. Build it from permutation generators (covers S_n,
dihedral, semidirect products, ...) or as an abelian product (for cross-check).
"""
from __future__ import annotations
import numpy as np
from math import prod
from itertools import product


class Group:
    def __init__(self, mult: np.ndarray, inv: np.ndarray, labels=None, abelian=None):
        self.mult = mult                       # mult[i,j] = index of g_i * g_j
        self.inv = inv                         # inv[i] = index of g_i^{-1}
        self.n = mult.shape[0]
        self.labels = labels
        self.abelian = abelian if abelian is not None else bool(
            np.array_equal(mult, mult.T))

    # -- constructors ----------------------------------------------------------
    @staticmethod
    def from_abelian(group_shape):
        """Z_{d1} x ... x Z_{dk}, flat index = mixed-radix (matches tricycle_code)."""
        shape = tuple(group_shape)
        nG = prod(shape)

        def to_idx(t):
            i = 0
            for e, d in zip(t, shape):
                i = i * d + e
            return i

        def to_tup(i):
            e = []
            for d in reversed(shape):
                e.append(i % d); i //= d
            return tuple(reversed(e))

        mult = np.zeros((nG, nG), dtype=np.int64)
        inv = np.zeros(nG, dtype=np.int64)
        for i in range(nG):
            ti = to_tup(i)
            inv[i] = to_idx(tuple((-a) % d for a, d in zip(ti, shape)))
            for j in range(nG):
                tj = to_tup(j)
                mult[i, j] = to_idx(tuple((a + b) % d for a, b, d in zip(ti, tj, shape)))
        return Group(mult, inv, labels=[to_tup(i) for i in range(nG)], abelian=True)

    @staticmethod
    def from_permutations(generators):
        """Close a set of permutation generators (tuples) into a group.

        generators: list of permutations as tuples perm where perm[i] is the
        image of i. Identity is computed; elements are distinct permutations.
        """
        deg = len(generators[0])
        ident = tuple(range(deg))

        def comp(p, q):                        # (p*q)[i] = p[q[i]]
            return tuple(p[q[i]] for i in range(deg))

        elems = [ident]
        index = {ident: 0}
        frontier = [ident]
        gens = [tuple(g) for g in generators]
        while frontier:
            nxt = []
            for e in frontier:
                for g in gens:
                    h = comp(g, e)
                    if h not in index:
                        index[h] = len(elems)
                        elems.append(h); nxt.append(h)
            frontier = nxt
        nG = len(elems)
        mult = np.zeros((nG, nG), dtype=np.int64)
        inv = np.zeros(nG, dtype=np.int64)
        for i, ei in enumerate(elems):
            # inverse: the perm that composes with ei to identity
            invp = tuple(np.argsort(ei))
            inv[i] = index[invp]
            for j, ej in enumerate(elems):
                mult[i, j] = index[comp(ei, ej)]
        return Group(mult, inv, labels=elems)

    @staticmethod
    def dihedral(n):
        """D_n of order 2n via two permutation generators (rotation r, flip s)."""
        r = tuple((i + 1) % n for i in range(n))
        s = tuple((-i) % n for i in range(n))
        return Group.from_permutations([r, s])

    # -- group algebra ---------------------------------------------------------
    def regular_rep(self, support):
        """Left regular representation B_G(a) for a = sum_{g in support} g.

        B[mult[g, j], j] = 1 for each g in support, each j  (mod 2 dedup).
        support: iterable of element indices.
        """
        nG = self.n
        A = np.zeros((nG, nG), dtype=np.uint8)
        for g in support:
            A[self.mult[g, np.arange(nG)], np.arange(nG)] ^= 1
        return A


def construct_tricycle_general(group: Group, supp_a, supp_b, supp_c):
    """Tricycle code over an arbitrary group. Supports are lists of element idx.

    H_X = [A^T B^T C^T];  H_Z = [[C 0 A],[0 C B],[B A 0]]  (same block form as the
    abelian construction). CSS validity is COMPUTED, not assumed — for non-commuting
    elements it may fail; that is a real signal the verifier surfaces.
    """
    from tricycle_code import _gf2_rank
    A = group.regular_rep(supp_a)
    B = group.regular_rep(supp_b)
    C = group.regular_rep(supp_c)
    nG = group.n; n = 3 * nG
    Z = np.zeros((nG, nG), dtype=np.uint8)
    H_X = np.hstack([A.T, B.T, C.T]).astype(np.uint8)
    H_Z = np.vstack([
        np.hstack([C, Z, A]),
        np.hstack([Z, C, B]),
        np.hstack([B, A, Z]),
    ]).astype(np.uint8)
    css_verified = not np.any((H_X @ H_Z.T) % 2)
    rank_X = _gf2_rank(H_X); rank_Z = _gf2_rank(H_Z)
    return {"H_X": H_X, "H_Z": H_Z, "n": n, "n_G": nG,
            "k": n - rank_X - rank_Z, "rank_X": rank_X, "rank_Z": rank_Z,
            "css_verified": css_verified, "abelian": group.abelian}
