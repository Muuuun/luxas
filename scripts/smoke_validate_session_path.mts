#!/usr/bin/env tsx
/**
 * smoke_validate_session_path — verify the F8 fix: SESSION_JSONL_PATH
 * passed to reflect_validate is non-empty when the observation has a
 * session_jsonl_path field, regardless of whether session_id is the
 * agent-stripped bare "checkpoint" or the full timestamped basename.
 *
 * Mirrors the resolution logic in scripts/validate_observation.mts so a
 * regression flips the smoke red.
 */
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

function resolveSessionJsonlPath(target: any): string {
  return typeof target.session_jsonl_path === "string" && target.session_jsonl_path.length > 0
    ? target.session_jsonl_path
    : (target.session_id?.includes("/") ? target.session_id : "");
}

console.log("1. fresh observation with session_jsonl_path field (post-F8-fix shape)");
const r1 = resolveSessionJsonlPath({
  session_id: "checkpoint.done-2026-05-10T11-30-00-000Z.jsonl",
  session_jsonl_path: "/Users/x/projects/proj-a/.agent/checkpoint.done-2026-05-10T11-30-00-000Z.jsonl",
  pattern: "thin_literature",
});
check("uses session_jsonl_path verbatim", r1 === "/Users/x/projects/proj-a/.agent/checkpoint.done-2026-05-10T11-30-00-000Z.jsonl");

console.log("\n2. legacy obs without session_jsonl_path, session_id IS a path");
const r2 = resolveSessionJsonlPath({
  session_id: "/some/full/path/checkpoint.done-2026-04-25T09-30-56-351Z.jsonl",
  pattern: "x",
});
check("falls back to session_id when it has '/'", r2 === "/some/full/path/checkpoint.done-2026-04-25T09-30-56-351Z.jsonl");

console.log("\n3. legacy obs with bare 'checkpoint' (the F8 trigger)");
const r3 = resolveSessionJsonlPath({
  session_id: "checkpoint",
  pattern: "x",
});
check("returns '' for bare-stem session_id (no path inferable)", r3 === "");

console.log("\n4. obs with explicit empty session_jsonl_path string");
const r4 = resolveSessionJsonlPath({
  session_id: "checkpoint.done-2026-05-10T11-30-00-000Z.jsonl",
  session_jsonl_path: "",
  pattern: "x",
});
check("empty session_jsonl_path falls through to session_id check", r4 === "");

console.log("\n5. obs missing session_id entirely");
const r5 = resolveSessionJsonlPath({ pattern: "x" });
check("missing session_id resolves to ''", r5 === "");

console.log("\n6. obs with session_jsonl_path containing both / and timestamped basename");
const r6 = resolveSessionJsonlPath({
  session_id: "checkpoint.done-2026-05-10T11-30-00-000Z.jsonl",
  session_jsonl_path: "/abs/path/to/checkpoint.done-2026-05-10T11-30-00-000Z.jsonl",
});
check("post-F8 obs propagates path correctly", r6.startsWith("/") && r6.endsWith(".jsonl"));

summary();
