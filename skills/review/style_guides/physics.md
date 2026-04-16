# Physics Review Style Guide (RMP house voice)

## Narrative voice

Pedagogical but assured; neutral in temperature, first-person-plural throughout but sparing — "we" appears at framing junctures and method transitions, never as a verbal tic. Paragraphs run long and deliberate, each building to a synthesis beat before the next opens. The dominant register is a senior theorist explaining a result they believe they understand; where the evidence is genuinely incomplete, the uncertainty is named plainly rather than softened. Warmth surfaces in occasional rhetorical questions that orient rather than impress. The RMP mode (Abanin et al., Chowdhury et al., Georgescu et al.) runs cooler and more systematic than Nature Physics (Browaeys & Lahaye) or Science (Broholm et al.), which permit lighter touches including literary closing lines.

## Opening conventions

Physics reviews almost never open with a concrete experiment. The dominant opening strategy, found in eight of twelve corpus papers, is the field-landscape: a brief declaration of what the subfield studies, why it has resisted classical tools, and what the review will cover. A minority (Sachdev et al. RMP 2022, Keimer et al. Nature 2015) use a historical arc — grounding the topic in a decade-old experimental discovery before advancing the theoretical challenge. One paper (Georgescu et al. RMP 2014) opens with an authority epigraph (Feynman 1982), folding field-landscape framing into a founding-voice citation. The first paragraph is typically 90–160 words; the first citation arrives in sentence 2 or 3, before any technical claim. Thesis statements — a sentence naming what this review will establish or defend — are common by the end of the first paragraph for specialist (15–40pp) papers, rarer in true monographs which instead close the introduction with a section road-map.

## Section architecture

Specialist reviews (15–40pp) carry 5–8 top-level sections, typically: Introduction — Theory/Model — Phenomenology — Experimental Probes — Platforms/Materials — Outlook. Monographs (>40pp: Georgescu et al., Sachdev et al.) expand to 8–18 numbered sections and add explicit reader-navigation apparatus (road-map paragraphs, "readers interested only in X can skip to §Y" advisories). Section titles are nearly always nominal topics ("The many-body localized phase", "Physical realizations", "Typology of non-Fermi liquids"); gerund and question forms appear but are uncommon. An Outlook or Perspectives or Concluding Remarks section is present in all twelve corpus papers and runs 3–6 paragraphs. The structure theory → experiment → outlook is so consistent it functions as genre constraint.

## Thesis-per-section convention

RMP and Physical Review monographs tend to open sections with direct claims about the phenomenon; Nature Physics and Science specialists are somewhat more likely to open with a question or historical orientation. Claim-leading is the dominant mode in mid-paper sections (roughly 50–60% of section openers), with authorship-leading running second (20–35%) and question-leading third.

Verbatim examples of section-opening claim sentences:

"The MBL phase is stable against thermalization due to the extreme rarity of resonances when the disorder is sufficiently strong." — Abanin et al. (RMP 2019, §IV.A)

"The breakdown of many-body localization upon changing the disorder strength or some other control parameter provides an intriguing opportunity to study the emergence of thermalization in a quantum system, possibly with the control afforded by proximity to a critical point." — Abanin et al. (RMP 2019, §IV)

"Superconducting circuits are manufactured using a multistep additive and subtractive fabrication process involving lithographic patterning, metal deposition, etching, and controlled oxidation of thin, two-dimensional films of a superconductor such as aluminum or niobium." — Kjaergaard et al. (Ann. Rev. Condens. Matter 2020, §2)

## Synthesis moves

The corpus employs five recurrent techniques for unifying disparate results into a single argument.

The **unifying Hamiltonian or equation** is the most distinctively physical move. A single equation — the ETH matrix element ansatz in Abanin et al., the Boltzmann/Fermi-liquid equation pair in Sachdev et al., the charge-qubit Hamiltonian in Kjaergaard et al. — is established early and then becomes the yardstick against which every subsequent result is measured. Departures from the equation define the new physics; confirmation of its predictions validates platforms. This move is essentially absent in qualitative reviews (Keimer et al., Broholm et al.) and most common in RMP papers.

