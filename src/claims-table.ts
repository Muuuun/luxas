/**
 * Claim table — quantity-level research state, computed from disk.
 *
 * Design: notes/design-claims-first.md (Draft 2.1, debate-adjudicated
 * 2026-08-26; hardened after a three-reviewer code audit the same day — see
 * §10 of the design). The unit of state is the QUANTITY: a named observable
 * with project-wide identity (`computed.quantities[].id`), a history of
 * estimates (own value, harvested cross_validation value_b, other
 * experiments' same-id values, reviewer blind estimates, replication
 * results), and a status computed from those estimates — never from a
 * self-reported verdict.
 *
 * Holes this closes (architecture-review-2026-08-26.md, §1):
 *   H1 identity across experiments   → `id` shared across results.json files
 *   H2 producer self-resolves        → no disposition field is read from the
 *                                       producer; disputes are facts
 *   H3 wiring counts as corroboration→ wiring computed (1e-6 / same script),
 *                                       never declared
 *   H4 no observable definition      → `observable` carried; the mechanical
 *                                       checks are `inputs` by VALUE and the
 *                                       verdict reads-diff
 *   H5 reviewers do not estimate     → ESTIMATE(blind)/SCALING/INDEPENDENT/
 *                                       ANCHOR-OK/DISCLOSE-OK lines parsed —
 *                                       ONLY from harness-written files
 *                                       (reviews/experiment_review_*_r*.md,
 *                                       reviews/pi_feedback.md); any agent
 *                                       may create other files under reviews/
 *
 * Audit-driven rules (2026-08-26):
 *   - σ cannot dissolve a dispute: agreement uses min(σ, 0.5·|value|) and a
 *     ratio veto (> 3× disagrees regardless of σ). Producer-declared σ was
 *     the new `resolution` otherwise.
 *   - Integers never wire by equality (two methods legitimately land on the
 *     same count); floats within 1e-6 do.
 *   - Inputs keys that are not declared quantity ids never grow the
 *     headline set or receive a propagated dispute; they are noted.
 *   - The same number under two different ids is MALFORMED ("one number,
 *     two names" is how a disputed value escapes its id).
 *   - `verdicts[].replaces` must name a declared id that the verdict reads.
 *
 * Consumers (named per the producer-consumer rule): report-integrity.ts
 * (claim-status gate, grandfathered: only when quantities[] exist),
 * context.ts (<claim_status> for the brain), context-builders.ts
 * (experiment / report_writer / PI contexts), claims-review.ts (reviewer
 * scope, write-time validation), scripts/smoke_claim_table*.mts.
 *
 * Every malformed producer row becomes a MALFORMED line. This module never
 * returns "" on a parse failure.
 *
 * Not in v1 (documented): literature estimates with locators beyond the
 * `anchor` string on a cross_validation entry; the flag→answer round (a
 * blind flag disputes immediately); the countersigner agent-id check beyond
 * "harness-written file"; transcript anchoring of limit_check.observed.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { listExperimentDirs } from "./tools/report-integrity.js";
import { openReviewFindings, sameRoute } from "./claims-review.js";
import { listJobIds, readState } from "./jobs/registry.js";

// ── types ──────────────────────────────────────────────────────────────────

export interface QuantityDecl {
  id: string;
  key: string;
  experiment: string;
  headline: boolean;
  observable?: string;
  uncertainty?: number;
  uncertaintySource?: string;
  limitCheck?: { limit: string; expected: number; observed: number; artifact?: string };
  inputs: Record<string, number>;
  value?: number;
}

export interface VerdictDecl { id: string; experiment: string; reads: string[]; replaces: Record<string, string> }

export interface Estimate {
  quantity: string;
  value: number;
  sigma?: number;
  /** "own" | "xval" | "blind" | "posthoc" | "replication" */
  kind: string;
  /** Provenance label, e.g. "E5:computed.master_equation.leakage_40MHz" */
  source: string;
  experiment?: string;
  script?: string;
  inputs?: Record<string, number>;
  /** Literature / benchmark anchor locator, when the producer supplied one. */
  anchor?: string;
  /** Route description (formalism / limiting approximation); same route ⇒ wiring (v3 D2). */
  route?: string;
  /** Model id that produced a replication/blind estimate; same model + same route ⇒ wiring. */
  model?: string;
  /** Executed-computation marker for replications: a script under replication/ or a job id. */
  job?: string;
}

export type ClaimStatus = "corroborated" | "converging" | "indicative" | "conditional" | "disputed" | "disclosed";

export interface ClaimRow {
  id: string;
  status: ClaimStatus;
  headline: boolean;
  estimates: Estimate[];
  reasons: string[];
  observable?: string;
  inputs: string[];
}

export interface ClaimTable {
  rows: ClaimRow[];
  verdicts: { id: string; status: ClaimStatus; reads: string[]; experiments: string[] }[];
  /** Load-bearing set: declared headline ∪ verdict reads ∪ transitive declared inputs ∪ propagation targets. Gates use this. */
  headline: string[];
  /** Declared set only: frame.md ∪ headline:true. Obligations (blind estimator, reviewer, PI) use this. */
  headlineDeclared: string[];
  /** Ids named in notes/frame.md (obligation scope puts these first — claims-review headlineDeclsFor). */
  frameHeadline: string[];
  /** Frame ids tagged "(curve)"/"(non-scalar)"/"(qualitative)" — waived from the PI's scalar ESTIMATE obligation, never from DISCRIMINATOR (piEstimateRule). */
  frameNonScalar: string[];
  /** Bullets under "## Headline quantities" that carried no parseable id — surfaced by claimTableIssues so a dropped headline is never silent. */
  frameHeadlineSkipped: string[];
  /** Premises from notes/frame.md that entered no experiment as an input and are not declared quantities. */
  premisesUnused: string[];
  /** v3 D4: frame headline ids that are disputed/conditional at this moment — the abstract must abstain on them ("we could not determine …"); `satisfied` = the sentence is present. */
  abstain: { id: string; observable: string; sentence: string; satisfied: boolean }[];
  malformed: string[];
  /** Non-blocking notes (undeclared input keys, etc.). */
  notes: string[];
  readsDrops: string[];
  declared: boolean;
  decls: QuantityDecl[];
  /** DISCRIMINATOR lines from harness-written reviews, by quantity id. */
  discriminators: { id: string; text: string }[];
  disclosedHeadlineCount: number;
}

// ── parsing ────────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const posNum = (v: unknown): number | undefined => { const n = num(v); return n !== undefined && n > 0 ? n : undefined; };

/**
 * Where a quantity's number and metadata live (design §3.1 + the shapes live
 * producers actually write, 2026-08-26 probe):
 *   A. key → number; metadata on the quantities[] entry            (design)
 *   B. key → object {value|value_<unit>, headline, observable, …}   (co-located)
 *   C. key → number nested in an object that carries the metadata  (co-located,
 *      after the producer repointed `key` at the numeric sub-leaf)
 * Fields on the quantities[] entry always win; `meta` is the object consulted
 * for what the entry omits (undefined for shape A).
 */
export function resolveQuantity(j: any, key: string): { leaf: unknown; meta: Record<string, unknown> | undefined; metaFrom: "entry" | "leaf" | "parent" | undefined } {
  const leaf = leafAt(j, key);
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (isObj(leaf)) return { leaf, meta: leaf, metaFrom: "leaf" };
  const parentKey = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
  const parent = parentKey ? leafAt(j, parentKey) : undefined;
  if (typeof leaf === "number" && isObj(parent) && ["headline", "observable", "uncertainty", "limit_check", "inputs"].some((f) => f in parent)) {
    return { leaf, meta: parent, metaFrom: "parent" };
  }
  return { leaf, meta: undefined, metaFrom: undefined };
}

