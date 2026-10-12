# blender-04: a domino run that actually falls

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> Set up a domino run in Blender with rigid-body physics, running headless, and
> save it as `data/dominoes.blend`. One Blender unit is one metre; gravity is
> the default.
>
> - `ground`: a mesh object that is a passive rigid body, with its top surface
>   on the plane z = 0 and large enough for the whole run.
> - `domino_01` … `domino_10`: boxes 0.1 m thick (X) × 0.5 m wide (Y) × 1.0 m
>   tall (Z), all active rigid bodies. Dominoes 02–10 stand upright on the
>   ground at frame 1 with their centres at x = 0.5, 1.0, …, 4.5 and y = 0.
>   `domino_01` is at the x = 0 end of the row.
> - Start the chain however you like — the usual way is to lean `domino_01`
>   towards +X — but dominoes 02–10 must be upright and at rest until they are
>   hit.
> - Scene frame range 1–250 at 24 fps.
>
> When the file is opened and the simulation is played from frame 1 to frame
> 250, all ten dominoes must end up toppled. The saved file will be simulated
> by someone else: a file that looks right and does nothing when played does
> not count. One short report stating how the chain is started and what the
> simulation does is sufficient.