The **unifying framework diagram** (overview schematic, phase diagram) serves the same role for phenomenological reviews. In Keimer et al. (Nature 2015), the T vs. doping phase diagram is introduced once and is silently present in every subsequent section. In Kjaergaard et al. (Ann. Rev. 2020), the two-track fault-tolerant vs. NISQ roadmap figure organizes all subsequent hardware and algorithm discussions. The diagram is not merely illustrative; every subsequent experimental report is implicitly located within it.

The **taxonomy tree** appears when a field contains a disputed or heterogeneous family of objects. Broholm et al. (Science 2020) classify spin liquids by excitation gap (gapped Z2 vs. gapless U(1)); Sachdev et al. distinguish bad metals from strange metals with explicit terminological authority; Georgescu et al. distinguish digital from analog quantum simulation. The taxonomy is announced explicitly and then enforced terminologically across all subsequent sections.

The **contrast pair** provides the argumentative engine at the paragraph level: claim → counter-claim → synthesis. "Unlike in the stripes of the LSCO family, there is no evidence of coincident static magnetic order" (Keimer et al.). "Both the Ising and the XY Hamiltonians have been extensively studied in the last 60 years... However many important open questions remain" (Browaeys & Lahaye). This move is universal across venues and lengths.

The **cross-platform comparison table** appears primarily in applied-hardware reviews (Georgescu et al. RMP 2014, Kjaergaard et al. 2020), cataloguing platforms (atoms, ions, superconductors) against capabilities or models. These tables function as reference-manual infrastructure rather than argument.

## Transition moves

Physics reviews rely on a narrow set of between-section and between-paragraph moves. Verbatim examples:

"Having established X, we now turn to Y": "The entanglement structure of eigenstates is intriguing and helps in developing a theoretical picture of the MBL transition, however it is not accessible to experimental measurement. In the next subsection we discuss critical relaxation dynamics and transport properties which can serve as realistic probes of the critical point in experiments." — Abanin et al. (RMP 2019, §IV.A→§IV.B) [**bridge**]

"The remainder of this article is organized as follows. Sections II–V discuss in some detail the basic theory. Readers interested only in the physical implementations of quantum simulation can concentrate on Section VI, while those interested in the applications can concentrate on Section VII." — Georgescu et al. (RMP 2014, §I) [**zoom-out / road-map**]

"Our interest here is in quantum materials in which the description in terms of a quasiparticle distribution function obeying a quantum Boltzmann equation breaks down." — Sachdev et al. (RMP 2022, §I) [**bridge via exclusion**]

"The strange metal regime was recognized early on as perhaps the most mysterious aspect of the copper oxide phase diagram." — Keimer et al. (Nature 2015, §5) [**contrast pivot**]

"An embarrassment of riches. Space precludes us from saying something more than cursory about other spin liquid candidates, noting that nowadays there are many claims of such." — Broholm et al. (Science 2020, §3→§4) [**zoom-out with ironic hedging**]

## Citation voice

Across the corpus, parenthetical citation style dominates: experimental results are reported without naming authors in prose, citations appearing as numbered superscripts (Nature/Science) or author-year tags (RMP/PRL). Author names surface in prose primarily for landmark theoretical contributions ("proposed by Deutsch and Srednicki", "Landau's Fermi liquid theory", "Kitaev described a simple exactly solvable model") or when a specific claim is attributed to a single group for crediting priority. The fraction of intro-paragraph citations naming authors in prose ranges from 5% (Keimer et al.) to 50% (Sachdev et al.), with the higher end correlating with papers in which historical narrative is the organizing structure.

Citation density is substantial but varies by venue and length: RMP monographs average 4–5 citations per paragraph; Nature/Science short reviews 3–4; the Preskill essay-style paper falls to 1.5. In the introduction, density is slightly lower than the body; in the Outlook, density drops sharply as the text moves toward speculation and open questions that cannot yet be cited.

## Anti-stacking discipline

