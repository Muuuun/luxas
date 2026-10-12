# blender-05: a pair of spur gears that actually run

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> Model a pair of meshing involute spur gears in Blender, run headless
> (`blender -b --python …`), and save the scene as `data/gears.blend`. One
> Blender unit is one millimetre.
>
> - Module 2 mm, pressure angle 20°, standard full-depth teeth (addendum
>   1 module, dedendum 1.25 modules), face width 10 mm (z = 0 … 10).
> - `pinion`: 18 teeth, turning about the world Z axis, with an 8 mm bore.
> - `gear`: 30 teeth, turning about the line parallel to Z through (48, 0, 0),
>   with a 12 mm bore.
> - Each is a single watertight mesh object, saved in a pose where the teeth
>   are in mesh.
>
> The pair has to run. Turn the pinion by any angle θ about its axis and the
> gear by −θ·18/30 about its own: the two solids must not overlap at any θ
> (0.02 mm of overlap is allowed for faceting). And with the pinion held still
> at any of those positions, the gear must not be free to turn by more than
> 0.2 mm of arc at its pitch circle (radius 30 mm) in total before teeth
> touch — that is, backlash of at most 0.2 mm everywhere in the mesh cycle.
>
> The saved file is the deliverable, and it will be measured by turning the two
> parts exactly as described. A pair that looks like gears and jams does not
> count, and neither does a pair that only clears because the teeth are thin.
> One short report stating the tooth geometry and the overlap and backlash you
> measured from the saved meshes is sufficient.
