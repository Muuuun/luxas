#!/usr/bin/env tsx
/**
 * smoke_bib_dedup — empirically test prompt-layer fix for the references.bib
 * collision problem observed in the Ba run.
 *
 * 3 parallel readers, each told to read ONE paper. Compare how many extra
 * bib entries each reader adds (collisions when the same shared ref gets
 * named differently by different readers).
 *
 * Conditions:
 *   A1 — stock reader.md
 *   A2 — append "ONLY add ONE bib entry for your assigned paper" rule
 *
 * Usage: npx tsx scripts/smoke_bib_dedup.mts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnAgent } from "../src/agents/spawn.js";
import { getDefinition } from "../src/agents/registry.js";
import type { AgentDefinition } from "../src/agents/registry.js";
import { getApiKey } from "../src/auth.js";

const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_SCRIPT = join(LUXAS_ROOT, "skills", "search", "scripts", "search");
const FIXTURE_PROJECT = "/Users/muqiao/Documents/sisyphus-projects/ba-atom-qc-feasibility";
const PAPERS = ["1811.06014", "1810.06537", "1810.10517"];
const TRIALS = 2;

const A2_RULE = `

## CRITICAL OVERRIDE — bib entry scope

You MAY ONLY add ONE BibTeX entry to \`report/references.bib\` — the entry whose \`cite_key\` corresponds to YOUR assigned paper ({{PAPER_ID}}). You MUST NOT add BibTeX entries for ANY other papers cited within {{PAPER_ID}}, no matter how relevant they appear. Adding extra entries causes parallel-reader collisions and is a hard violation.

If you observe references in {{PAPER_ID}} that you think are important, mention them in the literature.d/ fragment's "Key methods / assumptions" or "Relevance to this project" prose — do NOT touch \`references.bib\` for them.`;

function patchedReader(): AgentDefinition {
  const original = getDefinition("reader");
  return { ...original, systemPromptTemplate: original.systemPromptTemplate + A2_RULE };
}

function makeProjectDir(label: string, trial: number): string {
  const dir = join(tmpdir(), `luxas-bib-test-${label}-${trial}-${Date.now()}`);
  mkdirSync(join(dir, "data", "papers"), { recursive: true });
  mkdirSync(join(dir, "report"), { recursive: true });
  mkdirSync(join(dir, "notes", "literature.d"), { recursive: true });
  mkdirSync(join(dir, "notes", "methodology.d"), { recursive: true });
  writeFileSync(join(dir, "RESEARCH.md"),
    "# Goal\n\nFeasibility study of barium atoms for quantum computing. Cover Sr/Yb prior art on magic-wavelength tweezers, narrow-line cooling, and high-fidelity imaging.\n");
  writeFileSync(join(dir, "report", "references.bib"), "");
  for (const id of PAPERS) {
    const src = join(FIXTURE_PROJECT, "data", "papers", id);
    const dst = join(dir, "data", "papers", id);
    cpSync(src, dst, { recursive: true });
  }
  return dir;
}

async function spawnReader(projectDir: string, paperId: string, idx: number, condition: "A1" | "A2") {
  const resolveDefinition = condition === "A2" ? () => patchedReader() : undefined;
  return spawnAgent({
    name: "reader",
    templateVars: { PROJECT_DIR: projectDir, PAPER_ID: paperId, SEARCH_SCRIPT },
    prompt: `Read paper ${paperId}. Extract methodology + literature entry per the reader spec.`,
    projectDir,
    getApiKey,
    instanceIndex: idx,
    resolveDefinition,
    modelOverride: "deepseek-v4-pro",
  });
}

interface BibStats {
  totalEntries: number;
  uniqueCiteKeys: number;
  collisionGroups: string[][];
  citeKeys: string[];
  extras: string[];
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[_-]/g, "");
}

function analyzeBib(bibPath: string, assignedPapers: string[]): BibStats {
  const bib = existsSync(bibPath) ? readFileSync(bibPath, "utf-8") : "";
  const keys = [...bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map(m => m[1]);
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const n = normalizeKey(k);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push(k);
  }
  const collisionGroups = [...groups.values()].filter(g => new Set(g).size > 1);
  const assignedNorm = new Set(assignedPapers.map(p => normalizeKey(p.replace(/\W/g, ""))));
  const extras = keys.filter(k => {
    const n = normalizeKey(k);
    for (const a of assignedPapers) {
      const lastTok = a.split(/[._]/).pop() || a;
      if (n.includes(normalizeKey(lastTok))) return false;
    }
    return true;
  });
  return {
    totalEntries: keys.length,
    uniqueCiteKeys: groups.size,
    collisionGroups,
    citeKeys: keys,
    extras,
  };
}

async function runTrial(condition: "A1" | "A2", trial: number) {
  const dir = makeProjectDir(condition, trial);
  console.log(`\n[${condition} trial ${trial}] dir=${dir}`);
  const t0 = Date.now();
  const results = await Promise.all(PAPERS.map((p, i) => spawnReader(dir, p, i, condition)));
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const stats = analyzeBib(join(dir, "report", "references.bib"), PAPERS);
  const success = results.filter(r => r.success).length;
  console.log(`  elapsed ${elapsed}s, readers ${success}/${results.length} ok`);
  console.log(`  bib entries: ${stats.totalEntries} (unique normalized: ${stats.uniqueCiteKeys})`);
  console.log(`  cite keys: ${stats.citeKeys.join(", ")}`);
  if (stats.collisionGroups.length > 0)
    console.log(`  COLLISIONS: ${stats.collisionGroups.map(g => `[${g.join(" / ")}]`).join(", ")}`);
  console.log(`  extra entries (not from assigned papers): ${stats.extras.length} → ${stats.extras.join(", ") || "none"}`);
  return { condition, trial, dir, elapsed, stats, success };
}

const allResults: any[] = [];
for (const cond of ["A1", "A2"] as const) {
  for (let t = 0; t < TRIALS; t++) {
    allResults.push(await runTrial(cond, t));
  }
}

console.log("\n=== SUMMARY ===");
for (const cond of ["A1", "A2"]) {
  const trials = allResults.filter(r => r.condition === cond);
  const totalEntries = trials.reduce((s, t) => s + t.stats.totalEntries, 0);
  const totalCollisions = trials.reduce((s, t) => s + t.stats.collisionGroups.length, 0);
  const totalExtras = trials.reduce((s, t) => s + t.stats.extras.length, 0);
  const avgEntries = (totalEntries / trials.length).toFixed(1);
  console.log(`${cond}: avg ${avgEntries} bib entries/trial, total ${totalCollisions} collision-groups, total ${totalExtras} extras across ${trials.length} trials`);
}
