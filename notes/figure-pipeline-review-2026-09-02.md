# Figure pipeline review — Ba run (2026-08-29 → 08-31)

Trace: `sisyphus-projects/ba-neutral-atom-qc-20260829/project` on the droplet. Three canonical figures
(`ba_level_diagram`, `ba_lifetime_vs_n`, `gate_infidelity_frontier`), all shipped with defects a human sees in
two seconds. This note records what the trace shows, why the figures are bad, and what would change the outcome
by a large factor rather than another patch.

## 1. Numbers

| | |
|---|---|
| Run total | $160.28 |
| Spent after figure work began (08-30 04:45 UTC) | $92.94 |
| …of which kimi-k2.5 (the agent that actually draws) | $3.03 |
| …of which sonnet (figure_auditor) | $6.04 |
| …of which deepseek-v4-pro (brain / reviewer) + opus (PI) | $83.86 |
| illustrator_write spawns | 14 (8 died on turn 1) |
| figure_auditor spawns | 8, every verdict `fix`, 3 new fixes per figure each time |
| illustrator (audit) spawns | 5 (4 died on turn 1) |
| Pipeline deploys during the run | 5 (08-30 10:10 → 12:42 UTC) |
| figlint-pdf verdict on all three shipped figures | `clean` |

Drawing cost 3 % of the figure phase. Deciding, relaying and auditing cost 97 %.

## 2. What the shipped figures look like (independent look, 2026-09-02)

**gate_infidelity_frontier** (report p. 6): legend row *and* direct end-labels for the same series; a 1.2 in
dead zone between the axes and the legend (legend anchored at `bbox_to_anchor=(0.5,-0.06)` then
`bbox_inches="tight"`); panel titles right-aligned floating above the frame; seven series per axes with the
top of five of them clipped at 1e-2; left half of panel (b) empty except one dashed line; "Ba dec." and "Rb"
labels collide; Cs never labelled. The figure was produced by `report/figures/plot_frontier.py`, not by the
figspec.

**ba_lifetime_vs_n** (p. 4): the same dead zone; two legend entries with the identical text "Ba ¹G₄ radiative";
log x-axis with a single tick label (10²); panel (a) is one line plus a band; Cs and Sr markers stacked at the
same point; the Shi2025 label sits on its own line; the x-label appears only under (b). Also matplotlib
(`plot_lifetime.py`).

**ba_level_diagram** (p. 3, fills the page): energy-true vertical scale makes the figure 1:1.46 portrait so the
float takes a whole page; every laser transition is a *wavy* arrow (convention: wavy = spontaneous emission;
the vendored `energy_levels.tex` template teaches the same mistake); level labels sit on top of arrows
(¹D₂ on the pink arrow, ³D₃ on the blue one, ¹S₀ under two); a floating "Key:" box; wavelength labels far from
the arrows they name; two different label styles for the shelving manifold.

None of this is a collision the lint measures. All of it is composition: whitespace, redundancy, aspect,
convention, semantics.

## 3. What the trace shows

### 3.1 The spec was bypassed because it could not say what the author needed
The first hero-figure spec (`gate_infidelity_frontier.figspec.json`) is written in matplotlib vocabulary:
`"style": {"color": …, "linestyle": "--"}`, `"title"`, `"legend"`, `"annotations"`. None of these keys exist
in the figspec grammar (`linestyle` wants `"dashed"`, there is no per-series colour, no title, no annotation,
no legend). The renderer ignores unknown keys silently. Result: no dashed line, "Ba total" drawn red and
"Ba decay" blue (palette by index, so the Ba family loses its colour), no panel titles. The auditor reported
"every curve is solid", the PI wrote "set `linestyle='--'`" and "save plot scripts on disk", and brain spawned
`illustrator_write-fd3b5y` with "use DIRECT matplotlib — NOT the figspec renderer, which is failing to apply
dashed linestyles". That spawn wrote `report/figures/plot_frontier.py` at 12:21–12:37 UTC; the wrapper that
refuses plotting scripts by content landed at 12:41. Every later fix agent was refused 6–8 times per spawn
trying to edit that file.

Every bypass in this run traces to a missing spec feature: dashed style, colour grouping, in-panel condition
text ("T = 4 K"), panel titles, and a row filter (`reference_lifetimes.csv` has mixed `atom`/`l` rows; the spec
referenced the whole column, so the renderer's own "Rb nS" line zig-zags through Rb l=0 and l=1 rows — a
data-correctness bug the grammar cannot express).

### 3.2 The renderer prototype makes composition decisions badly
Re-rendering the two shipped specs locally with the current `figspec`:
- `"width": "double", "layout": "column"` → 7.0 × 9.3 in figure (height formula `0.78·w·n·0.85`).
- Markers on every point whenever a series has ≤ 16 points → 7 marker-laden curves.
- Log-axis "plain ticks" rule prints 50 60 80 100 200 300 … 3000 down one axis.
- Reference-line labels are placed at `x = 1.01` in axes coordinates and run off the canvas.
- Palette by series index, not by physical group.

The author cannot fix any of this (the install is read-only since 3afabc7 — `illustrator_write-5r0vkf`
patched the renderer mid-run: 121 turns, 63 renders, 46 tracebacks, 17 PNG views for one figure).

