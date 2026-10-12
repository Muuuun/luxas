# blender-02: a lit scene that renders the way it was specified

## Original Request

_Verbatim user input — ground truth for what the user asked for._

> Build this scene in Blender, run headless, and save it as `data/scene.blend`.
> Also render it through its camera to `data/render.png`. One Blender unit is
> one metre.
>
> - Mesh object `ball`: a sphere of radius 1 centred at (0, 0, 1), red —
>   Principled base colour (0.8, 0.05, 0.05).
> - Mesh object `box`: an axis-aligned cube with 2 m edges centred at
>   (3, 0, 1), blue — Principled base colour (0.05, 0.1, 0.8).
> - The scene's active camera shows both objects completely, with nothing in
>   front of them.
> - Light the scene so that both objects are clearly visible in the render:
>   neither black nor blown out.
>
> The saved scene will be opened and rendered again by someone else, so what
> counts is what the renderer produces from the file, not what the viewport
> shows. One short report describing the scene and what your render shows is
> sufficient.
