# Backtest: do the survey mechanisms catch the defects in our own traces? (2026-09-24)

Question: of the 8 transplants proposed in `notes/survey-autoresearch-rsi-2026-09-24.md`, which would have caught real, ground-truth defects in the last seven runs? Method: `backtest-spec.md` (one read-only auditor per project, CATCH = fires mechanically with artifacts that existed at the time; MAYBE = needs an agent's judgment; hindsight doesn't count). Per-project reports: `bt-*.md` in this directory. Spot-checked by hand: y-magic Y1 (f-sum bound has units 1/E, should be deficit/a²), ba-qc D1 (report holds ρ_ii = 0.5625 at the lossy ¹F₃ intermediate and has no scattering term), y-tweezer D1 (`compose.py` drops every zero crossing within 5 nm of any line), and the harness bug below.

## 1. Headline defects: defects that reached the report or abstract

| project | defect | M1 anchor | M2 indep. | M3 receipts | M5 review | M6 memory | M7 invariants |
|---|---|---|---|---|---|---|---|
| 297nm | E5 measures return of \|gg⟩, not gate fidelity (no phase); ~10× underestimate reverses the headline flip | miss (anchor passes under the wrong observable) | – | miss | maybe | miss (the prior lesson *reinforced* D3) | maybe |
| 297nm | E2 "pure sin⁴θ, 10⁶ anisotropy" contradicted 56× by its own θ=0 diagonalization | – | – | – | – | – | – |
| 297nm | circular "Numerov reproduces D2 to 0.37 %" (it looks the value up) | – | **catch** | – | – | – | – |
| pp-vs-ss | SS baseline at 4.9 µm vs PP at 2 µm; matched gives 1.66× not 1.98× | miss | miss | miss | miss | miss | miss |
| pp-vs-ss | 0.9967 rests on an unverified 2 µm interaction; 0.13° equals the whole signal | miss | miss | miss | maybe | maybe | miss |
| ba-qc | intermediate-state scattering omitted, ~10⁴× the reported total error | maybe | – | miss | miss | catch *on paper* (rb87 project has the term) | miss (tool_review never ran) |
| ba-qc | lifetime model whose own frozen Rb/Sr check was REFUTED (24×) called "validated" | **catch** | – | – | – | catch on paper | – |
| y-tweezer | "no magic wavelength": 5 nm mask around 302 lines hides 97 % of 350–700 nm | miss | miss | miss | maybe (bg-review bug) | miss | miss (run-level script, not a tool) |
| y-tweezer | ellipticity checked at 3 wavelengths, claimed for 350–1600 nm | – | – | – | maybe | – | – |
| y-tweezer | 132 MHz trap light shift of the imaging line omitted; 0.9999 not established | – | – | – | maybe | – | – |
| y-magic | f-sum "upper bound" 1.75 a₀³ has wrong units (deficit/2a); correct 15.3 → headline unsupported | miss | – | miss | miss | miss | maybe (units check fires on `alpha_deficit`) |
| XUV | abstract's statistical σ omits the 93.6 % term | – | – | – | – | – | – |
| XUV | same-algebra legs sold as "两条独立路由" | – | **catch** (existing 1e-6 rule already sees it; nothing stops the prose) | – | – | – | – |

**~13 headline defects; mechanical catches: M2 ×2, M1 ×1, M6 ×2 on paper only. Everything else is maybe/miss.** The auditors reached the same verdict independently in 6 of 6 projects.

## 2. Process defects: where the mechanisms do work

- **M4, failure routing, catches in 6 of 7 projects.** In every one, an infra failure (glm 429, Anthropic 400 credit, DeepSeek 402, a missing openai-codex key, OpenAlex 429, reader 402) was turned into "skip + disclose": zero test files in ba-qc and pp-vs-ss E5–E7, and E3's headline tool shipped untested in XUV.
- **M5, per-experiment review, catches unreviewed experiments in 4 projects.** The root cause is a **harness bug**: `src/tools/spawn-agent.ts` returns from the background path (line ~536) before the auto-review loop (line ~573), so background-spawned experiments are never reviewed (y-tweezer E1–E4). The "requested analysis must map to a key" clause would deadlock (ba-qc "measure the lifetime"; pp-vs-ss with $1.4 left). Add "review newer than results.json" (y-magic r3 flipped the headline unreviewed).

## 3. False positives: cost of each mechanism

- **M1:** no reasonable published anchor for 3–5 of 7 experiments per project. It deadlocks legitimate "the anchor fails" results (y-magic, y-tweezer E2, XUV E3 vs Hahn2025).
- **M2's import-graph rule is wrong as specified.** Perturbative-vs-exact-diag legs legitimately share `pairinteraction` (297nm E2/E5, pp-vs-ss). The method-class check is the useful half.
- **M3:** every wrong number *had* a receipt. It would block 8–12 legitimate literature values per project (12 of 20 in XUV).
- **M7:** where the tool description carried the prediction or the wrong sign, the blind tests enforced the defect (297nm D4/D9, XUV D11). Bugs also live in run-level compose scripts that tool tests never see.

## 4. What the headline defects have in common (none of the survey mechanisms target it)

1. **Quantity identity and omitted dominant term**: 297 E5 (wrong observable), ba D1 (scattering), y-tweezer light shift, XUV σ, y-magic units. The number is computed correctly for the wrong thing.
2. **The project's own evidence contradicts the report**: ba D3 (own REFUTED check), 297 E2 (own diag 56×), pp-vs-ss D6 (own angle scan), y-tweezer ellipticity (3 points → full range).
3. **Unfair comparison / filtering artifact**: pp-vs-ss baseline, y-tweezer mask.

Reviewers (opus-4-6) and PI endorsed all of them; nobody's role *requires recomputing the quantity by another route*. Model attribution is confounded (deepseek-v4-pro authors nearly everything). Two of six auditors lean "scaffold > model", one says the data can't separate them.

**The strongest evidence in this backtest is the backtest itself.** A fresh Opus-5.5 auditor with read access to everything and licence to recompute found all of section 1, in ~10 min and ~200k tokens per project. Caveats: it was told to hunt for defects; it had the luxury of the finished run; its findings were only partly hand-verified (3 of ~13 checked by me, all held).

## 5. Implications

- Build now (cheap, measured): fix the background-review bug; M4 infra routing (retry/switch, never convert to disclose); M5 lite (every cited EID has a review newer than its results.json).
- Don't build as specified: M1 as a hard gate, M3, M2's import-graph rule, M8 prompt evolution (no stable fitness signal exists yet: the evaluators themselves miss the defects).
- New candidate, needs its own backtest before building: a **pre-finish adversarial auditor**, one strong-model agent in the shape of this backtest's auditor, run once before the report. It targets the three patterns in §4 (recompute the headline by another route, enumerate the dominant terms, diff the report against own refuted checks and own data). Validation: rerun it *blind* (no spec hints about known defects) on these 7 projects and count recall on the §1 table; also check whether claude-opus-5-class models refuse (see `spawn.ts` refusal notes).
