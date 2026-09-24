#!/usr/bin/env tsx
/**
 * route_pairs — harvest every cross_validation pair that carries BOTH method
 * strings and BOTH numbers, from a tree of finished projects.
 *
 * This is the instrument behind notes/route-confession-2026-09-22.md. Its point
 * is the labelling trick: the LABEL comes from the two numbers (agreement to
 * 1e-6 means one computation recorded twice; disagreement past 10% means it
 * cannot be), while everything under test reads only the two method STRINGS.
 * So a route-text rule is scored against evidence it never saw.
 *
 *   npx tsx scripts/route_pairs.mts <projects-root> [--out <file.json>]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RoutePair {
  project: string; experiment: string; key: string;
  method_a: string; method_b: string;
  value_a: number; value_b: number; rel: number; tolerance_rel?: number;
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 7) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "papers") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.name === "results.json") yield p;
  }
}

export function harvest(root: string): RoutePair[] {
  const rows: RoutePair[] = [];
  for (const f of walk(root)) {
    let j: any; try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    const cv = j?.computed?.cross_validation;
    if (!cv || typeof cv !== "object") continue;
    const blocks: [string, any][] = ("method_a" in cv || "value_a" in cv)
      ? [["cross_validation", cv]]
      : Object.entries(cv).filter(([, v]) => v && typeof v === "object") as [string, any][];
    for (const [key, x] of blocks) {
      const ma = typeof x.method_a === "string" ? x.method_a.trim() : "";
      const mb = typeof x.method_b === "string" ? x.method_b.trim() : "";
      const a = Number(x.value_a), b = Number(x.value_b);
      if (!ma || !mb || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      const denom = Math.max(Math.abs(a), Math.abs(b));
      rows.push({
        project: f.replace(root.replace(/\/$/, "") + "/", "").split("/data/experiments/")[0],
        experiment: (f.match(/data\/experiments\/([^/]+)/) || [])[1] ?? "?",
        key, method_a: ma, method_b: mb, value_a: a, value_b: b,
        rel: denom === 0 ? 0 : Math.abs(a - b) / denom,
        tolerance_rel: Number.isFinite(Number(x.tolerance_rel)) ? Number(x.tolerance_rel) : undefined,
      });
    }
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) { console.error("usage: route_pairs.mts <projects-root> [--out <file.json>]"); process.exit(2); }
  const rows = harvest(root);
  const oi = process.argv.indexOf("--out");
  if (oi > 0 && process.argv[oi + 1]) writeFileSync(process.argv[oi + 1], JSON.stringify(rows, null, 1) + "\n");
  const band = (r: RoutePair) => r.rel <= 1e-6 ? "<=1e-6 (one computation twice)" : r.rel > 0.1 ? ">0.1 (cannot be one computation)" : "middle (unlabelled)";
  const c: Record<string, number> = {};
  rows.forEach((r) => { c[band(r)] = (c[band(r)] ?? 0) + 1; });
  console.log(`${rows.length} pairs across ${new Set(rows.map((r) => r.project)).size} projects`);
  for (const [k, v] of Object.entries(c)) console.log(`  ${String(v).padStart(3)}  ${k}`);
}
