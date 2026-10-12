# External simulation software in Luxas — design as built (2026-10-09)

Three reviewers (maintainer, verification, operator) attacked the draft; this is what survived.
Runner specification: `spec-simrun.md` (v2) beside this file.

## Principle

The capability sits below the executor, so the operator's hand route, the 3-agent pipeline and the solo
executor all reach it from bash. The harness only adds text it can compute from files on disk. With no
operator file and a project that names no simulation software, every prompt is byte-identical to before.

## Built

1. **simrun** (`skills/compute-methods/scripts/simrun`): local and ssh transports; verbs hosts, doctor, run,
   start, wait, status, log, fetch, cancel, ps. No desktop worker (`desktop: true` is refused, before any
   other rule). No job is started on an ssh host until `simrun doctor <host>` has passed on it, so doctor's
   own jobs are the first to use the Windows-only block; it is deleted if no Windows host has passed doctor
   by 2027-01-31. A job that was accepted earlier can still be waited for, listed and cancelled while a
   doctor run is in progress or after one that failed. One directory holds one job at a time, under two
   claim files; a `wait` that finds the claim held by another call comes back at its `--timeout` with exit 3
   and says who holds it and how the job stands on the host (unless the directory's own records already settle
   the job: then it is reported from them), and a `fetch` that had to wait for the claim is refused when the
   directory has moved on to the next job meanwhile.
2. **Operator file** `~/.sisyphus/software.json` (hand-edited; strict validation in simrun only). TypeScript
   reads it tolerantly for: the host label, the five fields of the fingerprint (transport, ssh, os, python,
   workdir), software ids, launcher names, and of a software entry whether it declares a `check` and whether
   it says `"desktop": true`. simrun's state (`~/.sisyphus/simrun/doctor.json`) tells TypeScript whether a host
   has passed doctor, by simrun's own rule: `ok` is true, `protocol` is simrun's PROTOCOL number
   (`SIMRUN_PROTOCOL` in `src/software.ts`), `host` is the fingerprint of the entry as it is now, and software
   that declares a `check` is in `checked`. The wiring gate holds the two readers together through
   `simrun hosts --json` (`runs` per software), case by case. No probe dates in prompts.
3. **Sheet keys** read by code: `software: <id>`, `bin: <name>[, ...]`, `artifacts: .ext[, ...]` (native model
   formats only; an extension belongs to one sheet).
4. **The line under a software sheet** (`buildMethodsRegistry`), one of five:
   - `[RUNS ON host "<label>" (passed simrun doctor): python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun run <job dir> --software <id> --host <label> -- <launcher> ...]`
     (for a local host the parenthesis reads `this machine, through the runner`). The host is always in the call:
     with the software on two hosts simrun refuses a call that does not choose.
   - `[DECLARED on host "<label>": it needs the logged-on desktop session, which this build of the runner cannot start; do not call it; say so in your return]`
     (the software entry says `"desktop": true`, whether or not the host has passed doctor)
   - `[DECLARED on host "<label>", not yet proven by simrun doctor: do not call it; say so in your return]`
   - `[FOUND on this machine: "<bin>" is on PATH. Luxas has not started it: run the sheet's smoke test first]`
   - `[NOT AVAILABLE here: no registered host provides it and "<bin>" is not on PATH. If this task needs it, say so in your return; do not substitute another tool silently]`
   Order: a host that can run a job (passed doctor, or local; not desktop-only) first; else the binary on PATH
   (an absolute PATH entry holding an executable file); else a host that cannot run one, as DECLARED; else NOT
   AVAILABLE. Registering a host therefore never takes away a program that starts on this machine. Reachable
   means the first or the fourth line.
   Plus, when reachable and in the experiment seat's context only (the tool seats cannot write `runs/run_N/`),
   `Save the model file the result rests on under data/experiments/<EID>/runs/run_N/; the reviewer re-opens it there.`
   For a sheet with no `verified:` date the sentence ends `the reviewer looks for it there`: the same reviewer is
   told nobody can re-open the file. And, for a sheet with no `verified:` date that is reachable, `No row of this sheet has been run against the program. Where a row and the program's own message disagree, the message is right; quote it.`
   A sheet with no `verified:` date whose software is not reachable contributes its header and the line, not its body.
