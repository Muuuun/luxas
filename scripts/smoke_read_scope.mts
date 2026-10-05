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
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { getDefinition } from "../src/agents/registry.js";

const wrapToolImplTools = buildSafetyWrapper(getDefinition("tool_impl").safety);
if (!wrapToolImplTools) throw new Error("tool_impl.md must declare a safety config for this smoke to run");

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

// tool_impl is blind to the tests it is judged by (it fixes failures from the
// pytest output the parent relays). The allowed root is the whole experiment
// dir, so this needs the deny-list — and the bash path, the lazy way round it.
async function blindToTests() {
  mkdirSync(join(dir, "data/experiments/E_test/tests"), { recursive: true });
  writeFileSync(join(dir, "data/experiments/E_test/tests/test_helper.py"), "def test_x(): assert True");
  const fakeBash = { name: "bash", execute: async (_id: string, params: any) => ({ content: [{ type: "text" as const, text: `BASH_OK:${params.command}` }] }) };
  const [r, b] = wrapToolImplTools!([fakeRead, fakeBash], dir, { EXPERIMENT_ID: "E_test" });
  const t = await r.execute("20", { path: "data/experiments/E_test/tests/test_helper.py" });
  assert(t.content[0].text.startsWith("BLOCKED"), "tool_impl read of tests/ blocked (deny wins over the allowed root)");
  const viaDots = await r.execute("21", { path: "data/experiments/E_test/scripts/../tests/test_helper.py" });
  assert(viaDots.content[0].text.startsWith("BLOCKED"), "…also through a .. path");
  const own = await r.execute("22", { path: "data/experiments/E_test/scripts/helper.py" });
  assert(own.content[0].text.startsWith("READ_OK"), "its own scripts/ stay readable");
  const cat = await b.execute("23", { command: "cat data/experiments/E_test/tests/test_helper.py" });
  assert(cat.content[0].text.startsWith("BLOCKED"), "tool_impl bash that names tests/ blocked");
  const ok = await b.execute("24", { command: "python data/experiments/E_test/scripts/helper.py" });
  assert(ok.content[0].text.startsWith("BASH_OK"), "bash on its own scripts/ still runs");
}

// No definition ships without a safety config: an agent holding write/bash with
// none could overwrite RESEARCH.md (seven did until 2026-10-05).
async function everyAgentGuarded() {
  const { loadAgentDefinitions } = await import("../src/agents/registry.js");
  const all: any = loadAgentDefinitions();
  const defs: any[] = all instanceof Map ? [...all.values()] : Array.isArray(all) ? all : Object.values(all);
  assert(defs.length >= 20, `loaded ${defs.length} agent definitions`);
  const bare = defs.filter((d) => !d.safety).map((d) => d.name);
  assert(bare.length === 0, `every definition declares safety${bare.length ? ` — missing: ${bare.join(", ")}` : ""}`);
  writeFileSync(join(dir, "RESEARCH.md"), "the human's goal");
  const fakeWrite = { name: "write", execute: async () => ({ content: [{ type: "text" as const, text: "WRITE_OK" }] }) };
  const fakeEdit = { name: "edit", execute: async () => ({ content: [{ type: "text" as const, text: "EDIT_OK" }] }) };
  const leaks: string[] = [];
  for (const d of defs) {
    const wrap = buildSafetyWrapper(d.safety);
    if (!wrap) continue;
    const [w, e, r] = wrap([fakeWrite, fakeEdit, fakeRead], dir, { EXPERIMENT_ID: "E_test" });
    await r.execute("30", { path: "RESEARCH.md" }); // a prior read must not unlock the write
    const wr = await w.execute("31", { path: "RESEARCH.md", content: "x" });
    const ed = await e.execute("32", { path: "RESEARCH.md", edits: [{ oldText: "goal", newText: "x" }] });
    if (wr.content[0].text === "WRITE_OK" || ed.content[0].text === "EDIT_OK") leaks.push(d.name);
  }
  assert(leaks.length === 0, `no agent can write RESEARCH.md${leaks.length ? ` — can: ${leaks.join(", ")}` : ""}`);
}

await run();
await failClosed();
await blindToTests();
await everyAgentGuarded();

rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — tool_impl read-scope enforcement works");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