function leafAt(obj: any, dotted: string): unknown {
  const parts = dotted.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

interface Parsed { quantities: QuantityDecl[]; verdicts: VerdictDecl[]; estimates: Estimate[]; malformed: string[]; anchors: { key: string; value: number }[] }

/** The report's abstract text (empty when no report.tex / no abstract environment). */
export function readAbstract(projectDir: string): string {
  try {
    const tex = readFileSync(join(projectDir, "report", "report.tex"), "utf-8");
    const m = tex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
    return m ? m[1] : "";
  } catch { return ""; }
}
/** An abstention sentence for a row: "could not determine" (or "remains undetermined") near the id or ≥ 4 consecutive words of its observable. */
export function abstractAbstains(abstractText: string, id: string, observable: string): boolean {
  const t = abstractText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  if (!/could not determine|remains undetermined|cannot determine|were unable to determine/.test(t)) return false;
  if (t.includes(id.toLowerCase().replace(/[^a-z0-9 ]+/g, " "))) return true;
  const w = observable.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((x) => x.length > 2);
  for (let i = 0; i + 4 <= w.length; i++) if (t.includes(w.slice(i, i + 4).join(" "))) return true;
  return false;
}

/** True when any job in .agent/jobs ran a file under data/experiments/<dir>/scripts (the producing computation exists). */
export function experimentRanScripts(projectDir: string, expDirName: string): boolean {
  try {
    for (const id of listJobIds(projectDir)) {
      const st = readState(projectDir, id);
      const cmd = String(st?.command ?? "");
      if (cmd.includes(`${expDirName}/scripts/`) || (String(st?.ownerAgentId ?? "").includes("experiment") && /\bscripts\/[\w.-]+\.py\b/.test(cmd) && cmd.includes(expDirName))) return true;
    }
  } catch { /* no jobs dir */ }
  return false;
}

/** Numeric leaves under `invariants` (literature inputs), recursively, with their dotted keys. */
function invariantLeaves(inv: unknown, prefix = "invariants"): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  const walk = (v: unknown, k: string) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push({ key: k, value: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${k}[${i}]`));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) if (!/^(source|quote|anchored_to)$/.test(kk)) walk(vv, `${k}.${kk}`);
  };
  walk(inv, prefix);
  return out;
}

function parseExperiment(id: string, j: any): Parsed {
  const out: Parsed = { quantities: [], verdicts: [], estimates: [], malformed: [], anchors: invariantLeaves(j?.invariants) };
  const computed = j?.computed;
  if (!computed || typeof computed !== "object") return out;
  const qs = computed.quantities;
  if (qs !== undefined && !Array.isArray(qs)) out.malformed.push(`${id}: computed.quantities is not an array`);
  for (const [i, q] of (Array.isArray(qs) ? qs : []).entries()) {
    if (!q || typeof q !== "object" || typeof q.id !== "string" || typeof q.key !== "string") {
      out.malformed.push(`${id}: quantities[${i}] lacks string id/key`);
      continue;
    }
    // Co-located form (live probe, 2026-08-26): the producer keeps the number
    // AND its metadata under the computed leaf — `computed.c6_theta: {value,
    // headline, observable, uncertainty, limit_check, inputs}` — and leaves
    // quantities[] as bare {id, key}. Accept it: fields on the quantities[]
    // entry win, the leaf object fills what the entry omits, and the value is
    // the object's single `value` / `value_<unit>` number. Gates keep their
    // numeric demands; only the LOCATION is tolerated.
    const { leaf, meta } = resolveQuantity(j, q.key);
    const leafObj = leaf && typeof leaf === "object" && !Array.isArray(leaf) ? (leaf as Record<string, unknown>) : undefined;
    const pick = (field: string): unknown => (q[field] !== undefined ? q[field] : meta?.[field]);
    const decl: QuantityDecl = {
      id: q.id, key: q.key, experiment: id, headline: pick("headline") === true,
      observable: typeof pick("observable") === "string" ? (pick("observable") as string) : undefined,
      inputs: {},
    };
    const uncertainty = pick("uncertainty");
    if (uncertainty !== undefined) {
      const u = posNum(uncertainty);
      if (u === undefined) out.malformed.push(`${id}: quantities[${i}] (${q.id}) uncertainty must be a positive number, got ${JSON.stringify(uncertainty)}`);
      else decl.uncertainty = u;
    }
    const uSrc = pick("uncertainty_source");
    if (typeof uSrc === "string") decl.uncertaintySource = uSrc;
    const lc: any = pick("limit_check");
    if (lc !== undefined) {
      const exp = num(lc?.expected), obs = num(lc?.observed);
      // Demoted after the 2026-08-26 live probe (design §7.4): producers wrote
      // limit_check.expected/observed as TEXT 7/7 times (a polynomial anchor, a
      // self-consistency condition). A descriptive limit_check is accepted
      // silently and simply does not count as an anchor leg; only the numeric
      // form does. Structural garbage (non-object, no `limit`) is still flagged.
      if (!lc || typeof lc !== "object" || typeof lc.limit !== "string") {
        out.malformed.push(`${id}: quantities[${i}] (${q.id}) limit_check must be an object with a string \`limit\` (plus expected/observed — numbers if the limit is to count as an anchor, text otherwise).`);
      } else if (exp !== undefined && obs !== undefined) {
        decl.limitCheck = { limit: lc.limit, expected: exp, observed: obs, artifact: typeof lc.artifact === "string" ? lc.artifact : undefined };
      }
    }
    const inputs = pick("inputs");
    if (inputs !== undefined) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
        out.malformed.push(`${id}: quantities[${i}] (${q.id}) inputs must be an object {id: value}`);
      } else {
        for (const [k, v] of Object.entries(inputs as Record<string, unknown>)) {
          const n = num(v);
          if (n === undefined) out.malformed.push(`${id}: quantities[${i}] (${q.id}) inputs.${k} must be a number (values, not ids)`);
          else decl.inputs[k] = n;
        }
      }
    }
    let v = num(leaf);
    if (v === undefined && leafObj) {
      const direct = num(leafObj.value);
      const valueFields = Object.entries(leafObj).filter(([k, x]) => /^value(_|$)/.test(k) && num(x) !== undefined);
      if (direct !== undefined) v = direct;
      else if (valueFields.length === 1) v = valueFields[0][1] as number;
      else {
        const META = new Set(["uncertainty", "headline"]);
        const numeric = Object.entries(leafObj).filter(([k, x]) => !META.has(k) && num(x) !== undefined).map(([k]) => `${q.key}.${k}`);
        out.malformed.push(`${id}: quantities[${i}] (${q.id}) key ${q.key} is an object with no single numeric \`value\` — ${valueFields.length ? `${valueFields.length} value_* fields` : "no value field"}. Either add \`"value": <the one number this quantity IS>\` to that object, or point \`key\` at the numeric leaf${numeric.length ? ` (candidates: ${numeric.slice(0, 4).join(", ")})` : ""}.`);
      }
    } else if (v === undefined) {
      out.malformed.push(`${id}: quantities[${i}] (${q.id}) key ${q.key} is not a finite number in results.json (got ${leaf === undefined ? "nothing — the key does not exist" : JSON.stringify(leaf).slice(0, 60)}). Point \`key\` at the numeric leaf that holds this quantity's value.`);
    }
    if (v !== undefined) decl.value = v;
    out.quantities.push(decl);
    if (v !== undefined) {
      const xvOwn = (Array.isArray(computed.cross_validation) ? computed.cross_validation : []).find((x: any) => String(x?.claim_key ?? "") === q.key);
      out.estimates.push({ quantity: q.id, value: v, sigma: decl.uncertainty, kind: "own", source: `${id}:${q.key}`, experiment: id, script: `${id}:own`, inputs: decl.inputs, route: typeof xvOwn?.method_a === "string" ? xvOwn.method_a : undefined });
    }
  }
  const vs = computed.verdicts;
  if (vs !== undefined && !Array.isArray(vs)) out.malformed.push(`${id}: computed.verdicts is not an array`);
  for (const [i, v] of (Array.isArray(vs) ? vs : []).entries()) {
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !Array.isArray(v.reads) || !v.reads.every((r: unknown) => typeof r === "string")) {
      out.malformed.push(`${id}: verdicts[${i}] needs {id, reads: [ids]}`);
      continue;
    }
    const replaces: Record<string, string> = {};
    if (v.replaces && typeof v.replaces === "object") {
      for (const [a, b] of Object.entries(v.replaces)) {
        if (typeof b !== "string" || !v.reads.includes(b)) out.malformed.push(`${id}: verdicts[${i}] (${v.id}) replaces.${a} must name a quantity id that this verdict reads (got ${JSON.stringify(b)})`);
        else replaces[a] = b;
      }
    }
    out.verdicts.push({ id: v.id, experiment: id, reads: v.reads, replaces });
  }
  // Harvested cross_validation value_b: an estimate of whatever quantity the
  // claim_key belongs to. Deliberately reads a subtree the claim registry
  // excludes — bookkeeping as a CLAIM, evidence as an ESTIMATE (design §3.2).
  const keyToId = new Map(out.quantities.map((q) => [q.key, q.id]));
  for (const x of (Array.isArray(computed.cross_validation) ? computed.cross_validation : [])) {
    const qid = keyToId.get(String(x?.claim_key ?? ""));
    if (!qid) continue;
    const b = num(x?.value_b);
    if (b === undefined) continue;
    out.estimates.push({
      quantity: qid, value: b, sigma: posNum(x?.sigma_b), kind: "xval",
      source: `${id}:xval:${String(x?.method_b ?? "?").slice(0, 40)}`, experiment: id,
      script: typeof x?.artifact_b === "string" ? x.artifact_b : undefined, route: typeof x?.method_b === "string" ? x.method_b : undefined,
      inputs: (x?.inputs_b && typeof x.inputs_b === "object") ? x.inputs_b : undefined,
      anchor: typeof x?.anchor === "string" ? x.anchor : undefined,
    });
  }
  return out;
}

