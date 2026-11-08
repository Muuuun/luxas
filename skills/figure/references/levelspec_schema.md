# levelspec — an energy-level diagram is data

`python3 $LUXAS_ROOT/skills/figure/scripts/levelspec <name>.levelspec.json` writes
`<out>.tex`, `<out>.pdf`, `<out>.png` and runs `figlint-pdf` at the print width. Exit 0 =
done; exit 2 = spec error, compile error or lint errors (the figure is not done — fix the
spec, never the generated `.tex`).

The author states the physics; the generator owns the drawing: a **compressed energy axis**
(gaps ∝ √ΔE with a floor so labels never touch, break marks where the compression is large —
a Rydberg gap no longer makes a page-tall figure), column layout with labels to the left of
each level line, arrow slots, **black levels and labels with each drive coloured by the wavelength
in its label** (figures v5: 83% of 208 corpus level diagrams), **straight arrows for coherent drives and
wavy arrows for decays** (the convention the hand-drawn Ba diagram inverted), the wavelength
set inline on its own arrow, **no key box** (a level's `tag` names its role in the text).

```json
{ "out": "report/figures/ba_levels",
  "width": "single" | "double",          // a request; the generator upgrades single→double when the labels need it and says so
  "unit": "cm$^{-1}$",                    // optional, axis label only — positions are compressed, so no ticks are drawn
  "height_in": 3.0,                       // optional; default 3.0 (single) / 3.4 (double)
  "levels": [
    { "id": "1S0", "label": "$6s^2\\,{}^1S_0$", "energy": 0,     "column": 0, "tag": "ground" },
    { "id": "3D1", "label": "$6s5d\\,{}^3D_{1,2,3}$", "energy": 9034, "column": 0, "tag": "shelving" },
    { "id": "3D2", "label": "", "energy": 9216, "column": 0 },     // manifold member: no label, tight spacing
    { "id": "1P1", "label": "$6s6p\\,{}^1P_1$", "energy": 18060, "column": 1 } ],
  "limit": { "label": "ionization limit", "energy": 42035, "column": 2 },   // optional dashed line
  "transitions": [
    { "from": "1S0", "to": "1D2", "kind": "qubit", "label": "877.6 nm" },   // double-headed, coloured from "877.6 nm"
    { "from": "1S0", "to": "1P1", "kind": "drive", "label": "553.7 nm" },   // straight arrow, green (5xx nm)
    { "from": "1P1", "to": "1S0", "kind": "decay" } ] }                      // wavy, thin, black
```

- `energy`: one unit for the whole diagram (cm⁻¹, THz, eV — the number only sets order and spacing).
- `column`: 0 = leftmost. Put states that a drive connects in adjacent columns; a transition
  that skips a column is drawn as an elbow (horizontal, then vertical) so it never crosses the
  skipped column's labels.
- **Colour** (figures v5, `skills/figure/scripts/colorkey.py`; measurements in `figure_types.md`): levels,
  their labels and decays are black. A `drive` / `qubit` / `dashed` transition takes the colour of the
  wavelength written in its label ("626 nm", "1064.5-nm", "2.42 µm" — UV purple … 626 nm red-orange …
  > 1 µm dark red); its label is the same colour (or black, if the report's key says `"drive_labels": "black"`).
  A transition with no wavelength (RF, MW, Ω) is black unless it has an `identity`.
- `identity` (level or transition): the colour of something the report's data figures also show — a species,
  spin up, a qubit state. It is looked up in (or claimed in) `report/figures/colorkey.json`, so the level here
  and the curve in Fig. 3 are the same blue. Leave it out otherwise: 83% of real level diagrams colour no level.
- `kind`: `drive` (straight →), `qubit` (↔), `decay` (wavy →), `dashed` (a virtual / two-photon
  effective transition).
- `tag`: a role word set in grey italic before the term symbol (`ground`, `qubit`, `shelving`).
  This replaces a key box.
- Rejected keys: `group` (v4; levels are no longer coloured by role), `color`, `wavelength` (write it in
  the label), `type`, `key`, `legend`, `x`, `y` — the error names the key to use.

The generator prints the print width to include it at (`figure` at 3.4 in or `figure*` at 7.0 in);
brain's `\includegraphics` must use that width, not `0.74\textwidth` of a page-tall PDF.
