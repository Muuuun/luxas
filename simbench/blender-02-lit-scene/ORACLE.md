# Oracle — blender-02-lit-scene

Tier: appearance. Every requirement here is one a script can state correctly
and still not deliver. The first Luxas-side Blender probe (2026-10-06) exited 0
twice, reported the right base colour, and rendered a grey part: once because
`diffuse_color` only drives the viewport, once because the material sat in a
slot no face used. Both are planted faults here.

`grader.py` never reads the arm's render to judge colour. It renders the saved
scene itself: through the scene's camera with the scene's lights (framing,
occlusion, exposure), then one object at a time under its own white world and
its own camera (does the material reach the renderer). `data/render.png` is
only checked for existing and not being blank.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "lit scene", "grader": "grader.py",
      "expect": [
        "opens and holds mesh objects named ball and box",
        "ball is a 1 m radius sphere at (0,0,1) and box is a 2 m cube at (3,0,1)",
        "active camera frames both objects completely",
        "both objects are unobstructed from the camera",
        "the scene's own lighting exposes what the camera sees (not black, not blown out)",
        "data/render.png exists and is not blank",
        "ball renders red under the grader's neutral light",
        "box renders blue under the grader's neutral light"
      ] }
  ]
}
```
