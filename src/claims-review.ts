/**
 * Claims-first review mechanics — the pure helpers behind design §3.5–§3.8
 * (notes/design-claims-first.md, Draft 2.1). Kept free of agent spawning so
 * every rule here is unit-testable offline (scripts/smoke_claims_review.mts);
 * the harness glue lives in tools/spawn-agent.ts (experiment_reviewer loop),
 * pi-agent.ts (PI verdict), tools/index.ts (finish), safety-wrappers.ts
 * (write-time validation) — each named here as the consumer of the helper it
 * calls, per the producer-consumer rule.
 *
 *  - Reviewer obligation lines (DISCRIMINATOR / ESTIMATE / SCALING /
 *    INDEPENDENT / ANCHOR-OK / DISCLOSE-OK) are extracted from a reviewer's
 *    text return and PERSISTED BY THE HARNESS to reviews/experiment_review_*.md
 *    — the reviewer itself has no write tool, and claims-table.ts reads only
 *    files. A review that lacks a DISCRIMINATOR for a headline quantity in its
 *    scope is not a review (same rule as a PI verdict with no ## Verdict).
 *  - The blind estimate is produced by a harness-spawned `replicator` BEFORE
 *    the reviewer runs, from the observable sentence and input values only —
 *    "preregistered" cannot be enforced inside one agent turn (critics' fix).
 *  - Finish escalation: identical blocking message on three consecutive
 *    finish() calls → hand to the operator (notes/escalations/needs-operator.md)
 *    instead of iterating. Layered UNDER the 12-call global backstop, which is
 *    untouched (deleting it restored the 441-call bug).
 *  - PI: a `stop` verdict without an estimate for every headline quantity in
 *    scope is downgraded to `steer` (fail-closed, never a deadlock: the next
 *    review can supply them).
 */

import { existsSync, mkdirSync, writeFileSync , readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrameHeadline, buildClaimTable, ESTIMATE_LINE_RE, type ClaimTable, type QuantityDecl } from "./claims-table.js";

export const REVIEW_LINE_RE = /^\s*(DISCRIMINATOR|ESTIMATE(?:\(blind\))?|SCALING|INDEPENDENT|ANCHOR-OK|DISCLOSE-OK):\s*(\S+)/;

export interface ReviewLine { kind: string; quantity: string; text: string }

/** Every obligation line in a reviewer's text return, in order. */
export function extractReviewerLines(text: string): ReviewLine[] {
  const out: ReviewLine[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const m = raw.match(REVIEW_LINE_RE);
    if (!m) continue;
    const kind = m[1].replace("(blind)", "");
    // ESTIMATE lines must parse under the strict grammar the table uses;
    // otherwise they are recorded as MALFORMED rather than silently dropped.
    if (kind === "ESTIMATE" && !ESTIMATE_LINE_RE.test(raw)) { out.push({ kind: "MALFORMED", quantity: m[2], text: `MALFORMED-ESTIMATE: ${raw.trim()}` }); continue; }
    out.push({ kind, quantity: m[2], text: raw.trim() });
  }
  return out;
}

/** Headline quantity ids missing a DISCRIMINATOR or a SCALING line. Empty = complete. */
export function reviewCompleteness(lines: ReviewLine[], headlineIds: string[]): string[] {
  const disc = new Set(lines.filter((l) => l.kind === "DISCRIMINATOR").map((l) => l.quantity));
  const scal = new Set(lines.filter((l) => l.kind === "SCALING").map((l) => l.quantity));
  return headlineIds.filter((id) => !disc.has(id) || !scal.has(id));
}

/** Experiment number ("E5") from an EXPERIMENT_ID like "E5_blockade_floor". */
export function experimentNumberOf(experimentId: string): string | null {
  const m = String(experimentId ?? "").match(/^E_?(\d+)/);
  return m ? `E${parseInt(m[1], 10)}` : null;
}

/** This experiment's declarations in the DECLARED headline set (frame.md ∪ headline:true) — the obligation scope (audit 2026-08-26: the load-bearing closure is for gates, not for spawn counts). */
export const OBLIGATION_CAP_PER_EXPERIMENT = 3;

