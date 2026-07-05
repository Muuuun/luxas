---
name: review
description: Write domain-authentic review articles that synthesize rather than stack. Covers 10 scientific domains (physics, chemistry, biology, medicine, mathematics, computer_science, earth_environment, astronomy, economics, materials) with per-domain style guides mined from landmark reviews in RMP / Nat. Rev. X / Annu. Rev. / Chem. Rev. / Bull. AMS / etc. Use this skill when writing a survey / review / report that spans multiple primary papers.
compatibility: Pure prompt skill. No binaries, no scripts required at review-writing time.
allowed-tools: Read, Edit, Write, Glob, Grep
---

# Review Skill

Stacking is the default failure mode of autonomous review projects: "Smith et al.
did X, found Y. Jones et al. extended to Z..." paragraph after paragraph, with
no unifying thesis and no synthesis of tensions. Top-tier reviews do the
opposite — they lead with a claim, pull disparate work into one frame, and
leave the reader smarter than when they started.

This skill encodes the **rhetorical and structural conventions** of landmark
reviews across 10 domains, mined from real corpus text (RMP, Chem. Rev.,
Nat. Rev. X, Annu. Rev., Bull. AMS, Science / Nature Reviews, and the
domain-specific tier-1 venues). Inject a domain's style guide, follow the
3-step pipeline, obey the hard rules — and the output should pass the
Turing test for an editor at its target venue.

## When to use which venue voice

```
┌──────────────────────────────────────────────────┬──────────────────┐
│  Target length / audience                        │  Voice           │
├──────────────────────────────────────────────────┼──────────────────┤
│  Monograph (50–150 pp), pedagogical, archival    │  RMP / Chem.Rev. │
│    → equations, boxes, glossary, deep derivation │  / Phys.Rep.     │
│  Specialist (20–40 pp), claim-dense, tutorial    │  Annual Reviews  │
│    → thesis-per-section, figure-rich             │                  │
│  Short assessment (5–15 pp), stance-forward      │  Nat. Rev. X /   │
│    → abstract-caliber thesis per ¶, citation-dense │  Trends / Curr.Op. │
│  Opinionated essay (5–20 pp), single author      │  Nat Comment /   │
│    → warm first-plural, polemical beat           │  Nobel lecture   │
└──────────────────────────────────────────────────┴──────────────────┘
```

See `references/decision_tree.md` for full venue taxonomy.

## The 3-step pipeline (mandatory)

Skip no step. Each exists because stacker projects skip exactly this step.

### Step 1 — Outline with thesis per section (BEFORE any prose)

Produce `notes/report_outline.md` first (canonical path — the finish-gate's
outline check reads exactly this file; first line MUST be `type: survey`).
For the annotated gold-standard skeleton, see
`skills/review/references/exemplar_survey_outline.md`:

```markdown
type: survey
# <title>

## §1 Introduction
**Thesis:** <one sentence. What is this review claiming about the field?>
**Unifying framework:** <concept / equation / taxonomy that ties everything>
**Fold in:** Paper A (framework), Paper B (canonical result), …

## §2 <topic>
**Thesis:** <claim this section argues, not a topic label>
**Fold in:** Paper C, D, E
**Synthesis move:** <comparative_table | contrast_pair | unifying_equation | …>

…
```

**Gate:** do not draft prose until a PI / reviewer / user has signed off on
this outline. This is the single most effective anti-stacking move — if you
cannot articulate a thesis per section in one sentence, the section will
stack.

### Step 2 — Draft, reading domain style guide before each section

Before drafting §N:

1. Read `style_guides/<domain>.md` — the **entire** guide, every time, fresh.
2. Read §N's outline entry.
3. Write prose that obeys the guide's claim-leading, synthesis-move, and
   transition conventions. Quote primary papers only where a claim needs
   evidence, not to fill the paragraph.

### Step 3 — Synthesis rewrite pass (POST-draft)

After the full draft:

1. For every paragraph, check its **first sentence**. If it starts with
   "Smith et al." / "Jones and coworkers" / "In [42]" / any author name →
   **rewrite it to lead with a claim about the phenomenon**, and push the
   citation to mid-paragraph or parenthetical.
