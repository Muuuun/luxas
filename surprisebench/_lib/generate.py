#!/usr/bin/env python3
"""Planted-surprise benches: deterministic inputs for every variant.

    python3 surprisebench/_lib/generate.py            # write <variant>/input/ for all variants
    python3 surprisebench/_lib/generate.py --check    # recompute true and naive answers, compare with oracle.json

Each task asks for a quantity X. The planted variant hides a phenomenon the
task does not mention; the clean variant (c*) is the same task without it.
The answer keys live in <variant>/oracle.json; --check keeps them in step with
this file (a key that drifts from its generator grades the wrong thing).
Design: notes/surprise-ruler-design-2026-10-22.md.
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_csv(path, header, cols, fmt):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(",".join(header) + "\n")
        for row in zip(*cols):
            f.write(",".join(fm % v for fm, v in zip(fmt, row)) + "\n")


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text.lstrip("\n"))


# ── S1 ringdown: two close modes (planted) or one (clean) ────────────────────
RING = dict(fs=10_000.0, T=8.0, fA=1000.00, QA=12_000.0, fB=1000.80, QB=30_000.0, aB=0.5, phB=0.4, noise=0.01, amp=2.0)


def ringdown(planted, seed):
    p = RING
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, p["T"], 1.0 / p["fs"])
    tau = lambda f, Q: Q / (np.pi * f)
    x = np.exp(-t / tau(p["fA"], p["QA"])) * np.cos(2 * np.pi * p["fA"] * t)
    if planted:
        x = x + p["aB"] * np.exp(-t / tau(p["fB"], p["QB"])) * np.cos(2 * np.pi * p["fB"] * t + p["phB"])
    v = p["amp"] * x + p["noise"] * p["amp"] * rng.standard_normal(t.size)
    return t, v


def ringdown_naive_q(t, v):
    """Single-exponential fit to the Hilbert envelope over the record (the naive route)."""
    # Analytic signal by FFT (scipy.signal.hilbert's method), so the check needs numpy only.
    n = v.size
    h = np.zeros(n)
    h[0] = 1.0
    h[1:(n + 1) // 2] = 2.0
    if n % 2 == 0:
        h[n // 2] = 1.0
    env = np.abs(np.fft.ifft(np.fft.fft(v) * h))
    m = (t > 0.05) & (t < t[-1] - 0.05)
    slope = np.polyfit(t[m], np.log(env[m]), 1)[0]
    return -np.pi * RING["fA"] / slope


def make_ringdown(out, planted, seed):
    t, v = ringdown(planted, seed)
    write_csv(os.path.join(out, "ringdown.csv"), ["t_s", "signal_V"], [t, v], ["%.4f", "%.5f"])
    write_text(os.path.join(out, "README.txt"), """
Torsion paddle P-7 (silicon, 300 um), ringdown run 2026-10-20 14:12.
Room temperature, 2e-7 mbar. The paddle is driven near 1 kHz by a piezo; the
drive is switched off at t = 0 and the free decay is recorded.
Readout: optical lever on a split photodiode; signal_V is proportional to the
paddle angle (small angles). Sampling 10 kHz, 8 s record, 16-bit ADC.
""")


# ── S2 orbit integrator: stale acceleration in the second half-kick (planted) ─
ORBIT = dict(GM=1.0, beta=0.01, rp=0.7, e=0.3, dt=0.01, n_orbits=20)

ORBIT_CODE = '''"""Group orbit integrator (kick-drift-kick leapfrog) for a test particle in
the potential  Phi(r) = -GM/r - beta/r**2.  Units: GM = 1 unless given.

Used for the 2025 precession paper. Typical use:

    from orbit import integrate
    t, x, y, vx, vy = integrate(r0=(0.7, 0.0), v0=(0.0, 1.3628), dt=0.01, n_steps=12566, beta=0.01)
