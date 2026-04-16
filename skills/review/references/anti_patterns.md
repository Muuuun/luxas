# Anti-patterns — the stacker's tells

If a reviewer sees any of the patterns below in a draft, the draft is not yet
a review — it is a list. This file exists so that the review agent can scan
its own output for these tells and fix them before shipping.

## 1. Authorship-led paragraph openings

The single most reliable stacker marker. Every paragraph starts with an author
name or citation number:

> **Bad:** Smith et al. [12] realized the transverse-field Ising model in 2D
> arrays of up to 30 ⁸⁷Rb atoms. They observed collective Rabi oscillations…

The paragraph is *about* the Smith paper instead of about the physics. Fix:

> **Good:** In the blockade regime, the transverse-field Ising model emerges
> directly from the Rydberg Hamiltonian — a mapping first realized
> experimentally in 2D arrays of up to 30 ⁸⁷Rb atoms (Labuhn et al. 2016),
> where collective Rabi oscillations at frequency √N Ω signaled fully blockaded
> pair states.

Author names survive — but mid-paragraph and parenthetical, behind a claim
about the phenomenon.

**Scan rule:** no paragraph may begin with `"<Surname>"`, `"<Surname> and <Surname>"`,
`"<Surname> et al."`, `"In [<digits>]"`, `"[<digits>] showed"`, or
`"Reference [<digits>]"`.

## 2. "Zoo of results" paragraphs

Three or more papers recited in sequence without synthesis:

> **Bad:** Labuhn observed this. Lienhard extended to that. Scholl scaled to
> 196 atoms. Bernien observed scars. …

A zoo-paragraph is a symptom of an untriaged section outline. Fix:

- **Group** results by what they collectively established, not by who did them.
- **Synthesize** into one sentence that names the common finding, citation-cluster
  the papers, and devote the paragraph to *what the collective finding means*.

## 3. "This section…" / "We now turn to…" openings

Orientation-first section openings. The reader already sees the header — they
don't need to be told what the section is about, they need the section's
**claim**.

> **Bad:** This section discusses Ising model experiments in Rydberg arrays.
>
> **Good:** The Rydberg blockade maps naturally onto an antiferromagnetic
> transverse-field Ising Hamiltonian, and the experimental program over the
> last decade has steadily extended the achievable system size while revealing
> frustration physics and quantum critical dynamics that push against the
> limits of classical simulation.

## 4. Drive-by citation clusters

Unanchored `[7, 8, 9]` / `see e.g. [12–18]` blobs. If you cannot state what
each citation contributes, the cluster is a stacker confession.

Acceptable use: one cluster at section boundaries labeled `"For recent
reviews, see [7, 8, 9]"` — but no more than **one per section**.

## 5. Summary-level conclusions

A conclusion section that merely re-summarizes what was already said. If the
conclusion can be deleted without losing information, it is a summary, not a
conclusion. Reviews end with one of:

- **Outlook**: a named set of open problems or a concrete prediction.
- **Provocation**: a thesis-level claim that re-frames the rest of the
  article in light of what the reader now knows.
- **Agenda**: a prioritized research program.

## 6. Missing thesis per section

Outline step (SKILL.md §Step 1) failed. Symptoms:

- Section opens with orientation, not claim.
- Multiple paragraphs in the section argue for different things.
- Cutting a paragraph doesn't noticeably change the section's argument (each
  paragraph stands alone).

Fix: rewrite the outline. Articulate **one sentence per section** that states
what this section claims. If you cannot, the section should not exist — merge
it with its neighbor or delete.

## 7. Over-balanced "on-the-one-hand / on-the-other" prose

Stacker-via-false-balance: presenting two sides as equally weighted when the
field has a clear view. Reviews take stances. If the field has reached a view,
state it; if the field is split, name the split and say which way the evidence
points.

## 8. Venue voice mismatch

Writing a short Nature Reviews Physics assessment in RMP voice (dense, with
30 equations) or vice versa. Each domain style guide marks typical length +
equation density + citation style for its tier-1 venues — violate these at
your peril.

## 9. Orphan figure / orphan equation

A figure or numbered equation referenced nowhere in the prose after its
introduction. If the reader encounters Eq. (12) only once, it probably isn't
earning its number.

## 10. Mineable shortcut: generative authorship fabrication

When under pressure, agents hallucinate plausible papers ("Smith et al. 2019
demonstrated…") that do not exist. **Every citation must have a DOI or arXiv
ID traceable through the project's bibliography.** An uncited claim is safer
than a fabricated citation.

## How to run the check

Before reporting a draft done:

```bash
# Scan for authorship-led paragraph openings
grep -n -E "^(\\s)*[A-Z][a-z]+ (et al|and [A-Z][a-z]+)" report/report.tex \
  | grep -v "^.*:.*%.*"  # skip commented lines

# Scan for "This section" openings
grep -n "^\\\\section\\|^\\\\subsection" -A 2 report/report.tex \
  | grep -E "This (section|chapter|subsection)|We now (turn|discuss)|Here we"
```

Any match is a candidate for synthesis rewrite per SKILL.md §Step 3.
