/**
 * Smoke test for spawn_agent(action="continue") validation gates.
 *
 * Exercises the failure paths in handleContinue end-to-end via the actual
 * tool surface — id regex, missing file, parent-ownership, missing
 * templateVars, file lock, etc. Stops short of driving a real LLM call (we
 * never set up an api key resolver that would spawn a model).
 *
 * Run: node_modules/.bin/tsx scripts/smoke/continue-validation.mts
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent.js";

const tmpRoot = join(tmpdir(), `luxas-continue-val-${Date.now()}`);
mkdirSync(join(tmpRoot, ".agent", "conversations"), { recursive: true });

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); process.exitCode = 1; }
}

// Build a tool whose parent is "brain" (the default).
const tool = createSpawnAgentTool(
  tmpRoot,
  {},                                    // templateVars
  () => undefined,                       // getApiKey — unused for these tests
  "brain",                               // parentAgentId
  0,                                     // depth
);

async function call(params: any) {
  const out: any = await tool.execute("test-call-id", params);
  return { text: out.content[0].text as string, details: out.details as any };
}

// ── Test 1: missing id ────────────────────────────────────────────────
console.log("\n=== Test 1: missing id ===");
{
  const r = await call({ action: "continue", task: "do thing" });
  check("rejects missing id", r.text.includes("`id` is required"));
  check("success: false", r.details.success === false);
}

// ── Test 2: missing task ──────────────────────────────────────────────
console.log("\n=== Test 2: missing task ===");
{
  const r = await call({ action: "continue", id: "some-id" });
  check("rejects missing task", r.text.includes("`task` is required"));
}

// ── Test 3: invalid id (path traversal) ───────────────────────────────
console.log("\n=== Test 3: id regex (path-escape) ===");
{
  const r = await call({ action: "continue", id: "../../../etc/passwd", task: "x" });
  check("rejects ../ in id", r.text.includes("invalid id"));
}
{
  const r = await call({ action: "continue", id: "has spaces", task: "x" });
  check("rejects spaces in id", r.text.includes("invalid id"));
}
{
  const r = await call({ action: "continue", id: "with/slash", task: "x" });
  check("rejects / in id", r.text.includes("invalid id"));
}

// ── Test 4: templateVars passed to continue ───────────────────────────
console.log("\n=== Test 4: rejects templateVars on continue ===");
{
  const r = await call({ action: "continue", id: "x", task: "y", templateVars: { FOO: "bar" } });
  check("rejects extra templateVars", r.text.includes("templateVars are recovered"));
}

// ── Test 5: nonexistent conv file ─────────────────────────────────────
console.log("\n=== Test 5: nonexistent conv file ===");
{
  const r = await call({ action: "continue", id: "never-spawned", task: "x" });
  check("rejects missing conv file", r.text.includes("no conversation file"));
}

// ── Test 6: legacy spawn_init missing ─────────────────────────────────
console.log("\n=== Test 6: legacy file (no spawn_init marker) ===");
{
  const path = join(tmpRoot, ".agent", "conversations", "legacy.jsonl");
  writeFileSync(path, JSON.stringify({ role: "user", content: "x", timestamp: 1 }) + "\n");
  const r = await call({ action: "continue", id: "legacy", task: "x" });
  check("rejects file without spawn_init", r.text.includes("no spawn_init marker"));
}

// ── Test 7: spawn_init present but messages empty ─────────────────────
console.log("\n=== Test 7: spawn_init but no messages ===");
{
  const path = join(tmpRoot, ".agent", "conversations", "empty-msgs.jsonl");
  writeFileSync(path,
    JSON.stringify({ type: "spawn_init", agentId: "empty-msgs", agent: "tool_impl", task: "x", parentAgentId: "brain", templateVars: { EXPERIMENT_ID: "E1", TOOL_NAME: "foo" }, timestamp: 1 }) + "\n",
  );
  const r = await call({ action: "continue", id: "empty-msgs", task: "x" });
  check("rejects spawn_init without messages", r.text.includes("zero messages"));
}

// ── Test 8: parent ownership mismatch ─────────────────────────────────
console.log("\n=== Test 8: parent ownership mismatch ===");
{
  const path = join(tmpRoot, ".agent", "conversations", "wrong-parent.jsonl");
  writeFileSync(path,
    JSON.stringify({ type: "spawn_init", agentId: "wrong-parent", agent: "tool_impl", task: "x", parentAgentId: "someone-else", templateVars: { EXPERIMENT_ID: "E1", TOOL_NAME: "foo" }, timestamp: 1 }) + "\n" +
    JSON.stringify({ role: "user", content: "x", timestamp: 2 }) + "\n",
  );
  const r = await call({ action: "continue", id: "wrong-parent", task: "x" });
  check("rejects continue from wrong parent", r.text.includes("Only the original parent can continue"));
}

// ── Test 9: missing required templateVars ─────────────────────────────
console.log("\n=== Test 9: required templateVars missing from spawn_init ===");
{
  const path = join(tmpRoot, ".agent", "conversations", "no-tv.jsonl");
  writeFileSync(path,
    // No templateVars in spawn_init — tool_impl requires EXPERIMENT_ID and TOOL_NAME
    JSON.stringify({ type: "spawn_init", agentId: "no-tv", agent: "tool_impl", task: "x", parentAgentId: "brain", timestamp: 1 }) + "\n" +
    JSON.stringify({ role: "user", content: "x", timestamp: 2 }) + "\n",
  );
  const r = await call({ action: "continue", id: "no-tv", task: "x" });
  check("rejects missing required templateVars", r.text.includes("cannot recover required template variables"));
  check("error names which vars missing", r.text.includes("EXPERIMENT_ID") && r.text.includes("TOOL_NAME"));
}

// ── Test 10: action defaults to "spawn" when omitted ──────────────────
console.log("\n=== Test 10: action default = spawn (legacy compat) ===");
{
  const r = await call({ task: "do something" });
  check("legacy call without action falls into spawn branch",
        r.text.includes("`agent` is required"));
}

// ── Test 11: unknown action rejected with allowed list ───────────────
console.log("\n=== Test 11: unknown action ===");
{
  const r = await call({ action: "spwan", agent: "reader", task: "x" });
  check("rejects misspelled action", r.text.includes("unknown action") && r.text.includes("\"spwan\""));
  check("error names allowed actions", r.text.includes("spawn") && r.text.includes("status") && r.text.includes("continue"));
}

// ── Test 12: status without id rejected explicitly ───────────────────
console.log("\n=== Test 12: status missing id ===");
{
  const r = await call({ action: "status" });
  check("status without id is explicit error (not silent fallthrough to spawn)",
        r.text.includes('action="status"') && r.text.includes("`id` is required"));
}

// ── Test 13: continue rejects background-agent transcript shape ──────
console.log("\n=== Test 13: background-agent transcript hint ===");
{
  const path = join(tmpRoot, ".agent", "conversations", "bg-shape.jsonl");
  // Mimic Session-wrapper schema (no spawn_init at all, but type:"session"+ type:"message" entries).
  writeFileSync(path,
    JSON.stringify({ type: "session", id: "x", started: 0 }) + "\n" +
    JSON.stringify({ type: "message", message: { role: "user", content: "x", timestamp: 1 } }) + "\n",
  );
  const r = await call({ action: "continue", id: "bg-shape", task: "x" });
  check("hint mentions background/Session format",
        r.text.includes("background") && r.text.includes("Session"));
}

// ── Cleanup ────────────────────────────────────────────────────────────
if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
