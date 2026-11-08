# Figure style by type, position and venue (figures v5, 2026-11-07)

What real papers do, measured on the papers Luxas has downloaded for its projects: 90 projects, 1,168
papers, 10,597 figure files, Mac and droplet copies merged. Source figures came from arXiv source
directories (figure environments in the .tex) and from full PDFs (the region above each caption).
Level diagrams were looked at one by one (208 of them, including 15 from Nature papers); data figures
were measured from their PDF drawing commands (5,120 vector figures from 816 papers). The corpus is
mostly arXiv preprints, so these numbers say what is usual, not what is beautiful. The measuring
scripts and per-figure records are listed at the end.

The palette and the report's colour key live in `skills/figure/scripts/colorkey.py`. Every renderer
(figspec, levelspec) and every template draws from it.

## 1. One colour key per report

Inside one paper, a figure draws a median 99% of its coloured ink in colours that the paper's other
figures also use. 59% of figures reuse at least 80% of their colour; 22% reuse less than 20%. A paper
uses a median of 15 distinct colour values, about 2–3 values per hue: a few hues, each in several
tints.

- An identity (a species, spin up, |0⟩, "measured", a named scheme) has one hue family for the whole
  report. The first figure that names it claims the next free family, and the claim is written to
  `report/figures/colorkey.json`. Every later figure, whether figspec, levelspec or a hand-written
  script, reads the same file.
- Claim order: blue, red, orange, green, plum, sand. Blue and red come first: they are the spin pair
  in the Bloch-group papers and stay 34 ΔE2000 apart for a red–green colour-blind reader. Any third
  family is confusable with one of those two, which is why a panel carries at most two families plus
  grey.
- Within a family, tints have fixed jobs: dark (d) for text and marker edges, mid (m) for lines and
  arrows, light (l) for marker fills and bands, pale (p) for areas.
- The palette is plain hex (`colorkey.PALETTE`, `colorkey.BLUE` / `BLUE_D` / `BLUE_L` / `BLUE_P`,
  `colorkey.BEAM["red_orange"]`, or the tables in `palettes.md`). A hand-written script can draw with
  those hex values directly. Look up which family an identity has in the report key
  (`colorkey.load_for('report/figures/<name>.pdf').family('<identity>')`). Never use a hex value that is
  not in the palette.

## 2. By figure type

### Level diagrams (levelspec; 208 diagrams read)

| | share of diagrams |
|---|---|
| Level lines black or grey | 83% (Nature: 14 of 15) |
| State labels, term symbols and numbers black | 88% |
| Drive arrows coloured | 79% |
| Label of a coloured drive in the arrow's colour | 50% (other 49% black) |
| Some levels coloured | 17%; 31 of these 35 because the colour names an identity used elsewhere in the figure (spin up/down, two species, parity, a qubit subspace) |

- Levels, labels and decays are black. Decays are thin wavy arrows.
- A laser drive takes the colour of its wavelength, in the order every corpus diagram follows:

  | Wavelength | Colour |
  |---|---|
  | UV (297–322 nm) | purple |
  | 399–421 nm | violet |
  | 460–480 nm | blue |
  | 5xx nm | green |
  | 578 nm | amber |
  | 626–649 nm | red-orange |
  | 689–852 nm | red |
  | beyond 1 µm | dark red |

  levelspec reads the wavelength from the arrow's label (`colorkey.beam`).
- RF and microwave drives have no wavelength colour. They are black, or they take the identity
  colour of the qubit they drive.
- A level is coloured only through `identity`, and only when the data figures show the same
  identity in that colour.
- A group of levels (a qubit subspace) is marked with a pale grey rounded box or a dashed frame,
  not by colouring the lines.

### Setups, scenes and sequence diagrams

- Beams take their wavelength colour.
- Atoms, ions and molecules take their identity colour.
- Hardware (coils, cells, mirrors, lenses) is drawn in neutral materials: copper, glass, grey.
- Text is black, except for a label that names a beam or an identity, which may share that colour.
- A pulse sequence uses the colour of the beam that each row drives.

