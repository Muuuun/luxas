# na-advantage: report rubric (judges and expert; never copied into a run)

The figure of merit and the claims are scored mechanically by `_lib/grade.py`. This rubric covers what code cannot check: whether the report is a sound case for the design. Each leaf is yes or no. A judge answers from the report and design.json only, and quotes the sentence that decides it.

The six top-level areas are what the expert grades blind (1 to 5 each). The leaves are for the LLM judges, and are calibrated against the expert's grades.

## 1. Circuit family and its realisation
- 1a. Names the circuit family (random circuit, IQP, or other), and says why its output is hard to sample and anti-concentrated.
- 1b. Justifies the connectivity it uses through the machine's transport, and how many layers that connectivity needs to scramble.
- 1c. Says why this N and this depth, as a trade-off between fidelity and classical cost, rather than giving them without a reason.

## 2. Error budget
- 2a. Accounts for every error source in MACHINE.md that the design incurs: gates, CZ pairs, unpaired atoms under the pulse, moves, idle dephasing, preparation and measurement.
- 2b. Treats losses as discarded shots (keep probability), not as a fidelity loss, or explicitly argues otherwise.
- 2c. States the errors per cycle and checks them against the noise-phase bound.

## 3. Samples and run time
- 3a. Derives the sample count from the significance target (about 25/F² for 5σ linear XEB).
- 3b. Includes the shot overhead (load, rearrange, image) and the discarded shots in the run time.

## 4. Classical hardness
- 4a. Estimates a tensor-network contraction cost for the actual circuit, not only the 2^N statevector size.
- 4b. Applies the fidelity discount (simulating at fidelity F costs about F times the exact cost), or argues that it does not apply.
- 4c. Considers at least one attack that does not appear in MACHINE.md, for example patch or elided circuits, Pauli-path methods for noisy circuits, or big-batch tensor-network sampling, and says whether it changes the conclusion.
- 4d. Says which numbers are upper bounds or estimates, and how far off they could be.

## 5. Verification
- 5a. Says how XEB will be estimated when the ideal probabilities cannot be computed. Acceptable answers include verifiable smaller or elided instances, patch circuits, Clifford versions run with the same noise, or a verifiable circuit family.
- 5b. Names a control that would reveal a miscalibrated error model, for example fidelity versus depth on simulable sizes.

## 6. Risks and honesty
- 6a. Names at least one concrete development that would invalidate the advantage claim, such as a better contraction order or a known algorithm, and estimates the margin against it.
- 6b. The report's headline numbers match design.json `claims`. Two numbers match if they agree to within 10%, or to within one decade for classical costs.