/**
 * Obligation scope for one experiment (v2 plan P0.2, PI's version): every
 * declaration stays tabled and comparable, but the blind estimator, the
 * reviewer and the PI owe lines only for the frame's ids plus at most
 * OBLIGATION_CAP_PER_EXPERIMENT producer-declared headline ids, ranked by
 * load — how many verdicts read the id and how many other declarations take
 * it as an input — then by relative σ (tighter first). Producers marked 6/7
 * and 23 ids `headline: true` in the live runs; this bounds the review bill
 * without letting a producer hide the load-bearing number.
 */
export function headlineDeclsFor(table: ClaimTable, experimentId: string, cap = OBLIGATION_CAP_PER_EXPERIMENT): QuantityDecl[] {
  const e = experimentNumberOf(experimentId);
  if (!e) return [];
  const frame = new Set(table.frameHeadline ?? []);
  const seen = new Set<string>();
  const mine = table.decls.filter((d) => d.experiment === e && (d.headline || frame.has(d.id) || table.headlineDeclared.includes(d.id)) && d.value !== undefined && !seen.has(d.id) && seen.add(d.id));
  const load = (id: string) => table.verdicts.filter((v) => v.reads.includes(id)).length + table.decls.filter((d) => d.id !== id && id in d.inputs).length;
  const relSigma = (d: QuantityDecl) => d.uncertainty !== undefined && d.value ? d.uncertainty / Math.abs(d.value) : Infinity;
  const inFrame = mine.filter((d) => frame.has(d.id));
  const rest = mine.filter((d) => !frame.has(d.id)).sort((a, b) => load(b.id) - load(a.id) || relSigma(a) - relSigma(b));
  return [...inFrame, ...rest.slice(0, cap)];
}

/** Project-wide obligation scope: frame ids ∪ each experiment's capped headline set (PI estimate rule uses this). */
export function obligationScope(table: ClaimTable): string[] {
  const out = new Set<string>(table.frameHeadline ?? []);
  for (const e of new Set(table.decls.map((d) => d.experiment))) for (const d of headlineDeclsFor(table, e)) out.add(d.id);
  return [...out];
}

/**
 * Ensure a replicator's ESTIMATE(blind) line carries the input values the
 * harness handed it (v2 plan P0.1): a blind estimate with `inputs: []` made
 * against declared inputs would be compared as if input-free, and could
 * never expire when those inputs move. Only fills an EMPTY/missing bracket.
 */
export function stampBlindInputs(line: string, inputs: Record<string, number>): string {
  const stamp = Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join(", ");
  if (!stamp) return line;
  if (/inputs:\s*\[\s*\]\s*$/.test(line)) return line.replace(/inputs:\s*\[\s*\]\s*$/, `inputs: [${stamp}]`);
  if (!/inputs:\s*\[/.test(line)) return `${line.trimEnd()} — inputs: [${stamp}]`;
  return line;
}

/**
 * Which headline declarations get a blind replicator estimate this round.
 * Producers over-declare `headline: true` (live probe 2026-08-26: 6 of 7
 * quantities) and each estimate is a model spawn, so: frame.md ids first,
 * then the rest in declaration order, at most `cap` per round (design §9.2:
 * N = 3 for a short ask). The skipped ids are returned so the harness can
 * say so in the review file instead of silently narrowing.
 */
export function selectBlindEstimateDecls<T extends { id: string }>(decls: T[], frameIds: string[], cap = 3, settled: Set<string> = new Set()): { chosen: T[]; skipped: string[] } {
  const seen = new Set<string>();
  const ordered: T[] = [];
  // A row the table already holds converging (an anchored reference three
  // tools agree on, or a re-declared settled value) gains nothing from a blind estimate —
  // Ba run 2026-08-30: 26 min of replicator on Rb 78s C6 after ARC/pairinteraction agreed to 0.6 %.
  const live = decls.filter((d) => !settled.has(d.id));
  for (const fid of frameIds) for (const d of live) if (d.id === fid && !seen.has(d.id)) { seen.add(d.id); ordered.push(d); }
  for (const d of live) if (!seen.has(d.id)) { seen.add(d.id); ordered.push(d); }
  const skipped = [...ordered.slice(cap).map((d) => d.id), ...decls.filter((d) => settled.has(d.id)).map((d) => `${d.id} (already settled)`)];
  return { chosen: ordered.slice(0, cap), skipped };
}

/** The task handed to a blind `replicator` in estimate mode — observable and input VALUES only (design §3.5). */
export function blindEstimateTask(decl: QuantityDecl): string {
  const inputs = Object.entries(decl.inputs).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    `Blind order-of-magnitude estimate of ONE quantity. You are not shown the producer's number, script, or narrative — that is the point.`,
    ``,
    `QUANTITY_ID: ${decl.id}`,
    `OBSERVABLE: ${decl.observable ?? "(no observable sentence recorded — estimate the quantity the id names, and say what definition you assumed)"}`,
    `INPUTS (values the producer used; treat as given): ${inputs || "(none declared)"}`,
    ``,
    `Produce your estimate by a route you choose (closed form, limiting case, scaling from a known benchmark, a short script). Run at least one bash/python line so the number is transcript-anchored.`,
    `State, in one sentence before the last line, the DEFINITION you assumed: the observable, its units, its sign convention (e.g. "negative = attractive") and the fixed parameters — a definitional mismatch is the most common reason two correct routes disagree, and the reviewer needs it to tell that case from a physics dispute.`,
    `A toy or napkin route is welcome (it can flag and it can converge) but say so in the route text; it is never an anchor.`,
    `Your LAST line must be exactly:`,
    `ESTIMATE(blind): ${decl.id} — <value> ± <sigma> via <route in ≤12 words> — inputs: [${Object.keys(decl.inputs).map((k) => `${k}=${decl.inputs[k]}`).join(", ")}]`,
  ].join("\n");
}

