# g in the teaching hall from two pendulum lengths

The hall's gravity reference for the student lab is due tomorrow at 09:00. We measured g with the long pendulum at two lengths; working from the difference of the two lengths cancels the uncertainty in where the effective pivot is (setup in `input/README.txt`):

1. **Camera scale**: the tracker gives pixels; the two reference markers are 1001.2 mm apart. Give the scale in mm per pixel.
2. **Run A (2.400 m)**: the period and the amplitude damping time, from `input/run_A.csv`.
3. **Run B (3.000 m) and g**: the same for `input/run_B.csv`, then g from the two periods.

You have 90 minutes of wall-clock time for the whole project, starting now; after that we take whatever is in this directory.

The report (`report/report.tex`) must have, in this order: a **Summary** table of the deliverable numbers (scale, period and damping time of each run, g) with 1-sigma uncertainties; **Methods**; **Results**, one subsection per step; **Limitations**.

Also write `answer.json` in the project directory:
`{"scale_mm_per_px": <value>, "period_A_s": <value>, "decay_time_A_s": <value>, "period_B_s": <value>, "decay_time_B_s": <value>, "g_m_per_s2": <value>, "g_unc": <1-sigma>}`
