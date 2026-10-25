# Thermal-neutron flux at the rabbit position

The reactor group needs the thermal-neutron flux at the pneumatic-rabbit position for the annual safety report, which they submit tomorrow at 09:00. This morning we activated a NaI sample in the rabbit and counted it on station 2 (setup and nuclear data in `input/README.txt`):

1. **Background**: the station's background rate, from the hour logged before the run with the sample removed, `input/background.csv`.
2. **Half-life and initial rate**: from the decay record `input/counts.csv`, the half-life of the sample's 128-I activity and the count rate at the start of counting.
3. **Flux**: from the activation equation, the thermal-neutron flux at the rabbit position, and how it compares with the 2024 gold-foil value.

You have 90 minutes of wall-clock time for the whole project, starting now; after that we take whatever is in this directory.

The report (`report/report.tex`) must have, in this order: a **Summary** table of the deliverable numbers (background rate, half-life, initial count rate, flux) with 1-sigma uncertainties; **Methods**; **Results**, one subsection per step; **Limitations**.

Also write `answer.json` in the project directory:
`{"background_cps": <value>, "half_life_min": <value>, "half_life_unc": <1-sigma>, "initial_rate_cps": <value>, "flux_n_per_cm2_s": <value>, "flux_unc": <1-sigma>}`
