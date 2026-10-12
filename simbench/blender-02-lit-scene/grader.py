"""Grader for blender-02-lit-scene. Re-opens <project>/data/scene.blend and renders it itself.

    blender -b --factory-startup --python grader.py -- <project-dir>

Two kinds of render, neither of them the arm's own:
  - through the scene's camera with the scene's lights, to judge framing and exposure;
  - one object at a time under the grader's white world and the grader's camera, to
    judge whether the material reaches the renderer at all. A colour set only on the
    viewport, or a material in a slot no face uses, renders grey here.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_lib"))
import grade as G  # noqa: E402

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

LABELS = [
    "opens and holds mesh objects named ball and box",
    "ball is a 1 m radius sphere at (0,0,1) and box is a 2 m cube at (3,0,1)",
    "active camera frames both objects completely",
    "both objects are unobstructed from the camera",
    "the scene's own lighting exposes what the camera sees (not black, not blown out)",
    "data/render.png exists and is not blank",
    "ball renders red under the grader's neutral light",
    "box renders blue under the grader's neutral light",
]
g = G.Grade()
proj = G.project_dir()
tmp = Path(tempfile.mkdtemp(prefix="simbench-"))

ok = G.open_blend(proj / "data" / "scene.blend")
ball, box = (G.mesh_object("ball"), G.mesh_object("box")) if ok else (None, None)
if not g.check(LABELS[0], ball is not None and box is not None, "" if ok else "data/scene.blend missing or unreadable"):
    for label in LABELS[1:]:
        g.check(label, False, "no artifact to measure")
    g.emit()
    sys.exit(0)

scene = bpy.context.scene
deps = bpy.context.evaluated_depsgraph_get()
WANT = {"ball": ((-1, -1, 0), (1, 1, 2)), "box": ((2, -1, 0), (4, 1, 2))}
corners, geo_bad = {}, []
for o in (ball, box):
    bm = G.world_bmesh(o)
    lo, hi = G.bbox(bm)
    bm.free()
    corners[o.name] = [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    wlo, whi = WANT[o.name]
    if max(max(abs(a - b) for a, b in zip(lo, wlo)), max(abs(a - b) for a, b in zip(hi, whi))) > 0.03:
        geo_bad.append(f"{o.name} spans {tuple(round(c, 2) for c in lo)}..{tuple(round(c, 2) for c in hi)}")
g.check(LABELS[1], not geo_bad, "; ".join(geo_bad))

CENTER = {"ball": Vector((0, 0, 1)), "box": Vector((3, 0, 1))}
cam = scene.camera
view = {}
if cam is None:
    g.check(LABELS[2], False, "scene has no active camera")
    g.check(LABELS[3], False, "scene has no active camera")
    g.check(LABELS[4], False, "scene has no active camera")
else:
    out_of_frame = []
    for name, pts in corners.items():
        uv = [world_to_camera_view(scene, cam, p) for p in pts]
        if not all(0.0 <= c.x <= 1.0 and 0.0 <= c.y <= 1.0 and c.z > 0 for c in uv):
            out_of_frame.append(name)
        c = world_to_camera_view(scene, cam, CENTER[name])
        if 0.0 <= c.x <= 1.0 and 0.0 <= c.y <= 1.0 and c.z > 0:
            view[name] = (c.x, c.y)
    g.check(LABELS[2], not out_of_frame, f"outside the frame: {', '.join(out_of_frame)}")

    blocked = []
    origin = cam.matrix_world.translation
    for o in (ball, box):
        hit, _loc, _n, _i, hit_obj, _m = scene.ray_cast(deps, origin, (CENTER[o.name] - origin).normalized())
        if not hit or hit_obj is None or hit_obj.name != o.name:
            blocked.append(f"{o.name} (first hit: {hit_obj.name if hit and hit_obj else 'nothing'})")
    g.check(LABELS[3], not blocked, f"blocked: {', '.join(blocked)}")

    if not view:
        g.check(LABELS[4], False, "neither object centre is in the frame")
    else:
        w, h, px = G.render_to_pixels(scene, tmp / "own.png")
        lum = {}
        for name, (u, v) in view.items():
            r, gr, b = G.patch_rgb(w, h, px, u, v)
            lum[name] = 0.2126 * r + 0.7152 * gr + 0.0722 * b
        bad = {n: round(v, 3) for n, v in lum.items() if not (0.04 <= v <= 0.97)}
        g.check(LABELS[4], not bad, f"luminance {bad or {n: round(v, 3) for n, v in lum.items()}}")

shot = proj / "data" / "render.png"
detail, blank = "missing", True
if shot.is_file():
    try:
        img = bpy.data.images.load(str(shot))
        w, h = img.size
        px = img.pixels[:]
        vals = [px[i] + px[i + 1] + px[i + 2] for i in range(0, len(px), 4 * max(1, (w * h) // 4000))]
        blank = not vals or (max(vals) - min(vals)) < 0.15
        detail = f"{w}x{h}, channel-sum range {max(vals) - min(vals):.3f}" if vals else "empty image"
    except Exception as e:  # unreadable file is a blank render
        detail = f"unreadable: {e}"
g.check(LABELS[5], not blank, detail)

# --- neutral-light renders: destructive from here on ------------------------
for o in list(bpy.data.objects):
    if o.type == "LIGHT":
        bpy.data.objects.remove(o, do_unlink=True)
world = bpy.data.worlds.new("grader_world")
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 1.0
scene.world = world
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
gcam = bpy.data.objects.new("grader_cam", bpy.data.cameras.new("grader_cam"))
scene.collection.objects.link(gcam)
scene.camera = gcam

DOMINANT = {"ball": 0, "box": 2}
for label, o in ((LABELS[6], ball), (LABELS[7], box)):
    for other in bpy.data.objects:
        if other.type == "MESH":
            other.hide_render = other.name != o.name
    c = CENTER[o.name]
    gcam.location = c + Vector((0, -6, 2.5))
    gcam.rotation_euler = (c - gcam.location).to_track_quat("-Z", "Y").to_euler()
    w, h, px = G.render_to_pixels(scene, tmp / f"{o.name}.png", 160, 120)
    rgb = G.patch_rgb(w, h, px, 0.5, 0.5, half=4)
    d = DOMINANT[o.name]
    others = [rgb[i] for i in range(3) if i != d]
    g.check(label, rgb[d] > 0.15 and rgb[d] >= 1.6 * max(others), f"centre pixel rgb {tuple(round(x, 3) for x in rgb)}")

g.emit()