/** Pull the ESTIMATE(blind) line out of a replicator's return (last match wins). */
export function extractBlindEstimate(text: string, quantityId: string): string | null {
  let found: string | null = null;
  for (const l of extractReviewerLines(text)) if (l.kind === "ESTIMATE" && l.quantity === quantityId && /ESTIMATE\(blind\)/.test(l.text)) found = l.text;
  return found;
}

/** Write reviews/experiment_review_<EID>_r<round>.md — the file claims-table.ts reads. */
export function persistReview(projectDir: string, experimentId: string, round: number, blindLines: string[], reviewerLines: ReviewLine[], verdictLine: string, missing: string[], feedback?: string): string {
  const dir = join(projectDir, "reviews");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `experiment_review_${experimentId}_r${round}.md`);
  // An incomplete review persists ONLY the blind lines and the marker — its
  // attestations (INDEPENDENT / ANCHOR-OK / DISCLOSE-OK) must not unlock
  // anything (audit H5).
  const persisted = missing.length ? reviewerLines.filter((l) => l.kind === "MALFORMED") : reviewerLines;
  const body = [
    `# experiment_reviewer — ${experimentId} round ${round}`,
    ``,
    `Blind estimates (harness-spawned replicator, recorded BEFORE the reviewer ran):`,
    ...(blindLines.length ? blindLines : ["(none — no declared headline quantity for this experiment, or estimator disabled/failed)"]),
    ``,
    `Reviewer obligation lines (design §3.5):`,
    ...(persisted.length ? persisted.map((l) => l.text) : ["(none)"]),
    ``,
    missing.length ? `REVIEW-INCOMPLETE: no DISCRIMINATOR+SCALING for ${missing.join(", ")} — NO REVIEW for those quantities; attestation lines withheld` : `REVIEW-COMPLETE`,
    verdictLine,
    // v3 D1 (2026-08-29): the reviewer's feedback used to live only in the
    // spawn result the brain read once; at the iteration cap it vanished.
    // Persisted here so finish() can require the flaw to reach the ledger.
    ...(feedback && feedback.trim() ? [``, `FEEDBACK:`, feedback.trim().slice(0, 1200)] : []),
    ``,
  ].join("\n");
  writeFileSync(path, body);
  return path;
}

// ── v3 D1: revise carried forward ──────────────────────────────────────────
//
// The 100-task AutoResearch diagnostic: in 82.5 % of failed runs the agent
// diagnosed a critical flaw during self-review and reported the unrevised
// conclusion. Luxas encoded exactly that: `VERDICT: revise` at the iteration
// cap went into a spawn result, the ledger stayed `Complete`. Now: the flaw
// must reach the artifact the referee reads — the L2 section quotes it
// (`finding_open:`) or answers it with a locator (`finding_answered:`).
export interface OpenFinding { experiment: string; round: number; sentence: string; feedback: string; answered: boolean; quoted: boolean }

