# Venue Format Conversion Guide

## Principles

1. **Never copy LaTeX preambles** between templates — start fresh with the target template
2. **Copy ONLY content**: abstract, section text, figures, tables, .bib entries
3. **Re-check page limits** — most conversions require cutting or expanding
4. **Re-check citation style** — numbered vs author-date, superscript vs brackets, article titles included or not

## Common CS Conference Conversions

| From → To | Page Change | Key Adjustments |
|-----------|-------------|-----------------|
| NeurIPS → ICML | 9 → 8 | Cut 1 page; add Broader Impact |
| ICML → ICLR | 8 → 9 | Expand experiments; add LLM disclosure |
| NeurIPS → ACL | 9 → 8 | Restructure for NLP audience; add Limitations section; switch to A4 |
| ICLR → AAAI | 9 → 7 | Significant cuts needed; strict style enforcement |
| Any → COLM | varies → 9 | Reframe for language model focus |

## Journal → Journal Conversions

| From → To | Key Adjustments |
|-----------|-----------------|
| Nature → Science | Restructure (Nature: Methods separate; Science: Methods integrated) |
| JACS Comm. → Angew. Comm. | Switch ACS→Wiley template; remove article titles from refs; CMYK figures |
| Any → Nature family | 150-word abstract; no refs in abstract; no "Scheme" numbering; Extended Data |
| PRL → Nature Physics | REVTeX → Nature template; expand beyond 4 pages; add Methods section |

## Content Migration Checklist
- [ ] Fresh target template (correct year/version)
- [ ] Abstract rewritten to meet new word limit
- [ ] Figures re-exported at target DPI/dimensions
- [ ] References reformatted (or re-generated from .bib)
- [ ] Required sections added (varies by venue)
- [ ] Page limit verified after migration
- [ ] Compilation clean (no warnings from new template)

## When Cutting Pages
- Move proofs and derivations to appendix/supplementary
- Condense Related Work (merge with Introduction if appropriate)
- Combine small tables
- Reduce figure size (but maintain readability)
- Tighten prose (remove hedging, redundancy)

## When Expanding Pages
- Add ablation studies
- Expand Limitations / Discussion
- Include qualitative examples
- Add more related work comparison
- Expand experimental details
