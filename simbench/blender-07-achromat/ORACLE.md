# Oracle — blender-07-achromat

Tier: design to a performance specification. The request fixes what the part
must do and leaves three radii to be found. This is the shape of an optical
design task in Zemax — a merit function with three targets, three variables,
and constraints — with Blender as the CAD seat and an independent ray trace as
the judge.

It cannot be met from thin-lens formulas. With 6 mm and 2.5 mm of glass, the
thin-lens achromat is millimetres off in focal length; and of the designs that
do meet focal length and colour exactly, only two narrow ranges of bending
bring the spot at d under 1.0 µm (front radius about 51–56 mm or 74–82 mm;
`design.py` prints the scan). `reference.py plano_back` meets focal length and
colour to the last digit and has a 11.9 µm spot.

`grader.py` re-opens `data/doublet.blend` and reads nothing the arm reported.
It fits a sphere to the vertices of each optical face, takes the thicknesses
from where those spheres cross the axis, and traces the recovered prescription
exactly (`optics.py`) with the indices the request states. On the reference it
returns the design values to three decimals (EFL 100.000 mm, F−C 0.0000 mm,
0.324 µm), which is the check that the fit and the trace agree with the
builder. The two elements are traced as built, gap included: `air_gap` (flint
0.2 mm back) fails the cemented check and, measured that way, the spot too.

```oracle
{
  "checks": [
    { "kind": "artifact", "label": "achromat", "grader": "grader.py",
      "expect": [
        "opens and holds mesh objects named crown and flint",
        "both are watertight",
        "25 mm in diameter, first vertex at z = 0, centre thicknesses 6 and 2.5 mm, crown edge at least 1 mm",
        "four optical faces are spherical: vertices within 2 um of a sphere centred on the axis",
        "cemented: the back of the crown and the front of the flint are the same sphere, in contact",
        "effective focal length at d is 100 mm within 0.5 mm",
        "axial colour: paraxial foci at F and C within 0.05 mm",
        "spherical aberration: RMS spot radius at d no more than 1.0 um for the 20 mm beam"
      ] }
  ]
}
```