"""
import numpy as np


def accel(x, y, beta, GM=1.0):
    r2 = x * x + y * y
    r = np.sqrt(r2)
    f = -GM / r2 - 2.0 * beta / (r2 * r)  # radial force per unit mass
    return f * x / r, f * y / r


def integrate(r0, v0, dt, n_steps, beta, GM=1.0):
    """Leapfrog (KDK). Returns arrays t, x, y, vx, vy of length n_steps + 1."""
    x, y = map(float, r0)
    vx, vy = map(float, v0)
    ax, ay = accel(x, y, beta, GM)
    out = np.empty((n_steps + 1, 5))
    out[0] = (0.0, x, y, vx, vy)
    for i in range(1, n_steps + 1):
        # half kick
        vhx = vx + 0.5 * dt * ax
        vhy = vy + 0.5 * dt * ay
        # drift
        x = x + dt * vhx
        y = y + dt * vhy
        # new acceleration
        ax_new, ay_new = accel(x, y, beta, GM)
        # half kick
        vx = vhx + 0.5 * dt * {AX}
        vy = vhy + 0.5 * dt * {AY}
        ax, ay = ax_new, ay_new
        out[i] = (i * dt, x, y, vx, vy)
    return out[:, 0], out[:, 1], out[:, 2], out[:, 3], out[:, 4]
'''


def orbit_code(planted):
    a = ("ax", "ay") if planted else ("ax_new", "ay_new")
    return ORBIT_CODE.replace("{AX}", a[0]).replace("{AY}", a[1])


def orbit_true_precession():
    p = ORBIT
    vp = np.sqrt(p["GM"] * (1 + p["e"]) / p["rp"])
    L = p["rp"] * vp
    w = np.sqrt(1 - 2 * p["beta"] / L ** 2)
    return 2 * np.pi * (1 / w - 1)


def orbit_naive_precession(planted):
    """Run the shipped integrator as the task says; precession from successive periapsis angles."""
    ns = {}
    exec(orbit_code(planted), ns)
    p = ORBIT
    vp = np.sqrt(p["GM"] * (1 + p["e"]) / p["rp"])
    n = int(p["n_orbits"] * 2 * np.pi * (p["rp"] / (1 - p["e"])) ** 1.5 / p["dt"])
    t, x, y, vx, vy = ns["integrate"]((p["rp"], 0.0), (0.0, vp), p["dt"], n, p["beta"])
    r = np.hypot(x, y)
    i = np.where((r[1:-1] < r[:-2]) & (r[1:-1] < r[2:]))[0] + 1
    ang = np.unwrap(np.arctan2(y[i], x[i]))
    return float(np.mean(np.diff(ang)))


def make_orbit(out, planted, seed):
    write_text(os.path.join(out, "sim", "orbit.py"), orbit_code(planted))
    p = ORBIT
    vp = float(np.sqrt(p["GM"] * (1 + p["e"]) / p["rp"]))
    with open(os.path.join(out, "params.json"), "w") as f:
        json.dump({"GM": p["GM"], "beta": p["beta"], "r_periapsis": p["rp"], "v_periapsis": round(vp, 10),
                   "note": "initial speed is the Kepler (beta = 0) periapsis speed for e = 0.3, a = 1",
                   "dt": p["dt"], "n_orbits": p["n_orbits"]}, f, indent=2)
        f.write("\n")


# ── S3 LC sweeps: a fixture resonance that does not tune with C (planted) ────
LC = dict(L_uH=3.23, C_pF=(100.0, 150.0, 220.0), C_stray_pF=4.7, Q=42.0, f_extra=21.94e6, Q_extra=60.0, extra_db=3.0, noise_db=0.04)


def lc_sweep(C_pF, planted, seed):
    p = LC
    rng = np.random.default_rng(seed + int(C_pF))
    f = np.linspace(1e6, 30e6, 2901)
    f0 = 1 / (2 * np.pi * np.sqrt(p["L_uH"] * 1e-6 * (C_pF + p["C_stray_pF"]) * 1e-12))
    peak = 0.5 / np.sqrt(1 + (2 * p["Q"] * (f - f0) / f0) ** 2)
    s = np.abs(peak + 1e-3)
    db = 20 * np.log10(s)
    if planted:
        db = db + p["extra_db"] / (1 + (2 * p["Q_extra"] * (f - p["f_extra"]) / p["f_extra"]) ** 2)
    db = db + p["noise_db"] * rng.standard_normal(f.size)
    return f, db, f0


def make_lc(out, planted, seed):
    for C in LC["C_pF"]:
        f, db, _ = lc_sweep(C, planted, seed)
        write_csv(os.path.join(out, f"sweep_C{int(C)}pF.csv"), ["freq_Hz", "s21_dB"], [f, db], ["%.0f", "%.3f"])
    write_text(os.path.join(out, "README.txt"), """
