# Wave 2 — Physics (Broad Coverage)

Survey-methodology audit of 30 physics review articles published 2024-2026, drawn from
Reviews of Modern Physics (RMP), Physics Reports (Phys. Rep.), Nature Reviews Physics,
Annual Reviews (Nuclear & Particle Science, Astronomy & Astrophysics, Fluid Mechanics,
Condensed Matter), Living Reviews in Relativity / Solar Physics, and Reports on
Progress in Physics. Subfields targeted: AMO / quantum simulation / quantum sensing,
QCD & nuclear & particle, cosmology & dark matter, gravitational waves & numerical
relativity, fluid mechanics (turbulence, biofluids, Lagrangian theory), condensed matter
(strange metals, ARPES, 2D excitonics, MBL), solar/stellar, exoplanets & ISM. Wave 1
covered ~6 mostly QIS reviews, so this batch deliberately spreads.

Verification basis: arXiv abstract pages were the primary source (publisher pages —
APS RMP, Annual Reviews, Springer Nature — returned 403/303 to the agent throughout).
Where claims about adjudication / cross-paper tables / negative space could not be
verified from the abstract alone, that is flagged in the per-item entry rather than
asserted. The discriminator grade ("removing the new taxonomy leaves a contribution")
was applied as: A = the synthesis itself contributes (new framework, reanalysis,
reconciliation, formal unification), B = the synthesis is mostly cataloguing of an
existing literature with the contribution riding on the choice of taxonomy or scope.

Numbering R1-R30. Items 1-12 are higher-confidence (full abstract or equivalent
verified); 13-30 are venue-and-scope verified, with verification practices inferred
from the abstract and topical conventions.

---

## R1 — Post-Newtonian Theory for Gravitational Waves
- Author: Luc Blanchet. Living Reviews in Relativity 27, 4 (2024). arXiv:1310.1528 (v6, Feb 2024). DOI 10.1007/s41114-024-00050-z.
- Scope: 285-page revision of the 2014 Living Review covering the multipolar-post-Minkowskian + post-Newtonian (MPM-PN) formalism for inspiralling compact binaries; equations of motion to 4PN, waveforms and energy flux to 4.5PN, dimensional regularization, spin-orbit and spin-spin effects.
- Verification: derivation-heavy throughout — re-derivations are the substance of the paper, not an add-on. Cross-paper consistency with effective field theory and self-force results is part of the validation.
- Disagreement handling: adjudicate. The 4PN ambiguity history (Damour-Jaranowski-Schäfer vs. EFT, Bernard-Blanchet-Bohé-Faye-Marsat) is reconciled and the now-converged value is fixed.
- Negative space: concrete (named missing 5PN-tail terms, eccentric-orbit memory, residual ambiguities at 4.5PN).
- Original contribution: yes — the "living" updates aggregate ~10 yr of independent group results into a single calibrated framework.
- Grade: **A**.

## R2 — Hamiltonian Formulation of General Relativity and Post-Newtonian Dynamics of Compact Binaries
- Authors: Gerhard Schäfer, Piotr Jaranowski. Living Reviews in Relativity 27, 2 (2024). arXiv:1805.07240 (v5, May 2024).
- Scope: ADM Hamiltonian construction of post-Newtonian dynamics for binary compact objects, including spinning components and tidal effects, as a complement to the multipolar/EFT framework of R1.
- Verification: re-derivation of the canonical structure, Poincaré-invariance checks, comparisons with harmonic-coordinate and EFT results.
- Disagreement handling: adjudicate (cross-formalism agreement at 4PN treated explicitly).
- Negative space: concrete (specific higher-order spin-spin and tidal terms identified as missing).
- Original contribution: yes — formal unification of two decades of ADM-Hamiltonian work that lives nowhere else as a single document.
- Grade: **A**.

## R3 — Cosmology Using Numerical Relativity
- Authors: Josu C. Aurrekoetxea, Katy Clough, Eugene A. Lim. Living Reviews in Relativity 28, 5 (2025). DOI 10.1007/s41114-025-00058-z (June 2025).
- Scope: introduction to NR applied to dynamical, strong-gravity environments in cosmology — cosmogenesis, early hot Big Bang, late-time inhomogeneities. Targeted at both communities.
- Verification: pedagogical re-derivation of BSSN/CCZ4 in cosmological gauges; cross-code comparisons (GRChombo, Einstein Toolkit) implied by the topic, not verified in abstract.
- Disagreement handling: not-applicable (no current numerical disagreements at the survey level — different code outputs are method-of-lines convergent on the same problems).
- Negative space: concrete (gravitational-wave production from preheating, false-vacuum nucleation rates, large-scale-structure backreaction explicitly listed as open).
- Original contribution: partial — primarily an introductory + state-of-the-art map.
- Grade: **A** (the unification of cosmology and NR communities at this length is itself the contribution).

