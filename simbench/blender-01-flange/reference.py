"""Reference flange, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Faults (each still saves a file that opens — "built but wrong"):
  bolt_circle_58      bolt holes on a 58 mm circle (volume and bbox unchanged)
  holes_rotated_45    bolt holes at 45/135/225/315 deg (volume and bbox unchanged)
  no_bolt_holes       bolt holes missing
  bore_blind          bore stops at the top face of the base
  open_mesh           one face deleted
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0]) / "data"
FAULT = args[1] if len(args) > 1 else ""
OUT.mkdir(parents=True, exist_ok=True)
N = 128

bpy.ops.wm.read_factory_settings(use_empty=True)


def cyl(radius, z0, z1, x=0.0, y=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=N, radius=radius, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    return bpy.context.active_object


def boolean(target, tool, op):
    m = target.modifiers.new(op.lower(), "BOOLEAN")
    m.operation, m.object, m.solver = op, tool, "EXACT"
    deps = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(target.evaluated_get(deps))
    target.modifiers.clear()
    target.data = baked
    bpy.data.objects.remove(tool, do_unlink=True)


part = cyl(40.0, 0.0, 8.0)
boolean(part, cyl(20.0, 7.0, 28.0), "UNION")
boolean(part, cyl(10.0, 8.0 if FAULT == "bore_blind" else -1.0, 29.0), "DIFFERENCE")
if FAULT != "no_bolt_holes":
    r = 29.0 if FAULT == "bolt_circle_58" else 30.0
    for k in range(4):
        a = math.radians(90 * k + (45 if FAULT == "holes_rotated_45" else 0))
        boolean(part, cyl(4.0, -1.0, 9.0, r * math.cos(a), r * math.sin(a)), "DIFFERENCE")
if FAULT == "open_mesh":
    bm = bmesh.new()
    bm.from_mesh(part.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[0]], context="FACES")
    bm.to_mesh(part.data)
    bm.free()
part.name = "flange"

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "flange.blend"), compress=True)
