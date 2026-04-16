# Venue selection decision tree

Use this to pick which domain style guide to obey, and within the domain,
which venue-specific register is appropriate.

## Step 1 — Pick the domain

Match the primary subject matter, not the methodology:

| Primary subject | Domain |
|---|---|
| Quantum systems, condensed matter, AMO, HEP, classical mechanics | `physics` |
| Synthesis, catalysis, MOFs, materials chemistry, photoredox | `chemistry` |
| Cell biology, genetics, immunology, developmental bio, microbiome | `biology` |
| Clinical, pharmacology, CAR-T, vaccines, precision medicine | `medicine` |
| Pure math, numerical analysis, probability, theorem-proof | `mathematics` |
| ML, systems, theory, HCI, security, software engineering | `computer_science` |
| Climate, ecology, geology, oceanography, atmosphere | `earth_environment` |
| Cosmology, galaxy formation, stars, compact objects, gravitational waves | `astronomy` |
| Macro, micro, finance, labor, development, econometrics | `economics` |
| 2D materials, batteries, alloys, ML for materials, nanomaterials | `materials` |

**Cross-domain** (e.g. "ML for materials"): pick the domain of the **object
being reviewed**. "ML for materials" is materials. "Biology informed by ML"
is biology. Exception: if the review is primarily about the method (a new
ML technique demonstrated on materials), use `computer_science`.

## Step 2 — Pick the length / venue register within domain

Every domain guide names its tier-1 venues. Pick based on target length and
audience:

### Monograph (50–150 pp)
Pedagogical, archival, equation-dense, derivation-complete. Reader reads
cover to cover over a weekend.

- **physics:** Reviews of Modern Physics, Physics Reports, Rep. Prog. Phys.
- **chemistry:** Chemical Reviews
- **mathematics:** Acta Numerica, Bull. AMS long surveys
- **computer_science:** Foundations and Trends in X, ACM Computing Surveys
- **biology:** Physiological Reviews
- **astronomy:** Living Reviews (in Relativity, Solar Physics)

**Voice cues:** fully-written derivations, numbered boxes, glossary often
present, section lengths 8–20 paragraphs, citation density ~2–4 per
paragraph.

### Specialist review (20–40 pp)
Thesis-dense, pedagogical but not derivation-complete, figure-rich. Reader
is a graduate student or newcomer to the subfield.

- **physics:** Annual Review of Condensed Matter Physics
- **astronomy:** Annual Review of Astronomy and Astrophysics
- **biology:** Annual Review of Biochemistry / Cell Biology
- **chemistry:** Chem. Soc. Rev., Nat. Rev. Chem.
- **earth_environment:** Reviews of Geophysics, Nat. Rev. Earth Environ.
- **economics:** Annual Review of Economics
- **medicine:** Nat. Rev. Drug Discov., Nat. Rev. Disease Primers

**Voice cues:** claim-led sections, a handful of numbered equations, one
well-designed figure per section, citation density ~1–3 per paragraph,
clear outlook section.

### Short assessment (5–15 pp)
Stance-forward, abstract-caliber thesis per paragraph, almost no derivation.
Reader skims for an executive summary of the field.

- **physics:** Nat. Rev. Phys.
- **biology:** Trends in X, Current Opinion in X
- **medicine:** NEJM Review Articles, Nat. Med. Perspectives
- **all:** Nature Reviews X, Science Perspectives
- **astronomy:** Nat. Rev. Phys., A&A Rev.
- **earth_environment:** Nat. Rev. Earth & Environment

**Voice cues:** short paragraphs, almost no inline math, one or two concept
figures, citation density >2 per paragraph, conclusion = outlook in 2–4
bullet-points.

### Opinionated essay (5–20 pp)
Single author (or very small team), warm first-plural, polemical beat,
willing to stake a position.

- **physics:** Quantum (Preskill-style), Nature Comment
- **economics:** Nobel lectures in AER, JEP
- **computer_science:** Nat. Mach. Intell. (Rudin 2019), CACM (Bengio/LeCun/Hinton)
- **medicine:** NEJM Perspective, Nat. Med. commentaries

**Voice cues:** "I/we" prominent, a central thesis re-stated throughout,
provocative titles, minimal citation density, conclusion is a call to
action.

## Step 3 — Load the style guide

```bash
# In the review project:
cat skills/review/style_guides/<domain>.md  # read entire guide before drafting each section
```

## Step 4 — If uncertain between two registers

Pick the one whose **length budget** matches the project's target page count.
Venue voice follows naturally from length — RMP-length projects can't fit the
Nat. Rev. Phys. assessment register and vice versa.

If length is also uncertain: **start with the specialist review register**.
It's the broadest target and the easiest to later tighten (→ short
assessment) or expand (→ monograph).

## Step 5 — If the project spans multiple domains

Three strategies:

1. **Pick the primary domain**, apply its style guide, acknowledge cross-field
   borrowings parenthetically.
2. **Split by section**: physics sections use `physics`, engineering sections
   use `materials`. Jarring unless transitions explicitly flag the shift.
3. **Write cross-field**: use `computer_science/ml` or `physics` if the
   domains intersect at method; use `earth_environment` if at application
   (e.g. "ML for climate modeling" = earth_environment).

Default: (1). The other two require conscious authorial handling.