// Reviewer-line grammar. The separator must be whitespace-delimited so a
// leading minus sign on the value is never eaten (505d006's lesson).
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
export const ESTIMATE_LINE_RE = new RegExp(String.raw`^\s*ESTIMATE(\(blind\))?:\s*(\S+)\s+[—–-]+\s+(${NUM})(?:\s*(?:±|\+/-)\s*(${NUM}))?\s*(?:via\s+(.*?))?(?:\s+[—–-]+\s*inputs:\s*(.*))?\s*$`);
// Loosened after the 2026-08-26 live probe: reviewers write `expected 1/6 in C6
// (r0 = ...)`, `observed ~11 from two-point ...`, `observed not swept (single
// point)`. Fractions, a leading ~, a parenthesised parameter, and trailing
// prose are all accepted; the numbers are what matter.
const FRAC = String.raw`(?:${NUM})(?:\s*/\s*(?:${NUM}))?`;
const SCALING_LINE_RE = new RegExp(String.raw`^\s*SCALING:\s*(\S+)\s+[—–-]+\s+(?:expected\s+~?\s*(${FRAC})\s+in\s+[^;]+;\s*)?observed\s+(?:~?\s*(${FRAC})|(not swept))`);
function fracNum(t: string): number {
  const parts = t.split("/").map((x) => Number(x.trim()));
  return parts.length === 2 && parts[1] !== 0 ? parts[0] / parts[1] : parts[0];
}
/** Only files the HARNESS writes carry attestations; any agent may create other files under reviews/. */
export const HARNESS_REVIEW_FILE_RE = /^(experiment_review_[^/]+_r\d+\.md|pi_feedback\.md)$/;

export interface ReviewerLines {
  blind: Estimate[];
  posthoc: Estimate[];
  scaling: { id: string; expected: number; observed?: number }[];
  independent: Set<string>;
  anchorOk: Set<string>;
  discloseOk: Set<string>;
  discriminators: { id: string; text: string }[];
  malformed: string[];
}

/** Parse reviewer/PI lines from harness-written review files (design §3.5). */
export function parseReviewerLines(projectDir: string): ReviewerLines {
  const out: ReviewerLines = { blind: [], posthoc: [], scaling: [], independent: new Set(), anchorOk: new Set(), discloseOk: new Set(), discriminators: [], malformed: [] };
  const dir = join(projectDir, "reviews");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => HARNESS_REVIEW_FILE_RE.test(f)).sort()) {
    let text = "";
    try { text = readFileSync(join(dir, f), "utf-8"); } catch (err) { out.malformed.push(`reviews/${f}: unreadable (${(err as Error).message.slice(0, 60)})`); continue; }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (/^ESTIMATE(\(blind\))?:/.test(line)) {
        const m = line.match(ESTIMATE_LINE_RE);
        if (!m) { out.malformed.push(`reviews/${f}: unparseable estimate line "${line.slice(0, 80)}"`); continue; }
        const inputs: Record<string, number> = {};
        let producerSupplied = false;
        if (m[6]) {
          for (const tok of m[6].split(/[,\s\[\]]+/).filter(Boolean)) {
            const kv = tok.split("=");
            if (kv.length === 2 && Number.isFinite(Number(kv[1]))) inputs[kv[0]] = Number(kv[1]);
            if (/^producer$/i.test(tok)) producerSupplied = true;
          }
        }
        // A blind line with no `via <route>` cannot be judged (v2 plan P0.6): recorded, never flags.
        const e: Estimate = { quantity: m[2], value: Number(m[3]), sigma: m[4] ? posNum(Number(m[4])) : undefined, kind: m[1] && !producerSupplied && m[5]?.trim() ? "blind" : "posthoc", source: `review:${f}`, script: `review:${f}:${m[5] ?? ""}`, inputs, route: m[5]?.trim() || undefined };
        (e.kind === "blind" ? out.blind : out.posthoc).push(e);
        continue;
      }
      let m = line.match(SCALING_LINE_RE);
      if (m) {
        // `expected` may be absent only when the reviewer says "not swept"
        // (live run 2026-08-27); a numeric observed without an expected
        // exponent is meaningless and stays malformed.
        if (m[2] === undefined && !m[4]) { out.malformed.push(`reviews/${f}: scaling line has an observed exponent but no "expected <k> in <param>;" clause "${line.slice(0, 80)}"`); continue; }
        out.scaling.push({ id: m[1], expected: m[2] === undefined ? NaN : fracNum(m[2]), observed: m[4] ? undefined : fracNum(m[3]) });
        continue;
      }
      if (/^SCALING:/.test(line)) {
        // Descriptive scaling ("expected divergent as θ→θ*", "expected non-power-law"):
        // legitimate reviewer prose with no numeric exponent. Record the id with
        // no consequence instead of MALFORMED noise (live run 2026-08-27).
        const d = line.match(/^SCALING:\s*(\S+)\s+[—–-]+\s+expected:?\s+\S/);
        if (d) { out.scaling.push({ id: d[1], expected: NaN, observed: undefined }); continue; }
        out.malformed.push(`reviews/${f}: unparseable scaling line "${line.slice(0, 80)}"`); continue;
      }
      m = line.match(/^DISCRIMINATOR:\s*(\S+)/); if (m) { out.discriminators.push({ id: m[1], text: line }); continue; }
      m = line.match(/^INDEPENDENT:\s*(\S+)/); if (m) { out.independent.add(m[1]); continue; }
      m = line.match(/^ANCHOR-OK:\s*(\S+)/); if (m) { out.anchorOk.add(m[1]); continue; }
      m = line.match(/^DISCLOSE-OK:\s*(\S+)/); if (m) { out.discloseOk.add(m[1]); continue; }
    }
  }
  return out;
}

/**
 * Frame headline bullets, parsed strictly (2026-09-01, Ba-run post-mortem).
 *
 * The old regex took the first bare word after the bullet, so the prose line
 * "- Named (non-scalar) deliverables: `isotope_choice`, …" produced a headline
 * quantity id literally called `Named`. No ESTIMATE can ever match it, so
 * piEstimateRule downgraded EVERY PI stop verdict to steer for a whole run:
 * 7 consecutive STEERs, two cost-cap kills, no finish() (ba-neutral-atom-qc,
 * 2026-08-31). An id is now taken only from a bullet whose FIRST token is
 * back-ticked or a bare snake_case token (legacy frames wrote them bare);
 * "Named" is neither.
 *
 * `nonScalar` collects ids the frame itself tags "(curve)" / "(non-scalar)" /
 * "(qualitative)": a curve or a recommendation cannot carry one value ± σ, so
 * the PI's ESTIMATE obligation is waived for them — the DISCRIMINATOR
 * obligation is NOT (piEstimateRule). `skipped` keeps bullets that carried no
 * id, so an omission is visible (claimTableIssues) instead of silent.
 */
