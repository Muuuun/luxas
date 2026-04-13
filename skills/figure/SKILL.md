---
name: figure
description: Hybrid figure pipeline (Nano Banana raster + rembg background removal + TikZ vector assembly). Includes a TikZ template library covering quantum circuits (quantikz), Feynman diagrams (tikz-feynman), circuits (circuitikz), molecules (chemfig), 2D/3D plots (pgfplots), energy-level diagrams, phase-space trajectories, optical setups, and pulse sequences. Use this skill to produce publication-quality figures with perfect LaTeX symbol rendering and agent-friendly iteration.
compatibility: Requires pdflatex + pdftoppm on PATH. Python 3.10+ with google-genai, rembg[cpu], Pillow. GEMINI_API_KEY env var for raster generation.
allowed-tools: Bash(python:*) Bash(pdflatex:*) Bash(pdftoppm:*) Bash(pdfimages:*)
---

# Figure Skill

Publication-quality figures via the hybrid pipeline: let Gemini (Nano Banana) render
photorealistic / textured / 3D components, let TikZ own all symbols, arrows, labels,
equations, and layout. You get the visual richness of AI rendering AND the precision
of code.

## When to use which backend

```
┌─────────────────────────────────────────────────────────────────┐
│  What are you drawing?                          │ Backend       │
├─────────────────────────────────────────────────┼───────────────┤
│  Data plot (lines, bars, heatmaps from data)    │ pgfplots      │
│  Quantum circuit (Hadamard, CNOT, measure)      │ quantikz      │
│  Feynman diagram                                │ feynman       │
│  Molecule / Lewis structure                     │ chemfig       │
│  Electronic circuit (op-amp, RLC)               │ circuitikz    │
│  Atomic energy levels + transitions             │ energy_levels │
│  Phase-space trajectory                         │ phase_space   │
│  Pulse sequence (NMR / qubit timing)            │ pulse_sequence│
│  Optical bench cartoon (2D, flat)               │ optical_setup │
│  Concept schematic with textured 3D objects     │ HYBRID        │
│    (Paul trap, cavity, apparatus, animal etc.)  │               │
└─────────────────────────────────────────────────────────────────┘
```

For HYBRID, pick raster components sparingly: only for textured / 3D / glossy
objects where TikZ would take 50+ lines of patches. Everything else → TikZ.

## The hybrid pipeline

```
1. decide which elements are raster (3D/textured/glossy) vs vector (everything else)
2. for each raster element:
     python skills/figure/scripts/hybrid_gen.py \
       --name <outName>  --prompt "<object spec>"  --style "<style suffix>" \
       --out assets/<outName>.png
   → generates isolated-object PNG on white bg, then rembg → transparent PNG
3. write figure_X.tex starting from skills/figure/templates/<best>.tex
     - \includegraphics{assets/<outName>.png} for raster slots
     - TikZ \draw \node for all labels, arrows, equations
4. compile:    pdflatex figure_X.tex
   preview:    pdftoppm -r 200 figure_X.pdf preview -png
5. Read preview-1.png (vision) → find issues → edit .tex → recompile (≤3 iters)
6. final output: figures/figure_X.{tex,pdf}
```

## Style consistency

ALWAYS check `figures/style_guide.md` first (if it exists) for mandatory palette,
fonts, line weights. If absent, default to Okabe-Ito (see `references/palettes.md`).

Before starting, look at existing figures/*.png via Read — match their palette,
font family, and panel-label style exactly.

## Strict rules (when using this skill as illustrator)

- Never originate content decisions (what data, what physics, what params).
- Only make style/composition/rendering decisions.
- LaTeX symbols (\ket{r}, F_{C_4}, \mu m, etc.) MUST be TikZ-native — never
  rely on Nano Banana to render text correctly (it can't).
- Raster components must have NO text in the prompt ("no labels, no captions").
- Raster components must have consistent style suffix across a figure for
  lighting/palette coherence.

## Templates

See `templates/` for starting points. Each is a complete `\documentclass{standalone}`
ready to compile. Pick the closest match, copy to figures/, edit.

## References

- `references/decision_tree.md` — full decision flow for tool selection
- `references/palettes.md` — Okabe-Ito, Nature, Tableau colorblind-safe palettes
- `references/pitfalls.md` — package conflicts (chemfig vs tikz-cd), font fallbacks, common bugs

## Scripts

- `scripts/hybrid_gen.py` — Gemini image generation + rembg background removal.
  CLI: `--name --prompt --style --out [--model gemini-2.5-flash-image] [--no-rembg]`
- `scripts/requirements.txt` — Python deps

## First-time setup

```bash
cd skills/figure
pip install -r scripts/requirements.txt
export GEMINI_API_KEY=...   # if not already set
```
