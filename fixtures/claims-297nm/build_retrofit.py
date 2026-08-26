#!/usr/bin/env python3
"""Build fixtures/claims-297nm/retrofit from raw: the frozen single_photon_297nm project with
hand-written computed.quantities[] / verdicts[] (design §3.1), a frame.md headline set, and one
reviewer artifact carrying the §3.5 lines. Numbers are the run's own; only the declarations are
added. expected.json is the hand-derived claim table the smoke gate asserts.
"""
import json, os, shutil, io

RAW = "fixtures/claims-297nm/raw"
OUT = "fixtures/claims-297nm/retrofit"
if os.path.exists(OUT): shutil.rmtree(OUT)
shutil.copytree(RAW, OUT)

def edit(exp, fn):
    p = f"{OUT}/data/experiments/{exp}/runs/run_1/results.json"
    j = json.load(io.open(p, encoding="utf-8"))
    fn(j["computed"])
    io.open(p, "w", encoding="utf-8").write(json.dumps(j, indent=1, ensure_ascii=False))

def e1(c):
    c["quantities"] = [
        {"id": "n_at_297nm", "key": "computed.n_at_target.P32", "headline": True,
         "observable": "effective principal quantum number of Rb 5S1/2 -> nP3/2 addressed by 297.0 nm (ARC quantum defects, dimensionless)",
         "uncertainty": 0.02, "uncertainty_source": "quantum-defect uncertainty delta(P3/2) +-2e-4 -> dn ~ 0.02"},
        {"id": "rabi_38P_khz", "key": "computed.rabi_38P_khz",
         "observable": "single-photon Rabi frequency 5S1/2 -> 38P3/2 at 7 mW, 700 um waist (kHz, peak field)",
         "uncertainty": 12, "uncertainty_source": "beam-waist +-10% -> 10%, F=1 vs F=2 ground state ~13%"},
        {"id": "d2_reduced_a0", "key": "computed.d2_reduced_a0",
         "observable": "reduced D2 dipole matrix element <5S||r||5P3/2> (a0)", "uncertainty": 0.03},
    ]
    for x in c["cross_validation"]:
        if x["claim_key"] == "computed.rabi_38P_khz": x["sigma_b"] = 9; x["anchor"] = "literature:Manthey2014 Fig.1(b) measured line scan"
        if x["claim_key"] == "computed.d2_reduced_a0": x["sigma_b"] = 0.02; x["anchor"] = "literature:Safronova1999 Table II"

def e3(c):
    c["quantities"] = [
        {"id": "rydberg_lifetime_75P_us", "key": "computed.lifetime_75p3_2_us.T300",
         "observable": "75P3/2 lifetime at 300 K incl. blackbody (us)", "uncertainty": 11},
        {"id": "c6_75_ghz_um6", "key": "computed.c6_75_ghz_um6",
         "observable": "perturbative C6 for 75P3/2 stretched pair at theta=90 (GHz um^6), n^11 extrapolation", "uncertainty": 700},
        {"id": "blockade_leakage_10MHz", "key": "computed.ceiling.terms.blockade",
         "observable": "finite-blockade gate error eps = hbar^2 Omega^2 / (2 V^2) at Omega/2pi=10 MHz, V=C6/r^6, r=4um", "uncertainty": 2e-5,
         "inputs": {"c6_75_ghz_um6": 3482.087049633264}},
        {"id": "fidelity_10MHz", "key": "computed.ceiling.fidelity", "headline": True,
         "observable": "Bell-state fidelity from the five-channel closed-form sum at Omega/2pi=10 MHz, T=5uK, theta=90, r=4um",
         "uncertainty": 2e-4, "inputs": {"rydberg_lifetime_75P_us": 221.63565543450602, "c6_75_ghz_um6": 3482.087049633264}},
    ]

def e4(c):
    c["quantities"] = [
        {"id": "blockade_leakage_40MHz", "key": "computed.f_power.term_breakdown_T5uK_40MHz.blockade",
         "observable": "finite-blockade gate error eps = hbar^2 Omega^2/(2 V^2) at Omega/2pi=40 MHz with V = C6/r^6 = 850 MHz",
         "inputs": {"blockade_shift_4um_GHz": -0.85011962890625, "c6_75_ghz_um6": 3482.087049633264}},
        {"id": "decay_40MHz_closedform", "key": "computed.f_power.term_breakdown_T5uK_40MHz.decay",
         "observable": "Rydberg decay channel (3/4) Tbar_r gamma at 40 MHz, closed form"},
        {"id": "fidelity_40MHz", "key": "computed.f_power.term_breakdown_T5uK_40MHz.fidelity", "headline": True,
         "observable": "five-channel closed-form fidelity at Omega/2pi=40 MHz, T=5uK",
         "inputs": {"blockade_leakage_40MHz": 0.001107, "decay_40MHz_closedform": 5.2e-05}},
        {"id": "fidelity_10MHz", "key": "computed.f_theta.fidelity_at_theta90",
         "observable": "E3 ceiling fidelity reproduced through the E4 wiring (same closed form)",
         "uncertainty": 2e-4, "inputs": {"rydberg_lifetime_75P_us": 221.63565543450602, "c6_75_ghz_um6": 3482.087049633264}},
    ]
    c["verdicts"] = [{"id": "ordering_f40_vs_f10", "reads": ["fidelity_40MHz", "fidelity_10MHz", "decay_40MHz_closedform"]}]

