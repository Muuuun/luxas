/**
 * Report tool — compile LaTeX to PDF.
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CompileParams = Type.Object({
  dir: Type.Optional(Type.String({ description: "Report directory (default: report/)" })),
  texfile: Type.Optional(Type.String({ description: "Name of the .tex file (default: report.tex)" })),
});

export function createReportTools(projectDir: string) {
  const compileLatex = {
    name: "compile_latex",
    label: "Compile LaTeX",
    description: "Compile LaTeX report to PDF. Runs pdflatex → bibtex → pdflatex → pdflatex. Returns compilation output and any errors.",
    parameters: CompileParams,
    async execute(
      _toolCallId: string,
      params: { dir?: string; texfile?: string },
    ) {
      const dir = params.dir ? join(projectDir, params.dir) : join(projectDir, "report");
      const texfile = params.texfile ?? "report.tex";
      const base = texfile.replace(/\.tex$/, "");
      const steps = [
        `pdflatex -interaction=nonstopmode ${texfile}`,
        `bibtex ${base}`,
        `pdflatex -interaction=nonstopmode ${texfile}`,
        `pdflatex -interaction=nonstopmode ${texfile}`,
      ];
      const outputs: string[] = [];
      let success = true;
      for (const cmd of steps) {
        try {
          const out = execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });
          outputs.push(`$ ${cmd}\n${out.slice(-500)}`);
        } catch (err: any) {
          const msg = err.stdout ?? err.stderr ?? err.message ?? String(err);
          outputs.push(`$ ${cmd}\nERROR: ${String(msg).slice(-1000)}`);
          // bibtex errors are often non-fatal
          if (!cmd.startsWith("bibtex")) success = false;
        }
      }
      const text = (success ? "✓ Compilation succeeded\n\n" : "✗ Compilation had errors\n\n") + outputs.join("\n\n");
      return { content: [{ type: "text" as const, text }], details: { success } };
    },
  };

  return [compileLatex];
}
