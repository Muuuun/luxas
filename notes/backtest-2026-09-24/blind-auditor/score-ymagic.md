# Score: blind audit (A) vs backtest (G), yttrium-magic-wavelengths-20260906

Scope: only G's Y* defects. Y8 is scored as a process defect (G itself calls it "Process") and left out. Y3 is a scaffold defect, but G lists it as a research defect that reached the report, so it is scored, and the counts are also given without it.

Verification was read-only on the droplet. Recomputations: ²D₃/₂ and ²D₅/₂ f-sums and α by source, taken from `augmented_y_dataset.json`; the lifetime-derived A-value against 1/τ; report.tex lines 22/30/71/75/79/97/101; the results.json quantity block; reviews r1/r3; pi_feedback.md. The scratch directory has been deleted.

## Recall

| G id | defect | reached report? | A match |
|---|---|---|---|
| Y1 | The f-sum "upper bound" of 1.75 a₀³ is `fsum_deficit/(2a)`; the real threshold bound is 15.33 → total 160.9, which passes. The diagnosis and the PI's εf veto are unsupported | **Yes** (title, abstract, §4, conclusion) | **FOUND**, F1. Same formula, same line numbers, same 15.33 / 160.9, and it also notes the PI veto |
| Y2 | Factor of 2 in the QDT continuum density (f₀/(2a) where f₀/a is correct); H check at 1.563/Hartree; the "1.9×" limitation is itself wrong | **Yes** ("continuum 1.03") | **FOUND**, F4. Same dE/dn derivation, same H 1.56/Hartree check, corrected 2.05 a₀³, total ~147.6, and it notes the 1.9× note comes from the halved formula |
| Y3 | The r3 revision (headline 151.41→146.59, confirmed→inconclusive) was never reviewed. The last reviewer ran at 08:49, before the QDT tool existed | **Yes** (all r3 numbers) | **MISSED**. F9 says no layer checked the bound, but it never notices that the reviews predate the revision |
| Y4 | Unsourced core value of 14.0 a₀³ (should be 3.9) | No (caught by reviewer r1) | MISSED |
| Y5 | Parametric ω_eff closure gave a marginal "confirmed" | No (superseded) | MISSED. F1 actually *reuses* the ω_eff = 0.37 case as supporting evidence, which is legitimate in its context |
| Y6 | The blind replicator's "estimate" was the benchmark itself (162 ± 12, inputs: []) in every round | Disclosed in report §2 | **FOUND**, F9 ("the replicator returned the benchmark itself"; reviewer ESTIMATE lines are MALFORMED) |
| Y7 | The Tablepol value 197.2 is Sr, not Y | No (fixed before the final version) | MISSED. It is only visible in results.json premise_corrections, not in the final claims |

## Precision (A findings that do not match a G defect)

