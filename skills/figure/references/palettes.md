# The palette (figures v5)

The palette has one source: `skills/figure/scripts/colorkey.py`, where it is written as plain hex. The
venue mplstyles, the TikZ templates, figspec and levelspec all carry these values, and `smoke_colorkey`
pins them. Draw with the hex directly:

- Python: `colorkey.BLUE` (mid), `colorkey.BLUE_D`, `BLUE_L`, `BLUE_P`, `colorkey.PALETTE["red"]["d"]`,
  `colorkey.HEX["grey.g5"]`, `colorkey.BEAM["red_orange"]`.
- TikZ: the block in `templates/base.tex` (`lxBlue`, `lxBlueD`, `lxBlueL`, `lxBlueP`, `beamOrange`, …).
- Anywhere else: the hex codes in the tables below.

Why these colours, and which kind of figure uses which, is in `figure_types.md`.

## Hue families

Data figures and identity colours use these. Each family is one CIELAB hue angle at four tints.

| family | dark d (text, edges) | mid m (lines, arrows) | light l (fills) | pale p (areas) |
|---|---|---|---|---|
| blue | #174F75 | #3B7CAE | #A3C1E2 | #E4ECF6 |
| red | #892F2D | #CA5852 | #ECACA4 | #FCE6E3 |
| orange | #804619 | #D17B3A | #F5C19F | #FFEADD |
| green | #2B5731 | #497E50 | #A7CAA9 | #E5F1E6 |
| plum | #62396D | #8A6194 | #CAB1CF | #F1E8F2 |
| sand | #6A5124 | #AD8B55 | #EACDA5 | #FBEFE0 |

**Greys:**
- ink #2C2C2C
- g7 #595959
- g5 #868686
- secondary text and references #6E6E6E
- g3 #B9B9B9
- g1 #DFDFDF
- g0 #F3F3F3

**Where the targets come from.** The mid and light tints were set from 63 Bloch-group figures
(2021–2026):
- blue mid L50 C32;
- green mid L47 C40;
- light tints L75–86 C19–29.

**Contrast on white:** dark ≥ 7, so it can be body text; mid ≥ 3.

**Claim order:** blue, red, orange, green, plum, sand. The first identity a report names gets blue,
the second red, and so on, recorded in `report/figures/colorkey.json`.

## Drive colours by wavelength (`colorkey.beam`)

Use these for schematics: drive arrows, beams, and the label of a drive.

| wavelength | colour | seen in the corpus as |
|---|---|---|
| < 380 nm | #7B3FA0 | 297–322 nm Rydberg UV |
| 380–440 nm | #4E4BC0 | 399 / 421 nm |
| 440–495 nm | #2F6FC0 | 459–483 nm |
| 495–570 nm | #2E8B47 | 5xx nm cooling and Raman |
| 570–605 nm | #B07C00 | 578 nm clock |
| 605–660 nm | #E0561F | 626–649 nm |
| 660–760 nm | #C8302B | 689–741 nm |
| 760–1000 nm | #A3262A | 780–852 nm |
| > 1 µm | #7A1F1F | 1064 nm tweezers, IR |

RF and microwave drives have no wavelength colour. They are black, or they take the identity colour
of the qubit they drive.

## Colour-blind distances

The table gives the smallest ΔE2000 between mid tints under a red–green deficiency (Machado 2009).
Two families compared in one panel need ≥ 20. Below that, also vary lightness, marker or line style.

| pair | ΔE | pair | ΔE | pair | ΔE |
|---|---|---|---|---|---|
| blue–orange | 45 | blue–red | 34 | red–orange | **9** |
| orange–plum | 43 | red–plum | 31 | green–sand | **9** |
| blue–sand | 41 | green–plum | 29 | blue–plum | **7** |
| plum–sand | 38 | orange–green | **10** | red–sand, orange–sand, red–green | **5** |
| blue–green | 35 | | | | |

Hence the two-family budget per panel. Blue–red and blue–orange are the binary pairs.

## Colormaps

- **One sign:** white to one family's dark tint, or viridis / cividis.
- **Signed quantity:** a blue–white–red map centred on zero.
- **Never:** jet, rainbow, hsv, turbo (figspec refuses them).

## Not used

- **Okabe–Ito.** Only 0.6% of corpus data figures use two or more of its colours, and it is the
  signature of machine-made figures.
- **matplotlib tab10.** 9% of corpus data figures use it; it reads as "default".
- **Pure RGB.** 15% of corpus data figures use it.
- **A domain guide's hex codes.** The prose guides in `style_guides/` describe a field's voice; their
  hex codes are illustrative only.
