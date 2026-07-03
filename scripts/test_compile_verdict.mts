// Golden-log tests for parseCompileVerdict — the single source of truth over
// the LaTeX .log (compile_latex message / Layer-3 snapshot / finish gate).
// Fixture 1 replays the 2026-07-02 table-overlap case: a bare center+tabular
// in a twocolumn doc whose overfull the log labels "in paragraph".
import { parseCompileVerdict, gateBlockingIssues } from "../src/tools/report.js";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function freshDir(): string { return mkdtempSync(join(tmpdir(), "verdict-")); }

// Build a .tex with tabular blocks at exact 1-indexed line positions.
function texWithTabulars(totalLines: number, blocks: { begin: number; end: number; float?: "table" | "table*" }[]): string {
  const lines: string[] = Array.from({ length: totalLines }, (_, i) => `% filler line ${i + 1}`);
  for (const b of blocks) {
    if (b.float) {
      lines[b.begin - 2] = `\\begin{${b.float}}`;
      lines[b.end] = `\\end{${b.float}}`;
    }
    lines[b.begin - 1] = "\\begin{tabular}{lccc}";
    lines[b.end - 1] = "\\end{tabular}";
  }
  return lines.join("\n");
}

// ── 1. The 2026-07-02 case: bare tabular overfull mislabeled "paragraph" ──
{
  console.log("case 1: bare-tabular overflow (the shipped table-overlap)");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(146, [{ begin: 42, end: 54 }, { begin: 114, end: 122 }]));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (64.85155pt too wide) in paragraph at lines 42--55\n" +
    "Overfull \\hbox (145.90541pt too wide) in paragraph at lines 114--123\n");
  const v = parseCompileVerdict(dir);
  check("ok=false", !v.ok);
  check("2 overfull hits", v.overfull.length === 2);
  check("ctx re-attributed to table", v.overfull.every((h) => h.ctx === "table"), JSON.stringify(v.overfull.map(h => h.ctx)));
  check("file is report.tex", v.overfull.every((h) => h.file === "report.tex"));
  check("fix prescribes table*, not \\allowbreak", v.overfull.every((h) => h.fix.includes("table*") && !h.fix.includes("allowbreak")));
  check("tag overfull-table", v.tags.includes("overfull-table"));
  check("overfull is NOT gate-blocking (Phase 1)", gateBlockingIssues(v).length === 0);
  check("report names both lines", v.report.includes("line 114") && v.report.includes("line 42"));
}

// ── 2. .bbl attribution: log line number beyond the .tex's end ──
{
  console.log("case 2: overfull in the generated bibliography");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(23, []));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (143.0pt too wide) in paragraph at lines 50--55\n");
  const v = parseCompileVerdict(dir);
  check("file is report.bbl", v.overfull[0]?.file === "report.bbl", v.overfull[0]?.file);
  check("fix targets references.bib", v.overfull[0]?.fix.includes("references.bib") === true);
}

// ── 3. Signal threshold ──
{
  console.log("case 3: sub-threshold overfull ignored");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (19.9pt too wide) in paragraph at lines 5--8\n");
  const v = parseCompileVerdict(dir);
  check("ok=true", v.ok);
  check("no tags", v.tags.length === 0, v.tags.join(","));
}

// ── 4. Citations / refs summary — gate semantics unchanged ──
{
  console.log("case 4: undefined citations and the refs-summary catch-all");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "report.log"),
    "Citation `foo2026' on page 3 undefined on input line 12.\n" +
    "There were undefined references.\n");
  const v = parseCompileVerdict(dir);
  const gate = gateBlockingIssues(v);
  check("citation detected", v.cites.includes("foo2026"));
  check("gate blocks on the citation", gate.some((i) => i.includes("foo2026")));
  check("refs-summary suppressed when cites present", !gate.some((i) => i.includes('"??"')));

  const dir2 = freshDir();
  writeFileSync(join(dir2, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir2, "report.log"), "There were undefined references.\n");
  const v2 = parseCompileVerdict(dir2);
  check("summary-only still blocks (catch-all kept)", gateBlockingIssues(v2).some((i) => i.includes('"??"')));
}

