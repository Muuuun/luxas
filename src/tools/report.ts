/**
 * Report tool — compile LaTeX to PDF.
 *
 * Auto-detects TeX installation paths (macOS TeX Live, Homebrew, Linux).
 * If not found, attempts automatic installation via Homebrew (macOS) or apt (Linux).
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

// First CJK font present on this machine, or null. fc-list ships with
// fontconfig on macOS and texlive-full Linux. Cached: the font set doesn't
// change within a run.
let cachedCJKFont: string | null | undefined;
function pickCJKFont(): string | null {
  if (cachedCJKFont !== undefined) return cachedCJKFont;
  for (const f of ["PingFang SC", "Noto Sans CJK SC", "Songti SC", "Source Han Sans SC", "WenQuanYi Zen Hei"]) {
    try { if (execSync(`fc-list "${f}"`, { stdio: "pipe" }).length) return (cachedCJKFont = f); } catch { /* fc-list absent / no match */ }
  }
  return (cachedCJKFont = null);
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

      // Pre-compile check: CJK characters with no CJK package is the one
      // garble path that ships SILENTLY — pdflatex (and plain xelatex without
      // a CJK font) drop every CJK glyph emitting only un-surfaced "Missing
      // character" warnings, so the PDF "compiles", passes every gate, and
      // only a human notices the mojibake (observed: a 4529-char zh report).
      // Block it like the figure-citation check: refuse and tell the agent the
      // exact two lines to add. Once added, the engine-detect below flips to
      // xelatex on its own — no source mutation, no new engine logic.
      let src = "";
      try { src = readFileSync(join(dir, texfile), "utf-8"); } catch { /* unreadable */ }
      // needsXelatex: any package that requires the unicode engine (fontspec
      // included — pdflatex can't use it). handlesCJK: packages that ACTUALLY
      // render CJK. fontspec is necessary-but-NOT-sufficient for CJK — it sets
      // the Latin font but maps no CJK glyphs, so a fontspec-only zh report
      // still ships mojibake and must NOT satisfy the guard (the 2026-07-02
      // qd-vs-atom report did exactly this: fontspec, no xeCJK → garbled PDF).
      const needsXelatex = /\\usepackage(\[[^\]]*\])?\{(ctex|xeCJK|fontspec)\}|\\documentclass(\[[^\]]*\])?\{ctexart\}/.test(src);
      const handlesCJK = /\\usepackage(\[[^\]]*\])?\{(ctex|xeCJK)\}|\\documentclass(\[[^\]]*\])?\{ctexart\}|\\setCJKmainfont/.test(src);
      const hasCJK = /[㐀-䶿一-鿿぀-ヿ가-힯]/.test(src);
      if (hasCJK && !handlesCJK) {
        const f = pickCJKFont();
        const fontLine = f
          ? `  \\setCJKmainfont{${f}}`
          : `  \\setCJKmainfont{...}   % no CJK font found — install: macOS \`brew install font-noto-sans-cjk-sc\`, Linux \`apt install fonts-noto-cjk\``;
        const msg = "✗ CJK check failed — source contains CJK characters but no CJK package; "
          + "pdflatex/plain-xelatex drops these glyphs silently (the PDF compiles but is mojibake). "
          + "Add immediately after \\documentclass{...}:\n"
          + "  \\usepackage{xeCJK}\n" + fontLine + "\nThen recompile.";
        return { content: [{ type: "text" as const, text: msg }], details: { success: false } };
      }

      // Engine selection: ctex / xeCJK / fontspec (CJK text & system fonts)
      // REQUIRE xelatex, not pdflatex. Hardcoding pdflatex made the agent
      // abandon this tool and hand-compile CJK reports with xelatex in bash —
      // bypassing every in-tool guard. Same package signal as the CJK check.
      const engine = needsXelatex ? "xelatex" : "pdflatex";

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
      const hardFailure = !success;
      const verdict = success ? parseCompileVerdict(dir, base) : null;
      if (verdict && !verdict.ok) success = false;

      // Message shape is load-bearing: the 2026-07-02 table-overlap shipped
      // because brain quoted the engine's "Output written on report.pdf" tail
      // against the ✗ header ("the system might be treating warnings as
      // errors") and finished anyway. Verdict first, raw engine output last,
      // header pre-empts the exit-0 rationalization. Raw outputs are NOT
      // suppressed — bibtex's real errors live there.
      const header = success
        ? "✓ Compilation succeeded\n\n"
        : hardFailure
          ? "✗ Compilation had errors\n\n"
          : `✗ PDF written but NOT shippable — ${verdict!.count > 0 ? `${verdict!.count} user-visible defect(s)` : "engine errors"} listed below. ` +
            `The engine's exit 0 / "Output written" line means the file EXISTS, not that it is correct.` +
            (gateBlockingIssues(verdict!).length > 0
              ? " finish() will block on the citation/reference problems until they are fixed."
              : "") +
            "\n\n";
      // fixer is scoped to "ONE precise edit" syntax fixes (fixer.md) — a
      // layout rework like a tabularx conversion violates its own constraints,
      // so only advertise the delegation for hard engine errors.
      const footer = hardFailure ?
        "\n\n💡 If you've already tried to fix this error once, delegate to the fixer agent instead of burning expensive tokens:\n" +
        '   spawn_agent(agent="fixer", task="Fix this compile error: <paste the error above>")\n' +
        "   The fixer uses haiku and is much cheaper than debugging LaTeX syntax yourself." : "";
      const promotedNote = promoted > 0
        ? `\nℹ️  Auto-promoted ${promoted} \`\\begin{table}\` → \`\\begin{table*}\` (twocolumn doc → tables span full text width).\n`
        : "";
      const problemsBlock = verdict && !verdict.ok
        ? verdict.report + "\n\n── engine output ──\n" : "";
      const text = header + promotedNote + problemsBlock + outputs.join("\n\n") + footer;
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

