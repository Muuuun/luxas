# Figure Style Templates

Matplotlib `.mplstyle` files for publication-quality figures. Each template sets font, sizing, DPI, colors, and line weights to match venue requirements.

## Style Map

| Style File | Target Venues |
|-----------|---------------|
| `physics-aps.mplstyle` | PRL, PRX, PRA-PRE, Nature Physics (CM fonts, LaTeX, 600 DPI) |
| `cs-conferences.mplstyle` | NeurIPS, ICML, ICLR, CVPR, ACL, AAAI (sans-serif, 300 DPI) |
| `nature-science.mplstyle` | Nature, Science, Cell, PNAS, eLife (Arial, compact, 300 DPI) |
| `chemistry-acs.mplstyle` | JACS, Nano Lett, ACS Nano, Chem Rev (Arial, compact, 300 DPI) |

## Usage

```python
import matplotlib.pyplot as plt
plt.style.use('/path/to/figstyle.mplstyle')
# or after copying to report/:
plt.style.use('report/figstyle.mplstyle')
```

## Column Widths (for figsize)

| Venue | Single Column | Double Column |
|-------|--------------|---------------|
| APS (PRL/PRX) | 3.375 in (8.6 cm) | 7.0 in (17.8 cm) |
| NeurIPS/ICML | 5.5 in (full text width) | — |
| Nature | 3.5 in (89 mm) | 7.2 in (183 mm) |
| ACS | 3.25 in (8.3 cm) | 6.73 in (17.1 cm) |

For double-column figures, override figsize:
```python
fig, ax = plt.subplots(figsize=(7.0, 3.5))  # APS double-column
```