5. **Which sheets a seat gets.** A program's sheet is chosen by what the brief (RESEARCH.md) or the task names;
   the head of the literature notes chooses method sheets only (a paper that used COMSOL is not this project using
   it). Its keywords are matched as whole words (`software.ts namesKeyword`): an ASCII letter or digit at an end
   of a keyword must not touch another one, so `blender` does not hit in "deblender" or "BlenderBot" and does in
   用Blender建模; digits may follow a keyword that ends in a letter, because a version is often written straight
   after the name (Blender4.2, COMSOL6.2, 用SolidWorks2022建模); a keyword that starts with a dot is a file extension. They name the program, its API or its file
   format and nothing more general (`三维建模`, `rigidbody` and `geometry nodes` were taken out of blender.md):
   one hit puts the sheet into three seats and "The brief names <program>" into the reviewer's notice. Method
   sheets keep the substring rule they have always had. Method sheets rank among themselves for the N slots, as before a sheet could name a program. A program's
   sheet that ranks in the top N of all matched sheets is added after them, never swapped in for one. **One
   software sheet rides along**: among the program sheets not shown, the best one (task hits first, then all hits,
   then file name) is appended. A tool seat can therefore get up to three sheets and the experiment seat up to five.
   (As first built, both kinds ranked in one list and the notes counted for both: a note citing COMSOL replaced the
   method sheet of a project that uses no simulator with a two-line stub.)
