/**
 * Claim table — quantity-level research state, computed from disk.
 *
 * Design: notes/design-claims-first.md (Draft 2.1, debate-adjudicated
 * 2026-08-26). The unit of state is the QUANTITY: a named observable with
 * project-wide identity (`computed.quantities[].id`), a history of estimates
 * (own value, harvested cross_validation value_b, other experiments' same-id
 * values, reviewer blind estimates, replication results), and a status
 * computed from those estimates — never from a self-reported verdict.
 *
 * Holes this closes (architecture-review-2026-08-26.md, §1):
 *   H1 identity across experiments   → `id` shared across results.json files
 *   H2 producer self-resolves        → no disposition field is read from the
 *                                       producer; disputes are facts
 *   H3 wiring counts as corroboration→ wiring computed (1e-6 / same script /
 *                                       same experiment), never declared
 *   H4 no observable definition      → `observable` carried; the mechanical
 *                                       checks are `inputs` by VALUE and the
 *                                       verdict reads-diff
 *   H5 reviewers do not estimate     → ESTIMATE(blind)/SCALING/INDEPENDENT/
 *                                       ANCHOR-OK lines parsed from reviews/
 *
 * Consumers (named per the producer-consumer rule): report-integrity.ts
 * (claim-status gate, grandfathered: only when quantities[] exist),
 * scripts/smoke_claim_table*.mts (fixtures/claims-297nm), and — only after
 * the <open_discrepancies> prior check shows dispatch changes — the brain's
 * L3 <claim_status> block.
 *
 * Every malformed producer row becomes a MALFORMED line in the table. This
 * module never returns "" on a parse failure: the try/catch-return-"" shape
 * of dynamics.ts is the anti-pattern (a crash and "nothing to report" must
 * not be the same string).
 *
 * Not yet in v1 (documented gaps, see design §7): literature estimates with
 * locators, replication agent results, flag-answer round, countersigner
 * agent-id check, the L3 table itself.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listExperimentDirs } from "./tools/report-integrity.js";

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
  /** "own" | "xval" | "blind" | "posthoc" | "replication" | "literature" */
  kind: string;
  /** Provenance label, e.g. "E5:computed.master_equation.leakage_40MHz" */
  source: string;
  experiment?: string;
  script?: string;
  inputs?: Record<string, number>;
  /** Literature / benchmark anchor locator, when the producer supplied one. */
  anchor?: string;
}

export type ClaimStatus = "corroborated" | "converging" | "indicative" | "conditional" | "disputed" | "disclosed";

export interface ClaimRow {
  id: string;
  status: ClaimStatus;
  headline: boolean;
  estimates: Estimate[];
  /** Human-readable reasons behind the status, deterministic order. */
  reasons: string[];
  observable?: string;
  /** Ids this quantity depends on (union of declared inputs). */
  inputs: string[];
}

export interface ClaimTable {
  rows: ClaimRow[];
  verdicts: { id: string; status: ClaimStatus; reads: string[]; experiments: string[] }[];
  headline: string[];
  malformed: string[];
  /** Verdict reads dropped between experiments without a stated replacement. */
  readsDrops: string[];
  /** True when at least one experiment declared quantities (else legacy). */
  declared: boolean;
  /** Every quantity declaration, for consumers that need producer scope (claims-review.ts). */
  decls: QuantityDecl[];
}

// ── parsing ────────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function leafAt(obj: any, dotted: string): unknown {
  // "computed.a.b[2].c" — arrays index as [i]
  const parts = dotted.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

interface Parsed { quantities: QuantityDecl[]; verdicts: VerdictDecl[]; estimates: Estimate[]; malformed: string[] }

