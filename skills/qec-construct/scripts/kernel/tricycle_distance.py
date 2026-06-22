"""
tricycle_distance: Compute Z-distance d_Z of a tricycle code via ILP.

Finds the minimum-weight nontrivial logical Z operator by solving
integer linear programs: one per logical representative direction.
"""

import numpy as np
from typing import Optional, Tuple, List, Dict, Any


# ============================================================
# GF(2) Linear Algebra Utilities
# ============================================================

def _gf2_rref(A: np.ndarray) -> Tuple[np.ndarray, int, List[int]]:
    """Row-reduce binary matrix A to reduced row-echelon form over GF(2).

    Returns:
        (RREF_matrix, rank, pivot_columns)
    """
    m, n = A.shape
    M = A.copy().astype(np.uint8) & 1
    row = 0
    pivot_cols: List[int] = []

    for col in range(n):
        # Find pivot in this column
        pivot = None
        for r in range(row, m):
            if M[r, col]:
                pivot = r
                break
        if pivot is None:
            continue
        # Swap pivot row to current row
        M[[row, pivot]] = M[[pivot, row]]
        # Eliminate this column in all other rows
        for r in range(m):
            if r != row and M[r, col]:
                M[r] ^= M[row]
        pivot_cols.append(col)
        row += 1

    return M, row, pivot_cols


def _gf2_nullspace(A: np.ndarray) -> np.ndarray:
    """Compute a basis for the nullspace of A over GF(2).

    Returns:
        Basis matrix of shape (nullity, n). Empty (0,n) if nullity=0.
    """
    m, n = A.shape
    if m == 0:
        # No constraints: nullspace is the whole space
        return np.eye(n, dtype=np.uint8)

    M, rank, pivot_cols = _gf2_rref(A)
    nullity = n - rank

    if nullity == 0:
        return np.zeros((0, n), dtype=np.uint8)

    free_cols = [c for c in range(n) if c not in pivot_cols]
    basis = []

    for fc in free_cols:
        v = np.zeros(n, dtype=np.uint8)
        v[fc] = 1
        for r in range(rank):
            pc = pivot_cols[r]
            if M[r, fc]:
                v[pc] = 1
        basis.append(v)

    return np.array(basis, dtype=np.uint8)


def _gf2_row_space_basis(A: np.ndarray) -> np.ndarray:
    """Compute a basis for the row space of A over GF(2).

    Returns:
        Basis matrix of shape (rank, n). Empty (0,n) if rank=0.
    """
    if A.shape[0] == 0:
        return np.zeros((0, A.shape[1]), dtype=np.uint8)

    M, rank, _ = _gf2_rref(A)
    return M[:rank].copy()


def _gf2_is_in_span(v: np.ndarray, basis: np.ndarray) -> bool:
    """Check if vector v is in the row-span of `basis` over GF(2)."""
    if basis.shape[0] == 0:
        return not np.any(v)

    # Check rank([basis; v]) == rank(basis)
    aug = np.vstack([basis, v.reshape(1, -1)])
    _, rank_aug, _ = _gf2_rref(aug)
    _, rank_basis, _ = _gf2_rref(basis)
    return rank_aug == rank_basis


# ============================================================
# ILP Solvers
# ============================================================

