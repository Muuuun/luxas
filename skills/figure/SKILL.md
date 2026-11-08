---
name: figure
description: Publication figures whose style follows what real papers do, by figure type, position in the paper and venue, with one colour key per report so an identity keeps its colour in every figure. Routes data figures to figspec, energy-level diagrams to levelspec, the Fig. 1 overview to a rendered scene (Blender, or Nano Banana raster + TikZ) with vector insets, and other schematics to TikZ templates (quantum circuits, Feynman diagrams, circuits, molecules, pulse sequences, optical setups). The palette, drive colours by wavelength and the colour key live in scripts/colorkey.py.
compatibility: Requires pdflatex + pdftoppm on PATH. Blender (optional) for rendered Fig. 1 scenes. Python 3.10+ with google-genai, rembg[cpu], Pillow for the hybrid raster route; GEMINI_API_KEY for raster generation.
allowed-tools: Bash(python:*) Bash(pdflatex:*) Bash(pdftoppm:*) Bash(pdfimages:*) Bash(blender:*)
---

# Figure Skill

The style rules here are measured, not chosen. They come from 10,597 figures in the 1,168 papers
Luxas has downloaded, with 208 level diagrams read one by one. Numbers and sources are in
`references/figure_types.md`. Read that file before drawing a figure of a kind you have not drawn in
this report.

## Four rules for every figure

1. **One colour key per report.** An identity (a species, spin up, |0⟩, "measured", a named scheme)
   has one hue family in every figure. figspec and levelspec claim and read it in
   `report/figures/colorkey.json`. The palette itself is plain hex. A hand-written figure draws with
   the hex values directly and asks the key only which family an identity has:

   ```python
   import sys; sys.path.insert(0, "<luxas_root>/skills/figure/scripts"); import colorkey as ck
   ck.BLUE, ck.BLUE_D, ck.BLUE_L, ck.BLUE_P      # "#3B7CAE" "#174F75" "#A3C1E2" "#E4ECF6": line, text/edge, fill, band
   ck.PALETTE["red"]["m"], ck.HEX["grey.g5"]     # the same table, by name
   ck.BEAM["red_orange"], ck.beam(626)           # drive colour: "#E0561F"
   fam = ck.load_for("report/figures/fig3.pdf").family("Dy")   # "blue": the family the report gave Dy
   ax.plot(x, y, color=ck.PALETTE[fam]["m"])
   ```

   In TikZ, copy the palette block from `templates/base.tex` (`lxBlue`, `lxBlueD`, `beamOrange`, …).
   The full hex tables are in `references/palettes.md`.
2. **Schematics are black.** Levels, state labels, text and decays are black. A drive arrow or beam
   takes the colour of its wavelength (`colorkey.beam(nm)`: UV purple → 626 nm red-orange → >1 µm
   dark red). Atoms and other objects take their identity colour from the key. Nothing else gets
   colour. 83% of corpus level diagrams have black levels and 88% black labels.
3. **Data figures carry at most two hue families per panel, plus grey.** Text is black (85% of
   corpus data figures). Use grey for theory, references and controls; one family light to dark for
   an ordered sweep. Draw a band only for uncertainty or a region (85% of figures have none).
4. **Fig. 1 is the overview, later figures are results.**
   - Fig. 1 holds the picture of the system, the level scheme and at most one headline result. 55%
     of Fig. 1s contain a render or photo; 40% contain a level diagram or setup.
   - From Fig. 2 on, 82–88% of figures are data figures in the same key.
   - SI figures use the same key.

The venue changes typography and geometry, not colour: fonts, panel-letter style, widths. These
come from the venue's mplstyle. See `references/figure_types.md` §4.

## Route by figure type

