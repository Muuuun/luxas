# Physical Review Letters (PRL)

> Official author guidelines: https://journals.aps.org/prl/authors

## Article Types

| Type | Length Limit | Notes |
|------|-------------|-------|
| **Letter** | **3,750 words** (~4 journal pages) | Excludes abstract, author list, affiliations, refs |
| **End Matter** | Up to **2 additional pages** | Appendices for specialists; does NOT count against 3,750-word limit |
| **Comment** | **750 words** | No abstract required |
| **Reply** | **750 words** | No abstract required |

## Formatting

### Template
- **REVTeX 4.2** — mandatory
- `\documentclass[aps,prl,twocolumn,superscriptaddress]{revtex4-2}`
- Two-column layout, US Letter paper

### Title
- **Title case** (capitalize first letter of each word except conjunctions/prepositions/articles)
- Concise; no acronyms unless widely recognized

### Abstract
- **Max 600 characters** (including spaces) — very strict
- Single paragraph, self-contained
- **No numbered references** (incorporate source info inline, e.g., `[Phys. Rev. A 44, R2775 (1991)]`)
- No displayed equations, no tables, no coined words

### Font
- Computer Modern (default REVTeX); Times via `\usepackage{times}` acceptable

### Section Headings (PRL-specific)
- **No freestanding heads** — use run-in style:
  - Level 1: `*Introduction*---Text follows here` (italic, em dash)
  - Level 2: `Global fit:  Text....` (roman, colon)

### Length Counting
- 3,750 words ≈ 4 journal pages (excluding abstract, authors, refs)
- End Matter: up to 2 additional pages (not counted against limit)
- Use PRL's length-checking tool before submission

## Figures & Tables

### Dimensions
- Single-column: **8.5 cm** (3⅜ in)
- Double-column: **~17.8 cm** (~7.0 in)

### Resolution
- **600 DPI** or higher preferred

### Sizing Requirements
- Symbol width and lettering height: at least **2 mm** at final size
- Data point diameter: at least **1 mm**
- Line weights: at least **0.18 mm (0.5 pt)**

### Formats
- Preferred: **EPS, PS, PDF** (vector)
- Also accepted: JPEG, PNG (for photographs)

### Color
- **Free online color**; print color: $1,090 first figure, $595 each additional
- For color-online / grayscale-print: ensure distinguishable grayscale + use different line styles

### Tables
- Numbered with **Roman numerals** (TABLE I, TABLE II)
- Narrow: 8.6 cm; Medium: 14 cm; Wide: 17.8 cm

## References & Citations

### In-text Style
- Numbered in square brackets: [1], [2,3], [4–6]
- REVTeX handles via `\cite{}`

### Reference List Format
- REVTeX `apsrev4-2.bst` style
- Initials then surname; volume in **bold**; **first page only** (no ranges)
- ≤10 authors: list all; 11–20: may use first + "et al."; >20: must use first + "et al."
- Abbreviated journal names (CASSI standard)
- **Article titles encouraged** (required for PRX/PRApplied/PRResearch)
- *ibid.* no longer used — repeat journal title
- Example: `C. Nadal, S. N. Majumdar, and M. Vergassola, Phys. Rev. Lett. **104**, 110501 (2010).`

## Required Sections
- **PhySH** (Physics Subject Headings) — replaces PACS codes
- Acknowledgments
- Supplemental Material (separate upload, linked from main text)

## Supplemental Material
- No strict length limit
- Uploaded separately; referee-accessible
- Referenced as "See Supplemental Material at [URL]..."
- Can include data files, code, videos

## Common Pitfalls
- Exceeding 3,750 words (use PRL length checker)
- Abstract exceeding 600 characters (very common rejection cause)
- Using freestanding section headings (PRL uses run-in style only)
- Using old REVTeX 4.1 instead of 4.2
- PACS codes instead of PhySH
- Page ranges in references (PRL uses first page only)
- Using *ibid.* (no longer accepted)
- Forgetting End Matter option for specialist details (keeps core concise)
