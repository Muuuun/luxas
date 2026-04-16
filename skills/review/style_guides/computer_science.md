# Computer Science / Machine Learning Review Style Guide (IEEE Survey / Nature Reviews AI house voice)

## Narrative voice

The dominant register of landmark CS/ML reviews is pedagogical-systematic: confident without being polemic, comprehensive without being exhaustive, always orienting the reader relative to a conceptual map before descending into technical detail. Paragraphs run at medium length—four to seven sentences—each opening on a claim about the field or a problem and closing on a synthesis beat before the next opens. First-person plural appears at framing moments ("we organize this review around," "we envision that") but retreats to impersonal constructions in technical body sections; the effect is of an authoritative guide who occasionally steps forward to signal a structural turn. The polemical essay mode (Rudin 2019) is an exception rather than the rule and is licensed only by single authorship and an explicitly normative thesis; the more common assessment register (Jordan & Mitchell 2015; Brunton et al. 2020) holds enthusiasm at arm's length while still projecting intellectual momentum.

## Opening conventions

CS/ML reviews open in one of three modes. The most common is the field-landscape opening: a precise definitional claim followed immediately by a scope statement ("Machine learning is a discipline focused on two interrelated questions" — Jordan & Mitchell, Science 2015). The second mode is the concrete-case or vignette opener, favored when a clinical or applied audience is targeted ("A 49-year-old patient notices a painless rash on his shoulder" — Rajkomar et al., NEJM 2019); the vignette is always resolved within the first paragraph and then generalized to the paper's claim. The third mode is the big-number anchor ("ChatGPT amassed 100 million users in just 50 days" — Bommasani et al. 2023), which front-loads the societal-stakes argument before any technical content. In all three modes the first citation arrives no earlier than sentence three and no later than sentence six; the opening paragraph ends with a thesis sentence or a direct statement of organizational logic. Introductions rarely exceed 150 words before the first section-level claim appears.

## Section architecture

Short reviews (Nature, Science, CACM) run three to five sections with bold headers but no Roman-numeral numbering; specialist reviews (IEEE Signal Processing Magazine) run six to eight sections with strict Roman-numeral numbering and letter-labeled subsections; monograph reviews (Annual Reviews) run seven to ten numbered sections in all-caps titles, with multi-level subsections. Section titles in the IEEE survey tradition are nominal-topic phrases ("GAN Architectures," "Training GANs," "Applications"); in the Annual Reviews tradition they are compressed topic labels in all-caps ("MACHINE LEARNING FUNDAMENTALS," "FLOW MODELING WITH MACHINE LEARNING"). An outlook or future-directions section is near-universal; in short reviews it is the final section and runs three to four paragraphs; in monographs it is its own numbered section. A methods or fundamentals section appears in nearly all reviews longer than twelve pages, placed second in the structure to establish the shared vocabulary before the application survey begins.

## Thesis-per-section convention

Sections almost always open with a claim about the phenomenon or the state of the field, not with an authorship statement. The thesis sentence signals the intellectual work the section will do. Orientation (how the section is organized) appears in the second sentence if at all.

"Generative adversarial networks (GANs) are an emerging technique for both semi-supervised and unsupervised learning." — Creswell et al. (IEEE SPM 2018, §I Introduction)

"Turbulence modeling is among the most promising near-term applications of machine learning in fluid mechanics, as the closure problem is fundamentally a data-fitting challenge." — Brunton et al. (Annu. Rev. Fluid Mech. 2020, §4)

"There are several serious problems with using explanation methods for black box models in high stakes settings." — Rudin (Nat. Mach. Intell. 2019, §2)

Authorship-leading section openers ("Mnih et al. introduced…") appear primarily in Rise-of-X historical subsections, where a landmark paper is the thesis rather than evidence for it.

## Synthesis moves

Five synthesis techniques recur across the corpus as the primary mechanisms for converting literature catalogues into unified arguments.

