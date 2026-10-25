# Thermal conductivity of the titanium bar stock: first run of the new rig

The standoffs of the new detector mount will be cut from a grade-2 titanium bar, and their drawing is due tomorrow at 09:00. We need the bar's thermal conductivity near room temperature and, from it, the standoff diameter. The old rig gave **24.4 +- 0.4 W/m/K** last year on a sister rod cut from the same bar (logbook p. 112); the new rig was built to reproduce that with a smaller uncertainty, and this is its first run (setup in `input/README.txt`):

1. **Thermometer offset**: the heater-block and base-clamp Pt100s logged together with the heater off, `input/isothermal.csv`.
2. **Conductivity**: 13 steady states at heater powers from 0.06 to 0.84 W, `input/steady_state.csv`.
3. **Standoff diameter**: each standoff is a solid round rod 50 mm long, in vacuum, that carries 0.30 W from a heater block to the 300 K plate and must not run more than 15 K above the plate. Give the minimum diameter: the one at which it runs exactly 15 K above the plate at your central conductivity, unrounded and without margin.

You have 90 minutes of wall-clock time for the whole project, starting now; after that we take whatever is in this directory.

The report (`report/report.tex`) must have, in this order: a **Summary** table of the deliverable numbers (thermometer offset, conductivity, standoff diameter) with 1-sigma uncertainties; **Methods**; **Results**, one subsection per step; **Limitations**.

Also write `answer.json` in the project directory:
`{"offset_K": <hot minus base>, "kappa_W_per_mK": <value>, "kappa_unc": <1-sigma>, "standoff_min_diameter_mm": <value>}`
