---
name: venue-specific
description: Venue-specific formatting requirements for academic journals and conferences across all disciplines. Covers Nature, Science, Cell, PRL, NEJM, Lancet, JACS, NeurIPS, ICML, and 30+ top venues. Use when writing, formatting, or checking a paper for a specific target venue.
compatibility: Always available. No external dependencies.
allowed-tools: Read Write Edit Bash
---

# Venue-Specific Formatting Skill

Know the exact rules before you write. This skill provides **concrete, actionable formatting specifications** for 30+ top journals and conferences across all disciplines.

## When to Use

- User specifies a target journal or conference for their paper
- Formatting or checking a manuscript before submission
- Converting a paper from one venue's format to another
- Answering questions about a specific venue's requirements (page limits, figure specs, etc.)

## How to Use

1. **Identify the target venue** from the user's request
2. **Load the venue file** from `references/` — read ONLY the relevant file, not all of them
3. **Load the matching writing-style file** — see Writing Style Map below
4. **Apply rules** to the current manuscript
5. If venue is not covered, use `references/INDEX.md` to find the closest match + tell user to check the official author guidelines

## Writing Style Map

**Always load `writing-style/universal.md`** (Gopen-Swan principles, precision, flow).

Then load the discipline-specific style guide:

| Target Venue | Also Load |
|-------------|-----------|
| NeurIPS, ICML, ICLR, AAAI, COLM, ACL | `writing-style/ml-ai-conferences.md` |
| OSDI, NSDI, ASPLOS, SOSP | `writing-style/systems-conferences.md` |
| Nature, Science, Cell, PNAS, eLife, Nature sub-journals | `writing-style/high-impact-journals.md` |
| Physics (PRL, PRX, Nature Physics) | `writing-style/high-impact-journals.md` (if broad journal) |
| Chemistry (JACS, Angewandte, Adv. Mater.) | `writing-style/universal.md` only |
| Biomedical (NEJM, Lancet, JAMA) | `writing-style/high-impact-journals.md` |
| CVPR, ICCV, ECCV | `writing-style/ml-ai-conferences.md` |

The venue file gives **formatting rules** (what). The writing-style file gives **writing advice** (how).

## Reference Map

Load on demand. **Never preload all files.**

### Life Sciences (Top Journals)

| File | Venue | When to Read |
|------|-------|-------------|
| `life-sciences/nature.md` | Nature | Target is Nature or Nature-branded journal |
| `life-sciences/science.md` | Science (AAAS) | Target is Science |
| `life-sciences/cell.md` | Cell (Cell Press) | Target is Cell or Cell Press journal |
| `life-sciences/pnas.md` | PNAS | Target is PNAS |
| `life-sciences/elife.md` | eLife | Target is eLife |

### Physics

| File | Venue | When to Read |
|------|-------|-------------|
| `physics/prl.md` | Physical Review Letters | Target is PRL |
| `physics/prx.md` | Physical Review X | Target is PRX |
| `physics/nature-physics.md` | Nature Physics | Target is Nature Physics |

### Chemistry & Materials

| File | Venue | When to Read |
|------|-------|-------------|
| `chemistry/jacs.md` | J. Am. Chem. Soc. | Target is JACS |
| `chemistry/angewandte.md` | Angew. Chem. Int. Ed. | Target is Angewandte |
| `chemistry/advanced-materials.md` | Advanced Materials | Target is Adv. Mater. |
| `chemistry/nature-chemistry.md` | Nature Chemistry | Target is Nat. Chem. |

### Biomedical

| File | Venue | When to Read |
|------|-------|-------------|
| `biomedical/nejm.md` | New England J. Med. | Target is NEJM |
| `biomedical/lancet.md` | The Lancet | Target is Lancet |
| `biomedical/jama.md` | JAMA | Target is JAMA |

### CS Conferences

| File | Venue | When to Read |
|------|-------|-------------|
| `cs-conferences/neurips.md` | NeurIPS | Target is NeurIPS |
| `cs-conferences/icml.md` | ICML | Target is ICML |
| `cs-conferences/iclr.md` | ICLR | Target is ICLR |
| `cs-conferences/cvpr.md` | CVPR / ICCV / ECCV | Target is vision conference |
| `cs-conferences/acl.md` | ACL / EMNLP / NAACL | Target is NLP conference |
| `cs-conferences/aaai.md` | AAAI | Target is AAAI |

### Publishers (Base Rules)

| File | Venue | When to Read |
|------|-------|-------------|
| `publishers/ieee.md` | IEEE journals/conferences | Target uses IEEE format |
| `publishers/acm.md` | ACM journals/conferences | Target uses acmart |
| `publishers/springer.md` | Springer / LNCS | Target uses Springer template |
| `publishers/elsevier.md` | Elsevier journals | Target uses Elsevier template |
| `publishers/aps.md` | APS (Phys. Rev. family) | Target uses REVTeX |
| `publishers/acs.md` | ACS (JACS, Nano Lett., etc.) | Target uses ACS template |
| `publishers/wiley.md` | Wiley journals | Target uses Wiley template |
| `publishers/nature-portfolio.md` | Nature portfolio journals | Target is any Nature-branded journal |

### Cross-Cutting

| File | When to Read |
|------|-------------|
| `CHECKLIST.md` | Always — universal pre-submission checklist |
| `CONVERSION.md` | Converting between venue formats |
| `INDEX.md` | Venue not listed — find closest match |

## Venue File Standard Format

Every venue file follows this structure for consistency:

```markdown
# [Venue Name]
> Official author guidelines: [URL]

## Article Types
| Type | Word Limit | Display Items | References | Notes |

## Formatting
### Page/Layout
### Font
### Abstract
### Title

## Figures & Tables
### Dimensions
### Resolution
### Formats
### Captions

## References & Citations
### In-text Style
### Reference List Format

## Required Sections

## Templates

## Common Pitfalls
```

## Templates

Bundled LaTeX templates for CS conferences are in `templates/`. See `templates/README.md` for:
- **Bundled**: NeurIPS, ICML, ICLR, ACL, AAAI, COLM, OSDI, NSDI, ASPLOS, SOSP
- **Download instructions**: REVTeX (APS), Nature, ACS, Elsevier, Springer/LNCS, IEEE, ACM

### Using a Template

```bash
# Copy template to paper project
cp -r skills/venue-specific/templates/neurips2025/ project/report/

# Verify compilation before editing
cd project/report/ && latexmk -pdf main.tex
```

**Never modify .sty/.cls files** — only edit .tex content files.

## Rules for the Agent

1. **Read the venue file before giving any formatting advice** — do not rely on memory
2. **Quote specific numbers** (word limits, DPI, dimensions) — never approximate
3. **Flag uncertainty**: if a requirement may have changed, say "verify at [official URL]"
4. **One venue at a time**: if user hasn't specified, ask which venue they're targeting
5. **Never modify venue files** based on guesses — only update with verified information from official author guidelines
6. **Use bundled templates** when starting a new paper — copy from `templates/`, never edit in place
