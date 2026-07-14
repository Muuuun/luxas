---
domain: qec-circuits
match: stim, pymatching, sinter, surface code, syndrome, detector, circuit-level, memory experiment, logical error rate, 症候, 表面码
verified: 2026-07-13
verified-on: vm
---

# Stabilizer-circuit QEC simulation — field standard: stim + pymatching (+ sinter)

| Tool | First-use frictions | Smoke test |
|---|---|---|
| stim 1.16.0 | (1) Generated-circuit task strings are exact DSL names (`"surface_code:rotated_memory_z"`). (2) Logical-error counting needs `compile_detector_sampler()` + DETECTOR/OBSERVABLE_INCLUDE — not `compile_sampler()`. (3) Call `.detector_error_model(decompose_errors=True)` before pymatching, else non-graphlike errors fail. `search_for_undetectable_logical_errors` is the zero-detector-column audit. | `python3 -c "import stim; print(stim.Circuit.generated('surface_code:rotated_memory_z',distance=3,rounds=3,after_clifford_depolarization=0.01).detector_error_model(decompose_errors=True).num_detectors)"` |
| PyMatching 2.4.0 | (1) Needs a DECOMPOSED DEM. MWPM cannot decode qLDPC DEMs with many disconnected components — that's a decoder-fit issue, use BP+OSD (see qldpc sheet), not a reason to drop circuit-level simulation. (2) `decode` returns observable predictions, not physical corrections; `decode_batch` for 2D. | `python3 -c "import stim,pymatching,numpy as np; m=pymatching.Matching.from_detector_error_model(stim.Circuit.generated('repetition_code:memory',distance=5,rounds=5,after_clifford_depolarization=0.01).detector_error_model(decompose_errors=True)); print(m.decode(np.zeros(m.num_detectors,dtype=np.uint8)))"` |
| sinter 1.16.0 | Worker processes → driving script needs `if __name__=='__main__':`; name decoders explicitly; distinct json_metadata per run or stats merge silently. | `python3 -c "import sinter; print(sinter.__version__)"` |

Feasibility arithmetic: Stim+PyMatching does ~10⁶ shots of a d≤15 memory circuit in minutes on one core. "10¹¹ simulations, prohibitive" style estimates are usually off by 50–100× — compute shots = points × shots/point and time ONE point before rejecting.

## Known false rejections
- "Stim MC would require ~10^11 circuit simulations — computationally prohibitive" — arithmetic inflated ~50–100× (量子点-vs-中性原子 run); the sweep was 2.25×10⁹ shots, hours of CPU.

## Cross-validation control pairs
| Headline quantity | method_a | method_b | tolerance_rel |
|---|---|---|---|
| logical error rate (circuit-level) | stim + your decoder | same circuit, pymatching baseline decoder (graphlike part) — or the analytic small-p expansion p_L ≈ A·p^⌈d/2⌉ slope on the two smallest p points | 0.5 on p_L (order-of-magnitude class), 0.15 on the fitted exponent |
| detector/observable counts | stim generated circuit | hand-count from the code's stabilizer structure (n_det = rounds × checks ± boundary terms — write the formula) | exact |
| threshold estimate | your sweep fit | published threshold for the same code+noise family (cite) | 0.3 |
