# TikZ / LaTeX Pitfalls

## Package conflicts

- **chemfig + tikz-cd**: both redefine `\chemfig`/arrow macros. Don't load both.
  If you need molecular structures AND commutative diagrams in the same paper,
  compile them as separate standalone figures.
- **tikz-feynman + non-LuaLaTeX**: tikz-feynman needs `lualatex` for automatic
  layout. With pdflatex it compiles but layout hints are ignored.
- **quantikz + qcircuit**: quantikz supersedes qcircuit; don't load both.

## Rendering / compilation gotchas

- **Font fallback to DejaVu Sans**: if you don't `\usepackage{helvet}\renewcommand{\familydefault}{\sfdefault}`,
  `\sffamily` may silently pick CM-Sans. For Nature/PRL submission you usually
  want Helvetica-like sans — load `helvet` explicitly.
- **`siunitx` narrow spaces**: `\SI{6.4}{\micro\meter}` renders as "6.4 μm" with
  a thin space. Don't try to fake it with `6.4\,\mu$m` — siunitx is smarter.
- **`braket` vs `physics`**: the `physics` package is banned on arXiv and breaks
  in many compilations. Use `braket` for `\ket{…}`, `\bra{…}`, `\braket{…}`.
- **`\boldmath` inside `\sffamily`**: doesn't always pick up bold math. Use
  `\mathbf{…}` explicitly for vectors in sans-serif.

## matplotlib non-ASCII / CJK rendering

**Preferred fix: use the project's default `report/figstyle.mplstyle`** (deployed
by `init_report` since 2026-05). It already includes the cross-platform CJK
fallback chain plus `pdf.fonttype: 42` for clean PDF text-layer extraction.
Just start your plot script with:

```python
import matplotlib.pyplot as plt
plt.style.use('report/figstyle.mplstyle')
```

The rest of this section is for cases where `figstyle.mplstyle` is unavailable
(one-off exploratory scripts outside `report/`, or projects that pre-date the
default scaffold).

If your plot has Chinese, Japanese, Korean, or any non-Latin glyphs, matplotlib's
default sans-serif (DejaVu Sans) has no CJK coverage and silently falls back to
"豆腐块" (□□□□). Three classic agent failure modes — all three observed in real
runs:

- **Hardcoding `'SimHei'` (Windows-only)** or **`'WenQuanYi Micro Hei'` (Linux-only)**
  → font name not found on macOS → silent fallback to default → tofu.
- **Hardcoding a Linux font path** like `/usr/share/fonts/truetype/wqy/*.ttc` →
  `FontProperties(fname=...)` fails to load on macOS → silent fallback → tofu.
- **Setting `rcParams['font.sans-serif']` AFTER the plt.* calls but BEFORE
  `plt.savefig`**: this actually works (matplotlib resolves text fonts at
  render time, which is savefig). So `rcParams` set anywhere before savefig
  is OK — but per-artist `fontproperties=` arguments are evaluated immediately
  at plot-time, so set rcParams FIRST.

Cross-platform fallback chain — drop in once at the top of any plot script
that contains non-ASCII text (works on macOS, recent Linux distros, and
Windows; first matched font wins):

```python
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = [
    'Arial Unicode MS',     # macOS — covers CJK + Latin
    'Hiragino Sans GB',     # macOS — Chinese-aware Hiragino variant
    'PingFang HK',          # macOS — note: matplotlib does NOT see 'PingFang SC'
    'Heiti TC',             # macOS fallback
    'Noto Sans CJK SC',     # Linux (Noto family is the recommended default)
    'WenQuanYi Micro Hei',  # older Linux distros
    'Microsoft YaHei',      # Windows
    'SimHei',               # Windows fallback
    'DejaVu Sans',          # last resort, ASCII-only — preserves Latin glyphs
]
plt.rcParams['axes.unicode_minus'] = False  # use hyphen-minus instead of U+2212
```

Verify on the running machine before assuming a font exists:

```python
from matplotlib.font_manager import fontManager
have = {f.name for f in fontManager.ttflist}
print(sorted(n for n in have if any(k in n for k in ['PingFang', 'Hiragino', 'Heiti', 'Songti', 'SimHei', 'YaHei', 'Noto Sans CJK', 'Arial Unicode', 'WenQuan'])))
```

Beware: `'PingFang SC'` is the macOS system default but matplotlib's font
discovery does NOT see the SC variant — only `'PingFang HK'`. Don't trust
the name shown in Font Book.

## Hybrid pipeline pitfalls

- **rembg too aggressive on chrome/silver**: objects whose brightness is close
  to white (polished metal, silver, glass) may be removed entirely. Fall back
  to the `_raw.png` (white background blends fine on white paper). The
  `hybrid_gen.py` script detects this (cut size < 10% of raw) and auto-falls back.
- **Nano Banana spells things wrong**: never include any text in the raster
  prompt. All text goes in TikZ overlay.
- **Perspective inconsistency across components**: if tweezer is top-down but
  Paul trap is isometric, they won't visually belong to the same scene. Always
  share a `STYLE` suffix that specifies perspective.
- **Raster PNG embedded in TikZ won't re-flow**: if you resize a node with
  `\includegraphics`, the internal label positions (estimated via `\coordinate`
  offsets) will drift. Prefer tuning the `width=…` once, then freeze.

## `standalone` class quirks

- `\usepackage{subcaption}` inside `standalone`: OK, but the PDF will have
  sub-captions; for "true" cropped-to-content figures, use TikZ `scope`s and
  manual panel labels instead.
- `border=4pt` in `\documentclass[border=4pt]{standalone}` adds a 4pt margin
  around content. Increase if distance labels get clipped.

## Compile iteration

Always run `pdflatex` twice when using tikz labels with `\ref`/`\label` cross-refs
within the same figure (rare but happens). First run creates the `.aux`, second
resolves positions.

For debugging, keep `-interaction=nonstopmode` OFF once — i.e., run
`pdflatex foo.tex` (no flag) — so it stops at the first error with the exact line.
