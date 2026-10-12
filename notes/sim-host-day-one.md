# The day the Windows machine arrives

For the person who owns the machine. Do the steps in order; each has its reason in one line.
Nothing below has been run on a Windows machine. It was put together on 2026-10-09 from
Microsoft's, the vendors' and the libraries' documentation, and where a step rests on something
remembered rather than read, it says so. Where this note and the machine disagree, the machine
is right: write down what it said.

Words used here:

- **runner**: `skills/compute-methods/scripts/simrun`, the one script that copies a job to the
  machine, runs it there, and brings the results back.
- **seat**: one running copy of a licensed program. Most of these licences allow one at a time.
- **job**: a folder with a script in it, prepared on the Luxas side.
- **the desktop**: what you see when you sit at the machine and log in. A program started over
  ssh does not run there. It runs in a separate, invisible place Windows keeps for services
  (Microsoft calls it "session 0"), where a window that asks a question waits forever.

Before you start, find out **which COMSOL licence you bought** (CPU-locked, named single user,
or floating network). It decides whether COMSOL may be driven this way at all; the terms are quoted in section 11.

## 1. A Windows account for Luxas

- [ ] Create a **local** account, for example `luxas`, with a password. No spaces in the name.
  *Why local:* Microsoft's page says key login over ssh "works with local Windows accounts and
  Active Directory (domain) accounts" and that Entra ID (work or school cloud) accounts "don't
  support key-based authentication". A personal Microsoft account is not mentioned either way,
  so a local account is the only kind known to work. It also carries no mail, OneDrive or saved
  passwords, and every job runs as this account.
- [ ] Make it a **standard** user, not a member of Administrators.
  *Why:* the runner is not a security boundary. A job is a script, and it can do whatever this
  account can do. The account is the boundary, so it should own its work folder and nothing else.
  Put it in Administrators only if a program or its licence check will not start for a standard
  user, and write down which program made you do it.
- [ ] Use it for Luxas only (**dedicated**).
  *Why:* the programs keep settings and licence state per Windows user. Two things follow.
  Each program must be started once by this account at the desktop (step 9). And if you use
  COMSOL at the desktop under your own account while a job runs under this one, the licence sees
  two users (a CPU-locked licence allows "one user at a time").
- [ ] Keep everything a job needs on the local disk.
  *Why:* Microsoft: a session opened with a key "isn't capable of outbound authentication as the
  user", so network drives and shares are not reachable from a job.

## 2. The ssh server

