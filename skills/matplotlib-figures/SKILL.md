---
name: matplotlib-figures
description: Publication-quality data plots via matplotlib with venue-specific styles. Use for generating your own figures (timelines, comparison charts, data summaries, heatmaps) that you add to the LaTeX report. Your brain prompt supplies the venue-specific style directory as {{VENUE_SPECIFIC_DIR}} — use that value wherever this skill writes `<VENUE_SPECIFIC_DIR>`.
---

# Matplotlib Figures Skill

All generated figures MUST be publication-quality: load a venue-matched style, save as vector PDF, use colorblind-safe palettes.

## 3-step workflow

### Step 1 — Set up the figure style (once per project)

When you have determined the target venue, copy the matching matplotlib style template to your project. Your brain prompt supplies the venue-specific directory as `{{VENUE_SPECIFIC_DIR}}`:

```bash
cp {{VENUE_SPECIFIC_DIR}}figstyles/<style>.mplstyle report/figstyle.mplstyle
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

## Rules

- **Never** use the default matplotlib style — always load `figstyle.mplstyle`.
- **Format**: PDF (vector) for line plots and diagrams; PNG only for raster data (heatmaps, images).
- **Width**: single-column for most figures; override `figsize` for double-column only when the figure genuinely needs it.
- **Colors**: use colorblind-friendly palettes (Tol / Wong — already bundled in the style files).
- **Tables**: render tabular data with LaTeX `\begin{tabular}`, NOT as matplotlib table images.
- **Fallback**: if `text.usetex` fails (LaTeX not installed), set `text.usetex=False` in the style file.