### 3.3 The eye and the hand are three lossy text hops apart
- `reviewer.md`: "DO NOT view figures or PDF pages yourself."
- `pi-agent.ts`: visual review delegated.
- `figure_auditor` sees the PNG and writes ≤ 3 fixes per figure as coordinates ("shift the qubit arrow from
  x = 1.5 to x = 0.2", "change the multiplier from 1.35 to 0.55").
- brain / reviewer rewrites that into a task; `illustrator_write` (kimi, no context of the audit image) executes.

The model that draws is the cheapest and sees the least. The models that never see the figure decide what
to nudge, and the nudges are numeric guesses relayed twice.

### 3.4 The audit loop has no convergence criterion
Eight audits. Each returns `fix` with three fresh mechanical items per figure; none repeats the previous
list. Round k (PI): "add in-panel `P = 2 W` / `P = 20 mW`". Round k+2 (auditor): "remove both in-panel
power annotations, they duplicate the titles". Round j: "move the legend outside the axes" (to clear 3
figlint collisions). Round j+1: "move the legend inside panel (a); the 1.2 in dead zone is the defect".
The procedure says *write ≤ 3 FIXES* and *any FIX ⇒ fix* in practice, so the loop can only terminate by
running out of money.

### 3.5 The gate is the lint, and the lint was gamed into the worst defect
`figlint-pdf` measures text collisions, clipping and font size. Pushing the legend below the canvas satisfied
it and produced the dead zone. All three shipped figures are lint-`clean`.

### 3.6 Dead provider, blind loop
From 08-31 08:07 UTC every kimi spawn returned
`404: Not found the model kimi-k2.5 or Permission denied` (stopReason=error, 0 turns). The reviewer's tool
result contained that line verbatim; the PI wrote "illustrator model unavailable" in `pi_feedback.md` and
kept asking for the same fixes. Five more audits and three PI reviews ran with nobody able to act on them —
the "$35 on an unsatisfiable gate" of commit 845d431 is this. The soft cost cap treats the symptom.

### 3.7 The brief asked for spaghetti
Brain's hero brief: three CSVs, eight curves (Ba decay 2 W, Ba decay 20 mW, Ba total, Rb/Cs/Sr/Yb decay *and*
total), σ bands on all headline curves, "draw the crossover threshold", two panels. `illustrator_write` is told
"≤ 4 series". A brief that names eight series per panel has already decided the figure will be unreadable;
the agent that receives it cannot push back.

### 3.8 Prompt palimpsest
`illustrator_write.md` (305 lines) opens with "data figures are specs, not scripts" and then spends
~200 lines on `ax.annotate`, `figplace.annotate_free`, `plt.savefig`, matplotlib `fontweight`, and
"every matplotlib script you write runs through figlint". `illustrator.md` (341 lines) still resolves figures
via `grep -l NAME data/experiments/*/scripts/plot_*.py`. An agent reading either is told both rules.

## 4. What would change the outcome by a large factor

Ordered by leverage. The first three are the ones that matter.

### 4.1 One agent that sees, draws and looks again — on the strongest vision model
Collapse `illustrator_write` → `figure_auditor` → reviewer → brain → `illustrator_write` into a single
`figure` agent that (a) reads the brief and the data, (b) renders, (c) reads its own PNG at print width,
(d) fixes, (e) repeats ≤ 3 times, (f) returns the PNG plus a one-line self-critique. Put it on the best
vision model available (Sonnet/Opus class, not the cheapest). Drawing cost $3 in this run; at 20× it is still
less than what the relay burned. The auditor becomes a ship/no-ship gate at the very end, never a fix-generator,
and never runs when no fixer can run.

### 4.2 Let the author express the figure, then validate hard
Whether the source is a spec or a short script matters less than: *the author must be able to say what
the figure needs, and the tool must refuse what it does not understand.* Concretely for figspec:
- Strict schema validation: unknown key → error naming the nearest valid key. Silence is what created 3.1.
- Semantic colour groups: `"group": "Ba"` → one hue family, variants by linestyle; references grey by default.
- Row filters: `{"csv": …, "col": …, "where": {"atom": "Rb", "l": 0}}`.
- In-panel condition tags (`"tag": "T = 4 K"`) and panel titles as condition labels.
- Per-series `linestyle`/`marker` accepted in both spellings.
- Size model per panel (≈ 3.4 × 2.4 in), never a 7 × 9 in column; markers only for genuinely sparse
  measured data, never for a computed sweep; direct labels with leader lines, no legend, ever.
- Envelope-by-default when a brief lists > 4 references: draw the best reference solid and the rest as a band.
If the grammar keeps refusing legitimate needs, the alternative is a small vetted plotting library
(`luxasfig`) with the same primitives, called from ≤ 40-line scripts; the "never matplotlib" rule would then
be "never raw matplotlib".

### 4.3 Composition metrics in the gate, not only collisions
Things a human sees in two seconds, computable from the rendered figure:
- ink bounding box vs canvas (dead-zone fraction > 15 % → error);
- duplicate legend labels; legend + direct labels for the same series → error;
- data-fill fraction of each axes < 40 % → warn, series clipped at a limit → warn;
- log axis with < 3 or > 8 tick labels → error / warn;
- figure aspect outside [0.35, 0.8] for `figure*`, outside [0.6, 1.2] for a column figure → error;
- > 5 series per axes → error.
Pass/fail here is what the gate should read, with the PNG read as the judgement call on top.

### 4.4 Convergence discipline for whatever audit remains
- Auditor output is a ranked list with two classes: **blocking** (claim not visible, illegible, occlusion,
  wrong data) and **cosmetic**. Verdict is `ship` unless a blocking item exists.
