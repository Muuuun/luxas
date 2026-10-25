# designbench: open design problems with a mechanical score

These tasks have no single right answer. They are ones a bare model or agent can do badly. Each task has a figure of merit that a grader recomputes from the agent's own artifact, so different systems can be compared on the same task:
- a bare LLM;
- a bare coding agent;
- a coding agent with a verification loop;
- Luxas.

Design, arms and pre-registered decision lines: `notes/designbench-na-advantage-2026-10-23.md`.

These tasks live here, not in `benchmarks/`, because `reflect_ab.mts` runs every directory there, on the API, for up to 40 minutes each.

## na-advantage

The task is to design a beyond-classical sampling experiment on AtomX-400, a fictional 400-site reconfigurable neutral-atom processor.

What the agent sees:
- `RESEARCH.md`;
- `input/hardware.json` (the datasheet);
- `input/MACHINE.md`: the error, loss, time and classical-cost model, every formula the grader uses;
- `input/FORMAT.md`: the design format;
- `input/compile.py`: a stdlib-only checker of format and geometry, which can also dump the expanded circuit.

What the agent delivers: `design.json` with a `claims` block, and `report.md`.

What the agent never sees:
- `_lib/` (the grader);
- `reference/`;
- `RUBRIC.md`.

`bench_run.mts` copies only `RESEARCH.md` and `input/`.

### Scoring

The figure of merit is S = log10(T_classical / T_q).
- **T_q** is the machine time for 25/F² kept samples at the predicted XEB fidelity F.
- **T_classical** is the cheapest of three attacks: statevector, tensor network per amplitude times M·F, or stabilizer rank.

A design counts only if it compiles and meets three conditions:
- T_q ≤ 7 days;
- at most 0.5 errors per cycle, the noise-phase bound;
- its light cone is complete.

`claims` are compared with the recomputed values:
- Fidelity, keep probability, shot time, samples and run time count as consistent within 10–30 %.
- Classical time and score are flagged only when they claim more than 2 decades above ours, i.e. overclaimed hardness. Claiming less is "conservative": the agent may know a better attack than our search.

The report is judged against `RUBRIC.md`.

### Reference scores (grader, 2026-10-23)

| design | n | F | T_q | log10 C_TN per amplitude | S |
|---|---|---|---|---|---|
| ref-grid-rcs: 8×8 grid RCS, 16 cycles | 64 | 5.5 % | 58 min | 14.4 | −4.4 |
| ref-hypercube-rcs: 16×8 hypercube RCS, 7 layers | 128 | 4.4 % | 89 min | 20.6 | +1.7 |
| ref-hypercube-deep: the same, 13 layers | 128 | 0.59 % | 6.1 d | 33.0 | +12.9 |

Because S is continuous, there is room above the references. With 128 atoms the hypercube layers sit at 0.49 errors per cycle, just under the bound. Going larger means spending less error per cycle.

Each planted design fails exactly one check:

| design | what is wrong | check that fails |
|---|---|---|
| bad-runtime | the grid run three times deeper | run time: 3.6 years |
| bad-noise | the hypercube with two extra single-qubit layers per cycle | noise: 0.75 errors per cycle |
| bad-clifford | the grid without SW | none, but the Clifford circuit falls to the stabilizer attack: S = −13 |
| bad-blockade | a 5 µm pairing shift | compile: partial blockade |
| bad-lightcone | pairing along rows only | light cone |
| bad-mirror | an 8×8 hypercube circuit followed by its inverse | light cone, once the inverse is cancelled |
| bad-trivial | diagonal gates only, so the state stays \|0⟩ | none, but the tensor network costs 10^2.8 FLOPs: S = −19 |
| bad-claims | claims from a careless budget: gate errors only, lost shots kept, a statevector per sample | exactly five of the seven claims are flagged |

The gate also checks itself: removing the gate reduction, SPAM, the light cone or the noise bound, or loosening the fidelity tolerance, each turns it red.

### Setup

The grader's search needs quimb and cotengra (the Mac's system Python is 3.9):

```
uv venv ~/.sisyphus/venvs/designbench --python 3.12
uv pip install --python ~/.sisyphus/venvs/designbench/bin/python quimb cotengra kahypar cmaes
```

### Running and grading an arm

```
env -u ANTHROPIC_API_KEY npx tsx scripts/bench_run.mts --arm claude-code --bench-root designbench --bench na-advantage --timeout-min 90
~/.sisyphus/venvs/designbench/bin/python designbench/_lib/grade.py <run-dir>          # one line
~/.sisyphus/venvs/designbench/bin/python designbench/_lib/grade.py <run-dir> --json   # everything
```

The tensor-network search takes 2–5 minutes per new circuit and is cached in `~/.sisyphus/designbench/tn_cache.json`.

### Changing the references or the machine

1. `python3 designbench/_lib/make_refs.py` writes `reference/*/design.json` and `reference/expected.json`.
2. For each reference that `make_refs.py` lists as having no search result, run `grade.py reference/<name> --cache designbench/na-advantage/reference/tn_cache.json` with the venv Python.
3. Run `make_refs.py` again, so the reference claims carry the classical times.
4. Run `npx tsx scripts/smoke_designbench.mts`. It holds the grader to exact answers, on the system python3 with no search:
   - the analytic budgets;
   - each planted design failing exactly its check;
   - the ordering of the references;
   - the RNG procedure in FORMAT.md;
   - refusals of malformed designs.

### Known gaps in the model

All of these are documented to the agents only by omission.
- **Tensor-network search**: the cost is only as good as our search, which is an upper bound. Two seeds on the same circuit differed by about one decade.
- **Structured circuits** whose contraction simplifies in ways neither our gate reduction nor quimb's simplification catches. The reduction does catch a circuit followed by its inverse, and quimb catches diagonal gates acting on |0⟩.
- **Symmetric circuits**: identical gates on every atom (global steps) may be easier than our search thinks.
- **Attacks the model leaves out**: approximate tensor networks for shallow 2D circuits, Pauli-path methods, big-batch tensor-network sampling. The noise-phase bound stands in for patch spoofing.
- **Memory** is not charged.
- **Move paths** are not checked.

The rubric asks the report to address these gaps.