const LOCATOR_RE = /(?:[\w./-]+\.(?:py|json|csv|npz|tex|md):\d+|job_[0-9a-f]{6,}|results\.json|runs\/run_\d+|computed\.[\w.]+)/;
function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 200)).trim();
}
function wordTokens(s: string): string[] { return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 0); }
/** True when `haystack` contains any 8-token window of `needle` (verbatim quote, punctuation-insensitive). */
export function quotesSentence(haystack: string, needle: string, window = 8): boolean {
  const h = wordTokens(haystack).join(" ");
  const n = wordTokens(needle);
  if (n.length < window) return n.length > 0 && h.includes(n.join(" "));
  for (let i = 0; i + window <= n.length; i++) if (h.includes(n.slice(i, i + window).join(" "))) return true;
  return false;
}

/** Experiments whose latest review is `revise` with a FEEDBACK block, and how the ledger/results answered it. */
export function openReviewFindings(projectDir: string): Map<string, OpenFinding> {
  const out = new Map<string, OpenFinding>();
  if (process.env.LUXAS_REVISE_BINDING === "0") return out;
  const dir = join(projectDir, "reviews");
  if (!existsSync(dir)) return out;
  const latest = new Map<string, { round: number; file: string }>();
  for (const f of readdirSync(dir)) {
    const m = f.match(/^experiment_review_(.+)_r(\d+)\.md$/);
    if (!m) continue;
    const r = parseInt(m[2], 10);
    const cur = latest.get(m[1]);
    if (!cur || r > cur.round) latest.set(m[1], { round: r, file: join(dir, f) });
  }
  let ledger = "";
  try { ledger = readFileSync(join(projectDir, "notes", "experiments.md"), "utf-8"); } catch { /* none */ }
  for (const [eid, { round, file }] of latest) {
    let text = "";
    try { text = readFileSync(file, "utf-8"); } catch { continue; }
    if (!/^\s*#{0,6}\s*VERDICT:\s*revise\b/im.test(text)) continue;
    const fb = text.match(/^FEEDBACK:\s*\n([\s\S]*)$/m);
    if (!fb || !fb[1].trim()) continue;
    const feedback = fb[1].trim();
    const sentence = firstSentence(feedback);
    const e = experimentNumberOf(eid) ?? eid;
    // The ledger section for this experiment (## L2.N …) and results.json open-issues.
    const n = e.replace(/^E/, "");
    const sec = ledger.match(new RegExp(`(?:^|\\n)##\\s+L2\\.${n}\\b[\\s\\S]*?(?=\\n##\\s|$)`));
    let section = sec ? sec[0] : "";
    try {
      const runs = join(projectDir, "data", "experiments", eid, "runs");
      for (const r of readdirSync(runs)) {
        const j = JSON.parse(readFileSync(join(runs, r, "results.json"), "utf-8"));
        const ro = j?.computed?.reviewer_open_issues;
        if (Array.isArray(ro)) section += "\n" + ro.map((x: unknown) => typeof x === "string" ? x : JSON.stringify(x)).join("\n");
      }
    } catch { /* no runs */ }
    const answered = [...section.matchAll(/finding_answered:\s*([^\n]*)/gi)].some((m) => LOCATOR_RE.test(m[1]));
    const quoted = [...section.matchAll(/finding_open:\s*([^\n]*)/gi)].some((m) => quotesSentence(m[1], sentence));
    out.set(e, { experiment: e, round, sentence, feedback, answered, quoted });
  }
  return out;
}


/** Headline ids (this experiment's) for the reviewer prompt, plus the rendered blind lines. */
export function reviewerObligationBlock(headlineIds: string[], blindLines: string[]): string {
  if (headlineIds.length === 0) return "";
  return [
    ``,
    `<claim_obligation>`,
    `Headline quantities in your scope: ${headlineIds.join(", ")}.`,
    `For EACH, your response MUST contain (anywhere, one per line, exact prefixes):`,
    `  DISCRIMINATOR: <id> — if right: <prediction>; if wrong: <prediction>; computation: <what would tell them apart>`,
    `  SCALING: <id> — expected <exponent> in <parameter>; observed <exponent> from <artifact>   (or "observed not swept")`,
    `Optionally: INDEPENDENT: <id> <a> vs <b> — <why the routes differ>;  ANCHOR-OK: <id> — <why competing observables differ at this limit>;  ESTIMATE: <id> — <value> ± <sigma> via <route>  (post-hoc; the blind one below is the one that can flag).`,
    `A response missing a DISCRIMINATOR or a SCALING line for a headline quantity is recorded as NO REVIEW for it, and none of its attestation lines count.`,
    blindLines.length ? `Blind estimates already recorded by the harness (do not re-derive; compare):\n${blindLines.join("\n")}` : `No blind estimate was available for these quantities.`,
    `</claim_obligation>`,
  ].join("\n");
}

// ── PI ─────────────────────────────────────────────────────────────────────

export interface PIEstimate { quantity: string; value: number; sigma?: number; route: string }

/**
 * Design §3.5 for the PI: `stop` requires an estimate per headline quantity;
 * otherwise it becomes `steer`.
 *
 * `nonScalarIds` (frame-tagged "(curve)"/"(non-scalar)"/"(qualitative)") are
 * waived from the ESTIMATE half only. A lifetime-vs-n curve or an "isotope
 * choice" recommendation has no single value ± σ, so demanding one made the
 * gate unsatisfiable rather than strict (ba-neutral-atom-qc, 2026-08-31: three
 * curve ids plus the phantom `Named` held a finished report for 7 reviews).
 * The DISCRIMINATOR obligation below still applies to every headline id,
 * curve-valued included — "if right the exponent is 3, if wrong 5" is exactly
 * the referee question a curve deserves.
 */
export function piEstimateRule(verdict: "continue" | "steer" | "stop", estimates: PIEstimate[] | undefined, headlineIds: string[], discriminators?: string[], nonScalarIds?: string[]): { verdict: "continue" | "steer" | "stop"; issue?: string } {
  if (verdict !== "stop" || headlineIds.length === 0) return { verdict };
  const waived = new Set(nonScalarIds ?? []);
  const have = new Set((estimates ?? []).map((e) => e.quantity));
  const missing = headlineIds.filter((id) => !have.has(id) && !waived.has(id));
  if (missing.length > 0) {
    return {
      verdict: "steer",
      issue: `PI stop verdict withheld: no independent estimate recorded for headline quantit${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")}. ` +
        `A PI that has not put its own number on the headline has not reviewed it — supply estimates (value ± sigma via a route the experiment did not use) in the next review. ` +
        `If one of these is not a scalar (a curve, a ranking, a recommendation), it cannot take a value ± sigma: tag it in notes/frame.md as \`- \\\`the_id\\\` — observable (curve)\` and it is waived here, but it still needs a DISCRIMINATOR.`,
    };
  }
  // Referee pass (2026-08-29, path-to-publishable experiment 3): the three
  // objections a referee raised on the pp-vs-ss manuscript were all "the one
  // computation you must show before I accept this claim". A STOP must name
  // that computation per headline quantity; the brain then runs it or
  // discloses. Same DISCRIMINATOR grammar, obligatory only at STOP.
  const disc = new Set((discriminators ?? []).map((d) => (d.match(/^\s*DISCRIMINATOR:\s*(\S+)/) ?? [])[1]).filter(Boolean));
  const noDisc = headlineIds.filter((id) => !disc.has(id));
  if (noDisc.length === 0) return { verdict };
  return {
    verdict: "steer",
    issue: `PI stop verdict withheld (referee pass): no DISCRIMINATOR for headline quantit${noDisc.length === 1 ? "y" : "ies"} ${noDisc.join(", ")}. ` +
      `For each, write the single computation a referee would demand before accepting the claim — "DISCRIMINATOR: <id> — if right: …; if wrong: …; computation: …" — the brain must run it or disclose it before the report ships. A stop that names no such computation is an endorsement, not a review.`,
  };
}

export function formatPIEstimateLines(estimates: PIEstimate[] | undefined, discriminators: string[] | undefined): string[] {
  const lines: string[] = [];
  for (const e of estimates ?? []) {
    if (!e || typeof e.quantity !== "string" || !Number.isFinite(Number(e.value))) continue;
    lines.push(`ESTIMATE: ${e.quantity} — ${e.value}${Number.isFinite(Number(e.sigma)) ? ` ± ${e.sigma}` : ""} via ${String(e.route ?? "unstated").slice(0, 80)}`);
  }
  for (const d of discriminators ?? []) if (typeof d === "string" && /^DISCRIMINATOR:\s*\S+/.test(d)) lines.push(d.trim());
  return lines;
}

// ── finish escalation (design §3.8) ────────────────────────────────────────

export class FinishEscalation {
  private last: string | null = null;
  private repeats = 0;
  constructor(private readonly threshold = 3) {}
  /** Record a blocking finish() message; true when the operator must take over. */
  record(blockText: string): boolean {
    // Digits masked: "3 open lead(s)" and "2 open lead(s)" are the same gate.
    const key = (blockText ?? "").split("\n")[0].trim().replace(/\d+/g, "#").slice(0, 160);
    if (key && key === this.last) this.repeats++; else { this.last = key; this.repeats = 1; }
    return this.repeats >= this.threshold;
  }
  reset(): void { this.last = null; this.repeats = 0; }
  get count(): number { return this.repeats; }
  /** Survive a resume: the ba-neutral-atom-qc livelock accumulated 7 identical
   *  withholdings across two cost-cap kills, so a counter that resets on every
   *  restart gives the deadman two fresh strikes each time. */
  getState(): { last: string | null; repeats: number } { return { last: this.last, repeats: this.repeats }; }
  restore(state: { last?: string | null; repeats?: number } | undefined): void {
    if (!state) return;
    this.last = state.last ?? null;
    this.repeats = Number.isFinite(state.repeats) ? Number(state.repeats) : 0;
  }
}

export function writeNeedsOperator(projectDir: string, blockText: string, calls: number, opts?: { gate?: "finish" | "pi" }): string {
  // notes/escalations/, NOT notes/directives/ — that directory is read back
  // as the USER's highest-priority directive (audit 2026-08-26).
  const dir = join(projectDir, "notes", "escalations");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "needs-operator.md");
  const narrative = opts?.gate === "pi"
    // 2026-09-01: the PI path had no deadman. On ba-neutral-atom-qc a frame
    // parsing bug made the PI's stop gate unsatisfiable, so the PI returned
    // the SAME withheld-stop issue seven times while the brain politely
    // waited for a verdict that could not exist — two cost-cap kills, no
    // finish(). The escalation existed; it was wired only to finish().
    ? `The PI withheld its stop verdict with the SAME issue on ${calls} consecutive reviews. The brain cannot finish without a stop, and the PI cannot give one, so this gate is unsatisfiable as posed rather than merely unmet — usually a headline quantity that can never receive the evidence the gate demands (a curve or a recommendation asked for one value ± σ, or a phantom id parsed out of prose in notes/frame.md).`
    : `finish() was blocked by the SAME gate on three consecutive calls (${calls} finish calls total). The brain is iterating without reducing the issue; this is the livelock signature (297nm run: 4 finish calls, 15 consecutive plan.md reads, 3 operator interventions).`;
  writeFileSync(path, [
    `# needs-operator`,
    ``,
    narrative,
    `The run exited cleanly with its artifacts as they stand. A person decides the next move.`,
    ``,
    `## Blocking gate (verbatim)`,
    ``,
    blockText,
    ``,
  ].join("\n"));
  return path;
}