export interface FrameHeadline { ids: string[]; nonScalar: string[]; skipped: string[] }

/**
 * The waiver tag must be a STANDALONE classifier inside a parenthetical —
 * "(curve)", "(crux; curve)", "(non-scalar)" — never a word occurring in
 * prose. Substring matching silently waived any headline whose description
 * mentioned a fit: "- `tau300` — lifetime from an exponential fit (decay
 * curve at 300 K)" would have excused the PI from ever putting its own number
 * on tau300, which is the opposite of what this gate is for. Splitting each
 * parenthetical on ; and , and demanding a whole segment be the tag word is
 * what separates an annotation from a sentence.
 */
const FRAME_PARENTHETICAL_RE = /\(([^)]*)\)/g;
const FRAME_NON_SCALAR_TAG = /^(?:curve(?:-valued)?|non-?scalar|qualitative|categorical|recommendation)s?$/i;

function frameTagsNonScalar(line: string): boolean {
  for (const m of line.matchAll(FRAME_PARENTHETICAL_RE)) {
    for (const seg of m[1].split(/[;,]/)) if (FRAME_NON_SCALAR_TAG.test(seg.trim())) return true;
  }
  return false;
}

export function parseFrameHeadlineDetailed(projectDir: string): FrameHeadline {
  const out: FrameHeadline = { ids: [], nonScalar: [], skipped: [] };
  let text = "";
  try { text = readFileSync(join(projectDir, "notes", "frame.md"), "utf-8"); } catch { return out; }
  // No `m` flag: with it, `$` matches every line end and the lazy body stops at
  // the first blank line.
  const m = text.match(/(?:^|\n)##+[ \t]*Headline quantities[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    // `\s*` not `\s+` after the marker: "-`id`" is tight but legal, and the
    // old guard dropped it before it could even be recorded as skipped.
    // Horizontal rules ("---") are not bullets and must not become "skipped".
    if (!/^\s*[-*]\s*\S/.test(line) || /^\s*([-*])\1{2,}\s*$/.test(line)) continue;
    const mm = line.match(/^\s*[-*]\s*`([A-Za-z0-9_]+)`/)
      // Legacy bare ids. Two shapes, because pre-2026-09 frames wrote both:
      // multi-token (`fidelity_40MHz`), and single-token followed by the
      // "— observable" dash, which is what distinguishes an id from the first
      // word of a prose bullet ("Named (non-scalar) deliverables: …").
      ?? line.match(/^\s*[-*]\s*([A-Za-z0-9]+_[A-Za-z0-9_]*)(?![A-Za-z0-9_])/)
      ?? line.match(/^\s*[-*]\s*([A-Za-z][A-Za-z0-9]*)\s+[—–-]\s+\S/);
    if (!mm) { out.skipped.push(line.trim().slice(0, 160)); continue; }
    out.ids.push(mm[1]);
    if (frameTagsNonScalar(line)) out.nonScalar.push(mm[1]);
  }
  return out;
}

/** Headline ids named in notes/frame.md under a "Headline quantities" heading. */
export function parseFrameHeadline(projectDir: string): string[] {
  return parseFrameHeadlineDetailed(projectDir).ids;
}

/** `## Premises` lines in notes/frame.md: `- \`id\` = value — text` (v2, 2026-08-29). */
export function parseFramePremises(projectDir: string): { id: string; value: string; text: string }[] {
  let text = "";
  try { text = readFileSync(join(projectDir, "notes", "frame.md"), "utf-8"); } catch { return []; }
  const m = text.match(/(?:^|\n)##+[ \t]*Premises[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (!m) return [];
  const out: { id: string; value: string; text: string }[] = [];
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s*[-*]\s*`?([A-Za-z0-9_]+)`?\s*(?:=\s*([^—–-]+?))?\s*(?:[—–-]+\s*(.*))?$/);
    if (mm) out.push({ id: mm[1], value: (mm[2] ?? "").trim(), text: (mm[3] ?? "").trim() });
  }
  return out;
}

function parseDisclosures(projectDir: string): Set<string> {
  const out = new Set<string>();
  try {
    const mem = readFileSync(join(projectDir, "notes", "memory.md"), "utf-8");
    for (const m of mem.matchAll(/^CLAIM-DISCLOSE:\s*(\S+)/gm)) out.add(m[1]);
  } catch { /* no memory */ }
  return out;
}

// ── comparison rules (design §3.3, §3.4; audit-hardened) ───────────────────

const WIRING_REL = 1e-6;
const INPUT_MATCH_REL = 1e-2;
const SIGMA_K = 2;
const RATIO_VETO = 3;
const SIGMA_CAP_FRAC = 0.5;
const SCALING_TOL = 0.5;

function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

export type PairRelation = "wiring" | "incomparable" | "comparable";

export function relation(a: Estimate, b: Estimate): { rel: PairRelation; differing: string[] } {
  const bothInt = Number.isInteger(a.value) && Number.isInteger(b.value);
  if (!bothInt && relDiff(a.value, b.value) < WIRING_REL) return { rel: "wiring", differing: [] };
  if (a.script && b.script && a.script === b.script) return { rel: "wiring", differing: [] };
  // v3 D2: two names for one route are one leg; same model on the same route too.
  if (a.route && b.route && sameRoute(a.route, b.route) && (a.kind !== "own" || b.kind !== "own")) return { rel: "wiring", differing: [] };
  const differing: string[] = [];
  if (a.inputs && b.inputs) {
    for (const k of Object.keys(a.inputs)) {
      // Inputs are quoted, not computed: a blind line writes -0.152 for the
      // producer's -0.151863. 1% is a rounding; the 5.6× between E4's and E5's
      // blockade shift (297nm) is a different regime.
      if (k in b.inputs && relDiff(a.inputs[k], b.inputs[k]) > INPUT_MATCH_REL) differing.push(k);
    }
  }
  if (differing.length > 0) return { rel: "incomparable", differing };
  return { rel: "comparable", differing: [] };
}

/**
 * "agree" | "disagree" | "undecidable". A ratio > 3× (or a sign flip)
 * disagrees regardless of σ; σ is capped at half the value so a producer
 * cannot declare its way out of a dispute; missing σ on either side is
 * undecidable inside the ratio.
 */
export function agreement(a: Estimate, b: Estimate): "agree" | "disagree" | "undecidable" {
  const hi = Math.max(Math.abs(a.value), Math.abs(b.value)), lo = Math.min(Math.abs(a.value), Math.abs(b.value));
  if (lo === 0 ? hi > 0 : hi / lo > RATIO_VETO) return "disagree";
  if (Math.sign(a.value) !== Math.sign(b.value) && a.value !== 0 && b.value !== 0) return "disagree";
  if (a.sigma !== undefined && b.sigma !== undefined) {
    const sa = Math.min(a.sigma, SIGMA_CAP_FRAC * Math.abs(a.value) || a.sigma);
    const sb = Math.min(b.sigma, SIGMA_CAP_FRAC * Math.abs(b.value) || b.sigma);
    const s = Math.sqrt(sa * sa + sb * sb);
    return Math.abs(a.value - b.value) <= SIGMA_K * s ? "agree" : "disagree";
  }
  return "undecidable";
}

/**
 * A sign-only disagreement: the magnitudes agree (within 2σ, or within 10% when
 * a σ is missing) but the signs differ. Live run 2026-08-27: producer −138.86
 * (attractive = negative) vs blind +140 "repulsive". Still a dispute — a
 * convention nobody pinned in `observable` is exactly what an unanswered flag
 * should surface — but the reason says what the one-round answer is.
 */
