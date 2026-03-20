# ACM (Base Rules)

> Official author guidelines: https://www.acm.org/publications/proceedings-template

Applies to all ACM journals and SIG conferences unless overridden by venue-specific files.

## Formatting

### Page / Layout
- `acmart.cls` document class
- Formats: `sigconf` (conference), `sigplan` (PLDI/ASPLOS/SOSP), `acmsmall`/`acmlarge` (journals)

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
- Missing CCS concepts
- Missing `\Description{}` tags on figures (accessibility violation)
- Using wrong acmart format (sigconf vs sigplan vs acmsmall)
