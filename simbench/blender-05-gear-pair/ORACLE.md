# Oracle — blender-05-gear-pair

Tier: functional geometry. Two parts that are each correct to look at and have
to work together. It is one gear mesh, with no physics engine in the grading:
the result is decided by geometry alone and takes five seconds.

`grader.py` re-opens `data/gears.blend` and does what the request says will be
done. It turns the pinion by θ and the gear by −θ·18/30 about the stated axes
at 240 positions over one turn of the gear, and at each one measures how deep
either mid-plane outline sits inside the other solid. Then at 24 positions it
holds the pinion and bisects for how far the gear can turn each way before it
overlaps by more than 0.02 mm.

The two functional checks are a pair on purpose. Overlap alone is passed by
thin teeth (`reference.py wide_backlash`: runs free, 0.54 mm of play). Backlash
alone is passed by teeth that jam (`tooth_on_tooth`, `straight_flanks`: right
thickness at the pitch circle, trapezoid flanks, 0.37 mm of overlap). Only a
conjugate profile at the right phase passes both at every position; the
reference measures 0.080–0.082 mm at all 24, which is its designed 0.04 mm
plus what the overlap tolerance adds (2 × 0.02 / cos 20°).

The backlash limit applied is 0.26 mm: the 0.2 mm of the request, the 0.043 mm
the overlap tolerance adds, and a margin.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "gear pair", "grader": "grader.py",
      "expect": [
        "opens and holds mesh objects named pinion and gear",
        "both are watertight",
        "axes at (0, 0) and (48, 0), 10 mm wide from z = 0, bores 8 mm and 12 mm",
        "18 and 30 full-depth teeth of module 2 (tip, root, thickness at the pitch circle)",
        "saved pose: the teeth do not overlap",
        "driven at 18:30 through a full turn of the gear: the teeth never overlap",
        "backlash at the pitch circle stays within 0.2 mm through the mesh cycle"
      ] }
  ]
}
```
