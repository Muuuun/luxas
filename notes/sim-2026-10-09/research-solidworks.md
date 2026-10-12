# Driving SOLIDWORKS from scripts over OpenSSH: research notes

Date of research: 2026-10-09. Nothing here has been run on a SOLIDWORKS machine. Every item is
**unverified until tried**.

Provenance tags used below:

- **[READ]** = I loaded the page (or the source file) in this session and the statement is on it.
  For help.solidworks.com I extracted the text from the page's embedded data, because the site is
  a JavaScript shell; the 2025 edition of the API help was used unless stated.
- **[READ-SUMMARY]** = the page was fetched in this session but I only saw a model-written summary
  of it (arXiv pages, some blogs). Numbers from these are lower confidence.
- **[SNIPPET]** = seen only in a search-result excerpt, page not opened.
- **[RECALLED]** = from memory, not checked against a page in this session.

URL shorthand: `APIHELP/<X>` means
`https://help.solidworks.com/2025/english/api/sldworksapi/SolidWorks.Interop.sldworks~SolidWorks.Interop.sldworks.<X>.html`
and `CONST/<X>` means
`https://help.solidworks.com/2025/english/api/swconst/SolidWorks.Interop.swconst~SolidWorks.Interop.swconst.<X>.html`.

---

## 0. Bottom line

1. **Interface**: out-of-process COM (`SldWorks.Application`) from Python with pywin32. This is
   what the only published benchmark of LLMs on real industrial CAD uses (ComAct, §8), and it
   reports 0 % for GUI agents against 52–88 % for a few-shot frontier model writing
   `win32com.client` code.
2. **SOLIDWORKS needs a logged-on interactive desktop session.** A shell opened by Windows OpenSSH
   is in session 0 and cannot host it. The runner must hand the job to a process that lives in
   the logged-on user's session (a worker started at logon, or a scheduled task created with
   `/it`). ssh is transport only.
3. **Run it visible, not hidden.** Vendor pages say `SelectByID2` needs "an open and visible
   document", `AddDimension2` should "only [be used] on visible documents", and a hidden session
   can make Save As fail with `swFileSaveAsNotSupported`. Nobody is watching the desktop, so
   visibility costs nothing.
4. **Verification must not share the tool.** There is no open-source reader for `.SLDPRT`
   geometry. The bridge is a STEP (and STL) export, re-opened with OCP/CadQuery or trimesh. To
   keep the export itself independent of the producer, the *harness* should own a fixed export
   script, not the producing agent.

---

## 1. The automation API

### 1.1 What must be running

- Any COM-capable language can write standalone (`.exe`, out-of-process) or add-in (`.dll`,
  in-process) applications. **[READ]**
  https://help.solidworks.com/2025/english/api/sldworksapiprogguide/GettingStarted/SolidWorks_API_Standalone_and_Add-in_Applications_Overview.htm
- "when programmatically creating a new SOLIDWORKS session, add-ins do not load even though Start
  Up is selected in the SOLIDWORKS Add-in dialog. You have to call ISldWorks::LoadAddIn". **[READ]**
  same page. (Relevant if Simulation or Toolbox is ever needed.)
- `CreateObject("SldWorks.Application")` "either creates a new SOLIDWORKS session or it attaches
  to an existing SOLIDWORKS session. If the end-user currently has an open SOLIDWORKS session,
  then your program attaches to it." Calling `ExitApp` then ends that session. **[READ]**
  APIHELP/ISldWorks~ExitApp
- Full SOLIDWORKS (`SLDWORKS.exe`) must be installed and licensed; there is no geometry-capable
  headless engine. The Document Manager API (§1.6) is the only vendor component that works
  without launching SOLIDWORKS, and it does not model. **[RECALLED]** for the "no headless
  engine" part.
- Versioned ProgID: `SldWorks.Application.NN` with `NN = year - 2012 + 20` (2025 → 33,
  2026 → 34). **[READ]** in pySldWrap source
  https://raw.githubusercontent.com/ThomasNeve/pySldWrap/master/pySldWrap/sw_tools.py ;
  consistent with `ISldWorks::RevisionNumber` returning major 23 for SOLIDWORKS 2015 **[READ]**
  APIHELP/ISldWorks~RevisionNumber.

### 1.2 Visible, UserControl, background

All **[READ]** on the 2025 API help:

- `ISldWorks::Visible`: "If the SOLIDWORKS application is started by your program, then the
  SOLIDWORKS application closes when your program ends. It makes no difference whether you make
  the SOLIDWORKS session visible." and "the SOLIDWORKS application can only be hidden if
  ISldWorks::UserControl is false and there are no visible documents open." APIHELP/ISldWorks~Visible
- `ISldWorks::UserControl = True`: session "remains running after your program ends" and it
  "causes the SOLIDWORKS application to run in the foreground and be visible".
  APIHELP/ISldWorks~UserControl
- `ISldWorks::UserControlBackground = True`: run "in the background and not be visible".
  APIHELP/ISldWorks~UserControlBackground
- `ISldWorks::DocumentVisible(Visible, Type)`: flag for documents opened afterwards. "If you
  create a document invisibly ... you cannot make it visible with IModelDoc2::Visible. Instead
  you should close it and then reopen it". APIHELP/ISldWorks~DocumentVisible
- `IFrame::KeepInvisible`: keep the frame hidden while activating documents; set back to false
  afterwards. APIHELP/IFrame~KeepInvisible
- `ISldWorks::CommandInProgress = True` before a batch of calls and `False` after: "Improves
  performance of out-of-process applications ... SOLIDWORKS then reduces the number of updates
  it makes during these calls." APIHELP/ISldWorks~CommandInProgress
- `ISldWorks::StartupProcessCompleted`: poll this before the first `OpenDoc6` from an
  out-of-process client. APIHELP/ISldWorks~StartupProcessCompleted
- `ISldWorks::EnableBackgroundProcessing`: only about opening drawings faster; not a headless
  mode. APIHELP/ISldWorks~EnableBackgroundProcessing
- **Trap**: "If you are closing the only document open in the SOLIDWORKS session and this
  SOLIDWORKS session is a background session, then calling this method, or calling
  ISldWorks::QuitDoc, results in the SOLIDWORKS session being closed." A background session is
  one started by the program with `UserControl` false. APIHELP/ISldWorks~CloseDoc
- **Reasons to stay visible**:
  - `SelectByID2`: "The IModelDoc2 object used to call this method must be an open and visible
    document." APIHELP/IModelDocExtension~SelectByID2
  - `AddDimension2`: "You should only use this method on visible documents."
    APIHELP/IModelDoc2~AddDimension2
  - `swFileSaveAsNotSupported` (4096): Save As "was executed is such a way that the resulting
    file might not be complete, possibly because SOLIDWORKS is hidden; if the error persists
    after setting SOLIDWORKS to visible and re-attempting the Save As operation, contact
    SOLIDWORKS API support." CONST/swFileSaveError_e
  - `swFileLoadWarning_InvisibleDoc_LinkedDesignTableUpdateFail` (65536). CONST/swFileLoadWarning_e

### 1.3 Why a service session or an ssh session fails

- Forum report, 2017-01-23: instantiating SOLIDWORKS from a Windows service or web service fails
  with `Retrieving the COM class factory for component with CLSID
  {F16137AD-8EE8-4D2A-8CAC-DFF5D1F67522} failed due to the following error: 80080005 Server
  execution failed (Exception from HRESULT: 0x80080005 (CO_E_SERVER_EXEC_FAILURE)).` The same
  code works from a desktop application. **[READ]** (question only; the page showed no answers)
  https://3dswym.3dexperience.3ds.com/question/solidworks-user-forum/cannot-connect-to-solidworks-through-windows-service_1GpdpRtKRyOKnSNE7GFd7Q
