"""Compose fig0: Blender scene (a) + vector insets (b) nuclear ladder, (c) CZ scheme.

python3 compose.py RENDER_PREFIX OUT_PREFIX
All drawing is in inches on one axes spanning the 6.5 x 3.0 in figure.
"""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

render, outp = sys.argv[1], sys.argv[2]
plt.rcParams.update({
    "font.family": "Arial", "font.size": 7, "mathtext.fontset": "custom",
    "mathtext.rm": "Arial", "mathtext.it": "Arial:italic", "mathtext.bf": "Arial:bold",
    "pdf.fonttype": 42,
})

W, H = 6.5, 3.0
fig = plt.figure(figsize=(W, H))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W); ax.set_ylim(0, H); ax.set_aspect("equal"); ax.axis("off")

# Schematic convention measured on real level diagrams (see 配色规范.md): levels, state labels and
# all prose are black; colour sits only on the drive arrows (by wavelength) and on the label that
# names that drive. Spontaneous decay is a thin black wavy arrow; virtual levels are dashed grey.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts"))
import colorkey  # noqa: E402  the palette, beam colours and the report's colour key
beam = colorkey.beam
key = colorkey.load_for(outp + ".pdf")   # report/figures/colorkey.json when the figure is written into a report
INK, GREY, LIGHTGREY, ZOOM = "#000000", "#5a5a5a", "#b4b4b4", "#8c8c8c"
RF = key.color("qubit", "m")   # RF has no wavelength colour: it takes the qubit's identity colour (colour key)
L626, L313, LM1 = beam(626), beam(313), beam(2420)
LW_LEVEL, LW_QUBIT, LW_ARROW = 1.5, 1.5, 1.15
FS, FS_S = 7, 6.5


def text(x, y, s, **kw):
    kw.setdefault("color", INK)
    kw.setdefault("fontsize", FS)
    return ax.text(x, y, s, **kw)


def ket(x, y, s, **kw):  # \vert gives a full-height bar; a plain | in Arial reads as l
    return text(x, y, r"$\vert %s\rangle$" % s, **kw)


def letter(x, y, s):
    text(x, y, s, fontsize=8, fontweight="bold", va="top", ha="left")


def arrow(x0, y0, x1, y1, color, lw=LW_ARROW, both=False, ms=7):
    style = "<|-|>" if both else "-|>"
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle=style, mutation_scale=ms,
                                 color=color, lw=lw, shrinkA=0, shrinkB=0))


def wavy(x0, y0, x1, y1, color, n=5, amp=0.03, lw=1.0):
    t = np.linspace(0, 1, 400)
    L = np.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    s = t * (L - 0.07)
    off = amp * np.sin(2 * np.pi * n * t) * np.clip(t * 10, 0, 1) * np.clip((1 - t) * 10, 0, 1)
    xs, ys = x0 + ux * s - uy * off, y0 + uy * s + ux * off
    ax.plot(xs, ys, color=color, lw=lw, solid_capstyle="round")
    arrow(xs[-1], ys[-1], x1, y1, color, lw=lw)


def level(x0, x1, y, color=INK, lw=LW_LEVEL, ls="-"):
    ax.plot([x0, x1], [y, y], color=color, lw=lw, ls=ls, solid_capstyle="butt")


def box(x0, y0, x1, y1):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle="round,pad=0,rounding_size=0.08",
                                fc="white", ec=LIGHTGREY, lw=0.8, zorder=0))


BY1 = 2.96
# ======================= (a) rendered scene =======================
img = plt.imread(render + ".png")
anc = json.load(open(render + ".anchors.json"))
pw, ph = anc["size"]
AX0, AX1, AY1 = 0.0, 2.70, 2.98
scale = (AX1 - AX0) / pw                     # inches per render pixel
AY0 = AY1 - ph * scale
ax.imshow(img, extent=(AX0, AX1, AY0, AY1), zorder=-1, interpolation="none")  # embed at native res


def P(key):  # anchor (render pixels, top-left origin) -> inches
    x, y = anc[key]
    return AX0 + x * scale, AY1 - y * scale


