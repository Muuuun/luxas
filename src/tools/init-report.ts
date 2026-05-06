/**
 * init_report tool — create LaTeX scaffold for the report.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

function makeScaffold(title: string): string {
  return `\\documentclass{article}
\\usepackage{amsmath, amssymb, graphicx}

\\title{${title}}
\\author{Luxas}

\\begin{document}
\\maketitle

\\begin{abstract}
% Write abstract here.
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
      "Initialize the LaTeX report scaffold. " +
      "Call this ONCE when you are ready to write the manuscript (after experiments are done). " +
      "Creates report/report.tex.",
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

      mkdirSync(reportDir, { recursive: true });

      if (!existsSync(join(reportDir, "references.bib"))) {
        writeFileSync(join(reportDir, "references.bib"), "");
      }

      if (existsSync(texPath)) {
        return {
          content: [{
            type: "text" as const,
            text: `report/report.tex already exists — not overwriting.`,
          }],
        };
      }

      writeFileSync(texPath, makeScaffold(params.title));

      if (process.platform === "darwin") {
        try {
          execSync(`xattr -cr "${reportDir}"`, { stdio: "pipe" });
        } catch {}
      }

      return {
        content: [{
          type: "text" as const,
          text: `Report scaffold created: report/report.tex`,
        }],
      };
    },
  };
}