function parseExperiment(id: string, j: any): Parsed {
  const out: Parsed = { quantities: [], verdicts: [], estimates: [], malformed: [] };
  const computed = j?.computed;
  if (!computed || typeof computed !== "object") return out;
  const qs = computed.quantities;
  if (qs !== undefined && !Array.isArray(qs)) out.malformed.push(`${id}: computed.quantities is not an array`);
  for (const [i, q] of (Array.isArray(qs) ? qs : []).entries()) {
    if (!q || typeof q !== "object" || typeof q.id !== "string" || typeof q.key !== "string") {
      out.malformed.push(`${id}: quantities[${i}] lacks string id/key`);
      continue;
    }
    const decl: QuantityDecl = {
      id: q.id, key: q.key, experiment: id, headline: q.headline === true,
      observable: typeof q.observable === "string" ? q.observable : undefined,
      inputs: {},
    };
    if (q.uncertainty !== undefined) {
      const u = num(q.uncertainty);
      if (u === undefined || u <= 0) out.malformed.push(`${id}: quantities[${i}] (${q.id}) uncertainty must be a positive number, got ${JSON.stringify(q.uncertainty)}`);
      else decl.uncertainty = u;
    }
    if (typeof q.uncertainty_source === "string") decl.uncertaintySource = q.uncertainty_source;
    if (q.limit_check !== undefined) {
      const lc = q.limit_check;
      const exp = num(lc?.expected), obs = num(lc?.observed);
      if (!lc || typeof lc !== "object" || typeof lc.limit !== "string" || exp === undefined || obs === undefined) {
        out.malformed.push(`${id}: quantities[${i}] (${q.id}) limit_check needs {limit, expected:number, observed:number}`);
      } else decl.limitCheck = { limit: lc.limit, expected: exp, observed: obs, artifact: typeof lc.artifact === "string" ? lc.artifact : undefined };
    }
    if (q.inputs !== undefined) {
      if (!q.inputs || typeof q.inputs !== "object" || Array.isArray(q.inputs)) {
        out.malformed.push(`${id}: quantities[${i}] (${q.id}) inputs must be an object {id: value}`);
      } else {
        for (const [k, v] of Object.entries(q.inputs)) {
          const n = num(v);
          if (n === undefined) out.malformed.push(`${id}: quantities[${i}] (${q.id}) inputs.${k} must be a number (values, not ids)`);
          else decl.inputs[k] = n;
        }
      }
    }
    const v = num(leafAt(j, q.key));
    if (v === undefined) out.malformed.push(`${id}: quantities[${i}] (${q.id}) key ${q.key} is not a finite number in results.json`);
    else decl.value = v;
    out.quantities.push(decl);
    if (v !== undefined) {
      out.estimates.push({ quantity: q.id, value: v, sigma: decl.uncertainty, kind: "own", source: `${id}:${q.key}`, experiment: id, script: `${id}:own`, inputs: decl.inputs });
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
    if (v.replaces && typeof v.replaces === "object") for (const [a, b] of Object.entries(v.replaces)) if (typeof b === "string") replaces[a] = b;
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
      quantity: qid, value: b, sigma: num(x?.sigma_b), kind: "xval",
      source: `${id}:xval:${String(x?.method_b ?? "?").slice(0, 40)}`, experiment: id,
      script: typeof x?.artifact_b === "string" ? x.artifact_b : undefined,
      inputs: (x?.inputs_b && typeof x.inputs_b === "object") ? x.inputs_b : undefined,
      anchor: typeof x?.anchor === "string" ? x.anchor : undefined,
    });
  }
  return out;
}

