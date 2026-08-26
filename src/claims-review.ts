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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
export function headlineDeclsFor(table: ClaimTable, experimentId: string): QuantityDecl[] {
  const e = experimentNumberOf(experimentId);
  if (!e) return [];
  const headline = new Set(table.headlineDeclared);
  const seen = new Set<string>();
  return table.decls.filter((d) => d.experiment === e && (d.headline || headline.has(d.id)) && d.value !== undefined && !seen.has(d.id) && seen.add(d.id));
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
export function persistReview(projectDir: string, experimentId: string, round: number, blindLines: string[], reviewerLines: ReviewLine[], verdictLine: string, missing: string[]): string {
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
    ``,
  ].join("\n");
  writeFileSync(path, body);
  return path;
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

/** Design §3.5 for the PI: `stop` requires an estimate per headline quantity; otherwise it becomes `steer`. */
export function piEstimateRule(verdict: "continue" | "steer" | "stop", estimates: PIEstimate[] | undefined, headlineIds: string[]): { verdict: "continue" | "steer" | "stop"; issue?: string } {
  if (verdict !== "stop" || headlineIds.length === 0) return { verdict };
  const have = new Set((estimates ?? []).map((e) => e.quantity));
  const missing = headlineIds.filter((id) => !have.has(id));
  if (missing.length === 0) return { verdict };
  return {
    verdict: "steer",
    issue: `PI stop verdict withheld: no independent estimate recorded for headline quantit${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")}. ` +
      `A PI that has not put its own number on the headline has not reviewed it — supply estimates (value ± sigma via a route the experiment did not use) in the next review.`,
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
}

export function writeNeedsOperator(projectDir: string, blockText: string, finishCalls: number): string {
  // notes/escalations/, NOT notes/directives/ — that directory is read back
  // as the USER's highest-priority directive (audit 2026-08-26).
  const dir = join(projectDir, "notes", "escalations");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "needs-operator.md");
  writeFileSync(path, [
    `# needs-operator`,
    ``,
    `finish() was blocked by the SAME gate on three consecutive calls (${finishCalls} finish calls total). The brain is iterating without reducing the issue; this is the livelock signature (297nm run: 4 finish calls, 15 consecutive plan.md reads, 3 operator interventions).`,
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
  for (const d of table.decls.filter((d) => d.experiment === e && (d.headline || table.headlineDeclared.includes(d.id)))) {
    if (d.uncertainty === undefined) problems.push(`${e}: headline quantity "${d.id}" has no \`uncertainty\` — without σ it can never be corroborated (caps at indicative).`);
    if (!d.observable) problems.push(`${e}: headline quantity "${d.id}" has no \`observable\` sentence — the reviewer's discriminator and the contradiction auditor read it.`);
  }
  return problems;
}
