"""Reference domino run, and planted-fault variants for scripts/smoke_simbench_graders.mts.

    blender -b --factory-startup --python reference.py -- <project-dir> [fault]

Faults (each still saves a scene that opens):
  weak_trigger       domino_01 leans 3 deg, inside its 5.7 deg tipping angle: it rocks back, nothing falls
  no_trigger         all ten upright
  no_ground_body     the ground has no rigid body; everything drops through it
  passive_dominoes   dominoes 02-10 are passive bodies
  spacing_too_wide   1.3 m apart, further than a domino is tall
  keyframed_fake     no physics at all: every domino is keyframed to lie flat at frame 250
"""
import math
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0]) / "data"
FAULT = args[1] if len(args) > 1 else ""
OUT.mkdir(parents=True, exist_ok=True)
T, W, H = 0.1, 0.5, 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 250, 24
bpy.ops.rigidbody.world_add()
scene.rigidbody_world.point_cache.frame_start = 1
scene.rigidbody_world.point_cache.frame_end = 250


def body(obj, kind):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.rigidbody.object_add(type=kind)
    obj.rigid_body.collision_shape = "BOX"
    obj.rigid_body.mass = 1.0


bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.25, 0, -0.25))
ground = bpy.context.active_object
ground.name = "ground"
ground.scale = (20.0, 10.0, 0.5)
if FAULT != "no_ground_body":
    body(ground, "PASSIVE")

spacing = 1.3 if FAULT == "spacing_too_wide" else 0.5
lean = math.radians({"weak_trigger": 3.0, "no_trigger": 0.0, "keyframed_fake": 0.0}.get(FAULT, 15.0))
for i in range(10):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(spacing * i, 0, H / 2))
    d = bpy.context.active_object
    d.name = f"domino_{i + 1:02d}"
    d.scale = (T, W, H)
    if i == 0 and lean:
        # Lean about the +X bottom edge so the domino still touches the ground.
        d.rotation_euler = (0.0, lean, 0.0)
        d.location = (T / 2 - T / 2 * math.cos(lean) + H / 2 * math.sin(lean), 0.0, T / 2 * math.sin(lean) + H / 2 * math.cos(lean))
    if FAULT == "keyframed_fake":
        d.keyframe_insert("rotation_euler", frame=1)
        d.keyframe_insert("location", frame=1)
        d.rotation_euler, d.location = (0.0, math.radians(90), 0.0), (spacing * i + H / 2, 0.0, T / 2)
        d.keyframe_insert("rotation_euler", frame=250)
        d.keyframe_insert("location", frame=250)
    else:
        body(d, "PASSIVE" if FAULT == "passive_dominoes" and i > 0 else "ACTIVE")

scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "dominoes.blend"), compress=True)