export interface ReviewerLines {
  blind: Estimate[];
  posthoc: Estimate[];
  scaling: { id: string; expected: number; observed?: number }[];
  independent: Set<string>;
  anchorOk: Set<string>;
  discloseOk: Set<string>;
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;

/** Parse reviewer/PI lines from every reviews/*.md (design §3.5). */
export function parseReviewerLines(projectDir: string): ReviewerLines {
  const out: ReviewerLines = { blind: [], posthoc: [], scaling: [], independent: new Set(), anchorOk: new Set(), discloseOk: new Set() };
  const dir = join(projectDir, "reviews");
  if (!existsSync(dir)) return out;
  const est = new RegExp(String.raw`^\s*ESTIMATE(\(blind\))?:\s*(\S+)\s+[—-]+\s*(${NUM})(?:\s*(?:±|\+/-)\s*(${NUM}))?\s*(?:via\s+(.*?))?(?:\s+[—-]+\s*inputs:\s*(.*))?\s*$`);
  const sc = new RegExp(String.raw`^\s*SCALING:\s*(\S+)\s+[—-]+\s*expected\s+(${NUM})\s+in\s+\S+;\s*observed\s+(${NUM}|not swept)`);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    let text = "";
    try { text = readFileSync(join(dir, f), "utf-8"); } catch { continue; }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      let m = line.match(est);
      if (m) {
        const inputs: Record<string, number> = {};
        let producerSupplied = false;
        if (m[6]) {
          for (const tok of m[6].split(/[,\s\[\]]+/).filter(Boolean)) {
            const kv = tok.split("=");
            if (kv.length === 2 && num(Number(kv[1])) !== undefined) inputs[kv[0]] = Number(kv[1]);
            if (/^producer$/i.test(tok)) producerSupplied = true;
          }
        }
        const e: Estimate = { quantity: m[2], value: Number(m[3]), sigma: m[4] ? Number(m[4]) : undefined, kind: m[1] ? "blind" : "posthoc", source: `review:${f}`, script: `review:${f}:${m[5] ?? ""}`, inputs, anchor: undefined };
        if (producerSupplied) e.kind = "posthoc"; // entirely producer-supplied inputs never flag (design §3.5)
        (e.kind === "blind" ? out.blind : out.posthoc).push(e);
        continue;
      }
      m = line.match(sc);
      if (m) { out.scaling.push({ id: m[1], expected: Number(m[2]), observed: m[3] === "not swept" ? undefined : Number(m[3]) }); continue; }
      m = line.match(/^INDEPENDENT:\s*(\S+)/); if (m) { out.independent.add(m[1]); continue; }
      m = line.match(/^ANCHOR-OK:\s*(\S+)/); if (m) { out.anchorOk.add(m[1]); continue; }
      m = line.match(/^DISCLOSE-OK:\s*(\S+)/); if (m) { out.discloseOk.add(m[1]); continue; }
    }
  }
  return out;
}

/** Headline ids named in notes/frame.md under a "Headline quantities" heading. */
export function parseFrameHeadline(projectDir: string): string[] {
  let text = "";
  try { text = readFileSync(join(projectDir, "notes", "frame.md"), "utf-8"); } catch { return []; }
  // No `m` flag: with it, `$` matches every line end and the lazy body stops at
  // the first blank line (observed: the fixture's four ids parsed as none).
  const m = text.match(/(?:^|\n)##+[ \t]*Headline quantities[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (!m) return [];
  const ids: string[] = [];
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s*[-*]\s*`?([A-Za-z0-9_]+)`?/);
    if (mm) ids.push(mm[1]);
  }
  return ids;
}

function parseDisclosures(projectDir: string): Set<string> {
  const out = new Set<string>();
  try {
    const mem = readFileSync(join(projectDir, "notes", "memory.md"), "utf-8");
    for (const m of mem.matchAll(/^CLAIM-DISCLOSE:\s*(\S+)/gm)) out.add(m[1]);
  } catch { /* no memory */ }
  return out;
}

// ── comparison rules (design §3.3, §3.4) ───────────────────────────────────

const WIRING_REL = 1e-6;
const SIGMA_K = 2;
const NO_SIGMA_DISPUTE_RATIO = 3;
const SCALING_TOL = 0.5;

function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

export type PairRelation = "wiring" | "incomparable" | "comparable";

export function relation(a: Estimate, b: Estimate): { rel: PairRelation; differing: string[] } {
  if (relDiff(a.value, b.value) < WIRING_REL) return { rel: "wiring", differing: [] };
  if (a.script && b.script && a.script === b.script) return { rel: "wiring", differing: [] };
  const differing: string[] = [];
  if (a.inputs && b.inputs) {
    for (const k of Object.keys(a.inputs)) {
      if (k in b.inputs && relDiff(a.inputs[k], b.inputs[k]) > WIRING_REL) differing.push(k);
    }
  }
  if (differing.length > 0) return { rel: "incomparable", differing };
  return { rel: "comparable", differing: [] };
}