| F id | verdict | reason |
|---|---|---|
| F1 | match Y1 | Correct. One small slip: it says "r2 and r3 reviewers' estimates 164.5 / 151.4" but cites the r1 and r3 files. The values are right (r1 gives 164.5 ± 13, r3 gives 151.4 ± 5) |
| F2 (BREAKS) | **NEW-TRUE** (extends Y1) | This is a second argument, independent of Y1, against "core-valence correlation, inaccessible to SOS". 111.5 of 141.66 a₀³ come from measured NIST A-values or lifetimes (recomputed: nist 99.13, lifetime 12.36, kurucz 29.9), and these already include core polarisation of the dipole operator. The residual α_vc is small and negative. G reaches the same "diagnosis unsupported" conclusion, but only through Y1. Caveat: the 805 Kurucz lines are semi-empirical, so "fully empirical" is overstated for ~21% of α. The conclusion still holds |
| F3 | **NEW-TRUE** (magnitude unverifiable) | Verified: the quantity's `uncertainty` is 12.0 with `uncertainty_source: "benchmark sigma …; valence SOS exact arithmetic"`. The model has no propagated uncertainty, yet the point value is 3.4 below the 150 edge. G mentions the Kurucz-gf question only as "no ground truth". A's 142–161 interval depends on an assumed 20–30% gf error, which cannot be settled from the artifacts. "Fails the gate" as a firm claim is weakened, not broken |
| F4 | match Y2 | Agrees with G |
| F5 | **NEW-TRUE** (minor) | Verified: report.tex:75/79 says the ground states are "well converged … stable", but no convergence test exists. Recomputed ²D₅/₂: 995 lines, f = 2.245, α = 143.30 (Kurucz 23.9; A said 24.3, a trivial difference). A 73–75% f-sum contradicts "converged". Under the report's own (wrong) logic the gap is correlation, so it looks internally consistent. Once Y1 is fixed it is an overclaim |
| F6 | **NEW-TRUE** | Verified: report.tex:97 calls all eight tabulated values "single-electron", says every one fails "low", and says "no correlated value exists for yttrium". The run's own list includes LR-CCSD 126.74, which is a correlated method, and TD-DFT LEXX 163, which is not low. The literature framing that supports the correlation diagnosis is factually wrong on the run's own data |
| F7 | NEW-TRUE (cosmetic, overlaps F2/F5) | "Complete" is used in the title and abstract while the f-sum is 73%. It is a wording overclaim with no independent consequence |
| F8 | **FALSE** | The premise that "A-value assumes 100% branching" is wrong. `merge_transition_dataset.py:15` uses the lifetime "while using Kurucz only for the relative branching". A = 2.051e8 against 1/τ = 1/4.6 ns = 2.174e8 means a branching fraction of 0.943 was already applied. A flagged this as "likely" and did not check it |
| F9 | match Y6 | It also correctly notes that the contradiction sweep checked the consistency of 1.75/147.3, not their validity. That is the same observation as G's Y1 "never caught" column |

## Disagreements
- **None substantive on the shared defects.** For Y1/F1, both passes compute 0.8003/0.22848² = 15.33 → 160.9. F1 quotes the εf headroom as ~4–5 a₀³ (the run's own experiments.md:107) and G says "up to ~14". These do not conflict: one is the run's expectation and the other is the Y1-corrected ceiling. For Y2/F4, both give f₀/a with a corrected continuum of about 2.05 and a total of about 147.6. G adds that the true H overestimate ratio is ~3.7× rather than 1.9×. A does not quantify this but agrees the 1.9× figure is an artifact of the bug.
- **Severity:** A rates Y2 (F4) as WEAKENS and G says "the verdict does not flip on its own". These agree. A rates F2 as BREAKS; given Y1 this is fair, because the report's central causal claim falls.

## Counts
- **recall (all research defects Y1–Y7): 3/7** (Y1, Y2, Y6). Excluding scaffold Y3: 3/6.
- **recall (defects that reached report: Y1, Y2, Y3, Y6): 3/4**. Excluding Y3: 3/3.
- **NEW-TRUE: 5** (F2, F3, F5, F6, F7; F7 is cosmetic and F3's magnitude cannot be verified). **FALSE: 1** (F8). **UNVERIFIABLE: 0**.
- **BREAKS findings that are real: 2/2** (F1 = Y1, F2).

## Summary
1. A found both physics defects that reached the headline (Y1 f-sum "bound" and Y2 factor of 2), with the same mechanism and numbers as G, plus the replicator-equals-benchmark issue (Y6). It missed the process-shaped Y3: the reviews predate the r3 revision.
2. The misses (Y4, Y5, Y7) were all caught or superseded before the final report, so they are invisible to an auditor who starts from the final claims.
3. Precision is high. 5 new real findings, the best being F2 (empirical matrix elements already contain correlation) and F6 (LR-CCSD is a correlated value, which contradicts "no correlated value exists"). One false finding: F8 assumed a unit branching fraction, but Kurucz branching (0.943) was applied.
