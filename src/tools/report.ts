/**
 * Report tool — compile LaTeX to PDF.
 *
 * Auto-detects TeX installation paths (macOS TeX Live, Homebrew, Linux).
 * If not found, attempts automatic installation via Homebrew (macOS) or apt (Linux).
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
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
      // resolve(), not join(): the brain sometimes passes an ABSOLUTE dir.
      // join(projectDir, "/abs/path") concatenates into a doubled, nonexistent
      // path, so execSync's cwd is ENOENT and EVERY compile step dies before
      // latex runs ("spawnSync /bin/sh ENOENT"). The PDF then never refreshes,
      // the tex-after-compile finish gate blocks forever, and the brain spins
      // on finish() — observed as a 60-call $24 dead loop on
      // magic-fountain-spread. resolve() takes an absolute arg as-is and only
      // joins a relative one.
      const dir = resolve(projectDir, params.dir ?? "report");
      const texfile = params.texfile ?? "report.tex";
      const base = texfile.replace(/\.tex$/, "");
      const env = getTexEnv();

      // Render authority-bound escalations only when the registry is non-empty.
      // This keeps the final-report section default-omitted and removes the
      // prompt-side pressure to invent human questions.
      applyAuthorityEscalationSection(dir, texfile, projectDir);

      // Pre-compile pass: in twocolumn documents, auto-promote `\begin{table}`
      // to `\begin{table*}` so tables span the full text width instead of
      // being constrained to the ~3.4in column and overflowing into the
      // adjacent column. Brain.md tells brain to do this manually but brain
      // routinely forgets; enforcing it at the tool layer is mechanical and
      // idempotent (already-`table*` blocks are left alone).
      const promoted = promoteTablesInTwoColumn(dir, texfile);

      // Pre-compile check: figures from other papers must have \cite{}
      const citationErrors = checkFigureCitations(dir, texfile, projectDir);
      if (citationErrors.length > 0) {
        const msg = "✗ Figure citation check failed — figures from other papers MUST have \\cite{} in their figure environment:\n\n" +
          citationErrors.join("\n") +
          "\n\nFix the missing citations before compiling.";
        return { content: [{ type: "text" as const, text: msg }], details: { success: false } };
      }

      // Engine selection: ctex / xeCJK / fontspec (CJK text & system fonts)
      // REQUIRE xelatex, not pdflatex. Hardcoding pdflatex made the agent
      // abandon this tool and hand-compile CJK reports with xelatex in bash —
      // bypassing every in-tool guard (figure-citation check, .log problem
      // scan). Detect the engine so the tool actually runs on those docs.
      let engine = "pdflatex";
      try {
        const src = readFileSync(join(dir, texfile), "utf-8");
        if (/\\usepackage(\[[^\]]*\])?\{(ctex|xeCJK|fontspec)\}|\\documentclass(\[[^\]]*\])?\{ctexart\}/.test(src)) {
          engine = "xelatex";
        }
      } catch { /* unreadable — default pdflatex */ }

      const steps = [
        `${engine} -interaction=nonstopmode ${texfile}`,
        `bibtex ${base}`,
        `${engine} -interaction=nonstopmode ${texfile}`,
        `${engine} -interaction=nonstopmode ${texfile}`,
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

      // pdflatex exits 0 on most layout/reference problems — they're warnings,
      // not errors. Parse the .log so the agent sees: text spilling past column
      // edge, floats that couldn't be placed (silently dropped), undefined cites
      // and refs (render as [?, ?] / "??"). All of these are user-visible bugs
      // that brain would otherwise finish() through.
      const problems = success ? readLogProblems(dir, base) : { count: 0, report: "" };
      if (problems.count > 0) success = false;

      const header = success ? "✓ Compilation succeeded\n\n" : "✗ Compilation had errors\n\n";
      const footer = success ? "" :
        "\n\n💡 If you've already tried to fix this error once, delegate to the fixer agent instead of burning expensive tokens:\n" +
        '   spawn_agent(agent="fixer", task="Fix this compile error: <paste the error above>")\n' +
        "   The fixer uses haiku and is much cheaper than debugging LaTeX syntax yourself.";
      const promotedNote = promoted > 0
        ? `\nℹ️  Auto-promoted ${promoted} \`\\begin{table}\` → \`\\begin{table*}\` (twocolumn doc → tables span full text width).\n`
        : "";
      const text = header + promotedNote + outputs.join("\n\n") + problems.report + footer;
      return { content: [{ type: "text" as const, text }], details: { success } };
    },
  };

  return [compileLatex];
}

