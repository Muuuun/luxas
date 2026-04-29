# ACM (Base Rules)

> Official author guidelines: https://www.acm.org/publications/proceedings-template

Applies to all ACM journals and SIG conferences unless overridden by venue-specific files.

## Formatting

### Page / Layout
- `acmart.cls` document class
- Formats: `sigconf` (conference), `sigplan` (PLDI/ASPLOS/SOSP), `acmsmall`/`acmlarge` (journals)

#### Minimal working template

`acmart.cls` is unusually strict — it MANDATES several preamble commands (`\setcopyright`, `\acmConference`, `\acmDOI`, `\acmISBN`) that produce hard errors or copyright-block warnings if missing. Title/author go AFTER `\begin{document}`. CCS concepts must be in `\begin{CCSXML}...\end{CCSXML}` blocks, NOT inline.

```latex
\documentclass[sigconf]{acmart}        % or [acmsmall], [acmlarge], [sigplan], [manuscript]
\usepackage{booktabs}                   % acmart already loads many; add only what you need

% ── REQUIRED preamble commands (acmart errors without these) ──
\setcopyright{acmcopyright}             % or acmlicensed / rightsretained / cc-by / etc.
\acmConference[Conference Acronym]{Full Conference Name}{Date}{Location}
\acmISBN{978-1-4503-XXXX-X/YY/MM}
\acmDOI{10.1145/XXXXXXX.XXXXXXX}
\copyrightyear{2026}
\acmYear{2026}

% Optional: suppress the "ACM Reference Format" block (anonymous review etc.)
% \settopmatter{printacmref=false, printccs=false, printfolios=true}

\begin{document}

\title{Your Title Here}

\author{First Author}
\affiliation{%
  \institution{Institution Name}
  \city{City}
  \country{Country}
}
\email{first@institution.edu}

\author{Second Author}
\affiliation{%
  \institution{Institution Name}
  \city{City}
  \country{Country}
}
\email{second@institution.edu}

\renewcommand{\shortauthors}{Author1 et al.}      % running header

\begin{abstract}
...
\end{abstract}

% ── CCS Concepts (REQUIRED for proceedings) ──
\begin{CCSXML}
<ccs2012>
   <concept>
       <concept_id>10010520.10010553.10010562</concept_id>
       <concept_desc>Computer systems organization~Embedded systems</concept_desc>
       <concept_significance>500</concept_significance>
   </concept>
</ccs2012>
\end{CCSXML}
\ccsdesc[500]{Computer systems organization~Embedded systems}

\keywords{keyword1, keyword2, keyword3}

\maketitle

\section{Introduction}
...

% ── Figures need \Description{} for accessibility ──
\begin{figure}
  \includegraphics{fig.pdf}
  \caption{Caption text.}
  \Description{Plain-text alt description for screen readers.}
\end{figure}

\bibliographystyle{ACM-Reference-Format}
\bibliography{references}
\end{document}
```

When converting from `article`: do not just edit `\documentclass` — you must add ALL the required preamble commands (acmart errors out without them in non-anonymous mode), restructure `\author{}` into the `\affiliation{...}\email{...}` blocks, and add `\Description{}` tags to every figure.

### Font
- Defined by acmart.cls — Libertine (default)

### Abstract
- No strict word limit; keep concise

## Figures & Tables
- Captions below figures, above tables
- `\Description{}` tag required for accessibility

### Special
- **CCS concepts** required (ACM Computing Classification System)
- **Keywords** required
- **Accessibility** requirements (alt text for figures)

## References & Citations
- ACM Reference Format (author-date or numbered, depending on venue)
- BibTeX with `acmart` style

## Templates
- acmart: https://www.acm.org/publications/proceedings-template

## Common Pitfalls
- **Missing required acmart preamble commands** (`\setcopyright`, `\acmConference`, `\acmDOI`, `\acmISBN`) — produces hard errors or a placeholder copyright block. See "Minimal working template".
- **`\title`/`\author` in the preamble** — acmart wants them AFTER `\begin{document}`. Article-class style produces broken title block.
- **Wrong format option** (`sigconf` vs `sigplan` vs `acmsmall`) — silently produces wrong layout that fails camera-ready.
- **Trusting `pdflatex` exit code alone** — acmart emits warnings (not errors) for missing CCS, missing `\Description{}`, missing `\copyrightyear`. Always grep `report.log`.
- Missing CCS concepts (CCSXML block + `\ccsdesc`)
- Missing `\Description{}` tags on figures (accessibility violation; warning only)
