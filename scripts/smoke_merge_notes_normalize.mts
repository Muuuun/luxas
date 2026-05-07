#!/usr/bin/env tsx
/**
 * smoke_merge_notes_normalize — verify merge-notes rewrites bib-fragment
 * inner cite_keys to match their filename.
 *
 * Bug surfaced in encoding-rate-0.5: readers wrote
 *   references.d/Panteleev2022.bib
 * containing
 *   @inproceedings{Panteleev_2022, ...}
 * brain cited `\cite{Panteleev2022}` (matching the filename); bibtex
 * couldn't find Panteleev2022 (only Panteleev_2022) and the citation
 * rendered as [?] in the PDF.
 *
 * Fix: merge-notes detects filename ≠ inner-key and rewrites the inner
 * key to match the filename (logged so the reader-side generation bug
 * stays visible).
 *
 *   npx tsx scripts/smoke_merge_notes_normalize.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

const tmp = mkdtempSync(join(tmpdir(), "luxas-mergenotes-"));
try {
  const proj = tmp;
  mkdirSync(join(proj, "report", "references.d"), { recursive: true });
  mkdirSync(join(proj, "notes"), { recursive: true });

  // Three fragments: filename ≠ inner key (underscore variant + DOI key + match)
  writeFileSync(join(proj, "report", "references.d", "Panteleev2022.bib"),
    `@inproceedings{Panteleev_2022,\n  title = {qLDPC},\n  author = {Panteleev and Kalachev},\n  year = 2022\n}\n`);
  writeFileSync(join(proj, "report", "references.d", "Berthusen2024.bib"),
    `@article{https://doi.org/10.48550/arxiv.2404.17676,\n  title = {Lifted product},\n  year = 2024\n}\n`);
  writeFileSync(join(proj, "report", "references.d", "Zhao2026.bib"),
    `@misc{Zhao2026,\n  title = {APM codes},\n  year = 2026\n}\n`);

  const mergeScript = "/Users/muqiao/Documents/Sisyphus/skills/search/scripts/merge-notes";
  // Capture stderr too — console.warn lines (the rename notices) go there.
  const stdout = execSync(`node "${mergeScript}" "${proj}" 2>&1`, { encoding: "utf-8" });

  console.log("1. merge runs and reports normalization");
  check("output mentions cite_key normalized count",
    /cite_key normalized/.test(stdout), `output: ${stdout}`);
  check("warns about Panteleev2022 rename",
    /Panteleev2022.*Panteleev_2022.*Panteleev2022/.test(stdout) ||
    /Panteleev2022.*Panteleev_2022/.test(stdout));
  check("warns about Berthusen2024 rename",
    /Berthusen2024.*doi.org/i.test(stdout));
  check("does NOT warn about Zhao2026 (already matched)",
    !/Zhao2026.*→.*Zhao2026/.test(stdout));

  console.log("\n2. references.bib has filename-matched keys");
  const bib = readFileSync(join(proj, "report", "references.bib"), "utf-8");
  check("has @inproceedings{Panteleev2022,", /@inproceedings\s*\{\s*Panteleev2022\s*,/.test(bib));
  check("has @article{Berthusen2024,",       /@article\s*\{\s*Berthusen2024\s*,/.test(bib));
  check("has @misc{Zhao2026,",               /@misc\s*\{\s*Zhao2026\s*,/.test(bib));
  check("does NOT contain underscore variants",
    !/\{Panteleev_2022\b/.test(bib));
  check("does NOT contain raw DOI keys",
    !/\{https:\/\//.test(bib));

  console.log("\n3. payload preserved (only the key changed)");
  check("Panteleev fragment still has the title",  /qLDPC/.test(bib));
  check("Berthusen fragment still has the title",  /Lifted product/.test(bib));
  check("Zhao fragment still has the title",       /APM codes/.test(bib));
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
