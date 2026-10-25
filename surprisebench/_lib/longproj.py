"""Long-horizon planted-surprise projects (notes/surprise-ruler-long-design-2026-10-23.md).

Each project has three steps. The plant sits in step 2 and uses the pilot's exact
physical parameters (generate.py RING / ROD / ORBIT / DECAY / PEND); what is new is
the context: more files, an inherited result, a prior value, a downstream closure.
Seeds are new, so no data file repeats a pilot file.

generate.py imports this module for writing inputs and for --check.
"""
import json
import os

import numpy as np

import generate as G

# ── L1 loss budget: s1's second mode in every ringdown of a pressure series ────
L1 = dict(pressures=tuple(float(p) for p in np.logspace(-7, -2, 11)), b=0.2, T_rec=8.0,
          alpha=-3.0e-5, f_ref=G.RING["fA"], T_ref=300.0)


def l1_ringdown(p_mbar, planted, seed):
    R = G.RING
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, L1["T_rec"], 1.0 / R["fs"])
    # gas damping adds b*p to 1/Q of both modes (same paddle, same gas)
    tau = lambda f, Q: 1.0 / (np.pi * f * (1.0 / Q + L1["b"] * p_mbar))
    x = np.exp(-t / tau(R["fA"], R["QA"])) * np.cos(2 * np.pi * R["fA"] * t)
    if planted:
        x = x + R["aB"] * np.exp(-t / tau(R["fB"], R["QB"])) * np.cos(2 * np.pi * R["fB"] * t + R["phB"])
    v = R["amp"] * x + R["noise"] * R["amp"] * rng.standard_normal(t.size)
    return t, v


def _envelope(v):
    n = v.size
    h = np.zeros(n)
    h[0] = 1.0
    h[1:(n + 1) // 2] = 2.0
    if n % 2 == 0:
        h[n // 2] = 1.0
    return np.abs(np.fft.ifft(np.fft.fft(v) * h))


def l1_naive_q(t, v):
    """Single exponential on the Hilbert envelope, down to ~10x the noise level."""
    env = _envelope(v)
    m = (t > 0.05) & (t < t[-1] - 0.05) & (env > 10 * G.RING["noise"] * G.RING["amp"])
    return float(-np.pi * G.RING["fA"] / np.polyfit(t[m], np.log(env[m]), 1)[0])


def l1_drift_log(seed):
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, 8 * 3600.0, 30.0)  # overnight, every 30 s
    T = L1["T_ref"] + 1.2 * np.sin(2 * np.pi * t / 21600.0) + 0.4 * (t / t[-1]) + 0.01 * rng.standard_normal(t.size)
    f = L1["f_ref"] * (1 + L1["alpha"] * (T - L1["T_ref"])) + 0.3e-3 * rng.standard_normal(t.size)
    return t, T, f


def l1_naive(planted, seed):
    qs = np.array([l1_naive_q(*l1_ringdown(p, planted, seed + 1 + i)) for i, p in enumerate(L1["pressures"])])
    p = np.array(L1["pressures"])
    y = 1 / qs
    A = np.vstack([np.ones(p.size), p]).T
    c = np.linalg.lstsq(A / y[:, None], np.ones(p.size), rcond=None)[0]  # equal relative errors
    return {"Q_int": float(1 / c[0]), "b_per_mbar": float(c[1])}


def make_l1(out, planted, seed):
    t, T, f = l1_drift_log(seed)
    G.write_csv(os.path.join(out, "drift_log.csv"), ["t_s", "T_paddle_K", "f_Hz"], [t, T, f], ["%.0f", "%.4f", "%.5f"])
    for i, p in enumerate(L1["pressures"]):
        tt, v = l1_ringdown(p, planted, seed + 1 + i)
        G.write_csv(os.path.join(out, "ringdowns", f"ringdown_{i + 1:02d}_{p:.2e}mbar.csv"), ["t_s", "signal_V"], [tt, v], ["%.4f", "%.5f"])
    G.write_text(os.path.join(out, "README.txt"), """
Torsion paddle P-7: silicon, 2.0 x 2.0 mm, 300 um thick, on two torsion beams;
fundamental torsion mode near 1 kHz. The paddle hangs 1.0 um above its
electrostatic drive electrode. Readout: optical lever on a split photodiode;
signal_V is proportional to the paddle angle (small angles). ADC 24 bit.

drift_log.csv: overnight log 2026-10-19/20, the paddle held in a phase-locked
loop on the torsion mode (f_Hz is the PLL frequency) while the lab temperature
drifted; T_paddle_K is the Pt1000 on the paddle clamp. One row every 30 s.

ringdowns/: free-decay records at 11 residual-gas pressures, 2026-10-21/22,
with the clamp temperature stabilized at 300.00 +- 0.01 K. The chamber was
pumped to its base pressure (1e-7 mbar) and then let up in steps with dry
nitrogen (ion gauge below 1e-4 mbar, capacitance manometer above; the pressure
is in the file name). At each pressure the paddle was driven near 1 kHz, the
drive switched off at t = 0 and the decay recorded: sampling 10 kHz, 8 s per
record.
""")


# ── L2 rod conductivity with a prior that matches the naive value (s4's plant) ─
L2 = dict(offset_K=0.042, prior=(24.4, 0.4), P_strut=0.30, L_strut=0.050, dT_max=15.0)


def l2_isothermal(seed):
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, 1800.0, 10.0)
    base = 300.0 + 0.002 * (t / t[-1]) + 0.02 * rng.standard_normal(t.size)
    hot = 300.0 + 0.002 * (t / t[-1]) + L2["offset_K"] + 0.03 * rng.standard_normal(t.size)
    return t, hot, base


