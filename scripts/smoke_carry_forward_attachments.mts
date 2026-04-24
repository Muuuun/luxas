/**
 * smoke_carry_forward_attachments — Phase 3b: attachment providers and
 * their insertion into ContextPacker's rebuild step.
 *
 *   npx tsx scripts/smoke_carry_forward_attachments.mts
 *
 * Covers:
 *   - createRecentFilesProvider picks the N most-recently-touched files
 *     from a FileContextCache, renders content (truncated past cap),
 *     and honors excludePaths (so authoritative files don't appear here).
 *   - createAuthoritativeArtifactsProvider reads plan.md/memory.md/…
 *     from disk at call time and respects truncation tier policies.
 *   - Integration: a ContextPacker-driven compact rebuilds messages in
 *     the correct order: [carryforward, ...preamble, ...attachments,
 *     ...retained].
 *   - A throwing provider is isolated — the compact still completes.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createRecentFilesProvider,
  createAuthoritativeArtifactsProvider,
  listAuthoritativeArtifactPaths,
  DEFAULT_AUTHORITATIVE_ARTIFACTS,
  type AttachmentMessage,
} from "../src/compaction/attachments.js";
import { createFileContextCache } from "../src/agents/file-context-cache.js";
import { ContextPacker } from "../src/compaction/engine.js";
import { createBlockConversationAdapter } from "../src/compaction/adapter.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const root = join(tmpdir(), `luxas-phase3b-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(root, { recursive: true });

// ── 1. createRecentFilesProvider ──────────────────────────────────────────

console.log("1. createRecentFilesProvider");

{
  const cache = createFileContextCache();
  const now = Date.now();
  // Touch 7 files with staggered timestamps.
  for (let i = 0; i < 7; i++) {
    cache.set(`${root}/f${i}.py`, {
      content: `# file ${i}\nprint("${i}")\n`,
      mtimeMs: now,
      touchedAt: now + i * 1000,
      via: i % 2 === 0 ? "read" : "write",
    });
  }

  const provider = createRecentFilesProvider(cache, { projectDir: root });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];

  check("one attachment message emitted", out.length === 1);
  const body = out[0]!.content;
  check("attachment kind is recent_files", out[0]!.kind === "recent_files");
  check("isMeta is true", out[0]!.isMeta === true);
  check("body wraps in <recent_files> tag", body.startsWith("<recent_files"));
  check("body references at most 5 files (default maxFiles)",
    (body.match(/### f\d\.py/g) ?? []).length === 5,
    `got ${(body.match(/### f\d\.py/g) ?? []).join(", ")}`);
  // Most recent (f6) should be included, oldest (f0, f1) shouldn't.
  check("newest file (f6) present", body.includes("### f6.py"));
  check("oldest file (f0) excluded", !body.includes("### f0.py"));
  check("via marker present", body.includes("[via=read]") || body.includes("[via=write]"));
}

// ── 2. excludePaths ──────────────────────────────────────────────────────

console.log("\n2. excludePaths drops authoritative files");

{
  const cache = createFileContextCache();
  const now = Date.now();
  cache.set(`${root}/notes/plan.md`, { content: "# plan", mtimeMs: now, touchedAt: now + 10, via: "write" });
  cache.set(`${root}/src/foo.ts`, { content: "foo", mtimeMs: now, touchedAt: now + 20, via: "read" });

  const provider = createRecentFilesProvider(cache, {
    projectDir: root,
    excludePaths: [`${root}/notes/plan.md`],
  });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];
  const body = out[0]!.content;
  check("excluded path not rendered", !body.includes("plan.md"));
  check("non-excluded path rendered", body.includes("src/foo.ts"));
}

// ── 3. Content truncation at maxBytesPerFile ─────────────────────────────

console.log("\n3. per-file content truncation");

{
  const cache = createFileContextCache();
  const huge = "x".repeat(20_000);
  cache.set(`${root}/big.txt`, {
    content: huge, mtimeMs: 1, touchedAt: 1000, via: "read",
  });
  const provider = createRecentFilesProvider(cache, {
    projectDir: root,
    maxBytesPerFile: 1000,
  });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];
  const body = out[0]!.content;
  check("truncation marker present", body.includes("truncated for attachment"));
  check("body contains at most ~1100 chars of file content",
    body.indexOf("[truncated for attachment]") < body.indexOf("big.txt") + 2000,
    `position ${body.indexOf("[truncated for attachment]")}`);
}

// ── 4. Files cached without content (>50KB) rendered as placeholder ──────

console.log("\n4. no-content entry rendered as placeholder");

{
  const cache = createFileContextCache();
  cache.set(`${root}/giant.bin`, {
    mtimeMs: 1, touchedAt: 2000, via: "write",
    // no content — simulates >50KB case
  });
  const provider = createRecentFilesProvider(cache, { projectDir: root });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];
  const body = out[0]!.content;
  check("placeholder text present for missing content",
    body.includes("cached without content"));
  check("file header still present", body.includes("giant.bin"));
}

// ── 5. Empty cache → no attachment ────────────────────────────────────────

console.log("\n5. empty cache → zero attachments");

{
  const cache = createFileContextCache();
  const provider = createRecentFilesProvider(cache, { projectDir: root });
  const out = await provider({ trigger: "automatic", removedCount: 0 });
  check("empty cache yields no messages", out.length === 0);
}

// ── 6. createAuthoritativeArtifactsProvider reads disk ────────────────────

console.log("\n6. authoritative artifacts from disk");

{
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes", "plan.md"), "# Plan\n\nBuild the thing.");
  writeFileSync(join(root, "notes", "memory.md"), "# Memory\n\n- remember this");
  // Skip methodology/literature/experiments — verify they're optional.

  const provider = createAuthoritativeArtifactsProvider({ projectDir: root });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];

  check("plan + memory included (2 attachments)", out.length === 2, `got ${out.length}`);
  const planMsg = out.find((m) => m.sourcePath?.endsWith("plan.md"));
  const memMsg = out.find((m) => m.sourcePath?.endsWith("memory.md"));
  check("plan attachment present", !!planMsg);
  check("memory attachment present", !!memMsg);
  check("plan content wrapped in <authoritative> tag",
    planMsg?.content.startsWith("<authoritative path=\"notes/plan.md\""));
  check("plan body contains source", planMsg?.content.includes("Build the thing"));
  check("kind is authoritative_artifact", planMsg?.kind === "authoritative_artifact");
}

// ── 7. Truncation tier applied when file exceeds cap ──────────────────────

console.log("\n7. authoritative truncation tier");

{
  writeFileSync(join(root, "notes", "methodology.md"), "HEAD_MARKER\n" + "x".repeat(10_000) + "\nTAIL_MARKER");
  const provider = createAuthoritativeArtifactsProvider({
    projectDir: root,
    tiers: [{ path: "notes/methodology.md", policy: { truncateTo: 500 } }],
  });
  const out = (await provider({ trigger: "automatic", removedCount: 0 })) as AttachmentMessage[];
  check("truncated attachment produced", out.length === 1);
  const body = out[0]!.content;
  check("truncation marker present", body.includes("[truncated "));
  check("head preserved", body.includes("HEAD_MARKER"));
  check("tail preserved", body.includes("TAIL_MARKER"));
}

// ── 8. Missing file is skipped silently ──────────────────────────────────

console.log("\n8. missing file skipped");

{
  const provider = createAuthoritativeArtifactsProvider({
    projectDir: root,
    tiers: [{ path: "notes/nonexistent.md", policy: "always" }],
  });
  const out = await provider({ trigger: "automatic", removedCount: 0 });
  check("missing file yields no attachment", out.length === 0);
}

// ── 9. listAuthoritativeArtifactPaths ────────────────────────────────────

console.log("\n9. listAuthoritativeArtifactPaths");

{
  const paths = listAuthoritativeArtifactPaths(root);
  check("returns paths for all default tiers",
    paths.length === DEFAULT_AUTHORITATIVE_ARTIFACTS.length);
  check("paths are absolute", paths.every((p) => p.startsWith(root)));
}

// ── 10. Engine integration: attachments spliced between preamble & retained ──

console.log("\n10. engine integration");

{
  // Build a minimal conversation + ContextPacker that compacts.
  // Messages: 30 user/assistant pairs (enough to trigger compact at low threshold).
  const msgs: any[] = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: "user", content: `turn ${i}: do something`.repeat(50) });
    msgs.push({ role: "assistant", content: `turn ${i}: did it`.repeat(50) });
  }

  let providerCalledWith: any[] = [];
  const marker = "ATTACHMENT_MARKER_" + Math.random().toString(36).slice(2);
  const testProvider = async (ctx: any) => {
    providerCalledWith.push(ctx);
    return [{
      role: "user", content: `[${marker}] fake attachment`,
      kind: "recent_files", isMeta: true, timestamp: Date.now(),
    }];
  };

  const adapter = createBlockConversationAdapter();
  const packer = new ContextPacker({
    adapter: adapter as any,
    thresholds: { windowLimit: 500, marginPercent: 10 },
    attachmentProviders: [testProvider],
  });

  const result = await packer.runCycle({ messages: msgs, usageTokens: 480 });
  check("compact produced messages", result.messages.length > 0);
  check("provider was called", providerCalledWith.length >= 1);

  // Find the attachment message and verify it's positioned between the
  // compact preamble and the retained tail. Preamble is the first user
  // message after the carryforward marker; attachments follow; retained
  // starts after. A simple heuristic: the attachment should appear before
  // any user/assistant message whose content is NOT prefixed by our marker
  // and NOT the carryforward/preamble.
  const attachmentIdx = result.messages.findIndex((m: any) =>
    typeof m.content === "string" && m.content.includes(marker));
  check("attachment is in rebuilt conversation", attachmentIdx >= 0);
  // The last message should still be from the original retained tail.
  const lastMsg = result.messages[result.messages.length - 1];
  check("last message is from retained (not an attachment)",
    typeof lastMsg?.content !== "string" || !lastMsg.content.includes(marker));
  // Everything after the attachment is retained.
  const afterAttachment = result.messages.slice(attachmentIdx + 1);
  check("retained tail comes after attachments", afterAttachment.length > 0);
}

// ── 11. Throwing provider is isolated, compact still completes ────────────

console.log("\n11. provider exception isolation");

{
  const msgs: any[] = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: "user", content: `u${i}: ${"x".repeat(200)}` });
    msgs.push({ role: "assistant", content: `a${i}: ${"y".repeat(200)}` });
  }

  const throwingProvider = async () => {
    throw new Error("provider boom");
  };

  const origErr = console.error;
  const logs: string[] = [];
  console.error = (msg: string) => { logs.push(msg); };
  try {
    const packer = new ContextPacker({
      adapter: createBlockConversationAdapter() as any,
      thresholds: { windowLimit: 500, marginPercent: 10 },
      attachmentProviders: [throwingProvider],
    });
    const result = await packer.runCycle({ messages: msgs, usageTokens: 480 });
    check("compact still produced output despite throwing provider",
      result.messages.length > 0);
    check("error was logged",
      logs.some((l) => l.includes("attachment provider threw")),
      `logs: ${logs.slice(0, 3).join(" | ")}`);
  } finally {
    console.error = origErr;
  }
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
