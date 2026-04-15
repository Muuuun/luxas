# Policy & Social Science Figure Style (Nature)

## Visual voice

Policy figures in Nature read as quietly argumentative rather than mechanistic — analytical, clinical, empirical, editorial, austere. They carry the weight of a regression table or a policy brief: restrained, data-dense, civically serious. Decorative chrome is absent — no drop shadows, no ornamental gradients, no 3D, no textures. Figures earn their presence through typographic calm, generous whitespace, and a small vocabulary of colors that do semantic work everywhere they appear.

## Figure 1 schematic conventions

Figure 1 is rarely a data plot; it is a **conceptual framework, study-design flowchart, causal pipeline, or documentary photograph with inset annotation**. Flow is top-down for CONSORT-style patient-filtering funnels (italic `n=` counts inside every box) and L-to-R for pipelines and paradigm taxonomies. Composition is 2D flat; icons are ideographic — rounded-rectangle nodes, small domain glyphs. Arrows use **bold filled triangular heads on ~1.5 pt stems**, with dashed variants for conditional or feedback edges. Labels sit inline inside nodes or beside arrows; callout lead lines are rare. Color semantics are binary-moral: **green check / red X** for approved vs. discouraged pathways, **teal entry / warm rose-red intervention**, muted grey for process containers. When Figure 1 is a photograph, annotation collapses to two or three colored letter badges over the unmanipulated image.

## Palette

Muted and editorial, not luminous; pure neon primaries are absent. Workhorse hues recur with consistency: steel/cobalt blue `#4472C4`–`#4A90C4`, crimson/coral `#C0392B`–`#D62728`, forest/sage green `#27AE60`–`#2D6A2D`, muted teal `#2A9DA0`–`#2D7A6E`, warm amber `#E8C040`–`#F5C242`, burnt orange `#E8742A`, deep purple `#5B3A8E`–`#6C3483`, navy `#1A3A6B`. Accents — salmon `#F4A582`, lavender `#9B8EC4`, dusty mauve `#B07080` — appear as tertiary members of country sets. Greys `#555`–`#AAA` are structural, reserved for reference curves, baselines, deprecated models. Backgrounds pure white. Temperature is often **mixed** — warm vs. cool is itself weaponized as an analytic axis (warm = burden/deficit, cool = adoption/progress).

## Color conventions

Color carries semantic load. **(1) Binary condition pairing**: one warm and one cool hue are locked to two conditions and maintained identically across every figure — purple vaccinated / amber-orange unvaccinated, cobalt unrestricted / crimson counterfactual, red Christian / blue Muslim / black Traditional. **(2) Categorical hue-per-entity**: each country, region, or lineage owns a unique hue threading through time-series lines, choropleth fills, chord ribbons, phylogeny tips, and stacked bars. Diverging scales (red-white-green, blue-white-red) serve change data with white at zero. Sequential ramps (yellow → teal → navy) encode magnitude in choropleths. CI bands ride at **α ≈ 0.15–0.30 in the parent line's hue**, never generic grey, preserving categorical identity inside uncertainty; ensemble curves and overplotted scatter sit at α ≈ 0.3–0.5.

## Markers & data encoding

The **filled circle is the default**, 3–8 pt, no visible stroke, solid fill matching the line hue. A recurring minimalist dual-code is **filled vs. open circles** for data provenance (observed vs. projected, survey vs. extrapolated) without changing color or shape. Second categorical dimensions use open circle / square / triangle / diamond with ~1 pt hue-matched stroke. Marker size occasionally encodes sample count (3–22 pt with an explicit 5/10/20 legend); more often size is uniform and color alone carries category. Country ISO codes sit directly adjacent to points in ~7 pt, substituting for a legend.

## Lines & hierarchy

Weights live in a narrow band: **0.5–1 pt for reference lines, 1.0–1.5 pt for secondary traces, 1.5–2.5 pt for the hero or national-aggregate trace**. Hierarchy is built by weight and opacity, not color escalation — a classic move is ~300 thin α-0.35 regional curves behind one or two opaque ~2 pt national lines. Dashed patterns are specialized: **dashed horizontal red at Re=1**, dashed vertical grey for policy-event dates (lockdowns, travel restrictions), dashed black for projected continuations, dotted grey for zero or detection thresholds.

