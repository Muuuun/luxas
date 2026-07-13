---
domain: qldpc-decoding
match: bposd, bp+osd, ldpc, qldpc, belief propagation, osd, decoder, bb code, bivariate bicycle, lifted product, gross code, 译码
verified: 2026-07-13
verified-on: vm
---

# qLDPC decoding — field standard: Roffe `ldpc` BP+OSD

| Tool | First-use frictions | Smoke test |
|---|---|---|
| ldpc 2.3.9 | (1) **v1→v2 rename**: `bposd_decoder` → `from ldpc import BpOsdDecoder`; kwargs `error_rate`/`error_channel`, `bp_method='ms'`, `osd_method='osd_cs'`, `osd_order`. Per-mechanism DEM priors go in via `error_channel=` (list of per-column probabilities) — don't decode with a flat error_rate when you have a DEM. (2) H as scipy-sparse/uint8; syndrome uint8; returns full-length error estimate — projecting onto logicals is your job. (3) **macOS OpenMP segfaults are env-fixable**: `OMP_NUM_THREADS=1` (or run on the Linux VM) — NOT a reason to drop the d=6/10/12 sweep. numpy-ABI pin history: re-verify after numpy bumps (current ldpc 2.3.9 + numpy 2.4.6 OK). | `python3 -c "from ldpc import BpOsdDecoder; from ldpc.codes import rep_code; import numpy as np; H=rep_code(5); d=BpOsdDecoder(H,error_rate=0.1,bp_method='ms',osd_method='osd_cs',osd_order=5); print(d.decode(np.zeros(H.shape[0],dtype=np.uint8)))"` |

Cost planning under job deadlines: OSD-CS order-10 on a ~n=1000 code is ~1–60 s/shot depending on p — measure ONE shot first, then size the sweep (resume-from-partial beats descoping shots by 10×). OSD-0 as a screen, OSD-10 for the headline points only.

## Known false rejections
- "ldpc on macOS produces OpenMP segfaults limiting reliability" → used to reject the d=6/10/12 sweep AND propagated untested into a second project (Yb-vs-Rb family). Fix was `OMP_NUM_THREADS=1` or Linux.
- "implementing BP+OSD requires the ldpc package and significant decoder engineering beyond scope" → the package IS the engineering; BpOsdDecoder is ~5 lines (qldpc lattice-surgery run later did exactly this).
