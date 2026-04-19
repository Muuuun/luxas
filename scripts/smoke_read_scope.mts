#!/usr/bin/env tsx
/**
 * Smoke: tool_impl / tool_review read-scope enforcement.
 *
 * Creates a fake project with a notes/ file + an experiment dir, applies
 * wrapToolImplTools with EXPERIMENT_ID=E_test, and asserts:
 *   - read inside data/experiments/E_test/ → succeeds
 *   - read of notes/literature.md → BLOCKED
 *   - read of an absolute path outside projectDir → BLOCKED
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapToolImplTools } from "../src/agents/safety-wrappers.js";

const dir = mkdtempSync(join(tmpdir(), "smoke-read-scope-"));
mkdirSync(join(dir, "notes"));
mkdirSync(join(dir, "data/experiments/E_test/scripts"), { recursive: true });
writeFileSync(join(dir, "notes/literature.md"), "secret literature");
writeFileSync(join(dir, "data/experiments/E_test/scripts/helper.py"), "print('ok')");

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Minimal fake read tool mirroring pi-coding-agent signature.
const fakeRead = {
  name: "read",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `READ_OK:${params.path}` }],
  }),
};

const wrapped = wrapToolImplTools([fakeRead], dir, { EXPERIMENT_ID: "E_test" });
const read = wrapped[0];

async function run() {
  // Inside scope — succeeds
  const ok = await read.execute("1", { path: "data/experiments/E_test/scripts/helper.py" });
  const okText = ok.content[0].text;
  assert(okText.startsWith("READ_OK"), "read inside experiment dir succeeds");

  // Outside scope — blocked
  const notes = await read.execute("2", { path: "notes/literature.md" });
  const notesText = notes.content[0].text;
  assert(notesText.startsWith("BLOCKED"), "read of notes/literature.md blocked");
  assert(notesText.includes("data/experiments/E_test"), "block message names allowed dir");

  // Sibling experiment — blocked
  const sibling = await read.execute("3", { path: "data/experiments/E_other/scripts/x.py" });
  assert(sibling.content[0].text.startsWith("BLOCKED"), "read of sibling experiment blocked");

  // Escape via .. — resolved and blocked
  const escape = await read.execute("4", { path: "data/experiments/E_test/../../notes/literature.md" });
  assert(escape.content[0].text.startsWith("BLOCKED"), "path with .. escape blocked after resolve");

  // Absolute path outside projectDir — blocked
  const abs = await read.execute("5", { path: "/etc/passwd" });
  assert(abs.content[0].text.startsWith("BLOCKED"), "absolute path outside projectDir blocked");
}

// Fail-closed: wrapper with no templateVars should block all reads (EXPERIMENT_ID stays literal).
async function failClosed() {
  const wrappedNoVars = wrapToolImplTools([fakeRead], dir);
  const readNoVars = wrappedNoVars[0];
  const r = await readNoVars.execute("10", { path: "data/experiments/E_test/scripts/helper.py" });
  assert(r.content[0].text.startsWith("BLOCKED"), "missing EXPERIMENT_ID fails closed (no reads allowed)");
}

await run();
await failClosed();

rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — tool_impl read-scope enforcement works");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
