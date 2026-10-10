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
 *                                       DISCLOSE-OK lines parsed —
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

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join, basename } from "node:path";
import { listExperimentDirs } from "./tools/report-integrity.js";
import { openReviewFindings, reviewOpenIssues, routeConfessesDependence, sameRoute } from "./claims-review.js";
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
  /** Unit token written after a reviewer line's value or σ ("MHz", "s⁻¹"); shown, never compared. */
  unit?: string;
}

// `corroborated` was removed 2026-09-04. It sat above `converging` and required
// an anchor, whose reviewer route (ANCHOR-OK) was marked OPTIONAL in
// experiment_reviewer.md and consequently emitted for 1 of 49 headline ids.
// Measured across every claims-first project (probe-claims, pp-vs-ss, ba-neutral
// atom): 75 rows, 0 corroborated. No code ever branched on it either — the gates
// read `disputed`/`conditional` — so it was an unreachable rung that nothing
// consumed, shown to brain each turn as a goalpost it could not reach.
// `converging` (agreeing pair + σ) is now the top status. Anchors still appear
// in `reasons` as "(anchored)"; they no longer change status. ANCHOR-OK itself
// is no longer parsed: it decided nothing, and its limit_check nag was the
// rendered reason of disputed rows, hiding the dispute.
// NOTE: report/claims.json has its OWN unrelated `corroborated` grade, computed
// by xvalVerdict from computed.cross_validation. That one is live — do not
// conflate them.
export type ClaimStatus = "converging" | "indicative" | "conditional" | "disputed" | "disclosed";

export interface ClaimRow {
  id: string;
  status: ClaimStatus;
  headline: boolean;
  estimates: Estimate[];
  reasons: string[];
  /** The reason that set `status` (a dispute, a cap, a conditional input); absent when nothing moved it off the default. Rendered and cited instead of the last reason, which is often a σ note. */
  cause?: string;
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
  /** ESTIMATE lines in harness review files that do not parse, as "reviews/<file>: <text>". Non-blocking: those files are write-protected and re-read every round, so one typo must not hold finish. */
  unparsed: string[];
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

/**
 * A results.json as the harness reads it. Python's json.dump writes bare NaN,
 * Infinity and -Infinity unless given allow_nan=False, and JSON.parse rejects
 * them: 10 of 224 local experiments had no readable results.json for one
 * non-finite field, so the claim table dropped the whole experiment and the
 * review loop re-sent it as missing. Strict first; on failure those tokens,
 * outside strings, read as null, so a declaration that points at one is named
 * as not finite and the rest of the file counts. Still not JSON → throws the
 * error of that second parse: it names what still blocks reading, not a NaN
 * the harness would have accepted.
 */
export function parseResultsJson(text: string): any {
  try { return JSON.parse(text); }
  catch (err) {
    // A string is matched whole, so a token inside one is left alone.
    const tolerant = text.replace(/"(?:[^"\\]|\\.)*"|-?\b(?:NaN|Infinity)\b/g, (m) => (m[0] === '"' ? m : "null"));
    if (tolerant === text) throw err;
    return JSON.parse(tolerant);
  }
}

/** parseResultsJson on a file; undefined when the file is missing or still not JSON. */
export function readResultsJson(path: string): any {
  try { return parseResultsJson(readFileSync(path, "utf-8")); } catch { return undefined; }
}

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

interface Parsed { quantities: QuantityDecl[]; verdicts: VerdictDecl[]; estimates: Estimate[]; malformed: string[]; anchors: { key: string; value: number }[]; instanceNotes: { quantity: string; text: string }[] }

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

function fileHead(path: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, readSync(fd, buf, 0, bytes, 0)).toString("utf-8");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * True for (experiment dir, quantity) when only an estimate-mode replicator
 * ran there: its replication/results.json is the blind estimate, not a second
 * leg. Dy E2–E4 estimators wrote that file (the write scope allowed it, and
 * bash still can), and each read as an independent replication. Reads
 * transcript heads only: foreground ones open with spawn_init.templateVars,
 * background ones with the rendered system prompt's tags. A replicator not
 * marked estimate is replicate mode, and an id it lacks is a wildcard, so
 * doubt keeps the leg. A head with neither (empty, or the Session header a
 * background runner holds until its first turn_end, for good if killed in
 * that turn) names no mode at all and counts for neither side.
 */