In a PowerShell window opened with "Run as administrator" (commands from Microsoft's page):

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP"
```

- [ ] Install it and start it. *Why:* it is how the runner reaches the machine; nothing else is
  installed for Luxas on the Windows side.
- [ ] Startup type Automatic. *Why:* after a Windows restart it comes back without anyone logging in.
- [ ] The last command should show a rule that is enabled. *Why:* installing the server creates
  it; if it is missing, port 22 is closed and step 8 times out. If the command reports that no
  such rule exists, create it in the same window:
  `New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22`
- [ ] Leave the default shell alone (it is `cmd.exe`). *Why:* that setting is machine-wide and
  changes how every ssh command is read.
- [ ] The Luxas side must be able to reach port 22 of this machine. How (same network, VPN,
  tunnel) is your choice. Do not open it to the internet with password login on.

## 3. A new key, and where Windows wants it

On the machine where Luxas runs (the Mac, or the server if runs happen there):

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_luxas_simwin -C luxas-simwin
```

and in `~/.ssh/config` there:

```
Host luxas-simwin
    HostName <the Windows machine's address>
    User luxas
    IdentityFile ~/.ssh/id_luxas_simwin
    IdentitiesOnly yes
    ForwardAgent no
```

- [ ] Make a **new** key. Do not reuse the production server's.
  *Why:* the public half of this key sits on a desktop machine that may later log itself in
  with nobody present (section 11, SOLIDWORKS). If it must be revoked, the production server should not notice.
- [ ] When `ssh-keygen` asks for a passphrase, press Enter twice (none).
  *Why:* the runner connects in a mode that cannot answer a prompt. With a passphrase, step 8
  works by hand and step 10 fails with "Permission denied (publickey)". The key opens one
  standard account and nothing else. If you want a passphrase anyway, the key must be in the
  ssh agent of the account that runs Luxas (on a Mac add `AddKeysToAgent yes` and
  `UseKeychain yes` to the stanza).
- [ ] Keep `ForwardAgent no` in the stanza, and the stanza above any `Host *` block.
  *Why:* the ssh agent on the Luxas side can hold the production server's key, and a forwarded
  agent can be used by any script that runs on the Windows machine. ssh keeps the first value
  it finds for an option, so an earlier `Host *` with `ForwardAgent yes` would win. The runner
  switches forwarding off itself on every connection it makes; this line covers the ones you
  make by hand.
- [ ] Give the runner the alias (`luxas-simwin`), never the address or the key file.
  *Why:* `software.json` holds no secret and no path to one; the runner refuses to read them there.
- [ ] Put the one line of `~/.ssh/id_luxas_simwin.pub` on the Windows machine, in one of the
  two files below. (Remembered, not read: the folder `C:\Users\luxas` appears at that account's
  first logon, so log in as `luxas` once before placing the key.)
  - standard user: `C:\Users\luxas\.ssh\authorized_keys`
  - **if the account is in Administrators**: `C:\ProgramData\ssh\administrators_authorized_keys`
    instead. Microsoft: "This file only applies to administrator accounts. You must use it
    instead of the user-specific file within the user's profile location." Then, as administrator:
    `icacls.exe "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`
    (on a non-English Windows write `"*S-1-5-32-544:F"` in place of `"Administrators:F"`).
  *Why this matters:* with the key in the wrong one of the two files, login fails with
  "Permission denied" and nothing says which file was read.
- [ ] Paste the line with Notepad and save as plain text.
  *Why:* a PowerShell `>` redirect can write the file in a two-byte text encoding (UTF-16), which
  the ssh server cannot read. In Notepad's save dialog choose "All files", so the name does not
  become `authorized_keys.txt` (remembered, not read).

## 4. Python

- [ ] Install 64-bit CPython **3.12** from python.org into a folder without spaces, for example
  `C:\Python312`.
  *Why 3.12:* it is inside every range that was read. The runner's part on the machine needs
  3.8 or newer and nothing else. MPh 1.4.0 (COMSOL) needs 3.10 or newer. ZOSPy 2.2.0 (Zemax)
  needs 3.10 to 3.14, and its pythonnet dependency in the 3.2 series needs 3.11 or newer; one
  Zemax project advises "Use Python 3.11–3.13 (not 3.14)". No version requirement was found for
  pywin32 (SOLIDWORKS). All of them must be 64-bit, like the programs.
  *Why no spaces:* the path is typed on a command line the runner builds. A space in `python` is
  not refused by `simrun hosts`: it is read as two words, and doctor then fails at
  `check "python"`.
- [ ] Not the Microsoft Store Python.
  *Why:* Windows ships a `python.exe` in `%LOCALAPPDATA%\Microsoft\WindowsApps` that is only a
  shortcut to the Store, and an ssh session can find it when a command says just `python`. MPh's documentation reports
  problems with the Store build. So the full path of the real one goes into `software.json`,
  and plain `python` is never relied on.
- [ ] Check it: `C:\Python312\python.exe -c "import sys, struct; print(sys.version, struct.calcsize('P') * 8)"`
  prints a 3.12 version and `64`.
- [ ] Install the libraries, at the desktop, as the `luxas` account:
  `C:\Python312\python.exe -m pip install MPh zospy pywin32`
  *Why you and not an agent:* installing software on this machine is your decision each time.

## 5. The work folder

- [ ] `mkdir C:\luxas`, owned by the `luxas` account, on the local disk, not inside OneDrive.
  *Why:* the runner does not create it; it reports "the operator creates that directory once
  and it must be writable". Short and without spaces because it too is typed on a command line,
  and because Windows paths longer than 260 characters break many programs.
- [ ] `mkdir C:\luxas-checks` for the two small test scripts of step 7.

## 6. Power and updates

- [ ] Sleep: Never. Hibernate: off. *Why:* a sleeping machine does not answer (the runner says
  ssh did not answer), and a job that was running is frozen with it; one frozen past its time
  limit is ended as `timeout` when the machine wakes. (Remembered, not read:
  `powercfg /change standby-timeout-ac 0`.)
- [ ] Decide when Windows Update may restart the machine. *Why:* a restart ends any running job.
  The ssh server comes back by itself, so jobs that need no desktop work again without you.
  Anything that needs the desktop (section 11) does not come back until someone logs in.
- [ ] If file errors come and go later, exclude `C:\luxas` from real-time virus scanning.
  *Why:* scanners briefly hold new files open (remembered, not read).

## 7. Tell Luxas about the machine: `~/.sisyphus/software.json`

On the machine where Luxas runs. You edit this file by hand; the runner only reads it.
First put two test scripts on the Windows machine.

`C:\luxas-checks\comsol_check.py`:

```python
import mph
client = mph.start(cores=1)
model = client.create('check')
model.parameter('a', '2[mm]')
print('a_m', model.parameter('a', evaluate=True))
```

`C:\luxas-checks\zemax_check.py`:

```python
import zospy as zp
zos = zp.ZOS()   # if the registry entry is missing: zp.ZOS(opticstudio_directory=r"<OpticStudio install folder>")
try:
    oss = zos.connect("standalone")
    print("api_ok", bool(zos.Application.IsValidLicenseForAPI), "mode", zos.Application.Mode)
finally:
    zos.disconnect()
```

Then the file (in JSON every backslash is written twice):

```json
{
  "hosts": {
    "simwin": {
      "transport": "ssh",
      "ssh": "luxas-simwin",
      "os": "windows",
      "python": "C:\\Python312\\python.exe",
      "workdir": "C:/luxas",
      "software": {
        "comsol": {
          "launchers": {
            "python": "C:\\Python312\\python.exe",
            "comsolbatch": "C:\\Program Files\\COMSOL\\COMSOL64\\Multiphysics\\bin\\win64\\comsolbatch.exe"
          },
          "check": ["python", "C:/luxas-checks/comsol_check.py"],
          "expect": "a_m 0.002",
          "check_timeout_s": 180,
          "seats": 1,
          "max_minutes": 120,
          "fail_patterns": ["License error", "Nonlinear solver did not converge", "Last time step is not converged", "Out of memory"]
        },
        "zemax": {
          "launchers": {
            "python": "C:\\Python312\\python.exe"
          },
          "check": ["python", "C:/luxas-checks/zemax_check.py"],
          "expect": "api_ok True",
          "check_timeout_s": 180,
          "seats": 1,
          "max_minutes": 30,
          "fail_patterns": ["License is not valid for ZOSAPI use", "Licence is not valid for API"]
        }
      }
    }
  }
}
```

`workdir` is written with forward slashes (`C:/luxas`), not backslashes. *Why:* it is typed
into scp, which drops a backslash from a path it downloads, so every result would be fetched
from the wrong place; the runner refuses a backslash there. `python` and the launcher paths keep
theirs: they never reach scp.

What each line is for:

| Key | Meaning | Why it is there |
|---|---|---|
| `simwin` | your name for the machine | it is what prompts show; the address appears in one place only, ssh's own error line when the machine does not answer |
| `ssh` | the alias from step 3 | keys and addresses stay in `~/.ssh/config` |
| `python`, `workdir` | steps 4 and 5 (`workdir` with forward slashes) | the runner's own part runs with this Python inside this folder |
| `launchers` | the only programs a job may start, by name | an agent names `comsolbatch`; the path is yours. Give full paths. The COMSOL path shown is the 6.4 default: check yours. |
| `check`, `expect` | a command that must take a licence and print a known value | a command that only exits 0, or prints a version, proves nothing about the licence |
| `seats` | how many copies may run at once | the runner then never starts a second while one runs |
| `max_minutes` | the longest one job may run | a hung program holds the seat until someone kills it; this is who kills it |
| `fail_patterns` | text in a job's output that means it failed | COMSOL's batch program is not documented to return an error code, so the text is the signal |

The patterns above are the ones read word for word on vendor pages or in the library's source
(`Licence is not valid for API` is ZOSPy's wording, not the vendor's). Add others only after you
have seen them in a real log. Do not add `FRU__delta_init`: OpticStudio prints that line on a
normal close.

- [ ] Run `python3 skills/compute-methods/scripts/simrun hosts`. *Why:* it prints the file as
  the runner understood it. A misspelt key is a `problem:` line that names the nearest legal one.

## 8. Once by hand: `ssh luxas-simwin whoami`

- [ ] ssh shows the machine's fingerprint and asks whether to continue. Compare it with the one
  the Windows machine prints for its own key, then answer `yes`:
  `ssh-keygen -lf C:\ProgramData\ssh\ssh_host_ed25519_key.pub` (remembered, not read; if ssh
  names another key type, the file name differs). It should then print `<machine name>\luxas`.
  *Why compare:* the answer is stored, and every later connection trusts whichever machine
  answered this one.
  *Why by hand:* the runner connects in a mode that never asks questions, so the very first
  connection, which does ask, has to be yours.
- [ ] `ssh luxas-simwin "C:\Python312\python.exe --version"` prints the version from step 4.

## 9. Start each program once at the desktop, as the `luxas` account

- [ ] Log in as `luxas` at the machine, start COMSOL and OpticStudio, and answer every first-run
  question, licence prompt and update offer until each starts straight into its main window.
  *Why:* over ssh nobody can click. OpticStudio's Python route also looks for an entry in this
  account's own registry (`HKCU\Software\Zemax`) and for the folder `Documents\Zemax`; both are
  expected to appear on the first start (inferred, not read).
- [ ] At the same desktop, run both check scripts with `C:\Python312\python.exe`. They should
  print `a_m 0.002` and `api_ok True`.
  *Why now:* if a check fails here, the cause is the program or its licence. If it works here
  and fails in step 10, the cause is that the job did not run at the desktop. Those are
  different problems with different owners.

## 10. `python3 skills/compute-methods/scripts/simrun doctor simwin`

It runs small test jobs that need no simulator, then each program's `check`. Every line starts
with `ok` or `problem:`. It first prints a note that the Windows parts of the runner have never
run anywhere before your machine: every `ok` below it is their first proof. Until doctor has
passed, the runner refuses jobs on this machine, and agents are told the program is declared
but not usable. The wording below is that of the runner on 2026-10-09; look for the first words.

| Line starts with | What it means | What to do |
|---|---|---|
| `problem: transport: ssh to host … did not answer` or `… failed (exit 255 …)` | the machine was not reached, or the key was refused | machine on and awake; step 2 (firewall rule); step 3 (which key file, saved as plain text; a key with a passphrase that is not in the ssh agent); step 8 done |
| `… the host part could not be copied into the workdir` | `C:\luxas` is missing or not writable by the account | step 5 |
| `… the host part is in place but did not answer: check "python"` | the `python` path is wrong, or it is the Store shortcut | step 4 |
| `problem: Python on the host is …` | older than 3.8 | step 4 |
| `problem: the no-op job ended …` | a job that only prints a word did not run to the end | this is the runner's never-tested Windows code failing; send the whole output to whoever maintains it |
| `problem: the 1 MB round trip failed` | a file came back missing or changed | results cannot be trusted; same as above |
| `problem: … one-seat …` | two test jobs ran at once, or did not finish | the seat lock does not hold here: do not run licensed programs through the runner |
| `problem: cancel left the job …` | cancelling did not end a job | a hung solve would keep the licence; same as above |
| `problem: detachment: …` | Windows ended the job when the command that started it returned | no job longer than one short command can run; same as above |
| `problem: software "comsol": its check ended …` (or `"zemax"`) | the program did not start, or did not get a licence, when started over ssh | compare with step 9, then read section 11 |
| `problem: software "comsol": its check never started, because every seat …` | a job started through the runner held the program for the minute doctor waited | `simrun ps simwin` shows which; let it finish or `simrun cancel` it, then run doctor again |
| `ok software "…": declared without a "check"` | passes, and proves nothing | add a `check` and `expect` |
| `problem: doctor stopped: …` | a step could not be carried out, and the checks after it were not run; the text after the colon is the cause | read it. "refused to start a detached process": this Windows will not let a job outlive the command that starts it. "scp … failed" after `ok transport reachable`: a file could not be copied back (check that `workdir` is written with forward slashes). Otherwise send the whole output to the maintainer |
| `problem: host … did not pass doctor` | the summary line; the cause is the first `problem:` above it | fix that one and run doctor again |

It also says once that a person using a program at the desktop holds the same licence seat and
is invisible to the runner. That stays true after doctor passes: while you are using COMSOL, a
job may fail for lack of a seat.

- [ ] Run it again after the runner is updated, and after you edit this machine's entry in
  `software.json`. *Why:* a pass covers the machine part of the entry (`ssh`, `os`, `python`,
  `workdir`), the way the runner talked to the machine that day, and the checks it ran. Change
  one of those, or add a `check`, and the runner refuses new jobs with "has not passed" (or "its
  check was not run") and agents are told the program is declared but not proven, until doctor
  has passed again. A program you add *without* a `check` is offered to agents at once: give
  every new program a `check`, or `"desktop": true` when it needs the desktop.
- [ ] Run it when no job is running on the machine. *Why:* while doctor runs, and after a run
  that failed, new jobs are refused; a job that was already running can still be waited for,
  cancelled and listed (`simrun ps simwin`). If such a job holds a program's only seat, that
  program's check cannot start and doctor fails with the line in the table above.
- [ ] `simrun hosts` now shows `passed` for the machine.

## 11. First test of each program, and what is already known to be a risk

For each program, put the sheet's smoke test (for most rows a five-line `smoke.py`; the
`comsolbatch` row needs a model file, named in the sheet) in an empty folder and run

    python3 skills/compute-methods/scripts/simrun run <that folder> --software comsol -- python smoke.py

Write what happened into the sheet (`skills/compute-methods/comsol.md` and so on) the same day:
move every answered question out of its "Unknown" section, and delete a row the machine refuted.

### COMSOL

- **The licence may not allow this at all.** From the vendor's licence pages:
  - CPU-locked: "The CPU version of the software may not be accessed or used over a network or remotely."
  - Named single user: "An NSL may be accessed and used via a single encrypted connection
    providing secure remote access, such as a virtual private network (VPN) or remote desktop
    protocol (using network-level authentication and encryption)."
  - Floating network: "You can run the software on a remote computer over your network."

  An agent reaching the machine over ssh is remote use. Whether that fits your licence is your
  decision, or the vendor's; no test settles it. With a CPU-locked licence, do not register
  COMSOL for the runner.
- **A licence may refuse a remote session even when the terms allow it.** The author of MPh
  writes that for single-computer licences COMSOL detects Remote Desktop "and then deliberately
  refuses to run". Whether an ssh session is treated the same way is not written anywhere that
  was found. The check in step 10 is the test.
- **MPh starts COMSOL with its graphics switched on.** What that does where there is no desktop
  is undocumented. If the check fails over ssh and works at the desktop, try the alternative in
  the sheet (stand-alone mode) before concluding anything.
- **The batch program's exit code is undocumented.** Run one job that must fail (a model that
  does not converge) and see what the runner reports. If it says the job succeeded, the text
  patterns in step 7 are the only signal: make sure the real failure text is among them.
