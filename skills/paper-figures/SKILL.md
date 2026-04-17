---
name: paper-figures
description: Extract figures from downloaded papers and include them in survey/review reports. Use when the report covers other groups' work and benefits from their architecture diagrams, experimental plots, or system schematics. Your brain prompt supplies the absolute path to the extract-figures script as {{EXTRACT_FIGURES}} — use that value wherever this skill writes `extract-figures`.
---

# Paper Figures Skill

Figures are information. A survey/review report covering downloaded papers MUST include key figures — architecture diagrams, experimental results, comparisons. Do NOT write a text-only survey when figures are available.

## 3-step workflow

### Step 1 — Extract figures from downloaded papers

Your brain prompt supplies the script's absolute path as `{{EXTRACT_FIGURES}}`. Invoke it once per paper:

```bash
{{EXTRACT_FIGURES}} data/papers/<paper-id>.pdf   # single PDF
{{EXTRACT_FIGURES}} data/papers/<arxiv-id>        # arXiv source directory
```

This creates `data/papers/<id>_figures/` with extracted images and a `manifest.json` listing each figure with caption and page number.

### Step 2 — Review captions and classify every figure

Read every manifest:

```bash
cat data/papers/*_figures/manifest.json
```

Record your decisions in `notes/memory.md` under a `## Figure Review` section. Every figure must end up in one of three states:

- **USE** — essential for understanding the topic; will be included in the report
- **SKIP** — irrelevant, redundant, or low quality
- **UNREVIEWED** — caption not yet read (only acceptable as a transient state)

Select figures that are:

- Essential for understanding the topic (architecture diagrams, system schematics)
- Key experimental results that support your narrative
- Useful comparisons across methods, systems, or time periods
- Visually informative (not just tables rendered as images)

### Step 3 — Include `USE` figures in the report

For each figure marked `USE`, embed it directly in LaTeX:

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{../data/papers/<id>_figures/<filename>}
  \caption{<Your caption describing the figure in the context of your survey>. Adapted from \cite{<key>}.}
  \label{fig:<label>}
\end{figure}
```

## Rules

- **Coverage**: survey/review reports include at least 3-5 `USE` figures from downloaded papers, in addition to any figures you generate yourself.
- **Captions**: write your OWN caption in the context of the survey narrative — do not copy the original caption.
- **Attribution**: always cite the source paper with `\cite{}`.
- **No skipping the review step**: every extracted figure must be classified before writing the report.
- **Complementary**: you may also generate your own figures (see `skills/matplotlib-figures/SKILL.md`) for data summaries, timelines, or cross-paper comparisons not found in existing figures.
