"""Reference lit scene, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Faults (each still saves a scene that opens and renders without error):
  material_unused_slot   ball's red material sits in a slot no face uses (the 2026-10-06 bug)
  viewport_color_only    box is blue in the viewport only; the node tree is left at default
  camera_misses_box      camera framed on the ball alone
  occluded               a wall stands between the camera and the ball
  no_light               no lamp and a black world
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0]) / "data"
FAULT = args[1] if len(args) > 1 else ""
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, rgb, nodes=True):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    if nodes:
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    return m


bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=(0, 0, 1))
ball = bpy.context.active_object
ball.name = "ball"
red = material("red", (0.8, 0.05, 0.05))
if FAULT == "material_unused_slot":
    ball.data.materials.append(None)   # slot 0: empty, used by every face
    ball.data.materials.append(red)    # slot 1: referenced by nothing
else:
    ball.data.materials.append(red)

bpy.ops.mesh.primitive_cube_add(size=2.0, location=(3, 0, 1))
box = bpy.context.active_object
box.name = "box"
box.data.materials.append(material("blue", (0.05, 0.1, 0.8), nodes=FAULT != "viewport_color_only"))

bpy.ops.mesh.primitive_plane_add(size=40.0, location=(0, 0, 0))
bpy.context.active_object.name = "floor"

if FAULT == "occluded":
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, -4, 1.5))
    wall = bpy.context.active_object
    wall.name = "wall"
    wall.scale = (3.0, 0.2, 3.0)

cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(cam)
target = Vector((0, 0, 1)) if FAULT == "camera_misses_box" else Vector((1.5, 0, 1))
cam.location = Vector((0, -5.0, 1.6)) if FAULT == "camera_misses_box" else Vector((1.5, -10.0, 4.0))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

world = bpy.data.worlds.new("world")
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
scene.world = world
if FAULT == "no_light":
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
else:
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
    bg.inputs["Strength"].default_value = 0.6
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(25))
    scene.collection.objects.link(sun)

scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.device = "CPU"
scene.render.resolution_x, scene.render.resolution_y = 640, 480
scene.render.filepath = str(OUT / "render.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "scene.blend"), compress=True)