- Then, in this order: does a job run with nobody logged in at the desktop; with COMSOL open
  at the desktop, does a job take a second seat, fail, or share; is the batch log plain text or
  the two-byte encoding UTF-16 (the patterns cannot match that); does a picture export work.

### Zemax OpticStudio

- **`IsValidLicenseForAPI` is the gate**, and it can be false on a licence that should allow
  scripting: one 2026 project on the Enterprise edition reports exactly that in the mode the
  runner needs, another on Premium reports it working, and nobody explains the difference.
  Step 9 tells you which you have.
- **Nobody has reported running it over ssh.** No page, issue or project found says whether
  OpticStudio's hidden mode works where there is no desktop. If the check works in step 9 and
  hangs or reports a licence error in step 10, it needs the desktop. Then add `"desktop": true`
  to the `zemax` entry and run doctor again (step 10). The runner then refuses to start it with
  a clear sentence, where otherwise each job would hang until its time limit, and agents are
  told it is declared on the machine but must not be called (the wording is under SOLIDWORKS).
  This build cannot run it in that case.
- **A failed attempt can leave a hidden `OpticStudio.exe` holding the licence**, and the next
  start then hangs. After a failed test, look in Task Manager for an OpticStudio process with no
  window and end it, but only when nobody is using OpticStudio: a person's window is the same
  program name.
