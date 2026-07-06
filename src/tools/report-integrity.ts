/**
 * Report-integrity checks — the "write-only evidence store" fix (2026-07-04,
 * debate-adjudicated). Producers (ledger, results.json) are honest; nothing
 * consuming them was required to read them back, so reports diverged from
 * recorded truth by default (5/5 reviewed runs). These checks bind the report
 * to the evidence store mechanically:
 *
 *   1. Number provenance — every number in the ABSTRACT must resolve to a
 *      number recorded in results.json / notes/*.md (the evidence corpus).
 *      Caught class: qldpc's uncomputed "ε<0.001" sensitivity claim, ftqc's
 *      fabricated "5.4×" — numbers wearing computed clothes.
 *   2. State-keyed experiment citations — the report may not reference E_N
 *      unless its ledger section is Status: Complete. Caught class: ftqc's
 *      figure caption "Data from E4 analysis" citing a Pending experiment
 *      over a "(to be populated)" ledger.
 *   3. Disclosure propagation — [unverified]/[unanchored] tags and
 *      tool_review-degradation notes in the ledger must surface in the
 *      report. Caught class: both shuttling runs ran with tool_review dead
 *      (API 429, self-written tests), disclosed in ledger, stripped from
 *      report.
 *   4. results.json shape — latest run per experiment should carry the
 *      prompt-defined contract (verdict enum + computed). Warning only:
 *      legacy projects predate the schema.
 *
 * Consumed in two places: compile_latex appends the issue list to its output
 * (visibility while iterating), finish() blocks on `blocking` issues
 * (shipping). Escape hatch for false positives: reviews/integrity_pushback.md
 * with mtime newer than report/report.tex — same contract as pi_pushback.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface IntegrityIssue {
  kind: "number-provenance" | "experiment-citation" | "disclosure" | "results-schema" | "harness-vocab" | "outline";
  blocking: boolean;
  text: string;
}

// ── number extraction ───────────────────────────────────────────

/**
 * Normalize the notation zoo to plain numbers. Handles LaTeX sci notation
 * (1.75\times10^{-7}, 10^{-5}), e-notation, unicode superscripts from
 * markdown ledgers (1.75×10⁻⁷), percentages (both 59 and 0.59 are recorded
 * so either spelling on the other side matches).
 */
const SUP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};

function normalizeNotation(text: string): string {
  return text
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (s) => "^{" + [...s].map((c) => SUP[c] ?? c).join("") + "}")
    .replace(/×/g, "\\times");
}

export function extractNumbers(raw: string): number[] {
  const text = normalizeNotation(raw);
  const out: number[] = [];
  const push = (v: number) => { if (Number.isFinite(v)) out.push(v); };

  // a \times 10^{b} — with or without braces; also bare 10^{b}
  const sciRE = /(?:(\d+(?:\.\d+)?)\s*\\times\s*)?10\s*\^\s*\{?\s*(-?\d+)\s*\}?/g;
  let m: RegExpExecArray | null;
  while ((m = sciRE.exec(text))) {
    push((m[1] ? parseFloat(m[1]) : 1) * Math.pow(10, parseInt(m[2], 10)));
  }
  // e-notation
  const eRE = /\b(\d+(?:\.\d+)?)[eE](-?\d+)\b/g;
  while ((m = eRE.exec(text))) push(parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10)));
  // plain decimals / integers, skipping ones already consumed by sci forms
  const stripped = text.replace(sciRE, " ").replace(eRE, " ");
  const plainRE = /(\d+(?:\.\d+)?)\s*(%|\\%)?/g;
  while ((m = plainRE.exec(stripped))) {
    const v = parseFloat(m[1]);
    push(v);
    if (m[2]) push(v / 100);
  }
  return out;
}

/** Round to one significant figure (mantissa integer + exponent). */
function sig1(v: number): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  return `${Math.round(v / Math.pow(10, exp))}e${exp}`;
}