def _solve_ilp_gurobipy(
    H_X: np.ndarray, logical_vec: np.ndarray, timeout: int,
    debug: bool = False,
) -> Tuple[Optional[int], Optional[np.ndarray], str]:
    """Solve the ILP using gurobipy directly."""
    import gurobipy as gp

    n = H_X.shape[1]

    model = gp.Model("tricycle_Z_distance")
    model.setParam("OutputFlag", 1 if debug else 0)
    model.setParam("TimeLimit", timeout)

    # Binary variables
    e_vars = model.addMVar(n, vtype=gp.GRB.BINARY, name="e")

    # Objective: minimise sum e_j
    model.setObjective(e_vars.sum(), gp.GRB.MINIMIZE)

    # H_X @ e = 0 (mod 2)  →  sum_{j in row} e_j = 2·t_i
    for i in range(H_X.shape[0]):
        indices = np.where(H_X[i] == 1)[0]
        if len(indices) == 0:
            continue
        t_i = model.addVar(lb=0, vtype=gp.GRB.INTEGER, name=f"t_{i}")
        model.addConstr(
            gp.quicksum(e_vars[j] for j in indices) == 2 * t_i
        )

    # logical_vec @ e = 1 (mod 2)  →  sum_{j in support} e_j = 2·s + 1
    log_indices = np.where(logical_vec == 1)[0]
    if len(log_indices) == 0:
        model.dispose()
        return None, None, "infeasible"
    s = model.addVar(lb=0, vtype=gp.GRB.INTEGER, name="s_logical")
    model.addConstr(
        gp.quicksum(e_vars[j] for j in log_indices) == 2 * s + 1
    )

    model.optimize()

    if debug:
        print(f"[DEBUG] Gurobi status: {model.Status}")

    # Extract if a solution exists
    if model.Status in (gp.GRB.OPTIMAL, gp.GRB.TIME_LIMIT) and model.SolCount > 0:
        e_raw = np.array([v.X for v in e_vars.tolist()], dtype=float)
        e_vals = np.round(e_raw).astype(np.uint8)

        # Consistency checks
        frac_err = float(np.max(np.abs(e_raw - e_vals.astype(float))))
        if frac_err > 1e-4:
            if debug:
                print(f"[DEBUG] Gurobi fractional solution rejected: err={frac_err:.4f}")
            model.dispose()
            return None, None, "inconsistent"

        obj_val = int(np.sum(e_vals))
        if np.any((H_X @ e_vals) % 2 != 0):
            if debug:
                print("[DEBUG] Gurobi solution violates H_X constraints")
            model.dispose()
            return None, None, "inconsistent"
        if (logical_vec @ e_vals) % 2 != 1:
            if debug:
                print("[DEBUG] Gurobi solution violates logical constraint")
            model.dispose()
            return None, None, "inconsistent"

        if debug:
            print(f"[DEBUG] Gurobi solution: obj={obj_val}")

        st = "optimal" if model.Status == gp.GRB.OPTIMAL else "timed_out"
        model.dispose()
        return obj_val, e_vals, st

    if model.Status == gp.GRB.INFEASIBLE:
        model.dispose()
        return None, None, "infeasible"
    if model.Status == gp.GRB.TIME_LIMIT:
        model.dispose()
        return None, None, "timed_out"

    model.dispose()
    return None, None, "unknown"