LC tank board rev B, bench 3, 2026-10-19. Hand-wound air-core inductor (nominal
3.2 uH) in parallel with a tuning capacitor; three capacitors measured: 100 pF,
150 pF, 220 pF (C0G, 1 %). The tank is loosely coupled to port 1 and port 2 of
the network analyzer through 1 pF capacitors.
Each file: |S21| in dB, 1-30 MHz, 2901 points, IF bandwidth 1 kHz, 0 dBm.
""")


# ── S4 rod conductivity: radiative loss from the hot end (planted) ───────────
ROD = dict(kappa=21.9, L=0.050, D=3.00e-3, eA=2.6e-5, T0=300.0, P=tuple(np.linspace(0.06, 0.84, 13)), noise_T=0.03, noise_P=0.002)
SIGMA_SB = 5.670374e-8


def rod_series(planted, seed):
    p = ROD
    rng = np.random.default_rng(seed)
    A = np.pi * p["D"] ** 2 / 4
    G = p["kappa"] * A / p["L"]
    eA = p["eA"] if planted else 0.0
    dT = []
    for P in p["P"]:
        lo, hi = 0.0, 2000.0
        for _ in range(200):
            d = (lo + hi) / 2
            if G * d + eA * SIGMA_SB * ((p["T0"] + d) ** 4 - p["T0"] ** 4) < P:
                lo = d
            else:
                hi = d
        dT.append((lo + hi) / 2)
    dT = np.array(dT)
    P_meas = np.array(p["P"]) * (1 + p["noise_P"] * rng.standard_normal(dT.size))
    Tb = p["T0"] + 0.02 * rng.standard_normal(dT.size)
    Th = Tb + dT + p["noise_T"] * rng.standard_normal(dT.size)
    return P_meas, Th, Tb


def rod_naive_kappa(P, Th, Tb):
    p = ROD
    A = np.pi * p["D"] ** 2 / 4
    d = Th - Tb
    G = np.sum(P * d) / np.sum(d * d)
    return G * p["L"] / A


def make_rod(out, planted, seed):
    P, Th, Tb = rod_series(planted, seed)
    V = np.sqrt(P * 1000.0)
    I = V / 1000.0
    write_csv(os.path.join(out, "steady_state.csv"), ["heater_V", "heater_mA", "T_hot_K", "T_base_K"],
              [V, I * 1e3, Th, Tb], ["%.4f", "%.4f", "%.3f", "%.3f"])
    write_text(os.path.join(out, "README.txt"), """
