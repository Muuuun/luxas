# APS — American Physical Society (Base Rules)

> Official author guidelines: https://journals.aps.org/authors

Applies to all Physical Review journals (PRL, PRA–PRE, PRX, PRResearch, PRApplied, etc.).

## Formatting

### Template
- **REVTeX 4.2** — mandatory for all APS journals
- `\documentclass[aps,prl,twocolumn,superscriptaddress]{revtex4-2}`
- Journal option: `prl`, `pra`, `prb`, `prc`, `prd`, `pre`, `prx`

#### Minimal working template

revtex4-2 has **two** structural conventions that differ from `article` — both are silent failures (warning, not error) when violated:

1. **`\title{}`, `\author{}`, `\affiliation{}` go AFTER `\begin{document}`**, not in the preamble. Preamble placement (article-class default) yields a title-less PDF; only `Class revtex4-2 Warning: No title.` in the log.
2. **`\begin{abstract}...\end{abstract}` goes BEFORE `\maketitle`**, not after. revtex's `\maketitle` commits the entire title block including the abstract — if `\maketitle` runs before the abstract is declared, the title block renders without it and the abstract content appears as body text.

Both bite when class-switching from `article` because article's natural order (frontmatter in preamble, `\maketitle` right after `\begin{document}`, then abstract as body) compiles fine in article and silently misrenders in revtex.

```latex
\documentclass[aps,<journal>,twocolumn,superscriptaddress]{revtex4-2}
\usepackage{amsmath, amssymb, graphicx}
\usepackage{hyperref}

\begin{document}                  % ← critical line

\title{Your Title Here}
\author{First Author}
\affiliation{Institution}
\author{Second Author}            % multiple authors / affiliations supported
\affiliation{Same or other}

\begin{abstract}
...
\end{abstract}

\maketitle                        % ← MUST come AFTER abstract

% Body
\bibliography{references}
\end{document}
```

**Multi-author with shared affiliation**: use `superscriptaddress` (in documentclass options) and label affiliations:
```latex
\author{Alice}\affiliation{Univ A}
\author{Bob}\affiliation{Univ A}
```

When converting an existing article-class document, you cannot just edit the documentclass line in place — the frontmatter block must also be **moved** from the preamble to immediately after `\begin{document}`.

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
- **`\title`/`\author`/`\affiliation` in the preamble** — revtex4-2 requires these AFTER `\begin{document}`. Article-class convention silently produces a title-less PDF (`Class revtex4-2 Warning: No title.`).
- **`\maketitle` before `\begin{abstract}`** — revtex4-2's `\maketitle` commits title + authors + affiliations + abstract as one block. Calling it before the abstract leaves the abstract out of the title block; the abstract content then renders as ordinary body text. Both this and #1 above can co-exist (they're independent silent failures from the same article-class-convention import).
- **Trusting `pdflatex` exit code alone** — the build succeeds with broken structure (missing title, missing abstract, undefined refs). Always grep `report.log` for `Warning:` and `Undefined` AND open the rendered PDF to check the front matter visually.
- Using old REVTeX 4.1 instead of 4.2
- PACS codes instead of PhySH
- Not including article titles in references (APS changed policy in 2019)