def _solve_ilp_pulp(
    H_X: np.ndarray,
    logical_vec: np.ndarray,
    timeout: int,
    solver_name: str,
    debug: bool = False,
) -> Tuple[Optional[int], Optional[np.ndarray], str]:
    """Solve the ILP using PuLP with the named solver backend."""
    import pulp

    n = H_X.shape[1]

    prob = pulp.LpProblem("tricycle_Z_distance", pulp.LpMinimize)

    # Binary variables
    e_vars = [pulp.LpVariable(f"e_{j}", cat=pulp.LpBinary) for j in range(n)]

    # Objective: minimise sum e_j
    prob += pulp.lpSum(e_vars)

    # H_X @ e = 0 (mod 2) for each row
    for i in range(H_X.shape[0]):
        indices = np.where(H_X[i] == 1)[0]
        if len(indices) == 0:
            continue
        t_i = pulp.LpVariable(f"t_{i}", lowBound=0, cat=pulp.LpInteger)
        prob += pulp.lpSum([e_vars[j] for j in indices]) == 2 * t_i

    # logical_vec @ e = 1 (mod 2)
    log_indices = np.where(logical_vec == 1)[0]
    if len(log_indices) == 0:
        return None, None, "infeasible"
    s = pulp.LpVariable("s_logical", lowBound=0, cat=pulp.LpInteger)
    prob += pulp.lpSum([e_vars[j] for j in log_indices]) == 2 * s + 1

    # Choose solver
    if solver_name == "highs":
        solver = pulp.HiGHS(msg=debug, timeLimit=timeout)
    elif solver_name == "cbc":
        solver = pulp.PULP_CBC_CMD(msg=debug, timeLimit=timeout)
    else:
        raise ValueError(f"Unknown solver: {solver_name}")

    prob.solve(solver)

    status_str = pulp.LpStatus[prob.status]

    if debug:
        print(f"[DEBUG] PuLP solve status: {status_str} (code {prob.status})")

    # Handle definite failure states first — do NOT try to extract values.
    if prob.status == pulp.LpStatusInfeasible:
        return None, None, "infeasible"
    elif prob.status == pulp.LpStatusUnbounded:
        return None, None, "unbounded"
    elif prob.status == pulp.LpStatusNotSolved:
        return None, None, "timed_out"

    # ----- extract variable values as floats first --------------------------
    try:
        e_raw = np.array([pulp.value(v) for v in e_vars], dtype=float)
    except (TypeError, ValueError):
        if debug:
            print("[DEBUG] Failed to extract variable values from PuLP")
        return None, None, status_str.lower()

    # Guard against NaN / None
    if e_raw is None or np.any(np.isnan(e_raw)):
        if debug:
            print("[DEBUG] Variable values contain NaN")
        return None, None, status_str.lower()

    # Round to nearest integer (should be exact 0/1 for a valid MIP solution).
    e_vals = np.round(e_raw).astype(np.uint8)

    # Detect fractional solutions (HiGHS may return LP-relaxation values
    # when the MIP gap is non-zero or when it times out before finding
    # an integer-feasible solution).
    frac_err = float(np.max(np.abs(e_raw - e_vals.astype(float))))
    if frac_err > 1e-4:
        if debug:
            print(
                f"[DEBUG] Fractional solution rejected: "
                f"max |x - round(x)| = {frac_err:.4f}"
            )
            print(f"[DEBUG] Raw values (first 20): {e_raw[:20].tolist()}")
        return None, None, "inconsistent"

    # ----- consistency checks -----------------------------------------------
    # Recompute objective from the extracted variable values (never trust
    # pulp.value(prob.objective) — it can be stale or from a different
    # solver iteration).
    obj_val = int(np.sum(e_vals))

    # 1. parity constraints: H_X @ e == 0 (mod 2)
    parity_violations = (H_X @ e_vals) % 2
    if np.any(parity_violations != 0):
        if debug:
            bad_rows = np.where(parity_violations != 0)[0]
            print(f"[DEBUG] H_X parity violated on rows: {bad_rows.tolist()}")
        return None, None, "inconsistent"

    # 2. logical constraint: logical_vec @ e == 1 (mod 2)
    if (logical_vec @ e_vals) % 2 != 1:
        if debug:
            print(
                "[DEBUG] Logical constraint violated: "
                f"overlap = {(logical_vec @ e_vals) % 2}"
            )
        return None, None, "inconsistent"

    # 3. objective sanity (informational only — we already use sum(e_vals))
    pulp_obj = pulp.value(prob.objective)
    if pulp_obj is not None and abs(float(pulp_obj) - obj_val) > 0.5:
        if debug:
            print(
                f"[DEBUG] Objective mismatch: "
                f"pulp.value(obj)={pulp_obj}, sum(e)={obj_val}"
            )

    if debug:
        print(f"[DEBUG] Solution accepted: obj={obj_val}, status={status_str}")
        print(f"[DEBUG] e_vals (first 20): {e_vals[:20].tolist()}")

    st = "optimal" if prob.status == pulp.LpStatusOptimal else "feasible"
    return obj_val, e_vals, st


# ============================================================
# Fallback: brute-force and greedy heuristic
# ============================================================

def _brute_force(
    H_X: np.ndarray,
    logical_vecs: np.ndarray,
    row_space_basis: np.ndarray,
) -> Tuple[Optional[int], Optional[np.ndarray]]:
    """Brute-force search for min-weight logical operator (n <= 20)."""
    n = H_X.shape[1]
    best_weight: Optional[int] = None
    best_e: Optional[np.ndarray] = None

    for k in range(1, 1 << n):
        e = np.array([int(b) for b in format(k, f"0{n}b")], dtype=np.uint8)

        # Check e in ker(H_X)
        if np.any((H_X @ e) % 2):
            continue

        # Check e not in im(H_Z^T)
        if _gf2_is_in_span(e, row_space_basis):
            continue

        weight = int(np.sum(e))
        if best_weight is None or weight < best_weight:
            best_weight = weight
            best_e = e.copy()

    return best_weight, best_e


