---
domain: optics
match: slm, hologram, gerchberg, fourier optics, aod, acousto, interferomet, diffraction, 光镊, 全息, 光计算
---

# Optics / holography — candidates: LightPipes, slmsuite (UNVERIFIED)

Neither package is installed on the VM; rows below are from docs, untested here.

| Tool | Likely frictions | Smoke test |
|---|---|---|
| LightPipes | Unit constants from the package (`mm`,`um`,`nm`) — raw floats are meters (silent 1000×); FFT grid aliasing past `Begin(size,λ,N)` extent. | `python3 -c "from LightPipes import Begin,Fresnel,mm,nm; F=Begin(10*mm,633*nm,128); F=Fresnel(F,0.1); print('ok')"` |
| slmsuite | Simulation needs explicit SimulatedSLM + simulated camera; GS/WGS optimizers want cupy (CPU fallback slow, silent). | `python3 -c "import slmsuite; print(slmsuite.__version__)"` |

In-repo precedent: bespoke numpy FFT + coherent-state models (SLM-transport run) — acceptable when blind-tested against analytics.