// ── Auto-promote table → table* in twocolumn documents ─────────

/**
 * In a `[twocolumn]` document, `\begin{table}` constrains the float to a single
 * ~3.4in column; wide content overflows into the adjacent column's body text.
 * `\begin{table*}` is the natural full-width-float variant. Brain.md instructs
 * brain to do this manually but it's a routine omission. Tool-layer rewrite is
 * mechanical, idempotent, and content-preserving.
 *
 * Returns the number of `\begin{table}` blocks promoted (0 if not twocolumn or
 * if no plain-table envs exist).
 */
function promoteTablesInTwoColumn(dir: string, texfile: string): number {
  const texPath = join(dir, texfile);
  if (!existsSync(texPath)) return 0;

  let tex: string;
  try { tex = readFileSync(texPath, "utf-8"); }
  catch { return 0; }

  // Detect twocolumn: either documentclass option or an explicit \twocolumn
  // command at the start of a line. Both forms appear in venue-specific
  // scaffolds (e.g. revtex4-2 uses the documentclass option; some ICML
  // templates invoke \twocolumn after \maketitle).
  const isTwoColumn =
    /\\documentclass\s*\[[^\]]*\btwocolumn\b[^\]]*\]\s*\{[^}]+\}/.test(tex) ||
    /^\s*\\twocolumn\b/m.test(tex);
  if (!isTwoColumn) return 0;

  // Replace `\begin{table}` / `\end{table}` only. The `\}` after `table` means
  // `\begin{table*}` (already promoted) is naturally skipped — `table*` has
  // `*` where the pattern requires `}`. Placement specifier `[t]`, `[!ht]`,
  // etc. follows the env opener and is preserved untouched.
  let count = 0;
  const promoted = tex
    .replace(/\\begin\{table\}/g, () => { count++; return "\\begin{table*}"; })
    .replace(/\\end\{table\}/g, "\\end{table*}");

  if (count === 0) return 0;
  try { writeFileSync(texPath, promoted, "utf-8"); }
  catch { return 0; }
  return count;
}

// ── pdflatex .log problem detection ──────────────────────────────

const OVERFULL_THRESHOLD_PT = 20;

interface OverfullHit { pt: number; line: number; ctx: "table/align" | "paragraph" | "math/display" }
interface StuckHit { line: number | null }

/**
 * Parse the .log for warnings that pdflatex logs but doesn't fail the build on,
 * yet which produce user-visible PDF bugs:
 *   • Overfull \hbox ≥ OVERFULL_THRESHOLD_PT → text spills past column edge
 *   • A float is stuck                        → figure/table silently dropped
 *   • Citation `X' ... undefined              → renders as [?, ?]
 *   • Reference `X' ... undefined             → renders as "??"
 *
 * Underfull \vbox and Underfull \hbox are intentionally NOT surfaced: they're
 * loose-spacing complaints (especially common in mixed CJK+English paragraphs)
 * that are typically un-fixable without breaking content, and would lock brain
 * into an infinite repair loop.
 */
