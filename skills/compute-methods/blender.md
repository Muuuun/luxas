---
domain: blender
match: blender, import bpy, import bmesh, .blend
software: blender
bin: blender
artifacts: .blend
verified: 2026-10-06
verified-on: mac
---

# Blender — drive it headless with a script, then measure the saved file

Verified on macOS arm64, Blender 5.2.2 LTS (bundled Python 3.13). Whether it is on this machine is stated in the line above this sheet. Run the smoke test first, and if it fails say so in the ledger rather than substituting a hand-rolled mesh library.

No GUI, no mouse: `blender -b --factory-startup --python script.py -- <args>`. Arguments after the bare `--` reach the script as `sys.argv[sys.argv.index("--") + 1:]`. Each invocation is a fresh process; state lives in the `.blend` you save.

| Tool | First-use frictions | Smoke test |
|---|---|---|
| Blender 5.2 (`bpy`) | (1) **Exit code is 0 even when the script raised** — add `--python-exit-code 1` or a traceback looks like success. (2) Start from an empty file: `bpy.ops.wm.read_factory_settings(use_empty=True)`; without `--factory-startup` the user's startup file and add-ons load. (3) **Apply a modifier without an operator**: `deps = bpy.context.evaluated_depsgraph_get(); obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(deps)); obj.modifiers.clear()`. `bpy.ops.object.modifier_apply` needs an active-object context that a headless script often lacks. **Count open edges after every boolean** (`sum(not e.is_manifold for e in bm.edges)`): a four-hole flange built this way was closed with `solver = "EXACT"` and with `"MANIFOLD"` at 64 to 256 segments, but the same part built from `bmesh.ops.create_cone` cylinders and `modifier_apply` came out of `EXACT` with 3–12 open edges, and switching that build to `"MANIFOLD"` closed it (simbench bare-arm run, 2026-10-06). If edges are open, change the solver; do not "clean up" the mesh afterwards. (4) Units are bare numbers. Geometry can be in millimetres, but **rigid-body physics assumes metres** (gravity 9.81): a scene modelled in mm falls a thousand times too slowly. (5) `import bpy` only works inside Blender's own Python; from pytest call the binary with `subprocess.run([...], check=True)`. | `blender -b --python-exit-code 1 --python-expr "import bpy, bmesh; print(bpy.app.version_string)"` |
| Cycles (CPU) | Works headless everywhere and needs no display: `scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 16`. 320×240 at 16 samples took 0.4 s here; 800×600 at 32 samples about 2 s. EEVEE also rendered headless on this Mac (4 s, first-frame shader compile) but needs a GPU context — untested on the VM, so default to Cycles CPU. | render one frame of an empty scene to a PNG and check the file exists |
| Freestyle (line drawings) | Renders visible and hidden edges as lines, headless, with Cycles: `scene.render.use_freestyle = True`, one line set with `visibility = "VISIBLE"` and one with `"HIDDEN"` and `linestyle.use_dashed_line = True`, an orthographic camera, a white emission material. **The default `crease_angle` (134°) drops every 135° edge** — a 45° chamfer or rib loses its line; set `freestyle_settings.crease_angle = radians(170)`, which still skips the facets of a 96-sided cylinder. At `ortho_scale` = extent in mm and resolution = 10 × extent, the image is exactly 10 px/mm. | three views of a box with a through hole: the hole is two dashed lines in the side view |
| Rigid bodies (Bullet) | (1) `bpy.ops.rigidbody.world_add()` first, then for each object select it, make it active, and `bpy.ops.rigidbody.object_add(type="ACTIVE"\|"PASSIVE")`. (2) Nothing is simulated until frames are stepped **in order**: `for f in range(1, 251): scene.frame_set(f)`; jumping straight to frame 250 reads the rest pose. (3) Read simulated transforms from the evaluated object: `obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world`. (4) A body with no passive ground under it falls forever — check z at the last frame. | 10 boxes on a passive ground, lean the first 15°, step 250 frames, all ten end tilted > 60° |

## What exit 0 does not tell you (each observed 2026-10-06, exit code 0)

- **A colour set on `material.diffuse_color` or `world.color` never reaches the render.** Those drive the viewport. Cycles and EEVEE read the node tree: set `Base Color` on the Principled BSDF node, and `Color`/`Strength` on the world's Background node. A new material and a new world already carry those nodes in 5.2; `use_nodes = True` only prints a deprecation warning.
- **A mesh baked from a boolean keeps an empty material slot 0, and every face uses it.** `mesh.materials.append(mat)` then puts the material in slot 1, referenced by no face: `mat.users` is 1, the script can print the right base colour, and the part renders default grey. Use `mesh.materials.clear()` before `append`, or assign slot 0.
- **Linked duplicates share one mesh.** `obj.data.materials[0] = mat` recolours every object that uses that mesh. Check `obj.data.users`; give the object its own copy (`obj.data = obj.data.copy()`) before changing it.
- **A scene can meet every static requirement and do nothing when played.** A domino leaned 3° sits inside its tipping angle and rocks back. The only check is to step the simulation and read the end state.

## Verification: measure the saved file, not the script's report

These are for whoever writes the test (tool_review) and for the experiment's own results. All of them re-open the artifact in a fresh `blender -b` process.

| Commitment | How to measure it from the file |
|---|---|
| dimensions, volume, watertight | evaluated mesh → `bmesh`, triangulate, `bm.calc_volume()`, bounding box from vertices, `sum(not e.is_manifold for e in bm.edges) == 0`. A circle with N segments has `(N/2π)·sin(2π/N)` of the true area — 0.9996 at N = 128, 0.974 at N = 16 — so state the tolerance. |
| a hole, a boss, a slot is where the spec says | point-in-solid probes: `BVHTree.FromBMesh(bm)`, cast a ray from the point in an oblique direction, count crossings (odd = inside). Probe either side of each wall. **Volume and bounding box do not see a bolt circle that is 1 mm off or rotated 45°**; probes do. When counting crossings, restart the ray past each hit by a step scaled to the part (`2e-6 × bounding-box diagonal`) and do not count a second hit on the same face: mesh coordinates are float32, and a fixed `1e-5` step on a 100 mm part re-hit the same triangle on 2 % of rays and gave 5 wrong answers in 14 400 probes. |
| two parts work together (gears mesh, a pin fits) | move them the way the mechanism moves and measure overlap at each position: outline points of one part tested for depth inside the other (`inside` and `BVHTree.find_nearest` distance). Check the opposite failure too — overlap alone is passed by parts that are too thin, so also measure the play. |
| the material is what the renderer uses | follow the link into the Material Output's `Surface` socket back to the Principled node, and take materials only from slots that faces reference (`{p.material_index for p in mesh.polygons}`). Or render it and sample a pixel. |
| the picture shows the thing | render it in the test with the test's own camera and light, load the PNG with `bpy.data.images.load`, sample a patch at the object's projected position (`bpy_extras.object_utils.world_to_camera_view`). Never assert on a render the tool made of itself. |
| the mechanism works | step the simulation in the test and assert on end transforms. |

## Known false rejections

None recorded yet. Add the verbatim wrong claim here the first time a ledger abandons Blender for a friction listed above.