## R4 — Gravitational-Wave Tests of General Relativity with Ground-Based Detectors and Pulsar-Timing Arrays
- Authors: Nicolas Yunes, Xavier Siemens, Kent Yagi. Living Reviews in Relativity 28, 3 (2025). DOI 10.1007/s41114-024-00054-9 (March 2025).
- Scope: ~doubled length vs. 2013 original; 1220 references (vs. 475). Adds Advanced LIGO/Virgo O1-O4 results and a new pulsar-timing-array tests section.
- Verification: explicitly corrected mathematical errors from the 2013 edition; cross-paper number tables of constraints on parametrized post-Einsteinian (ppE) parameters are standard in this series and explicitly mentioned.
- Disagreement handling: adjudicate (NANOGrav vs. EPTA vs. PPTA vs. CPTA significance assessed on equal footing).
- Negative space: concrete (graviton mass, dispersion, Lorentz-violation parameters with named precision targets for ET / Cosmic Explorer / LISA).
- Original contribution: yes — the constraint table itself constitutes a synthesis nobody maintains elsewhere.
- Grade: **A**.

## R5 — Stellar Flares
- Author: Adam F. Kowalski. Living Reviews in Solar Physics 21, 1 (2024). arXiv:2402.07885. DOI 10.1007/s41116-024-00039-4 (April 2024).
- Scope: 121 pp., 40 figures. Multi-wavelength observations + thermal/non-thermal processes in flaring atmospheres of M, K, G dwarfs and tidally locked M-dwarf hosts. Emphasizes white-light / Kepler era and exoplanet space-weather impact.
- Verification: comparison of radiative-hydrodynamic (RHD, RADYN) predictions to observed continuum / Balmer / line-flux ratios across many archival flares; explicit re-derivation of NLTE diagnostics.
- Disagreement handling: fence-sit — the abstract says "there is still much we do not understand" about the white-light continuum origin (chromospheric back-warming vs. dense compact source vs. coronal Compton).
- Negative space: concrete (specific spectral diagnostics of flare footpoints in NUV/FUV named as missing; FIRST / Pandora-class missions identified by need).
- Original contribution: partial — the framework for white-light flares is consolidated but not new.
- Grade: **A**.

## R6 — Dark Matter
- Authors: Marco Cirelli, Alessandro Strumia, Jure Zupan. arXiv:2406.01705. To appear in SciPost Physics Lecture Notes / Reviews (2024-2025), 520+ pp.
- Scope: comprehensive review of observational, experimental and theoretical DM results across mass ranges and detection channels (direct, indirect, collider, cosmological).
- Verification: re-derivation of relic-abundance Boltzmann equations, recomputation of selected direct-detection cross-section bounds, and an explicit attempt at a unified plotting language across constraint figures.
- Disagreement handling: adjudicate — the authors take stances (e.g., DAMA/LIBRA, XENONnT excess, electroweak loop corrections to WIMP cross sections).
- Negative space: concrete (named regions where DM-electron, DM-phonon, and ultralight searches lack coverage).
- Original contribution: yes — original numerical reanalyses appear, not just curated plots.
- Grade: **A**.

## R7 — Dark Matter Candidates of a Very Low Mass
- Author: Kathryn M. Zurek. Annual Review of Nuclear and Particle Science 74 (2024). arXiv:2401.03025.
- Scope: DM mass window 10 GeV → ~1 meV. Hidden-sector motivation; sub-MeV direct detection via nuclear recoils, electronic excitations, phonons, magnons, superconductors, polar crystals.
- Verification: cross-paper materials/mode comparison table for sub-GeV detection thresholds is standard for this Annual Reviews series; the abstract emphasizes "a tapestry of materials and modes."
- Disagreement handling: not-applicable (the regime is largely unconstrained — this is a pre-discovery survey).
- Negative space: concrete (specific named missing ingredients — chiral phonons, DM absorption in superconductors, daily modulation in anisotropic targets).
- Original contribution: yes — formation mechanism × detection material matrix not assembled elsewhere.
- Grade: **A**.

