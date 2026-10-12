---
domain: solidworks
match: solidworks, sldworks, .sldprt, .sldasm
software: solidworks
bin: SLDWORKS
artifacts: .sldprt, .sldasm
---

# SOLIDWORKS — COM from Python (pywin32), inside a logged-on desktop session (UNVERIFIED draft)

**This build of the runner cannot start SOLIDWORKS.** It needs a process inside the logged-on desktop session, and `simrun` refuses: "this build has no desktop worker, so it cannot be started". This sheet is for whoever builds that worker. If your task needs SOLIDWORKS, say so in your return.

The route is out-of-process COM, `win32com.client.Dispatch("SldWorks.Application")`, against a full, licensed, **visible** SOLIDWORKS. Once a worker exists a job goes through the runner; the exact call is in the line above this sheet. Its shape:

    python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun run <job dir> --software solidworks -- <launcher> <args>

For a job longer than a minute or two use `start` (it returns at once), then `wait`; `wait` and `run` return within their `--timeout`. Print the numbers you will report from the fetched files in the same bash call.

| Tool | Likely frictions | Smoke test |
|---|---|---|
| pywin32 COM | (1) From a service or ssh session it is expected not to start (unverified; see Unknown 1); a forum report gives `80080005 Server execution failed`. (2) `Dispatch` "either creates a new SOLIDWORKS session or it attaches to an existing SOLIDWORKS session": if a person has one open, the script drives their documents and `ExitApp` closes them. (3) **Metres, radians, kilograms** in every call: 10 mm is `0.010`. (4) Stay visible: `SelectByID2` needs "an open and visible document", and a hidden Save As can fail with `swFileSaveAsNotSupported` (4096). (5) Under late binding a by-reference output is `VARIANT(pythoncom.VT_BYREF \| pythoncom.VT_I4, 0)`, read from `.value`; an object VBA passes as `Nothing` is `VARIANT(pythoncom.VT_DISPATCH, None)`. A method with no arguments may be an attribute there, with no parentheses (the wrapper that was read writes `model.EditRebuild3`); this sheet writes `()`: Unknown 6. (6) `NewDocument` needs the template's full path (`GetUserPreferenceStringValue(swDefaultTemplatePart)`) and returns nothing when it is wrong. The help gives no numbers for preference constants: resolve them by name from `swconst.tlb`. | new part from the default template, a 60 × 40 mm rectangle extruded 10 mm; `Extension.GetMassProperties2(1, status, False)[3] * 1e9` is 24000 (mm³) |

## What exit 0 does not tell you

- **Rebuild errors do not raise.** A feature call returns an object or nothing, `ForceRebuild3` returns a bool, and `Save3` succeeds with warning bit 1 (`swFileSaveWarning_RebuildError`). Before saving, call `Extension.GetWhatsWrong` and `GetErrorCode2` on each feature.
- **A failed selection is a False return** (`SelectByID2` matches names exactly and case-sensitively; a face picked by coordinates depends on the view), and the feature call after it returns nothing. Assert on both.
- **A cut can go the wrong way with no error**: "The default direction for cut operations is opposite the sketch normal." Check the volume after each feature.
- **An export can be of something else.** `SaveAs3` "Exports the entire model, unless faces or bodies are selected" (call `ClearSelection2(True)` first). An STL is moved into positive space unless `swSTLDontTranslateToPositive` is set, and its unit is a preference (`swExportStlUnits`) the file does not record.

## Verification: measure the saved file, not the script's report

No open-source reader of `.SLDPRT` geometry was found, so the check without SOLIDWORKS runs on a STEP or STL export. **Who writes the export matters**: the producing script's own can hold a selection or a stale file, unseen. It should come from a fixed script the harness owns. Units: the API is metric (m, m³, kg); CadQuery's STEP importer converts to mm by default; an STL carries none.

| Commitment | How to measure it from the file |
|---|---|
| it rebuilds without errors (needs SOLIDWORKS) | Fresh process: `OpenDoc6(path, 1, options, "", err, warn)` (part = 1, assembly = 2; options: silent = 1, read-only = 2; nothing is returned on failure), `ForceRebuild3(False)`, `Extension.GetWhatsWrong`. The order of its three outputs is not established (help: Features, ErrorCodes, Warnings), so also walk `FirstFeature` / `GetNextFeature` and read `GetErrorCode2` on each. Never save. |
| volume and mass (needs SOLIDWORKS) | `Extension.GetMassProperties2(Accuracy, Status, UseSelected)` returns `[CoMx, CoMy, CoMz, Volume, SurfaceArea, Mass, …]` in metric units: m³ × 1e9 = mm³. |
| volume, extents, number of solids (no SOLIDWORKS) | (Library calls read in summary.) STEP: `cq.importers.importStep(path)` returns a CadQuery Workplane; its bounding box has `xmin`, `xmax`, `xlen` and so on; the selector `"%CYLINDER"` picks hole and boss walls. STL: `m = trimesh.load(path)`; `m.is_watertight` first ("If the current mesh isn't watertight this is garbage"), then `m.volume`, `m.bounds`, `m.split()`. Curved faces are faceted, so state a tolerance. Not SOLIDWORKS' `GetPartBox`: the vendor calls its values approximate. |
| parts do not interfere | `asm.InterferenceDetectionManager`: `TreatCoincidenceAsInterference = False`, `GetInterferences()`, each `.Volume` in m³. Without SOLIDWORKS: intersect each pair of solids in the assembly's STEP. |

A STEP has no feature tree, dimensions or mates: whether a model is parametric can only be checked in SOLIDWORKS.

## Licence and seat

- An unactivated standalone licence makes SOLIDWORKS try to activate at start-up, and a perpetual licence must be reactivated "once a year" (a prompt with "Reactivate Now" and "Remind Me Later"): windows that nobody is there to click.
- A floating licence with no seat free opens a "Network License Usage" dialog; an unreachable server gives `Could not obtain a license for SOLIDWORKS. Cannot connect to license server.` To a script these are dialogs: the first COM call blocks or is rejected.
- Terms read: "Windows Home Editions and Windows To Go are not supported." No vendor statement was found on using a machine-activated licence from a remote or unattended session.
- One SOLIDWORKS per machine: a second start, or one after a crash, opens a dialog and waits for a click (reseller page). Record `swApp.GetProcessID()` and kill only that process.
- A person at the desktop is the session a script attaches to (friction 2), on the same licence.

## Unknown: find out at first contact

1. What `Dispatch` does from a session with no desktop: fail fast, hang, or attach to the desktop's instance.
2. Whether COM calls work while the console is locked.
3. `GetWhatsWrong` under pywin32: the help orders its outputs Features, ErrorCodes, Warnings; an open-source wrapper unpacks them otherwise and notes "error codes seem incorrect".
4. The UI language: plane and feature names follow it ("Front Plane" is the English one; recalled).
5. Recalled, not read: CadQuery's `Volume()` and `isValid()`, the OCP calls for a cylinder's axis and radius, pywin32's error tuples.
6. Whether a method with no arguments takes parentheses under late binding (recalled: adding `()` fails with `'bool' object is not callable`; early binding requires them). Pick one binding mode per script.

## Known false rejections

None recorded yet.
