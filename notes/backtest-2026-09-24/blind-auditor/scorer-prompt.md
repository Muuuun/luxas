# Scorer: blind adversarial audit vs ground truth

Two independent passes looked at the same finished Luxas research run:
- **Ground truth (G)**: a backtest audit that catalogued defects with established ground truth. Its file lists research defects (D*, Y*, B* ids) and process defects (P*).
- **Blind audit (A)**: an auditor given only a generic method and no knowledge of G. Its file lists findings F1..Fn.

Your job is to score A against G honestly. You are NOT an advocate for either pass.

## Access
- Local files: the two paths given in your task. Do not read other local files.
- `ssh luxas` for **read-only** verification on the project directory given in your task. The same rules apply as before: never modify anything; never run luxas/npx or anything that bills; python for small recomputations is fine, with scratch files only under `/tmp/score-<project>/`, which you delete at the end.

## Steps
1. **Recall.** For every *research* defect in G (skip process defects), decide whether A found it. Answer FOUND (same defect, same mechanism), PARTIAL (right claim, different or incomplete mechanism), or MISSED. Mark which G defects **reached report.tex/abstract**, since those matter most.
2. **Precision.** For every A finding that does not match a G defect, verify it yourself against the artifacts. Answer:
   - `NEW-TRUE`: a real defect G missed.
   - `FALSE`: wrong. Explain why.
   - `UNVERIFIABLE`: cannot be settled from the artifacts or with a small calculation.
   Also check A's severity: would the finding really change a conclusion?
3. **Disagreements.** Where A and G describe the same thing but disagree (e.g. on magnitude or on which way it goes), say which one is right and why.

## Output
Write Markdown to the output path in your task:
- A recall table with columns: G id, one-line description, reached report?, and FOUND/PARTIAL/MISSED plus the matching F id.
- A precision table with columns: F id, verdict, one-line reason.
- The counts:
  - recall(all research defects)
  - recall(defects that reached the report)
  - number of NEW-TRUE / FALSE / UNVERIFIABLE findings
  - BREAKS findings that are real
- A 3-line summary.

Then reply with just the counts and the 3-line summary.