/** "agree" | "disagree" | "undecidable" (missing sigma and within 3x). */
export function agreement(a: Estimate, b: Estimate): "agree" | "disagree" | "undecidable" {
  if (a.sigma !== undefined && b.sigma !== undefined) {
    const s = Math.sqrt(a.sigma * a.sigma + b.sigma * b.sigma);
    return Math.abs(a.value - b.value) <= SIGMA_K * s ? "agree" : "disagree";
  }
  const hi = Math.max(Math.abs(a.value), Math.abs(b.value)), lo = Math.min(Math.abs(a.value), Math.abs(b.value));
  if (lo === 0 ? hi > 0 : hi / lo > NO_SIGMA_DISPUTE_RATIO) return "disagree";
  if (Math.sign(a.value) !== Math.sign(b.value) && a.value !== 0 && b.value !== 0) return "disagree";
  return "undecidable";
}

// ── the table ──────────────────────────────────────────────────────────────

export function buildClaimTable(projectDir: string): ClaimTable {
  const decls: QuantityDecl[] = [];
  const verdicts: VerdictDecl[] = [];
  const estimates: Estimate[] = [];
  const malformed: string[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    if (!e.latestResults) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); }
    catch (err) { malformed.push(`${e.id}: results.json unparseable (${(err as Error).message.slice(0, 60)})`); continue; }
    const p = parseExperiment(e.id, j);
    decls.push(...p.quantities); verdicts.push(...p.verdicts); estimates.push(...p.estimates); malformed.push(...p.malformed);
  }
  // Replicator results (design §3.6.2): data/experiments/<dir>/replication/results.json.
  for (const e of listExperimentDirs(projectDir)) {
    const p = join(e.dir, "replication", "results.json");
    if (!existsSync(p)) continue;
    try {
      const r = JSON.parse(readFileSync(p, "utf-8"));
      const v = num(r?.value);
      if (typeof r?.quantity !== "string" || v === undefined) { malformed.push(`${e.id}: replication/results.json needs {quantity: string, value: number}`); continue; }
      const inputs: Record<string, number> = {};
      if (r?.inputs && typeof r.inputs === "object") for (const [k, x] of Object.entries(r.inputs)) { const n = num(x); if (n !== undefined) inputs[k] = n; }
      estimates.push({ quantity: r.quantity, value: v, sigma: num(r?.sigma), kind: "replication", source: `${e.id}:replication`, experiment: e.id, script: `replication:${e.id}:${String(r?.script ?? "")}`, inputs });
    } catch (err) { malformed.push(`${e.id}: replication/results.json unparseable (${(err as Error).message.slice(0, 60)})`); }
  }
  const declared = decls.length > 0 || verdicts.length > 0;
  const rev = parseReviewerLines(projectDir);
  estimates.push(...rev.blind, ...rev.posthoc);
  const disclosures = parseDisclosures(projectDir);

  const ids = [...new Set([...decls.map((d) => d.id), ...estimates.map((e) => e.quantity)])].sort();
  const declsById = new Map<string, QuantityDecl[]>();
  for (const d of decls) declsById.set(d.id, [...(declsById.get(d.id) ?? []), d]);

  // Headline set: frame.md ∪ headline:true ∪ reads of in-set verdicts ∪ propagation targets (added below).
  const headline = new Set<string>([...parseFrameHeadline(projectDir), ...decls.filter((d) => d.headline).map((d) => d.id)]);
  const verdictById = new Map<string, VerdictDecl[]>();
  for (const v of verdicts) verdictById.set(v.id, [...(verdictById.get(v.id) ?? []), v]);
  for (const [vid, vs] of verdictById) if (headline.has(vid)) for (const v of vs) for (const r of v.reads) headline.add(r);
  // Load-bearing closure: every declared input of a headline quantity is
  // itself headline (transitively) — the number the abstract rests on is the
  // one that must be reviewed, whatever key it sits under (E5's leakage was
  // never in the abstract; E6's fidelity built on it was).
  {
    const inputsOfId = (id: string) => (declsById.get(id) ?? []).flatMap((d) => Object.keys(d.inputs));
    const known = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of [...headline]) for (const up of inputsOfId(id)) if (known.has(up) && !headline.has(up)) { headline.add(up); grew = true; }
    }
  }

  // Pass 1: per-quantity intrinsic status from estimate pairs.
  type Intr = { status: ClaimStatus; reasons: string[]; propagate: string[] };
  const intrinsic = new Map<string, Intr>();
  for (const id of ids) {
    const es = estimates.filter((e) => e.quantity === id);
    const reasons: string[] = [];
    const propagate: string[] = [];
    let disputed = false, agreeingPair = false, anchoredAgree = false;
    const producers = es.filter((e) => e.kind !== "blind" && e.kind !== "posthoc");
    for (let i = 0; i < producers.length; i++) for (let k = i + 1; k < producers.length; k++) {
      const a = producers[i], b = producers[k];
      const { rel, differing } = relation(a, b);
      const ag = agreement(a, b);
      if (rel === "wiring") { if (ag === "agree" || ag === "undecidable") reasons.push(`wiring: ${a.source} ≈ ${b.source}`); continue; }
      if (rel === "incomparable") {
        reasons.push(`incomparable: ${a.source} vs ${b.source} differ in inputs ${differing.join(",")}`);
        if (ag === "disagree") { propagate.push(...differing); reasons.push(`dispute propagated to ${differing.join(",")}`); }
        continue;
      }
      if (ag === "disagree") { disputed = true; reasons.push(`disagree: ${a.source}=${a.value} vs ${b.source}=${b.value}`); }
      else if (ag === "agree") {
        const attested = !headline.has(id) || rev.independent.has(id);
        if (attested) {
          agreeingPair = true;
          if (a.anchor || b.anchor) anchoredAgree = true;
          reasons.push(`agree: ${a.source} ~ ${b.source}${a.anchor || b.anchor ? " (anchored)" : ""}`);
        } else reasons.push(`agree but unattested (no INDEPENDENT line): ${a.source} ~ ${b.source}`);
      } else reasons.push(`undecidable (missing σ): ${a.source} vs ${b.source}`);
    }
    // Reviewer blind estimates: flag → disputed (v1: no answer round yet).
    const own = producers.find((e) => e.kind === "own");
    for (const bl of rev.blind.filter((e) => e.quantity === id)) {
      if (own && agreement(own, bl) === "disagree") { disputed = true; reasons.push(`blind reviewer estimate ${bl.value} disagrees with ${own.source}=${own.value} (unanswered)`); }
    }
    // Scaling exponent mismatch.
    for (const s of rev.scaling.filter((s) => s.id === id)) {
      if (s.observed !== undefined && Math.abs(s.observed - s.expected) > SCALING_TOL) { disputed = true; reasons.push(`scaling: observed exponent ${s.observed} vs expected ${s.expected}`); }
    }
    // Limit check counts as anchor only when reviewer attested ANCHOR-OK.
    for (const d of declsById.get(id) ?? []) {
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
    intrinsic.set(id, { status, reasons, propagate });
  }
  // Propagation: an incomparable disagreement disputes the differing upstream id (and pulls it into headline).
  for (const [id, intr] of intrinsic) for (const up of intr.propagate) {
    headline.add(up);
    const t = intrinsic.get(up) ?? { status: "indicative", reasons: [], propagate: [] };
    if (t.status !== "disputed" && t.status !== "disclosed") { t.status = "disputed"; t.reasons.push(`disputed by propagation from ${id}`); }
    intrinsic.set(up, t);
  }
  // Pass 2: conditional via inputs (disputed upstream) — fixed point.
  const RANK: Record<ClaimStatus, number> = { corroborated: 5, converging: 4, indicative: 3, conditional: 2, disclosed: 1, disputed: 0 };
  const inputsOf = (id: string) => [...new Set((declsById.get(id) ?? []).flatMap((d) => Object.keys(d.inputs)))];
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
  // Verdicts inherit the minimum status of what they read.
  const vRows = [...verdictById.entries()].sort().map(([vid, vs]) => {
    const reads = [...new Set(vs.flatMap((v) => v.reads))];
    let status: ClaimStatus = "corroborated";
    for (const r of reads) { const s = intrinsic.get(r)?.status ?? "indicative"; if (RANK[s] < RANK[status]) status = s; }
    if (status === "disputed" || status === "disclosed") status = "conditional";
    return { id: vid, status, reads, experiments: vs.map((v) => v.experiment) };
  });
  // Reads-diff: a verdict declared by several experiments must not silently drop a read.
  const readsDrops: string[] = [];
  for (const [vid, vs] of verdictById) {
    const sorted = [...vs].sort((a, b) => a.experiment.localeCompare(b.experiment, undefined, { numeric: true }));
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Set(sorted[i - 1].reads), cur = sorted[i];
      for (const r of prev) if (!cur.reads.includes(r) && !(r in cur.replaces)) readsDrops.push(`${vid}: ${cur.experiment} dropped read ${r} (present in ${sorted[i - 1].experiment}) with no replaces entry`);
    }
  }
  return { rows, verdicts: vRows, headline: [...headline].sort(), malformed, readsDrops, declared, decls };
}

