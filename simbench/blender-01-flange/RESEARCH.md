# blender-01: a flange, modelled headless in Blender

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> Model this machined flange in Blender, run headless (`blender -b --python …`),
> and save the scene as `data/flange.blend`. One Blender unit is one millimetre.
>
> - The part is a single watertight mesh object named `flange`, with its axis on
>   the world Z axis and its bottom face on z = 0.
> - Base: a disc 80 mm in diameter and 8 mm thick (z = 0 … 8).
> - Boss: a cylinder 40 mm in diameter rising 20 mm above the base (z = 8 … 28).
> - Bore: a 20 mm hole along the axis, through the whole part.
> - Four bolt holes, 8 mm in diameter, through the base, on a 60 mm bolt circle
>   at 0°, 90°, 180° and 270° from the +X axis.
> - Round features must be round enough that the volume is within 1 % of the
>   exact solid.
>
> The saved file is the deliverable and it will be measured. One short report
> stating the volume and bounding box you measured from the saved mesh is
> sufficient.