- Cosmetic items are batched into one fix round, then shipped regardless.
- Hard cap: two audit rounds per figure per run.
- The auditor receives the previous audit and the diff of what changed; it may not reopen an item the
  previous round closed, and may not request the reverse of a previous fix.
- Requests are design-level ("legend duplicates the end labels — drop it"), never coordinates.

### 4.5 Generated level diagrams, not hand-placed TikZ
An energy-level diagram is data: `levels: [{label, energy_cm, column, group}]`,
`transitions: [{from, to, wavelength, kind: laser|decay|qubit|e2}]`. A generator applies a compressed
energy axis (piecewise or log so the Rydberg gap does not produce a page-tall figure), straight arrows for
drives and wavy for decays, label slots resolved automatically, colour by group. The five audit rounds on
`ba_level_diagram` were all absolute-coordinate nudges; none would exist. Fix `templates/energy_levels.tex`
(wavy laser arrow) regardless.

### 4.6 The brief is a design, not a data dump
Brain's brief must name ≤ 2 panels and ≤ 4 series per panel, and the one comparison each panel makes.
Cheaper still: the figure agent proposes a three-line design first (panels, series, the sentence the reader
should say), brain approves or edits, then rendering starts. The 08-30 hero brief would have been cut to
"panel (a) 2 W: Ba decay, Ba total, envelope of the four references; panel (b) 20 mW: same".

### 4.7 Operational
- **Done 2026-09-02**: `--profile dual` now routes the vision agents to DeepSeek's own multimodal model
  (`deepseek-v4-flash-vision-exp`, announced 2026-08-21) instead of Kimi K2.5. Both halves of a dual run are
  now one provider and one key, so the 3.6 failure mode — a second provider dropping the model mid-run —
  cannot recur. Live-probed before wiring: the model is listed on the account, reads the actual Ba figures,
  and emits tool calls with an image in context. Two API constraints are now gated in
  `smoke_dual_profile.mts`: the entry must accept image input, and it must declare `reasoning: true`, because
  thinking mode plus `tool_choice: "required"` is a hard 400 and the silent-exit guard sends "required" for
  any model that is not marked as reasoning. Kimi stays selectable via `LUXAS_VISION_MODEL_PROFILE=k2p5`
  with its 404 recorded in the entry comment.

### 4.7a Measured: what the vision switch actually buys (2026-09-03)
The 09-02 entry above shipped on n=1 per figure, which was not enough to claim anything about quality. A
controlled benchmark since then: the three real Ba figures, one fixed auditor prompt, three repeats per
model, scored against the defect list in §2 that was established by independent reading.

| | DeepSeek-V4-Flash-Vision | Sonnet-4-6 | Kimi K2.5 |
|---|---|---|---|
| Runs completed | 9/9 | 9/9 | **0/9 — 404 on every call** |
| Real defects found per audit | 5.4 | 5.6 | n/a |
| False or garbled claims (total) | 3 in 9 | 8 in 9 | n/a |
| Latency, mean / worst | 67 s / 138 s | 12 s / 13 s | n/a |
| Cost per audit, mean | $0.0104 | $0.0113 | n/a |
| Output tokens per audit | 7 700 | 420 | n/a |

Conclusions that change how this should be read:

- **Kimi's 404 is not a droplet-credential problem.** It fails identically with the local key, 9/9. The
  switch was necessary, not merely tidy.
- **Quality is a tie, not an upgrade.** Both models find five to six real defects per audit. DeepSeek was
  the only one to catch the log x-axis carrying a single tick label (2/3 runs) and the energy axis with no
  ticks or scale (3/3); Sonnet was the only one to catch the stacked Cs/Sr markers, and was steadier on the
  frontier figure. Sonnet also produced more false claims, including a state (`³D₀`) that does not exist in
  the diagram.
- **Cost is parity, not a saving.** The sticker price is 7× cheaper on input and 11× on output, but reasoning
  tokens eat all of it: 7 700 output tokens per audit against Sonnet's 420. Any claim that this switch makes
  figures cheaper is wrong.
- **Latency is 5× worse** and that compounds over a multi-turn agent.
- **The earlier "invents detail on tall schematics" claim does not replicate.** It came from a single sample
  where the model called the wavy arrows solid. Across 3 fresh runs on the same figure that error did not
  recur, and DeepSeek scored *higher* than Sonnet on the level diagram (6.0 vs 5.7 real defects). The
  honest reason to keep `figure_auditor` on Claude is latency and consistency, not accuracy.
- **An apparent 1-in-9 empty-output failure was my benchmark's fault**, not the model's: a 16 000-token cap
  truncated it mid-reasoning. Re-probed at the production cap (393 216) the same prompt terminated cleanly
  4/4 at 5–8 k tokens and ~$0.01. The large `maxTokens` in the model entry is load-bearing; do not lower it.
