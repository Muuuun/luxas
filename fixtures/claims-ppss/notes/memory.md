# Memory

## Framing (2026-08-26)
- Q is GENERATIVE: "how many more atoms can we pack using PP (sin^4 theta) vs SS (isotropic) Rydberg blockade". Deliverable object = packing-density gain ratio (PP/SS atoms-per-area), as a curve vs anisotropy ratio + n, with headline at Rb n~75, Omega/2pi=10 MHz.
- Prior-art: search confirmed NO prior paper computes PP-vs-SS packing-density advantage (open edge). Building blocks established: Vermersch2015 (P/D sin^4 + magic distances), Walker2008 (S-S isotropic, 70S C6~891 GHz um^6), Wadenpfuhl2025 (sin^4 from dM=+-2 channel), Low2012 (43S C6=-2441 MHz um^6, n^11), Evered2023 (SS gate baseline 2 um/450 MHz/10 kHz cross-talk), Li2026 (SS residual-vdW spacing floor).
- Key insight (Fermi): gain ~ (C6_SS/C6_0)^(1/6) * (C6_SS/C6_PP(90))^(1/6) — blockade radius Rb ~ C6^(1/6), so packing gain is the SIXTH ROOT of the anisotropy, not the full ratio; and P-P is ~2-3x stronger than S-S at matched n, partially offsetting. Expect ~1.3-7x, not orders of magnitude.
- Structure: E1 (C6 anisotropy map, resolve theta=0 residual) -> E2 (packing optimization + density gain). E2 is TERMINAL/synthesis: consumes E1, produces deliverable directly. Single-scope question, linear pipeline, no separate E3.

## Prior project cross-check (unverified leads)
- single_photon_297nm: C6_PP(theta)~sin^4 for Rb nP3/2 stretched; anisotropy 23.6x (Vermersch Zeeman n=25), 56x (full diag n=50), ~1e6 (field-free); C6(90,n=60)=299.1 GHz um^6, n^11 -> n=75 = 3482 GHz um^6 (near-Forster); defect ~0.185 GHz at n=75. SS side NOT computed there. All [unverified] — re-derive in E1.
- Career standard (binding): curve-shaped question not answered by point values at fixed params — hence gain CURVE + headline.

## TODO
- [ ] PI plan review (mandatory gate) before first experiment dispatch.
- [ ] Dispatch E1 (background), then E2 after E1 completes.

## PI plan review (2026-08-26) — CONTINUE, 2 issues addressed
- [x] Diagonal-neighbor exclusion zone: added to plan.md E2 (full 2D pairwise cross-talk constraint incl. θ=45° diagonal neighbors where sin⁴θ=0.25; binding constraint may come from diagonal, not axis neighbor).
- [x] Corpus check: Warttmann2026 (Quantum 10, 2045: crosstalk infidelity 6.91ε², amplitude error αε, phase error βε) and Li2026 (arXiv:2608.17331: 10 μm→10.08× budget, 15 μm→0.08×) confirmed in notes/literature.md with real numbers.
- E1 dispatched (background, brain.experiment-bg-1). E2 waits for E1 results.json.


## Premise correction handling (2026-08-27)
PREMISE-ACK: E1#0 — FINAL settled value: θ=0 residual C6_PP(0°, n=60) = −10.41 GHz·μm⁶ (≈7.5% of SS C6), three methods agree 0.04% (wide-window diag −10.408, second-order sum −10.412, ARC blind 10.4±3). Anisotropy ~26–29×. The earlier ~18× and ~10⁶× were both artifacts (window truncation / degenerate-perturbation channel-miss). plan.md E2 updated. Wide-window only settled at n=60; n≠60 (incl. n=75) still ±20 GHz window.

## Disputed-quantity settlement plan (2026-08-27)
- 3 headline quantities DISPUTED. Priority order (claim_status_dispatch): run reviewer DISCRIMINATORs first.
- frontier[3] (c6_pp_theta0_60_diag, THE load-bearing one): basis convergence sweep k={2,3,5,7,10} via c6_diag_theta0_scan.py — current n_range=(58,62) NOT converged (10% gap at θ=90°). = reviewer Issue 1.
- frontier[1] (c6_ss_60): Singer n^11+QDT at n=60 (−140.3) + ARC perturbative 60S. Mild dispute (E1 −138.86 vs xval −138.42 vs blind 140±12 — all consistent).
- frontier[2] (c6_pp_theta90_60): ARC getC6perturbatively θ=90°. Mild (E1 299 vs replication 292.4 vs blind 292, xval 268).
- Reviewer Issues 2–5: honest inter-method uncertainty (not internal R⁻⁶ fit), factor-3.3 not "order-of-magnitude", propagate θ=0 spread into anisotropy (18–60), note n*^9.5 vs n^11 departure.

