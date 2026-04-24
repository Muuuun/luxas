/**
 * smoke_file_context_cache — Phase 3a: FileContextCache + safety-wrapper wiring.
 *
 *   npx tsx scripts/smoke_file_context_cache.mts
 *
 * Verifies that successful read/write/edit through the safety wrapper:
 *   - Populates the internal FileContextCache (enforcement still works).
 *   - Fires onFileContextEntry with the full entry (content, mtime,
 *     touchedAt, via, range for partials).
 *   - Respects the FILE_CONTEXT_MAX_ENTRY_BYTES cap — entries for files
 *     larger than the cap keep mtime/path/via only, no content.
 *   - onFileTouched still fires for write/edit (PR-1 contract unchanged).
 *   - A throwing hook does not convert the mutation into a tool failure
 *     (PR-1 isolation property).
 *
 * Mock file operations hit the real filesystem under a tmp dir — pi-
 * coding-agent's read/edit/write tools don't have an API-key dependency,
 * so this is a pure unit smoke.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildSafetyWrapper,
  type SafetyRuntimeHooks,
} from "../src/agents/safety-wrappers.js";
import {
  FILE_CONTEXT_MAX_ENTRY_BYTES,
  type FileContextEntry,
} from "../src/agents/file-context-cache.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const root = join(tmpdir(), `luxas-phase3a-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(root, { recursive: true });

// ── Mock read/edit/write tools that touch real disk ──

const readTool = {
  name: "read",
  execute: async (_id: string, params: { path: string; offset?: number; limit?: number }) => {
    const abs = params.path.startsWith("/") ? params.path : join(root, params.path);
    const full = readFileSync(abs, "utf-8");
    const lines = full.split("\n");
    const start = (params.offset ?? 1) - 1;
    const end = params.limit ? start + params.limit : lines.length;
    const slice = lines.slice(start, end).join("\n");
    // Mimic pi-coding-agent's truncation banner on partial reads.
    const text = params.offset || params.limit
      ? slice + `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`
      : slice;
    return { content: [{ type: "text", text }] };
  },
};

const writeTool = {
  name: "write",
  execute: async (_id: string, params: { path: string; content: string }) => {
    const abs = params.path.startsWith("/") ? params.path : join(root, params.path);
    writeFileSync(abs, params.content);
    return { content: [{ type: "text", text: `wrote ${params.content.length} bytes` }] };
  },
};

const editTool = {
  name: "edit",
  execute: async (_id: string, params: { path: string; oldText: string; newText: string }) => {
    const abs = params.path.startsWith("/") ? params.path : join(root, params.path);
    const orig = readFileSync(abs, "utf-8");
    const updated = orig.replace(params.oldText, params.newText);
    if (orig === updated) throw new Error(`Could not find the exact text: "${params.oldText.slice(0, 40)}..."`);
    writeFileSync(abs, updated);
    return { content: [{ type: "text", text: "edit applied" }] };
  },
};

// Collector that mimics a Phase 3b agent-level aggregator: subscribes to
// onFileContextEntry and keeps the latest per path.
const collectedEntries = new Map<string, FileContextEntry>();
const touchedEvents: any[] = [];
const hooks: SafetyRuntimeHooks = {
  onFileContextEntry: (e) => { collectedEntries.set(e.absPath, e.entry); },
  onFileTouched: (e) => { touchedEvents.push(e); },
};

const wrapper = buildSafetyWrapper({
  protectedFiles: [],
  writeOnExistingPolicy: "allow_as_read",
});
if (!wrapper) throw new Error("buildSafetyWrapper returned undefined");
const wrapped = wrapper([readTool as any, writeTool as any, editTool as any], root, {}, hooks);
const wRead = wrapped.find((t: any) => t.name === "read");
const wWrite = wrapped.find((t: any) => t.name === "write");
const wEdit = wrapped.find((t: any) => t.name === "edit");

// ── 1. write populates cache with content, fires both hooks ──
console.log("1. write");
const p1 = join(root, "a.py");
await wWrite.execute("id1", { path: p1, content: "def foo():\n    return 42\n" });

const e1 = collectedEntries.get(p1);
check("write → onFileContextEntry fired", !!e1);
check("write → via = write", e1?.via === "write");
check("write → content captured", e1?.content === "def foo():\n    return 42\n");
check("write → mtimeMs is fresh", typeof e1?.mtimeMs === "number" && Math.abs(e1!.mtimeMs - statSync(p1).mtimeMs) < 5);
check("write → touchedAt is fresh", typeof e1?.touchedAt === "number" && Math.abs(e1!.touchedAt - Date.now()) < 1000);
check("write → range undefined (full content)", e1?.range === undefined);

const t1 = touchedEvents.find((e) => e.path === p1 && e.via === "write");
check("write → onFileTouched fired", !!t1);

// ── 2. read (full) populates cache with content ──
console.log("\n2. read (full)");
await wRead.execute("id2", { path: p1 });
const e2 = collectedEntries.get(p1);
check("read → via = read (overwrote write entry)", e2?.via === "read");
check("read → content captured", e2?.content === "def foo():\n    return 42\n");
check("read → range undefined (full read)", e2?.range === undefined);

// ── 3. read (partial with offset+limit) retains range ──
console.log("\n3. read (partial)");
const p3 = join(root, "long.py");
const longContent = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
writeFileSync(p3, longContent);

await wRead.execute("id3", { path: p3, offset: 5, limit: 3 });
const e3 = collectedEntries.get(p3);
check("partial read → range set", e3?.range?.start === 5 && e3?.range?.end === 7,
  `got start=${e3?.range?.start} end=${e3?.range?.end}`);
check("partial read → content strips truncation banner",
  typeof e3?.content === "string" && !e3!.content!.includes("Showing lines"));
check("partial read → content = lines 5-7",
  e3?.content === "line 5\nline 6\nline 7");

// ── 4. edit updates cache with post-edit disk content ──
console.log("\n4. edit");
// Need a read-before-edit (safety enforcement). Do full read first.
await wRead.execute("id4a", { path: p1 });
await wEdit.execute("id4b", { path: p1, oldText: "return 42", newText: "return 84" });

const e4 = collectedEntries.get(p1);
check("edit → via = edit", e4?.via === "edit");
check("edit → content re-read from disk", e4?.content === "def foo():\n    return 84\n");
check("edit → mtime bumped", typeof e4?.mtimeMs === "number" && (e4!.mtimeMs >= (e2?.mtimeMs ?? 0)));

const t4 = touchedEvents.find((e) => e.path === p1 && e.via === "edit");
check("edit → onFileTouched fired", !!t4);

// ── 5. Files above FILE_CONTEXT_MAX_ENTRY_BYTES keep mtime only ──
console.log("\n5. size cap (>50KB)");
const p5 = join(root, "big.txt");
const bigContent = "x".repeat(FILE_CONTEXT_MAX_ENTRY_BYTES + 10_000);
await wWrite.execute("id5", { path: p5, content: bigContent });
const e5 = collectedEntries.get(p5);
check("big write → entry exists", !!e5);
check("big write → content undefined (above cap)", e5?.content === undefined,
  `got content length ${e5?.content?.length}`);
check("big write → mtimeMs / via still set", typeof e5?.mtimeMs === "number" && e5?.via === "write");

// edit on big file: disk re-read also drops content
await wRead.execute("id5b", { path: p5 });
// read SHOULD capture content up to what the tool returned — our mock reads
// full file (banner-free), so the raw cached content will be ~60KB. Depending
// on interpretation we could cap reads too; for now reads don't apply the
// 50KB cap because the tool already truncates to its own DEFAULT_MAX_BYTES.
// What MUST hold: edit on the same file re-reads disk and gets undefined
// because size > cap.
await wEdit.execute("id5c", { path: p5, oldText: "xxx", newText: "yyy" });
const e5c = collectedEntries.get(p5);
check("big edit → content dropped to undefined (>cap)",
  e5c?.content === undefined,
  `got content length ${e5c?.content?.length}`);

// ── 6. Hook exception isolation (Phase 3a addition to onFileContextEntry) ──
console.log("\n6. hook exception isolation");
const throwingHooks: SafetyRuntimeHooks = {
  onFileContextEntry: () => { throw new Error("cache hook boom"); },
};
const wrapped2 = wrapper([writeTool as any], root, {}, throwingHooks);
const wWrite2 = wrapped2[0];
let wroteOK = false;
try {
  const res = await wWrite2.execute("id6", { path: join(root, "iso.txt"), content: "ok" });
  wroteOK = !res?.isError;
} catch {
  wroteOK = false;
}
check("tool succeeds when onFileContextEntry throws", wroteOK);
check("disk write landed despite cache hook throw",
  (() => { try { return readFileSync(join(root, "iso.txt"), "utf-8") === "ok"; } catch { return false; } })());

// ── 7. LRU eviction under pressure ──
console.log("\n7. LRU eviction under pressure (200+ unique files)");
// Use a dedicated small-cache instance for deterministic test, not the main
// wrapper. The production cap is 200; verifying behavior at cap=5 exercises
// the same code path without writing 200 files.
import { createFileContextCache } from "../src/agents/file-context-cache.js";
const small = createFileContextCache({ maxEntries: 5 });
for (let i = 0; i < 7; i++) {
  small.set(`/tmp/fake-${i}`, {
    mtimeMs: 1, touchedAt: 100 + i, via: "write", content: `f${i}`,
  });
}
check("cache respects maxEntries", small.size() === 5, `got ${small.size()}`);
check("oldest entries evicted (/tmp/fake-0, /tmp/fake-1 dropped)",
  !small.has("/tmp/fake-0") && !small.has("/tmp/fake-1"));
check("newest entries retained (/tmp/fake-6)", small.has("/tmp/fake-6"));

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
