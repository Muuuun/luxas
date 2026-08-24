# Figure design language

Every archetype in this directory embodies these rules. When adapting one,
the rules survive; only the data changes. Derived from the 2026-08-24 audit
of shipped figures and the dataviz form/color method.

## Form first — the data's job picks the chart

| The reader must… | Form | Not |
|---|---|---|
| rank magnitudes across studies | dot/lollipop on log axis, sorted | bars on linear (a 660× range shipped with 4/5 bars invisible) |
| see two quantities per entity | scatter plane, iso-product lines | two units on one axis labelled "Value" |
| see which combinations exist | dot matrix, zeros = white | dark heatmap of a sparse count matrix |
| see where behavior changes | line + shaded regime + annotated crossing | unannotated curve the caption re-explains |

## The rules

1. **One figure, one argument.** The title or annotation states the finding;
   if you cannot write that sentence, the figure is not ready.
2. **Emphasis: accent + grey.** The entity the caption discusses wears the one
   accent color; everything else is warm grey. Color follows the entity,
   never the rank, and never repaints when a series is dropped.
3. **Direct labels, no legend box, for ≤4 series.** Label lines at their ends,
   dots beside themselves. Text wears ink (#222) or muted (#7A7570) — never
   the series color for values.
4. **One axis, one unit.** Two measures of different units = two panels or a
   plane, never a shared axis.
5. **>50× positive range ⇒ log scale** (figlint warns; treat as an error
   unless a comment in the script argues linear).
6. **Recessive chrome.** Left/bottom spines only; light SOLID hairline grid
   (#EFEDEA, never dashed); ticks short or absent; whitespace is structure.
7. **Annotate the claim on the figure** — a thin grey leader line to the
   feature the text discusses. The reader should not need the caption to
   find the point.
8. **Zeros and absence get no ink.** Sparse data: mark presence, leave
   absence white.
9. **Sorting is information.** Rank rows/columns by the quantity, marginal
   totals, or the argument's order — never alphabetically by accident.
10. **Every script runs through figlint** (../scripts/figlint) before its
    output is used. ERRORs are fixed, not argued with.

## Palette

Accent `#0F6BB2` · context grey `#9C9490` · ink `#222222` · muted `#7A7570`
· band fill `#F4F1EE` · grid `#EFEDEA`. Venue figstyles may override hues;
the accent+grey emphasis structure survives any palette.