// ── Compile verdict — single source of truth over the LaTeX .log ─────────
//
// ONE parser, three consumers: the compile_latex tool result, the Layer-3
// research-snapshot "last compile" line (context.ts), and the finish()
// PDF-correctness gate (tools/index.ts). The 2026-07-02 table-overlap
// shipped because each consumer ran its own regexes over the same log and
// disagreed — the tool said ✗ while the snapshot said "warnings only" —
// and the brain quoted the disagreement to overrule the tool. A shared
// verdict makes that disagreement unrepresentable.
//
// Underfull \vbox and Underfull \hbox are intentionally NOT surfaced: they're
// loose-spacing complaints (especially common in mixed CJK+English paragraphs)
// that are typically un-fixable without breaking content, and would lock brain
// into an infinite repair loop.

const OVERFULL_THRESHOLD_PT = 20;

export interface OverfullHit {
  pt: number;
  line: number;
  /** "table" = line-attributed to a tabular block in the source. The log
   *  alone labels a bare-tabular overflow "in paragraph" — routing by the
   *  log ctx would prescribe \allowbreak for what needs a table* / tabularx
   *  rework. */
  ctx: "table" | "table/align" | "paragraph" | "math/display";
  /** `<base>.tex` or `<base>.bbl` — a log line number past the .tex's end
   *  is in the generated bibliography; telling brain to edit that line of
   *  the .tex sends it thrashing on innocent lines. */
  file: string;
  fix: string;
}
export interface StuckHit { line: number | null }

export interface CompileVerdict {
  ok: boolean;
  count: number;
  overfull: OverfullHit[];
  stuck: StuckHit[];
  cites: string[];
  refs: string[];
  /** LaTeX's end-of-run "There were undefined references" summary — kept as
   *  a catch-all so per-page regex drift can't silently narrow detection. */
  refsSummary: boolean;
  ctrlSeq: number;
  /** Any `!`-prefixed engine error in the log (nonstopmode plows through). */
  engineErrors: boolean;
  bblStale: boolean;
  /** .log older than .pdf — the verdict does not describe the shipped PDF
   *  (hand-compile under another jobname / stale-log path). */
  logStale: boolean;
  logMissing: boolean;
  /** Discrete, alphabetically sorted problem classes for the Layer-3
   *  snapshot — byte-stable across rebuilds over an unchanged log. */
  tags: string[];
  report: string;
}

