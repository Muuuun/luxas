"""Core checks shared by the figlint CLI and the savefig auto-hook.

lint_figure(fig, fname, tight) -> (errors, warnings): text collisions and
canvas clipping are errors; a >50x positive range on a linear axis is a
warning. Tick labels are exempt from the clip check and tight saves skip it
entirely — false positives are how linters get ignored.
"""
import numpy as np
from matplotlib.text import Text


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
            # Text-only box: Annotation.get_window_extent unions in the arrow
            # patch, so a callout with an arrow "collided" with everything along
            # the arrow's path (fig4, 2026-08-28).
            ext = Text.get_window_extent(t, renderer)
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

    # Composition budgets (figures v2, 2026-08-28 — the pp-vs-ss run shipped an
    # 8-series spaghetti panel with 10 annotations and an inset over the data).
    # Budgets are WARN (judgment stays with the reviewer); occlusion is ERROR.
    from matplotlib.legend import Legend
    for ax in fig.get_axes():
        if getattr(ax, "_figlint_inset", False):
            continue
        n_lines = len([ln for ln in ax.get_lines() if ln.get_visible() and len(np.ravel(ln.get_xdata())) > 1])
        if n_lines > 6:
            warnings.append(f"{fname}: {n_lines} line series overlaid in one axes (> 6) — split into panels or drop series; the reader cannot follow more")
        n_annot = len([t for t in ax.texts if t.get_visible() and t.get_text().strip()])
        if n_annot > 4:
            warnings.append(f"{fname}: {n_annot} in-axes annotations (> 4) — keep the ones that carry the claim, move the rest to the caption")
        leg = ax.get_legend()
        if leg is not None and leg.get_visible():
            try:
                lb = leg.get_window_extent(renderer)
                hidden = 0
                for ln in ax.get_lines():
                    if not ln.get_visible():
                        continue
                    xy = np.column_stack([np.ravel(ln.get_xdata()), np.ravel(ln.get_ydata())]).astype(float)
                    xy = xy[np.isfinite(xy).all(axis=1)]
                    if len(xy) == 0:
                        continue
                    disp = ax.transData.transform(xy)
                    hidden += int(((disp[:, 0] > lb.x0) & (disp[:, 0] < lb.x1) & (disp[:, 1] > lb.y0) & (disp[:, 1] < lb.y1)).sum())
                if hidden >= 3:
                    errors.append(f"{fname}: legend covers {hidden} data points — move it to an empty corner (loc='best' is not enough) or outside the axes")
            except Exception:
                pass
        # an inset axes whose box overlaps the parent's data is occlusion
        for child in list(getattr(ax, "child_axes", [])) + [c for c in fig.get_axes() if c is not ax]:
            if child.get_visible() is False:
                continue
            try:
                if ax.bbox.contains(*child.bbox.p0) and ax.bbox.contains(*child.bbox.p1) and child.bbox.width < 0.7 * ax.bbox.width:
                    child._figlint_inset = True
                    cb = child.get_tightbbox(renderer) or child.bbox
                    hidden = 0
                    for ln in ax.get_lines():
                        xy = np.column_stack([np.ravel(ln.get_xdata()), np.ravel(ln.get_ydata())]).astype(float)
                        xy = xy[np.isfinite(xy).all(axis=1)]
                        if len(xy) == 0:
                            continue
                        disp = ax.transData.transform(xy)
                        hidden += int(((disp[:, 0] > cb.x0) & (disp[:, 0] < cb.x1) & (disp[:, 1] > cb.y0) & (disp[:, 1] < cb.y1)).sum())
                    if hidden >= 3:
                        errors.append(f"{fname}: inset covers {hidden} data points of the parent axes — move the inset to an empty region or make it a panel")
            except Exception:
                pass

    # Text over data (figures v2 convergence experiment, 2026-08-28): after
    # every fix round the same defect remained in all four data plots — an
    # annotation laid across the curve it describes. Deterministic: sample each
    # visible line densely in display space and count samples inside a text
    # bbox (tick labels and axis labels excluded). ≥ 3 samples = ERROR.
    for ax in fig.get_axes():
        if getattr(ax, "_figlint_inset", False):
            continue
        samples = []
        for ln in ax.get_lines():
            if not ln.get_visible():
                continue
            xy = np.column_stack([np.ravel(ln.get_xdata()), np.ravel(ln.get_ydata())]).astype(float)
            xy = xy[np.isfinite(xy).all(axis=1)]
            if len(xy) < 2:
                continue
            disp = ax.transData.transform(xy)
            seg = np.diff(disp, axis=0)
            n = np.clip((np.hypot(seg[:, 0], seg[:, 1]) / 3.0).astype(int), 1, 200)
            for (p0, d, k) in zip(disp[:-1], seg, n):
                t = np.linspace(0, 1, k, endpoint=False)[:, None]
                samples.append(p0 + t * d)
        if not samples:
            continue
        pts = np.vstack(samples)
        axis_labels = {id(ax.xaxis.label), id(ax.yaxis.label), id(ax.title)}
        for t in ax.texts + ([ax.get_legend()] if False else []):
            if not t.get_visible() or not t.get_text().strip() or id(t) in axis_labels or id(t) in ticklabels:
                continue
            try:
                # The text's CORE (50%): a direct label abutting its curve has
                # 0–2 samples there; a label laid over the curve has ≥ 5
                # (measured 2026-08-28 on the archetype set and the pp-vs-ss figures).
                bb = _shrunk(Text.get_window_extent(t, renderer), 0.5)
            except Exception:
                continue
            inside = int(((pts[:, 0] > bb.x0) & (pts[:, 0] < bb.x1) & (pts[:, 1] > bb.y0) & (pts[:, 1] < bb.y1)).sum())
            if inside >= 4:
                errors.append(f'{fname}: annotation "{t.get_text()[:40]}" lies over a data line ({inside} samples under it) — move it beside the curve (offset points) or into empty space')

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
