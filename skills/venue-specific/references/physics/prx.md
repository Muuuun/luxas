# Physical Review X (PRX)

> Official author guidelines: https://journals.aps.org/prx/authors

## Article Types

| Type | Length Limit | Notes |
|------|-------------|-------|
| **Research Article** | No strict page limit | Typically 10–20 journal pages; must justify length |
| **Perspectives** | Invited | Commentary on PRX papers |

## Formatting

### Template
- **REVTeX 4.2** — mandatory
- `\documentclass[aps,prx,twocolumn,superscriptaddress]{revtex4-2}`
- Two-column layout

#### Minimal working template

revtex4-2 requires `\title{}`, `\author{}`, and `\affiliation{}` to appear AFTER `\begin{document}` (NOT in the preamble like `article` class). Putting them in the preamble compiles cleanly but produces a title-less PDF — only a `Class revtex4-2 Warning: No title.` in the log, no error, exit code 0.

```latex
\documentclass[aps,prx,twocolumn,superscriptaddress]{revtex4-2}
\usepackage{amsmath, amssymb, graphicx}
\usepackage{hyperref}

\begin{document}                  % ← critical line

\title{Your Title Here}
\author{First Author}
\affiliation{Institution}

\maketitle

\begin{abstract}
... up to 500 words / 5% of article ...
\end{abstract}

% Body sections (PRX allows freestanding heads, unlike PRL)
\section{Introduction}
...

\bibliography{references}
\end{document}
```

Converting an existing article-class document by editing only `\documentclass` is the most common failure mode — frontmatter must also be moved into the document body. See "Common Pitfalls".

### Abstract
- About **5% of article length**, max **500 words**
- No numbered references, no displayed equations

### Popular Summary
- **Required** before publication — unique to PRX
- **150–250 words**, non-technical
- Understandable by graduate students outside the field
- No mathematical expressions

### Quality Bar
- PRX is highly selective (acceptance rate ~10%)
- Open access (APC required); Creative Commons CC-BY license
- Articles must be written for a broad audience

## Figures & Tables
- Same as PRL (APS base rules apply)
- Single-column: 8.6 cm; Double-column: 17.8 cm
- 600 DPI preferred; EPS/PDF preferred

## References & Citations
- APS `apsrev4-2.bst` style (same as PRL)
- **Article titles required** (mandatory for PRX, unlike PRL where only encouraged)

## Required Sections
- PhySH subject headings
- Acknowledgments
- Supplemental Material (optional)

## Differences from PRL
- No page limit (but must be concise and well-organized)
- Open access with APC (article processing charge)
- Broader scope (interdisciplinary physics)
- Expects significant depth in methods and discussion

## Common Pitfalls
- **`\title`/`\author`/`\affiliation` in the preamble** — revtex4-2 requires these AFTER `\begin{document}`. Article-class convention silently produces a title-less PDF (`Class revtex4-2 Warning: No title.` in `report.log`, no error, exit code 0). Particularly easy to miss when converting an existing article-class document by editing only the `\documentclass` line. See "Minimal working template" above.
- **Trusting `pdflatex` exit code alone** — the build can succeed with broken structure (missing title, undefined refs, unresolved citations). Always grep `report.log` for `Warning:` and `Undefined` after every compile.
- Unnecessarily long papers (no page limit doesn't mean no editing)
- Not meeting the high novelty/significance bar
