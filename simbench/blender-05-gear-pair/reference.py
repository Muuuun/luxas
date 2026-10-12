"""Reference gear pair, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Faults (each still saves a file that opens and looks like two gears in mesh):
  tooth_on_tooth    gear turned half a pitch: a tooth faces a tooth at the saved pose
  center_49         gear axis at x = 49: the teeth clear, with 0.7 mm of backlash
  straight_flanks   trapezoid teeth, right thickness at the pitch circle, not conjugate
  gear_29_teeth     29 teeth on the gear, driven at the 18:30 ratio
  wide_backlash     every tooth 0.25 mm thin: runs free, rattles
  no_bores          bores missing
  open_mesh         one face deleted from the pinion
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

M, ALPHA, WIDTH = 2.0, math.radians(20.0), 10.0


def inv(a):
    return math.tan(a) - a


def outline(z, thin, phase, straight=False, flank_pts=24, arc_pts=6):
    """Counter-clockwise outline of a full-depth spur gear about the origin, a tooth centred on `phase`."""
    r = M * z / 2
    rb, ra, rf = r * math.cos(ALPHA), r + M, r - 1.25 * M
    psi = math.pi / (2 * z) - thin / (2 * r)  # half the tooth's angle at the pitch circle

    def half_angle(rho):
        if straight:  # the tangent to the involute at the pitch point, extended both ways
            s = -rb + math.sqrt(rho * rho - (r * math.sin(ALPHA)) ** 2)
            return psi + math.atan2(-s * math.sin(ALPHA), r + s * math.cos(ALPHA))
        if rho <= rb:
            return psi + inv(ALPHA)
        return psi + inv(ALPHA) - inv(math.acos(rb / rho))

    radii = [rf + (ra - rf) * i / flank_pts for i in range(flank_pts + 1)]
    polar = []
    for k in range(z):
        c = phase + 2 * math.pi * k / z
        polar += [(rho, c - half_angle(rho)) for rho in radii]
        tip = half_angle(ra)
        polar += [(ra, c - tip + 2 * tip * i / arc_pts) for i in range(1, arc_pts)]
        polar += [(rho, c + half_angle(rho)) for rho in reversed(radii)]
        root = half_angle(rf)
        gap = 2 * math.pi / z - 2 * root
        polar += [(rf, c + root + gap * i / arc_pts) for i in range(1, arc_pts)]
    return [(rho * math.cos(a), rho * math.sin(a)) for rho, a in polar]


def prism(name, pts, cx):
    bm = bmesh.new()
    lo = [bm.verts.new((x + cx, y, 0.0)) for x, y in pts]
    hi = [bm.verts.new((x + cx, y, WIDTH)) for x, y in pts]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bore(target, radius, cx):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=radius, depth=WIDTH + 2, location=(cx, 0, WIDTH / 2))
    tool = bpy.context.active_object
    m = target.modifiers.new("bore", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", tool, "EXACT"
    deps = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(target.evaluated_get(deps))
    target.modifiers.clear()
    target.data = baked
    bpy.data.objects.remove(tool, do_unlink=True)


bpy.ops.wm.read_factory_settings(use_empty=True)

thin = 0.25 if FAULT == "wide_backlash" else 0.02
z2 = 29 if FAULT == "gear_29_teeth" else 30
cx = 49.0 if FAULT == "center_49" else 48.0
straight = FAULT == "straight_flanks"
# The pinion has a tooth on the line of centres, so the gear needs a space there:
# its teeth sit half a pitch off the direction that faces the pinion.
gear_phase = math.pi if FAULT == "tooth_on_tooth" else math.pi + math.pi / z2

pinion = prism("pinion", outline(18, thin, 0.0, straight), 0.0)
gear = prism("gear", outline(z2, thin, gear_phase, straight), cx)
if FAULT != "no_bores":
    bore(pinion, 4.0, 0.0)
    bore(gear, 6.0, cx)
if FAULT == "open_mesh":
    bm = bmesh.new()
    bm.from_mesh(pinion.data)
    bm.faces.ensure_lookup_table()
    side = next(f for f in bm.faces if len(f.verts) == 4)
    bmesh.ops.delete(bm, geom=[side], context="FACES")
    bm.to_mesh(pinion.data)
    bm.free()

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "gears.blend"), compress=True)
