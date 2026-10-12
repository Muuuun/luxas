---
name: compute-methods
description: Friction sheets for field-standard computational tools and simulators (frictions, smoke tests, how to measure a saved model). Injected at spawn time.
compatibility: Pure prompt skill. Sheets are data; the injection lives in the harness.
---

# Compute-methods registry

**Why this exists** (2026-07-13, debate-adjudicated): experiment agents abandon
the field-standard tool over first-use friction and fall back to
approximations that change the science. Canonical: pairinteraction rejected as
"requires manual database download" when the real fix was the species string
`'Yb174_mqdt'` — the ν¹¹-scaling fallback missed series splitting and a pair
resonance that refuted a headline claim. A sheet row is cheaper than a
debugging spiral: **a friction listed here is a usage bug, not a tool failure.**

**Who reads the sheets**: nobody by hand. `buildMethodsRegistry`
(src/agents/context-builders.ts) injects the matching ones into experiment,
tool_impl and tool_review contexts at spawn time. A sheet without `match:`
keywords is never injected. Sheets cover Rydberg pair interactions, QEC
circuits, qLDPC decoding, code distance, atom dynamics, optics, quantum
chemistry, and the simulators Blender, COMSOL, Zemax OpticStudio and SOLIDWORKS.

Sheet contract:
- frontmatter `match:` comma-separated keywords (substring, case-insensitive)
  — ranked by hit count against RESEARCH.md + literature head + task text.
  A software sheet is matched against RESEARCH.md and the task text only: a
  paper in the literature notes that used a program does not select its
  sheet. Its keywords are matched as whole words, not as substrings
  (src/software.ts `namesKeyword`): an ASCII letter or digit at either end of
  the keyword must not touch another one, so `blender` does not hit in
  "deblender" or "BlenderBot" and does hit in 用Blender建模. One exception:
  digits may follow a keyword that ends in a letter, because a version is
  often written straight after the name (Blender4.2, COMSOL6.2,
  SolidWorks2022). A keyword that starts with a dot is a file extension and
  must not be followed by a letter, a digit, `_` or `(`. The same keywords, matched against RESEARCH.md, also
  decide the reviewer's "no saved model" notice (src/review-images.ts) and
  whether a model file far below `run_N/` counts, and one hit is enough for
  each. So a software sheet's keywords name the program, its API or its file
  format, and nothing more general: 三维建模, `rigidbody` and `geometry nodes`
  said what a task is about and put the Blender sheet in front of a COMSOL
  brief's own. A whole word can still be another field's word: `bpy` is the
  ligand in `[Ru(bpy)3]2+`, so the sheet says `import bpy`.
- frontmatter `verified:` YYYY-MM-DD. Sheets without `verified:` are injected
  with an UNVERIFIED banner; older than 90 days get a STALE banner (frictions
  demote to hints). `verified-on:` vm|mac is a note for people; no code reads it.
- Three optional keys for a sheet about one program (read by src/software.ts).
  A line that breaks its rule is dropped silently at run time. For a sheet in
  this directory smoke_sim_wiring (section 5) fails on a `software:` line or an
  `artifacts:` entry that did not parse; a dropped `bin:` name is reported by nothing.
  - `software: <id>`: lowercase letters, digits, `-` and `_`, alone on its line
    (no comment after it; the same id as in software.json). With any other
    spelling the sheet is treated as a plain method sheet: no line, no
    ride-along, no reviewer block. It ties the sheet to the operator's
    `~/.sisyphus/software.json` and selects the line printed above the sheet:
    RUNS ON a host that passed `simrun doctor`, DECLARED on a host that has not
    (or whose entry says `"desktop": true`, which this build of the runner
    cannot start), FOUND on PATH, or NOT AVAILABLE. "Passed" is the runner's
    rule: a pass made against the host entry as it is now and, for software
    that declares a `check`, one that ran it. Method sheets take the N slots
    among themselves; a program's sheet that ranks in the top N is added after
    them, and of the program sheets left the best one is appended. So a domain
    sheet cannot crowd the program's sheet out, and a program that is only
    mentioned cannot crowd a domain sheet out.
  - `bin: <name>[, <name>]` executable names looked up on PATH of the machine
    Luxas runs on, when no registered host can run the software now.
  - `artifacts: .ext[, .ext]` native model formats only. Each entry is a dot
    followed by letters or digits, matched against a file's last extension
    (`x_t`, `.x_t` and `.tar.gz` are ignored). The experiment reviewer is handed
    files with these extensions from the newest run that holds one, for
    re-opening (src/review-images.ts): any such file within three directories
    of `run_N/`; a deeper one when the brief names the program or results.json
    names the file; one below a hidden or installed-package directory only
    when results.json names it. A directory that is a symbolic link is not
    looked into (the reviewer is told how many were not). The sheet's Verification section is the only
    how-to: list a format only if a
    row there opens it, and write that section so that it stands alone (the
    reviewer is not given the smoke test or any other part of the sheet). An
    extension belongs to one sheet.
- A sheet with no `verified:` date whose software is not reachable contributes
  only its header (file name and UNVERIFIED banner) and that line; its rows are
  withheld. Reachable, it is given whole, under a sentence that no row has been
  run against the program.
- Body: per-tool table (frictions, smoke test), then `## Known false
  rejections` — verbatim wrong claims from past ledgers, so a reviewer can
  recognize a recurrence. In a software sheet the section headed
  `## Verification…` is what the reviewer receives with the model file once the
  sheet is verified and the program reachable, without the rest of the sheet:
  it must stand alone (units and sign conventions inside).
- After you fix a new friction in anger, add the row in the same session —
  the next agent inherits it.
- A software sheet earns its `verified:` date from a simbench task with planted
  faults for that program, not from a smoke test: notes/sim-host-day-one.md.
