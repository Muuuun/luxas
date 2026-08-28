---
status: positioned
sources_md5: 015db0da5ff1f83bfcbf0a847305281c
claims_audited: 6
known: 1
new_regime: 1
new_method: 0
new_result: 4
reconciliation: 0
---

## Summary

The report has one genuinely layered headline and five sub-claims. The *headline* — that orienting Rb $nP_{3/2}$ gate pairs at a $C_6(\theta)$ zero yields a $\approx1.98\times$ two-dimensional packing-density gain over the isotropic S–S baseline — has no direct prior: no earlier paper computes a packing/atom-count gain from anisotropic Rydberg interactions. That headline is a *synthesis* of pieces that are individually established, and the report positions several of them as more novel than they are. (i) The $\theta=0$ nonzero residual and the $C_5$ quadrupole floor are already computed in Vermersch–Glaetzle–Zoller 2015 (App. A, $M=3$; App. B), which the report cites for anisotropy/magic distances but not for those specific results. (ii) The concept of an *angle* where $C_6(\theta)$ vanishes ("Förster zero angle") is stated explicitly in Wadenpfuhl–Adams 2025 — for $P_{1/2}$ pairs, not the homonuclear stretched $P_{3/2}$ pair the report treats; the report's zero at $24.65^\circ$ is therefore a new *regime*, not a new phenomenon. (iii) The sixth-root packing law is a corollary of the textbook blockade radius $R_b=(|C_6|/\hbar\Omega)^{1/6}$ (Löw et al. 2012; Saffman–Walker–Mølmer 2010); the report's addition is the explicit two-axis packing-gain formula and the quantified $\approx1.35\times$ cap. (iv) The "$54.7^\circ$ magic angle is a channel zero, not a total zero" is a direct reading of the three $\Delta M$ angular factors of the dipole–dipole operator already laid out in Wadenpfuhl–Adams 2025 (Eq. 1, Fig. 1a) and Vermersch et al. 2015 (App. A) — and the updated report now credits exactly these priors inline in §4. The genuinely new elements are: the $n=60$ numerical values (residual $-10.41$ GHz·µm⁶, zero $24.65^\circ$, anisotropy $\approx26\times$), the weak-blockade $C_5/C_8$ *gate* built on the $C_6$-zero floor, and the packing-density-gain optimization itself. (Re-run note: the Fig. 1 caption's $R\sim4.9$ µm S–S / $R\sim5.5$ µm P–P blockade radii are the report's own applications of Eq. (1) at its computed $C_6$ anchors, not prior-art numbers.)

## Claims

### C1: "The anisotropy alone does not yield a large gain: because the blockade and cross-talk radii scale as the sixth root of $|C_6|$, the $\approx$26$\times$ P–P anisotropy compresses to a $\approx$1.35$\times$ strong-blockade packing gain."
- **Neutral restatement:** For Rb $n=60$, the $\approx26\times$ P–P $C_6$ anisotropy between $\theta=0$ and $\theta=90^\circ$ produces only a $\approx1.35\times$ (1.38 rectangular / 1.315 staggered) 2D packing-density gain over S–S, because the blockade and cross-talk radii scale as $|C_6|^{1/6}$.
- **Closest prior:**
  1. `Low2012` — J. Phys. B 45, 113001 — §IV.A / Fig. "blockade": blockade radius defined where $V(r_b)=C_6/r_b^6=\hbar\Omega_R$ (the sixth-root scaling itself; the report reproduces it as Eq. (1) and cites this source).
  2. `Saffman2010` — Rev. Mod. Phys. 82, 2313 — Eq. (29) "scale1" (blockade-radius condition) and §II (S-state $D_\varphi=4/3$, no Förster zeros): the textbook scaling and the isotropic S–S baseline.
  3. `Vermersch2015` — Phys. Rev. A 91, 023411 — App. A (D-matrices, Fig. 2): the P-state vdW anisotropy that feeds the sixth-root law; no packing-gain statement.
- **Delta class:** new_result
- **Delta:** Low2012/Saffman2010 give the blockade radius $R_b\propto|C_6|^{1/6}$, from which density $\propto|C_6|^{1/3}$ is an immediate corollary; this report states the explicit two-axis packing-gain factorization $g_{2D}=[(C_6^{SS}/C_6(0))(C_6^{SS}/C_6(90))]^{1/6}$ and quantifies the $\approx1.35\times$ ceiling at $n=60$ — a synthesis no prior computes, though none of its ingredients is new.
- **Queries run:** "Rydberg blockade radius sixth root C6 packing density"; "anisotropic Rydberg interaction gate array density"; "Rydberg gate array density packing anisotropic blockade"; plus direct reads of Low2012 §IV.A and Saffman2010 Eq. (29).
- **Wording required:** Sentence as-is; the report already cites Low2012/Saffman2010 for the blockade radius, but should say plainly that $g_{2D}\propto|C_6|^{1/6}$ *is* the textbook blockade-radius scaling rather than a new law.

