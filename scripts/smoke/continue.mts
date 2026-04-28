/**
 * Smoke test for spawn_agent(action="continue") plumbing.
 *
 * Covers the pure pieces — parseConvJsonl message/meta separation, marker
 * counting for revisionNumber, and continue_init append semantics. Does NOT
 * exercise live LLM calls (those happen end-to-end during a real luxas run).
 *
 * Run: node_modules/.bin/tsx scripts/smoke/continue.mts
 */

import { mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConvJsonl } from "../../src/active-agents.js";

const tmpRoot = join(tmpdir(), `luxas-continue-smoke-${Date.now()}`);
const convDir = join(tmpRoot, ".agent", "conversations");
mkdirSync(convDir, { recursive: true });

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); process.exitCode = 1; }
}

// ── Test 1: spawn_init + messages + continue_init parses cleanly ──────
console.log("\n=== Test 1: parseConvJsonl basic separation ===");
{
  const path = join(convDir, "test1.jsonl");
  const lines = [
    { type: "spawn_init", agent: "tool_impl", task: "write foo", parentAgentId: "brain.experiment-x", templateVars: { EXPERIMENT_ID: "E1", TOOL_NAME: "foo" }, timestamp: 1000 },
    { role: "user", content: "write foo", timestamp: 1001 },
    { role: "assistant", content: [{ type: "text", text: "ok writing foo" }], timestamp: 1002 },
    { type: "continue_init", newTask: "tests failed: ...", timestamp: 2000 },
    { role: "user", content: "tests failed: ...", timestamp: 2001 },
    { role: "assistant", content: [{ type: "text", text: "fixing" }], timestamp: 2002 },
  ];
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n") + "\n");

  const parsed = parseConvJsonl(path);
  check("spawnInit recovered", !!parsed.spawnInit && parsed.spawnInit.agent === "tool_impl");
  check("spawnInit.templateVars present", parsed.spawnInit?.templateVars?.EXPERIMENT_ID === "E1");
  check("messages count = 4 (2 user + 2 assistant)", parsed.messages.length === 4, `got ${parsed.messages.length}`);
  check("messages do NOT contain spawn_init/continue_init markers",
        !parsed.messages.some(m => m.type === "spawn_init" || m.type === "continue_init"));
  check("continueInits length = 1", parsed.continueInits.length === 1);
  check("continueInits[0].newTask preserved", parsed.continueInits[0]?.newTask === "tests failed: ...");
}

// ── Test 2: empty / missing file returns empty shape, no throw ─────────
console.log("\n=== Test 2: missing file is non-throwing ===");
{
  const parsed = parseConvJsonl(join(convDir, "does-not-exist.jsonl"));
  check("spawnInit === null", parsed.spawnInit === null);
  check("messages === []", parsed.messages.length === 0);
  check("continueInits === []", parsed.continueInits.length === 0);
}

// ── Test 3: malformed lines are skipped silently ───────────────────────
console.log("\n=== Test 3: malformed lines tolerated ===");
{
  const path = join(convDir, "test3.jsonl");
  writeFileSync(path,
    `{"type":"spawn_init","agent":"reader","task":"x","parentAgentId":"brain","timestamp":1}\n` +
    `not-valid-json garbage line\n` +
    `{"role":"user","content":"hi","timestamp":2}\n` +
    `{}\n` +  // valid JSON but no role/type → skipped
    `{"role":"assistant","content":[],"timestamp":3}\n`,
  );
  const parsed = parseConvJsonl(path);
  check("spawnInit recovered despite malformed lines", parsed.spawnInit?.agent === "reader");
  check("messages count = 2 (user + assistant; empty {} skipped)", parsed.messages.length === 2);
}

// ── Test 4: counting continue_init markers across multiple revisions ───
console.log("\n=== Test 4: revisionNumber computation ===");
{
  const path = join(convDir, "test4.jsonl");
  appendFileSync(path, JSON.stringify({ type: "spawn_init", agent: "tool_impl", task: "x", parentAgentId: "brain", timestamp: 0 }) + "\n");
  appendFileSync(path, JSON.stringify({ role: "user", content: "x", timestamp: 1 }) + "\n");
  appendFileSync(path, JSON.stringify({ role: "assistant", content: [], timestamp: 2 }) + "\n");
  // Three continues
  for (let r = 1; r <= 3; r++) {
    appendFileSync(path, JSON.stringify({ type: "continue_init", newTask: `fix ${r}`, timestamp: 100 + r }) + "\n");
    appendFileSync(path, JSON.stringify({ role: "user", content: `fix ${r}`, timestamp: 110 + r }) + "\n");
    appendFileSync(path, JSON.stringify({ role: "assistant", content: [], timestamp: 120 + r }) + "\n");
  }

  const parsed = parseConvJsonl(path);
  check("3 continue_init markers counted", parsed.continueInits.length === 3);
  check("4th continue would be revision = priorCount + 1 = 4", (parsed.continueInits.length + 1) === 4);
  check("messages count = 2 initial + 2 per round × 3 = 8", parsed.messages.length === 8,
        `got ${parsed.messages.length}`);
}

// ── Test 5: legacy spawn_init without templateVars still parses ────────
console.log("\n=== Test 5: legacy spawn_init (no templateVars) ===");
{
  const path = join(convDir, "test5.jsonl");
  writeFileSync(path,
    `{"type":"spawn_init","agent":"reader","task":"x","parentAgentId":"brain","timestamp":1}\n` +
    `{"role":"user","content":"x","timestamp":2}\n`,
  );
  const parsed = parseConvJsonl(path);
  check("spawnInit recovered", parsed.spawnInit?.agent === "reader");
  check("templateVars is undefined (not crashed)", parsed.spawnInit?.templateVars === undefined);
}

// ── Cleanup ────────────────────────────────────────────────────────────
if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
