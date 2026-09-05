---
name: matplotlib-figures
description: Publication-quality data plots via matplotlib with venue-specific styles. Use for generating your own figures (timelines, comparison charts, data summaries, heatmaps) that you add to the LaTeX report. Your brain prompt supplies the venue-specific style directory as {{VENUE_SPECIFIC_DIR}} — use that value wherever this skill writes `<VENUE_SPECIFIC_DIR>`.
---

# Matplotlib Figures Skill

## Step 0 — data figures go through `figspec` (mandatory for agents)

`python3 <luxas_root>/skills/matplotlib-figures/scripts/figspec <name>.figspec.json` renders a
declarative spec (series as CSV references, one highlight, reference lines, bands) through a fixed
template that owns style, marker policy, occupancy-aware label placement and legends. Grammar:
`references/figspec_schema.md`. **The grammar is strict (figures v4, 2026-09-05)**: an unknown key is an
error naming the key to use; exit 2 means the figure is not done (a label that could not be placed, more than
five series, a page-tall layout) and `compile_latex` reads the same findings from `<pdf>.figlint.json`.
Energy-level diagrams go through `skills/figure/scripts/levelspec` (grammar
`skills/figure/references/levelspec_schema.md`). The archetype/figlint workflow below remains for figure classes
the spec cannot express (dot matrices, comparison planes); a plain y(x) figure written in raw
matplotlib by an agent is a defect.

All generated figures MUST be publication-quality: load a venue-matched style, save as vector PDF, use colorblind-safe palettes.

## 3-step workflow

### Step 1 — Set up the figure style (once per project)

When you have determined the target venue, copy BOTH the matching matplotlib style template AND the domain style guide to your project (half-upgrading only the mplstyle recreates the figstyle/guide palette divergence). Your brain prompt supplies the venue-specific directory as `{{VENUE_SPECIFIC_DIR}}`:

```bash
cp {{VENUE_SPECIFIC_DIR}}figstyles/<style>.mplstyle report/figstyle.mplstyle
cp <luxas_root>/skills/figure/style_guides/<domain>.md report/figures/style_guide.md
```

**Style map:**

| Venue | Style file | Notes |
|---|---|---|
| Physics (PRL, PRX, APS journals) | `physics-aps.mplstyle` | CM fonts, LaTeX, 600 DPI |
| CS conferences (NeurIPS, ICML, ICLR) | `cs-conferences.mplstyle` | sans-serif, 300 DPI |
| Nature / Science / Cell / PNAS | `nature-science.mplstyle` | Arial, compact, 300 DPI |
| Chemistry (JACS, ACS journals) | `chemistry-acs.mplstyle` | Arial, 300 DPI |

### Step 2 — Use the style in all plotting code

```python
import matplotlib.pyplot as plt
plt.style.use('report/figstyle.mplstyle')
```

### Step 3 — Save as PDF (vector), not PNG

```python
fig.savefig('report/figures/fig_name.pdf')
```

## Archetype-first workflow (mandatory)

Do NOT write a figure from scratch. `references/` holds polished archetypes —
each embodies the design language (`references/DESIGN.md`) and passes figlint:

| archetype | use it for |
|---|---|
| `archetype_comparison.py` | cross-study/scheme rankings; any "who is best and why" (log dot plot + two-quantity plane with iso-product lines) |
| `archetype_scan.py` | any y(x) parameter scan: shaded regimes, direct-labelled lines, annotated crossing |
| `archetype_matrix.py` | sparse categorical counts: dot matrix, zeros white, sorted by totals |

Copy the nearest one, keep every design rule (the comments say which line is
a rule), replace the data. This is the same exemplar discipline as the survey
outline (`skills/review/references/exemplar_survey_outline.md`): imitate the
skeleton, do not re-derive the shape — re-derivation is how the shipped
660×-on-linear and dark-heatmap failures happened.

## figlint — run every plot script through it (mandatory)

Never run a plot script bare. Run it through the mechanical linter that ships with this skill:

```bash
python3 <luxas_root>/skills/matplotlib-figures/scripts/figlint <your_plot_script.py>
```

It executes the script with `savefig` patched and reports, per saved figure:
- **ERROR: text collision** — two labels overlap. Fix positions; a colliding label ships unreadable. (Production audit 2026-08-24: one schematic shipped with FOUR collisions.)
- **ERROR: clipped** — a label extends past the canvas. Enlarge the canvas or move the label; `bbox_inches="tight"` also resolves it.
- **WARN: wide linear axis** — positive data spanning >50× on a linear axis. Small values render invisible; a shipped FOM chart put 1.27 ns next to 840 ns on linear and four of five bars vanished — the report's central comparison. Switch to log, or write one comment line in the script saying why linear is right.

Every ERROR must be fixed before the figure is used. Exit 2 = errors; do not `|| true` it.

## Chart-form rules (from shipped failures, not taste)

- **One axis, one unit.** Never put quantities with different units on a shared axis labelled "Value" — a bar in ns next to a bar in ×10⁻³ compares nothing.
- **Range ratio > 50× ⇒ log scale or broken axis.** See the WARN above.
- **Sparse count matrices are not heatmaps.** A mostly-zero integer matrix rendered as a dark heatmap is 90% ink for 0. Use a dot matrix or a table; give zeros a light neutral, not the colormap floor; and never let a colorbar tick at 0.5 for integer counts.
- **Do not double-encode.** If every cell prints its number, the colormap adds nothing but darkness — pick one encoding, or use color only to group.
- **Annotations must not touch.** If two annotations fight for a spot, move one with a leader line — figlint enforces this mechanically.

## Rules

- **Never** use the default matplotlib style — always load `figstyle.mplstyle`.
- **Format**: PDF (vector) for line plots and diagrams; PNG only for raster data (heatmaps, images).
- **Width**: single-column for most figures; override `figsize` for double-column only when the figure genuinely needs it.
- **Colors**: the palette comes from the style file's `axes.prop_cycle`, pre-aligned to `skills/figure/style_guides/<domain>.md` — don't override it. Red/green adjacent series: differentiate by marker/linestyle too.
- **Tables**: render tabular data with LaTeX `\begin{tabular}`, NOT as matplotlib table images.
- **Fallback**: if `text.usetex` fails (LaTeX not installed), set `text.usetex=False` in the style file.
