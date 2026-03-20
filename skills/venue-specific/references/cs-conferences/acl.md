# ACL / EMNLP / NAACL

> Official author guidelines: https://acl-org.github.io/ACLPUB/formatting.html
> Style files: https://github.com/acl-org/acl-style-files

## Article Types

| Type | Page Limit | Notes |
|------|-----------|-------|
| **Long paper** | 8 pages | + unlimited refs and appendix |
| **Short paper** | 4 pages | + unlimited refs and appendix |
| **Demo paper** | 6 pages | System demonstration |

## Formatting

### Page / Layout
- **A4 paper** (not US Letter)
- Two-column layout per `acl.sty`
- Margins: left 2 cm, right 4.5 cm (approximate)

### Font
- Must be one of: NimbusRomNo9L, TeXGyreTermes, TimesNewRomanPSMT
- Main font must account for **>35% of all text** (checked by aclpubcheck)

### Abstract
- No strict word limit

### Template
- **acl.sty** — mandatory
- `acl-style-files` GitHub repo

## Figures & Tables
- Captions below figures, above tables
- Must not bleed into margins (pixel-level check)
- Bottom 2 cm must remain blank

## References & Citations
- Numbered style or author-date (both accepted)
- `\citet{}` / `\citep{}` with natbib

## Required Sections
- **Limitations section** — mandatory
- **Blind review** — double-blind
- **Ethics statement** — if applicable

## Format Checking Tool
- **aclpubcheck**: https://github.com/acl-org/aclpubcheck
- Run on camera-ready PDF (not review version)
- Checks: page size (A4), margins (pixel-level), fonts, page limits

## Common Pitfalls
- Using US Letter instead of A4
- Wrong font family (only specific fonts accepted)
- Text/figures bleeding into margins
- Missing Limitations section
- Running aclpubcheck on the review version (line numbers cause spurious errors)