def l2_steady(planted, seed):
    """s4's physics (generate.ROD) with the dT solved for the power actually dissipated, a heater
    whose resistance drifts 50 ppm/K with the block temperature, and V and I read with 1e-4 noise."""
    p = G.ROD
    rng = np.random.default_rng(seed)
    A = np.pi * p["D"] ** 2 / 4
    Gc = p["kappa"] * A / p["L"]
    eA = p["eA"] if planted else 0.0
    P = np.array(p["P"]) * (1 + p["noise_P"] * rng.standard_normal(len(p["P"])))
    dT = []
    for Pk in P:
        lo, hi = 0.0, 2000.0
        for _ in range(200):
            d = (lo + hi) / 2
            if Gc * d + eA * G.SIGMA_SB * ((p["T0"] + d) ** 4 - p["T0"] ** 4) < Pk:
                lo = d
            else:
                hi = d
        dT.append((lo + hi) / 2)
    dT = np.array(dT)
    Tb = p["T0"] + 0.02 * rng.standard_normal(dT.size)
    Th = Tb + dT + p["noise_T"] * rng.standard_normal(dT.size) + L2["offset_K"]
    R = 1000.0 * (1 + 50e-6 * (Tb + dT - 300.0))
    V = np.sqrt(P * R) * (1 + 1e-4 * rng.standard_normal(dT.size))
    I_mA = 1e3 * np.sqrt(P / R) * (1 + 1e-4 * rng.standard_normal(dT.size))
    return V, I_mA, Th, Tb


def l2_strut_mm(kappa):
    return float(1e3 * np.sqrt(4 * L2["P_strut"] * L2["L_strut"] / (np.pi * kappa * L2["dT_max"])))


def l2_naive(planted, seed):
    V, I_mA, Th, Tb = l2_steady(planted, seed)
    k = float(G.rod_naive_kappa(V * I_mA / 1e3, Th - L2["offset_K"], Tb))
    return {"kappa_W_per_mK": k, "standoff_min_diameter_mm": l2_strut_mm(k)}