Rod conductivity rig, run 2026-10-18. Sample: commercially pure titanium,
grade 2, turned rod, diameter 3.00 mm, length 50.0 mm between the heater block
and the base clamp. Vacuum 1e-6 mbar. The base clamp is held at 300 K.
Heater: 1.000 kOhm thin-film resistor epoxied in a small copper block clamped
to the free end of the rod. Thermometers: Pt100 in the heater block (T_hot)
and in the base clamp (T_base), 4-wire. Each row is one steady state (waited
for drift < 2 mK/min).
""")


# ── S5 half-life: counter dead time (planted: high rate; clean: low rate) ────
DECAY = dict(T12_min=24.99, tau_dead=100e-6, R0_planted=8000.0, R0_clean=200.0, bkg=0.35, gate=10.0, minutes=120)


def decay_counts(planted, seed):
    p = DECAY
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, p["minutes"] * 60.0, p["gate"])
    lam = np.log(2) / (p["T12_min"] * 60)
    R0 = p["R0_planted"] if planted else p["R0_clean"]
    # rate integrated over the gate, then the counter's non-paralyzable dead time
    R = R0 * (np.exp(-lam * t) - np.exp(-lam * (t + p["gate"]))) / (lam * p["gate"]) + p["bkg"]
    m = R / (1 + R * p["tau_dead"])
    return t, rng.poisson(m * p["gate"])


def decay_naive_t12(t, c):
    p = DECAY
    r = c / p["gate"] - p["bkg"]
    ok = r > 0
    slope = np.polyfit(t[ok] + p["gate"] / 2, np.log(r[ok]), 1, w=np.sqrt(np.maximum(c[ok], 1)))[0]
    return np.log(2) / -slope / 60


def make_decay(out, planted, seed):
    t, c = decay_counts(planted, seed)
    write_csv(os.path.join(out, "counts.csv"), ["t_start_s", "counts"], [t, c], ["%.0f", "%d"])
    write_text(os.path.join(out, "README.txt"), f"""
Counting station 2, run 2026-10-21. Sample: NaI powder (0.{'50' if planted else '02'} g) activated in
the pneumatic rabbit, counted from 4 min after the end of the irradiation.
Detector: end-window Geiger-Mueller tube, sample 5 cm below the window.
Scaler: consecutive 10 s gates, counts as recorded.
Background, sample removed, measured before the run: 0.35 counts/s.
""")


# ── S6 pendulum: Foucault rotation of the swing plane (planted) ──────────────
PEND = dict(L=2.400, g=9.8076, lat_deg=48.25, A0=0.150, tau_d=1800.0, fps=10.0, T=3600.0, noise=0.3e-3)
OMEGA_E = 7.2921159e-5


def pendulum(seed):
    p = PEND
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, p["T"], 1.0 / p["fps"])
    th0 = p["A0"] / p["L"]
    w0 = np.sqrt(p["g"] / p["L"])
    T_true = 2 * np.pi / w0 * (1 + th0 ** 2 / 16)
    wf = 2 * np.pi / T_true
    amp = p["A0"] * np.exp(-t / p["tau_d"])
    s = amp * np.cos(wf * t)
    phi = -OMEGA_E * np.sin(np.radians(p["lat_deg"])) * t  # clockwise seen from above
    x = s * np.cos(phi) + p["noise"] * rng.standard_normal(t.size)
    y = s * np.sin(phi) + p["noise"] * rng.standard_normal(t.size)
    m1 = (0.412 + p["noise"] * rng.standard_normal(t.size), 0.305 + p["noise"] * rng.standard_normal(t.size))
    m2 = (-0.388 + p["noise"] * rng.standard_normal(t.size), -0.297 + p["noise"] * rng.standard_normal(t.size))
    return t, x, y, m1, m2, T_true


def make_pendulum(out, planted, seed):
    t, x, y, m1, m2, _ = pendulum(seed)
    mm = lambda a: np.asarray(a) * 1e3
    write_csv(os.path.join(out, "track.csv"), ["t_s", "bob_x_mm", "bob_y_mm", "m1_x_mm", "m1_y_mm", "m2_x_mm", "m2_y_mm"],
              [t, mm(x), mm(y), mm(m1[0]), mm(m1[1]), mm(m2[0]), mm(m2[1])], ["%.2f"] + ["%.2f"] * 6)
    write_text(os.path.join(out, "README.txt"), """