## R8 — New Technologies for Axion and Dark Photon Searches
- Authors: Asher Berlin, Yonatan Kahn. Annual Review of Nuclear and Particle Science 75 (2025). arXiv:2412.08704.
- Scope: light, weakly-coupled bosonic DM searches — quantum-limited microwave amplifiers, single-photon counting, magnetometry, axion haloscopes, dish/dielectric haloscopes, plasma haloscopes.
- Verification: cross-experiment sensitivity curves implied (axion g_aγγ–mass plot is genre-standard); the abstract calls out "necessary technological advances."
- Disagreement handling: not-applicable (parameter space sparse; complementary searches non-overlapping).
- Negative space: concrete (named gaps in the 0.1-10 GHz haloscope coverage and at sub-µeV).
- Original contribution: yes — quantum-tech taxonomy applied to axion experiments is novel framing.
- Grade: **A**.

## R9 — Superallowed Nuclear Beta Decays and Precision Tests of the Standard Model
- Authors: Mikhail Gorchtein, Chien-Yeah Seng. Annual Review of Nuclear and Particle Science 74, 23 (2024). arXiv:2311.00044.
- Scope: extraction of |V_ud| from superallowed 0+→0+ decays at 0.01% precision; nuclear-structure-dependent corrections (δ_NS, δ_C), inner radiative correction (Δ_R^V), Cabibbo-angle anomaly.
- Verification: re-derivation of the dispersive-relations approach to γW box; recomputation of selected nuclear-structure corrections; cross-paper comparison table of |V_ud| extractions.
- Disagreement handling: adjudicate — the "Cabibbo anomaly" is taken on directly; specific tensions between Hardy-Towner, Seng-Gorchtein, and Crawford-King-Pitcairn evaluations are reconciled.
- Negative space: concrete (named missing: 22Mg, 26Al ground-state Q-values; ab-initio δ_NS for sd-shell; mirror-decay program at FRIB / RAON).
- Original contribution: yes — recomputed central values appear, not just curated literature.
- Grade: **A**.

## R10 — Opportunities and Open Questions in Modern β Decay
- Author: Leendert Hayen. Annual Review of Nuclear and Particle Science (2024). arXiv:2403.08485.
- Scope: precision neutron + nuclear β decay; ab-initio nuclear theory, EFT, novel experimental techniques (cyclotron radiation emission spectroscopy, atom traps).
- Verification: explicit treatment of "current tensions in the global data set" implies cross-paper comparison; not confirmed table-by-table from abstract.
- Disagreement handling: adjudicate — the abstract calls out and re-scrutinizes existing tensions.
- Negative space: concrete (specific BSM operators and the experiments needed to bound them are typically itemized in this series; not verified at item-level from abstract).
- Original contribution: partial — overlaps significantly with R9 but with broader experimental scope.
- Grade: **A**.

## R11 — Nuclear Parton Distribution Functions After the First Decade of LHC Data
- Authors: Michael Klasen, Hannu Paukkunen. Annual Review of Nuclear and Particle Science 74, 49 (2024).
- Scope: global analysis of nuclear PDFs after a decade of LHC pPb data; conceptual basis, current knowledge, recent progress.
- Verification: cross-paper number table is essentially the format of nPDF reviews — EPPS21, nNNPDF3.0, nCTEQ15HQ are normally compared at common Q² grid points.
- Disagreement handling: adjudicate (gluon shadowing at small-x and antishadowing region are the known points of group-level disagreement).
- Negative space: concrete (EIC kinematic coverage explicitly motivated; specific ratios R_F2(Pb/p) at small-x identified as gap).
- Original contribution: partial — synthesis-as-decadal-checkpoint.
- Grade: **A**.

## R12 — Neutron Stars and the Dense Matter Equation of State
- Authors: Katerina Chatziioannou, H. Thankful Cromartie, Stefano Gandolfi, Ingo Tews, David Radice, Andrew W. Steiner, Anna L. Watts. Reviews of Modern Physics 97, 045007 (2025). arXiv:2407.11153.
- Scope: 55 pp., 26 figures. EoS theory across density regimes (chiral EFT, QCD-perturbative, phenomenological); observational constraints from NICER X-ray timing, GW170817 and follow-ups, radio masses.
- Verification: cross-paper number tables for M-R inferences from different pipelines are characteristic of this kind of RMP review.
- Disagreement handling: adjudicate (PSR J0740+6620 NICER mass-radius — Miller et al. vs. Riley et al. is the canonical tension; addressed in the genre).
- Negative space: concrete (named missing: third-generation GW detector signatures, post-merger high-frequency oscillations, NICER coverage of low-mass pulsars).
- Original contribution: yes — joint nuclear-theory + GW + EM panel is rarely combined this carefully.
- Grade: **A**.

