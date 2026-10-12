"""Shared helpers for simbench graders. Runs inside Blender (bpy).

A grader re-opens the artifact an arm saved and measures it there. Nothing the
arm printed, returned or wrote into a report is read: on 2026-10-06 a script
that exited 0 and self-reported the right material colour rendered a grey part
(the baked boolean mesh kept an empty slot 0 that every face still used).

Every grader prints exactly one line, `GRADE_JSON {"checks": [...]}`; the reader
is runArtifactCheck in scripts/bench_score.mts.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class Grade:
    def __init__(self):
        self.checks = []

    def check(self, label, ok, detail=""):
        self.checks.append({"label": label, "pass": bool(ok), "detail": str(detail)[:300]})
        return bool(ok)

    def emit(self):
        print("GRADE_JSON " + json.dumps({"checks": self.checks}))


def project_dir():
    return Path(sys.argv[sys.argv.index("--") + 1])


def open_blend(path):
    if not Path(path).is_file():
        return False
    try:
        bpy.ops.wm.open_mainfile(filepath=str(path))
        return True
    except Exception:
        return False


def mesh_object(name):
    o = bpy.data.objects.get(name)
    return o if o is not None and o.type == "MESH" else None


def world_bmesh(obj):
    """Evaluated (modifiers applied), triangulated, world-space bmesh. Caller frees."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    ev.to_mesh_clear()
    bm.transform(obj.matrix_world)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    return bm


def bbox(bm):
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def non_manifold_edges(bm):
    return sum(1 for e in bm.edges if not e.is_manifold)


# Directions with no rational relation to any axis, so a probe ray does not run
# along a face or through an edge of an axis-aligned part.
_PROBE_DIRS = [Vector(d).normalized() for d in ((0.5377, 0.3181, 0.7809), (-0.6131, 0.7411, 0.2737), (0.2251, -0.4673, -0.8549))]


def make_inside_test(bm):
    """point -> True when the point is inside the closed surface (ray parity, 2-of-3 vote)."""
    if not bm.verts:
        return lambda p: False
    tree = BVHTree.FromBMesh(bm)
    lo, hi = bbox(bm)
    # The ray restarts just past each hit. That step has to clear float32 spacing
    # at the size of the part, or the same triangle is hit twice and parity
    # flips: with a fixed 1e-5 on a 100 mm gear, 314 of 14400 probes split their
    # votes and 5 came out wrong after the vote (2026-10-06). Scaled to the
    # part, and a second hit on the same face within a few steps is not counted.
    step = 2e-6 * max(1e-3, (Vector(hi) - Vector(lo)).length)

    def crossings(p, d):
        n, origin, last = 0, Vector(p), -1
        for _ in range(4096):
            hit, _normal, idx, dist = tree.ray_cast(origin, d)
            if hit is None:
                return n
            if not (idx == last and dist < 4 * step):
                n += 1
            last = idx
            origin = hit + d * step
        return n

    def inside(p):
        votes = sum(crossings(p, d) % 2 for d in _PROBE_DIRS)
        return votes >= 2

    return inside


def probe(inside, expectations):
    """expectations: [(point, should_be_inside)] -> (all_ok, 'first mismatch' or '')."""
    for p, want in expectations:
        got = inside(p)
        if got != want:
            return False, f"point {tuple(round(c, 3) for c in p)} is {'inside' if got else 'outside'} the solid, expected {'inside' if want else 'outside'}"
    return True, ""


def principled_base_color(mat):
    """Base colour the renderer will use, or None when no Principled BSDF feeds the output."""
    if mat is None or mat.node_tree is None:
        return None
    for link in mat.node_tree.links:
        if link.to_node.type == "OUTPUT_MATERIAL" and link.to_socket.name == "Surface" and link.from_node.type == "BSDF_PRINCIPLED":
            return tuple(link.from_node.inputs["Base Color"].default_value)[:3]
    return None


def face_materials(obj):
    """Materials the faces actually reference (a slot no face uses does not count)."""
    used = {p.material_index for p in obj.data.polygons}
    out = []
    for i in sorted(used):
        out.append(obj.material_slots[i].material if i < len(obj.material_slots) else None)
    return out


def render_to_pixels(scene, path, width=320, height=240, samples=16):
    """Cycles CPU render through the scene camera; returns (w, h, flat RGBA floats)."""
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = img.pixels[:]
    bpy.data.images.remove(img)
    return w, h, px


def patch_rgb(w, h, px, u, v, half=2):
    """Mean RGB of a small patch at view coordinates (u, v) in [0,1], origin bottom-left."""
    cx, cy = int(u * (w - 1)), int(v * (h - 1))
    acc, n = [0.0, 0.0, 0.0], 0
    for y in range(max(0, cy - half), min(h, cy + half + 1)):
        for x in range(max(0, cx - half), min(w, cx + half + 1)):
            i = (y * w + x) * 4
            acc[0] += px[i]; acc[1] += px[i + 1]; acc[2] += px[i + 2]
            n += 1
    return tuple(a / n for a in acc) if n else (0.0, 0.0, 0.0)


def tilt_deg(obj_matrix_world):
    """Angle between the object's local +Z and world +Z."""
    z = (obj_matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    return math.degrees(math.acos(max(-1.0, min(1.0, z.z))))