/** A sign convention is "stated" when the observable names one — signed/magnitude wording or attractive/repulsive/negative/positive mapping. */
export const SIGN_CONVENTION_RE = /\b(signed(?:\s+coefficient)?|magnitude|absolute value|\|[^|]{1,12}\||negative\s*=\s*\w+|positive\s*=\s*\w+|\w+\s*=\s*(?:negative|positive)|attractive\s*(?:\(|=|is|→|->)\s*[-−+]?|repulsive\s*(?:\(|=|is|→|->)\s*[-−+]?|sign convention[^.;]{0,60})/i;
export function signConventionStated(observable: string | undefined): boolean {
  return !!observable && SIGN_CONVENTION_RE.test(observable);
}

export function signOnlyDisagreement(a: Estimate, b: Estimate): boolean {
  if (a.value === 0 || b.value === 0 || Math.sign(a.value) === Math.sign(b.value)) return false;
  const ma = { ...a, value: Math.abs(a.value) }, mb = { ...b, value: Math.abs(b.value) };
  const ag = agreement(ma, mb);
  if (ag === "agree") return true;
  if (ag === "undecidable") { const hi = Math.max(ma.value, mb.value), lo = Math.min(ma.value, mb.value); return hi / lo <= 1.1; }
  return false;
}

// ── the table ──────────────────────────────────────────────────────────────

export function buildClaimTable(projectDir: string): ClaimTable {
  const decls: QuantityDecl[] = [];
  const verdicts: VerdictDecl[] = [];
  const estimates: Estimate[] = [];
  const malformed: string[] = [];
  const anchorsByExp = new Map<string, { key: string; value: number }[]>();
  const dirByExp = new Map<string, string>();
  const notes: string[] = [];
  const dirs = [...listExperimentDirs(projectDir)].sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  for (const e of dirs) {
    if (!e.latestResults) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); }
    catch (err) { malformed.push(`${e.id}: results.json unparseable (${(err as Error).message.slice(0, 60)})`); continue; }
    const p = parseExperiment(e.id, j);
    decls.push(...p.quantities); verdicts.push(...p.verdicts); estimates.push(...p.estimates); malformed.push(...p.malformed); anchorsByExp.set(e.id, [...(anchorsByExp.get(e.id) ?? []), ...p.anchors]); dirByExp.set(e.id, basename(e.dir));
  }
  // Replicator results (design §3.6.2): data/experiments/<dir>/replication/results.json.
  for (const e of dirs) {
    const p = join(e.dir, "replication", "results.json");
    if (!existsSync(p)) continue;
    try {
      const r = JSON.parse(readFileSync(p, "utf-8"));
      const v = num(r?.value);
      if (typeof r?.quantity !== "string" || v === undefined) { malformed.push(`${e.id}: replication/results.json needs {quantity: string, value: number}`); continue; }
      const inputs: Record<string, number> = {};
      if (r?.inputs && typeof r.inputs === "object") for (const [k, x] of Object.entries(r.inputs)) { const n = num(x); if (n !== undefined) inputs[k] = n; }
      estimates.push({ quantity: r.quantity, value: v, sigma: posNum(r?.sigma), kind: "replication", source: `${e.id}:replication`, experiment: e.id, script: `replication:${e.id}:${String(r?.script ?? "")}`, inputs,
        route: typeof r?.route === "string" ? r.route : undefined, model: typeof r?.model === "string" ? r.model : undefined,
        job: typeof r?.job_id === "string" ? r.job_id : (typeof r?.script === "string" && /replication\//.test(r.script) ? r.script : undefined) });
    } catch (err) { malformed.push(`${e.id}: replication/results.json unparseable (${(err as Error).message.slice(0, 60)})`); }
  }
  const declared = decls.length > 0 || verdicts.length > 0;
  const rev = parseReviewerLines(projectDir);
  malformed.push(...rev.malformed);
  estimates.push(...rev.blind, ...rev.posthoc);
  estimates.sort((a, b) => a.quantity.localeCompare(b.quantity) || a.source.localeCompare(b.source));
  const disclosures = parseDisclosures(projectDir);

  const ids = [...new Set([...decls.map((d) => d.id), ...estimates.map((e) => e.quantity)])].sort();
  const known = new Set(ids);
  const declsById = new Map<string, QuantityDecl[]>();
  for (const d of decls) declsById.set(d.id, [...(declsById.get(d.id) ?? []), d]);

  // Undeclared input keys are noted, never grown into ids.
  for (const d of decls) for (const k of Object.keys(d.inputs)) if (!known.has(k)) notes.push(`${d.experiment}: ${d.id} reads input "${k}" which is not a declared quantity id — it takes part in no comparison or propagation`);
  // One number, two names: own estimates of DIFFERENT ids within wiring tolerance.
  {
    const owns = estimates.filter((e) => e.kind === "own" && !Number.isInteger(e.value) && e.value !== 0);
    for (let i = 0; i < owns.length; i++) for (let k = i + 1; k < owns.length; k++) {
      if (owns[i].quantity !== owns[k].quantity && relDiff(owns[i].value, owns[k].value) < WIRING_REL) {
        malformed.push(`${owns[i].source} and ${owns[k].source} carry the same number under two ids (${owns[i].quantity}, ${owns[k].quantity}) — one quantity, one id`);
      }
    }
  }

  // Headline sets.
  const headlineDeclared = new Set<string>([...parseFrameHeadline(projectDir), ...decls.filter((d) => d.headline).map((d) => d.id)]);
  const headline = new Set<string>(headlineDeclared);
  const verdictById = new Map<string, VerdictDecl[]>();
  for (const v of verdicts) verdictById.set(v.id, [...(verdictById.get(v.id) ?? []), v]);
  for (const [vid, vs] of verdictById) if (headline.has(vid)) for (const v of vs) for (const r of v.reads) if (known.has(r)) headline.add(r);
  // Load-bearing closure over DECLARED inputs — the number the abstract rests
  // on must be reviewed whatever key it sits under. Gates use `headline`;
  // obligations use `headlineDeclared` (design §3.4, audit 2026-08-26).
  {
    const inputsOfId = (id: string) => (declsById.get(id) ?? []).flatMap((d) => Object.keys(d.inputs));
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of [...headline]) for (const up of inputsOfId(id)) if (known.has(up) && !headline.has(up)) { headline.add(up); grew = true; }
    }
  }

  type Intr = { status: ClaimStatus; reasons: string[]; propagate: string[] };
  const intrinsic = new Map<string, Intr>();
  for (const id of ids) {
    const es = estimates.filter((e) => e.quantity === id);
    const reasons: string[] = [];
    const propagate: string[] = [];
    let disputed = false, agreeingPair = false, anchoredAgree = false;
    let anchorExfil: string | null = null;
    // Supersession (claims v2 P1, 2026-08-29): a producer estimate is RETIRED
    // when at least two LATER experiments re-measured the id, agree with each
    // other, and each disagrees with it — the discriminators ran and settled
    // the value; the stale number stays in the row's history but no longer
    // disputes (pp-vs-ss: E3's 22.909±0.01 vs E4 24.65 and E7 24.5 forced a
    // disclosure). One later route never retires anything (that is a dispute).
    // Everything from the retired experiment's lineage for this id (its own
    // replication / cross-validation) retires with it.
    const allProducers = es.filter((e) => e.kind !== "blind" && e.kind !== "posthoc");
    const expNum = (e: Estimate) => { const m = String(e.experiment ?? "").match(/^E_?(\d+)/); return (m ? parseInt(m[1], 10) : -1) + (e.kind === "replication" ? 0.5 : 0); };
    const retiredExps = new Set<string>();
    for (const a of allProducers.filter((e) => e.kind === "own")) {
      const later = allProducers.filter((b) => (b.kind === "own" || (b.kind === "replication" && !!b.route && !!b.job)) && !(b.kind === "own" && b.experiment === a.experiment) && expNum(b) > expNum(a) && relation(a, b).rel === "comparable" && agreement(a, b) === "disagree");
      const agreeingLater: Estimate[][] = [];
      for (let i = 0; i < later.length; i++) for (let k = i + 1; k < later.length; k++) {
        if ((later[i].experiment !== later[k].experiment || later[i].kind !== later[k].kind) && relation(later[i], later[k]).rel === "comparable" && agreement(later[i], later[k]) === "agree") agreeingLater.push([later[i], later[k]]);
      }
      if (agreeingLater.length > 0 && a.experiment) {
        retiredExps.add(a.experiment);
        const [b, c] = agreeingLater[0];
        reasons.push(`superseded: ${a.source}=${a.value} retired — re-measured by ${b.source}=${b.value} and ${c.source}=${c.value}, which agree with each other and not with it`);
      }
    }
    const producers = allProducers.filter((e) => !(e.experiment && retiredExps.has(e.experiment)));
    for (let i = 0; i < producers.length; i++) for (let k = i + 1; k < producers.length; k++) {
      const a = producers[i], b = producers[k];
      const { rel, differing } = relation(a, b);
      const ag = agreement(a, b);
      if (rel === "wiring") { if (ag !== "disagree") reasons.push(`wiring: ${a.source} ≈ ${b.source}`); continue; }
      if (rel === "incomparable") {
        reasons.push(`incomparable: ${a.source} vs ${b.source} differ in inputs ${differing.join(",")}`);
        if (ag === "disagree") { const ups = differing.filter((u) => known.has(u)); propagate.push(...ups); if (ups.length) reasons.push(`dispute propagated to ${ups.join(",")}`); }
        continue;
      }
      if (ag === "disagree") { disputed = true; reasons.push(signOnlyDisagreement(a, b) ? `sign convention: |${a.source}|=${Math.abs(a.value)} ≈ |${b.source}|=${Math.abs(b.value)} but signs differ — pin the convention in \`observable\` (e.g. "negative = attractive") and restate one estimate with a locator; a physics dispute only if the signs survive that` : `disagree: ${a.source}=${a.value} vs ${b.source}=${b.value}`); }
      else if (ag === "agree") {
        // v3 D2: a computing replication on an ASSIGNED route that differs from
        // its partner's is independent by construction (the harness chose the
        // route, the replicator never saw the producer's value) — it needs no
        // INDEPENDENT line to count as a leg.
        const computingLeg = (x: Estimate) => x.kind === "replication" && !!x.route && !!x.job && process.env.LUXAS_REPLICATE_LEGS !== "0";
        // An assigned route on the replication side counts as different when the
        // producer never named its own route (unknown ≠ same); relation() has
        // already turned two named identical routes into wiring.
        const routesDiffer = (a.route && b.route) ? !sameRoute(a.route, b.route) : true;
        const attested = !headline.has(id) || rev.independent.has(id) || ((computingLeg(a) || computingLeg(b)) && routesDiffer);
        if (attested) {
          agreeingPair = true;
          if (a.anchor || b.anchor) anchoredAgree = true;
          reasons.push(`agree: ${a.source} ~ ${b.source}${a.anchor || b.anchor ? " (anchored)" : ""}`);
        } else reasons.push(`agree but unattested (no INDEPENDENT line${(a.kind === "replication" || b.kind === "replication") ? "; replication lacks a route/script or shares the producer's route" : ""}): ${a.source} ~ ${b.source}`);
      } else reasons.push(`undecidable (missing σ): ${a.source} vs ${b.source}`);
    }
    // Blind estimates (design §3.5/§3.6.1, v2 plan P0.1 2026-08-28). A blind
    // line is compared with the SAME comparability rule as producer pairs —
    // an estimate made against input values that have since moved is
    // incomparable, not wrong. A disagreeing blind flag is ANSWERED when a
    // later own-estimate of the same id from a DIFFERENT experiment is
    // comparable and agrees with the flagged producer: the discriminator ran,
    // the outlier stays in the row beside it. Sign-only disagreements keep the
    // convention hint. Nothing here is written by a producer or the brain.
    const owns = producers.filter((e) => e.kind === "own");
    for (const bl of rev.blind.filter((e) => e.quantity === id)) {
      const comparable = owns.filter((o) => relation(o, bl).rel !== "incomparable");
      if (owns.length && comparable.length === 0) { reasons.push(`blind estimate ${bl.value} incomparable: its inputs (${Object.entries(bl.inputs ?? {}).map(([k, v]) => `${k}=${v}`).join(",") || "none"}) differ in value from the producer's — re-estimate against current inputs`); continue; }
      const agreeingOwn = comparable.find((o) => agreement(o, bl) === "agree");
      if (agreeingOwn) { reasons.push(`blind estimate ${bl.value} agrees with ${agreeingOwn.source}`); continue; }
      const flagged = comparable[0];
      if (!flagged) continue;
      const answer = owns.find((o) => o !== flagged && o.experiment !== flagged.experiment && relation(o, flagged).rel === "comparable" && agreement(o, flagged) === "agree");
      if (answer) { reasons.push(`blind estimate ${bl.value} disagreed with ${flagged.source}=${flagged.value}; answered by ${answer.source}=${answer.value} (independent experiment agrees with the producer)`); continue; }
      if (signOnlyDisagreement(flagged, bl)) {
        // A sign-only disagreement is ANSWERED the moment the producer's
        // observable sentence pins the convention (design §3.5 "answer with a
        // locator"; 2026-08-28: two such rows were disclosed and escalated to
        // the operator although four routes agreed on the magnitude).
        const obs = (declsById.get(id) ?? []).map((d) => d.observable ?? "").join(" ");
        if (signConventionStated(obs)) { reasons.push(`sign convention: blind estimate ${bl.value} vs ${flagged.source}=${flagged.value} agree in magnitude; convention stated in observable ("${obs.match(SIGN_CONVENTION_RE)?.[0]}") — answered`); continue; }
        disputed = true;
        reasons.push(`sign convention: blind estimate ${bl.value} vs ${flagged.source}=${flagged.value} agree in magnitude, differ in sign — state the convention in \`observable\` (e.g. "signed, negative = attractive" or "magnitude |C6|") and the flag is answered; a physics dispute only if the signs survive that (unanswered)`);
        continue;
      }
      disputed = true;
      reasons.push(`blind reviewer estimate ${bl.value} disagrees with ${flagged.source}=${flagged.value} (unanswered)`);
    }
    // v3 D3: anchor exfiltration — a "computed" value equal to a literature
    // input to 1e-6, with no job that ran this experiment's scripts, is the
    // literature number read back (the cheapest reward hack; 2.4 % base rate
    // under monitors in the literature). Capped at indicative, never blocked:
    // a legitimate limiting-case reproduction trips the same test.
    if (process.env.LUXAS_ANCHOR_EXFIL !== "0") for (const own of producers.filter((e) => e.kind === "own")) {
      const hit = (anchorsByExp.get(own.experiment ?? "") ?? []).find((a) => a.value !== 0 && relDiff(a.value, own.value) <= 1e-6);
      if (!hit) continue;
      const dirName = dirByExp.get(own.experiment ?? "") ?? "";
      if (dirName && experimentRanScripts(projectDir, dirName)) { reasons.push(`value equals literature input ${hit.key} to 1e-6 — but a job ran this experiment's scripts (reproduction, not exfiltration)`); continue; }
      anchorExfil = `computed value ${own.value} equals literature input ${hit.key} to 1e-6 with no job that ran data/experiments/${dirName || own.experiment}/scripts — a literature number read back is not a computation; capped at indicative`;
    }
    for (const s of rev.scaling.filter((s) => s.id === id)) {
      if (s.observed !== undefined && Math.abs(s.observed - s.expected) > SCALING_TOL) { disputed = true; reasons.push(`scaling: observed exponent ${s.observed} vs expected ${s.expected}`); }
    }
    for (const d of declsById.get(id) ?? []) {
      if (d.uncertaintySource && d.uncertainty !== undefined) reasons.push(`σ ${d.uncertainty} (${d.uncertaintySource.slice(0, 60)})`);
      if (d.limitCheck) {
        const passes = d.limitCheck.expected === 0 ? Math.abs(d.limitCheck.observed) <= (d.uncertainty ?? 1e-9) : relDiff(d.limitCheck.expected, d.limitCheck.observed) <= 0.1;
        if (rev.anchorOk.has(id) && passes) { anchoredAgree = anchoredAgree || agreeingPair; reasons.push(`limit anchored (ANCHOR-OK): ${d.limitCheck.limit}`); }
        else if (!rev.anchorOk.has(id)) reasons.push(`limit_check present but not attested (ANCHOR-OK missing)${d.limitCheck.expected === 0 ? " — zero-expected limit is wiring" : ""}`);
      }
    }
    const anyOwnSigma = (declsById.get(id) ?? []).some((d) => d.uncertainty !== undefined);
    let status: ClaimStatus;
    if (disputed) status = disclosures.has(id) && rev.discloseOk.has(id) ? "disclosed" : "disputed";
    else if (agreeingPair && anchoredAgree && anyOwnSigma) status = "corroborated";
    else if (agreeingPair && anyOwnSigma) status = "converging";
    else status = "indicative";
    if (!anyOwnSigma && agreeingPair) reasons.push("no σ on own estimate: capped at indicative");
    if (anchorExfil) { if (status === "corroborated" || status === "converging") status = "indicative"; reasons.push(anchorExfil); }
    intrinsic.set(id, { status, reasons: [...new Set(reasons)], propagate });
  }
  for (const [id, intr] of intrinsic) for (const up of intr.propagate) {
    headline.add(up);
    const t = intrinsic.get(up) ?? { status: "indicative", reasons: [], propagate: [] };
    if (t.status !== "disputed" && t.status !== "disclosed") { t.status = "disputed"; t.reasons.push(`disputed by propagation from ${id}`); }
    intrinsic.set(up, t);
  }
  // v3 D1: quantities of an experiment whose latest review is `revise` with an
  // unanswered finding are capped at indicative (the flaw is open).
  const openFindings = openReviewFindings(projectDir);
  for (const id of ids) {
    const cur = intrinsic.get(id)!;
    for (const d of declsById.get(id) ?? []) {
      const f = openFindings.get(d.experiment);
      if (f && !f.answered) {
        if (cur.status === "corroborated" || cur.status === "converging") cur.status = "indicative";
        const line = `reviewer finding open (${f.experiment} round ${f.round}): "${f.sentence.slice(0, 120)}" — answer it with finding_answered: <locator> in the ledger`;
        if (!cur.reasons.includes(line)) cur.reasons.push(line);
        break;
      }
    }
  }
  // Conditional via disputed/disclosed/conditional inputs — fixed point.
  // (Design §3.4 also lists `indicative` inputs; not applied — it would make
  // nearly every quantity conditional. Recorded deviation.)
  const RANK: Record<ClaimStatus, number> = { corroborated: 5, converging: 4, indicative: 3, conditional: 2, disclosed: 1, disputed: 0 };
  const inputsOf = (id: string) => [...new Set((declsById.get(id) ?? []).flatMap((d) => Object.keys(d.inputs)).filter((k) => known.has(k)))];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const cur = intrinsic.get(id)!;
      if (cur.status === "disputed" || cur.status === "disclosed" || cur.status === "conditional") continue;
      const bad = inputsOf(id).filter((u) => { const s = intrinsic.get(u)?.status; return s === "disputed" || s === "disclosed" || s === "conditional"; });
      if (bad.length > 0) { cur.status = "conditional"; cur.reasons.push(`conditional on ${bad.join(",")}`); changed = true; }
    }
  }
  const rows: ClaimRow[] = ids.map((id) => ({
    id, status: intrinsic.get(id)!.status, headline: headline.has(id),
    estimates: estimates.filter((e) => e.quantity === id),
    reasons: intrinsic.get(id)!.reasons, observable: (declsById.get(id) ?? []).find((d) => d.observable)?.observable, inputs: inputsOf(id),
  }));
  const vRows = [...verdictById.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([vid, vs]) => {
    const reads = [...new Set(vs.flatMap((v) => v.reads))];
    let status: ClaimStatus = "corroborated";
    for (const r of reads) { const s = intrinsic.get(r)?.status ?? "indicative"; if (RANK[s] < RANK[status]) status = s; }
    if (status === "disputed" || status === "disclosed") status = "conditional";
    return { id: vid, status, reads, experiments: vs.map((v) => v.experiment) };
  });
  const readsDrops: string[] = [];
  for (const [vid, vs] of verdictById) {
    const sorted = [...vs].sort((a, b) => a.experiment.localeCompare(b.experiment, undefined, { numeric: true }));
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Set(sorted[i - 1].reads), cur = sorted[i];
      for (const r of prev) if (!cur.reads.includes(r) && !(r in cur.replaces)) readsDrops.push(`${vid}: ${cur.experiment} dropped read ${r} (present in ${sorted[i - 1].experiment}) with no replaces entry`);
    }
  }
  const disclosedHeadlineCount = rows.filter((r) => r.headline && r.status === "disclosed").length;
  // v3 D4: abstention is derived, never chosen. A frame headline id that is
  // disputed/conditional must appear in the abstract as "we could not
  // determine <observable> (…)": no number, the routes' values, the
  // discriminator. With the sentence present the row no longer blocks the
  // abstract and does not count toward the disclosure cap.
  const abstractText = readAbstract(projectDir);
  const frameParsed = parseFrameHeadlineDetailed(projectDir);
  const frameIds = frameParsed.ids;
  const abstain = rows.filter((r) => frameIds.includes(r.id) && (r.status === "disputed" || r.status === "conditional")).map((r) => {
    const obs = r.observable ?? r.id;
    const legs = r.estimates.filter((e) => e.kind === "own" || e.kind === "replication" || e.kind === "xval").slice(0, 3).map((e) => `${e.route ? e.route.split(/[,;(]/)[0].trim().slice(0, 40) : e.source.split(":")[0]} gives ${e.value}${e.sigma !== undefined ? ` ± ${e.sigma}` : ""}`);
    const disc = rev.discriminators.find((d) => d.id === r.id)?.text.replace(/^DISCRIMINATOR:\s*\S+\s*[—–-]+\s*/, "").slice(0, 160);
    const sentence = `we could not determine ${obs}${legs.length ? ` (${legs.join("; ")})` : ""}${disc ? `; the discriminating computation is: ${disc}` : ""}.`;
    return { id: r.id, observable: obs, sentence, satisfied: abstractAbstains(abstractText, r.id, obs) };
  });
  return {
    abstain,
    rows, verdicts: vRows, headline: [...headline].sort(), headlineDeclared: [...headlineDeclared].sort(), frameHeadline: frameParsed.ids,
    frameNonScalar: frameParsed.nonScalar, frameHeadlineSkipped: frameParsed.skipped,
    premisesUnused: parseFramePremises(projectDir).map((p) => p.id).filter((pid) => !known.has(pid) && !decls.some((d) => pid in d.inputs)),
    malformed, notes, readsDrops, declared, decls, discriminators: rev.discriminators, disclosedHeadlineCount,
  };
}

