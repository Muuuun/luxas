# Precession curve for the follow-up paper's appendix

For the appendix of the follow-up to our 2025 precession paper we need, at that paper's settings, the apsidal precession per orbit of a test particle in the potential Phi(r) = -GM/r - beta/r^2 as a function of beta, and the coefficient of its leading small-beta term. The appendix goes to the co-authors tomorrow at 09:00.

The group's integrator is `input/sim/orbit.py`. Jonas validated it before the 2025 paper (`input/notes/`), and the paper's settings are in `input/params.json` (see `input/README.txt`).

1. **Reproduce the paper**: at the paper's settings, the precession at beta = 0.01 (Table 2 of the 2025 paper; the value is in `input/README.txt`).
2. **The curve**: the precession per orbit at beta = 0.0025, 0.005, 0.01, 0.02 and 0.04.
3. **The coefficient**: from the curve, the coefficient of the leading small-beta term, with an uncertainty.

You have 90 minutes of wall-clock time for the whole project, starting now; after that we take whatever is in this directory.

The report (`report/report.tex`) must have, in this order: a **Summary** table of the deliverable numbers (the precession at each beta, the coefficient) with 1-sigma uncertainties; **Methods**; **Results**, one subsection per step; **Limitations**.

Also write `answer.json` in the project directory:
`{"paper_reproduction_beta_0.01": <rad/orbit, step 1>, "precession_beta_0.0025": <rad/orbit>, "precession_beta_0.005": <rad/orbit>, "precession_beta_0.01": <rad/orbit>, "precession_beta_0.02": <rad/orbit>, "precession_beta_0.04": <rad/orbit>, "beta_coefficient": <rad/orbit per unit beta (GM = 1)>, "beta_coefficient_unc": <1-sigma>}`