// ── write-time validation of quantity declarations (design §3.1) ───────────

function tokens(id: string): Set<string> {
  return new Set(id.toLowerCase().split(/[_\W]+/).filter((t) => t.length > 2));
}

/** Ids lexically near `id` (≥2 shared tokens) that are not `id` itself. */
export function nearestIds(id: string, known: Iterable<string>, n = 3): string[] {
  const t = tokens(id);
  return [...new Set(known)].filter((k) => k !== id)
    .map((k) => { const kt = tokens(k); let s = 0; for (const x of kt) if (t.has(x)) s++; const need = Math.min(t.size, kt.size) <= 1 ? 1 : 2; return { k, s, need }; })
    .filter((x) => x.s >= x.need).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.k);
}

/** Problems with a results.json's computed.quantities[] / verdicts[], for the write-time hook. */
export function quantityDeclarationProblems(projectDir: string, experimentId: string): string[] {
  const table = buildClaimTable(projectDir);
  const e = experimentNumberOf(experimentId) ?? experimentId;
  const problems = table.malformed.filter((m) => m.startsWith(`${e}:`));
  const others = new Set(table.decls.filter((d) => d.experiment !== e).map((d) => d.id));
  for (const d of table.decls.filter((d) => d.experiment === e)) {
    if (others.has(d.id)) continue; // reuse — the intended case
    const near = nearestIds(d.id, others);
    if (near.length > 0) problems.push(`${e}: quantity id "${d.id}" is new but lexically near existing ${near.join(", ")} — reuse the existing id if it is the same observable (the estimate histories must join), or pick a clearly distinct id and say in \`observable\` why it is a different quantity.`);
  }
  // Frame ids the brain named that no experiment declares, when this
  // experiment coined a near-miss (live probe: frame `C6_60P_mj32_theta`,
  // producer `c6_theta_60p_mj32` — the ship gate never linked them).
  const declaredAnywhere = new Set(table.decls.map((d) => d.id));
  const mine = table.decls.filter((d) => d.experiment === e).map((d) => d.id);
  for (const fid of parseFrameHeadline(projectDir)) {
    if (declaredAnywhere.has(fid)) continue;
    // Stricter than nearestIds: ≥2 shared tokens always (short frame ids like
    // p2_at_r0_theta reduce to one token and would match anything with "theta").
    const ft = new Set(fid.toLowerCase().split(/[_\W]+/).filter((t) => t.length > 2));
    const near = mine.filter((m) => [...m.toLowerCase().split(/[_\W]+/)].filter((t) => ft.has(t)).length >= 2);
    if (near.length > 0) problems.push(`${e}: notes/frame.md names headline quantity "${fid}" but no experiment declares it; your "${near[0]}" looks like the same observable — declare it under the frame id "${fid}" (the ship gate and the reviewer obligation are scoped to frame ids; a near-miss id leaves the headline unreviewed).`);
  }
  const declaredHeadline = table.decls.filter((d) => d.experiment === e && d.headline).map((d) => d.id);
  if (declaredHeadline.length > OBLIGATION_CAP_PER_EXPERIMENT) {
    const kept = headlineDeclsFor(table, experimentId).map((d) => d.id);
    problems.push(`${e}: ${declaredHeadline.length} quantities are marked headline:true; the reviewer/blind-estimate obligation covers only the frame's ids plus ${OBLIGATION_CAP_PER_EXPERIMENT} by load — this round: ${kept.join(", ")}. Every declaration stays in the table; if the number the abstract will quote is not among those, mark fewer as headline or name it in notes/frame.md.`);
  }
  for (const d of table.decls.filter((d) => d.experiment === e && (d.headline || table.headlineDeclared.includes(d.id)))) {
    if (d.uncertainty === undefined) problems.push(`${e}: headline quantity "${d.id}" has no \`uncertainty\` — without σ it can never reach converging (caps at indicative).`);
    if (!d.observable) problems.push(`${e}: headline quantity "${d.id}" has no \`observable\` sentence — the reviewer's discriminator and the contradiction auditor read it.`);
  }
  return problems;
}

