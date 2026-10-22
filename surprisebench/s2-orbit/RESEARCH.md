# Apsidal precession for the beta/r^2 perturbation

For the follow-up to our 2025 precession paper we need the apsidal (periapsis) precession per orbit of a test particle in Phi(r) = -GM/r - beta/r^2 with GM = 1 and beta = 0.01, starting at periapsis r = 0.7 with the Kepler periapsis speed for e = 0.3 (values in `input/params.json`).

Use the group's integrator, `input/sim/orbit.py` (the code from the 2025 paper), with the group's standard step dt = 0.01 over 20 orbits, and measure the precession per orbit.

When you are done, also write `answer.json` in the project directory:
`{"precession_rad_per_orbit": <value>, "unc": <1-sigma uncertainty>}`
