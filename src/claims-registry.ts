/**
 * The claim registry: every claimable structured value in the project, as a
 * PURE FUNCTION over the experiments' results.json files.
 *
 * This is the fix for architecture defect #1 (2026-08-24 diagnosis): claims
 * are BORN structured — `computed.gamow_factor = 42.66` — then flattened into
 * ledger prose, re-flattened into report prose, and finally re-joined to
 * their own origin by exact-string `claim_key`s that report_writer INVENTED
 * from memory. Measured cost of that round-trip: 0/18 claims matching their
 * executed cross-validations in magic-state-cultivation, 0/11 in
 * 量子计算在组合优化 — 40 agreeing controls collapsing to 1 corroborated
 * grade. The registry ends key invention: downstream consumers PICK keys
 * from here; they never coin them.
 *
 * Deliberately NOT a persisted file. A stored registry can drift from
 * results.json and would need its own freshness gate (and could itself be
 * hand-edited into a lie); a computed view cannot. results.json remains the
 * single source of truth — this module is a lens, and staleness is
 * structurally impossible.
 *
 * Consumers (the reader is named here per the producer-consumer rule):
 *   - context-builders.ts injects it into report_writer's context as
 *     <claim_registry>, so the writer picks keys with xval status visible;
 *   - safety-wrappers.ts validates claims.json / results.json writes against
 *     it at WRITE TIME, suggesting nearest keys on a miss;
 *   - the finish gates stay unchanged as the backstop (an unknown key simply
 *     never matches an xval, so 1c caps it at indicative; 5f still catches
 *     misattributed agreeing controls by value).
 */

import { readFileSync } from "node:fs";
import { listExperimentDirs, xvalVerdict } from "./tools/report-integrity.js";

export interface RegistryEntry {
  /** Dotted claim key, e.g. "computed.gamow_factor" — the ONLY legal spelling. */
  key: string;
  /** The leaf value when it is a finite number; undefined for non-numeric leaves. */
  value?: number;
  /** Experiment id, e.g. "E3". */
  experiment: string;
  /** Harness verdict of the best cross_validation entry recorded for this key. */
  xval: "corroborated" | "discrepant" | "identical" | "malformed" | null;
  /** True when a cross_validation_plan names this key (run-or-demote pending). */
  planned: boolean;
}

const XVAL_RANK: Record<string, number> = { corroborated: 3, discrepant: 2, identical: 1, malformed: 0 };

