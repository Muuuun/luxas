"""ARCHETYPE: quantity vs parameter — "where does the behavior change".

Adapt this for any y(x) scan (blockade leakage vs angle, fidelity vs power,
error vs distance). Design rules embodied:
- Lines are direct-labelled AT THEIR ENDS; no legend box to cross-reference.
- The regime that matters is a SHADED BAND with its name in grey ink — the
  reader is told where to look, not left to infer it.
- The crossing/threshold is annotated with a thin leader line, text in ink.
- Emphasis: the series the caption talks about is the accent; alternatives
  are grey. Color follows the entity, never the rank.
- Log y when the quantity spans decades (figlint warns if you forget).
"""
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

for st in ("report/figstyle.mplstyle",):
    if Path(st).exists(): plt.style.use(st)

ACCENT, CONTEXT, INK, MUTED = "#0F6BB2", "#9C9490", "#222222", "#7A7570"
th = np.linspace(0, 90, 400)                       # angle theta (deg)
p2_bare = 0.248 * np.exp(-((th - 0) / 28) ** 2) + 0.02   # illustrative shapes
p2_dressed = 0.05 * np.exp(-((th - 0) / 45) ** 2) + 0.008

fig, ax = plt.subplots(figsize=(5.2, 3.4))
ax.axvspan(0, 25, color="#F4F1EE", zorder=0)
ax.text(12.5, 0.4, "weak-blockade\nregime", ha="center", fontsize=8.5, color=MUTED)

ax.plot(th, p2_bare, color=ACCENT, lw=2)
ax.plot(th, p2_dressed, color=CONTEXT, lw=2)
# direct labels at the line ends — never a legend box for 2-3 series
ax.annotate("bare", (th[-1], p2_bare[-1]), xytext=(6, 0),
            textcoords="offset points", va="center", color=ACCENT, fontsize=9)
ax.annotate("dressed", (th[-1], p2_dressed[-1]), xytext=(6, 0),
            textcoords="offset points", va="center", color=MUTED, fontsize=9)
# annotate the claim, with a leader line, in ink
i = int(np.argmin(np.abs(th - 15)))
ax.annotate("peak leakage 0.25\nat the axis", (th[i], p2_bare[i]),
            xytext=(52, 0.18), textcoords="data", fontsize=8.5, color=INK,
            arrowprops=dict(arrowstyle="-", lw=0.7, color=MUTED))

ax.set_yscale("log")
ax.set_xlim(0, 100); ax.set_ylim(5e-3, 0.6)
ax.set_xlabel(r"interatomic angle $\theta$ (deg)")
ax.set_ylabel(r"double-excitation $p_2$")
ax.spines[["top", "right"]].set_visible(False)
ax.yaxis.grid(True, color="#EFEDEA", lw=0.8); ax.set_axisbelow(True)
fig.savefig("archetype_scan.png", dpi=200, bbox_inches="tight")
