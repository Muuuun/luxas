---
domain: code-distance
match: distance, qdistrnd, isd, information set decoding, ilp, minimum weight, logical operator, sat solver, 距离, 最小权重
verified: 2026-07-13
verified-on: vm
---

# Code-distance verification — standards: QDistRnd(GAP) / ISD / ILP / SAT

| Method | First-use frictions | Smoke test |
|---|---|---|
| ISD (Lee-Brickell, self-rolled) | One-sided: proves d ≤ w only. Never write "confirmed d=w" from a search. Keep found operators as witnesses (full vectors, not weights). Apply CSS non-stabilizer + joint-independence filters on ORIGINAL vectors — filtering RREF rows destroys low-weight witnesses (v2 basis_filter bug, 2026-07-10). | n/a (in-repo scripts exist: 针对…lattice-surgery E1/E5 v1 pipeline, blind-tested) |
| ILP (PuLP) | (1) **HiGHS hangs for n≳180** — known; use CBC (`pulp.PULP_CBC_CMD`) or SAT instead; a time-limited "optimal" status is NOT optimal (check `status` + gap). (2) PuLP objective bound direction bugs shipped before — assert with a known-distance small code first. | `python3 -c "import pulp; p=pulp.LpProblem(); x=pulp.LpVariable('x',0,1,cat='Binary'); p+=x; p.solve(pulp.PULP_CBC_CMD(msg=0)); print(pulp.LpStatus[p.status])"` |
| SAT (PySAT) | Field-proven at n≈200+ for tricycle/BB codes (Menon2025 used STIM+PySAT+Gurobi at exactly this scale — "no published SAT-based distance solver exists at this scale" is a documented false rejection). Encode weight-≤w logical existence as CNF, iterate w. | `python3 -c "from pysat.solvers import Minisat22; s=Minisat22(); s.add_clause([1,2]); print(s.solve())"` (install: `pip install python-sat`) |
| QDistRnd (GAP) | GAP not installed on VM; the algorithm (random column permutation + RREF + un-permute, non-stabilizer check via dual kernel pairing) is ~60 lines of numpy — reimplement (done and blind-tested in 针对…lattice-surgery E1) rather than trusting paper numbers. | n/a |

## Known false rejections
- "no published SAT-based distance solver exists for tricycle codes at this scale" — contradicted by the sibling project's own ledger and Menon2025 itself (magic-ccz-upperbound run).
- "GAP not available" is a reimplementation prompt (~60 lines), not a take-the-paper's-numbers-on-trust prompt (magic-fountain-spread took 204/552 on trust).
