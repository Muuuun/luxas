"""Grader for blender-03-edit-scene. Compares <project>/data/workshop_edited.blend with the input.

    blender -b --factory-startup --python grader.py -- <project-dir>

The original is read from this bench's own input/workshop.blend, never from the
copy the arm was given, so an arm that edits its input in place cannot move the
baseline. "Unchanged" means what the renderer and the modifier stack would see:
world transform, mesh geometry, modifiers, and the material each face uses.

A file whose every object is as the input had it is no artifact: it opens,
keeps the other parts and the rig exactly, and until 2026-10-09 scored 3/6 for
no work. It now fails the first check and everything after it, like a missing
file (reference.py unchanged_copy; smoke_simbench_graders.mts holds it to 0/6).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_lib"))
import grade as G  # noqa: E402

import bpy  # noqa: E402

LABELS = [
    "opens and is not the input unchanged",
    "bolt_02 origin is at (2.0, 1.5, 0.25) and it is otherwise the same bolt",
    "plate_03 faces use a material named warning_yellow with base colour (1.0, 0.8, 0.0)",
    "bracket_01 is gone",
    "the six other parts are unchanged (transform, mesh, modifiers, material)",
    "camera and light unchanged, nothing added",
]
MOD_PROPS = {"BEVEL": ("width", "segments"), "ARRAY": ("count", "relative_offset_displace")}


def r(x, nd=4):
    # mathutils types are sequences without __iter__, so test for a number instead.
    return round(float(x), nd) if isinstance(x, (int, float)) else tuple(round(float(v), nd) for v in x)


def snapshot():
    snap = {}
    for o in bpy.data.objects:
        s = {"type": o.type, "matrix": tuple(r(row) for row in o.matrix_world)}
        if o.type == "MESH":
            me = o.data
            s["mesh"] = (len(me.vertices), len(me.polygons), r([sum(v.co[i] for v in me.vertices) for i in range(3)]),
                         r([sum(abs(v.co[i]) for v in me.vertices) for i in range(3)]))
            s["modifiers"] = tuple((m.type, m.name, tuple(r(getattr(m, p)) for p in MOD_PROPS.get(m.type, ()))) for m in o.modifiers)
            s["materials"] = tuple((m.name if m else None, r(G.principled_base_color(m) or (), 3)) for m in G.face_materials(o))
        elif o.type == "LIGHT":
            s["data"] = (o.data.type, r(o.data.energy))
        elif o.type == "CAMERA":
            s["data"] = (r(o.data.lens),)
        snap[o.name] = s
    return snap


def differs(a, b, keys):
    return [k for k in keys if a.get(k) != b.get(k)]


g = G.Grade()
assert G.open_blend(Path(__file__).resolve().parent / "input" / "workshop.blend"), "bench input missing"
before = snapshot()

opened = G.open_blend(G.project_dir() / "data" / "workshop_edited.blend")
after = snapshot() if opened else None
why = ""
if not opened:
    why = "data/workshop_edited.blend missing or unreadable"
elif after == before:
    why = "data/workshop_edited.blend is the input, unchanged: none of the three edits was made"
if not g.check(LABELS[0], not why, why):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

b = after.get("bolt_02")
if b is None:
    g.check(LABELS[1], False, "bolt_02 missing")
else:
    want = [list(row) for row in before["bolt_02"]["matrix"]]
    want[0][3], want[1][3], want[2][3] = 2.0, 1.5, 0.25
    off = max(abs(x - y) for rw, rg in zip(want, b["matrix"]) for x, y in zip(rw, rg))
    other = differs(before["bolt_02"], b, ("mesh", "modifiers", "materials"))
    g.check(LABELS[1], off <= 1e-3 and not other, f"transform off by {off:.4f}" + (f"; changed: {', '.join(other)}" if other else ""))

p = after.get("plate_03")
if p is None:
    g.check(LABELS[2], False, "plate_03 missing")
else:
    mats = p["materials"]
    good = len(mats) == 1 and mats[0][0] == "warning_yellow" and len(mats[0][1]) == 3 and max(abs(x - y) for x, y in zip(mats[0][1], (1.0, 0.8, 0.0))) <= 0.02
    other = differs(before["plate_03"], p, ("matrix", "mesh", "modifiers"))
    g.check(LABELS[2], good and not other, f"faces use {mats}" + (f"; changed: {', '.join(other)}" if other else ""))

gone = "bracket_01" not in after
g.check(LABELS[3], gone, "" if gone else "bracket_01 still present")

untouched = ["plate_01", "plate_02", "bolt_01", "bolt_03", "bracket_02", "bracket_03"]
changed = []
for name in untouched:
    if name not in after:
        changed.append(f"{name} missing")
    else:
        d = differs(before[name], after[name], ("matrix", "mesh", "modifiers", "materials"))
        if d:
            changed.append(f"{name}: {', '.join(d)}")
g.check(LABELS[4], not changed, "; ".join(changed))

rig = [f"{n}: {', '.join(differs(before[n], after.get(n, {}), ('type', 'matrix', 'data')))}" for n in ("camera", "key_light")
       if differs(before[n], after.get(n, {}), ("type", "matrix", "data"))]
extra = sorted(set(after) - set(before))
g.check(LABELS[5], not rig and not extra, "; ".join(rig + ([f"added: {', '.join(extra)}"] if extra else [])))

g.emit()