def make_l2(out, planted, seed):
    t, hot, base = l2_isothermal(seed)
    G.write_csv(os.path.join(out, "isothermal.csv"), ["t_s", "T_hot_K", "T_base_K"], [t, hot, base], ["%.0f", "%.3f", "%.3f"])
    V, I_mA, Th, Tb = l2_steady(planted, seed + 1)
    G.write_csv(os.path.join(out, "steady_state.csv"), ["heater_V", "heater_mA", "T_hot_K", "T_base_K"],
                [V, I_mA, Th, Tb], ["%.4f", "%.4f", "%.3f", "%.3f"])
    G.write_text(os.path.join(out, "README.txt"), """
New rod-conductivity rig, first run 2026-10-21. Sample: commercially pure
titanium, grade 2, turned rod cut from the strut bar stock (heat 4471),
diameter 3.00 mm, length 50.0 mm between the heater block and the base clamp.
Vacuum 1e-6 mbar. The base clamp is held at 300 K.
Heater: 1.000 kOhm (at 300 K) thin-film resistor, cemented with a ceramic
high-temperature adhesive in a small copper block clamped to the free end of
the rod; heater_V and heater_mA are the voltage across it and the current.
Thermometers: Pt100 in the heater block (T_hot) and in the base clamp (T_base),
4-wire, read by the same bridge.

isothermal.csv: both thermometers logged together for 30 min with the heater
off and the whole rig at 300 K, one row every 10 s.
steady_state.csv: one row per steady state (waited for drift < 2 mK/min).
""")


# ── L3 inherited integrator: s2's stale-acceleration bug, a true but weak validation ─
L3 = dict(betas=(0.0025, 0.005, 0.01, 0.02, 0.04))

VALIDATE_KEPLER = '''"""Kepler test of sim/orbit.py (J., 2025-09-12): beta = 0 must give a closed orbit."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sim"))
from orbit import integrate

GM, rp, e = 1.0, 0.7, 0.3
vp = np.sqrt(GM * (1 + e) / rp)
dt, n_orbits = 0.001, 20
period = 2 * np.pi * (rp / (1 - e)) ** 1.5
t, x, y, vx, vy = integrate((rp, 0.0), (0.0, vp), dt, int(n_orbits * period / dt), beta=0.0)
r = np.hypot(x, y)
i = np.where((r[1:-1] < r[:-2]) & (r[1:-1] < r[2:]))[0] + 1
drift = np.mean(np.diff(np.unwrap(np.arctan2(y[i], x[i]))))
print(f"periapsis passages: {len(i)}  mean periapsis-angle drift: {drift:+.1e} rad/orbit")
'''


def l3_run(planted, beta, dt, n_orbits):
    ns = {}
    exec(G.orbit_code(planted), ns)
    O = G.ORBIT
    vp = np.sqrt(O["GM"] * (1 + O["e"]) / O["rp"])
    n = int(n_orbits * 2 * np.pi * (O["rp"] / (1 - O["e"])) ** 1.5 / dt)
    t, x, y, vx, vy = ns["integrate"]((O["rp"], 0.0), (0.0, vp), dt, n, beta)
    r = np.hypot(x, y)
    i = np.where((r[1:-1] < r[:-2]) & (r[1:-1] < r[2:]))[0] + 1
    return float(np.mean(np.diff(np.unwrap(np.arctan2(y[i], x[i])))))


def l3_true(beta):
    O = G.ORBIT
    L2_ = O["rp"] ** 2 * O["GM"] * (1 + O["e"]) / O["rp"]
    return float(2 * np.pi * (1 / np.sqrt(1 - 2 * beta / L2_) - 1))


def l3_true_coeff():
    O = G.ORBIT
    return float(2 * np.pi / (O["rp"] * O["GM"] * (1 + O["e"])))


def l3_naive(planted):
    """The paper's settings, then the leading coefficient of a quadratic fit through the origin."""
    b = np.array(L3["betas"])
    prec = np.array([l3_run(planted, x, G.ORBIT["dt"], G.ORBIT["n_orbits"]) for x in b])
    k = np.linalg.lstsq(np.vstack([b, b ** 2]).T, prec, rcond=None)[0][0]
    return {"precession_beta_0.01": float(prec[list(b).index(0.01)]), "beta_coefficient": float(k)}