// ── gate + render ──────────────────────────────────────────────────────────

export interface ClaimIssue { blocking: boolean; text: string }

/** Finish-gate issues (design §3.4, §3.8, §3.9). Empty for legacy projects (no declarations). */
export function claimTableIssues(projectDir: string, table: ClaimTable = buildClaimTable(projectDir)): ClaimIssue[] {
  if (!table.declared) return [];
  const issues: ClaimIssue[] = [];
  if (table.malformed.length > 0) issues.push({ blocking: true, text: `Malformed quantity declarations:\n  - ${table.malformed.join("\n  - ")}` });
  for (const d of table.readsDrops) issues.push({ blocking: true, text: `Verdict reads-diff: ${d}. Name the replacement in verdicts[].replaces or restore the read.` });
  // Abstract legality: claims.json entries whose claim_key maps to a declared quantity.
  let claims: any[] = [];
  try { claims = JSON.parse(readFileSync(join(projectDir, "report", "claims.json"), "utf-8")); } catch { claims = []; }
  if (Array.isArray(claims)) {
    const keyToRow = new Map<string, ClaimRow>();
    for (const row of table.rows) for (const est of row.estimates) if (est.kind === "own") keyToRow.set(est.source.split(":").slice(1).join(":"), row);
    for (const c of claims) {
      const key = String(c?.claim_key ?? "");
      const row = key ? keyToRow.get(key) : undefined;
      if (!row) continue;
      const ctx = String(c?.tex_context ?? "").slice(0, 60);
      if (!row.headline) issues.push({ blocking: true, text: `"${ctx}" cites ${row.id}, which is outside the headline set (${table.headline.join(", ") || "empty"}). Add it to notes/frame.md "Headline quantities" or mark headline:true — the set never widens silently.` });
      if (row.status === "disputed" || row.status === "conditional") {
        issues.push({ blocking: true, text: `"${ctx}" cites ${row.id} whose status is ${row.status} (${row.reasons.slice(-2).join("; ")}). Legal moves: run the discriminating computation (a comparable independent estimate), a blind replication, or a countersigned disclosure (CLAIM-DISCLOSE in notes/memory.md + DISCLOSE-OK by a non-producer reviewer).` });
      }
    }
    const abstractNumbers = claims.length;
    if (abstractNumbers > 0 && table.headline.length === 0) issues.push({ blocking: true, text: `claims.json carries ${abstractNumbers} entries but the headline set is empty — declare headline quantity ids in notes/frame.md.` });
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
  const hidden = table.rows.length - rows.length;
  const bad = table.rows.filter((r) => r.headline && (r.status === "disputed" || r.status === "conditional"));
  return `<claim_status>\n${lines.join("\n")}${hidden > 0 ? `\n(+ ${hidden} non-headline rows not shown)` : ""}\nship: ${bad.length === 0 ? "no headline quantity disputed/conditional" : `${bad.length} headline quantit${bad.length === 1 ? "y" : "ies"} disputed/conditional → abstract blocked (${bad.map((r) => r.id).join(", ")})`}\n</claim_status>`;
}
