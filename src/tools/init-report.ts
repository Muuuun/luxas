/**
 * init_report tool — create LaTeX scaffold for the report.
 */

import { existsSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERAL_MPLSTYLE = join(LUXAS_ROOT, "skills", "venue-specific", "figstyles", "general.mplstyle");
export const STYLE_TRUTH_HEADER = "> **Style truth is `report/figstyle.mplstyle`** (palette = `axes.prop_cycle`, tick direction, font sizes, spines). The prose below describes the venue's visual voice; any hex codes or tick conventions it names are illustrative and must NOT be applied over the mplstyle.\n\n";
const DEFAULT_STYLE_GUIDE = join(LUXAS_ROOT, "skills", "figure", "style_guides", "_default.md");

function makeScaffold(title: string): string {
  return `\\documentclass[twocolumn]{article}
\\usepackage{amsmath, amssymb, graphicx, tabularx}
\\usepackage{dblfloatfix}% allow figure*/table* at [b] and on the final page — without it double-column floats defer page after page and pile up at the document end
% Relax float placement so figures land near their \\ref instead of drifting:
\\renewcommand{\\topfraction}{0.9}
\\renewcommand{\\dbltopfraction}{0.9}
\\renewcommand{\\textfraction}{0.07}
\\renewcommand{\\floatpagefraction}{0.85}
\\renewcommand{\\dblfloatpagefraction}{0.85}
\\providecommand{\\affiliation}[1]{}% safety net: \\affiliation is a revtex4-2/APS-only command; in [article] it is undefined and its argument text spills onto page 1 (triggers "Missing \\begin{document}"). No-op it so a stray \\affiliation can never leak.

\\title{${title}}
\\author{Luxas \\\\ \\small Singularity Research}

\\begin{document}
\\twocolumn[
  \\begin{@twocolumnfalse}
    \\maketitle
    \\begin{abstract}
    % Write abstract here.
    \\end{abstract}
    \\vspace{6pt}
  \\end{@twocolumnfalse}
]

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

      // Deploy a default figstyle so plot scripts that do
      // `plt.style.use('report/figstyle.mplstyle')` get sensible cross-platform
      // CJK + TrueType embedding from day one. brain may overwrite this with
      // a venue-specific style (physics-aps / nature-science / etc.) later.
      const figstylePath = join(reportDir, "figstyle.mplstyle");
      if (!existsSync(figstylePath) && existsSync(GENERAL_MPLSTYLE)) {
        copyFileSync(GENERAL_MPLSTYLE, figstylePath);
      }

      // Deploy the default style guide alongside it. style_guide.md is the
      // palette/composition ground truth that illustrator_write reads before
      // every plot and illustrator audits against — seeding it at init (not at
      // reviewer finalize, which used to burn polish rounds on hex churn)
      // means the first figure already draws against a guide. brain upgrades
      // it to a domain guide (physics/biology/...) when the venue is known.
      const styleGuidePath = join(reportDir, "figures", "style_guide.md");
      if (!existsSync(styleGuidePath) && existsSync(DEFAULT_STYLE_GUIDE)) {
        mkdirSync(join(reportDir, "figures"), { recursive: true });
        // Single style source (figures v2, 2026-08-28): the mplstyle is the
        // truth; the prose guide is voice. Two sources cost eight audit
        // spawns of palette ping-pong in the pp-vs-ss run.
        writeFileSync(styleGuidePath, STYLE_TRUTH_HEADER + readFileSync(DEFAULT_STYLE_GUIDE, "utf-8"));
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
