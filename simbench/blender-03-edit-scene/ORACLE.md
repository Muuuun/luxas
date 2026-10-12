# Oracle — blender-03-edit-scene

Tier: editing existing state. The three edits are trivial; what is under test
is whether the scene is read before it is changed. `make_input.py` builds the
input with three things a script cannot know without looking:

- the three plates are linked duplicates of ONE mesh, so assigning the yellow
  material on `plate_03.data` turns all three yellow;
- plates and brackets share ONE material, so recolouring `steel` recolours six
  objects;
- every plate carries a bevel and every bracket an array modifier, so a scene
  rebuilt from primitives instead of edited loses them.

`grader.py` compares the saved file with this directory's own
`input/workshop.blend` (not the arm's copy): world transform, mesh geometry,
modifier stack, and the material each face actually uses. A saved file whose
every object is as the input had it counts as no artifact (0/6): the two
"unchanged" checks are only evidence of care on a scene somebody edited.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "edited scene", "grader": "grader.py",
      "expect": [
        "opens and is not the input unchanged",
        "bolt_02 origin is at (2.0, 1.5, 0.25) and it is otherwise the same bolt",
        "plate_03 faces use a material named warning_yellow with base colour (1.0, 0.8, 0.0)",
        "bracket_01 is gone",
        "the six other parts are unchanged (transform, mesh, modifiers, material)",
        "camera and light unchanged, nothing added"
      ] }
  ]
}
```