### C2: "The decisive lever is instead the existence of an angle $\theta^*\approx24.65^\circ$ (three-channel model; bounded to $\pm0.35^\circ$ inter-method spread) at which the three-channel $C_6(\theta)$ vanishes --- where the repulsive $\Delta M=0$ and $\Delta M=\pm1$ channels cancel the attractive $\Delta M=\pm2$ channel."
- **Neutral restatement:** For the Rb $60P_{3/2}$, $|m_j|=3/2$ stretched pair, the three-channel $C_6(\theta)$ has a genuine zero at $\theta^*\approx24.65^\circ$ (headline $24.3\pm0.35^\circ$), distinct from the $54.7^\circ$ single-channel zero.
- **Closest prior:**
  1. `Wadenpfuhl2025` — Phys. Rev. A 111, 062803 — §III.B (text near Fig. 5): "Pair states like $\ket{76P_{1/2},60P_{1/2}}$ … two channels of different sign cancel each other at a Förster zero angle where the interaction strength vanishes as the sign of $C_6$ changes along $\theta$" — the Förster-zero-angle phenomenon, for $P_{1/2}$ (two $\Delta M$ channels); also Eq. (1)/Fig. 3 for the channel angular dependencies.
  2. `Vermersch2015` — Phys. Rev. A 91, 023411 — App. A §j=1/2 eigenvalues (the $\lambda_0$ eigenstate called "a Förster zero", no $C_6^{(1)}$ contribution) and App. A §j=3/2, $M=3$ (the stretched-pair eigenvalue) — the ingredients, but no $\theta^*$ at which $C_6(\theta)=0$ is extracted.
  3. `Walker2008` — Phys. Rev. A 77, 032723 — Table I (Förster-zero states with $D_\varphi=0$ entries) and §II Eq. (18) (existence condition for a Förster-zero eigenstate) — establishes angular/Förster zeroes in vdW channels as known.
- **Delta class:** new_regime
- **Delta:** Wadenpfuhl–Adams 2025 establishes the $C_6(\theta)$ "Förster zero angle" for heteronuclear $P_{1/2}$ ($j=1/2$) pairs; this report computes the analogous three-channel ($\Delta M=0,\pm1,\pm2$) zero for the *homonuclear stretched $P_{3/2}$* pair at $n=60$, $\theta^*=24.65^\circ$ — same result class, new species/angular-momentum regime and new numerical value.
- **Queries run:** "Rydberg p state van der Waals C6 zero angle"; "Förster zero angle van der Waals Rydberg p state"; "magic distance Rydberg p state blockade" (returned Vermersch2015 as the key prior); direct read of Wadenpfuhl2025 §III.B/Fig. 5 and Vermersch2015 App. A.
- **Wording required:** Sentence as-is, but the report should acknowledge that the *existence* of a $C_6(\theta)$ zero is already named a "Förster zero angle" in Wadenpfuhl–Adams 2025 (for $P_{1/2}$); only the $P_{3/2}$ value is new.

