# Synthesis rubric — how to unify disparate work

Synthesis is the craft a review article offers that a primary paper cannot.
This file catalogs the seven canonical moves mined from the corpus
(`review_style_skills`). Each move is named, described, and illustrated with
a domain example. Use this as a checklist when drafting a section — at least
one synthesis move per section.

## 1. Unifying equation

Expose the common Hamiltonian / objective / loss / PDE that different
experiments or algorithms all implement. Cite the papers that instantiate
each term.

- **Physics:** the Rydberg Hamiltonian
  `H = (ℏΩ/2) Σᵢ σˣᵢ − ℏδ Σᵢ nᵢ + ½ Σᵢ≠ⱼ Vᵢⱼ nᵢnⱼ`
  unifies every Ising-simulator experiment: `Ω` controls transverse field,
  `δ` controls longitudinal, `Vᵢⱼ` the interaction, geometry controls
  `Vᵢⱼ`.
- **ML:** the empirical risk minimization objective
  `min_θ (1/n) Σᵢ L(fθ(xᵢ), yᵢ) + λ Ω(θ)`
  unifies SVM / logistic regression / neural nets through choice of `L`, `fθ`,
  `Ω`.

## 2. Comparative platform (or system / method) table

One table row per platform/method, columns are dimensions the reader cares
about (coherence, size, programmability, gate fidelity — or accuracy, compute
cost, interpretability, data efficiency — or biocompatibility, synthesis
yield, stability). The synthesis happens in the **column choices**.

Every field has its version. A comparative table earns more than a page of
prose.

## 3. Taxonomy tree

Hierarchical classification of the objects the review studies. Levels usually
go: physical regime → model class → experimental variant. Each leaf cites the
papers that instantiate it.

Caveat: a taxonomy only synthesizes if the branches *have consequences*. A
taxonomy that merely names categories is a glossary.

## 4. Contrast pair

Pick two objects (platforms / methods / phases / eras) and walk them through
every dimension side by side. The reader learns both and learns what
distinguishes them.

- **Physics:** blockade regime vs. dipolar-exchange regime.
- **Biology:** cytotoxic T cells vs. regulatory T cells.
- **Economics:** representative-agent vs. heterogeneous-agent macro.

A contrast pair is the shortest viable review.

## 5. Timeline with periodization

Chronological arc with named eras. Each era gets a thesis sentence
("1950–1970: phenomenology; 1970–1995: microscopic theory; 1995–present:
simulation-driven"). The synthesis is the periodization itself — naming where
the discontinuities fall.

Works especially well for long-running problems (high-Tc, CMB, protein
folding, macroeconomics).

## 6. Phase diagram (literal or metaphorical)

Two control parameters, regions, phase boundaries. For experiments: a
measured phase diagram. For methods: a "when-to-use-which" chart with axes
like (data size, supervision amount). For markets: (inflation, unemployment).

## 7. Running example

Thread one concrete case study through every section. New concepts are
introduced via what they do *to the running example*. Synthesis emerges
because the example accumulates resolution.

- **ML:** MNIST in a deep learning review.
- **Physics:** the Ising model in a quantum simulation review.
- **Economics:** the 2008 crisis in a monetary policy review.

Running examples are dangerous in long reviews (the example may not bear the
weight). Use when the example is *the* canonical case of the phenomenon.

## Minor moves (use sparingly)

- **Mathematical analogy:** "X is to Y what A is to B."
- **Named-convention coinage:** introduce a memorable shorthand for a
  clunky concept (e.g. "IOM axis" for immuno-onco-microbiome).
- **Historical reframing:** revisit a famous result in light of new tools.

## How to use this file during drafting

When drafting §N:

1. Decide upfront which synthesis move §N will execute.
2. The move belongs in the outline entry (`**Synthesis move:**` field).
3. If the move is "comparative table" — draft the table FIRST, then the
   prose. The table constrains the prose.
4. If by the end of §N a reader could not tell which move was used, the
   section failed — rewrite.

## Domain-specific elaborations

See `skills/review/style_guides/<domain>.md` for how each domain's canonical
synthesis moves are expressed in its voice (e.g. physics favors unifying
Hamiltonians + phase diagrams; chemistry favors taxonomies + volcano plots;
economics favors contrast pairs + periodizations).
