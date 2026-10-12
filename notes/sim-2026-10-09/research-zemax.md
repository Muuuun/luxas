# Driving Ansys Zemax OpticStudio from scripts, no GUI, over OpenSSH

Research date: 2026-10-09. Nothing here was run against OpticStudio. Every code block that touches
OpticStudio is **unverified until tried on the Windows machine**.

Provenance tags used throughout:

- **[READ url]** — I read this on the page / in the file during this session.
- **[READ-SRC repo:path]** — I read the source file itself (fetched with `gh api`, so the text is exact, not a model summary).
- **[SNIPPET url]** — only a search-engine summary of that page was seen; the page itself returned 403 or was not opened.
- **[RECALLED]** — from memory, not confirmed on any page this session.
- **[INFERRED]** — my conclusion from read facts; the reasoning is given.
- **[MEASURED-BY-3P]** — a third party reports having measured it on their install; I read their report.

Pages I could **not** open (HTTP 403 for every `optics.ansys.com/hc/...` and `support.zemax.com/hc/...` article,
and `web.archive.org` is blocked from here): the Ansys knowledge-base articles "ZOS-API.NET: An Overview",
"Getting started with Python", "Required OpticStudio version and language for using ZOS-API", the licensing
articles, and the in-product Help file (operand definitions). Everything that depends on them is marked
[SNIPPET] or [RECALLED].

---

## 0. Recommended route, in one paragraph

Run **Windows Python + ZOSPy 2.2.0 in standalone mode** (`zos.connect("standalone")`, which calls
`ZOSAPI_Connection.CreateNewApplication()`), one job at a time, each job a fresh Python process that
connects once, does its work, saves a **`.zmx`** with an absolute path, writes a JSON of read-back values,
and exits. The runner must treat the OpticStudio seat as a single lock, record the `OpticStudio.exe` PID the
job spawned, and reap that PID if the job dies. Whether this works from an OpenSSH session (Windows session 0,
no desktop) is **not established by any source** and is the first thing to test; the fallback is to launch the
same script through a scheduled task that runs in the logged-on user's interactive session.

The three facts most likely to bite:

1. **`IsValidLicenseForAPI` is the gate, and it can be false on an edition that should allow the API.**
   One 2026 project on 2025 R2.02 *Enterprise* reports standalone creation succeeding but
   `IsValidLicenseForAPI == False` (extension mode worked on the same seat); another on 2025 R1 *Premium*
   reports standalone working. Nobody explains the difference.
2. **A killed script leaves a headless `OpticStudio.exe` holding the seat**, and the next
   `CreateNewApplication()` then hangs or reports a licence error. Reap by tracked PID, never by image name.
3. **`.zos` is dead and ZMX text is not ASCII by default.** From 2025 R1 on, files can only be saved as
   `.zmx`; the vendor's own Example 01 still saves `.zos`. ZMX encoding is a preference (ANSI or Unicode);
   files in the wild are UTF-16-LE or UTF-8-with-BOM. A checker that opens the file as plain UTF-8 fails.

---

## 1. Connection modes

### 1.1 What the vendor documents

| Mode | API entry point | Needs a running GUI? | `Application.Mode` value | `PrimarySystem` is |
|---|---|---|---|---|
| Standalone application | `ZOSAPI_Connection.CreateNewApplication()` | No. Launches a new instance | `Server` | "initially an empty sequential system" |
| Interactive Extension | `ZOSAPI_Connection.ConnectAsExtension(int zemaxInstance)` | Yes, GUI open and *Programming > Interactive Extension* clicked | `Plugin` | "the live optical system" |
| User Extension / User Analysis / User Operand | `ZOSAPI_Connection.ConnectToApplication()` | Yes — "will only succeed when the client application was launched by Optic Studio" | `Plugin` / `UserAnalysis` / `UserAnalysisSettings` / `Operand` | "a copy of the optical system" (for all modes other than Server/Plugin) |

Sources, all read:

