# experiment_reviewer — E5 (retrofit fixture; lines per design §3.5)

DISCRIMINATOR: blockade_leakage_40MHz — if right: leakage scales as Omega^2 and matches (Omega/2V)^2 within 3x at V=-152 MHz; if wrong: exponent ~4 and 100x below the closed form; computation: two-branch symmetric gate with conditional phase at V=-152 MHz, check eps ~ hbar^2 Omega^2/2V^2 in the V >> Omega limit
ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 with V=152 MHz — inputs: [blockade_shift_4um_GHz=-0.152]
SCALING: blockade_leakage_40MHz — expected 2 in Omega; observed 4.03 from runs/run_1/data/master_fidelity_vs_omega.csv
INDEPENDENT: rabi_38P_khz E1:own vs E1:xval — computed dipole + beam formula vs a measured line scan
INDEPENDENT: c6_75_ghz_um6 E3:own vs E5:own — n^11 extrapolation of perturbative C6 vs R^-6 tail fit of a full diagonalization
