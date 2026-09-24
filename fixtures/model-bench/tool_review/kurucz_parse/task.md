Write a pytest test file `test_kurucz_parse.py` (at `data/experiments/{{EXPERIMENT_ID}}/tests/test_kurucz_parse.py`) for the tool `kurucz_parse` (module `data/experiments/{{EXPERIMENT_ID}}/scripts/kurucz_parse.py`).

**Purpose**: parse the Kurucz Y I electric-dipole (E1) line list into a normalized transition table with spontaneous-emission A coefficients.

**Contract**: `parse_kurucz(lines_path: str) -> list[dict]` returns a list of dicts, each `{"E_lower_cm": float, "E_upper_cm": float, "J_lower": float, "J_upper": float, "log_gf": float, "A_s1": float, "wl_vac_nm": float}`, sorted by E_lower_cm then E_upper_cm.

Record format (one transition per line, whitespace-separated leading fields; labels may contain spaces): air wavelength (nm), log10(gf), element code (39.00), energy of the FIRST (lower) level (cm⁻¹), J of the lower level, lower level label (free text, may contain spaces), energy of the SECOND (upper) level (cm⁻¹, always written with a decimal point), J of the upper level, upper label and trailing columns (ignored). Real records:

```
   123.8476 -3.407 39.00       0.000  1.5 5s2 4d a2D  -80744.412  1.5 z(2P)2P300  9.07 -5.90 -7.71K06  0 0  0 0.000  0 0.000                      798 1328     0
   156.3303 -3.074 39.00  -74496.286  1.5 O(1S)2D126   10529.163  0.5 5s2 5p z2P  7.86 -2.76 -6.75K06  0 0  0 0.000  0 0.000                      800  630     0
   403.9822 -0.131 39.00       0.000  1.5 5s2 4d a2D   24746.574  2.5 s1D)5p y2D  8.36 -5.96 -7.68K06  0 0  0 0.000  0 0.000                      798 1088     0
```

Physics/conventions the implementation must honor:
- Bound levels (energy < 50145.6 cm⁻¹) are stored NON-NEGATIVE = absolute energy above ground (the ground state is stored as 0.000 and is bound).
- Autoionizing levels are stored NEGATIVE with magnitude NOT equal to absolute energy; for an autoionizing upper level the absolute upper energy = E_lower + ΔE with ΔE = 1e7/λ_vac (cm⁻¹, λ_vac in nm).
- Kurucz wavelengths are standard air; convert to vacuum with the Edlén (1966) standard-air refractive index before computing ΔE or A. `wl_vac_nm` is that vacuum wavelength.
- A_ul [s⁻¹] = 0.66702e16 / λ²[Å] × 10^log_gf / (2·J_upper+1), with λ[Å] = λ_vac_nm × 10.
- Keep only lines whose lower level is bound (stored lower energy ≥ 0); drop lines with an autoionizing (negative) lower level.
- Malformed / header-like lines are skipped without raising.

Write tests that verify these invariants on small synthetic records you construct yourself, with ground truth (A-values, ΔE, vacuum wavelengths) computed independently in the test from first principles. Do not read the implementation body.
