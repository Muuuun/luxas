# APS — American Physical Society (Base Rules)

> Official author guidelines: https://journals.aps.org/authors

Applies to all Physical Review journals (PRL, PRA–PRE, PRX, PRResearch, PRApplied, etc.).

## Formatting

### Template
- **REVTeX 4.2** — mandatory for all APS journals
- `\documentclass[aps,prl,twocolumn,superscriptaddress]{revtex4-2}`
- Journal option: `prl`, `pra`, `prb`, `prc`, `prd`, `pre`, `prx`

### Page / Layout
- Two-column layout (default in REVTeX)
- US Letter paper

### Font
- Computer Modern (default); Times via `\usepackage{times}` acceptable

### Abstract
- PRL: must be concise (no strict word limit; ~100–150 words typical)
- Other PR journals: varies

## Figures & Tables

### Resolution
- **600 DPI** preferred; minimum 300 DPI

### Formats
- EPS (preferred), PDF, PNG, TIFF
- PostScript compatible

### Dimensions
- Single-column: 8.6 cm (3.4 in)
- Double-column: 17.8 cm (7.0 in)

### Color
- Free color for online; may incur charges for print (varies by journal)

## References & Citations

### In-text Style
- Numbered in square brackets: [1], [2,3], [4–6]
- REVTeX handles this via `\cite{}`

### Reference List Format
- REVTeX `apsrev4-2.bst` style
- Author names: initials then surname
- Abbreviated journal names (Phys. Rev. Lett., Phys. Rev. A, etc.)
- **Article titles included** (since 2019 APS style change)

## Required Sections
- PACS codes deprecated; use **PhySH** (Physics Subject Headings) instead
- Acknowledgments section
- Supplemental Material (separate upload, linked from main text)

## Templates
- REVTeX 4.2: https://journals.aps.org/revtex
- Overleaf REVTeX template available

## Common Pitfalls
- Using old REVTeX 4.1 instead of 4.2
- PACS codes instead of PhySH
- Not including article titles in references (APS changed policy in 2019)
