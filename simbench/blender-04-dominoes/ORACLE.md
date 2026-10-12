# Oracle — blender-04-dominoes

Tier: functional. The artifact has to do something when it is run, and the
only way to know is to run it. A part can be built, open and look right and
still not work; this task puts that gap at a size that grades in two seconds.

`grader.py` re-opens `data/dominoes.blend`, steps the rigid-body world from
frame 1 to 250 itself, and reads where the dominoes are. A domino's tipping
angle is atan(0.1 / 1.0) = 5.7°: `reference.py weak_trigger` leans the first
one 3°, passes every static check, and nothing falls. `keyframed_fake` lays
all ten flat with keyframes and no physics, and is caught by the rigid-body
check rather than by the end state.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "domino run", "grader": "grader.py",
      "expect": [
        "opens and holds ground and domino_01..domino_10",
        "each domino is a 0.1 x 0.5 x 1.0 m box",
        "dominoes 02-10 stand upright on the ground, 0.5 m apart along +X, at frame 1",
        "ground is a passive rigid body and all ten dominoes are active rigid bodies",
        "simulated to frame 12: domino_10 has not moved yet (the fall travels down the row)",
        "simulated to frame 250: all ten dominoes are toppled",
        "simulated to frame 250: nothing fell through the ground"
      ] }
  ]
}
```
