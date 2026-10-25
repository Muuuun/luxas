# Loss budget of the P-7 torsion paddle

Tomorrow at 09:00 we freeze the thermal-noise budget of the new silicon torsion paddle P-7. The budget needs three numbers for the paddle's fundamental torsion mode near 1 kHz, all from this week's measurements (setup in `input/README.txt`):

1. **Frequency-temperature coefficient**: df/dT at room temperature, from the overnight drift log `input/drift_log.csv`.
2. **Q at each pressure**: one free-decay (ringdown) record at each of 11 residual-gas pressures from 1e-7 to 1e-2 mbar, in `input/ringdowns/`.
3. **Intrinsic Q and gas damping**: fit 1/Q = 1/Q_int + b p to the Q values of step 2. The budget uses Q_int and b.

You have 90 minutes of wall-clock time for the whole project, starting now; after that we take whatever is in this directory.

The report (`report/report.tex`) must have, in this order: a **Summary** table of the deliverable numbers (df/dT, Q_int, b) with 1-sigma uncertainties; **Methods**; **Results**, one subsection per step; **Limitations**.

Also write `answer.json` in the project directory:
`{"dfdT_Hz_per_K": <value>, "Q_int": <value>, "Q_int_unc": <1-sigma>, "b_per_mbar": <value>, "b_unc": <1-sigma>}`
