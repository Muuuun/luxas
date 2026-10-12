# simrun — specification v2 (after the three-reviewer attack, 2026-10-09)

Revised the same day after two reviews of the built runner (20 findings, then 14 more against the
fixed runner; the blocker and major ones each re-run by a second reviewer). Where a rule below exists
because of one of them, the rule says what went wrong without it.

One file: `skills/compute-methods/scripts/simrun` (extensionless, executable, `#!/usr/bin/env python3`).
Python >= 3.8, standard library only (this Mac's `python3` is 3.9.6; a host has its own).
The same file is the client on the caller's machine and the host-side part on the machine that has the software.

Callers: any agent seat with bash (`python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun ...`), the
operator's interactive session (the primary route today), `src/software.ts` never (TypeScript reads the
operator file itself), and the gates.

What it is for: run a prepared job directory with a named program on the machine that has it, hold the
program's licence seat while it runs, survive the caller going away (Luxas kills every bash command at
30 minutes; Windows sshd kills every child when the ssh command returns), and bring the results back
with a record of what produced them. It checks no result: the exit code of a simulator is not a success signal.

It is NOT a security boundary. The launcher list is a guard against mistakes and against shell quoting;
a launcher such as `python` runs whatever script the job holds, as the host's user. The boundary is the
account on the host, which the operator sets up.

## 1. Operator file

Path: `$LUXAS_SOFTWARE_FILE`, else `~/.sisyphus/software.json`. Hand-edited; simrun never writes it.

```json
{
  "hosts": {
    "<label>": {
      "transport": "local" | "ssh",
      "ssh": "<ssh config alias or user@host>",   // ssh: required
      "os": "posix" | "windows",                  // default posix
      "python": "python3",                        // how to start Python ON THAT HOST: space-separated tokens, default "python3" (posix) / "py -3" (windows)
      "workdir": "/abs/path",                     // ssh: required, forward slashes only ("C:/luxas"). local: default <state dir>/hosts/<label>
      "software": {
        "<id>": {
          "launchers": { "<name>": "<absolute path or bare command on that host>" },   // required, >= 1
          "check": ["<launcher name>", "arg", ...],   // optional: a command that proves the program starts AND works (takes a licence, prints a known value)
          "expect": "<substring the check output must contain>",   // required whenever check is present
          "check_timeout_s": 120,
          "seats": 1,               // optional. Present: at most this many jobs of this software at once on this host. Absent: no lock.
          "max_minutes": 30,        // wall-clock ceiling of one job (default 30); --max-minutes may only lower it
          "fail_patterns": ["License error", "Failed to find a solution"],   // optional literals; a log line containing one makes the job state=failed. Plain ASCII on a windows host.
          "desktop": false          // true = needs the logged-on desktop session. Accepted, and refused at start (no desktop worker in this build).
        }
      }
    }
  }
}
```

Strict validation, here and nowhere else:
- an unknown key is a problem that names the nearest legal key (difflib);
- labels and ids match `[a-z0-9][a-z0-9_-]{0,31}`; launcher names match `[A-Za-z0-9_.-]{1,48}`;
- every token of `python` matches `[A-Za-z0-9_.:/\\-]+` (no spaces, quotes, `;&|<>$` or backticks); `ssh` matches `[A-Za-z0-9_.@:-]+` and does not start with `-`;
- `workdir` matches `[A-Za-z0-9_.:/-]+` and starts with `/` or `<drive>:/`. A backslash in it is a problem that gives the
  reason: scp drops a backslash from a path it downloads, so uploads went to `C:\luxas` and every download asked for `C:luxas/...`;
- on a host with `os: windows` a `fail_patterns` entry outside plain ASCII is a problem: the log is in the machine's code
  page there and the pattern would never match (a job printing a licence error would end `exited 0`). On a posix host it is accepted;
- `check[0]` must be a declared launcher; `expect` is required with `check`; `check_timeout_s` and `seats` must be
  positive integers, `max_minutes` a positive number;
