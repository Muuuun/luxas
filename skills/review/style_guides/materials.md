# Materials Science Review Style Guide (Nature Reviews Materials house voice)

## Narrative voice

Authoritative and synthetic, cool in temperature but not clinical; paragraphs earn their length by building toward a materials-science claim rather than cataloguing names. The register splits by paper type: specialist reviews of a single material class (2D TMDs, MXenes, HEAs) run in archival-monograph mode — deliberate, citation-dense, trusting the reader to track fine distinctions — while cross-cutting survey reviews (ML in materials, 2D heterostructures) allow first-person plural at framing moments and close with envisioning language. In both modes, the author's role is to argue a claim about the field, not to compile what was done.

## Opening conventions

Materials reviews rarely waste a first sentence on scene-setting. The dominant opening positions the reviewed material against a gap or predecessor: "Graphene is very popular because of its many fascinating properties, but its lack of an electronic bandgap has stimulated the search for 2D materials with semiconducting character" (Manzeli et al., Nat. Rev. Mater. 2017, §1). A minority opens with a historical arc that telescopes from civilizational scale: "Since the Bronze Age, humans have been altering the properties of materials by adding alloying elements" (George et al., Nat. Rev. Mater. 2019, §1). First citation arrives in sentence one or two. First-paragraph length runs 80–140 words; a scope sentence naming the review's organizing axes closes the opening paragraph or appears at the top of the Introduction.

## Section architecture

Specialist reviews (15–20 pages) carry 6–9 sections; monographs (30+ pages) carry 8–12. Titles are nominal-topic ("Synthesis," "Material Discovery") except in cross-cutting surveys where a section makes a claim rather than surveying a theme ("Adaptive Design Process and Active Learning"). An Outlook section is universal, 3–5 paragraphs, structured by open problems not summary. Single-material reviews follow a method/theory/synthesis/device split; cross-cutting reviews substitute a pipeline split (representation → algorithm → application → interpretability).

## Thesis-per-section convention

Sections open with a claim about the phenomenon, not an authorship statement. The thesis sentence names a property, mechanism, or challenge in declarative form:

"Because of the charge confinement and reduced dielectric screening, the optical properties of semiconducting 2D materials are dominated by excitonic effects." — Novoselov et al. (Science 2016, §Semiconducting Group-VIB)

"Machine learning methods have proven to be successful in the prediction of a large number of material properties." — Schmidt et al. (npj Comput. Mater. 2019, §Prediction of Material Properties)

"Moving from conventional semiconductors with nearly free electrons to strongly correlated materials, we encounter strong interactions among particles and quasiparticles." — Liu & Hersam (Nat. Rev. Mater. 2019, §Topological qubit platforms)

The defining habit: the phenomenon is named before its discoverers.

## Synthesis moves

Four canonical techniques unify disparate work into a claim.

The comparative property panel arrays band structures, DOS profiles, or performance metrics for an entire materials family on a common axis, letting the eye read the thesis — property diversity follows from a single structural variable — without prose support. Novoselov et al. (Science 2016, Fig. 1) and Manzeli et al. (Nat. Rev. Mater. 2017) exemplify this most completely.

The reference-system contrast pairs a canonical predecessor (graphene, diamond NV centre, GaAs quantum dot) against the reviewed class. Liu & Hersam (Nat. Rev. Mater. 2019) evaluate each 2D qubit candidate by how closely it replicates NV-centre decoherence while adding 2D-specific tunability — avoiding both isolated enthusiasm and bare enumeration.

The pipeline unification diagram presents the reviewed method as an accelerator of every discovery stage. Schmidt et al. (npj 2019, Fig. 1) deploy this for ML; Novoselov et al. (Science 2016, Fig. 3) for heterostructure assembly.

The running benchmark material anchors fragmented sections: MoS2 in TMDC reviews, MATBG in moiré reviews, perovskites in ML reviews — every new result stated as a delta from the benchmark.

## Transition moves

Between-section transitions favour functional bridging over decorative pivots. The dominant grammar is retrospective capture followed by prospective orientation:

