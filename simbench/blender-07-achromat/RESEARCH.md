# blender-07: a cemented achromat that meets its optical specification

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> Design a cemented achromatic doublet and model it in Blender, run headless
> (`blender -b --python …`). Save the scene as `data/doublet.blend`. One Blender
> unit is one millimetre. The optical axis is the world Z axis and light
> travels towards +Z.
>
> - Two watertight mesh objects: `crown` (N-BK7, the first element) and `flint`
>   (N-SF5, behind it). Both are 25 mm in diameter with a plain cylindrical
>   edge. Centre thickness 6 mm for the crown and 2.5 mm for the flint; the
>   crown at least 1 mm thick at its edge.
> - Three spherical surfaces centred on the Z axis: the front of the crown,
>   with its vertex at z = 0; the cemented surface, which is both the back of
>   the crown and the front of the flint (the same sphere, in contact); and the
>   back of the flint. Each surface is spherical out to the edge.
> - Refractive indices to use:
>
>   | glass | F (486.13 nm) | d (587.56 nm) | C (656.27 nm) |
>   |---|---|---|---|
>   | N-BK7 | 1.52238 | 1.51680 | 1.51432 |
>   | N-SF5 | 1.68750 | 1.67270 | 1.66661 |
>
> - Performance, for a collimated on-axis beam 20 mm in diameter:
>   1. effective focal length at d: 100 mm ± 0.5 mm;
>   2. axial colour: the paraxial foci at F and C within 0.05 mm of each other
>      along the axis;
>   3. spherical aberration: geometric RMS spot radius at d no more than
>      1.0 µm, at the focal plane that makes it smallest. (RMS spot radius:
>      the root-mean-square distance from the axis of the points where rays
>      filling the beam uniformly cross that plane.)
>
> The saved file is the deliverable and it will be measured. A sphere is fitted
> to the vertices of each optical surface — they must lie on it within 2 µm,
> with its centre on the axis — and the prescription recovered that way is
> ray-traced exactly with the indices above. One short report giving the
> prescription and the three performance numbers you computed from the saved
> meshes is sufficient.