function estimatorOnlyReplication(projectDir: string): (dir: string, quantity: string) => boolean {
  const est = new Set<string>(), rep = new Set<string>();
  const conv = join(projectDir, ".agent", "conversations");
  let names: string[] = [];
  try { names = readdirSync(conv).filter((n) => /(?:^|\.)replicator-[^.]+\.jsonl$/.test(n)); } catch { /* no conversations */ }
  const rendered = (v: string | undefined) => (v && !v.includes("{{") ? v : undefined);
  for (const n of names) {
    const lines = fileHead(join(conv, n), 16384).split("\n");
    let field: (key: "EXPERIMENT_ID" | "QUANTITY_ID" | "MODE") => string | undefined = () => undefined;
    if (/"type"\s*:\s*"spawn_init"/.test(lines[0])) field = (k) => lines[0].match(new RegExp(`"${k}"\\s*:\\s*"([^"\\\\]*)"`))?.[1];
    else {
      const sys = lines.find((l) => /"role"\s*:\s*"system"/.test(l));
      if (!sys) continue;
      const tag = { EXPERIMENT_ID: "experiment_id", QUANTITY_ID: "quantity_id", MODE: "mode" } as const;
      field = (k) => sys.match(new RegExp(`<${tag[k]}>([^<]*)</${tag[k]}>`))?.[1];
    }
    const eid = rendered(field("EXPERIMENT_ID")), q = rendered(field("QUANTITY_ID"));
    if (field("MODE") === "estimate" || n.includes(".blind-estimate-")) { if (eid && q) est.add(`${eid}\u0000${q}`); }
    else rep.add(`${eid ?? "*"}\u0000${q ?? "*"}`);
  }
  return (dir, q) => est.has(`${dir}\u0000${q}`) && ![`${dir}\u0000${q}`, `${dir}\u0000*`, `*\u0000${q}`, "*\u0000*"].some((k) => rep.has(k));
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
  const out: Parsed = { quantities: [], verdicts: [], estimates: [], malformed: [], anchors: invariantLeaves(j?.invariants), instanceNotes: [] };
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
  // Only for the same instance, though: Dy E1 filed three other clock-point
  // roots (value_a 19797.5 / 24866.8 / 48119.6) under the 3136.82 G root's
  // key, and their value_b disputed it and everything it fed. Same instance =
  // value_a within 1 % or within own σ, never the entry's tolerance_rel (the
  // producer's own pass bar); an entry without value_a is legacy and counts.
  const declByKey = new Map(out.quantities.map((q) => [q.key, q]));
  for (const x of (Array.isArray(computed.cross_validation) ? computed.cross_validation : [])) {
    const own = declByKey.get(String(x?.claim_key ?? ""));
    if (!own) continue;
    const qid = own.id;
    const b = num(x?.value_b);
    if (b === undefined) continue;
    const va = num(x?.value_a);
    if (own.value !== undefined && va !== undefined && relDiff(va, own.value) > INPUT_MATCH_REL && !(own.uncertainty !== undefined && Math.abs(va - own.value) <= own.uncertainty)) {
      out.instanceNotes.push({ quantity: qid, text: `different instance: ${id}:xval:${String(x?.method_b ?? "?").slice(0, 40)} has value_a=${va}, not ${qid}'s own ${own.value} — its value_b=${b} is not an estimate of ${qid}` });
      continue;
    }
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
//   <value> [unit] [± <σ> [unit] | (+a/−b) [unit]] [(qualifier)] [via <route>] [— inputs: [k=v, …]]
// Units and asymmetric errors arrived with the Dy run: 11 of 28 lines failed
// the unit-less grammar, among them E4's blind 207.82 MHz against the
// producer's 65.68. A unit is whitespace-preceded and starts with a letter,
// µ μ Ω Å ° or %, so a digit inside one (s^-1) is never read as σ and a
// digit-led unit (1/s) stays unparsed. Only value and σ are numbers.
// A σ in % (spaced, glued, or per side of (+a%/−b%)) is relative to a value
// that is not itself in %: "0.01 ± 30 %" is 0.01 ± 0.003. Read as an absolute
// 30 it was capped at 0.5·|v| and a 2× gap on an error rate "agreed".
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const UNUM = String.raw`(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const UNIT = String.raw`(?!via\b)[A-Za-zµμΩÅ°%](?:(?!\+/-)[^\s,;()±])*`;
const ASYM = String.raw`\(\s*\+\s*(?<sigmaPlus>${UNUM})\s*(?<plusPct>%)?\s*/\s*[-−–]\s*(?<sigmaMinus>${UNUM})\s*(?<minusPct>%)?\s*\)`;
export const ESTIMATE_LINE_RE = new RegExp(
  String.raw`^\s*ESTIMATE(?<blind>\(blind\))?:\s*(?<id>\S+)\s+[—–-]+\s+(?<value>${NUM})(?:\s+(?<unit>${UNIT}))?` +
  String.raw`(?:\s*(?:±|\+/-)\s*(?<sigma>${NUM})(?:\s+(?<sigmaUnit>${UNIT})|(?<sigmaPct>%))?|\s*${ASYM}(?:\s+(?<asymUnit>${UNIT}))?)?` +
  // A qualifier opening with + or ± is a σ that did not parse; it must not be swallowed as prose.
  String.raw`(?:\s+\((?![+±])[^)]*\))?\s*(?:via\s+(?<route>.*?))?(?:\s+[—–-]+\s*inputs:\s*(?<inputs>.*))?\s*$`,
);

export interface EstimateLine {
  blind: boolean;
  id: string;
  value: number;
  sigma?: number;
  unit?: string;
  route?: string;
  inputs: Record<string, number>;
  /** The inputs clause says "producer": the values were handed over, so the line is never a blind leg. */
  producerSupplied: boolean;
}

const isPercent = (u: string | undefined) => u === "%" || /^percent$/i.test(u ?? "");

/** One ESTIMATE / ESTIMATE(blind) line; null when it does not parse, including a value and σ in different units. */
export function parseEstimateLine(line: string): EstimateLine | null {
  const g = line.match(ESTIMATE_LINE_RE)?.groups;
  if (!g) return null;
  const sigmaUnit = g.sigmaUnit ?? g.asymUnit;
  // A % σ is relative, so it never conflicts with the value's unit.
  if (g.unit && sigmaUnit && g.unit !== sigmaUnit && !isPercent(sigmaUnit)) return null;
  const value = Number(g.value);
  const side = (s: string, pct: boolean) => (pct && !isPercent(g.unit) ? Math.abs(value) * Number(s) / 100 : Number(s));
  const inputs: Record<string, number> = {};
  let producerSupplied = false;
  for (const tok of (g.inputs ?? "").split(/[,\s\[\]]+/).filter(Boolean)) {
    const kv = tok.split("=");
    if (kv.length === 2 && Number.isFinite(Number(kv[1]))) inputs[kv[0]] = Number(kv[1]);
    if (/^producer$/i.test(tok)) producerSupplied = true;
  }
  const sigma = g.sigma !== undefined ? side(g.sigma, !!g.sigmaPct || isPercent(g.sigmaUnit))
    : g.sigmaPlus !== undefined ? Math.max(side(g.sigmaPlus, !!g.plusPct || isPercent(g.asymUnit)), side(g.sigmaMinus, !!g.minusPct || isPercent(g.asymUnit))) : undefined;
  // A σ-only unit labels the value, except a relative %.
  return { blind: !!g.blind, id: g.id, value, sigma: posNum(sigma), unit: g.unit ?? (isPercent(sigmaUnit) ? undefined : sigmaUnit), route: g.route?.trim() || undefined, inputs, producerSupplied };
}

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

// INDEPENDENT is a closed form (C41): `— shared: none|inputs|model|code|values`.
// The prefix alone used to attest, so Dy E4's "these are not independent:
// method_b reuses five of the six solver channel values" lifted the pair to
// converging. The answer list ends at end-of-line, a dash, ; . or (; anything
// else after it ("none of the code") is prose, and prose is no answer.
const INDEPENDENT_SHARED_RE = /[—–-]\s*shared:\s*([a-z]+(?:\s*,\s*[a-z]+)*)(?=\s*(?:$|[—–;.(])|\s+-(?:\s|$))/i;
/** The lower-cased `shared:` answers on an INDEPENDENT line; empty for an open-form line. */
export function independentShared(line: string): string[] {
  const m = line.replace(/[*`]/g, "").match(INDEPENDENT_SHARED_RE);
  return m ? m[1].toLowerCase().split(/\s*,\s*/) : [];
}