// ── 5. Determinism: byte-stable over an unchanged log ──
{
  console.log("case 5: byte-stable verdict (Layer-3 cache equality)");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(146, [{ begin: 42, end: 54 }]));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (64.85155pt too wide) in paragraph at lines 42--55\n" +
    "Citation `x' on page 1 undefined on input line 2.\n");
  const a = JSON.stringify(parseCompileVerdict(dir));
  const b = JSON.stringify(parseCompileVerdict(dir));
  check("two parses byte-identical", a === b);
  const v = parseCompileVerdict(dir);
  check("tags sorted", JSON.stringify(v.tags) === JSON.stringify([...v.tags].sort()));
}

// ── 6. In-float table* overflow → tabularx advice ──
{
  console.log("case 6: overflow inside an existing table* float");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(40, [{ begin: 12, end: 20, float: "table*" }]));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (570.0pt too wide) in paragraph at lines 12--20\n");
  const v = parseCompileVerdict(dir);
  check("ctx table", v.overfull[0]?.ctx === "table");
  check("fix is tabularx/textwidth, not another table*", v.overfull[0]?.fix.includes("tabularx") === true && v.overfull[0]?.fix.includes("\\textwidth") === true);
}

// ── 7. Default base pinned to "report" — sibling logs can't whitewash ──
{
  console.log("case 7: gate evidence pinned to report.log; sibling logs ignored");
  const dir = freshDir();
  const past = new Date(Date.now() - 60_000);
  writeFileSync(join(dir, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "report.log"),
    "Citation `foo2026' on page 3 undefined on input line 12.\n" +
    "There were undefined references.\n");
  utimesSync(join(dir, "report.log"), past, past);
  writeFileSync(join(dir, "supplement.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "supplement.log"), "clean\n"); // newer AND clean
  const v = parseCompileVerdict(dir);
  check("newer clean sibling log does NOT whitewash", gateBlockingIssues(v).length > 0);
  check("report.log's citation still surfaces", v.cites.includes("foo2026"));
  const v2 = parseCompileVerdict(dir, "supplement");
  check("explicit base (compile tool path) honored", v2.ok);
}

// ── 8. Engine errors + stale log ──
{
  console.log("case 8: engine ! errors and log-older-than-pdf");
  const dir = freshDir();
  writeFileSync(join(dir, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "report.log"), "! LaTeX Error: File `nope.sty' not found.\n");
  const v = parseCompileVerdict(dir);
  check("engineErrors flagged", v.engineErrors && !v.ok && v.tags.includes("engine-error"));

  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, "report.log"), past, past);
  writeFileSync(join(dir, "report.pdf"), "%PDF-fake");
  const v2 = parseCompileVerdict(dir);
  check("stale-log flagged", v2.logStale && v2.tags.includes("stale-log"));
}

// ── 9. Commented-out tabular is not a phantom table ──
{
  console.log("case 9: %-commented tabular does not re-attribute prose overfull");
  const dir = freshDir();
  const lines = Array.from({ length: 30 }, (_, i) => `filler ${i + 1}`);
  lines[11] = "% \\begin{tabular}{lccc}  <- commented out";
  lines[19] = "% \\end{tabular}";
  writeFileSync(join(dir, "report.tex"), lines.join("\n"));
  writeFileSync(join(dir, "report.log"),
    "Overfull \\hbox (30.0pt too wide) in paragraph at lines 14--16\n");
  const v = parseCompileVerdict(dir);
  check("ctx stays paragraph", v.overfull[0]?.ctx === "paragraph", v.overfull[0]?.ctx);
  check("fix is \\allowbreak, not table*", v.overfull[0]?.fix.includes("allowbreak") === true);
}

// ── 10. bblStale-only: tags surface it even though ok=true ──
{
  console.log("case 10: bblStale-only state is visible in tags (snapshot coherence)");
  const dir = freshDir();
  const past = new Date(Date.now() - 120_000);
  writeFileSync(join(dir, "report.tex"), texWithTabulars(30, []));
  writeFileSync(join(dir, "report.log"), "clean\n");
  writeFileSync(join(dir, "report.bbl"), "old bbl\n");
  utimesSync(join(dir, "report.bbl"), past, past);
  writeFileSync(join(dir, "references.bib"), "@article{x}\n"); // newer than .bbl
  const v = parseCompileVerdict(dir);
  check("ok=true (tool flip semantics unchanged)", v.ok);
  check("tag stale-bibliography present", v.tags.includes("stale-bibliography"));
  check("gate blocks", gateBlockingIssues(v).length === 1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