export const COSMETIC_AGENTS = new Set(["illustrator", "illustrator_write", "typesetter", "report_writer", "contradiction_auditor", "prior_art_auditor"]);

/**
 * Speed bump for cosmetic spawns while a headline row is disputed/conditional
 * (v2 plan P0.5, design §3.7). Returns "" when the ship line is clean or the
 * agent is not cosmetic; otherwise the ship line + legal moves, to be
 * PREPENDED to the spawn result (non-blocking, the default) — or, with
 * LUXAS_COSMETIC_WHILE_DISPUTED=0, the reason the spawn is refused. The
 * pp-vs-ss run spent ~$25 on figures and a report the gate then blocked.
 */
export function cosmeticSpawnNotice(projectDir: string, agent: string): { notice: string; refuse: boolean } {
  if (!COSMETIC_AGENTS.has(agent)) return { notice: "", refuse: false };
  let table: ClaimTable;
  try { table = buildClaimTable(projectDir); } catch { return { notice: "", refuse: false }; }
  if (!table.declared) return { notice: "", refuse: false };
  const blocked = table.rows.filter((r) => r.headline && (r.status === "disputed" || r.status === "conditional")).map((r) => `${r.id} (${r.status})`);
  if (blocked.length === 0) return { notice: "", refuse: false };
  const refuse = process.env.LUXAS_COSMETIC_WHILE_DISPUTED === "0";
  const notice = `[claim gate] ${blocked.length} headline quantit${blocked.length === 1 ? "y is" : "ies are"} disputed/conditional — the abstract cannot ship and figures/report text built now will be redrawn: ${blocked.join(", ")}. ` +
    `Legal moves: run the reviewer's DISCRIMINATOR as an experiment, spawn a replicator (replicate mode) on the highest-load disputed id, or propose CLAIM-DISCLOSE for a non-producer to countersign. ` +
    (refuse ? `Refused (LUXAS_COSMETIC_WHILE_DISPUTED=0). Spawn "${agent}" once the ship line is clean.` : `Spawning "${agent}" anyway — the dollars are yours to spend; the ship line is not.`);
  return { notice, refuse };
}

