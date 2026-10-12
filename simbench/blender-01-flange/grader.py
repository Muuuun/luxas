"""Grader for blender-01-flange. Re-opens <project>/data/flange.blend and probes the solid.

    blender -b --factory-startup --python grader.py -- <project-dir>

Geometry is checked by asking "is this point inside the solid?" at points the
spec decides, so the result does not depend on how the part was modelled.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_lib"))
import grade as G  # noqa: E402

g = G.Grade()
LABELS = [
    "opens and holds a mesh object named flange",
    "watertight",
    "bounding box 80 x 80 x 28 mm with the base on z = 0",
    "volume within 1% of 54940 mm^3",
    "bore is 20 mm wide and goes through",
    "boss is 40 mm wide and 20 mm tall",
    "four 8 mm bolt holes on the 60 mm circle at 0/90/180/270 deg",
]

ok = G.open_blend(G.project_dir() / "data" / "flange.blend")
obj = G.mesh_object("flange") if ok else None
if not g.check(LABELS[0], obj is not None, "" if obj else "data/flange.blend missing, unreadable, or without a mesh object 'flange'"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

bm = G.world_bmesh(obj)
nm = G.non_manifold_edges(bm)
g.check(LABELS[1], nm == 0 and len(bm.faces) > 0, f"{nm} non-manifold edges")

lo, hi = G.bbox(bm)
want_lo, want_hi = (-40, -40, 0), (40, 40, 28)
worst = max(max(abs(a - b) for a, b in zip(lo, want_lo)), max(abs(a - b) for a, b in zip(hi, want_hi)))
g.check(LABELS[2], worst <= 0.2, f"min {tuple(round(c, 3) for c in lo)} max {tuple(round(c, 3) for c in hi)}")

exact = math.pi * (40**2 * 8 + 20**2 * 20 - 10**2 * 28 - 4 * 4**2 * 8)
vol = bm.calc_volume(signed=False)
g.check(LABELS[3], abs(vol - exact) / exact <= 0.01, f"measured {vol:.1f}, exact {exact:.1f}")

inside = G.make_inside_test(bm)
g.check(LABELS[4], *G.probe(inside, [
    ((0, 0, 4), False), ((0, 0, 20), False), ((9.3, 0, 14), False), ((0, 9.3, 2), False),
    ((10.7, 0, 14), True), ((0, 10.7, 2), True),
]))
g.check(LABELS[5], *G.probe(inside, [
    ((19.3, 0, 20), True), ((-19.3, 0, 20), True), ((20.7, 0, 20), False), ((0, 20.7, 20), False),
    ((15, 0, 27.5), True), ((15, 0, 28.5), False),
]))
bolt = []
for k in range(4):
    c, s = math.cos(math.radians(90 * k)), math.sin(math.radians(90 * k))
    bolt += [((30 * c, 30 * s, 4), False), ((33.3 * c, 33.3 * s, 4), False), ((26.7 * c, 26.7 * s, 4), False),
             ((34.7 * c, 34.7 * s, 4), True), ((25.3 * c, 25.3 * s, 4), True)]
    c45, s45 = math.cos(math.radians(90 * k + 45)), math.sin(math.radians(90 * k + 45))
    bolt.append(((30 * c45, 30 * s45, 4), True))
g.check(LABELS[6], *G.probe(inside, bolt))

bm.free()
g.emit()