letter(0.02, BY1 - 0.05, "a")
a0, a1 = P("atom0"), P("atom1")
r_atom = abs(P("atom1_edge")[0] - a1[0])
# tweezers: top-left corner, leader to the left beam
bt = P("beam0_top")
text(0.20, 2.80, "1064.5-nm tweezers", ha="left", va="top")
text(0.20, 2.68, "150 µK deep, linear pol.", ha="left", va="top", color=GREY, fontsize=FS_S)
ax.plot([bt[0] - 0.02, bt[0] + 0.06], [2.56, bt[1] - 0.18], color=INK, lw=0.6)
# atom label between the atoms, with short leaders
mx, my = (a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2 + 0.26
text(mx, my, r"$^{161}$Dy", ha="center", va="center", fontsize=7.5)
for a in (a0, a1):
    d = np.array(a) - np.array([mx, my - 0.04])
    d /= np.linalg.norm(d)
    p0 = np.array([mx, my - 0.04]) + d * 0.17
    p1 = np.array(a) - d * (r_atom + 0.03)
    ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=INK, lw=0.6)
# B label under the arrow
tl, tp = P("arrow_tail"), P("arrow_tip")
bx = (tl[0] + tp[0]) / 2 + 0.05
by = min(tl[1], tp[1]) - 0.30
text(bx, by, r"$\mathbf{B}$ = 3,136.8 G", ha="center", va="center", fontsize=7.5)
text(bx, by - 0.13, "clock field", ha="center", va="center", color=GREY, fontsize=FS_S)
# RF: wavefronts from the top right toward the atoms
ox, oy = 2.30, 2.62
th0 = np.arctan2(a1[1] - oy, a1[0] - ox)
for k, rad in enumerate((0.11, 0.19, 0.27)):
    th = np.linspace(th0 - 0.55, th0 + 0.55, 50)
    ax.plot(ox + rad * np.cos(th), oy + rad * np.sin(th), color=RF, lw=1.1, alpha=1 - 0.25 * k,
            solid_capstyle="round")
text(2.66, 2.80, "RF, 1.27 GHz", ha="right", va="top")

# ======================= (b) nuclear ladder =======================
BX0, BX1, BY0, BY1 = 2.78, 4.98, 0.04, 2.96
box(BX0, BY0, BX1, BY1)
letter(BX0 + 0.06, BY1 - 0.05, "b")
text(BX0 + 0.21, BY1 - 0.06, r"$^5I_8$, $m_J = -8$ nuclear ladder", va="top", ha="left")
# zoom lines from the right atom to the box's left corners
for yb in (BY1 - 0.10, BY0 + 0.10):
    ax.plot([a1[0] + r_atom * 0.7, BX0], [a1[1], yb], color=ZOOM, lw=0.6, ls=(0, (2.5, 2)), zorder=-0.5)

ly = np.linspace(0.36, 2.08, 6)        # m_I = -5/2 ... +5/2
LX0, LX1 = 3.52, 3.98
ex_y = 2.50
# 626-nm excited state
level(2.95, LX1, ex_y)
text(3.45, ex_y + 0.09, "626-nm excited state", fontsize=FS_S, va="center", ha="left")
mi = ["−5/2", "−3/2", "−1/2", "+1/2", "+3/2", "+5/2"]
for i, y in enumerate(ly):
    level(2.95 if i == 0 else LX0, LX1, y)
    text(LX1 + 0.04, y, mi[i], fontsize=FS_S, ha="left", va="center")
text(LX1 + 0.04, ly[5] + 0.20, r"$m_I$", fontsize=FS_S, ha="left", va="center")
ket(4.27, ly[5], "1", fontsize=8, va="center")
ket(4.27, ly[4], "0", fontsize=8, va="center")
# qubit RF transition
arrow(LX1 - 0.09, ly[4] + 0.02, LX1 - 0.09, ly[5] - 0.02, RF, both=True, lw=1.4)
text(4.27, (ly[4] + ly[5]) / 2, "RF π\n1,270.66 MHz", color=RF, fontsize=FS_S, va="center", ha="left",
     linespacing=1.05)
