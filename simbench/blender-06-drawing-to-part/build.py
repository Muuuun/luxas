"""Build the blender-06 bracket as one mesh from part_def. Runs inside Blender.

Shared by reference.py (the known-good part and its planted faults) and
make_input.py (the drawing). Not copied into a run directory.
"""
import math

import bmesh
import bpy

SEGMENTS = 96


def _mesh_object(name, verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _prism(name, tri, lo, hi, axis):
    """Triangle `tri` (2D) extruded from lo to hi along `axis` ('x' or 'z')."""
    place = (lambda p, t: (t, p[0], p[1])) if axis == "x" else (lambda p, t: (p[0], p[1], t))
    verts = [place(p, lo) for p in tri] + [place(p, hi) for p in tri]
    return _mesh_object(name, verts, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])


def primitive(name, kind, a):
    if kind == "box":
        x0, y0, z0, x1, y1, z1 = a
        v = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        return _mesh_object(name, v, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    if kind == "cyl_z":
        cx, cy, r, z0, z1 = a
        bpy.ops.mesh.primitive_cylinder_add(vertices=SEGMENTS, radius=r, depth=z1 - z0, location=(cx, cy, (z0 + z1) / 2))
        return bpy.context.active_object
    if kind == "cyl_y":
        cx, cz, r, y0, y1 = a
        bpy.ops.mesh.primitive_cylinder_add(vertices=SEGMENTS, radius=r, depth=y1 - y0, location=(cx, (y0 + y1) / 2, cz),
                                            rotation=(math.radians(90), 0, 0))
        return bpy.context.active_object
    if kind == "rib":
        x0, x1, y0, y1, z0, z1 = a
        return _prism(name, [(y0, z0), (y1, z0), (y1, z1)], x0, x1, "x")
    if kind == "corner":
        (c,) = a
        return _prism(name, [(-1, -1), (c + 1, -1), (-1, c + 1)], -1, 51, "z")
    raise ValueError(kind)


def _boolean(target, tool, op):
    m = target.modifiers.new(op.lower(), "BOOLEAN")
    m.operation, m.object, m.solver = op, tool, "EXACT"
    deps = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(target.evaluated_get(deps))
    target.modifiers.clear()
    target.data = baked
    bpy.data.objects.remove(tool, do_unlink=True)


def build_part(add, cut, name="part"):
    part = primitive(name, add[0][1], add[0][2])
    for n, kind, a in add[1:]:
        _boolean(part, primitive(n, kind, a), "UNION")
    for n, kind, a in cut:
        _boolean(part, primitive(n, kind, a), "DIFFERENCE")
    part.name = name
    return part
