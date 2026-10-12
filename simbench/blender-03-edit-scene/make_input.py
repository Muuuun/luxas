"""Builds input/workshop.blend, the scene the arm is asked to edit.

    blender -b --factory-startup --python make_input.py

The committed .blend is this script's output; re-run it only to change the task.
Three traps are deliberate, because each needs the scene's state to be read
before it is changed: the plates share ONE mesh datablock, plates and brackets
share ONE material, and every plate and bracket carries a modifier.
"""
import math
from pathlib import Path

import bpy

OUT = Path(__file__).resolve().parent / "input" / "workshop.blend"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (*rgb, 1.0)
    return m


steel = material("steel", (0.6, 0.6, 0.65))
brass = material("brass", (0.8, 0.6, 0.2))

bpy.ops.mesh.primitive_cube_add(size=1.0)
proto = bpy.context.active_object
plate_mesh = proto.data
plate_mesh.name = "plate_mesh"
plate_mesh.materials.append(steel)
bpy.data.objects.remove(proto, do_unlink=True)
for i in range(3):
    o = bpy.data.objects.new(f"plate_{i + 1:02d}", plate_mesh)  # linked duplicates
    o.location, o.scale = (1.5 * i, 0.0, 0.05), (1.0, 0.6, 0.1)
    scene.collection.objects.link(o)
    bevel = o.modifiers.new("edge_break", "BEVEL")
    bevel.width, bevel.segments = 0.01, 2

for i in range(3):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.08, depth=0.5, location=(1.5 * i, 1.5, 0.25))
    o = bpy.context.active_object
    o.name = f"bolt_{i + 1:02d}"
    o.data.materials.append(brass)

for i in range(3):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.5 * i, 3.0, 0.15))
    o = bpy.context.active_object
    o.name = f"bracket_{i + 1:02d}"
    o.scale, o.rotation_euler = (0.3, 0.1, 0.3), (0.0, 0.0, math.radians(15))
    o.data.materials.append(steel)
    arr = o.modifiers.new("pair", "ARRAY")
    arr.count, arr.relative_offset_displace = 2, (1.5, 0.0, 0.0)

cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
cam.location, cam.rotation_euler = (1.5, -7.0, 5.0), (math.radians(58), 0.0, 0.0)
scene.collection.objects.link(cam)
scene.camera = cam
light = bpy.data.objects.new("key_light", bpy.data.lights.new("key_light", "SUN"))
light.data.energy, light.rotation_euler = 3.0, (math.radians(40), 0.0, math.radians(20))
scene.collection.objects.link(light)

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
