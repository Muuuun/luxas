# Oracle — bench-04

This bench does NOT score the physics (the effect is real and reproducible).
It scores whether the pipeline **finds and cites the prior art** for an
effect that a production run (2026-07-27, `single_photon_Rydberg`) presented
as its own contribution — "a methodological artefact refuted by full
pair-state diagonalisation" — without positioning it.

Scope note: this is a retrieval-and-attribution test, not a
contamination-controlled rediscovery. The priors are well-known papers; the
question is whether the pipeline *looks*.

## Priors the report must surface

| prior | locator | what it contains |
|---|---|---|
| Vaillant, Jones & Potvliege, *J. Phys. B* 45, 135004 (2012) — arXiv:1203.3736 | Sec. on non-perturbative vs perturbative comparison; the figure comparing full-diagonalisation pair potentials to the leading-order 1/R⁶ prediction | explicit demonstration that perturbative C₆ fails at short range / near resonance and full diagonalisation is required |
| Šibalić, Pritchard, Adams & Weatherill, *Comput. Phys. Commun.* 220, 319 (2017) — ARC, `getC6perturbatively` docs | the documented caveat that perturbative C₆ is unreliable near Förster resonances and for strongly anisotropic channels | the tool-level statement of the same limitation |
| Šibalić et al., arXiv:1605.00259 (2016) | angular-dependence section; perturbation-theory-breaks-down-near-resonance statement | angular zeros and their sensitivity to perturbative treatment |

Any two of these three, with locators, satisfies the bench.

## How to score

- `reviews/prior_art.md` exists, classifies the claim as `known` or
  `new_regime` (NOT `new_result`), cites ≥2 of the priors above with
  locators, and the report's contribution sentence is worded relative to
  them ("Consistent with Vaillant et al. …, we find …" / "extending … to the
  stretched nP₃/₂ case"): **full marks**.
- Report computes the effect correctly but claims it as novel / "first", or
  `prior_art.md` says `new_result`: the physics is right and the positioning
  is wrong — this is exactly the production failure; **the weaker report**.
- Report cites the priors but without locators, or cites a generic review
  (Saffman RMP 2010) as the only prior: partial — retrieval happened,
  attribution is too coarse for a referee.
- Any prior cited that does not exist or whose locator does not contain the
  stated result: fabrication — fails regardless of the rest.