"The previous chapters were concerned with the prediction of the stability, atomic structure, and physical properties. Necessarily, all of these methods have the end goal of minimizing the time until a new optimal material with tailored properties is found." — Schmidt et al. (npj 2019, §Adaptive Design, bridge)

"Heterostructures of 2D materials offer not only a way to study these phenomena, but open unprecedented possibilities of combining them for technological use." — Novoselov et al. (Science 2016, §Heterostructures, zoom-out)

"Moving from conventional semiconductors with nearly free electrons to strongly correlated materials, we encounter strong interactions among particles and quasiparticles." — Liu & Hersam (Nat. Rev. Mater. 2019, §Topological, zoom-in)

Contrast-pivot transitions ("Despite these impressive achievements, several challenges must be addressed...") are reserved for section boundaries marking the shift to outlook, not for paragraph-to-paragraph movement.

## Citation voice

Citations are parenthetical-dominant throughout, including the Introduction. Named-in-prose citations are reserved for milestone experiments whose attribution is as important as the result (Feynman's 1981 proclamation; Maddox's 1991 Nature editorial; the 2004 HEA discovery) and for foundational theoretical frameworks (DiVincenzo criteria, Josephson junction equations). Density runs 4–6 per paragraph in body sections, rising to 6–8 in systematic-survey subsections; the Introduction carries the same density as the body. Author names are not used in prose for results that can be stated as claims about the material.

## Anti-stacking discipline

The dominant paragraph pattern opens with a declarative claim about the material or phenomenon, states the mechanism in the second sentence, and weaves citations parenthetically through the remainder. Authorship leads are rare:

Claim-leading: "The interest in these materials comes from the existence of CDW and superconductivity in their phase diagram." / "Even 30 years after its discovery, unconventional superconductivity remains one of the unsolved challenges of theoretical condensed matter physics." / "The massless Dirac fermions in graphene possess exceptionally high mobility, in excess of 300,000 cm² V⁻¹ s⁻¹."

Authorship stacking — "Schmidt et al. first constructed a dataset of DFT calculations for approximately 250,000 cubic perovskites..." — clusters in mid-section cataloguing paragraphs of systematic-survey subsections. Section openings are almost never authorship-led.

## Figure and equation roles

Figure 1 in every paper in this corpus performs a taxonomic or framework function — property grid, workflow diagram, or phase-space map — rather than presenting new data. Overview schematics and comparison panels dominate; phase diagrams appear wherever competing ordered states are the thesis. Equation density splits by paper type: ML-in-materials reviews carry 1–2 numbered equations per page, used to define descriptors and loss functions; device-physics and heterostructure reviews carry fewer than 0.5 per page, reserving equations for phase-transition order parameters or Josephson-junction relations where the formula is the claim. Boxes are rare; when they appear they anchor a classification (moiré taxonomy box) that would otherwise require repeated back-references. Tables appear in ML-focused reviews only, conveying scope as property × method × reference grids.

## Signature moves

1. Open a section by naming the predecessor's limitation ("its lack of an electronic bandgap," "the Kohn–Sham equations are too expensive"), positioning the reviewed topic as the answer to a specific gap rather than an extension of prior work.

2. Deploy a single canonical benchmark across all sections (MoS2 for TMDCs, the NV centre for SPEs, perovskites for ML): every new result stated as a delta, making comparison implicit without explicit comparative paragraphs.

3. End body sections — not the outlook — with an open-problem sentence naming a structural or mechanistic unknown ("The mechanism for the CDW transition does not fit standard weak coupling mean field theories"; "the exact defects responsible for trapping excitons have not yet been definitively identified"), signalling that the review is a live map.

4. Make figure 1 a taxonomy: array competing materials or methods on a common axis so the scope claim is visually legible before the first paragraph of body text.

5. Reserve first-person plural for three moments: scope statement in the abstract ("we discuss"), prospective vision at the outlook close ("we envisage," "we would like to argue"), and cautious synthetic judgments beyond cited evidence ("we believe," "we suspect"). Everywhere else, the phenomenon speaks.
