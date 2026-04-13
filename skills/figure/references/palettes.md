# Colorblind-safe Palettes

## Okabe-Ito (default — used in `base.tex`)

| Name        | Hex       | Use for                     |
| ----------- | --------- | --------------------------- |
| Black       | `#000000` | Text, main lines            |
| Orange      | `#E69F00` | Laser / tweezer / warm      |
| Sky Blue    | `#56B4E9` | Cool accent                 |
| Green       | `#009E73` | Highlight, success, balance |
| Yellow      | `#F0E442` | Secondary accent            |
| Blue        | `#0072B2` | Atom / qubit primary        |
| Vermillion  | `#D55E00` | Ion / excited / warm accent |
| Reddish Purple | `#CC79A7` | Magnetic / field / auxiliary |

Reference: Okabe & Ito (2008), "Color Universal Design".
Safe for all types of colorblindness. Use these by default.

## Tableau 10 (alternative)

`#1F77B4 #FF7F0E #2CA02C #D62728 #9467BD #8C564B #E377C2 #7F7F7F #BCBD22 #17BECF`

## Nature "cite style" (if matching Nature figures)

Nature tends to use:
- Desaturated primaries (`#4F86F7`, `#E8601C`, `#2B8CBE`, `#E41A1C`)
- Lots of gray neutrals (`#555555`, `#999999`)
- White figure backgrounds, no grids

## Rules

1. Never red+green alone (protanopia/deuteranopia safe palettes = these lists).
2. If a figure will be printed B&W, also vary line style (solid/dashed/dotted)
   or marker shape, not just color.
3. Keep max 5 distinct colors per figure. Beyond that, use pattern/texture
   or split into multiple panels.
4. Reuse the same semantic color for the same quantity across figures in a
   paper (e.g., atom always blue, ion always vermillion).
