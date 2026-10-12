"""Lay three rendered line views out as one drawing on millimetre axes. System Python with matplotlib.

    python3 make_drawing.py <dir with top.png front.png right.png> <out.png>

Called by make_input.py. Extents here must match VIEWS there.
"""
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.image as mpimg
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import MultipleLocator

src, out = sys.argv[1], sys.argv[2]
VIEWS = {
    "top": ((-10, 110), (-10, 70), "x (mm)", "y (mm)", "TOP  (looking down, along -Z)"),
    "front": ((-10, 110), (-10, 60), "x (mm)", "z (mm)", "FRONT  (looking along +Y)"),
    "right": ((-10, 70), (-10, 60), "y (mm)", "z (mm)", "RIGHT  (looking along -X)"),
}
fig = plt.figure(figsize=(15.5, 12.0), dpi=140)
grid = fig.add_gridspec(2, 2, width_ratios=[120, 80], height_ratios=[80, 70], wspace=0.14, hspace=0.2)
cells = {"top": grid[0, 0], "front": grid[1, 0], "right": grid[1, 1]}
for name, ((h0, h1), (v0, v1), hl, vl, title) in VIEWS.items():
    ax = fig.add_subplot(cells[name])
    img = mpimg.imread(f"{src}/{name}.png")[..., :3]
    ink = 1.0 - img.min(axis=2)                       # lines are dark on white paper
    rgba = np.zeros(img.shape[:2] + (4,))
    rgba[..., 3] = np.clip(ink * 1.6, 0, 1)
    ax.xaxis.set_major_locator(MultipleLocator(10)); ax.yaxis.set_major_locator(MultipleLocator(10))
    ax.xaxis.set_minor_locator(MultipleLocator(5)); ax.yaxis.set_minor_locator(MultipleLocator(5))
    ax.grid(which="major", color="#b9c4d0", linewidth=0.7, zorder=0)
    ax.grid(which="minor", color="#dde3ea", linewidth=0.5, zorder=0)
    ax.imshow(rgba, extent=(h0, h1, v0, v1), zorder=3, interpolation="antialiased")
    ax.set_xlim(h0, h1); ax.set_ylim(v0, v1); ax.set_aspect("equal")
    ax.set_xlabel(hl, fontsize=12); ax.set_ylabel(vl, fontsize=12)
    ax.set_title(title, fontsize=13, loc="left")
    ax.tick_params(labelsize=10)
fig.text(0.62, 0.86, "Third-angle projection.\nSolid lines: visible edges.\nDashed lines: hidden edges.\nGrid: 5 mm.",
         fontsize=13, va="top", linespacing=1.6)
fig.savefig(out, bbox_inches="tight", facecolor="white")
