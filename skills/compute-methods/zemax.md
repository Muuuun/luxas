---
domain: zemax
match: zemax, opticstudio, zos-api, zospy, .zmx, .zos
software: zemax
bin: OpticStudio
artifacts: .zmx
---

# Ansys Zemax OpticStudio — ZOSPy in standalone mode, one Python process per job (UNVERIFIED draft)

No GUI: Python with **ZOSPy** (`import zospy as zp`). `zos.connect("standalone")` starts its own OpticStudio with no visible window; the vendor: "it still requires an active license". One job is one fresh process: connect once, work, save a `.zmx`, write the values you read back to a JSON file, `zos.disconnect()` in a `finally`. When the line above this sheet says RUNS ON, a job reaches OpticStudio through the runner with the call printed there (when it says FOUND, the program is on this machine: start `python` directly). The runner call's shape:

    python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun run <job dir> --software zemax -- <launcher> <args>

For an optimisation longer than a minute or two use `start` (it returns at once), then `wait`; `wait` and `run` return within their `--timeout`. Print the numbers you will report from the fetched files in the same bash call.

| Tool | Likely frictions | Smoke test |
|---|---|---|
| ZOSPy 2.2 standalone | (1) It finds OpticStudio through the *current user's* registry (`HKCU\Software\Zemax`, value `ZemaxRoot`); without it, `FileNotFoundError`. Bypass: `zp.ZOS(opticstudio_directory=r"<install directory>")`. (2) The licence is checked *after* an OpticStudio process exists: `ConnectionRefusedError: OpticStudio Licence is not valid for API, connection not established`. Nothing closes that process before `zos.disconnect()`, hence the `finally`. (3) Save `.zmx` (`.zos` is retired). `oss.save_as(path)` needs an absolute path (`Path("lens.zmx").resolve()`; the job directory is the working directory); nothing is on disk before it. Save before any layout export: a third party found a failed one blocks saving. (4) **One tool at a time**: opening a second "will fail silently and return `None`" (`AttributeError: 'NoneType' object has no attribute 'Algorithm'`). `Close()` every tool in a `finally`. (5) Surfaces count from 0 (the object), the image is `NumberOfSurfaces - 1`; wavelengths, fields and operands count from 1. | `smoke.py`: `zos = zp.ZOS()`; in a `try`: `oss = zos.connect("standalone"); oss.new(); r = oss.LDE.GetSurfaceAt(1); r.Radius = 50.0; print(bool(zos.Application.IsValidLicenseForAPI), r.Radius)`; in the `finally`: `zos.disconnect()`. Prints `True 50.0` |

## What exit 0 does not tell you

- **A write can "succeed" without changing the value** (a solve drives the cell, or the call failed quietly). A third-party harness: "A clean call is not proof of success. Trust the read-back value".
- **`oss.load(path)` discards the API's success flag.** Assert that `oss.SystemFile` is the file you asked for.
- **A spot result has no validity flag** (third party): an RMS comes back for a system whose rays fail. Trace rays and require `ErrorCode == 0 and vignetteCode == 0`.
- **The optimiser can lower the merit function by breaking the lens**: it "frequently compresses the glass thickness to near zero".

## Verification: measure the saved file, not the script's report

Measure the saved `.zmx`, not the builder's JSON; never save while checking. Rows 3–4 take the seat: `zos = zp.ZOS(); oss = zos.connect("standalone")` in a `try`, `zos.disconnect()` in the `finally`; operand types are `zp.constants.Editors.MFE.MeritOperandType.<NAME>`. Units: lens units are on the file's `UNIT` line; wavelengths are micrometres; the file stores curvature (1/R) where the editor shows radius. **Not established:** the sign of a radius (recalled: positive when the centre of curvature is on the +z side), that a row's glass is the medium *after* that surface (recalled), and the sign of `AXCL`.