- **Multi-turn figure creation, same brief, one run each (2026-09-03).** The audit task above is not what
  these agents mostly do; `illustrator_write` gets 70 turns to *create* a figure. Identical brief and data
  (the real E6 frontier CSVs), one run per model:

  | | DeepSeek vision | Sonnet-4-6 |
  |---|---|---|
  | Turns | 36 | 48 |
  | Wall clock | 11.9 min | 23.0 min |
  | Cost | $0.21 | $2.18 |
  | Self-reported | visual check passed | visual check passed (2 fix rounds) |

  DeepSeek is **10× cheaper and 2× faster in wall clock** here, despite being 5× slower per call, because it
  used fewer turns. Both produced a figure with far better mechanics than anything the Ba run shipped: no
  legend, direct end labels, no dead zone, nothing clipped. Both also failed, differently, and **both passed
  their own visual check**:
  - DeepSeek noticed that the `*_eps_total` reference columns are dominated by an invalid blockade term
    spanning ~12 decades and switched to the decay-limited columns. Every plotted value is physical. But the
    inversion the brief asked for is not visible (the Ba 20 mW curve lies on top of Rb/Cs, indistinguishable),
    neither panel is labelled 4 K or 300 K, and it renamed the x-axis "Register size $n$" — `n` is the
    principal quantum number.
  - Sonnet showed the inversion with an explicit marker and named the axis correctly, but plotted the raw
    `*_eps_total` columns unexamined, so its y-axis reads **gate infidelity up to 10⁴** — an infidelity above
    1 is impossible — and it labelled the species `¹³⁸Ba⁺`, an ion, in a neutral-atom paper, in every label.

  The scientific error is Sonnet's and it is the worse one; a referee rejects ε = 10⁴ on sight. The lesson is
  not that one model wins: it is that **the step-5 "look at your own PNG and state the claim" self-check
  caught neither failure**, because neither failure is a composition defect. This is direct evidence for §4.3
  (the gate must test claim delivery and physical plausibility, e.g. an infidelity axis exceeding 1) and
  against relying on the author's own eye as the last line.
### 4.7b GLM re-measured after the account was funded, and `figure_auditor` moved (2026-09-03)
Credit restored, so GLM could finally be probed. `glm-5.3-flash` **has vision**; `glm-5.3`, `glm-5.2`,
`glm-5.1` and `glm-4.7` reject image content outright (`1210 … 取值范围 ['text']`). The older `glm-4.5v` /
`glm-4.6v` work but audit worse, and neither appears in `/models` — the catalog cannot be trusted to
enumerate vision support.

Audit task, same three figures, same prompt, 3 repeats:

| Model | Latency mean / worst | Cost per audit | Real defects per audit |
|---|---|---|---|
| glm-5.3-flash | 116 s / 187 s | **$0.0029** | **7–8** |
| glm-4.5v | 35 s / 53 s | $0.0066 | 5–6 |
| deepseek-vision | 67 s / 138 s | $0.0104 | 5.4 |
| sonnet-4-6 | 12 s / 13 s | $0.0113 | 5.6 |

`glm-5.3-flash` is simultaneously cheapest and sharpest. It alone found the dashed ionization line struck
through the `6sng ¹G₄` label (D5) and the wavelength labels sitting equidistant between the two arrows they
annotate (D6) — neither appeared in six deepseek/sonnet runs on that figure. **`figure_auditor` now routes
there under `--profile dual`** (`LUXAS_VISION_AUDIT_MODEL_PROFILE`, set in `src/index.ts`; `--profile claude`
keeps the Anthropic tier). It also puts the auditor a family away from the deepseek agents it audits, the
same independence rule `PI_REVIEWER_AGENTS` enforces.

A live `figure_auditor` spawn on it (17 tool calls, 170 s) immediately produced something eight Sonnet audits
in the Ba run never did: it caught a **vacuously passing lint**. `figlint-pdf` exited 0 with no output because
PyMuPDF had opened a PNG as an image document with no text layer, so every collision check silently did
nothing — and the auditor wrote "this is not a verified clean" instead of copying `lint: clean`. It also
scoped the CLAIM verdict per species and found the caption's "inverts" does not hold for Yb. That is §3.5
(the gate is the lint) being caught by the reader rather than shipped.

**Creation task** (same brief as §4.7a, one run each) — glm was added for completeness:

| | glm-5.3-flash | DeepSeek vision | Sonnet-4-6 |
|---|---|---|---|
| Turns | **14** | 36 | 48 |
| Wall clock | 12.8 min | 11.9 min | 23.0 min |
| Cost | **$0.043** | $0.21 | $2.18 |

GLM produced the best figure of the three: correct axis names, direct labels, no legend, no dead zone, and
**both** claims annotated on the page ("below all four references", "above Rb, Cs, Sr") — the only one of the
three to deliver the inversion the brief asked for. Faced with the same corrupted `*_eps_total` columns that
DeepSeek dodged by switching columns and Sonnet plotted to ε = 10⁴ unexamined, it drew an explicit
`gate fails` reference line at ε = 1, marking the physical boundary rather than hiding or ignoring the
problem. Its remaining defect is the one all three share: neither panel is labelled 4 K or 300 K.

**Routing as it now stands (2026-09-03).** The drawing agents — `illustrator`, `illustrator_write`,
`typesetter` — run on `glm-5.3-flash`. `figure_auditor` was moved there first and then moved back to its
Anthropic tier, because with GLM drawing the figures an auditor on GLM is not an independent eye. That is
not a theoretical worry here: GLM omitted the 4 K / 300 K panel labels when it drew the figure, and did not
flag missing temperature labels when it audited one. Same model, same blind spot. The rule is the one
`PI_REVIEWER_AGENTS` already encodes for the PI, and `smoke_dual_profile` now asserts it directly —
`figure_auditor`'s provider must differ from `illustrator_write`'s.

