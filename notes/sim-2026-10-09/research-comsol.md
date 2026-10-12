# Driving COMSOL Multiphysics from scripts on Windows 11 over OpenSSH — research notes

Researched 2026-10-09. Nothing here has been run on a COMSOL machine by us. Every item is **unverified until tried**.

Provenance labels used on every fact:

- **[READ]** — I read it on the cited page in this session (vendor docs, library docs, library source, issue tracker).
- **[READ-3P]** — read this session, but the source is a third party reporting its own experience (not the vendor, not the library author).
- **[SNIPPET]** — seen only in a search-engine result summary; the page itself was not readable (COMSOL forum posts need a login).
- **[RECALLED]** — from memory, not confirmed on a page this session.
- **[INFERENCE]** — my reasoning from the facts above; no source states it.

---

## 0. Recommended route and the three facts most likely to bite

**Route.** Two channels, both plain processes started from a script file that the runner pushes to the Windows machine:

1. **MPh (Python, `pip install MPh`) for anything that builds, edits or measures a model.** One Python process = one COMSOL session. It is the only route where a single script can load, set a parameter, build, mesh, solve, evaluate to a NumPy array, export, and save, and where the independent checker can re-open the saved `.mph` and evaluate from the stored solution without re-solving.
2. **`comsolbatch.exe -inputfile in.mph -outputfile out.mph -batchlog log.txt` for a long solve of an already-built model.** Fresh process, progress lines in a log file, documented stop/cancel commands.

`comsolcompile` + Java class is a third option that needs no Python, but two of its properties make it worse for an agent: no typed node classes (compile errors), and a third party reports that file writes from the class are blocked by COMSOL's security settings.

**Three facts most likely to bite**

1. **The licence type decides whether the ssh route is allowed and whether it works at all.** A CPU-locked licence "may not be accessed or used over a network or remotely" [READ]. A named-single-user licence may be used through "a single encrypted connection providing secure remote access" [READ]. Only the floating network licence is unrestricted for remote use. Separately, FlexNet refuses uncounted node-locked licences inside a Windows Terminal Services guest session (error -103) [READ-3P, non-COMSOL vendors]; whether an OpenSSH session trips that check on COMSOL is not documented anywhere I could find.
2. **Windows OpenSSH kills every process the session started when the session ends.** This is by design (a job object with kill-on-close) [READ, Win32-OpenSSH maintainers]. A solve started with `start`/`Start-Process` dies on disconnect. The job must be launched through Task Scheduler or with the breakaway flag, or the ssh connection must stay open for the whole run.
3. **Image export is the one step with no vendor statement that it works without a desktop.** COMSOL renders exported images "using the graphics card" by default [READ]; MPh starts its server with `-graphics` [READ, source]; a third party that runs COMSOL 6.4 on Windows writes "PNG export has been unreliable in known Windows setups" [READ-3P]. Treat numbers and exported data as the evidence, and test PNG export on the machine before any prompt promises it.

---

## 1. Ways to run COMSOL without the Desktop

Current version for all command tables below: **COMSOL 6.4** (reference manual, "COMSOL Commands on Windows").
Source for 1.1–1.3 unless stated: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_running.38.31.html **[READ]** (fetched as HTML and read in full).

### 1.0 Where the executables are

- "The commands are available in the `bin\win64` subdirectory in the COMSOL installation directory." [READ]
- Default install root on Windows for 6.4: `C:\Program Files\COMSOL\COMSOL64\Multiphysics` [READ — appears in KB 1142, KB 903 and the Java-heap page]. So: `C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe`.
- Registry: `HKEY_LOCAL_MACHINE\SOFTWARE\COMSOL\COMSOL64\`, value name `COMSOLROOT`, holds the install path [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_api_intro.46.12.html].
- General syntax: `<command> [<target>] [<options>] [<target arguments>]`. Options go "between the command and the target (if any)" [READ].
- Per-launcher `.ini` files sit next to each `.exe` (`comsolbatch.ini`, `comsolmphserver.ini`, …); a system property is added as a line `-Dopt = val` [READ].

Launchers [READ, Table 22-1]: `comsol`, `comsolbatch`, `comsolcompile`, `comsolmphserver`, `comsolmphclient`, `comsolmphserver matlab` (needs LiveLink for MATLAB), `comsoldoc`, `comsolpowerpointbatch`, `comsoltrust`, `comsolxpl`, and the cluster ones (`comsolcluster*`, all require a floating network licence).

### 1.1 General options, valid for every command [READ, Table 22-2]

| Option | Text from the manual |
|---|---|
| `-np <no. of cores>` | "Number of cores." Default is all available cores. |
| `-numasets <no. of sets>` | "Number of NUMA sets." `-numasets 1` = the whole computer. |
| `-mpmode throughput \| turnaround \| owner` | Multiprocessor mode. `throughput` when other processes are active; `turnaround` when none are; `owner` "highest performance in most cases". |
| `-tmpdir <path>` | "Temporary file directory." Alternative: environment variable `COMSOL_TMPDIR`. |
| `-prefsdir <path>` | "Preference directory." |
| `-recoverydir <path>` | "Path to recovery directory. The recovery directory is by default a subdirectory to the preference directory." |
| `-autosave {on} \| off` | "Control saving of recovery files." |
| `-configuration <path>` | State/cache directory. "When running in batch or cluster mode, add @process.id to get a unique identifier to the path." |
| `-data <path>` | Workspace directory. "The workspace directory is cleared when COMSOL is launched." Same `@process.id` advice. |
| `-3drend ogl \| sw` | "3D renderer: OpenGL or software rendering." |
| `-c <path>` | "License file path." |
| `-ckl` | "Use class-kit license." |
| `-comsolinifile <path>` | Custom `.ini` path. |
| `-alloc {scalable} \| native` | Memory allocator. |
| `-blas {auto} \| mkl \| aocl \| blas \| path` | BLAS library. |
| `-keeplicenses on \| {off}` | "Keep checked-out licenses when creating or opening an application." |
| `-gpuid`, `-hwacc cpu \| gpusingle \| gpudouble \| off` | GPU selection / hardware acceleration. |
| `-v`, `-version` | "Print COMSOL version." |
| `-h`, `-help`; `<target> -h` | General / target-specific help. |

### 1.2 `comsolbatch` [READ, Table 22-9 and the sections after it]

"Use the COMSOL batch command to run COMSOL jobs without a user interface. Run both Model MPH files and model files for Java with the COMSOL batch command. Model files for Java need to be compiled before running."

Syntax: `comsolbatch [<options>] [<target arguments>]`

| Argument | What the manual says |
|---|---|
| `-inputfile <filename>` | "Run a Model MPH file or class file." (also `dbmodel:///` URIs) |
| `-outputfile <filename>` | "Save a Model MPH file using the given filename. **If output is not given, the input file is overwritten with the output.**" |
| `-study <study tag>` | "The study to compute." Tag, not label (e.g. `std1`). Tags via `model.study().tags()`. |
| `-job <job tag>` | "The batch job to run." Tags via `model.batch().tags()`. |
| `-pname <names>` / `-plist <values>` | Comma-separated global parameter names / values. `-pname a,b -plist 1,2` ≡ `model.param().set("a",1); model.param().set("b",2);`. "**the model is saved with a new name that contains the parameter tuple**". Several tuples (`-plist 1,2,3,4`) "will be saved in multiple files". "**only applicable for MPH files; they have no effect when running class files.**" |
| `-pindex <indices>` | Use `_<index>` as filename suffix instead of `_<parameter name>_<parameter value>`. |
| `-paramfile <filename>` | Table: names on row 1 (space separated), one value tuple per following row. CSV (RFC 4180) also accepted. |
| `-error {on} \| off` | "Stop if an error occurs." Only applies to multi-tuple `-plist`/`-pname`. |
| `-batchlog <filename>` | "Sets the location for log output… If not used, the log appears in the command window." |
| `-batchlogout` | "Log to standard out when storing on file." |
| `-methodcall <tag> <filename>` | "Run a method call with the given tag. The file in <filename> contains the method call." |
| `-nosave` | "Do not save the resulting model." |
| `-norun` | "Do not compute the model." Useful with `-clearsolution`/`-clearmesh`. |
| `-clearmesh`, `-clearsolution`, `-resethistory` | Clear meshes; clear solutions (except probe data); compact history before saving. |
| `-createplots` | "Create default plots when running." |
| `-graphics` | "Start COMSOL batch with graphics libraries. This displays plots during analysis." |
| `-checklicense <filename>` | "Print license requirements for a Model MPH file." |
| `-usebatchlic` | "Use batch license (requires batch licenses)." Equivalent to the "Use batch license" checkbox in Cluster Computing / Cluster Sweep. |
| `-mode {batch} \| desktop` | `batch` (default): Batch and Cluster Computing settings in the model are ignored. |
| `-client`, `-host <hostname>`, `-port <port number>` | Run batch as a client of a server. "Unless running in -mode desktop, the server must also be started with -mode batch." |
| `-recover` | "Recover and continue computation." |
| `-continue` | "Continue computing an interrupted batch job." |
| `-stop`, `-cancel` | Stop / cancel a running job (see below). |
| `-stoptime <seconds>` | "Stop the batch job after a certain time (in seconds)." |
| `-alivetime <seconds>` | "The time between writing status on disc." |
| `-jobfile <filename>` | Text file of `<inputfile> <outputfile>` pairs, run consecutively; "the list can be updated continuously during the batch process". |
| `-outputdir` | Where files produced by the run are stored; default is the directory of the output model. |
| `-classpathadd <classpath>`, `-dev <filename>` | Extra classpath; JAR with extra classes for a batch class file. |
| `-prodargs` | Extra arguments, placed last. |