/**
 * Two-sided resolution: equal within 0.5% relative tolerance, OR same value
 * at one significant figure. The loose branch exists because abstracts
 * legitimately round ("~2×10⁻⁵" against a computed 1.87e-5 is 7% off — a
 * false block without it, gate-cost debate F5). The precision cost is
 * accepted: this gate checks PROVENANCE, not exactness; semantic drift
 * between rounded claims is the contradiction_auditor's job.
 */
function resolves(v: number, evidence: number[]): boolean {
  const vSig = sig1(v);
  for (const e of evidence) {
    if (v === e) return true;
    if (Math.abs(v - e) <= 0.005 * Math.max(Math.abs(v), Math.abs(e))) return true;
    if (vSig === sig1(e)) return true;
  }
  return false;
}

/**
 * Numbers exempt from provenance: structural small integers (list positions,
 * code distances — they always co-occur with a resolvable partner anyway),
 * years, and 100 (percent base).
 */
function exempt(v: number): boolean {
  if (Number.isInteger(v) && v >= 0 && v <= 12) return true;
  if (Number.isInteger(v) && v >= 1900 && v <= 2100) return true;
  if (v === 100) return true;
  return false;
}

/**
 * Strip the parts of a .tex file where digits are markup, not claims:
 * comments, preamble, \cite/\ref/\label arguments, lengths (0.8\linewidth,
 * 10pt), table column specs.
 */
function texClaimText(src: string): { abstract: string; body: string } {
  let s = src.replace(/(?<!\\)%.*$/gm, "");
  const begin = s.indexOf("\\begin{document}");
  if (begin >= 0) s = s.slice(begin);
  s = s
    .replace(/\\(?:cite|ref|eqref|label|bibliography|bibliographystyle|includegraphics|input|include)\s*(\[[^\]]*\])?\s*\{[^}]*\}/g, " ")
    .replace(/\d+(?:\.\d+)?\s*\\(?:linewidth|textwidth|columnwidth)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?(?:pt|cm|mm|em|ex|in|bp)\b/g, " ")
    .replace(/\\begin\{(?:tabular|tabularx)\}\s*(\{[^}]*\}){1,2}/g, " ");
  const am = s.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  return { abstract: am ? am[1] : "", body: s };
}

// ── evidence corpus ─────────────────────────────────────────────

function collectJsonNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number") { if (Number.isFinite(value)) out.push(value); return; }
  if (typeof value === "string") { out.push(...extractNumbers(value)); return; }
  if (Array.isArray(value)) { for (const v of value) collectJsonNumbers(v, out); return; }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectJsonNumbers(v, out);
  }
}

interface ExperimentDir { id: string; dir: string; latestResults: string | null }

function listExperimentDirs(projectDir: string): ExperimentDir[] {
  const root = join(projectDir, "data", "experiments");
  if (!existsSync(root)) return [];
  const out: ExperimentDir[] = [];
  for (const name of readdirSync(root)) {
    const m = name.match(/^E_?(\d+)/);
    if (!m) continue;
    const dir = join(root, name);
    let latest: string | null = null;
    let latestN = -1;
    const runsDir = join(dir, "runs");
    if (existsSync(runsDir)) {
      for (const run of readdirSync(runsDir)) {
        const rm = run.match(/^run_(\d+)$/);
        if (!rm) continue;
        const p = join(runsDir, run, "results.json");
        const n = parseInt(rm[1], 10);
        if (existsSync(p) && n > latestN) { latestN = n; latest = p; }
      }
    }
    out.push({ id: `E${parseInt(m[1], 10)}`, dir, latestResults: latest });
  }
  return out;
}

