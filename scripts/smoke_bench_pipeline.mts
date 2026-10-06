#!/usr/bin/env tsx
/**
 * smoke_bench_pipeline — the measurement instrument measures.
 *
 * bench_run / bench_score / bench_compare decide whether a harness change was
 * worth making, so a scorer that passes a wrong report (or fails a right one)
 * is worse than no scorer. This gate feeds it hand-written reports whose
 * correct score is known, including the ones built to fool it. No model is
 * called.
 *
 *   npx tsx scripts/smoke_bench_pipeline.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBench, numbersIn } from "./bench_score.mts";
import { baselinePrompt, buildRecord, appendRecord, listBenches } from "./bench_run.mts";
import { readLedger, summarize, render } from "./bench_compare.mts";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH = join(ROOT, "benchmarks");
const tmp = mkdtempSync(join(tmpdir(), "luxas-bench-gate-"));
function project(name: string, tex: string | null, bib = ""): string {
  const d = join(tmp, name);
  mkdirSync(join(d, "report"), { recursive: true });
  if (tex !== null) writeFileSync(join(d, "report", "report.tex"), tex);
  if (bib) writeFileSync(join(d, "report", "references.bib"), bib);
  return d;
}
const passed = (dir: string, bench: string) => { const s = scoreBench(dir, join(BENCH, bench)); return `${s.oracle?.passed}/${s.oracle?.total}`; };
const failed = (dir: string, bench: string) => scoreBench(dir, join(BENCH, bench)).oracle!.checks.filter((c) => !c.pass).map((c) => c.label.slice(0, 40));

console.log("1. every bench is machine-scoreable");
const benches = listBenches();
check("at least 4 benches", benches.length >= 4, `${benches.length}`);
for (const b of benches) {
  const md = readFileSync(join(BENCH, b, "ORACLE.md"), "utf-8");
  const m = md.match(/```oracle\s*\n([\s\S]*?)\n```/);
  let n = 0;
  try { n = JSON.parse(m![1]).checks.length; } catch { /* reported below */ }
  check(`${b}: oracle block parses with >= 3 checks`, n >= 3, `${n} checks`);
}

console.log("\n2. numbers are read the way reports write them");
const vals = (t: string) => numbersIn(t).map((n) => n.v);
check("LaTeX scientific notation", vals("p_L = 6 \\times 10^{-7}").some((v) => Math.abs(v - 6e-7) < 1e-12), JSON.stringify(vals("p_L = 6 \\times 10^{-7}")));
check("…and it is not also read as 6, 10 and 7", !vals("p_L = 6 \\times 10^{-7}").includes(10));
check("bare power of ten", vals("about $10^{-6}$ per state").some((v) => Math.abs(v - 1e-6) < 1e-12));
check("e-notation", vals("2.555e-4").some((v) => Math.abs(v - 2.555e-4) < 1e-12));
check("significant digits are counted from what was written", numbersIn("G = 42.66")[0].sig === 4 && numbersIn("about 43")[0].sig === 2);

console.log("\n3. bench-01: right, wrong, and built-to-fool reports");
const B1 = "bench-01-u233-gamow";
const good1 = project("b1-good", "We integrate the WKB exponent with the centrifugal term and find $G = 42.66$. The Q-value from AME2020 is 4.9087 MeV. The Viola--Seaborg systematics give 42.59.");
check("a correct report scores full", passed(good1, B1) === "4/4", `${passed(good1, B1)} failed: ${failed(good1, B1).join(" | ")}`);
const naive1 = project("b1-naive", "Neglecting the centrifugal barrier, WKB gives $G = 40.2$. Q = 4.9087 MeV (AME2020). Viola--Seaborg agrees.");
check("the no-centrifugal answer (40.2) fails the G check", failed(naive1, B1).some((l) => l.startsWith("Gamow factor")), passed(naive1, B1));
const stray1 = project("b1-stray", "See page 43 of the review. We did not compute G. Q is about 5 MeV.");
check("a stray '43' does not satisfy G = 42.6 (minSig)", failed(stray1, B1).some((l) => l.startsWith("Gamow factor")));
check("a rounded Q of 5 MeV does not satisfy Q = 4.9087", failed(stray1, B1).some((l) => l.startsWith("Q_alpha")));
const none = project("b1-none", null);
check("no report → 0, never a free pass", passed(none, B1) === "0/4", passed(none, B1));
const md1 = join(tmp, "b1-md"); mkdirSync(join(md1, "report"), { recursive: true });
writeFileSync(join(md1, "report", "report.md"), "G = 42.66, Q = 4.9087 MeV from AME2020; Viola-Seaborg cross-check 42.59.");
check("a Markdown report is read too (an arm without LaTeX still gets scored)", passed(md1, B1) === "4/4", passed(md1, B1));