- Useful over ssh before blaming the licence: `ssh luxas-simwin "whoami & query session"` and
  `ssh luxas-simwin "reg query HKCU\Software\Zemax /v ZemaxRoot"`.

### SOLIDWORKS

- **This build of the runner cannot start it.** SOLIDWORKS is driven through a Windows
  mechanism (COM) that only works inside a logged-in desktop, and the runner has no helper
  program living there yet. If you list it in `software.json`, give it `"desktop": true`. The
  runner accepts the entry and refuses to start it, in those words, and agents are told
  `[DECLARED on host "simwin": it needs the logged-on desktop session, which this build of the runner cannot start; do not call it; say so in your return]`
  in place of the draft sheet's rows. *Why the key matters:* without it, once doctor has passed,
  agents are told to run SOLIDWORKS through the runner, and each such job is expected to fail
  or hang.
- **What building that helper would cost you, so you can decide first:**
  - The `luxas` account has to stay logged in at the desktop with nobody there, which means
    automatic login at boot. Microsoft's own tool for that stores the password where "a user
    with administrative rights can easily retrieve and decrypt it", and anyone who can touch
    the machine is then that account.
  - Connecting by Remote Desktop and closing the window locks that desktop; it has to be
    handed back to the screen each time.
  - A perpetual SOLIDWORKS licence asks to be reactivated once a year, in a window at
    start-up. That day every job stops until someone clicks.
  - If someone has SOLIDWORKS open, a script attaches to *their* session and can close it.
