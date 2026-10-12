# blender-06: a bracket rebuilt from its three-view drawing

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> `input/drawing.png` is a three-view drawing of a machined bracket. Model the
> part in Blender, run headless (`blender -b --python …`), and save it as
> `data/part.blend`: one watertight mesh object named `part`, one Blender unit
> per millimetre, in the coordinate system of the drawing.
>
> How to read the drawing:
>
> - Third-angle projection, three views, each on millimetre axes in the part's
>   own coordinates. TOP looks down along −Z (x to the right, y up the page).
>   FRONT looks along +Y from in front of the part (x to the right, z up).
>   RIGHT looks along −X from the right-hand side (y to the right, z up).
> - Solid lines are visible edges; dashed lines are hidden edges.
> - Every flat face lies on a multiple of 5 mm, every hole or boss axis sits on
>   multiples of 5 mm, and every diameter is a multiple of 10 mm. Every face is
>   flat or cylindrical.
>
> The saved mesh will be compared, point by point, with the solid the drawing
> describes, as a whole and feature by feature. One short report listing the
> features you identified, with their positions and sizes, is sufficient.
