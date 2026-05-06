/**
 * Report tool — compile LaTeX to PDF.
 *
 * Auto-detects TeX installation paths (macOS TeX Live, Homebrew, Linux).
 * If not found, attempts automatic installation via Homebrew (macOS) or apt (Linux).
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { applyAuthorityEscalationSection } from "./authority-escalation.js";

const CompileParams = Type.Object({
  dir: Type.Optional(Type.String({ description: "Report directory (default: report/)" })),
  texfile: Type.Optional(Type.String({ description: "Name of the .tex file (default: report.tex)" })),
});

/**
 * Find pdflatex and return PATH prefix for TeX binaries.
 * Checks common install locations before falling back to auto-install.
 */
function resolveTexPath(): string {
  // Already in PATH?
  try {
    execSync("which pdflatex", { stdio: "pipe" });
    return "";
  } catch {}

  // Common TeX Live locations (macOS & Linux)
  const candidates = [
    "/Library/TeX/texbin",
    "/usr/local/texlive/2026/bin/universal-darwin",
    "/usr/local/texlive/2025/bin/universal-darwin",
    "/usr/local/texlive/2024/bin/universal-darwin",
    "/usr/local/texlive/2026/bin/x86_64-linux",
    "/usr/local/texlive/2025/bin/x86_64-linux",
    "/opt/homebrew/bin",
    "/usr/bin",
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "pdflatex"))) {
      return dir;
    }
  }

  // Try to auto-install
  try {
    if (process.platform === "darwin") {
      console.error("  ⟳ Installing BasicTeX via Homebrew...");
      execSync("brew install --cask basictex", {
        stdio: "pipe",
        timeout: 300_000,
      });
      // After install, check again
      if (existsSync("/Library/TeX/texbin/pdflatex")) {
        return "/Library/TeX/texbin";
      }
    } else {
      console.error("  ⟳ Installing texlive via apt...");
      execSync("sudo apt-get update && sudo apt-get install -y texlive-latex-base texlive-latex-extra texlive-bibtex-extra biber", {
        stdio: "pipe",
        timeout: 300_000,
      });
      if (existsSync("/usr/bin/pdflatex")) {
        return "/usr/bin";
      }
    }
  } catch {}

  return "";
}

let cachedTexPath: string | null = null;

export function getTexEnv(): Record<string, string> {
  if (cachedTexPath === null) {
    cachedTexPath = resolveTexPath();
  }
  if (!cachedTexPath) return { ...process.env } as Record<string, string>;

  return {
    ...process.env,
    PATH: `${cachedTexPath}:${process.env.PATH ?? ""}`,
  } as Record<string, string>;
}

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
      const env = getTexEnv();

      // Render authority-bound escalations only when the registry is non-empty.
      // This keeps the final-report section default-omitted and removes the
      // prompt-side pressure to invent human questions.
      applyAuthorityEscalationSection(dir, texfile, projectDir);

      // Pre-compile check: figures from other papers must have \cite{}
      const citationErrors = checkFigureCitations(dir, texfile, projectDir);
      if (citationErrors.length > 0) {
        const msg = "✗ Figure citation check failed — figures from other papers MUST have \\cite{} in their figure environment:\n\n" +
          citationErrors.join("\n") +
          "\n\nFix the missing citations before compiling.";
        return { content: [{ type: "text" as const, text: msg }], details: { success: false } };
      }

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
          const out = execSync(cmd, {
            cwd: dir,
            encoding: "utf-8",
            timeout: 60_000,
            maxBuffer: 5 * 1024 * 1024,
            env,
          });
          outputs.push(`$ ${cmd}\n${out.slice(-500)}`);
        } catch (err: any) {
          const msg = err.stdout ?? err.stderr ?? err.message ?? String(err);
          outputs.push(`$ ${cmd}\nERROR: ${String(msg).slice(-1000)}`);
          // bibtex errors are often non-fatal
          if (!cmd.startsWith("bibtex")) success = false;
        }
      }

      const header = success ? "✓ Compilation succeeded\n\n" : "✗ Compilation had errors\n\n";
      const footer = success ? "" :
        "\n\n💡 If you've already tried to fix this error once, delegate to the fixer agent instead of burning expensive tokens:\n" +
        '   spawn_agent(agent="fixer", task="Fix this compile error: <paste the error above>")\n' +
        "   The fixer uses haiku and is much cheaper than debugging LaTeX syntax yourself.";
      const text = header + outputs.join("\n\n") + footer;
      return { content: [{ type: "text" as const, text }], details: { success } };
    },
  };

  return [compileLatex];
}

// ── Figure citation enforcement ──────────────────────────────────

/**
 * Build a set of figure filenames that originate from downloaded papers.
 * Scans each paper's figures manifest.json for extracted figure filenames.
 */
function buildPaperFigureIndex(projectDir: string): Set<string> {
  const index = new Set<string>();
  const papersDir = join(projectDir, "data", "papers");
  if (!existsSync(papersDir)) return index;

  try {
    for (const entry of readdirSync(papersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(papersDir, entry.name, "figures", "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        for (const fig of manifest.figures ?? []) {
          if (fig.filename) index.add(fig.filename);
          if (fig.source) index.add(fig.source);
        }
      } catch {}
    }
  } catch {}
  return index;
}

/**
 * Check that every \includegraphics in a \begin{figure} environment
 * has a \cite{} if the figure file comes from a downloaded paper.
 * Returns an array of error messages (empty = all good).
 */
function checkFigureCitations(
  reportDir: string,
  texfile: string,
  projectDir: string,
): string[] {
  const texPath = join(reportDir, texfile);
  if (!existsSync(texPath)) return [];

  const tex = readFileSync(texPath, "utf-8");
  const paperFigures = buildPaperFigureIndex(projectDir);
  if (paperFigures.size === 0) return [];

  const errors: string[] = [];

  // Extract all \begin{figure}...\end{figure} blocks (including figure*)
  const figureBlocks = tex.match(/\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/g) ?? [];

  for (const block of figureBlocks) {
    // Find all \includegraphics in this block
    const gfxMatches = block.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g);

    for (const m of gfxMatches) {
      const figPath = m[1];
      const figName = basename(figPath);

      // Check if this figure comes from a downloaded paper
      if (!paperFigures.has(figName)) continue;

      // Check if there's a \cite{} anywhere in this figure environment
      if (!/\\cite[tp]?\{[^}]+\}/.test(block)) {
        // Find the caption for a better error message
        const capMatch = /\\caption\{([^}]{0,80})/.exec(block);
        const caption = capMatch ? capMatch[1] : "(no caption)";
        errors.push(
          `  • Figure "${figName}" is from a downloaded paper but has no \\cite{} in its figure environment.\n` +
          `    Caption: ${caption}...`
        );
      }
    }
  }

  return errors;
}
