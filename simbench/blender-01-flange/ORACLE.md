# Oracle — blender-01-flange

Tier: static geometry. The floor of the set: a coding agent with a shell is
expected to pass this, so a miss here is an environment problem, not a
capability one.

The exact solid is π(40²·8 + 20²·20 − 10²·28 − 4·4²·8) = 54 940.2 mm³.

`grader.py` re-opens `data/flange.blend` and asks, at points fixed by the
spec, whether each point is inside the solid. Volume and bounding box alone
are not enough: `reference.py bolt_circle_58` and `holes_rotated_45` keep both
exactly and are wrong parts. `scripts/smoke_simbench_graders.mts` holds the
grader to that — the reference passes every check, each planted fault fails
the check named for it.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "flange", "grader": "grader.py",
      "expect": [
        "opens and holds a mesh object named flange",
        "watertight",
        "bounding box 80 x 80 x 28 mm with the base on z = 0",
        "volume within 1% of 54940 mm^3",
        "bore is 20 mm wide and goes through",
        "boss is 40 mm wide and 20 mm tall",
        "four 8 mm bolt holes on the 60 mm circle at 0/90/180/270 deg"
      ] }
  ]
}
```