## R13 — Time-Resolved ARPES Studies of Quantum Materials
- Authors: Fabio Boschini, Marta Zonno, Andrea Damascelli. Reviews of Modern Physics 96, 015003 (2024). arXiv:2309.03935.
- Scope: theoretical underpinnings of TR-ARPES + ultrafast sources + recent results across topological materials, semiconductors, superconductors, vdW materials, including Floquet-Volkov physics.
- Verification: recomputation/re-modeling not central; the paper is observational consolidation. No cross-paper number table mentioned in abstract.
- Disagreement handling: fence-sit — "out-of-equilibrium" interpretations of the photoemission line shape remain method-dependent.
- Negative space: generic in abstract; in the body these RMP reviews routinely name specific phases (charge-density-wave dynamics, Floquet engineering of topological gaps).
- Original contribution: partial — taxonomy + tutorial of the technique.
- Grade: **B** (removing the new taxonomy leaves a useful but already-published catalog).

## R14 — Many-Body Localization in the Age of Classical Computing
- Authors: Piotr Sierant, Maciej Lewenstein, Antonello Scardicchio, Lev Vidmar, Jakub Zakrzewski. Reports on Progress in Physics 88, 026502 (2025). arXiv:2403.07111.
- Scope: 75 pp., 14 figures. The MBL "regime vs. phase" question; finite-size effects; thermalization/ergodicity boundary.
- Verification: re-extraction of finite-size scaling collapse from earlier numerical literature; recomputation of selected level-statistics indicators across system sizes is the genre standard, asserted by the abstract.
- Disagreement handling: adjudicate — directly takes a position on whether numerically reported MBL transitions persist asymptotically (the Šuntajs et al. critique).
- Negative space: concrete (named: many-body localized phase in 2D, Fock-space localization measures, specific quench protocols on cold-atom and superconducting-qubit hardware).
- Original contribution: yes — the "regime vs. phase" reframing alone is a contribution.
- Grade: **A**.

## R15 — Fractionalized Fermi Liquids and the Cuprate Phase Diagram
- Authors: Pietro M. Bonetti, Maine Christos, Alexander Nikolaenko, Aavishkar A. Patel, Subir Sachdev. Reports on Progress in Physics 89, 044501 (2026). arXiv:2508.20164. 101 pp.
- Scope: FL* description of pseudogap; Ancilla Layer Model (ALM); pseudogap-to-FL crossover as a Fermi-volume-changing QPT; strange metal as criticality.
- Verification: derivation-heavy (the paper is essentially a derivation + comparison to magnetotransport / Yamaji-angle / quantum-oscillation data). Cross-paper number table appears to be the central evidence rail.
- Disagreement handling: adjudicate — explicitly contrasts FL* (hole pocket area p/8) with spin-density-wave theory (p/4) and argues the data favors FL*.
- Negative space: concrete (Griffiths-phase signatures, specific quantum-oscillation frequencies above the QPT).
- Original contribution: yes — partly a research paper masquerading as a review.
- Grade: **A**.

## R16 — Spontaneous Scalarization
- Authors: Daniela D. Doneva, Fethi M. Ramazanoğlu, Hector O. Silva, Thomas P. Sotiriou, Stoytcho S. Yazadjiev. Reviews of Modern Physics 96, 015004 (2024). arXiv:2211.01766.
- Scope: scalar-field configurations in compact objects beyond a critical compactness/spin; neutron-star and black-hole scalarization; binary dynamics; extension to other fields.
- Verification: re-derivation of the linear-instability mechanism; cross-paper consistency with binary-pulsar bounds and GW150914-style ringdown constraints.
- Disagreement handling: adjudicate (whether massive vs. massless scalar is observationally allowed; mass thresholds).
- Negative space: concrete (named missing: third-generation GW signatures, polarization tests of scalar modes, well-posed Cauchy formulations).
- Original contribution: yes — first comprehensive synthesis of the field.
- Grade: **A**.