interface TabularBlock { begin: number; end: number; float: "bare" | "table" | "table*" }

function scanTabularBlocks(tex: string): TabularBlock[] {
  const blocks: TabularBlock[] = [];
  const floatStack: ("table" | "table*")[] = [];
  const open: TabularBlock[] = [];
  const lines = tex.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // Strip unescaped %-comments: a commented-out tabular would otherwise
    // create a phantom block and re-attribute a prose overfull as "table".
    const line = lines[i].replace(/(^|[^\\])%.*$/, "$1");
    if (/\\begin\{table\*\}/.test(line)) floatStack.push("table*");
    else if (/\\begin\{table\}/.test(line)) floatStack.push("table");
    if (/\\begin\{tabular\*?\}|\\begin\{tabularx\}/.test(line)) {
      open.push({ begin: i + 1, end: -1, float: floatStack[floatStack.length - 1] ?? "bare" });
    }
    if (/\\end\{tabular\*?\}|\\end\{tabularx\}/.test(line)) {
      const b = open.pop();
      if (b) { b.end = i + 1; blocks.push(b); }
    }
    if (/\\end\{table\*?\}/.test(line)) floatStack.pop();
  }
  return blocks;
}

function tableFix(float: TabularBlock["float"]): string {
  switch (float) {
    case "bare":
      return "bare tabular wider than the column — wrap it in \\begin{table*}[t]\\centering … \\end{table*} (full-width float, one edit); if cells hold long wrapping text, convert those columns to tabularx X-columns instead";
    case "table":
      return "the table float is single-column — change \\begin{table}…\\end{table} to \\begin{table*}…\\end{table*}; if it still overflows, convert long-text columns to tabularx X-columns";
    case "table*":
      return "already a full-width float, so the natural-width columns exceed \\textwidth — convert the long-text column(s) to \\begin{tabularx}{\\textwidth}{…X…} (only X columns line-wrap; \\resizebox shrinks the font to illegibility)";
  }
}

function defaultFix(ctx: OverfullHit["ctx"]): string {
  switch (ctx) {
    case "table/align":
      return "a long-text/CJK cell in a bare l/c/r column won't line-wrap (it expands to natural width); convert the long-text column(s) to tabularx X-columns: add \\usepackage{tabularx}, then \\begin{tabularx}{\\columnwidth}{>{\\raggedright\\arraybackslash}X|c|c}…\\end{tabularx} — use \\textwidth if the float is \\begin{table*}. Only X columns line-wrap";
    case "paragraph":
      return "insert \\allowbreak in long English/cite runs; split multi-key \\cite{} into shorter ones";
    default:
      return "use \\begin{align} a &= b \\\\ &+ c \\end{align} to break the display across lines";
  }
}