6. **Reviewer artifact block** (`src/review-images.ts`, appended after the image block): native model files of the
   newest run that holds one (never through a symlink; the image list keeps its three levels). Which files with a
   model's extension count:
   - within three directories of `run_N/`: every one, whatever the brief says;
   - deeper: when the brief names the program or `results.json` names the file (a data set's own `lego.blend`, or
     the `hash.mph` of an index, five directories down is not this experiment's model);
   - below a dot-directory, `site-packages`, `node_modules` or `__pycache__`: only when `results.json` names the file;
   - never under a path that cannot be printed (a line break of any kind, or a tag).
   A directory that is a symbolic link is not entered (a link to itself never ends).
   What is there and not taken, or was not looked into, is never called absent: the texts that say "no model file"
   count such files, and such directories outside hidden ones, in every run newer than the one handed over, and
   say where they are.
   At most 2 are shown: those the newest `results.json` names by their whole file name first (where several files
   share that name, the one whose path below the run directory it holds: a sweep leaves the same name once per
   point), then those somebody can open (verified sheet, reachable program, inside the project, within the copy
   limit), then the most recently written; when they are not from the newest run the block says which run they
   are from. They are copied to a temp
   directory by the harness and removed when the review loop ends, also when the process is ended from inside a
   model call (the cost cap). How-to and a re-measurement request only for a sheet that is verified and reachable,
   with a where-line written for the reviewer (`"<bin>" is on PATH; call it directly`, or the runner call plus the
   copy's directory as the job directory); otherwise the file is listed as not re-measured with the reason (also:
   over 100 MB, or a real path outside the project, which is what a symlink out of it or a `data/` that is itself
   a symlink gives).
   The reviewer answers with one line before its VERDICT line, `artifact <path>: …`; the loop takes it in the
   shapes a model writes it (list item, list number, heading, quote, table row, bold, backticks; the word must
   start the line and be followed by a space or the colon), writes those lines into
   `reviews/experiment_review_<EID>_r<N>.md` (section `Saved-model read-back:`) and appends them to the result the
   brain reads. When a model was listed and no such line is found it says exactly that, not that the model was not
   re-opened. The block states what each
   outcome does to the vote: a file that cannot be opened or measured from here is not by itself a REVISE; a
   measured value that contradicts the reported one is.
   When the brief names a registered kind of software and no run of the experiment holds such a file, one sentence
   says so and that a result obtained with that software is then a REVISE (Issue: save the model). When files of
   that kind are there and not taken (above), the sentence counts them and the Issue asks for a plain place.
   `LUXAS_REVIEW_ARTIFACTS=0` switches it off. Deletion rule: the planted-fault trial below.
7. **Draft sheets** comsol.md, zemax.md, solidworks.md (no `verified:` date); blender.md gains the keys and loses
   its frozen "not installed on the VM" sentence; SKILL.md documents the keys and gets a one-line description.
8. **Pins and repairs**: a gate that pi-ai tells a text-only model a tool image was omitted (the behaviour Luxas
   relies on); the wiring gate no longer goes red when blender.md turns 90 days old; bench ledger rows of the
   luxas arm record the routing env (a row written with `--record` states it: `--routing KEY=VALUE`); C46, C47,
   the effort pin and transcript, the blender-03 control, the dead CORROBORATED clause (handed over by the
   hardening session's review).
9. **Persisted knowledge**: the four research files, this design and the runner spec under `notes/sim-2026-10-09/`,
   and `notes/sim-host-day-one.md` (what the operator does when the Windows machine arrives).

## Not built, with the evidence that would change it

- Brain `<available_software>` block: no reader until a host is registered; all three reviewers. Reopen on a trace
  where the brain plans a hand-rolled substitute for registered software.
- `luxas software` subcommand: `simrun hosts / ps / doctor` serve the hand route with no Luxas process.
- Desktop worker (SolidWorks): cannot be tested without a logged-on Windows session. Build it with the machine.
- Per-spawn vision routing: the profile's seeing model misread numbers on 2 of 6 pages and tool seats cannot read
  outside their experiment directory. Image-input experiments use the solo executor or the hand route.
- Passing the model into the read tool: pi-ai already replaces a tool image with "(tool image omitted: model does
  not support images)" for a text-only model (transform-messages.js); pinned by a gate instead.
- A replicator "re-measure" mode; any claim-table change; any text in brain.md or experiment.md.

## Measurements declared now (run after the top-up; none decided by this change alone)

- **M0 planted faults** (Anthropic, about $5-8): scratch projects from simbench `reference.py` (2 references, 6
  faults), model under `runs/run_1/`, results.json and L2 claiming the reference values; `review_experiment.mts
  --no-blind` with the block on and with `LUXAS_REVIEW_ARTIFACTS=0`. Keep the block only if block-on gives REVISE
  with a measured-vs-reported line on at least 5 of 6 faults, SATISFIED on 2 of 2 references, catches at least two
  more faults than block-off, and adds at most $0.50 per round. Otherwise delete it. Two more cases, block on only,
  for the notice that no model was saved: an L2 section that reports a Blender result with no model under any run
  (expected: REVISE with the Issue "save the model"), and one that reports no such result (expected: SATISFIED).
  If the first is SATISFIED or the second is REVISE, delete the notice.
- **M1 Luxas-arm baseline**: blender-02 first, one scratch instance, cap $25; a cap hit or provider abort is no
  measurement. Record routing env, where the model file was saved, whether the reviewer got the blocks.
- **M2 image input**: blender-06 on the solo executor, n=1, cap $5; three outcomes written down beforehand
  (correct; blocked and said so; wrong and finished green).
- **M3 first contact**: `simrun doctor <host>` green; then each draft sheet's smoke test through simrun. A sheet
  gets `verified:` only with a simbench task and planted faults for that software.

## Checked by hand on 2026-10-09, with the real program and no model call

Blender 5.2.2 on this Mac, a scratch operator file with one local host, everything in a scratch directory:
`simrun run <job> --software blender --host mac -- blender -b --python make.py --python-exit-code 1` ended
`SIMRUN state=exited exit=0`, and `simrun.json` listed `part.blend` and `results.json`; the experiment context
showed the RUNS ON line and the save line; the reviewer block listed `part.blend` with the simrun record, a copy
path and the sheet's Verification section; re-opening the copy through simrun measured 23999.998 mm³ (reported
23999.998), a 20 x 30 x 40 mm bounding box and no open edge; the original file's hash was unchanged and the copy
was gone afterwards. This shows the pieces fit. It does not show what a model does with the texts: that is M0 and M1.

