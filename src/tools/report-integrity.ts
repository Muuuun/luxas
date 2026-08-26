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
import { extractFrontmatterBlock, parseAuditFrontmatter } from "../utils.js";
import { claimTableIssues } from "../claims-table.js";

export interface IntegrityIssue {
  kind: "number-provenance" | "experiment-citation" | "disclosure" | "results-schema" | "harness-vocab" | "outline" | "method-blocked" | "claim-status";
  blocking: boolean;
  text: string;
  /**
   * When true, the reviews/integrity_pushback.md mtime hatch does NOT waive
   * this issue. The hatch exists for parser false positives ("E_2 is a
   * physics symbol"); a deliberately-written structured entry
   * (cannot_comply / method_blocked) cannot be a parser false positive —
   * its only exits are the *_resolved disposition fields.
   */
  pushbackExempt?: boolean;
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
    .replace(/×/g, "\\times")
    // thousands separators: 10,500 → 10500 (comma between digit groups of 3)
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
}

export function extractNumbers(raw: string): number[] {
  const text = normalizeNotation(raw);
  const out: number[] = [];
  const push = (v: number) => { if (Number.isFinite(v)) out.push(v); };
  // A leading "-" is a sign only when not glued to a preceding word/number
  // (2026-08-25, live false-block: E5's transcript-anchored -0.151863 GHz
  // failed xval anchoring because every extraction came out positive).
  // "40-80", "R-6", and LaTeX dash runs ("---700 mW", "316--319 nm") keep
  // "-" as a dash; "= -0.151863" / "(-0.85" do not.
  const signAt = (src: string, matchStart: number, sign: string): number =>
    sign === "-" && !/[-0-9A-Za-z.]/.test(src[matchStart - 1] ?? "") ? -1 : 1;

  // a \times 10^{b} — with or without braces; also bare 10^{b}
  const sciRE = /(-?)(?:(\d+(?:\.\d+)?)\s*\\times\s*)?10\s*\^\s*\{?\s*(-?\d+)\s*\}?/g;
  let m: RegExpExecArray | null;
  while ((m = sciRE.exec(text))) {
    push(signAt(text, m.index, m[1]) * (m[2] ? parseFloat(m[2]) : 1) * Math.pow(10, parseInt(m[3], 10)));
  }
  // e-notation
  const eRE = /(-?)\b(\d+(?:\.\d+)?)[eE](-?\d+)\b/g;
  while ((m = eRE.exec(text))) {
    push(signAt(text, m.index, m[1]) * parseFloat(m[2]) * Math.pow(10, parseInt(m[3], 10)));
  }
  // plain decimals / integers, skipping ones already consumed by sci forms
  const stripped = text.replace(sciRE, " ").replace(eRE, " ");
  const plainRE = /(-?)(\d+(?:\.\d+)?)\s*(%|\\%)?/g;
  while ((m = plainRE.exec(stripped))) {
    const v = signAt(stripped, m.index, m[1]) * parseFloat(m[2]);
    push(v);
    if (m[3]) push(v / 100);
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
    // Percent ↔ fraction (2026-08-25, live false-block on the 297nm report):
    // "F = 99.963%" in the report vs "F(40 MHz) = 0.999627" in the ledger is
    // ONE number in two conventions. Accept a ×100 rescale, but only across
    // the fraction/percent boundary — one side in (0,1], the other in
    // (1,100] — so unrelated order-of-magnitude coincidences stay blocked.
    const [lo, hi] = Math.abs(v) < Math.abs(e) ? [v, e] : [e, v];
    if (Math.abs(lo) > 0 && Math.abs(lo) <= 1 && Math.abs(hi) > 1 && Math.abs(hi) <= 100) {
      if (Math.abs(hi - 100 * lo) <= 0.005 * Math.abs(hi)) return true;
    }
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
  // Headline surface = abstract + the conclusion section (both are where
  // rejected-branch numbers get promoted; SLM incident hit both).
  const cm = s.match(/\\section\*?\{[^}]*(?:结论|Conclusion|Summary|总结)[^}]*\}([\s\S]*?)(?=\\section|\\bibliography|\\end\{document\})/i);
  const abstract = (am ? am[1] : "") + "\n" + (cm ? cm[1] : "");
  return { abstract, body: s };
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

export interface ExperimentDir { id: string; dir: string; latestResults: string | null }

export function listExperimentDirs(projectDir: string): ExperimentDir[] {
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
  // Sorted by experiment number: consumers render into L3 blocks that must be
  // a pure function of disk state, not of readdir order.
  return out.sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10) || a.dir.localeCompare(b.dir));
}

export interface ExperimentRun { n: number; path: string; results: any }

/**
 * Every parsable results.json for an experiment, ascending by run index —
 * the per-run history the dynamics blocks (src/dynamics.ts) read. Unlike
 * listExperimentDirs this keeps ALL runs: stopping and lineage are properties
 * of the sequence, not of the latest artifact.
 */
export function listExperimentRuns(dir: string): ExperimentRun[] {
  const runsDir = join(dir, "runs");
  if (!existsSync(runsDir)) return [];
  const out: ExperimentRun[] = [];
  for (const run of readdirSync(runsDir)) {
    const rm = run.match(/^run_(\d+)$/);
    if (!rm) continue;
    const p = join(runsDir, run, "results.json");
    if (!existsSync(p)) continue;
    try { out.push({ n: parseInt(rm[1], 10), path: p, results: JSON.parse(readFileSync(p, "utf-8")) }); }
    catch { /* unparseable run is not history */ }
  }
  return out.sort((a, b) => a.n - b.n);
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

/**
 * ENDORSED evidence for headline claims (2026-07-12, debate-adjudicated after
 * the SLM incident): the abstract/conclusion may only carry numbers from the
 * ledger's endorsement surface (Headline findings / Verdict / 结论 sections of
 * notes/experiments.md) or from literature notes. Raw results.json leaves are
 * NOT headline provenance — E1 of the SLM run computed the incoherent-limit
 * thresholds (1.05e8 Hz) into computed.* as a conservative bound, the ledger's
 * verdict rejected that branch (endorsing 200 Hz / 10.5 kHz), and the report
 * headlined the rejected-but-computed number anyway. "Computed" is not
 * "endorsed"; the ledger — written by the fresh-context ledger_writer and
 * audited by reviewer + contradiction_auditor — is the endorsement layer.
 * Falls back to the full ledger when no endorsement sections parse (legacy
 * ledger formats must not dead-gate, per the E_N-header-regex lesson).
 */
function collectEndorsedNumbers(projectDir: string): number[] {
  const out: number[] = [];
  let ledger = "";
  try { ledger = readFileSync(join(projectDir, "notes", "experiments.md"), "utf-8"); } catch { /* absent */ }
  const sectRE = /^#{2,4}\s+.*(headline|verdict|结论|核心发现|adjudicat)[^\n]*\n([\s\S]*?)(?=^#{2,4}\s|(?![\s\S]))/gim;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = sectRE.exec(ledger))) {
    found = true;
    out.push(...extractNumbers(m[2]));
  }
  if (!found) out.push(...extractNumbers(ledger));
  try { out.push(...extractNumbers(readFileSync(join(projectDir, "notes", "literature.md"), "utf-8"))); } catch { /* absent */ }
  return out;
}