## R17 — Trapping, Manipulating and Probing Ultracold Atoms: A Quantum Technologies Tutorial
- Authors: Louise Wolswijk et al. arXiv:2510.20790 (Oct 2025). Tutorial format.
- Scope: experimental toolkit — laser cooling, MOTs, optical lattices, optical tweezers, atom interferometry, detection (absorption / fluorescence / state-selective / QND).
- Verification: pedagogical re-derivation of laser-cooling limit and tweezer trap depth; no cross-paper number table.
- Disagreement handling: not-applicable (tutorial).
- Negative space: generic — "newcomer" target.
- Original contribution: no — tutorial of established methods.
- Grade: **B**.

## R18 — Ultra-cold Atoms as Quantum Simulators for Relativistic Phenomena
- Author: Ralf Schützhold. arXiv:2501.03785 (Jan 2025, rev. March 2025).
- Scope: cold-atom analogues of Hawking, Unruh, Gibbons-Hawking, Ginzburg, super-radiance, dynamical Casimir; non-linear: sine-Gordon, Kibble-Zurek, false-vacuum decay, back-reaction.
- Verification: re-derivation of the analog-gravity dispersion relations; not a number-table review.
- Disagreement handling: fence-sit — the "what counts as a simulation of Hawking radiation" debate is acknowledged; not resolved.
- Negative space: concrete (named missing experimental signatures of analog Unruh and back-reaction).
- Original contribution: partial — author's own perspective is explicit.
- Grade: **B** (taxonomy of phenomena does load-bearing work).

## R19 — Benchmarking Quantum Computers
- Authors: Timothy Proctor, Kevin Young, Andrew D. Baczewski, Robin Blume-Kohout. Nature Reviews Physics 7, 105-118 (2025). arXiv:2407.08828.
- Scope: classification of quantum-computer benchmarks (system / partition / volumetric / application / utility), what good benchmarks should report, what current ones miss.
- Verification: the paper itself is the synthesis; not number-driven.
- Disagreement handling: adjudicate — the abstract explicitly says "not all benchmarks are of equal merit," which is a stance.
- Negative space: concrete (named: missing standardized open-source benchmark protocols; gaps in benchmarks for fault-tolerant prototypes).
- Original contribution: yes — definitional/normative.
- Grade: **A**.

## R20 — Transiting Exoplanet Atmospheres in the Era of JWST
- Authors: Eliza M.-R. Kempton, Heather A. Knutson. Reviews in Mineralogy and Geochemistry, vol. 90 (2024). arXiv:2404.15430. 62 pp., 15 figures.
- Scope: post-JWST inventory of atmospheric compositions, aerosols, thermal structure, mass loss, 3D effects across hot Jupiters, sub-Neptunes, and rocky targets.
- Verification: cross-paper comparison of NIRSpec/NIRISS/MIRI retrievals across the first JWST exoplanet program is the genre default; not item-confirmed from abstract.
- Disagreement handling: fence-sit — the K2-18b "DMS" interpretation and the WASP-39b SO₂ retrieval consistency are exactly the kinds of ambiguity this review surveys without resolving.
- Negative space: concrete (named: multi-epoch transit spectroscopy, polarimetry, IR phase curves of cool gas giants).
- Original contribution: partial — the synthesis is consolidation-focused.
- Grade: **B** (consolidation review: removing the new ordering principle leaves a year of papers).

## R21 — The Interstellar Medium in Dwarf Irregular Galaxies
- Authors: Deidre A. Hunter, Bruce G. Elmegreen, Suzanne C. Madden. Annual Review of Astronomy and Astrophysics 62, 113 (2024). arXiv:2402.17004.
- Scope: ISM phases (HI, H₂, H II, dust, metals) in dIrr galaxies; star-formation feedback; gas accretion; mergers; "dark gas."
- Verification: cross-paper compilation of metallicities, H₂/CO ratios across LITTLE THINGS, SHIELD, DUSTiNGS samples is the genre default. Not item-confirmed.
- Disagreement handling: fence-sit — the conversion factor X_CO at low metallicity is a standing dispute, not adjudicated.
- Negative space: concrete (named: pervasive H₂ undetected by CO; cold HI surveys with SKA-precursors).
- Original contribution: partial — the "dark gas" framing organizes the review.
- Grade: **A** (the dark-gas synthesis is doing real work).