- the file holds no secret (no password, no key path: use `~/.ssh/config`).
Any problem makes every verb that starts a job or asks a host exit 4 printing the problems (`wait` and `status` on a
job that was already collected still print its record: they read no operator file). `hosts` still prints what it
could read plus the problems, also when a value has the wrong type (an object where a string belongs): it used to end
in a traceback there. A missing file is not a problem: there are no hosts.

State directory (written by simrun, never by hand): `$SIMRUN_STATE_DIR`, else `~/.sisyphus/simrun/`.
- `doctor.json`: `{ "<label>": {"ok": true|false, "at": "<utc>", "simrun": "<sha12>", "os": "...", "protocol": 1, "host": "<16 hex>", "checked": ["<software id>", ...]} }`, atomic write.
  - `ok` is written `false` before the first check and `true` only after the last one has passed. A doctor that is
    interrupted, killed or crashes therefore leaves `false` (it used to leave `true`: the verdict was "no problem was
    printed", written on every exit).
  - `protocol` is simrun's PROTOCOL number (1). It is bumped when the remote command line or the host layout changes
    in a way an earlier pass no longer covers.
  - `host` is the fingerprint of the operator entry the pass was made against: the first 16 hex digits of the sha256
    of five fields joined by `\n`: `transport`, `ssh` (empty when absent), `os`, the `python` tokens joined by one
    space (after the default is applied), `workdir` (empty when absent).
  - `checked` lists the software ids whose `check` passed in that run. Both readers take it as a list and as nothing
    else: a number, a string or an object proves no check. (simrun once read whatever was there: a number ended
    `hosts` and `run` in a traceback, and the string `"solver-old"` counted `solver` as checked.)
  - A host is **passed** when `ok` is true, `protocol` is the current number and `host` equals the fingerprint of the
    entry as it is now. A label re-pointed at another machine, os, Python or workdir is `never` again; a record with
    the current protocol and fingerprint whose `ok` is not true is `failed` (a doctor that is running, or one that
    did not pass). Software that declares a `check` is refused until its id is in `checked` (a check added after the
    pass has proven nothing). A `doctor.json` that is not an object is no record.
  - Readers: simrun (`doctor_state`, `require_doctor`), and `src/software.ts`, which applies the same rule term by
    term (`ok`, `protocol`, `host` against its own computation of the fingerprint, `checked` for software that
    declares a check). `simrun hosts --json` prints each host's fingerprint as `print` and, per software, `runs`:
    whether a job would be accepted now. `scripts/smoke_sim_wiring.mts` holds the line a seat is given to `runs`
    for every state of the two files (never run, passed, re-pointed, check not run, desktop, local). A file with a
    validation problem is the one case left where a prompt line can say RUNS ON while simrun refuses: simrun then
    refuses every job with the problem's text, and `runs` is false for every software.
- `hosts/<label>/`: default workdir of a local host.

## 2. Verbs

```
simrun hosts [--json]
simrun doctor <host>
simrun run    <dir> --software <id> [--host <label>] [--timeout 75] [--max-minutes N] [--seat-wait-minutes 10] [--pull-limit-mb 200] -- <launcher> [args...]
simrun start  <dir> --software <id> [--host <label>] [--max-minutes N] [--seat-wait-minutes 10] -- <launcher> [args...]
simrun wait   <dir> [--timeout 75] [--pull-limit-mb 200]
simrun status <dir>
simrun log    <dir> [--tail 100]
simrun fetch  <dir> <relative path> [...]
simrun cancel <dir>            |  simrun cancel --host <label> --job <id>
simrun ps     [<host>]
```

The default `--timeout` is 75 s, below the 90 s after which Luxas hands a foreground bash call back while it keeps
running: with 100 the caller never saw simrun's own exit 3 and `next=` line.

`hosts` prints an aligned table (label, transport, os, software ids with seats / desktop / doctor state) or, with
`--json`, `{file, exists, problems[], hosts:[{label, transport, os, doctor: "passed"|"failed"|"never"|"n/a", print: "<16 hex>", software:[{id, launchers:[names], seats|null, max_minutes, desktop, runs: true|false}]}]}`
(`print` and `runs` are described in section 1).
It never prints the ssh target, the workdir or a launcher path. No output line of any verb starts with `✗`, `FAIL` or `FAILED`.

Job rules:
- A job is the directory the caller prepared. One active job per directory (`<dir>/.simrun/job.json`); a second
  `start` while one is active is refused and names it. The whole of `start` runs under an exclusive claim file
  (`<dir>/.simrun/starting`, holding the caller's pid): two starts typed at once used to both pass the test and both
  run a program. A claim whose pid is gone, or that is older than an hour, is removed and does not block the directory.
- `<dir>` is refused when it is the home directory or an ancestor of it, when it directly contains `.agent`,
  `.git`, `.ssh` or `RESEARCH.md` (that is a project root, not a job directory), or when it is one of `.ssh`, `.agent`,
  `.git`, `.sisyphus` or lies inside one (a job directory is sent whole to the host). One exception: a directory
  inside a bench run's project, `…/.sisyphus/bench-runs/<run>/<anything below it>`, is accepted (a bench run is a
  project like any other; without the exception no bench run could use the runner). The names are compared without
  letter case: the path keeps the case that was typed, and on a disk that folds case `~/.SSH` is the keys directory
  (it was accepted, and the job ran in it). Symlinks inside it are refused, not followed.
- For a host with `os: windows`, a file or directory name with a component that contains one of `<>:"|?*` or a control
  character, ends in a dot or a space, or is a device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`9`, `LPT1`-`9`, with or
  without an extension) is refused before any connection, naming up to five: Windows would change or lose it without an error.
  So are two names that differ only by letter case (both named): the host holds one file for both.