## Bars & forest plots

Forest and coefficient plots are the genre's signature form. Flat, borderless, typographically rich: each row is a horizontal CI whisker with a filled circle (or paired circle + square for subgroups) at the estimate, a **dashed vertical reference line at 0 or OR = 1**, and inline annotations flush-right or flush-left carrying β, t, P, supported/total fractions — the figure becomes a hybrid table. Whiskers are frequently **cap-free**; when caps appear they are flat, ~0.75 pt, ~4 pt wide. A distinctive two-tier whisker — thick inner 50% bar plus thin outer 95% extension — conveys uncertainty hierarchy without boxes. Regression bars are flat-filled, borderless, width ~0.6–0.8 of slot. Stacked horizontal bars carry **inside-bar numeric annotations** (both % and raw n); axis break `//` handles compressed dominant segments.

## Maps & choropleths

Geography is ubiquitous. Choropleths use either a **7–10-step discrete sequential ramp** with explicit numeric interval labels (preferring exact lookup over a continuous bar) or a **diverging red-white-blue / red-white-green** scale centered at zero for change maps. Borders are **hairline dark grey ~0.3–0.5 pt**. Maps are frequently paired — adoption (cool) beside burden (warm), or national with a regional inset zoom. Bivariate 3×3 choropleths appear for two-axis encodings. No spines, no graticules; the frame is edge-to-edge. Colorbars sit **right-side vertical (thin-tall)** for choropleth or **bottom-center horizontal (thin-wide)** for heatmaps, labeled only at endpoints and midpoint.

## Typography

Sans-serif throughout — **Helvetica Neue or Arial**. Size ladder: **panel letters 10–12 pt bold lowercase (a, b, c) top-left**, axis titles 8–10 pt regular, tick labels 7–8 pt, legend/annotation 7–9 pt, inline statistics (β, t, P) 8 pt italic. **Bold is reserved almost exclusively for panel letters**; colored bold country or condition names sometimes stand in for a legend. Math renders as inline unicode (β, %, °C), not LaTeX.

## Composition & whitespace

Layouts are **mosaic rather than strict grids**: a large anchor plus a 2×2 satellite cluster, or a full-width top strip with a 1×3 row beneath. Panel letters sit flush top-left inside the frame. Inter-panel gutters ~8–12 pt; outer margins generous. **Bottom-left-only L-frame spines** are near-universal — top and right stripped, no gridlines in line, scatter, or bar panels. Legends migrate outside the plot area or collapse into colored inline text in the title strip. The genre tolerates **unusually heavy per-point labeling** when reproducibility demands — every prevalence point annotated with `61.6% (125/203)`, every forest row with exact β/P.

## Error representation

Uncertainty is front-and-center. On **line/time-series plots, shaded CI bands at α ≈ 0.15–0.30 in the parent line's hue** dominate — never generic grey, because categorical identity must survive inside the envelope. Two-tier envelopes (inner process + outer scenario, or inner 50% + outer 95%) appear when multiple uncertainty sources matter. On **forest plots**, horizontal whiskers extend in the point color, typically cap-free. On bar charts, thin ~0.75 pt solid black error bars with small flat caps. Violin and density plots replace box plots when shape matters, with embedded open-circle median. **Exact p-values above bracket comparisons** are preferred over asterisks.

## Signature moves

Persistent semantic color across every panel of a paper, so a reader learns the vocabulary in Figure 1 and reads Figures 2–5 without re-consulting the legend. Dashed reference lines at null values (Re=1, OR=1, AMCE=0) as universal anchors. CI bands color-matched to their parent line at low alpha. Forest plots as hybrid table-figures with inline β/P/n. Filled-vs-open circle dual-coding for provenance. Choropleth pairs (cool adoption + warm burden) at matched granularity. Ensemble-plus-aggregate line bundles dramatizing regional heterogeneity against a national signal. Bottom-left-only spines, no gridlines, pure white ground — the editorial minimalism that lets the uncertainty, the geography, and the coefficient do the arguing.
