# Language

- **Chosen**: en
- **Signals**: research_md=en, dirname=en, corpus=en
- **Rationale**: The user request is written in English and the entire literature corpus is English-language; the report targets a general technical audience.

**Deliverable object**: a packing-density gain ratio (atoms/area for PP ÷ atoms/area for SS at matched operating parameters), exposed as a curve over the interaction-anisotropy ratio and principal quantum number, with a headline value at the canonical operating point (Rb, n≈75, Ω/2π=10 MHz). The user's question "how many more atoms" is scalar-shaped at fixed parameters but honestly parameter-dependent, so the deliverable is the gain curve with a pinned headline — not a bare number.

---

### E_1: SS vs PP van der Waals interaction anisotropy at matched principal quantum number

**Question**: What are the quantitative van der Waals C6 coefficients — including angular dependence — for the two gate-relevant Rydberg pair classes, and how anisotropic is each? (i) SS: Rb nS1/2 × nS1/2 (the conventional two-photon gate state, expected isotropic); (ii) PP: Rb nP3/2 |mJ|=3/2 (stretched) × same (the single-photon 297 nm gate state, expected ∝ sin⁴θ). Critically: what is the RESIDUAL interaction along the quantization axis (θ=0°) for the stretched P state — this residual sets the tight-packing floor for the downstream packing comparison.

**Approach**:
- Compute C6 for both pair classes at matched n (scan n ≈ 40–80) using a field-standard pair-interaction code (pairinteraction and/or ARC PairStateInteractions), with degenerate perturbation theory as the production method and full pair-Hamiltonian diagonalization as the independent control.
- For the PP stretched state, compute C6(θ) at a grid of angles θ ∈ {0°, …, 90°} and decompose into angular channels (ΔM=0 → (1−3cos²θ)², ΔM=±1 → sin²θcos²θ, ΔM=±2 → sin⁴θ) following Wadenpfuhl2025; confirm sin⁴ dominance and quantify the residual constant at θ=0°.
- Benchmark: PP stretched vs Vermersch2015/Walker2008 (sin⁴θ-dominant, small residual); SS vs Low2012 (43S C6 = −2441 MHz·μm⁶) and Walker2008 (70S C6 ≈ 891 GHz·μm⁶, isotropic), with the n¹¹ scaling law (Singer/Saffman).
- Report, at matched n: C6_SS(n) (isotropic), C6_PP(θ=90°, n), C6_PP(θ=0°, n) (the residual), and the anisotropy ratio C6_PP(90°)/C6_PP(0°) under each treatment (field-free perturbative vs full diagonalization). Flag any near-Förster resonance that makes the perturbative C6 a poor design input at the operating n (e.g. n≈75).

**Architectural commitments**: none (foundation). A prior project (single_photon_297nm) reported C6_PP(θ) ∝ sin⁴θ for Rb nP3/2 stretched, with anisotropy 23.6×–56× (treatment-dependent) to ~10⁶ (field-free) — treat as an [unverified] lead to re-derive and, in particular, re-resolve the θ=0° residual.

---

### E_2: Packing-density comparison — how many more atoms for PP vs SS parallel gates

**Premise (corrected by E_1, final)**: the PP θ=0° residual is NOT negligible. Wide-energy-window full pair-Hamiltonian diagonalization gives C6_PP(0°, n=60) = −10.41 GHz·μm⁶ (≈7.5% of the SS C6 at n=60), settled by THREE independent methods to 0.04% central-value agreement (wide-window diagonalization −10.408, all-channel second-order sum −10.412, ARC blind 10.4±3). The physical anisotropy is ~26–29× (both-diagonalization 25.76 / mixed 28.74), NOT ~10⁶×, NOT ~18×. CAVEAT: the θ=0 residual is wide-window-settled ONLY at n=60; the n≠60 values in c6_pp_theta0_diagonalization_by_n still use the ±20 GHz window (n=75: −128.8 GHz·μm⁶, likely an overestimate). Plan the packing gain around ~26–29× anisotropy anchored at n=60; if the n=75 operating point is needed, either compute the wide-window θ=0 residual there or flag the gap.

**Question**: Given the SS (isotropic) and PP (∝ sin⁴θ) van der Waals interactions from E_1, how many more atoms per unit area (and per unit volume) can be packed into a parallel two-qubit Rydberg-blockade gate array using the PP gate versus the SS gate, under identical gate-fidelity and cross-talk constraints? Assume the Rydberg excitation beam is flat-top over a large region, so packing is interaction-limited (blockade + cross-talk), not beam-limited.

**Approach**:
- From E_1's C6 values, define two interaction thresholds and the corresponding angle-dependent blockade radius Rb(θ) = (C6(θ)/(k·ħΩ))^(1/6): (a) the gate threshold V_block (the gate pair must be blockaded so leakage ≤ ε_gate), and (b) the cross-talk threshold V_ct (any two atoms in DIFFERENT gate pairs must interact ≤ ε_ct). Use the field-standard conventions (Saffman2010/2016 blockade radius; Evered2023 measured inter-site cross-talk ~10 kHz; Warttmann2026/Li2026 parallel-gate crosstalk budget).
- Geometry: a 2D array with the quantization axis IN the plane; gate pairs oriented perpendicular to the quantization axis (θ=90°, the blockaded direction), and rows of gate pairs stacked along the quantization axis (θ=0°, the decoupled direction). For SS (isotropic) the same Rb applies in both in-plane directions.
- Compute the FULL 2D exclusion zone, not just nearest-axis neighbors: for every atom, the cross-talk constraint V(r_ij, θ_ij) ≤ V_ct must be enforced against ALL other atoms in different gate pairs, including DIAGONAL neighbors at intermediate angles (e.g. θ=45° where sin⁴θ = 0.25). The binding constraint on the quantization-axis spacing may come from a diagonal neighbor at sin⁴θ ≈ 0.25, NOT from the θ=0° same-column neighbor — find the densest packing subject to the full pairwise exclusion constraint, and report whether the diagonal neighbor (not the axis neighbor) sets the gain.
- Compute the densest arrangement of parallel gate pairs and the resulting atom density (atoms/area) for SS and PP, and the density-gain ratio gain = ρ_PP/ρ_SS. Also compute the 3D case (quantization axis out of plane, stacking layers in z).
- Explicitly derive/verify the scaling law: gain ∝ (C6_SS/C6_0)^(1/6) · (C6_SS/C6_PP(90°))^(1/6) — the sixth-root suppression means the gain is the SIXTH ROOT of the anisotropy, NOT the full anisotropy ratio; and the P-P gate-direction strength relative to S-S offsets part of the gain.
- Sweep the anisotropy ratio (E_1's treatment-dependent range) and n; report the density-gain curve with a headline value at the canonical operating point (Rb, n≈75, Ω/2π=10 MHz), plus the trap-spacing-limited regime where the θ=0° residual is negligible (then the quantization-axis spacing is set by the optical-trap/addressing spacing, not blockade).
- Mitigation-transfer: check whether the magic-distance mechanism (Vermersch2015: a vdW eigenstate crosses zero at a specific distance r0, decoupling nearest neighbors) can further shrink the effective θ=0°/residual interaction and raise the gain — quantitatively, or refuted with a stated reason.

**Architectural commitments**: E_1 (C6_SS(n), C6_PP(θ=90°,n), C6_PP(θ=0°,n), anisotropy ratio at matched n). These must be read from E_1's results.json, not re-derived.
