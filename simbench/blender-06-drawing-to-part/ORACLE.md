# Oracle — blender-06-drawing-to-part

Tier: reading a drawing. The request is a picture, not a list of dimensions:
three orthographic views with hidden lines, which is how a part usually arrives
at a CAD seat. Nothing here is hard to model once it has been read. What is
measured is whether twelve primitives were recovered from three projections —
the depth of a pocket that exists only as a dashed line, a counterbore that is
a dashed circle in one view, a rib whose slope appears in one view only.

It also needs eyes. An arm whose producing model is text-only cannot open
`drawing.png` at all.

The drawing is not hand-made. `part_def.py` lists the solid as primitives;
`make_input.py` builds it and renders the three views with Freestyle (visible
edges solid, hidden edges dashed, every real edge a crease) and
`make_drawing.py` lays them out on millimetre axes. `grader.py` imports the
same list as an exact point-in-solid function, so the drawing and the answer
cannot drift apart.

`grader.py` re-opens `data/part.blend` and compares it with that solid point by
point: 30 000 points over the whole part (IoU), then 2 500 in the
neighbourhood of each feature (fraction of points on which the two agree,
0.97 required). Points within 0.5 mm of the drawn surface are not scored.

Each planted fault in `reference.py` is one misreading and fails the check for
that feature alone: `pocket_through` (IoU still 0.990), `no_counterbore`
(0.981), `boss_missing` (0.980), `rib_rectangular` (0.951). A whole-part score
would pass all four; that is why the checks are per feature. `mirrored_x`
keeps the bounding box and fails six.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "bracket", "grader": "grader.py",
      "expect": [
        "opens and holds a mesh object named part",
        "watertight",
        "bounding box runs from the origin to (100, 60, 50)",
        "matches the drawn solid: overlap (IoU) at least 0.93",
        "base: notch in the front edge and chamfered corner at the origin",
        "base: 10 mm holes at (20, 25) and (80, 25), the second through a 20 mm boss 10 high",
        "base: pocket 20 x 10 and 5 deep",
        "wall: 10 thick and 50 high, stepped down to 35 beyond x = 70",
        "wall: 20 mm hole at x = 25, z = 30, counterbored 30 mm x 5 from the back",
        "rib: triangular, 10 thick, from the base up the wall"
      ] }
  ]
}
```
