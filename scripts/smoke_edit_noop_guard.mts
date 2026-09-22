#!/usr/bin/env tsx
/**
 * smoke_edit_noop_guard — the brain's `edit` must reach disk, and the no-op
 * guard must fire only on a real no-op.
 *
 * Two bugs live here, one after the other:
 *
 *   Bug E (BOM investigation): brain called edit with oldText === newText and
 *   got the misleading "oldText not found". The no-op guard was added to name
 *   the slip directly.
 *
 *   The guard's own regression (measured 2026-09-22 over the 08-25..09-20
 *   runs): it read only the LEGACY top-level oldText/newText, while
 *   pi-coding-agent's canonical shape is `edits: [{oldText,newText}, …]`.
 *   Every canonical call arrived as "" === "" and was blocked with a message
 *   insisting the tool was fine and "Do NOT record this as a tool bug".
 *   yttrium-magic-wavelengths-20260906 died on exactly that (four identical
 *   blocked \bibliography edits → operator escalation, report.tex unchanged
 *   at line 108); pp-vs-ss-gate-packing-20260826 recorded "the `edit` tool has
 *   been broken all session" in two escalation notes.
 *
 * Case 5 is the one that would have caught it: drive the REAL edit tool
 * end-to-end and assert the bytes on disk changed. A guard that only inspects
 * block messages cannot tell "correctly refused" from "silently swallowed".
 *
 *   npx tsx scripts/smoke_edit_noop_guard.mts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { createCodingToolsForProject } from "../src/tools/coding.js";
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
  const textOf = (r: any) => r?.content?.[0]?.text ?? "";

  console.log("1. oldText === newText is rejected before underlying execute");
  underlyingCalled = false;
  const res1: any = await wrapped.execute("call-1", {
    path: "memory.md",
    oldText: "Note: PDF was broken, keeping PNG.",
    newText: "Note: PDF was broken, keeping PNG.",
  });
  const text1 = textOf(res1);
  check("returned an error result", /No-op edit|oldText === newText/i.test(text1),
    `text="${text1.slice(0, 120)}"`);
  check("did NOT call underlying execute", underlyingCalled === false);
  check("error mentions appending guidance", /append|anchor|read the file/i.test(text1),
    `text="${text1.slice(0, 120)}"`);
  check("block is marked isError (hooks log it as a failure)", res1?.isError === true,
    `isError=${res1?.isError}`);

  console.log("\n2. oldText !== newText still goes through (path-not-cached path)");
  underlyingCalled = false;
  const res2: any = await wrapped.execute("call-2", {
    path: "memory.md",
    oldText: "# Memory",
    newText: "# Memory\n\nNote: appended.",
  });
  // Should hit the read-before-edit gate (since we never read), NOT the no-op.
  const text2 = textOf(res2);
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
  check("empty no-op also rejected", /No-op edit/i.test(textOf(res3)),
    `text="${textOf(res3).slice(0, 120)}"`);

  console.log("\n4. canonical edits[] shape is NOT mistaken for a no-op (y-magic repro)");
  underlyingCalled = false;
  const res4: any = await wrapped.execute("call-4", {
    path: "report.tex",
    edits: [{
      oldText: "\\bibliography{references}",
      newText: "{\\footnotesize\\bibliography{references}}",
    }],
  });
  const text4 = textOf(res4);
  check("no-op guard did NOT fire on an edits[] call",
    !/No-op edit/i.test(text4),
    `text="${text4.slice(0, 160)}"`);
  check("no-op message does not accuse the agent of a slip",
    !/not a tool fault/i.test(text4),
    `text="${text4.slice(0, 160)}"`);

  console.log("\n4b. edits[] sent as a JSON string is normalized too");
  const res4b: any = await wrapped.execute("call-4b", {
    path: "report.tex",
    edits: JSON.stringify([{ oldText: "a-real-anchor-line", newText: "changed" }]),
  });
  check("JSON-string edits[] not mistaken for a no-op",
    !/No-op edit/i.test(textOf(res4b)), `text="${textOf(res4b).slice(0, 160)}"`);

  console.log("\n4c. an all-no-op edits[] IS still rejected");
  const res4c: any = await wrapped.execute("call-4c", {
    path: "memory.md",
    edits: [{ oldText: "same", newText: "same" }, { oldText: "also", newText: "also" }],
  });
  check("all-no-op edits[] rejected", /No-op edit/i.test(textOf(res4c)),
    `text="${textOf(res4c).slice(0, 160)}"`);

  console.log("\n4d. a MIXED edits[] (one no-op, one real) is not thrown away");
  const res4d: any = await wrapped.execute("call-4d", {
    path: "memory.md",
    edits: [{ oldText: "same", newText: "same" }, { oldText: "# Memory", newText: "# Notes" }],
  });
  check("mixed edits[] not rejected as a no-op", !/No-op edit/i.test(textOf(res4d)),
    `text="${textOf(res4d).slice(0, 160)}"`);

  console.log("\n4e. an edit carrying no replacement gets a shape message, not a no-op message");
  const res4e: any = await wrapped.execute("call-4e", { path: "memory.md", edits: [] });
  const text4e = textOf(res4e);
  check("named as a shape problem", /carried no replacements/i.test(text4e),
    `text="${text4e.slice(0, 160)}"`);
  check("shows the accepted shape", /edits: \[\{oldText, newText\}/.test(text4e),
    `text="${text4e.slice(0, 160)}"`);

  console.log("\n5. END-TO-END: a wrapped edit on the REAL tool changes bytes on disk");
  const real = join(tmp, "report.tex");
  writeFileSync(real, "\\documentclass{article}\n\\begin{document}\nhi\n\\bibliography{references}\n\\end{document}\n");
  const realTools = wrap(createCodingToolsForProject(tmp), tmp, {}, undefined);
  const realRead = realTools.find((t: any) => t.name === "read");
  const realEdit = realTools.find((t: any) => t.name === "edit");
  check("read + edit tools are present", !!realRead && !!realEdit);

  await realRead.execute("read-1", { path: real });
  let editErr: string | undefined;
  let editRes: any;
  try {
    editRes = await realEdit.execute("edit-1", {
      path: real,
      edits: [{
        oldText: "\\bibliography{references}",
        newText: "{\\footnotesize\\bibliography{references}}",
      }],
    });
  } catch (e: any) { editErr = e?.message || String(e); }

  const after = readFileSync(real, "utf-8");
  check("edit did not throw", editErr === undefined, `err=${String(editErr).slice(0, 200)}`);
  check("edit result is not a BLOCKED result",
    !/BLOCKED/.test(textOf(editRes)), `text="${textOf(editRes).slice(0, 200)}"`);
  check("FILE ON DISK CHANGED (the y-magic assertion)",
    after.includes("{\\footnotesize\\bibliography{references}}"),
    `file still: ${JSON.stringify(after.split("\n").find((l) => l.includes("bibliography")))}`);

  console.log("\n6. END-TO-END: a multi-edit call applies every replacement");
  const multi = join(tmp, "multi.md");
  writeFileSync(multi, "alpha\nbeta\ngamma\n");
  await realRead.execute("read-2", { path: multi });
  await realEdit.execute("edit-2", {
    path: multi,
    edits: [
      { oldText: "alpha", newText: "ALPHA" },
      { oldText: "gamma", newText: "GAMMA" },
    ],
  });
  const afterMulti = readFileSync(multi, "utf-8");
  check("both replacements landed",
    afterMulti.includes("ALPHA") && afterMulti.includes("GAMMA"),
    `file=${JSON.stringify(afterMulti)}`);
  check("untouched line preserved", afterMulti.includes("beta"), `file=${JSON.stringify(afterMulti)}`);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