def make_l3(out, planted, seed):
    G.write_text(os.path.join(out, "sim", "orbit.py"), G.orbit_code(planted))
    O = G.ORBIT
    vp = float(np.sqrt(O["GM"] * (1 + O["e"]) / O["rp"]))
    with open(os.path.join(out, "params.json"), "w") as f:
        json.dump({"GM": O["GM"], "r_periapsis": O["rp"], "v_periapsis": round(vp, 10),
                   "note": "initial speed is the Kepler (beta = 0) periapsis speed for e = 0.3, a = 1; the same initial conditions for every beta",
                   "dt": O["dt"], "n_orbits": O["n_orbits"],
                   "precession_estimator": "mean change of the periapsis angle between successive periapsis passages"}, f, indent=2)
        f.write("\n")
    G.write_text(os.path.join(out, "notes", "validate_kepler.py"), VALIDATE_KEPLER)
    drift = l3_run(planted, 0.0, 0.001, 20)
    published = l3_run(planted, 0.01, O["dt"], O["n_orbits"])
    G.write_text(os.path.join(out, "notes", "validation_2025-09-12.md"), f"""
# Integrator validation, 2025-09-12 (Jonas)

Before the precession runs for the paper I checked `sim/orbit.py` on the case
with a known answer: a Kepler orbit (beta = 0) must close, i.e. the periapsis
must not move.

- Initial conditions as in the paper: r_p = 0.7, Kepler periapsis speed for
  e = 0.3, a = 1, GM = 1.
- dt = 0.001, 20 orbits (script: `notes/validate_kepler.py`).
- Result: mean periapsis-angle drift {drift:+.1e} rad/orbit over 20 orbits.

That is far below the precessions we report (10^-2 to 10^-1 rad/orbit), so the
integrator is fine for the paper. The paper runs use dt = 0.01 to keep the
beta scan short.
""")
    G.write_text(os.path.join(out, "README.txt"), f"""
sim/orbit.py      the group's orbit integrator (kick-drift-kick leapfrog)
params.json       the settings used for the 2025 paper
notes/            Jonas's validation of the integrator (2025-09-12) and its script

2025 paper, Table 2: precession per orbit at beta = 0.01 is {published:.4f} rad/orbit
(computed with sim/orbit.py at the settings in params.json).
""")


# ── L4 activation flux: s5's dead time feeding a downstream closure ────────────
# Elemental iodine, not NaI: real NaI activation also makes 24-Na (15 h), which the pilot's generator
# left out and a careful analyst would look for. 127-I is 100 % of iodine, so 128-I is the only product.
L4 = dict(eff=0.0312, m_planted=0.423, m_clean=0.00265, M_I=126.904, sigma_b=6.2, t_irr=600.0, t_wait=240.0,
          flux=9.5e7, flux_2024=(9.5e7, 0.4e7), bkg=0.35)
N_A = 6.02214076e23


def l4_rates(mass_g):
    lam = np.log(2) / (G.DECAY["T12_min"] * 60)
    N = mass_g / L4["M_I"] * N_A
    sat = 1 - np.exp(-lam * L4["t_irr"])
    wait = np.exp(-lam * L4["t_wait"])
    A0 = N * L4["sigma_b"] * 1e-24 * L4["flux"] * sat * wait  # activity at the start of counting, Bq
    return lam, L4["eff"] * A0  # true count rate at the start of counting


def l4_flux_from(R0, lam, mass_g):
    N = mass_g / L4["M_I"] * N_A
    return float(R0 / L4["eff"] / (N * L4["sigma_b"] * 1e-24 * (1 - np.exp(-lam * L4["t_irr"])) * np.exp(-lam * L4["t_wait"])))