def e5(c):
    c["quantities"] = [
        {"id": "blockade_shift_4um_GHz", "key": "computed.pair_potential.v_4um_ghz",
         "observable": "energy shift of the |rr>-connected pair eigenstate at R=4um, theta=90 from full pair-Hamiltonian diagonalization (GHz)",
         "uncertainty": 0.015, "uncertainty_source": "pair-basis truncation (n 72-78, l<=2) ~10%",
         "inputs": {"forster_defect_GHz": 0.185}},
        {"id": "c6_75_ghz_um6", "key": "computed.pair_potential.c6_tail_ghz_um6",
         "observable": "R^-6 tail coefficient fitted to the full diagonalization for R>=8um (GHz um^6)", "uncertainty": 300},
        {"id": "blockade_leakage_40MHz", "key": "computed.master_equation.leakage_40MHz",
         "observable": "population outside |gg> after the pulse, evolving |gg> under sesolve over the reduced pair basis; no |gr> branch, no conditional phase",
         "uncertainty": 5e-5, "uncertainty_source": "V(4um) +-10% propagated as 2 dV/V",
         "limit_check": {"limit": "V -> 10 GHz", "expected": 0, "observed": 3e-9, "artifact": "scripts/blockade_gate_master.py"},
         "inputs": {"blockade_shift_4um_GHz": -0.151863, "rydberg_lifetime_75P_us": 221.64}},
    ]

def e6(c):
    c["quantities"] = [
        {"id": "decay_40MHz_ME", "key": "computed.corrected_frontier.anchor_points.40.terms.decay",
         "observable": "Rydberg decay channel at 40 MHz from the E5 master equation"},
        {"id": "blockade_leakage_10MHz", "key": "computed.corrected_frontier.anchor_points.10.terms.leakage",
         "observable": "E5 master-equation population non-return at 10 MHz, substituted into the 10 MHz budget",
         "uncertainty": 2e-7, "inputs": {"blockade_shift_4um_GHz": -0.151863}},
        {"id": "fidelity_40MHz", "key": "computed.corrected_frontier.ordering.f40", "headline": True,
         "observable": "corrected five-channel fidelity at 40 MHz with E5 leakage and decay folded in",
         "uncertainty": 6e-5, "inputs": {"blockade_leakage_40MHz": 0.0002555024352332, "decay_40MHz_ME": 3.259892649021268e-05}},
        {"id": "fidelity_10MHz", "key": "computed.corrected_frontier.ordering.f10", "headline": True,
         "observable": "corrected five-channel fidelity at 10 MHz", "uncertainty": 6e-5,
         "inputs": {"blockade_leakage_10MHz": 9.593711042255038e-07}},
    ]
    c["verdicts"] = [{"id": "ordering_f40_vs_f10", "reads": ["fidelity_40MHz", "fidelity_10MHz", "decay_40MHz_ME"]}]

edit("E1_transition_strength_power", e1)
edit("E3_gate_fidelity_budget", e3)
edit("E4_synthesis_fidelity_frontier", e4)
edit("E5_blockade_floor_master_equation", e5)
edit("E6_corrected_fidelity_frontier", e6)

fm = f"{OUT}/notes/frame.md"
io.open(fm, "a", encoding="utf-8").write("\n## Headline quantities\n\n- `n_at_297nm`\n- `fidelity_10MHz`\n- `fidelity_40MHz`\n- `ordering_f40_vs_f10`\n")

io.open(f"{OUT}/reviews/experiment_review_E5.md", "w", encoding="utf-8").write("""# experiment_reviewer — E5 (retrofit fixture; lines per design §3.5)

DISCRIMINATOR: blockade_leakage_40MHz — if right: leakage scales as Omega^2 and matches (Omega/2V)^2 within 3x at V=-152 MHz; if wrong: exponent ~4 and 100x below the closed form; computation: two-branch symmetric gate with conditional phase at V=-152 MHz, check eps ~ hbar^2 Omega^2/2V^2 in the V >> Omega limit
ESTIMATE(blind): blockade_leakage_40MHz — 1.7e-2 ± 5e-3 via (Omega/2V)^2 with V=152 MHz — inputs: [blockade_shift_4um_GHz=-0.152]
SCALING: blockade_leakage_40MHz — expected 2 in Omega; observed 4.03 from runs/run_1/data/master_fidelity_vs_omega.csv
INDEPENDENT: rabi_38P_khz E1:own vs E1:xval — computed dipole + beam formula vs a measured line scan
INDEPENDENT: c6_75_ghz_um6 E3:own vs E5:own — n^11 extrapolation of perturbative C6 vs R^-6 tail fit of a full diagonalization
""")

expected = {
    "n_at_297nm": "indicative",
    "rabi_38P_khz": "corroborated",
    "d2_reduced_a0": "corroborated",
    "rydberg_lifetime_75P_us": "indicative",
    "c6_75_ghz_um6": "converging",
    "blockade_shift_4um_GHz": "disputed",
    "blockade_leakage_10MHz": "disputed",
    "blockade_leakage_40MHz": "disputed",
    "decay_40MHz_closedform": "indicative",
    "decay_40MHz_ME": "indicative",
    "fidelity_10MHz": "conditional",
    "fidelity_40MHz": "conditional",
}
io.open(f"{OUT}/expected.json", "w", encoding="utf-8").write(json.dumps({
    "rows": expected,
    "verdicts": {"ordering_f40_vs_f10": "conditional"},
    "headline": ["blockade_leakage_10MHz", "blockade_leakage_40MHz", "blockade_shift_4um_GHz", "c6_75_ghz_um6", "decay_40MHz_ME", "decay_40MHz_closedform", "fidelity_10MHz", "fidelity_40MHz", "n_at_297nm", "ordering_f40_vs_f10", "rydberg_lifetime_75P_us"],
    "readsDrops": 1,
}, indent=1))
print("retrofit fixture written to", OUT)
