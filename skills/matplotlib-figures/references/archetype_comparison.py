"""ARCHETYPE: cross-study comparison — "who is best, and why".

Adapt this; do not write comparison figures from scratch. Shown with the real
data whose shipped version failed (E1_fom_comparison, 2026-08: bars 1.27-840 ns
on a LINEAR axis — four of five invisible).

Design rules embodied (delete none of them when adapting):
- RANKING, not bars: on a log axis a bar's length is meaningless (its left
  edge is arbitrary), so magnitudes are dots on a log scale, sorted.
- EMPHASIS: the story class gets the one accent color; context is warm grey.
  Color follows the ENTITY class, never the rank.
- DIRECT LABELS, no legend box: five entries label themselves; class is
  stated once per group in the margin, in ink (text never wears data color).
- The DECOMPOSITION panel replaces "two units on one axis labelled Value":
  the tau-epsilon plane on log-log, with iso-FOM diagonals, so the product
  is readable as position and both variables keep their own unit.
- Recessive chrome: left/bottom spines only, light solid grid (never dashed),
  annotations in grey with thin leader lines.
"""
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

for st in ("report/figstyle.mplstyle",):  # project style first, when present
    if Path(st).exists(): plt.style.use(st)

# study, tau_pi (ns), epsilon, single-photon?
DATA = [
    ("Evered 2023 (Rb)",   264, 0.0048, False),
    ("Madjarov 2020 (Sr)",  77, 0.020,  True),
    ("Ma 2023 (Yb)",       330, 0.020,  True),
    ("Levine 2019 (Rb)",   400, 0.050,  False),
    ("Ma 2022 (Rb)",      5600, 0.150,  False),
]
ACCENT, CONTEXT, INK, MUTED = "#0F6BB2", "#9C9490", "#222222", "#7A7570"

rows = sorted(((n, t * e, t, e, s) for n, t, e, s in DATA), key=lambda r: r[1])
fig, (ax, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.4), width_ratios=[1.15, 1])

# ── (a) ranking: FOM = tau*eps, log axis ─────────────────────────────────
y = np.arange(len(rows))
for i, (name, fom, *_rest, single) in enumerate(rows):
    c = ACCENT if single else CONTEXT
    ax.plot([ax.get_xlim()[0], fom], [i, i], color="#E8E5E2", lw=1, zorder=1)
    ax.plot(fom, i, "o", ms=8, color=c, zorder=3)
    ax.annotate(f"{fom:.3g}", (fom, i), xytext=(8, 0), textcoords="offset points",
                va="center", fontsize=8.5, color=INK)
ax.set_xscale("log")
ax.set_yticks(y, [r[0] for r in rows], fontsize=9)
ax.set_xlabel(r"figure of merit $\tau_\pi\,\varepsilon$ (ns)  —  lower is better")
ax.set_xlim(0.8, 3000)
ax.invert_yaxis()
ax.spines[["top", "right"]].set_visible(False)
ax.xaxis.grid(True, color="#EFEDEA", lw=0.8); ax.set_axisbelow(True)
ax.text(0.02, 1.04, "(a)", transform=ax.transAxes, fontweight="bold")
# class statement, once, in the empty top-right corner — replaces a legend
# box (the best entries sit at the LEFT of a lower-is-better log axis, so
# top-right is guaranteed free; figlint confirmed the bottom corner was not)
ax.text(0.98, 0.90, "single-photon", color=ACCENT, fontsize=9,
        ha="right", transform=ax.transAxes)
ax.text(0.98, 0.80, "two-photon", color=MUTED, fontsize=9,
        ha="right", transform=ax.transAxes)

# ── (b) the decomposition: tau-eps plane, iso-FOM diagonals ──────────────
taus = np.array([r[2] for r in rows]); eps = np.array([r[3] for r in rows])
for fom in (1, 10, 100, 1000):
    tt = np.logspace(1.5, 4.4, 50)
    ax2.plot(tt, fom / tt, color="#EFEDEA", lw=0.9, zorder=1)
    # label a diagonal only where it exits through the RIGHT edge inside the
    # y-view; diagonals leaving through the bottom stay unlabelled (the note
    # below explains them) — labelling those pinned them onto each other
    e_edge = fom / 2e4
    if 2.5e-3 < e_edge < 0.4:
        ax2.annotate(f"{fom:g} ns", (2e4, e_edge), fontsize=7, color=MUTED,
                     va="center", ha="left", xytext=(2, 0), textcoords="offset points")
for name, fom, t, e, single in rows:
    c = ACCENT if single else CONTEXT
    ax2.plot(t, e, "o", ms=7, color=c, zorder=3)
    ax2.annotate(name.split(" (")[0], (t, e), xytext=(0, 7),
                 textcoords="offset points", ha="center", fontsize=7.5, color=INK)
ax2.set_xscale("log"); ax2.set_yscale("log")
ax2.set_xlim(30, 2e4); ax2.set_ylim(2e-3, 0.5)
ax2.set_xlabel(r"$\pi$-pulse time $\tau_\pi$ (ns)")
ax2.set_ylabel(r"gate error $\varepsilon$")
ax2.spines[["top", "right"]].set_visible(False)
ax2.text(0.02, 1.04, "(b)", transform=ax2.transAxes, fontweight="bold")
ax2.text(0.03, 0.05, "diagonals: constant $\\tau_\\pi\\varepsilon$",
         transform=ax2.transAxes, fontsize=7.5, color=MUTED)

fig.tight_layout(w_pad=2.0)
fig.savefig("archetype_comparison.png", dpi=200, bbox_inches="tight")