### C3: "The $54.7^\circ$ magic angle is a channel zero, not a total zero --- the true $C_6$ zero is at $24.65^\circ$"
- **Neutral restatement:** The $(1-3\cos^2\theta)^2$ factor kills only the $\Delta M=0$ channel at $54.7^\circ$; the $\sin^4\theta$ ($\Delta M=\pm2$) channel survives, so the total $C_6(54.7^\circ)=+126.3$ GHz·µm⁶ is far from zero.
- **Closest prior:**
  1. `Wadenpfuhl2025` — Phys. Rev. A 111, 062803 — Eq. (1) (label `eqn:dipoleInteractionSpherical`) + Fig. 1(a): the three rows of $\hat V_{dd}$ carry $(1-3\cos^2\theta)$, $\sin\theta\cos\theta$, $\sin^2\theta$ for $\Delta M=0,\pm1,\pm2$; Fig. 3 plots the channel angular dependencies. (Note: the report's inline "Wadenpfuhl & Adams 2025, Eq. 2" is off by one — the three $\Delta M$ angular factors are Eq. 1 in the arXiv source 2412.14861.)
  2. `Vermersch2015` — Phys. Rev. A 91, 023411 — App. A: the $\mathcal D_1,\mathcal D_2,\mathcal D_3$ matrices (entries $\propto\sin2\theta,\sin^2\theta,\cos2\theta$) and the $\mathcal M_i$ expression (dipole–dipole angular operator, $Y_2^{\mu+\nu}$) carry the same angular structure.
  3. `Walker2008` — Phys. Rev. A 77, 032723 — Table I / §"Consequences of Zeeman degeneracy": the $D_\varphi$ angular factors for p-state channels, from which the $(1-3\cos^2\theta)$ magic-angle zero is standard.
- **Delta class:** known
- **Delta:** The channel-vs-total distinction is a direct reading of the three $\Delta M$ angular factors already tabulated in Wadenpfuhl2025 Eq. (1)/Fig. 1a and Vermersch2015 App. A; the report's own addition is only the numerical evaluation $C_6(54.7^\circ)=+126.3$ and the flagged correction of its earlier two-channel value.
- **Queries run:** direct read of Wadenpfuhl2025 Eq. (1)/Figs. 1,3 and Vermersch2015 App. A D-matrices.
- **Wording required:** Already satisfied — §4 now credits "the three $\Delta M$ angular factors of Wadenpfuhl2025 Eq.(2) and Vermersch2015 Appendix A" inline at the three-channel decomposition. (Optionally correct Eq. (2) → Eq. (1).)

### C4: "At $\theta=0^\circ$, the interaction does not vanish … the converged wide-window diagonalization gives $C_6(0^\circ)=-10.41$ GHz·µm$^6\pm0.3$ … the physical P–P anisotropy is $\approx$26–29$\times$"
- **Neutral restatement:** The stretched $60P_{3/2}$ pair has a nonzero $\theta=0$ residual $C_6(0^\circ)=-10.41$ GHz·µm⁶ (7.5% of $|C_6^{SS}|$), so the P–P anisotropy is $\approx26\times$, not the $\sim10^6\times$ of the naive degenerate-perturbation channel miss.
- **Closest prior:**
  1. `Vermersch2015` — Phys. Rev. A 91, 023411 — App. A, §j=3/2, §M=3: the stretched pair $|\tfrac32,\tfrac32\rangle$ has eigenvalue $\lambda_0=\frac{4C_6^{(3)}}{15}+\frac{4C_6^{(4)}}{625}+\frac{136C_6^{(5)}}{1875}+\frac{84C_6^{(6)}}{625}$ — explicitly *nonzero*; Figs. 10/11 show it is negative (attractive) for $n>38$.
  2. `Walker2008` — Phys. Rev. A 77, 032723 — §"van der Waals Interactions Between Degenerate Rydberg Atoms" + Table I (`evals`): the degenerate-Zeeman vdW matrix, from which the nonzero stretched-pair shift follows.
  3. `Wadenpfuhl2025` — Phys. Rev. A 111, 062803 — Fig. 2 ($C_6$ maps at $\theta=0$): $C_6(\theta{=}0)$ is nonzero for the $P_{1/2}$ pairs studied.
- **Delta class:** new_result
- **Delta:** Vermersch et al. 2015 already give the *structure* (nonzero $\theta=0$ eigenvalue for the stretched $P_{3/2}$ pair, attractive at $n>38$); this report supplies the specific $n=60$ value $-10.41$ GHz·µm⁶ and combines it with the $\theta=90^\circ$ anchor into the "$\approx26\times$, not $10^6\times$" anisotropy — the numerical value and the artifact diagnosis are new, the qualitative $\theta=0$-nonzero fact is not.
- **Queries run:** "stretched p3/2 Rydberg van der Waals theta zero residual" (no relevant hits); direct read of Vermersch2015 App. A §M=3 and Walker2008 §III/Table I.
- **Wording required:** Sentence as-is, but the $\theta=0$-nonzero fact should be credited to Vermersch2015 App. A §M=3 (the report currently cites Vermersch2015 only for the anisotropy matrix and magic distances, not for the nonzero $\theta=0$ eigenvalue).

### C5: "At this angle a compact weak-blockade gate driven by the residual $C_5/C_8$ quadrupole interaction is viable (fidelity 0.9967 at $R=2.0$~µm)"
- **Neutral restatement:** At the $C_6$ zero, the residual $C_5/R^5+C_8/R^8$ quadrupole floor supports a $\pi$-$\pi$-hold-$\pi$-$\pi$ interaction gate reaching fidelity 0.9967 at $R=2.0$ µm ($\Omega=160$ MHz, $t=0.1855$ µs), viable only for $R\lesssim2.2$ µm.
- **Closest prior:**
  1. `Vermersch2015` — Phys. Rev. A 91, 023411 — App. B ("Effects of the Quadrupole-Quadrupole interactions") + Tab. H5 + Fig. 12: computes $H_5=C_5/r^5$ for Rb $P_{3/2}$ (and $D_{3/2}$) with angular matrix $D_{22}$ and $C_5$ vs $n$; explicitly concludes "the quadrupole-quadrupole interactions are therefore negligible" relative to $C_6$ — it computes the C5 floor but dismisses it because it does not consider the $C_6$-zero geometry.
  2. `Walker2008` — Phys. Rev. A 77, 032723 — Appendix (quadrupole–quadrupole term): estimates the $R^{-5}$ term and finds it "normally much smaller" than $R^{-6}$.
  3. `Saffman2010` — Rev. Mod. Phys. 82, 2313 — Eq. (34) (the analytic interaction-gate error formula the report cross-checks against); `Saffman2016` — J. Phys. B 49, 202001 — §IV.B (the fundamental bound $E\ge2/(V\tau)$ used for the viability window).
- **Delta class:** new_result
- **Delta:** Vermersch2015 (App. B/Fig. 12) already computes the $C_5$ quadrupole coefficient for Rb $P_{3/2}$ but dismisses it as negligible against $C_6$; this report builds the $\pi$-$\pi$-hold-$\pi$-$\pi$ gate on the $C_5/C_8$ floor in the geometry where $C_6(\theta^*)=0$ and gives its fidelity (0.9967 at $R=2.0$ µm) — the coefficient is known, the gate-on-the-$C_6$-zero-floor is not.
- **Queries run:** "quadrupole quadrupole interaction Rydberg C5 gate" (returned Weber2017, no gate-on-quadrupole-floor prior); direct read of Vermersch2015 App. B and Walker2008 Appendix.
- **Wording required:** Sentence as-is, but credit the $C_5$ $P_{3/2}$ coefficient to Vermersch2015 App. B (Fig. 12, Tab. H5) — currently uncited for this purpose.

### C6: "orienting gate pairs at $\theta^*$ yields a 1.98$\times$ packing-density gain (robust 1.95--2.11$\times$ across $R\in[1.5,2.2]$~µm) relative to the S–S gate --- roughly doubling the atom count per unit area"
- **Neutral restatement:** Orienting compact $R=2.0$ µm interaction gates at $\theta^*=24.65^\circ$ yields a 2D packing density of $0.013911$ atoms/µm² vs. $0.007038$ for the S–S baseline — a $1.98\times$ gain (1.95–2.11 across $R\in[1.5,2.2]$ µm), exceeding the $1.35\times$ strong-blockade cap.
- **Closest prior:**
  1. `Vermersch2015` — Phys. Rev. A 91, 023411 — the anisotropy + magic-distance machinery (App. A/B, Fig. 6) — supplies the anisotropic interaction and the C5 floor but performs *no* packing-density optimization.
  2. `Evered2023` — Nature 622, 268–272 — [Methods] 53S blockade gates at 2 µm with $V/2\pi\approx450$ MHz and $\sim10$ kHz inter-site cross-talk — the isotropic S–S baseline and cross-talk model the report compares against.
  3. `Wadenpfuhl2025` — Phys. Rev. A 111, 062803 — the $C_6(\theta)$ angular zero the report exploits (Fig. 5), with the stated motivation "identify pair states with strong or vanishing angular dependency to match experimental requirements" — but for $P_{1/2}$ and without any gate/packing calculation.
- **Delta class:** new_result
- **Delta:** No prior computes a packing-density/atom-count gain from orienting Rydberg gates along a $C_6$ zero; the closest works provide the individual ingredients (Vermersch2015: anisotropy + C5 floor; Wadenpfuhl2025: the $C_6(\theta)$ zero; Evered2023: the S–S baseline), but the $1.98\times$ packing optimization is this report's own synthesis.
- **Queries run:** "anisotropic Rydberg interaction gate array density"; "Rydberg gate array density packing anisotropic blockade"; "magic distance Rydberg p state blockade" (all returned no packing-gain prior).
- **Wording required:** Sentence as-is.

## Queries that found nothing
- C6 (packing-density gain from anisotropic Rydberg gates): three queries above returned no paper computing a packing/atom-density gain from anisotropic Rydberg interactions; the closest hits (Vermersch2015, Evered2023, Wadenpfuhl2025) are adjacent ingredients, not the result itself. This is the one claim for which no directly overlapping prior exists after a genuine search.
- C5 (C5/C8 quadrupole gate): "quadrupole quadrupole interaction Rydberg C5 gate" returned no prior gate built on the quadrupole floor; the C5 *coefficient* prior is Vermersch2015 App. B (locator above).
- C1 (packing-gain law): "Rydberg blockade radius sixth root C6 packing density" and "Rydberg gate array density packing anisotropic blockade" returned no prior stating the two-axis packing-gain formula; the sixth-root scaling prior is Low2012/Saffman2010 (locators above).
