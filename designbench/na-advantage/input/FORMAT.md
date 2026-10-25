# design.json format (`atomx/1`)

A design is one JSON object:

```json
{
  "format": "atomx/1",
  "atoms": [[0, 0], [10, 0], [0, 10], [10, 10]],
  "program": [ ...steps... ],
  "claims": { ...your headline numbers... },
  "notes": "optional free text"
}
```

- `atoms`: the trap sites to load, as [x_um, y_um]. Atom k (the k-th entry) is qubit k for the whole program.
- `program`: a list of steps, run in order. It must not be empty.
- No other top-level keys are allowed.

## Steps

| step | keys |
|---|---|
| one gate on every atom | `{"op": "global", "gate": "H"}` |
| one gate on chosen atoms | `{"op": "local", "atoms": [0, 3, 5], "gate": "T"}` |
| a gate per atom | `{"op": "local", "gates": {"0": "SX", "3": "T"}}` (keys are atom indices as strings) |
| machine-drawn gates | `{"op": "local_random", "set": ["SX", "SY", "SW"], "atoms": "all", "seed": 7, "no_repeat": true}` |
| transport | `{"op": "move", "x": [0, 20, 40], "y": "all", "dx": 8, "dy": 0}` |
| Rydberg pulse | `{"op": "rydberg"}` |
| repetition | `{"op": "repeat", "times": 10, "body": [ ...steps... ]}` |

**Gates**: H, X, Y, Z, S, SDG, T, TDG, SX, SY, SW (definitions in MACHINE.md).

**move**: `x` and `y` are each `"all"` or a list of coordinates in µm. Both are required, and so are `dx` and `dy`. The move picks up atoms whose current position matches both lists. Selected coordinates are compared after rounding to 1e-6 µm.

**local_random**: the machine draws one gate per listed atom from `set`, using Python's `random` module:

- The n-th time a given `local_random` entry runs (n = 0, 1, 2, …, counting repetitions), it uses `rng = random.Random(f"{seed}:{n}")`.
- Atoms are visited in increasing index order. For each atom, the candidates are the gates in `set`, in the order written. With `"no_repeat": true`, the candidates leave out the gate this atom last received from any `local_random` step.
- The drawn gate is `candidates[rng.randrange(len(candidates))]`.
- `atoms` is `"all"` or a list of indices. It defaults to `"all"`.

You do not need to reproduce this yourself: `compile.py --dump` writes out the drawn gates.

**repeat**: expands its body `times` times. Repeats may be nested. A program may have at most 200,000 steps after expansion.

## Claims

`claims` states your headline numbers, computed under MACHINE.md. All seven keys are required:

| key | meaning |
|---|---|
| `fidelity` | predicted XEB fidelity F of a kept shot |
| `keep_probability` | P, the probability that a shot loses no atom |
| `cycle_time_s` | shot time t_shot in seconds |
| `kept_samples` | M |
| `quantum_time_s` | T_q in seconds |
| `classical_time_s` | T_classical in seconds, by the cheapest method you know of |
| `score` | S = log10(classical_time_s / quantum_time_s) |

We recompute every number from your program and compare.

## compile.py

```
python3 compile.py design.json                     # OK: ... or ERROR: ...
python3 compile.py design.json --dump circuit.json # also write the expanded program
```

`--dump` writes `{"n": N, "atoms": [...], "steps": [...]}`, where each step is one of:

- `{"kind": "1q", "mode": "global", "gate": "H"}`, a gate on every atom;
- `{"kind": "1q", "mode": "local", "gates": [[atom, gate], ...]}`;
- `{"kind": "move", "atoms": [...], "dx": .., "dy": .., "distance_um": ..}`;
- `{"kind": "rydberg", "pairs": [[a, b], ...], "unpaired": [...]}`.
