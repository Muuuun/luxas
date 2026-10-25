"""Error, loss, time and sample budget of an expanded AtomX design (MACHINE.md).

Pure arithmetic over compile.expand()'s steps. The grader's half of the machine
model; the agent gets the same model in words (MACHINE.md) and has to compute
these numbers itself.
"""
import math


def step_duration_us(step, hw):
    d = hw["duration_us"]
    if step["kind"] == "1q":
        return d["global_1q"] if step["mode"] == "global" else d["local_1q"]
    if step["kind"] == "rydberg":
        return d["rydberg"]
    dist = step["distance_um"]
    return d["move_overhead"] + 2.0 * math.sqrt(dist / hw["move_acceleration_um_per_us2"])


def step_errors(step, n, hw):
    """(sum of error probabilities, sum of log(1 - p) over error events,
    sum of log(1 - p) over loss events) for one step, idle excluded."""
    e, L = hw["error"], hw["loss"]
    if step["kind"] == "1q":
        if step["mode"] == "global":
            k, p = n, e["global_1q"]
        else:
            k, p = len(step["gates"]), e["local_1q"]
        return k * p, k * math.log1p(-p), 0.0
    if step["kind"] == "rydberg":
        np_, nu = len(step["pairs"]), len(step["unpaired"])
        s = np_ * e["cz"] + nu * e["rydberg_unpaired"]
        lf = np_ * math.log1p(-e["cz"]) + nu * math.log1p(-e["rydberg_unpaired"])
        return s, lf, 2 * np_ * math.log1p(-L["cz_per_atom"])
    k = len(step["atoms"])
    return k * e["move"], k * math.log1p(-e["move"]), k * math.log1p(-L["move"])


def budget(circuit, hw):
    n, steps = circuit["n"], circuit["steps"]
    e = hw["error"]
    t2_us = hw["t2_s"] * 1e6
    durations = [step_duration_us(s, hw) for s in steps]
    tc_us = sum(durations)
    log_f = log_keep = 0.0
    cycles, cur, cur_us = [], 0.0, 0.0
    counts = {"pulses": 0, "cz": 0, "unpaired": 0, "moves": 0, "moved_atoms": 0, "global_1q": 0, "local_1q": 0}
    for s, dt in zip(steps, durations):
        err, lf, lk = step_errors(s, n, hw)
        log_f += lf
        log_keep += lk
        cur += err
        cur_us += dt
        if s["kind"] == "rydberg":
            counts["pulses"] += 1
            counts["cz"] += len(s["pairs"])
            counts["unpaired"] += len(s["unpaired"])
            cycles.append(cur + n * cur_us / t2_us)
            cur, cur_us = 0.0, 0.0
        elif s["kind"] == "move":
            counts["moves"] += 1
            counts["moved_atoms"] += len(s["atoms"])
        elif s["mode"] == "global":
            counts["global_1q"] += n
        else:
            counts["local_1q"] += len(s["gates"])
    if cycles and (cur or cur_us):
        cycles[-1] += cur + n * cur_us / t2_us   # steps after the last pulse join the last cycle
    idle = -math.expm1(-tc_us / t2_us)
    log_f += n * (math.log1p(-idle) + math.log1p(-e["prep"]) + math.log1p(-e["meas"]))
    vac = -math.expm1(-tc_us * 1e-6 / hw["vacuum_lifetime_s"])
    log_keep += n * math.log1p(-vac)
    fid, keep = math.exp(log_f), math.exp(log_keep)
    oh = hw["shot_overhead_s"]
    cycle_s = oh["prepare"] + tc_us * 1e-6 + oh["image"]
    sigma = hw["limits"]["significance_sigma"]
    kept = math.ceil(sigma ** 2 / fid ** 2)
    quantum_s = kept / keep * cycle_s
    return {
        "n": n, "circuit_us": tc_us, "fidelity": fid, "keep_probability": keep,
        "cycle_time_s": cycle_s, "kept_samples": kept, "raw_shots": kept / keep, "quantum_time_s": quantum_s,
        "errors_per_cycle_max": max(cycles) if cycles else None, "cycles": len(cycles), "counts": counts,
    }
