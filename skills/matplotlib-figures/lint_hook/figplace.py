"""figplace — authoring-time label placement with the linter's own geometry.

The figures-v2 convergence experiment (2026-08-28) showed that even a careful
author placing a callout blind in data coordinates needs 3–4 render/lint
rounds on a busy panel: the legend, the other annotations and the curves are
all invisible at write time. This helper makes them visible: it tries candidate
anchors in order and returns the first whose text box is free of every
occupied region — line samples, legend box, other texts, inset axes — using
the same tests figlint applies at save time.

    from figplace import annotate_free
    annotate_free(ax, "Best: F = 0.9967", xy=(2.0, 0.9967),
                  candidates=[(4.9, 0.70, "right"), (2.3, 0.60, "right"), (3.0, 0.82, "left")],
                  fontsize=8, arrowprops=dict(arrowstyle="-", lw=0.7))

Candidates are (x, y[, ha]) in data coordinates; `free_anchor` returns the
chosen one (or None, after which the caller decides — nothing is drawn silently
in a bad spot). Import via the lint hook dir (already on PYTHONPATH in the
hardened bash tool): `sys.path.insert(0, "skills/matplotlib-figures/lint_hook")`.
"""
import numpy as np
from matplotlib.text import Text


def _occupancy(ax, renderer, exclude=()):
    """Occupied display-space regions: line samples (N×2), and boxes (list of Bbox)."""
    from matplotlib.transforms import Bbox
    samples = []
    for ln in ax.get_lines():
        if not ln.get_visible():
            continue
        xy = np.column_stack([np.ravel(ln.get_xdata()), np.ravel(ln.get_ydata())]).astype(float)
        xy = xy[np.isfinite(xy).all(axis=1)]
        if len(xy) < 1:
            continue
        disp = ax.transData.transform(xy)
        if len(disp) == 1:
            samples.append(disp)
            continue
        seg = np.diff(disp, axis=0)
        n = np.clip((np.hypot(seg[:, 0], seg[:, 1]) / 3.0).astype(int), 1, 200)
        for p0, d, k in zip(disp[:-1], seg, n):
            samples.append(p0 + np.linspace(0, 1, k, endpoint=False)[:, None] * d)
    pts = np.vstack(samples) if samples else np.zeros((0, 2))
    boxes = []
    leg = ax.get_legend()
    if leg is not None and leg.get_visible():
        try:
            boxes.append(leg.get_window_extent(renderer))
        except Exception:
            pass
    from matplotlib.text import Text
    for t in ax.texts:
        if t in exclude or not t.get_visible() or not t.get_text().strip():
            continue
        try:
            boxes.append(Text.get_window_extent(t, renderer))  # text only, not the arrow
        except Exception:
            pass
    for child in getattr(ax, "child_axes", []):
        try:
            boxes.append(child.get_tightbbox(renderer) or child.bbox)
        except Exception:
            pass
    return pts, boxes


def _box_free(bb, pts, boxes, pad=2.0):
    from matplotlib.transforms import Bbox
    b = Bbox.from_extents(bb.x0 - pad, bb.y0 - pad, bb.x1 + pad, bb.y1 + pad)
    if len(pts) and int(((pts[:, 0] > b.x0) & (pts[:, 0] < b.x1) & (pts[:, 1] > b.y0) & (pts[:, 1] < b.y1)).sum()) >= 1:
        return False
    return not any(b.overlaps(o) for o in boxes)


def _why(bb, pts, boxes, axbox, pad=2.0):
    from matplotlib.transforms import Bbox
    b = Bbox.from_extents(bb.x0 - pad, bb.y0 - pad, bb.x1 + pad, bb.y1 + pad)
    if not (axbox.x0 <= bb.x0 and bb.x1 <= axbox.x1 and axbox.y0 <= bb.y0 and bb.y1 <= axbox.y1):
        return "outside the axes"
    n = int(((pts[:, 0] > b.x0) & (pts[:, 0] < b.x1) & (pts[:, 1] > b.y0) & (pts[:, 1] < b.y1)).sum()) if len(pts) else 0
    if n:
        return f"crosses a data line ({n} samples)"
    for o in boxes:
        if b.overlaps(o):
            return "overlaps a legend/text/inset box"
    return None


def free_anchor(ax, text, candidates, fontsize=None, explain=False, **text_kwargs):
    """First candidate (x, y[, ha]) whose rendered text box is free; None if none is.
    With explain=True returns (choice, [(candidate, reason-or-None), ...])."""
    fig = ax.figure
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    pts, boxes = _occupancy(ax, renderer)
    axbox = ax.bbox
    reasons = []
    choice = None
    for cand in candidates:
        x, y = cand[0], cand[1]
        ha = cand[2] if len(cand) > 2 else text_kwargs.get("ha", "left")
        kw = dict(text_kwargs); kw["ha"] = ha
        if fontsize is not None:
            kw["fontsize"] = fontsize
        probe = ax.text(x, y, text, **kw)
        try:
            bb = Text.get_window_extent(probe, renderer)
            why = _why(bb, pts, boxes, axbox)
        finally:
            probe.remove()
        reasons.append((tuple(cand), why))
        if why is None:
            choice = (x, y, ha)
            break
    return (choice, reasons) if explain else choice


def annotate_free(ax, text, xy, candidates, fontsize=None, arrowprops=None, **text_kwargs):
    """annotate() at the first free candidate; returns the Annotation, or None (nothing drawn)."""
    spot = free_anchor(ax, text, candidates, fontsize=fontsize, **text_kwargs)
    if spot is None:
        return None
    x, y, ha = spot
    kw = dict(text_kwargs); kw["ha"] = ha
    if fontsize is not None:
        kw["fontsize"] = fontsize
    return ax.annotate(text, xy=xy, xytext=(x, y), textcoords="data", arrowprops=arrowprops, **kw)
