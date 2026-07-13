---
domain: atom-dynamics
match: qutip, master equation, lindblad, shuttling, transport, heating, motional, tweezer, sesolve, mesolve, pulser, 输运, 加热
verified: 2026-07-13
verified-on: vm
---

# Atom/trap dynamics — field standard: qutip (or bespoke split-step numpy)

| Tool | First-use frictions | Smoke test |
|---|---|---|
| qutip 5.0.4 | (1) **BROKEN ON VM as of 2026-07-13**: `import qutip` raises ImportError (`sph_harm` removed in scipy 1.18). Fix: `pip install -U qutip` (≥5.1) — do this FIRST, do not reroll Lindblad by hand because import failed. (2) v4→v5: `qutip.Options` removed → plain `options={...}` dicts; LLM priors are v4-shaped. (3) ħ=1, angular frequencies — the missing 2π between Hz and rad/s is the canonical bug. | `python3 -c "import qutip; r=qutip.sesolve(qutip.sigmax(),qutip.basis(2,0),[0,1.5707963]); assert abs(abs(r.states[-1].full()[1,0])-1)<1e-6; print('ok')"` |
| split-step TDSE (numpy/scipy) | For moving-trap heating: symmetrized split-step Fourier ~80 lines (in-repo precedent: SLM run E1 tdse_transport_solver.py, blind-tested). Verify against the coherent-state analytic model for a linear ramp before trusting either. | n/a |