/** Flatten the `computed` tree to dotted leaf keys. Arrays index as [i]. */
function flatten(prefix: string, node: unknown, out: { key: string; value?: number }[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "number") {
    out.push({ key: prefix, value: Number.isFinite(node) ? node : undefined });
    return;
  }
  if (typeof node === "string" || typeof node === "boolean") {
    out.push({ key: prefix });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(`${prefix}[${i}]`, v, out));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}.${k}` : k, v, out);
    }
  }
}

/** Bookkeeping subtrees that are not claims themselves. */
const NON_CLAIM_SUBTREES = /^computed\.(cross_validation|cross_validation_plan|cross_validation_resolved|method_blocked|method_ladder)\b/;

export function buildClaimRegistry(projectDir: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    if (!e.latestResults) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); } catch { continue; }
    const computed = j?.computed;
    if (!computed || typeof computed !== "object") continue;

    const xvalByKey = new Map<string, RegistryEntry["xval"]>();
    for (const x of (Array.isArray(computed.cross_validation) ? computed.cross_validation : [])) {
      if (!x || typeof x !== "object") continue;
      const k = String(x.claim_key ?? "");
      if (!k) continue;
      const v = xvalVerdict(x) ?? "malformed";
      const prev = xvalByKey.get(k);
      if (!prev || XVAL_RANK[v] > XVAL_RANK[prev]) xvalByKey.set(k, v);
    }
    const planned = new Set(
      (Array.isArray(computed.cross_validation_plan) ? computed.cross_validation_plan : [])
        .map((p: any) => String(p?.claim_key ?? "")).filter(Boolean));

    const leaves: { key: string; value?: number }[] = [];
    flatten("computed", computed, leaves);
    for (const leaf of leaves) {
      if (NON_CLAIM_SUBTREES.test(leaf.key)) continue;
      entries.push({
        key: leaf.key,
        value: leaf.value,
        experiment: e.id,
        xval: xvalByKey.get(leaf.key) ?? null,
        planned: planned.has(leaf.key),
      });
    }
  }
  return entries;
}

/** Nearest registry keys to a miss, by shared dotted-path tokens — for the
 * write-time "did you mean" message. */
export function nearestKeys(miss: string, registry: RegistryEntry[], n = 3): string[] {
  const tok = (k: string) => new Set(k.toLowerCase().split(/[.\[\]_]+/).filter((t) => t.length > 2));
  const m = tok(miss);
  return [...new Set(registry.map((r) => r.key))]
    .map((k) => {
      const t = tok(k);
      let shared = 0;
      for (const x of m) if (t.has(x)) shared++;
      return { k, shared };
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, n)
    .map((x) => x.k);
}

/** Rendered-context budget: beyond this many lines, plain keys are grouped
 * by subtree (loud, never silently dropped — defect #2 must not be recreated
 * here). Membership checks always use the FULL registry regardless. */
const RENDER_LINE_BUDGET = 400;

/** Render the registry as the compact block injected into report_writer's
 * context. Arrays collapse to a range line; when the corpus is huge (a real
 * project carried 33,698 leaves — benchmark arrays), keys WITH evidence
 * status render individually and the rest group per subtree with counts, so
 * nothing is dropped without saying so. */
export function renderClaimRegistry(registry: RegistryEntry[]): string {
  if (registry.length === 0) return "";
  const numeric = registry.filter((r) => r.value !== undefined);
  const nonNumeric = registry.length - numeric.length;

  // Collapse array runs: key[0..N] on one line (claims cite specific elements
  // rarely; membership still accepts every element key).
  const arrays = new Map<string, { count: number; experiment: string }>();
  const scalars: RegistryEntry[] = [];
  for (const r of numeric) {
    const m = r.key.match(/^(.*)\[\d+\]$/);
    if (m && r.xval === null && !r.planned) {
      const a = arrays.get(m[1]) ?? { count: 0, experiment: r.experiment };
      a.count++; arrays.set(m[1], a);
    } else scalars.push(r);
  }

  const statusOf = (r: RegistryEntry): string =>
    r.xval === "corroborated" ? "xval:CORROBORATED (may headline as corroborated)"
      : r.xval === "discrepant" ? "xval:DISCREPANT (disputed — may headline only at grade disputed with a hedge; the producer cannot resolve it)"
      : r.xval ? `xval:${r.xval} (does not count — grade caps at indicative)`
      : r.planned ? "xval:planned-unrun (grade caps at indicative until executed)"
      : "no-xval (grade caps at indicative)";

  const withStatus = scalars.filter((r) => r.xval !== null || r.planned);
  const plain = scalars.filter((r) => r.xval === null && !r.planned);
  const lines: string[] = withStatus.map((r) => `${r.key} = ${r.value}  [${r.experiment}]  ${statusOf(r)}`);

  let grouped = 0;
  if (withStatus.length + plain.length + arrays.size <= RENDER_LINE_BUDGET) {
    for (const r of plain) lines.push(`${r.key} = ${r.value}  [${r.experiment}]  ${statusOf(r)}`);
  } else {
    // First collapse mid-path array indices to a wildcard pattern —
    // `waterflooding[3].cosine_similarity` and its 40 siblings become ONE
    // `waterflooding[*].cosine_similarity` line (the real 33k-leaf project
    // is almost entirely this shape). If the pattern list still exceeds the
    // budget, group further by leading path segments. Counts always stated.
    const patterns = new Map<string, { count: number; experiment: string }>();
    for (const r of plain) {
      const pat = r.key.replace(/\[\d+\]/g, "[*]");
      const g = patterns.get(pat) ?? { count: 0, experiment: r.experiment };
      g.count++; patterns.set(pat, g);
    }
    const emit = (label: string, g: { count: number; experiment: string }) => {
      lines.push(g.count === 1
        ? `${label}  [${g.experiment}]`
        : `${label} — ${g.count} keys  [${g.experiment}]  (read the results.json for exact spellings)`);
      grouped += g.count;
    };
    if (patterns.size <= RENDER_LINE_BUDGET) {
      for (const [pat, g] of [...patterns.entries()].sort()) emit(pat, g);
    } else {
      const groups = new Map<string, { count: number; experiment: string }>();
      for (const [pat, g] of patterns) {
        const seg = pat.split(".").slice(0, 3).join(".");
        const cur = groups.get(seg) ?? { count: 0, experiment: g.experiment };
        cur.count += g.count; groups.set(seg, cur);
      }
      for (const [seg, g] of [...groups.entries()].sort()) emit(`${seg}.*`, g);
    }
  }
  for (const [base, a] of [...arrays.entries()].sort()) {
    lines.push(`${base}[0..${a.count - 1}] — ${a.count} array elements  [${a.experiment}]`);
  }

  return `<claim_registry entries="${numeric.length}"${grouped ? ` grouped="${grouped}"` : ""}>\n` +
    `Every structured value the experiments produced, with its ONLY legal claim_key spelling and its ` +
    `cross-validation status. When a number in your prose comes from an experiment, its claims.json entry ` +
    `MUST use the key exactly as printed here — pick, never invent. A grouped \`prefix.*\` line means those ` +
    `keys exist but are summarized for space: read that experiment's results.json for the exact spelling ` +
    `before citing one. A number with no registry row is not an experiment result: source it from the ` +
    `literature entry it came from, or leave it out of the headline.\n\n` +
    lines.join("\n") +
    (nonNumeric > 0 ? `\n(+ ${nonNumeric} non-numeric keys omitted)` : "") +
    `\n</claim_registry>`;
}