/**
 * One level of derived arithmetic over an evidence set: v resolves if it is
 * a·b, a/b, a+b, a−b, or a scaled by a common unit factor, for a,b endorsed.
 * Kills the "36 = 3×12 rounds" / ratio / percent / kHz-vs-Hz FP classes
 * without an open-ended search (single multiplication level, capped corpus).
 */
const UNIT_FACTORS = [1e3, 1e-3, 100, 0.01, 60];

function resolvesDerived(v: number, evidence: number[]): boolean {
  const ev = evidence.length > 400 ? evidence.slice(0, 400) : evidence;
  // TIGHT tolerance only (0.5% relative), and each op is shaped like its one
  // legitimate use case. Anything looser is porous over a few-hundred-value
  // corpus — verified live on the SLM incident: sig-1 products laundered
  // 1.045e8 via 10500×~1e4; wide unit factors via an unrelated 105.2×1e6;
  // unconstrained ratios via 10468/0.0001.
  //   product: one operand is a small integer count/multiplier (rounds ×
  //            per-round, 3×12) — require int in [2,100];
  //   ratio:   result is a relative factor or percent — require |v| ≤ 1000;
  //   unit factor: one hop only (kHz↔Hz, %, minutes).
  const tight = (x: number, e: number) =>
    x === e || Math.abs(x - e) <= 0.005 * Math.max(Math.abs(x), Math.abs(e));
  for (const f of UNIT_FACTORS) {
    if (ev.some((e) => tight(v, e * f))) return true;
  }
  const smallInts = [...new Set(ev.filter((e) => Number.isInteger(e) && e >= 2 && e <= 100))];
  for (const a of ev) {
    for (const k of smallInts) {
      if (tight(v, a * k)) return true;
    }
  }
  if (Math.abs(v) <= 1000) {
    for (let i = 0; i < ev.length; i++) {
      const a = ev[i];
      for (let j = i; j < ev.length; j++) {
        const b = ev[j];
        if (b !== 0 && tight(v, a / b)) return true;
        if (a !== 0 && tight(v, b / a)) return true;
      }
    }
  }
  // sums/differences deliberately excluded: over a few hundred evidence
  // values they resolve almost anything, silently disarming the gate.
  return false;
}

// ── the checks ──────────────────────────────────────────────────

const VERDICT_ENUM = new Set(["confirmed", "refuted", "inconclusive"]);

// ── claim grades (2026-07-14, quality-strategy debate) ──────────
//
// Evidence grades for headline claims, machine-computed from structured
// state. Ordering matters: a claim may always be RENDERED at a lower grade
// than computed, never higher ("a number cannot be rendered stronger than
// its recorded evidence grade" — the K-class fix). Semantics:
//   corroborated — an executed, transcript-anchored cross-validation by an
//                  independent method agrees within tolerance (5d verifies)
//   indicative   — single-method computation, no divergence flags
//   conditional  — depends on an unrun FollowUp (open_dependencies)
//   divergent    — the ledger sentence backing it carries a divergence /
//                  placeholder / needs-confirmation marker
//   disputed     — an executed cross-validation on this quantity DISAGREES and
//                  no third independent estimate or non-producer adjudication
//                  has settled it (claims-first design, 2026-08-26). The
//                  producer's cross_validation_resolved does NOT clear this.
const GRADE_ORDER: Record<string, number> = { corroborated: 4, indicative: 3, conditional: 2, disputed: 1, divergent: 0 };
// Hedge tokens required in the tex_context of below-indicative claims —
// normalized-substring match, deliberately generous (the goal is that SOME
// hedge reaches the reader in the same sentence, not prose policing).
const HEDGE_TOKENS: Record<string, string[]> = {
  conditional: ["若", "假设", "待", "尚未", "conditional", "pending", "assuming", "provided", "取决"],
  divergent: ["发散", "需完整", "需确认", "上界", "上限", "bound", "divergent", "unverified", "不可靠", "伪影", "待验证", "perturbative regime", "微扰"],
  disputed: ["disputed", "disagree", "discrepan", "unresolved", "differ by", "under dispute", "两种方法", "不一致", "存疑", "两方法"],
};
const DIVERGENCE_MARKERS = /发散|placeholder|占位|pending|待验证|需完整对角化|需确认|不可靠|divergent|unreliable|extrapolat|外推|inaccurate for/i;

/** Harness verdict on one cross_validation entry: agents report numbers,
 * the harness pronounces. Returns "corroborated" | "discrepant" |
 * "identical" | null (malformed).
 *
 * "identical": value_a and value_b agree to the last bit. Two genuinely
 * independent methods — a different formalism, an analytic limit, a second
 * library — do not reproduce a float to full precision; a bit-identical pair
 * is the same computation run twice, or one number copied into both slots.
 * Production audit (2026-08-23, 77 entries since July): 23 of the 40
 * "agreeing" entries were bit-identical, e.g. -74.96294599504007 on both
 * sides at tolerance 1e-10. That is the self-circular failure the
 * tool_impl/tool_review split exists to prevent, one layer up — and the
 * string check on method_a != method_b cannot see it ("vqe" vs "vqe_rerun"
 * passes). The only exception is an exact integer count that two methods
 * legitimately both land on (a gate count, a code distance); those are
 * admitted when both values are integers with magnitude below
 * XVAL_EXACT_INT_LIMIT. */
const XVAL_EXACT_INT_LIMIT = 1e6;
export function xvalVerdict(x: any): "corroborated" | "discrepant" | "identical" | null {
  const a = Number(x?.value_a), b = Number(x?.value_b);
  const tol = Number(x?.tolerance_rel);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(tol) || tol <= 0 || tol > 0.5) return null;
  // Wiring veto (claims-first design §3.3, 2026-08-26): two independent
  // methods do not reproduce a float to 1e-6 relative — that is the same
  // computation recorded twice (E6's channel-sum "cross-validated" against
  // the pipeline it re-summed agreed to 1e-9 and was graded corroborated).
  if (a === b || Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b))) {
    const smallInt = Number.isInteger(a) && Number.isInteger(b) && Math.abs(a) < XVAL_EXACT_INT_LIMIT;
    if (!smallInt) return "identical";
  }
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)) ? "corroborated" : "discrepant";
}