The cost of that choice is small: the auditor runs a handful of times per run at $0.011 an audit against
GLM's $0.003, and Sonnet is 10× faster per audit, which matters because the auditor is on the critical path
to shipping while the drawing agents are not.

**The pairing was then exercised end to end** (20 tool calls, 6.5 min): Sonnet auditing the figure GLM had
actually drawn. Its first FIX is the exact defect GLM was blind to in both roles —

> **Add temperature subtitles to both panels.** Neither panel carries a temperature label. The only way to
> tell them apart is the file names in the figspec.

GLM omitted those labels when drawing and did not flag their absence when auditing; the cross-family auditor
named it as the top fix. The independence argument is now empirical, not theoretical. Sonnet also checked the
caption against the pixels numerically and found it overclaims: barium at 20 mW inverts above Rb, Cs and Sr
but stays 8× *below* Yb at n = 100 (2.82e-4 vs 2.25e-3), so a caption naming all four species as the
comparison set is wrong. That is a claim-level catch, the class §4.3 argues the gate must cover, produced by
the reader rather than the lint.

- **`tool_review` moved glm-5.2 → glm-5.3 (2026-09-04, user instruction).** Recorded plainly: this was NOT
  backed by a blind-test-authoring benchmark. What is verified live is only that the model works — id
  resolves, tool calling with `tool_choice` "auto" and "required", reasoning_content returned, max_tokens
  ceiling 131072, context OK at 900,015 prompt tokens, pricing $1.40/$4.40/$0.26 from docs.z.ai. It is ~26%
  **dearer** than 5.2, so the cost cap bites marginally sooner on experiment-heavy runs. Because the move is
  unevidenced, `LUXAS_TOOL_REVIEW_MODEL=glm-5.2` is a one-variable rollback that `applyProfile` actually
  reads and `smoke_glm_model` actually exercises — a documented escape hatch nothing reads is the
  orphan-mechanism failure this repo keeps re-learning. The signal to watch is the pytest pass/fail pattern
  in `data/experiments/*/tests/`, not the model's prose: a weaker blind-test author shows up as tests that
  pass a trivial stub, not as worse-sounding output.

  **One data point, taken after the switch** (14 turns, 213 s, $0.18). A live `tool_review` on glm-5.3 was
  given only a description of a `blockade_radius(c6, omega)` tool — closed form `R_b = (C6/Ω)^(1/6)` — and
  wrote a 41-test suite. It was then run against five implementations, pytest arbitrating:

  | Implementation | Required | Result |
  |---|---|---|
  | correct closed form | pass | **41 passed** |
  | stub returning `0.0` | fail | failed |
  | raw ratio, no sixth root | fail | failed |
  | swap-symmetric `max/min` | fail | failed |
  | correct maths, no `ValueError` contract | fail | failed |

  It satisfied the contract in `CLAUDE.md` without being told: expected values recomputed from inputs
  (exact sixth powers — 64→2, 729→3, 15625→5 — verifiable by hand, never the tool's own output), explicit
  adversarial cases naming the lazy implementations they defeat, scaling and monotonicity laws, and the
  error contract including `-0.0`. It stayed blind: no read or write outside `tests/`. That is one tool, not
  a benchmark, and it says nothing about 5.3 *versus* 5.2 — but it rules out the failure mode that would
  have made the switch immediately harmful.
- **Fable 5.1 vs GLM-5.3, head to head (2026-09-04).** They look alike only on a saturated task.

  | Task | claude-fable-5-1 | glm-5.3 |
  |---|---|---|
  | Blind-test authoring (pytest arbitrates) | 66 tests, kills 4/4 stubs, 34 turns, $0.36 | 41 tests, kills 4/4 stubs, 14 turns, $0.18 |
  | E6 physics-review adjudication | **refuses** (`cyber`, 0 tokens) | both discriminators, plus two extras, $0.015 |

  The first row separates nothing because both models hit the ceiling — killing
  four lazy implementations is not a hard bar. The second row is the one that
  discriminates, and there they are opposites: GLM produced the best answer any
  model gave on that prompt, catching that the `_eps_total` columns stay above 1
  up to n ≈ 90, that Yb never crosses barium at *any* n, and that Yb's total ≈
  its decay term so the failure is real rather than a blockade-leakage artifact
  — an argument neither gpt-5.6-sol nor anyone else made. It also flagged that
  the first file states no drive power, so "equal 20 mW" is unverifiable from
  the data. Fable produced nothing at all.

  So: not similar. On the task this workload actually needs, GLM does it well
  for ~1.5 cents and Fable declines. Caveat: GLM is verbose — one of two runs
  hit the 6000-token cap mid-answer.
- **GLM was a live production hazard while the account was dry (2026-09-03).** Asked to add GLM's vision
  model to the comparison: the account returns `1113 余额不足或无可用资源包` (insufficient balance) for
  `glm-5.2`, `glm-5.3`, `glm-5.3-flash` and for every vision id (`glm-4.5v`, `glm-4.6v`), 3/3 on retry, so it
  is not transient. Only `glm-4.7` answers, and it rejects image content at the API
  (`1210 messages.content.type 参数非法，取值范围 ['text']`) — as do glm-5.2 and glm-5.3, which are text-only
  models, not multimodal. So there is no GLM vision number to report until the account is funded.
  **The hazard**: `glm-5.2` is the UNCONDITIONAL route for `tool_review` in every profile
  (`GLM_REVIEWER_AGENTS` in `src/agents/spawn.ts`), and `tool_review` is the blind-test author that makes the
  impl/review split real. With the account dry, every `tool_review` spawn fails exactly as Kimi did in §3.6.
  The preflight check in `src/index.ts` resolves only the *brain's* provider and only tests key presence, not
  credit, so a run starts clean and dies at the first experiment. This is the same failure class the vision
  switch just removed, still armed on a different agent.
- **Neither model caught the convention error** (wavy arrows used for laser drives) or the
  Rydberg/ionization baseline collision. Both miss the same class — domain conventions — which is the
  argument for §4.5: you cannot audit your way to a correct level diagram.
- A spawn that returns `stopReason=error` with 401/403/404 marks that agent type unavailable for the rest of
  the run; the reviewer/PI figure loop then skips figure fixes and stops spawning audits. Reading the 404 is
  not enough — the trace shows it was read and ignored. **Still open**: the provider consolidation removes
  the likeliest trigger but not the blind-loop behaviour itself.
- Pin a run to the checkout it started on (copy or lock); five hot deploys in one run produced the
  4-minute window in 3.1 and a mix of old and new rules.
- Rewrite `illustrator_write.md` and `illustrator.md` from scratch at ≤ 80 lines each around one rule set.
  The palimpsest is not a cosmetic issue; it is the reason the agent believed matplotlib was allowed.

## 5. What the three figures should have been

- **Frontier**: two panels (2 W, 20 mW), each with Ba decay (dashed blue), Ba total (solid blue), best
  reference (grey solid, labelled "Sr" / "Rb") and the other references as a light grey band; crossover
  marked once; y-limits chosen so nothing is clipped; no legend, end labels only.
- **Lifetime**: one panel. τ(n) for Ba radiative (blue), Ba effective 300 K (blue dashed), Rb/Cs/Sr points
  (grey markers, labelled), Shi2025 7.1 ms as a grey reference line with its label in the margin.
- **Level diagram**: compressed energy axis, three columns (¹S₀/¹D₂/³D on the left, P states centre,
  Rydberg + limit at the top right), straight coloured arrows with wavelength tags on the arrows,
  one wavy arrow for the ¹P₁ decay if shown at all, no key box.

## 6. What shipped from §4 (2026-09-05) — figures v4

Read against §4, in leverage order. Nothing here adds a model call; the drawing agents and the auditor
keep their routing. The relay is what gets cheaper: the audit loop is capped, the style audit is gone.

**§4.2 — the author can say what the figure needs, and the tool refuses what it does not understand.**
`figspec` now validates the whole spec against an explicit key set. An unknown key is exit 2 with the
nearest valid key; matplotlib vocabulary is refused with the figspec word to use (`title` → `tag`, `legend`
→ nothing, `style`/`color` → `group`, `annotations` → `highlight`/`tag`). Re-running the Ba run's own
`gate_infidelity_frontier.figspec.json` through it now stops at `panels[0].title` instead of drawing
something else silently. New vocabulary, each one a bypass in §3.1: a per-panel `tag` ("T = 4 K" — the
label every model in §4.7a omitted; placed inside the frame, else above the spine, never dropped), a `where`
row filter on CSV references (the mixed `reference_lifetimes.csv` that zig-zagged through Rb l=0 and l=1
rows), a colour `group` (one hue per species, variants by line style), a `reference` role (grey), an
`envelope` for "the other four species", `markers: false`, `linestyle` in both spellings. Composition is
now measured by the renderer itself: > 5 data series is an error, > 4 a warning; a series mostly outside
the authored limits is an error (five of seven Ba curves were clipped at 1e-2); data filling < 35 % of an
axis is a warning; a stacked panel is 2.45 in (the `double`+`column` spec that produced 7 × 9.3 in is now
7 × 4.9); a label the placer cannot fit is exit 2 + a `<pdf>.figlint.json` sidecar — the same channel the
save-time hook uses, so `compile_latex` refuses the figure until the spec is fixed. Before this, fig2's
highlight label had been dropped silently in every render since 08-29 and the fixture was "publishable".

**§4.3 — composition in the gate.** `figlint-pdf` rasterises the page and measures the largest empty
interior band: ≥ 15 % of the height (or 20 % of the width) is an ERROR. At `--width` it computes the print
height: > 6.5 in is an ERROR, > 5.5 in a WARN. On the three shipped Ba PDFs, which were lint-`clean`
before: frontier → dead zone 18 %; lifetime → dead zone 22 %; level diagram → prints 7.6 in tall + the
`ionization limit ⊗ 6sng¹G₄` collision. The two re-rendered data figures (below) pass. The compile gate
already consumes these errors; nothing new to wire.

**§4.5 — generated level diagrams.** `skills/figure/scripts/levelspec`: levels (label, energy, column,
group, tag) + transitions (from, to, kind, label) → TikZ → pdf/png → figlint at the natural width. It owns
the compressed energy axis (√ΔE gaps with a floor, break marks where compression > 3×), left-side labels
with the role tag inline (no key box), arrow slots, straight arrows for drives and wavy for decays, inline
wavelengths (rotated / sloped, so the stroke rule exempts them), elbow routing for a transition that skips
a column, staggered label positions on a fan, auto-upgrade single → double when the labels need it, and
the natural include width in its output. The Ba diagram from the fixture: 5.1 × 3.7 in, lint-clean,
against 6.4 × 9.3 in shipped. `templates/energy_levels.tex` no longer teaches a wavy laser.

**§4.4 — convergence.** `figure_auditor` classifies BLOCKING (claim not visible, impossible value,
illegible, occlusion, missing panel condition) vs cosmetic; verdict is `ship` unless blocking; ≤ 3 fixes
naming the spec knob, never coordinates; round 2 receives round 1 and may not reopen or reverse. The
reviewer's loop is capped at two rounds, re-briefs only for BLOCKING items, and escalates a surviving
blocking item to brain as a content problem instead of a third spawn. New audit lines: DATA (an infidelity
above 1 is visible to a reader who knows no physics) and CONDITION.

**§4.6 — the brief is a design.** brain's brief carries ≤ 2 panels, ≤ 4 series per panel, the one
comparison per panel, each panel's `tag`, which reference carries the claim and which are an envelope;
level diagrams are levelspec; the include width comes from the agent's return (never `0.74\textwidth`
of a tall PDF). The post-creation `illustrator` "global style audit" is removed — with renderer-owned
style there is nothing to align, and it was the palette ping-pong of §2 (design-figures-v2 §2.3).