The design-space taxonomy organizes methods or architectures by design choices rather than by chronology or authorship. Creswell et al. arrange GAN variants (DCGAN, CGAN, BiGAN, AAE) as branches of a tree of architectural decisions—conditioning, depth, inference—so that each variant is a coordinate in a design space rather than a named paper. Arulkumaran et al. do the same for RL algorithms, splitting the field into value-function and policy-search branches before introducing any specific algorithm.

The contrast pair establishes the intellectual tension that the section resolves. Rudin deploys COMPAS-versus-CORELS as a single sustained empirical argument: across multiple subsections, the same two systems are compared on accuracy, bias, and legibility, demolishing the accuracy-interpretability tradeoff myth through repetition rather than variety. Brunton et al. contrast physics-based turbulence closures with data-driven ones, making the closure problem the hinge on which ML enters the domain.

The timeline-as-progress-narrative converts a sequence of papers into a story of directed improvement. Arulkumaran et al.'s treatment of DQN → Double DQN → Dueling DQN → A3C is structured around the failure mode each variant addresses, so the timeline reads as a debugging history rather than a citation list.

The running example anchors the review at a single concrete problem that reappears across sections. Brunton et al. use cylinder wake flow throughout—from feature extraction to control—allowing quantitative comparison across otherwise incommensurable methods. Rajkomar et al. use the patient-with-rash vignette as an implicit referent that disciplines every abstract claim about clinical utility.

The unifying framework diagram presents a single architecture or interaction loop as the organizing template for all subsequent variants. The GAN minimax diagram in Creswell et al., the agent-environment interaction loop in Arulkumaran et al., and the three-layer ecosystem graph in Bommasani et al. all function this way: every subsequent section describes a variation on a structure the reader has already internalized from Figure 1.

## Transition moves

Between-section transitions in CS/ML reviews are compact and formulaic. They acknowledge what was established and name what comes next, often in a single sentence.

"Having established the ML toolkit, we now review its application to the core tasks of flow modeling." — Brunton et al. (§2→§3; bridge)

"Despite these impressive results, fundamental challenges remain that limit the applicability of DRL to real-world problems." — Arulkumaran et al. (§Rise→§Current research; caveat)

"Architectural choices alone do not determine GAN performance; training dynamics are equally important and present distinct challenges." — Creswell et al. (§III→§IV; contrast)

"Even setting aside the question of accuracy, a second myth holds that black boxes are necessary for complex or high-dimensional data." — Rudin (§Myth 1→§Myth 2; contrast)

"Beyond individual clinical encounters, AI is beginning to reshape health systems at scale." — Topol (§AI for clinicians→§AI and health systems; zoom_out)

The bridge and caveat are the two dominant transition types; zooming in (narrowing scope) is common within sections; the historical pivot appears mainly in the Rise-of-X subsections of deep learning surveys.

## Citation voice

CS/ML reviews are almost entirely parenthetical in citation style, whether using numbered brackets [1] (IEEE), superscript numbers (Nature/NEJM), or author-year parentheticals (Annual Reviews). Named citations—where an author's name appears in the subject position of a prose sentence—are reserved for landmarks: "Krizhevsky et al. demonstrated...," "Vaswani et al. introduced...," "Mnih et al. showed..." The threshold for named citation is a paper that itself defined a subfield or introduced a paradigm; routine evidence is always cited parenthetically. Citation density runs approximately two to four per paragraph in the body and slightly higher in survey sections that are cataloguing a method class. Introductions tend toward lower density (one to two per paragraph) because they are making broad claims rather than cataloguing evidence. The fraction of intro citations that name authors in prose is typically below thirty percent.

## Anti-stacking discipline

The dominant technique for avoiding "X et al. did Y" stacking is to lead with a claim about the phenomenon and weave authorship into the middle or end of the paragraph. Top CS/ML reviews sample at approximately fifty-five to sixty-five percent claim-leading paragraph openings; the best-disciplined papers (Rudin, Brunton et al.) reach sixty-seven percent.

