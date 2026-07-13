---
domain: quantum-chemistry
match: pyscf, dft, hartree, ccsd, molecular, basis set, openfermion, 量子化学, 分子
---

# Quantum chemistry — standard: pyscf (UNVERIFIED — not installed on VM)

| Tool | Likely frictions | Smoke test |
|---|---|---|
| pyscf | Coordinates default Angstrom not Bohr; `max_memory` in MB thrashes silently; pass `verbose=0` or SCF output floods agent context. | `python3 -c "from pyscf import gto,scf; e=scf.RHF(gto.M(atom='H 0 0 0; H 0 0 0.74',basis='sto-3g',verbose=0)).kernel(); assert abs(e+1.117)<0.01; print('ok')"` |
| openfermion | pyscf bridge is a separate package (`openfermionpyscf`); populate MolecularData integrals before `jordan_wigner()`. | `python3 -c "import openfermion; print(openfermion.jordan_wigner(openfermion.FermionOperator('0^ 0')))"` |
