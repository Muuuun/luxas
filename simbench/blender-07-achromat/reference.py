"""Reference achromat, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

The prescriptions are the output of design.py. Each fault is a doublet that
opens, looks right, and misses one requirement:
  efl_103             focal length 103 mm, colour and spherical aberration corrected
  colour_uncorrected  F and C foci 0.15 mm apart, the rest corrected
  plano_back          flat last surface: focal length and colour met, no bending left for spherical aberration
  crown_8mm           crown 8 mm thick, re-optimised so that the optics still pass
  rippled_surface     reference prescription, front surface off its sphere by up to 5 um
  air_gap             flint moved 0.2 mm back: not cemented
  open_mesh           one face deleted from the flint
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

RADIUS, RINGS, SEGMENTS = 12.5, 48, 96
# (c1, c2, c3, crown centre thickness) — curvatures in 1/mm, from design.py
PRESCRIPTION = {
    "": (0.01877000, -0.02117807, -0.00542635, 6.0),
    "efl_103": (0.01814000, -0.02060848, -0.00534377, 6.0),
    "colour_uncorrected": (0.02150000, -0.02064988, -0.00309676, 6.0),
    "plano_back": (0.02400949, -0.01624375, 0.0, 6.0),
    "crown_8mm": (0.01896000, -0.02147024, -0.00534743, 8.0),
}
c1, c2, c3, t1 = PRESCRIPTION.get(FAULT, PRESCRIPTION[""])
T2 = 2.5
gap = 0.2 if FAULT == "air_gap" else 0.0


def sag(c, h):
    return c * h * h / (1 + math.sqrt(1 - c * c * h * h))


def element(name, z_front, c_front, z_back, c_back, ripple=0.0):
    bm = bmesh.new()

    def surface(z0, c, bump):
        centre = bm.verts.new((0.0, 0.0, z0))
        rings = []
        for k in range(1, RINGS + 1):
            h = RADIUS * k / RINGS
            z = z0 + sag(c, h) + bump * math.sin(math.pi * 6 * k / RINGS)
            rings.append([bm.verts.new((h * math.cos(2 * math.pi * j / SEGMENTS), h * math.sin(2 * math.pi * j / SEGMENTS), z)) for j in range(SEGMENTS)])
        for j in range(SEGMENTS):
            bm.faces.new((centre, rings[0][j], rings[0][(j + 1) % SEGMENTS]))
        for a, b in zip(rings, rings[1:]):
            for j in range(SEGMENTS):
                bm.faces.new((a[j], b[j], b[(j + 1) % SEGMENTS], a[(j + 1) % SEGMENTS]))
        return rings[-1]

    front, back = surface(z_front, c_front, ripple), surface(z_back, c_back, 0.0)
    for j in range(SEGMENTS):
        bm.faces.new((front[j], front[(j + 1) % SEGMENTS], back[(j + 1) % SEGMENTS], back[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
element("crown", 0.0, c1, t1, c2, ripple=0.005 if FAULT == "rippled_surface" else 0.0)
flint = element("flint", t1 + gap, c2, t1 + gap + T2, c3)
if FAULT == "open_mesh":
    bm = bmesh.new()
    bm.from_mesh(flint.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[0]], context="FACES")
    bm.to_mesh(flint.data)
    bm.free()

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "doublet.blend"), compress=True)