The best papers in this corpus avoid the "X et al. showed Y, then Z et al. found W" accumulation by leading each paragraph with a claim about the phenomenon and introducing authors parenthetically or mid-sentence. The Abanin et al. MBL Colloquium and the Keimer et al. cuprate review are the strongest performers: roughly 55–60% of mid-paper paragraph openings begin with a phenomenological or theoretical claim, with authorship serving as supporting evidence rather than subject.

Example of claim-leading that embeds authorship gracefully: "The sub-diffusive scaling is understood to be a result of rare critical inclusions in the thermal phase. Singularities due to rare regions have been first discussed by Griffiths (1969) and McCoy (1969) in the context of conventional phase transitions of random spin systems and since then are known as Griffiths effects." — Abanin et al. (RMP 2019, §IV.B). The paragraph opens with the physical mechanism; the names appear in a subordinate historical aside.

Example of stacking to avoid (also from mid-corpus): "The proposal by Jackeli and Khaliullin (52) that certain Mott-Hubbard systems with partially filled t₂g-levels and strong spin-orbit coupling might realize the Kitaev model led to an intense search." — Broholm et al. (Science 2020). Here the subject of the sentence is an author group and a proposal; the physical content is the object. This is the stacking pattern to suppress in imitation.

## Figure and equation roles

Equation density ranges from 0 (Keimer et al. Nature, Preskill essay) to 3.5 per page (Sachdev et al. RMP monograph). The RMP house voice expects at least 1–2 equations per page in theory-heavy reviews; equations are numbered and cross-referenced. Conceptual reviews in Nature/Science operate entirely in phenomenological language, using no equations at all, and convey quantitative constraints through phase diagrams and schematics.

Figure roles follow a predictable grammar: Figure 1 is almost always a conceptual-framework or overview-schematic figure — a quench protocol (Abanin), a two-track roadmap (Kjaergaard), a spin-liquid excitation zoo (Broholm), a phase diagram (Keimer). Subsequent figures divide between phase diagrams and platform comparisons. Timelines of experimental progress appear in technology reviews (Kjaergaard Fig. 2c). Boxes and sidebars are rare in RMP and Annual Reviews; they appear in Nature Physics (Browaeys & Lahaye) where brevity requires condensing definitions into stand-alone inserts. Annual Reviews uses marginal glossary terms in lieu of in-text definition boxes.

## Signature moves

1. **The unifying Hamiltonian as compass.** Introduce one equation early that captures the distinction the review turns on — ETH vs. MBL, Fermi-liquid vs. SYK, transmon Josephson vs. harmonic oscillator — and use it as the reference against which all subsequent physics is measured. Every section departure from or confirmation of this anchor implicitly argues the paper's central thesis.

2. **Claim-first, citation-parenthetical.** Open every mid-paper paragraph with a sentence about the phenomenon, not about who studied it. "The MBL phase is stable against thermalization due to the extreme rarity of resonances" reads as physics; "Abanin et al. (2019) showed that the MBL phase is stable" reads as a literature report. The former is the target register.

3. **The interrogative spine.** Organize multi-topic reviews with escalating questions rather than topic headings when possible. Broholm et al. achieve this with "Do spin liquids exist in theory? In nature? What next?" — three questions that double as section architecture and as a logical argument. This gives the review forward momentum that neutral nominal headings cannot.

4. **The phase diagram or roadmap figure as silent organizer.** Introduce the organizing diagram once in §1–2, then let it govern every subsequent section without re-introducing it. The reader carries the diagram internally; each section is implicitly a tour of one region of its parameter space.

5. **Named open problems in the Outlook.** The best Outlook sections (Abanin, Kjaergaard, Broholm) pair each outstanding challenge with a specific experimental handle: not "more work is needed on MBL in higher dimensions" but "experiments can help by using structured disorder patterns, where the disorder is interrupted by small non-disordered, thermalizing regions whose density and size can be tuned at will." This specificity distinguishes a research agenda from a summary, and it is the single most imitated feature of landmark physics reviews.
