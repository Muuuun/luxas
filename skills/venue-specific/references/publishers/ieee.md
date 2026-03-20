# IEEE (Base Rules)

> Official author guidelines: https://www.ieee.org/publications/authors/author-guide.html

Applies to all IEEE journals (TPAMI, TIP, T-ASE, etc.) and conferences (CVPR, ICRA, etc.) unless overridden by venue-specific files.

## Formatting

### Page / Layout
- **Two-column** layout
- US Letter paper (8.5 × 11 in)
- Template: `IEEEtran.cls`

### Font
- Times New Roman (body text)
- 10 pt for conference papers; 9–10 pt for journals

### Abstract
- **150–200 words** typical
- No math, no citations in abstract

### Keywords
- 3–5 terms from IEEE keyword taxonomy

## Figures & Tables

### Dimensions
- Single-column: ~3.5 in (88.9 mm)
- Double-column: ~7.16 in (181.9 mm)

### Resolution
- **300 DPI** minimum; **600 DPI** recommended for line art

### Formats
- EPS, PDF (vector); TIFF, PNG (raster)

### Captions
- Figure captions: **below**
- Table captions: **above**
- Referenced in text before appearing

### Pseudocode
- IEEEtran only recognizes `figure` and `table` as standard floats
- **Do NOT use** dedicated `algorithm` float — use `figure` + `algorithmicx` instead
- Give pseudocode a normal figure caption

## References & Citations

### In-text Style
- Numbered in square brackets: [1], [2–4]

### Reference List Format
- Numbered in order of appearance
- IEEE abbreviation style for journal names
- Include article titles

## Templates
- IEEEtran: https://www.ieee.org/publications/authors/author-guide.html
- Overleaf has maintained IEEEtran templates

## Common Pitfalls
- Using `algorithm` float (not IEEE-safe)
- A4 paper instead of US Letter
- Math or citations in abstract
