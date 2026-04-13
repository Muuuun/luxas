# Figure Tool Decision Tree

Use this table to pick the right template. If multiple apply, start from `base.tex`
and `\input` / merge elements.

| Need to draw                                       | Template                    | Key packages         |
| -------------------------------------------------- | --------------------------- | -------------------- |
| Quantum circuit (gates, meters, wires)             | `quantikz.tex`              | quantikz             |
| Feynman diagram (particle physics)                 | `feynman.tex`               | tikz-feynman (lualatex) |
| Electronic circuit (R, C, op-amp, diode)           | `circuitikz.tex`            | circuitikz           |
| Molecule / Lewis structure                         | `chemfig.tex`               | chemfig              |
| Chemical equation inline                           | use `\ce{…}` in any doc     | mhchem               |
| Atomic energy levels + transitions                 | `energy_levels.tex`         | tikz, braket         |
| Phase-space trajectory                             | `phase_space.tex`           | pgfplots             |
| 2D data plot (line/bar/heatmap)                    | `pgfplots_2d.tex`           | pgfplots             |
| 3D surface / contour                               | `pgfplots_3d.tex`           | pgfplots             |
| Pulse sequence timing diagram                      | `pulse_sequence.tex`        | tikz                 |
| Flat optical-bench cartoon                         | `optical_setup.tex`         | tikz                 |
| Commutative diagram / category theory              | (use `tikz-cd` directly)    | tikz-cd              |
| Multi-panel concept schematic w/ 3D apparatus      | `hybrid_panels.tex`         | tikz + raster        |

## When to go hybrid (raster + TikZ)

Use hybrid if ANY of:
- The object has a realistic 3D appearance (optical tweezer glow, Paul trap
  perspective, cavity mirror, mouse, molecule rendering)
- Reproducing it in TikZ would take 50+ lines of `\path`/`\fill` patches
- A published paper in the same field uses a similar rendered-apparatus style
  for its first figure

Do NOT use hybrid for:
- Data plots (use pgfplots)
- Symbolic diagrams (quantum circuit, Feynman, energy levels)
- Simple geometric schematics (arrows + boxes + labels)

## Raster-component prompt recipe

Each raster component call should be:
1. **Single isolated object** ("A linear Paul ion trap, nothing else")
2. **No text requested** ("no labels, no captions, no text")
3. **Shared style suffix** across components in one figure (so lighting / palette match)
4. **Strict color specification** (hex codes or vivid color names)
5. **Explicit aspect ratio** and **1024×1024** to maximize resolution

See `hybrid_gen.py --help` and `hybrid_panels.tex` for a worked example.
