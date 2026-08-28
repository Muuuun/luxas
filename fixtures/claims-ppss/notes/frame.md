# Framing

## Q: "PP vdW is sin^4 distributed; compare with SS gate; how many more atoms can we pack?"

- **Type**: generative / existence — compute a packing-density gain. No single literature number answers it; the building blocks (C6 angular dependence) are established.
- **Deliverable object**: a **density-gain ratio** (atoms/area for PP ÷ atoms/area for SS at matched operating parameters), exposed as a curve vs the anisotropy ratio / principal quantum number, with a headline value at the canonical operating point (Rb, n≈75, Ω/2π=10 MHz). The user asks "how many more atoms" — a ratio, but honestly parameter-dependent → a scan/frontier, not a bare scalar.

## Prior-art check (to be confirmed by search)
- PP vdW sin⁴ anisotropy: ALREADY established (Vermersch2014: C6(θ)=6.33sin⁴θ−0.267sin²θ+0.269 for Rb 25P3/2 |mJ|=3/2; Walker2008, Wadenpfuhl2024). SS isotropic (Low2012/Saffman2016: 43S C6=−2441 MHz·μm⁶, n¹¹).
- The OPEN edge is the *packing consequence*: does the sin⁴ anisotropy permit a denser parallel-gate array than the isotropic SS interaction, and by how much?

## Headline quantities (ship gate)
- `packing_gain_2d` — density ratio PP/SS (2D, quantization axis in-plane), at Rb n≈75, Ω/2π=10 MHz.
- `anisotropy_ratio_resolved` — C6(θ=90°)/C6(θ=0°) for the stretched nP3/2 state, resolved across treatments (field-free / Zeeman / full diagonalization).
- `c6_ss_vs_pp_ratio` — C6_SS(n) / C6_PP(θ=90°, n) at matched n (the magnitude offset that partially cancels the anisotropy gain).

## Fermi anchors (30-second estimates, to be computed rigorously by experiments)
- Blockade radius Rb = (C6/ħΩ)^(1/6) → the packing gain is the SIXTH ROOT of the anisotropy: gain ~ (C6_max/C6_0)^(1/6), NOT the full anisotropy ratio.
- SS n=75: C6 ≈ 2441·(75/43)¹¹ ≈ 1100 GHz·μm⁶ (Low2012 43S anchor, n¹¹). [estimate]
- PP n=75 θ=90°: ≈ 3482 GHz·μm⁶ (near-Förster enhanced, from adjacent project E2 n¹¹ extrapolation). [from single_photon_297nm, unverified here]
- → gain ≈ (C6_SS/C6_0)^(1/6) · (C6_SS/C6_PP(90°))^(1/6); with 56× anisotropy → ~1.3×; with 10⁶ (field-free) → ~7×. The magnitude offset (P-P ~3× stronger than S-S) costs ~0.8× in the gate direction.

## Premises
- `flat_top_beam` = given — uniform Rabi frequency over the array (RESEARCH.md: "assume it is flat-top and can be used over a relatively large region")
- `n` = 60 — principal quantum number of the Rydberg states (E1 declares it as an input)
