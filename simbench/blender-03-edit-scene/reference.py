"""Reference edit of input/workshop.blend, and planted-fault variants.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Faults (each still saves a file that opens and contains the requested edits "in letter"):
  shared_mesh_material    yellow assigned on the mesh the three plates share -> all three turn yellow
  yellow_in_unused_slot   yellow appended as a second slot; plate_03's faces still use steel
  moved_wrong_bolt        bolt_01 moved instead of bolt_02
  collateral_delete       bracket_02 deleted along with bracket_01
  modifiers_dropped       edits correct, but every bevel/array modifier is gone (scene rebuilt, not edited)

Control (not a fault: it shows no work at all, and must score 0):
  unchanged_copy          the input saved under the output name, untouched
"""
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0]) / "data"
FAULT = args[1] if len(args) > 1 else ""
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(Path(__file__).resolve().parent / "input" / "workshop.blend"))
D = bpy.data.objects

if FAULT == "unchanged_copy":
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "workshop_edited.blend"), compress=True)
    sys.exit(0)

D["bolt_01" if FAULT == "moved_wrong_bolt" else "bolt_02"].location = (2.0, 1.5, 0.25)

yellow = bpy.data.materials.new("warning_yellow")
next(n for n in yellow.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (1.0, 0.8, 0.0, 1.0)
plate = D["plate_03"]
if FAULT == "shared_mesh_material":
    plate.data.materials[0] = yellow
elif FAULT == "yellow_in_unused_slot":
    plate.data = plate.data.copy()
    plate.data.materials.append(yellow)
else:
    plate.data = plate.data.copy()  # the plates share one mesh; give plate_03 its own
    plate.data.materials[0] = yellow

bpy.data.objects.remove(D["bracket_01"], do_unlink=True)
if FAULT == "collateral_delete":
    bpy.data.objects.remove(D["bracket_02"], do_unlink=True)
if FAULT == "modifiers_dropped":
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.modifiers.clear()

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "workshop_edited.blend"), compress=True)
