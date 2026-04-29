# Elsevier (Base Rules)

> Official author guidelines: https://www.elsevier.com/researcher/author/submit-your-paper

Applies to Elsevier journals (Lancet family, Cell Press, various field journals).

## Formatting

### Page / Layout
- Most Elsevier journals accept any reasonable format at initial submission
- Structured format required at revision/acceptance
- `elsarticle.cls` LaTeX document class available

#### Minimal working template

`elsarticle.cls` uses a label-based author/affiliation system: `\author[label]{...}` cross-references `\affiliation[label]{...}` (or `\address[label]{...}` in older versions). Frontmatter goes inside `\begin{frontmatter}...\end{frontmatter}`, NOT loose after `\begin{document}` like other classes.

```latex
\documentclass[review,12pt]{elsarticle}     % options: review, 1p (single col), 3p (3-col), final
\usepackage{amsmath, amssymb, graphicx, hyperref}

\journal{Journal Name}                      % shows on title page

\begin{document}

\begin{frontmatter}                         % ← elsarticle's title-block container

\title{Your Title Here}

\author[a]{First Author\corref{cor1}}
\ead{first@institution.edu}
\author[a,b]{Second Author}
\author[b]{Third Author}

\affiliation[a]{organization={Department, Institution}, city={City}, country={Country}}
\affiliation[b]{organization={Other Institution}, city={City}, country={Country}}

\cortext[cor1]{Corresponding author}

\begin{abstract}
... 200–300 words, structured if journal requires ...
\end{abstract}

\begin{keyword}
keyword1 \sep keyword2 \sep keyword3
\end{keyword}

\end{frontmatter}                           % ← closes title block

\section{Introduction}
...

\bibliographystyle{elsarticle-num}          % or elsarticle-harv (Harvard)
\bibliography{references}
\end{document}
```

When converting from `article`: the `\author{Name}\\ Affiliation` pattern doesn't work — must use the label-cross-reference idiom and wrap everything in `\begin{frontmatter}`.

### Font
- 12 pt, double-spaced for review

### Abstract
- Varies by journal (structured or unstructured)
- Typically 200–300 words

## Figures & Tables

### Dimensions
- Single-column: **90 mm**
- 1.5-column: **140 mm**
- Double-column: **190 mm**

### Resolution
- Line art: **1000 DPI**
- Halftone (photos): **300 DPI**
- Combination (line + photo): **500 DPI**

### Formats
- TIFF, EPS, PDF preferred
- JPEG acceptable for photographs

### Color
- Free color online; print color may incur charges

## References & Citations
- Varies by journal:
  - Vancouver (numbered) — most medical journals
  - APA — social science journals
  - Harvard — some journals
- Check specific journal

## Required Sections
- Varies heavily by journal
- Cell Press journals have unique requirements (STAR Methods, Key Resources Table)
- Lancet family has strict reporting guidelines

## Templates
- elsarticle: https://www.elsevier.com/researcher/author/policies-and-guidelines/latex-instructions
- Overleaf Elsevier template

## Common Pitfalls
- **Title outside `\begin{frontmatter}`** — elsarticle's frontmatter container is mandatory; without it, the title block is silently malformed.
- **Using `\author{Name \\ Affiliation}` (article style)** — elsarticle requires label-based cross-reference between `\author[label]` and `\affiliation[label]`. Mixing them produces wrong author/affiliation grouping.
- **Trusting `pdflatex` exit code alone** — elsarticle warnings (missing corresponding author, malformed labels) don't fail the build. Always grep `report.log` for `Warning:` and `Undefined`.
- Assuming all Elsevier journals have the same format (they don't)
- Low-resolution line art (Elsevier requires 1000 DPI)
- Not checking if the journal is Cell Press or Lancet family (very different requirements)
