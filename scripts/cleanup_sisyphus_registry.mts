#!/usr/bin/env tsx
/**
 * One-time cleanup of ~/.sisyphus (2026-06-10), companion to the
 * cross-project-memory read-path fix:
 *   1. Drop /tmp throwaway registrations from projects.json
 *   2. Re-derive junk registry names ("Hi Luxas,", "Research Goal", "<research>")
 *      with the fixed deriveProjectTitle, from each project's live RESEARCH.md
 *   3. Re-home stray archive-root *.md files (CJK empty-slug collision victims)
 *      into their proper archive/<slug>/ dir using their Source headers
 *   4. Migrate legacy archive dirs (old basename-only slugs) to the new
 *      hashed slug scheme so future runs append to the same dir instead of
 *      forking a duplicate. For legacy slugs shared by several projects
 *      (e.g. two BOM projects -> "bom"), the dir's content belongs to the
 *      LAST writer, so it migrates to the entry with the latest lastRun.
 *
 * Idempotent — safe to re-run. Prints every change it makes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { deriveProjectTitle, readFileSafe } from "../src/utils.js";
import { archiveSlug } from "../src/memory.js";

const SIS = join(homedir(), ".sisyphus");
const PROJECTS = join(SIS, "projects.json");
const ARCHIVE = join(SIS, "archive");

// ── 1+2: registry prune + name backfill ──
const projects: any[] = JSON.parse(readFileSync(PROJECTS, "utf-8"));
const kept = projects.filter(p => {
  const throwaway = /^(\/private)?\/tmp\//.test(p.path);
  if (throwaway) console.log(`DROP   ${p.path}`);
  return !throwaway;
});

for (const p of kept) {
  const research = readFileSafe(join(p.path, "RESEARCH.md"));
  if (!research) continue;
  const fresh = deriveProjectTitle(research);
  if (fresh !== "Untitled" && fresh !== p.name) {
    console.log(`RENAME ${p.path}\n       "${p.name}" -> "${fresh}"`);
    p.name = fresh;
  }
}
writeFileSync(PROJECTS, JSON.stringify(kept, null, 2));
console.log(`Registry: ${projects.length} -> ${kept.length} entries\n`);

// ── 3: re-home archive-root strays ──
for (const f of readdirSync(ARCHIVE)) {
  const full = join(ARCHIVE, f);
  if (!f.endsWith(".md")) continue; // dirs stay
  const header = readFileSync(full, "utf-8").slice(0, 500);
  const src = header.match(/<!-- Source: (.+?) -->/)?.[1];
  if (!src) { console.log(`SKIP   ${f} (no Source header)`); continue; }
  const projectDir = dirname(dirname(src)); // strip /notes/<file>.md
  const destDir = join(ARCHIVE, archiveSlug(projectDir));
  mkdirSync(destDir, { recursive: true });
  renameSync(full, join(destDir, f));
  console.log(`REHOME ${f} -> archive/${archiveSlug(projectDir)}/ (project: ${projectDir})`);
}

// ── 4: migrate legacy archive dirs to hashed slugs ──
function legacySlug(projectDir: string): string {
  return basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

// For each legacy slug, the migration target is the registry entry with the
// latest lastRun (last-writer-wins matches what the dir actually contains).
const byLegacy = new Map<string, any>();
for (const p of kept) {
  const slug = legacySlug(p.path);
  if (!slug) continue;
  const prev = byLegacy.get(slug);
  if (!prev || p.lastRun > prev.lastRun) byLegacy.set(slug, p);
}
for (const [legacy, p] of byLegacy) {
  const oldDir = join(ARCHIVE, legacy);
  const newDir = join(ARCHIVE, archiveSlug(p.path));
  if (existsSync(oldDir) && !existsSync(newDir)) {
    renameSync(oldDir, newDir);
    console.log(`MIGRATE archive/${legacy}/ -> archive/${archiveSlug(p.path)}/`);
  }
}
console.log("Done.");