console.log("\n4. bench-03 and bench-04: caveats, citations and traps");
const B3 = "bench-03-ftqc-ccz-conflict";
const good3 = project("b3-good", "From Table 1, Gidney reports $6 \\times 10^{-7}$; Claes tabulates $1.0 \\times 10^{-6}$, a ratio of 1.67. The two are normalised to different physical error rates, so the comparison is ill-posed.");
check("bench-03 correct report scores full", passed(good3, B3) === "5/5", `${passed(good3, B3)} failed: ${failed(good3, B3).join(" | ")}`);
const bad3 = project("b3-bad", "Gidney reports $6 \\times 10^{-7}$ and Claes $1 \\times 10^{-6}$ (ratio 1.67). These figures are directly comparable, so Gidney is cheaper.");
check("…and calling them directly comparable trips the trap and misses the caveat", failed(bad3, B3).length === 2, failed(bad3, B3).join(" | "));
const B4 = "bench-04-prior-art-positioning";
const good4 = project("b4-good", "The failure of perturbative $C_6$ is known \\cite{vaillant2012,sibalic2017,sibalic2016}.", "@article{vaillant2012, author={Vaillant, C. L.}, eprint={1203.3736}}\n@article{sibalic2017, author={Šibalić, N.}, title={ARC}}\n@misc{sibalic2016, eprint={1605.00259}}");
check("bench-04: priors found in the bibliography count", passed(good4, B4) === "4/4", `${passed(good4, B4)} failed: ${failed(good4, B4).join(" | ")}`);
const bad4 = project("b4-bad", "We show for the first time that perturbative $C_6$ vanishes on axis, a previously unreported artefact.");
check("bench-04: claiming novelty with no priors scores 0", passed(bad4, B4) === "0/4", passed(bad4, B4));

console.log("\n5. the baseline is not handed the answer");
for (const b of benches) {
  const prompt = baselinePrompt(readFileSync(join(BENCH, b, "RESEARCH.md"), "utf-8"));
  // Only the answer fields — labels and patterns legitimately contain years ("AME2020").
  const block = JSON.parse(readFileSync(join(BENCH, b, "ORACLE.md"), "utf-8").match(/```oracle\s*\n([\s\S]*?)\n```/)![1]);
  const oracleNums: number[] = block.checks.flatMap((c: any) => [c.target, c.a, c.b]).filter((v: any) => typeof v === "number");
  const leaked = oracleNums.filter((v) => numbersIn(prompt).some((n) => Math.abs(n.v - v) <= Math.abs(v) * 1e-6));
  check(`${b}: no oracle value appears in the prompt`, leaked.length === 0, leaked.join(", "));
}
const runSrc = readFileSync(join(ROOT, "scripts", "bench_run.mts"), "utf-8");
check("the run directory receives RESEARCH.md and nothing else from the bench", (runSrc.match(/copyFileSync\(/g) ?? []).length === 1 && /copyFileSync\(join\(BENCH_ROOT, bench, "RESEARCH\.md"\)/.test(runSrc));

console.log("\n6. ledger round trip and the table");
const ledger = join(tmp, "LEDGER.jsonl");
const rec = (arm: string, dir: string, bench: string, cost: number) => appendRecord(buildRecord({ arm, bench, runDir: dir, model: "m", costUsd: cost, wallSec: 600, exit: "success" }), ledger);
rec("claude-code", good1, B1, 1.0); rec("claude-code", naive1, B1, 2.0); rec("luxas", good1, B1, 8.0); rec("luxas", none, B3, 4.0);
writeFileSync(ledger, readFileSync(ledger, "utf-8") + "{ torn line\n");
const s = summarize(readLedger(ledger));
check("records survive a torn line", readLedger(ledger).length === 4);
check("mean over repeated runs", Math.abs(s.cells[B1]["claude-code"].score - (1 + 0.75) / 2) < 1e-9, String(s.cells[B1]["claude-code"].score));
check("mean cost per run", s.cells[B1]["claude-code"].costUsd === 1.5);
check("a run with no report counts as 0 and is flagged", s.cells[B3]["luxas"].score === 0 && s.cells[B3]["luxas"].reports === 0);
check("--latest keeps only the newest run", summarize(readLedger(ledger), { latest: true }).cells[B1]["claude-code"].n === 1);
const table = render(s);
check("the table warns that n=1 differences are noise", /n=1 cells present/.test(table));
check("the table lists arm/bench pairs not yet run", /not yet run: claude-code\/bench-03/.test(table), table.split("\n").slice(-2).join(" / "));
check("an empty ledger says so instead of printing an empty table", /ledger is empty/.test(render(summarize([]))));
check("the committed ledger, if present, parses", !existsSync(join(BENCH, "LEDGER.jsonl")) || readLedger().every((r) => typeof r.arm === "string" && typeof r.oracleTotal === "number"));

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
