"""Grader for blender-06-drawing-to-part. Re-opens <project>/data/part.blend and compares it with the drawn solid.

    blender -b --factory-startup --python grader.py -- <project-dir>

The solid the drawing describes is known exactly (part_def.py: the drawing was
rendered from it). The saved mesh is compared with it point by point: sample
points in a box, ask each solid whether the point is inside, count agreement.
Once over the whole part, and once in the neighbourhood of each feature, so
that one misread feature fails one check. Points within 0.5 mm of the drawn
surface are not scored, which is the modelling tolerance.
"""
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
sys.path.insert(0, str(HERE))
import grade as G  # noqa: E402
import part_def as P  # noqa: E402

IOU_MIN = 0.93
AGREE_MIN = 0.97
LABELS = [
    "opens and holds a mesh object named part",
    "watertight",
    "bounding box runs from the origin to (100, 60, 50)",
    "matches the drawn solid: overlap (IoU) at least 0.93",
    "base: notch in the front edge and chamfered corner at the origin",
    "base: 10 mm holes at (20, 25) and (80, 25), the second through a 20 mm boss 10 high",
    "base: pocket 20 x 10 and 5 deep",
    "wall: 10 thick and 50 high, stepped down to 35 beyond x = 70",
    "wall: 20 mm hole at x = 25, z = 30, counterbored 30 mm x 5 from the back",
    "rib: triangular, 10 thick, from the base up the wall",
]
# Neighbourhoods (x0, y0, z0, x1, y1, z1) scored for each feature check.
REGIONS = {
    4: [(35, -3, -3, 65, 15, 13), (-3, -3, -3, 15, 15, 13)],
    5: [(12, 17, -3, 28, 33, 13), (67, 12, -3, 93, 38, 23)],
    6: [(7, 32, 2, 33, 48, 13)],
    7: [(65, 47, 30, 103, 63, 53), (57, 47, 12, 68, 63, 53)],
    8: [(7, 47, 12, 43, 63, 48)],
    9: [(42, 17, 8, 58, 53, 43)],
}
g = G.Grade()

ok = G.open_blend(G.project_dir() / "data" / "part.blend")
obj = G.mesh_object("part") if ok else None
if not g.check(LABELS[0], obj is not None, "" if obj else "data/part.blend missing, unreadable, or without a mesh object 'part'"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

bm = G.world_bmesh(obj)
nm = G.non_manifold_edges(bm)
g.check(LABELS[1], nm == 0 and len(bm.faces) > 0, f"{nm} non-manifold edges")

lo, hi = G.bbox(bm)
worst = max(max(abs(a - b) for a, b in zip(lo, P.BBOX[0])), max(abs(a - b) for a, b in zip(hi, P.BBOX[1])))
g.check(LABELS[2], worst <= 0.5, f"min {tuple(round(c, 2) for c in lo)} max {tuple(round(c, 2) for c in hi)}")

mesh_inside = G.make_inside_test(bm)
rng = random.Random(20261006)


def compare(box, n):
    """(both, either, agree, scored) over n points in the box, skipping points at the drawn surface."""
    both = either = agree = scored = 0
    for _ in range(n):
        x, y, z = (rng.uniform(box[i], box[i + 3]) for i in range(3))
        if P.near_surface(x, y, z):
            continue
        want, got = P.inside(x, y, z), mesh_inside((x, y, z))
        scored += 1
        both += want and got
        either += want or got
        agree += want == got
    return both, either, agree, scored


both, either, _agree, _scored = compare((-2, -2, -2, 102, 62, 52), 30000)
iou = both / either if either else 0.0
g.check(LABELS[3], iou >= IOU_MIN, f"IoU {iou:.3f}")

for i in sorted(REGIONS):
    worst, where = 1.0, None
    for box in REGIONS[i]:
        _b, _e, agree, scored = compare(box, 2500)
        frac = agree / scored if scored else 0.0
        if frac < worst:
            worst, where = frac, box
    g.check(LABELS[i], worst >= AGREE_MIN, f"agreement {worst:.3f}" + (f" in the box {where[:3]}..{where[3:]}" if worst < AGREE_MIN else ""))

bm.free()
g.emit()
