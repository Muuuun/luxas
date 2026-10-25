# AtomX-400: machine model

This is the model your design is judged under. The numbers are in `hardware.json`; key names are given in brackets. `compile.py` checks the format and the geometry rules. It does not compute anything in the sections after "Geometry".

## Atoms

- **Trap sites**: 400 static sites on a square grid with pitch 10 µm, at (10 i, 10 j) µm for 0 ≤ i, j < 20 [`sites`].
- **Loading**: a design loads 2 to 400 of the sites. Atom k, the k-th entry of `atoms`, is qubit k.
- **Preparation**: every atom starts in |0⟩, with error 2.0e-3 per atom [`error.prep`].
- **Measurement**: at the end every atom is measured in the Z basis, with error 3.0e-3 per atom [`error.meas`].
- **Field**: atoms can be moved anywhere with x, y ∈ [−20, 210] µm [`field_um`].

## Operations

Steps run one after another; nothing overlaps.

| op | what it does | duration | error per event |
|---|---|---|---|
| `global` | one single-qubit gate on every atom | 2 µs | 3.0e-4 per atom |
| `local` | single-qubit gates on any chosen atoms, in parallel, any gate per atom | 10 µs | 1.0e-3 per addressed atom |
| `local_random` | a `local` step whose gates the machine draws (FORMAT.md) | 10 µs | 1.0e-3 per addressed atom |
| `move` | AOD transport of a set of atoms by (dx, dy) | 100 µs + 2√(d/a) | 1.0e-4 per moved atom |
| `rydberg` | global Rydberg pulse: CZ on every pair of atoms closer than 3 µm | 0.5 µs | 2.5e-3 per pair; 5.0e-4 per unpaired atom |

For moves, d = √(dx² + dy²) and a = 0.01 µm/µs² [`move_acceleration_um_per_us2`].

**Gates**:
- H, X, Y, Z, S, SDG (S†), T, TDG (T†);
- SX = √X = e^{−iπX/4}, SY = √Y = e^{−iπY/4};
- SW = √W = e^{−iπW/4}, with W = (X + Y)/√2.

The two-qubit gate is CZ = diag(1, 1, 1, −1). H, X, Y, Z, S, SDG, SX and SY are Clifford; T, TDG and SW are not.

## Geometry

**Move.** A move picks up every atom whose current x is in the list `x` and whose current y is in the list `y`. This is how an AOD grabs atoms: at the crossings of its selected columns and rows. `"all"` selects every column or every row. The move then translates all the picked atoms by (dx, dy).
- Positions are compared and stored to 1e-6 µm.
- After a move, every two atoms must be at least 1 µm apart, and every atom must be inside the field.
- Paths are not checked.

**Rydberg pulse.** During a pulse:
- two atoms at most 3 µm apart form a CZ pair [`geometry_um.pair_max`];
- no atom may have more than one other atom within 3 µm;
- no two atoms may be between 3 and 7 µm apart, which would be partial blockade [`geometry_um.isolated_min`];
- an atom with no other atom within 7 µm is unpaired. It gets no gate, only the unpaired error.

## Fidelity

- **Circuit duration**: T_c is the sum of all step durations.
- **Idle dephasing**: every atom accrues error 1 − exp(−T_c / T2), with T2 = 1.5 s [`t2_s`].
- **Predicted XEB fidelity**: F is the product of (1 − p) over every error event. The events are:
  - every gate on every atom;
  - every CZ pair and every unpaired atom, per pulse;
  - every moved atom, per move;
  - idle dephasing, per atom;
  - preparation and measurement, per atom.

## Losses

Atoms can be lost:
- 2.0e-4 per moved atom per move [`loss.move`];
- 5.0e-4 per paired atom per pulse [`loss.cz_per_atom`];
- 1 − exp(−T_c / 30 s) per atom from the vacuum [`vacuum_lifetime_s`].

A lost atom is missing from the final image, and the shot is discarded.

The keep probability P is the product of (1 − p) over the loss events. Kept shots have fidelity F.

## Shots, samples and run time

- **Shot time**: t_shot = 0.200 s (load, rearrange, cool) + T_c + 0.015 s (image) [`shot_overhead_s`].
- **Kept samples**: M = ⌈25 / F²⌉. This is the linear-XEB demonstration at 5σ: the estimator's standard deviation is about 1/√M [`limits.significance_sigma`].
- **Quantum run time**: T_q = (M / P) · t_shot.

## Errors per cycle (noise phase)

**Cycle.** A cycle is one Rydberg pulse together with every step since the previous pulse. Steps after the last pulse belong to the last cycle.

**λ.** For each cycle, λ is the sum of two parts:
- the error probabilities of the cycle's events: gates, CZ pairs, unpaired atoms and moved atoms. Preparation, measurement and losses are not counted.
- N × (cycle duration) / T2.

**Requirement.** λ ≤ 0.5 in every cycle [`limits.max_errors_per_cycle`].

Above this the experiment is in the strong-noise phase, where its XEB can be spoofed by simulating weakly coupled patches. Morvan et al., Nature 634, 328 (2024), found the transition at 0.5–0.6 errors per cycle in 2D.

## What the classical side simulates

The machine runs every step. The classical side first simplifies the circuit by removing gates that multiply to the identity:
- every run of single-qubit gates on an atom, with no CZ on that atom in between, becomes one gate, and is dropped if it is the identity up to a phase;
- two CZs on the same pair, with nothing on either atom in between, cancel.

This is repeated until nothing changes, so a circuit followed by its inverse simplifies to nothing. The light cone and the classical cost below are computed on this simplified circuit.

## Light cone

Every qubit's final state must depend on every qubit's initial state through the CZ pairs of the simplified circuit, taken in program order.

## Classical cost

The reference classical machine does 10¹⁸ FLOP/s [`reference_classical_machine`]. Its memory is unlimited, which favors the classical side. Three methods are considered, and the cheapest one counts. G is the number of gate applications in the simplified circuit: single-qubit gates counted per atom, plus CZ pairs. t is the number of its non-Clifford gate applications.

1. **Statevector**: 8 · 2^N · G FLOPs computes all amplitudes at once. Sampling from them is then free.
2. **Tensor network**, one amplitude at a time: C_TN is the FLOP count of the cheapest contraction order for ⟨x|U|0^N⟩ that a search finds, after the usual network simplifications (diagonal gates as hyperedges, rank reduction). Producing M samples at fidelity F costs M · F · C_TN, because contracting a fraction F of the network gives fidelity F (Markov et al. 2018).
3. **Stabilizer rank**, one amplitude at a time: C_stab = N³ · 2^(0.228 t) FLOPs (Bravyi et al. 2019). M samples at fidelity F cost M · F · C_stab.

T_classical = min(8 · 2^N · G, M · F · min(C_TN, C_stab)) / 10¹⁸ s.

## Figure of merit

S = log10(T_classical / T_q).

A design counts only if all four hold:
- it compiles;
- T_q ≤ 604,800 s, one week [`limits.max_run_time_s`];
- λ ≤ 0.5 in every cycle;
- the light cone is complete.
