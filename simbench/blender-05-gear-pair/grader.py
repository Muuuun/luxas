"""Grader for blender-05-gear-pair. Re-opens <project>/data/gears.blend and turns the gears.

    blender -b --factory-startup --python grader.py -- <project-dir>

The functional checks do what the request says will be done: turn the pinion by
theta and the gear by -theta * 18/30 about their axes and measure how deep one
solid sits inside the other; then hold the pinion and find how far the gear can
turn either way before it touches. Both are measured on the mid-plane outline,
with the same point-in-solid test the static graders use, so the result does
not depend on how the teeth were modelled.

Overlap alone can be satisfied by thin teeth, and backlash alone by teeth that
jam; a conjugate pair is the only thing that passes both at every phase.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_lib"))
import grade as G  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

M, Z1, Z2, CENTER, WIDTH, ZMID = 2.0, 18, 30, 48.0, 10.0, 5.0
TOL = 0.02            # overlap depth allowed for faceting, as the request states
BACKLASH_MAX = 0.26   # 0.2 in the request + 2 * TOL / cos(20 deg) the overlap tolerance adds + margin
PLAY_RANGE = 0.6      # mm of arc searched each way
R2 = M * Z2 / 2

LABELS = [
    "opens and holds mesh objects named pinion and gear",
    "both are watertight",
    "axes at (0, 0) and (48, 0), 10 mm wide from z = 0, bores 8 mm and 12 mm",
    "18 and 30 full-depth teeth of module 2 (tip, root, thickness at the pitch circle)",
    "saved pose: the teeth do not overlap",
    "driven at 18:30 through a full turn of the gear: the teeth never overlap",
    "backlash at the pitch circle stays within 0.2 mm through the mesh cycle",
]
g = G.Grade()

ok = G.open_blend(G.project_dir() / "data" / "gears.blend")
objs = [G.mesh_object("pinion"), G.mesh_object("gear")] if ok else [None, None]
if not g.check(LABELS[0], all(objs), "" if all(objs) else "data/gears.blend missing, unreadable, or without mesh objects 'pinion' and 'gear'"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)


class Solid:
    def __init__(self, obj, cx, teeth, bore):
        self.cx, self.teeth, self.bore = cx, teeth, bore
        self.r = M * teeth / 2
        self.bm = G.world_bmesh(obj)
        self.open_edges = G.non_manifold_edges(self.bm)
        self._inside = G.make_inside_test(self.bm)
        self.tree = BVHTree.FromBMesh(self.bm)
        self.outline = self._slice()

    def _slice(self):
        """Points on the z = ZMID section, no more than 0.1 mm apart along it."""
        cut = self.bm.copy()
        res = bmesh.ops.bisect_plane(cut, geom=cut.verts[:] + cut.edges[:] + cut.faces[:], dist=1e-6,
                                     plane_co=(0, 0, ZMID), plane_no=(0, 0, 1))
        pts = []
        for e in (x for x in res["geom_cut"] if isinstance(x, bmesh.types.BMEdge)):
            a, b = e.verts[0].co, e.verts[1].co
            n = max(1, int(math.ceil((b - a).length / 0.1)))
            pts += [(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n) for i in range(n)]
        cut.free()
        return pts

    def inside(self, x, y):
        return self._inside(Vector((x, y, ZMID)))

    def depth(self, x, y):
        """How far (x, y) on the mid-plane sits inside the solid; 0 when outside."""
        p = Vector((x, y, ZMID))
        return self.tree.find_nearest(p)[3] if self._inside(p) else 0.0

    def ring(self, radius, n=3600):
        """(inside/outside transitions, fraction inside) round a circle about the axis."""
        flags = [self.inside(self.cx + radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n)) for i in range(n)]
        return sum(1 for i in range(n) if flags[i] != flags[i - 1]), sum(flags) / n


pin = Solid(objs[0], 0.0, Z1, 4.0)
gear = Solid(objs[1], CENTER, Z2, 6.0)
solids = (("pinion", pin), ("gear", gear))

closed = all(s.open_edges == 0 and len(s.bm.faces) > 0 for _n, s in solids)
g.check(LABELS[1], closed, ", ".join(f"{n}: {s.open_edges} non-manifold edges" for n, s in solids))

bad = []
for name, s in solids:
    zs = [v.co.z for v in s.bm.verts]
    if abs(min(zs)) > 0.05 or abs(max(zs) - WIDTH) > 0.05:
        bad.append(f"{name} spans z = {min(zs):.2f} .. {max(zs):.2f}")
    if not s.outline:
        bad.append(f"{name} has no section at z = {ZMID}")
        continue
    mx = sum(p[0] for p in s.outline) / len(s.outline)
    my = sum(p[1] for p in s.outline) / len(s.outline)
    if math.hypot(mx - s.cx, my) > 0.1:
        bad.append(f"{name} section is centred on ({mx:.2f}, {my:.2f}), expected ({s.cx:.0f}, 0)")
    hole = [(0.0, 0.0, False)] + [((s.bore + d) * math.cos(a), (s.bore + d) * math.sin(a), d > 0)
                                   for d in (-0.3, 0.3) for a in (0.3 + k * math.pi / 4 for k in range(8))]
    miss = [(x, y) for x, y, want in hole if s.inside(s.cx + x, y) != want]
    if miss:
        bad.append(f"{name} bore is not {2 * s.bore:.0f} mm on its axis ({len(miss)} of {len(hole)} probes wrong)")
g.check(LABELS[2], not bad, "; ".join(bad[:3]))

bad = []
for name, s in solids:
    ra, rf = s.r + M, s.r - 1.25 * M
    n_pitch, frac = s.ring(s.r)
    if n_pitch != 2 * s.teeth:
        bad.append(f"{name}: {n_pitch // 2} teeth on the pitch circle, expected {s.teeth}")
    elif not 0.45 <= frac <= 0.505:
        bad.append(f"{name}: teeth fill {frac:.3f} of the pitch circle, expected 0.45-0.505")
    if s.ring(ra + 0.1)[1] > 0 or s.ring(ra - 0.3)[0] != 2 * s.teeth:
        bad.append(f"{name}: tip circle is not {2 * ra:.0f} mm")
    if s.ring(rf - 0.2)[1] < 1.0 or s.ring(rf + 0.4)[0] != 2 * s.teeth:
        bad.append(f"{name}: root circle is not {2 * rf:.0f} mm")
g.check(LABELS[3], not bad, "; ".join(bad[:3]))

REACH1 = (CENTER - (gear.r + M) - 0.5) ** 2   # pinion points nearer its axis than this cannot reach the gear
REACH2 = (CENTER - (pin.r + M) - 0.5) ** 2
PIN_PTS = [(x, y) for x, y in pin.outline if x * x + y * y > REACH1]
GEAR_PTS = [(x - CENTER, y) for x, y in gear.outline if (x - CENTER) ** 2 + y * y > REACH2]
RA1SQ, RA2SQ = (pin.r + M + 0.5) ** 2, (gear.r + M + 0.5) ** 2


def overlap(theta, phi, stop_at=None):
    """Deepest overlap (mm) with the pinion turned by theta and the gear by phi about their own axes."""
    ct, st, cp, sp = math.cos(theta), math.sin(theta), math.cos(phi), math.sin(phi)
    worst = 0.0
    for x, y in PIN_PTS:                      # pinion outline, carried into the gear's rest frame
        dx, dy = ct * x - st * y - CENTER, st * x + ct * y
        if dx * dx + dy * dy > RA2SQ:
            continue
        d = gear.depth(CENTER + cp * dx + sp * dy, -sp * dx + cp * dy)
        if d > worst:
            worst = d
            if stop_at is not None and worst > stop_at:
                return worst
    for x, y in GEAR_PTS:                     # gear outline, carried into the pinion's rest frame
        wx, wy = CENTER + cp * x - sp * y, sp * x + cp * y
        if wx * wx + wy * wy > RA1SQ:
            continue
        d = pin.depth(ct * wx + st * wy, -st * wx + ct * wy)
        if d > worst:
            worst = d
            if stop_at is not None and worst > stop_at:
                return worst
    return worst


def play(theta, phi, sign):
    """mm of arc at the gear's pitch circle it can turn (pinion held) before overlapping by more than TOL."""
    if overlap(theta, phi + sign * PLAY_RANGE / R2, TOL) <= TOL:
        return PLAY_RANGE
    lo, hi = 0.0, PLAY_RANGE
    for _ in range(8):
        mid = (lo + hi) / 2
        if overlap(theta, phi + sign * mid / R2, TOL) <= TOL:
            lo = mid
        else:
            hi = mid
    return lo


