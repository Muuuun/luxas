"""Grader for blender-04-dominoes. Re-opens <project>/data/dominoes.blend and runs the physics.

    blender -b --factory-startup --python grader.py -- <project-dir>

The functional checks come from stepping the rigid-body simulation here, frame
by frame, and reading where the dominoes end up. A scene can satisfy every
static requirement and still do nothing when played; that gap is the point.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_lib"))
import grade as G  # noqa: E402

import bpy  # noqa: E402

LABELS = [
    "opens and holds ground and domino_01..domino_10",
    "each domino is a 0.1 x 0.5 x 1.0 m box",
    "dominoes 02-10 stand upright on the ground, 0.5 m apart along +X, at frame 1",
    "ground is a passive rigid body and all ten dominoes are active rigid bodies",
    "simulated to frame 12: domino_10 has not moved yet (the fall travels down the row)",
    "simulated to frame 250: all ten dominoes are toppled",
    "simulated to frame 250: nothing fell through the ground",
]
NAMES = [f"domino_{i:02d}" for i in range(1, 11)]
g = G.Grade()

ok = G.open_blend(G.project_dir() / "data" / "dominoes.blend")
ground = G.mesh_object("ground") if ok else None
dominoes = [G.mesh_object(n) for n in NAMES] if ok else []
if not g.check(LABELS[0], ground is not None and dominoes and all(dominoes),
               "" if ok else "data/dominoes.blend missing or unreadable"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

scene = bpy.context.scene


def state():
    deps = bpy.context.evaluated_depsgraph_get()
    out = {}
    for d in dominoes:
        m = d.evaluated_get(deps).matrix_world.copy()
        out[d.name] = (G.tilt_deg(m), tuple(m.translation))
    return out


scene.frame_set(1)
s1 = state()

wrong = [f"{d.name} {tuple(round(x, 3) for x in sorted(d.dimensions))}" for d in dominoes
         if max(abs(a - b) for a, b in zip(sorted(d.dimensions), (0.1, 0.5, 1.0))) > 0.01]
g.check(LABELS[1], not wrong, "; ".join(wrong[:3]))

misplaced = []
for i, name in enumerate(NAMES[1:], start=1):
    tilt, (x, y, z) = s1[name]
    if tilt > 1.0 or abs(x - 0.5 * i) > 0.02 or abs(y) > 0.02 or abs(z - 0.5) > 0.02:
        misplaced.append(f"{name} at ({x:.2f}, {y:.2f}, {z:.2f}) tilt {tilt:.1f} deg")
g.check(LABELS[2], not misplaced, "; ".join(misplaced[:3]))

world = scene.rigidbody_world
bad = []
if world is None or not world.enabled:
    bad.append("scene has no enabled rigid body world")
if ground.rigid_body is None or ground.rigid_body.type != "PASSIVE":
    bad.append("ground is not a passive rigid body")
bad += [f"{d.name} is not an active rigid body" for d in dominoes if d.rigid_body is None or d.rigid_body.type != "ACTIVE"]
g.check(LABELS[3], not bad, "; ".join(bad[:3]))

s12 = None
for f in range(2, 251):
    scene.frame_set(f)
    if f == 12:
        s12 = state()
s250 = state()

tilt12, (x12, _y12, z12) = s12[NAMES[-1]]
_t1, (x1, _y1, z1) = s1[NAMES[-1]]
g.check(LABELS[4], tilt12 < 5.0 and abs(x12 - x1) < 0.05 and abs(z12 - z1) < 0.05,
        f"domino_10 at frame 12: tilt {tilt12:.1f} deg, moved ({x12 - x1:.2f}, {z12 - z1:.2f})")

standing = [f"{n} {s250[n][0]:.0f} deg" for n in NAMES if s250[n][0] < 60.0]
g.check(LABELS[5], not standing, "still standing: " + ", ".join(standing[:5]))

sunk = [f"{n} z={s250[n][1][2]:.2f}" for n in NAMES if s250[n][1][2] < -0.2]
g.check(LABELS[6], not sunk, "below the ground: " + ", ".join(sunk[:5]))

g.emit()