// ── Route lint (v3 D5, 2026-08-29) ────────────────────────────────────────
//
// A cross-validation "control" whose method differs from the producer's only
// by a library name or a filler word is the same computation recorded twice
// (pp-vs-ss E2: gain_3d_n60 bit-identical; 297nm E6 re-summed the pipeline it
// "validated"). Routes differ when they differ in FORMALISM or LIMITING
// APPROXIMATION; two names for one route share their content tokens.
const ROUTE_STOPWORDS = new Set(["arc", "pairinteraction", "numpy", "scipy", "qutip", "python", "script", "code", "library", "package",
  "the", "a", "an", "of", "for", "with", "via", "using", "based", "from", "and", "or", "in", "on", "to", "at", "by", "same", "own",
  "method", "approach", "calculation", "computation", "estimate", "value", "result", "v2", "v3", "new", "old", "rerun", "re-run", "again", "control"]);
export function routeTokens(method: string): Set<string> {
  return new Set(String(method ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !ROUTE_STOPWORDS.has(t)));
}
/** True when two method descriptions name the same route (no distinguishing content token on either side). */
export function sameRoute(a: string, b: string): boolean {
  const ta = routeTokens(a), tb = routeTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const onlyA = [...ta].filter((t) => !tb.has(t)), onlyB = [...tb].filter((t) => !ta.has(t));
  return onlyA.length === 0 && onlyB.length === 0;
}
/** Write-time problems for cross_validation / cross_validation_plan entries whose two methods are one route. */
export function routeLintProblems(computed: any): string[] {
  const out: string[] = [];
  const xv = Array.isArray(computed?.cross_validation) ? computed.cross_validation : [];
  for (const x of xv) {
    const a = String(x?.method_a ?? ""), b = String(x?.method_b ?? "");
    if (a && b && sameRoute(a, b)) out.push(`cross_validation ${String(x?.claim_key ?? "?")}: method_a "${a.slice(0, 50)}" and method_b "${b.slice(0, 50)}" name the same route — a second call of the same function (or the same formalism through another library) is not a control. Name a route that differs in formalism or limiting approximation (see <methods_registry> control pairs), or drop the entry.`);
  }
  const plan = Array.isArray(computed?.cross_validation_plan) ? computed.cross_validation_plan : [];
  const producerRoutes = new Set<string>(xv.map((x: any) => String(x?.method_a ?? "")).filter(Boolean));
  for (const pl of plan) {
    const cm = String(pl?.control_method ?? "");
    if (!cm) continue;
    for (const pr of producerRoutes) if (sameRoute(cm, pr)) { out.push(`cross_validation_plan ${String(pl?.claim_key ?? "?")}: control_method "${cm.slice(0, 50)}" is the producer's own route ("${pr.slice(0, 40)}") — the plan must name an independent route.`); break; }
  }
  return out;
}
