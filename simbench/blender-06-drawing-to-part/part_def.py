"""The bracket of blender-06 as primitives. Pure Python: imported by the grader
(the analytic solid the saved mesh is compared with), by reference.py and by
make_input.py (which build a mesh from the same list and draw it).

The solid is: the union of ADD, minus every primitive in CUT. Cuts run past the
faces they open through, so the same numbers serve the boolean build (no
coplanar faces) and the point test.

  box    (x0, y0, z0, x1, y1, z1)
  cyl_z  (cx, cy, r, z0, z1)        axis parallel to Z
  cyl_y  (cx, cz, r, y0, y1)        axis parallel to Y
  rib    (x0, x1, y0, y1, z0, z1)   right triangle in YZ, full height at y1, zero at y0
  corner (c,)                       the wedge x + y < c, full height
"""

ADD = [
    ("base", "box", (0, 0, 0, 100, 60, 10)),
    ("wall", "box", (0, 50, 10, 100, 60, 50)),
    ("rib", "rib", (45, 55, 20, 50, 10, 40)),
    ("boss", "cyl_z", (80, 25, 10, 10, 20)),
]
CUT = [
    ("boss hole", "cyl_z", (80, 25, 5, -1, 21)),
    ("base hole", "cyl_z", (20, 25, 5, -1, 11)),
    ("notch", "box", (40, -1, -1, 60, 10, 11)),
    ("pocket", "box", (10, 35, 5, 30, 45, 11)),
    ("wall hole", "cyl_y", (25, 30, 10, 49, 61)),
    ("counterbore", "cyl_y", (25, 30, 15, 55, 61)),
    ("step", "box", (70, 49, 35, 101, 61, 51)),
    ("chamfer", "corner", (10,)),
]
BBOX = ((0, 0, 0), (100, 60, 50))


def _in(kind, a, x, y, z):
    if kind == "box":
        return a[0] <= x <= a[3] and a[1] <= y <= a[4] and a[2] <= z <= a[5]
    if kind == "cyl_z":
        return a[3] <= z <= a[4] and (x - a[0]) ** 2 + (y - a[1]) ** 2 <= a[2] ** 2
    if kind == "cyl_y":
        return a[3] <= y <= a[4] and (x - a[0]) ** 2 + (z - a[1]) ** 2 <= a[2] ** 2
    if kind == "rib":
        return a[0] <= x <= a[1] and a[2] <= y <= a[3] and a[4] <= z <= a[5] and (z - a[4]) * (a[3] - a[2]) <= (y - a[2]) * (a[5] - a[4])
    if kind == "corner":
        return x + y <= a[0]
    raise ValueError(kind)


def inside(x, y, z, add=ADD, cut=CUT):
    return any(_in(k, a, x, y, z) for _n, k, a in add) and not any(_in(k, a, x, y, z) for _n, k, a in cut)


_S = 0.7071
_OFFSETS = ([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
            + [(a * _S, b * _S, 0) for a in (1, -1) for b in (1, -1)]
            + [(a * _S, 0, b * _S) for a in (1, -1) for b in (1, -1)]
            + [(0, a * _S, b * _S) for a in (1, -1) for b in (1, -1)])


def near_surface(x, y, z, d=0.5):
    """True when the solid's surface passes within about d of the point (such points are not scored)."""
    here = inside(x, y, z)
    return any(inside(x + d * ox, y + d * oy, z + d * oz) != here for ox, oy, oz in _OFFSETS)
