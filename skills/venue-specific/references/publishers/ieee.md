# IEEE (Base Rules)

> Official author guidelines: https://www.ieee.org/publications/authors/author-guide.html

Applies to all IEEE journals (TPAMI, TIP, T-ASE, etc.) and conferences (CVPR, ICRA, etc.) unless overridden by venue-specific files.

## Formatting

### Page / Layout
- **Two-column** layout
- US Letter paper (8.5 × 11 in)
- Template: `IEEEtran.cls`

#### Minimal working template

`IEEEtran.cls` puts `\title{}`, `\author{}`, and `\maketitle` AFTER `\begin{document}` (same convention as revtex, NOT article). Affiliation goes inside `\author{}` via `\IEEEauthorblockN`/`\IEEEauthorblockA` (conference) or `\thanks{}` (journal). Choose the right mode option:

- **Journal**: `\documentclass[journal]{IEEEtran}`
- **Conference**: `\documentclass[conference]{IEEEtran}` — different layout, mandatory for ICRA/CVPR/etc.
- **Technote**: `\documentclass[technote]{IEEEtran}`

```latex
\documentclass[conference]{IEEEtran}      % or [journal] / [technote]
\usepackage{cite,amsmath,amssymb,graphicx,algorithmicx}

\begin{document}

\title{Your Title Here}

% Conference-style author block:
\author{\IEEEauthorblockN{First Author}
\IEEEauthorblockA{Department\\Institution\\Email: a@b.c}
\and
\IEEEauthorblockN{Second Author}
\IEEEauthorblockA{Department\\Institution\\Email: x@y.z}}

% Journal-style author block (alternative):
% \author{First Author,~\IEEEmembership{Member,~IEEE,}
%         Second Author,~\IEEEmembership{Senior~Member,~IEEE}
%         \thanks{Manuscript received ...; revised ...}
%         \thanks{F. Author is with Dept., Univ., City, Country (e-mail: a@b.c).}}

\maketitle

\begin{abstract}
... 150–200 words, no math, no citations ...
\end{abstract}

\begin{IEEEkeywords}
keyword1, keyword2, keyword3
\end{IEEEkeywords}

\section{Introduction}
...

\bibliographystyle{IEEEtran}
\bibliography{references}
\end{document}
```

When converting from `article`, do NOT just edit the documentclass — IEEEtran requires title/author **inside** the document, and the author block syntax is different from `\author{Name \\ Affiliation}`.

### Font
- Times New Roman (body text)
- 10 pt for conference papers; 9–10 pt for journals

### Abstract
- **150–200 words** typical
- No math, no citations in abstract

### Keywords
- 3–5 terms from IEEE keyword taxonomy

## Figures & Tables

### Dimensions
- Single-column: ~3.5 in (88.9 mm)
- Double-column: ~7.16 in (181.9 mm)

### Resolution
- **300 DPI** minimum; **600 DPI** recommended for line art

### Formats
- EPS, PDF (vector); TIFF, PNG (raster)

### Captions
- Figure captions: **below**
- Table captions: **above**
- Referenced in text before appearing

### Pseudocode
- IEEEtran only recognizes `figure` and `table` as standard floats
- **Do NOT use** dedicated `algorithm` float — use `figure` + `algorithmicx` instead
- Give pseudocode a normal figure caption

## References & Citations

### In-text Style
- Numbered in square brackets: [1], [2–4]

### Reference List Format
- Numbered in order of appearance
- IEEE abbreviation style for journal names
- Include article titles

## Templates
- IEEEtran: https://www.ieee.org/publications/authors/author-guide.html
- Overleaf has maintained IEEEtran templates

## Common Pitfalls
- **Wrong documentclass mode** — `[conference]`, `[journal]`, `[technote]` produce different layouts. Mismatched mode silently looks "almost right" but fails camera-ready check.
- **`\title`/`\author` in the preamble** — IEEEtran wants them AFTER `\begin{document}`. Article-class style compiles but produces a broken title block.
- **Wrong author block macros** — conference uses `\IEEEauthorblockN`/`\IEEEauthorblockA`; journal uses `\thanks{}` for affiliations. Mixing them produces malformed output.
- **Trusting `pdflatex` exit code alone** — IEEEtran emits warnings (not errors) for many class-rule violations. Always grep `report.log` for `Warning:` and `Undefined`.
- Using `algorithm` float (not IEEE-safe)
- A4 paper instead of US Letter
- Math or citations in abstract