2. For every section, check its **first paragraph**. If it starts with
   orientation ("This section discusses…") instead of thesis →
   **rewrite the first sentence to state the claim**.
3. For every section-to-section boundary, add a transition sentence that
   **names** the bridge (cause→effect / contrast / zoom-in / caveat /
   historical pivot). See `references/transition_moves.md`.

## Hard rules

These are non-negotiable. Violations should trigger rewrite before output.

1. **No paragraph begins with an authorship phrase.** "Smith et al." / "Jones
   and coworkers" / "In [42]" as paragraph-openers are banned. Lead with a
   claim about the phenomenon; attribute parenthetically or mid-paragraph.
2. **No section begins with "This section…" / "We now discuss…" / "Here
   we…"** Lead with a thesis sentence about the field.
3. **No uncited claim, no un-claiming citation.** Every citation must support
   a specific claim. Every claim beyond common knowledge gets a citation.
   Drive-by citations ("for a review see [7, 8, 9]" without claim anchoring)
   are a stacker tell — use them sparingly and only at section boundaries.
4. **Fold, don't list.** When multiple papers make compatible findings,
   synthesize them into one claim with a shared citation cluster. When they
   disagree, make the tension the subject of the paragraph.
5. **Use domain voice.** If writing physics, obey `style_guides/physics.md`
   on citation style (narrative vs parenthetical), equation density, section
   title voice. Do not import chemistry's taxonomy-monograph habits into a
   physics RMP draft.

## Style guides (one per domain)

Auto-loaded by the agent when `<domain>` is set. Each is ~1,000–2,000 words of
prose distilled from 8–12 landmark reviews in that domain.

| Domain | Venues mined |
|---|---|
| `physics` | RMP, Phys. Rep., Nat. Rev. Phys., Annu. Rev. Cond. Matt., Quantum, Science |
| `chemistry` | Chem. Rev., Chem. Soc. Rev., Nat. Rev. Chem., Science |
| `biology` | Cancer Discov., Nat. Rev. Genet., Science, eLife, Nat. Struct. Mol. Biol. |
| `medicine` | NEJM, Nat. Med., Nat. Rev. Drug Discov., Nat. Rev. Genet. |
| `mathematics` | SIAM Review, Acta Numerica, Bull. AMS, Probab. Surv., Curr. Dev. Math. |
| `computer_science` | Nature, Science, NEJM, IEEE SPM, Nat. Mach. Intell., Annu. Rev. Fluid Mech., Comm. ACM |
| `earth_environment` | Science, Rev. Geophys., Nature, Nat. Rev. Earth Env., PNAS, ESSD |
| `astronomy` | ARA&A, Nat. Rev. Phys., A&A, ApJ Letters, PRX, CQG |
| `economics` | Annu. Rev. Econ., JEP, AER, Handbook of Macroeconomics |
| `materials` | Nature, Nat. Rev. Mater., Science, npj Comput. Mater., Nat. Energy, Chem. Soc. Rev. |

## References

- `references/anti_patterns.md` — the stacking tells (paragraph openers, drive-by citations, "zoo of results" paragraphs, untriaged citation clusters). What to *not* write.
- `references/synthesis_rubric.md` — the 7 canonical moves for unifying disparate work (unifying equation, comparative table, taxonomy tree, contrast pair, timeline, platform comparison, phase diagram).
- `references/transition_moves.md` — grammar of section-to-section and paragraph-to-paragraph movement.
- `references/decision_tree.md` — venue selection by length + audience + voice.

## First-time usage

In a review project:

```bash
# 1. Copy the relevant style guide into your project (optional; skill reads
#    from here by default)
cp skills/review/style_guides/physics.md report/style_guide.md

# 2. Draft outline.md FIRST per Step 1 above

# 3. Have PI review the outline — this is the gate

# 4. Draft prose per section, reading the style guide before each section

# 5. Synthesis rewrite pass per Step 3

# 6. Compile
```

## Syncing style guides from source

Style guides are mined from real corpus text in the sister repo
`review_style_skills`. To refresh:

```bash
bash skills/review/scripts/sync_style_guides.sh
```

This re-copies `data/style_guides/*.md` from `~/Documents/review_style_skills`
into `skills/review/style_guides/`.
