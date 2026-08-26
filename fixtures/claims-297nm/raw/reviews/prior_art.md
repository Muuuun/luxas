---
status: positioned
sources_md5: 28dee45c74335cf53a5f997b6747d9da
claims_audited: 4
known: 3
new_regime: 1
new_method: 0
new_result: 0
reconciliation: 0
---

## Summary

The report is a feasibility and error-budget assessment of single-photon 297 nm excitation of
$^{87}$Rb $5S_{1/2}\rightarrow nP_{3/2}$ (target $n\approx75$) as a route to neutral-atom gates. Against the
literature, three of its four headline "signatures" are already established and are re-derived here: (i) the
single-photon UV $\rightarrow nP_{3/2}$ route and its power-cheapness are demonstrated (Manthey2014 for Rb at
297 nm; Hankin2014 for Cs, including the explicit "reduce laser power" argument and the same 1 MHz/10 $\mu$m
operating point), and reviewed in Shi2022; (ii) the $\sin^4\theta$ angular anisotropy of the stretched
$nP_{3/2}$ pair and the resulting side-by-side geometry constraint are established by Glaetzle2014/Vermersch2014
(Vermersch's Eq. for $C_6(\theta)$ at $n=25$ is the "23.6$\times$" number the report reproduces) and by
Walker2008; (iii) the $k^2$ recoil scaling is Robicheaux2021, and the statement that single-photon $p$-orbital
excitation is motional-dephasing-limited is made explicitly in Shi2022. The one genuinely new piece is the
channel-sum error budget for the Rb 297 nm $n\approx75$ case: $99.89\%$ ceiling, recoil-dominated. That is
Pagano2022's Sr-88 323 nm model transplanted to a different species/wavelength/Rydberg orbital, with the dominant
channel flipping from Rydberg decay (Sr) to photon recoil (Rb, shorter $\lambda$) — a `new_regime` result. The
report does not cite Hankin2014 or Glaetzle2014, which are the two most important missing prior-art anchors.
The validation statements (D2 matrix element to 0.37%, Manthey Rabi to 12.5%, Low lifetime to 0.9%, Vermersch
$C_6$ to 1.8%, Pagano fidelities) are explicit reproductions of published benchmarks and are not audited as
novelty claims.

## Claims

### C1: "Single-photon excitation of $^{87}$Rb $5S_{1/2}\rightarrow nP_{3/2}$ at 297 nm is assessed as a power-cheap route to high-fidelity neutral-atom gates." (abstract; with "the stretched $nP_{3/2}\,|m_J|=3/2$ dipole yields $\Omega/\sqrt{P}=0.902\,\mathrm{MHz}/\sqrt{\mathrm{mW}}$, so $\approx1.2$ mW drives a $\mu$s $\pi$-pulse" and the conclusion "a power-cheap ($\approx1.2$ mW) gate at $n\approx75$")

- **Neutral restatement:** For $^{87}$Rb, a single 297 nm photon drives $5S_{1/2}\rightarrow nP_{3/2}$ with $\Omega/\sqrt P\approx0.9$ MHz/$\sqrt{\rm mW}$, so $\sim$1 mW gives a $\mu$s $\pi$-pulse at $n\approx75$ — a power-cheap excitation route.
- **Closest prior:**
  1. Manthey2014 (arXiv:1403.1761) — §"Electron-microscopy of a Rydberg excited BEC", Fig. 1(b): single-photon UV excitation of $^{87}$Rb $5S_{1/2}\rightarrow38P_{3/2}$ demonstrated (7 mW, 700 $\mu$m waist) with the UV source the report itself cites as "700 mW … $n=30$ to the ionization limit accessible." Same system (Rb) and same wavelength class (297 nm), so the route already exists.
  2. Hankin2014 (arXiv:1401.2191) — §"Single-photon excitation model": oscillator strength $f(6S\rightarrow84P_{3/2})=6\times10^{-8}$ vs $f(6S\rightarrow84P_{1/2})=2\times10^{-12}$, "This result favors exciting to $nP_{3/2}$ states in the interest of reducing laser power requirements," targeting exactly $\Omega/2\pi=1$ MHz at a 10 $\mu$m waist; §"Rydberg Blockade": blockade below 7 $\mu$m at 1 MHz, demonstrated. (Cs, not Rb.)
  3. Shi2022 (arXiv:2212.06427) — §"One-photon excitation" and §"Comparison between different schemes of Rydberg excitation": one-photon UV $\rightarrow$ $p$-orbital Rydberg excitation demonstrated (Hankin2014, Jau2015), with the power/Doppler tradeoffs spelled out.
- **Delta class:** known
- **Delta:** Manthey2014 already demonstrates 297 nm single-photon Rb $nP$ excitation (and mW-class power is trivially available at 700 mW), and Hankin2014 already establishes that direct $nP_{3/2}$ excitation is the power-cheap single-photon choice at the same 1 MHz/10 $\mu$m operating point; this report re-derives $\Omega/\sqrt P=0.902$ MHz/$\sqrt{\rm mW}$ at $n\approx75$ from the same known $5S\rightarrow nP$ dipole.
- **Queries run:** "single-photon Rydberg excitation rubidium 297 nm"; "rubidium Rydberg nP single-photon ultraviolet excitation 297"; "Two-atom Rydberg blockade direct 6S nP excitation"; "direct excitation nP Rydberg rubidium blockade single photon ultraviolet".
- **Wording required:** drop the unstated novelty framing and cite the demonstrations inline, e.g. "Single-photon 297 nm excitation of $^{87}$Rb $5S\rightarrow nP_{3/2}$, demonstrated by Manthey et al. [Manthey2014] and shown power-cheap for $nP_{3/2}$ by Hankin et al. [Hankin2014], is assessed here for its gate-fidelity ceiling." (Hankin2014 is missing from references.bib and must be added.)

### C2: "its pp van der Waals interaction is pure $\sin^4\theta$, vanishing at $\theta=0$ and maximal at $\theta=90^\circ$, which constrains the array to side-by-side geometry." (abstract; intro "the stretched-state interaction vanishes on-axis"; conclusion "contingent on side-by-side geometry ($\theta\approx90^\circ$)")

- **Neutral restatement:** The stretched $nP_{3/2}\,|m_J|=3/2$ pair interaction follows $C_6\propto\sin^4\theta$, vanishing end-to-end along the quantization axis and peaking side-by-side, forcing a $\theta\approx90^\circ$ array.
- **Closest prior:**
  1. Vermersch2014 (arXiv:1408.0662) — §"Anisotropic interactions for Rydberg atoms in p-states", Eq. (`eq:C6_n25`): $C_6(\theta)=(6.33\sin^4\theta-0.267\sin^2\theta+0.269)\,h\,\mathrm{MHz}\,\mu\mathrm{m}^6$ for Rb $|25P_{3/2},m_j=3/2\rangle$, with $C_6(\pi/2)=6.35$ vs $C_6(0)=0.269$ (ratio 23.6, the report's "23.6$\times$"); text (also §II.A): "$C_6(\theta)$ is dominated by a term proportional to $\sin^4\theta$… Interactions are therefore much stronger along the $x$ direction compared to the $z$ direction."
  2. Glaetzle2014 (PRX 4, 041037 (2014)) — the source Vermersch2014 cites for the $\sin^4\theta$ $nP_{3/2}$ result; the anisotropy is the basis of that paper's Rydberg spin-ice model.
  3. Walker2008 (PRA 77, 062712) — the $nP_{3/2}+nP_{3/2}$ angular structure and the Förster-zero sublevels that make degenerate $P$ manifolds poor blockade candidates (the caveat the report itself invokes).
- **Delta class:** known
- **Delta:** Vermersch2014 (via Glaetzle2014) already gives the $\sin^4\theta$ angular dependence, the on-axis suppression ($C_6(0)/C_6(\pi/2)=1/23.6$), and the in-plane (side-by-side) geometry for stretched Rb $nP_{3/2}$; this report re-states the same anisotropy as "pure" $\sin^4\theta$ in a field-free treatment at $n=40$–$75$ and reuses it as a gate-geometry constraint.
- **Queries run:** "van der Waals angular dependence nP Rydberg rubidium blockade anisotropy"; "Dynamical preparation of laser-excited anisotropic Rydberg crystals" (Vermersch2014, source read and grepped for $\sin^4\theta$/$C_6(\theta)$); "single-photon Rydberg excitation rubidium 297 nm".
- **Wording required:** keep the inline citation to Vermersch2014 (already present in the body) and demote "pure"/"vanishing" to the prior form, e.g. "its pp van der Waals interaction follows the $C_6\propto\sin^4\theta$ anisotropy established by Glaetzle et al./Vermersch et al. [Vermersch2014], near-vanishing at $\theta=0$… which constrains the array to side-by-side geometry." The field-free "fraction 1.0" refinement should be flagged as a re-derivation, not a discovery.

### C3: "A closed-form channel-sum error budget gives a $99.89\%$ fidelity ceiling at $T=5\,\mu$K and $\Omega/2\pi=10$ MHz, dominated by photon recoil ($3.9\times10^{-4}$) with Rydberg decay sub-dominant ($2.1\times10^{-4}$) owing to the $221.6\,\mu$s blackbody-limited lifetime of $75P_{3/2}$." (abstract; Sec. 4)

- **Neutral restatement:** A channel-sum error budget for the Rb 297 nm $75P_{3/2}$ gate gives $F=99.89\%$ at $T=5\,\mu$K, $\Omega/2\pi=10$ MHz, with photon recoil the dominant channel and Rydberg decay sub-dominant because of the long $75P_{3/2}$ lifetime.
- **Closest prior:**
  1. Pagano2022 (Phys. Rev. Research 4, 033019 / arXiv:2202.13849) — §"Error-budgeting for Strontium-88", Table 1 ($60\,^3S_1$, 323 nm, $\Omega_0/2\pi=10$ MHz, $C_6=-154$ GHz$\cdot\mu$m$^6$, $1/\gamma=50\,\mu$s), Eq. (`eqn:infidelity_decay`) $1-F_d=\tfrac34\bar T_r\gamma$, Eq. (`eqn:infidelity_recoil`) $1-F_r=\tfrac{15}{32}\frac{\hbar k^2}{2m}\omega_z\bar T_r^2\coth(\dots)$, and the error-budget table (recoil 0.008–0.011%): finds Bell fidelity 99.899% at 10 MHz and 99.973% at 40 MHz, with Rydberg decay the dominant channel. The report explicitly adopts and validates against this exact model and these exact numbers.
  2. Robicheaux2021 (PRA 103, 022424) — Eq. (`EqFid1`) and Eq. (828): $1-\mathcal F\propto K^2 k_B T/M$, the thermal recoil form the report says its coherent-state recoil term reduces to.
  3. Shi2022 (arXiv:2212.06427) — closing paragraph of §"Comparison between different schemes of Rydberg excitation": one-photon $p$-orbital excitation has "prevailing motional dephasing" whose elimination is "an open question" — i.e. the recoil/Doppler limitation is already flagged.
- **Delta class:** new_regime
- **Delta:** Pagano2022 gives the same closed-form channel-sum budget for a single-photon Sr-88 gate ($60\,^3S_1$, 323 nm, $\Omega_0/2\pi=10$ MHz) with Rydberg decay dominant and $F\approx99.9\%$; this report applies the same model to Rb $75P_{3/2}$ at 297 nm and finds photon recoil (not decay) dominant, giving $99.89\%$ — same result class and method, different species, wavelength, and Rydberg orbital.
- **Queries run:** "single-photon Rydberg gate P state fidelity"; "photon recoil limit Rydberg gate fidelity single-photon excitation"; "rubidium single-photon Rydberg nP state quantum gate recoil"; "single-photon Rydberg gate rubidium 75P error budget recoil limited"; "single-photon Rydberg excitation rubidium error budget fidelity". No Rb-297-nm-specific error budget exists; the Sr (Pagano2022) and general (Robicheaux2021) results are the closest.
- **Wording required:** sentence as-is is acceptable, provided the opening of Sec. 4 already states the model is "adapted" from Pagano2022 (it does). The title's "recoil-limited 99.9% gate" should be read as regime-specific; the 99.89% value is numerically the same as Pagano's Sr value at the same Rabi frequency, so the claim of novelty rests entirely on the recoil-vs-decay channel flip at 297 nm, not on the ceiling number itself. The $221.6\,\mu$s lifetime is a routine ARC computation benchmarked against Low2012, not an independent result.

### C4: "because recoil scales as $k^2$, the 297 nm floor is the largest among single-photon candidates and is therefore wavelength-specific." (abstract; conclusion "the recoil floor is wavelength-specific, not a universal single-photon limit")

- **Neutral restatement:** Photon-recoil infidelity scales as $k^2$, so the 297 nm (Rb) route has the largest recoil floor among the single-photon candidates (Cs 319 nm, Sr 323 nm); the recoil ceiling is wavelength-specific.
- **Closest prior:**
  1. Robicheaux2021 (PRA 103, 022424) — Eq. (`EqFid1`) / Eq. (828): $1-\mathcal F=K^2 k_B T_{\rm eff}/(2M)(\dots)$, i.e. infidelity $\propto K^2$ (photon kick squared) — the general $k^2$ scaling.
  2. Shi2022 (arXiv:2212.06427) — §"Comparison between different schemes of Rydberg excitation" (Third and closing points): "the Doppler dephasing in the ground-Rydberg transition is not removable in one-photon Rydberg excitations… the wavevector in the one-photon Rydberg excitation in Hankin2014 is 2.5 times larger than that of the two-photon transition… one may expect a strong Doppler dephasing"; "prevailing motional dephasing" is the open question for one-photon $p$-orbital excitation.
  3. Pagano2022 (PRResearch 4, 033019) — the recoil contribution for Sr at 323 nm (Table: 0.008–0.011%), providing the longer-wavelength comparison point.
- **Delta class:** known
- **Delta:** Robicheaux2021 establishes the $k^2$ recoil scaling and Shi2022 already identifies the large single-photon wavevector/motional dephasing as the defining limitation of one-photon $p$-orbital excitation; this report instantiates the known $k^2$ law at 297 nm and orders the candidate wavelengths {297, 319, 323} nm — a synthesis, not a new result.
- **Queries run:** "photon recoil limit Rydberg gate fidelity single-photon excitation"; "Shi Rydberg single-photon excitation P state quantum gate"; Robicheaux2021 source grepped for $K^2$/scaling.
- **Wording required:** keep the $k^2$ citation to Robicheaux2021 inline (already present in the body) and add Shi2022 for the "single-photon $P$-state excitation is motional-dephasing-limited" point; the comparative ordering among the three wavelengths is arithmetic on the $k^2$ law and should not be presented as a finding.

## Queries that found nothing

- For C3, a search specifically for a Rb-297-nm single-photon gate error budget / fidelity ceiling found no prior: the queries "single-photon Rydberg gate rubidium 75P error budget recoil limited", "rubidium single-photon Rydberg nP state quantum gate recoil", "single-photon Rydberg excitation rubidium error budget fidelity" returned no Rb-297-specific budget. The nearest results are the Sr budget (Pagano2022), the general recoil limit (Robicheaux2021), and the qualitative motional-dephasing statement (Shi2022). This is consistent with `new_regime` (not `new_result`), because the result class and method are both taken from Pagano2022.
