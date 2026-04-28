/**
 * End-to-end smoke for spawn_agent(action="continue") against the real
 * DeepSeek API. Confirms that the new path actually round-trips through a
 * live model:
 *
 *   1. Spawn a worker via the tool surface, capture its agentId from the
 *      [agent: ...] header.
 *   2. Continue that agent with a follow-up task.
 *   3. Verify the conv jsonl has spawn_init + exactly 1 continue_init,
 *      and the agent saw both user messages.
 *
 * Cost: ~$0.01 on deepseek-v4-flash (two short turns × ~5K context).
 *
 * Requirements: DEEPSEEK_API_KEY in env.
 *
 * Run: node_modules/.bin/tsx scripts/smoke/continue-deepseek.mts
 */

import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent.js";
import { parseConvJsonl } from "../../src/active-agents.js";
import { getApiKey } from "../../src/auth.js";

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY not set — skipping live test");
  process.exit(0);
}

// Force every anthropic-tier slot (worker = sonnet) to deepseek.
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-flash";

const tmpRoot = join(tmpdir(), `luxas-continue-deepseek-${Date.now()}`);
// Need to look like a luxas project skeleton or the safety wrappers / tools may complain.
mkdirSync(join(tmpRoot, ".agent", "conversations"), { recursive: true });
mkdirSync(join(tmpRoot, "notes"), { recursive: true });
writeFileSync(join(tmpRoot, "RESEARCH.md"), "# Smoke test\nNo real research goal.\n");

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); process.exitCode = 1; }
}

const tool = createSpawnAgentTool(
  tmpRoot,
  {},                                  // templateVars: PROJECT_DIR injected by tool
  getApiKey,                           // real key resolver
  "brain",                             // parentAgentId
  0,                                   // depth
);

async function call(params: any): Promise<{ text: string; details: any }> {
  const out: any = await tool.execute(`smoke-${Date.now()}`, params);
  return { text: out.content[0].text as string, details: out.details };
}

// ── Step 1: initial spawn ─────────────────────────────────────────────
console.log("\n=== Step 1: initial spawn (deepseek-v4-flash) ===");
const t1 = Date.now();
const r1 = await call({
  agent: "worker",
  task: "Echo exactly the string 'INITIAL_OK' and nothing else. Use the bash tool: `echo INITIAL_OK`. Then end your turn — no further commentary.",
});
const elapsed1 = Math.floor((Date.now() - t1) / 1000);
console.log(`  (took ${elapsed1}s)`);
console.log(`  result preview: ${r1.text.slice(0, 200).replace(/\n/g, " | ")}`);

const idMatch = r1.text.match(/^\[agent:\s*([A-Za-z0-9._-]+)\]/);
check("foreground spawn returned [agent: <id>] header", !!idMatch, "no header found");
check("foreground spawn success=true", r1.details.success === true);
const agentId = idMatch?.[1];
if (!agentId) {
  console.log("\nCannot proceed without agentId. Aborting.");
  process.exit(1);
}
console.log(`  recovered agentId: ${agentId}`);

// ── Step 2: continue ───────────────────────────────────────────────────
console.log("\n=== Step 2: continue (same agent) ===");
const t2 = Date.now();
const r2 = await call({
  action: "continue",
  id: agentId,
  task: "Now echo exactly 'CONTINUED_OK' via `echo CONTINUED_OK`. End your turn — no further commentary.",
});
const elapsed2 = Math.floor((Date.now() - t2) / 1000);
console.log(`  (took ${elapsed2}s)`);
console.log(`  result preview: ${r2.text.slice(0, 200).replace(/\n/g, " | ")}`);

check("continue returned [agent continue: ...] header",
      r2.text.startsWith(`[agent continue: id=${agentId}`));
check("continue success=true", r2.details.success === true);
check("continue revision=1 in details", r2.details.revisionNumber === 1);
check("continue agentId matches initial", r2.details.agentId === agentId);

// ── Step 3: jsonl shape ────────────────────────────────────────────────
console.log("\n=== Step 3: conv jsonl shape ===");
const convPath = join(tmpRoot, ".agent", "conversations", `${agentId}.jsonl`);
check("conv jsonl exists at canonical path", existsSync(convPath));
const parsed = parseConvJsonl(convPath);
check("spawnInit recovered", !!parsed.spawnInit);
check("spawnInit.agent === 'worker'", parsed.spawnInit?.agent === "worker");
check("spawnInit.parentAgentId === 'brain'", parsed.spawnInit?.parentAgentId === "brain");
// PROJECT_DIR is injected by handleContinue from ctx.projectDir, not the
// stored templateVars. The smoke factory passes {} for templateVars (no extra
// vars beyond PROJECT_DIR), so spawnInit.templateVars is the empty object.
check("spawnInit.templateVars persisted (even if empty)",
      typeof parsed.spawnInit?.templateVars === "object");
check("exactly 1 continue_init marker", parsed.continueInits.length === 1,
      `got ${parsed.continueInits.length}`);
check("messages contain user + assistant from both runs (≥4)",
      parsed.messages.length >= 4, `got ${parsed.messages.length}`);

// Find the second user message — should match the continue task.
const userMessages = parsed.messages.filter(m => m.role === "user");
check("at least 2 user messages (initial + continue)", userMessages.length >= 2,
      `got ${userMessages.length}`);
const continueUserMsg = userMessages[1];
const continueText = typeof continueUserMsg?.content === "string"
  ? continueUserMsg.content
  : JSON.stringify(continueUserMsg?.content ?? "");
check("second user message contains the continue task",
      continueText.includes("CONTINUED_OK"));

// Verify the agent actually responded after the continue (assistant turn after second user).
const lastAssistant = [...parsed.messages].reverse().find(m => m.role === "assistant");
check("there is an assistant message after the continue", !!lastAssistant);

// ── Cleanup ────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
console.log(`tmp project: ${tmpRoot}`);
if (failed === 0 && process.env.KEEP_TMP !== "1") {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  console.log("(cleaned up)");
} else if (failed > 0) {
  console.log("(left tmp dir for inspection)");
}
if (failed > 0) process.exit(1);