def _greedy_heuristic(
    H_X: np.ndarray,
    logical_vecs: np.ndarray,
    row_space_basis: np.ndarray,
) -> Tuple[Optional[int], Optional[np.ndarray]]:
    """Greedy heuristic: for each logical rep, try stabiliser cancellations.

    AMBIGUITY: The description does not specify a particular greedy algorithm.
    We implement a simple local search: start with each logical representative,
    then iteratively try adding each row-space basis vector of H_Z
    (a stabiliser) and accept if weight decreases.  This is NOT guaranteed
    optimal — caller must check the returned status.
    """
    n = H_X.shape[1]
    best_weight: Optional[int] = None
    best_e: Optional[np.ndarray] = None

    for l_vec in logical_vecs:
        e = l_vec.copy()
        # Greedy descent: repeatedly scan all basis vectors of im(H_Z^T)
        improved = True
        while improved:
            improved = False
            for r in range(row_space_basis.shape[0]):
                candidate = e ^ row_space_basis[r]
                if int(np.sum(candidate)) < int(np.sum(e)):
                    e = candidate
                    improved = True

        weight = int(np.sum(e))
        if weight > 0 and (best_weight is None or weight < best_weight):
            best_weight = weight
            best_e = e.copy()

    return best_weight, best_e


# ============================================================
# Solver discovery
# ============================================================

def _discover_solver(
    timeout: int, use_gurobi: bool, debug: bool = False,
) -> Tuple[Optional[str], Optional[Any]]:
    """Return (solver_name, solver_fn) for the best available ILP solver.

    solver_fn has signature (H_X, logical_vec) -> (weight, vec, status).
    """
    # 1. Gurobi (direct gurobipy)
    if use_gurobi:
        try:
            import gurobipy  # noqa: F401

            def _gurobi_fn(H, lv):
                return _solve_ilp_gurobipy(H, lv, timeout, debug=debug)

            return "gurobi", _gurobi_fn
        except ImportError:
            pass

    # 2. PuLP + HiGHS
    try:
        import pulp  # noqa: F401

        # Quick check: can we instantiate HiGHS?
        try:
            pulp.HiGHS(msg=False)
        except Exception:
            pass
        else:

            def _highs_fn(H, lv):
                return _solve_ilp_pulp(H, lv, timeout, "highs", debug=debug)

            return "highs", _highs_fn
    except ImportError:
        pass

    # 3. PuLP + CBC (bundled with PuLP)
    try:
        import pulp  # noqa: F401

        def _cbc_fn(H, lv):
            return _solve_ilp_pulp(H, lv, timeout, "cbc", debug=debug)

        return "cbc", _cbc_fn
    except ImportError:
        pass

    return None, None


# ============================================================
# Main entry point
# ============================================================