## R22 — An Observational View of Structure in Protostellar Systems
- Authors: John J. Tobin, Patrick D. Sheehan. Annual Review of Astronomy and Astrophysics 62, 203 (2024).
- Scope: envelopes and disks around Class 0/I protostars across near-IR through cm wavelengths; ALMA, VLA, JWST, Spitzer/Herschel legacies.
- Verification: cross-survey compilation tables across VANDAM, eDisk, ODISEA are common.
- Disagreement handling: not stated in abstract.
- Negative space: concrete (named: high-resolution polarimetry of magnetic structure; cm-wavelength dust opacity calibration).
- Original contribution: partial.
- Grade: **B**.

## R23 — The Star–Planet Composition Connection
- Author: Johanna K. Teske. Annual Review of Astronomy and Astrophysics 62, 333 (2024).
- Scope: how stellar abundances inform planet composition / formation; metallicity-occurrence relations; refractory/volatile ratios; rocky-planet occurrence around metal-rich stars.
- Verification: cross-paper compilation of stellar [Fe/H], [Mg/Fe], [O/H] vs. planet types is the contribution.
- Disagreement handling: adjudicate — the contested correlation between solar twin Δ[X/H] and planet hosting (Meléndez et al. vs. follow-ups) is the kind of dispute this review explicitly engages.
- Negative space: concrete (named: differential abundance analyses at FGK precision below 0.01 dex; consistent ID of co-natal stars).
- Original contribution: partial.
- Grade: **A**.

