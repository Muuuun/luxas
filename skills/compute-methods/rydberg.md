---
domain: rydberg
match: rydberg, blockade, pairinteraction, arc, c6, c3, dipole, quantum defect, mqdt, ytterbium, yb, dressing, van der waals, 里德堡, 阻塞
verified: 2026-07-13
verified-on: vm
---

# Rydberg pair interactions — field standard: pairinteraction (MQDT) + ARC

| Tool | First-use frictions | Smoke test |
|---|---|---|
| pairinteraction 2.5.1 | (1) **Species strings are exact**: `"Rb"` works; `"Yb174"` fails with "No tables found" — divalent atoms exist ONLY as MQDT variants: `"Yb174_mqdt"`, `"Yb171_mqdt"`, `"Sr88_mqdt"`. If the error says "Check the spelling of the species", it means exactly that. (2) **DB init order**: `import pairinteraction.real as pi; pi.Database.initialize_global_database(download_missing=True)` BEFORE any KetAtom (v2 auto-downloads; nothing is "manual"). CLI form: `python3 -m pairinteraction database download <species>` (bare `pairinteraction` binary is NOT on PATH for --user installs → exit 127). (3) MQDT KetAtom wants full quantum numbers (`nu=`, `l=`, `j=`/`f=`, `m=`); `nu` (effective) ≠ `n`. Yb171 F=1/2 has TWO S-series ~0.4 apart in nu — disambiguate by nu and record the ket's energy. Perturbative C6 DIVERGES near pair resonances (e.g. Yb171 mixed series nu≈80.5) — flag, don't ship as design value. | `python3 -c "import pairinteraction.real as pi; pi.Database.initialize_global_database(download_missing=True); print(pi.KetAtom('Rb',n=60,l=0,j=0.5,m=0.5).get_energy(unit='GHz'))"` |
| ARC 3.10.2 | (1) Class-per-isotope: `from arc import Rubidium87, Ytterbium174`; divalent classes need spin arg (`getEnergy(60,0,0,s=0)`). (2) Energies in eV, negative to threshold; `j` is float (0.5); the eV↔GHz and missing-2π conversions are the classic bugs. (3) SQLite db locking under parallel access for n>80 — serialize or retry; import pulls matplotlib (stderr warning noise). ARC's Yb module covers ¹S₀ series only — for ³S₁/singlet-triplet mixing use pairinteraction MQDT. | `python3 -c "from arc import Rubidium87; print(Rubidium87().getEnergy(60,0,0.5))"` |

Cross-check convention: pairinteraction `C3` = pair hopping element; ARC collinear C3 = 2× that (the (1−3cos²θ) factor at θ=0). For a 2D array (interatomic axis ⊥ quantization) use θ=90°: factor +1.

## Known false rejections
- "pairinteraction requires manual database download" — FALSE (Yb/Rb单光子 run, 2026-07-11). v2 auto-downloads; the actual error was the species string.
- "rydcalc is not publicly installable" — UNTESTED claim, repeated by PI pushback without verification (same run).