def l4_counts(planted, seed):
    p = G.DECAY
    mass = L4["m_planted"] if planted else L4["m_clean"]
    lam, R0 = l4_rates(mass)
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, p["minutes"] * 60.0, p["gate"])
    R = R0 * (np.exp(-lam * t) - np.exp(-lam * (t + p["gate"]))) / (lam * p["gate"]) + L4["bkg"]
    m = R / (1 + R * p["tau_dead"])  # non-paralyzable dead time, as in s5
    return t, rng.poisson(m * p["gate"])


def l4_background(seed):
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, 3600.0, G.DECAY["gate"])
    return t, rng.poisson(L4["bkg"] * G.DECAY["gate"] * np.ones(t.size))


def l4_naive(planted, seed):
    t, c = l4_counts(planted, seed)
    gate = G.DECAY["gate"]
    r = c / gate - L4["bkg"]
    ok = r > 0
    sl, ic = np.polyfit(t[ok] + gate / 2, np.log(r[ok]), 1, w=np.sqrt(np.maximum(c[ok], 1)))
    lam = -sl
    mass = L4["m_planted"] if planted else L4["m_clean"]
    return {"half_life_min": float(np.log(2) / lam / 60), "flux_n_per_cm2_s": l4_flux_from(float(np.exp(ic)), lam, mass)}


def l4_seed_report(planted, seed):
    """Is this decay record statistically ordinary under the true model? Poisson deviance p-value
    (Wilson-Hilferty, no scipy), the largest pull, and for the clean variant how far the naive
    half-life sits from 24.99 min in units of its own fit error. The design asks the clean record
    to hold no real anomaly: the pilot's clean c5 carried a 5-sigma dead-time shift."""
    import math
    t, c = l4_counts(planted, seed)
    p = G.DECAY
    mass = L4["m_planted"] if planted else L4["m_clean"]
    lam, R0 = l4_rates(mass)
    R = R0 * (np.exp(-lam * t) - np.exp(-lam * (t + p["gate"]))) / (lam * p["gate"]) + L4["bkg"]
    mu = R / (1 + R * p["tau_dead"]) * p["gate"]
    cc = np.maximum(c, 1e-12)
    dev = float(2 * np.sum(np.where(c > 0, c * np.log(cc / mu), 0.0) - (c - mu)))
    n = c.size
    z = ((dev / n) ** (1 / 3) - (1 - 2 / (9 * n))) / math.sqrt(2 / (9 * n))
    pval = 0.5 * math.erfc(z / math.sqrt(2))
    pull = float(np.max(np.abs((c - mu) / np.sqrt(mu))))
    gate = p["gate"]
    r = c / gate - L4["bkg"]
    ok = r > 0
    (sl, ic), cov = np.polyfit(t[ok] + gate / 2, np.log(r[ok]), 1, w=np.sqrt(np.maximum(c[ok], 1)), cov="unscaled")
    T = np.log(2) / -sl / 60
    sT = T * math.sqrt(cov[0, 0]) / abs(sl)
    return {"deviance_p": pval, "max_pull": pull, "naive_T12": float(T), "naive_T12_sigma": float(sT), "clean_offset_sigma": float((T - G.DECAY["T12_min"]) / sT)}


def l4_seed_ok(planted, seed):
    r = l4_seed_report(planted, seed)
    return r["deviance_p"] > 0.1 and r["max_pull"] < 3.5 and (planted or abs(r["clean_offset_sigma"]) < 1.0)


