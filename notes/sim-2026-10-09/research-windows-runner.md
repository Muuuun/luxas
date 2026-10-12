# Running engineering-software jobs on Windows 11 over OpenSSH — research notes

Date of research: 2026-10-09. Nothing here was executed on a Windows machine. Every statement is
**unverified until tried on the target machine**.

## How to read the provenance tags

- **[read-raw]** — I read the exact text in this session from the raw source (GitHub raw file, `gh api`, CPython `.rst` / `.c`). Quotes are verbatim.
- **[read-fetch]** — I read the page in this session through a fetch tool that converts and, for some pages, summarises. Microsoft Learn pages came back as near-verbatim markdown; a few other pages came back as a summary, so wording may be paraphrased. One proven case: the fetch tool's rendering of `os.kill` differed from the raw `.rst`, so for Python I rely on the raw files only.
- **[snippet]** — seen only in a web-search result summary, page not opened.
- **[recalled]** — from memory, not seen on a page this session.
- **[inferred]** — my deduction from something read; the deduction itself is untested.

---

## 0. Bottom line for the runner design

1. **An ssh login on Windows is a service-side, desktop-less context, and everything it starts is killed when the top-level shell of that ssh command exits** unless the child explicitly breaks away from sshd's job object. This is in the sshd source ([read-raw], §2).
2. So there are two execution lanes, and the host registry must say which lane each program uses:
   - **Lane A, headless** (anything with a real batch mode: `blender -b`, `comsolbatch`, solver CLIs): host-side Python starts it with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB`, stdio redirected to files, returns immediately; the client polls.
   - **Lane B, needs the user's desktop** (GUI applications driven through COM/automation servers): a **worker process that was started inside the logged-on user's session at logon** polls a job-queue directory. The ssh side only writes job files and reads status files. No per-job `schtasks`/PsExec.
3. **The remote command line must be boring.** Fixed interpreter path, fixed script path, verb and job id restricted to `[A-Za-z0-9._-]`. Everything else travels in a JSON file (sftp) or on stdin. This removes the cmd/PowerShell quoting problem instead of solving it.
4. **Never `os.kill(pid, 0)` on Windows** (§5.3). It is not a probe there.
5. Licence seat = one lock directory on the Windows host with a heartbeat, plus (FlexNet only) an `lmutil lmstat` cross-check. The lock is the authority for single-seat/node-locked licences because the licence manager cannot be asked.

---

## 1. Windows 11 OpenSSH Server

### 1.1 Install, start, firewall

Source: <https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse> [read-fetch], page dated 2025-09-04.

Prerequisites quoted: "A device running at least Windows Server 2019 or Windows 10 (build 1809)", "PowerShell 5.1 or later", "An account that is a member of the built-in Administrators group."

Windows 11 pivot, elevated PowerShell:

```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
if (!(Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
}
```

- "Installing OpenSSH Server creates and enables a firewall rule named `OpenSSH-Server-In-TCP`."
- Server 2025 pivot only: "add them to the **OpenSSH Users** user group" to allow/restrict users. Whether current Windows 11 builds apply the same group gate is **not stated** on the page → test.
- The in-box version "might differ" from the GitHub `PowerShell/openssh-portable` releases. Check with `ssh -V` / `sshd -V` on the box. [recalled: Windows 11 24H2 ships roughly `OpenSSH_for_Windows_9.5p1`.]

Config file: `%programdata%\ssh\sshd_config`; "Any changes to the configuration file require the service to be restarted." (<https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration> [read-fetch], dated 2025-08-05).

### 1.2 Default shell

Same page [read-fetch]: "The initial default in Windows is the Windows command prompt (cmd.exe)." Changing it:

```powershell
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
```

Wiki <https://github.com/PowerShell/Win32-OpenSSH/wiki/DefaultShell> [read-raw]:
- `HKLM\SOFTWARE\OpenSSH\DefaultShell` — full path of the shell executable.
- `DefaultShellCommandOption` (optional) — "switch that the configured default shell requires to execute a command, immediately exit and return to the calling process. By default this is `-c`."
- `DefaultShellEscapeArguments` (optional) — "flag that allow you to skip escaping the arguments of default shell. By default this is `0`. This option is only applicable to shells other than powershell, bash, cygwin, cmd, and ssh-shellhost.exe."

Source `contrib/win32/win32compat/pwd.c` (branch `latestw_all`) [read-raw] also reads a fourth value, `DefaultShellArguments`, and falls back to `<System32>\cmd.exe` when `DefaultShell` is absent or empty. `DefaultShell` is a machine-wide value: **changing it changes the quoting rules for every ssh user and tool on that machine** [inferred].

**Runner rule: detect, do not assume.** First call of every connection should be a probe whose output differs by shell, e.g. `echo %OS%` prints `Windows_NT` under cmd and the literal `%OS%` under PowerShell [recalled behaviour; test].

### 1.3 How the remote command string is built (source, not docs)

`contrib/win32/win32compat/w32-doexec.c`, function `do_exec_windows` [read-raw]:

- Shell type is decided by substring of the configured shell path: `system32\cmd` → cmd; `powershell` → PowerShell; `ssh-shellhost`; `\bash`; `cygwin`; else other.
- Command option: registry override if present, else `/c` for cmd, `-c` for everything else.
- **No pty (the normal `ssh host cmd` case), cmd / shellhost**: the code comment says "no escaping needed for cmd and ssh-shellhost"; the process command line is exactly
  `"<shell>" /c "<command exactly as the client sent it>"` (`sprintf_s(..., "%s %s \"%s\"", shell, option, exec_command)`). Inner double quotes are **not** escaped.
- **No pty, PowerShell / bash / cygwin**: argv = `[shell, "-c", command]` and goes through `build_commandline_string` (`misc.c` [read-raw]) which, per argument: wraps it in `"` if it contains a space **unless the argument starts with a single quote** ("leave as is if the command is surrounded by single quotes"); writes every `"` as `\"`; doubles backslashes only when they immediately precede a `"`.
- **With a pty (`ssh -t`)**: command line is `"<shell>" <option> <command>` concatenated with no quoting at all.
- `scp`, `sftp-server`, `internal-sftp` at the start of the command are rewritten to `scp.exe` / `sftp-server.exe` (`build_exec_command`).
- Working directory: `chdir(s->pw->pw_dir)` — the user profile directory.

Consequences [inferred from the above]:

| Trap | Why | Avoid by |
|---|---|---|
| Two layers of quoting (local sh, then cmd or PowerShell) | ssh joins local argv with spaces; remote shell re-parses | one fixed command, safe-charset args |
| cmd metacharacters `& | < > ^ %` act on the Windows side; `'` means nothing to cmd | cmd parses the string after `/c` | never put free text on the command line |
| `%VAR%` expands remotely under cmd, `$var` expands remotely under PowerShell (and `$` expands locally inside local double quotes) | | pass data in files / stdin |
| Under PowerShell a command that starts with `'` is passed without the outer quotes | the single-quote special case in `build_commandline_string` | never start with `'` |
| `ssh -t` changes the quoting rules | pty branch concatenates raw | always `ssh -T` |
| PowerShell: long or complex scripts | | `powershell -NoProfile -NonInteractive -EncodedCommand <base64 of UTF-16LE>` [recalled] or upload a `.ps1` |

Net::OpenSSH's `ShellQuoter::MSCmd` documentation exists precisely because of this (<https://manpages.debian.org/jessie/libnet-openssh-perl/Net::OpenSSH::ShellQuoter::MSCmd.3pm.en.html> [snippet]: cmd.exe "may require not quoting at all when the requested command is a builtin").

### 1.4 Key authentication, administrators

<https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement> [read-fetch], dated 2025-10-03:

- Standard user: `C:\Users\<username>\.ssh\authorized_keys`.
- Administrator: `C:\ProgramData\ssh\administrators_authorized_keys`. "This file only applies to administrator accounts. You must use it instead of the user-specific file within the user's profile location."
- ACL command: `icacls.exe "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`
- Non-English Windows: "you can use the security identifier (SID) in place of the group name … it must be preceded by an asterisk": `/grant "*S-1-5-32-544:F" /grant "SYSTEM:F"`. **Relevant if the machine is a Chinese-language install.**
- "Key-based authentication in OpenSSH for Windows works with local Windows accounts and Active Directory (domain) accounts. Microsoft Entra ID accounts don't support key-based authentication." → the automation account should be a **local** account.
- "A remote session opened via key-based authentication doesn't have associated user credentials. As a result, the session isn't capable of outbound authentication as the user. This behavior is by design." → **no access to network shares / mapped drives as that user from a key-auth ssh session**. Same statement in the wiki page "SSH remote sessions on Windows" [read-raw].

Default `sshd_config` shipped in the source tree (`contrib/win32/openssh/sshd_config`) ends with [read-raw]:

```
Subsystem	sftp	sftp-server.exe
Match Group administrators
       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

Config page [read-fetch]: account names in `AllowUsers`/`Match` "must be specified in lower case"; `PermitRootLogin` "Not applicable in Windows"; **not available on Windows**: `AcceptEnv`, `PermitUserEnvironment`, `AuthorizedKeysCommand`, `StrictModes`, `PidFile`, `X11Forwarding` (and others). So **environment cannot be pushed with `SendEnv`/`SetEnv`** — set it inside the host-side script.

Wrong ACL symptom: the wiki says only that misconfiguration "would manifest as an attention seeking log entry" [read-fetch]; the client just falls through to password or `Permission denied (publickey,…)` [recalled]. For file logs set `SyslogFacility LOCAL0` → `%programdata%\ssh\logs` [read-fetch].

[snippet, virtualizationhowto / MS docs search summary]: the reason for the separate admin file is "to prevent a user from bypassing a UAC prompt to gain access to an elevated command prompt" — i.e. an administrator's ssh session is elevated. Whether the token is the full elevated one in the in-box build: **test with `whoami /groups`** (look for `Mandatory Label\High Mandatory Level`).

### 1.5 scp / sftp and path syntax

- sftp subsystem is on by default (above). Wiki "sftp.exe examples" [read-raw] shows `cd /tests  //changed to remote directory c:/tests` and states elsewhere "SFTP doesn't support chmod" (Various Considerations [read-raw]).
- Server-side path resolution, `misc.c` realpath [read-raw]: a path of the form `/X:/…` has the leading slash dropped (`path[0]=='/' && path[2]==':'` → "skip the first '/'"), `X:` alone becomes `X:\`, and `/` alone is the virtual root. So **both `C:/lx/jobs/a` and `/C:/lx/jobs/a` are accepted**; use forward slashes.
- OpenSSH 9.0 release notes <https://www.openssh.org/txt/release-9.0> [read-fetch]: "This release switches scp(1) from using the legacy scp/rcp protocol to using the SFTP protocol by default." and "the scp(1) client may be instructed to use the legacy scp/rcp using the -O flag." So a modern macOS/Linux `scp` to Windows goes through `sftp-server.exe`; remote wildcards/quoting follow SFTP rules.
- Server-side rename used by sftp-server (`w32_rename` in `misc.c` [read-raw]): `MoveFileExW(old, new, MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED)`.

### 1.6 PATH and environment of an ssh session

`w32-doexec.c` `setup_session_user_vars` [read-raw]: "PATH is a special case. The System Path value is prepended to the User Path value" — it reads `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\PATH` and `HKCU\Environment\PATH` from the **registry** at session setup and sets `PATH = system;user`. `HOMEDRIVE`/`HOMEPATH` are set if missing; `PROMPT` is set to `user@COMPUTERNAME $P$G` for non-subsystem sessions.

[inferred] PATH edits made through the normal Windows UI/`setx` should be visible to the next ssh session without restarting sshd; other variables may still come from the service's inherited environment block — **not traced, test**. Because the user PATH part normally contains `%LOCALAPPDATA%\Microsoft\WindowsApps`, the Store `python` stub is reachable from ssh (§5.1).

---

## 2. The session an ssh login runs in

### 2.1 No desktop

- Microsoft, Interactive Services <https://learn.microsoft.com/en-us/windows/win32/services/interactive-services> [read-fetch]: "Services cannot directly interact with a user as of Windows Vista." "All services run in Terminal Services session 0." "By default, services use a noninteractive window station and cannot interact with the user." Recommended alternative: "Create a separate hidden GUI application and use the CreateProcessAsUser function to run the application within the context of the interactive user. Design the GUI application to communicate with the service through some method of interprocess communication (IPC)".
- sshd design wiki [read-raw]: "SSHD will be implemented as a Windows service … the privileged monitor spawns one more worker running in the context of the authenticated user … launched using CreateProcess(user_token)". Source: `CreateProcessAsUserW(as_user, …)` in `w32fd.c` with no session switch [read-raw].
- Third-party statement of the same thing, cua.ai docs <https://cua.ai/docs/how-to-guides/driver/windows-ssh> [read-fetch]: "Windows OpenSSH runs in Session 0, which has no desktop, so window tools return empty results there." Their fix is the same pattern as Lane B: a daemon in the interactive session registered as an autostart scheduled task, reached over a named pipe; "Sign in through SSH with the same Windows account that owns the interactive daemon. The named pipe is private to that account; another account can see the pipe but gets `Access is denied`."

What this means for a process started over ssh [inferred + recalled, test each]: it can run console/batch programs; windows it creates are invisible and unreachable; a modal dialog (licence prompt, crash dialog, "file exists, overwrite?") blocks forever with nobody able to click it; COM automation of GUI applications commonly fails (SolidWorks forum via search [snippet]: "80080005 Server execution failed" when called from a service).

**GPU**: I found no primary source. [recalled] Compute APIs (CUDA) usually work from session 0; anything needing a display/OpenGL context or a presentable surface may not. **Must be tested per program** (e.g. Blender Cycles GPU vs EEVEE from ssh).

### 2.2 What happens to children when the session ends — the job object

`w32-doexec.c` [read-raw]:

```c
job_info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
/*
* assign job object to control processes spawned
* 1. create job object
* 2. assign child to job object
* 3. duplicate job handle into child so it would be the last to close it
*/
... CreateJobObjectW ... AssignProcessToJobObject(job, process_handle) ...
DuplicateHandle(GetCurrentProcess(), job, process_handle, &job_dup, 0, FALSE, DUPLICATE_SAME_ACCESS)
... CloseHandle(job);   /* sshd's own handle */
```

Reading this [inferred]: the only surviving job handle lives in the **top-level shell process of that ssh command** and is not inheritable (`bInheritHandle FALSE`). When that shell exits — normally because the command finished, or because the connection dropped — the last handle closes and **every process still in the job is terminated**. This is stricter than "killed when the session ends": `ssh host "start /b solver.exe"` kills `solver.exe` as soon as `cmd /c` returns.

Microsoft job-object semantics <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects> [read-fetch]: "if the job has the JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE flag specified, closing the last job object handle terminates all associated processes"; "After a process is associated with a job, by default any child processes it creates using CreateProcess are also associated with the job. (Child processes created using Win32_Process.Create are not associated with the job.)"; "If the job has the extended limit JOB_OBJECT_LIMIT_BREAKAWAY_OK and the parent process was created with the CREATE_BREAKAWAY_FROM_JOB flag, then child processes of the parent process are not associated with the job."

Issue history [read-raw via `gh api`]:
- <https://github.com/PowerShell/Win32-OpenSSH/issues/1032> "Allow Breakaway OK on SSH Job" (2018-01): maintainer first — "This is intentional … you may use Task Scheduler to achieve background job/process execution", then "we should allow child processes to break away at their liberty. This will be fixed in the next drop." A later comment places it in release v7.6.0.0p1-Beta.
- <https://github.com/PowerShell/Win32-OpenSSH/issues/1195> (open since 2018): "By design we associate the job object with the initial process, so that all the child processes are cleaned-up automatically." "By default all the processes launched by SSH are closed once the SSH session is closed. If you want the process to execute independent of ssh session then you need to try spawn your process with special flags". "windows OS doesn't have nohup, screen, tmux. All these utilities are out of scope of this project."

### 2.3 Ways to start a process that outlives the ssh command

Flag values, <https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags> [read-fetch]: `CREATE_BREAKAWAY_FROM_JOB 0x01000000` ("If the calling process is associated with a job, the job must set the JOB_OBJECT_LIMIT_BREAKAWAY_OK limit"), `CREATE_NEW_PROCESS_GROUP 0x00000200` ("CTRL+C signals will be disabled for all processes within the new process group"), `DETACHED_PROCESS 0x00000008`, `CREATE_NO_WINDOW 0x08000000` ("ignored … if it is used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS"), `CREATE_NEW_CONSOLE 0x00000010`.

Python exposes all of them as `subprocess.*` constants, `DETACHED_PROCESS`, `CREATE_NO_WINDOW`, `CREATE_BREAKAWAY_FROM_JOB` "Added in version 3.7" (<https://docs.python.org/3/library/subprocess.html> [read-fetch]).

**(a) Python, stdlib only — recommended for Lane A** [composed from the read facts; untested]:

```python
import subprocess, sys
flags = (subprocess.DETACHED_PROCESS
         | subprocess.CREATE_NEW_PROCESS_GROUP
         | subprocess.CREATE_BREAKAWAY_FROM_JOB)
with open(log_path, "ab", buffering=0) as log:
    p = subprocess.Popen(argv_list,                 # list, never a shell string
                         cwd=job_dir,
                         stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                         creationflags=flags, close_fds=True)
write_pid_record(p.pid)                             # then exit quickly
```

Notes: stdio **must not** be the ssh pipes, or ssh will not return until the child exits [recalled; same rule as POSIX]. The thing to detach is a small **supervisor** (a second `python host.py _supervise <job>`), which then starts the real program as an ordinary child, waits, and writes `exit.json`; that way the exit code is captured and a tree-kill of the supervisor's pid takes the solver with it. If breakaway is refused, CreateProcess fails with access denied → Python `PermissionError: [WinError 5]` [recalled]; the fallback is (b) or (c).

**(b) WMI / CIM** (from a comment by an Ansible maintainer on issue 1032 [read-raw]):

```powershell
$proc_info = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -Property @{CreateFlags=16777216} -ClientOnly
$arguments = @{CommandLine="cmd.exe"; ProcessStartupInformation=$proc_info}
Invoke-CimMethod -ClassName Win32_Process -Name Create -Arguments $arguments
```

`16777216` = `0x01000000` = `CREATE_BREAKAWAY_FROM_JOB`. Microsoft's `Win32_Process.Create` page <https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/create-method-in-class-win32-process> [read-fetch]: "A fully qualified path must be specified in cases where the program to be launched is not in the search path of Winmgmt.exe." "For security reasons the Win32_Process.Create method cannot be used to start an interactive process remotely." "Processes created with the Win32_Process.Create method are limited by the job object unless the CREATE_BREAKAWAY_FROM_JOB flag is specified." (That last sentence and the job-objects page's parenthesis read as contradictory; pass the flag and it does not matter.) Return values: 0 success, 2 access denied, 3 insufficient privilege, 8 unknown failure, 9 path not found, 21 invalid parameter. No stdout capture; it is not a way onto the desktop.

**(c) Scheduled task** — the route the sshd maintainer named. `schtasks /create` reference <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create> [read-fetch]: `/tr` "The path name must not exceed 262 characters"; `/sc once` requires `/st`; `/z` "delete the task upon the completion of its schedule"; `/f` overwrite; `/rl HIGHEST|LIMITED` (default Limited); `/np` "No password is stored. The task runs non-interactively as the given user. Only local resources are available."; "Schtasks always prompts for a password unless you provide one"; "Schtasks doesn't verify program file locations or user account passwords … the task is created, but it won't run." Objection from the issue thread [read-raw]: "You need to be an administrator to create the jobs; Cleanup can fail causing all sorts of issues".

**(d) `Start-Process`** — I found no source showing that PowerShell's `Start-Process` sets the breakaway flag; issue 1195 reports `START` from a batch file being killed. Treat `Start-Process`/`start` as **not sufficient** over ssh [inferred; test].

---

## 3. Running a program that needs the logged-on user's desktop

### 3.1 `schtasks /it`

`/it` [read-fetch, same page]: "Specifies to run the scheduled task only when the run as user … is logged on to the computer." A task with `/it` shows "**Logon Mode** … Interactive only" in `schtasks /query /v`. Task Scheduler API <https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_logon_type> [read-fetch]: `TASK_LOGON_INTERACTIVE_TOKEN` (3) "User must already be logged on. The task will be run only in an existing interactive session."; `TASK_LOGON_S4U` (2) "the task will run in a non-interactive desktop … no access to either the network or to encrypted files"; `TASK_LOGON_PASSWORD` (1) password stored at registration.

Shape of a per-job launch from ssh [composed; untested]:

```bat
schtasks /create /tn lx_job_0042 /tr "C:\lx\bin\run_job.cmd 0042" /sc once /st 23:59 /ru WORKSTATION\simuser /it /f
schtasks /run /tn lx_job_0042
schtasks /query /tn lx_job_0042 /fo csv /nh
schtasks /delete /tn lx_job_0042 /f
```

Open points: whether `/create … /it` prompts for a password in a key-auth ssh session (the page says schtasks "always prompts … unless you provide one"; a prompt with no tty would hang or fail); whether `/st` in the past is rejected ("Schtasks won't let you schedule a task to run once if the date and time specified are in the past") or only warned. Registering from XML with `<LogonType>InteractiveToken</LogonType>` (`schtasks /create /xml`) or PowerShell `Register-ScheduledTask` with an interactive principal avoids the password question [recalled].

### 3.2 PsExec `-i`

<https://learn.microsoft.com/en-us/sysinternals/downloads/psexec> [read-fetch], page "Published: April 11, 2023": usage `psexec [\\computer…][-u user [-p psswd]][-n s][-r servicename][-h][-l][-s|-e][-x][-i [session]][-c [-f|-v]][-w directory][-d][-<priority>][-g n][-a n,n,...][-accepteula][-nobanner] cmd [arguments]`. `-i`: "Run the program so that it interacts with the desktop of the specified session on the remote system. If no session is specified the process runs in the console session." `-d`: "Don't wait for process to terminate (non-interactive)." `-h`: elevated token. `-accepteula`: "suppresses the display of the license dialog." "some anti-virus scanners report that one or more of the tools are infected with a 'remote admin' virus."

It is a separate download that installs a service and trips antivirus. **Not recommended as the primary mechanism**; keep as a manual diagnostic. `pypsexec` (§7) is the same idea in Python and needs SMB/445 and admin.

### 3.3 Recommended: a session worker started at logon, polling a queue directory

This is Microsoft's own advice for services (§2.1) and the pattern cua-driver uses. Worker = the same stdlib-only `host.py` in `worker` mode.

Start it one of two ways (both done once, by the human, at the console):
- Startup folder shortcut (`shell:startup`) running `pythonw.exe C:\lx\bin\host.py worker` [recalled], or
- Task Scheduler task, trigger "At log on" of that user, "Run only when user is logged on" (= interactive token): `schtasks /create /tn lx_worker /tr "C:\lx\bin\worker.cmd" /sc onlogon /ru WORKSTATION\simuser /it /rl highest /f` [composed from the reference; untested]. `/sc ONLOGON`: "runs whenever a user (any user) logs on"; with `/mo ONLOGON` semantics "when the user specified by the /ru parameter logs on". `/delay mmmm:ss` is valid for ONLOGON.

Protocol [design]:
- ssh side (`host.py submit`): validate job, write `queue\<id>.json.tmp`, `os.replace` to `queue\<id>.json`.
- worker: claim by renaming `queue\<id>.json` → `claimed\<id>.json` (rename is the atomic claim), take the seat lock, run, write `jobs\<id>\exit.json` via temp+replace, release lock.
- worker heartbeat file `worker\alive.json` (pid, process creation time, session id, timestamp) rewritten every N seconds; `host.py status` reports **"no worker alive"** as its own typed state so the agent does not wait on a queue nobody reads.
- The worker is long-lived, so the COM server it starts (e.g. the CAD application) can be kept open across jobs or restarted per job — registry decides.

Why this beats per-job `schtasks /it`: no admin rights per job, no 262-character `/tr` limit, no password question, no task litter after crashes, and "is anybody there" is observable.

### 3.4 Keeping that session alive and unlocked without an RDP client

- **Autologon** <https://learn.microsoft.com/en-us/sysinternals/downloads/autologon> [read-fetch] (published 2016-08-29): "Windows uses the credentials you enter with Autologon, which are encrypted in the Registry, to log on the specified user automatically." Warning verbatim: "Although the password is encrypted in the registry as an *LSA secret*, a user with administrative rights can easily retrieve and decrypt it." "When Exchange Activesync password restrictions are in place, Windows will not process the autologon configuration." Microsoft's note <https://learn.microsoft.com/en-us/windows/win32/secauthn/protecting-the-automatic-logon-password> [read-fetch]: if Winlogon cannot find the LSA-stored password "it will use the **DefaultPassword** value of the Winlogon key (if it exists)" — the plain registry method stores the password in clear text [recalled detail of the Winlogon values `AutoAdminLogon`, `DefaultUserName`, `DefaultPassword`].
- **RDP then disconnect** locks the session. `tscon` reference <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/tscon> [read-fetch]: syntax `tscon {<sessionID> | <sessionname>} [/dest:<sessionname>] [/password:<pw> | /password:*] [/v]`; "You must have Full Control access permission or Connect special access permission"; remark "You can't connect to the console session." The widely used trick `tscon <id> /dest:console` (hand your RDP session to the physical console so it stays unlocked) is **not documented on that page**; it appears in RPA vendor knowledge bases [snippet, EdgeVerve / UiPath]: batch `for /f "skip=1 tokens=3" %%s in ('query user %USERNAME%') do ( %windir%\System32\tscon.exe %%s /dest:console)` run "with admin rights"; side effect "screen resolution of unattended RDP session maintained by TSCON is typically 1024x768 or 640×480".
- Microsoft Power Automate docs [snippet]: "Windows 10 and Windows 11 devices can't run unattended desktop flows if any active Windows user sessions are present (even a locked one)." — evidence that Microsoft's own unattended UI automation treats session state as a hard precondition.

**Security cost, stated plainly**: autologon + no lock screen means anyone with physical access has that account, and any local administrator can recover its password. Mitigations: dedicated low-privilege local account that owns nothing but the job directory and the software licence; machine in a locked room; no saved credentials for other systems in that profile; BitLocker does not help once booted. Whether a **locked but logged-on** session is enough for COM automation (as opposed to pixel-level GUI automation) is unknown → test, because it would remove the need to stay unlocked.

Also needed for unattended operation [recalled]: disable sleep/hibernate (`powercfg /change standby-timeout-ac 0`), and plan for Windows Update reboots (after a reboot the worker only returns if autologon is on).

---

## 4. File transfer from Linux / macOS to Windows

| Method | Works with stock Windows sshd? | Notes |
|---|---|---|
| `scp -r local user@host:C:/lx/in/` | yes (SFTP protocol since client 9.0; legacy protocol with `-O` hits `scp.exe`) | no atomicity; partial tree visible during copy |
| `sftp -b batch.txt user@host` | yes | scriptable `mkdir`, `put -r`, `rename`; exit status non-zero on first failing command in batch mode [recalled] |
| `rsync` | **no** — needs an rsync binary on Windows | Win32-OpenSSH issue 1266 [read-raw]: "this is not in this project's scope"; works only with a cygwin/msys2 `rsync.exe` installed, paths become `/cygdrive/c/...` |
| `tar -cf - dir \| ssh host "tar -xf - -C C:\lx\in"` | probably (Windows ships `tar.exe`) [recalled] | single stream, fast for many small files; test binary-safety of stdin under cmd |

Pitfalls:

1. **Atomic publish**: upload to `in\<id>.partial\`, then one `rename` to `in\<id>\`, then submit. The host side must never read a directory it did not see renamed. Server rename is `MoveFileExW(… REPLACE_EXISTING | COPY_ALLOWED)` [read-raw], but whether the sftp client's `rename` is refused when the target exists depends on client/server extension negotiation — design so the target never exists.
2. **Line endings**: sftp/scp are binary; nothing is converted. Python and most solver inputs accept LF. `.bat`/`.cmd` files written on macOS with LF endings can misbehave [recalled] → do not ship batch files; ship `.py` and JSON.
3. **Long paths**: 260-character `MAX_PATH` unless `LongPathsEnabled`=1 under `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` (<https://docs.python.org/3/using/windows.html> [read-raw 3.13 `.rst` line 106]) — and the engineering application itself may still not cope. Keep the job root short (`C:\lx\j\<id>`), cap relative path length at submit time.
4. **Files locked by running programs**: a solver or CAD process holds its model file; reading it mid-run may fail or give a torn file. Fetch only after `exit.json` exists, and fetch from a manifest written by the host side.
5. **Antivirus / indexer**: freshly written files can be briefly held open by Defender or Search; `os.replace`, delete and directory rename then fail transiently with `PermissionError` (`WinError 5` / `WinError 32`) [recalled] → bounded retry with backoff around every rename/delete on the Windows side.
6. **Case-insensitive, reserved names**: `CON`, `NUL`, `AUX`, trailing dots/spaces, and `: * ? " < > |` are invalid [recalled] → validate names client-side.
7. **Text config for sshd itself** must be ASCII or UTF-8 ("UTF-16 variants are not supported", wiki [read-raw]) — relevant if a PowerShell redirect writes `authorized_keys` as UTF-16.
8. `chmod` over sftp does nothing (wiki [read-raw]); permissions are ACLs.

---

## 5. Python on Windows for the host-side part

### 5.1 Which Python

- Store alias: 3.13 docs [read-raw]: the Store package makes `python`, `python3`, `python3.x` available; "Open 'Manage App Execution Aliases' through Start to select which version of Python is associated with each command." Current (`main`) docs troubleshooting table [read-raw]: aliases live in `%UserProfile%\AppData\Local\Microsoft\WindowsApps`. On a machine with **no** Python installed, the `python.exe` there is a stub: [recalled] it prints "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > …App execution aliases" and exits with a non-zero code (9009 in cmd). The COMSOL MCP README independently requires "Python 3.10+ (NOT Windows Store version)" [read-raw].
- Launcher: 3.13 docs [read-raw]: "The launcher will be installed into the Windows directory"; "System-wide installations of Python 3.3 and later will put the launcher on your PATH." Commands: `py -3`, `py -V:3.13`, `py -0p` (list with paths). The `main` docs describe the newer **Python install manager** where `py list` is the listing command, "`-0` and `-0p` … are retained", and the manager's own directory may be `%LocalAppData%\Python\bin` or under `…\WindowsApps\PythonSoftwareFoundation.PythonManager_*` [read-raw].
- **Runner rule**: at host setup run once `py -3 -c "import sys;print(sys.executable)"`, store the absolute `python.exe` path in the host registry, and from then on call that absolute path. Never rely on bare `python`.
- Some applications bundle their own interpreter (Blender; AEDT embeds "CPython 3.10+", PyAEDT doc [read-raw]). The host runner should use a plain system Python and treat the application's interpreter as part of the job.

### 5.2 Encoding of stdout

- `PYTHONUTF8` [read-raw `cmdline.rst`]: "If set to `1`, enable the Python UTF-8 Mode." Added 3.7. Or `-X utf8`.
- `PYTHONIOENCODING` [read-raw]: "overrides the encoding used for stdin/stdout/stderr, in the syntax `encodingname:errorhandler`"; "On Windows, the encoding specified by this variable is ignored for interactive console buffers unless PYTHONLEGACYWINDOWSSTDIO is also specified. Files and pipes redirected through the standard streams are not affected."
- `windows.rst` [read-raw]: "Windows still uses legacy encodings for the system encoding (the ANSI Code Page). Python uses it for the default encoding of text files".

Over ssh without a pty, stdout is a pipe, so without UTF-8 mode Python encodes with the ANSI code page (cp936 on a Chinese install, cp1252 on Western) [inferred]. Since `AcceptEnv` is unsupported, set it in the command or the code:

```
C:\Path\python.exe -X utf8 -u C:\lx\bin\host.py status 0042
```

and inside: `sys.stdout.reconfigure(encoding="utf-8", newline="\n")`; emit one JSON object with `ensure_ascii=True`. Output of Windows tools the host script calls (`schtasks`, `tasklist`, `taskkill`, `lmutil`) is in the OEM code page and **localised** → decode with `errors="replace"`, use `/fo csv /nh`, branch on exit codes, never on message text.

### 5.3 Is a pid alive — and why `os.kill(pid, 0)` is wrong

Python 3.13 `Doc/library/os.rst` [read-raw]:

> Windows: The `signal.CTRL_C_EVENT` and `signal.CTRL_BREAK_EVENT` signals are special signals which can only be sent to console processes which share a common console window, e.g., some subprocesses. Any other value for *sig* will cause the process to be unconditionally killed by the TerminateProcess API, and the exit code will be set to *sig*.

`Modules/posixmodule.c` `os_kill_impl` [read-raw]:

```c
if (sig == CTRL_C_EVENT || sig == CTRL_BREAK_EVENT) {
    if (GenerateConsoleCtrlEvent(sig, (DWORD)pid) == 0) { return PyErr_SetFromWindowsErr(0); }
    Py_RETURN_NONE;
}
HANDLE handle = OpenProcess(PROCESS_ALL_ACCESS, FALSE, (DWORD)pid);
...
BOOL res = TerminateProcess(handle, sig);
```

Win32 values, <https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent> [read-fetch]: "**CTRL_C_EVENT** 0", "**CTRL_BREAK_EVENT** 1"; for CTRL_C_EVENT "If *dwProcessGroupId* is nonzero, this function will succeed, but the CTRL+C signal will not be received by processes within the specified process group"; "If this parameter is zero, the signal is generated in all processes that share the console of the calling process."

So on Windows:
- `os.kill(pid, 0)` → signal 0 **is** `CTRL_C_EVENT` → `GenerateConsoleCtrlEvent(0, pid)`. Its success or failure says nothing reliable about whether `pid` exists, and `os.kill(0, 0)` sends Ctrl+C to everything on the caller's console.
- `os.kill(pid, n)` for any other `n` (including `signal.SIGTERM` = 15) **terminates the process** with exit code `n`.

Correct stdlib-only probe [composed; constants recalled; untested]:

```python
import ctypes
from ctypes import wintypes as wt

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0, WAIT_TIMEOUT = 0x0, 0x102
ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER = 5, 87

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.OpenProcess.argtypes = (wt.DWORD, wt.BOOL, wt.DWORD);            k32.OpenProcess.restype = wt.HANDLE
k32.WaitForSingleObject.argtypes = (wt.HANDLE, wt.DWORD);            k32.WaitForSingleObject.restype = wt.DWORD
k32.GetExitCodeProcess.argtypes = (wt.HANDLE, ctypes.POINTER(wt.DWORD)); k32.GetExitCodeProcess.restype = wt.BOOL
k32.GetProcessTimes.argtypes = (wt.HANDLE,) + (ctypes.POINTER(wt.FILETIME),) * 4; k32.GetProcessTimes.restype = wt.BOOL
k32.CloseHandle.argtypes = (wt.HANDLE,);                             k32.CloseHandle.restype = wt.BOOL

def probe(pid):
    """-> ("running", create_time) | ("exited", exit_code) | ("gone", None) | ("denied", None)"""
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid)
    if not h:
        err = ctypes.get_last_error()
        if err == ERROR_INVALID_PARAMETER: return ("gone", None)      # no such pid
        if err == ERROR_ACCESS_DENIED:     return ("denied", None)    # exists, not ours
        raise ctypes.WinError(err)
    try:
        if k32.WaitForSingleObject(h, 0) == WAIT_TIMEOUT:
            c, e, k, u = wt.FILETIME(), wt.FILETIME(), wt.FILETIME(), wt.FILETIME()
            k32.GetProcessTimes(h, c, e, k, u)
            return ("running", (c.dwHighDateTime << 32) | c.dwLowDateTime)
        code = wt.DWORD()
        k32.GetExitCodeProcess(h, ctypes.byref(code))
        return ("exited", code.value)
    finally:
        k32.CloseHandle(h)
```

Why `WaitForSingleObject(h, 0)` and not only `GetExitCodeProcess`: Microsoft [read-fetch, <https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess>]: "If the process has not terminated and the function succeeds, the status returned is STILL_ACTIVE"; "an application should not use STILL_ACTIVE (259) as an error code … applications that test for that value could interpret it to mean that the thread is still running". The handle needs "PROCESS_QUERY_INFORMATION or PROCESS_QUERY_LIMITED_INFORMATION".

**Pid reuse**: Windows recycles pids quickly. Store `(pid, creation_time)` in the pid record and treat a different creation time as "gone". If the supervisor is alive it simply holds the `Popen` object and calls `p.poll()`; the ctypes probe is for a *later* ssh invocation.

### 5.4 Killing a process tree

<https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill> [read-fetch]: syntax `taskkill [/s <computer> …] {[/fi <filter>] [...] [/pid <processID> | /im <imagename>]} [/f] [/t]`; `/t` "Ends the specified process and any child processes started by it."; `/f` "Specifies that processes be forcefully ended."

```
taskkill /PID <supervisor_pid> /T /F
```

Caveats [inferred/recalled]: the tree is by parent pid, so children whose parent already exited are missed; applications that hand off to a pre-existing server process (COM out-of-proc servers, licence helpers) are not children at all. The registry should list per-program **image names to sweep** after a kill (e.g. the solver's server exe) and the sweep must be filtered to the automation user (`/fi "USERNAME eq simuser"`), never a bare `/im`. `Popen.terminate()`/`kill()` on Windows both call `TerminateProcess` on that one process only ([read-fetch] subprocess docs). `CTRL_BREAK_EVENT` to a `CREATE_NEW_PROCESS_GROUP` child is the only graceful stdlib signal and only for console programs sharing a console — with `DETACHED_PROCESS` there is no shared console, so plan for hard kill plus a cooperative `cancel` flag file that the supervisor polls.

### 5.5 Atomic rename

`os.replace` [read-raw]: "If *dst* exists and is a file, it will be replaced silently if the user has permission. … If successful, the renaming will be an atomic operation (this is a POSIX requirement)." `os.rename` [read-raw]: "On Windows, if *dst* exists a `FileExistsError` is always raised." CPython implements both with `MoveFileExW`, `flags = is_replace ? MOVEFILE_REPLACE_EXISTING : 0` [read-raw `posixmodule.c`].

- The docs' atomicity sentence is about POSIX; on NTFS a same-volume `MoveFileExW` replace is effectively atomic for readers [recalled] — keep temp and destination in the **same directory**.
- When *dst* is open in another process without delete-sharing (Python's `open()` does not request it), the replace fails with `PermissionError` [recalled: `WinError 5` or `32`]. A client that polls `status.json` over ssh while the supervisor rewrites it will hit this. → writer: retry ~10× with 20–200 ms backoff; reader: open, read, close immediately; or make status append-only (`events.jsonl`) so nothing is replaced.
- `os.rename(dir_a, dir_b)` where `dir_b` does not exist is the atomic "claim" primitive on both OSes; it raises if `dir_b` exists (POSIX: only if non-empty) — always use fresh unique target names.

### 5.6 Lock primitives, stdlib only, both OSes

| Primitive | POSIX | Windows | Auto-released on crash? | Use for |
|---|---|---|---|---|
| `os.mkdir(lockdir)` | atomic, `FileExistsError` if held | same | **no** → needs stale handling | the seat lock (inspectable, works from any process, any session) |
| `os.open(path, O_CREAT\|O_EXCL\|O_WRONLY)` | atomic | atomic | no | same, single file |
| `msvcrt.locking(fd, LK_NBLCK, n)` | — | byte-range lock | yes (handle closes with process) [recalled] | short critical sections on the host |
| `fcntl.flock` / `lockf` | advisory | — | yes | not needed on the Windows side |

`msvcrt.locking` [read-raw]: "Lock part of a file based on file descriptor *fd* from the C runtime. Raises OSError on failure. The locked region of the file extends from the current file position for *nbytes* bytes". `LK_LOCK`/`LK_RLCK`: "If the bytes cannot be locked, the program immediately tries again after 1 second. If, after 10 attempts, the bytes cannot be locked, OSError is raised." `LK_NBLCK`: "If the bytes cannot be locked, OSError is raised."

The seat lock lives **on the Windows host** (that is where the seat is), so only Windows semantics matter; the client never takes the lock itself, it asks `host.py`.

Stale detection and safe break [design]:

```
C:\lx\locks\<software>.lock\
    owner.json   {job_id, pid, pid_create_time, session_id, lane, acquired_at, host_boot_time}
    heartbeat    (mtime touched every 15 s by the supervisor/worker)
```

- Stale iff **(a)** `probe(pid)` is `gone`, or `running` with a different creation time, or `host_boot_time` differs from the current boot; **and/or (b)** heartbeat older than a generous multiple (≥ 4×) of the interval. Use (a) as the primary test; (b) alone only when (a) cannot be evaluated (`denied`). Heartbeat age must be computed with the Windows host's own clock on both ends (mtime vs. `time.time()` on the host), never the client's clock.
- Break = `os.rename(lockdir, lockdir + ".stale." + uuid)`. Only one breaker's rename succeeds; then remove the renamed directory; then compete for the lock normally with `os.mkdir`. **Never** `rmtree` followed by `mkdir`, which lets two breakers both win.
- After breaking, before starting a new job: sweep the registry's image names for the automation user, and (FlexNet) confirm with `lmstat` that the seat is actually back.
- A solver that is still running legitimately for days must keep heartbeating through its supervisor; the supervisor heartbeats on a timer thread independent of solver output.

---

## 6. Licence-seat coordination

### 6.1 What the licence manager can tell you (FlexNet / FLEXlm)

- `lmstat` usage, FLEXlm End User Manual chapter "License Administration Tools" <https://public.dhe.ibm.com/software/rational/docs/documentation/manuals/rose2001unix/html/FLEXlm_End-User_Manual/chap6.htm> [read-fetch, old manual]: `lmstat [-a] [-A] [-c license_file] [-f feature] [-i [feature]] [-S vendor] [-s hostname] [-t value]`. Current syntax per Revenera search result [snippet; the Revenera site returned HTTP 403 to my fetch]: `lmstat [-a [--no-user-info]] [-asec] [-c license_file_list] [-f [feature] [--no-user-info]] [-i [feature]] [-s[server]] [-S [vendor]] [-t timeout_value] [-proj]`.
- Command lines and output shape, Safe Software admin guide <https://docs.safe.com/fme/html/FME-Form-Documentation/FME-Form-Admin-Guide/FMEInstallation/Monitoring_Floating_License_Use.htm> [read-fetch]: `lmutil lmstat -a -c <license file>`, `lmutil lmstat -f FME -c safe.lic`; output `Users of f1: (Total of 4 licenses issued; Total of 1 license in use)` then per-checkout lines like `daniel myhost2 19.36.18.26 (v1.0) (myhost1/40000 102), start Fri 2/28 14:29`. `-c` also accepts `port@host` [recalled].
- Parse only the `Users of <feature>:  (Total of N license(s) issued;  Total of M license(s) in use)` line with a tolerant regex; singular/plural and spacing vary. If `lmutil` is missing or the server is unreachable, report `licence_state: "unknown"`, not "free".
- `lmremove` [read-fetch, same old manual]: `lmremove [-c file] feature user host display`; "If the application is active, it will re-checkout the license". It is an administrator tool for crashed clients; **the runner must not call it**.

### 6.2 Timeout and linger (options file, server side)

FLEXlm End User Manual ch. 5 <https://public.dhe.ibm.com/software/rational/docs/documentation/manuals/rose2001unix/html/FLEXlm_End-User_Manual/chap5.htm> [read-fetch, summarised]:
- `TIMEOUT featurename seconds` — "Sets the time after which an inactive license is reclaimed by the vendor daemon." Default minimum 900 s (15 min), vendors can set their own minimum. Requires the application to declare itself idle / use heartbeats.
- `TIMEOUTALL seconds` — same for all features.
- `LINGER featurename interval` — the daemon holds the licence for the interval **after** the application checks it in or exits. "This is only useful if the application uses duplicate grouping. Otherwise, LINGER will cause you to use extra licenses."

IBM's options-file page [read-fetch]: timeout "must be a minimum of 900 (15 minutes) and can be greater than the default value of 7200"; "will only work with … products that use manual heartbeats".

Implications for automation [inferred]:
- A seat is normally returned when the process exits and its connection to the vendor daemon closes; a **hung** process holds its seat indefinitely unless the vendor enabled timeouts, and then not sooner than 15 minutes. Killing the hung process is the only fast release.
- If the site uses `LINGER`, or the vendor has a built-in linger/minimum checkout time, back-to-back jobs can fail the second checkout even though our lock is free. So: after release, optionally wait until `lmstat` shows the seat free, with a registry-configured `post_release_wait_s` as fallback, and retry the first checkout failure once before declaring `LICENCE_UNAVAILABLE`.
- Product specifics found: COMSOL installation guide 6.4 <https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_installation.02.030.html> [read-fetch, summarised]: vendor daemon `LMCOMSOL`, default ports 1718 (lmgrd) and 1719 (vendor daemon); "Each COMSOL Desktop process checks out a COMSOL feature, a COMSOLUSER feature, and a COMSOLGUI feature"; floating network licences have separate batch features (`COMSOLBATCH`, e.g. `RFBATCH`). → for COMSOL the feature name to query differs between GUI and batch runs, and which features exist depends on licence type.
- PyMAPDL ships a licence checker (`ansys/mapdl/core/licensing.py` [read-raw outline]) that tails the licence debug log with a timeout and can run `ansysli_util -checkout <lic>`; its docs show the failure text `FlexNet Licensing error:-5,357` / "Maximum licensed number of demo users already reached." [read-raw `troubleshoot.rst`]. Lesson: **classify licence failure from the solver's own log into a typed error**; do not let it surface as a generic non-zero exit.

### 6.3 Lock design for one seat

- One lock directory per **licence pool**, not per program (two programs may draw on one licence; one program may have independent batch and GUI features). The registry maps `software → licence_pool → {kind: flexnet|nodelocked|dongle|none, server, features[], seats}`.
- `seats: 1` → the mkdir lock above. `seats: N` → N numbered slot directories; take the first free.
- A **human at the keyboard also uses the seat**. The lock cannot see that. With FlexNet, `lmstat` can; with a node-locked licence nothing can except looking for the application's process under any user (`tasklist /fi "IMAGENAME eq …"`). `acquire` should therefore check: lock free **and** no foreign instance of the listed image names **and** (if FlexNet) `in use < issued`. Otherwise return `SEAT_BUSY` with who holds it (job id or "interactive user"), and never kill a process the runner did not start.
- Acquire is done by the supervisor/worker on the Windows host immediately before launching the program and released in a `finally`; the client only observes. Queueing = jobs wait in `queue\` ; no client-side sleeping-with-lock.
- Record seat wait time and hold time per job; that is the number needed to decide whether a second seat is worth buying.

Not established: the licence technology of the specific SolidWorks and Zemax/OpticStudio installations in question (network vs. standalone vs. online), whether they are FlexNet-queryable, and their linger/timeout behaviour.

---

## 7. Prior art and what to take from it

### 7.1 svd-ai-lab/sim-cli (233 stars, last push 2026-09-08, commit b7318cc3ab; "alpha")

All [read-raw] from README and `docs/`.

- Verbs: `check <solver>` (detect installs/versions), `lint <script>`, `run script --solver` (one-shot), `logs last --field`, and for live sessions `connect` → `inspect session.versions` → `exec --file step.py --label <step>` → `inspect last.result` → `disconnect` → `stop`; plus `describe` (machine-readable manifest), `scan` (parse model files without the solver), `screenshot`.
- "A bounded step is one modeling, meshing, solving, or postprocessing action that can be inspected and verified before continuing"; "Prefer this loop over one large generated script"; re-inspect "after any human GUI edit, since an engineer can cut in through the solver GUI at any time".
- Agent contract (`docs/agent-readability.md`): one JSON object per command with `ok`; on failure `error_code` from a **closed enum**, `message` "≤280 chars", long output in `details`/`stdout`/`stderr`; exit codes 0 success / 1 run failure / 2 user error / 3 environment error / 4 plugin error; `--no-interactive` "Default ON when stdout is not a TTY"; "no command requires interactive input".
- Bounded output: lists come back as `{total, sample, truncated}` "so a large scan cannot blow up an agent's context"; absolute paths redacted unless asked.
- Driver rules: "`detect_installed` is idempotent, ≤500 ms, never imports the SDK"; "The driver writes nothing outside its workspace; rely on `RunResult.workspace_delta`" — files added/modified under cwd, "Captured by snapshotting cwd mtimes before and after the subprocess. Solver-neutral". `SolverInstall` records `name, version, path, source` ("env:AWP_ROOT252" / "registry" / "default-path").
- Config: project `sim.toml`; secrets never stored, referenced as `${env:NAME}` and redacted on display.
- Remote (`docs/remote-solvers.md`): an HTTP server on the solver host (`sim serve --host 0.0.0.0 --port 7600`). "The runtime has no authentication layer. `POST /connect` and `POST /exec` run code on the solver host, so anyone who can reach the port can execute arbitrary code"; "Treat network reachability itself as the security boundary." Only `/shutdown` is localhost-gated.
- Windows detail (`DEVELOPMENT.md`): a running `sim.exe` is locked, so reinstalling over it fails with "os error 32" — the general Windows rule that **a running executable or open file cannot be replaced**; applies to updating our own host script while a worker runs it.
- `SIM_DEV_MODE=1` gates raw-Python escape hatches.
- `docs/why-cli-first.md`: "a broad MCP surface adds context overhead and wrapper maintenance"; "every command it runs is a line a human can re-run, paste into a bug report".
- sim-plugin-comsol README: four COMSOL paths in order of preference — offline `.mph` inspection; direct `comsolbatch.exe -inputfile in.mph -outputfile out.mph -batchlog log.txt`; `comsolcompile` + `comsolbatch` for settled Java recipes; live `comsolmphserver` session (optionally "shared-desktop" with a visible client).

Take: the envelope, the closed error enum, bounded lists, `describe`, workspace-delta, "check before connect", typed "not installed". Do **not** take: an unauthenticated listening port — ssh already gives authentication and encryption.

### 7.2 wjc9011/COMSOL_Multiphysics_MCP (819 stars, last push 2026-09-17) [read-raw README]

- "Requirements: COMSOL Multiphysics (version 5.x or 6.x); Python 3.10+ (NOT Windows Store version); Java runtime (required by MPh/COMSOL)".
- "100+ total" MCP tools wrapping the `mph` library; async solve family: `study_solve_async`, `study_get_progress`, `study_cancel`, `study_wait`.
- "The mph library creates a singleton COMSOL client. Only one Client can exist per Python process" — they keep the client and `client.clear()` models.
- Versioned saves: `./comsol_models/{model_name}/{model_name}_{timestamp}.mph` plus `_latest.mph`.
- Tables of property names "verified against a live COMSOL 6.3 session".

Take: start/progress/cancel/wait as separate verbs; never overwrite a model, write timestamped + `latest`; one application client per host process. Not take: a 100-tool surface — the agent can write the script.

### 7.3 ahujasid/blender-mcp (repo now `ahujasid/mcp-for-blender`, ~30k stars) — architecture only [read-raw README]

Two parts: "Blender Addon (`addon.py`) — … creates a socket server within Blender to receive and execute commands" and an MCP server that connects to it; defaults `BLENDER_HOST=localhost`, `BLENDER_PORT=9876`. "the addon's socket server has no authentication or encryption, so anyone who can reach that port can run Python inside Blender. Keep it on `localhost` … prefer an SSH tunnel". `BLENDER_MCP_SAFE_MODE=1` blocks "reading or writing files directly, running other programs, accessing the network, or installing code that keeps running after the script ends". "ALWAYS save your work before using it."

Take: the in-application listener is exactly the Lane B shape (code runs inside the GUI process in the user's session); if we ever need a live channel, bind to localhost and reach it with `ssh -L`. Their safe-mode list is a ready-made deny list for job scripts.

### 7.4 microsoft/UFO — API vs GUI only [read-raw `ufo/README.md`]

"Hybrid GUI + API Actions … Chooses native APIs when available, falls back to clicks/keystrokes when not—fast *and* robust."; the AppAgent's "**Puppeteer** executor … chooses between GUI actions and native APIs"; "Combines Windows UIA, Win32 and WinCOM". The automator overview page returned 404. Take: API first, GUI only as fallback — consistent with the script-first decision.

### 7.5 PyMAPDL [read-raw `doc/source/getting_started/launcher.rst`]

- "PyMAPDL cannot launch remote instances." The remote side must already be running: Windows `C:/Program Files/ANSYS Inc/v241/ansys/bin/winx64/ANSYS241.exe -port 50005 -grpc`; client `Mapdl("192.168.0.1", port=50052)`.
- `launch_mapdl_process(nproc=4, port=50052)` returns `(ip, port, pid)` "without creating a client" — "allows you to manage the process independently from the client connection".
- Install discovery by environment variable `AWP_ROOTXXX` or explicit `PYMAPDL_MAPDL_EXEC`; licence server via `ANSYSLMD_LICENSE_FILE`.

Take: launching and connecting are separate steps with a pid handed back; discovery order = explicit path > vendor env var > default path, recorded with its source.

### 7.6 PyAEDT [read-raw `doc/source/Getting_started/ClientServer.rst`]

"If the `machine` argument is provided and the machine is a remote machine, AEDT must be up and running on the remote server listening on the specified port": `ansysedt.exe -grpcsrv portnumber`. Requires "The same Python version is used on the client and server machines." Transport modes WNUA / UDS / mTLS / insecure, with secure modes needing specific service packs; older releases "only support insecure mode". Take: vendor remote APIs exist but come with version coupling and often no authentication → tunnel them through ssh, and keep the client-side script running **on the Windows host** so there is no client/server version skew.

### 7.7 pypsexec (jborean93, 138 stars) [read-raw README]

Works over SMB/RPC: copies a PAExec binary to `ADMIN$`, creates and starts a Windows service as SYSTEM, talks over a named pipe, then removes both. Can "Run as an interactive process" and "Specify the session the interactive process should run on". Requires port 445, `ADMIN$` writable, an administrator with "a full logon token that is not filtered by UAC". "In the case of a failed process, the PAExec service and binary may not be removed from the host". Take: it is the only stdlib-external way from Linux straight into a chosen desktop session, but at the cost of SMB exposure and service installation; not for us. Its failure mode (leftovers after a crash) is the reason every runner resource needs an idempotent `cleanup`.

### 7.8 pywinrm (diyan, 1.1k stars) [read-raw README, partial]

`Session.run_cmd('ipconfig', ['/all'])`, `run_ps(script)`; transports basic/NTLM/Kerberos/CredSSP; "CredSSP … Allows double hop authentication. This only works over a HTTPS endpoint". From issue 1032 [read-raw]: WinRM's job has "Breakaway OK", which is how Ansible implements `async` on Windows. WinRM sessions are also non-interactive [recalled]. Take: no advantage over ssh for our case; same session-0 limits.

### 7.9 Fabric / Invoke against Windows

Not read on a primary page. [snippet, fab-user mailing list 2020]: what matters is "what shell the server is using"; "some minor features in Fabric … assume a Unix shell on the remote end". [recalled] Fabric is Paramiko underneath, so all of §1.3 and §2.2 applies unchanged; it is a pip dependency, and the brief is stdlib-only → call the system `ssh`/`sftp` binaries with `subprocess`.

### 7.10 Design lessons, consolidated

**Registry (hosts and software)** — one file, human-edited, read-only to the agent:

```
host:      id, ssh alias (from ~/.ssh/config), os, detected default shell, python exe (absolute),
           runner root (C:\lx), automation user, worker lane available (bool, from heartbeat)
software:  id, lane (headless | desktop), exe (absolute) + how found (explicit|env|registry|default),
           version, argv template, licence_pool, image names to sweep, typical/max runtime,
           result file patterns, log file to tail, licence-failure regexes, verified_on (date) or "unverified"
licence_pool: kind, server, features, seats, post_release_wait_s
```

**Verbs** (client CLI; each prints one JSON envelope, exit code by class):

| Verb | Does | Notes |
|---|---|---|
| `describe` | manifest of verbs, error codes, registry summary | read once per agent session |
| `check <host> [software]` | connectivity, shell, python, runner version, worker heartbeat, software detected, seat state | cheap, no licence checkout |
| `push <host> <job> <dir>` | upload inputs to `.partial`, rename | size/name/path-length validation client-side |
| `submit <host> <job>` | validate + enqueue or start; returns immediately | idempotent on job id |
| `status <host> <job>` | state machine value + seat wait + last heartbeat + tail(N) of log | bounded output |
| `wait <host> <job> --timeout S` | poll with backoff, **returns before S even if still running** | S kept under the caller's cache/timeout window |
| `logs <host> <job> --tail N / --since OFFSET` | bounded log read | byte offsets, not "all" |
| `fetch <host> <job> [patterns]` | download from the manifest only | checks sizes/hashes from manifest |
| `cancel <host> <job>` | cooperative flag, then tree kill of own pid record | never by image name alone |
| `cleanup <host> <job>` | remove job dir, tasks, stale partials | idempotent |
| `seat <host> <pool>` | who holds it, since when, lmstat view | read-only |

States: `queued → waiting_seat → running → {succeeded, failed, cancelled, timed_out, lost}` with `lost` = pid record gone/mismatched without `exit.json` (reboot, kill). Closed error enum, e.g. `HOST_UNREACHABLE, AUTH_FAILED, RUNNER_VERSION_MISMATCH, PYTHON_NOT_FOUND, SOFTWARE_NOT_INSTALLED, NO_WORKER, SEAT_BUSY, LICENCE_UNAVAILABLE, JOB_EXISTS, BAD_JOB_SPEC, TIMEOUT, RUN_FAILED, RESULT_MISSING, TRANSFER_FAILED`.

**How results and logs come back**: the host supervisor writes `exit.json` {exit_code, started, ended, seat_wait_s, runner_version} and `manifest.json` {relative path, size, sha256} for files changed under the job dir (workspace delta); `status` returns the tail of the log and the manifest summary as `{total, sample, truncated}`; `fetch` pulls files. The agent's own claims about what the job produced are never taken from the job script's stdout — the reviewer re-opens the fetched model (or runs an independent measuring job on the same host).

**What must be atomic**: job publication (rename of uploaded dir); queue claim (rename); seat acquire (mkdir) and stale-break (rename-then-remove); `exit.json`/`manifest.json`/`status.json` (temp + `os.replace` in same dir, with retry); pid record written before the supervisor detaches is acknowledged.

**What the agent must never be allowed to do** (enforced in the client and again in `host.py`, not only in the prompt):
- send an arbitrary remote command line; the client builds the only allowed ones;
- name an executable; it names a `software` id from the registry;
- write outside `C:\lx\j\<job>` (inputs) or read outside it (fetch); path traversal and absolute paths rejected on both ends;
- break a seat lock, kill a process it did not start, or kill by image name outside the registry's sweep list and the automation user;
- call `lmremove`, `lmdown`, edit the licence/options file, or change the system clock;
- create/modify scheduled tasks, services, firewall rules, registry (`DefaultShell`!), `sshd_config`, `authorized_keys`, user accounts, autologon;
- reboot/log off/lock the machine, or disconnect/redirect the interactive session;
- run with a pty, forward ports, or use agent forwarding (`ssh -T -o BatchMode=yes -o ClearAllForwardings=yes`);
- upload executables/installers or run package installs (`pip`, `winget`, MSI);
- see or log secrets (licence server credentials, autologon password).
Server-side hardening option: in `administrators_authorized_keys`/`authorized_keys`, prefix the runner's key with `command="C:\Path\python.exe -X utf8 C:\lx\bin\host.py --from-ssh",no-port-forwarding,no-agent-forwarding,no-pty` so the key can only ever run the host script, which reads the requested verb from `SSH_ORIGINAL_COMMAND` [recalled OpenSSH feature; whether the Windows port honours `command=` and sets `SSH_ORIGINAL_COMMAND` must be tested; sftp then needs a second key or a subsystem exception].

---

## 8. Runner shape that follows from the above

```
client (macOS/Linux, stdlib)                    Windows host
----------------------------                    ------------------------------------------
lxrun <verb> ...                                C:\lx\bin\host.py        (same file, both lanes)
  ├─ sftp -b  (push / fetch)        ───────►    C:\lx\in\<job>.partial → C:\lx\j\<job>\
  └─ ssh -T host "<py> -X utf8 -u               host.py <verb> <job>     (session 0, elevated?)
        C:\lx\bin\host.py <verb> <job>"           ├─ lane A: Popen(supervisor, DETACHED|NEW_GROUP|BREAKAWAY)
                                                  └─ lane B: write queue\<job>.json  ──► worker (user session)
                                                supervisor / worker:
                                                  mkdir seat lock → heartbeat thread → run program →
                                                  exit.json + manifest.json → release lock
```

- Host script deployed by the client with a version stamp; `check` compares versions and refuses to run on mismatch; updating it while a worker is running needs "write new file, worker notices and restarts itself" because an open script file can be replaced but the running interpreter keeps the old code [inferred].
- Use an ssh config `Host` alias with `ControlMaster auto`/`ControlPersist` on the client to make polling cheap [recalled client feature; verify it works against Windows sshd].
- Every ssh call gets `-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2` and a client-side subprocess timeout; a hung call is `HOST_UNREACHABLE`, not a hung agent turn.

---

## 9. Must be tested on the machine (not established from sources)

1. In-box OpenSSH version on that Windows 11 build (`sshd -V`), and that its job object has BREAKAWAY_OK (i.e. the detached supervisor survives `ssh` returning and survives the connection being killed).
2. Whether the admin ssh session is elevated; whether the automation account should be admin at all.
3. Session id of ssh-launched processes (`tasklist /fi "PID eq …" /fo csv` Session# column) and of the worker.
4. Per program: does it run from session 0 (headless lane) — Blender `-b`, `comsolbatch`, any ZOS-API standalone script, SolidWorks via COM — and what the failure looks like when it does not (hang vs. error code).
5. GPU availability from session 0 for each program that wants it.
6. Whether a locked (not logged-off) session is enough for the desktop lane.
7. `schtasks /create … /it` from a key-auth ssh session: password prompt or not; `/st` in the past.
8. Exit-code propagation `ssh host "<py> … "` → client `$?` under cmd and under PowerShell.
9. stdin pass-through as binary under cmd (`ssh host "<py> host.py submit -" < job.json`), and `tar` over ssh.
10. `os.replace` failure modes while a reader holds the file; Defender-induced transient failures in the job directory.
11. Exact text/exit code of the Store `python` stub on that machine; presence of `py.exe`.
12. Code page of the machine (`chcp`, `python -c "import locale;print(locale.getencoding())"`).
13. Licence kind for each product on that machine, feature names, whether `lmutil` is installed and where, linger/minimum-checkout behaviour, and how long a seat takes to return after a hard kill.
14. `command=` forced-command and `SSH_ORIGINAL_COMMAND` support in Windows sshd.
15. sftp `rename` onto an existing target; `ControlMaster` against Windows sshd.
16. Modal dialogs: which programs pop one on licence failure / crash / first run (EULA, "what's new"), since in session 0 that is an indefinite hang — needs a per-job wall-clock timeout in the supervisor regardless.

---

## 10. Source list

| # | URL | How read |
|---|---|---|
| 1 | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse | read-fetch |
| 2 | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration | read-fetch |
| 3 | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement | read-fetch |
| 4 | https://github.com/PowerShell/Win32-OpenSSH/wiki/DefaultShell (+ wiki pages: sftp.exe-examples, ssh.exe-examples, SSH-remote-sessions-on-Windows, Various-Considerations, About-Win32-OpenSSH-and-Design-Details) | read-raw |
| 5 | https://github.com/PowerShell/openssh-portable (branch `latestw_all`): `contrib/win32/win32compat/w32-doexec.c`, `misc.c`, `pwd.c`, `w32fd.c`, `contrib/win32/openssh/sshd_config` | read-raw |
| 6 | https://github.com/PowerShell/Win32-OpenSSH/issues/1032 , /1195 , /1266 | read-raw (gh api) |
| 7 | https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects | read-fetch |
| 8 | https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags | read-fetch |
| 9 | https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/create-method-in-class-win32-process | read-fetch |
| 10 | https://learn.microsoft.com/en-us/windows/win32/services/interactive-services | read-fetch |
| 11 | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create | read-fetch |
| 12 | https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_logon_type ; …/taskschd/security-contexts-for-running-tasks | read-fetch |
| 13 | https://learn.microsoft.com/en-us/sysinternals/downloads/psexec ; …/autologon | read-fetch |
| 14 | https://learn.microsoft.com/en-us/windows/win32/secauthn/protecting-the-automatic-logon-password | read-fetch |
| 15 | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/tscon ; …/taskkill | read-fetch |
| 16 | https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent ; …/processthreadsapi/nf-processthreadsapi-getexitcodeprocess | read-fetch |
| 17 | https://github.com/python/cpython (branch 3.13): `Doc/library/os.rst`, `msvcrt.rst`, `signal.rst`, `Doc/using/windows.rst`, `cmdline.rst`, `Modules/posixmodule.c`; `main` `Doc/using/windows.rst` | read-raw |
| 18 | https://docs.python.org/3/library/subprocess.html | read-fetch |
| 19 | https://www.openssh.org/txt/release-9.0 | read-fetch (summarised) |
| 20 | https://cua.ai/docs/how-to-guides/driver/windows-ssh | read-fetch (summarised) |
| 21 | FLEXlm End User Manual ch.5/ch.6 (public.dhe.ibm.com …/FLEXlm_End-User_Manual/chap5.htm, chap6.htm) | read-fetch (summarised, old version) |
| 22 | IBM options-file page (ibm.com/support/knowledgecenter/SSSTWP_8.1.6/…/r_options_file_cmd.html) | read-fetch (summarised) |
| 23 | https://docs.safe.com/fme/html/FME-Form-Documentation/FME-Form-Admin-Guide/FMEInstallation/Monitoring_Floating_License_Use.htm | read-fetch (summarised) |
| 24 | https://doc.comsol.com/6.4/doc/com.comsol.help.comsol/comsol_installation.02.030.html | read-fetch (summarised) |
| 25 | https://github.com/svd-ai-lab/sim-cli (README, docs/remote-solvers.md, agent-readability.md, why-cli-first.md, DEVELOPMENT.md, src/sim/driver.py, server.py routes) ; svd-ai-lab/sim-plugin-comsol README | read-raw |
| 26 | https://github.com/wjc9011/COMSOL_Multiphysics_MCP README | read-raw |
| 27 | https://github.com/ahujasid/blender-mcp (redirects to ahujasid/mcp-for-blender) README | read-raw (grep of relevant sections) |
| 28 | https://github.com/microsoft/UFO README and `ufo/README.md` | read-raw (grep) |
| 29 | https://github.com/ansys/pymapdl `doc/source/getting_started/launcher.rst`, `troubleshoot.rst`, `src/ansys/mapdl/core/licensing.py` | read-raw (partial) |
| 30 | https://github.com/ansys/pyaedt `doc/source/Getting_started/ClientServer.rst` | read-raw (first 140 lines) |
| 31 | https://github.com/jborean93/pypsexec README ; https://github.com/diyan/pywinrm README | read-raw (partial) |
| — | Revenera FlexNet docs (docs.revenera.com …/lmstat.htm, TIMEOUT.htm, LINGER.htm), Autodesk options-file page, microsoft.github.io/UFO/automator/overview, mapdl.docs.pyansys.com launcher page | **not read** (403/404); only search snippets |
| — | Power Automate unattended requirements, UiPath/EdgeVerve tscon articles, Fabric mailing list, SolidWorks forum on services | search snippets only |
