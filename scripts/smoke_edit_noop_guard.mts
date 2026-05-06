#!/usr/bin/env tsx
/**
 * smoke_edit_noop_guard — verify safety-wrappers rejects edit calls where
 * oldText === newText BEFORE doing any disk lookup or fuzzy matching.
 *
 * Bug E from the BOM investigation: brain called edit on memory.md with
 * oldText === newText (and neither was in the file). The wrapper's
 * read-before-edit check caught it eventually, but with the misleading
 * "oldText not found" message. The new no-op guard fires earlier and
 * tells the agent specifically what went wrong.
 *
 *   npx tsx scripts/smoke_edit_noop_guard.mts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

const tmp = mkdtempSync(join(tmpdir(), "luxas-edit-noop-"));
try {
  writeFileSync(join(tmp, "memory.md"), "# Memory\n");

  // Stub edit tool — captures whether the underlying execute was called.
  let underlyingCalled = false;
  const stubEdit = {
    name: "edit",
    label: "edit",
    description: "stub",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      underlyingCalled = true;
      return { content: [{ type: "text", text: "ok" }] };
    },
  };

  // Allow writes anywhere under tmp so the no-op guard is the gate that fires.
  const wrap = buildSafetyWrapper({
    protectedFiles: [],
    allowedWriteRoots: [tmp],
  });
  if (!wrap) throw new Error("buildSafetyWrapper returned undefined");

  const [wrapped] = wrap([stubEdit], tmp, {}, undefined);

  console.log("1. oldText === newText is rejected before underlying execute");
  underlyingCalled = false;
  const res1: any = await wrapped.execute("call-1", {
    path: "memory.md",
    oldText: "Note: PDF was broken, keeping PNG.",
    newText: "Note: PDF was broken, keeping PNG.",
  });
  const text1 = res1?.content?.[0]?.text ?? "";
  check("returned an error result", /No-op edit|oldText === newText/i.test(text1),
    `text="${text1.slice(0, 120)}"`);
  check("did NOT call underlying execute", underlyingCalled === false);
  check("error mentions appending guidance", /append|anchor|read the file/i.test(text1),
    `text="${text1.slice(0, 120)}"`);

  console.log("\n2. oldText !== newText still goes through (path-not-cached path)");
  underlyingCalled = false;
  const res2: any = await wrapped.execute("call-2", {
    path: "memory.md",
    oldText: "# Memory",
    newText: "# Memory\n\nNote: appended.",
  });
  // Should hit the read-before-edit gate (since we never read), NOT the no-op.
  const text2 = res2?.content?.[0]?.text ?? "";
  check("no-op guard did NOT fire on differing text",
    !/No-op edit/i.test(text2),
    `text="${text2.slice(0, 120)}"`);
  check("hit a different gate (read-before-edit)",
    /must read|read the file|read tool/i.test(text2),
    `text="${text2.slice(0, 120)}"`);

  console.log("\n3. empty oldText === empty newText also rejected");
  underlyingCalled = false;
  const res3: any = await wrapped.execute("call-3", {
    path: "memory.md",
    oldText: "",
    newText: "",
  });
  const text3 = res3?.content?.[0]?.text ?? "";
  check("empty no-op also rejected", /No-op edit/i.test(text3),
    `text="${text3.slice(0, 120)}"`);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
