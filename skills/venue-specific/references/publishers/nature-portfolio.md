# Nature Portfolio (Base Rules)

> Official author guidelines: https://www.nature.com/nature/for-authors/formatting-guide

Applies to all Nature-branded journals (Nature, Nature Physics, Nature Chemistry, Nature Methods, Nature Communications, etc.).

## Formatting

### Initial Submission
- **Single file** (Word or PDF, up to 30 MB) with text + figures together
- No mandatory template at initial submission
- Double-spaced, 12 pt

### Revised / Accepted Manuscript
- LaTeX or Word template required
- Nature LaTeX template available

#### Minimal working LaTeX template (`nature.cls`)

`nature.cls` puts title/author AFTER `\begin{document}`. Author/affiliation linkage uses superscript labels (`\affiliation{}` is NOT used; instead each author has an inline `\affilnum{}` reference).

```latex
\documentclass{nature}
\usepackage{amsmath, amssymb, graphicx}

\begin{document}

\title{Your Title Here}

\author{First Author$^{1}$, Second Author$^{1,2}$ \& Third Author$^{2}$}

\address{
  $^{1}$Department, Institution One, City, Country.\\
  $^{2}$Department, Institution Two, City, Country.
}

\maketitle

\begin{abstract}
... 150 words max, no references ...
\end{abstract}

% Body — Nature uses no section heads in main text; instead bold lead-in lines:
\noindent
\textbf{Lead-in phrase.} Following text...

\section*{Methods}                       % Methods is a starred section (no number)
...

\bibliographystyle{naturemag}
\bibliography{references}
\end{document}
```

Nature's `nature.cls` is **not on CTAN** — download it from Nature's submission portal. When converting from `article`: do NOT use the article-class `\author{Name \\ Affiliation}` pattern; Nature uses inline superscript numbers cross-referenced to `\address{}`. Section heads in main text are uncommon; Nature uses bold lead-in phrases instead.

### Abstract
- **150 words** max (Nature, Nature Physics, Nature Chemistry)
- **200 words** for Nature Communications
- **No references** in abstract

### Title
- No explicit word limit; short and punchy preferred
- No acronyms in title (define in text)

## Figures & Tables

### Dimensions
- **Single-column**: 89 mm
- **Double-column**: 183 mm
- **Full page width**: 183 mm

### Resolution
- **300 DPI** minimum

### Formats
- TIFF, EPS, AI, PDF (vector preferred)

### Font in Figures
- **5–7 pt** sans-serif (Helvetica, Arial)
- Symbol font for Greek characters

### Special Rules
- **No "Scheme" numbering** — use "Figure" for everything
- **Extended Data**: up to 10 figures/tables (online, peer-reviewed)
- Scale bars required (not magnification factors)
- Error bars must be defined in caption

## Methods
- Separate **Online Methods** section
- Max **3,000 words** (Nature Chemistry, Nature Physics)
- Cannot contain figures or tables (use Extended Data)

## References & Citations

### In-text Style
- Superscript Arabic numerals

### Reference List Format
- Numbered in order of citation
- Surname, initials (no period between initials)
- **Article titles included** (upright, sentence case)
- If >5 authors: first author + "et al."
- Nature reference style (unique to Nature portfolio)

## Required Sections
- **Data Availability Statement** — mandatory
- **Code Availability Statement** — if applicable
- **Author Contributions** — mandatory
- **Competing Interests** — mandatory declaration
- **Ethics declarations** — if applicable
- **Supplementary Information** — additional data (less rigorously reviewed than Extended Data)

## Templates
- Nature LaTeX template: https://www.nature.com/documents/nature-template.zip
- Word template available

## Common Pitfalls
- References in the abstract (not allowed)
- Using "Scheme" numbering (Nature doesn't use it)
- Figures in Methods section (use Extended Data instead)
- Exceeding 150-word abstract limit
- Not providing Data/Code Availability statements