Again after the third and after the fourth review round, on the tree as it then was, with the layout the third
round was about: three jobs through simrun (one local host, one seat), each saving
`run_1/jobs/sweep_0N/out/final/part.blend`, and a `results.json` that names the second by its path. The last time
the brief was in Chinese with the version written straight after the name (用Blender5.2建…). The experiment
context showed the RUNS ON line and the save line; the reviewer block listed the named file first, as copy 1, with
its simrun record, the third as copy 2, and "1 more model file"; re-opening copy 1 through simrun, with the copy's
directory as the job directory, measured 35999.998 mm³ (reported 35999.99758601194), a 20 x 30 x 60 mm bounding
box and no open edge; the three originals kept their hashes. With a `run_2` that held `results.json` and
`out -> ../store`, the block said "No run of this experiment after …/run_1 holds a model file this block can hand
you (newest: …/run_2; 1 directory there is a symbolic link and was not looked into)" and handed over run_1's
files as an earlier run's. `status` of a job that had ended and was not collected, and `cancel` of it, printed
the sentences of spec section 2.

## Reviews

Four adversarial passes on 2026-10-09, each finding re-run by a second agent when blocker or major. First pass:
57 findings (one blocker: an interrupted doctor left a pass on record). Second pass, against the fixed tree: 38
findings, no blocker, five major: a wait that came back late wrote its job's record over the next job's; a doctor
run cut off wait, status and cancel of jobs already on the host; a program that a literature note cites took a
method sheet's place; a model more than three directories below `run_N/` was reported as not saved, with a REVISE;
and the checklist's `"desktop": true` step for Zemax ended in a refusal no doctor run could clear. All five and the
minor ones that change behaviour are fixed, each with a gate case that is red on the tree before the fix.
Third pass, on the second round's changes only: 15 findings, no blocker, two major. A fetch that had waited for the
directory's claim fetched the job it had read before the wait, over the result of the job collected meanwhile
(the claim was new in round two; the read under it was missing). And the deep walk of round two reached the
layout it was written for, a sweep with one file name per point, where "named in results.json" by file name alone
handed the reviewer the two newest files, not the one named. Both are fixed, with the minor ones: a wait behind
a held claim now returns at its timeout; a model below a hidden directory is taken when results.json names it and
is never called absent; a file five directories down in a project that names no simulator no longer starts the
block; a program's keywords are whole words.
Two fixes are not the ones proposed. For the sweep, the reviewer's fix ranked every file by how much of its path
results.json holds, which put two stage files in front of a final model beside results.json; the path now only
decides among files that share a name. For a model replaced by one that differs in letter case, a refusal was
proposed; it is a printed note, because a refused archive leaves the whole job uncollected.
Fourth pass, on the third round's changes only: 10 findings, none of them blocker or major, so none went to a
second agent; each came with a scratch run that shows it, and each is fixed with a gate case that is red on the
tree before the fix or under a mutation of the line it guards.
- The note of a call that gives up on the claim was one sentence for every job. It said "has ended" of a job whose
  supervisor is gone while its program still ran and held the seat, and "not in <dir> yet" of a job collected long
  before, with `next=` pointing at the wait of the directory's next job. The call now reads the records first, and
  the sentence says how the job stands; `status` uses the same clause.
- A program named with its version glued on (Blender4.2, 使用COMSOL6.2) had stopped selecting its sheet: the
  whole-word rule of round three refused a digit after the name.