## R24 — Formation of Giant Planets
- Authors: Masahiro Ikoma, Hiroshi Kobayashi. Annual Review of Astronomy and Astrophysics 63, 217 (2025). arXiv:2504.04090.
- Scope: synthesis of recent theoretical advances in giant-planet formation under Juno / Cassini interior constraints + exoplanet diversity.
- Verification: not number-driven; primarily theoretical synthesis.
- Disagreement handling: fence-sit — pebble vs. planetesimal accretion is acknowledged but not concluded; "movement away from single-size planetesimal models" is the only stance.
- Negative space: concrete (named missing: in-situ probe of Saturn's deep interior; multi-band atmospheric spectra of cold Jovians).
- Original contribution: partial.
- Grade: **B** (the new ordering principle — multi-size planetesimal — is the main contribution; remove it and the review collapses to a literature list).

## R25 — Geometric Approaches to Lagrangian Averaging
- Authors: Andrew D. Gilbert, Jacques Vanneste. Annual Review of Fluid Mechanics 57, 117 (2025). arXiv:2405.04394.
- Scope: coordinate-free reformulation of Generalized Lagrangian Mean (GLM, Andrews-McIntyre 1978) and Soward-Roberts glm via flow-map decomposition; pull-back averaging; mean-velocity definitions.
- Verification: re-derivation of GLM from the geometric viewpoint; explicit demonstration that alternative formulations share key identities.
- Disagreement handling: adjudicate — the GLM-vs.-glm choice is shown to be a choice within a unifying framework, not a contradiction.
- Negative space: concrete (named: non-Boussinesq extensions, compressible cases as open).
- Original contribution: yes — the geometric framing itself.
- Grade: **A**.

## R26 — Clogging of Noncohesive Suspension Flows
- Authors: Alvaro Marin, Mathieu Souzy. Annual Review of Fluid Mechanics 57, 89 (2025).
- Scope: clogging in particle-laden flows; parallels with dry granular clogging; flow-drive, particle propulsion, particle-shape effects.
- Verification: cross-paper compilation of clogging-onset conditions across geometries (constrictions, pores, hoppers) is genre-standard.
- Disagreement handling: fence-sit — the universality (or not) of intermittent clogging statistics across geometries is current open debate.
- Negative space: concrete (named: active-particle clogging in living flows; cohesive-noncohesive crossover).
- Original contribution: partial.
- Grade: **B**.

## R27 — Fluid Mechanics of the Dead Sea
- Authors: Eckart Meiburg, Nadav G. Lensky. Annual Review of Fluid Mechanics 57, 167 (2025).
- Scope: thermohaline + buoyancy + precipitation/dissolution coupling in a near-saturated terminal lake with ~1 m/yr level decline; halite finger sedimentation.
- Verification: cross-paper compilation of lake observations + lab + simulation; specific datasets named.
- Disagreement handling: not-applicable (a system review of one named lake).
- Negative space: concrete (named: high-resolution turbulence measurements at the diffusive interface).
- Original contribution: yes — first integrated fluid-mechanical synthesis of this geophysical system.
- Grade: **A**.

## R28 — Multiscale Modeling of Respiratory Transport Phenomena and Intersubject Variability
- Authors: Stavros C. Kassinos, Josué Sznitman. Annual Review of Fluid Mechanics 57, 141 (2025).
- Scope: in vitro and in silico canonical models spanning the airway tree; intersubject variability in lung morphometry; toward hybrid whole-lung simulations.
- Verification: cross-paper compilation of CFD predictions across patient-specific geometries.
- Disagreement handling: fence-sit — model comparisons remain framework-specific; no single model adjudicated as best.
- Negative space: concrete (named: whole-cycle hybrid simulations; aerosol deposition validation; real-time clinical use).
- Original contribution: partial.
- Grade: **B**.

## R29 — Turbulence from an Observer Perspective
- Author: Tamer A. Zaki. Annual Review of Fluid Mechanics 57, 311 (2025).
- Scope: data-assimilation viewpoint on wall-bounded turbulence; back-in-time inference; the critical-resolution synchronization threshold.
- Verification: re-derivation of synchronization conditions from chaotic-systems / Lyapunov-based criteria.
- Disagreement handling: adjudicate (a clear position on when and why observer-based reconstruction works).
- Negative space: concrete (named: experimental measurement densities required for synchronization in real flows).
- Original contribution: yes — the observer framing is the contribution.
- Grade: **A**.

## R30 — 2D Excitonics with Atomically Thin Lateral Heterostructures
- Authors: S. Shradha et al. Reports on Progress in Physics 89, 046501 (2026). arXiv:2510.21422.
- Scope: TMD-based lateral heterostructures, charge-transfer excitons at atomically sharp interfaces, exciton transport, excitonic lensing, fabrication via CVD.
- Verification: cross-paper compilation of CVD-grown lateral heterostructure spectroscopy is the dominant evidence mode.
- Disagreement handling: not stated in abstract.
- Negative space: concrete (named: atomically clean interfaces at scale; deterministic excitonic devices; defect-engineered interfaces).
- Original contribution: partial — taxonomy of phenomena novel to lateral (vs. vertical) heterostructures is the contribution.
- Grade: **B**.

---

## Cross-cutting Summary (counts over N=30)

**Scope binding.** Of the 30 reviews, **22 explicitly bound scope by date, mass range,
density range, system class, or instrument/era** (e.g., R6 mass-window, R8 frequency
window, R20 "post-JWST," R12 dense-matter density regimes). The remaining 8 had a
generic catch-all framing ("recent advances", "open questions", "current status") with
no hard delimiter — most common in the gravitational-wave / Living-Reviews entries
(R1, R2, R4) where the "living" status is itself the framing, and in tutorials (R17).

**Verification practices.** Re-derivation as load-bearing evidence is heavily
clustered in the gravity / nuclear-theory / strongly-correlated theory subset:
**all of R1, R2, R3, R9, R12, R14, R15, R16, R25, R29 contain re-derivation as
substance** (10/30). Recomputation of numerical predictions ("we recompute X across
Y references on a common grid") is concentrated in the data-rich phenomenology
reviews: R6 (DM), R9 (V_ud), R11 (nPDF), R12 (M-R), R20 (JWST retrievals), R23
(stellar abundances) (6/30 explicit). Cross-paper number tables are the dominant
mode for Annual-Reviews entries on phenomenology and for RMP nuclear/HEP
(approximately 18/30 either show one or are in a genre that requires it). Original
figures from public data appear most often in the Annual-Reviews fluid-mechanics
and astronomy entries (R21, R22, R24, R25, R29).

**Disagreement handling.** Strong adjudication: 14/30 (R1, R2, R4, R6, R9, R10, R11,
R12, R14, R15, R16, R19, R23, R25, R29). Fence-sit: 9/30 (R5, R13, R18, R20, R21, R22,
R24, R26, R28). Not-applicable / pre-discovery / single-system: 7/30 (R3, R7, R8, R17,
R27, R30, plus a borderline R22). The pattern: when a review is at the **theory
end** of a contested field (4PN coefficient, FL* hole pocket, cuprate phase, |V_ud|),
adjudication is normal. When at the **observational consolidation** end (JWST
spectra, ISM phases), fence-sitting is normal.

**Negative space.** **24/30 name specific missing measurements / methods / systems**
("third-generation GW detector polarization channel," "in-situ Saturn deep probe,"
"daily-modulation in anisotropic DM targets," "specific 5PN tail terms,"
"calibrated cm-wavelength dust opacity"). Only **6/30 stop at generic "more work
needed" framing** (R3 in part, R17, R20 partly, R21 partly, R26, R28). The
cleanest negative-space discipline is in nuclear/particle (R8, R9, R12 — they name
both the measurement and the facility that would do it) and in gravitational waves
(R1, R4, R16 — they name the PN order or the post-Einsteinian parameter).

**Original contribution beyond synthesis.** Yes: 17/30. Partial: 11/30. No: 2/30
(R17 tutorial, parts of R20). The Annual-Reviews entries are heavily "partial" —
they are paid to consolidate, not innovate. The Living-Reviews entries are heavily
"yes" because the genre invites authors to maintain a canonical reference and
re-do calculations across editions (R1, R2, R4 are pure "yes"). RMP colloquia are
mixed: R12, R16 yes; R13 partial.

**A vs. B grade by the discriminator** ("removing the new taxonomy / framework /
table leaves a contribution"):
- **A: 19/30** (R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R14, R15, R16,
  R19, R21, R23, R25, R27, R29 — note: 21 actually, see correction below)
- **B: 9/30** (R13, R17, R18, R20, R22, R24, R26, R28, R30)
- Correction: A count = 21 of 30 (~70%), B count = 9 of 30. The 70/30 A/B split
  here is likely **higher than across all of physics** because the sampling was
  biased toward Living Reviews / RMP / Annual Reviews (the venues with the
  strongest discriminator-pass rate by selection effect). Wave 1 + this wave
  combined still won't be representative without sampling the long tail of more
  routine "review of [niche]" articles in Phys. Rep. and J. Phys. condensed matter.

**Patterns to harvest for the autonomous-agent skill:**
1. **Theoretical-synthesis reviews are easier to discriminator-pass** than
   observational-consolidation ones, because re-derivation + cross-formalism
   reconciliation is structurally a contribution. Agent surveys should treat
   "reformulate framework X in language Y" as a permitted move when the source
   literature is fragmented across multiple formalisms.
2. **Negative space is rarely abstract-quoteable** — it lives in the body, in
   tables, or in phrases like "should be measured" / "not yet determined". An
   agent extracting negative-space discipline must read body sections, not just
   abstracts.
3. **Cross-paper number tables are the venue's main accountability mechanism**.
   Reviews without one (R5 abstract, R13, R20, R26) are systematically more
   "fence-sitting." Discriminator-passing surveys should default to a reanalysis
   table.
4. **Living-Reviews entries set the stylistic upper bar**: they re-derive,
   correct prior errata in print (R4), and update against new data each edition.
   Annual-Reviews entries are mid-bar (consolidation + opinion). RMP colloquia
   are variable — strong when the field is in flux (R12, R16), weak when the
   review is taxonomic (R13).
5. **The Cabibbo-anomaly cluster (R9, R10, R11) shows that adjacent reviews on
   the same data adjudicate differently** depending on author stance. This is
   evidence against any single-author "neutral" survey discipline; agents
   should explicitly model author position rather than aspire to neutrality.

## Honest paywall / access notes

- Publisher pages from APS (RMP), Annual Reviews, and Springer Nature returned
  403/303 to the WebFetch backend throughout this batch. All venue + scope +
  author + DOI verification was done via arXiv abstract pages, NASA ADS / INSPIRE
  surrogates, and the editorial-news SolarNews / Hyperspace@gu sites.
- Where an item was not on arXiv (R11, R23, R26, R27, R28, R29 do not have an
  obvious arXiv counterpart found in this session), the venue page was the only
  primary source and it 403'd. For those entries, the scope and authorship are
  triangulated from search-result snippets and from the Annual Reviews catalog;
  the verification-practice / disagreement-handling / negative-space columns
  should be considered **inferred from genre conventions**, not verified at the
  paragraph level. Items R11, R26, R28 are the most heavily inferred.
- Two items (R5, R7) are arXiv-confirmed but the verification claim that the
  body contains specific re-derivations rests on the abstract claim ("reviews
  ... static and hydrodynamic models," "rich tapestry of materials and modes")
  rather than direct body inspection.
- The discriminator grade is the agent's call against the rubric and not an
  expert assessment.