- The sheet is written for whoever builds the helper, not for today's agents.

## 12. How a sheet earns its `verified:` date

The three sheets (`comsol.md`, `zemax.md`, `solidworks.md` in `skills/compute-methods/`) carry
no `verified:` line. Agents therefore see them under a banner that nobody has run them, and
the reviewer is not asked to re-open a model with them.

A smoke test does not earn the date. It proves the program starts. The rows that can be wrong
without anyone noticing are the *verification* rows: how to measure a saved model. A wrong one
gives a wrong measurement that passes.

A sheet earns `verified: YYYY-MM-DD` when there is a task for that program under `simbench/`,
built like the Blender ones:

- [ ] a `reference.py` that makes a correct model **and** a set of models that open fine but
  are wrong in one known way each (a boundary condition on the wrong face, a lens with one
  radius changed, a hole 1 mm off);
- [ ] a grader that re-opens each saved file and measures it by the sheet's verification rows;
- [ ] the reference passes every check, and each planted fault fails exactly the check it was
  planted for (`scripts/smoke_simbench_graders.mts` is where the Blender ones are held to this).

Then add the date and `verified-on:`, and take "(UNVERIFIED draft)" out of the title. After 90
days the harness marks a dated sheet STALE until the smoke tests are run again and the date moved.

## 13. Dates and rules after which things are deleted

- **2027-01-31**: if no Windows machine has passed `simrun doctor` by then, the Windows-only
  part of the runner is removed. It is code that has never run; unproven, it is a liability.
- **The reviewer's saved-model block** (the part of a review that hands the reviewer a model
  file to re-open) has no date. It is kept only if a planted-fault trial shows it catching at
  least 5 of 6 faults, passing 2 of 2 correct models, catching at least two more faults than a
  review without it, and adding at most $0.50 per round. Otherwise it is deleted.
- **The three draft sheets** have no deletion date in the design. A draft whose program never
  gets a machine stays a draft, and costs nothing while its program is unreachable: agents are
  then told only that the sheet exists and the program is not available.
