/**
 * smoke_reader_merge — verify skills/search/scripts/merge-notes rolls up
 * per-paper fragments into canonical notes/literature.md + notes/methodology.md.
 *
 *   npx tsx scripts/smoke_reader_merge.mts
 *
 * Covers:
 *   1. Literature fragments → ### cite_key block per file
 *   2. Methodology A/B/C/D bullets deduplicated with paper-ID collection
 *   3. "Papers processed" sorted + deduplicated
 *   4. Idempotence — running the merge twice produces byte-identical output
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(tmpdir(), `luxas-merge-smoke-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MERGE = join(LUXAS_ROOT, "skills", "search", "scripts", "merge-notes");

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── Fixture ─────────────────────────────────────────────────────
mkdirSync(join(root, "notes", "literature.d"), { recursive: true });
mkdirSync(join(root, "notes", "methodology.d"), { recursive: true });

writeFileSync(join(root, "notes/literature.d/Smith2024.md"),
  "- **Authors / Year / Venue**: Smith et al. 2024, Nature\n- **Core claim**: Foo works.\n");
writeFileSync(join(root, "notes/literature.d/Jones2025.md"),
  "- **Authors / Year / Venue**: Jones et al. 2025, PRL\n- **Core claim**: Bar works.\n");
writeFileSync(join(root, "notes/literature.d/Aardvark2023.md"),
  "- **Authors / Year / Venue**: Aardvark 2023, PRX\n- **Core claim**: Baz works.\n");

writeFileSync(join(root, "notes/methodology.d/2401.00001.md"), `## A. Theoretical quantities computed
- pseudo-threshold extracted from multi-distance curve crossings
- encoding rate k/n vs distance

## B. Experimental / simulation demonstrations
- full Stim circuit-level simulation

## D. Rigor thresholds observed
- >=10^5 shots per point

## Papers processed
- 2401.00001 — contributed: threshold method
`);
writeFileSync(join(root, "notes/methodology.d/2502.00002.md"), `## A. Theoretical quantities computed
- pseudo-threshold extracted from multi-distance curve crossings
- ancilla count scaling

## B. Experimental / simulation demonstrations
- full Stim circuit-level simulation

## D. Rigor thresholds observed
- >=10^5 shots per point
- three or more code distances

## Papers processed
- 2502.00002 — contributed: ancilla scaling
`);

// ── Run merge ───────────────────────────────────────────────────
console.log("1. merge-notes first run");
const res = spawnSync(MERGE, [root], { encoding: "utf-8" });
check("exit code 0", res.status === 0, res.stderr);
check("summary line mentions fragment count",
  /merged 3 literature fragments, 2 methodology fragments/.test(res.stdout),
  res.stdout.trim());

const lit = readFileSync(join(root, "notes", "literature.md"), "utf-8");
const meth = readFileSync(join(root, "notes", "methodology.md"), "utf-8");

// ── 1. literature structure ─────────────────────────────────────
console.log("\n2. literature.md structure");
check("has Smith2024 heading", /^### Smith2024\b/m.test(lit));
check("has Jones2025 heading", /^### Jones2025\b/m.test(lit));
check("has Aardvark2023 heading", /^### Aardvark2023\b/m.test(lit));
check("Aardvark sorted first (alpha)", lit.indexOf("### Aardvark") < lit.indexOf("### Jones"));
check("Jones before Smith", lit.indexOf("### Jones") < lit.indexOf("### Smith"));
check("contains body content from Smith", /Foo works\./.test(lit));

// ── 2. methodology dedup + paper IDs ────────────────────────────
console.log("\n3. methodology.md dedup + paper-ID collection");
check("shared bullet has both IDs",
  /pseudo-threshold extracted from multi-distance curve crossings\s+\[2401\.00001, 2502\.00002\]/.test(meth));
check("unique bullet for 2401 alone",
  /encoding rate k\/n vs distance\s+\[2401\.00001\]/.test(meth));
check("unique bullet for 2502 alone",
  /ancilla count scaling\s+\[2502\.00002\]/.test(meth));
check("D section collected >=10^5 across both",
  />=10\^5 shots per point\s+\[2401\.00001, 2502\.00002\]/.test(meth));
check("papers-processed list has both",
  /2401\.00001 — contributed: threshold method/.test(meth) &&
  /2502\.00002 — contributed: ancilla scaling/.test(meth));

// ── 3. idempotence ──────────────────────────────────────────────
console.log("\n4. idempotence");
const res2 = spawnSync(MERGE, [root], { encoding: "utf-8" });
check("second run exit code 0", res2.status === 0, res2.stderr);
const lit2 = readFileSync(join(root, "notes", "literature.md"), "utf-8");
const meth2 = readFileSync(join(root, "notes", "methodology.md"), "utf-8");
check("literature.md unchanged across re-runs", lit === lit2);
check("methodology.md unchanged across re-runs", meth === meth2);

// ── 4. missing fragment dir — doesn't crash ─────────────────────
console.log("\n5. empty project (no fragments)");
const empty = join(root, "empty");
mkdirSync(empty, { recursive: true });
const resEmpty = spawnSync(MERGE, [empty], { encoding: "utf-8" });
check("empty run exit 0", resEmpty.status === 0, resEmpty.stderr);
check("empty summary reports 0 fragments",
  /merged 0 literature fragments, 0 methodology fragments/.test(resEmpty.stdout),
  resEmpty.stdout.trim());

// ── 5. references.bib fragment merge + dup-key collapse ─────────
console.log("\n6. references.d fragment merge");
const bibRoot = join(root, "bib_test");
mkdirSync(join(bibRoot, "report", "references.d"), { recursive: true });
writeFileSync(join(bibRoot, "report/references.d/Vassen1988.bib"),
  "@article{Vassen1988,\n  author = {Vassen, W.},\n  year = {1988},\n  journal = {Phys Rev A}\n}\n");
writeFileSync(join(bibRoot, "report/references.d/Vassen_1988.bib"),
  "@article{Vassen_1988,\n  author = {Vassen et al},\n  year = {1988}\n}\n");
writeFileSync(join(bibRoot, "report/references.d/Wu_2022.bib"),
  "@article{Wu_2022,\n  author = {Wu, Y.},\n  year = {2022}\n}\n");
writeFileSync(join(bibRoot, "report/references.d/Aardvark2023.bib"),
  "@article{Aardvark2023,\n  author = {Aardvark},\n  year = {2023}\n}\n");
const resBib = spawnSync(MERGE, [bibRoot], { encoding: "utf-8" });
check("bib merge exit 0", resBib.status === 0, resBib.stderr);
check("bib merge summary mentions 1 dropped (dup-key)",
  /3 bib entries \(1 dup-key dropped/.test(resBib.stdout),
  resBib.stdout.trim());
const bib = readFileSync(join(bibRoot, "report", "references.bib"), "utf-8");
const bibKeys = [...bib.matchAll(/@\w+\s*\{\s*([A-Za-z0-9_]+)/g)].map(m => m[1]);
check("merged bib has 3 entries", bibKeys.length === 3, bibKeys.join(","));
check("dup variant collapsed (only Vassen1988 kept, alpha-first)",
  bibKeys.includes("Vassen1988") && !bibKeys.includes("Vassen_1988"),
  bibKeys.join(","));
check("non-dup keys preserved", bibKeys.includes("Wu_2022") && bibKeys.includes("Aardvark2023"));
check("merge header present", /Merged from report\/references\.d\//.test(bib));

// ── 6. bib idempotence ──────────────────────────────────────────
const resBib2 = spawnSync(MERGE, [bibRoot], { encoding: "utf-8" });
check("bib second run exit 0", resBib2.status === 0);
const bib2 = readFileSync(join(bibRoot, "report", "references.bib"), "utf-8");
check("bib unchanged across re-runs", bib === bib2);

// ── 7. legacy migration guard: no references.d/ → bib preserved ─
console.log("\n7. legacy migration guard");
const legacy = join(root, "legacy");
mkdirSync(join(legacy, "report"), { recursive: true });
const legacyBib = "@article{Legacy2020,\n  title = {pre-fragment-era entry}\n}\n";
writeFileSync(join(legacy, "report/references.bib"), legacyBib);
const resLegacy = spawnSync(MERGE, [legacy], { encoding: "utf-8" });
check("legacy run exit 0", resLegacy.status === 0);
check("legacy summary mentions skip", /no references\.d\/ — skipped/.test(resLegacy.stdout), resLegacy.stdout.trim());
const legacyBibAfter = readFileSync(join(legacy, "report", "references.bib"), "utf-8");
check("legacy bib unchanged (no overwrite)", legacyBib === legacyBibAfter);

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