export function parseCompileVerdict(reportDir: string, base?: string): CompileVerdict {
  // Default is pinned to "report": the finish gate, the snapshot line and the
  // typesetter suspects all audit the SHIPPED report/report.pdf, whose engine
  // transcript is report.log by jobname. Resolving "the newest .log" instead
  // was verified to be a whitewash hole — any newer sibling compile
  // (supplement.tex, a hand-compiled scratch doc) would replace the gate's
  // evidence and let a broken report.pdf ship (it also re-anchored the
  // bblStale check to a nonexistent sibling .bbl). compile_latex passes the
  // base it actually compiled, so non-report compiles are still judged
  // correctly in the tool result.
  const resolvedBase = base ?? "report";
  const logPath = join(reportDir, `${resolvedBase}.log`);

  let log = "";
  let logMissing = true;
  try { log = readFileSync(logPath, "utf-8"); logMissing = false; } catch { /* no compile yet */ }

  // Source structure for line-number attribution.
  let texLineCount = Infinity;
  let tabularBlocks: TabularBlock[] = [];
  try {
    const tex = readFileSync(join(reportDir, `${resolvedBase}.tex`), "utf-8");
    texLineCount = tex.split("\n").length;
    tabularBlocks = scanTabularBlocks(tex);
  } catch { /* no attribution possible */ }

  const overfull: OverfullHit[] = [];
  const stuck: StuckHit[] = [];
  const cites = new Set<string>();
  const refs = new Set<string>();
  let refsSummary = false;
  let ctrlSeq = 0;
  let engineErrors = false;

  if (!logMissing) {
    // `[^\n]*?` lazily captures the context phrase between the pt value and
    // the line number so we can tell tables from math from prose.
    const overfullRe = /Overfull \\hbox \(([\d.]+)pt too wide\)([^\n]*?)\b(?:line|lines) (\d+)/g;
    for (const m of log.matchAll(overfullRe)) {
      const pt = parseFloat(m[1]);
      if (pt < OVERFULL_THRESHOLD_PT) continue;
      const line = parseInt(m[3], 10);
      const tag = m[2];
      let ctx: OverfullHit["ctx"] =
        tag.includes("alignment") ? "table/align" :
        tag.includes("paragraph") ? "paragraph" :
        "math/display";
      let file = `${resolvedBase}.tex`;
      let fix: string;
      if (line > texLineCount) {
        file = `${resolvedBase}.bbl`;
        fix = `the overflow is in the generated bibliography, not the .tex — fix the long entry/URL in references.bib (wrap URLs in \\url{}), then recompile. Do NOT edit line ${line} of ${resolvedBase}.tex`;
      } else {
        const block = tabularBlocks.find((b) => line >= b.begin - 1 && line <= b.end + 1);
        if (block) {
          ctx = "table";
          fix = tableFix(block.float);
        } else {
          fix = defaultFix(ctx);
        }
      }
      overfull.push({ pt, line, ctx, file, fix });
    }

    // Float stuck — pdflatex gave up placing a figure/table; it's dropped from
    // the rendered PDF entirely (or pushed past the end). Brain ends up with a
    // \ref{} pointing at nothing.
    const stuckRe = /A float is stuck \(cannot be placed\)(?:[^\n]*?on input line (\d+))?/g;
    for (const m of log.matchAll(stuckRe)) {
      stuck.push({ line: m[1] ? parseInt(m[1], 10) : null });
    }

    // Citation / Reference undefined — pdflatex prints these once per pass per
    // page; dedupe by key so brain sees the unique broken targets.
    for (const m of log.matchAll(/Citation `([^']+)' on page \d+ undefined/g)) cites.add(m[1]);
    for (const m of log.matchAll(/Reference `([^']+)' on page \d+ undefined/g)) refs.add(m[1]);
    refsSummary = /There were undefined references/.test(log);

    // Undefined control sequence — e.g. a revtex-only `\affiliation` in an
    // [article] doc; LaTeX drops the command and its argument text spills onto
    // page 1. pdflatex/xelatex exit 0 on this, so it ships silently otherwise.
    ctrlSeq = (log.match(/! Undefined control sequence/g) || []).length;

    engineErrors = /^!/m.test(log);
  }

  let bblStale = false;
  try {
    if (statSync(join(reportDir, "references.bib")).mtimeMs >
        statSync(join(reportDir, `${resolvedBase}.bbl`)).mtimeMs) bblStale = true;
  } catch { /* no bib or no bbl — nothing to compare */ }

  let logStale = false;
  try {
    // 5s tolerance: the engine writes the .pdf before it closes the .log.
    if (statSync(join(reportDir, `${resolvedBase}.pdf`)).mtimeMs -
        statSync(logPath).mtimeMs > 5000) logStale = true;
  } catch { /* no pdf or no log */ }

  const count = overfull.length + stuck.length + cites.size + refs.size +
    (refsSummary && cites.size === 0 && refs.size === 0 ? 1 : 0) + ctrlSeq;
  const ok = count === 0 && !engineErrors;

  const tagSet = new Set<string>();
  for (const h of overfull) {
    tagSet.add(h.ctx === "table" || h.ctx === "table/align" ? "overfull-table"
      : h.ctx === "paragraph" ? "overfull-paragraph" : "overfull-math");
  }
  if (stuck.length > 0) tagSet.add("float-stuck");
  if (cites.size > 0) tagSet.add("undefined-citations");
  if (refs.size > 0 || refsSummary) tagSet.add("undefined-references");
  if (ctrlSeq > 0) tagSet.add("undefined-control-sequence");
  if (engineErrors) tagSet.add("engine-error");
  if (bblStale) tagSet.add("stale-bibliography");
  if (logStale) tagSet.add("stale-log");
  const tags = [...tagSet].sort();

  const sections: string[] = [];
  if (overfull.length > 0) {
    const sorted = [...overfull].sort((a, b) => b.pt - a.pt);
    sections.push(
      `Overfull \\hbox ≥${OVERFULL_THRESHOLD_PT}pt (content spills past the column edge into the neighbour):\n` +
      sorted.map((h) => `    • ${h.file} line ${h.line} (${h.ctx}): ${h.pt.toFixed(1)}pt (~${(h.pt / 28.45).toFixed(1)} cm) too wide — ${h.fix}`).join("\n"),
    );
  }
  if (stuck.length > 0) {
    sections.push(
      `Float stuck — figure/table couldn't be placed and was silently dropped from the PDF:\n` +
      stuck.map((h) => `    • ${h.line !== null ? `line ${h.line}` : "(line n/a)"} — shrink the figure, use \\begin{figure*}/\\begin{table*} for a full-width float, or relax the placement specifier (e.g. [!htbp])`).join("\n"),
    );
  }
  if (cites.size > 0) {
    sections.push(
      `Undefined citations (PDF renders as [?, ?]) — add the entry to references.bib or fix the typo in \\cite{key}, then recompile:\n` +
      `    • ${[...cites].join(", ")}`,
    );
  }
  if (ctrlSeq > 0) {
    sections.push(
      `Undefined control sequence ×${ctrlSeq} (a command LaTeX doesn't know — e.g. a revtex-only \\affiliation in an [article] doc; its argument text spills onto page 1). Search the .log for "! Undefined control sequence" and fix the line it names.`,
    );
  }
  if (refs.size > 0 || (refsSummary && cites.size === 0)) {
    sections.push(
      `Undefined references (PDF renders as "??") — add \\label{key} to the target or fix the typo in \\ref{key}:` +
      (refs.size > 0 ? `\n    • ${[...refs].join(", ")}` : ""),
    );
  }

  const report = count > 0
    ? `⚠️ ${count} layout/reference problem(s) detected — these appear as visible bugs in the PDF:\n\n  ` +
      sections.join("\n\n  ")
    : engineErrors
      ? `⚠️ the engine reported errors (lines starting with "!") — search the .log for "!" and fix the line it names`
      : "";

  return {
    ok, count, overfull, stuck, cites: [...cites], refs: [...refs], refsSummary,
    ctrlSeq, engineErrors, bblStale, logStale, logMissing, tags, report,
  };
}

/**
 * Exactly the verdict classes the finish() gate blocks on. Living next to the
 * parser means the compile message, the snapshot consequence line, and the
 * gate can never disagree about what blocks — a consequence claim that the
 * gate doesn't enforce is exactly the "warnings only" bug in a new coat.
 */
export function gateBlockingIssues(v: CompileVerdict): string[] {
  const issues: string[] = [];
  if (v.cites.length > 0) issues.push(`undefined citation(s) [render as "?"]: ${v.cites.join(", ")}`);
  if (v.ctrlSeq > 0) issues.push(`undefined control sequence (e.g. a revtex-only \\affiliation in an [article] doc — its text spills onto page 1)`);
  if (v.refsSummary && v.cites.length === 0) issues.push(`undefined reference(s) [render as "??"]`);
  if (v.bblStale) issues.push(`references.bib is newer than report.bbl — bibtex did not re-run after the bibliography changed; recompile`);
  return issues;
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