### Data figures (figspec; 5,120 vector figures measured)

| | share of figures |
|---|---|
| All text black or grey | 85% |
| Hue families used: 0 / 1 / 2 / 3 / 4 / 5+ | 11% / 19% / 30% / 22% / 11% / 7% |
| Pale filled bands present | 15% |
| Okabe–Ito, at least two of its colours | 0.6% |
| matplotlib tab10, at least two of its colours | 9% |
| Pure RGB, at least two colours | 15% |
| Median lightness L / chroma C of line colours | 53 / 63 |

- Axis labels, ticks and panel letters are black. A direct label beside a curve may use the curve's
  dark tint, but never a legend box.
- Use at most two hue families per panel; a third series is grey or a line style within a family.
- A binary contrast (two conditions, two species) is blue against red, or blue against orange, and
  stays fixed for the whole report.
- An ordered sweep (N = 20, 40, 60) is one family drawn light to dark (`"ordered": true`).
- Theory, references and controls are grey. A model line is black and dashed.
- Bands mark uncertainty or a region only. They are not there to add colour: 85% of figures have
  none.
- Colormaps:
  - for one sign, white to one family, or viridis / cividis;
  - for a signed quantity, a blue–white–red map centred on zero;
  - never jet or rainbow.

## 3. By position

Measured by figure number on the same corpus (figure files grouped per paper and figure):

| | contains a level diagram | contains a setup or schematic | data only | contains a render or photo | colour pixels (median) |
|---|---|---|---|---|---|
| Fig. 1 | 14% | 26% | 60% | 55% | 5.7% |
| Fig. 2 | 4% | 14% | 82% | 45% | 4.5% |
| Fig. 3 | 2% | 10% | 88% | 43% | 4.1% |
| Fig. 4+ | 3% | 9% | 88% | 39% | 3.7% |

- **Fig. 1 is the overview.** It holds the picture of the system (a rendered scene or a setup
  schematic), the level scheme, and at most one headline result. This is the one figure where a
  rendered scene earns its place. The quality target is
  `references/exemplars/fig1_blender/` (a Blender scene plus vector insets): render with Blender
  when `blender` is on PATH; otherwise use the hybrid raster + TikZ route.
- **Fig. 2 onwards are results.** Data figures in the colour key that Fig. 1 started. An identity
  drawn in Fig. 1 keeps its colour here.
- **SI / Extended Data** use the same key. More series per panel are acceptable there, but not new
  colours for old identities. (Not measured — the corpus does not mark SI figures reliably.)

## 4. By venue (the article's overall style)

The palette and the key do not change with venue. A report keeps one key whichever journal it
targets. What changes is typography and geometry, set by the venue's mplstyle
(`skills/venue-specific/figstyles/`):

| | Nature / Science | APS (PRL, PRX, PRA) | general report |
|---|---|---|---|
| Font | Arial / Helvetica, 5–7 pt | Computer Modern (LaTeX), 8 pt | sans, 9 pt |
| Panel letters | **a** bold, no parentheses, 8 pt | (a) | (a) |
| Widths | 89 / 120 / 183 mm | 3.375 / 7.0 in | 3.4 / 7.0 in |
| Fig. 1 | rendered overview common | schematic + level diagram common | as Nature |

These rows come from the journals' figure guides, not from the corpus measurement.

## Sources

- The measuring scripts are in `scripts/figure_corpus/` (see its README).
- The per-diagram level-diagram record is `references/level_diagram_tally.tsv`.
- The per-figure records are in `~/figstyle-2026-11/full/rows_all.jsonl` on the droplet.
- The palette's tint targets (mid and light tints) come from 63 figures in 14 Bloch-group papers (2021–2026):
  - blue mid L50 C32;
  - green mid L47 C40;
  - light tints L75–86 C19–29.
