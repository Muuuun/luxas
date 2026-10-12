---
domain: comsol
match: comsol, comsolbatch, .mph
software: comsol
bin: comsolbatch
artifacts: .mph
---

# COMSOL Multiphysics — MPh (Python) to build and measure, comsolbatch for long solves (UNVERIFIED draft)

No GUI. **MPh** (`import mph`) builds, edits and measures a model; one Python process is one COMSOL session. **`comsolbatch`** solves a model that already holds a study, "using the active solver settings in the model". When the line above this sheet says RUNS ON, a job reaches COMSOL through the runner with the call printed there (when it says FOUND, the program is on this machine: start `comsolbatch` or `python` directly). The runner call's shape:

    python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun run <job dir> --software comsol -- <launcher> <args>

The job directory is the working directory on the machine that has COMSOL; there is no shell (no `>`, no `&&`). For a solve longer than a minute or two use `start` (it returns at once), then `wait`; `wait` and `run` return within their `--timeout`. Print the numbers you will report from the fetched files in the same bash call.

| Tool | Likely frictions | Smoke test |
|---|---|---|
| MPh 1.4 | (1) `client = mph.start(cores=1)`: one client per process, `NotImplementedError: Only one client can be instantiated per Python session.` After `FlException: Not connected to a server`, start a new process. (2) MPh addresses nodes by **name**, `comsolbatch -study` by **tag** (`std1`): `LookupError: Study "<name>" does not exist.` (3) Values are strings with a bracketed unit: `model.parameter('d', '1[mm]')`. Read back, that is the string; with `evaluate=True`, the number in the base unit. (4) `model.evaluate(expr, unit, dataset)` uses the first study's dataset unless one is named. No solution: `RuntimeError: The solution has not been computed.` (5) Give `load`, `save` and exports absolute paths (`Path('out.mph').resolve()`); `model.save()` with no path overwrites the file the model was loaded from. (6) MPh's exit hook stops the JVM hard: close every output file before the script ends. | `smoke.py`: `import mph; c = mph.start(cores=1); m = c.create('smoke'); m.parameter('a', '2[mm]'); print('a_m', m.parameter('a', evaluate=True))` prints `a_m 0.002` |
| `comsolbatch` 6.4 | (1) `comsolbatch -inputfile in.mph -outputfile out.mph -batchlog log.txt -batchlogout`. **Without `-outputfile` the input file is overwritten.** `-batchlogout` also sends the log to standard output, where the runner reads it. (2) With `-pname a,b -plist 1,2` "the model is saved with a new name that contains the parameter tuple": list the directory, do not assume `out.mph`. | solve MPh's demonstration model `capacitor.mph` (MPh repository, `demos/`; `demos/create_capacitor.py` names its nodes: study `static`), copied into the job directory as `in.mph`; then Verification rows 1–3 on the output |

## What exit 0 does not tell you

- **No page states `comsolbatch`'s exit codes**, and MPh's source notes the server exits 0 on error on Linux. Success is a stored solution (Verification row 1) and no failure line in the log. Read verbatim on vendor pages: `Nonlinear solver did not converge.`, `Last time step is not converged.`, `Out of memory during LU factorization.`
- **A boundary condition on the wrong entity dimension is silently not applied.** Third-party report: the third argument of `physics(...).create(name, type, dim)` fixes it, and "Picking the wrong dim means COMSOL silently won't apply the BC".
- Third-party reports: a `set(...)` may take effect only once its sequence is built or run; a table exported before `setResult()` can hold "only table metadata".

## Verification: measure the saved file, not the script's report

Work in a fresh process on a **copy** of the file and never call `model.save()` there. Rows 2–4 start COMSOL (through the runner when the line above says RUNS ON): `import mph; client = mph.start(cores=1)`, one client per process. Units: pass the unit of the quantity you judge to `model.evaluate`; without one the result is in the model's default units. Sign conventions: the research established none.

| Commitment | How to measure it from the file |
|---|---|
| a solution is stored | No COMSOL needed: a saved `.mph` is a ZIP archive (layout observed by a third party on 6.x, not vendor-documented). With `zipfile`: a member `solution*.mphbin` exists and `modelinfo.xml` has `nodeType="solved"`, not `compact`. |
| the inputs are the ones the task gave | `model = client.load(copy)`, then `model.parameters(evaluate=True)`: numbers in base units. Take inputs from here, not from the script or its JSON. A parameter is a declared input, not a used one: a material with its own value overrides a parameter the physics never references. Confirm use with a number COMSOL computed from the physics that depends on it (capacitor: `2*es.intWe/U^2` against ε0·εr·A/d from the parameters). For the slab the temperature field does not depend on k, and −k·Tx with k taken from the parameter cancels k: evaluate the interface's own flux or conductivity against the parameter (variable names not read: Unknown 4). |
| a scalar result | `model.evaluate('<your own expression>', '<unit>', '<dataset name>')` evaluates the stored solution; nothing is solved again. Compare with a closed form computed from the parameters just read. From MPh's tutorial: capacitance is `2*es.intWe/U^2` in `'pF'`; for a dielectric block without fringing the reference is ε0·εr·A/d. |
| a field | `model.evaluate('T', 'K')` beside `model.evaluate('x', 'm')`, compared point by point with the closed form (slab: T1 + (T2 − T1)·x/L). Assert that the extremes reach both boundary values and that the field is not uniformly the initial value: a published benchmark of model-written COMSOL code found exports equal to it (293.15 K), and empty tables, with every call executed. |

## Licence and seat

- **The licence type decides whether remote use is allowed at all.** Vendor terms: CPU-locked, "The CPU version of the software may not be accessed or used over a network or remotely." Named single user, "may be accessed and used via a single encrypted connection providing secure remote access". Floating network, "You can run the software on a remote computer over your network." Which applies is the licence holder's decision; never work around a refusal.
- The COMSOL process (`comsolbatch`, or the server MPh started) holds the seat until it exits. Stop a job with `simrun cancel`, never by killing COMSOL processes by name: a person using COMSOL at the desktop holds the same licence and is invisible to the runner's seat lock.
- No seat free, as the desktop words it: `License error: -4.` and `Licensed number of users already reached.`

## Unknown: find out at first contact

1. Whether `mph.start()` works with no desktop: it starts its server with `-graphics`. Documented alternative: `mph.option('session', 'stand-alone')` before `mph.start()`.
2. `comsolbatch` exit codes on failure, its log's encoding (a third party reports UTF-16), and how the log words a licence refusal or a stationary-solver failure (`Failed to find a solution.` is recalled, not read).
3. PNG export without a desktop (a third party calls it unreliable on Windows). Until tested, a picture is not evidence.
4. Names for building from scratch (`HeatTransfer`, `TemperatureBoundary`/`T0`, `Tx`, `w`, `freq`) are recalled or third-party: try each before asserting on it. The heat-transfer interface's own flux and conductivity variables were not read at all: find their names in the model. Default nodes change with the version (Electrostatics: `Free Space 1` from 6.3).

## Known false rejections

None recorded yet.