function collectEvidenceNumbers(projectDir: string, experiments: ExperimentDir[]): number[] {
  const out: number[] = [];
  for (const f of ["experiments.md", "literature.md", "memory.md", "plan.md"]) {
    try { out.push(...extractNumbers(readFileSync(join(projectDir, "notes", f), "utf-8"))); } catch { /* absent */ }
  }
  for (const e of experiments) {
    if (!e.latestResults) continue;
    try { collectJsonNumbers(JSON.parse(readFileSync(e.latestResults, "utf-8")), out); } catch { /* unparseable */ }
  }
  return out;
}

// ── the checks ──────────────────────────────────────────────────

const VERDICT_ENUM = new Set(["confirmed", "refuted", "inconclusive"]);

export function reportIntegrityIssues(projectDir: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let tex = "";
  try { tex = readFileSync(join(projectDir, "report", "report.tex"), "utf-8"); } catch { return issues; }
  const { abstract, body } = texClaimText(tex);
  const experiments = listExperimentDirs(projectDir);
  const ledger = (() => {
    try { return readFileSync(join(projectDir, "notes", "experiments.md"), "utf-8"); } catch { return ""; }
  })();

  // 1. Number provenance — abstract blocks, body warns.
  const evidence = collectEvidenceNumbers(projectDir, experiments);
  if (evidence.length > 0) {
    const fmt = (v: number) => (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6 ? String(v) : v.toExponential(3));
    const unresolvedAbstract = [...new Set(extractNumbers(abstract))]
      .filter((v) => !exempt(v) && !resolves(v, evidence));
    if (unresolvedAbstract.length > 0) {
      issues.push({
        kind: "number-provenance", blocking: true,
        text: `Abstract contains number(s) with no provenance in the evidence store ` +
          `(results.json / notes/*.md): ${unresolvedAbstract.slice(0, 8).map(fmt).join(", ")}. ` +
          `Every abstract number must be a computed leaf or a quoted, noted literature value — ` +
          `not an extrapolation or a from-memory figure. Either compute it (record in results.json), ` +
          `quote it (add to notes/literature.md with source), or remove it from the abstract.`,
      });
    }
    const unresolvedBody = [...new Set(extractNumbers(body))]
      .filter((v) => !exempt(v) && !resolves(v, evidence));
    if (unresolvedBody.length > 0) {
      issues.push({
        kind: "number-provenance", blocking: false,
        text: `${unresolvedBody.length} number(s) in the report body have no provenance in the ` +
          `evidence store, e.g.: ${unresolvedBody.slice(0, 12).map(fmt).join(", ")}. Not blocking, ` +
          `but each is a fabrication risk — check the load-bearing ones.`,
      });
    }
  }

  // 2. State-keyed experiment citations. IDs come from the ledger + the
  //    experiment dirs (the structured namespaces), never from prose.
  const incomplete = new Set<string>();
  const sectionRE = /^##\s+(?:L2\.(\d+)|E_?(\d+))\b[\s\S]*?(?=^##\s|(?![\s\S]))/gm;
  let sm: RegExpExecArray | null;
  while ((sm = sectionRE.exec(ledger))) {
    const n = parseInt(sm[1] ?? sm[2], 10);
    if (!/^\*\*Status:\*\*\s*Complete\b/im.test(sm[0])) incomplete.add(`E${n}`);
  }
  for (const e of experiments) {
    // dir exists but no substantive results at all → incomplete regardless of prose
    if (!e.latestResults || statSync(e.latestResults).size < 64) incomplete.add(e.id);
    else incomplete.delete(e.id);
  }
  const cited = new Set<string>();
  const refRE = /\bE_?(\d+)\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = refRE.exec(body))) cited.add(`E${parseInt(rm[1], 10)}`);
  const badCites = [...cited].filter((id) => incomplete.has(id));
  if (badCites.length > 0) {
    issues.push({
      kind: "experiment-citation", blocking: true,
      text: `Report references experiment(s) ${badCites.join(", ")} whose ledger status is not ` +
        `Complete (or which have no substantive results.json). A report may only cite finished, ` +
        `evidence-backed experiments — complete the experiment or remove the reference. ` +
        `(If "E${badCites[0].slice(1)}" in the report is a physics symbol, not an experiment ` +
        `reference, use the integrity_pushback escape below.)`,
    });
  }

  // 3. Disclosure propagation: machine-detectable degradation/uncertainty
  //    tags recorded in notes must survive into the report.
  const notesText = ["experiments.md", "memory.md", "literature.md"]
    .map((f) => { try { return readFileSync(join(projectDir, "notes", f), "utf-8"); } catch { return ""; } })
    .join("\n");
  const tags: string[] = [];
  const tagRE = /\[(unverified[^\]]*|unanchored[^\]]*|extrapolated[^\]]*|search-degraded[^\]]*)\]/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagRE.exec(notesText))) tags.push(`[${tm[1]}]`);
  const reviewDegraded =
    /tool_review[^.\n]{0,80}(unavailable|429|failed|not\s+run)|429[^.\n]{0,60}tool_review/i.test(notesText);
  const reportDiscloses =
    /unverified|not\s+independently\s+(?:verified|tested|reviewed)|未[经]?独立|未验证|独立(?:测试|验证|评审)不可用|search[^.\n]{0,40}(?:degraded|unavailable)|(?:corpus|literature|coverage)[^.\n]{0,50}(?:limited|restricted|incomplete)|(?:检索|搜索)[^.。\n]{0,30}(?:不可用|受限|降级)|(?:语料|文献覆盖)[^.。\n]{0,30}(?:受限|有限|不完整)/i.test(body);
  if ((tags.length > 0 || reviewDegraded) && !reportDiscloses) {
    const what = [
      tags.length > 0 ? `${tags.length} unverified/unanchored tag(s) in notes (e.g. ${[...new Set(tags)].slice(0, 3).join(", ")})` : "",
      reviewDegraded ? "a tool_review-degradation note (independent tests did not run)" : "",
    ].filter(Boolean).join(" and ");
    issues.push({
      kind: "disclosure", blocking: true,
      text: `The ledger records ${what}, but the report contains no corresponding disclosure. ` +
        `Disclosures written in notes must survive to the shipped document — add the caveat to the ` +
        `report (typically in a Limitations paragraph) or resolve the underlying uncertainty and ` +
        `remove the tag from the notes.`,
    });
  }

  // 5. Harness vocabulary in reader prose (storytelling debate, 2026-07-05).
  //    The surgery survey shipped a table caption citing an internal JSON
  //    field ("E2 分类实验中的 comparison_matrix.code_family_scope 字段") and a
  //    section conclusion phrased in adjudication enums ("通过 INCONCLUSIVE
  //    （而非 REFUTED）裁决"). The reader gets the FIELD's story; the pipeline's
  //    vocabulary stays in notes/. Deliberately tight patterns — do NOT extend
  //    into a euphemism arms race (a euphemized recurrence is evidence for the
  //    generative position, not for a longer blacklist). Escape: the existing
  //    integrity_pushback hatch (reports legitimately ABOUT these tokens).
  {
    const prose = body.replace(/\\texttt\{[^}]*\}|\\verb\|[^|]*\|/g, " ");
    const hits: string[] = [];
    const vocabPatterns: Array<[RegExp, string]> = [
      [/(通过|判定为|裁决为?)\s*(INCONCLUSIVE|REFUTED|CONFIRMED)|(INCONCLUSIVE|REFUTED|CONFIRMED)\s*(（|\()?而非/, "adjudication enum narrated as prose"],
      [/\b[a-z]+(?:_[a-z]+)+\.[a-z]+(?:_[a-z]+)*\b/, "internal JSON field path in prose"],
      [/E\d+\s*(实验|分类实验|对比实验)?(中的|通过|的裁决)/, "experiment-pipeline reference in reader prose"],
      [/PI\s*(反馈|修订|review|steer)/i, "PI-review process narrated in the report"],
    ];
    for (const [re, label] of vocabPatterns) {
      const m = prose.match(re);
      if (m) hits.push(`${label}: "…${m[0].slice(0, 60)}…"`);
    }
    if (hits.length > 0) {
      issues.push({
        kind: "harness-vocab", blocking: true,
        text: `Report prose contains pipeline-internal vocabulary the reader cannot interpret:\n  - ${hits.join("\n  - ")}\n` +
          `Rewrite in the field's terms (e.g. "open rather than closed: no obstruction proven, no adaptation demonstrated" ` +
          `instead of "INCONCLUSIVE 而非 REFUTED 裁决"; cite the literature, not results.json fields). The pipeline's ` +
          `vocabulary belongs in notes/, never in report.tex prose.`,
      });
    }
  }

  // 6. Outline existence + format (storytelling debate, 2026-07-05). Six
  //    brain.md mandates were silently skipped in the surgery run — the
  //    outline never existed and nothing checked. Existence + first-line
  //    format is all this gate claims to verify (mechanical class); outline
  //    QUALITY is the PI's structure check. Path is canonical:
  //    notes/report_outline.md (skills/review/SKILL.md was unified to it —
  //    a gate demanding path A while a skill writes path B is the PI-STEER
  //    deadlock pathology, caught pre-ship by the second-order debate).
  {
    const outlinePath = join(projectDir, "notes", "report_outline.md");
    let firstLine = "";
    try {
      firstLine = readFileSync(outlinePath, "utf-8").split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
    } catch { /* missing */ }
    if (!/^type:\s*\S+/.test(firstLine)) {
      issues.push({
        kind: "outline", blocking: true,
        text: `notes/report_outline.md is ${firstLine === "" ? "missing or empty" : `present but its first line is "${firstLine.slice(0, 60)}" instead of "type: <article-type>"`}. ` +
          `Write the reader-facing outline BEFORE report prose (see skills/narrative/SKILL.md, or the survey exemplar at ` +
          `skills/review/references/exemplar_survey_outline.md for surveys): first line "type: <empirical|feasibility|comparison|survey|policy-zh>", ` +
          `then claim-anchored section titles. The outline is a checkpoint artifact — gates and PI review key off it.`,
      });
    }
  }

  // 4. results.json shape (warning only — legacy projects predate the schema).
  const malformed: string[] = [];
  for (const e of experiments) {
    if (!e.latestResults) continue;
    try {
      const j = JSON.parse(readFileSync(e.latestResults, "utf-8"));
      const verdict = typeof j.verdict === "string" ? j.verdict.toLowerCase() : null;
      if (!verdict || !VERDICT_ENUM.has(verdict) || typeof j.computed !== "object") malformed.push(e.id);
    } catch { malformed.push(e.id); }
  }
  if (malformed.length > 0) {
    issues.push({
      kind: "results-schema", blocking: false,
      text: `results.json for ${malformed.join(", ")} is missing the contract keys ` +
        `(verdict ∈ confirmed|refuted|inconclusive, computed{}). Downstream gates key off these — ` +
        `fix the experiment output format.`,
    });
  }

  // 5. Fabricated test provenance (blocking — shipped failure 2026-07-06: a
  // project's results.json claimed "(tested: passing)" while ZERO test files
  // existed anywhere; tool_review had been down on API 429 all run and the
  // claim was authored as prose). A "tested" claim is only utterable when
  // tests/ actually contains test files. Keyed off structured state (file
  // presence), not self-report.
  {
    const fakeTested: string[] = [];
    for (const e of experiments) {
      if (!e.latestResults) continue;
      let raw = "";
      try { raw = readFileSync(e.latestResults, "utf-8"); } catch { continue; }
      if (!/tested\s*:?\s*(passing|passed|pass|通过)/i.test(raw)) continue;
      let hasTests = false;
      try {
        hasTests = readdirSync(join(e.dir, "tests")).some((f) => /^test_.*\.py$/.test(f));
      } catch { /* no tests dir */ }
      if (!hasTests) fakeTested.push(e.id);
    }
    if (fakeTested.length > 0) {
      issues.push({
        kind: "results-schema", blocking: true,
        text: `results.json for ${fakeTested.join(", ")} claims "tested: passing" but the experiment's ` +
          `tests/ directory contains no test_*.py files — a test claim with no tests is fabricated ` +
          `provenance. Either author the tests (spawn tool_review) or remove the claim and disclose ` +
          `"untested — reviewer unavailable" in the ledger.`,
      });
    }
  }

  // 6. Tests present but no captured pytest run (warning only — the passive
  // capture in bash-hardened.ts only exists for runs after 2026-07-06, so
  // legacy projects legitimately have no artifacts). Promote to blocking
  // only after a corpus scan, per the overfull-verdict Phase-1/2 pattern.
  {
    let captures: Set<string> | null = null; // experiment ids with an exit-0 pytest run
    try {
      captures = new Set(
        readdirSync(join(projectDir, ".agent", "pytest"))
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            try {
              const j = JSON.parse(readFileSync(join(projectDir, ".agent", "pytest", f), "utf-8"));
              return j.exitCode === 0 ? String(j.experiment ?? "") : "";
            } catch { return ""; }
          })
          .filter(Boolean),
      );
    } catch { /* no capture dir — pre-capture project, stay silent */ }
    if (captures && captures.size > 0) {
      const untested = experiments.filter((e) => {
        let hasTests = false;
        try { hasTests = readdirSync(join(e.dir, "tests")).some((f) => /^test_.*\.py$/.test(f)); } catch {}
        return hasTests && !captures!.has(e.dir.split("/").pop()!);
      }).map((e) => e.id);
      if (untested.length > 0) {
        issues.push({
          kind: "results-schema", blocking: false,
          text: `${untested.join(", ")} have test files but no captured passing pytest run ` +
            `(.agent/pytest/). Tests that never ran verify nothing — run pytest in the ` +
            `experiment directory.`,
        });
      }
    }
  }

  return issues;
}