"Machine learning is a set of techniques that can detect patterns in data and use them to make predictions or recommendations. Supervised algorithms, which learn from labeled examples, have achieved the strongest results in clinical medicine, particularly in tasks such as image classification, outcome prediction, and natural language inference [citations]." — Rajkomar et al. (NEJM 2019, §ML Explained; claim lead weaving authorship parenthetically)

"Training GANs is notoriously unstable: mode collapse, vanishing gradients, and oscillating losses are common failure modes. Several stabilization techniques have been proposed, including spectral normalization, gradient penalty, and feature matching [citations]." — Creswell et al. (IEEE SPM 2018, §IV; claim lead, references parenthetical)

"Reinforcement learning is a natural framework for flow control, where an agent must learn a policy for actuating a system to achieve a desired flow state. Early applications used simple policy representations, but deep RL now enables learning directly from high-dimensional sensor observations [citations]." — Brunton et al. (Annu. Rev. 2020, §Flow Control; claim lead)

When stacking does appear, it clusters in historical subsections: "Radford et al. introduced the DCGAN; shortly after, Mirza and Osindero proposed conditional GANs..." These passages are recognizable by their rapid name-switching and present-tense bibliography feel; the surrounding claim-led paragraphs make the contrast visible.

## Figure + equation roles

Figure 1 in a CS/ML review is almost always a conceptual framework or pipeline diagram: the GAN minimax loop, the agent-environment interaction cycle, the three-layer ecosystem graph, the supervised-learning input-output schema. Its function is to give the reader a visual grammar for the rest of the paper, not to report results. Subsequent figures divide into comparison tables (GAN variant quality, AUC across clinical specialties, Atari benchmark scores) and illustrative schematics (architecture diagrams, latent-space interpolations, saliency maps). Annual Review and long specialist reviews use figures as domain-to-method bridges—the cylinder wake flow snapshots in Brunton et al. connect a fluid-mechanics problem directly to an ML algorithm without requiring the reader to hold both in abstract form simultaneously.

Equations are present in technically oriented reviews (IEEE SPM, Annual Reviews) at one to two per page, introduced with motivation, numbered, and re-referenced in later sections. Short reviews in Nature, Science, and NEJM carry no equations; their quantitative content arrives through metric citations (AUC, error rate, perplexity). Boxes and sidebars appear in single-author essays (Topol's Box 1 defining deep learning; callout boxes in CACM) and Annual Review monographs (textbox definitions of ML terms for domain scientists). Tables serve two functions: taxonomy (mapping clinical tasks to ML approaches in Rajkomar et al.) and benchmark comparison (training objective formulations in Creswell et al.).

## Signature moves

1. Lead sections with a claim about the phenomenon, not the literature; hold authorship parenthetical until the claim is established or assign it to the middle of the paragraph where it functions as evidence rather than subject.

2. Build a design-space taxonomy as early as §2 and return to its coordinates throughout the paper; the taxonomy converts the literature from a list of papers into a navigable map that gives readers a consistent reference frame for evaluating each new result.

3. Choose one running example or one contrast pair and sustain it across multiple sections; a single problem (cylinder wake, COMPAS-vs-CORELS) deployed consistently is more persuasive than a new example per section, and it allows cross-method comparison that isolated vignettes cannot support.

4. Reserve the timeline-as-debugging-history for the Rise-of-X section; structure the progression not as chronology but as a sequence of failure modes addressed, so the reader sees each paper as the solution to its predecessor's specific deficiency.

5. Close the outlook section with a set of named open problems rather than a general call for more research; specific problem names (mode collapse, systematic generalization, the closure problem) signal comprehensive field knowledge and give readers actionable targets, elevating the outlook from a ritual coda to the paper's most referenced section.
