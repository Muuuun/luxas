# Springer / LNCS (Base Rules)

> Official author guidelines: https://www.springer.com/gp/computer-science/lncs/conference-proceedings-guidelines

## Formatting

### Page / Layout
- **Single-column** layout
- A4 paper
- `llncs.cls` for LNCS proceedings

#### Minimal working template (LNCS)

`llncs.cls` puts title/author AFTER `\begin{document}`. Affiliations use `\institute{...\and ...}` (LNCS-specific macro), and authors are linked to institutes by index, not label.

```latex
\documentclass[runningheads]{llncs}
\usepackage{amsmath, amssymb, graphicx, hyperref}

\begin{document}

\title{Your Title Here}
\titlerunning{Short Title}              % running header (≤45 chars)

\author{First Author\inst{1} \and Second Author\inst{1,2} \and Third Author\inst{2}}
\authorrunning{F. Author et al.}        % running header for authors

\institute{
  Institution One, City, Country \\
  \email{first@institution.edu} \and
  Institution Two, City, Country \\
  \email{third@institution.edu}
}

\maketitle

\begin{abstract}
... 150–250 words ...
\keywords{keyword1 \and keyword2 \and keyword3}
\end{abstract}

\section{Introduction}
...

\bibliographystyle{splncs04}
\bibliography{references}
\end{document}
```

When converting from `article`: the `\author{Name \\ Affiliation}` pattern doesn't work — must use `\author{Name\inst{N}}` indexed against an `\institute{... \and ...}` block, plus add `\titlerunning`/`\authorrunning` for headers.

### Font
- Computer Modern (default LaTeX) or Times
- 10 pt body text

### Abstract
- No strict word limit; typically 150–250 words

### Page Limits
- **Strict** — varies by conference (typically 12–16 pages including refs)
- Camera-ready deadline strictly enforced

## Figures & Tables
- High resolution: **300 DPI** minimum
- Figure captions below, table captions above
- Vector graphics preferred

### Citations
- Numbered: [1]
- Springer Nature BibTeX style

## Templates
- LNCS: https://www.springer.com/gp/computer-science/lncs/conference-proceedings-guidelines
- Overleaf LNCS template available

## Common Pitfalls
- **`\author{Name \\ Affiliation}` (article style)** — LNCS requires `\author{Name\inst{N}}` indexed against `\institute{... \and ...}`. See "Minimal working template".
- **Missing `\titlerunning`/`\authorrunning`** — without these, headers default to truncated full title/author list, often awkwardly.
- **Trusting `pdflatex` exit code alone** — LNCS warnings (running-header overflow, missing email) don't fail the build. Always grep `report.log`.
- Exceeding strict page limit (no exceptions)
- Not using llncs.cls (generic article.cls rejected)
