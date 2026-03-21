---
name: search
description: Unified academic paper search, citation chains, paper download (arXiv LaTeX/PDF, Sci-Hub), figure extraction from papers, LaTeX source reading, BibTeX fetching, web search, and anti-detect browsing for Cloudflare-protected sites (PRL, Science, Nature, Google Scholar).
compatibility: Requires Node.js 22+. Optional: Python 3.9+ and seleniumbase for sb-browser. PyMuPDF and Pillow for figure extraction.
allowed-tools: Bash(search:*) Bash(sb-browser:*) Bash(extract-figures:*)
---

# Search Skill

All information gathering in one place. Two CLI scripts:

- `scripts/search` — paper search, citations, download, LaTeX source, BibTeX, web search, URL fetch
- `scripts/sb-browser` — anti-detect Chrome browser for Cloudflare-protected sites

## Setup

```bash
bash scripts/setup.sh
```

## scripts/search

### Paper Search

```bash
scripts/search papers "Rydberg atom quantum gate"
scripts/search papers "topological insulators" --source openalex --count 20
scripts/search papers "diffusion models" --source arxiv --count 15
```

- **OpenAlex**: all fields, citation counts, DOIs. `--source openalex`
- **arXiv**: recent preprints, physics/CS/math. `--source arxiv`
- Default: both.

### Citation Chains

```bash
scripts/search citations W2057883617
scripts/search citations "10.1038/s41586-021-03819-2" --direction citations --limit 30
scripts/search citations 2301.07041 --direction references
```

Accepts: OpenAlex ID (W...), DOI, or arXiv ID. `--direction`: citations (forward), references (backward), both (default).

### Paper Download

```bash
scripts/search download --arxiv 2301.07041 --output data/papers
scripts/search download --doi "10.1038/s41586-021-03819-2" --output data/papers
scripts/search download --url "https://example.com/paper.pdf" --output data/papers
```

- arXiv: tries LaTeX source first (tar.gz), falls back to PDF.
- DOI: auto-discovers working Sci-Hub mirror, downloads PDF.
- URL: direct download.
- Default `--output`: `data/papers/`

### LaTeX Source

```bash
scripts/search source 2301.07041
scripts/search source 2301.07041 --papers-dir data/papers --max-chars 50000
```

Downloads if not present, then returns concatenated .tex/.bib content. Much better than PDF for extracting equations, methods, citations.

### BibTeX

```bash
scripts/search bib "10.1038/s41586-021-03819-2"
scripts/search bib "10.1038/s41586-021-03819-2" --save report/references.bib
```

Fetches BibTeX via doi.org content negotiation, falls back to CrossRef. `--save` appends to a .bib file (deduplicates by DOI).

### Web Search (Brave)

```bash
scripts/search web "quantum error correction review 2024" --count 10
```

Requires `BRAVE_API_KEY` env var.

### URL Fetch

```bash
scripts/search fetch "https://example.com/page"
```

Strips HTML to plain text. For Cloudflare-protected sites, use sb-browser instead.

## scripts/sb-browser

Real Chrome with anti-detection fingerprints. Bypasses Cloudflare Turnstile.

```bash
scripts/sb-browser open "https://journals.aps.org/prl/"
scripts/sb-browser snapshot                    # accessibility tree with @refs
scripts/sb-browser fill @e9 "Rydberg atom"     # fill search box
scripts/sb-browser click @e10                  # click search button
scripts/sb-browser get text                    # extract page text
scripts/sb-browser close                       # shutdown
```

### Figure Extraction

```bash
scripts/extract-figures data/papers/2104.10350.pdf
scripts/extract-figures data/papers/2301.07041              # arXiv source dir
scripts/extract-figures data/papers/paper.pdf --output report/figures/extracted
```

- **arXiv source**: Parses `.tex` for `\includegraphics`, copies original figure files (PDF/PNG/EPS). Best quality.
- **PDF**: Renders pages at 200 DPI, detects "Figure N" captions, crops figure regions. Works on both raster and vector figures.
- Outputs a `manifest.json` with figure metadata (filename, caption, page number).
- Use this to extract key figures from papers for inclusion in your report.

## Decision Guide

| Need | Command |
|------|---------|
| Find papers by keyword | `search papers <query>` |
| Chase citation chains | `search citations <id>` |
| Download paper (arXiv) | `search download --arxiv <id>` |
| Download paper (DOI/Sci-Hub) | `search download --doi <doi>` |
| Read LaTeX source | `search source <arxivId>` |
| Get BibTeX citation | `search bib <doi>` |
| General web search | `search web <query>` |
| Fetch unprotected URL | `search fetch <url>` |
| Extract figures from paper | `extract-figures <paper-path>` |
| Cloudflare-protected site | `sb-browser open` → `snapshot` → interact → `get text` |