function readLogProblems(
  dir: string,
  base: string,
): { count: number; report: string } {
  const logPath = join(dir, `${base}.log`);
  if (!existsSync(logPath)) return { count: 0, report: "" };

  let log: string;
  try { log = readFileSync(logPath, "utf-8"); }
  catch { return { count: 0, report: "" }; }

  // Overfull \hbox — `[^\n]*?` lazily captures the context phrase between
  // the pt value and the line number so we can tell tables from math from prose.
  const overfullRe = /Overfull \\hbox \(([\d.]+)pt too wide\)([^\n]*?)\b(?:line|lines) (\d+)/g;
  const overfull: OverfullHit[] = [];
  for (const m of log.matchAll(overfullRe)) {
    const pt = parseFloat(m[1]);
    if (pt < OVERFULL_THRESHOLD_PT) continue;
    const tag = m[2];
    const ctx: OverfullHit["ctx"] =
      tag.includes("alignment") ? "table/align" :
      tag.includes("paragraph") ? "paragraph" :
      "math/display";
    overfull.push({ pt, line: parseInt(m[3], 10), ctx });
  }

  // Float stuck — pdflatex gave up placing a figure/table; it's dropped from
  // the rendered PDF entirely (or pushed past the end). Brain ends up with a
  // \ref{} pointing at nothing.
  const stuckRe = /A float is stuck \(cannot be placed\)(?:[^\n]*?on input line (\d+))?/g;
  const stuck: StuckHit[] = [];
  for (const m of log.matchAll(stuckRe)) {
    stuck.push({ line: m[1] ? parseInt(m[1], 10) : null });
  }

  // Citation / Reference undefined — pdflatex prints these once per pass per
  // page; dedupe by key so brain sees the unique broken targets.
  const cites = new Set<string>();
  for (const m of log.matchAll(/Citation `([^']+)' on page \d+ undefined/g)) cites.add(m[1]);
  const refs = new Set<string>();
  for (const m of log.matchAll(/Reference `([^']+)' on page \d+ undefined/g)) refs.add(m[1]);

  // Undefined control sequence — e.g. a revtex-only `\affiliation` in an
  // [article] doc; LaTeX drops the command and its argument text spills onto
  // page 1. pdflatex/xelatex exit 0 on this, so it ships silently otherwise.
  const ctrlSeq = (log.match(/! Undefined control sequence/g) || []).length;

  const total = overfull.length + stuck.length + cites.size + refs.size + ctrlSeq;
  if (total === 0) return { count: 0, report: "" };

  const sections: string[] = [];

  if (overfull.length > 0) {
    const sorted = overfull.sort((a, b) => b.pt - a.pt);
    sections.push(
      `Overfull \\hbox ≥${OVERFULL_THRESHOLD_PT}pt (text spills past column edge):\n` +
      sorted.map((h) => `    • line ${h.line} (${h.ctx}): ${h.pt.toFixed(1)}pt too wide`).join("\n"),
    );
  }
  if (stuck.length > 0) {
    sections.push(
      `Float stuck — figure/table couldn't be placed and was silently dropped from the PDF:\n` +
      stuck.map((h) => `    • ${h.line !== null ? `line ${h.line}` : "(line n/a)"}`).join("\n"),
    );
  }
  if (cites.size > 0) {
    sections.push(
      `Undefined citations (PDF renders as [?, ?]):\n` +
      `    • ${[...cites].join(", ")}`,
    );
  }
  if (ctrlSeq > 0) {
    sections.push(
      `Undefined control sequence ×${ctrlSeq} (a command LaTeX doesn't know — e.g. a revtex-only \\affiliation in an [article] doc; its argument text spills onto page 1). Search the .log for "! Undefined control sequence" and fix the line it names.`,
    );
  }
  if (refs.size > 0) {
    sections.push(
      `Undefined references (PDF renders as "??"):\n` +
      `    • ${[...refs].join(", ")}`,
    );
  }

  const report =
    `\n\n⚠️ ${total} layout/reference problem(s) detected — these will appear as visible bugs in the PDF:\n\n  ` +
    sections.join("\n\n  ") +
    "\n\nCommon causes & fixes:\n" +
    "  • Overfull math/display    → use \\begin{align} a &= b \\\\ &+ c \\end{align}\n" +
    "  • Overfull table/align     → a long-text/CJK cell in a bare l/c/r column won't line-wrap (it expands to natural width); \\begin{table*} and \\resizebox do NOT fix this (table* keeps natural-width columns, resizebox shrinks the font to illegibility). Convert the long-text column(s) to tabularx X-columns: add \\usepackage{tabularx}, then \\begin{tabularx}{\\columnwidth}{>{\\raggedright\\arraybackslash}X|c|c}...\\end{tabularx} — use \\textwidth instead of \\columnwidth if the float is \\begin{table*}. Only X columns line-wrap.\n" +
    "  • Overfull paragraph       → insert \\allowbreak in long English/cite runs; split multi-key \\cite{} into shorter ones\n" +
    "  • Float stuck              → shrink the figure, use \\begin{figure*}/\\begin{table*} for full-width float, or relax placement specifier (e.g. [!htbp])\n" +
    "  • Citation undefined       → add entry to references.bib, or fix typo in \\cite{key}; remember to re-run bibtex\n" +
    "  • Reference undefined      → add \\label{key} to the target, or fix typo in \\ref{key}";
  return { count: total, report };
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