# ladder RF pulses (initialise up, read out down)
for i in range(4):
    xa = LX0 + 0.07 + 0.085 * i
    arrow(xa, ly[i] + 0.02, xa, ly[i + 1] - 0.02, RF, both=True, lw=1.0, ms=5.5)
yl = (ly[0] + ly[3]) / 2
text(4.27, yl + 0.13, "4 RF π pulses", color=RF, fontsize=FS_S, va="center")
text(4.27, yl, "↑ initialise", fontsize=FS_S, va="center")
text(4.27, yl - 0.13, "↓ read out", fontsize=FS_S, va="center")
# 626-nm cycle on the bottom rung (imaging) and pumping into it
arrow(2.99, ly[0], 2.99, ex_y, L626, lw=1.2)
wavy(3.10, ex_y, 3.10, ly[0], INK, n=10, amp=0.025, lw=0.7)
text(2.885, (ly[0] + ex_y) / 2, "imaging, 626 nm (closed cycle)", fontsize=FS_S, rotation=90,
     ha="center", va="center")
wavy(3.30, ex_y, 3.30, ly[0], INK, n=10, amp=0.025, lw=0.7)
text(3.40, (ly[0] + ex_y) / 2, "optical pumping, 23 tones", fontsize=FS_S, rotation=90,
     ha="center", va="center")
ket(2.95, ly[0] - 0.16, "{-}8,{-}5/2", fontsize=FS_S, ha="left", va="center")

# ======================= (c) CZ =======================
CX0, CX1 = 5.06, 6.48
box(CX0, BY0, CX1, BY1)
letter(CX0 + 0.06, BY1 - 0.05, "c")
text(CX0 + 0.21, BY1 - 0.06, "CZ gate in 0.24 µs", va="top", ha="left")
text(CX0 + 0.21, BY1 - 0.19, "time-optimal", va="top", ha="left", color=GREY, fontsize=FS_S)
g = 0.48
c0x, c1x, cw = 5.18, 5.82, 0.36   # columns for |0> and |1>
level(c0x, c0x + cw, g)
level(c1x, c1x + cw, g)
ket(c0x + cw / 2, g - 0.14, "0", fontsize=8, ha="center", va="center")
ket(c1x + cw / 2, g - 0.14, "1", fontsize=8, ha="center", va="center")
# M1 shelving of |0>
y57 = 1.62
level(c0x, c0x + cw, y57)
text(c0x + cw / 2, y57 + 0.20, r"$^5I_7$", fontsize=7.5, ha="center", va="center")
text(c0x + cw / 2, y57 + 0.36, "shelved", color=GREY, fontsize=FS_S, ha="center", va="center")
xa = c0x + 0.10
arrow(xa, g, xa, y57, LM1, lw=1.3)
text(xa + 0.05, (g + y57) / 2 + 0.07, "M1", color=LM1, ha="left", va="center")
text(xa + 0.05, (g + y57) / 2 - 0.07, "2.42 µm", color=LM1, fontsize=FS_S, ha="left", va="center")
# two-photon Rydberg excitation of |1>
ymid, yR = 1.32, 2.30
level(c1x, c1x + cw, ymid, color=GREY, lw=0.9, ls=(0, (3, 2)))
level(c1x, c1x + cw, yR)
xb = c1x + 0.10
arrow(xb, g, xb, ymid, L626, lw=1.3)
arrow(xb, ymid, xb, yR, L313, lw=1.3)
text(xb + 0.05, (g + ymid) / 2, "626 nm", color=L626, fontsize=FS_S, ha="left", va="center")
text(xb + 0.05, (ymid + yR) / 2, "313 nm", color=L313, fontsize=FS_S, ha="left", va="center")
text(c1x + cw / 2, yR + 0.19, r"$ns$ Rydberg", ha="center", va="center")
text(c1x + cw / 2, yR + 0.33, r"$n$* ≈ 40", color=GREY, fontsize=FS_S, ha="center", va="center")
text(CX1 - 0.06, BY0 + 0.05, "energies not to scale", fontsize=6, color=GREY, ha="right", va="bottom")

fig.savefig(outp + ".pdf", dpi=600)
fig.savefig(outp + ".png", dpi=300)
print("wrote", outp)