Long pendulum, teaching hall, run 2026-10-17 21:00-22:00 (hall closed).
Site: Garching, 48.25 N, 11.65 E. Length pivot to bob centre 2.400 m; bob:
5 kg brass sphere. Released at rest, 150 mm from the vertical, along the
camera x axis.
Camera: fixed to the ceiling looking straight down, 10 frames/s; positions in
mm in the camera frame after the lab's standard calibration (origin = bob at
rest). M1 and M2 are two fixed markers on the floor, tracked as references.
""")


VARIANTS = {
    "s1-ringdown": (make_ringdown, True, 11),
    "c1-ringdown": (make_ringdown, False, 12),
    "s2-orbit": (make_orbit, True, 21),
    "c2-orbit": (make_orbit, False, 22),
    "s3-lc-sweep": (make_lc, True, 31),
    "s4-rod-kappa": (make_rod, True, 41),
    "s5-halflife": (make_decay, True, 51),
    "c5-halflife": (make_decay, False, 52),
    "s6-pendulum": (make_pendulum, True, 61),
}


def all_variants():
    """The short benches here and the long-horizon projects in longproj.py."""
    import longproj
    return {**VARIANTS, **longproj.LONG_VARIANTS}


def computed_answers(name):
    """(true X, naive X) as the generator defines them."""
    if name not in VARIANTS:
        import longproj
        return longproj.computed_answers(name)
    make, planted, seed = VARIANTS[name]
    if make is make_ringdown:
        t, v = ringdown(planted, seed)
        return {"Q": RING["QA"]}, {"Q": float(ringdown_naive_q(t, v))}
    if make is make_orbit:
        return {"precession_rad_per_orbit": float(orbit_true_precession())}, {"precession_rad_per_orbit": orbit_naive_precession(planted)}
    if make is make_lc:
        f0 = {f"{int(C)}pF": float(lc_sweep(C, planted, seed)[2] / 1e6) for C in LC["C_pF"]}
        return {"f0_MHz": f0, "Q_loaded": {k: LC["Q"] for k in f0}}, {}
    if make is make_rod:
        P, Th, Tb = rod_series(planted, seed)
        return {"kappa_W_per_mK": ROD["kappa"]}, {"kappa_W_per_mK": float(rod_naive_kappa(P, Th, Tb))}
    if make is make_decay:
        t, c = decay_counts(planted, seed)
        return {"half_life_min": DECAY["T12_min"]}, {"half_life_min": float(decay_naive_t12(t, c))}
    if make is make_pendulum:
        T_true = pendulum(seed)[5]
        return {"period_s": float(T_true), "decay_time_s": PEND["tau_d"]}, {}
    raise KeyError(name)


def main():
    if "--check" in sys.argv:
        bad = 0
        for name in all_variants():
            true, naive = computed_answers(name)
            okey = json.load(open(os.path.join(ROOT, name, "oracle.json")))
            for k, v in true.items():
                want = okey["answer"][k]["true"]
                same = (abs(v - want) <= 1e-3 * abs(want)) if not isinstance(v, dict) else all(abs(v[c] - want[c]) <= 1e-3 * abs(want[c]) for c in v)
                print(f"{'ok ' if same else 'BAD'} {name} {k} true {v} (oracle {want})")
                bad += not same
            for k, v in naive.items():
                want = okey["answer"][k].get("naive")
                same = want is not None and abs(v - want) <= 0.01 * abs(want)
                print(f"{'ok ' if same else 'BAD'} {name} {k} naive {v:.6g} (oracle {want})")
                bad += not same
        import longproj
        for label, ok in longproj.extra_checks():
            print(f"{'ok ' if ok else 'BAD'} {label}")
            bad += not ok
        sys.exit(1 if bad else 0)
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, (make, planted, seed) in all_variants().items():
        if only and name not in only:
            continue
        out = os.path.join(ROOT, name, "input")
        make(out, planted, seed)
        true, naive = computed_answers(name)
        print(f"{name}: true {true} naive {naive}")


if __name__ == "__main__":
    main()
