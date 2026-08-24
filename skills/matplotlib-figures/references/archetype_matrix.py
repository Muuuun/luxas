"""ARCHETYPE: sparse categorical matrix — "which combinations exist".

The replacement for the shipped failure: a mostly-zero count matrix rendered
as a dark heatmap (90% of ink spent on zero, colorbar ticked at 0.5 for
integer counts, numbers duplicating the colormap). Design rules embodied:
- Zeros are ABSENCE: white cell, no mark. Ink goes only where data is.
- One encoding: dot AREA carries the count; the number sits inside larger
  dots only. No colorbar for small integers.
- Hairline grid; labels in ink; spines off, ticks off.
- Row/column ordering is by marginal totals (busiest first), never
  alphabetical — the ordering IS information.
"""
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

for st in ("report/figstyle.mplstyle",):
    if Path(st).exists(): plt.style.use(st)

ACCENT, INK, MUTED = "#0F6BB2", "#222222", "#7A7570"
rows = ["open-system bath", "vibronic transfer", "interface transfer",
        "conical intersection", "polaron hopping", "energy derivative"]
cols = ["noise-as-resource", "digital sim", "Trotter boson", "VQE NACV",
        "1st-quant grid", "analog trap", "FT mapping", "variational dyn"]
C = np.zeros((6, 8), int)
C[0, [0, 1, 2, 5]] = [3, 2, 2, 1]; C[1, [1, 0]] = [2, 2]
C[2, [4, 1, 0, 3]] = [1, 1, 1, 1]; C[3, 5] = 1; C[4, 6] = 1; C[5, [3, 7]] = [1, 1]

order_r = np.argsort(-C.sum(1)); order_c = np.argsort(-C.sum(0))
C = C[order_r][:, order_c]
rows = [rows[i] for i in order_r]; cols = [cols[j] for j in order_c]

fig, ax = plt.subplots(figsize=(6.4, 3.6))
for i in range(len(rows)):
    for j in range(len(cols)):
        if C[i, j] > 0:
            ax.scatter(j, i, s=140 * C[i, j], color=ACCENT, alpha=0.85, zorder=3)
            if C[i, j] > 1:
                ax.text(j, i, str(C[i, j]), ha="center", va="center",
                        color="white", fontsize=8, zorder=4)
ax.set_xticks(range(len(cols)), cols, rotation=35, ha="right", fontsize=8.5)
ax.set_yticks(range(len(rows)), rows, fontsize=9)
ax.set_xlim(-0.6, len(cols) - 0.4); ax.set_ylim(len(rows) - 0.4, -0.6)
for sp in ax.spines.values(): sp.set_visible(False)
ax.grid(True, color="#F0EEEB", lw=0.7); ax.set_axisbelow(True)
ax.tick_params(length=0)
ax.set_title("literature coverage: mechanism × method (dot area = paper count)",
             fontsize=9.5, color=INK, pad=10)
fig.savefig("archetype_matrix.png", dpi=200, bbox_inches="tight")