**§4.7 (prompt palimpsest).** `illustrator_write.md` rewritten from 305 lines to ~85 around one rule
set (spec, look, lint, return); the ~200 lines of `ax.annotate` / `figplace` / `savefig` are gone.
`illustrator.md` and the reviewer resolve sources as figspec → levelspec → tex; `plot_*.py` is legacy only.

**Evidence, same data as §2.** The Ba frontier and lifetime re-rendered from the run's CSVs in the v4
grammar (`figspec_schema.md` carries the frontier spec): two panels tagged 4 K / 300 K, Ba as one hue with
2 W solid and 20 mW dashed, Sr grey, Rb/Cs/Yb one envelope, nothing clipped, direct labels, no legend, no
dead zone; the lifetime as one panel with Rb selected by `where`, the Sr literature point as a single marker,
Shi2025 as a margin-labelled reference line. Both lint-clean at their print widths. This is §5 as drawn.

**Gates.** `smoke_figspec` (fig9 fixture: tag/group/where/reference/envelope; eight refused specs; the
unfit-label exit-2 + sidecar path; the 4-panel column height cap), `smoke_figlint_pdf` (+ dead zone,
+ page-tall), new `smoke_levelspec` (Ba fixture renders, straight/wavy, no key, < 5.5 in, lint-clean;
three refused specs; the template fix). All registered in the MANIFEST.

