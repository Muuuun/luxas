"""Reference bracket, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Each fault is one way of misreading the drawing, and still a closed part of the
right overall size:
  pocket_through     the pocket's dashed depth line ignored: cut through the base
  no_counterbore     the dashed circle in FRONT ignored: plain 20 mm hole
  step_at_left       the step put at x < 30 instead of x > 70
  rib_rectangular    the rib's slope in RIGHT ignored: a 30 x 30 block
  boss_missing       the two circles at (80, 25) read as a plain hole
  mirrored_x         the whole part mirrored left to right
  open_mesh          one face deleted
"""
import sys
from pathlib import Path

import bmesh
import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import part_def as P  # noqa: E402
from build import build_part  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0]) / "data"
FAULT = args[1] if len(args) > 1 else ""
OUT.mkdir(parents=True, exist_ok=True)

add = list(P.ADD)
cut = list(P.CUT)


def swap(items, name, replacement):
    """The list with primitive `name` replaced, or dropped when replacement is None."""
    out = []
    for item in items:
        if item[0] != name:
            out.append(item)
        elif replacement is not None:
            out.append(replacement)
    return out


if FAULT == "pocket_through":
    cut = swap(cut, "pocket", ("pocket", "box", (10, 35, -1, 30, 45, 11)))
elif FAULT == "no_counterbore":
    cut = swap(cut, "counterbore", None)
elif FAULT == "step_at_left":
    cut = swap(cut, "step", ("step", "box", (-1, 49, 35, 30, 61, 51)))
elif FAULT == "rib_rectangular":
    add = swap(add, "rib", ("rib", "box", (45, 20, 10, 55, 50, 40)))
elif FAULT == "boss_missing":
    add = swap(add, "boss", None)

bpy.ops.wm.read_factory_settings(use_empty=True)
part = build_part(add, cut)

if FAULT == "mirrored_x":
    for v in part.data.vertices:
        v.co.x = 100.0 - v.co.x
    part.data.flip_normals()
if FAULT == "open_mesh":
    bm = bmesh.new()
    bm.from_mesh(part.data)
    # The smallest face: a pinhole fails the watertight check and leaves the
    # point-by-point comparison (a 2-of-3 ray vote) undisturbed.
    bmesh.ops.delete(bm, geom=[min(bm.faces, key=lambda f: f.calc_area())], context="FACES")
    bm.to_mesh(part.data)
    bm.free()

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "part.blend"), compress=True)
