/**
 * init_report tool — create LaTeX scaffold and inject provref usage manual.
 *
 * This is the ONLY point where provref knowledge enters the brain agent's
 * context. Called once, when the agent is ready to write the manuscript.
 * Returns the full provref manual as a tool result (just-in-time injection).
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { resolveProvrefCmd, mergeRunsOrStub } from "./provref-utils.js";

const PROVREF_MANUAL = `## Provref Rules — READ CAREFULLY

Every number in report.tex MUST come from a structured reference. You cannot type literal numbers.

### Two macros

  \\resultref{run_N.path.to.field}    → your own experiment results
  \\litref{bibkey.field}              → values from cited papers

### Examples

  Our method achieves \\resultref{run_5.fidelity} fidelity.
  Previous best: \\litref{rydberg2024.fidelity} \\cite{rydberg2024}.
  Energy conservation: \\resultref{run_5.dynamics.energy_conservation}\\%.
  Uncertainty: $\\resultref{run_5.acc} \\pm \\resultref{run_5.acc_std}$

### Where the data lives

  \\resultref values: data/runs/run_N/results.json (produced by your experiment scripts)
  \\litref values: notes/literature_values.json (you maintain this when reading papers)

### literature_values.json format

  {
    "rydberg2024": {
      "source": "Rydberg et al., PRL 132, 020401 (2024)",
      "context": "Single-qubit gate fidelity at T=100K",
      "fidelity": 0.953,
      "fidelity_error": 0.012
    }
  }

Required fields per entry: "source" (string) and "context" (string), plus any numeric fields.

### What compile_latex does

  1. Merges data/runs/run_*/results.json into one file (automatic)
  2. Validates every \\resultref and \\litref resolves (hard fail with "Available keys" hints)
  3. Generates a clean version for PI review (refs replaced with numbers)
  4. Compiles PDF via pdflatex + jsonparse

If any ref is broken, compile fails with line numbers and "Did you mean…?" suggestions.

### What does NOT need a ref

  - Numbers inside math environments ($...$, equation, align)
  - Years (2024, 2025, ...)
  - Math constants (use LaTeX symbols: \\pi, e, etc.)
  - Indices, exponents, equation/figure/table labels

### Reference card

The full manual is saved to report/PROVREF_USAGE.md — read it if you forget.`;

const PROVREF_STY = `\\NeedsTeXFormat{LaTeX2e}
\\ProvidesPackage{provref}[2026/04/08 v0.1 Structured numerical references]

\\RequirePackage{jsonparse}

\\newcommand{\\provrefLoadRuns}[1]{\\JSONParseFromFile{\\provrefRuns}{#1}}
\\newcommand{\\provrefLoadLit}[1]{\\JSONParseFromFile{\\provrefLit}{#1}}

\\newcommand{\\resultref}[1]{\\JSONParseExpandableValue{\\provrefRuns}{#1}}
\\newcommand{\\litref}[1]{\\JSONParseExpandableValue{\\provrefLit}{#1}}

\\endinput
`;

function makeScaffold(title: string): string {
  return `\\documentclass{article}
\\usepackage{provref}
\\usepackage{amsmath, amssymb, graphicx}
\\provrefLoadRuns{../data/runs/all_results.json}
\\provrefLoadLit{../notes/literature_values.json}

\\title{${title}}
\\author{Luxas}

\\begin{document}
\\maketitle

\\begin{abstract}
% Write abstract here. Use \\resultref{} for your own results.
\\end{abstract}

\\section{Introduction}

\\section{Methods}

\\section{Results}

\\section{Discussion}

\\section{Conclusion}

\\bibliographystyle{unsrt}
\\bibliography{references}

\\end{document}
`;
}

export function createInitReportTool(projectDir: string) {
  return {
    name: "init_report",
    label: "Initialize Report",
    description:
      "Initialize the LaTeX report scaffold with provref boilerplate. " +
      "Call this ONCE when you are ready to write the manuscript (after experiments are done). " +
      "Creates report/report.tex and returns the provref usage rules.",
    parameters: {
      type: "object" as const,
      properties: {
        title: {
          type: "string" as const,
          description: "Paper title",
        },
      },
      required: ["title"],
    },
    async execute(_toolCallId: string, params: { title: string }) {
      const reportDir = join(projectDir, "report");
      const texPath = join(reportDir, "report.tex");
      const litPath = join(projectDir, "notes", "literature_values.json");
      const runsDir = join(projectDir, "data", "runs");
      const allResultsPath = join(runsDir, "all_results.json");

      mkdirSync(reportDir, { recursive: true });
      mkdirSync(runsDir, { recursive: true });

      const provrefCmd = resolveProvrefCmd(projectDir);
      if (provrefCmd) {
        mergeRunsOrStub(provrefCmd, runsDir, allResultsPath);
      } else if (!existsSync(allResultsPath)) {
        writeFileSync(allResultsPath, "{}\n");
      }

      if (!existsSync(litPath)) {
        mkdirSync(join(projectDir, "notes"), { recursive: true });
        writeFileSync(litPath, "{}\n");
      }

      if (!existsSync(join(reportDir, "provref.sty"))) {
        writeFileSync(join(reportDir, "provref.sty"), PROVREF_STY);
      }
      if (!existsSync(join(reportDir, "references.bib"))) {
        writeFileSync(join(reportDir, "references.bib"), "");
      }

      if (existsSync(texPath)) {
        return {
          content: [{
            type: "text" as const,
            text: `report/report.tex already exists — not overwriting.\n\n${PROVREF_MANUAL}`,
          }],
        };
      }

      writeFileSync(texPath, makeScaffold(params.title));
      writeFileSync(join(reportDir, "PROVREF_USAGE.md"), PROVREF_MANUAL);

      if (process.platform === "darwin") {
        try {
          execSync(`xattr -cr "${reportDir}" "${dirname(litPath)}" "${runsDir}"`, { stdio: "pipe" });
        } catch {}
      }

      return {
        content: [{
          type: "text" as const,
          text: `Report scaffold created: report/report.tex\n\n${PROVREF_MANUAL}`,
        }],
      };
    },
  };
}
