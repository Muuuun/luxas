# ACS — American Chemical Society (Base Rules)

> Official author guidelines: https://pubs.acs.org/page/4authors/index.html

Applies to all ACS journals (JACS, Nano Letters, ACS Nano, JPCL, Chem. Rev., etc.).

## Formatting

### Page / Layout
- **US Letter** paper (8.5 × 11 in) — not A4
- Double-spaced for review
- Single-column
- LaTeX class: `achemso.cls` (mandatory for ACS LaTeX submissions)

#### Minimal working template

`achemso.cls` takes the **journal name as a documentclass option** (e.g. `[journal=jacsat]`) which controls layout per ACS journal. Like elsarticle, it uses label-based author/affiliation cross-references. Title/author go AFTER `\begin{document}`.

```latex
\documentclass[journal=jacsat,manuscript=article]{achemso}
% journal options: jacsat (JACS), nalefd (Nano Lett), ancham (Anal. Chem.),
%                  jpclcd (J. Phys. Chem. Lett.), jpccck (JPC C), etc.
% manuscript: article / communication / note / review / suppinfo

\usepackage{amsmath, amssymb, graphicx, chemformula}

\author{First Author}
\affiliation[A]{Department, Institution, City, Country}
\author{Second Author}
\affiliation[B]{Other Institution, City, Country}
\alsoaffiliation[A]{Department, Institution, City, Country}    % joint affiliations
\email{corresponding@institution.edu}                          % corresponding-author email
\phone{+1-555-000-0000}                                        % optional

\title{Your Title Here}

\abbreviations{NMR,DFT,QED}      % macro: define recurring abbreviations
\keywords{keyword1, keyword2}

\begin{document}

\begin{abstract}
... up to 250 words ...
\end{abstract}

% TOC graphic (REQUIRED for most ACS journals)
\begin{tocentry}
\includegraphics[width=\textwidth]{toc-graphic.pdf}
\end{tocentry}

\section{Introduction}
...

\bibliography{references}        % achemso uses its own .bst automatically
\end{document}
```

When converting from `article`: the `\author{Name \\ Affiliation}` pattern doesn't work — must use the label-based `\author{}\affiliation[label]{}\email{}` pattern, AND set the `journal=...` option in documentclass.

### Font
- Figures: **Arial or Helvetica**, minimum **8 pt**

### Abstract
- Max **250 words** (most ACS journals)

## Figures & Tables

### Dimensions
- Single-column: **3.25 in** (8.25 cm)
- Double-column: **7.0 in** (17.8 cm)

### Resolution
- Color/photos: **300 DPI**
- Line art: **600 DPI**

### Formats
- TIFF (preferred), PDF, EPS, CDX (ChemDraw)

### TOC Graphic
- Required for most ACS journals

## References & Citations

### In-text Style
- Superscript Arabic numerals: ¹, ¹⁻³, ¹·²

### Reference List Format
- Numbered in order of appearance
- ACS Style Guide
- **Article titles included**
- Abbreviated journal names

## Required Sections
- Supporting Information (SI)
- ORCID for corresponding author
- TOC Graphic

## Templates
- Word and LaTeX: https://pubs.acs.org/page/4authors/submission/index.html

## Common Pitfalls
- **Missing `journal=...` option in `\documentclass`** — achemso defaults to a generic layout that's wrong for every specific ACS journal. Always set the journal code (e.g. `jacsat` for JACS).
- **Using `\author{Name \\ Affiliation}` (article style)** — achemso requires `\author{}\affiliation[label]{}\email{}` pattern outside the document body's natural author block.
- **Trusting `pdflatex` exit code alone** — achemso warnings (missing TOC graphic, missing email, missing keywords) don't fail the build. Always grep `report.log`.
- A4 paper instead of US Letter
- Figures in wrong font (must be Arial/Helvetica)
- Missing TOC graphic
