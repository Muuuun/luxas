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
- **GLM cannot be benchmarked and is a live production hazard (2026-09-03).** Asked to add GLM's vision
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
