# Fig. 1 exemplar: rendered scene + vector insets

`preview.png` is the quality target the user picked (2026-11-04/07): the Dy proposal's overview figure.
Panel a is a Blender render. Panels b and c are vector level diagrams drawn over it with zoom lines.
Copy the method, not the geometry.

## Files

- **`scene.py`**: the Blender scene. Run headless:

      blender -b --factory-startup --python-exit-code 1 --python scene.py -- OUT 1.0 256

  - Uses Cycles on the CPU with 4 threads; run it under `nice`. Full resolution takes about 65 s on a Mac mini.
  - The world shader is white for camera rays and dimmed for lighting, so the background prints white while objects stay shaded.
  - Tweezer beams are absorbing/emitting volumes whose density is a Gaussian beam built from math nodes.
  - Atoms take their identity colour from the colour key, converted to linear RGB.
  - Coils are neutral copper.
  - Writes `OUT.png` plus `OUT.anchors.json`, the pixel positions of scene points. The overlay uses these anchors, so labels land on the objects.
- **`compose.py`**: matplotlib in inches on one figure-sized axes.
  - Embeds the render at native resolution (`interpolation="none"`, PDF saved at 600 dpi).
  - Draws labels, leader lines, zoom lines and the two level-diagram insets.
  - Colours come from `skills/figure/scripts/colorkey.py`:
    - drive arrows use `beam(nm)`;
    - RF uses the qubit's identity colour;
    - everything else is black or grey.

      python3 compose.py OUT_OF_SCENE OUT_FIGURE

- **`render.anchors.json`**: anchors of the render used for `preview.png`, so you can test `compose.py` without re-rendering.

## What makes it work

These follow the measurements in `../../figure_types.md`.

- **The picture carries the system**: two atoms in their tweezers, the coils and the field arrow. Nothing in it is decorative.
- **Colour has meaning.**
  - Beams are red because 1064 nm light is red in every corpus diagram.
  - Atoms are the qubit's blue, the same blue the data figures use for |0⟩/|1⟩.
  - Coils are copper because hardware is neutral.
- **Insets follow the corpus level-diagram rules**: black levels and labels, drive arrows coloured by wavelength (626 nm red-orange, 313 nm violet, 2.42 µm dark red), black wavy decays.
- **Text** uses one font (Arial) at 6.5–8 pt, with grey for secondary lines.
- **Panel letters** are bold lowercase without parentheses (Nature style).

## Where it runs

Blender is installed on the Mac only. The droplet, where Luxas runs, has no Blender. Until it is installed there, Luxas runs fall back to the hybrid raster + TikZ route (`../../../templates/hybrid_panels.tex`).
