# Anchor exemplars — named A-grade reviews per verification floor

> Use this when filling in `notes/scope.md`'s "anchor:" field for each
> declared verification floor. Pick the closest match by domain + floor
> and try to mirror its structural moves. All entries verified against
> the 240-review corpus in `empirical_evidence/`.

## Counting floor

Bounded N from publicly named source; mechanical classification with
released lexicon; longitudinal table. Reproducible by other teams.

| Anchor | Domain | What to mirror |
|---|---|---|
| **VLM-26K** (arXiv:2510.09586) | CS / vision-language | 26,104 papers from CVPR/ICLR/NeurIPS 2023-2025; 35-label hand-crafted lexicon; longitudinal cross-venue consistency check; lexicon publicly released |
| **Reuel BetterBench** (NeurIPS 2024, arXiv:2411.12990) | CS / benchmarks | 24 benchmarks × 46 criteria; ≥2 raters with calibration round; *counts* not gestures (e.g. "17/24 lack replication scripts"); companion site released |
| **Balloccu Leak-Cheat-Repeat** (EACL 2024, arXiv:2402.03927) | CS / data contamination | 255 papers manually coded over 1 year; reconstructs ~4.7M leaked samples across 263 benchmarks; release on leak-llm.github.io |

## Measurement floor

≥30 open-weight artifacts; survey authors run ≥3 standard benchmarks
themselves; system-level numbers (latency / memory / throughput) on
identified hardware. Distinguish from "measurement" of cited numbers —
the floor requires *survey authors' own* measurements.

| Anchor | Domain | What to mirror |
|---|---|---|
| **Lu et al. SLM Survey** (arXiv:2409.15790) | CS / small LMs | 70 open-source SLMs (100M-5B); authors ran capability + latency + memory benchmarks themselves; revisions push updated model lists |
| **FedLearn aggregation** (arXiv:2511.22616) | CS / federated learning | Survey-with-experiments hybrid; authors run controlled IID/non-IID aggregation tests; literature integrated around the empirical results |
| **White et al. synthetic-data scaling** (arXiv:2510.01631) | CS / data | Authors run their own scaling-law experiments on synthetic-vs-real mixtures; characterize model collapse empirically; literature is the framing, experiments are the evidence |

## SLR floor

Explicit search query; screening counts (PRISMA flow); ≥50 included works;
extracted-feature data dump publicly released.

| Anchor | Domain | What to mirror |
|---|---|---|
| **Saadati OCL-SLR** (arXiv:2501.04897) | CS / online continual learning | True SLR: 81 approaches, 83 datasets, >1000 features extracted, >500 components identified; full extracted-feature data dump on GitHub; PRISMA-style framing substantively delivered |
| **Cochrane CDSR template** (CD002991 inhaled corticosteroids COPD; PMC10042218) | Medicine | Verbatim Cochrane methodology: dual independent screening, RoB tool stated, GRADE per-outcome certainty, "resolved disagreements by consensus", Summary-of-Findings table with "Certainty of the evidence (GRADE)" column |
| **eClinicalMedicine TB SR 2025** (PMC12146525) | Medicine | PRISMA-compliant; Cochrane Library + MEDLINE + Embase searched 2010-2024; 53 datasets included; pooled risk ratio with 95% CI + forest plot |

## Anchor-experiment floor

≥1 sub-claim from the literature reproduced or controllably tested by
survey authors; setup described to standalone-empirical-paper depth (data,
code, hardware named).

| Anchor | Domain | What to mirror |
|---|---|---|
| **FedLearn aggregation** (arXiv:2511.22616) | CS | Same as Measurement floor — straddles both because survey-with-experiments is one of the cleanest paths to A |
| **Wen-Hecht-Mevel H2 safety** (PECS 2024, OSTI 2498424) | Engineering / combustion | Re-plot benchmark experimental data (laminar flame speeds, MIE, detonation cell sizes) from many primary sources on consistent axes using authors' group's reaction-mechanism re-evaluation; reduced-mechanism predictions recomputed and overlaid |
| **Berkeley RDI benchmark exploits** (rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/) | CS / benchmarks | Built scanner agent, ran exploits through *official* eval pipelines on 8 benchmarks; concrete failure-mode catalog ("Single 10-line conftest.py achieved 100% on SWE-bench") |