- Host choice: `--host`, else the only host that has the software, else exit 4 listing the candidates.
  Software on no host: exit 4 and exactly `simrun: software "<id>" is not available: no host in <file> provides it` on stdout.
- `desktop: true` is answered first, whatever the doctor record says: exit 4 with exactly
  `simrun: software "<id>" on host "<label>" needs the logged-on desktop session; this build has no desktop worker, so it cannot be started`.
  (It used to come after the doctor rules. Doctor never runs a desktop entry's check, so such an entry with a `check`
  was refused with "its check was not run; run doctor again", which no doctor run could clear.)
- To start a job, an ssh host must be passed (section 1: `ok`, the protocol number, the fingerprint of the entry);
  otherwise exit 4:
  `simrun: host "<label>" has not passed 'simrun doctor <label>' yet; jobs are refused until it has`.
  Software that declares a `check` which that doctor run did not pass: exit 4 and
  `simrun: software "<id>" on host "<label>" declares a check that the last 'simrun doctor <label>' did not run; run doctor again before using it`.
  A local host needs none, and none is read for a job there.
- `wait`, `status`, `log`, `fetch`, `cancel` (both forms) and `ps` reach jobs that were accepted earlier. The first
  five are refused, with the same first sentence, only when the host is `never` (no record, another protocol,
  another fingerprint); on a `failed` host they answer. `ps` is not refused: it does not ask a `never` host, prints
  `simrun: host "<label>" is not asked: it has not passed 'simrun doctor <label>'`, lists the other hosts and exits 0.
  Doctor writes `ok: false` before its first check, so with the start rule applied to them a doctor run made every
  wait and cancel of a running job exit 4, and a doctor that failed because that job held the seat its check needed
  could not pass until the job had ended on its own.
- A job record that simrun did not write (`job` is not a job id, `host` or `software` is not a string) is refused by
  every verb that reads it, exit 4, before anything is sent: the id is typed on the remote command line and inside
  scp's remote path.
- The command after `--` is an argv list. Its first token must be a launcher name declared for that software
  on that host; it is replaced by the declared path. The command runs on the host without a shell (no globbing,
  `&&` or redirection). Anything else is refused before any connection, listing the legal launcher names.
- The client makes the job id: `<utc yyyymmddThhmmssZ>-<8 hex>`.

