# Domain Style Guides

Six prose style guides distilled from real Nature paper figures, used by the illustrator pipeline to make figures look domain-native rather than generic-matplotlib.

| File | Sample basis |
|---|---|
| `physics.md` | ~47 Nature physics papers (2020–2025), main figures only |
| `biology.md` | ~48 Nature biology papers |
| `chemistry.md` | ~49 Nature chemistry papers |
| `earth.md` | ~49 Nature earth/climate papers |
| `ml.md` | ~50 Nature ML/AI papers |
| `policy.md` | ~47 Nature policy/social-science papers |
| `_default.md` | Conservative fallback (Okabe-Ito) when domain detection fails |

## How they're produced

Mining pipeline lives in a separate repo: `Muuuun/aesthetic_style_skills` (private). It crawls Crossref, samples ~50 Nature research papers per domain, scrapes main figures from Nature HTML (no PDFs, no paywall touched), runs Sonnet 4.6 vision over each paper to extract structured style notes, then synthesizes per-domain prose guides. End-to-end cost ~$18.

To refresh these guides (e.g. expand sample size or re-mine with a tweaked schema):

```bash
./skills/figure/scripts/sync_style_guides.sh
```

## How they're used

PI (in `<figure_finalize_loop>` of `src/agents/definitions/reviewer.md`) detects the project's domain at the start of the figure-finalize loop and copies the matching guide into `report/figures/style_guide.md` if it doesn't already exist. Illustrator workers then read `report/figures/style_guide.md` as the authoritative project style — same read path as before, no template variable changes.

If the project already has figures with established conventions, the seed step blends: project consistency wins where it conflicts with the Nature norm, but the Nature guide informs gaps.