/**
 * md5 over the contradiction_auditor's actual read set: report.tex +
 * experiments.md + every results.json (lexicographically sorted relative
 * paths), matching the shell pipeline in contradiction_auditor.md's workflow
 * step 1 byte-for-byte. PDF-md5 keying was a category error — pdflatex embeds timestamps, so a
 * no-op recompile of unchanged sources produced a new PDF md5 and re-fired
 * the audit (gate-cost debate F3). The auditor audits VALUES in these source
 * files; keying on them means prose-preserving recompiles don't invalidate it.
 */
export function evidenceSourcesDigest(projectDir: string): string {
  const hash = createHash("md5");
  const feed = (p: string) => { try { hash.update(readFileSync(p)); } catch { /* missing — contributes nothing, like cat */ } };
  feed(join(projectDir, "report", "report.tex"));
  feed(join(projectDir, "notes", "experiments.md"));
  const root = join(projectDir, "data", "experiments");
  const resultPaths: string[] = [];
  if (existsSync(root)) {
    for (const exp of readdirSync(root)) {
      const runsDir = join(root, exp, "runs");
      if (!existsSync(runsDir)) continue;
      for (const run of readdirSync(runsDir)) {
        if (!/^run_\d+$/.test(run)) continue;
        const p = join(runsDir, run, "results.json");
        if (existsSync(p)) resultPaths.push(`data/experiments/${exp}/runs/${run}/results.json`);
      }
    }
  }
  resultPaths.sort();
  for (const rel of resultPaths) feed(join(projectDir, rel));
  return hash.digest("hex");
}

/** Render issues for tool output. */
export function formatIntegrityIssues(issues: IntegrityIssue[]): string {
  return issues
    .map((i) => `${i.blocking ? "✗ [blocks finish]" : "⚠"} (${i.kind}) ${i.text}`)
    .join("\n\n");
}