| What you are drawing | Route | Colour |
|---|---|---|
| Data: lines, points, bands, heatmaps, polar | `skills/matplotlib-figures/scripts/figspec` (strict spec) | key families per `group` / series label; `"ordered": true` for sweeps |
| Energy-level diagram | `scripts/levelspec` (strict spec, `references/levelspec_schema.md`) | black levels; drives by the wavelength in their label; `identity` for a coloured level or an RF drive |
| Fig. 1 overview with a rendered system (tweezers, trap, cavity, apparatus) | Blender scene + vector insets: `references/exemplars/fig1_blender/` | beams by wavelength, atoms by identity, hardware neutral |
| …when Blender is not on PATH | hybrid: Nano Banana raster + TikZ (`templates/hybrid_panels.tex`, below) | same |
| Flat setup / optical bench | `templates/optical_setup.tex` | beams by wavelength |
| Pulse sequence | `templates/pulse_sequence.tex` | each row in its beam's colour |
| Quantum circuit, Feynman, circuit, molecule | `templates/quantikz.tex`, `feynman.tex`, `circuitikz.tex`, `chemfig.tex` | black, one accent at most |
| Phase space, analytic 2D/3D plot | `templates/phase_space.tex`, `pgfplots_2d.tex`, `pgfplots_3d.tex` | key families |

Every template starts with the same palette block, generated from `scripts/colorkey.py`.
`smoke_colorkey` refuses any other hex in a template.

`figlint-pdf` (run on every figure, and by `compile_latex`) warns `off-palette colour` for any vector line,
fill or text colour outside the palette, whichever tool drew it. Heatmaps use the palette maps
`lx_<family>` (sequential) and `lx_bluered` (signed, the default).

## Fig. 1 with a rendered scene

The exemplar `references/exemplars/fig1_blender/` is the quality target. Its `preview.png` is the
figure the user chose.

1. **Render.** `scene.py` builds the system in Blender (Cycles, CPU, 4 threads, under `nice`). It
   writes the render and an anchors JSON with the pixel positions of the objects.
2. **Draw over the render.** `compose.py` draws labels, leader lines, zoom lines and level-diagram
   insets in matplotlib, in inches. The render is embedded at native resolution.
3. **Look.** Open the PNG. Check that labels sit on their objects and that nothing touches the
   insets.

Blender is on the Mac, not on the droplet. Without it, use the hybrid route.

## The hybrid route (raster component + TikZ)

```
1. decide which elements are raster (3D / textured / glossy) vs vector (everything else)
2. for each raster element:
     python skills/figure/scripts/hybrid_gen.py --name <n> --prompt "<object>" --style "<shared suffix>" --out assets/<n>.png
   → isolated object on white, rembg → transparent PNG
3. figure_X.tex from templates/hybrid_panels.tex: \includegraphics for raster slots, TikZ for every label and arrow
4. pdflatex figure_X.tex; pdftoppm -r 200 figure_X.pdf preview -png
5. Read the preview → fix → recompile (≤ 3 iterations)
```

Raster prompts ask for no text. Every component of one figure shares the same style suffix. Name
colours in the prompt from the key and the beam table, never as "vivid".

## Strict rules (as illustrator)

- Never originate content: data, physics and parameters come from the brief.
- LaTeX symbols are TikZ- or matplotlib-native, never rendered into a raster.
- Colour comes from the key and the beam table. Do not pick a hex by eye, and do not restyle a
  figure to a domain guide's hex codes.

## References

- `references/figure_types.md`: the measured rules by type, position and venue.
- `references/levelspec_schema.md`: level-diagram grammar.
- `references/palettes.md`: the palette, tints, beam colours and colour-blind distances.
- `references/exemplars/fig1_blender/`: the overview-figure exemplar.
- `references/decision_tree.md`: templates by drawing type.
- `references/pitfalls.md`: package conflicts, font fallbacks.
- `references/level_diagram_tally.tsv`: the 208 level diagrams as read.

## Scripts

- `scripts/colorkey.py`: palette, `beam(nm)`, wavelength parsing, the report colour key
  (`python3 colorkey.py [key.json]` prints it).
- `scripts/levelspec`: level diagrams.
- `scripts/hybrid_gen.py`: Gemini image generation + rembg.
  CLI: `--name --prompt --style --out [--model gemini-2.5-flash-image] [--no-rembg]`.
