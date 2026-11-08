"""fig0 panel a: two 161Dy atoms in 1064.5-nm tweezers under the bias field B.

blender -b --factory-startup --python-exit-code 1 --python scene.py -- OUT_PREFIX SCALE SAMPLES [--rydberg]
Writes OUT_PREFIX.png and OUT_PREFIX.anchors.json (pixel positions of scene points for overlays).
"""
import bpy, json, math, os, sys
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:]
out, scale, samples = argv[0], float(argv[1]), int(argv[2])
RYD = "--rydberg" in argv
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts"))
import colorkey  # noqa: E402  stdlib only, so Blender's own Python can import it
KEY = colorkey.load_for(out + ".png")   # report/figures/colorkey.json when rendered into a report


def linear(hexc):
    """sRGB hex -> linear RGB tuple for a Blender material."""
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(int(hexc[i:i + 2], 16) / 255) for i in (1, 3, 5))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- geometry (arbitrary units) ----------
D = 4.4          # atom separation
W0, ZR = 0.55, 1.5   # waist and Rayleigh range (exaggerated divergence)
ZC = 3.9         # soft end of the drawn beam
R_ATOM = 0.52
ATOMS = [Vector((-D / 2, 0, 0)), Vector((D / 2, 0, 0))]


def mat_principled(name, color, rough=0.3, metal=0.0, coat=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Alpha"].default_value = alpha
    return m


def sphere(name, loc, r, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


# ---------- tweezer beams: absorbing + faintly emitting Gaussian volumes ----------
def beam_material(name, rgb, amp):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out_n = N("ShaderNodeOutputMaterial")
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Object"], sep.inputs[0])

    def math(op, a, b=None):
        n = N("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    x, y, z = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]
    w2 = math("MULTIPLY", math("ADD", math("MULTIPLY", math("POWER", z, 2.0), 1 / ZR**2), 1.0), W0**2)
    r2 = math("ADD", math("POWER", x, 2.0), math("POWER", y, 2.0))
    gauss = math("EXPONENT", math("MULTIPLY", math("DIVIDE", r2, w2), -2.0))
    peak = math("DIVIDE", W0**2, w2)
    taper = math("EXPONENT", math("MULTIPLY", math("POWER", math("DIVIDE", z, ZC), 6.0), -1.0))
    dens = math("MULTIPLY", math("MULTIPLY", math("MULTIPLY", gauss, peak), taper), amp)

    ab = N("ShaderNodeVolumeAbsorption")
    ab.inputs["Color"].default_value = (*rgb, 1)
    L(dens, ab.inputs["Density"])
    em = N("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.25, 0.2, 1)
    L(math("MULTIPLY", dens, 0.35), em.inputs["Strength"])
    add = N("ShaderNodeAddShader")
    L(ab.outputs[0], add.inputs[0])
    L(em.outputs[0], add.inputs[1])
    L(add.outputs[0], out_n.inputs["Volume"])
    return m


beam_mat = beam_material("tweezer", (0.97, 0.30, 0.27), 2.6)
for i, a in enumerate(ATOMS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=2.2, depth=2 * ZC + 2, location=a)
    c = bpy.context.object
    c.name = f"beam{i}"
    c.data.materials.append(beam_mat)

# ---------- atoms ----------
atom_mat = mat_principled("atom", linear(KEY.color("qubit", "m")), rough=0.20, metal=0.0, coat=1.0)  # the qubit's identity colour
for i, a in enumerate(ATOMS):
    sphere(f"atom{i}", a, R_ATOM, atom_mat)

if RYD:  # optional Rydberg cloud on the right atom
    m = bpy.data.materials.new("ryd")
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    v = nt.nodes.new("ShaderNodeVolumeAbsorption")
    v.inputs["Color"].default_value = (0.55, 0.35, 0.95, 1)
    v.inputs["Density"].default_value = 0.35
    nt.links.new(v.outputs[0], o.inputs["Volume"])
    sphere("ryd", ATOMS[1], 1.5, m)


# ---------- bias coils (schematic), axis along the pair axis ----------
copper = mat_principled("copper", (0.86, 0.70, 0.60), rough=0.45, metal=0.7)
CX, CZ, CR = 4.5, -0.6, 2.25
for sgn in (-1, 1):
    for k in range(4):  # four turns per coil
        bpy.ops.mesh.primitive_torus_add(major_radius=CR, minor_radius=0.085, major_segments=128,
                                         minor_segments=24,
                                         location=(sgn * (CX + 0.25 * (k - 1.5)), 0, CZ),
                                         rotation=(0, math.pi / 2, 0))
        bpy.ops.object.shade_smooth()
        bpy.context.object.data.materials.append(copper)

# ---------- B arrow along the pair axis, below the atoms ----------
arrow_mat = mat_principled("arrow", (0.16, 0.17, 0.19), rough=0.35, coat=0.6)
AZ, AY = -1.9, 0.0
L_SHAFT, R_SHAFT, L_HEAD, R_HEAD = 6.5, 0.13, 0.95, 0.34
x0 = -(L_SHAFT + L_HEAD) / 2
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R_SHAFT, depth=L_SHAFT,
                                    location=(x0 + L_SHAFT / 2, AY, AZ), rotation=(0, math.pi / 2, 0))
bpy.context.object.data.materials.append(arrow_mat)
bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=R_HEAD, radius2=0, depth=L_HEAD,
                                location=(x0 + L_SHAFT + L_HEAD / 2, AY, AZ), rotation=(0, math.pi / 2, 0))
bpy.context.object.data.materials.append(arrow_mat)
bpy.ops.object.shade_smooth()
ARROW_TAIL = Vector((x0, AY, AZ))
ARROW_TIP = Vector((x0 + L_SHAFT + L_HEAD, AY, AZ))

# ---------- light and world ----------
world = bpy.data.worlds.new("w")
scene.world = world
wn = world.node_tree
bg = wn.nodes["Background"]
lp = wn.nodes.new("ShaderNodeLightPath")
bg_light = wn.nodes.new("ShaderNodeBackground")
bg_light.inputs["Color"].default_value = (1, 1, 1, 1)
bg_light.inputs["Strength"].default_value = 0.45
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 1.0
mix = wn.nodes.new("ShaderNodeMixShader")
wn.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
wn.links.new(bg_light.outputs[0], mix.inputs[1])
wn.links.new(bg.outputs[0], mix.inputs[2])
wn.links.new(mix.outputs[0], wn.nodes["World Output"].inputs["Surface"])

bpy.ops.object.light_add(type="AREA", location=(-6, -8, 9))
key = bpy.context.object
key.data.energy = 2200
key.data.size = 5
key.rotation_euler = (Vector((0, 0, 0)) - key.location).to_track_quat("-Z", "Y").to_euler()

# ---------- camera ----------
bpy.ops.object.camera_add(location=(8.0, -27.5, 8.4))
cam = bpy.context.object
target = Vector((0.0, 0.0, -0.35))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 85
scene.camera = cam

# ---------- render ----------
r = scene.render
r.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
r.threads_mode = "FIXED"
r.threads = 4
r.resolution_x, r.resolution_y = 1620, 1740
r.resolution_percentage = int(100 * scale)
r.film_transparent = False
scene.view_settings.view_transform = "Standard"
r.image_settings.file_format = "PNG"
r.filepath = out + ".png"
bpy.ops.render.render(write_still=True)

# ---------- anchors in pixel coordinates (origin top-left) ----------
W = r.resolution_x * r.resolution_percentage / 100
H = r.resolution_y * r.resolution_percentage / 100


def px(p):
    v = world_to_camera_view(scene, cam, Vector(p))
    return [v.x * W, (1 - v.y) * H]


anchors = {"size": [W, H]}
for i, a in enumerate(ATOMS):
    anchors[f"atom{i}"] = px(a)
    anchors[f"atom{i}_edge"] = px(a + Vector((R_ATOM, 0, 0)))
    anchors[f"beam{i}_top"] = px(a + Vector((0, 0, ZC * 0.85)))
    anchors[f"beam{i}_bot"] = px(a + Vector((0, 0, -ZC * 0.85)))
anchors["arrow_tail"] = px(ARROW_TAIL)
anchors["arrow_tip"] = px(ARROW_TIP)
anchors["coilL_top"] = px(Vector((-CX, 0, CZ + CR)))
anchors["coilR_top"] = px(Vector((CX, 0, CZ + CR)))
anchors["coilR_bot"] = px(Vector((CX, 0, CZ - CR)))
anchors["mid_top"] = px(Vector((0, 0, ZC * 0.85)))
json.dump(anchors, open(out + ".anchors.json", "w"), indent=1)
print("ANCHORS", anchors)
