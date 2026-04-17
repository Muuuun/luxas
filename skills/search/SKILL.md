---
name: search
description: Unified academic paper search, citation chains, paper download (arXiv LaTeX/PDF, Sci-Hub), figure extraction from papers, LaTeX source reading, BibTeX fetching, web search, and browser automation for Cloudflare-protected sites (PRL, Science, Nature, Google Scholar).
compatibility: Requires Node.js 22+. Optional: browser-use CLI for browser automation. PyMuPDF and Pillow for figure extraction.
allowed-tools: Bash(search:*) Bash(browse:*) Bash(browser-use:*) Bash(extract-figures:*)
---

# Search Skill

All information gathering in one place. Two CLI tools:

- `scripts/search` — paper search, citations, download, LaTeX source, BibTeX, web search, URL fetch
- `scripts/browse` — browser automation wrapper (uses browser-use with headed + Chrome profile defaults)

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
scripts/search papers "air pollution health effects" --source crossref --count 20
scripts/search papers "quantum error correction" --from-year 2024 --sort date --count 20
# Author-filtered search: use last name as an indexed field, not free text.
# At least one of <query> or --author is required; both together = AND.
scripts/search papers "" --author "Lukin" --from-year 2025 --sort date --count 20
scripts/search papers "neutral atom arrays" --author "Bluvstein" --count 15
```

- **OpenAlex**: all fields, citation counts, DOIs. `--source openalex`
- **arXiv**: recent preprints, physics/CS/math. `--source arxiv`
- **CrossRef**: broadest coverage (120M+ records), all disciplines, non-English journals. `--source crossref`
- Default: all three.
- `--author <LastName>`: Filter by author last name. Maps to arXiv `au:`, OpenAlex `raw_author_name.search`, and CrossRef `query.author` — all indexed fields. Strongly preferred over putting the name in the free-text query, which treats the name as an unweighted keyword and routinely misses the target. Pair with `--from-year` for recent work by a specific researcher.
- `--from-year YYYY`: Only return papers published in YYYY or later.
- `--sort relevance|date`: Sort by relevance (default) or publication date (newest first).

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

**Automatic reader dispatch (arXiv only).** After a successful `search download --arxiv <id>`, a background `reader` is dispatched automatically. It reads the paper's main text + figure manifest and writes two things in a single pass: methodology coverage (A/B/C/D: what's computed, what's demo'd, what goes in figures, what rigor bar) into `notes/methodology.md`, AND a per-paper literature entry (keyed by `cite_key`) into `notes/literature.md`. You never need to launch the reader manually. If it silently misses a paper (hook race, manual drop, DOI download), the research snapshot will surface an `<unprocessed_papers>` reminder asking you to `spawn_agent(agent="reader", ...)` for the gap.

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

### GitHub

```bash
# Repo search — find repositories by keyword
scripts/search github "quantum simulation" --count 10
scripts/search github "transformer inference" --from-year 2024 --sort date

# Code search — find code across public repos (via Sourcegraph)
scripts/search github "func NewRydbergHamiltonian" --code --count 5
scripts/search github "class QuantumCircuit" --code

# Read README — quick overview without cloning
scripts/search github qiskit/qiskit --readme

# Clone repo — shallow clone to local dir for deep analysis
scripts/search github qiskit/qiskit --clone --output /tmp
```

- **Repo search** (default): GitHub REST API. Sorted by stars (default) or `--sort date`. `--from-year YYYY` filters by creation date. Auth via `GITHUB_TOKEN` env var or `gh auth token` (optional, increases rate limit from 10 to 30 req/min).
- **Code search** (`--code`): Sourcegraph streaming API. Supports regex. Searches across most popular public repos. No auth needed.
- **README** (`--readme`): Fetches raw README markdown via GitHub API. Pass `owner/repo` as the query.
- **Clone** (`--clone`): `git clone --depth 1` (latest snapshot only, no history). Default output: `/tmp`. Pass `owner/repo` as the query.

### URL Fetch

```bash
scripts/search fetch "https://example.com/page"
```

Strips HTML to plain text. For Cloudflare-protected sites, use `scripts/browse` instead.

## scripts/browse

Browser automation via browser-use. Always launches in headed mode with the user's real Chrome profile (cookies, fingerprint), so it bypasses Cloudflare and Google Scholar anti-bot.

The daemon persists across commands (~50ms latency after first open). Closed automatically when Luxas exits.

```bash
scripts/browse open "https://journals.aps.org/prl/"
scripts/browse state                           # clickable elements with indices
scripts/browse input 5 "Rydberg atom"          # fill search box by index
scripts/browse click 7                         # click element by index
scripts/browse eval "document.body.innerText"  # extract full page text
scripts/browse close                           # shutdown (optional, auto-closed on exit)
```

### Workflow: extract text from a protected page

```bash
scripts/browse open "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.117.073003"
# If cookie consent appears, click accept:
scripts/browse state                           # find the accept button index
scripts/browse click <accept_index>
# Extract content:
scripts/browse eval "document.querySelector('.abstract')?.innerText"
scripts/browse eval "document.querySelector('h3.title')?.innerText"
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

**Use `scripts/search` first** — it covers most academic needs without a browser:

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
| Find GitHub repos | `search github <query>` |
| Search code across repos | `search github <query> --code` |
| Read repo README | `search github owner/repo --readme` |
| Clone repo for analysis | `search github owner/repo --clone` |

**Use `scripts/browse` only when `search` cannot do the job** — it launches a real browser which is heavier:

| Need | Command |
|------|---------|
| Government reports, policy docs | `browse open <url>` → `eval "document.body.innerText"` |
| Non-academic web content (news, industry) | `browse open <url>` → `state` → interact |
| Cloudflare-blocked page (last resort) | `browse open <url>` → extract content |
| Interactive site requiring login/forms | `browse open <url>` → `state` → `input`/`click` |

**Rule of thumb**: `search` for papers, academic data, and GitHub repos/code; `browse` for everything else (government sites, general web, protected pages). Don't use `browse` for tasks that `search` can handle.