def make_l4(out, planted, seed):
    tb, cb = l4_background(seed)
    G.write_csv(os.path.join(out, "background.csv"), ["t_start_s", "counts"], [tb, cb], ["%.0f", "%d"])
    t, c = l4_counts(planted, seed + 1)
    G.write_csv(os.path.join(out, "counts.csv"), ["t_start_s", "counts"], [t, c], ["%.0f", "%d"])
    mass = L4["m_planted"] if planted else L4["m_clean"]
    f24, u24 = L4["flux_2024"]
    G.write_text(os.path.join(out, "README.txt"), f"""
Counting station 2, run 2026-10-22.
Sample: elemental iodine, {mass * 1000:.2f} mg, in a polyethylene capsule. Irradiated for
{L4['t_irr'] / 60:.0f} min in the pneumatic rabbit of the 100 W training reactor;
counting started {L4['t_wait'] / 60:.0f} min after the end of the irradiation (t_start_s = 0).
Detector: end-window Geiger-Mueller tube, sample 5 cm below the window.
Scaler: consecutive 10 s gates, counts as recorded.

background.csv: the hour before the run, sample removed, same gates.

Counting efficiency for 128-I in this geometry: {100 * L4['eff']:.2f} % (counts per
decay), calibrated 2025-03 against the gamma spectrometer.
Nuclear data: 127-I is 100 % of natural iodine; thermal (n,gamma) cross
section of 127-I: {L4['sigma_b']} b; iodine atomic mass {L4['M_I']} g/mol.
Rabbit position, thermal flux from the 2024-05 gold-foil measurement:
({f24 / 1e7:.1f} +- {u24 / 1e7:.1f}) x 10^7 n cm^-2 s^-1 at the same reactor power.
""")


# ── L5 Foucault, orthogonal: s6's rotation in two runs, g from two lengths ─────
L5 = dict(L_A=2.400, L_B=3.000, tau_A=1800.0, tau_B=2100.0, px_per_mm=0.4, cx=960.0, cy=540.0, marker_sep_mm=1001.2)


def l5_run(L, tau_d, planted, seed):
    p = G.PEND
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, p["T"], 1.0 / p["fps"])
    th0 = p["A0"] / L
    T0 = 2 * np.pi * np.sqrt(L / p["g"])
    # the period follows the decaying amplitude: T = T0 (1 + theta^2/16), theta = th0 exp(-t/tau)
    phase = 2 * np.pi / T0 * (t - th0 ** 2 / 16 * tau_d / 2 * (1 - np.exp(-2 * t / tau_d)))
    s = p["A0"] * np.exp(-t / tau_d) * np.cos(phase)
    T_true = T0
    phi = -G.OMEGA_E * np.sin(np.radians(p["lat_deg"])) * t if planted else 0.0 * t
    x = s * np.cos(phi) + p["noise"] * rng.standard_normal(t.size)
    y = s * np.sin(phi) + p["noise"] * rng.standard_normal(t.size)
    # markers on stands at bob height, 1001.2 mm apart
    m1 = (0.4120, 0.3050)
    m2 = (m1[0] - 0.8000, m1[1] - 0.6020)
    mk = lambda c: c + p["noise"] * rng.standard_normal(t.size)
    return t, x, y, (mk(m1[0]), mk(m1[1])), (mk(m2[0]), mk(m2[1])), float(T_true)


def l5_px(x_m, axis):
    """Tracker pixels: x right, y DOWN (image convention). Physical y (north, up in a right-handed
    frame seen from above) maps to decreasing pixel y, so the Foucault turn shows clockwise on screen."""
    if axis == "x":
        return x_m * 1e3 * L5["px_per_mm"] + L5["cx"]
    return L5["cy"] - x_m * 1e3 * L5["px_per_mm"]