export interface ReviewerLines {
  blind: Estimate[];
  posthoc: Estimate[];
  scaling: { id: string; expected: number; observed?: number }[];
  /** Ids attested by an INDEPENDENT line answering exactly "shared: none". */
  independent: Set<string>;
  /** Every INDEPENDENT line, attesting or not; `shared` is empty for an open-form line. */
  independentLines: { id: string; shared: string[]; text: string }[];
  discloseOk: Set<string>;
  discriminators: { id: string; text: string }[];
  malformed: string[];
  /** ESTIMATE lines that do not parse, kept as "reviews/<file>: <text>" (never malformed: see ClaimTable.unparsed). */
  unparsed: string[];
}

/** Parse reviewer/PI lines from harness-written review files (design §3.5). */
export function parseReviewerLines(projectDir: string): ReviewerLines {
  const out: ReviewerLines = { blind: [], posthoc: [], scaling: [], independent: new Set(), independentLines: [], discloseOk: new Set(), discriminators: [], malformed: [], unparsed: [] };
  const dir = join(projectDir, "reviews");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => HARNESS_REVIEW_FILE_RE.test(f)).sort()) {
    let text = "";
    try { text = readFileSync(join(dir, f), "utf-8"); } catch (err) { out.malformed.push(`reviews/${f}: unreadable (${(err as Error).message.slice(0, 60)})`); continue; }
    const harnessReview = f.startsWith("experiment_review_");
    for (const raw of text.split("\n")) {
      // FEEDBACK is the reviewer's prose, persisted whole and last: a line in it
      // that looks like an attestation was never extracted as one, and an
      // incomplete review withholds exactly those (audit H5).
      if (harnessReview && /^FEEDBACK:/.test(raw)) break;
      const line = raw.trim();
      if (/^(?:MALFORMED-ESTIMATE:\s*)?ESTIMATE(\(blind\))?:/.test(line)) {
        // MALFORMED-ESTIMATE: is the harness's mark for a line that failed at
        // extraction; it stays text (an incomplete review persists only those,
        // with its parseable lines withheld).
        const p = line.startsWith("MALFORMED-") ? null : parseEstimateLine(line);
        if (!p) { out.unparsed.push(`reviews/${f}: ${line.slice(0, 240)}`); continue; }
        // A blind line with no `via <route>` cannot be judged (v2 plan P0.6): recorded, never flags.
        const e: Estimate = { quantity: p.id, value: p.value, sigma: p.sigma, kind: p.blind && !p.producerSupplied && p.route ? "blind" : "posthoc", source: `review:${f}`, script: `review:${f}:${p.route ?? ""}`, inputs: p.inputs, route: p.route, ...(p.unit ? { unit: p.unit } : {}) };
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
      m = line.match(/^INDEPENDENT:\s*(\S+)/);
      if (m) {
        // Recorded always, attesting only on exactly "shared: none". Any other
        // answer or open prose is recorded and never malformed: malformed blocks
        // finish, and Dy carries ten legacy open-form lines.
        const shared = independentShared(line);
        out.independentLines.push({ id: m[1], shared, text: line });
        if (shared.length === 1 && shared[0] === "none") out.independent.add(m[1]);
        continue;
      }
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
// Holds even when σ "agrees": the 50% σ cap let Dy κ532's 2.86× gap
// (+7.3e-6 vs −2.56e-6) read as a sign convention.
const SIGN_ONLY_MAX_RATIO = 1.1;

function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

export type PairRelation = "wiring" | "incomparable" | "comparable";

/** Input keys both sides quote at values more than 1 % apart: the comparability rule, shared with the review loop's blind-line reuse. */
export function differingInputs(a: Record<string, number> | undefined, b: Record<string, number> | undefined): string[] {
  const differing: string[] = [];
  if (!a || !b) return differing;
  for (const k of Object.keys(a)) {
    // Inputs are quoted, not computed: a blind line writes -0.152 for the
    // producer's -0.151863. 1% is a rounding; the 5.6× between E4's and E5's
    // blockade shift (297nm) is a different regime.
    if (k in b && relDiff(a[k], b[k]) > INPUT_MATCH_REL) differing.push(k);
  }
  return differing;
}

export function relation(a: Estimate, b: Estimate): { rel: PairRelation; differing: string[]; why?: string } {
  const bothInt = Number.isInteger(a.value) && Number.isInteger(b.value);
  if (!bothInt && relDiff(a.value, b.value) < WIRING_REL) return { rel: "wiring", differing: [] };
  if (a.script && b.script && a.script === b.script) return { rel: "wiring", differing: [] };
  // v3 D2: two names for one route are one leg; same model on the same route too.
  if (a.route && b.route && sameRoute(a.route, b.route) && (a.kind !== "own" || b.kind !== "own")) return { rel: "wiring", differing: [] };
  // …and a leg that ADMITS it re-reads / re-sums / is internal to the other is
  // not a second leg either. sameRoute (token-set equality) fired 0/64 on the
  // real corpus; this fires 4/64 with 0 false positives, 2 of them above the
  // numeric 1e-6 veto where nothing else looks. notes/route-confession-2026-09-22.md §2.
  // Words cannot outvote numbers: legs that disagree stay comparable, so the dispute shows.
  if (a.route && b.route && (a.kind !== "own" || b.kind !== "own") && agreement(a, b) !== "disagree") {
    const confession = routeConfessesDependence(a.route, b.route);
    if (confession) return { rel: "wiring", differing: [], why: confession };
  }
  const differing = differingInputs(a.inputs, b.inputs);
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
 * A sign-only disagreement: the magnitudes agree (within 10%, and within 2σ when
 * both σ are given) but the signs differ. Live run 2026-08-27: producer −138.86
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
  const hi = Math.max(ma.value, mb.value), lo = Math.min(ma.value, mb.value);
  if (hi / lo > SIGN_ONLY_MAX_RATIO) return false;
  return agreement(ma, mb) !== "disagree";
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
  const instanceNotes: { quantity: string; text: string }[] = [];
  const dirs = [...listExperimentDirs(projectDir)].sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  for (const e of dirs) {
    if (!e.latestResults) continue;
    let j: any;
    try { j = parseResultsJson(readFileSync(e.latestResults, "utf-8")); }
    catch (err) { malformed.push(`${e.id}: results.json unparseable (${(err as Error).message.slice(0, 60)})`); continue; }
    const p = parseExperiment(e.id, j);
    decls.push(...p.quantities); verdicts.push(...p.verdicts); estimates.push(...p.estimates); malformed.push(...p.malformed); instanceNotes.push(...p.instanceNotes); anchorsByExp.set(e.id, [...(anchorsByExp.get(e.id) ?? []), ...p.anchors]); dirByExp.set(e.id, basename(e.dir));
  }
  // Replicator results (design §3.6.2): data/experiments/<dir>/replication/results.json.
  const byEstimator = estimatorOnlyReplication(projectDir);
  const estimatorWrote = new Map<string, string[]>();
  for (const e of dirs) {
    const p = join(e.dir, "replication", "results.json");
    if (!existsSync(p)) continue;
    try {
      const r = parseResultsJson(readFileSync(p, "utf-8"));
      const v = num(r?.value);
      if (typeof r?.quantity !== "string" || v === undefined) { malformed.push(`${e.id}: replication/results.json needs {quantity: string, value: number}`); continue; }
      if (byEstimator(basename(e.dir), r.quantity)) {
        estimatorWrote.set(r.quantity, [...(estimatorWrote.get(r.quantity) ?? []), `${e.id}: replication/results.json written by the blind estimator — not a second leg`]);
        continue;
      }
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

  for (const [q, lines] of estimatorWrote) if (!known.has(q)) notes.push(...lines);
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

  type Intr = { status: ClaimStatus; reasons: string[]; propagate: string[]; cause?: string };
  const intrinsic = new Map<string, Intr>();
  for (const id of ids) {
    const es = estimates.filter((e) => e.quantity === id);
    // Instance notes first, so the rendered (last) reason stays the comparison's.
    const reasons: string[] = [...instanceNotes.filter((n) => n.quantity === id).map((n) => n.text), ...(estimatorWrote.get(id) ?? [])];
    const propagate: string[] = [];
    let disputed = false, agreeingPair = false;
    let anchorExfil: string | null = null;
    // Every dispute below is sufficient on its own; the last one found is the row's cause.
    let cause: string | undefined;
    const dispute = (why: string) => { disputed = true; cause = why; reasons.push(why); };
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
      const { rel, differing, why } = relation(a, b);
      const ag = agreement(a, b);
      if (rel === "wiring") { if (ag !== "disagree") reasons.push(`wiring: ${a.source} ≈ ${b.source}${why ? ` (${why})` : ""}`); continue; }
      if (rel === "incomparable") {
        reasons.push(`incomparable: ${a.source} vs ${b.source} differ in inputs ${differing.join(",")}`);
        if (ag === "disagree") { const ups = differing.filter((u) => known.has(u)); propagate.push(...ups); if (ups.length) reasons.push(`dispute propagated to ${ups.join(",")}`); }
        continue;
      }
      if (ag === "disagree") { dispute(signOnlyDisagreement(a, b) ? `sign convention: |${a.source}|=${Math.abs(a.value)} ≈ |${b.source}|=${Math.abs(b.value)} but signs differ — pin the convention in \`observable\` (e.g. "negative = attractive") and restate one estimate with a locator; a physics dispute only if the signs survive that` : `disagree: ${a.source}=${a.value} vs ${b.source}=${b.value}`); }
      else if (ag === "agree") {
        // v3 D2: a computing replication on an ASSIGNED route that differs from
        // its partner's is independent by construction (the harness chose the
        // route, the replicator never saw the producer's value) — it needs no
        // INDEPENDENT line to count as a leg.
        const computingLeg = (x: Estimate) => x.kind === "replication" && !!x.route && !!x.job && process.env.LUXAS_REPLICATE_LEGS !== "0";
        // An assigned route on the replication side counts as different when the
        // producer never named its own route (unknown ≠ same); relation() has
        // already turned two named identical routes into wiring.
        const routesDiffer = (a.route && b.route)
          ? !sameRoute(a.route, b.route) && !routeConfessesDependence(a.route, b.route)
          : true;
        const attested = !headline.has(id) || rev.independent.has(id) || ((computingLeg(a) || computingLeg(b)) && routesDiffer);
        if (attested) {
          agreeingPair = true;
          reasons.push(`agree: ${a.source} ~ ${b.source}${a.anchor || b.anchor ? " (anchored)" : ""}`);
        } else {
          const said = rev.independentLines.filter((l) => l.id === id);
          const lacking = said.length ? `INDEPENDENT line does not answer "shared: none" (${said.map((l) => l.shared.join(",") || "open form").join("; ")})` : "no INDEPENDENT line";
          reasons.push(`agree but unattested (${lacking}${(a.kind === "replication" || b.kind === "replication") ? "; replication lacks a route/script or shares the producer's route" : ""}): ${a.source} ~ ${b.source}`);
        }
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
      // The unit is printed so the reviewer can see a units mismatch; the comparison stays numeric.
      const blv = bl.unit ? `${bl.value} ${bl.unit}` : `${bl.value}`;
      const comparable = owns.filter((o) => relation(o, bl).rel !== "incomparable");
      if (owns.length && comparable.length === 0) { reasons.push(`blind estimate ${blv} incomparable: its inputs (${Object.entries(bl.inputs ?? {}).map(([k, v]) => `${k}=${v}`).join(",") || "none"}) differ in value from the producer's — re-estimate against current inputs`); continue; }
      const agreeingOwn = comparable.find((o) => agreement(o, bl) === "agree");
      if (agreeingOwn) { reasons.push(`blind estimate ${blv} agrees with ${agreeingOwn.source}`); continue; }
      const flagged = comparable[0];
      if (!flagged) continue;
      const answer = owns.find((o) => o !== flagged && o.experiment !== flagged.experiment && relation(o, flagged).rel === "comparable" && agreement(o, flagged) === "agree");
      if (answer) { reasons.push(`blind estimate ${blv} disagreed with ${flagged.source}=${flagged.value}; answered by ${answer.source}=${answer.value} (independent experiment agrees with the producer)`); continue; }
      if (signOnlyDisagreement(flagged, bl)) {
        // A sign-only disagreement is ANSWERED the moment the producer's
        // observable sentence pins the convention (design §3.5 "answer with a
        // locator"; 2026-08-28: two such rows were disclosed and escalated to
        // the operator although four routes agreed on the magnitude).
        const obs = (declsById.get(id) ?? []).map((d) => d.observable ?? "").join(" ");
        if (signConventionStated(obs)) { reasons.push(`sign convention: blind estimate ${blv} vs ${flagged.source}=${flagged.value} agree in magnitude; convention stated in observable ("${obs.match(SIGN_CONVENTION_RE)?.[0]}") — answered`); continue; }
        dispute(`sign convention: blind estimate ${blv} vs ${flagged.source}=${flagged.value} agree in magnitude, differ in sign — state the convention in \`observable\` (e.g. "signed, negative = attractive" or "magnitude |C6|") and the flag is answered; a physics dispute only if the signs survive that (unanswered)`);
        continue;
      }
      dispute(`blind reviewer estimate ${blv} disagrees with ${flagged.source}=${flagged.value} (unanswered)`);
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
      if (s.observed !== undefined && Math.abs(s.observed - s.expected) > SCALING_TOL) dispute(`scaling: observed exponent ${s.observed} vs expected ${s.expected}`);
    }
    for (const d of declsById.get(id) ?? []) {
      if (d.uncertaintySource && d.uncertainty !== undefined) reasons.push(`σ ${d.uncertainty} (${d.uncertaintySource.slice(0, 60)})`);
    }
    const anyOwnSigma = (declsById.get(id) ?? []).some((d) => d.uncertainty !== undefined);
    let status: ClaimStatus;
    if (disputed) status = disclosures.has(id) && rev.discloseOk.has(id) ? "disclosed" : "disputed";
    else if (agreeingPair && anyOwnSigma) status = "converging";
    else status = "indicative";
    if (!anyOwnSigma && agreeingPair) { const cap = "no σ on own estimate: capped at indicative"; reasons.push(cap); if (!disputed) cause = cap; }
    if (anchorExfil) { if (status === "converging") { status = "indicative"; cause = anchorExfil; } reasons.push(anchorExfil); }
    intrinsic.set(id, { status, reasons: [...new Set(reasons)], propagate, cause });
  }
  for (const [id, intr] of intrinsic) for (const up of intr.propagate) {
    headline.add(up);
    const t: Intr = intrinsic.get(up) ?? { status: "indicative", reasons: [], propagate: [] };
    if (t.status !== "disputed" && t.status !== "disclosed") { t.status = "disputed"; t.cause = `disputed by propagation from ${id}`; t.reasons.push(t.cause); }
    intrinsic.set(up, t);
  }
  // v3 D1: quantities of an experiment whose latest review is `revise` with an
  // unanswered finding are capped at indicative (the flaw is open). Only an
  // answer bound to that round's Issue 1 lifts it (C15); a quote does not.
  const openFindings = openReviewFindings(projectDir);
  for (const id of ids) {
    const cur = intrinsic.get(id)!;
    for (const d of declsById.get(id) ?? []) {
      const f = openFindings.get(d.experiment);
      if (f && !f.answered) {
        const line = `reviewer finding open (${f.experiment} round ${f.round}): "${f.sentence.slice(0, 120)}" — answer it in the ledger with finding_answered: r${f.round} #1 <clause> — <locator>`;
        if (cur.status === "converging") { cur.status = "indicative"; cur.cause = line; }
        if (!cur.reasons.includes(line)) cur.reasons.push(line);
        break;
      }
    }
  }
  // Conditional via disputed/disclosed/conditional inputs — fixed point.
  // (Design §3.4 also lists `indicative` inputs; not applied — it would make
  // nearly every quantity conditional. Recorded deviation.)
  const RANK: Record<ClaimStatus, number> = { converging: 4, indicative: 3, conditional: 2, disclosed: 1, disputed: 0 };
  const inputsOf = (id: string) => [...new Set((declsById.get(id) ?? []).flatMap((d) => Object.keys(d.inputs)).filter((k) => known.has(k)))];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const cur = intrinsic.get(id)!;
      if (cur.status === "disputed" || cur.status === "disclosed" || cur.status === "conditional") continue;
      const bad = inputsOf(id).filter((u) => { const s = intrinsic.get(u)?.status; return s === "disputed" || s === "disclosed" || s === "conditional"; });
      if (bad.length > 0) { cur.status = "conditional"; cur.cause = `conditional on ${bad.join(",")}`; cur.reasons.push(cur.cause); changed = true; }
    }
  }
  const rows: ClaimRow[] = ids.map((id) => {
    const { status, reasons, cause } = intrinsic.get(id)!;
    return {
      id, status, headline: headline.has(id),
      estimates: estimates.filter((e) => e.quantity === id),
      reasons, ...(cause ? { cause } : {}), observable: (declsById.get(id) ?? []).find((d) => d.observable)?.observable, inputs: inputsOf(id),
    };
  });
  const vRows = [...verdictById.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([vid, vs]) => {
    const reads = [...new Set(vs.flatMap((v) => v.reads))];
    let status: ClaimStatus = "converging";
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
    malformed, unparsed: rev.unparsed, notes, readsDrops, declared, decls, discriminators: rev.discriminators, disclosedHeadlineCount,
  };
}

// ── gate + render ──────────────────────────────────────────────────────────

export interface ClaimIssue { blocking: boolean; text: string }

// Static on purpose: a row's `cause` is only its last dispute, so a blind flag
// can hide behind a later scaling line. Only another experiment's own estimate
// answers a blind flag (buildClaimTable's blind loop); a replication never does.
const LEGAL_MOVES = `Legal moves: run the discriminating computation (an experiment whose results.json declares a comparable estimate under the same quantity id — the only answer to a blind-estimate flag), a replicate-mode replicator (spawn_agent(agent="replicator", MODE: "replicate"); it settles a disagreement between two producers, never a blind-estimate flag), or a countersigned disclosure (CLAIM-DISCLOSE in notes/memory.md + DISCLOSE-OK from a reviewer or the PI).`;

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
  issues.push(...reviewOpenIssues(projectDir));
  if (table.malformed.length > 0) issues.push({ blocking: true, text: `Malformed quantity declarations:\n  - ${table.malformed.join("\n  - ")}` });
  // Non-blocking: the files are write-protected and nobody can correct a line in them before finish.
  if (table.unparsed.length > 0) issues.push({ blocking: false, text: `${table.unparsed.length} ESTIMATE line(s) in harness review files did not parse and take part in no comparison; listed so a dropped estimate is never silent (the grammar is one value per line: "<value> [unit] [± <σ> [unit] | (+a/−b) [unit]] via <route> — inputs: [k=v, …]"):\n  - ${table.unparsed.slice(0, 8).join("\n  - ")}${table.unparsed.length > 8 ? `\n  (+ ${table.unparsed.length - 8} more)` : ""}` });
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
      if (bad.has(row.status)) issues.push({ blocking: true, text: `"${ctx}" cites ${row.id} whose status is ${row.status} (${row.cause ?? row.reasons.slice(-2).join("; ")}). ${LEGAL_MOVES}` });
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
    const ests = r.estimates.map((e) => `${e.source.split(":")[0]}${e.kind === "own" ? "" : ":" + e.kind}=${fmt(e.value)}${e.unit ? " " + e.unit : ""}${e.sigma !== undefined ? "±" + fmt(e.sigma) : ""}`).join(" ");
    const why = r.cause ?? r.reasons[r.reasons.length - 1];
    return `- ${r.id}${r.headline ? " [H]" : ""} ${r.status.toUpperCase()}  ${ests}${why ? `\n    ${why}` : ""}`;
  });
  for (const v of table.verdicts) lines.push(`- verdict ${v.id} ${v.status.toUpperCase()} reads: ${v.reads.join(", ")}`);
  for (const d of table.readsDrops) lines.push(`- READS-DROP ${d}`);
  for (const m of table.malformed) lines.push(`- MALFORMED ${m}`);
  for (const u of table.unparsed.slice(0, 3)) lines.push(`- UNPARSED ${u.slice(0, 200)}`);
  if (table.unparsed.length > 3) lines.push(`- UNPARSED (+ ${table.unparsed.length - 3} more)`);
  for (const n of table.notes.slice(0, 4)) lines.push(`- NOTE ${n}`);
  const hidden = table.rows.length - rows.length;
  const satisfiedAbstain = new Set(table.abstain.filter((a) => a.satisfied).map((a) => a.id));
  const bad = table.rows.filter((r) => r.headline && (r.status === "disputed" || r.status === "conditional") && !satisfiedAbstain.has(r.id));
  const frontier = table.discriminators.filter((d) => bad.some((r) => r.id === d.id)).slice(0, 3).map((d, i) => `frontier[${i + 1}]: ${d.text.slice(0, 200)}`);
  return `<claim_status>\n${lines.join("\n")}${hidden > 0 ? `\n(+ ${hidden} non-headline rows not shown)` : ""}` +
    (frontier.length ? `\n${frontier.join("\n")}` : "") +
    `\nship: ${bad.length === 0 ? "no headline quantity disputed/conditional" : `${bad.length} headline quantit${bad.length === 1 ? "y" : "ies"} disputed/conditional → abstract blocked (${bad.map((r) => r.id).join(", ")})`}; discloses used: ${table.disclosedHeadlineCount}/1${table.abstain.length ? `; abstentions: ${table.abstain.map((a) => `${a.id}${a.satisfied ? " (in abstract)" : " (SENTENCE MISSING)"}`).join(", ")}` : ""}\n</claim_status>`;
}