- With a run between the newest and the one handed over, the block still called the older run "the latest run that
  did" save a model; and a model below a directory that is a symbolic link was called absent, the hole of round
  three one step further on in both cases.
- `cancel` said "its results are collected instead" of a job that had exited 3; a job on a local host read
  `doctor.json`, which it does not need, and ended in exit 5 when that file could not be opened; the letter-case
  note went unsaid when a later member could not be written, and for a pair that also differs in how an accent is
  composed.
- Eighteen changes of round three could be undone with all three gates green (five in the runner, thirteen in the
  harness); each now turns a check red.
Deviations from the fixes proposed in that pass. For the claim note, "lost" was to carry "the program may still be
running"; it is said only for the two reasons under which nothing watches the program, because a job whose
program was never started is lost as well. For the letter-case note, two guards that ask the disk were written
and taken out again: on this Mac's disk nothing can make them matter (26 pairs of names tried: the disk and
Python's tables disagree only for two pairs of letters newer than the tables), so no gate could hold them. For
the linked directory, links inside hidden directories are not counted: every virtual environment on Linux has one.
There is no fifth pass: the rule set before the fourth was to stop unless it found a blocker. The fixes of this
round are held by the gates, by 44 mutations (18 of the runner, 26 of the harness), every one of which turns the
check meant for it red, and by the comparison against HEAD below; no second agent has read them.
Registry against HEAD after this round: 1824 cells that name no simulator in brief or task are byte-identical
(two more near-miss briefs: BlenderBot3, deblender2); in 456 cells that name one, no method-sheet block HEAD
showed is lost or reordered. HEAD was 592d927 in all three comparisons. On 2026-10-10 another session's batch
was committed as 3ecd09c while this layer was still uncommitted; the same grid against that commit's tree gives
the same two results.
One second-round finding lay outside this layer. It was reported to the session that owns the spawn marker, which
fixed it the same day: a continued agent's context was rebuilt from the first 2000 characters of its task, so a
program named only after that point lost its sheet on continue (the marker now carries the whole task as
`contextTask`; gate `smoke_brain_request`, section C2).
Left as it is, on purpose:
- a results archive that is refused leaves its job uncollected (run it again from a new directory);
- a project whose `data/` is a symlink to another disk gets its models listed and not re-opened;
- a doctor run that finds a checked seat busy fails the host for new jobs until it is run again with the seat free;
- a method sheet with one incidental keyword hit precedes the program's sheet in the tool seats, where before
  round two those seats got the program's sheet alone: blender-05 carries rydberg.md ("arc" in its brief) and
  blender-07 code-distance.md ("distance"). This is the rule "what a project got before a sheet could name a
  program, to the byte, with the program's sheet added after"; the incidental hits come from the method sheets'
  rule that one keyword hit anywhere in the brief selects a sheet (matched by substring, though both of these
  hits are whole words), which is older than this layer and is the user's decision to change;
- where several files share a name and results.json gives only the bare name or a path below a directory inside
  `run_N/`, nothing separates them and the two newest are handed over;
- a file of the same name beside results.json counts as named by a path that ends in its name;
- a read-back line inside brackets or quotes, or after a label ("Read-back: artifact …"), is not taken; the note
  then says no line was found, which is true;
- `speed.mph` as a column name and `x.blend,` from an imaging library still count as naming a file format;
- a program's name glued to a word (BlenderProc, COMSOLMultiphysics, ZemaxOpticStudio) does not select its sheet:
  no boundary tells these from BlenderBot, and a compound that is wanted gets a keyword of its own;
- `results.json` is read as text: a name written with `\u` escapes (Python's default for a name that is not
  ASCII), with backslashes, or in another letter case counts as not named. A file within three directories of
  `run_N/` is taken all the same, ranked as not named; a hidden or deeper one is counted as not taken;
- the letter-case note pairs names by Python's Unicode tables: a pair of letters newer than them that the disk
  folds is written onto the caller's file without it;
- the walk for models has no limit on the number of files (78,000 files in three runs cost about 0.3 s a round).
