# Datasets — provenance ledger

> **Required artifact** if the survey contains any re-analysis figure
> (narrative-with-embedded-re-analysis type, or any review reprocessing
> observational data). Without this, re-analysis figures are unauditable
> — equivalent to PRISMA-name-without-substance for empirical sciences.

## Per-dataset entry

For each observational or computational dataset used:

```markdown
## <dataset name>
- Source: <URL / DOI of dataset paper or repository>
- Version: <version string or commit hash>
- Download date: <ISO>
- Processing pipeline: <script path within project / git commit hash>
- Hash of raw download: <sha256 of the source file(s)>
- Citation: <DOI of dataset paper>
- License: <e.g. CC-BY-4.0 / proprietary / restricted>
- Used in: <figure path or analysis result key>
- Reprocessing notes: <any non-default flags, subset selection, region
  masks, time-range filters; verbatim CLI invocation if scripted>
```

## Worked examples

```markdown
## ERA5 surface temperature reanalysis
- Source: https://doi.org/10.24381/cds.adbb2d47
- Version: ERA5-Land v2024.1
- Download date: 2026-04-15
- Processing pipeline: scripts/reprocess_era5.py (commit a3f2e91)
- Hash of raw download: sha256:c8...
- Citation: Muñoz-Sabater et al. 2021, https://doi.org/10.5194/essd-13-4349-2021
- License: Copernicus license
- Used in: report/figures/temperature_trend.pdf
- Reprocessing notes: monthly aggregates 1981-2020, land-only mask,
  bilinear interpolation to 0.25° grid; CLI: python scripts/reprocess_era5.py --vars t2m --start 1981 --end 2020
```

## Cross-cutting requirement

If `notes/datasets.md` exists, every figure in the report that was
derived from a dataset listed here must carry a caption including the
dataset name and version, e.g.:

> "Re-analyzed from ERA5-Land v2024.1 (download 2026-04-15);
> reprocessing pipeline: scripts/reprocess_era5.py."

This is the agent equivalent of the Earth-science venue norm: dataset
provenance is the methodological burden in narrative-with-embedded-
re-analysis surveys.