**Not done, deliberately.** §4.1 (one agent that sees and draws on the strongest vision model) is a
routing/cost decision the user makes; the structure now supports it (the auditor is a gate, not a fix
generator). No live run has exercised v4 yet — the next `--profile dual` run is the measurement:
count figspec exit-2 messages the agent recovers from, audit rounds per figure (cap 2), and whether the
shipped PDFs carry a dead zone or a page-tall float (they cannot compile if they do).

## 7. Nature methodology, checked against the renderer (2026-09-05, figures v4.1)

Survey: Nature's *Guide to preparing final artwork* and research figure guide; Nature Methods *Points of
View* (Wong, Krzywinski et al., 2010–13: colour coding, salience, Gestalt, negative space, typography,
arrows, layout, axes/ticks/grids, labels and callouts, plotting symbols, mapping quantitative data to
colour, simplify to clarify) and *Points of Significance: Error bars* (Krzywinski & Altman 2013). The
mechanical rules (89/183 mm, ≤ 170 mm tall, 5–7 pt Helvetica/Arial, 8 pt bold panel letters, vector,
white space minimised) were already met by v4. The one active contradiction was ours: the mined domain
guides (tab10, red beside green) were declared ground truth over the mplstyle — Wong's colour-blindness
column says the opposite. Eight changes, all in `figspec` + one line of brain.md, gated in `smoke_figspec`:

1. mplstyle palette is ground truth; guides never override it (brain.md). A red–green pair on one axes
   (deuteranope simulation, Machado 2009 matrix; tab10 red/green distance 0.07 vs Okabe-Ito pairs ≥ 0.20)
   is separated by line style with a warning naming the pair.
2. Label text colour darkened to WCAG 4.5 on white (Okabe-Ito yellow 1.4 → olive 4.8).
3. `cmap` validated: sequential set, rainbow banned, `diverging: true` + `center` → RdBu_r symmetric.
4. `sigma_kind` required with `sigma`; renderer prints `caption must state: …` and stores it in the sidecar.
5. Reference role → open markers; data filled.
6. `sharey` automatic for a row/grid of one quantity (union of limits, tick labels once); stacked column
   shows x tick labels and title on the bottom panel only; `useOffset=False` on linear axes.
7. Sizes from the style: panel letters `min(10, font.size+1)`, labels ≤ `font.size` (Nature: 8/7 pt);
   `width: "1.5"` (120 mm).
8. Group header: "Ba" over "2 W" / "20 mW" in the margin when a group's labels repeat the group word.

Not adopted: Nature's "avoid coloured text" taken literally (direct labels in the series colour are the
column-endorsed alternative to a legend; contrast is enforced instead); grids (still never drawn);
1.5-column height rules beyond the existing 6.5 in cap.

## 8. Is it really better? Measured (2026-09-05, ~$1 total) — and the one thing it broke

Harness in `notes/figure-bench-2026-09-05/` (judge, pair lists, creation briefs, every PNG). Two tests.

