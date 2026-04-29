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

#### Minimal working template

revtex4-2 differs from `article` in **two** critical ways:

1. **`\title{}`, `\author{}`, `\affiliation{}` must appear AFTER `\begin{document}`** (not in the preamble like article class). Preamble placement compiles cleanly but produces a title-less PDF — revtex emits only `Class revtex4-2 Warning: No title.` in the log, no error.
2. **`\begin{abstract}...\end{abstract}` must come BEFORE `\maketitle`** (not after, like article class). revtex4-2 treats abstract as part of the title-block metadata that `\maketitle` commits — declare title/author/affiliation/abstract first, then call `\maketitle` once at the end of the head block. With the article-class order (`\maketitle` before abstract), the title block renders without an abstract and the abstract content appears as body text where it doesn't belong.

Always start from this skeleton when authoring or class-switching:

```latex
\documentclass[aps,prl,twocolumn,superscriptaddress]{revtex4-2}
\usepackage{amsmath, amssymb, graphicx}
\usepackage{hyperref}

\begin{document}                  % ← critical line

\title{Your Title Here}
\author{First Author}
\affiliation{Institution}
\author{Second Author}
\affiliation{Same or other institution}

\begin{abstract}
... ≤600 chars ...
\end{abstract}

\maketitle                        % ← MUST come AFTER abstract

% Body — use run-in section heads (see "Section Headings" below)
\textit{Introduction}---Text follows here.

\bibliography{references}
\end{document}
```

When converting an existing `\documentclass{article}` document to revtex4-2, you cannot just edit the documentclass line in place — the frontmatter block must also be **moved** from the preamble to immediately after `\begin{document}`. See "Common Pitfalls" below.

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
- **`\title`/`\author`/`\affiliation` in the preamble** — revtex4-2 requires these AFTER `\begin{document}`. The article-class convention (frontmatter in preamble) silently produces a title-less PDF: only a `Class revtex4-2 Warning: No title.` in `report.log`, no error, exit code 0. Particularly easy to miss when converting an existing article-class document by editing only the `\documentclass` line. See "Minimal working template" above.
- **`\maketitle` before `\begin{abstract}`** — revtex4-2's `\maketitle` is a commit point that emits title + authors + affiliations + abstract together. Calling it before the abstract is declared (the article-class default order) leaves the abstract out of the title block and renders the abstract content as ordinary body text. Even with the title block correct, this produces an "abstract-less" front matter. See "Minimal working template" above for the correct order.
- **Trusting `pdflatex` exit code alone** — the build can succeed with broken structure (missing title, missing abstract, undefined refs, unresolved citations). Always grep `report.log` for `Warning:` and `Undefined` after every compile, AND open the rendered PDF to check the front matter visually.
- Exceeding 3,750 words (use PRL length checker)
- Abstract exceeding 600 characters (very common rejection cause)
- Using freestanding section headings (PRL uses run-in style only)
- Using old REVTeX 4.1 instead of 4.2
- PACS codes instead of PhySH
- Page ranges in references (PRL uses first page only)
- Using *ibid.* (no longer accepted)
- Forgetting End Matter option for specialist details (keeps core concise)
