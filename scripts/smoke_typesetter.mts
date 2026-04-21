#!/usr/bin/env tsx
/**
 * Smoke: typesetter agent on a real project (inbox_B6Bk_xVQ2503).
 *
 * Forces haiku to keep the test cheap. Verifies the prompt produces a
 * parseable reviews/typesetter_notes.md with the YAML frontmatter the
 * finish-gate requires.
 *
 * Run: ./node_modules/.bin/tsx scripts/smoke_typesetter.mts
 */

import { existsSync, readFileSync, statSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnAgent } from "../src/agents/spawn.js";
import { getApiKey } from "../src/auth.js";
import { installUsageTracking } from "../src/usage-log.js";

const PROJECT_DIR = "/Users/muqiao/Documents/sisyphus-projects/33de130e831c/projects/inbox_B6Bk_xVQ2503";
const NOTES_PATH = join(PROJECT_DIR, "reviews", "typesetter_notes.md");
const PAGES_DIR = join(PROJECT_DIR, "reviews", "typesetter_pages");
const PDF_PATH = join(PROJECT_DIR, "report", "report.pdf");

if (!existsSync(PDF_PATH)) {
  console.error(`FAIL: ${PDF_PATH} does not exist — typesetter has nothing to audit.`);
  process.exit(1);
}

// Clean any prior notes so we know the agent produced this run's output.
if (existsSync(NOTES_PATH)) unlinkSync(NOTES_PATH);
if (existsSync(PAGES_DIR)) rmSync(PAGES_DIR, { recursive: true, force: true });

installUsageTracking(join(PROJECT_DIR, ".agent", "usage.log"));

console.log(`Running typesetter on ${PROJECT_DIR} (model: haiku)...`);
const t0 = Date.now();
const result = await spawnAgent({
  name: "typesetter",
  templateVars: { PROJECT_DIR },
  prompt:
    "Audit report/report.pdf page-by-page for document-level layout per your prompt. " +
    "Write reviews/typesetter_notes.md with the required YAML frontmatter " +
    "(status, audited_at, report_pdf_md5, report_tex_md5, page_count, pages_audited).",
  projectDir: PROJECT_DIR,
  getApiKey,
  modelOverride: "haiku",
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n--- Agent output (success=${result.success}, ${elapsed}s) ---`);
console.log(result.output.slice(0, 500));
console.log(`---`);

// Verify notes file
let failures = 0;
if (!existsSync(NOTES_PATH)) {
  console.log(`FAIL: ${NOTES_PATH} not created.`);
  failures++;
} else {
  const notes = readFileSync(NOTES_PATH, "utf-8");
  const fm = notes.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    console.log("FAIL: typesetter_notes.md has no YAML frontmatter.");
    failures++;
  } else {
    const fmBody = fm[1];
    const required = ["status", "audited_at", "report_pdf_md5", "page_count"];
    for (const key of required) {
      if (!new RegExp(`^${key}:`, "m").test(fmBody)) {
        console.log(`FAIL: frontmatter missing key: ${key}`);
        failures++;
      }
    }
    const status = fmBody.match(/^status:\s*(\S+)/m)?.[1];
    const md5 = fmBody.match(/^report_pdf_md5:\s*([0-9a-f]+)/m)?.[1];
    console.log(`\nFrontmatter parsed:`);
    console.log(`  status=${status}`);
    console.log(`  report_pdf_md5=${md5?.slice(0, 12) ?? "MISSING"}…`);
    console.log(`  notes size: ${notes.length} bytes`);
    console.log(`  Summary section: ${notes.match(/##\s*Summary/) ? "present" : "MISSING"}`);
  }
}

if (failures === 0) {
  console.log(`\nPASS — typesetter prompt produces valid notes file (${elapsed}s on haiku)`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
