# Framing

## Q1: "analyze the fidelity and power requirement for single photon transitions via 297nm"

- **Type**: generative / analysis (compute + synthesize; no single literature number answers it).
- **Cited-answer locator**: none — this is the open edge. Partial inputs exist:
  - Manthey2014: Rb 297nm = 2×594nm SHG, 700 mW, <0.7 MHz linewidth, Ω=2π×90 kHz at n=38.
  - Saffman2016: Doppler limit for one-photon (T<5 μK for 0.9999 at 100 ns).
  - Robicheaux2021: recoil infidelity ∝ K² (297 nm ~7× worse than two-photon).
  - Pagano2022: Sr 323nm single-photon budget (decay-dominated 0.092%).
  - Shi2022: single-photon eliminates intermediate-state scattering; two-photon 2.5× smaller k-vector.
- **Derived child**: E_1 (power budget) + E_3 (fidelity error budget). Generative, requires computation.

## Q2: "whether pp vdw is angle dependent or not"

- **Type**: characterization — **ALREADY ANSWERED by literature: YES, strongly angle-dependent.**
- **Cited-answer locator**:
  - Vermersch2014 Eq.: C₆(θ) = 6.33 sin⁴θ − 0.267 sin²θ + 0.269 (h·MHz·μm⁶), Rb 25P₃/₂ m_J=3/2, ~23× anisotropy.
  - Walker2008: P/D states angle-dependent, Förster zeros; S-states isotropic.
  - Weber2016: dipole-dipole C₆ ∝ (1−3cos²θ), magic angle 54.7°.
  - Wadenpfuhl2024: angular channel decomposition, P₁/₂ and P₃/₂ C₆(θ) maps.
- **Derived child (EXTEND)**: E_2 — quantify C₆(θ) for the specific Rb nP states at the 297nm-relevant n (40–60), and determine the gate/blockade consequence (r_b(θ), magic angle, geometry selection). Not a survey write-up.