## Premise correction handling (E2-E5, 2026-08-27)
PREMISE-ACK: E2#0 - "0 deg almost no interaction gives ~26x denser" WRONG: settled theta=0 residual C6=-10.41 GHz um^6 (7.5% of SS C6) gives ~1.3-1.4x gain, not ~26x. Report carries ~1.3-1.4x; no downstream experiment affected.
PREMISE-ACK: E2#1 - gain is the SIXTH ROOT of the anisotropy (radii scale C6^(1/6)), not the full ratio. Report carries it; no downstream affected.
PREMISE-ACK: E2#2 - trap-limited regime is capped by the DIAGONAL neighbor (gate-pair theta=90 extent d_gate=5.47 um binds at theta~30 deg), not the optical-trap floor. Report carries it; E3 accounted for it.
PREMISE-ACK: E3#0 - the 54.7 deg magic angle zeroes ONLY the (1-3cos^2)^2 channel; total C6(54.7 deg)=+120.3 (sin^4 channel remains at 4/9). Report carries it; E4 corrected the relevant angle to ~24.3 deg.
PREMISE-ACK: E3#1 - the two-channel model admits gains over 1.6x near its 22.9 deg zero but these are unphysical (weak blockade, C8-dominated, unverified interpolation). Report carries it; E4 strong-blockade constraint accounted for it.
PREMISE-ACK: E4#0 - the dM=+-1 channel is NOT negligible (b=-22.7, 8% of c2); the zero is at ~24.0-24.7 deg (not 22.9). Report carries ~24.3 deg; E3's 22.9 corrected.
PREMISE-ACK: E4#1 - sin4_fraction=0.9999999 was an artifact (pi.C6 silently drops dM=0 and dM=+-1 channels); intermediate-angle C6 needs all 3 channels. Report carries the 3-channel model.
PREMISE-ACK: E5#0 - near the C6 zero the interaction is few-MHz at R=2.0 um (V=-2.89 MHz), NOT sub-MHz; dead zone at R=2.402 um; viable gates live at R at most 2.2 um. Report carries it; E6 accounts for the R at most 2.2 um boundary and dead zone.

## E6 dispatch (2026-08-27)
- E6 (interaction-gate packing gain) is the OPEN frontier lead. E5 found a viable C5/C8 interaction gate at R~2 um (fidelity 0.9967), which E2/E3/E4's strong-blockade (theta=90, R~5.5 um) analysis did not account for. E6 re-derives the packing gain with the real interaction-gate potential + dead zone + R at most 2.2 um boundary. Decision rule: CONFIRM ~1.35x cap, or BREAK if substantially above 1.35.

## Premise correction handling (E6, 2026-08-28)
PREMISE-ACK: E6#0 - the three-channel C6 zero (interaction-gate axis) is at theta*=24.65 deg (a=-2.60, b=-22.72, c=295.62), NOT E4's 24.3 deg (where C6=-0.51 GHz um^6 flips the gate interaction sign at R=2.0 um). E6 already used 24.65 deg; the report will carry 24.65 deg. No downstream experiment affected (experiments complete).

## FINAL HEADLINE (2026-08-28)
Answer to "how many more atoms can we pack (PP vs SS gate)": ~2x (1.98x, robust 1.95-2.11x across R in [1.5,2.2] um), via a weak-blockade C5/C8 interaction gate at the three-channel C6 zero theta*=24.65 deg. NOT the naive ~26x (which was both a wrong anisotropy estimate ~1e6 and a wrong scaling ~sixth-root), NOT the ~1.35x strong-blockade cap. Chain: E1 (~26x anisotropy, theta=0 residual -10.41) -> E2 (sixth-root ~1.35x) -> E3 (54.7 deg is channel-zero) -> E4 (true C6 zero 24.3 deg, C5/C8 floor) -> E5 (interaction gate viable, F=0.9967 at R=2 um) -> E6 (interaction gate ~2x gain). n=75 operating point is a future-work refinement (E6 computed at n=60).

## Dispute resolution (2026-08-28)
CLAIM-DISCLOSE: c6_ss_60 — C6_SS(60) = -138.86 GHz um^6 (repulsive, V=-C6/r^6 convention). The blind estimate 140 is the magnitude |C6|, agreeing to under 1% in magnitude (138.86 vs 140) but differing only in sign convention (V=+C6/r^6). Physics settled by Singer n^11 (-140.27), ARC perturbative (-141.15), full diagonalization (-138.42), and the PI DISCRIMINATOR (-139 +/- 4).
CLAIM-DISCLOSE: c6_pp_theta0_60_diag — same sign-convention class: settled value -10.41 GHz um^6 (wide-window diag -10.408, second-order sum -10.412, PI posthoc -10.4); blind 10.4 is |C6| (magnitude).
The remaining DISPUTED flags (c6_at_dm0_magic_angle, c6_diag_min_abs, c6_total_zero_angle, max_gain_over_orientation, c6_pp_theta90_60) are stale blind estimates from the superseded two-channel model / near-Forster spread, each settled by the PI's DISCRIMINATOR + posthoc estimate (126, 0.01, 24.5, 1.33, 292). Requesting non-producer countersign (DISCLOSE-OK) in the final PI review.