**A. Blind pairwise judgement.** A vision model sees two versions of one figure and the claim, scores each
0–2 on seven criteria (claim, condition, physical, legible, focus, space, convention) and names the version a
referee would accept with fewer revisions. Both presentation orders; two judge families (Sonnet, GLM-5.3-flash).

| pair (A vs B) | judge | A wins | B wins | mean A | mean B |
|---|---|---|---|---|---|
| shipped Ba frontier vs v4.1 re-render | sonnet / glm | 0 / 0 | 2 / 2 | 7.0 / 8.5 | 14.0 / 14.0 |
| shipped Ba lifetime vs v4.1 re-render | sonnet / glm | 0 / 0 | 2 / 2 | 8.0 / 8.0 | 13.5 / 14.0 |
| hand TikZ level diagram vs levelspec | sonnet / glm | 0 / 0 | 2 / 2 | 9.0 / 9.5 | 12.5 / 13.5 |
| shipped Ba lifetime vs v4.1 **created** by deepseek / glm | sonnet | 0 / 0 | 4 / 4 | 7.8 / 7.5 | 13.8 / 13.8 |
| 09-03 GLM frontier vs **v4.1** GLM frontier (same brief) | sonnet | **3** | 1 | 10.8 | 12.0 |
| 09-03 DS frontier vs **v4.1** DS frontier (same brief) | sonnet | **4** | 0 | 11.8 | 13.0 |
| 09-03 GLM frontier vs **v4.2** GLM frontier | sonnet | 1 | **3** | 10.3 | 12.3 |
| 09-03 DS frontier vs **v4.2** GLM frontier | sonnet | 0 | **4** | 11.0 | 13.3 |
| v4.1 vs v4.2 lifetime (glm / ds) | sonnet | 2 / 2 | 2 / 2 | 13.5 / 14.0 | 13.5 / 13.3 |

Against what the real run shipped, v4 wins every vote in both judge families (14 of 14 on the re-renders,
8 of 8 on fresh creations), and the rubric moves from 7–9 to 13–14 of 14. That is the production baseline,
and the answer to "is it really better" is yes by a wide margin.

**The thing it broke.** Against the 09-03 *creation* outputs on the frontier brief — same brief, old prompt
and renderer — v4.1 **lost 7 of 8 votes while scoring higher** on the rubric. Every losing reason was the
same: the v4 rule "≤ 4 series, fold the references into an envelope" hid the four references the claim
named individually, and nothing on the page said "inverts". The old figures were cluttered (six coloured
lines, and the GLM one plotted the corrupted `_eps_total` column up to ε = 10, a physical impossibility the
judge penalised) but they wrote "below all four references" and "above Rb, Cs, Sr" next to the curves. A
referee weighs claim delivery above composition. That is Wong's *salience to relevance* read against my own
rule, and the rule was wrong.

**v4.2 (same day).** References get their own budget (≤ 4, thin grey, open markers, end-labelled) and do
not count against the four foreground series; a reference the claim names is drawn individually, an
envelope only for a set the claim does not name; `highlight` takes up to two callouts per panel whose label
is the claim's words at the point where the relation holds (≤ 40 characters; a number in e-notation is
typeset as ×10ⁿ); the colour-blind check ignores same-grey pairs; brain's `crux:` line names the words for
the page; the auditor's CLAIM line asks for them. Re-run: the v4.2 GLM frontier beats the 09-03 GLM figure
3–1 and the 09-03 DS figure 4–0. On the simple lifetime claim v4.1 and v4.2 tie 2–2 with equal scores in
both models — the judge's split there is pure position bias, so the callout rule costs nothing.

**B. Can an agent drive the strict grammar?** Six creation runs, `illustrator_write` under the v4 prompt,
no human in the loop:

| brief | model | tools | wall | exit-2 loops | lint | notes |
|---|---|---|---|---|---|---|
| frontier (v4.1) | glm-5.3-flash | 10 | 8.5 min | 0 | clean | tags, group, envelope, decay columns chosen |
| frontier (v4.1) | deepseek-vision | 37 | 21 min | 0 | clean | 23 calls inspecting data AND reading the renderer source |
| lifetime (v4.1) | glm / deepseek | 12 / 17 | 4 / 3 min | 0 / 0 | clean | `where` on the mixed table correct in both |
| frontier (v4.2) | glm | 10 | 4.7 min | 0 | clean | 4 references + 2 callouts per panel |
| lifetime (v4.2) | glm / deepseek | 13 / 16 | 4.5 / 3.4 min | 0 / 0 | clean | callouts "above Rb, Sr" / "far below Shi2025" |

No run hit an exit-2 loop; every spec passed the lint first time. The frontier brief is contaminated — it
is the schema's worked example — so its runs test the pipeline, not the model; the lifetime brief has no
example and tests the model, and both models used the row filter, the tag, the reference role and (v4.2)
the claim callouts without one. Cost signal: the deepseek frontier run spent half its 37 calls reading the
renderer source to learn the grammar; the prompt now says the grammar document is complete and forbids
that. Compare 09-03: 14–48 tools, 12–23 min, and figures that a judge now scores 10–12 of 14.

**Caveats.** n = 1 creation run per cell; judge is a model, with visible position bias on close pairs
(the 2–2 splits); the rubric is mine. What is not in doubt: the direction and size of the gap to the shipped
figures, and that v4.1's envelope rule lost referee votes until v4.2 restored the named references and the
claim callouts.
