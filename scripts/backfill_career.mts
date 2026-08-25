#!/usr/bin/env tsx
/**
 * One-off: harvest the user's ENTIRE project history into the career
 * ledgers — "make all history a career". Walks every project dir under the
 * given roots that has a RESEARCH.md; harvestCareer is idempotent, so
 * re-running only adds new projects.
 *
 * Usage: tsx scripts/backfill_career.mts <root> [root...]
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { harvestCareer } from "../src/career.js";

const roots = process.argv.slice(2);
if (roots.length === 0) { console.error("usage: backfill_career.mts <root>..."); process.exit(2); }

let projects = 0, tf = 0, tc = 0, tl = 0;
function walk(dir: string, depth: number): void {
  if (depth > 5) return;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  if (entries.includes("RESEARCH.md")) {
    const h = harvestCareer(dir);
    if (h) { projects++; tf += h.findings; tc += h.corrections; tl += h.leads;
      if (h.findings + h.corrections + h.leads > 0) console.log(`  ${dir.split("/").slice(-1)[0]}: +${h.findings}f +${h.corrections}c +${h.leads}l`); }
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    try { if (statSync(p).isDirectory()) walk(p, depth + 1); } catch { /* skip */ }
  }
}
for (const r of roots) if (existsSync(r)) walk(r, 0);
console.log(`\nharvested ${projects} new project(s): ${tf} findings, ${tc} corrections, ${tl} open leads`);