- `CreateNewApplication()`: "Attempts to launch a new instance of Optic Studio in 'headless' mode. Note that although the Optic Studio window will not be visible, it still requires an active license." **[READ https://developer.synopsys.com/docs/zos-api-interface-2024-r2/class_z_o_s_a_p_i_1_1_z_o_s_a_p_i___connection.xhtml]** (developer.ansys.com now 301-redirects to developer.synopsys.com.)
- `ConnectToApplication()`: "Attempts to connect to Optic Studio. This will only succeed when the client application was launched by Optic Studio." Same page.
- `ConnectAsExtension(int zemaxInstance)`: "Connects to an existing instance of OpticStudio in extension mode." 0 = any available instance. Same page.
- `ConnectionTimeoutSeconds`: "Gets or sets the connection timeout (seconds). This is only used when launching a new OpticStudio instance, with CreateNewApplication." Same page.
- `PreferencesFile`: controls which file specifies OpticStudio preferences for standalone applications; without it settings load from `OpticStudio.CFG` but do not persist between sessions. Same page.
- `FormattingCulture`: culture used converting numbers to/from strings; must be set before `CreateNewApplication`. Same page.
- `PrimarySystem` wording per mode, `CloseApplication` ("Shut down the Optic Studio process. Note - this method only applies when running in standalone mode. Any attempt to call API members after this call successfully executes will fail."), `InitializationErrorCode` ("should only have a value when using IZOSAPI_Connection.CreateNewApplication, and LicenseStatus is one of the error values"), `OpticStudioInstance` (instance number of the running process): **[READ https://developer.synopsys.com/docs/zemax-opticstudio-zos-api-2026-r1/reference/interface_z_o_s_a_p_i_1_1_i_z_o_s_a_p_i___application.md]** and the 2024 R2 SP02 equivalent.
- `ZOSAPI_Mode` enum members `Server, Operand, Plugin, UserAnalysis, UserAnalysisSettings`: **[READ-SRC MREYE-LUMC/ZOSPy:zospy/api/stubs/_ZOSAPI_constants/__init__.pyi]** (stubs are auto-generated from the ZOS-API assemblies).
- "In standalone application mode, the ZOS-API launches an entirely new instance of OpticStudio … effectively being run as a service, with no user interface" **[SNIPPET optics.ansys.com/hc/en-us/articles/42661773562899]**.
- Only one `IZOSAPI_Application` per process: "you can only have one 'IZOSAPI_Application' at a time. You will need to close the previous application in one mode in order to open it." (Zemax staff) **[READ https://community.zemax.com/got-a-question-7/zos-api-can-i-run-standalone-and-interactive-extension-at-the-same-time-880]**.
- A second `ZOSAPI_Connection()` in the same process silently returns the existing connection **[READ https://zospy.readthedocs.io/en/latest/user_guide/getting_started/faq.html]**.

Interactive Extension specifics (relevant only as a fallback):

- "Each *Interactive Extension* click permits exactly one `ConnectAsExtension`" and then stops listening; closing the dialog drops the link **[READ-SRC webworn/zemax-mcp-server:README.md]** [MEASURED-BY-3P on 2025 R2.02].
- For ZOSPy tests in extension mode: "first open OpticStudio, enable the Interactive Extension mode, and uncheck 'Auto Close on Disconnect'" **[READ-SRC MREYE-LUMC/ZOSPy:tests/README.md]**.
- This mode cannot be armed without a human (or GUI automation) clicking the ribbon button, so it does not meet "no GUI interaction". **[INFERRED]** from the two items above.

### 1.2 Which licence editions permit API use

What is established:

- Legacy Zemax editions: "Please ensure you have either a Professional or Premium OpticStudio License (a requirement for using the API)." **[READ https://community.zemax.com/got-a-question-7/api-can-t-connect-to-opticstudio-license-error-933]** — i.e. legacy **Standard** edition does not permit the API.
- Ansys-era editions: the product capabilities table lists "Automation API: X X X" for Professional, Premium and Enterprise **[READ https://ansys.synopsys.com/products/optics/ansys-zemax-opticstudio]** (as rendered through the fetch tool; I did not see the raw table).
- A PADT capabilities sheet (2023-07) lists "Programmable interface (ZOS-API)" under "Programming Interface" with columns 1/2/3 = Pro / Premium / Enterprise; the tick glyphs did not survive text extraction, so the per-edition marks are not confirmed from this PDF **[READ https://www.padtinc.com/simulation/wp-content/uploads/2023/07/Ansys_Zemax_Capabilities_2023_07-PADT.pdf via pdftotext]**.
- Student licence: reported "LicenseException: License is not valid for ZOSAPI use" **[READ https://community.zemax.com/zos-api-12/licenseexception-license-is-not-valid-for-zosapi-use-1103]**.
- `LicenseStatusType` enum members: `Unknown, KeyNotWorking, NewLicenseNeeded, StandardEdition, ProfessionalEdition, PremiumEdition, TooManyInstances, NotAuthorized, KeyNotFound, KeyExpired, Timeout, InstanceConflict, OpticsViewer, OpticStudioHPCEdition, EnterpriseEdition, StudentEdition` **[READ-SRC ZOSPy stubs]**. `LicenseStatus` "displays the license edition if successful, or an error code if unsuccessful" [READ 2026 R1 docs].

What contradicts the simple picture:

- "Standalone/headless was **not** available on this license despite the Enterprise edition — `CreateNewApplication()` succeeds but `IsValidLicenseForAPI` is false. Use extension mode." OpticStudio 2025 R2.02 Enterprise **[READ-SRC webworn/zemax-mcp-server:README.md]** [MEASURED-BY-3P]. No cause given. Possible causes I can think of — the GUI was already open on the same seat, or the licence increment lacks a feature — are **guesses**.
- "Developed against 2025 R1 (25.1.0, Premium) … Access is gated at first engine open on `IsValidLicenseForAPI`", standalone used throughout **[READ-SRC chuang44-tiff/optivibe-mcp:README.md]** [MEASURED-BY-3P].
- A viewer / design-only seat "can connect but fails the API license check" **[READ-SRC chuang44-tiff/optivibe-mcp:.claude/skills/zos-api-debug/SKILL.md]**.

Ansys licensing versus legacy softkey / USB key: **not established**. The only relevant read facts:

- With both Ansys and legacy network licences on a site, "when I use the ZOS Api and all Ansys Licenses are currently used, the ZOS Api throws the LicenseException, although there are free Legacy Licenses" — unanswered **[READ https://community.zemax.com/zos-api-12/zos-api-legacy-ansys-4593]**.
- 2024 R1 added "Shared Web Licensing" and Enterprise-only "Elastic Licensing" **[READ https://community.zemax.com/opticstudio-release-notes-71/ansys-zemax-opticstudio-2024-r1-release-notes-4877]**.
- Which licence a headless instance picks when several are configured, and where that choice is stored (per user or per machine), I could not find.

### 1.3 Python access through raw pythonnet — the vendor boilerplate

The official template **[READ-SRC ansys/lib-zemax-programming:examples/templates/python_standalone.py]** (Copyright 2026 ANSYS; the same class appears in the 2024 R2 docs Example 01) was read in full. It is not reproduced here: read it at the source. In order, `PythonStandaloneApplication.__init__(self, path=None)` does this:

1. Reads the value `ZemaxRoot` of the registry key `HKEY_CURRENT_USER\Software\Zemax` (`winreg`) and adds a reference to `ZOS-API\Libraries\ZOSAPI_NetHelper.dll` below that directory (`clr.AddReference`), then imports `ZOSAPI_NetHelper`.
2. Calls `ZOSAPI_NetHelper.ZOSAPI_Initializer.Initialize()`, or `Initialize(path)` when a path was given. If that returns false it raises `InitializationException("Unable to locate Zemax OpticStudio.  Try using a hard-coded path.")`.
3. Takes the install directory from `ZOSAPI_Initializer.GetZemaxDirectory()`, adds references to `ZOSAPI.dll` and `ZOSAPI_Interfaces.dll` there, and imports `ZOSAPI`.
4. Creates `ZOSAPI.ZOSAPI_Connection()`; `None` raises `ConnectionException("Unable to initialize .NET connection to ZOSAPI")`.
5. Calls `TheConnection.CreateNewApplication()`; `None` raises `InitializationException("Unable to acquire ZOSAPI application")`.
6. Tests `TheApplication.IsValidLicenseForAPI`; `False` raises `LicenseException("License is not valid for ZOSAPI use")`.
7. Takes `TheApplication.PrimarySystem`; `None` raises `SystemNotPresentException("Unable to acquire Primary system")`.

`__del__` calls `TheApplication.CloseApplication()` and drops the connection. The four exception classes are nested in the class.

Facts that follow from the template:

- The lookup key is **`HKEY_CURRENT_USER\Software\Zemax`, value `ZemaxRoot`**, and it points to the per-user Zemax *data* folder (default `C:\Users\<user>\Documents\Zemax`), where `ZOS-API\Libraries\ZOSAPI_NetHelper.dll` lives — not to the program folder. [READ-SRC, plus webworn's connection.py error text "Set the ZEMAX_ROOT env var to your Zemax data folder (e.g. C:\Users\<you>\Documents\Zemax)" READ-SRC]
- The exact exception strings an agent will see with the vendor boilerplate: `"Unable to locate Zemax OpticStudio.  Try using a hard-coded path."`, `"Unable to initialize .NET connection to ZOSAPI"`, `"Unable to acquire ZOSAPI application"`, `"License is not valid for ZOSAPI use"`, `"Unable to acquire Primary system"`.
- The template's install comment: `python -m pip install pythonnet`, "Ensure you are running a Python version compatible with PythonNET. Check the article 'ZOS-API using Python.NET' or 'Getting started with Python' in our knowledge base". No versions stated in the file.
- The Ansys example repo declares `requires-python = ">=3.9"`, `pythonnet>=3.0` **[READ-SRC ansys/lib-zemax-programming:pyproject.toml]**, and "The ZOS-API is backward compatible so most examples should work on any version of OpticStudio" [READ-SRC README.md].
- Older vendor guidance was Python 3.4–3.8 with pythonnet 2.5 **[READ https://community.zemax.com/zos-api-12/zos-api-not-compatible-with-modern-versions-of-python-and-pythonnet-3919]**.
- ZOS-API assemblies target .NET Framework; one project sets `os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")` **before** `import clr` **[READ-SRC chuang44-tiff/optivibe-mcp:packages/optivibe-harness/src/optivibe_harness/_bootstrap.py]**. The C# MCP server lists ".NET Framework 4.8 (included with Windows 10/11)" as prerequisite **[READ-SRC jaruiz6363/OpticStudioMCPServer:README.md]**.

### 1.4 ZOSPy (MREYE-LUMC/ZOSPy)

Versions, all read from the repository on 2026-10-09:

- Latest release **v2.2.0, 2026-09-21**; previous v2.1.5 (2026-02-13). [READ via `gh api repos/MREYE-LUMC/ZOSPy/releases`]
- `requires-python = ">=3.10,<3.15"`; dependencies `pythonnet >=3.1.0,<4`, `lark ~=1.2.0`, `pandas`, `pydantic >=2.4.0`, `numpy`, `semver >=3.0.0,<4`. [READ-SRC pyproject.toml; PyPI JSON agrees]
- pythonnet on PyPI: 3.1.0 (2026-05-23, Python >=3.10,<3.15), 3.2.1 (2026-10-08, **Python >=3.11**,<3.16). So on Python 3.10 pip must pick pythonnet 3.1.0. [READ pypi.org/pypi/pythonnet/json]
- Tested OpticStudio versions: **25.1.1, 24.2.2, 24.1.3, 24.1.0**, all "No known problems"; reference version "OpticStudio 25 R1.01"; "Older versions of OpticStudio are not tested, but they will likely work with ZOSPy." [READ-SRC docs/compatibility_table.md]. 2025 R2 and 2026 R1 are **not** in the table; issue #228 shows a user on 25.2.02 with standalone mode working apart from a report parser bug [READ github issue #228].
- Install: `pip install zospy` or `conda install conda-forge::zospy`. [READ-SRC README.md]
- "it is not maintained formally by Zemax" (forum moderator) **[READ community thread 3919]**.

Connect call and what it does **[READ-SRC zospy/zpcore.py]**:

```python
import zospy as zp
zos = zp.ZOS()                      # or zp.ZOS(opticstudio_directory=r"C:\Program Files\Ansys Zemax OpticStudio 2025 R2.02")
oss = zos.connect("standalone")     # default mode is "standalone"
```

- `ZOS.__init__(*, preload=False, zosapi_nethelper=None, opticstudio_directory=None)`. With neither argument it reads `HKCU\Software\Zemax\ZemaxRoot` (`get_zos_root()` in `zospy/api/apisupport.py`) and raises `FileNotFoundError` if the key or value is missing. With `opticstudio_directory` it **skips the registry and the NetHelper entirely** and loads `ZOSAPI_Interfaces.dll` / `ZOSAPI.dll` from that directory (`FileNotFoundError(f"Cannot locate {dll}.dll in {zos_dir}")` otherwise). "You need to specify the path to the OpticStudio directory, not the path to the executable itself." [READ-SRC docs/user_guide/usage/connection.md]
- `connect()` → `self.Connection.CreateNewApplication()`; then `if not self.Application.IsValidLicenseForAPI: raise ConnectionRefusedError("OpticStudio Licence is not valid for API, connection not established")`. If a connection is already alive: `RuntimeError("Only one Zemax application can exist within runtime")`.
- After connecting it calls `Application.BeginMessageLogging()`; `zos.retrieve_logs()` returns `Application.RetrieveLogMessages()`.
- `zos.disconnect()` → `Application.CloseApplication()`. A `weakref.finalize` does the same at interpreter exit ("At the end of a script, it is not necessary to disconnect; this is handled automatically when Python terminates" [READ ZOSPy FAQ]). This does **not** run if the Python process is killed. [INFERRED]
- `ZOS` is a singleton; a second `zp.ZOS()` returns the same object with `UserWarning: Only a single instance of ZOS can exist at any time. Returning existing instance.`
- `oss.new(saveifneeded=False)`, `oss.load(filepath, saveifneeded=False)`, `oss.save_as(filepath)` ("a partial path or relative path does not work"), `oss.save()`. Note `oss.load()` calls `self._System.LoadFile(filepath, saveifneeded)` and **discards its boolean return**. [READ-SRC]
- `zos.create_new_system()` (standalone only) returns a second `OpticStudioSystem` inside the same instance — one licence, several systems.
- `zos.version` → `semver.Version(ZOSMajorVersion, ZOSMinorVersion, ZOSSPVersion)`.
- ZOSPy registers pythonnet codecs that auto-downcast `IAS_`, `ISurface`, `ISystemTool` etc.; this is its fix for the pythonnet-3 interface problem (see §6). [READ-SRC zospy/api/codecs.py]
- On import ZOSPy calls `config.set_decimal_point_and_thousands_separator()` (locale handling). [READ-SRC zospy/__init__.py]

### 1.5 Minimal script: build a cemented doublet, F/d/C, read EFFL, save

Composed by me from API members that were each read in vendor examples, ZOSPy source or the ZOS-API stubs.
**Never executed.** Lines whose member names are only recalled are flagged.

```python
# build_doublet.py  —  python build_doublet.py C:\jobs\j1\doublet.zmx C:\jobs\j1\build.json
import json, sys
from pathlib import Path
import zospy as zp

out_zmx = Path(sys.argv[1]).resolve()       # SaveAs needs an absolute path
out_json = Path(sys.argv[2]).resolve()

zos = zp.ZOS()                              # add opticstudio_directory=... if the HKCU key is missing
oss = zos.connect("standalone")
try:
    app = zos.Application
    info = {"license": str(app.LicenseStatus), "mode": str(app.Mode),
            "version": str(zos.version)}     # not app.SerialCode: a licence serial does not belong next to results

    oss.new()                               # empty sequential system: 0 = OBJ, 1 = STO, 2 = IMA   [RECALLED layout;
                                            # consistent with vendor Example 01 and the ZOSPy README example]
    sd = oss.SystemData
    sd.MaterialCatalogs.AddCatalog("SCHOTT")                                   # vendor Example 01
    sd.Aperture.ApertureType = zp.constants.SystemData.ZemaxApertureType.EntrancePupilDiameter   # vendor Example 15
    sd.Aperture.ApertureValue = 20.0
    sd.Wavelengths.SelectWavelengthPreset(zp.constants.SystemData.WavelengthPreset.FdC_Visible)  # vendor Example 15
    # do NOT assume which index is F, d, C or which is primary — read them back:
    waves = {i: (sd.Wavelengths.GetWavelength(i).Wavelength, bool(sd.Wavelengths.GetWavelength(i).IsPrimary))
             for i in range(1, sd.Wavelengths.NumberOfWavelengths + 1)}
    # field 1 exists by default at (0, 0); nothing to add for an on-axis design

    lde = oss.LDE
    s1 = lde.GetSurfaceAt(1)                # stop = crown front
    s2 = lde.InsertNewSurfaceAt(2)          # cemented interface
    s3 = lde.InsertNewSurfaceAt(3)          # flint back
    s1.Radius, s1.Thickness, s1.Material = 61.47, 6.0, "N-BK7"     # numbers are placeholders
    s2.Radius, s2.Thickness, s2.Material = -44.64, 2.5, "N-SF5"
    s3.Radius, s3.Thickness = -129.94, 95.0
    s1.Comment, s2.Comment, s3.Comment = "crown front (STO)", "cemented", "flint back"

    # put the image plane at best focus
    qf = oss.Tools.OpenQuickFocus()                                              # vendor Example 01
    qf.Criterion = zp.constants.Tools.General.QuickFocusCriterion.SpotSizeRadial
    qf.UseCentroid = True
    qf.RunAndWaitForCompletion()
    qf.Close()                                                                   # ALWAYS close a tool

    MOT = zp.constants.Editors.MFE.MeritOperandType
    d = next(i for i, (w, _) in waves.items() if abs(w - 0.5876) < 1e-3)
    efl = oss.MFE.GetOperandValue(MOT.EFFL, 0, d, 0, 0, 0, 0, 0, 0)              # arg order: see §5.3
    first_order = tuple(lde.GetFirstOrderData())                                 # (EFL, pWFN, rWFN, pImgH, pMag) or with a leading element — check length

    oss.save_as(out_zmx)                    # .zmx, not .zos (see §4)
    info.update(waves={str(k): v for k, v in waves.items()}, effl=efl, first_order=first_order,
                n_surfaces=lde.NumberOfSurfaces, system_file=oss.SystemFile, saved=out_zmx.exists())
    out_json.write_text(json.dumps(info, indent=2))
finally:
    zos.disconnect()                        # CloseApplication(); the OpticStudio.exe PID exits ~1.5 s later (§3)
```

Raw-pythonnet equivalent: replace the first block with the vendor `PythonStandaloneApplication` class and use
`ZOSAPI.SystemData.ZemaxApertureType.EntrancePupilDiameter`, `ZOSAPI.SystemData.WavelengthPreset.FdC_Visible`,
`ZOSAPI.Editors.MFE.MeritOperandType.EFFL`, `TheSystem.New(False)`, `TheSystem.SaveAs(path)`. The vendor
examples that show these exact calls: Example 01 (new file, `AddCatalog('SCHOTT')`, `ApertureValue`,
`AddField(0, 5.0, 1.0)`, `SelectWavelengthPreset`, `InsertNewSurfaceAt`, `Radius/Thickness/Material/Comment`,
F-number solve, QuickFocus, `Save`) **[READ https://developer.synopsys.com/docs/zos-api-interface-2024-r2/page_ex01_py.xhtml]**
and Example 15 (`ApertureType`, `FdC_Visible`, `SetFieldType`, variables, wizard, local/global/hammer)
**[READ-SRC ansys/lib-zemax-programming:examples/python/PythonStandalone_15_Seq_Optimization.py]**.

---

## 2. Standalone mode from an OpenSSH session with no interactive desktop

**No source I could reach says whether it works.** I searched the Zemax community, ZOSPy issues (queries: ssh,
headless, service, task scheduler, remote, hang, timeout — no relevant hits), the Ansys repo and five
agent/MCP projects. Nobody reports running ZOS-API standalone under sshd, a Windows service, a scheduled task
without logon, or CI. ZOSPy's own CI builds and lints on `ubuntu-latest` only; the OpticStudio tests are run by
hand [READ-SRC .github/workflows/ci.yml]. The Ansys example tests are likewise local pytest runs
[READ-SRC ansys/lib-zemax-programming:tests/python/run_test.py].

What is established and bears on it:

| Fact | Source | Consequence |
|---|---|---|
| Windows OpenSSH server runs commands in **Session 0**, which has no interactive desktop; "window tools return empty results there" | [READ https://cua.ai/docs/how-to-guides/driver/windows-ssh] | Anything in OpticStudio that needs a window station/desktop may fail or hang. |
| Vendor calls standalone "headless" and says the window "will not be visible" | [READ ZOS-API docs, §1.1] | The process is still the GUI executable `OpticStudio.exe` in "Server" mode ([READ-SRC optivibe process_reaper.py: "A cold CreateNewApplication() spawns EXACTLY ONE OpticStudio.exe (the headless Server-mode engine)"]). "Not visible" is not the same as "needs no desktop". |
| Both the vendor boilerplate and ZOSPy default discovery read **HKCU** | [READ-SRC, §1.3, §1.4] | The SSH login must be the Windows account that owns that registry value. It is created per user (first GUI run or install for that user) [INFERRED]; a different account gets `FileNotFoundError` from `winreg`. Bypass: `zp.ZOS(opticstudio_directory=...)`. |
| NetHelper search order: user override dir, NetHelper's folder, its parent, then a registry GUID; corrupted entries from old installs break it; error text `Exception: Cannot find OpticStudio`; fixes: Windows *Repair* of the install, or pass the install path | [READ https://community.zemax.com/zos-api-12/python-zos-api-example-not-working-out-of-the-box-since-ansys-5239] | Use the explicit path in the runner; do not depend on discovery. |
| Data folder is per user: `ZemaxDataDir` "the full path for the current user's Zemax directory (in the My Documents\Zemax\ folder by default)", `GlassDir` e.g. `C:\Users\John.Doe\My Documents\Zemax\GLASSCAT` | [READ ZOS-API docs 2024 R2 SP02 application interface] | A user profile with a populated `Documents\Zemax` is required (glass catalogues, configs). An account that never ran OpticStudio probably lacks it [INFERRED]. |
| Graphics-related noise even in normal standalone use: `*** FRU__delta_init(): Attempt to start when running!` printed when `CloseApplication()` runs; maintainer: "seems to have something to do with graphics" | [READ github.com/MREYE-LUMC/ZOSPy/issues/180], 2025 R2.02 | The engine touches graphics subsystems even headless. |
| Native layout export can wedge the engine's tool slot | [READ-SRC optivibe session.py] [MEASURED-BY-3P] | Do not render layouts in the seat-holding job unless needed; do it last. |

Licence bound to a user? Not established. Legacy single-user softkeys and USB keys and their behaviour in remote
sessions: I found only a generic Sentinel-HASP statement that hardware keys are disabled inside RDP terminal
sessions **[SNIPPET support.skm.com KB 4359, not Zemax-specific]**. Treat as unknown.

**Test plan, in order (each step costs seconds and one seat):**

1. `ssh win "whoami & query session"` — confirm the account and whether an interactive session for it exists.
2. `ssh win "reg query HKCU\Software\Zemax /v ZemaxRoot"` and `dir "%USERPROFILE%\Documents\Zemax\ZOS-API\Libraries"`.
3. `ssh win "py -3.12 -c \"import clr, sys; print(sys.version)\""` — pythonnet loads at all in session 0.
4. Connect-only probe (script below) with a hard outer timeout of 120 s, printing `LicenseStatus`, `IsValidLicenseForAPI`, `InitializationErrorCode`, `Mode`, then `CloseApplication()`.
5. If 4 hangs or reports a licence error over SSH but works when the same command is typed at the machine's own console: the desktop matters. Fallback below.

Connect-only probe (raw pythonnet, so a ZOSPy problem cannot mask a licence problem):

```python
# probe.py  — exit code 0 only if the API is usable
import os, sys, json, time
os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")
import clr
ZDIR = sys.argv[1]                                  # e.g. C:\Program Files\Ansys Zemax OpticStudio 2025 R2.02
sys.path.append(ZDIR)
clr.AddReference(os.path.join(ZDIR, "ZOSAPI_Interfaces.dll"))
clr.AddReference(os.path.join(ZDIR, "ZOSAPI.dll"))
import ZOSAPI
conn = ZOSAPI.ZOSAPI_Connection()
conn.ConnectionTimeoutSeconds = 60.0                 # property exists [READ]; default value unknown
t0 = time.time()
app = conn.CreateNewApplication()
out = {"seconds": round(time.time() - t0, 1), "app_is_none": app is None}
if app is not None:
    out.update(license=str(app.LicenseStatus), api_ok=bool(app.IsValidLicenseForAPI),
               init_error=str(app.InitializationErrorCode), mode=str(app.Mode),
               data_dir=str(app.ZemaxDataDir), glass_dir=str(app.GlassDir))
    app.CloseApplication()
print(json.dumps(out)); sys.exit(0 if out.get("api_ok") else 2)
```

Loading the two DLLs straight from the install directory without the NetHelper is what ZOSPy does when given
`opticstudio_directory` [READ-SRC zospy/api/apisupport.py `load_zosapi(zemaxdirectory=...)`]; the vendor route
goes through `ZOSAPI_NetHelper.ZOSAPI_Initializer.Initialize(path)`. Whether the direct load works with raw
pythonnet outside ZOSPy is untested.

Fallback if session 0 fails — run the job in the logged-on user's interactive session from SSH **[RECALLED;
standard Windows mechanics, flags not re-read this session]**:

```bat
schtasks /Create /TN zos_job /SC ONCE /ST 00:00 /F /IT /RU %USERNAME% /TR "C:\jobs\run_job.cmd C:\jobs\j1"
schtasks /Run /TN zos_job
schtasks /Query /TN zos_job /FO LIST /V
```

`/IT` makes the task run only when that user is logged on, in that user's session. This needs the account to be
logged on at the console or in an RDP session (auto-logon on a dedicated machine), which is the "partly" in the
answer to "does it need a desktop session". The cua.ai guide uses the same shape: a daemon started in the
interactive session, reached from the SSH session over a named pipe [READ].

---

## 3. Seat behaviour

### 3.1 `IsValidLicenseForAPI`

- "Gets a value indicating whether this the API is currently useable." [READ 2026 R1 docs]
- It is read **after** `CreateNewApplication()` returns, i.e. an OpticStudio process already exists and must be closed even on failure. In the vendor template a failed check raises before `self.TheSystem` is set, and `__del__` then calls `CloseApplication()`; in ZOSPy the finalizer is registered only *after* the licence check passes (changed in 2.1.5, PR #199), so on `ConnectionRefusedError` nothing closes the instance until `zos.disconnect()` or process exit. [READ-SRC zpcore.py; INFERRED consequence — call `zos.disconnect()` in a `finally`.]
- The licence read "can itself wedge"; one project wraps both `CreateNewApplication()` and the `IsValidLicenseForAPI` read in a 30 s watchdog thread. [READ-SRC optivibe session.py] [MEASURED-BY-3P]

### 3.2 How many simultaneous instances

- Legacy FAQ (2019-09-11): perpetual single-user licence 2 instances for every edition; subscription Standard 2, Professional 4, Premium 8 (19.4+); "Licenses cannot be 'stacked'. Only one license seat can be used by any machine at one time." **[READ https://community.zemax.com/got-a-question-7/faq-how-many-instances-of-opticstudio-can-be-opened-at-once-862]**
- "The ZOSAPI_Connection class requires a new license for each instance but multiple IOpticalSystem interfaces can be launched from the same ZOSAPI_Connection class (and thus only requiring a single license)." Premium: 8 instances total, GUI and ZOS-API combined; the 8th parallel Python process failed with `LicenseException (License is not valid for ZOSAPI use)`. **[READ https://community.zemax.com/zos-api-12/python-multiprocessing-licensing-error-3117]**
- Standalone on a perpetual licence with two instances already open: "attempting to launch a 3rd instance will return a license check error" — messages `"License Check Failed"` or `"License is not valid for ZOSAPI use"`. **[READ community thread 933]**
- Ansys licensing, 2024 R2 known issue: "a single seat is shared by the first two instances, while any additional instances erroneously consume an extra seat per instance" (fixed in R2.01). **[READ https://community.zemax.com/opticstudio-release-notes-71/ansys-zemax-opticstudio-2024-r2-release-notes-5222]** So on Ansys licensing the intended behaviour is that several instances on one machine share one seat [INFERRED from "erroneously"]; the cap per edition under Ansys licensing I could not find.
- "'The ZOS-API is SINGLE-SEAT (N=1)' is NOT a licence hard-block: cross-process coexistence has been measured on the licence this was developed against. N=1 is OptiVibe's own operational discipline." (2025 R1 Premium) **[READ-SRC optivibe session.py]** [MEASURED-BY-3P]

### 3.3 GUI already open

- It counts as an instance (above). With the GUI open on a 2-instance licence, one standalone job still fits; a second does not. [INFERRED from 862 + 933]
- Standalone does not attach to the open GUI; it starts its own process (`Mode == Server`). [READ docs]
- The unexplained Enterprise failure in §1.2 was observed on a machine where the author was working in the GUI (their workflow is extension mode). Whether that is the cause is unknown.

### 3.4 Leftover processes

- "A 2nd `CreateNewApplication()` binds the SAME engine and closing any one handle poisons the shared remoting channel — but only WHILE a live registered engine exists; after a poison the next create spawns a genuinely NEW pid (measured live)." **[READ-SRC optivibe session.py]** [MEASURED-BY-3P]
- "the PID exits ~1.5 s after `CloseApplication()` returns"; they poll up to 6 s, then force-terminate the tracked PID. [same file]
- "The single seat (N=1) can be held by an orphaned OpticStudio server from an earlier run — e.g. after Claude Code hard-killed the MCP … close any stray headless `OpticStudio.exe` that no interactive session owns, then retry." **[READ-SRC optivibe zos-api-debug SKILL.md]**
- Reaping rule they use: snapshot `OpticStudio.exe` PIDs before create, diff after, keep only PIDs whose `create_time >= pre_create_time - 0.5 s`, kill by that PID only; "A user's interactive OpticStudio is the SAME exe name, so the reaper keys on the tracked spawn PID, never the name." **[READ-SRC optivibe process_reaper.py]**
- Symptom of a dead channel when a stale handle is used: `System.Runtime.Remoting.RemotingException: Object '/…​.rem' has been disconnected or does not exist at the server.` **[READ https://community.zemax.com/zos-api-12/crash-of-a-zos-api-python-application-782]**
- "Many rapid `connect → New() → disconnect` cycles can wedge the OpticStudio session (`New_Analysis` returns `None`; on-axis rays report spurious errors)" — extension mode, 2025 R2.02. **[READ-SRC webworn README.md]** [MEASURED-BY-3P]
- Cold start can exceed short client timeouts: one fork's changelog says an MCP "3 秒超时自动崩溃 … zemax 冷启动超过 3 秒" was fixed. **[READ repo description of zym1998year/OpticStudioMCPServer]** Allow tens of seconds.
- `del zos` (vendor pattern) releases the licence only if nothing else references the object; in notebooks it often does not. [READ github ZOSPy issue #61]

### 3.5 Implications for the runner (design notes, mine)

- One lock for the whole machine, taken before the job starts, released only after the job's `OpticStudio.exe` PID is gone. The independent re-opening agent takes the same lock: implement and verify are sequential, never concurrent.
- Job wrapper on Windows: record `tasklist /FI "IMAGENAME eq OpticStudio.exe" /FO CSV /NH` before and 2–60 s after start; the new PID is the job's engine; write it to `job_dir\engine.pid`. On timeout or after exit, if that PID still exists: `taskkill /PID <pid> /T /F`. Never `taskkill /IM OpticStudio.exe` unless the machine is known to have no human user.
- Start detached (`schtasks` or `Start-Process`) and poll a status file; do not hold the SSH channel open for the whole job. Whether sshd kills the child tree when the channel drops is unverified.
- Hard wall-clock cap in the wrapper, not only in Python: an un-interruptible .NET call cannot be cancelled from the Python side ([READ-SRC optivibe: "a single in-flight .NET open is un-interruptible"]).
- Every job writes: `LicenseStatus`, `Mode`, `zos.version`, wall time, and `Application.RetrieveLogMessages()`. Not `SerialCode`: result directories get copied and committed, and the licence serial must not travel with them.

---

## 4. Files

### 4.1 `.zmx` and `.zos`

- 2024 R1 notes: "The .ZOS file format will be retired in January 2025"; from 2024 R2 OpticStudio writes `.ZOS` files "using the same content type as .ZMX files"; `.ZMX` becomes the default save format. **[READ 2024 R1 release notes]**
- 2024 R2 notes: "The .ZOS file format has been retired. … aligning with the needs of long-term customers who require the human-readable aspect of the .ZMX file format." **[READ 2024 R2 release notes]**
- Announcement: 2025 R1 (January 2025) is the last release that can save `.ZOS`; after it ".ZOS file format will be read-only, and you will only be able to save files in .ZMX file format." **[READ https://community.zemax.com/user-news-alerts-5/ansys-zemax-opticstudio-updates-file-format-4699]**
- Therefore `SaveAs("…​.zos")` on 2025 R2 / 2026 R1 is expected to fail or be refused [INFERRED; not seen stated for the API]. The vendor's Example 01 in the 2024 R2 docs saves `e01_new_file_and_quickfocus.zos`; the 2026 repo's Example 15 saves `.zmx`.
- `IOpticalSystem` "represents a single ZMX file" [READ 2026 R1 docs index]. Members: `New(saveIfNeeded)`, `LoadFile(LensFile, saveIfNeeded) -> bool`, `Save()`, `SaveAs(fileName)`, `Close(saveIfNeeded) -> bool` (secondary systems only), `SystemFile`, `NeedsSave`, `CopySystem()`, `GetCurrentStatus()`, `UpdateStatus()`. [READ-SRC ZOSPy stubs]
- `SaveAs()` "requires absolute paths; relative paths may fail with non-ASCII directories" **[READ-SRC Jerry-del975/ai-zemax-optical-design:SKILL.md]**; ZOSPy: "a partial path or relative path does not work" [READ-SRC].
- Extension-mode edits "are live and unsaved" until saved [READ-SRC webworn]. Same holds in standalone: nothing is on disk until `Save`/`SaveAs` [INFERRED].

ZMX text format — observed on two files in the ZOSPy repo (`examples/Polarization Prism/…​.zmx`, VERS 221221;
`examples/Retinal illumination…/PseudophakicControlModel.zmx`, VERS 201130) **[READ-SRC bytes inspected]**:

- Both start `EF BB BF` = **UTF-8 with BOM**, CRLF line ends. (They may have been re-encoded before being committed; do not take this as OpticStudio's default.)
- Encoding is a preference: `Application.Preferences.General.ZMXFileEncoding` and `.TXTFileEncoding`, enum `ZOSAPI.Preferences.EncodingType` = `ANSI | Unicode` **[READ-SRC ZOSPy stubs; READ vendor Example 26, which sets both to ANSI and `UseSessionFiles = False`]**. ZOSPy maps `Unicode` → Python codec `"UTF-16-le"` for analysis text files [READ-SRC zpcore.py `get_txtfile_encoding`]. Default value: Unicode **[RECALLED]**.
- First line `VERS <yymmdd> …` identifies the writing build. Then system keywords: `MODE SEQ|NSC`, `NAME`, `UNIT MM X W X CM MR CPMM`, `ENPD 50` (entrance pupil diameter), `GCAT SCHOTT` (catalogues in use), `FTYP …`, `WAVM <n> <µm> <weight>` (24 slots always written, unused ones repeat 0.55), `PWAV <primary>`, field lines `XFLN/YFLN/FWGN`.
- Per surface: `SURF <n>` then indented `TYPE STANDARD`, **`CURV <curvature> <solve flags…>`** (curvature = 1/R, **not** radius; `0.0` = plane), **`DISZ <thickness>`** (`INFINITY` literal), **`GLAS <name> …`** (absent = air), **`DIAM <semi-diameter> <flags…>`**, `MEMA`, `STOP` on the stop surface [RECALLED for `STOP`; the others observed].
- "simply reading out the text of a ZMX file doesn't paint the full picture of what the active state for each surface is" — unused solve slots hold stale values (SLAB, extra GLAS parameters, OEMA flags) (Zemax staff) **[READ https://community.zemax.com/got-a-question-7/differences-in-zmx-files-for-systems-that-are-equal-in-file-comparer-5249]**. Parse `CURV`/`DISZ`/`GLAS` first tokens only; do not diff whole files.
- Version differences: a file written by v24 and one rebuilt in 20.3.2 compared equal except surface names [same thread]. Forward compatibility (older OpticStudio opening a newer `VERS`) not researched.

### 4.2 Session files

- Preferences: `General.UseSessionFiles`, `IncludeCalculatedDataInSession`, `IncludeToleranceDataInSession`; per-system `IOpticalSystem.SessionMode` = `FromPreferences | SessionOn | SessionOff`. **[READ-SRC ZOSPy stubs]** ZOSPy exposes `oss.SessionModes`.
- The session file sits next to the lens file with extension `.ZDA` (older: `.SES`) and stores open analysis windows and optionally cached results **[RECALLED]**. For scripted use set `oss.SessionModes = "SessionOff"` or `Preferences.General.UseSessionFiles = False` so that re-opening recomputes from the prescription and no sidecar needs to be shipped [INFERRED].
- Preferences changed through the API in standalone mode are not persisted unless `Connection.PreferencesFile` is set [READ ZOS-API docs: "settings load from OpticStudio.CFG but don't persist between sessions"].

### 4.3 Glass catalogues

- Location: `Application.GlassDir`, default `<Documents>\Zemax\GLASSCAT`; settable via `Preferences.Folders.GlassDirectory`. **[READ docs + stubs]**
- `.AGF` is text: `NM` line = glass name and dispersion-formula number, `CD` line = dispersion coefficients, `IT` lines = transmission; next `NM` ends the record. **[READ https://community.zemax.com/got-a-question-7/search-all-glass-across-catalogs-2157 and …/how-to-read-absorption-data-from-material-via-zos-api-2749]**
- "The encoding of different glass catalog files (*.AGF) vary, with the Schott one appearing to be UTF-8, but others like Optimax being UTF-16." **[SNIPPET of thread 2157]**
- A binary format (BGF) now exists alongside AGF **[SNIPPET optics.ansys.com/hc/en-us/articles/46891219767827]**.
- `NM` field order `NM <name> <formula#> <MIL#> <Nd> <Vd> <exclude> <status> <melt>`; formula 1 = Schott, 2 = Sellmeier 1 with `CD` = K1 L1 K2 L2 K3 L3 **[RECALLED]**.
- API: `SystemData.MaterialCatalogs.AddCatalog(name) -> bool`, `GetAvailableCatalogs()`, `GetCatalogsInUse()`, `GetMaterialsInCatalog(catalog)`, `IsCatalogInUse`, `RemoveCatalog`. **[READ-SRC stubs]** `Tools.OpenMaterialsCatalog()` exposes index data but not transmission [READ thread 2749].
- Per-surface: `LDE.GetGlass(Surface)` → `(ok, glassName, nd, vd, dpgf)`; `LDE.GetIndex(Surface, NumberOfWavelengths, [In,Out] double[] indexAtWavelength)`; `row.Material`, `row.MaterialCatalog`. **[READ 2026 R1 LDE docs + stubs]**
- A new system has no guarantee of which catalogues are loaded; the vendor example calls `AddCatalog('SCHOTT')` before using `N-BK7`. The file records them in `GCAT`. If the opening machine lacks a catalogue named in `GCAT`, the load reports a missing-catalogue / glass-not-found error; exact message text not found in any source.

---

## 5. Reading results

### 5.1 Lens Data Editor

`oss.LDE` is `ILensDataEditor`; rows are `ILDERow`. Members **[READ-SRC ZOSPy stubs, Editors/LDE]**:

- Editor: `NumberOfSurfaces`, `StopSurface` (read-only int in the stub), `GetSurfaceAt(n)`, `InsertNewSurfaceAt(n)`, `AddSurface()`, `RemoveSurfaceAt(n)`, `GetFirstOrderData()`, `GetGlass(n)`, `GetIndex(n, nw)`, `GetPupil()`, `GetSag(n, x, y)`, `RunTool_MakeFocal(focalLength)`.
- Row: `SurfaceNumber`, `TypeName`, `Type`, `IsObject`, `IsImage`, `IsStop` (get/set), `Comment`, `Radius`, `Thickness`, `Material`, `Coating`, `SemiDiameter`, `MechanicalSemiDiameter`, `ChipZone`, `Conic`, `TCE`, `MaterialCatalog`, and for each a `…Cell` (`RadiusCell`, `ThicknessCell`, `MaterialCell`, `SemiDiameterCell`, `ConicCell`), plus `GetCellAt(col)` / `GetSurfaceCell(SurfaceColumn)`.
- Cell (`IEditorCell`): `Header`, `DataType`, `DoubleValue`, `IntegerValue`, `Value` (string), `Solve` (current `SolveType`), `IsReadOnly`, `MakeSolveVariable()`, `MakeSolveFixed()`, `CreateSolveType(SolveType)`, `GetSolveData()`, `SetSolveData(data) -> SolveStatus`.
- Surface numbering: 0 = object, last = image = `NumberOfSurfaces - 1`. Evidence: vendor Example 15 takes the last lens surface as `GetSurfaceAt(TheLDE.NumberOfSurfaces - 2)`; ZOSPy's batch-trace test gets the same result for surface `4` and `"Image"` in a 5-surface system [READ-SRC tests/tools/test_batch_raytrace.py].
- Infinite values: `surface_object.Thickness = float("inf")` is accepted [READ-SRC ZOSPy README]; a plane's `Radius` reads back as `Infinity` and breaks naive JSON [READ-SRC webworn README].
- `GetFirstOrderData`: outputs `EFL, paraxialWorkingFNumber, realWorkingFNumber, paraxialImageHeight, paraxialMagnification` **[READ 2026 R1 docs]**; ZOSPy stub types it as `tuple[float × 5]`.
- Stop: one 2026 skill says "`system.LDE.StopSurface = N` — set stop by property, not `MakeSurfaceStop()`" [READ-SRC Jerry-del975 SKILL.md, tested on 2024 R1]; webworn's skill uses `TheSystem.LDE.GetSurfaceAt(3).IsStop = True` [READ-SRC]. The stub shows `IsStop` settable and `StopSurface` getter only. Prefer `row.IsStop = True` and read back `LDE.StopSurface`.

### 5.2 Solves

- Pattern (vendor Example 01): `Solver = Surface_3.RadiusCell.CreateSolveType(ZOSAPI.Editors.SolveType.FNumber); Solver._S_FNumber.FNumber = 10; Surface_3.RadiusCell.SetSolveData(Solver)`. [READ]
- Pickup (vendor Example 15): `Solver = cell.CreateSolveType(SolveType.SurfacePickup); p = Solver._S_SurfacePickup; p.Surface = 1; p.ScaleFactor = 1; p.Column = ZOSAPI.Editors.LDE.SurfaceColumn.Thickness; cell.SetSolveData(Solver)`. [READ-SRC]
- Variables: `cell.MakeSolveVariable()`; `Tools.RemoveAllVariables()`, `Tools.SetAllRadiiVariable()`. [READ-SRC]
- `SolveType` members include `Fixed, Variable, SurfacePickup, MarginalRayAngle, MarginalRayHeight, ChiefRayAngle, FNumber, ElementPower, EdgeThickness, Position, MaterialModel, MaterialSubstitute, MaterialOffset, Automatic, Maximum, …`. [READ-SRC stubs]
- ZOSPy helpers: `zp.solvers.variable(cell)`, `fixed(cell)`, `material_model(cell, refractive_index, abbe_number, partial_dispersion)`, `surface_pickup(...)`, `position(...)`, `element_power(...)`, `pickup_chief_ray(...)`. [READ-SRC zospy/solvers/__init__.py]
- A checker must read `row.RadiusCell.Solve`, `ThicknessCell.Solve`, `MaterialCell.Solve` for every surface: a `MaterialModel` solve means the "glass" is a fictitious (nd, vd) model, not a catalogue glass; a leftover `Variable` or `FNumber` solve means the saved numbers are whatever the last update computed. [INFERRED]

### 5.3 Merit Function Editor and operand values

`oss.MFE` is `IMeritFunctionEditor` **[READ-SRC stubs]**: `NumberOfOperands`, `GetOperandAt(n)`, `AddOperand()`, `InsertNewOperandAt(n)`, `RemoveOperandAt(n)`, `CalculateMeritFunction() -> float`, `LoadMeritFunction(file)`, `SaveMeritFunction(file)`, `SEQOptimizationWizard`, and

```
GetOperandValue(type: MeritOperandType, srf: int, wave: int, Hx, Hy, Px, Py, Ex, Ey: float) -> float
```

"GetOperandValue() expects the operand type, plus 8 more inputs because some operands use all 8." [READ-SRC vendor Example 07]. The eight inputs are the operand's eight editor columns in order (Param1…Param8); `srf` and `wave` are just the names of the first two.

Row (`IMFERow`): `Type`, `TypeName`, `ChangeType(MeritOperandType)`, `Target`, `Weight`, `Value` (read-only), `Contribution`, `GetOperandCell(MeritColumn)` with `MeritColumn` = `Comment, Param1 … Param8, Target, Weight, Value, Contrib`; vendor code also uses `Operand_3.GetCellAt(2).IntegerValue = 1` (cell 2 = Param1, cell 3 = Param2) [READ Example 03].

Operands needed here (all present in the `MeritOperandType` enum [READ-SRC stubs]):

| Operand | Meaning | Columns → `GetOperandValue` call | Provenance |
|---|---|---|---|
| `EFFL` | Paraxial effective focal length, lens units, at wavelength `Wave` | Param2 = Wave → `GetOperandValue(EFFL, 0, wave, 0,0,0,0,0,0)` | meaning and column [RECALLED]. A third-party table lists `Surf1, Surf2, Wave` for EFFL [READ-SRC jaruiz6363 OperandDatabase.cs]; I believe that is wrong (surface ranges belong to `EFLX`/`EFLY`). **Resolve on the machine** by printing `row.GetOperandCell(MeritColumn.ParamN).Header`. |
| `AXCL` | "This is the image separation between the two wavelengths defined by Wave1 and Wave2." Lens units. Zone = 0 → paraxial; 0 < Zone ≤ 1 → real marginal rays at that pupil zone | Param1 = Wave1, Param2 = Wave2, Param3 = Zone → `GetOperandValue(AXCL, w1, w2, zone, 0,0,0,0,0)` | quoted sentence [READ thread 5598]; Zone behaviour [SNIPPET thread 2675 + RECALLED]; column order [READ-SRC jaruiz DB + RECALLED]. **Sign convention not established.** |
| `RSCE` | "RMS spot radius with respect to the centroid in lens units. This operand uses a Gaussian quadrature method that is accurate for systems with unvignetted circular pupils." Wave = 0 → polychromatic | Param1 = Ring, Param2 = Wave, Param3 = Hx, Param4 = Hy → `GetOperandValue(RSCE, rings, wave, hx, hy, 0,0,0,0)` | quote and the call `GetOperandValue(RSCE, Sampling, Wave, Hx, Hy, 0, 0, 0, 0)` [READ https://community.zemax.com/zos-api-12/how-to-retrieve-rms-spot-radius-value-after-changing-certain-parameters-thickness-tiltx-3337] |
| `RSCH` | as RSCE but with respect to the chief ray | same columns | [READ same thread] |
| `RSRE` | centroid reference, rectangular grid of rays, considers vignetting; `Samp` n → n×n grid per pupil quadrant | Param1 = Samp, Param2 = Wave, Hx, Hy | [READ thread 3337; SNIPPET of help text] |
| `RSRH` | chief-ray reference, rectangular grid | same | [READ thread 3337] |
| `REAY`/`REAX` | real-ray y/x at a surface | `GetOperandValue(REAY, surf, wave, Hx, Hy, Px, Py, 0, 0)` | [READ vendor Example 23] |
| `INDX` | refractive index of a surface's medium at a wavelength: Surf, Wave | `GetOperandValue(INDX, surf, wave, 0,…)` | name in enum [READ-SRC]; meaning [RECALLED] |

"RSCE neglects ray vignetting, while the Spot Diagram accounts for it … As you increase the ray density in the spot diagram it will tend towards the RS** operands." **[READ https://community.zemax.com/got-a-question-7/sequential-zemax-rsce-doesn-t-match-spot-diagram-4121]**

### 5.4 Optimisation

Vendor Example 15, read (not reproduced here). For the local optimiser it calls `TheSystem.Tools.OpenLocalOptimization()`, sets `Algorithm` to `ZOSAPI.Tools.Optimization.OptimizationAlgorithm.DampedLeastSquares`, `Cycles` to `ZOSAPI.Tools.Optimization.OptimizationCycles.Automatic` and `NumberOfCores`, reads `InitialMeritFunction`, calls `RunAndWaitForCompletion()`, reads `CurrentMeritFunction` and calls `Close()`. For the hammer optimiser it calls `TheSystem.Tools.OpenHammerOptimization()`, sets `Algorithm` and `NumberOfCores`, then `RunAndWaitWithTimeout(5)`, `Cancel()`, `WaitForCompletion()` and `Close()`. Both results are tested against `None` before use.

- Enums: `OptimizationAlgorithm` = `DampedLeastSquares | OrthogonalDescent`; `OptimizationCycles` = `Automatic | Fixed_1_Cycle | Fixed_5_Cycles | Fixed_10_Cycles | Fixed_50_Cycles | Infinite`. [READ-SRC stubs]
- Hammer and Global never finish on their own: always `RunAndWaitWithTimeout(seconds)` → `Cancel()` → `WaitForCompletion()` → `Close()`. [READ-SRC vendor Example 15 / 03]
- `ISystemTool`: `Run()`, `RunAndWaitForCompletion()`, `RunAndWaitWithTimeout(s)`, `WaitForCompletion()`, `Cancel()`, `Close()`, `IsRunning`, `Progress`, `Succeeded`, `ErrorMessage`. [READ-SRC stubs]
- **Only one tool can be open.** "you always need to close an open tool before opening a new one, otherwise opening the new tool will fail silently and return `None`" — and `oss.load()` does not close an open tool. [READ github ZOSPy issue #147] Symptom: `AttributeError: 'NoneType' object has no attribute 'Algorithm'`. ZOSPy 2.2.0 has `zp.tools.open_tool(oss, oss.Tools.OpenLocalOptimization)` as a context manager that raises `RuntimeError("Cannot open tool because another tool is already open.")` instead. [READ-SRC zospy/tools/base.py]
- Wizard: `w = TheMFE.SEQOptimizationWizard; w.Data = 1  # RMS spot; w.Ring = 2  # index → 3 rings; w.IsGlassUsed = True; w.GlassMin = 3.0; …; w.Apply()`. [READ-SRC vendor Example 15] One third-party server marks its wizard tool "DISABLED … does not work correctly" [READ-SRC jaruiz DEVELOPMENT_NOTES.md]; another says "`wizard.OK()` not `Ok()`. Properties: `Ring`, `Arm`, `Data` (singular)" [READ-SRC Jerry-del975]. For an achromat, hand-written operands (EFFL target, AXCL target 0, RSCE or the wizard's default spot rows, MNCG/MXCG/MNEG thickness bounds as in vendor Example 03) are simpler to verify than wizard output.
- Reported optimiser behaviour in agent use: "the optimizer frequently compresses the glass thickness to near zero, resulting in unmanufacturable hourglass-shaped lenses"; EFL drifts unless held [READ https://arxiv.org/html/2609.30450]. "Do not trust merit score alone; inspect geometry and per-field performance." [READ-SRC Jerry-del975 zos-api-patterns.md]

### 5.5 Ray tracing through the API

Single ray without opening a tool: operands (`REAY` etc.) through `MFE.GetOperandValue` [READ Example 23].

Batch **[READ vendor Example 22/23; READ-SRC ZOSPy zospy/tools/batch_raytrace.py; READ-SRC stubs]**:

```python
rt = oss.Tools.OpenBatchRayTrace()
buf = rt.CreateNormUnpol(max_rays, ZOSAPI.Tools.RayTrace.RaysType.Real, to_surface)   # ZOSPy passes -1 for the image surface
buf.ClearData()
buf.AddRay(wave_number, Hx, Hy, Px, Py, opd_mode)        # opd_mode: OPDMode.None / Current / CurrentAndChief
rt.RunAndWaitForCompletion()
buf.StartReadingResults()
res = buf.ReadNextResult()   # (success, rayNumber, ErrorCode, vignetteCode, X, Y, Z, L, M, N, l2, m2, n2, opd, intensity)
rt.Close()
```

- `OPDMode.None` cannot be written literally in Python; the vendor uses `Enum.Parse(ZOSAPI.Tools.RayTrace.OPDMode, "None")`, webworn uses `getattr(RT.OPDMode, "None")`, ZOSPy exposes it as `None_` in constants. [READ]
- Vendor examples pass placeholder arguments to `ReadNextResult(sysInt, sysInt, sysInt, sysDbl × 11)` and loop `while output[0]`; ZOSPy and webworn (pythonnet 3) call `ReadNextResult()` with no arguments. Result is a 15-tuple; `[0]` is the success flag. [READ]
- A ray is good iff `ErrorCode == 0 and vignetteCode == 0`. [READ vendor Example 22; optivibe uses the same test] Positive error code = ray missed that surface, negative = TIR at that surface **[RECALLED]**.
- `X, Y, Z` are local coordinates on the target surface; `L, M, N` ray direction cosines after it; `l2, m2, n2` are the **surface normal** — ZOSPy's test data shows `l2,m2,n2 = 0,0,-1` at a plane image surface while `L,M,N = 0,0,1` [READ-SRC tests/tools/test_batch_raytrace.py], although ZOSPy's docstring calls them "direction cosines of the ray in the local coordinate system".
- Vendor Examples 22/23 pass `nsur = TheSystem.LDE.NumberOfSurfaces` as `toSurface`, which is one past the image index; ZOSPy passes `-1`; webworn passes `NumberOfSurfaces - 1`. Use `-1` or `NumberOfSurfaces - 1`.
- ZOSPy wrapper: `zp.tools.BatchRayTraceNormUnpol(hx=[…], hy=[…], px=[…], py=[…], wavelength=1, surface="Image", rays_type="Real", opd_mode="None").run(oss).data` → DataFrame with columns `rayNumber, ErrorCode, vignetteCode, X, Y, Z, L, M, N, l2, m2, n2, opd, intensity`. New in 2.2.0. [READ-SRC]
- Known vendor bug, fixed in 25 R1.01: `IZRDReader` "causing incorrect data for all segments except the first" (non-sequential ray databases). [READ ZOS-API changelog]

### 5.6 Spot diagram analysis

```python
spot = TheSystem.Analyses.New_Analysis(ZOSAPI.Analysis.AnalysisIDM.StandardSpot)
st = spot.GetSettings()
st.Field.SetFieldNumber(0)                 # 0 = all
st.Wavelength.SetWavelengthNumber(0)       # 0 = all
st.ReferTo = ZOSAPI.Analysis.Settings.Spot.Reference.Centroid     # see note
spot.ApplyAndWaitForCompletion()
r = spot.GetResults().SpotData
rms = r.GetRMSSpotSizeFor(field_number, wave_number)
geo = r.GetGeoSpotSizeFor(field_number, wave_number)
spot.Close()
```

- Calls from vendor Example 22 [READ]. That example writes `ZOSAPI.Analysis.Settings.RMS.ReferTo.Centroid`; the spot settings interface types `ReferTo` as `Settings.Spot.Reference` (`ChiefRay, Centroid, Middle, Vertex`) [READ-SRC stubs]. Which enum the setter accepts under pythonnet 3 is untested.
- Other spot settings: `Pattern` (`Square, Hexapolar, Dithered`), `RayDensity` (int), `DirectionCosines`, `IgnoreLateralColor`, `DeltaFocus`, `Surface`, `Configuration`. [READ-SRC stubs]
- `SpotData` (`IAR_SpotDataResultMatrix`): `NumberOfFields`, `NumberOfWavelengths`, `GetRMSSpotSizeFor(fieldN, waveN)`, `GetRMSSpot_X_For`, `GetRMSSpot_Y_For`, `GetGeoSpotSizeFor`, `GetReferenceCoordinate_X_For/_Y_For`, `MaxRadius`, `MeanRadius`. [READ-SRC stubs]
- `waveN` semantics: vendor code calls `GetRMSSpotSizeFor(1, 1)` after `SetWavelengthNumber(0)`; webworn found "RMS spot is `SpotData.GetRMSSpotSizeFor(field, 0)` (polychromatic)" on 2025 R2.02 [READ-SRC, MEASURED-BY-3P]. So 0 = all wavelengths, n = wavelength n. To get "RMS at d" either set `Wavelength.SetWavelengthNumber(d_index)` and read `(1, 1)` — whether the result matrix is then re-indexed is untested — or read `(1, d_index)`. Test both on the machine.
- **Units: micrometres**, not lens units: webworn reports "RMS spot 1453→56 µm" from this call; optivibe: "spot-radius units = um for a mm lens" [READ-SRC both]. Operands `RSCE` etc. are in **lens units** [READ]. Factor 1000 for a mm lens.
- "The spot result object has NO native validity member" — a spot can be reported for a system where rays fail; optivibe cross-checks with a batch trace and flags any ray with nonzero error/vignette code, and treats RMS > 1e7 µm as physically impossible. [READ-SRC optivibe _spot_validity.py]
- There is also a tool, `oss.Tools.OpenRMSSpotRadiusCalculator()` → `IComputeRMSSpotSize` with `SetMethodGaussianQuadrature(...)`, `SetMethodRectangularArray(...)`, `GetSpotRadius(configuration, field)`, `RMSSpotRadii`. [READ-SRC stubs] No example seen; units unknown.
- ZOSPy 2.2.0 has **no** spot-diagram wrapper (rays-and-spots wrappers: `RayFan`, `SingleRayTrace` only) [READ-SRC zospy/analyses/raysandspots/__init__.py]; use `zp.analyses.new_analysis(oss, zp.constants.Analysis.AnalysisIDM.StandardSpot, settings_first=True)` then `.Settings`, `.ApplyAndWaitForCompletion()`, `.Results.SpotData`. [READ-SRC zospy/analyses/base.py]
- First-order report through ZOSPy: `zp.analyses.reports.SystemData().run(oss).data.general_lens_data` has `effective_focal_length_air`, `effective_focal_length_image`, `back_focal_length`, `total_track`, `image_space_f_number`, `paraxial_working_f_number`, `working_f_number`, `entrance_pupil_diameter`, `primary_wavelength`, `lens_units`, … [READ-SRC zospy/analyses/reports/system_data.py]. Open bug: the parser fails "when RayAimingMode is anything but Off", when Fast Semi-Diameters is disabled, and on an empty system [READ github issue #228, open, 2026-06].

### 5.7 Units and sign conventions

| Quantity | Convention | Provenance |
|---|---|---|
| Lens units | set in `SystemData.Units.LensUnits` (`Millimeters, Centimeters, Inches, Meters`); ZMX `UNIT MM …` | [READ-SRC stubs, sample ZMX] default mm [RECALLED] |
| Wavelength | micrometres (`GetWavelength(1).Wavelength = 0.543  # in μm`; `WAVM 1 0.55…`) | [READ-SRC ZOSPy README, sample ZMX] |
| Radius sign | positive when the centre of curvature is toward +z (to the right of the vertex); biconvex = `+R, −R` | convention [RECALLED]; consistent with ZOSPy example `lens_front.Radius = 20; lens_back.Radius = -20` [READ] |
| Thickness | distance to the next surface along +z; object at infinity = `inf` | [READ ZOSPy example] |
| Material on row i | medium **after** surface i | [RECALLED]; consistent with vendor Example 01 (`Surface_2.Material = 'N-BK7'`, surface 3 is "rear of lens") |
| Indices | surfaces from 0 (object); wavelengths, fields, operands, configurations from 1 | [READ-SRC Jerry-del975 patterns: "commonly 1-based"; vendor code] |
| Hx, Hy, Px, Py | normalised to [−1, 1] | [READ-SRC ZOSPy validators] |
| Operand RMS/AXCL/EFFL | lens units | [READ for RSCE; RECALLED for others] |
| Spot analysis RMS/GEO | micrometres | [READ-SRC 3P, above] |
| AXCL sign (Wave1 vs Wave2) | **unknown** | staff answer only says sign gives "the focal shift direction from reference focus" [READ thread 5598] |

---

## 6. Failure modes and exact messages

| # | Symptom (text an agent would see) | Cause | Fix | Provenance |
|---|---|---|---|---|
| 1 | `LicenseException: License is not valid for ZOSAPI use` (vendor boilerplate) / `ConnectionRefusedError: OpticStudio Licence is not valid for API, connection not established` (ZOSPy) / C# server: `Invalid Zemax license: <LicenseStatus>` | `IsValidLicenseForAPI` false: edition without API (legacy Standard, student, viewer), instance limit reached, or — in extension mode — dialog not armed | Print `LicenseStatus` and `InitializationErrorCode`; close other instances; check edition | [READ-SRC template, zpcore.py, jaruiz ZemaxSession.cs; READ threads 933, 1103, 3117] |
| 2 | Same message on Enterprise in standalone only | unexplained | test on the actual seat; fallback extension mode | [READ-SRC webworn] |
| 3 | `"License Check Failed"` (MATLAB wording) | third instance on a 2-instance licence | close one instance | [READ thread 933] |
| 4 | `FileNotFoundError` from `winreg.OpenKey(... r"Software\Zemax")` or `QueryValueEx(..., "ZemaxRoot")` | HKCU key absent for this account | run OpticStudio once as that user, or pass `opticstudio_directory` | [READ-SRC apisupport.py] |
| 5 | `Exception: Cannot find OpticStudio` / `InitializationException: Unable to locate Zemax OpticStudio.  Try using a hard-coded path.` | NetHelper cannot resolve the install (stale registry GUIDs from older installs, mismatched DLLs between `Documents\Zemax` and Program Files) | Windows *Repair* on the install; or `zp.ZOS(opticstudio_directory=r"C:\Program Files\Ansys Zemax OpticStudio 2024 R2.01")` | [READ thread 5239] |
| 6 | `FileNotFoundError: Cannot locate ZOSAPI.dll in <dir>` | wrong `opticstudio_directory` (e.g. path to the exe) | give the directory | [READ-SRC apisupport.py] |
| 7 | `Could not load file or assembly 'ZemaxEngine.dll' or one of its dependencies. A dynamic link library (DLL) initialization routine failed. (Exception from HRESULT: 0x8007045A)` | OpticStudio 2025 under PyCharm/Spyder **debuggers**; also seen with the vendor class wrapper | run without a debugger (plain `python script.py`); `PYDEVD_USE_CYTHON=NO` sometimes helps; ZOSPy reported fine | [READ https://community.zemax.com/zos-api-12/error-using-zos-api-in-python-5631] |
| 8 | `Unhandled Exception: Python.Runtime.InternalPythonnetException: Failed to create Python type for ZemaxUI.ZOSAPI.Analysis.Wavefront.AS_WavefrontMap` | PyCharm debugger "PyQt compatible" option | disable it | [READ github ZOSPy issue #182] |
| 9 | `AttributeError: 'IAS_' object has no attribute 'Normalize'` (or any analysis-specific setting) | pythonnet ≥ 3 returns the declared interface type, not the concrete one | `settings.__implementation__.Normalize`, or use ZOSPy ≥ 1.2.0 whose codec downcasts automatically | [READ https://community.zemax.com/zos-api-12/python-net-3-x-is-completely-fixed-4926; READ-SRC codecs.py] |
| 10 | Exceptions in calls with int/enum arguments, e.g. `IZRDReaderResults.ReadNextSegmentFull`; "Python.NET 3.0: cannot assign `int` to enum properties (e.g. `tool.Cycles`)" | pythonnet 3 no longer converts int ↔ .NET enum implicitly | pass the enum member (`ZOSAPI.Tools.Optimization.OptimizationCycles.Fixed_5_Cycles`), never an int | [READ thread 3919; READ-SRC Jerry-del975 SKILL.md] |
| 11 | `pip install pythonnet` fails or resolves an unexpected version | Python too new/old for the wheel: pythonnet 3.0.5 needs < 3.14, 3.1.0 needs 3.10–3.14, 3.2.x needs ≥ 3.11 | use 64-bit CPython 3.11–3.13 | [READ PyPI JSON; webworn INSTALL.md "Use Python 3.11–3.13 (not 3.14)"] |
| 12 | Connection fails with a 32-bit Python | "64-bit Python must match 64-bit OpticStudio" | install 64-bit Python | [READ-SRC optivibe SKILL.md] |
| 13 | `RuntimeError: Only one Zemax application can exist within runtime` (ZOSPy) / older ZOSPy `ValueError: Cannot have more than one active ZOS instance` | second connect in one process | one connection per process; reuse `zos`; for a new empty system call `oss.new()` | [READ-SRC zpcore.py; READ FAQ] |
| 14 | `System.Runtime.Remoting.RemotingException: Object '/….rem' has been disconnected or does not exist at the server.` | handle used after `CloseApplication()`, or the OpticStudio process died | start a new Python process | [READ thread 782; optivibe] |
| 15 | `AttributeError: 'NoneType' object has no attribute 'Algorithm'` after `OpenLocalOptimization()` | another tool is still open | `oss.Tools.CurrentTool.Close()` first; close every tool in `finally` | [READ github ZOSPy issue #147] |
| 16 | `New_Analysis` returns `None`; on-axis rays report errors | session wedged after many connect/New/disconnect cycles | restart OpticStudio; one connection per job | [READ-SRC webworn] |
| 17 | `CreateNewApplication()` never returns | orphan engine holding the seat, or a hung handshake | outer timeout; reap the orphan PID; retry once | [READ-SRC optivibe] |
| 18 | `UnicodeDecodeError` reading a `.zmx` or an analysis text file | file is UTF-16-LE (or UTF-8 with BOM); reader assumed UTF-8/cp1252 | sniff the BOM: `FF FE` → `utf-16`, `EF BB BF` → `utf-8-sig`, else ANSI (`locale.getencoding()`); or set `Preferences.General.ZMXFileEncoding/TXTFileEncoding` | [READ github ZOSPy issue #31 (23 R2: "all analyses that use text-based output fail"); READ-SRC zpcore.py; Jerry-del975: "Zemax text output may be UTF-16; try UTF-16 first, then UTF-8"] |
| 19 | `locale.Error: unsupported locale setting` on `import zospy` (ZOSPy 1.2.0, German Windows); dates/numbers parsed wrongly on non-English locales | ZOSPy sets the locale on import; OpticStudio writes text with the system decimal separator | use current ZOSPy; set `Connection.FormattingCulture` before connecting if needed | [READ github ZOSPy issues #66, #67] |
| 20 | Glass not found / missing catalogue when loading or when setting `row.Material` | catalogue not in the system's list, or `.agf` absent from `GlassDir` on this machine | `sd.MaterialCatalogs.AddCatalog("SCHOTT")` before setting materials; check `GetAvailableCatalogs()`; read back `row.Material` after writing | API members [READ-SRC]; **exact error text not found** |
| 21 | Write "succeeds" but the value did not change | cell is driven by a solve, wrong surface type, or the API call silently failed ("Please throw errors instead of failing silently" is a forum thread title) | read back every written value and compare | [READ-SRC optivibe CLAUDE.md: "A clean call is not proof of success"; forum thread title seen in search results only] |
| 22 | `*** FRU__delta_init(): Attempt to start when running!` on stderr at `CloseApplication()` | OpticStudio internal, graphics-related; harmless | ignore; do not treat stderr content as failure | [READ github ZOSPy issue #180] |
| 23 | `TypeError: 'MethodObject' object is not callable` in `_disconnect_zos` at interpreter exit (ZOSPy < 2.1.5) | finalizer bug | upgrade to ≥ 2.1.5 | [READ github ZOSPy PR #199] |
| 24 | `SaveAs` to `.zos` fails or writes ZMX text into a `.zos` | format retired | save `.zmx` | [READ release notes; consequence INFERRED] |
| 25 | SystemData report parse error in ZOSPy | ray aiming on / fast semi-diameters off / empty system | read `LDE.GetFirstOrderData()` or `EFFL` instead | [READ github ZOSPy issue #228] |

Analyses that are unavailable or risky without the GUI:

- Layout pictures (Cross-Section, 3D Layout, Shaded Model) can be retrieved through the API only since **2024 R1** [READ 2024 R1 release notes]. Before that they could not be exported headless.
- On 2025 R1 a native layout export that raises leaves the tool slot wedged: "6 of 6 raising runs wedged the slot"; afterwards optimisation, quick focus, batch ray trace, tolerancing and `SaveAs/LoadFile/New` block or kill the engine, while LDE edits, MFE edits and `CloseApplication` still work; "a .zmx saved BEFORE the wedge is intact on disk" [READ-SRC optivibe session.py] [MEASURED-BY-3P]. Rule: **save first, render last**, and give the reviewer's image a separate job.
- Many analyses expose no numeric series through `GetDataSeries/GetDataGrid`; the only output is `Results.GetTextFile(path)`, which then has the encoding problem of row 18 [READ-SRC ZOSPy base.py: wrappers use a temp `.txt` and `get_txtfile_encoding()`; which analyses are text-only was not enumerated].
- I found no list from the vendor of analyses that refuse to run in standalone mode.

---

## 7. Verification recipes for a cemented achromat (EFL, F–C axial colour, RMS spot at d)

Principle: the checker is a different process, started after the builder's engine PID is gone, that opens
**the saved file** and measures; it does not read the builder's JSON. Three legs, in increasing independence
from OpticStudio's own evaluation:

### Leg A — re-open in OpticStudio and read operands (needs the seat)

```python
# verify_doublet.py  C:\jobs\j1\doublet.zmx  C:\jobs\j1\verify.json      [composed, never executed]
import json, math, sys
from pathlib import Path
import zospy as zp

zmx = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve()
zos = zp.ZOS(); oss = zos.connect("standalone")
try:
    oss.SessionModes = "SessionOff"                      # ignore any .ZDA sidecar   [setter exists; effect RECALLED]
    oss.load(zmx)                                        # NOTE: return value of LoadFile is discarded by ZOSPy
    assert Path(oss.SystemFile).resolve() == zmx, oss.SystemFile
    sd, lde, mfe = oss.SystemData, oss.LDE, oss.MFE
    MOT = zp.constants.Editors.MFE.MeritOperandType

    waves = [(i, sd.Wavelengths.GetWavelength(i).Wavelength, bool(sd.Wavelengths.GetWavelength(i).IsPrimary))
             for i in range(1, sd.Wavelengths.NumberOfWavelengths + 1)]
    def idx(um): return next(i for i, w, _ in waves if abs(w - um) < 5e-4)
    F, d, C = idx(0.4861), idx(0.5876), idx(0.6563)

    surfaces = []
    for i in range(lde.NumberOfSurfaces):
        r = lde.GetSurfaceAt(i)
        surfaces.append(dict(
            n=i, type=str(r.TypeName), stop=bool(r.IsStop), comment=str(r.Comment),
            radius=float(r.Radius), thickness=float(r.Thickness), material=str(r.Material),
            semi_diameter=float(r.SemiDiameter), conic=float(r.Conic),
            radius_solve=str(r.RadiusCell.Solve), thickness_solve=str(r.ThicknessCell.Solve),
            material_solve=str(r.MaterialCell.Solve),
            index={k: mfe.GetOperandValue(MOT.INDX, i, w, 0, 0, 0, 0, 0, 0) for k, w in (("F", F), ("d", d), ("C", C))}))

    res = dict(
        version=str(zos.version), license=str(zos.Application.LicenseStatus),
        lens_units=str(sd.Units.LensUnits), aperture_type=str(sd.Aperture.ApertureType),
        aperture_value=float(sd.Aperture.ApertureValue), stop_surface=int(lde.StopSurface),
        catalogs=list(sd.MaterialCatalogs.GetCatalogsInUse()), waves=waves,
        n_fields=int(sd.Fields.NumberOfFields),
        field1=(float(sd.Fields.GetField(1).X), float(sd.Fields.GetField(1).Y)),
        surfaces=surfaces,
        effl_d=mfe.GetOperandValue(MOT.EFFL, 0, d, 0, 0, 0, 0, 0, 0),
        first_order=[float(v) for v in lde.GetFirstOrderData()],
        axcl_FC_paraxial=mfe.GetOperandValue(MOT.AXCL, F, C, 0.0, 0, 0, 0, 0, 0),
        axcl_FC_zone07=mfe.GetOperandValue(MOT.AXCL, F, C, 0.707, 0, 0, 0, 0, 0),
        rsce_d_lens_units={rings: mfe.GetOperandValue(MOT.RSCE, rings, d, 0.0, 0.0, 0, 0, 0, 0) for rings in (3, 6, 12)},
        rsre_d_lens_units=mfe.GetOperandValue(MOT.RSRE, 20, d, 0.0, 0.0, 0, 0, 0, 0),
    )

    spot = zp.analyses.new_analysis(oss, zp.constants.Analysis.AnalysisIDM.StandardSpot, settings_first=True)
    spot.Settings.Field.SetFieldNumber(1)
    spot.Settings.Wavelength.SetWavelengthNumber(0)
    spot.Settings.RayDensity = 15
    spot.ApplyAndWaitForCompletion()
    sdta = spot.Results.SpotData
    res["spot_rms_um"] = {"poly": float(sdta.GetRMSSpotSizeFor(1, 0)), "d": float(sdta.GetRMSSpotSizeFor(1, d))}
    spot.Close()

    out.write_text(json.dumps(res, indent=2, default=lambda v: None if isinstance(v, float) and not math.isfinite(v) else str(v)))
finally:
    zos.disconnect()
```

Checks the verifier applies to that JSON (none of them trust a builder-reported number):

1. Structure: exactly object + 3 refracting surfaces + image; all `type == "Standard"`, `conic == 0`; two non-empty `material` cells on consecutive surfaces (cemented = no air gap); every `*_solve` is `Fixed` (or `Automatic` for semi-diameters) — in particular `material_solve` is not `MaterialModel`.
2. Object thickness is infinite; aperture type and value as specified; stop where specified; wavelengths are F/d/C within 0.5 nm.
3. `effl_d` and `first_order[0]` agree with each other to 1e-6 relative (two different API routes); both within the spec's tolerance.
4. `|axcl_FC_paraxial|` within spec. Sign is not asserted until calibrated (see Leg B).
5. `rsce_d` stable across rings 3/6/12 (Gaussian quadrature converged) and `rsre_d` close to it (no vignetting); `1000 × rsce_d[12]` vs `spot_rms_um["d"]` agree to a few percent — different sampling, so not exact [READ thread 4121]. Record which `GetRMSSpotSizeFor` wave index semantics held.
6. Evaluated **at the image distance saved in the file**. If the spec means "at best focus", the checker itself runs QuickFocus on its in-memory copy and reports both, and never saves.

### Leg B — plain-Python exact trace from the prescription (no OpticStudio evaluation)

Inputs: radii, thicknesses and semi-aperture read in Leg A, and per-surface refractive indices at F, d, C.
For the indices, either the `INDX` readout above (the catalogue lookup is still OpticStudio's) or, fully
independently, the Sellmeier coefficients from the `.agf` `CD` line (formula numbering RECALLED — confirm the
computed n_d against the `NM` line's Nd to 1e-5 before trusting the parse).

The algorithm, written and run during this research (a pure standard-library script that is not in the
repository; tested locally only against itself, not against OpticStudio):

- **Paraxial y–nu trace** per wavelength with y₀ = 1, u₀ = 0: at each surface `n'u' = nu − y (n' − n) c`,
  transfer `y ← y + u' t`. Then `EFL = −y₀ / u'_last`, `BFD = −y_last / u'_last` (from the last vertex).
  Paraxial axial colour = `BFD(λ₁) − BFD(λ₂)`.
- **Exact trace** through spheres: with origin at the vertex and the sphere `c(x²+y²+z²) − 2z = 0`,
  `B = N − c (P·D)`, `C = c|P|² − 2z₀`, path `s = C / (B + √(B² − cC))` (finite for `c = 0`); unit normal
  `(−cx, −cy, 1 − cz)`; vector Snell with `μ = n/n'`: `D' = μD + (cos θ' − μ cos θ) N̂`.
- **Zonal axial colour**: axis crossing `z − y·N/M` of the ray entering at height `zone × semi-aperture`, per
  wavelength; difference F − C.
- **On-axis RMS spot radius about the centroid** at the saved image distance: by symmetry the centroid is on
  the axis and `RMS² = ∫₀¹ r_img(√u)² du` with `u = (ρ/a)²`; Gauss–Legendre in `u`. This is the radial half of
  the quadrature RSCE is documented to use, so RSCE with enough rings and the script should agree closely for
  an unvignetted on-axis field.

Local self-test output (synthetic BK7/F2 doublet, indices from Sellmeier coefficients I recalled — they
reproduce catalogue values: N-BK7 nd = 1.51680, vd = 64.17; F2 nd = 1.62004, vd = 36.37):

```
singlet EFL trace=49.212996  thick-lens formula=49.212996
zone 0.0001: real BFD d=93.43942   (paraxial BFD d=93.43942)
paraxial axial colour  BFD(F)-BFD(C) = -0.11161 ; zone 0.7: -0.05905 ; zone 1.0: +0.00095
RMS spot radius on axis at paraxial focus, d: rings=3 11.8269 um, rings=6..48 11.8271 um
```

What Leg B settles that no source did:

- **AXCL sign**: compare `axcl_FC_paraxial` with `BFD(F) − BFD(C)` from the script. Equal → AXCL = Wave1 − Wave2; opposite → reversed. Until then assert on `abs()`.
- **EFFL reference medium and wavelength argument**: `effl_d` must equal the script's EFL at d to ~1e-6 relative; if it equals the EFL at the primary wavelength instead, the `wave` argument was ignored or misplaced (the EFFL column question in §5.3).
- **Spot units and wavelength index**: `spot_rms_um["d"]` ≈ 1000 × script RMS (mm).
- Expected agreement: EFL and paraxial colour to ~1e-6 relative (limited by index precision); RMS to a few 1e-3 relative against RSCE with ≥ 6 rings; a few percent against the Spot Diagram.

Caveats for Leg B: valid only for all-spherical "Standard" surfaces, object at infinity, on-axis field, stop
at (or imaged trivially onto) the first surface so that entrance-pupil radius = EPD/2 at surface 1. If the
stop is elsewhere, take the marginal ray height at surface 1 from a batch trace or compute the entrance pupil
paraxially. Environment: OpticStudio adjusts catalogue indices to the system temperature/pressure when
"Adjust Index Data To Environment" is on [field exists in the SystemData report, READ-SRC]; with it off,
indices are the catalogue's (relative to air at catalogue conditions) [RECALLED]. Compare the script's
Sellmeier n_d with `INDX` to detect this.

### Leg C — parse the `.zmx` text without the seat

Decode with BOM sniffing, split on `SURF`, take the first token after `CURV` (curvature → `R = 1/c`, `0` →
plane), `DISZ` (`INFINITY` → inf), `GLAS` (name), `DIAM` (semi-diameter), plus `ENPD`, `WAVM`, `PWAV`, `GCAT`,
`UNIT`. Feed the same Leg B script. This runs on the Linux/macOS host with no licence, so it can run while the
seat is busy, and it catches a builder that saved one file and measured another. It cannot see active solves
reliably (staff warning in §4.1), so it complements Leg A rather than replacing it.

---

## 8. Prior art: LLM agents driving Zemax

| Project | How it drives OpticStudio | Version / licence it reports | Pitfalls it reports |
|---|---|---|---|
| **optivibe-mcp** (chuang44-tiff, created 2026-07-20, pushed 2026-10-08, Apache-2.0) | Python, pythonnet with `PYTHONNET_RUNTIME=netfx`, **standalone**, one engine per MCP process, lazy open | 2025 R1 (25.1.0) Premium; Python 3.11+ | Orphaned engine holds the seat after the host is hard-killed; `CreateNewApplication()` and the licence read can hang (30 s watchdog); second create binds the same engine and closing one handle poisons the channel; PID exits ~1.5 s after close; native layout export can wedge the tool slot; spot results have no validity flag; "A clean call is not proof of success. Trust the read-back value"; "there is no reliable in-session undo"; `Gradient2` takes n0 **squared** |
| **zemax-mcp-server** (webworn, 2026-07, MIT, 13★) | Python, raw pythonnet ≥ 3.0.3, **extension mode** by default | 2025 R2.02 Enterprise; Python 3.11–3.13 | Standalone: `IsValidLicenseForAPI` false on this seat; one `ConnectAsExtension` per ribbon click; rapid connect/New/disconnect cycles wedge the session; planar radius = Infinity breaks JSON; `WavefrontMap` not `Wavefront`; must run under Windows Python, not WSL python |
| **OpticStudioMCPServer** (jaruiz6363, 2026-02, MIT, 57★; fork zym1998year 32★) | C# .NET Framework 4.8 server linking ZOSAPI DLLs, **standalone by default** | "any recent version" | Its optimisation-wizard tool is disabled as not working; it re-implements Levenberg–Marquardt outside OpticStudio; fork fixed a crash when cold start exceeded a 3 s connect timeout |
| **ai-zemax-optical-design** (Jerry-del975, 2026-06, 80★) | Python, pythonnet with ZOSPy fallback, **extension preferred** | 2024 R1 | "Standalone may crash or hang when the API license/session is unhealthy"; "Do not retry Standalone repeatedly after an OpticStudio exception dialog or timeout"; API quirks: `LDE.StopSurface = N`, `AddConfiguration(True)` takes bool, `wizard.OK()`, enums not ints, absolute `SaveAs` paths, text output may be UTF-16 |
| **optiforge** (zhaopeizhao41-ops, 2026) | Python MCP, **standalone default** | "OpticStudio 2021 or later, with a license that permits ZOS-API use (Premium, Professional or Enterprise)" | README only skimmed |
| **tangericm/optical-design** | Skill built on Optiland; optional "licensed native audited workflow via ZOSPy" | — | "Optiland snippets are not interchangeable with ZOSPy" |
| **LensDesigner** (Sun et al., arXiv:2609.30450, 2026-09-24) | "ZOS-API/pythonnet behind a Flask bridge"; LangChain ReAct agent; in-house paraxial tracer filters candidates before Zemax | version not stated | optimiser collapses glass thickness to near zero unless centre thicknesses are fixed; EFL drifts unless penalised; state desynchronisation between the agent's model and the lens; identical action loops (circuit breaker); non-catalogue glasses rejected by whitelist; "Zemax is the sole source of truth for final RMS / EFFL / #F" |
| **ZOSPy** itself (JOSS 2024, doi:10.21105/joss.05756) | the wrapper most of the above build on or mention | tested to 25.1.1 | see §1.4, §6 |

Sources: each row's repository README / SKILL / source files read with `gh api` this session; LensDesigner read
at https://arxiv.org/html/2609.30450 (first 100 k characters). Star counts and dates as of 2026-10-09.

Pattern across them: the two projects that describe measured engine behaviour in detail (optivibe, webworn)
disagree on whether standalone is usable, and both are single-author 2026 projects on different editions and
releases. None runs over SSH; all assume a logged-on Windows user with the MCP server started from that
user's desktop session.

---

## 9. What could not be established (test on the machine)

1. Whether `CreateNewApplication()` works from a Windows OpenSSH session (session 0), and if not, whether it works from a scheduled task with `/IT` in the logged-on session.
2. Whether the seat on this machine has `IsValidLicenseForAPI == True` in standalone mode (edition, Ansys vs legacy licence, and the unexplained Enterprise failure).
3. Whether the licence is found under the SSH account: per-user vs per-machine licence configuration, legacy softkey/USB key behaviour in non-console sessions.
4. Instance cap per edition under Ansys licensing; whether the GUI being open changes the standalone result.
5. Whether ZOSPy 2.2.0 works unchanged on 2025 R2 / 2026 R1 (not in its tested list).
6. AXCL sign; EFFL column layout (`Wave` only, or `Surf1/Surf2/Wave`); `GetRMSSpotSizeFor` wavelength index semantics after `SetWavelengthNumber(n)`; whether the spot `ReferTo` setter takes `Settings.Spot.Reference` or `Settings.RMS.ReferTo`.
7. Default `ZMXFileEncoding` on a fresh install, and the exact error text for a missing glass catalogue.
8. What `SaveAs("x.zos")` does on ≥ 2025 R2.
9. `LDE.GetIndex` calling convention under pythonnet 3 (does the `[In,Out] double[]` need to be passed), and whether `GetFirstOrderData()` returns 5 values or 5 plus a leading element.
10. Whether sshd terminates the Python/OpticStudio process tree when the SSH channel closes.
11. Cold-start time of the engine on this machine (to size timeouts).
12. Whether `New_Analysis(StandardSpot)` and layout export behave the same in session 0 as on a desktop.