- "Services cannot directly interact with a user as of Windows Vista." and "All services run in
  Terminal Services session 0." **[READ]**
  https://learn.microsoft.com/en-us/windows/win32/services/interactive-services
- "Windows OpenSSH runs in Session 0, which has no desktop, so window tools return empty results
  there." **[READ-SUMMARY]** (third-party computer-use driver documentation)
  https://cua.ai/docs/how-to-guides/driver/windows-ssh
- I found **no vendor page that states "unsupported in a service" in those words**. The nearest
  first-party evidence is the visibility requirements in §1.2, and the SOLIDWORKS PDM task-host
  practice that the host "must be on and logged into Windows" **[SNIPPET]** (reseller pages:
  https://www.javelin-tech.com/blog/2018/08/solidworks-pdm-task-host-automatic-login/ ,
  https://www.goengineer.com/en-us/blog/task-host-setup-checklist-solidworks-pdm ).
- In pywin32 the same failure would surface as
  `pywintypes.com_error: (-2146959355, 'Server execution failed', None, None)`
  (0x80080005). **[RECALLED]** message format; the HRESULT arithmetic is exact.

### 1.4 Command-line switches

- Vendor table (SOLIDWORKS Task Scheduler > Run Custom Task): `/b` = "Run the SOLIDWORKS software
  in the background", `/m` = "Run the SOLIDWORKS macro"; both "set by default" for SOLIDWORKS
  tasks. **[READ]** https://help.solidworks.com/2024/English/SolidWorks/Sldworks/HIDD_TASK_MACRO.htm
- `"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SLDWORKS.exe" /m "full path to macro"` runs a
  macro at start-up. **[READ-SUMMARY]** (reseller post from 2008; only `.swp` mentioned)
  https://www.cati.com/?p=117840
- xCAD (open-source framework) starts SOLIDWORKS with these constants: `SafeMode =
  "/SWSafeMode /SWDisableExitApp"`, `BackgroundMode = "/b"`, `SilentMode = "/r"`, and finds the
  instance in the Running Object Table under the moniker `SolidWorks_PID_<pid>`. **[READ]**
  https://raw.githubusercontent.com/xarial/xcad/master/src/SolidWorks/SwApplicationFactory.cs
  The meaning of `/r` and the two `/SW…` switches is **not documented by the vendor on any page
  I found**; treat as community knowledge.
- CodeStack describes three ways to connect: create by ProgID (cannot choose the instance),
  `GetActiveObject` (existing instance only), and start the process then look up
  `"SolidWorks_PID_" + processId` in the ROT (most control; their sample uses a 10 s default
  timeout, which is too short for a cold start). **[READ-SUMMARY]**
  https://www.codestack.net/solidworks-api/getting-started/stand-alone/connect-csharp/

### 1.5 VBA macros, `.swb` text macros, RunMacro2, Task Scheduler

- `ISldWorks::RunMacro2(FilePathName, ModuleName, ProcedureName, Options, ByRef Error)` returns
  true if the macro runs; errors in `swRunMacroError_e`; "Running a macro from an add-in
  application, standalone .exe, or VBA macro is supported." For a .NET macro pass the compiled
  DLL path and `"Main"`. **[READ]** APIHELP/ISldWorks~RunMacro2
- `swRunMacroError_e` includes `swRunMacroError_MacrosAreDisabled = 2`, `_Busy = 17`,
  `_CallRejected = 19`, `_OpenFileFailed = 28`, `_InvalidProcname = 6`. **[READ]** CONST/swRunMacroError_e
- A "SOLIDWORKS macro template" is a **text** file with the `.swb` extension holding VB code,
  and the Task Scheduler runs it by passing `/m`. The vendor's sample `.swb` opens each drawing
  in a folder with `OpenDoc6(..., 3, 1, "", openError, openWarn)` and saves it as DXF, logging to
  a file, then `swApp.ExitApp`. **[READ]** HIDD_TASK_MACRO page above. This means an agent can
  write a macro as plain text; `.swp` files are binary **[RECALLED]**.
- SOLIDWORKS Task Scheduler "runs separately from SOLIDWORKS"; it needs a Professional, Premium
  or Office licence for everything except file conversion. "To run a scheduled task, your
  computer must be on at the scheduled start time." **[READ]**
  https://help.solidworks.com/2024/english/SolidWorks/sldworks/c_SOLIDWORKS_Task_Scheduler_Overview.htm
  and `.../c_licensing_requirements.htm`. It is a GUI scheduler; it does not remove the need for
  a desktop session **[RECALLED]**. I do not recommend it for the runner: Python + COM gives
  return values and error codes directly.

### 1.6 Document Manager API

All **[READ]** https://help.solidworks.com/2025/English/api/swdocmgrapi/GettingStarted-swdocmgrapi.html

- "requires a license key that is only available via the SOLIDWORKS customer portal to
  SOLIDWORKS customers who are currently under subscription. Each user ... must have a license
  key." Request at https://www.solidworks.com/support/subscription/key-request/ . The key must
  be renewed for each new major release; a key older than the file's version cannot open the
  file. "Do not share this license key with anyone outside your company".
- It is a COM object in `SwDocumentMgr.dll` (with `zlib.dll`), registered by a SOLIDWORKS
  install or by `regsvr32`. It can be used on a machine without SOLIDWORKS.
- Key categories: Basic, Previews, DimXpert, Geometry Streams, XML Streams, Tesselation.
- Use: custom properties, configuration names, references, previews, without launching
  SOLIDWORKS. It does not rebuild or compute mass properties. **[RECALLED]** for the last
  sentence.

### 1.7 C#

Not needed for the first version. One fact worth keeping: a Node.js COM bridge (winax) could not
call methods with 13 or more parameters and fell back to generated VBA (§8); C# and pywin32 do
not have that limit **[RECALLED]** for the pywin32 half.

---

## 2. Running from an OpenSSH session

### 2.1 The constraint

A process inherits its parent's session; `sshd` is a service, so everything started from an ssh
shell is in session 0 with no interactive desktop (§1.3). Starting `SLDWORKS.exe` or
`Dispatch("SldWorks.Application")` straight from the ssh shell is therefore expected to fail or
hang. **Unverified on our machine**: which of the two it does, and how long it takes.

### 2.2 Options

**A. Persistent worker in the user's session (recommended).**
A small Python process starts at logon in the desktop session and watches a job directory. ssh
only pushes files and reads status. This is the shape Microsoft recommends for services that
need UI ("Create a separate hidden GUI application and use the CreateProcessAsUser function to
run the application within the context of the interactive user ... communicate ... through some
method of interprocess communication" **[READ]** interactive-services page) and the shape the
cua driver uses (daemon in session 1+, ssh side proxies to it over a named pipe; same Windows
account required on both sides **[READ-SUMMARY]**).

Register once, from an interactive (RDP or console) session of that user:

```
schtasks /create /tn "LuxasSWWorker" /tr "C:\luxas\worker.cmd" /sc onlogon /ru MACHINE\luxas /it /rl highest /f
```

`/it` = "run the scheduled task only when the run as user ... is logged on"; a verbose query
shows `Logon Mode: Interactive only`. `/sc onlogon` runs at logon. `/rl highest` runs elevated.
**[READ]** https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create
That the task's process then appears on that user's desktop is the standard behaviour of
interactive-only tasks **[RECALLED]**.

**B. One scheduled task per job.**

```
schtasks /create /tn "LuxasSWJob" /tr "C:\luxas\run_job.cmd JOBID" /sc once /st 00:00 /ru MACHINE\luxas /it /f
schtasks /run /tn "LuxasSWJob"
schtasks /query /tn "LuxasSWJob" /v /fo list
```

Works from the ssh shell because the Task Scheduler service, not sshd, launches the process.
`schtasks /run` returns at once; the job must write its own status file. The documentation
says "Schtasks won't let you schedule a task to run once if the date and time specified are in
the past" **[READ]**, so `/st 00:00` may be refused. Safer: create the task once at setup time
with a fixed command that reads the job id from a file, and only call `schtasks /run` per job.
**Unverified**: how Windows 11 treats a `/sc once` start time that has already passed today.

**C. PsExec.**
`psexec -accepteula -i <session> -u MACHINE\luxas -p <pw> C:\luxas\run_job.cmd JOBID`.
`-i`: "Run the program so that it interacts with the desktop of the specified session on the
remote system. If no session is specified the process runs in the console session." `-d`: do not
wait. `-h`: elevated token. **[READ]** https://learn.microsoft.com/en-us/sysinternals/downloads/psexec
Needs the password on the command line and an extra download; antivirus often flags PsTools
(same page). Second choice.

Find the session id from ssh: `query user` (also `qwinsta`), and check where SOLIDWORKS landed
with `tasklist /v /fi "imagename eq SLDWORKS.exe"` (the Session# column). **[RECALLED]**

### 2.3 Keeping a desktop session alive with no monitor and no RDP client

- **Autologon**: Sysinternals Autologon stores the credentials "encrypted in the Registry" as an
  LSA secret and logs the user on at the console at boot; `autologon user domain password` on
  the command line. "a user with administrative rights can easily retrieve and decrypt it".
  **[READ]** https://learn.microsoft.com/en-us/sysinternals/downloads/autologon
- **After any RDP visit, do not just close the client.** Closing RDP "locks out the computer and
  displays the login screen", and in that state "the computer does not have GUI". Reattach the
  session to the console instead (needs administrator rights):
  ```
  for /f "skip=1 tokens=3" %%s in ('query user %USERNAME%') do (
    %windir%\System32\tscon.exe %%s /dest:console
  )
  ```
  This "leaves the remote computer unlocked". **[READ-SUMMARY]**
  https://support.smartbear.com/testcomplete/docs/testing-with/running/via-rdp/keeping-computer-unlocked.html
  After `tscon` the session resolution may drop to 1024x768 or 640x480 **[SNIPPET]** (UiPath
  forum); matters for screenshots.
- Whether SOLIDWORKS COM calls keep working while the console is **locked** is not established.
  GUI-test vendors say drawing stops when locked; COM automation that does not need pixels may
  survive. Test it; until then disable lock, screensaver and sleep for the worker account.
- **Graphics**: "Use software OpenGL ... is automatically selected and unavailable for change if
  your graphics card does not support hardware acceleration, or does not support it for the
  current combination of resolution, number of colors, refresh rate". **[READ]**
  https://help.solidworks.com/2025/english/SolidWorks/sldworks/HIDD_OPTIONS_PERFORMANCE.htm
  Readable through the API as the read-only toggle `swUserPreferenceToggle_e.swUseSimpleOpenGL`.
  **[READ]** https://help.solidworks.com/2025/english/api/swconst/SO_Performance.htm
  Remote access forces software OpenGL **[READ-SUMMARY]**
  https://knowledge.cadimensions.com/knowledge/the-solidworks-use-software-opengl-setting
  Software OpenGL is slow but is fine for geometry work. A machine with no display attached may
  need a dummy HDMI/DP plug or a virtual display for the GPU to present a desktop **[RECALLED]**.
- Supported hypervisors, should the "machine" be a VM: VMware vSphere ESXi, VMware Workstation,
  Microsoft Hyper-V, Parallels Desktop; "SOLIDWORKS and eDrawings require a GPU for optimal
  performance in a virtualized environment." **[READ]**
  https://www.solidworks.com/support/system-requirements

### 2.4 OpenSSH details the runner depends on

All **[RECALLED]**, standard Win32-OpenSSH behaviour, to be confirmed on the machine: default
shell is `cmd.exe`; `scp` and `sftp` work; for accounts in the Administrators group the
authorised keys file is `C:\ProgramData\ssh\administrators_authorized_keys`; quoting of nested
`cmd` arguments through ssh is fragile, so push a `.cmd` or `.json` file and pass only an id.

---

## 3. Typical operations

Unit rule: "Unless otherwise stated, all SOLIDWORKS API functions use metric units ... meters,
radians, kilograms, square meters, or cubic meters." **[READ]**
https://help.solidworks.com/2025/english/api/sldworksapiprogguide/Overview/Units.htm
So 10 mm is `0.010`, and the vendor's own example multiplies an interference volume by 1e9 to
print mm³.

### 3.1 Signatures read on the 2025 help

| Operation | Call | Notes |
|---|---|---|
| New document | `swApp.NewDocument(TemplateName, PaperSize, Width, Height)` | "Fully qualified path" of the template; returns NULL on failure; "To get the default template filename, use ISldWorks::GetUserPreferenceStringValue." APIHELP/ISldWorks~NewDocument |
| Default template | `swApp.GetUserPreferenceStringValue(swDefaultTemplatePart)` | also `swDefaultTemplateAssembly`, `swDefaultTemplateDrawing`. https://help.solidworks.com/2025/english/api/swconst/SO_DefaultTemplates.htm |
| Open | `swApp.OpenDoc6(FileName, Type, Options, Configuration, ByRef Errors, ByRef Warnings)` | Type: `swDocPART=1`, `swDocASSEMBLY=2`, `swDocDRAWING=3`; Options: `swOpenDocOptions_Silent=1`, `_ReadOnly=2`. Returns NULL on failure. Does not change the working directory. Foreign files (STEP, IGES) go through `LoadFile4`. APIHELP/ISldWorks~OpenDoc6 |
| Select | `model.Extension.SelectByID2(Name, Type, X, Y, Z, Append, Mark, Callout, SelectOption)` | 9 arguments. Name is case-sensitive and exact; dimensions must be fully qualified (`"D1@Sketch2@Part1.SLDPRT"`). Face picking by X,Y,Z uses the view ray: "if the view changes ... the same IFace2 might not be selected next time". |
| Sketch | `model.SketchManager.InsertSketch(True)`, `.CreateCornerRectangle(X1,Y1,Z1,X2,Y2,Z2)`, `.CreateCircleByRadius(XC,YC,Zc,Radius)` | `AddToDB = True` "avoids ... inferencing, automatic relations, and snapping to the grid"; must be reset to False. |
| Boss extrude | `model.FeatureManager.FeatureExtrusion3(...)` | **23** arguments in this order: Sd, Flip, Dir, T1, T2, D1, D2, Dchk1, Dchk2, Ddir1, Ddir2, Dang1, Dang2, OffsetReverse1, OffsetReverse2, TranslateSurface1, TranslateSurface2, Merge, UseFeatScope, UseAutoSelect, T0, StartOffset, FlipStartOffset. Since 2014. |
| Cut extrude | `model.FeatureManager.FeatureCut4(...)` | **27** arguments: the first 17 as above, then NormalCut, UseFeatScope, UseAutoSelect, AssemblyFeatureScope, AutoSelectComponents, PropagateFeatureToParts, T0, StartOffset, FlipStartOffset, OptimizeGeometry. Since 2017. "The default direction for cut operations is opposite the sketch normal." |
| End conditions | `swEndCondBlind=0`, `swEndCondThroughAll=1`, `swEndCondMidPlane=6`, `swEndCondUpToNext=11` | CONST/swEndConditions_e |
| Simple hole | `FeatureManager.SimpleHole2(Dia, Sd, Flip, Dir, T1, T2, D1, D2, ...)` | Hole Wizard is `HoleWizard5` (many arguments). |
| Chamfer | `FeatureManager.InsertFeatureChamfer(Options, ChamferType, Width, Angle, OtherDist, VertexChamDist1, VertexChamDist2, VertexChamDist3)` | edges pre-selected |
| Fillet | `FeatureManager.FeatureFillet3(...)` | "As of SOLIDWORKS 2020, this method is obsolete for creating constant radius fillets"; use `CreateDefinition` + `ISimpleFilletFeatureData2` + `CreateFeature`. |
| Patterns | `FeatureLinearPattern5`, `FeatureCircularPattern5` | Both marked **Obsolete**: "See IFeatureManager::CreateFeature and ... ILinearPatternFeatureData". |
| Dimension value | `model.Parameter("D1@Boss-Extrude1")` then `dim.SetSystemValue3(NewValue, WhichConfigurations, Config_names)` | value in metres; `SystemValue` property is obsolete. |
| Add a dimension | `model.AddDimension2(X, Y, Z)` | visible documents only; set `swInputDimValOnCreate` to False "to suppress the dialog box that lets the user type a dimension value". |
| Equations | `model.GetEquationMgr().Add3(Index, Equation, Solve, WhichConfigurations, ConfigNames)` | e.g. `"D1@Extrude2" = "B" * 2`; `Add2` for single-configuration parts; returns -1 on error. |
| Rebuild | `model.ForceRebuild3(TopOnly)` / `model.EditRebuild3()` | return a bool only |
| Rebuild errors | `model.Extension.GetWhatsWrong(ByRef Features, ByRef ErrorCodes, ByRef Warnings)`; `feature.GetErrorCode2(ByRef IsWarning)` | codes in `swFeatureError_e` |
| Mass properties | `model.Extension.CreateMassProperty2()` → `IMassProperty2`; older `Extension.GetMassProperties2(Accuracy, ByRef Status, UseSelected)` | the older one is marked obsolete but returns one array: `[CoMx, CoMy, CoMz, Volume, SurfaceArea, Mass, MomXX, MomYY, MomZZ, MomXY, MomZX, MomYZ]`, "returns values in metric units". |
| Bounding box | `part.GetPartBox(True)`; `body.GetBodyBox()` | 6 doubles. "The values returned are approximate and should not be used for comparison or calculation purposes." |
| Interference | `asm.InterferenceDetectionManager` → `.TreatCoincidenceAsInterference = False`, `.GetInterferences()`, `.GetInterferenceCount()`, `interference.Volume`, `.Components`, `.Done()` | Volume in m³. Vendor example: https://help.solidworks.com/2025/english/api/sldworksapi/Run_Interference_Detection_Example_VB.htm |
| Save | `model.Save3(Options, ByRef Errors, ByRef Warnings)` | `swSaveAsOptions_Silent=1`. Warnings `swFileSaveWarning_RebuildError=1`, `_NeedsRebuild=2`. |
| Export | `model.Extension.SaveAs3(Name, Version, Options, ExportData, AdvancedSaveAsOptions, ByRef Errors, ByRef Warnings)` | Since 2020 SP02. The file extension picks the format. "To save as an IGES, STL, or STEP file, the document to convert must be the active document." "Exports the entire model, unless faces or bodies are selected" → call `model.ClearSelection2(True)` first. "Overwrites existing files unless they are read only." |
| STEP flavour | `swApp.SetUserPreferenceIntegerValue(swStepAP, 203 or 214)` | https://help.solidworks.com/2025/english/api/swconst/FileSaveAsSTEPOptions.htm |
| STL options | `swSTLBinaryFormat` (toggle), `swExportStlUnits` (0 mm, 1 cm, 2 m, 3 in, 4 ft), `swSTLQuality`, `swSTLDeviation`, `swSTLAngleTolerance`, **`swSTLDontTranslateToPositive`**, `swSTLShowInfoOnSave`, `swSTLPreview` | https://help.solidworks.com/2025/english/api/swconst/FileSaveAsSTLOptions.htm |
| Parasolid | extension `.x_t` / `.x_b`; `swParasolidOutputVersion` | https://help.solidworks.com/2025/english/api/swconst/FileSaveAsParasolidOptions.htm (extensions **[RECALLED]**) |
| Screenshot | `model.SaveBMP(FileNameIn, WidthIn, HeightIn)` | "If WidthIn or the HeightIn is less than or equal to 0, then the view size is based on the current window size." Views: `model.ShowNamedView2(VName, ViewId)`, `model.ViewZoomtofit2()`. |
| Process id | `swApp.GetProcessID()` | for the watchdog |
| Quit | `swApp.ExitApp()` | "ending your program does not guarantee that the SOLIDWORKS processes are closed ... Calling this method ensures that no SOLIDWORKS processes are left running". |

### 3.2 Minimal Python (composed from the signatures above; **not run**)

The call shapes for by-reference arguments and for the `Nothing` callout are taken from working
open-source code (pySldWrap, **[READ]**); the rest is assembled from the help pages and is a
starting point, not a verified script.

```python
import pythoncom, win32com.client as w32
from win32com.client import VARIANT

def byref_i4(v=0):  return VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, v)
NOTHING = VARIANT(pythoncom.VT_DISPATCH, None)        # VBA "Nothing"

sw = w32.Dispatch("SldWorks.Application")             # attaches if one is running
sw.Visible = True
while not sw.StartupProcessCompleted: pythoncom.PumpWaitingMessages()

swDefaultTemplatePart = 8                             # [RECALLED] value; resolve by name instead
tpl = sw.GetUserPreferenceStringValue(swDefaultTemplatePart)
assert tpl, "no default part template configured"
model = sw.NewDocument(tpl, 0, 0.0, 0.0)
assert model is not None, "NewDocument returned Nothing"

ext, sk, fm = model.Extension, model.SketchManager, model.FeatureManager
assert ext.SelectByID2("Front Plane", "PLANE", 0, 0, 0, False, 0, NOTHING, 0)   # English UI only
sk.InsertSketch(True)
sk.CreateCornerRectangle(-0.030, -0.020, 0, 0.030, 0.020, 0)                    # 60 x 40 mm
feat = fm.FeatureExtrusion3(True, False, False, 0, 0, 0.010, 0.0,               # blind, 10 mm
                            False, False, False, False, 0.0, 0.0,
                            False, False, False, False,
                            True, True, True, 0, 0.0, False)
assert feat is not None, "extrude returned Nothing"

ok = model.ForceRebuild3(False)
mp = ext.GetMassProperties2(1, byref_i4(), False)     # [CoM xyz, Volume m^3, Area, Mass, ...]
volume_mm3 = mp[3] * 1e9

err, warn = byref_i4(), byref_i4()
model.ClearSelection2(True)
sw.SetUserPreferenceIntegerValue(SW_STEP_AP, 214)     # SW_STEP_AP: resolve swStepAP by name
ok = ext.SaveAs3(r"C:\luxas\jobs\J1\out\part.SLDPRT", 0, 1, NOTHING, NOTHING, err, warn)
ok = ext.SaveAs3(r"C:\luxas\jobs\J1\out\part.step",   0, 1, NOTHING, NOTHING, err, warn)
assert ok and err.value == 0, f"save failed: errors={err.value} warnings={warn.value}"
```

Things in that sketch that are guesses: the numeric value of `swDefaultTemplatePart`; whether
`FeatureExtrusion3` should be called while the sketch is still open (macro recordings do it that
way **[RECALLED]**); whether `SaveAs3` accepts `NOTHING` for both object arguments under late
binding (pySldWrap does this for the older `SaveAs2`).

### 3.3 Reading rebuild errors

```python
def whats_wrong(model):
    n = model.Extension.GetWhatsWrongCount          # late-bound: attribute access calls it
    if not n: return []
    f = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_VARIANT, None)
    c = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_VARIANT, None)
    w = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_VARIANT, None)
    model.Extension.GetWhatsWrong(f, c, w)
    return list(zip([x.Name for x in f.value], c.value, w.value))
```

Pattern from pySldWrap **[READ]**; note its author's comment "error codes seem incorrect", and
that it unpacks the three arrays in a different order from the help page (it reads the first as
warnings and the third as features). **The argument order must be checked on the machine**; the
help page order is Features, ErrorCodes, Warnings.

Also walk the tree: `feat = model.FirstFeature()` … `feat.GetNextFeature()`, calling
`feat.GetErrorCode2(isWarning)` on each. `swFeatureError_e`: 0 none, 1 unknown, 13 "Edge for
fillet/chamfer does not exist", 18 "Radius is too big", 30 "Feature would create a disjoint
body; direction may be wrong", 31 "Cannot locate end of feature", 37 "Bosses require one or
more closed contours that do not self-intersect", 71 `swFeatureErrorCutNotIntersectModel`.
**[READ]** CONST/swFeatureError_e

Suppress the rebuild dialog (vendor snippet, **[READ]** APIHELP/IModelDoc2~ShowFeatureErrorDialog):

```vb
bValue = swApp.GetUserPreferenceToggle(swShowErrorsEveryRebuild)
swApp.SetUserPreferenceToggle swShowErrorsEveryRebuild, false
swModel.ForceRebuild3
swApp.SetUserPreferenceToggle swShowErrorsEveryRebuild, bValue
```

and set `model.ShowFeatureErrorDialog = False` for per-feature errors.

---

## 4. Licences

- **Standalone (machine activation)**: "Before you can run SOLIDWORKS products on an individual
  computer, you must activate the license for that computer. Activation requires that you have
  internet or email access. After activation, you do not need to be online". If not activated,
  "SOLIDWORKS tries to activate it when you start the product" (a window at start-up). Activation
  "Can be performed immediately (recommended) or within 30 days of installation." **[READ]**
  https://help.solidworks.com/2025/english/SolidWorks/install_guide/c_administering_individual_licenses.htm
- **Annual reactivation**: "Starting with SOLIDWORKS 2022 and later, if you purchased a perpetual
  license of SOLIDWORKS, you must also reactivate the license once a year ... SOLIDWORKS prompts
  you to reactivate the perpetual license before the required reactivation date", with buttons
  "Reactivate Now" and "Remind Me Later". **[READ]** same page. For automation this is a modal
  window at start-up on some day each year.
- **SolidNetWork (floating)**: licence manager on one server, clients need TCP/IP to it; "allows
  the number of users to exceed the number of licenses". Borrowing removes a licence from the
  pool until returned. **[READ]**
  https://help.solidworks.com/2025/english/SolidWorks/install_guide/c_administering_licenses_using_SNL.htm
- **When no floating seat is free**: a "Network License Usage" dialog "opens when the server is
  out of licenses for a product", listing who holds them. **[READ]**
  https://help.solidworks.com/2025/english/SolidWorks/install_guide/HIDD_LICMGR_USAGEINFO.htm
  Message texts seen only in search excerpts **[SNIPPET]**: "Could not obtain a license for
  SOLIDWORKS Standard. Licensed number of users already reached"; "Could not obtain a license
  for SOLIDWORKS. Cannot connect to license server." (the second is on the vendor
  troubleshooting page **[READ]**
  https://help.solidworks.com/2025/English/SolidWorks/Install_Guide/c_troubleshooting_snl_licenses.htm ,
  cause "typically ... port settings"; log file `SNL_Manager_install_dir\lmgrd.log`).
- **Idle return (floating only)**: put `TIMEOUTALL seconds` (minimum 900) in
  `SolidNetWork_License_Manager_install_dir\Licenses\sw_d.opt`. **[READ]**
  https://help.solidworks.com/2025/english/SolidWorks/install_guide/t_monitoriing_license_idle_time.htm
- **One session per machine**: starting a second copy raises "A journal file could not be
  created. Auto recover will not work. Another session of SOLIDWORKS may already be running on
  this machine." and waits for a click. The same dialog appears after an abnormal exit that
  left the journal file behind, or when a hidden `SLDWORKS.exe` is still in Task Manager.
  **[READ-SUMMARY]** https://www.goengineer.com/blog/top-three-causes-solidworks-journal-file-warning
  Journal path: `C:\Users\<user>\AppData\Roaming\SOLIDWORKS\SOLIDWORKS <version>\swxJRNL.swj`
  **[SNIPPET]**.
- **A leftover process and the seat**: forum threads report `SLDWORKS.exe` staying in Task
  Manager after exit, and a network licence not being released after shutdown **[SNIPPET]**
  (https://3dswym.3dexperience.3ds.com/question/solidworks-user-forum/network-license-is-not-released-after-shutting-down-solidworks_JZJkGAmuQgas7DDa0CIgEg ).
  On a standalone licence nothing is "held" by a process; the harm is the journal dialog and
  attaching to a broken instance. **[RECALLED]** for that last sentence.
- **Licence type from code**: `swApp.GetCurrentLicenseType()` → `swLicenseType_e`. **[READ]**
- **Cloud-connected editions**: a PDM task host running "SOLIDWORKS Connected" must "log in at
  least every 7 days to keep the license active" **[SNIPPET]** (vendor help page title "Keeping
  PDM Task Hosts Running with SOLIDWORKS Connected"; I could not load the page body). Online
  licensing makes the licence follow a login rather than a machine **[READ-SUMMARY]**
  https://www.goengineer.com/blog/remote-access-to-your-solidworks-network-or-standalone-license
  A login prompt is another start-up modal.
- **Remote Desktop and standalone licences**: not established. Resellers describe RDP to an
  office workstation as a normal way to use SOLIDWORKS **[SNIPPET]**, and I found no vendor
  statement that a machine-activated licence refuses RDP sessions. The FlexNet "-103 Terminal
  Server remote client not allowed" error that other vendors' node-locked licences give was not
  found for SOLIDWORKS. Test on the machine.

### Supported Windows versions (**[READ]** https://www.solidworks.com/support/system-requirements, fetched 2026-10-09)

| | SOLIDWORKS 2025 | SOLIDWORKS 2026 | SOLIDWORKS 2027 |
|---|---|---|---|
| Windows 11, 64-bit | yes | yes | yes |
| Windows 10, 64-bit | yes | **no** | no |
| Windows Server 2025 (server products) | yes, from SW2025 SP3 | yes | yes |
| Windows Server 2022 | yes | yes | yes |
| Windows Server 2019 | yes | no | no |

Lifecycle table on the same page: Windows 11 supported from SW 2022 SP2, still active;
Windows 10 from SW 2015 SP5 to SW 2025 SP5. Notes on the page: "Windows Home Editions and
Windows To Go are not supported." "Apple Mac machines running Windows using Boot Camp are not
supported." Hardware: x86_64, 16 GB RAM (32 recommended), "Certified cards and drivers".
The server rows are for server products (PDM, licence manager); the client rows are what
matters for running SOLIDWORKS itself.

---

## 5. pywin32 pitfalls specific to SOLIDWORKS

1. **By-reference outputs need an explicit VARIANT under late binding.** pywin32's own
   documentation: without type information a method with an `[in,out]` parameter "does not work
   as expected ... no result came back", and the fix is
   `VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BSTR, "Hello")`, reading `.value` afterwards.
   **[READ]** https://raw.githubusercontent.com/mhammond/pywin32/main/com/win32com/HTML/variant.html
   Working SOLIDWORKS code does exactly this for `OpenDoc6`:
   `arg5 = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 2)`,
   `arg6 = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 128)`,
   `sw.app.OpenDoc6(arg1, arg2, arg3, "", arg5, arg6)`; and for `Save3`, `ActivateDoc3`,
   `SaveAs2`. **[READ]** pySldWrap source.
2. **`None` is not `Nothing`.** For object arguments that VBA passes as `Nothing` (the `Callout`
   of `SelectByID2`, `ExportData` of `SaveAs`), pySldWrap passes
   `VARIANT(pythoncom.VT_DISPATCH, None)`. **[READ]** A bare `None` typically raises
   `pywintypes.com_error: (-2147352571, 'Type mismatch.', None, <argument index>)`
   (DISP_E_TYPEMISMATCH) **[RECALLED]**. The TypeScript MCP server documents the same family of
   bug: "Never pass `null` to COM ... COM interprets `null` as `VT_NULL`, causing type mismatch
   errors." **[READ-SUMMARY]**
3. **Late binding turns zero-argument methods into attributes.** pySldWrap writes
   `model.EditRebuild3`, `sw.app.GetFirstDocument`, `model.GetPathName`, `model.GetNext` with no
   parentheses. **[READ]** Adding `()` under late binding then fails with
   `TypeError: 'bool' object is not callable` or `'str' object is not callable` **[RECALLED]**.
   Under early binding the parentheses are required. Pick one binding mode per script and state
   it in the methods sheet.
4. **Early binding (makepy).** pywin32 generates wrappers from a type library via
   `gencache.EnsureModule(typelibCLSID, lcid, major, minor)` or `makepy`; "use makepy.py with a
   -i option" to print the two lines to paste. **[READ]**
   https://raw.githubusercontent.com/mhammond/pywin32/main/com/win32com/HTML/GeneratedSupport.html
   With generated support, out-parameters come back as return values and
   `win32com.client.constants.swDocPART` style names resolve. For SOLIDWORKS the libraries are
   `sldworks.tlb` and `swconst.tlb` in the install folder; their GUIDs
   (`{83A33D31-27C5-11CE-BFD4-00400513BB57}`, `{4687F359-55D0-4CD3-B6CF-2EB42C11F989}`) are
   **[RECALLED]** and unverified. Safer: `tlb = pythoncom.LoadTypeLib(path)`,
   `a = tlb.GetLibAttr()`, `gencache.MakeModuleForTypelib(a[0], a[1], a[3], a[4])`
   **[RECALLED]**. Known cost of early binding with this API: many members return a plain
   `IDispatch` and need a cast to the right interface (`win32com.client.CastTo`) **[RECALLED]**.
   The enum help pages do not list numeric values for the user-preference enums ("See System
   Options and Document Properties"), so resolving constants by name from `swconst.tlb` is the
   only reliable source.
5. **`Dispatch` versus `DispatchEx`.** `Dispatch("ProgID")` first tries `pythoncom.connect`
   (the running instance) and falls back to `CoCreateInstance`; `DispatchEx` goes straight to
   `CoCreateInstanceEx`. **[READ]**
   https://raw.githubusercontent.com/mhammond/pywin32/main/com/win32com/client/dynamic.py and
   `.../client/__init__.py`. Because the vendor says creating the object "either creates a new
   SOLIDWORKS session or ... attaches to an existing" one, neither call guarantees a fresh
   process. To own a specific process, start `SLDWORKS.exe` and bind to `SolidWorks_PID_<pid>`
   in the Running Object Table (xCAD, CodeStack).
6. **Selection by name is exact, case-sensitive and language-dependent.** Help text in §3.1.
   Default plane and feature names follow the UI language: English "Front Plane", "Top Plane",
   "Right Plane", "Boss-Extrude1", "Sketch1"; a Simplified Chinese install shows 前视基准面 /
   上视基准面 / 右视基准面 and 凸台-拉伸1 / 草图1 **[RECALLED]**. Templates can also rename
   planes (forum thread "Trying to select renamed Front Plane" **[SNIPPET]**).
   Language-independent route: walk `FirstFeature` / `GetNextFeature`, keep those whose
   `GetTypeName2()` is `"RefPlane"`, take them by index (vendor "Select Plane Example"
   **[SNIPPET]**), and select with the feature's own `Select2`. The TypeScript MCP server reached
   the same conclusion: "Feature tree traversal over SelectByID2". **[READ-SUMMARY]**
7. **Face and edge picking by coordinates depends on the view.** Prefer geometry handles:
   `body.GetFaces()`, filter by normal and location, then select the handle; or build on
   reference planes so no face needs picking. Help text in §3.1.
8. **Template paths.** `NewDocument` needs a full path and returns `Nothing` silently if it is
   wrong. Default location is under `C:\ProgramData\SOLIDWORKS\SOLIDWORKS <year>\templates\`
   with localized file names (`Part.prtdot`; `gb_part.prtdot` on Chinese GB installs)
   **[RECALLED]**. Read the preference; if it is empty, fail with a clear message.
9. **Threads and COM apartments.** Call `pythoncom.CoInitialize()` in any worker thread that
   touches the API; do not share COM objects between threads **[RECALLED]**.
10. **Busy server.** While a modal dialog is open or SOLIDWORKS is rebuilding, calls can fail
    with `(-2147418111, 'Call was rejected by callee.', None, None)` (RPC_E_CALL_REJECTED) or
    `-2147417846` (RPC_E_SERVERCALL_RETRYLATER); after a crash,
    `(-2147023174, 'The RPC server is unavailable.', None, None)` or `-2147417848` (object
    disconnected) **[RECALLED]**. `swFileLoadError_e.swApplicationBusy = 8388608` is the API's
    own version: "File open is blocked when application is busy". **[READ]**

---

## 6. Failure modes of scripted use

| Failure | What the script sees | Counter | Source |
|---|---|---|---|
| Started from session 0 | `0x80080005 Server execution failed`, or a hang | run in the logged-on session (§2) | [READ] forum |
| Start-up modal: activation, yearly reactivation, login, licence usage, journal warning | the first COM call blocks or is rejected; no exception text names the dialog | worker enumerates top-level windows of the SOLIDWORKS pid, logs title and text, saves a desktop screenshot, fails the job with that text. Do not click blindly. | [READ] install guide; dialog watcher is my design |
| Missing or invalid default template | `NewDocument` returns `Nothing`; interactive message "The default templates are not valid. The problems can be resolved by correcting the default templates under the options dialog." | read `swDefaultTemplatePart`, check the file exists | NewDocument [READ]; message [SNIPPET] goengineer.com/blog/solidworks-default-templates-error |
| Template prompt | new-document dialog | toggle `swAlwaysUseDefaultTemplates` True | [READ] SO_DefaultTemplates |
| Dimension input box | `AddDimension2` blocks | `swInputDimValOnCreate` False | [READ] |
| Rebuild errors do not raise | feature call returns an object or `Nothing`; `ForceRebuild3` returns a bool; `Save3` succeeds with warning bit 1 (`swFileSaveWarning_RebuildError`) | after every feature: check for `Nothing`; before saving: `GetWhatsWrong` and per-feature `GetErrorCode2`; treat any error as job failure | [READ] |
| Feature creation "succeeds" with wrong direction | geometry differs, no error (cut default direction is opposite the sketch normal) | measure volume after each step against the expected delta | [READ] direction rule |
| Wrong units | part is 1000x too big; a "10" extrude is 10 m | metres everywhere | [READ] |
| Selection fails | `SelectByID2` returns False; the next feature call returns `Nothing` | assert on every selection | [READ] |
| Export while hidden or not active | `SaveAs3` False, error 4096; or a partial file | visible session; `ActivateDoc3` then export; `ClearSelection2` | [READ] |
| STL moved | STL coordinates shifted into positive space, so positions disagree with the model | set `swSTLDontTranslateToPositive` True, or check positions on STEP only | [READ] |
| STL units | exported in the user-preference unit, file carries none | set `swExportStlUnits` and record it beside the file | [READ] |
| Background session closes itself | closing the last document ends SOLIDWORKS; later calls give RPC errors | keep `UserControl` True or keep one document open | [READ] |
| Crashed or leftover `SLDWORKS.exe` | next start shows the journal dialog; `Dispatch` attaches to a zombie | record the pid (`GetProcessID`), `taskkill /pid <pid> /f` on timeout, check `tasklist` before each job, delete a stale `swxJRNL.swj` only when no process exists | journal [READ-SUMMARY]; cleanup is my design |
| Obsolete API from model memory | `FeatureFillet`, `FeatureLinearPattern5`, `SaveAs2`/`SaveAs4`, `Dimension.SystemValue` are marked obsolete; ComAct reports models "hallucinating non-existent API calls" | methods sheet lists the current calls; reviewer checks the saved file, not the script | [READ] / [READ-SUMMARY] |
| Add-ins absent | Toolbox, Simulation calls fail in a programmatically created session | `LoadAddIn` | [READ] |

---

## 7. Verification without SOLIDWORKS

No open-source library reads `.SLDPRT` geometry (it is a Parasolid stream in a proprietary
container) **[RECALLED]**. So the independent checker works on a neutral export.

**Who writes the export matters.** If the producing agent's own script writes the STEP file, a
producer bug (exporting a selection, the wrong configuration, a stale file) reaches the checker
unseen. Recommended: a fixed, harness-owned `export.py` on the Windows worker that takes only a
`.SLDPRT`/`.SLDASM` path, opens it read-only and silent, runs `ForceRebuild3`, records
`GetWhatsWrong`, `GetMassProperties2` and the feature-tree type names into `sw_report.json`,
then writes `.step` (AP214), `.x_t` and a binary STL in millimetres with
`swSTLDontTranslateToPositive` on. The producer never touches these files. The checker then
compares its own measurements with the task's expected values, and may cross-check against
`sw_report.json` as a second, differently-computed estimate.

### 7.1 STEP with CadQuery / OCP (exact B-rep)

```python
import cadquery as cq
wp = cq.importers.importStep("part.step")          # returns a Workplane
shape = wp.val()
assert shape.isValid()
vol_mm3 = shape.Volume()
bb = shape.BoundingBox()                           # xmin..xmax, xlen, ylen, zlen
n_solids = len(wp.solids().vals())
cyl = wp.faces("%CYLINDER").vals()                 # hole and boss walls
```

`cq.importers.importStep(path)` "returns a Workplane object"; the importer converts to
millimetres by default and takes a `unit` argument in current documentation. **[READ-SUMMARY]**
https://cadquery.readthedocs.io/en/latest/importexport.html (an older CadQuery may lack `unit`;
then lengths are whatever OCCT's STEP reader produced, normally mm). `BoundBox` has
`xmin/xmax/xlen` etc.; selector `"%CYLINDER"` filters faces by geometry type. **[READ-SUMMARY]**
https://cadquery.readthedocs.io/en/latest/classreference.html . That `Volume()`, `BoundingBox()`,
`isValid()`, `Center()` are methods is **[RECALLED]**.

Hole position and diameter from a cylindrical face **[RECALLED]** OCP calls:

```python
from OCP.BRepAdaptor import BRepAdaptor_Surface
for f in cyl:
    c = BRepAdaptor_Surface(f.wrapped).Cylinder()
    r = c.Radius(); p = c.Axis().Location(); d = c.Axis().Direction()
    # (p.X(), p.Y(), p.Z()) is a point on the axis, (d.X(), d.Y(), d.Z()) its direction
```

A through-hole usually appears as one or two cylindrical faces sharing an axis; group by axis
before counting. Whether a cylinder is a hole or a boss: test a point on the axis with
`BRepClass3d_SolidClassifier` (outside the solid = hole).

Interference in an assembly without SOLIDWORKS: import the assembly STEP, take the solids, and
compute `a.intersect(b).Volume()` for each pair; nonzero volume above a tolerance is an
interference. Coincident faces give zero volume, which matches SOLIDWORKS with
`TreatCoincidenceAsInterference = False`.

### 7.2 STL with trimesh (tessellated, approximate)

```python
import trimesh
m = trimesh.load("part.stl")
assert m.is_watertight                 # "If the current mesh isn't watertight this is garbage."
vol, bounds, extents = m.volume, m.bounds, m.extents
parts = m.split()
```

Quoted warning and property list **[READ-SUMMARY]** https://trimesh.org/trimesh.base.html .
STL carries no units. Curved faces are faceted, so compare volume with a tolerance tied to the
export deviation (order 0.1–1 %), not exactly.

### 7.3 Blender

Already in the project. `bpy.ops.wm.stl_import(filepath=...)` (4.x) then `bmesh` `calc_volume()`
and `obj.bound_box` **[RECALLED]**. Same caveats as trimesh; no STEP import without an add-on.

### 7.4 What the checker cannot see

STEP has no feature tree, sketches, dimensions, equations or mates. "Is it parametric", "does
changing D1 move the hole", "is the pattern a pattern" need SOLIDWORKS. Two ways to keep some
independence: (a) the harness-owned script changes a named dimension, rebuilds and re-exports,
and the checker measures both exports; (b) the Document Manager API for names and properties
only. The producer's own printed numbers are never evidence.

---

## 8. Prior art

| Work | Interface | Result | Provenance |
|---|---|---|---|
| **ComAct / ComCADBench** (arXiv 2606.13239, June 2026) | Python `win32com.client` driving SolidWorks, Inventor and AutoCAD in Dockerized Windows; 1,000 tasks (400 single, 600 multi, including modelling + drawing and assembly + interference detection); scored by Chamfer distance to ground truth | GUI agents (GPT-5, Qwen) 0.0 % in every category; COM zero-shot GPT-5 24–71 % valid, 7–33 % success; COM few-shot Claude Sonnet 76–96 % valid, 52–88 % success; their trained model 84–98 % valid, 58–98 % success. Failure notes: code that runs but violates geometry ("syntax-geometry gap"); retrieved API snippets lowered scores; hallucinated API names. | [READ-SUMMARY] https://arxiv.org/abs/2606.13239 , https://arxiv.org/html/2606.13239 |
| **CADWorld** (arXiv 2609.16251, Sept 2026) | Screenshots + GUI actions in FreeCAD; 200 tasks, 11 categories; checks on saved artifacts | best agent 17.5 %, expert reference 87.0 %. "weaker agents often fail before producing a valid artifact, whereas stronger agents increasingly fail on structural, geometric, and construction-process requirements" | [READ-SUMMARY] https://arxiv.org/abs/2609.16251 |
| **ProSoftArena** (arXiv 2601.02399, CVPR 2026) | GUI (screenshots, accessibility tree, set-of-marks); 436 tasks, 13 applications including SolidWorks and AutoCAD | best agent 24.4 % on single-application tasks (L2), 0 % on multi-application pipelines (L3); L1 best reported as 45.9 %. CAD tools named among the poorly performing applications. Per-application SolidWorks numbers were not recovered reliably. | [READ-SUMMARY] https://arxiv.org/html/2601.02399v1 |
| **BenchCAD** (arXiv 2605.10865, May 2026) | CadQuery code; 17,900 verified programs, 106 part families | models "replac[e] essential operations such as sweeps, lofts, and twist-extrudes with simpler sketch-and-extrude patterns" and misread design parameters | [READ-SUMMARY] https://arxiv.org/abs/2605.10865 |
| Text-to-CAD line (Text2CAD, CAD-Coder, CAD-Recode, cadrille, CADCodeVerify/CADPrompt) | CadQuery or command-sequence generation, mostly fine-tuned small models; scored by Chamfer distance or IoU | not directly comparable; CADCodeVerify adds a visual feedback loop and reports a 5.5 % compile-rate gain for GPT-4 | [SNIPPET] |
| **SolidworksMCP-TS** (vespo92; npm `solidworks-mcp-server`) | Node + winax COM, with generated VBA macros as fallback | "Simple operations (12 params or fewer) - Direct COM call via winax. Complex operations (13+ params) - Auto-generated VBA macro". Status "Alpha / Experimental"; "most tools have not been validated against a live SolidWorks instance"; "No CI integration testing - Tests only run against mocks." Targets SolidWorks 2021–2025; needs SOLIDWORKS running. | [READ-SUMMARY] https://github.com/vespo92/SolidworksMCP-TS , https://cdn.jsdelivr.net/npm/solidworks-mcp-server@3.1.3/README.md |
| Other MCP servers (arhamgarg/solidworks-mcp, alisamsam/solidworks-mcp, tylerstoltz/sw_mcp for SolidWorks 2020) | Python + pywin32; some have the LLM emit a pywin32 script | no success numbers found | [SNIPPET] |
| **pySldWrap** (PyPI 0.2) | pywin32, late binding, explicit VARIANTs | "Before running a script, SolidWorks should be opened." Covers open, edit dimension, rebuild, STEP export, mass properties. | [READ] https://github.com/ThomasNeve/pySldWrap |
| **xCAD.NET** (Xarial) | C#; starts the process with switches and binds through the ROT | source of the `/b`, `/r`, `/SWSafeMode` constants | [READ] |
| cua driver | named-pipe daemon in the interactive session, driven over ssh | the session-0 workaround in product form | [READ-SUMMARY] |

Reading across these: script-through-COM beats GUI by a wide margin on real CAD; the dominant
script failures are wrong or outdated API names, selections that silently fail, and code that
runs but builds the wrong geometry. All three are caught only by measuring the saved artifact.

---

## 9. Runner design notes

**Windows side (once, by a person at the desktop):** install SOLIDWORKS and activate it; start it
by hand once and dismiss every first-run dialog; confirm default templates; set English UI if
possible; install Python + pywin32; create `C:\luxas\{queue,jobs,worker}`; configure Autologon;
disable sleep, lock and screensaver for the worker account; register the logon task (§2.2 A);
install OpenSSH Server and the key.

**Worker (session 1, one process):**
1. Poll `C:\luxas\queue\*.json` (written by rename, so it is never half-read).
2. Take the seat lock: a named mutex plus `C:\luxas\seat.lock` holding job id, pid and a
   heartbeat timestamp. One job at a time; one `SLDWORKS.exe` at a time.
3. Pre-flight: no stray `SLDWORKS.exe` (kill and log if found); start SOLIDWORKS; wait for
   `StartupProcessCompleted` with a generous timeout (minutes on a cold start); record
   `GetProcessID`, `RevisionNumber`, `GetCurrentLicenseType`, `swUseSimpleOpenGL`.
4. Run the job script as a **child process** with a wall-clock limit, stdout/stderr to files.
   The child attaches with `Dispatch`.
5. A watchdog thread lists top-level windows owned by the SOLIDWORKS pid every few seconds. A
   new dialog-class window means: write its title and text into `status.json`, save a desktop
   screenshot, kill the child, and (by policy) restart SOLIDWORKS.
6. After the child exits, run the harness-owned export script (§7) on the declared outputs.
7. Write `status.json` last, atomically: state (`done`, `failed`, `timeout`, `dialog`,
   `no_licence`, `no_session`), exit code, timings, SOLIDWORKS version, the list of output files
   with sizes and hashes.
8. Release the lock. Restart SOLIDWORKS every N jobs or on any failure.

**Linux/macOS side:** `scp` the job directory; `scp` the queue file under a temporary name then
`ssh host ren`; poll `ssh host type C:\luxas\jobs\<id>\status.json` with short calls; `scp` the
results back. Health probe before submitting: `ssh host query user` (a session in state
`Active` or `Conn` for the worker account), `tasklist` for the worker, and the heartbeat age in
`seat.lock`. If there is no interactive session, report `no_session` and stop; do not retry.

**States the runner must distinguish** (each has a different owner): no desktop session
(operator); licence or activation dialog (operator); seat busy (wait); script error (producing
agent); rebuild errors in the saved model (producing agent); timeout or crash (retry once, then
operator).

---

## 10. Not established; must be tested on the machine

1. Does `Dispatch("SldWorks.Application")` from the ssh shell fail fast with `0x80080005`, hang,
   or (if a session-1 instance is already running) attach to it across sessions?
2. Does a `/it` task started with `schtasks /run` from ssh land on the autologon desktop on this
   Windows 11 build, and does it survive a locked console?
3. Does SOLIDWORKS COM automation keep working with the console locked, or after an RDP
   disconnect without `tscon`?
4. Does a machine-activated standalone licence start inside an RDP session?
5. Which start-up dialogs appear on this install (activation, reactivation, login for a
   cloud-connected edition, "What's new", crash-recovery, journal warning) and their exact
   window titles.
6. Meaning and effect of `/r`, `/b`, `/SWSafeMode`, `/SWDisableExitApp` on SOLIDWORKS 2025/2026;
   whether `/m` accepts a text `.swb`; whether `/m` runs before or after add-ins load.
7. Numeric values of `swDefaultTemplatePart`, `swStepAP`, `swSTLBinaryFormat`,
   `swExportStlUnits`, `swSTLDontTranslateToPositive`, `swShowErrorsEveryRebuild`,
   `swInputDimValOnCreate`, `swAlwaysUseDefaultTemplates` (read them from `swconst.tlb`).
8. Type-library GUIDs and whether `gencache.EnsureDispatch("SldWorks.Application")` works.
9. `GetWhatsWrong` argument order and whether the by-reference VARIANT pattern returns usable
   arrays in pywin32.
10. Whether `SaveAs3` to STEP/STL works with `Visible = False`, and whether `SaveBMP` gives a
    non-black image under software OpenGL, in a `tscon` console session, and with no monitor.
11. Whether `FeatureExtrusion3` must be called with the sketch still in edit mode.
12. Cold-start time of SOLIDWORKS on the machine (sets the worker's start timeout).
13. UI language of the install, and therefore the plane, feature and template names.
14. Whether killing `SLDWORKS.exe` releases a floating seat at once, and whether it leaves the
    journal dialog for the next start.
15. Edition and licence type actually purchased (standalone, SolidNetWork, or a
    3DEXPERIENCE-connected edition that requires a periodic login).
16. Per-application SolidWorks success rates in ProSoftArena, and per-software breakdown in
    ComCADBench (I only have summarised ranges).