if not closed:
    for label in LABELS[4:]:
        g.check(label, False, "not two closed solids: overlap is undefined")
else:
    d0 = overlap(0.0, 0.0)
    g.check(LABELS[4], d0 <= TOL, f"deepest overlap {d0:.3f} mm")

    STEPS = 240   # eight positions per tooth pitch
    worst, at = 0.0, 0
    for i in range(STEPS):
        tg = 2 * math.pi * i / STEPS
        d = overlap(tg * Z2 / Z1, -tg)
        if d > worst:
            worst, at = d, i
    g.check(LABELS[5], worst <= TOL, f"deepest overlap {worst:.3f} mm, with the pinion turned {math.degrees(2 * math.pi * at / STEPS * Z2 / Z1):.1f} deg")

    lash = []
    for i in range(24):   # 24 different phases of the mesh, on 24 different teeth
        tg = 2 * math.pi / Z2 * i * 31 / 24
        theta, phi = tg * Z2 / Z1, -tg
        lash.append(play(theta, phi, +1) + play(theta, phi, -1))
    g.check(LABELS[6], max(lash) <= BACKLASH_MAX,
            f"backlash {min(lash):.3f} .. {max(lash):.3f} mm over 24 mesh positions (limit {BACKLASH_MAX} with the overlap tolerance)")

g.emit()
