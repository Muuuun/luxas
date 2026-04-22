/**
 * Smoke: the new `allowedWriteRoots` positive whitelist in safety-wrappers.
 * Mirrors smoke_write_scope's style. Runs against a fake project dir with
 * a fake edit tool; verifies wrapper routes writes correctly.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import type { SafetyConfig } from "../src/agents/registry.js";

const dir = mkdtempSync(join(tmpdir(), "smoke-allow-write-"));
mkdirSync(join(dir, "definitions"), { recursive: true });
mkdirSync(join(dir, "state"), { recursive: true });
mkdirSync(join(dir, "off-limits"), { recursive: true });
// Pre-create files so read-before-edit check is happy.
for (const p of ["definitions/a.md", "state/log.jsonl", "off-limits/nope.md"]) {
  writeFileSync(join(dir, p), "seed\n");
}

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Fake write tool — the wrapper's positive check runs before it dispatches.
const fakeWrite = {
  name: "write",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `WROTE:${params.path}` }],
  }),
};

const config: SafetyConfig = {
  allowedWriteRoots: ["definitions", "{{STATE_DIR}}"],
  writeOnExistingPolicy: "allow_as_read",
};
const wrap = buildSafetyWrapper(config);
if (!wrap) { console.error("FAIL buildSafetyWrapper returned undefined"); process.exit(1); }
const wrapped = wrap([fakeWrite], dir, { STATE_DIR: "state" });
const write = wrapped.find((t: any) => t.name === "write")!;

async function run() {
  const inside = await write.execute("1", { path: "definitions/new.md" });
  assert(!inside.content[0].text.startsWith("BLOCKED"),
    "write inside definitions/ allowed");

  const stateDir = await write.execute("2", { path: "state/new.jsonl" });
  assert(!stateDir.content[0].text.startsWith("BLOCKED"),
    "write inside templated STATE_DIR allowed");

  const outside = await write.execute("3", { path: "off-limits/hack.md" });
  assert(outside.content[0].text.startsWith("BLOCKED"),
    "write outside allowed roots blocked");

  const escape = await write.execute("4", { path: "definitions/../off-limits/escape.md" });
  assert(escape.content[0].text.startsWith("BLOCKED"),
    "path with .. escape blocked after resolve");

  // No positive whitelist = no positive-path restriction (backward compat).
  const laxConfig: SafetyConfig = { writeOnExistingPolicy: "allow_as_read" };
  const laxWrap = buildSafetyWrapper(laxConfig)!;
  const laxWrite = laxWrap([fakeWrite], dir)[0];
  const anywhere = await laxWrite.execute("5", { path: "off-limits/anywhere.md" });
  assert(!anywhere.content[0].text.startsWith("BLOCKED"),
    "no allowedWriteRoots = no positive restriction (backward compat)");
}

await run();
rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — allowedWriteRoots enforcement");
  process.exit(0);
} else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