def compute_distance_ilp(
    H_X: np.ndarray,
    H_Z: np.ndarray,
    timeout: int = 300,
    use_gurobi: bool = False,
    debug: bool = False,
) -> dict:
    """Compute d_Z (minimum-weight nontrivial logical Z operator) via ILP.

    Parameters
    ----------
    H_X : np.ndarray, shape (m_X, n), dtype=uint8
        X-type parity check matrix (binary).
    H_Z : np.ndarray, shape (m_Z, n), dtype=uint8
        Z-type parity check matrix (binary).
    timeout : int
        Solver timeout in seconds (default 300).
    use_gurobi : bool
        If True, prefer Gurobi over open-source solvers.
    debug : bool
        If True, print solver output and consistency-check details.

    Returns
    -------
    dict with keys:
        d_Z        – minimum distance (int or None)
        logical_op – minimising binary vector (np.ndarray or None)
        status     – "optimal"|"feasible"|"infeasible"|"timed_out"|"heuristic"|"no_solver"
        solver     – name of solver: "gurobi"|"highs"|"cbc"|"brute_force"|"none"
        d_X        – always None (X-distance not computed by this function)
    """
    # Validate / sanitise inputs
    H_X = np.asarray(H_X, dtype=np.uint8)
    H_Z = np.asarray(H_Z, dtype=np.uint8)
    H_X = H_X & 1
    H_Z = H_Z & 1

    if H_X.ndim != 2 or H_Z.ndim != 2:
        raise ValueError("H_X and H_Z must be 2-dimensional arrays")

    n = H_X.shape[1]
    if H_Z.shape[1] != n:
        raise ValueError("H_X and H_Z must have the same number of columns")

    # ----- Step 1: ker(H_X) — Z operators must live here --------------------
    G = _gf2_nullspace(H_X)  # shape (k_full, n), where k_full = dim(ker(H_X))

    if G.shape[0] == 0:
        # No non-trivial vectors in ker(H_X) → no logical Z operators
        return {
            "d_Z": None,
            "logical_op": None,
            "status": "infeasible",
            "solver": "none",
            "d_X": None,
        }

    # ----- Step 2: X logical representatives --------------------------------
    # A Z operator e ∈ ker(H_X) is nontrivial iff it anticommutes with at
    # least one X logical operator.  X logical operators form a basis of
    #     ker(H_Z) / im(H_X^T).
    # The ILP constraint  x_i^T @ e = 1 (mod 2)  for some basis vector x_i
    # correctly enforces e ∉ im(H_Z^T) in any valid CSS code.
    K_Z = _gf2_nullspace(H_Z)          # basis of ker(H_Z)
    R_X = _gf2_row_space_basis(H_X)    # basis of im(H_X^T)

    logical_vecs = []
    for i in range(K_Z.shape[0]):
        if not _gf2_is_in_span(K_Z[i], R_X):
            logical_vecs.append(K_Z[i])

    if len(logical_vecs) == 0:
        # k = 0: no nontrivial X logical directions → no logical qubits
        return {
            "d_Z": None,
            "logical_op": None,
            "status": "infeasible",
            "solver": "none",
            "d_X": None,
        }

    L = np.array(logical_vecs, dtype=np.uint8)

    # Also keep the rowspace of H_Z for the brute-force / greedy fallback
    # (they need im(H_Z^T) to test membership).
    R_Z = _gf2_row_space_basis(H_Z)

    # ----- Step 3: Solve ILPs -----------------------------------------------
    solver_name, solver_fn = _discover_solver(timeout, use_gurobi, debug=debug)

    if solver_fn is not None:
        # ILP solver available — solve one ILP per logical representative
        best_weight: Optional[int] = None
        best_e: Optional[np.ndarray] = None
        best_status = "infeasible"

        for i in range(L.shape[0]):
            w, e, st = solver_fn(H_X, L[i])

            # Belt-and-suspenders consistency check (the solver functions
            # already check internally, but we re-verify here).
            if e is not None:
                if w is None or w != int(np.sum(e)):
                    if debug:
                        print(
                            f"[DEBUG] Main-loop consistency: "
                            f"w={w}, sum(e)={int(np.sum(e)) if e is not None else None}"
                        )
                    e = None
                    st = "inconsistent"
                elif np.any((H_X @ e) % 2 != 0):
                    if debug:
                        print("[DEBUG] Main-loop: H_X constraint violated")
                    e = None
                    st = "inconsistent"
                elif (L[i] @ e) % 2 != 1:
                    if debug:
                        print("[DEBUG] Main-loop: logical constraint violated")
                    e = None
                    st = "inconsistent"

            if e is not None and (
                best_weight is None or (w is not None and w < best_weight)
            ):
                best_weight = w
                best_e = e
                best_status = st

        # Distinguish "timed_out with solution" from "timed_out without"
        if best_e is not None:
            return {
                "d_Z": best_weight,
                "logical_op": best_e,
                "status": best_status,
                "solver": solver_name,
                "d_X": None,
            }
        elif best_status == "timed_out":
            return {
                "d_Z": None,
                "logical_op": None,
                "status": "timed_out",
                "solver": solver_name,
                "d_X": None,
            }
        else:
            return {
                "d_Z": None,
                "logical_op": None,
                "status": "infeasible",
                "solver": solver_name,
                "d_X": None,
            }

    # ----- Step 4: Fallback – no ILP solver ---------------------------------
    # The brute-force / greedy fallback needs Z logical representatives
    # (vectors in ker(H_X) \ im(H_Z^T)) as starting points, not X logical reps.
    # Compute them here.
    L_Z = []
    for i in range(G.shape[0]):
        if not _gf2_is_in_span(G[i], R_Z):
            L_Z.append(G[i])
    L_Z = np.array(L_Z, dtype=np.uint8) if L_Z else np.zeros((0, n), dtype=np.uint8)

    if n <= 20:
        w, e = _brute_force(H_X, L_Z, R_Z)
        if w is not None:
            return {
                "d_Z": w,
                "logical_op": e,
                "status": "optimal",
                "solver": "brute_force",
                "d_X": None,
            }
        else:
            return {
                "d_Z": None,
                "logical_op": None,
                "status": "infeasible",
                "solver": "brute_force",
                "d_X": None,
            }
    else:
        w, e = _greedy_heuristic(H_X, L_Z, R_Z)
        if w is not None:
            return {
                "d_Z": w,
                "logical_op": e,
                "status": "heuristic",
                "solver": "none",
                "d_X": None,
            }
        else:
            return {
                "d_Z": None,
                "logical_op": None,
                "status": "infeasible",
                "solver": "none",
                "d_X": None,
            }
