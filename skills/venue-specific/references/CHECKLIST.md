# Universal Pre-Submission Checklist

Use this for **every** venue. Then add venue-specific checks from the relevant file.

## Compilation & Structure
- [ ] Paper compiles without errors or warnings
- [ ] No placeholder text (TODO, FIXME, XXX, TBD)
- [ ] All sections present per venue requirements
- [ ] Page limit respected (check venue file for exact number)

## References & Citations
- [ ] All `\ref{}` resolve (no "??" in output)
- [ ] All `\cite{}` resolve (no undefined citations)
- [ ] Every in-text citation has a corresponding reference entry
- [ ] Every reference entry is cited at least once in text
- [ ] BibTeX entries verified against source (DOI, authors, year, title)
- [ ] No hallucinated references — every citation verified via API or manual check
- [ ] Citation style matches venue (numbered vs author-date, superscript vs brackets)

## Figures & Tables
- [ ] All figures referenced in text before they appear
- [ ] All tables referenced in text before they appear
- [ ] Figure captions below, table captions above (unless venue specifies otherwise)
- [ ] Resolution meets venue minimum (typically ≥300 DPI)
- [ ] Vector format (PDF/EPS) for plots; raster (PNG/TIFF) only for photographs
- [ ] Colorblind-safe palette used
- [ ] Figures readable in grayscale
- [ ] No title inside figure (caption serves this function)
- [ ] Captions self-contained (understandable without main text)
- [ ] Font in figures matches venue requirement (size, family)

## Notation & Language
- [ ] All acronyms defined on first use
- [ ] Consistent notation throughout (same symbol = same meaning)
- [ ] Consistent terminology (don't alternate between synonyms)
- [ ] Equations numbered if referenced; punctuated at end
- [ ] Units in standard form (SI preferred)

## Anonymity (if double-blind)
- [ ] No author names in text, headers, or footers
- [ ] No identifiable affiliations
- [ ] No "our previous work [X]" self-citations
- [ ] PDF metadata cleared (author, creator fields)
- [ ] No institutional logos or URLs
- [ ] Acknowledgments removed or anonymized
- [ ] Supplementary materials anonymized

## Final Checks
- [ ] Abstract within word limit
- [ ] Title within word limit (if any)
- [ ] Correct template/style file used (exact year/version)
- [ ] Spell check completed
- [ ] All co-authors have reviewed and approved