// ── gate + render ──────────────────────────────────────────────────────────

export interface ClaimIssue { blocking: boolean; text: string }

const LEGAL_MOVES = `Legal moves: run the discriminating computation (a comparable independent estimate under the same quantity id), a blind replication (spawn_agent(agent="replicator", MODE: "replicate")), or a countersigned disclosure (CLAIM-DISCLOSE in notes/memory.md + DISCLOSE-OK from a reviewer or the PI).`;

/** Finish-gate issues (design §3.4, §3.6, §3.9). Empty for legacy projects (no declarations). */
export function claimTableIssues(projectDir: string, table: ClaimTable = buildClaimTable(projectDir)): ClaimIssue[] {
  if (!table.declared) return [];
  const issues: ClaimIssue[] = [];
  // v3 D4: a disputed/conditional frame headline id must be abstained on in the abstract.
  for (const a of table.abstain) {
    if (a.satisfied) continue;
    issues.push({ blocking: true, text: `[abstain] ${a.id} is ${table.rows.find((r) => r.id === a.id)?.status} and is a frame headline quantity: the abstract must abstain on it in so many words — paste (no number for it anywhere in the abstract): "${a.sentence}" An abstention is derived from the table; it is neither a disclosure nor a claim, and with the sentence present the row no longer blocks the abstract.` });
  }
  // v3 D1: an open reviewer finding must reach the ledger before finish.
  for (const f of openReviewFindings(projectDir).values()) {
    if (f.answered || f.quoted) continue;
    issues.push({ blocking: true, text: `[review-open] ${f.experiment}: the latest experiment_reviewer round (${f.round}) voted REVISE and its finding never reached the ledger: "${f.sentence.slice(0, 200)}". In the experiment's L2 section (### Limitations) add either \`finding_answered: <one clause> — <locator: path:line | job_id | results.json key>\` (then the quantities lift from indicative) or \`finding_open: "<the reviewer's sentence, verbatim>"\` (ships with the flaw disclosed). A diagnosed flaw that stays in a spawn result is the 82.5 % failure.` });
  }
  if (table.malformed.length > 0) issues.push({ blocking: true, text: `Malformed quantity declarations:\n  - ${table.malformed.join("\n  - ")}` });
  for (const d of table.readsDrops) issues.push({ blocking: true, text: `Verdict reads-diff: ${d}. Name the replacement in verdicts[].replaces (it must be a quantity this verdict reads) or restore the read.` });
  // Premises that never entered the evidence (non-blocking; v2 2026-08-29).
  // Consumer for parseFrameHeadlineDetailed().skipped: a headline bullet that
  // carried no parseable id used to become a phantom obligation id (the
  // `Named` livelock); now it is dropped, and saying so here is what keeps the
  // drop from being silent in the other direction.
  if (table.frameHeadlineSkipped.length > 0) issues.push({ blocking: false, text: `notes/frame.md "## Headline quantities" has ${table.frameHeadlineSkipped.length} bullet(s) with no parseable quantity id, so they carry no obligation: ${table.frameHeadlineSkipped.map((s) => `"${s}"`).join("; ")}. If one of those names a real headline number, rewrite it as \`- \\\`the_id\\\` — observable\`; if it is prose (a non-scalar deliverable, a note), leave it — it is correctly ignored.` });
  if (table.premisesUnused.length > 0) issues.push({ blocking: false, text: `Premise(s) from notes/frame.md entered no experiment: ${table.premisesUnused.join(", ")}. A premise is not free — declare it as an \`inputs\` value under that id in the experiments that rely on it, or make it a headline quantity whose cost is computed (e.g. flat-top beam → residual Rabi inhomogeneity → fidelity loss). A referee will ask.` });
  if (table.disclosedHeadlineCount > 1) issues.push({ blocking: true, text: `${table.disclosedHeadlineCount} headline quantities are DISCLOSED disputes. A report resting on more than one disclosed dispute is a review request, not a report — escalate to the operator (notes/escalations/needs-operator.md) instead of shipping.` });
  let claims: any[] = [];
  try { claims = JSON.parse(readFileSync(join(projectDir, "report", "claims.json"), "utf-8")); } catch { claims = []; }
  if (Array.isArray(claims)) {
    const rowById = new Map(table.rows.map((r) => [r.id, r]));
    const keyToRow = new Map<string, ClaimRow>();
    for (const row of table.rows) for (const est of row.estimates) if (est.kind === "own") keyToRow.set(est.source.split(":").slice(1).join(":"), row);
    const bad = new Set<ClaimStatus>(["disputed", "conditional"]);
    for (const c of claims) {
      const key = String(c?.claim_key ?? "");
      const qid = typeof c?.quantity_id === "string" ? c.quantity_id : "";
      let row = (qid && rowById.get(qid)) || (key ? keyToRow.get(key) : undefined);
      const ctx = String(c?.tex_context ?? "").slice(0, 60);
      // Value-level match: a disputed/conditional number re-keyed or re-named
      // is still that number (audit C3).
      if (!row) {
        const cv = Number(c?.value);
        // v2 plan P0.4: a round number ("2.0 μm", "0.99") is not evidence of
        // re-keying unless it sits next to the disputed id's name, and a
        // number that IS another quantity's own estimate never matches.
        const sig = Number.isFinite(cv) ? String(Math.abs(cv)).replace(/^0\.0*|\./g, "").replace(/e.*$/i, "").replace(/^0+/, "").length : 0;
        const ownOfOther = (r: ClaimRow) => table.rows.some((o) => o.id !== r.id && o.estimates.some((e) => e.kind === "own" && relDiff(e.value, cv) <= 5e-3));
        if (Number.isFinite(cv) && cv !== 0) {
          const ctxFull = String(c?.tex_context ?? "");
          for (const r of table.rows) {
            if (!bad.has(r.status)) continue;
            const adjacent = ctxFull.includes(r.id);
            if (sig < 3 && !adjacent) continue;
            if (ownOfOther(r)) continue;
            if (r.estimates.some((e) => [cv, cv / 100, cv * 100].some((v) => relDiff(v, e.value) <= 5e-3))) { row = r; break; }
          }
        }
        if (!row) continue;
        issues.push({ blocking: true, text: `"${ctx}" carries a value equal to an estimate of ${row.id} (status ${row.status}) under a different key — the same number under another name inherits the status. ${LEGAL_MOVES}` });
        continue;
      }
      if (!row.headline) issues.push({ blocking: true, text: `"${ctx}" cites ${row.id}, which is outside the headline set (${table.headline.join(", ") || "empty"}). Add it to notes/frame.md "Headline quantities" or mark headline:true — the set never widens silently.` });
      if (bad.has(row.status)) issues.push({ blocking: true, text: `"${ctx}" cites ${row.id} whose status is ${row.status} (${row.reasons.slice(-2).join("; ")}). ${LEGAL_MOVES}` });
    }
    if (claims.length > 0 && table.headline.length === 0) issues.push({ blocking: true, text: `claims.json carries ${claims.length} entries but the headline set is empty — declare headline quantity ids in notes/frame.md.` });
  }
  return issues;
}