def make_l5(out, planted, seed):
    for name, L, tau, s in (("A", L5["L_A"], L5["tau_A"], seed), ("B", L5["L_B"], L5["tau_B"], seed + 1)):
        t, x, y, m1, m2, _ = l5_run(L, tau, planted, s)
        G.write_csv(os.path.join(out, f"run_{name}.csv"), ["t_s", "bob_x_px", "bob_y_px", "m1_x_px", "m1_y_px", "m2_x_px", "m2_y_px"],
                    [t, l5_px(x, "x"), l5_px(y, "y"), l5_px(m1[0], "x"), l5_px(m1[1], "y"), l5_px(m2[0], "x"), l5_px(m2[1], "y")],
                    ["%.2f"] + ["%.3f"] * 6)
    G.write_text(os.path.join(out, "README.txt"), f"""
Long pendulum, teaching hall, Garching (48.25 N, 11.65 E). Bob: 5 kg brass
sphere. Run A 2026-10-17 21:00-22:00, length pivot to bob centre 2.400 m;
run B 2026-10-18 21:00-22:00 after lengthening the wire, 3.000 m (both lengths
+- 2 mm from the same tape; the pivot clamp was not touched).
Each run: released at rest 150 mm from the vertical, along the camera x axis.
Camera: on a mount hanging from the ceiling, looking straight down, 10 frames/s;
for run B the mount was lowered by 0.60 m with the bob, so the camera-to-bob
distance is the same in both runs. Positions are tracker pixels (x to the
right, y down the image). M1 and M2 are two markers on stands, reset to the
height of the bob centre for each run, {L5['marker_sep_mm']} mm apart (tape),
tracked as references.
""")


def l5_period(L, at_release=False):
    p = G.PEND
    T0 = 2 * np.pi * np.sqrt(L / p["g"])
    return float(T0 * (1 + (p["A0"] / L) ** 2 / 16) if at_release else T0)


def l5_truth():
    """Periods: the small-amplitude T0 (also accepted: the period at release, 2.4e-4 and 1.6e-4 longer)."""
    p = G.PEND
    return {"period_A_s": l5_period(L5["L_A"]), "period_B_s": l5_period(L5["L_B"]), "decay_time_A_s": L5["tau_A"],
            "decay_time_B_s": L5["tau_B"], "g_m_per_s2": p["g"], "scale_mm_per_px": 1 / L5["px_per_mm"]}


# ── registry ──────────────────────────────────────────────────────────────────
LONG_VARIANTS = {
    "l1-loss-budget": (make_l1, True, 101),
    "l1c-loss-budget": (make_l1, False, 201),
    "l2-rod-prior": (make_l2, True, 301),
    "l3-inherited-orbit": (make_l3, True, 401),
    "l3c-inherited-orbit": (make_l3, False, 501),
    "l4-activation-flux": (make_l4, True, 603),   # seeds chosen by l4_seed_ok (counts use seed + 1)
    "l4c-activation-flux": (make_l4, False, 704),
    "l5-foucault-g": (make_l5, True, 801),
}


def extra_checks():
    """(label, ok) pairs that generate.py --check asserts besides the answer keys."""
    out = []
    for name, (make, planted, seed) in LONG_VARIANTS.items():
        if make is make_l4:
            r = l4_seed_report(planted, seed + 1)
            out.append((f"{name} decay record ordinary under the true model (deviance p {r['deviance_p']:.2f}, max pull {r['max_pull']:.2f}"
                        + ("" if planted else f", naive half-life {r['clean_offset_sigma']:+.2f} sigma from 24.99") + ")", l4_seed_ok(planted, seed + 1)))
    return out


def computed_answers(name):
    """(true, naive) per answer key, as the generator defines them."""
    make, planted, seed = LONG_VARIANTS[name]
    if make is make_l1:
        return ({"Q_int": G.RING["QA"], "b_per_mbar": L1["b"], "dfdT_Hz_per_K": L1["f_ref"] * L1["alpha"]},
                {"Q_int": l1_naive(planted, seed)["Q_int"]})
    if make is make_l2:
        k = G.ROD["kappa"]
        return ({"kappa_W_per_mK": k, "standoff_min_diameter_mm": l2_strut_mm(k), "offset_K": L2["offset_K"]}, l2_naive(planted, seed + 1))
    if make is make_l3:
        return ({"precession_beta_0.01": l3_true(0.01), "beta_coefficient": l3_true_coeff()}, l3_naive(planted))
    if make is make_l4:
        return ({"half_life_min": G.DECAY["T12_min"], "flux_n_per_cm2_s": L4["flux"], "background_cps": L4["bkg"]}, l4_naive(planted, seed + 1))
    if make is make_l5:
        return (l5_truth(), {})
    raise KeyError(name)