| Commitment | How to measure it from the file |
|---|---|
| the prescription (no OpticStudio, no seat) | Parse the text. Decode by its first bytes: `FF FE` is UTF-16, `EF BB BF` is UTF-8 with BOM, otherwise ANSI. After each `SURF <n>` take the first token after `CURV` (curvature; `0.0` is a plane), `DISZ` (thickness; `INFINITY`), `GLAS` (glass; absent means air), `DIAM` (semi-diameter). Also `UNIT`, `ENPD` (entrance pupil diameter), `WAVM <n> <µm> <weight>` (24 slots are always written; unused ones repeat 0.55; `PWAV` names the primary). First tokens only: unused solve slots hold stale values. Seen on two files, not vendor-documented. |
| focal length and axial colour (plain Python) | Paraxial trace per wavelength from that prescription, starting y = 1, u = 0. At each surface n'u' = nu − y(n' − n)c, then y ← y + u't. EFL = −y₀/u'(last); back focal distance BFD = −y(last)/u'(last); axial colour = BFD(λ₁) − BFD(λ₂). For spherical `STANDARD` surfaces, object at infinity. Spot size needs an exact trace, also plain Python: intersect each ray with each sphere, refract by Snell's law in vector form, take the RMS radius of the image-plane hits about their centroid. Indices (no source off the host was found): the `INDX` operand in row 4's session (its meaning and columns are recalled), or the `CD` line of the catalogue's `.agf` file there (dispersion coefficients; which formula a number means is recalled). First reproduce the catalogue's n_d to 1e-5; coefficients from memory must pass the same test. |
| the same file, re-opened (takes the seat) | `oss.load(abs_path)`, then assert `Path(oss.SystemFile).resolve() == abs_path`: the load discards the API's success flag, and without this nothing below was measured on this file. Per surface `Radius`, `Thickness`, `Material` and the `.Solve` of `RadiusCell`, `ThicknessCell`, `MaterialCell`: report every solve that is not `Fixed`. Find wavelengths by value (`SystemData.Wavelengths.GetWavelength(i).Wavelength`), not by assumed order. |
| operand values | `MFE.GetOperandValue(type, …)` takes eight values after the type. Print the operand's cell headers first (`row.GetOperandCell(MeritColumn.Param1).Header` …): which column is Wave1 or Wave2 comes from a third-party table. `AXCL` is "the image separation between the two wavelengths defined by Wave1 and Wave2" (its unit: Unknown 3): assert on its absolute value until the plain-Python number has fixed the sign. RMS spot about the centroid, lens units: `GetOperandValue(RSCE, rings, wave, Hx, Hy, 0, 0, 0, 0)`; it "neglects ray vignetting". Before trusting an RMS, trace the marginal rays (`zp.tools.BatchRayTraceNormUnpol(…).run(oss).data`) and require `ErrorCode == 0 and vignetteCode == 0`. The spot *analysis* (`SpotData.GetRMSSpotSizeFor(field, wave)`) is in **micrometres** according to two third-party projects, and agrees to a few per cent, not exactly. |

## Licence and seat

- The API needs an edition that permits it (Professional, Premium, Enterprise); others give `License is not valid for ZOSAPI use`.
- No vendor page on licence terms could be opened: whether remote or unattended use is permitted is **not established**; the licence holder decides.
- The seat is held by the `OpticStudio.exe` the connection started. **A killed script leaves it holding the seat**, and the next connection hangs or reports a licence error. Stop a job with `simrun cancel`, never by killing OpticStudio by name; cancel ends the script's process tree, and whether that takes OpticStudio.exe with it is Unknown 5.
- A person with OpticStudio open at the desktop is an instance on the same licence, invisible to the runner's seat lock. Too many instances: the message above, or `License Check Failed`.

## Unknown: find out at first contact

1. Whether standalone mode works at all from a session with no desktop. No source says.
2. Whether this seat gives `IsValidLicenseForAPI == True` in standalone mode (one project on 2025 R2.02 Enterprise reports false, unexplained).
3. Operand columns (`AXCL`: Wave1, Wave2, Zone; `EFFL`: which one is the wavelength) come from a third-party table or recall, as does `AXCL` being in lens units: print the cell headers first.
4. Which wavelength index `GetRMSSpotSizeFor` expects (0 reportedly means all).
5. Whether `simrun cancel` or the time limit ends the OpticStudio.exe the script started. If the next connection hangs or reports a licence error, say so in your return: the operator has to end it.

## Known false rejections

None recorded yet.