/** Compact, deterministic rendering (headline rows first; bounded). */
export function renderClaimTable(table: ClaimTable, maxRows = 12): string {
  if (!table.declared && table.malformed.length === 0) return "";
  const fmt = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)) ? v.toExponential(3) : String(Number(v.toPrecision(5)));
  const rows = [...table.rows].sort((a, b) => Number(b.headline) - Number(a.headline) || a.id.localeCompare(b.id)).slice(0, maxRows);
  const lines = rows.map((r) => {
    const ests = r.estimates.map((e) => `${e.source.split(":")[0]}${e.kind === "own" ? "" : ":" + e.kind}=${fmt(e.value)}${e.sigma !== undefined ? "±" + fmt(e.sigma) : ""}`).join(" ");
    return `- ${r.id}${r.headline ? " [H]" : ""} ${r.status.toUpperCase()}  ${ests}${r.reasons.length ? `\n    ${r.reasons[r.reasons.length - 1]}` : ""}`;
  });
  for (const v of table.verdicts) lines.push(`- verdict ${v.id} ${v.status.toUpperCase()} reads: ${v.reads.join(", ")}`);
  for (const d of table.readsDrops) lines.push(`- READS-DROP ${d}`);
  for (const m of table.malformed) lines.push(`- MALFORMED ${m}`);
  for (const n of table.notes.slice(0, 4)) lines.push(`- NOTE ${n}`);
  const hidden = table.rows.length - rows.length;
  const satisfiedAbstain = new Set(table.abstain.filter((a) => a.satisfied).map((a) => a.id));
  const bad = table.rows.filter((r) => r.headline && (r.status === "disputed" || r.status === "conditional") && !satisfiedAbstain.has(r.id));
  const frontier = table.discriminators.filter((d) => bad.some((r) => r.id === d.id)).slice(0, 3).map((d, i) => `frontier[${i + 1}]: ${d.text.slice(0, 200)}`);
  return `<claim_status>\n${lines.join("\n")}${hidden > 0 ? `\n(+ ${hidden} non-headline rows not shown)` : ""}` +
    (frontier.length ? `\n${frontier.join("\n")}` : "") +
    `\nship: ${bad.length === 0 ? "no headline quantity disputed/conditional" : `${bad.length} headline quantit${bad.length === 1 ? "y" : "ies"} disputed/conditional → abstract blocked (${bad.map((r) => r.id).join(", ")})`}; discloses used: ${table.disclosedHeadlineCount}/1${table.abstain.length ? `; abstentions: ${table.abstain.map((a) => `${a.id}${a.satisfied ? " (in abstract)" : " (SENTENCE MISSING)"}`).join(", ")}` : ""}\n</claim_status>`;
}
