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
