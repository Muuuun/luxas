/**
 * claims_compliance — field-wise producer compliance for the claims-first contract.
 *
 * Reader for the design §7.4 live probe: before any gate is trusted on a field,
 * measure how often live producers actually fill it. Fields under ~80% get
 * demoted to optional or redesigned (design §7, step 4).
 *
 * Usage: npx tsx scripts/claims_compliance.mts <project-dir> [--json]
 *
 * Measures, per role:
 *   experiment  — results.json computed.quantities[] {id,key,headline,observable,
 *                 uncertainty,uncertainty_source,limit_check,inputs}; verdicts[] {id,reads,replaces}
 *   reviewer    — reviews/experiment_review_*_r*.md DISCRIMINATOR / ESTIMATE(blind) /
 *                 SCALING / INDEPENDENT / ANCHOR-OK per headline quantity in scope
 *   PI          — reviews/pi_feedback.md ESTIMATE / DISCRIMINATOR lines
 *   brain       — notes/frame.md "## Headline quantities" (present, 1..N ids)
 *
 * Raw JSON is read directly (not via buildClaimTable) so that malformed-but-present
 * fields still count as "attempted" — the point is producer behaviour, not gate output.
 * Field LOCATION follows resolveQuantity (entry → co-located leaf → numeric leaf's
 * parent), the same tolerance the table applies; how often producers co-locate
 * is reported as its own row.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrameHeadline, parseReviewerLines, resolveQuantity, HARNESS_REVIEW_FILE_RE } from "../src/claims-table.ts";

export interface FieldRate { field: string; filled: number; total: number; rate: number | null; valid?: number }
export interface ComplianceReport {
  projectDir: string;
  experiments: number;
  runsWithResults: number;
  runsDeclaringQuantities: number;
  quantities: number;
  verdicts: number;
  fields: FieldRate[];
  reviewer: { files: number; headlineIdsInScope: string[]; perLine: FieldRate[]; malformed: string[] };
  pi: { present: boolean; estimateLines: number; discriminatorLines: number };
  brain: { frameHeadline: string[]; headlineTrue: string[] };
  below80: string[];
}

function rate(filled: number, total: number): number | null { return total === 0 ? null : filled / total; }
function fr(field: string, filled: number, total: number, valid?: number): FieldRate { return { field, filled, total, rate: rate(filled, total), valid }; }

function listResults(projectDir: string): { experiment: string; path: string }[] {
  const root = join(projectDir, "data", "experiments");
  if (!existsSync(root)) return [];
  const out: { experiment: string; path: string }[] = [];
  for (const e of readdirSync(root)) {
    const runs = join(root, e, "runs");
    if (!existsSync(runs) || !statSync(runs).isDirectory()) continue;
    for (const r of readdirSync(runs)) {
      const p = join(runs, r, "results.json");
      if (existsSync(p)) out.push({ experiment: e, path: p });
    }
  }
  return out;
}

function getPath(obj: any, key: string): unknown {
  return key.split(".").reduce<any>((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

export function measureCompliance(projectDir: string): ComplianceReport {
  const results = listResults(projectDir);
  const experiments = new Set(results.map((r) => r.experiment)).size;

  let runsDeclaring = 0;
  const qs: any[] = [];
  const vs: any[] = [];
  const knownIds = new Set<string>();
  for (const r of results) {
    let j: any;
    try { j = JSON.parse(readFileSync(r.path, "utf-8")); } catch { continue; }
    const arr = j?.computed?.quantities;
    if (Array.isArray(arr) && arr.length) {
      runsDeclaring++;
      for (const q of arr) {
        // Same resolution as buildClaimTable: entry fields win, then the
        // co-located object (leaf or the numeric leaf's parent) fills gaps.
        const r = typeof q?.key === "string" ? resolveQuantity(j, q.key) : { leaf: undefined, meta: undefined, metaFrom: undefined };
        const merged = { ...(r.meta ?? {}), ...(q ?? {}) };
        qs.push({ q: merged, j, raw: q, metaFrom: r.metaFrom, leaf: r.leaf });
        if (typeof q?.id === "string") knownIds.add(q.id);
      }
    }
    const varr = j?.computed?.verdicts ?? j?.verdicts;
    if (Array.isArray(varr)) for (const v of varr) vs.push(v);
  }

  const n = qs.length;
  const count = (pred: (q: any, j: any) => boolean) => qs.filter(({ q, j }) => pred(q, j)).length;
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const fields: FieldRate[] = [
    fr("quantities[] declared (per run)", runsDeclaring, results.length),
    fr("id (string)", count((q) => typeof q.id === "string" && q.id.length > 0), n),
    fr("key (string)", count((q) => typeof q.key === "string"), n,
      qs.filter(({ leaf }) => isNum(leaf) || (leaf && typeof leaf === "object" && (isNum((leaf as any).value) || Object.entries(leaf as any).filter(([k, v]) => /^value(_|$)/.test(k) && isNum(v)).length === 1))).length),
    fr("metadata co-located under computed.* (not on the entry)", qs.filter(({ metaFrom }) => metaFrom !== undefined).length, n),
    fr("headline (boolean present)", count((q) => typeof q.headline === "boolean"), n),
    fr("observable (sentence ≥ 40 chars)", count((q) => typeof q.observable === "string" && q.observable.trim().length >= 40), n),
    fr("uncertainty (present)", count((q) => q.uncertainty !== undefined), n,
      count((q) => isNum(q.uncertainty) && q.uncertainty > 0)),
    fr("uncertainty_source", count((q) => typeof q.uncertainty_source === "string" && q.uncertainty_source.length > 0), n),
    fr("limit_check (present)", count((q) => q.limit_check !== undefined), n,
      count((q) => q.limit_check && typeof q.limit_check.limit === "string" && isNum(q.limit_check.expected) && isNum(q.limit_check.observed))),
    fr("limit_check.artifact", count((q) => typeof q.limit_check?.artifact === "string"), n),
    fr("inputs (present)", count((q) => q.inputs !== undefined), n,
      count((q) => q.inputs && typeof q.inputs === "object" && !Array.isArray(q.inputs)
        && Object.entries(q.inputs).every(([k, v]) => knownIds.has(k) && isNum(v)))),
    fr("inputs non-empty", count((q) => q.inputs && typeof q.inputs === "object" && Object.keys(q.inputs).length > 0), n),
  ];
  const nv = vs.length;
  fields.push(
    fr("verdicts[].id", vs.filter((v) => typeof v?.id === "string").length, nv),
    fr("verdicts[].reads (non-empty, known ids)", vs.filter((v) => Array.isArray(v?.reads) && v.reads.length > 0 && v.reads.every((x: unknown) => typeof x === "string" && knownIds.has(x))).length, nv),
    fr("verdicts[].replaces (present)", vs.filter((v) => v?.replaces !== undefined).length, nv),
  );

  // reviewer obligations
  const reviewsDir = join(projectDir, "reviews");
  const reviewFiles = existsSync(reviewsDir) ? readdirSync(reviewsDir).filter((f) => HARNESS_REVIEW_FILE_RE.test(f) && f !== "pi_feedback.md") : [];
  const lines = parseReviewerLines(projectDir);
  const frame = parseFrameHeadline(projectDir);
  const headlineTrue = qs.filter(({ q }) => q.headline === true && typeof q.id === "string").map(({ q }) => q.id as string);
  const scope = [...new Set([...frame, ...headlineTrue])];
  const has = (ids: Iterable<string>, id: string) => [...ids].includes(id);
  const perLine: FieldRate[] = [
    fr("DISCRIMINATOR per headline id", scope.filter((id) => lines.discriminators.some((d) => d.id === id)).length, scope.length),
    fr("ESTIMATE(blind) per headline id", scope.filter((id) => lines.blind.some((e) => e.quantity === id)).length, scope.length,
      scope.filter((id) => lines.blind.some((e) => e.quantity === id && e.sigma !== undefined)).length),
    fr("SCALING per headline id", scope.filter((id) => lines.scaling.some((s) => s.id === id)).length, scope.length,
      scope.filter((id) => lines.scaling.some((s) => s.id === id && s.observed !== undefined)).length),
    fr("INDEPENDENT per headline id", scope.filter((id) => has(lines.independent, id)).length, scope.length),
    fr("ANCHOR-OK per headline id", scope.filter((id) => has(lines.anchorOk, id)).length, scope.length),
    fr("review files with ≥1 DISCRIMINATOR", reviewFiles.filter((f) => /^DISCRIMINATOR:/m.test(readFileSync(join(reviewsDir, f), "utf-8"))).length, reviewFiles.length),
  ];

  // PI
  const piPath = join(reviewsDir, "pi_feedback.md");
  const piText = existsSync(piPath) ? readFileSync(piPath, "utf-8") : "";
  const pi = {
    present: existsSync(piPath),
    estimateLines: (piText.match(/^ESTIMATE(\(blind\))?:/gm) ?? []).length,
    discriminatorLines: (piText.match(/^DISCRIMINATOR:/gm) ?? []).length,
  };

  const all = [...fields, ...perLine];
  const below80 = all.filter((f) => f.rate !== null && f.rate < 0.8).map((f) => f.field);

  return {
    projectDir, experiments, runsWithResults: results.length, runsDeclaringQuantities: runsDeclaring,
    quantities: n, verdicts: nv, fields,
    reviewer: { files: reviewFiles.length, headlineIdsInScope: scope, perLine, malformed: lines.malformed },
    pi, brain: { frameHeadline: frame, headlineTrue }, below80,
  };
}

export function renderCompliance(r: ComplianceReport): string {
  const pct = (f: FieldRate) => f.rate === null ? "   n/a" : `${String(Math.round(f.rate * 100)).padStart(4)}%`;
  const row = (f: FieldRate) => {
    const flag = f.rate !== null && f.rate < 0.8 ? "  ◀ <80%" : "";
    const valid = f.valid !== undefined ? `  (valid ${f.valid}/${f.total})` : "";
    return `  ${pct(f)}  ${String(f.filled).padStart(3)}/${String(f.total).padEnd(3)}  ${f.field}${valid}${flag}`;
  };
  const out: string[] = [];
  out.push(`claims compliance — ${r.projectDir}`);
  out.push(`experiments ${r.experiments}, runs with results.json ${r.runsWithResults}, runs declaring quantities ${r.runsDeclaringQuantities}, quantities ${r.quantities}, verdicts ${r.verdicts}`);
  out.push(`\nexperiment (producer):`);
  out.push(...r.fields.map(row));
  out.push(`\nbrain: frame.md headline = [${r.brain.frameHeadline.join(", ") || "—"}]; headline:true = [${r.brain.headlineTrue.join(", ") || "—"}]`);
  out.push(`\nreviewer (${r.reviewer.files} harness review files; scope = [${r.reviewer.headlineIdsInScope.join(", ") || "—"}]):`);
  out.push(...r.reviewer.perLine.map(row));
  if (r.reviewer.malformed.length) out.push(`  malformed lines: ${r.reviewer.malformed.length}\n    ` + r.reviewer.malformed.slice(0, 5).join("\n    "));
  out.push(`\nPI: pi_feedback.md ${r.pi.present ? "present" : "absent"}; ESTIMATE lines ${r.pi.estimateLines}; DISCRIMINATOR lines ${r.pi.discriminatorLines}`);
  out.push(`\nbelow 80% (demote-to-optional candidates, design §7.4): ${r.below80.length ? "\n  - " + r.below80.join("\n  - ") : "none"}`);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) { console.error("usage: claims_compliance.mts <project-dir> [--json]"); process.exit(2); }
  const r = measureCompliance(dir);
  console.log(json ? JSON.stringify(r, null, 2) : renderCompliance(r));
}