Documented examples [READ]:

```bat
comsolbatch -inputfile in.mph -outputfile out.mph -study std1
comsolbatch -stop <level> -inputfile <filename>
comsolbatch -cancel -inputfile <filename>
```

- Stop: "`<level>` is the level to stop the process on. Set the level to a high value in order to stop as soon as possible. By default, it is set to 100." The `-inputfile` given to `-stop`/`-cancel` must be the same as the one that launched the job, "or the -inputfile should be the same as the -outputfile specified to launch another process." [READ]
- `-recover`: "the working directory (where all .log, and .status files are generated) will contain the recovery file… If the -recover option is specified, the model from the recovery directory will be opened. If opening that model succeeds, a continue operation will be performed; otherwise, the input filename model will be simulated." [READ]
- "It is not possible to run model files protected with a password using the comsolbatch command." [READ]
- From the COMSOL blog (Walter Frei, 2020-12-09) [READ, via page summary]: `comsolbatch -inputfile my_file.mph -pname tbb,Vtot -plist "1[cm]","10[mV]" -methodcall my_method -nosave`. https://www.comsol.com/blogs/how-to-run-comsol-multiphysics-from-the-command-line
- Log content [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_running.38.08.html]: lines of the form `Memory: RAM/MAXRAM VIRT/MAXVIRT` (MB; "The log only reports changes to the memory usage") and `Current Progress: 53%`.
- What a batch run solves [READ]: "solves the model in the Model MPH file … using the active solver settings in the model". The model must already contain a study; batch does not create one.

### 1.3 `comsolcompile` + running a compiled class through `comsolbatch`

- Syntax [READ]: `comsolcompile [<options>] [<target arguments>] <file>.java`. Arguments: `-classpathadd <classpath>`, `-jdkroot <path>` ("Path to the JDK root."), `-verbose`.
- 6.4 getting-started text [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_api_intro.46.07.html and .11.html]:

```bat
<COMSOL path>\bin\win64\comsolcompile feeder_clamp.java
<COMSOL path>\bin\win64\comsolbatch -inputfile feeder_clamp.class
```

  The 6.4 page shows no `-jdkroot`; an older mirror of the same page told users to install a JDK first [SNIPPET]. Whether 6.4 needs a separate JDK is **not established** (system requirements list "COMSOL API for use with Java: JDK 8 and 11" and say COMSOL ships OpenJDK 21.0.7+6 [READ — https://www.comsol.com/system-requirements]).
- Required shape of the file [READ — comsol_api_intro.46.08.html]:

```java
import com.comsol.model.*;
import com.comsol.model.util.*;

public class feeder_clamp {
  public static void main(String[] args) { run(); }
  public static Model run() {
    Model model = ModelUtil.create("Model");
    ...
    return model;
  }
}
```

- "saving it as a model file for Java, the file does not contain a `runAll` command for the solver sequence. To run a solver sequence, add a line similar to `model.sol("sol1").runAll();` … above the line that contains `return model;`." [READ]
- `-pname`/`-plist` do nothing for class files [READ, see 1.2]. Parameters must be set in the Java source.
- Pitfalls reported by sim-plugin-comsol's bundled skill [READ-3P — https://github.com/svd-ai-lab/sim-plugin-comsol `…/base/reference/java_batch_patterns.md`]:
  - Typed declarations (`Component comp = …`, `Geometry geom = …`, `HeatTransfer ht = …`) fail with `cannot be resolved to a type`. Use chain style only: `model.component("comp1").geom("geom1").create("i1","Interval");`. "It is not a classpath problem."
  - "`comsolbatch` runs your class in a sandbox that **blocks `java.io.FileWriter`** (security manager). Always print KPIs to stdout", then redirect: `comsolbatch.exe -inputfile MyModel.class -nosave > comsol.log 2>&1`. This matches the vendor's security preference "File system access: Temporary and application files (the default)" for "methods and Java libraries" [READ — comsol_ref_running.38.10.html], but the vendor page does not say it applies to batch class files.
  - "Do not rely on `comsolbatch -inputfile model.mph -outputfile model.java` for source export. Verified on 2026-05-19 with COMSOL 6.4: that command saved a COMSOL `.mph` ZIP container with a `.java` filename". Use `model.save(path, "java")`.

### 1.4 `comsolmphserver` + a client

Server [READ, Table 22-7]: `comsolmphserver [<options>] [<target arguments>]`. "A COMSOL Multiphysics server listens for TCP/IP connections from COMSOL Multiphysics clients."

| Argument | Text |
|---|---|
| `-port <port>` | TCP port to listen on, "or 0 for a random free port". Default port is **2036**. |
| `-portfile <path>` | "COMSOL Multiphysics writes its server port to the given <path> when it has started listening." |
| `-login {info} \| force \| never \| auto` | "`info` means that only missing information is asked for. `force` resets the password. `never` requires that the login information is available. `auto` automatically creates a new username and password." |
| `-passwd reset \| nostore` | New password / do not store it on file. |
| `-user <user>` | Login name. |
| `-multi {auto} \| on \| off` | "Accept repeated client connections." |
| `-silent` | "Do not listen to standard input." |
| `-graphics` | "Start the server with graphics libraries. This displays plots on the server when you are connected with a client (that is, not with the COMSOL GUI)." |
| `-mode batch \| {desktop}` | Ignore Batch and Cluster Computing settings or use them. |

Facts that matter for a headless runner:

- First start is interactive: "When a COMSOL Multiphysics server is started for the first time, you are asked for a username and password." Login is written to `.comsol/v64/login.properties` "in your Windows home directory" [READ]. `-login auto` avoids the prompt (this is what MPh and sim-plugin-comsol pass).
- "The COMSOL Multiphysics server is a single-user server allowing multiple connections by the same user." "Both client and server should be started by the same system user. The COMSOL Multiphysics server is not designed to run as a service, serving multiple users." [READ — comsol_ref_running.38.04.html, .17.html]
- Client and server on the same computer works "with all available license types: named single user license (NSL), CPU-locked license (CPU), and floating network license (FNL)". On different computers "requires a floating network license (FNL)". [READ — comsol_ref_running.38.14.html]
- The vendor describes terminal use on Windows: "In some Windows versions, Microsoft provides a Telnet Server with which you can log in through a terminal window. When using a terminal window to log in on Windows, use the comsolmphserver command to start the COMSOL Multiphysics server." [READ] — the only vendor sentence I found that speaks to a non-desktop login on Windows.
- The TCP link is authenticated (challenge handshake) but "otherwise not encrypted" [READ].
- Client side, Java API [READ — ModelUtil reference, https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/api/com/comsol/model/util/ModelUtil.html]: `ModelUtil.connect("localhost", 2036)`, `ModelUtil.disconnect()`, `ModelUtil.load(tag, path)` (reads the file on the client), `ModelUtil.loadOnServer(tag, path)` (reads on the server), `ModelUtil.initStandalone(false)` for no-server use ("guiSupport - is true if support for plotting in a GUI should be available"), `ModelUtil.showProgress(String fileName)` ("Specifies file to log progress to"), `ModelUtil.hasProduct(...)`, `ModelUtil.checkoutLicense(String... product)` ("If not all required products can be checked out, no products are checked out"), `ModelUtil.checkoutLicenseForFile(file)`, `ModelUtil.setPreference(name, value)`, `ModelUtil.listPreferences()`, `ModelUtil.loadRecovery(tag, folder)`, `ModelUtil.getComsolVersion()`.
- LiveLink for MATLAB [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.llmatlab/llmatlab_ug_start.5.4.html and .5.5.html]: `comsolmphserver.exe matlab filename` runs an M-file; "Running without Display": `comsolmphserver.exe matlab -nodesktop -mlnosplash`; manual connect from MATLAB with `mphstart`, `mphstart(<portnumber>)`, `mphstart(<ipaddress>, <portnumber>, <username>, <password>)`; a remote server needs FNL. Needs a MATLAB licence and the LiveLink licence, so it is not the recommended route.

### 1.5 MPh (Python package `MPh`, import name `mph`)

Sources: docs https://mph.readthedocs.io/en/stable/ (installation, tutorial, demonstrations, limitations, API, releases) **[READ]**; source `mph/session.py`, `mph/server.py`, `mph/client.py`, `mph/model.py`, `mph/discovery.py` on `main` **[READ]**; PyPI JSON https://pypi.org/pypi/MPh/json **[READ]**.

**Versions**

- Latest: **MPh 1.4.0, published 2026-08-30**; `requires_python >= 3.10`; dependencies `jpype1`, `numpy` [READ, PyPI]. 1.3.0 (2025-10-30) dropped Python 3.6–3.9 [READ, releases].
- COMSOL: "Comsol versions 6.0 and newer are expected to work. Up to version 6.3, they have been successfully tested." 5.5/5.6 "may work if you manually downgrade JPype: `pip install "jpype1<1.6"`" [READ, installation]. The maintainer wrote on 2026-05-08 that he "cannot reproduce" a 6.4 load failure and "It all works as it has before" on 6.4 [READ, issue #251]. sim-plugin-comsol's notes call 6.4 "Latest tested as of 2026 Q1. Drives cleanly via mph 1.2.x" [READ-3P].
- Python: must be 64-bit; the Microsoft Store Python has caused problems (issue #57), use python.org installers [READ]. JPype had no wheels for Python 3.14 in November 2025 (issue #243) [READ]; current `jpype1` on PyPI is 1.7.1 [READ] — whether it has 3.14 Windows wheels was not checked.
- "A separate Java run-time environment is not required as Comsol ships with one already built in." [READ]
- Maintenance risk: open issue #245 "Maintenance note" (2025-12-07): the maintainer no longer uses COMSOL for work and asks users to take over testing [READ].

**How it starts / attaches** [READ, source + docs]

- `mph.start(cores=None, version=None, port=0)` returns a `Client`. Since MPh 1.3.0 the default on Windows is **client–server mode** (option `'session'` = `'client-server'`): it launches a `Server` subprocess and connects a thin client over loopback. "It takes roughly ten seconds for the client to spin up."
- Exact server command MPh runs (source, `server.py`): `comsolmphserver.exe -login auto -graphics -autosave off [-ckl] [-np N] [-port P] [-multi on|off]` + any `arguments=[...]` given to `mph.Server(...)`, with `stdin=PIPE, stdout=PIPE` and, on Windows, `CREATE_NO_WINDOW` (added in 1.4.0, issue #260). It waits for a stdout line matching `^COMSOL.* \(.*\) .*?(\d{4,5}).*$` to learn the port; default start-up timeout 60 s.
- **Stand-alone mode** (`mph.option('session', 'stand-alone')` before `mph.start()`, or `mph.Client()` with no port): JPype starts the JVM named in `comsol.ini` with classpath `<root>\plugins\*`, then calls `ModelUtil.initStandalone(False)` and `ModelUtil.loadPreferences()`, then sets preferences `updates.update.check=off`, `tempfiles.recovery.autosave=off`, `tempfiles.recovery.checkforrecoveries=off`, `tempfiles.saving.optimize=filesize`, `tempfiles.saving.warnifoverwriteolder=off`. Works "out of the box" on Windows only. Faster start, less per-call overhead. Core count via env `COMSOL_NUM_THREADS`.
- **Attach to an existing server**: `mph.Client(port=2036, host='localhost')` → `ModelUtil.connect(host, port)`; classpath `<root>\apiplugins\*`. `client.disconnect()`: "the server, unless started with the option `multi` set to `'on'`, will shut down as soon as the client disconnects."
- Discovery on Windows: registry `HKLM\SOFTWARE\Comsol\<node>`, plus whatever `comsol` resolves to on `PATH`. Error when nothing is found: `Could not find a supported Comsol installation.` (older: `Could not locate any Comsol installation.`).
- One client per Python process: `NotImplementedError: Only one client can be instantiated per Python session.` Parallel runs = separate Python processes (docs demo uses `multiprocessing`, four workers each `mph.start(cores=1)`).
- Shutdown: MPh registers an `atexit` handler that disconnects and then calls `java.lang.Runtime.exit(exit_code)`; "No Python code is reached from here on." It monkey-patches `sys.exit` and `sys.excepthook` so the process exit code is 0, the `sys.exit(n)` value, or 1 after an uncaught exception [READ, `session.py`]. "pressing Ctrl+C to interrupt an ongoing operation will usually crash the Python session" [READ, limitations].
- Class-kit licence: `mph.option('classkit', True)` before `mph.start()`.
- Licence stance: "MPh wants nothing to do with that complication… This is true for the most common license types: 'CPU-Locked' and 'Floating Network'." [READ]

**Model API used below** [READ, API page + source]

- `client.load(path)`, `client.create(name)`, `client.remove(model)`, `client.clear()`, `client.modules()`.
- `model.parameter(name, value)`; `model.parameter(name, evaluate=True)` returns the number; `model.parameters(evaluate=True)`.
- `model.build(geometry=None)`, `model.mesh(mesh=None)`, `model.solve(study=None)` — by **name (label)**, not tag.
- `model.evaluate(expression, unit=None, dataset=None, inner=None, outer=None)` → NumPy array(s). Raises `RuntimeError: The solution has not been computed.` if the dataset's solution is empty. Tries a global evaluation first and silently falls back to a field evaluation, so a typo in a global expression surfaces as the *second* error.
- `model.export(node=None, file=None)`; `model.exports()`, `model.datasets()`, `model.studies()`, `model.problems()`.
- `model.save(path=None, format=None)` — formats "Comsol", "Java", "Matlab", "VBA" or by extension; "Overwrites existing files"; with no path it overwrites the file the model was loaded from.
- `model.clear()` (clears plot data, solutions via `clearSolutionData()`, meshes) and `model.reset()` (`resetHist()`).
- `model.java` is the raw `com.comsol.model.Model`; any node's `.java` is its Java object. Everything in the Java API is reachable.

### 1.6 Minimal MPh script: load → set parameter → build → mesh → solve → evaluate → export table and image → save

Uses MPh's own demonstration model `capacitor.mph` (repo `demos/`), whose node names I read in `demos/create_capacitor.py`: study `static`, tables `electrostatic`, evaluation `electrostatic`, exports `data` and `image`. The MPh calls are exactly those of the tutorial **[READ]**; the table lines use `.java` methods documented in the Programming Reference (`setResult()`, `model.result().table(<ftag>).save(<filename>)`) **[READ]**; the composition is mine and **untested**.

```python
# run_capacitor.py  —  python run_capacitor.py C:\jobs\J1
import sys, json
from pathlib import Path
import mph

job = Path(sys.argv[1]).resolve()
out = job / 'out'; out.mkdir(parents=True, exist_ok=True)

client = mph.start(cores=4)                      # client-server mode by default (MPh >= 1.3)
model  = client.load(job / 'capacitor.mph')

model.parameter('d', '1[mm]')                    # value as expression string with unit
model.build()                                    # all geometry sequences
model.mesh()                                     # all mesh sequences
model.solve('static')                            # study by name

C = float(model.evaluate('2*es.intWe/U^2', 'pF'))        # global expression, unit given explicitly
(x, y, E) = model.evaluate(['x', 'y', 'es.normE'])       # field data, model default units

# table -> text file (Java API through the node's .java)
ev = model/'evaluations'/'electrostatic'
ev.java.setResult()                                       # refresh the table from the new solution
(model/'tables'/'electrostatic').java.save(str(out / 'capacitance.txt'))

model.export('data',  out / 'field.txt')                  # Data export node defined in the model
model.export('image', out / 'field.png')                  # Image export node; see section 2 on headless risk

model.save(out / 'capacitor_solved.mph')                  # with mesh and solution
(out / 'result.json').write_text(json.dumps({'C_pF': C, 'E_max_V_per_m': float(E.max()),
                                             'problems': [str(p) for p in model.problems()]}))
# write and close every file before exit: MPh's exit hook stops the JVM hard
```

Creating an export from scratch instead of relying on nodes already in the file (property names read in the 6.4 API reference for "Data" and "Image (Export)", and in MPh's `create_capacitor.py`):

```python
exports = model/'exports'
data = exports.create('Data', name='T field')
data.property('expr', ['T']); data.property('unit', ['K'])
data.property('exporttype', 'vtu')           # 'text' | 'vtu'
data.property('filename', str(out / 'T.vtu'))
data.run()

img = exports.create('Image', name='T plot')
img.property('sourceobject', model/'plots'/'temperature')   # an existing plot group
img.property('imagetype', 'png'); img.property('size', 'manualweb'); img.property('unit', 'px')
img.property('width', '1200'); img.property('height', '900'); img.property('resolution', '96')
img.property('filename', str(out / 'T.png'))
img.run()
```

Java equivalent of the load-solve-measure core, for `comsolcompile` + `comsolbatch` (syntax from the 6.4 references for `EvalGlobal` / `Global (Numerical)` **[READ]**; composition mine, **untested**):

```java
import com.comsol.model.*;
import com.comsol.model.util.*;

public class RunCap {
  public static Model run() throws Exception {
    Model model = ModelUtil.load("m", "C:\\jobs\\J1\\capacitor.mph");
    model.param().set("d", "1[mm]");
    model.study("std1").run();                               // tag, not label
    model.result().numerical().create("g1", "Global");
    model.result().numerical("g1").set("expr", new String[]{"2*es.intWe/U^2"});
    model.result().numerical("g1").set("unit", new String[]{"pF"});
    double[][][] r = model.result().numerical("g1").getData();   // [expression][solnum][value]
    System.out.println("C_pF=" + r[0][0][0]);
    model.save("C:\\jobs\\J1\\out\\capacitor_solved.mph");
    return model;
  }
  public static void main(String[] args) throws Exception { run(); }
}
```

```bat
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolcompile.exe" RunCap.java
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe" -inputfile RunCap.class -nosave -batchlog C:\jobs\J1\out\batch.log
```

---

## 2. From an ssh session on Windows with no interactive desktop

### 2.1 What is documented

- Batch is defined as running "without a graphical user interface" / "without a user interface" [READ]. Graphics libraries are loaded only with `-graphics`.
- The server page describes starting `comsolmphserver` from a terminal login on Windows (Telnet) [READ, 1.4].
- LiveLink for MATLAB has a documented "Running without Display" mode [READ, 1.4].
- For the floating licence: "you can access COMSOL Multiphysics with a Windows Remote Desktop connection. OpenGL rendering usually works, but it ultimately depends on your graphics driver." [READ]
- Nothing in the vendor pages I read mentions OpenSSH, Windows session 0, services, or Task Scheduler.

### 2.2 Windows OpenSSH behaviour that the runner must design around

- Default shell is `cmd.exe`; changed with string value `DefaultShell` under `HKEY_LOCAL_MACHINE\SOFTWARE\OpenSSH` [READ — https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration]. `AcceptEnv` and `PermitUserEnvironment` are not available in the Windows build [READ, same page], so environment variables cannot be passed from the client with `SendEnv`; set them inside the pushed script.
- **Processes die with the session.** Win32-OpenSSH maintainers: "By design we associate the job object with the initial process, so that all the child processes are cleaned-up automatically." and "By default all the processes launched by SSH are closed once the SSH session is closed." [READ — https://github.com/PowerShell/Win32-OpenSSH/issues/1195]. `START "" program.exe` from a `.bat` does not survive.
- Documented escapes [READ — https://github.com/PowerShell/Win32-OpenSSH/issues/1032]:
  - maintainer: "you may use Task Scheduler to achieve background job/process execution";
  - breakaway flag through WMI (comment by jborean93, 2018-04-17):

    ```powershell
    $proc_info = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -Property @{CreateFlags=16777216} -ClientOnly
    $arguments = @{CommandLine="cmd.exe"; ProcessStartupInformation=$proc_info}
    Invoke-CimMethod -ClassName Win32_Process -Name Create -Arguments $arguments
    ```
    (`16777216` = `CREATE_BREAKAWAY_FROM_JOB`.)
- An ssh login is not a logged-on desktop: its processes run in the non-interactive services session and cannot show windows [RECALLED — Windows session-0 isolation; not read this session].
- A scheduled task set to "run only when user is logged on" (`schtasks … /IT`) runs inside that user's interactive desktop session; "run whether user is logged on or not" runs non-interactively [RECALLED — schtasks semantics; not read this session]. This is the standard way to get a process into the real desktop session from ssh, which matters for both graphics and the licence check in 3.3.

### 2.3 Do batch, the server and MPh need a logged-on session or graphics?

| Component | Evidence | Status |
|---|---|---|
| `comsolbatch` solve + save | Defined as no-UI; used on headless Linux clusters routinely [READ, vendor + DESY docs]. No Windows-ssh statement. | Expected to work; **unverified on Windows ssh**. Licence check is the open risk (3.3). |
| `comsolmphserver` | Vendor describes terminal start on Windows; needs `-login auto` (or pre-stored login) or it prompts [READ]. `-silent` stops it reading stdin [READ]. | Expected to work; unverified. |
| MPh `mph.start()` | Launches the server **with `-graphics`** by default [READ, source]. What `-graphics` does when no desktop exists is not documented. `mph.Server(arguments=[...])` appends arguments "and would thus override them in case of duplicates", but `-graphics` is a bare flag with no "off" form [INFERENCE]. | **Unknown.** Fallbacks: stand-alone mode (`initStandalone(False)` = no GUI support), or start the server yourself without `-graphics` and attach with `mph.Client(port=…)`. |
| Solve progress plots | KB 933: "If you experience crashes while solving, these could be caused by plots created while solving. In that case, try disabling plots while solving … and the generation of convergence plots" [READ]. MPh's demo turns these off with `study.java.setGenPlots(False)` and `study.java.setGenConv(False)` [READ]. | Do the same in every scripted study. |

### 2.4 Image export without a display

- "By default, the COMSOL Multiphysics generates images using the graphics card. Such hardware-accelerated image export runs fast … but can become unstable if the image size exceeds or is close to the allowed limit (for example, 4000-by-4000 pixels). To instead use software rendering for creating the images, open the Preferences window, and, on the Graphics page, select the **Use software rendering for image export** checkbox." [READ — https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_results.37.214.html; same sentence on the 6.4 page]
- Command-line renderer switch: `-3drend ogl | sw` [READ]. KB 933: `comsol -3drend sw` "(start with software rendering)"; hardware rendering needs OpenGL 2.1+; on first start COMSOL "will try to fall back to use a built-in software rendering"; DirectX rendering existed only before 6.2 [READ — https://www.comsol.com/support/knowledgebase/933].
- sim-plugin-comsol starts its graphics-mode server as `comsolmphserver.exe -port N -multi on -login auto -silent -graphics -3drend sw` [READ-3P, `driver.py`], and its skill says: "PNG export has been unreliable in known Windows setups; test visual export when figures are required, and keep screenshots as human review aids rather than the only proof." [READ-3P]
- Old forum guidance: COMSOL graphics are generated through the GUI layer, and adding `-graphics` to a batch run of a compiled class (with a virtual frame buffer on Linux) is how images were exported on clusters [SNIPPET — forum thread 30682, posts not readable without login].
- The preference key for "Use software rendering for image export" is not in any page I read. `ModelUtil.listPreferences()` "Returns a string that lists the preferences's names and their description" [READ] — use it on the machine to find the key, then `ModelUtil.setPreference(key, value)`.
- Image-export defaults are stateful: "The default values listed above are valid before any image has been exported successfully. After that, the settings from the last successful image export are used as default values" [READ, API reference]. Always set `size`, `unit`, `width`, `height`, `resolution`, `imagetype` explicitly.
- Robust alternative that needs no renderer: export field data (`exporttype` `vtu` or `text`) and tables, and draw the picture on the Linux/macOS host [INFERENCE; the VTU route is what sim-plugin-comsol recommends, READ-3P].

---

## 3. Licences

### 3.1 Types and what each permits

Sources: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_installation.02.006.html and https://www.comsol.com/products/licensing **[READ]**.

| Type | Terms that matter here |
|---|---|
| **CPU-locked single user (CPU)** | One designated computer; "different users can take turns using the software on that computer, one user at a time. There is no restriction on the number of simultaneous sessions that the one user may run. **The CPU version of the software may not be accessed or used over a network or remotely.**" |
| **Named single user (NSL)** | Up to four computers, two at once, one named person. "For each computer, there is no restriction on the number of simultaneous sessions that the Named User may run." "An NSL may be accessed and used via a single encrypted connection providing secure remote access, such as a virtual private network (VPN) or remote desktop protocol (using network-level authentication and encryption)." |
| **Floating network (FNL)** | Per concurrent user, FlexNet licence server. "You can run the software on a remote computer over your network. Support for remote computing includes using Windows Remote Desktop." "For local use, there is no restriction on the number of simultaneous sessions for one concurrent user." Client–server across machines and cluster commands need this type. |
| Class kit (CKL) | 30 users, classroom use; needs `-ckl`. |

Consequences [INFERENCE from the terms]: an agent reaching the machine over ssh is remote use. That is outside the CPU-locked terms, inside the NSL terms only if the ssh connection counts as the "single encrypted connection" and the agent's use is the named user's use, and unrestricted under FNL. This is a licence-terms question for the licence holder, not something a test can settle.

### 3.2 Seats: batch versus GUI versus server

- FlexNet features seen in a real `lmstat` printout for an FNL [READ — KB 1142]: `SERIAL`, `COMSOL`, `COMSOLGUI`, `COMSOLUSER`, add-on modules (`ACDC`, `STRUCTURALMECHANICS`, …), and separate batch features `COMSOLBATCH`, `ACDCBATCH`, `STRUCTURALMECHANICSBATCH`, plus `CLIENTSERVER`, `CLUSTERNODE`, `MODELMANAGER*`, `CHATBOT`. In that printout two Desktop users hold `COMSOL`, `COMSOLGUI`, `COMSOLUSER` and their module; all `*BATCH` and `CLIENTSERVER` counts are 0.
- Which features a plain `comsolbatch` run or a `comsolmphserver` checks out is **not stated** on any page I read. [RECALLED, low confidence: batch takes `COMSOL` + `COMSOLUSER` + modules but not `COMSOLGUI`.]
- Batch licences exist only on FNL and only for cluster features: "If you have licensed a floating network license, you are allowed to run a simultaneous 'batch job' along with your COMSOL Multiphysics Desktop… This batch license functionality is only available for Cluster Computing and Cluster Sweep nodes… Each additional floating network license lets you run a separate independent batch job (with different models) on multiple computers." [READ — comsol_ref_running.38.08.html]. `-usebatchlic` on the command line is "equivalent to the Use batch license checkbox available in the Cluster Computing and Cluster Sweep study nodes" [READ].
- **Two processes at once on one licence?** By the terms, yes on every type, for the same user on the same computer ("no restriction on the number of simultaneous sessions") [READ]. MPh's documented multi-process demo relies on this [READ].
- **But the session identity matters.** On Linux, "If you want to run multiple COMSOL sessions simultaneously on a Linux computer, they have to be started from the same terminal window… If you on the other hand use different terminal windows for each command, each terminal will check out a new license seat" (FNL, KB 1059), and for CPU/NSL on Linux a second terminal triggers the -4 error (KB 1318) [READ]. An MPh user fixed a licence failure under Slurm-over-ssh with `export DISPLAY=""` — "something regarding DISPLAY over ssh was messing with the license" [READ — MPh issue #205]. So seat sharing keys on user + host + display/terminal [INFERENCE]. Whether a Windows ssh session and the console desktop session of the same user count as the same "session identity" is **unknown**; if not, a GUI left open on the desktop plus an ssh batch run may need two seats (FNL) or fail (single-user).
- To avoid a second seat for cluster jobs: "That you have the same username on the cluster and the local computer" and "That you are using the Batch licenses for the cluster job" [READ — KB 1059].

### 3.3 Remote-session check in FlexNet (error -103)

- FlexNet message for uncounted node-locked licences used from Remote Desktop: "Terminal Server Remote Client Not Allowed" / "(-103) Cannot checkout an uncounted license within a Windows Terminal Services guest session" [SNIPPET/READ-3P — PTC article CS23456, Dell, Intel community; not COMSOL pages].
- MPh's author: "on Windows, for single-CPU licenses, Comsol has some sneaky ways of detecting that the user is connected via Remote Desktop and then deliberately refuses to run." [READ — MPh issue #188]
- A COMSOL CPU/NSL file licence shows in `lmstat` as "`SERIAL`: (Uncounted, node-locked)" [READ — KB 1142 printout], i.e. the licence class this check applies to.
- Whether an OpenSSH session is treated as a remote/guest session by that check: **unknown, must be tested** with the exact licence on the exact machine.

### 3.4 Exact error text when no seat is free [READ — KB 1059, KB 1318]

```
Could not obtain license for COMSOL Multiphysics GUI.
License error: -4.
Licensed number of users already reached.
Feature:     COMSOLGUI
License path: C:\Program Files\COMSOL\COMSOL60\Multiphysics\license\license.dat;
FlexNet Licensing error: -4,132. ""
```

That is the Desktop dialog. The feature name and layout printed by `comsolbatch` to its log are not documented on a page I read; match on `License error: -4` and `Licensed number of users already reached` [INFERENCE].

Other documented licence errors [READ — https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_installation.02.112.html]:

| Text | Meaning given |
|---|---|
| `License error: -1. Cannot find license file.` | File missing or unreadable. |
| `License error: -2. Invalid license file syntax.` | Edited with a word processor / damaged. |
| `License error: -4. Licensed number of users already reached.` | All seats of a product in use. |
| `License error: -5. No such feature exists.` | Licence manager start-up problem (also seen by an MPh user with a class-kit licence under a Slurm job array, issue #222). |
| `License error: -10. Feature has expired.` | Trial expired. |
| `License error: -12. Invalid returned data from license server system.` | Firewall. |
| `License error: -15. Cannot connect to license server system.` | Licence manager not running / firewall / wrong host. Sub-codes `-15,570`, `-15,10032`, `-15,10` in KB 903. |
| `License error: -39. User/host not on INCLUDE list for feature.` | Options file `LMCOMSOL.opt`. |
| `License error: -88. System clock has been set back.` | Clock. |
| `License error: -96. License server machine is down or not responding.` | Network (`-96,491`). |
| `License error: -97. The desired vendor daemon is down.` | Vendor daemon. |
| `Could not obtain license for <feature node>, Required product: <module>` + `-15` | Licence-server connection lost mid-session when adding a node. |

Licence-server loss during a run: after "a few minutes" the Desktop offers Save and Exit; "If you are running a COMSOL batch job, the output file is used if it is not identical to the input file." [READ]

### 3.5 Querying seats

- Applies to "floating network, class kit, and COMSOL Server licenses" [READ — KB 1142, https://www.comsol.com/support/knowledgebase/1142]:

```bat
cd "C:\Program Files\COMSOL\COMSOL64\Multiphysics\license\win64"
lmutil lmstat -a -c ../license.dat
lmutil lmstat -a -c 1718@licsrv
```

  Default ports 1718 (lmgrd) and 1719 (LMCOMSOL) [READ]. Output lines look like `Users of COMSOL: (Total of 2 licenses issued; Total of 2 licenses in use)` followed by `user host display (v6.4) (server/port handle), start …`. "If you are a user with license checkout access, you can view license usage information from any computer on the network" provided the FlexNet utilities are local.
- Licence manager log: `C:\ProgramData\COMSOL\comsol64.log`; licence file: `C:\Program Files\COMSOL\COMSOL64\Multiphysics\license\license.dat` [READ — KB 903].
- From inside a session: `ModelUtil.hasProduct("COMSOL","ACDC")` (no checkout), `ModelUtil.checkoutLicense(...)` (all-or-nothing checkout, returns boolean) [READ]; MPh `client.modules()` lists licensed products via `hasProduct` [READ, source].
- Before running: `comsolbatch -checklicense model.mph` "Print license requirements for a Model MPH file" [READ]. The saved file also carries `usedlicenses.txt`, one line per required module [READ-3P].
- For a CPU-locked or NSL file licence on Windows there is no licence server to query [INFERENCE from KB 1142's scope]; the only seat signal is whether a COMSOL process of another user is running.

---

## 4. Model files, stored solutions, exports, units

### 4.1 `.mph`

- "The files contain binary and text data. The mesh and solution data are stored as binary data, while all other information is stored as plain text." Solved files "include all meshes and solutions"; compact files "include all settings but have no built meshes and solution data" [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_environment.18.15.html].
- A saved file is a ZIP archive (magic `50 4b 03 04`): `fileversion` (e.g. `2092:COMSOL 6.4.0.272`), `modelinfo.xml` (`comsolVersion`, `nodeType` = `compact` | `solved` | `preview`, `isRunnable`, `lastComputationTime`), `dmodel.xml` (model tree; global parameters as `<param T="33" param="…" value="…">` inside `<ModelParamGroup>`), optional `smodel.json`, `usedlicenses.txt`, `geometry*.mphbin`, `mesh*.mphbin`, `solution*.mphbin`, `savepoint*/` [READ-3P — sim-plugin-comsol `mph_file_format.md`, reverse-engineered, "Confirmed across vendor models"]. Not vendor-documented; treat as observed behaviour of 6.x.
- Save is not backward compatible: saving a file from an earlier version rewrites it "in an updated format that is only compatible with COMSOL Multiphysics version 6.4 or later" [READ — comsol_ref_environment.18.16.html]. In the Desktop this asks for confirmation; MPh's stand-alone mode sets `tempfiles.saving.warnifoverwriteolder=off` [READ].
- Compress on save: preference "Optimize MPH files for" Speed (default) or File size [READ]; MPh stand-alone sets `tempfiles.saving.optimize=filesize` [READ].
- Compact copy from the command line: `comsolbatch -inputfile full.mph -outputfile compact.mph -clearsolution -clearmesh -resethistory -norun` [flags READ in vendor table; the combined command and a 19.83 MiB → 0.47 MiB result READ-3P].
- File locking: "Only one user can open and edit an MPH file at the same time." A locked file gets a sibling `<name>.mph.lock`; the Desktop offers "Open As Read-Only" or, for a stale lock, "Reset Lock and Open" [READ]. How `comsolbatch`/the API behave when the input is locked is not documented on that page. A forum thread title gives the save-side text: "Failed to save model. The file … is locked by another program" [SNIPPET].

### 4.2 Saving so a second process can evaluate without re-solving

- Save the model after solving without clearing (`model.save(path)` in MPh; `-outputfile` in batch; never `-clearsolution`). The solved file then carries `solution*.mphbin`.
- Second process: `client.load(path)` then `model.evaluate(...)` directly. MPh checks `solution.java.isEmpty()` and raises `RuntimeError: The solution has not been computed.` if the solution is missing [READ, source]; numerical features recompute only the evaluation, "recomputing the feature if necessary" [READ, API reference] — that is the evaluation feature, not the study.
- `model.evaluate` limits [READ]: dataset "must be a solution dataset. Derived datasets are not supported"; default dataset is "what [Comsol] considers the default dataset. That generally refers to the study defined first". Name the dataset explicitly when a model has more than one study.
- Opening a solved file requires the licences of the modules it uses (`hasProductForFile`, `usedlicenses.txt`), so the checker takes a seat too [INFERENCE].
- The checker must not call `model.save()` with no argument: that overwrites the producer's file [READ, `save` docstring]. Load a copy, or never save.

### 4.3 Export formats

- **Data** export [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_api_results.52.042.html]: `model.result().export().create(<ftag>,"Data")`; properties include `expr` (string array), `unit`, `data` (dataset), `filename`, `exporttype` = `text` | `vtu`, `header` on|off (default off), `fullprec` on|off (default on), `separator`, `location` = `fromdataset` | `file` | `grid` | `regulargrid`, `level` = `fromdataset` | `volume` | `surface` | `line` | `point`, `struct` = `sectionwise` | `spreadsheet`, `ifexists` = `append` | `overwrite`, `innerinput`/`solnum`/`t`, `outerinput`/`outersolnum`. `alwaysask` "is ignored when running without a UI".
- **Table** export [READ — 6.3 API reference, comsol_api_results.52.161.html]: `create(<ftag>,"Table")`; `table`, `filename`, `header`, `prec` = `fromtable` | `full` | `manual`, `source` = `table` | `evaluationgroup`. Direct: `model.result().table(<ftag>).save(<filename>)`, `.getReal()`, `.getColumnHeaders()` [READ — comsol_api_general.47.54.html].
- **Image** export [READ — https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_api_results.52.077.html]: `create(<ftag>,<pgtag>,"Image")`; `imagetype` = `png` | `eps` | `jpeg` | `bmp` | `gltf` (eps 1D only, gltf 3D only); `pngfilename` etc.; `size` = `manualprint` | `manualweb` | `current` | `presentation`; `unit` = `px` | `mm` | `in`; `width` (800), `height` (600), `resolution` (96); `sourceobject`, `sourcetype` = `plotgroup` | `geometry` | `other`; `zoomextents`; `background` = `current` | `color` | `transparent`. MPh sets a property called `filename` on Image nodes and its own demo does too [READ, source], although the 6.4 table lists only the per-format `*filename` properties — a discrepancy to check on the machine.
- GUI docs additionally list TIFF and GIF for images [READ].
- **Numerical results in memory**: `Global` feature (API-only) `getData()` → `[expression][solnum][value]`; `EvalGlobal` `getReal()`, `computeResult()`, `setResult()`, `appendResult()`; `Interp` feature (API-only) evaluates at arbitrary coordinates via property `coord` / `setInterpolationCoordinates(double[][])`, `getData()` → `[expression][solnum][coordinates]`, `coorderr` on = error if all points fall outside the geometry [READ — API reference pages 52.066, 52.051, 52.082].
- A table exported before `setResult()`/`appendResult()` has been called can contain "only table metadata" [READ-3P].

### 4.4 Units

- Parameter values are expression strings with a bracketed unit: `model.parameter('d', '1[mm]')`, `-plist "1[cm]","10[mV]"` [READ].
- `model.parameter(name)` returns the string as typed (`'2[mm]'`); `evaluate=True` returns the number in the model's base unit [READ].
- `model.evaluate(expr, unit)`: "When left out, values are returned in the model's default units" — e.g. field strength in V/m and coordinates in metres in the tutorial [READ]. Always pass the unit for the quantity being judged.
- Numerical features: `unit` property, "If the old unit is not valid when the expression changes, the unit property is reset to default" [READ]. Set `expr` first, then `unit`.
- Decimal separator: if the OS uses a comma, COMSOL may follow it (the manual's Linux advice is to set `LC_ALL=C` "to enforce the COMSOL software to use a period") [READ — Eclipse set-up page]. Check the Windows regional setting before parsing exported text.
- Batch logs on Windows "may be UTF-16"; decode before grepping [READ-3P].
- Data files exported with `header` off carry no units at all [INFERENCE from the default].

---

## 5. Version facts, October 2026

- **COMSOL 6.4**, released 2025-11-18 (new Granular Flow Module); 6.3 on 2024-11-19; 6.2 on 2023-11-07 [READ — https://www.comsol.com/release-history]. Latest maintenance: **6.4 Update 3, 2026-05-29**; 6.3 Update 3, 2026-03-26 [READ — https://www.comsol.com/product-update]. The yearly November cadence suggests 6.5 in November 2026 [INFERENCE].
- Windows 11 and Windows 10 are supported; COMSOL "is shipped with OpenJDK 21.0.7+6" [READ — https://www.comsol.com/system-requirements]. Older releases shipped Java 8 (5.5/5.6) and Java 11 (an MPh crash log from a 6.x install shows Temurin 11.0.13) [READ, MPh docs + issue #131].
- 6.4 highlights relevant here: NVIDIA cuDSS GPU direct solver; the Chatbot window (Windows only) now accepts OpenAI-compatible providers; batch and cluster studies can read/write Model Manager databases [READ — https://www.comsol.com/release/6.4]. No official Python interface was announced on the pages I read; the MPh maintainer still asks users to "keep pressuring Comsol to release a 'LiveLink for Python'" (2025-12) [READ].
- **Java API stability.** The call structure (`model.component(...).geom(...)`, `model.study(...)`, `model.sol(...)`, `model.result()...`) is the same in the 5.x-era blog code and the 6.4 reference [READ]. What changes between releases is default nodes and feature names: MPh's own demo needs `if model.version() >= '6.3':` because Electrostatics in 6.3 creates a default `Free Space 1` node where earlier versions created `Charge Conservation 1`, and it must then create `ChargeConservationSolid` itself [READ — `demos/create_capacitor.py`]. `clearSolution()` was deprecated in favour of `clearSolutionData()` [READ — MPh 1.3.0 notes]. A script written against one version's default tree can silently address the wrong node on another [INFERENCE].
- Files move forward only (4.1).
- **MPh supported range**: COMSOL 6.0+ "expected to work", tested to 6.3 in the docs, reported working on 6.4; Python ≥ 3.10; latest 1.4.0 (1.5).

---

## 6. Failure modes of scripted use and their messages

| Failure | What the agent sees | Source | Notes |
|---|---|---|---|
| No free seat | `License error: -4.` / `Licensed number of users already reached.` / `FlexNet Licensing error: -4,132` | [READ] KB 1059 | Desktop wording; batch layout unverified. |
| Licence server unreachable | `License error: -15. Cannot connect to license server system.`; `-96`; `-97` | [READ] | 3.4 |
| Remote-session refusal (node-locked) | `-103` "Terminal Server remote client not allowed" / "Cannot checkout an uncounted license within a Windows Terminal Services guest session" | [READ-3P], non-COMSOL | Not confirmed for COMSOL or for ssh. |
| Stationary solver did not converge | `Failed to find a solution.` + `Maximum number of Newton iterations reached.` + `Returned solution is not converged.` (+ `Not all parameter steps returned.`); variants `Failed to find a solution for all parameters`, `Failed to find a solution for the initial parameter`, `No convergence, even when using the minimum damping factor` | [RECALLED] for the exact block; variants [SNIPPET] from forum thread titles/summaries | Not read verbatim on a vendor page. |
| Time-dependent solver did not converge | `Nonlinear solver did not converge.` / `Maximum number of Newton iterations reached.` / `Time : 0.15582918651998362` / `Last time step is not converged.` | [READ] KB 1127 | Verbatim. |
| Linear system | `Failed to solve linear system` (bad mesh / under-constrained) | [READ-3P] | |
| Native memory | `Out of memory during LU factorization.` / `Out of memory during assembly` | [READ] KB 1030, KB 1186 | RAM, not Java heap. |
| Java heap | "a Java out-of-memory error"; KB title "Out of memory"; an MPh issue title has `OutOfMemoryError` when evaluating particle trajectories | [READ] heap page, KB 1243, MPh #132 title | Default heap **`-Xmx2g`** in every `bin\win64\*.ini`; raise (e.g. `-Xmx4g`) in `comsolbatch.ini` / `comsolmphserver.ini`, or copy the ini and pass `-comsolinifile <path>`. In MPh stand-alone mode the heap belongs to the JVM JPype starts, so the ini files do not obviously apply [INFERENCE]. |
| Disk full in temp dir | process dies; MPh then shows `java.lang.NullPointerException` from `StudyClient.run`, then `Error while disconnecting client at session clean-up.` and `IllegalStateException: Tried to disconnect while not connected.` | [READ] MPh #128 | Fix: `-tmpdir`, `-autosave off`. |
| Server process died mid-run | `java.lang.NullPointerException` in `java.run()`; later calls give `com.comsol.util.exceptions.FlException: Not connected to a server` | [READ] MPh #131 | Cannot reconnect inside the same Python process (JPype). Restart the process. |
| JVM crash after hundreds of solves (stand-alone) | `A fatal error has been detected by the Java Runtime Environment: EXCEPTION_ACCESS_VIOLATION (0xc0000005)`, `hs_err_pid<N>.log` in the cwd | [READ] MPh #131 | Cache results per iteration; bound solves per process. |
| Session killed on ssh logout | same NullPointerException pattern | [READ] MPh #188 (Linux) | On Windows the job object does this by design (2.2). |
| Model will not load on 6.3/6.4 | `com.comsol.util.exceptions.FlException: Failed to initialize physics interface.` | [READ] MPh #251 | Reproduced by others with the Java API alone; COMSOL-side. |
| Stand-alone init fails | `UnexpectedServerException: java.lang.NullPointerException` at `ModelUtil.initStandalone` | [READ] MPh #225 | Workaround given: client–server mode. |
| Python exits silently on `mph.start()` | no error, back at the prompt | [READ] MPh #157 | Not root-caused. |
| MPh server start | `Starting server failed: <last line of server output>`; `TimeoutError: Sever failed to start within time-out period.` [sic]; `Server port is X, but Y was requested.` | [READ] source | On Linux the server exits 0 even on error; MPh therefore ignores the return code. |
| Second client in one process | `NotImplementedError: Only one client can be instantiated per Python session.` | [READ] | |
| Evaluate before solving / on compact file | `RuntimeError: The solution has not been computed.` | [READ] source | |
| Wrong name | `LookupError: Study "<name>" does not exist.` / `Geometry sequence "<name>" does not exist.` / `ValueError: Dataset "<name>" does not exist.` | [READ] source | MPh uses labels, batch uses tags. |
| Java compile | `cannot be resolved to a type` | [READ-3P] | Typed node declarations. |
| Missing material value | `Undefined material property "X"` at solve | [READ-3P] | Set `<X>_mat`/`<X>_src` to `userdef` first. |
| Unknown interface | `Unknown physics interface` | [READ-3P] | e.g. `HeatTransferInSolids` vs `HeatTransfer`; FEABench reports the same confusion [READ]. |
| Locked file | sibling `.mph.lock`; "is locked by another program" on save | [READ] doc; [SNIPPET] | Stale lock after a killed session. |
| Recovery files accumulating | recovery folder under the preference dir (`%USERPROFILE%\.comsol\v64\…`) fills | [READ] options table; blog comments | `-autosave off` or `-recoverydir`. |
| Stale server | port 2036 taken; COMSOL then tries subsequent ports; start-up collisions when several start at once | [READ] MPh `Server` docstring | Use `-port 0` + `-portfile`, record the PID, `taskkill /PID <pid> /T /F` (what sim-plugin-comsol does [READ-3P]). "Never terminate every `comsol` process by name." [READ-3P] |
| First server start waits for input | hangs asking for username/password | [READ] | `-login auto`. |
| Run "succeeds" but answer is a default | exported value equals an initial condition (293.15 K) or the table is empty | [READ] FEABench paper | The checker must test for this explicitly. |

Not established: **exit codes of `comsolbatch`** (no page I read states them; the MPh source notes the Linux server returns 0 on error). Do not use the exit code alone as the success signal.

---

## 7. Verification recipes for an independent checker

Principle: the checker opens the saved `.mph` in its own process, reads the **inputs** (parameters) from the file, computes the closed-form answer itself, and evaluates the quantity from the stored solution with its own expression. It never reads numbers the producer printed. Variable and feature names marked [RECALLED] must be confirmed on the machine (list `node.properties()`, try the evaluation) before they go into a methods sheet.

Zero-licence pre-check (stdlib only, no COMSOL process) [READ-3P for the layout]:

```python
import zipfile, re
z = zipfile.ZipFile(path)
names = z.namelist()
assert any(n.startswith('solution') and n.endswith('.mphbin') for n in names), 'no stored solution'
print(z.read('fileversion').decode(errors='replace'))                # e.g. 2092:COMSOL 6.4.0.272
info = z.read('modelinfo.xml').decode(errors='replace')
print(re.findall(r'nodeType="(\w+)"', info))                         # expect solved
```

Common checker skeleton (MPh calls [READ]; composition untested):

```python
import mph, numpy as np, shutil, sys
src, work = sys.argv[1], sys.argv[2]
shutil.copy2(src, work)                      # never open or save the producer's file in place
client = mph.start(cores=2)
model = client.load(work)
P = model.parameters(evaluate=True)          # inputs, as numbers in base units
print(model.studies(), model.datasets(), model.problems())
```

### 7.1 Steady conduction, plane slab (or annulus), fixed temperatures

- Closed form, slab of thickness L, T(0)=T1, T(L)=T2, constant k: `T(x) = T1 + (T2−T1)·x/L`; flux `q = k(T1−T2)/L`; heat rate `Q = q·A`.
- Annulus r1<r<r2: `T(r) = T1 + (T2−T1)·ln(r/r1)/ln(r2/r1)`; per unit length `Q' = 2πk(T1−T2)/ln(r2/r1)`.
- Checker:

```python
x, T = model.evaluate(['x', 'T'], ['m', 'K'])                    # nodal field from the stored solution
T_ref = P['T1'] + (P['T2'] - P['T1']) * x / P['L']
err_T = np.abs(T - T_ref).max()                                   # linear elements reproduce a linear field: expect ~1e-9 K
# flux recomputed from the gradient, independent of interface-specific flux variables:
Tx = model.evaluate('Tx', 'K/m')                                  # [RECALLED] 'Tx' = x-derivative of dependent variable T; alternative d(T,x)
q_ref = P['k0'] * (P['T1'] - P['T2']) / P['L']
err_q = np.abs(-P['k0'] * Tx - q_ref).max() / abs(q_ref)
assert not np.allclose(T, 293.15), 'field equals the default initial value'   # FEABench failure mode
```

- For the annulus use `r = np.hypot(x, y)` and the log profile; expect mesh-dependent error, and check it falls when the mesh is refined.
- Guards: confirm both temperatures actually appear at the boundaries (`T.min()`, `T.max()` equal T2, T1 to tolerance), and that `P['k0']` is the value the physics uses (a material with its own k overrides a parameter that is never referenced).

### 7.2 Cantilever: tip deflection and first eigenfrequency

- Euler–Bernoulli, end load F, length L, rectangular b×h, `I = b·h³/12`: `δ = F·L³/(3·E·I)`.
- First bending frequency: `f1 = (1.8751² / (2π·L²)) · sqrt(E·I/(ρ·A))`, `A = b·h`. With b ≠ h there are two bending families; compare against both I values.
- A 3D solid model deviates from beam theory through shear and Poisson effects: use L/h ≥ 20 and expect agreement at the per-cent level, not machine precision [RECALLED, standard beam theory]. State the tolerance before running.
- Checker:

```python
w = model.evaluate('w', 'm', 'static')                            # [RECALLED] u, v, w are Solid Mechanics displacement components
x = model.evaluate('x', 'm', 'static')
tip = np.isclose(x, P['L'])
delta = np.abs(w[tip]).mean()
I = P['b'] * P['h']**3 / 12
assert abs(delta - P['F'] * P['L']**3 / (3 * P['E0'] * I)) / delta < tol

f = model.evaluate('freq', 'Hz', 'eigen')                         # [RECALLED] global variable 'freq' on an eigenfrequency dataset; one value per mode
f = np.sort(np.real(np.atleast_1d(f)))
f1 = (1.8751**2 / (2*np.pi*P['L']**2)) * np.sqrt(P['E0'] * I / (P['rho0'] * P['b'] * P['h']))
```

- Guards: the load must be the total force the checker assumes (a boundary load entered as pressure vs total force differs by the area); reaction-force balance is a second independent leg; eigenvalues can come back complex — MPh returns complex arrays when `isComplex()` [READ].

### 7.3 Parallel-plate capacitance

- Model only the dielectric block between the plates (side walls zero charge) so that `C = ε0·εr·A/d` is exact, with no fringing.
- Checker (the expression is the one in MPh's tutorial [READ]):

```python
C = float(model.evaluate('2*es.intWe/U^2', 'F', 'static'))        # energy method; es.intWe [READ in MPh tutorial]
eps0 = 8.8541878128e-12
C_ref = eps0 * P['epsr'] * P['A'] / P['d']
E = model.evaluate('es.normE', 'V/m', 'static')
assert np.allclose(E, P['U'] / P['d'], rtol=1e-6)                  # uniform field: second, independent leg
```

- Guards: in a 2D model the out-of-plane thickness property decides the scale (`es.java.prop('d').set('d', 'l')` in MPh's demo [READ]); in 6.3+ the default domain node is Free Space, so εr applies only where a Charge Conservation node was added and selected [READ, demo]. A checker that sees C equal to the vacuum value has found exactly that mistake.

### 7.4 Checker without Python (Java class through `comsolbatch`)

Same idea as the `RunCap` class in 1.6 but with `ModelUtil.load` on a copy, no `study.run()`, a `Global` or `Interp` feature, `System.out.println("KEY=" + value)`, and `-nosave`. Results come back on stdout / in `-batchlog` only (file writes reportedly blocked, 1.3).

---

## 8. Prior art: LLM agents driving COMSOL

### 8.1 FEABench (Google)

- Paper https://arxiv.org/abs/2504.06260 (NeurIPS 2024 MATH-AI workshop); code https://github.com/google/feabench (Apache-2.0, last push 2025-05) **[READ: repo README, `common/remote_service/mph_comsol_service.py`; paper via page summary]**.
- Interface: **MPh**. An RPyC service on the COMSOL machine holds `mph.Server(multi=True)` + `mph.Client(port=…)`; the LLM emits Java-API lines that must start with `model.` and are `eval`'d one at a time against `model.java`; exceptions are returned as strings (`str(e)`), never raised. COMSOL 6.1 in examples.
- Answer extraction: the model must export a table, `model.result().table("tbl1").save("OUTPUT_PATH/output.txt")`, and an LLM verifier checks the table really holds the target quantity.
- Results: best single-shot executability 0.79 (Claude 3.5 Sonnet); the multi-turn agent reached 88% executable calls; **only 1–2 of 15 problems gave a value within 10% of the target**. Agent runs took 7–17 minutes per problem, dominated by LLM calls; the FEA itself 0.9–1.5 s.
- Pitfalls reported: the physics block has the lowest executability; hallucinated interface and feature names (GUI label "Heat Transfer in Solids" vs API type `HeatTransfer`); wrong spatial dimension on boundary features; **exports that contain default or initial values (293.15 K) or empty tables while every call executed**.

### 8.2 COMSOL MCP servers

- **wjc9011/COMSOL_Multiphysics_MCP** — https://github.com/wjc9011/COMSOL_Multiphysics_MCP (MIT, 819 stars, pushed 2026-09-17; paper in *Neurocomputing* 703, 134481, 2026) **[READ: README, `src/tools/session.py` grep, `src/knowledge/prompts/mph_api.md`]**.
  - Interface: **MPh inside an MCP server** (`python -m src.server`), 100+ tools (`comsol_start`, `model_load`, `geometry_add_block`, `physics_add_heat_transfer`, `study_solve`, `study_solve_async`, `results_evaluate`, `results_export_image`, …). Session code constructs `mph.Client(...)` directly, i.e. a stand-alone JPype client unless a port is given.
  - Requirements stated: COMSOL 5.x or 6.x, "Python 3.10+ (NOT Windows Store version)".
  - Pitfalls it documents: one client per process — "client is kept alive and models are cleared" (`client.clear()`) instead of reconnecting; `model.java` is an attribute, not a call; create the component with the `True` flag (`component().create('comp1', True)`); physics needs the geometry tag (`physics().create('spf','LaminarFlow','geom1')`); boundary-condition property names must be known exactly (`HeatFluxBoundary` → `q0`, `TemperatureBoundary` → `T0`, `InletBoundary` → `U0`, `OutletBoundary` → `p0`); its electrochemistry type table was "verified against a live COMSOL 6.3 session" because guessed names fail. PNG export from plot groups is still listed under "Next Steps".
- Others seen in search results only (not read): Howard-Lai/COMSOL_MCP, Qwup2112/comsol-mcp-server, Ching-Chiang/comsol-mcp, Suzy-Sa/COMSOL-Multiphysics-MCP, Twofruitsgrape/dsh-comsol [SNIPPET].

### 8.3 svd-ai-lab sim-cli + sim-plugin-comsol

- https://github.com/svd-ai-lab/sim-cli (233 stars), https://github.com/svd-ai-lab/sim-plugin-comsol (71 stars, Apache-2.0, pushed 2026-08-18) **[READ: README, bundled `SKILL.md`, `java_batch_patterns.md`, `mph_file_format.md`, `offline_postprocessing_exports.md`, `debug_failed_exec.md`, `solver/6.4/notes.md`, `driver.py` grep]**.
- Interfaces, in the order its skill tells an agent to prefer them: (1) offline `.mph` inspection with a stdlib ZIP reader, no JVM; (2) local COMSOL HTML help search; (3) direct `comsolbatch -inputfile … -outputfile … -batchlog …`; (4) `comsolcompile` + `comsolbatch` for settled Java recipes; (5) a live session = `comsolmphserver.exe -port N -multi on -login auto -silent` + JPype (`mph` 1.2.x), with `sim connect / exec / inspect`; (6) a visible Desktop attached to the same server (`comsol.exe mphclient -host localhost -port N`).
- Pitfalls it reports (all [READ-3P]):
  - "On Windows, COMSOL batch logs may be UTF-16."
  - "PNG export has been unreliable in known Windows setups"; numbers and exported data are the acceptance evidence.
  - "A shell or tool timeout ends that observation call; it does not prove COMSOL stopped." Check the process, the batch-log tail and output timestamps before retrying; identify the process by executable, full command line, start time and log/output targets; never kill by name.
  - Starting a second `mph.start()` / `client.create()` inside a live session "can spawn a conflicting COMSOL JVM".
  - "Prefer absolute paths for save/export/log targets. Do not rely on COMSOL's launch directory or the Java process current directory."
  - Many `set(...)` calls do not take effect downstream until the relevant sequence is built or run; use `run()` as a deliberate synchronisation point.
  - Batch Java: chain style only; file writes blocked; `-outputfile x.java` does not export Java.
  - Selections: the third argument of `physics(...).create(name, type, dim)` fixes the entity dimension; "Picking the wrong dim means COMSOL silently won't apply the BC."
  - Divergence triage: classify singular / invalid set-up / mesh-localised / nonlinear before touching solver settings; change one axis per run; "A lower residual alone is not proof of a valid solution".
  - Its 6.4 notes record no API differences found so far.

---

## 9. What this means for the runner (design notes, all [INFERENCE] unless tagged)

1. **Job directory, absolute paths.** One directory per job on the Windows side (`C:\luxas\jobs\<id>\{in,out,scripts,logs}`); every path the script passes to COMSOL is absolute.
2. **Push a script file, not a command line.** The default ssh shell is `cmd.exe` [READ]; quoting `-plist "1[cm]","10[mV]"` through bash → ssh → cmd is fragile. Push `run.cmd` / `run.py` and, for batch parameters, a `-paramfile`.
3. **Launch so the job survives the connection.** Task Scheduler (`schtasks /Create … /TR "C:\luxas\jobs\<id>\run.cmd"`, then `schtasks /Run`) or the WMI breakaway call [READ, 2.2]. If the licence or graphics turn out to need the interactive session, the task must be created to run in the logged-on user's session, which requires that user to stay logged on at the console.
4. **The wrapper records what the runner polls**: PID file, start time, the COMSOL command line, `%ERRORLEVEL%` into a `done` file written last. Success = `done` exists **and** the output `.mph` exists with a newer timestamp **and** the log contains no `License error` / `Failed to` / `Out of memory` line **and** the result file parses. Exit code alone is not trusted.
5. **Progress**: `-batchlog` + `Current Progress: NN%` and `Memory:` lines [READ]; for MPh, `ModelUtil.showProgress(file)` [READ, untested through JPype]. Decode UTF-16 if needed.
6. **Stop**: `comsolbatch -stop 100 -inputfile <same>` or `-cancel` first [READ]; then `taskkill /PID <pid> /T /F`.
7. **Isolation when more than one process runs**: `-prefsdir`, `-configuration …\cfg_@process.id`, `-data …\data_@process.id`, `-tmpdir`, `-autosave off` [READ]; for servers `-port 0 -portfile <path>` [READ].
8. **Seat lock**: a host-side lock (atomic `mkdir` in the job root) held for the whole process lifetime, covering producer and checker alike, because the checker needs a seat too. For FNL, add an `lmutil lmstat -a -c <port@host>` pre-check on `Users of COMSOL:` [READ]. Record whether a Desktop is open on the console (`tasklist /FI "IMAGENAME eq comsol.exe"`).
9. **Bound each process**: one job per Python process; restart after a failure (no reconnect) [READ, MPh #131].
10. **Images are optional evidence**; the mandatory artefacts are the solved `.mph`, a table/JSON of numbers, and a VTU or text field export.
11. **Version pin**: record `ModelUtil.getComsolVersion()` / `fileversion` and `mph.__version__` with every result.

---

## 10. Unknowns — to be tested on the machine, in this order

1. Licence type installed (CPU / NSL / FNL / trial) and whether its terms cover agent-driven ssh use.
2. Does `comsolbatch -inputfile <solved tutorial>.mph -outputfile out.mph -batchlog log.txt` run from an OpenSSH session with nobody logged on at the console? With someone logged on? Exact log text on licence refusal.
3. Does a Desktop open on the console plus a batch run from ssh use one seat or two (FNL), or fail with -4 (single-user)? Does -103 appear?
4. `comsolbatch` exit codes on success, solver failure, licence failure, missing input.
5. Does `mph.start()` work from ssh given its default `-graphics`? If not: stand-alone mode, or a manually started server without `-graphics`.
6. PNG export from ssh: default renderer, `-3drend sw`, and the software-rendering-for-image-export preference (find its key with `ModelUtil.listPreferences()`). Does it need the interactive session?
7. Encoding of `-batchlog` on this install (UTF-8 or UTF-16); decimal separator in exported text under the machine's locale.
8. Output filename when `-pname/-plist` is used with a single tuple (does `out.mph` become `out_<name>_<value>.mph`?).
9. Does `comsolcompile` in 6.4 need `-jdkroot`? Are file writes from a batch class really blocked, and does the security preference change that?
10. Which FlexNet features `comsolbatch`, `comsolmphserver` and MPh stand-alone each check out (read from `lmstat` while each runs).
11. Behaviour of `comsolbatch` and `client.load` on a file with a stale `.mph.lock`.
12. Whether `Image` export accepts `filename` or only `pngfilename` on 6.4.
13. Variable names used in section 7 (`Tx`, `w`, `freq`, `es.intWe` in 3D) and feature type names for from-scratch builds (`HeatTransfer`, `TemperatureBoundary`/`T0`, material property `thermalconductivity`).
14. JVM heap in MPh stand-alone mode: which setting controls it.
15. Whether MPh 1.4.0 + JPype 1.7.x + COMSOL 6.4 Update 3 (OpenJDK 21) passes MPh's own test suite on this machine (`python tools\test.py --log` in a source checkout [READ, MPh #157]).

---

## 11. Sources

Vendor (COMSOL), read this session:
- Commands on Windows (6.4): https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_running.38.31.html
- COMSOL Batch: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_running.38.08.html
- Client–server architecture / modes: …/comsol_ref_running.38.04.html, .14.html, .17.html, .18.html, .19.html
- Java heap: …/comsol_ref_running.38.11.html — Security settings: …/comsol_ref_running.38.10.html
- Compiling Java: …/comsol_ref_running.38.09.html; …/comsol_api_intro.46.07.html, .08.html, .10.html, .11.html, .12.html, .13.html
- ModelUtil: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/api/com/comsol/model/util/ModelUtil.html
- API reference: …/comsol_api_general.47.54.html (model.result), …/comsol_api_results.52.042.html (Data), .051 (EvalGlobal), .066 (Global), .077 (Image export), .082 (Interp); 6.3 …/comsol_api_results.52.161.html (Table export)
- File formats / saving: …/comsol_ref_environment.18.15.html, .18.16.html — Image (GUI): https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_results.37.214.html
- Licence types: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_installation.02.006.html; https://www.comsol.com/products/licensing
- Licence errors: https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_installation.02.112.html
- Knowledge base: 903, 933, 1030, 1059, 1127, 1142, 1186, 1243, 1318 under https://www.comsol.com/support/knowledgebase/<n>
- Batch job configuration: https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_ref_solver.36.233.html
- LiveLink for MATLAB: https://doc.comsol.com/6.4/doc/com.comsol.help.llmatlab/llmatlab_ug_start.5.4.html, .5.5.html
- Release history / updates / system requirements / 6.4 highlights: https://www.comsol.com/release-history, /product-update, /system-requirements, /release/6.4
- Blogs: https://www.comsol.com/blogs/how-to-run-comsol-multiphysics-from-the-command-line, /how-to-run-simulations-in-batch-mode-from-the-command-line, /how-and-when-to-open-recovery-files-in-comsol-multiphysics

MPh, read this session:
- Docs: https://mph.readthedocs.io/en/stable/ (installation, tutorial, demonstrations, limitations, releases, api/mph.start, mph.Client, mph.Server, mph.Model, mph.config)
- Source: https://github.com/MPh-py/MPh/tree/main/mph (`session.py`, `server.py`, `client.py`, `model.py`, `discovery.py`), `demos/create_capacitor.py`
- Issues: #128, #131, #157, #188, #205, #222, #225, #243, #245, #251, #260 at https://github.com/MPh-py/MPh/issues/<n>
- PyPI: https://pypi.org/pypi/MPh/json, https://pypi.org/pypi/jpype1/json

Windows OpenSSH, read this session:
- https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration
- https://github.com/PowerShell/Win32-OpenSSH/issues/1032, /issues/1195

Prior art, read this session:
- https://github.com/google/feabench; https://arxiv.org/abs/2504.06260
- https://github.com/wjc9011/COMSOL_Multiphysics_MCP
- https://github.com/svd-ai-lab/sim-plugin-comsol; https://github.com/svd-ai-lab/sim-cli

Other:
- DESY Maxwell cluster notes on COMSOL storage locations: https://docs.desy.de/maxwell/applications/comsol_storage/

The raw text of the pages above was kept during the research and is not in the repository.
