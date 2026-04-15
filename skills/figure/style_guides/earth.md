# Earth Science Figure Style Guide (Nature)

## Visual voice

Earth-science figures in Nature read as *cartographic-clinical*: NWS-analysis-chart density, USGS-sheet restraint. Recurring mood words are "clinical," "analytical," "meteorological," "measured," occasionally "epic" for planetary subjects. Figures are polished-vector with hard edges; rasters (hillshade, satellite retrievals, DEMs, polar orthographic basemaps) carry gradient texture underneath, but every vector overlay — fault trace, grounding line, ship track, basin polygon — is crisp, thin, geometric. White line halos are essentially never used; separation comes from z-order and background luminance.

## Figure 1 schematic conventions

Figure 1 is almost never an abstract conceptual schematic. It is overwhelmingly a **geographic anchor**: shaded-relief study-area map, polar orthographic projection, or multi-scale drill-down (global disk → regional → site), typically with a locator inset. Ingredients: grey hillshade or satellite basemap, colored overlays for faults/grounding lines/ancestral-lake polygons, one high-chroma focal marker (green X, red bounding box, magenta fault-plane outline) that orients the reader instantly, a nested zoom inset, compass rose, scale bar. When Figure 1 *is* conceptual it tends to be a **timeline-as-schematic**: a δ¹⁸O or phylogenetic spine running L-to-R across geological epochs with colored epoch bands (peach Eocene, tan Oligocene, yellow Miocene, cooler Pliocene/Quaternary) beneath the x-axis, and hairline downward arrows linking spine moments to map panels above. Labels use short leader lines or offset callouts, never inline text over terrain.

## Palette

Five to seven hues per figure, mixed temperature, muted-to-vivid saturation. A recurring earth-tone core: **navy/cobalt (~#2B4C8C, #4A90D9)** for cool/steppe/ocean/low-emissions; **salmon-to-brick (#E8735A, #C0392B, #8B0000)** for warm/high-emissions/mass-loss/faults; **burnt orange/terracotta (#E07040, #E87722)** for intermediate scenarios; **forest and sage green (#2D6B3C, #7AB87A)** for vegetation, agreement, or in-situ observations; **gold/ochre (#D4A017, #F5C518)** for epochs and reference classes; **lavender/mauve (#B08CC8)** for tertiary categories. Grey (#808080) is reserved for published references, outgroups, or data-disagreement regions.

## Color conventions

Color is *semantic first, sequential second*. Named categories (populations, SSP scenarios, ice-sheet models) receive a persistent hue carried rigidly across every panel — PCA to Sankey to pie-chart map to time series. Sequential physical fields use perceptually-uniform magma/inferno/viridis ramps. Anomalies use **diverging RdBu_r centered at zero**, often *asymmetrically stretched* toward the dominant sign to represent imbalance honestly. Warm = loss/warming/high-emissions; cool = gain/cooling/low-emissions is near-universal. Transparency is disciplined: ~0.25–0.4 alpha on CI bands, density overlays, uncertainty rectangles; fully opaque on error bars, contours, annotation.

## Markers & data encoding

Filled circles dominate time-series and scatter at 3–7 pt. Categorical vocabularies (pentagon, hexagon, diamond, four-directional triangles, star, cross) appear when many named groups coexist, with **outlined large shapes (~8–10 pt) reserved for new-study groups and small filled triangles for published references** — instant hierarchy. Open vs filled within the same color distinguishes ancient vs present-day or model vs observation without spending a new hue. Pie-chart markers sized by sample count on topographic relief are a signature device. Size generally does not encode magnitude; the exception is population-scaled open circles on log axes where area encodes one variable and fill encodes another.

## Lines & hierarchy

Weights live between **0.5 and 1.5 pt**: 0.75 pt default, 1.0–1.5 pt for emphasized data, 0.3–0.5 pt for basin outlines, graticules, grounding lines, contour strokes. Solid = primary observed/modeled; long-dash = trend fits, zero-reference, or inferred/uncertain connections (admixture edges, ancestral-lake boundaries, cloud-base references); dash-dot = alternative scenarios. Ends rounded on curves, butt on spines. Z-order is explicit — raster bottom, sequential/diverging contours, observational contours, black geographic boundaries on top.

## Heatmaps & maps

Maps layer four to five data fields without apology. The canonical stack: grey shaded-relief or satellite raster → perceptually-uniform sequential or diverging raster field (ice thickness, SWE anomaly, cloud droplet radius) → vector contours for a second dynamical field (orange/red for geopotential-pressure, magenta for ERA5 reference, blue isentropes) → black coastlines at ~0.3 pt → categorical overlays (fault traces, grounding lines, pie-chart markers, ship-track contours whose color *adapts* white-to-yellow with local luminance). Non-significance is marked by **diagonal hatching over choropleth polygons**, preserving the hue underneath rather than greying it out. Colorbars are thin-tall on the right for paired panels, thin-wide across the bottom for shared choropleth panels; logarithmic ticks are standard for ice velocity (1, 10, 100, 1000). Polar orthographic projections carry grounding lines at ~0.5 pt white/black with bold 1.5 pt red/yellow for paleo-grounding overlays.

## Typography

Sans-serif throughout — Helvetica Neue, Arial, occasionally Myriad Pro. Panel labels 9–11 pt bold lowercase (a, b, c, often italic in recent papers), axis titles 8–9 pt regular, tick labels 7–8 pt, legends 6–8 pt. Bold is reserved almost exclusively for panel letters. Italic for variable names (T, f₄, ∂SWE/∂T). Math is inline unicode — degree symbols, μ, δ, Δ, superscripts m s⁻¹, hPa, µm, °N, °W.

## Composition & whitespace

Layouts are mosaic: 2×2 for paired maps, 2×3 or 3×2 for polar-map arrays, 1×2 for map + strip-plot pairings, and a recurring signature — **one full-width anchor panel (time series, δ¹⁸O spine, mass-balance overlay) across the bottom, with smaller map/scatter panels feeding into it from above**. Gutters tight (5–12 pt); outer margins generous. Panel labels flush top-left, bold, no enclosing box.

## Error representation

Shaded CI bands at ~30–40% alpha color-matched to the parent line are the default on continuous curves; uncapped whiskers on box-and-whisker plots for projection ensembles. Scatter error bars are fully opaque, capped with small flat serifs, matched to series color. A distinctly earth-science idiom is the **overlapping semi-transparent rectangle stack** — each rectangle's x-extent encoding a study's time period and y-extent its uncertainty range — where density-of-overlap substitutes for a computed consensus statistic. Stippled green dots are the preferred significance overlay on maps, keeping the color field readable underneath.

## Signature moves

Asymmetric diverging colormaps stretched toward the dominant sign; multi-scale zooms from global disk to sub-meter with cross-panel color-coded markers tying scales together; pie-chart markers on topographic relief; colored epoch bands as a second x-axis beneath geological time series; dual-axis plots juxtaposing proxy past (δ¹⁸O, inverted) with projected future (temperature anomaly); layered multi-contour meteorological cartography with rigidly semantic hues; hatched polygons for non-significance; dashed colored arrows across PCA space for migration trajectory; full-width time-series anchor panels connected upward by hairline arrows to a grid of map snapshots, turning disparate panels into one temporally coherent narrative.
