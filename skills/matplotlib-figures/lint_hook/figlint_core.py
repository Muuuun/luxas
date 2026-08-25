"""Core checks shared by the figlint CLI and the savefig auto-hook.

lint_figure(fig, fname, tight) -> (errors, warnings): text collisions and
canvas clipping are errors; a >50x positive range on a linear axis is a
warning. Tick labels are exempt from the clip check and tight saves skip it
entirely — false positives are how linters get ignored.
"""
import numpy as np


def _shrunk(bbox, f):
    from matplotlib.transforms import Bbox
    w, h = bbox.width * f, bbox.height * f
    cx, cy = (bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2
    return Bbox.from_extents(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def lint_figure(fig, fname, tight):
    from matplotlib.text import Text
    errors, warnings = [], []
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    fig_bbox = fig.bbox

    ticklabels = set()
    for ax in fig.get_axes():
        for t in ax.get_xticklabels() + ax.get_yticklabels():
            ticklabels.add(id(t))

    texts = []
    for t in fig.findobj(Text):
        if not t.get_visible() or not t.get_text().strip():
            continue
        try:
            ext = t.get_window_extent(renderer)
        except Exception:
            continue
        if ext.width <= 0 or ext.height <= 0:
            continue
        texts.append((t, ext))

    seen = set()
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, ea = texts[i]
            b, eb = texts[j]
            if id(a) in ticklabels and id(b) in ticklabels:
                continue
            f = 0.75 if (id(a) in ticklabels or id(b) in ticklabels) else 0.85
            if _shrunk(ea, f).overlaps(_shrunk(eb, f)):
                key = (a.get_text()[:30], b.get_text()[:30])
                if key in seen:
                    continue
                seen.add(key)
                errors.append(f'{fname}: collision "{a.get_text()[:40]}" ⊗ "{b.get_text()[:40]}"')

    if not tight:
        for t, ext in texts:
            if id(t) in ticklabels:
                continue
            pad = 2.0
            if (ext.x0 < fig_bbox.x0 - pad or ext.x1 > fig_bbox.x1 + pad
                    or ext.y0 < fig_bbox.y0 - pad or ext.y1 > fig_bbox.y1 + pad):
                errors.append(f'{fname}: clipped "{t.get_text()[:40]}" extends past the canvas edge')

    for ax in fig.get_axes():
        for which in ("x", "y"):
            if getattr(ax, f"get_{which}scale")() != "linear":
                continue
            vals = []
            for ln in ax.get_lines():
                data = ln.get_xdata() if which == "x" else ln.get_ydata()
                vals.extend(abs(v) for v in np.ravel(np.asarray(data, dtype=float)) if np.isfinite(v) and v != 0)
            for p in ax.patches:
                try:
                    v = abs(float(p.get_width() if which == "x" else p.get_height()))
                    if np.isfinite(v) and v > 0:
                        vals.append(v)
                except Exception:
                    pass
            if len(vals) >= 3:
                ratio = max(vals) / min(vals)
                if ratio > 50:
                    warnings.append(
                        f"{fname}: {which}-axis is LINEAR but positive data spans {ratio:.0f}x "
                        f"(min {min(vals):.3g}, max {max(vals):.3g}) — small values will be invisible; "
                        f"use a log scale or broken axis")
    return errors, warnings
