"""Grader for blender-07-achromat. Re-opens <project>/data/doublet.blend, recovers the prescription, traces it.

    blender -b --factory-startup --python grader.py -- <project-dir>

Nothing the arm reported is used. The radii come from fitting a sphere to the
vertices of each optical surface of the saved meshes, the thicknesses from
where those spheres cross the axis, and the performance from an exact ray trace
(optics.py) of that recovered prescription with the indices the request gives.
The two elements are traced as four surfaces with whatever gap the file has, so
an uncemented pair is measured as built.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
sys.path.insert(0, str(HERE))
import grade as G  # noqa: E402
import optics as O  # noqa: E402

import numpy as np  # noqa: E402

LABELS = [
    "opens and holds mesh objects named crown and flint",
    "both are watertight",
    "25 mm in diameter, first vertex at z = 0, centre thicknesses 6 and 2.5 mm, crown edge at least 1 mm",
    "four optical faces are spherical: vertices within 2 um of a sphere centred on the axis",
    "cemented: the back of the crown and the front of the flint are the same sphere, in contact",
    "effective focal length at d is 100 mm within 0.5 mm",
    "axial colour: paraxial foci at F and C within 0.05 mm",
    "spherical aberration: RMS spot radius at d no more than 1.0 um for the 20 mm beam",
]
g = G.Grade()

ok = G.open_blend(G.project_dir() / "data" / "doublet.blend")
objs = [G.mesh_object("crown"), G.mesh_object("flint")] if ok else [None, None]
if not g.check(LABELS[0], all(objs), "" if all(objs) else "data/doublet.blend missing, unreadable, or without mesh objects 'crown' and 'flint'"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

bms = [G.world_bmesh(o) for o in objs]
opens = [G.non_manifold_edges(bm) for bm in bms]
g.check(LABELS[1], all(n == 0 for n in opens) and all(len(bm.faces) > 0 for bm in bms), f"crown: {opens[0]} non-manifold edges, flint: {opens[1]}")


def fit(points):
    """Sphere through the points -> dict(c, zv, off_axis, rms, worst), lengths in mm. c = 0 for a flat."""
    p = np.array(points, dtype=np.float64)
    if len(p) < 8:
        return None
    if np.ptp(p[:, 2]) < 1e-4:
        zv = float(p[:, 2].mean())
        dev = np.abs(p[:, 2] - zv)
        return {"c": 0.0, "zv": zv, "off_axis": 0.0, "rms": float(np.sqrt((dev ** 2).mean())), "worst": float(dev.max())}
    a = np.c_[p, np.ones(len(p))]
    sol, *_ = np.linalg.lstsq(a, -(p ** 2).sum(axis=1), rcond=None)
    centre = -sol[:3] / 2
    radius = math.sqrt(max(1e-12, float(centre @ centre - sol[3])))
    dev = np.abs(np.linalg.norm(p - centre, axis=1) - radius)
    zv = centre[2] - radius if abs(centre[2] - radius - p[:, 2].mean()) < abs(centre[2] + radius - p[:, 2].mean()) else centre[2] + radius
    return {"c": 1.0 / (centre[2] - zv), "zv": float(zv), "off_axis": float(math.hypot(centre[0], centre[1])),
            "rms": float(np.sqrt((dev ** 2).mean())), "worst": float(dev.max())}


def faces_of(bm, sign):
    """Vertices of the faces that look along -Z (sign -1, the front) or +Z (sign +1, the back)."""
    seen = {}
    for f in bm.faces:
        if f.normal.z * sign > 0.5:
            for v in f.verts:
                seen[v.index] = tuple(v.co)
    return list(seen.values())


surf = {name: fit(faces_of(bm, sign)) for name, bm, sign in
        (("crown front", bms[0], -1), ("crown back", bms[0], +1), ("flint front", bms[1], -1), ("flint back", bms[1], +1))}
have = all(s is not None for s in surf.values())


def sag(c, h):
    return c * h * h / (1 + math.sqrt(max(0.0, 1 - c * c * h * h)))


bad = []
for name, bm in (("crown", bms[0]), ("flint", bms[1])):
    r = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
    if abs(r - 12.5) > 0.05:
        bad.append(f"{name} reaches {2 * r:.2f} mm across")
if have:
    cf, cb, ff, fb = surf["crown front"], surf["crown back"], surf["flint front"], surf["flint back"]
    if abs(cf["zv"]) > 0.01:
        bad.append(f"first vertex at z = {cf['zv']:.3f}")
    if abs(cb["zv"] - cf["zv"] - 6.0) > 0.02:
        bad.append(f"crown is {cb['zv'] - cf['zv']:.3f} mm thick at the centre")
    if abs(fb["zv"] - ff["zv"] - 2.5) > 0.02:
        bad.append(f"flint is {fb['zv'] - ff['zv']:.3f} mm thick at the centre")
    edge = cb["zv"] + sag(cb["c"], 12.5) - cf["zv"] - sag(cf["c"], 12.5)
    if edge < 1.0:
        bad.append(f"crown edge is {edge:.2f} mm thick")
else:
    bad.append("an element has no face looking along the axis on one side")
g.check(LABELS[2], not bad, "; ".join(bad[:3]))

if not have:
    for label in LABELS[3:]:
        g.check(label, False, "no optical surface to fit")
    g.emit()
    sys.exit(0)

off = [f"{n}: {s['worst'] * 1000:.1f} um off its sphere" for n, s in surf.items() if s["worst"] > 0.002]
off += [f"{n}: centre {s['off_axis']:.3f} mm off the axis" for n, s in surf.items() if s["off_axis"] > 0.02]
g.check(LABELS[3], not off, "; ".join(off[:3]) or "worst vertex " + f"{max(s['worst'] for s in surf.values()) * 1000:.2f} um off")

dc, dz = abs(cb["c"] - ff["c"]), abs(cb["zv"] - ff["zv"])
g.check(LABELS[4], dc <= 1e-5 and dz <= 0.01, f"curvatures differ by {dc:.2e} /mm, vertices {dz:.3f} mm apart")

air, crown, flint = O.GLASS["air"], O.GLASS["N-BK7"], O.GLASS["N-SF5"]
system = [(cf["zv"], cf["c"], air, crown), (cb["zv"], cb["c"], crown, air), (ff["zv"], ff["c"], air, flint), (fb["zv"], fb["c"], flint, air)]
radii = ", ".join("flat" if abs(s[1]) < 1e-9 else f"{1 / s[1]:.3f}" for s in system)
try:
    efl = O.paraxial(system, O.D)[0]
    colour = O.paraxial(system, O.F)[1] - O.paraxial(system, O.C)[1]
    rms = O.spot(system, wavelengths=(O.D,))[0] * 1000
except (TypeError, ZeroDivisionError):
    efl = colour = rms = float("nan")
g.check(LABELS[5], abs(efl - 100.0) <= 0.5, f"EFL {efl:.3f} mm (fitted radii {radii})")
g.check(LABELS[6], abs(colour) <= 0.05, f"F focus minus C focus {colour:+.4f} mm")
g.check(LABELS[7], rms <= 1.0, f"RMS spot radius {rms:.3f} um at best focus")

g.emit()
