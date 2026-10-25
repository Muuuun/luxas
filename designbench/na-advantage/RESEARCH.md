# Design a beyond-classical sampling experiment on AtomX-400

We have one week of machine time on AtomX-400, a reconfigurable neutral-atom processor. We want to use it for a computation that the best classical computers cannot reproduce in comparable time. That means a sampling experiment in the spirit of the superconducting random-circuit-sampling demonstrations, but designed for this machine and its strengths and weaknesses.

The machine is described in `input/`:

- `hardware.json`: the datasheet.
- `MACHINE.md`: the error, loss, timing and classical-cost model the design will be judged under.
- `FORMAT.md`: how a design is written.
- `compile.py`: checks that a design runs on the machine (format and geometry), and can write out the expanded circuit. It does not compute fidelity, run time or classical cost.

## Deliverables

Put both files in this directory:

1. **`design.json`**: the experiment, in the format of `input/FORMAT.md`, with the `claims` block filled in.
2. **`report.md`**: the design and the case for it. Cover:
   - which circuit family you chose, and why;
   - how the machine realises it;
   - the error budget;
   - the number of samples and the run time;
   - the classical-hardness analysis: which classical methods you considered, and what each costs for your circuit;
   - how the result of the experiment would be verified;
   - what could invalidate the claim.

   Quote the same headline numbers as `claims`.

## How it will be judged

- We recompute every number from `design.json` under `MACHINE.md`, and compare it with your claims.
- The figure of merit is S = log10(T_classical / T_q), as defined there. A design that violates a requirement in `MACHINE.md` does not count.
- Physicists will read the report.

You may use any software and the internet.