## Re-derivation floor (math / theoretical)

Load-bearing equations re-derived in single unified notation; ≥10 named
methods drop out as instances of one master object; new short proof of
≥1 known result.

| Anchor | Domain | What to mirror |
|---|---|---|
| **Blanes-Casas-Murua splitting methods** (Acta Numerica 33, arXiv:2401.01722) | Math / numerical analysis | Order conditions re-derived from single Lie-algebraic formalism; Strang, Yoshida, etc. all re-cast as instances of one composition tableau |
| **Combettes monotone operator splitting** (Acta Numerica 33, arXiv:2310.08443) | Math / optimization | Every algorithm re-derived as successive projections onto separating half-spaces; ~20 named methods subsumed; new convergence proofs under unified assumptions |
| **De Ryck-Mishra PINN error analysis** (Acta Numerica 33, arXiv:2402.10926) | Math / ML theory | Unified error decomposition (approximation + stability + generalization + training); fragmented PINN literature recast under three-error axis; identifies training error as dominant bottleneck |
| **Janus collab spin-glass** (RMP 97, 045005, arXiv:2412.08381) | Physics | Re-cast prior numerical estimates with corrected exponents (ξ^{D-θ/2} replacing ξ^3); 4PN ambiguity adjudicated and converged value fixed |

## Dataset re-analysis floor (earth-science / observational)

Authors re-process named observational datasets with documented pipeline;
new figures derived from reprocessing; dataset versioning and processing-
pipeline hash in `notes/datasets.md`.

| Anchor | Domain | What to mirror |
|---|---|---|
| **Tierney paleoclimate DA** (Annu Rev Earth Planet Sci 53, DOI:10.1146/annurev-earth-032320-064209) | Earth / paleoclimate | Offline ensemble Kalman filter pipeline explicitly described; ships paleoDA reconstructions (e.g., Pliocene warmth) as new figures from reprocessing; dataset provenance load-bearing |
| **Reviews of Geophysics LST** (10.1029/2022RG000777) | Earth / remote sensing | Tabulates inter-product biases across satellite-derived land-surface-temperature products; closest Earth-science analog to a "summary of findings" table |
| **Copernicus ESSD discussions** (essd.copernicus.org) | Earth / data products | Open peer review with all reviewer comments + author responses public; the only journal mode that produces externally auditable adjudication artifacts |

## Cross-domain bonus exemplars

Worth keeping in mind for hybrid surveys:

| Anchor | Why notable |
|---|---|
| **Acta Numerica norm** (8/8 Vol 33-34 articles 2024-25) | Every article re-derives prior theorems under one notation; coverage breadth explicitly secondary; the survey's value is the *unifying object* |
| **JEL norm** (≥80% of 2024 *JEL* surveys are A-grade) | Author re-estimation on harmonized data with replication packages on openICPSR; meta-analysis embedded in narrative |
| **Annual Review of Economics "stylized-fact tables"** | Recompute headline numbers from primary papers onto common scale (Restrepo 2024 on automation; D'Acunto-Weber on subjective expectations) |
| **Hutchcroft activated random walk** (Probability Surveys 21) | Names prior survey claims he disagrees with (the "all-models-agree" position), gives sharper formulation, lists disagreement explicitly as open conjecture rather than papering over |

## How to use this file

1. After choosing review type + verification floor in `scope.md`, pick the
   closest anchor from the matching floor section.
2. Read the anchor's actual paper (or the entry in
   `empirical_evidence/wave2_<domain>.md` for a deeper write-up).
3. Mirror the anchor's structural moves: same kind of corpus boundary,
   same kind of measurement, same kind of release (lexicon / data dump
   / experimental setup).
4. If no anchor fits cleanly, note it in scope.md and flag for
   `escalate_authority_bound` — the floor may not be matched in the
   240-review corpus and brain may be charting unmapped territory.

## How NOT to use this file

- Do not list the anchor as a citation in the report just because you
  declared it as your floor. The anchor is a methodological reference,
  not a substantive citation (unless you are actually surveying ML
  benchmarks and Reuel et al. is in your scope).
- Do not pick an anchor whose domain is far from yours (e.g. citing
  Acta Numerica as your anchor for a CS/ML survey). Re-derivation
  floor only applies if your survey is genuinely theoretical /
  mathematical.