Transports:
- local: the job runs in place, cwd = `<dir>`; the supervisor is still a detached process (it must outlive the
  caller's process group: Luxas kills that at 30 minutes). The directory is the caller's, so the supervisor records
  what is in it at the moment the program ends (`jobs/<id>.after.json`); outputs are the files that differ from the
  start manifest in that record and still have the same (size, mtime) when `wait` runs. A file the job wrote that was
  changed or removed afterwards is not an output and is named in a note. What the caller writes while the program is
  still running cannot be told from the job's own files. For software with `seats` the start manifest is taken again
  when the program starts: a job may wait minutes for its seat, and what the caller wrote during the wait was
  recorded as the job's output.
- ssh: `<dir>` is zipped (excluding `.simrun/`, `__pycache__/`, `.pytest_cache/`; more than 200 MB is refused with
  the five largest files listed) to `<dir>/.simrun/in.zip`; `scp` copies it and a request file
  (`<id>.req.json`: argv, limits, software entry, sha256 of the zip) to `<workdir>/jobs/`; the host side verifies
  the sha256 and unpacks into `<workdir>/jobs/<id>/`. After the job ends the host side zips every file that is
  new or whose (size, mtime) changed since unpacking, up to `--pull-limit-mb` in total and half of it per file;
  the client downloads it to `<dir>/.simrun/out.zip.part`, renames, unpacks into `<dir>`, then marks the job pulled;
  a repeated `wait` on an unpulled job pulls again. Collecting runs under an exclusive claim (`<dir>/.simrun/collecting`):
  a second `wait` typed while the first is collecting lets it finish and reports what it recorded. A `fetch` runs
  under the same claim (two fetches typed at once shared one request file and one archive name on both sides: one
  failed, the other reported the first one's file while its own never arrived).
  A `run` or `wait` waits for the claim no longer than what is left of its `--timeout` (a `cancel`: the default 75 s).
  When another call still holds it then, this call collects nothing and writes nothing. It reads the two records
  first (both are written by rename): a job that `job.json` shows as finished is reported from it, and a job the
  directory has moved on from is reported from its history record, as in the next paragraph. Otherwise the call
  prints the host's state line with `next=` under `simrun: job <id> has ended on the host and is not collected into
  <dir> yet (no simrun.json for it): another simrun call (pid <n>) is collecting or fetching in this directory`;
  `run` and `wait` exit 3, `cancel` exits 0. In place of "has ended" the note says `is no longer watched on the
  host (the program it started may still be running there)` for a job whose supervisor is gone or did not answer a
  cancel, and `is lost on the host` for any other lost job. `status` of a job that is not live and not collected
  starts with the same clause: `simrun: job <id> has ended on the host and is not collected into <dir> yet: simrun
  wait <dir>`. (A fetch holds the claim for its whole transfer; a wait
  behind one printed nothing until the transfer was done, past its own timeout. The note was one sentence for every
  job: it said "has ended" of a program that still ran and held its seat, and "not in <dir> yet" of a job collected
  long before, with `next=` pointing at the wait of the directory's next job.)
  A `wait` or `cancel` that takes the claim and finds that `job.json` names another job, or holds no job record
  while its own job is already in the history, pulls nothing and writes nothing (either transport): it reports its
  job from `<dir>/.simrun/history/<id>.json`, with a note that names that record and the job the directory holds
  now. (A `job.json` that still names its job without `final` is an interrupted collection, and is collected
  again.) A wait holds no claim while it is inside its host wait; one that came back after `cancel` and `start` had
  been typed wrote the first job's record over the second's, and the directory then accepted a third start beside
  a running job.
  A `fetch` reads `job.json` again once it has the claim. When it no longer names the fetch's job, the fetch is
  refused, exit 4, and nothing is sent or pulled: `simrun: job <id> is no longer the job of <dir> (it holds job <id>
  now); nothing was fetched: fetch reaches the files of a directory's current job only`. (A fetch that had waited
  behind another fetch while the next job was started and collected wrote the earlier job's file over the next
  job's result, under the next job's record, and exited 0.)
  Files over the limit stay on the host, are listed with sizes, and `simrun fetch <dir> <path>` brings one back.
  A job that did not end `exited 0` is packed with limit 0, which means nothing at all (an empty file used to fit).
- Unpacking, on either side: every member is inspected before the first byte is written. Refused with nothing
  written: an absolute path, `..`, a symlink member, a path through a symlink already in the destination, `.simrun/`
  or a top-level `simrun.json` in any letter case (compared with casefold: this Mac's disk and NTFS fold case, and
  this Mac's also folds the long s, which `lower()` does not), a member under a path the archive also holds as a
  file, a member that is a file where the destination has a directory (or needs a directory where it has a file),
  and, when the destination's disk holds one name for both (asked with a probe file), two members whose paths differ
  only by letter case, both named. Each file is written to a short temporary name beside its target and renamed onto
  it, so a target that is read-only in the caller's directory is replaced and a name of up to 255 bytes can be
  written. A member whose name differs only by letter case from an entry the destination already holds (the
  caller's input `Mesh.dat`, the job's own `mesh.dat` from a host that tells them apart) is written onto that entry
  when the disk holds one name for both, and that is said: `simrun: 'mesh.dat' from the archive was written onto
  'Mesh.dat', which <dir> already held: the two names differ only by letter case, and the disk of <dir> holds one
  name for both`. It is not refused, because the job's other results would stay uncollected with it.
  The two names are compared without letter case and in one composition of accents (this Mac's disk holds one
  file for `É` and for `e` followed by the accent); the same visible name in two compositions is not reported. The
  pairing uses Python's Unicode tables: a pair of letters newer than them, which the disk may fold, is not noticed.
  A member that then cannot be written (full disk, read-only directory) is a refusal that names it and says
  the members before it were unpacked; it carries the note of each earlier member that was written onto an entry
  of another spelling. A results archive that is refused leaves the job uncollected: its files stay
  on the host for 7 days, and the job has to be run again from a new directory with the names changed.
- Every remote invocation is exactly
  `ssh -T -o BatchMode=yes -o ForwardAgent=no -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -- <target> <python tokens> [-X utf8 -u] <workdir>/.simrun/<sha12>/simrun _host <verb> <job id or -> [<small args matching [A-Za-z0-9_.:/-]+>]`
  run with a client-side subprocess timeout. `-X utf8 -u` is added when `os` is `windows`. `ForwardAgent=no` is on the
  command line, where no config file can override it: the machine that drives this may hold keys to other
  servers, and agent-written scripts run on the host. The host copy lives at
  `<workdir>/.simrun/<sha12>/simrun` and is never replaced (a new version gets a new directory). It is installed by
  whichever call finds it missing, not only by `start` and `doctor`: when a remote call fails with a code other than
  255 (ssh's own), the client copies its host part and asks once more, so a client edited while a job runs can still
  wait for it, ask its status and cancel it. Host-side output is
  one JSON document with `ensure_ascii`. `SIMRUN_SSH` / `SIMRUN_SCP` replace the two programs (space-separated argv
  prefix) for the gates.

Results and state:
- `run` = `start`, then one remote `_host wait <id> <secs>`, then pull. Exit codes of `run` and `wait`: 0 the job
  exited with code 0 and no fail pattern matched; 1 the job ended otherwise (non-zero exit, fail pattern, time limit,
  cancelled, lost); 3 not finished here when `--timeout` elapsed: still queued for a seat or running, or ended on
  the host while another simrun call held the directory (see the claim above). `status`, `log` and `cancel` exit
  0 when the call itself worked, whatever state the job is in (the state line says it); `fetch` exits 1 when a path
  is not on the host. Of every verb: 4 refused before starting; 5 transport failure
  (the message says ssh or scp, and that the job may still be running on the host) or a file operation that failed
  on the caller's machine (one line, never a traceback: Python's own exit code for that is 1, which means "the job
  ended otherwise"). A file of the job directory that cannot be read when it is packed is exit 4: nothing was started.
- The last stdout line of `run`, `wait` and `status` is always
  `SIMRUN state=<waiting_seat|running|exited|failed|timeout|cancelled|lost> exit=<n|-> host=<label> software=<id> job=<id> elapsed=<s>s[ reason=<...>][ next="simrun wait <dir>"]`
  (`next=` with exit code 3, and from a `cancel` that could not collect). Before it, when the job has ended, the last 80 lines of its log, so values the
  job printed are in the caller's transcript. The usage text says: print the numbers you will report from the
  fetched files in the same bash call.
- `<dir>/simrun.json` is written when a job ends (and kept per job in `<dir>/.simrun/history/<id>.json`):
  `{job, host, software, command (launcher names, not paths), started, ended, state, exit, reason, outputs: [{path, bytes, sha256}], left_on_host: [{path, bytes}]}`.
  `outputs` lists files that are new or changed by this job (local transport too); a job that did not end in
  `state=exited exit=0` writes `outputs: []`. Reader: the reviewer's artifact block (src/review-images.ts).
- Notes printed as `simrun: ...` lines above the state line when the job has ended: files the job wrote that were
  changed after it ended (local); symlinks the job created; a launcher that exited while processes it started were
  still running (they may still write files and hold the licence; posix hosts only); a job whose supervisor is gone
  or did not answer a cancel, with the program's last known pid; a job that another call collected before this one
  came back, with the history record and the job the directory holds now; a job that has ended while another call
  holds the directory; a pulled file that was written onto an entry spelled in another letter case. `cancel` of a job that is `lost` says that
  it stopped nothing (it used to say the job had ended on its own and its results were collected). `cancel` of a
  job that had ended on its own says `its results are collected instead` only when the job exited 0 and this call
  collected it; for any other end it says `it is recorded instead, and nothing is collected from a job that did not
  end well`; behind a held claim it says neither.

## 3. Host side

Layout under `<workdir>`: `.simrun/<sha12>/simrun`, `jobs/<id>/` (cwd), `jobs/<id>.req.json`, `jobs/<id>.status.json`,
`jobs/<id>.log`, `jobs/<id>.manifest.json` (the directory before the job), `jobs/<id>.after.json` (the directory when
the program ended; local hosts only), `locks/<software>/seat-<k>/owner.json`, and for the moment a seat is being
broken or released `locks/<software>/seat-<k>.breaking/`.

- `_host start`: verify the zip, unpack (a refused or half-written unpack is removed whole), snapshot the manifest,
  prune ended jobs older than 7 days and, after one day, whatever a start that failed after its upload left without
  a status (an archive of up to 200 MB, a request, a half-made directory), spawn the
  detached supervisor, return. Detached means: POSIX `start_new_session=True`; Windows
  `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB`, stdio to files. A refused spawn is a typed error naming the flag.
- The supervisor: take a seat if the software has `seats`; run the command (stdout+stderr to `jobs/<id>.log`,
  `PYTHONUNBUFFERED=1`) and write the program's pid into its seat; every 15 s re-read its seat's `owner.json`, kill
  the job and stop if it no longer owns the seat (`state=lost reason=seat_taken`), else write `beat`; kill the process
  tree at `max_minutes`; when the launcher ends, note whether its process group still has members (`left_running`;
  posix only) and, on a local host, record the directory (`.after.json`); scan the log for `fail_patterns`; write the
  final status (tmp + `os.replace` in a short bounded retry); release the seat.
  The supervisor watches the launcher only. A launcher that exits while what it started still runs ends the job
  (`exited`, seat released) and the caller is told so in a note; the job is not held until the group is empty, because
  a licence helper or solver server that stays by design would turn every job into a timeout.
- Seats: taking one is `os.mkdir(seat-<k>)` then `owner.json` `{job, pid, prog, started, beat, deadline, boot}`:
  `pid` is the supervisor, `prog` the program it started (null until then). `beat` is a field (not an mtime).
  A seat is stale when `boot` differs from the host's current boot time by more than 120 s, or when `beat` is older
  than 90 s and (neither `pid` nor `prog` is alive, or now > `deadline` + 90 s). The program counts because it is the
  one that holds the real licence: with the supervisor killed, the next job used to start beside it.
  Breaking a stale seat and releasing one's own are the same operation, done under a guard directory
  (`seat-<k>.breaking`, `mkdir`, at most 3 s of retries, a guard older than 30 s is abandoned): re-read `owner.json`,
  go on only if the condition still holds for what is there now (still stale; still mine), rename the seat to a
  unique name (bounded retry on `PermissionError`, as for every replace), remove that, drop the guard, then compete
  with `mkdir` again. Without the re-read under the guard two waiters both judged the same dead owner and the second
  removed the seat the first had just taken. A release that fails is printed (it lands in `jobs/<id>.sup.log`); the
  seat then ends by the stale rule.
  While waiting the status is `waiting_seat` with the holder's job id and since when; the wait ends after
  `--seat-wait-minutes` in `state=timeout reason=no_seat`. A waiter makes `locks/<software>/` again on every round:
  `_host start` removes an empty `locks/doctor-*` directory (doctor's one-seat test leaves one per run), and when
  that fell between doctor's two test jobs the one still waiting died and doctor reported the seat lock as unproven.
- Process liveness: POSIX `os.kill(pid, 0)`. Windows: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE)`
  + `WaitForSingleObject(h, 0) == WAIT_TIMEOUT` through ctypes; never `os.kill(pid, 0)` there (signal 0 is
  CTRL_C_EVENT on Windows and any other value terminates the process) and never `GetExitCodeProcess == 259` alone.
  Kill tree: POSIX `killpg`; Windows `taskkill /PID <pid> /T /F`. Boot time: Linux `/proc/stat` btime, macOS
  `sysctl -n kern.boottime`, Windows `GetTickCount64`.
  The Windows functions sit in one marked block. They have never run on Windows; no job is started on an ssh host
  until `doctor` has passed on it, so doctor's own jobs are the first to use them. Deletion rule: if no Windows host has
  passed `doctor` by 2027-01-31 the block is removed.
- `_host wait <id> <secs>`: block up to `<secs>` for the job to end, return the status. `_host status`: the status
  file carries `boot` (the host's boot time when the job was accepted). A `running`/`waiting_seat` status is reported
  as `lost reason=supervisor_gone` when its `boot` differs from the current one by more than 120 s, or when its beat
  is older than 90 s and (the supervisor's pid is not alive, or now > `created` + seat wait (software with `seats`
  only) + time limit + 90 s). A pid on record is a number, not a process: after a reboot or a reuse it names
  somebody else, and without the two bounds such a job read `running` for ever. Inside those bounds a silent job
  whose pid number is in use still reads `running`; a number cannot say more.
- `_host cancel`: set the cancel flag and give the supervisor 5 s to kill the job's process tree and write
  `cancelled`. If none answers, kill the pids on record (supervisor first) only when the beat is at most 90 s old;
  with an older beat kill nothing, write `cancelled reason=no_supervisor_answered_and_no_pid_was_killed`, and leave
  the seat to the stale rule (the program may still run). Otherwise release the seat.
- `_host ps`: every job under `jobs/` not yet pruned: id, software, state, age, seat holder and since when, beat age.

## 4. doctor

`simrun doctor <host>` prints one line per check, each `ok ...` or `problem: ...`, writes `doctor.json` (`ok: false`
before the first check, the verdict after the last; section 1), and exits 1 on any problem. On every exit, an
interrupt included, it cancels and forgets the jobs it started, found through the job records in its own scratch
directory; an upload it was cut off in has no status and is pruned by the one-day rule. Checks: transport reachable; Python on the host and its version (>= 3.8); workdir writable;
a 1 MB file round-trips with the same sha256; a no-op job (the host's own Python printing a token) runs and the
token comes back in the log tail and the state line; a job that sleeps 20 s is still running after the command
that started it has returned and then ends on its own (detachment); two jobs on a one-seat test software do
not overlap; `cancel` ends a sleeping job and frees its seat; for each registered software with a `check`:
it exits 0 within `check_timeout_s` and its output contains `expect` (a `desktop: true` entry's check is not run;
a check that could not get a seat within the 60 s doctor waits is a problem that says so and points at `simrun ps`:
a job started through the runner holds it). For `os: windows` it first prints that
the Windows branches have never run before this host. A person using a program at the desktop holds the same
licence seat and is invisible to the seat lock: doctor says so once.

## 5. Verified here / not verifiable yet

Verified by the gates on this Mac: every verb over the local transport, and over real `ssh` and `scp` against a
throwaway user-mode `sshd` on 127.0.0.1 with temporary keys (start returns and the job survives; wait; pull and
its limits; seats, stale seats, seat wait; cancel by directory and by id; ps; fail patterns; refusals; doctor).
Since the review also: a doctor interrupted mid-run; a pass under another protocol, without a fingerprint, or for a
re-pointed label; six waiters on one stale seat, three rounds; a seat whose owner was replaced under a running job;
a killed supervisor whose program lives; a supervisor pid that belongs to a bystander; two starts and two waits
typed at once; a client edited while its job runs; a job record with an unsafe id (against stand-ins that connect
to nothing); the host-side and client-side charset checks called directly; hostile archives in both letter cases
and into a destination that is not empty.
Since the second review also: a wait that comes back after the directory has moved on to the next job (both
transports, the waiting call stopped inside its host wait); status, wait, log, fetch, cancel and ps of jobs that
were accepted before a doctor record said `ok: false`; two fetches typed at once; a desktop entry that declares a
check; the private directories typed in other letter cases; a lock directory removed under a waiting supervisor;
the default wait time read from the remote command line; archives with a long-s spelling of the records, with
names that differ only by case, with a 250-byte name, and with a file where the destination has a directory.
Since the third review also: a fetch that waited for the claim while the directory moved on to the next job (the
fetch stopped where it found the claim held); a wait and a cancel whose job has ended while another call holds the
claim (both transports for the wait); a job found in the history with no job record in the directory; a doctor
record whose `checked` is a number, a boolean, a string or an object; doctor writing over a `doctor.json` that is
a list; the refusal of two names that differ only by letter case for a Windows host, with the directory listing
replaced (this Mac's disk cannot hold the pair); the long-s spelling of the records in the list of a job's files;
an archive member written onto an entry spelled in another letter case.
Since the fourth review also: what a call that gives up on the claim says, by the host's view and by the
directory's records (eight states, asked of finalize()); the time handed to the claim once the host wait is over;
cancel's sentence for a job that had ended on its own (behind a held claim, collected, exited 3); a local job with
a `doctor.json` that cannot be opened; a queued fetch that finds no job record; the letter-case note through `run`,
a later `wait` and `fetch`; that note inside the refusal for a later member that cannot be written; a name that
differs by letter case and by the composition of an accent.
One check is not in a gate because it needs a seat held for 70 s: doctor's line for a check that found no seat.
Not verifiable until a Windows host exists: the marked Windows block, OpenSSH-on-Windows behaviour for the one
remote command line, and anything about a desktop session.

Known limits on a Windows host, each left out because doctor could not exercise the code that would close it:
- A pid is stored without the process's creation time, and Windows reuses pids quickly. The bounds are the ones
  above: a pid on record is killed only while the beat is fresh, a silent job is lost once it is past its limits,
  and a seat whose owner pids are numbers in use is freed at `deadline` + 90 s.
- There is no process group to ask whether a launcher left processes behind, so `left_running` is never set there.
  A launcher on a Windows host must block until the solver has ended; the software's `check` is the place to see it.
- The retry around the seat rename on `PermissionError` is in place but has never fired; the first doctor run on
  Windows measures whether a waiter that has `owner.json` open blocks a release.
- File names are checked on the caller's side from the rules above, not against a real NTFS volume, and
  `fail_patterns` are restricted to ASCII there instead of being matched in the machine's code page.