export function reportIntegrityIssues(projectDir: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  // Shared harness-transcript corpus: .agent/jobs/*/output.log tails,
  // whitespace-normalized. Agent-unwritable ground truth — the execution
  // anchor for verbatim errors (5c) and cross-validation values (5d).
  const normText = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  let _jobsCorpus: string | null = null;
  const jobsCorpus = (): string => {
    if (_jobsCorpus !== null) return _jobsCorpus;
    const chunks: string[] = [];
    try {
      const jobsDir = join(projectDir, ".agent", "jobs");
      for (const id of readdirSync(jobsDir)) {
        try {
          const p2 = join(jobsDir, id, "output.log");
          const sz = statSync(p2).size;
          const raw = readFileSync(p2, "utf-8");
          chunks.push(sz > 262_144 ? raw.slice(-262_144) : raw);
        } catch { /* job without log */ }
      }
    } catch { /* no jobs dir — legacy project */ }
    _jobsCorpus = normText(chunks.join("\n"));
    return _jobsCorpus;
  };
  // Numeric view of the transcripts, for value anchoring (a needle-in-text
  // substring match breaks on formatting; number extraction + tight relative
  // tolerance does not).
  let _jobsNumbers: number[] | null = null;
  const jobsNumbers = (): number[] => {
    if (_jobsNumbers !== null) return _jobsNumbers;
    _jobsNumbers = extractNumbers(jobsCorpus());
    return _jobsNumbers;
  };
  const valueAnchored = (v: number): boolean => {
    if (jobsCorpus() === "") return true; // legacy project without job logs
    return jobsNumbers().some((e) => v === e ||
      Math.abs(v - e) <= 0.001 * Math.max(Math.abs(v), Math.abs(e)));
  };
  let tex = "";
  try { tex = readFileSync(join(projectDir, "report", "report.tex"), "utf-8"); } catch { return issues; }
  const { abstract, body } = texClaimText(tex);
  const experiments = listExperimentDirs(projectDir);
  const ledger = (() => {
    try { return readFileSync(join(projectDir, "notes", "experiments.md"), "utf-8"); } catch { return ""; }
  })();

  // 1. Number provenance. Headline surface (abstract + conclusion) blocks
  //    against the ENDORSED corpus (ledger headline/verdict sections +
  //    literature) — "computed" is not "endorsed" (SLM incident 2026-07-12:
  //    a ledger-rejected branch lived in computed.* and got headlined).
  //    Body warns against the full corpus, unchanged.
  const evidence = collectEvidenceNumbers(projectDir, experiments);
  if (evidence.length > 0) {
    const fmt = (v: number) => (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6 ? String(v) : v.toExponential(3));
    const endorsed = collectEndorsedNumbers(projectDir);
    const headlineNums = [...new Set(extractNumbers(abstract))].filter((v) => !exempt(v));
    const unresolvedAbstract = headlineNums
      .filter((v) => !resolves(v, endorsed) && !resolvesDerived(v, endorsed));
    if (unresolvedAbstract.length > 0) {
      const computedOnly = unresolvedAbstract.filter((v) => resolves(v, evidence));
      const nowhere = unresolvedAbstract.filter((v) => !resolves(v, evidence));
      const parts: string[] = [];
      if (computedOnly.length > 0) {
        parts.push(
          `${computedOnly.slice(0, 6).map(fmt).join(", ")} exist(s) in the raw evidence store but ` +
          `NOT in the ledger's endorsement surface (Headline findings / Verdict sections of ` +
          `notes/experiments.md) or literature notes. A computed value is not an endorsed value — ` +
          `intermediate/rejected branches also live in results.json. If the ledger's verdict ` +
          `endorses this number, add it to the experiment's Headline findings; if the verdict ` +
          `rejected the branch it came from, replace it in the report with the endorsed number.`);
      }
      if (nowhere.length > 0) {
        parts.push(
          `${nowhere.slice(0, 6).map(fmt).join(", ")} appear(s) NOWHERE in the evidence store — ` +
          `a from-memory or extrapolated figure. Compute it (record in results.json + ledger ` +
          `headline), quote it (notes/literature.md with source), or remove it.`);
      }
      issues.push({
        kind: "number-provenance", blocking: true,
        text: `Headline surface (abstract/conclusion) contains number(s) without endorsed provenance:\n  - ` +
          parts.join("\n  - "),
      });
    }
    // 1b. claims.json dereference (2026-07-12). When the report_writer's
    //     provenance manifest exists, each entry's source_quote must appear
    //     verbatim in the named file and contain the claimed value. A valid
    //     pointer to a non-existent quote is fabricated provenance. The
    //     manifest is optional (brain-authored legacy reports have none) —
    //     absence is not an issue; presence is a contract.
    try {
      const claimsRaw = readFileSync(join(projectDir, "report", "claims.json"), "utf-8");
      const claims = JSON.parse(claimsRaw);
      const bad: string[] = [];
      if (Array.isArray(claims)) {
        for (const c of claims) {
          const v = typeof c?.value === "number" ? c.value : NaN;
          const file = String(c?.source_file ?? "");
          const quote = String(c?.source_quote ?? "");
          if (!Number.isFinite(v) || !quote || !/^notes\/(experiments|literature)\.md$/.test(file)) {
            bad.push(`malformed entry: ${JSON.stringify(c).slice(0, 100)}`);
            continue;
          }
          let src = "";
          try { src = readFileSync(join(projectDir, file), "utf-8"); } catch { /* missing file */ }
          if (!src.includes(quote)) {
            bad.push(`${fmt(v)}: quote not found verbatim in ${file}: "${quote.slice(0, 80)}"`);
          } else if (!resolves(v, extractNumbers(quote))) {
            bad.push(`${fmt(v)}: quote exists in ${file} but does not contain the value: "${quote.slice(0, 80)}"`);
          }
        }
      }
      if (bad.length > 0) {
        issues.push({
          kind: "number-provenance", blocking: true,
          text: `report/claims.json has ${bad.length} entr${bad.length === 1 ? "y" : "ies"} that fail dereference:\n  - ` +
            bad.slice(0, 8).join("\n  - ") +
            `\nEach claims.json entry must quote, verbatim, the ledger/literature sentence containing its value.`,
        });
      }
    } catch { /* no manifest — legacy report, corpus checks above still apply */ }

    // 1c. Claim-grade render legality (2026-07-14, quality-strategy debate).
    //     claims.json entries may carry {grade, claim_key, open_dependencies}.
    //     The harness RECOMPUTES the maximum defensible grade from structured
    //     state; a recorded grade above the recomputed cap blocks ("a number
    //     cannot be rendered stronger than its recorded evidence grade").
    //     Below-indicative grades must carry a hedge token in tex_context —
    //     the hedge reaches the reader in the same sentence, mechanically.
    //     Entries without a grade field are v1-schema (legacy) — 1b only.
    try {
      const claims = JSON.parse(readFileSync(join(projectDir, "report", "claims.json"), "utf-8"));
      const gradeBad: string[] = [];
      // collect all cross_validation entries (latest run per experiment)
      const xvals: any[] = [];
      for (const e of experiments) {
        if (!e.latestResults) continue;
        try {
          const j = JSON.parse(readFileSync(e.latestResults, "utf-8"));
          if (Array.isArray(j?.computed?.cross_validation)) xvals.push(...j.computed.cross_validation);
        } catch { /* malformed elsewhere */ }
      }
      if (Array.isArray(claims)) {
        for (const c of claims) {
          const grade = c?.grade === undefined ? null : String(c.grade);
          if (grade === null) continue;
          const label = `"${String(c?.tex_context ?? c?.value ?? "?").slice(0, 60)}"`;
          if (!(grade in GRADE_ORDER)) {
            gradeBad.push(`${label}: unknown grade "${grade}" (allowed: ${Object.keys(GRADE_ORDER).join("/")})`);
            continue;
          }
          // recompute the cap
          let cap = GRADE_ORDER.indicative;
          const key = String(c?.claim_key ?? "");
          if (key) {
            const x = xvals.find((x2) => String(x2?.claim_key ?? "") === key);
            if (x && xvalVerdict(x) === "corroborated"
                && valueAnchored(Number(x.value_a)) && valueAnchored(Number(x.value_b))
                && normText(String(x?.method_a ?? "")) !== normText(String(x?.method_b ?? ""))) {
              cap = GRADE_ORDER.corroborated;
            }
          }
          if (Array.isArray(c?.open_dependencies) && c.open_dependencies.length > 0) {
            cap = Math.min(cap, GRADE_ORDER.conditional);
          }
          // Disputed cap (claims-first §3.4): a DISCREPANT cross-validation on
          // this key — or on a value this entry carries (re-keyed copies of a
          // disputed number are how the 297nm abstract cited E5's 2.555e-4
          // under E6's key) — caps the grade at `disputed`.
          {
            const cv = Number(c?.value);
            const windows = key ? [cv] : [cv, cv / 100, cv * 100];
            const near = (x: number) => Number.isFinite(cv) && Number.isFinite(x) && x !== 0 && !exempt(cv) &&
              windows.some((v) => Math.abs(v - x) <= 5e-3 * Math.abs(x));
            const hit = xvals.find((x2) => xvalVerdict(x2) === "discrepant" &&
              ((key && String(x2?.claim_key ?? "") === key) || near(Number(x2?.value_a)) || near(Number(x2?.value_b))));
            if (hit) cap = Math.min(cap, GRADE_ORDER.disputed);
          }
          if (DIVERGENCE_MARKERS.test(String(c?.source_quote ?? ""))) {
            cap = Math.min(cap, GRADE_ORDER.divergent);
          }
          if (GRADE_ORDER[grade] > cap) {
            const capName = Object.keys(GRADE_ORDER).find((k) => GRADE_ORDER[k] === cap);
            gradeBad.push(`${label}: recorded grade "${grade}" exceeds the recomputed cap "${capName}" ` +
              `(corroborated needs an anchored, agreeing cross_validation entry for claim_key; ` +
              `open_dependencies caps at conditional; a DISCREPANT cross-validation on this key or value caps at disputed; ` +
              `a divergence-marked source_quote caps at divergent)`);
          }
          const hedges = HEDGE_TOKENS[grade];
          if (hedges) {
            const ctx = normText(String(c?.tex_context ?? ""));
            if (!hedges.some((h) => ctx.includes(normText(h)))) {
              gradeBad.push(`${label}: grade "${grade}" requires a hedge in the claim's own sentence ` +
                `(tex_context) — e.g. ${hedges.slice(0, 4).join(" / ")} — none found`);
            }
          }
        }
      }
      if (gradeBad.length > 0) {
        issues.push({
          kind: "number-provenance", blocking: true, pushbackExempt: true,
          text: `Claim-grade legality failures in report/claims.json:\n  - ` + gradeBad.slice(0, 8).join("\n  - ") +
            `\nEither strengthen the evidence (run the cross-validation / the blocking FollowUp) or ` +
            `demote the claim's grade AND hedge its sentence accordingly.`,
        });
      }
    } catch { /* no manifest — legacy */ }

    // 1d. Manifest presence (2026-07-14, found live: the Yb/Rb REVISION run
    //     hand-edited an existing report.tex, never spawned report_writer, so
    //     claims.json never existed and the entire claim-grade defence (1c)
    //     was inert — "presence is a contract" meant the revision path opted
    //     out by construction). A headline that carries numbers must carry
    //     the manifest that grades them. Pushback-exempt: an absent artifact
    //     cannot be a parser false positive.
    {
      const headlineNums2 = [...new Set(extractNumbers(abstract))].filter((v) => !exempt(v));
      const manifestExists = existsSync(join(projectDir, "report", "claims.json"));
      if (headlineNums2.length > 0 && !manifestExists) {
        issues.push({
          kind: "number-provenance", blocking: true, pushbackExempt: true,
          text: `report/claims.json is missing, but the abstract/conclusion carries ` +
            `${headlineNums2.length} quantitative claim(s). Every headline number must be graded: ` +
            `write the manifest (one entry per number: {value, tex_context, source_file, source_quote, ` +
            `grade, claim_key?, open_dependencies?}), or spawn report_writer to author the prose and ` +
            `the manifest together. The harness recomputes each grade cap from structured state — ` +
            `a divergence-flagged or FollowUp-dependent number cannot be rendered unhedged.`,
        });
      }
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

  // 5b. Cannot-comply blockers (blocking — 2026-07-09 debate verdict on the
  // counterfeit-instruments class). computed.cannot_comply is the structured
  // third option between "satisfy the requirement" and "fake it" (observed:
  // identically-zero detectors + a self-cancelling observable shipped because
  // the builder had no other exit). This check is the channel's consumer edge:
  // an unresolved blocker must reach the brain's finish path, or the channel
  // is one more write-only artifact.
  {
    // Entry-evaporation fix (2026-07-13): scan ALL runs, not just the latest —
    // an experiment_reviewer revise loop legitimately produces run_N+1 whose
    // results.json may not carry the blocker forward. An entry is live unless
    // the LATEST run's *_resolved list disposes it (matched on requirement).
    const collectAllRuns = (e: ExperimentDir, key: string): any[] => {
      const out: any[] = [];
      const runsDir = join(e.dir, "runs");
      try {
        for (const run of readdirSync(runsDir)) {
          if (!/^run_\d+$/.test(run)) continue;
          try {
            const j = JSON.parse(readFileSync(join(runsDir, run, "results.json"), "utf-8"));
            const v = j?.computed?.[key];
            if (Array.isArray(v)) out.push(...v);
          } catch { /* unparseable run */ }
        }
      } catch { /* no runs dir */ }
      return out;
    };
    const latestResolved = (e: ExperimentDir, key: string): any[] => {
      if (!e.latestResults) return [];
      try {
        const j = JSON.parse(readFileSync(e.latestResults, "utf-8"));
        return Array.isArray(j?.computed?.[key]) ? j.computed[key] : [];
      } catch { return []; }
    };

    const blocked: string[] = [];
    for (const e of experiments) {
      const cc = collectAllRuns(e, "cannot_comply");
      const resolved = new Set(latestResolved(e, "cannot_comply_resolved").map((r: any) => String(r?.requirement ?? "")));
      const live = cc.filter((c: any) => !resolved.has(String(c?.requirement ?? "")));
      if (live.length > 0) {
        blocked.push(`${e.id}: ${live.map((c: any) => String(c?.requirement ?? "?").slice(0, 80)).join("; ")}`);
      }
    }
    if (blocked.length > 0) {
      issues.push({
        kind: "results-schema", blocking: true, pushbackExempt: true,
        text: `Unresolved cannot-comply blocker(s):\n  ${blocked.join("\n  ")}\n` +
          `A sub-agent reported a requirement satisfiable only by a degenerate artifact. ` +
          `Resolve it: fix the requirement (re-spawn the experiment with a corrected description), ` +
          `descope the experiment honestly, or — if genuinely acceptable — move the entry to ` +
          `computed.cannot_comply_resolved with a "resolution" field explaining the disposition. ` +
          `Do not ship a report over an open counterfeit-pressure point.`,
      });
    }

    // 5c. Method-blocked escalations (blocking — 2026-07-13 debate verdict on
    // the choose-easy-over-appropriate class). computed.method_blocked records
    // a field-standard tool abandoned for engineering friction, with the
    // failing command and the VERBATIM last error. Two teeth beyond 5b's
    // pattern: (a) the verbatim text is grounded against the harness's own
    // per-command transcripts (.agent/jobs/*/output.log — agent-unwritable),
    // so a paraphrase like "requires manual database download" cannot anchor;
    // (b) disposition is brain's, via computed.method_blocked_resolved with a
    // "resolution" field — the deadline-pressured producer does not
    // self-approve a method-class downgrade.
    {
      const open: string[] = [];
      const unanchored: string[] = [];
      for (const e of experiments) {
        const mb = collectAllRuns(e, "method_blocked");
        if (mb.length === 0) continue;
        const resolved = new Set(latestResolved(e, "method_blocked_resolved").map((r: any) => String(r?.intended_tool ?? "")));
        for (const m of mb) {
          const tool = String(m?.intended_tool ?? "?");
          if (resolved.has(tool)) continue;
          const err = String(m?.verbatim_last_error ?? "");
          const cmd = String(m?.failing_command ?? "");
          const label = `${e.id}: ${tool} → fallback "${String(m?.fallback_used ?? "?").slice(0, 60)}"`;
          // transcript grounding: only when job logs exist (legacy projects
          // have none — don't dead-gate them on an unverifiable requirement)
          const corpus = jobsCorpus();
          if (corpus && err && !corpus.includes(normText(err))) {
            unanchored.push(`${label} — verbatim_last_error not found in any .agent/jobs transcript; ` +
              `it must be copy-paste from the failing command's output, not a paraphrase ` +
              `(recorded: "${err.slice(0, 100)}")`);
          } else {
            open.push(`${label}${cmd ? ` (failing command: ${cmd.slice(0, 80)})` : ""}`);
          }
        }
      }
      if (open.length > 0 || unanchored.length > 0) {
        const parts: string[] = [];
        if (open.length > 0) {
          parts.push(`Undisposed method-blocked escalation(s):\n  ${open.join("\n  ")}\n` +
            `A field-standard method was abandoned for engineering friction and a weaker method used. ` +
            `Brain must disposition each: re-run the failing_command yourself (fresh eyes on the raw ` +
            `error — check skills/compute-methods/ for a known fix), then either fix-and-respawn, or ` +
            `accept the fallback by writing computed.method_blocked_resolved: ` +
            `[{"intended_tool": ..., "resolution": "<what you ran / why the fallback stands>"}] in the ` +
            `latest results.json AND disclosing the method substitution in the report's limitations.`);
        }
        if (unanchored.length > 0) {
          parts.push(`Unanchored method-blocked entr${unanchored.length === 1 ? "y" : "ies"}:\n  ${unanchored.join("\n  ")}`);
        }
        issues.push({ kind: "method-blocked", blocking: true, pushbackExempt: true, text: parts.join("\n\n") });
      }
    }

    // 5d. Cross-validation integrity (2026-07-14, quality-strategy debate —
    // the C-class fix). computed.cross_validation entries record an executed
    // independent-method recomputation of a headline quantity. Teeth:
    //   (a) the VERDICT is harness-computed from {value_a, value_b,
    //       tolerance_rel} — agents report numbers, code pronounces
    //       corroborated/discrepant (survey evidence: LLM-reviewer-as-gate
    //       is a rubber stamp; execution-based checks are the only verified
    //       mechanism);
    //   (b) values must be transcript-anchored in .agent/jobs/*/output.log
    //       (a narrated number that never appeared in any executed command's
    //       output cannot anchor — same pattern as method_blocked);
    //   (c) a DISCREPANT entry blocks finish (pushback-exempt) until
    //       computed.cross_validation_resolved disposes it — a disagreement
    //       between two methods is a finding, not a formatting issue.
    {
      const problems: string[] = [];
      const disputes: string[] = [];
      for (const e of experiments) {
        if (!e.latestResults) continue;
        let j: any;
        try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); } catch { continue; }
        const xv = j?.computed?.cross_validation;
        if (!Array.isArray(xv) || xv.length === 0) continue;
        for (const x of xv) {
          const key = String(x?.claim_key ?? "?");
          const verdict = xvalVerdict(x);
          if (verdict === null) {
            problems.push(`${e.id}/${key}: malformed entry (needs numeric value_a, value_b, tolerance_rel in (0, 0.5])`);
            continue;
          }
          if (verdict === "identical") {
            problems.push(`${e.id}/${key}: value_a and value_b are bit-identical (${x.value_a}) — two independent ` +
              `methods do not reproduce a float to full precision. This is the same computation recorded twice, ` +
              `not a cross-validation. Run a genuinely different method (analytic limit, second formalism, ` +
              `second library, literature value) and record ITS number; the dependent claim stays indicative until then.`);
            continue;
          }
          {
            const missing = [Number(x.value_a), Number(x.value_b)].filter((v) => !valueAnchored(v));
            if (missing.length > 0) {
              problems.push(`${e.id}/${key}: value(s) ${missing.map((v) => String(v)).join(", ")} not found in any ` +
                `.agent/jobs transcript — a cross-validation value must come from an executed command's output, ` +
                `not narration. Re-run the computation through bash so the harness sees it.`);
              continue;
            }
          }
          if (verdict === "discrepant") {
            disputes.push(`${e.id}/${key}: ${x.value_a} (${String(x?.method_a ?? "?").slice(0, 40)}) vs ` +
              `${x.value_b} (${String(x?.method_b ?? "?").slice(0, 40)})`);
          }
        }
      }
      // Disputes are facts, not formatting issues (claims-first design §3.6,
      // 2026-08-26): the producer's cross_validation_resolved no longer clears
      // them — the 297nm run "resolved" a 4.3× disagreement by declaring its own
      // script authoritative. A dispute is disclosed here (non-blocking) and
      // enforced where it matters: any claims.json entry carrying the disputed
      // key or value is capped at grade `disputed` (1c) and must hedge.
      if (disputes.length > 0) {
        issues.push({
          kind: "disclosure", blocking: false,
          text: `Cross-method DISPUTES on record (${disputes.length}):\n  - ` + disputes.slice(0, 8).join("\n  - ") +
            `\nA disputed number may headline only at grade "disputed" with a hedge in its sentence, or leave ` +
            `the abstract. cross_validation_resolved does not settle a dispute; only a third independent ` +
            `estimate or a non-producer adjudication with a locator does.`,
        });
      }
      if (problems.length > 0) {
        issues.push({
          kind: "method-blocked", blocking: true, pushbackExempt: true,
          text: `Cross-validation integrity failure(s):\n  - ` + problems.slice(0, 8).join("\n  - "),
        });
      }
    }

    // 5e. Cross-validation PLAN closure (2026-07-14, found live). The Evidence
    // Contract freezes a control method per headline quantity at Phase 1
    // (computed.cross_validation_plan). At finish each planned claim_key must
    // have EITHER an executed cross_validation entry OR an anchored
    // method_blocked entry proving the control could not run. Observed failure
    // this gate closes: an experiment declared the prescribed control
    // ("full pair diagonalization") infeasible — "memory-limited" — in PROSE,
    // wrote a phantom `computed.method_blocked[0]` reference into its ledger
    // while the key was absent from results.json, and the reviewer waved it
    // through. The control in fact ran on the same machine in ~10 minutes.
    // "I could not run the control" is a data claim: it needs the verbatim
    // error, like every other capability claim.
    {
      const unclosed: string[] = [];
      for (const e of experiments) {
        if (!e.latestResults) continue;
        let j: any;
        try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); } catch { continue; }
        const plan = j?.computed?.cross_validation_plan;
        if (!Array.isArray(plan) || plan.length === 0) continue;
        const xvKeys = new Set((Array.isArray(j?.computed?.cross_validation) ? j.computed.cross_validation : [])
          .map((x: any) => String(x?.claim_key ?? "")));
        const mbTools = (Array.isArray(j?.computed?.method_blocked) ? j.computed.method_blocked : []);
        for (const p of plan) {
          const key = String(p?.claim_key ?? "?");
          if (xvKeys.has(key)) continue;
          const blocked = mbTools.some((m: any) =>
            String(m?.intended_tool ?? "").length > 0 &&
            String(m?.verbatim_last_error ?? "").length > 0 &&
            (String(m?.claim_key ?? "") === key || String(m?.intended_tool ?? "").includes(String(p?.control_method ?? "\u0000"))));
          if (!blocked) {
            unclosed.push(`${e.id}/${key}: planned control "${String(p?.control_method ?? "?").slice(0, 60)}" ` +
              `neither executed (no cross_validation entry) nor anchored-blocked (no method_blocked entry with a ` +
              `verbatim_last_error). Run the control, or record the attempt's exact command and its verbatim error.`);
          }
        }
      }
      if (unclosed.length > 0) {
        issues.push({
          kind: "method-blocked", blocking: true, pushbackExempt: true,
          text: `Unclosed cross-validation plan(s):\n  - ` + unclosed.slice(0, 6).join("\n  - "),
        });
      }
    }

    // 5f. Headline cross-validation coverage (2026-08-23, production audit).
    // Cross-validation coverage is defined by what the REPORT claims, not by
    // what the experiment found convenient to check. The audit of 77 executed
    // entries since July found the grade pipeline leaking at the join: claims
    // cite one key namespace (computed.gap_matrix_summary.*), the experiment
    // validated another (computed.gidney_vs_claes_d3_ratio), and the exact-
    // string lookup in 1c dropped the credit — 0 of 18 claims matched in
    // magic-state-cultivation, 0 of 11 in 量子计算在组合优化, with 19 and 12
    // executed entries respectively. Net: 40 agreeing controls became 1
    // corroborated claim.
    //
    // Two teeth, deliberately different:
    //   (a) BLOCKS on provable misattribution: a headline claim whose VALUE
    //       appears as value_a/value_b of an agreeing cross_validation entry
    //       recorded under a DIFFERENT claim_key. The work was done; only the
    //       key is wrong. Fixing the key is a one-line edit and the claim
    //       then grades corroborated — refusing to ship until that happens
    //       costs nothing and recovers the evidence.
    //   (b) REPORTS (non-blocking) headline claims with no control at all.
    //       Those are already correctly capped at indicative by 1c; blocking
    //       on "you did not validate this" would recreate the finish-gate
    //       livelock the observation corpus is full of. The coverage line
    //       makes the ratio visible at finish time instead of in a post-hoc
    //       audit, which is the whole point.
    {
      let claims: any[] = [];
      try {
        const cj = JSON.parse(readFileSync(join(projectDir, "report", "claims.json"), "utf-8"));
        claims = Array.isArray(cj) ? cj : [];
      } catch { claims = []; }
      if (claims.length > 0) {
        const headlineNums = [...new Set(extractNumbers(abstract))].filter((v) => !exempt(v));
        // Every agreeing entry, with its experiment id for the message.
        const agreeing: { key: string; exp: string; a: number; b: number }[] = [];
        for (const e of experiments) {
          if (!e.latestResults) continue;
          let j: any;
          try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); } catch { continue; }
          for (const x of (Array.isArray(j?.computed?.cross_validation) ? j.computed.cross_validation : [])) {
            if (xvalVerdict(x) !== "corroborated") continue;
            if (normText(String(x?.method_a ?? "")) === normText(String(x?.method_b ?? ""))) continue;
            agreeing.push({ key: String(x?.claim_key ?? ""), exp: e.id, a: Number(x.value_a), b: Number(x.value_b) });
          }
        }
        const agreeingKeys = new Set(agreeing.map((x) => x.key));
        const headline = claims.filter((c) => {
          const v = Number(c?.value);
          return Number.isFinite(v) && !exempt(v) && resolves(v, headlineNums);
        });
        const misattributed: string[] = [];
        let covered = 0;
        for (const c of headline) {
          const key = String(c?.claim_key ?? "");
          if (key && agreeingKeys.has(key)) { covered++; continue; }
          const v = Number(c.value);
          // Strict match only — NOT resolves(), whose one-significant-figure
          // branch is right for provenance but wrong for identity: it paired
          // an energy-mismatch ratio of 42.5 with a Gamow factor of 40.16
          // (both "4e1") on a production report. Two quantities that merely
          // share a leading digit are not the same number.
          const close = (x: number) => v === x || Math.abs(v - x) <= 0.005 * Math.max(Math.abs(v), Math.abs(x));
          const hit = agreeing.find((x) => close(x.a) || close(x.b));
          if (hit) {
            misattributed.push(`"${String(c?.tex_context ?? c.value).slice(0, 50)}" (value ${c.value}, claim_key ` +
              `"${key || "(none)"}") matches ${hit.exp}'s agreeing cross_validation recorded under claim_key ` +
              `"${hit.key}" — same number, different key, credit lost. Set this claim's claim_key to "${hit.key}" ` +
              `(or the cross_validation entry's to "${key}") so 1c can grade it corroborated.`);
          }
        }
        if (misattributed.length > 0) {
          issues.push({
            kind: "number-provenance", blocking: true, pushbackExempt: true,
            text: `Headline claim(s) with an executed, agreeing cross-validation filed under the wrong claim_key:\n  - ` +
              misattributed.slice(0, 6).join("\n  - "),
          });
        }
        if (headline.length > 0) {
          const uncovered = headline.length - covered - misattributed.length;
          issues.push({
            kind: "number-provenance", blocking: false,
            text: `Headline cross-validation coverage: ${covered}/${headline.length} abstract/conclusion claims ` +
              `have an agreeing independent control (${uncovered} ship at indicative or below). ` +
              `Each uncovered headline number is a referee's first question; a control for it is worth more ` +
              `than another experiment.`,
          });
        }
      }
    }
  }

  // 5g. Prior-art positioning of contribution claims (2026-08-23, novelty
  // debate). A number gets provenance (1a) and a grade (1c); a CONTRIBUTION
  // claim — "we show", "first", "novel", 首次, 我们证明 — got nothing: brain
  // decided the question was open at framing time, against its own notes,
  // and no later step asked the referee's first question ("hasn't this been
  // done?"). That is the self-circular shape this system separates everywhere
  // else. prior_art_auditor is the independent author: fresh context, tasked
  // to refute, emits closest-prior results WITH LOCATORS and a delta class —
  // never a novelty score, because LLM novelty scores do not track expert
  // judgment (arXiv:2608.05179) while a locator is checkable.
  //
  // Teeth, deliberately asymmetric (the corpus is 67% finish-gate livelock):
  //   BLOCKS on missing structure only — a contribution sentence in the
  //     headline surface with no audit, a stale audit, an audit whose cited
  //     prior is not in references.bib (an uncitable prior is not prior art).
  //   The VERDICT never blocks by itself. A `known` delta DEMOTES the sentence
  //     — first/novel must go and the closest prior must be cited inline. The
  //     only verdict-adjacent block is the same one numbers have: a sentence
  //     still wearing "first"/"novel" after the audit marked it `known` is an
  //     unhedged claim at a demoted grade (cf. gradeBad for `divergent`), and
  //     its fix is one named edit, not more research. Honest wording is the
  //     outcome; a wall is not.
  {
    // Matches the vocabulary prior_art_auditor.md <scope> names, PLUS the
    // positioned forms a reworded claim takes ("we compute", "we quantify",
    // "here we present"). Found live 2026-08-23: after the auditor's
    // rewording removed "we find that"/"artefact refuted" from
    // single_photon_Rydberg, the abstract's five contribution claims fell
    // out of the old pattern and the gate went silent on a stale audit.
    // A positioned claim is still a claim; the gate must keep seeing it.
    const CONTRIB_RE = /\b(?:(?:here )?we (?:show|establish|demonstrate|prove|find|compute|quantify|derive|obtain|present|report|introduce|resolve|identify)\b|for the first time|first (?:demonstration|derivation|computation|report|measurement)|novel|new (?:result|method|regime|bound|protocol|scheme)\b|this (?:work|report|paper) (?:demonstrates|establishes|shows|presents|computes|finds))|首次|我们(?:证明|提出|发现|首次|计算|给出)|本文(?:提出|证明|首次|给出|计算)/i;
    const sentences = abstract
      .replace(/%[^\n]*/g, " ")
      .split(/(?<=[.!?。！？])\s+/)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x.length > 20 && CONTRIB_RE.test(x));
    if (sentences.length > 0) {
      const auditPath = join(projectDir, "reviews", "prior_art.md");
      const auditSrc = existsSync(auditPath) ? readFileSync(auditPath, "utf-8") : null;
      const blockers: string[] = [];
      const demotions: string[] = [];
      if (auditSrc === null) {
        blockers.push(`${sentences.length} contribution sentence(s) in the abstract/conclusion and no reviews/prior_art.md. ` +
          `Spawn the auditor:\n    spawn_agent(agent="prior_art_auditor", task="Position every contribution claim in ` +
          `report/report.tex against the closest prior results (locators required). Write reviews/prior_art.md.", background=false)\n` +
          `  First sentence: "${sentences[0].slice(0, 110)}"`);
      } else {
        const fm = extractFrontmatterBlock(auditSrc);
        const afm = fm ? parseAuditFrontmatter(fm) : ({} as Record<string, string | undefined>);
        if (!fm || !afm.status || !afm.sources_md5) {
          blockers.push(`reviews/prior_art.md is missing YAML frontmatter keys (status, sources_md5). Re-spawn prior_art_auditor.`);
        } else if (afm.status !== "positioned") {
          blockers.push(`reviews/prior_art.md status is "${afm.status}" — the audit did not complete. Re-spawn prior_art_auditor.`);
        } else {
          const now = priorArtSourcesDigest(projectDir);
          if (now !== afm.sources_md5) {
            blockers.push(`reviews/prior_art.md audited different sources (recorded ${afm.sources_md5.slice(0, 12)}…, current ` +
              `${now.slice(0, 12)}…) — report.tex or references.bib changed since. Re-spawn prior_art_auditor.`);
          } else {
            // Every cited prior must resolve to a bib key: an uncitable prior
            // is not prior art, and a `known` verdict the report cannot cite
            // cannot be applied.
            let bib = "";
            try { bib = readFileSync(join(projectDir, "report", "references.bib"), "utf-8"); } catch { /* absent */ }
            // The auditor writes priors as prose — "Walker & Saffman, PRA 77,
            // 032723 (2008) — Table I" — never as bib keys (found live
            // 2026-08-23: the first-token parse read "Scholl" and failed the
            // join against Scholl2022). Resolve a prior line to a bib entry by
            // first-author surname + year, which both forms carry.
            const bibIndex: { key: string; surname: string; year: string }[] = [];
            for (const m of bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|$)/g)) {
              const key = m[1]; const body = m[2];
              const au = body.match(/author\s*=\s*[{"]([^}"]*)/i)?.[1] ?? "";
              const first = au.split(/\s+and\s+/i)[0] ?? "";
              const surname = (first.includes(",") ? first.split(",")[0] : first.split(/\s+/).pop() ?? "")
                .replace(/[{}\\'"`^~.]/g, "").toLowerCase();
              const year = body.match(/year\s*=\s*[{"]?\s*(\d{4})/i)?.[1] ?? key.match(/(\d{4})/)?.[1] ?? "";
              bibIndex.push({ key, surname, year });
            }
            // The report's sentence for a claim block, located by the same
            // token window coverage uses; true when it \cite{}s any resolved
            // prior key. A `known` claim that already cites its prior is done.
            const priorAlreadyCited = (cb: string, keys: string[]): boolean => {
              if (keys.length === 0) return false;
              const head = cb.split("\n")[0].replace(/^[\s"“”]+|[\s"“”]+$/g, "");
              // The auditor quotes the sentence verbatim from the tex, so a
              // \cite{} of a resolved key IN THE QUOTE settles it without a
              // tex search (run 5, 2026-08-23: the header carried
              // \cite{Beterov2009} and the locator below still missed it).
              const quoted = [...head.matchAll(/\\cite[a-z]*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((k) => k.trim()));
              if (quoted.some((k) => keys.includes(k))) return true;
              const w = head.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length > 3);
              if (w.length < 2) return false;
              // Locate the sentence in the tex by its first two long words in
              // order (a filtered needle cannot be matched against an
              // unfiltered haystack — the same tokenization trap as coverage).
              const flat = tex.replace(/\s+/g, " ");
              const lower = flat.toLowerCase();
              let from = -1;
              for (let i = 0; i < w.length - 1 && from < 0; i++) {
                const a = lower.indexOf(w[i].toLowerCase());
                if (a >= 0 && lower.indexOf(w[i + 1].toLowerCase(), a) - a < 80) from = a;
              }
              if (from < 0) return false;
              const seg = flat.slice(from, from + 900);
              const stop = seg.search(/[.。!?]\s+[A-Z\\]/);
              const sentence = stop > 0 ? seg.slice(0, stop + 1) : seg;
              const cites = [...sentence.matchAll(/\\cite[a-z]*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((k) => k.trim()));
              return cites.some((k) => keys.includes(k));
            };
            const resolvePrior = (line: string): string | null => {
              const l = line.toLowerCase();
              // bare key form first
              for (const b of bibIndex) if (new RegExp(`\\b${b.key.toLowerCase()}\\b`).test(l)) return b.key;
              const yr = line.match(/\b(19|20)\d{2}\b/)?.[0];
              for (const b of bibIndex) {
                if (b.surname.length >= 3 && l.includes(b.surname) && (!yr || !b.year || yr === b.year)) return b.key;
              }
              return null;
            };
            const claimBlocks = auditSrc.split(/\n###\s+C\d+:/).slice(1);
            for (const cb of claimBlocks) {
              const title = cb.split("\n")[0].trim().slice(0, 90);
              const cls = cb.match(/\*\*Delta class:\*\*\s*([a-z_]+)/)?.[1];
              const priorLines = [...cb.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((m) => m[1]);
              const priors = priorLines.map((l) => l.split(/\s[—-]\s/)[0].trim().slice(0, 50));
              if (!cls) { blockers.push(`prior_art.md claim "${title}" has no Delta class.`); continue; }
              if (cls === "known") {
                const citable = priorLines.map(resolvePrior).filter((k): k is string => !!k);
                if (priors.length > 0 && citable.length === 0) {
                  blockers.push(`prior_art.md marks "${title}" as known, but none of its priors (${priors.slice(0, 3).join(", ")}) ` +
                    `is a key in references.bib — add the entry so the prior can be cited, or the verdict cannot be applied.`);
                } else if (priorAlreadyCited(cb, citable)) {
                  // `known` with the prior already cited in the report's own
                  // sentence is the RESOLVED state of a demotion, not a pending
                  // one (found live 2026-08-23: the gate demoted a C4 whose
                  // audit entry read "✓ Carries citations"). Nothing to do.
                } else {
                  const wording = cb.match(/\*\*Wording required:\*\*\s*([\s\S]*?)(?=\n- \*\*|\n###|\n## |$)/)?.[1]?.trim();
                  demotions.push(`"${title}" — delta class KNOWN (closest prior: ${citable[0] ?? priors[0] ?? "?"}). ` +
                    `Drop first/novel and cite the prior inline.${wording ? ` Auditor's wording: ${wording.slice(0, 160)}` : ""}`);
                }
              }
            }
            // A headline contribution sentence the auditor never covered is an
            // unaudited claim — structure, so it blocks.
            // Match on a mid-sentence window, not the opening words: the
            // auditor quotes the sentence verbatim but may trim a leading
            // "Crucially," / "Here" / LaTeX that the abstract splitter kept.
            // Tokenize BOTH sides identically (drop short tokens on both, not
            // just the needle — a filter applied to one side only makes
            // "the stretched pair" miss "the stretched p3 2 pair").
            const tokens = (t: string) => normText(t).replace(/[^a-z0-9\u4e00-\u9fff ]/g, " ")
              .split(/\s+/).filter((w) => w.length > 2).join(" ");
            const covered = claimBlocks.map((cb) => tokens(cb.split("\n")[0]));
            for (const sent of sentences) {
              const words = tokens(sent).split(" ");
              const start = Math.min(3, Math.max(0, words.length - 6));
              const win = words.slice(start, start + 6).join(" ");
              if (win.length >= 12 && !covered.some((c) => c.includes(win))) {
                blockers.push(`contribution sentence not covered by prior_art.md: "${sent.slice(0, 100)}". Re-spawn prior_art_auditor ` +
                  `or add the claim to the audit.`);
              }
            }
          }
        }
      }
      if (blockers.length > 0) {
        issues.push({
          kind: "disclosure", blocking: true, pushbackExempt: true,
          text: `Prior-art positioning incomplete:\n  - ` + blockers.slice(0, 6).join("\n  - "),
        });
      }
      if (demotions.length > 0) {
        // Demotion is a wording requirement, surfaced the same way a
        // below-indicative grade is: the sentence must say what the evidence
        // supports. It blocks only because an unhedged "first" with a cited
        // contradiction in the audit is a provenance failure on the sentence
        // itself — the fix is one edit, named above, not more research.
        issues.push({
          kind: "number-provenance", blocking: true, pushbackExempt: true,
          text: `Contribution claim(s) the prior-art audit found already in the literature — reword, do not re-research:\n  - ` +
            demotions.slice(0, 6).join("\n  - "),
        });
      }
      issues.push({
        kind: "disclosure", blocking: false,
        text: `Prior-art coverage: ${sentences.length} contribution sentence(s) in the headline surface` +
          (auditSrc ? `; audit present (${demotions.length} demoted to cited-prior wording)` : `; NO audit`) + `.`,
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

  // Definition concerns from the contradiction auditor (claims-first §3.9):
  // revise-level advice, never a veto — surfaced so it has a reader.
  try {
    const sweep = readFileSync(join(projectDir, "reviews", "contradiction_sweep.md"), "utf-8");
    const m = sweep.match(/^definition_concerns:\s*(\d+)/m);
    if (m && parseInt(m[1], 10) > 0) {
      issues.push({ kind: "claim-status", blocking: false,
        text: `The contradiction auditor recorded ${m[1]} definition concern(s) (same quantity id with observables that describe different measurements, or a substitution across definitions). Read reviews/contradiction_sweep.md "## Definition concerns" and have the reviewer's DISCRIMINATOR settle which definition the claim needs.` });
    }
  } catch { /* no sweep yet — its own gate speaks to that */ }

  // Claim-status gate (claims-first design §3.4/§3.9, 2026-08-26): quantity-
  // level statuses computed in src/claims-table.ts. Grandfathered — a project
  // that declares no computed.quantities[] gets no issues here.
  try {
    for (const ci of claimTableIssues(projectDir)) issues.push({ kind: "claim-status", blocking: ci.blocking, pushbackExempt: true, text: ci.text });
  } catch (err) {
    issues.push({ kind: "claim-status", blocking: false, text: `claim table could not be built: ${(err as Error).message.slice(0, 120)}` });
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
/**
 * md5 over prior_art_auditor's read set: report.tex + references.bib, matching
 * the shell pipeline in prior_art_auditor.md workflow step 1 byte-for-byte.
 * Keyed on the contribution SENTENCES and the citation set, not the ledger —
 * a results.json edit does not change what the report claims to contribute.
 */
export function priorArtSourcesDigest(projectDir: string): string {
  const hash = createHash("md5");
  for (const rel of ["report/report.tex", "report/references.bib"]) {
    try { hash.update(readFileSync(join(projectDir, rel))); } catch { /* missing — contributes nothing, like cat */ }
  }
  return hash.digest("hex");
}

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
