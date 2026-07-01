---
name: qec-construct
description: Verifier-in-the-loop CONSTRUCTION of quantum error-correcting codes with transversal non-Clifford gates (CCZ/T). Use when the task is to INVENT or improve a code/construction (not merely search a known family). Provides a sound, cheap algebraic verifier (qverify, "QEC's Lean") so you can propose an algebraic construction, get instant ground-truthed feedback, debug failures, and iterate — the way AlphaProof uses Lean. Targets the under-explored non-abelian region. NOT for blind random/grid search over supports.
---

# qec-construct — a QEC verifier-in-the-loop

## The one rule: CONSTRUCT, don't search

Broad/random/hill-climb search over code supports is a known dead end for this
problem (empirically caps far below the frontier; the good codes are rare
isolated optima). Your job is to **propose a parametrized ALGEBRAIC construction**
— a group + a generating rule for the supports + (for a new gate) the cup-product
/ Leibniz conditions — and **debug it against the sound verifier**, not to sample
points and hope.

If you find yourself enumerating random supports, stop: that is the wrong mode.

## The verifier: `scripts/qverify` (this is your Lean)

Call it at high frequency. Input a construction spec (JSON), get a SOUND verdict —
including **which condition failed**, so you can fix it.

```
echo '{"family":"abelian","group_shape":[3,4,5],
       "supp_a":[[0,1,3],[0,3,0],[2,1,3],[2,3,1]],
       "supp_b":[[1,1,4],[1,2,2],[2,1,1],[2,2,4]],
       "supp_c":[[0,0,4],[2,0,1]],
       "frontier_fom":14.4}' | scripts/qverify
```

What it checks, cheapest first:
- **CSS validity** (H_X H_Z^T = 0), n, k — exact GF(2), instant. Fails loudly if your construction isn't even a code.
- **Cheap sound screen** — a fast heuristic upper bound UB on d_Z (~sub-second, ~100x faster than exact). Reports `FOM_upper = k*UB^3/n`. If `FOM_upper < frontier` the code provably can't beat it → **reject** (never rejects a real winner, since UB ≥ d_Z). Otherwise → **promote**.
- **Gate (CCZ) check** (supply `partition_a/b/c`) — STCP/Leibniz conditions hold? logical CCZ non-trivial? `K_CCZ` (extractable gates). Abelian path is validated against all 11 published Menon codes.
- **`"exact":true`** — sound exact distance via ILP-to-optimality. Only this certifies distance. Run it only on promoted candidates.

## The loop (this is the whole method)

1. Propose a construction (group + support-generating rule + preorientation).
2. `qverify` it (cheap). If `css` or `gate` fails → read which condition failed → **fix the construction** (this is the Menon-style derivation-debug; e.g. the naive cup-product conditions force d=2 — find the offset/structure that escapes it).
3. Keep the cheap screen as your fitness: iterate the construction rule to push `FOM_upper` up while keeping the gate valid.
4. On a promoted candidate, run `"exact":true` to certify.

## The soundness gate — DO NOT violate

A code counts as a **new frontier code** ONLY if a single `qverify` run shows:
`css_valid` ✓, `gate.preserves_codespace`/`stcp_conditions_hold` ✓, `K_CCZ ≥ 1`,
and `distance_exact.status == "optimal"` with `fom_exact` strictly above the
frontier. **Estimated / biased-sampled / timed-out distances never certify a win.**
If you report a win on anything less, it is a hallucination, not a result.

## Where the new codes likely are

The abelian families are heavily optimized (you will mostly re-find Menon). The
upside is the **under-explored non-abelian region** (`"family":"general"`,
`"group":{"kind":"dihedral","n":..}` or `{"kind":"perm","generators":[..]}`).
The CSS + distance + cheap-screen verifiers ARE general and sound for non-abelian.
But two honest caveats: (1) the **non-abelian CCZ gate check is NOT yet implemented
in qverify** — so a non-abelian code is CSS/distance-verified but cannot be
gate-CERTIFIED here yet; implementing a group-agnostic direct-circuit
coboundary-invariance check (validated against `verify_stcp` before ship) is the
open next step. (2) Non-abelian is a **high-risk** region, not virgin territory:
Tiew2026 already *derived* non-abelian weight-4 cup-product gate conditions, yet
experts (Tiew, Menon) converged on abelian for deep reasons — the cup product is
graded-commutative (abelian-aligned), and abelian gives Fourier/character analysis,
analytic distance bounds, and hardware locality. Betting on non-abelian bets that
their choice was driven by "harder to analyze" (which this skill's verifiers
bypass) rather than "structurally worse" (which they don't).

## Honest boundary

This skill gives you a sound, cheap, debuggable verifier and the construct-don't-
search discipline. It does **not** guarantee a better code — proposing the right
construction is still the hard part. But it is the machine that lets a construction
loop actually converge instead of hallucinating, and it attacks the two real walls:
no cheap *classical* proxy exists for quantum distance (so the screen measures the
quantum quantity directly, cheaply, soundly), and the gate-validity that used to be
guessed is now checked exactly.
