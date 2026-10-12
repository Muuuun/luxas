"""Draw input/drawing.png: the three-view drawing an arm is given. Run once; the PNG is committed.

    blender -b --factory-startup --python make_input.py

Step 1 (here, in Blender): build the bracket from part_def and render three
orthographic line views with Freestyle — visible edges solid, hidden edges
dashed — at 10 px per millimetre.
Step 2 (make_drawing.py, system Python with matplotlib): lay the three views
out in third-angle arrangement on millimetre axes.
"""
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import part_def as P  # noqa: E402
from build import build_part  # noqa: E402

PX_PER_MM = 10
# name: (camera location, camera rotation, horizontal extent, vertical extent) in mm
VIEWS = {
    "top": ((50, 30, 300), (0, 0, 0), (-10, 110), (-10, 70)),
    "front": ((50, -300, 25), (math.radians(90), 0, 0), (-10, 110), (-10, 60)),
    "right": ((400, 30, 25), (math.radians(90), 0, math.radians(90)), (-10, 70), (-10, 60)),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
part = build_part(P.ADD, P.CUT)

white = bpy.data.materials.new("paper")
nt = white.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
emit = nt.nodes.new("ShaderNodeEmission")
emit.inputs["Color"].default_value = (1, 1, 1, 1)
nt.links.new(emit.outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
part.data.materials.clear()
part.data.materials.append(white)

world = bpy.data.worlds.new("paper")
world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
scene.world = world
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
scene.view_settings.view_transform = "Standard"
scene.render.image_settings.file_format = "PNG"
scene.render.resolution_percentage = 100

scene.render.use_freestyle = True
layer = scene.view_layers[0]
layer.use_freestyle = True
fs = layer.freestyle_settings
for ls in list(fs.linesets):
    fs.linesets.remove(ls)
# Every real edge is a crease. The default (134 deg) drops the 135 deg edges of
# the rib and the chamfer; 170 keeps them and still skips the facets of a
# 96-sided cylinder (176 deg).
fs.crease_angle = math.radians(170)
for name, visibility, thickness, dashed in (("visible", "VISIBLE", 3.0, False), ("hidden", "HIDDEN", 2.0, True)):
    ls = fs.linesets.new(name)
    ls.select_by_visibility, ls.visibility = True, visibility
    ls.select_silhouette = ls.select_border = ls.select_crease = True
    ls.linestyle.color, ls.linestyle.thickness = (0, 0, 0), thickness
    if dashed:
        ls.linestyle.use_dashed_line, ls.linestyle.dash1, ls.linestyle.gap1 = True, 12, 9

cam_data = bpy.data.cameras.new("view")
cam_data.type = "ORTHO"
cam_data.clip_end = 2000
cam = bpy.data.objects.new("view", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

tmp = Path(tempfile.mkdtemp(prefix="blender06-"))
for name, (loc, rot, (h0, h1), (v0, v1)) in VIEWS.items():
    cam.location, cam.rotation_euler = loc, rot
    w, h = h1 - h0, v1 - v0
    cam_data.ortho_scale = max(w, h)
    scene.render.resolution_x, scene.render.resolution_y = w * PX_PER_MM, h * PX_PER_MM
    scene.render.filepath = str(tmp / f"{name}.png")
    bpy.ops.render.render(write_still=True)

(HERE / "input").mkdir(exist_ok=True)
subprocess.run(["python3", str(HERE / "make_drawing.py"), str(tmp), str(HERE / "input" / "drawing.png")], check=True)
print("DRAWING", HERE / "input" / "drawing.png")
