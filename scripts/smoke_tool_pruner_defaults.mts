/**
 * smoke_tool_pruner_defaults — Phase 3c: explicit whitelist/blacklist
 * in pruneHistoricToolOutputs.
 *
 *   npx tsx scripts/smoke_tool_pruner_defaults.mts
 *
 * Pre-3c behavior: `eligibleToolNames: []` (default) meant "prune every
 * tool output". That's fine when every tool is idempotent, but Phase 3b
 * will start relying on spawn_agent / write / edit tool results being
 * preserved as the agent's memory of artifacts — the old default would
 * have silently clobbered them.
 *
 * Post-3c behavior:
 *   - Undefined `eligibleToolNames` → DEFAULT_PRUNABLE_TOOL_NAMES
 *     ({read, bash, grep, glob})
 *   - NEVER_PRUNE_TOOL_NAMES blacklist always wins, even if explicitly
 *     whitelisted ({spawn_agent, request_pi_review, finish, write, edit}).
 *   - Unknown tool names (neither list) log once, default to not-prunable.
 */

import {
  pruneHistoricToolOutputs,
  DEFAULT_PRUNABLE_TOOL_NAMES,
  NEVER_PRUNE_TOOL_NAMES,
} from "../src/compaction/tool-pruner.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// Minimal conversation-adapter shape that pruner needs. Test messages are
// plain objects; adapter just reads/writes their fields.
interface TestMsg {
  role: "user" | "assistant" | "toolResult";
  toolName?: string;
  toolCallId?: string;
  text?: string;
  blocks?: any[];
}

const adapter = {
  getRole: (m: TestMsg) => m.role,
  getBlocks: (m: TestMsg) => m.blocks ?? [],
  isToolOutcome: (m: TestMsg) => m.role === "toolResult",
  getToolOutcomeName: (m: TestMsg) => m.toolName ?? null,
  getToolOutcomeCallId: (m: TestMsg) => m.toolCallId ?? null,
  getPlainText: (m: TestMsg) => m.text ?? "",
  replaceToolOutcomeText: (m: TestMsg, text: string): TestMsg => ({ ...m, text }),
};

const longText = "x".repeat(500);
const placeholder = "[earlier tool output cleared to reduce context load — re-run the tool if the raw output is needed]";

function makeResult(toolName: string, text: string): TestMsg {
  return { role: "toolResult", toolName, toolCallId: `c_${toolName}`, text };
}
function isPlaceholder(m: TestMsg): boolean {
  return m.text === placeholder;
}

// ── 1. default whitelist prunes read/bash/grep/glob ──
console.log("1. default whitelist");
{
  // 10 recents are kept (DEFAULT_KEEP_RECENT), so put prunable ones older.
  const msgs: TestMsg[] = Array.from({ length: 15 }, (_, i) =>
    makeResult(i < 5 ? "bash" : "read", longText)
  );
  const out = pruneHistoricToolOutputs(msgs, adapter as any, {});
  const pruned = out.messages.filter(isPlaceholder).length;
  check(`default prunes oldest bash/read above keepRecent=10`, pruned === 5, `pruned ${pruned}`);
}

// ── 2. blacklist overrides — spawn_agent never prunes ──
console.log("\n2. NEVER_PRUNE blacklist overrides whitelist");
{
  // Even if caller explicitly whitelists spawn_agent, it stays.
  const msgs: TestMsg[] = [
    ...Array.from({ length: 10 }, () => makeResult("read", longText)),     // keepRecent window
    ...Array.from({ length: 5 }, () => makeResult("spawn_agent", longText)), // historic, blacklisted
  ];
  const out = pruneHistoricToolOutputs(msgs, adapter as any, {
    eligibleToolNames: ["read", "spawn_agent"],
  });
  const spawnPruned = out.messages.filter((m) => m.toolName === "spawn_agent" && isPlaceholder(m)).length;
  check("spawn_agent not pruned despite explicit whitelist", spawnPruned === 0, `pruned ${spawnPruned}`);
}

// Also verify defaults include all the expected blacklisted names
console.log("\n3. NEVER_PRUNE defaults cover stateful tools");
for (const name of ["spawn_agent", "request_pi_review", "finish", "write", "edit"]) {
  check(`  ${name} in NEVER_PRUNE_TOOL_NAMES`, NEVER_PRUNE_TOOL_NAMES.has(name));
}

// ── 4. Default whitelist contents ──
console.log("\n4. DEFAULT_PRUNABLE covers stable tools");
for (const name of ["read", "bash", "grep", "glob"]) {
  check(`  ${name} in DEFAULT_PRUNABLE_TOOL_NAMES`, DEFAULT_PRUNABLE_TOOL_NAMES.has(name));
}

// ── 5. Unknown tool — not pruned, warns once ──
console.log("\n5. unknown tool default conservative");
{
  const origErr = console.error;
  const warnings: string[] = [];
  console.error = (msg: string) => { warnings.push(msg); };
  try {
    // mystery_tool at the OLDEST end so it gets evaluated past keepRecent window.
    const msgs: TestMsg[] = [
      ...Array.from({ length: 5 }, () => makeResult("mystery_tool", longText)),
      ...Array.from({ length: 10 }, () => makeResult("read", longText)),
    ];
    const out = pruneHistoricToolOutputs(msgs, adapter as any, {});
    const mysteryPruned = out.messages.filter((m) => m.toolName === "mystery_tool" && isPlaceholder(m)).length;
    check("unknown tool is not pruned", mysteryPruned === 0, `pruned ${mysteryPruned}`);
    check("unknown tool logs a warning", warnings.some((w) => w.includes("mystery_tool")),
      `warnings: ${warnings.join(" | ") || "none"}`);
  } finally {
    console.error = origErr;
  }
}

// ── 6. Explicit empty whitelist respected (caller wants nothing prunable) ──
console.log("\n6. explicit empty whitelist");
{
  const msgs: TestMsg[] = Array.from({ length: 15 }, () => makeResult("bash", longText));
  const out = pruneHistoricToolOutputs(msgs, adapter as any, { eligibleToolNames: [] });
  const pruned = out.messages.filter(isPlaceholder).length;
  check("explicit eligibleToolNames:[] disables all pruning", pruned === 0, `pruned ${pruned}`);
}

// ── 7. Custom override works ──
console.log("\n7. custom whitelist");
{
  // custom_tool at the OLDEST end so it's past keepRecent and evaluated.
  const msgs: TestMsg[] = [
    ...Array.from({ length: 5 }, () => makeResult("custom_tool", longText)),
    ...Array.from({ length: 10 }, () => makeResult("read", longText)),
  ];
  const out = pruneHistoricToolOutputs(msgs, adapter as any, {
    eligibleToolNames: ["custom_tool"],
  });
  const customPruned = out.messages.filter((m) => m.toolName === "custom_tool" && isPlaceholder(m)).length;
  check("custom tool prunes when explicitly whitelisted", customPruned === 5, `pruned ${customPruned}`);
  // And: "read" is NOT pruned here because caller's custom list replaces defaults.
  const readPruned = out.messages.filter((m) => m.toolName === "read" && isPlaceholder(m)).length;
  check("default whitelist is replaced, not augmented, by custom list", readPruned === 0);
}

// ── 8. keepRecent window respected ──
console.log("\n8. keepRecent window");
{
  const msgs: TestMsg[] = Array.from({ length: 15 }, () => makeResult("bash", longText));
  const out = pruneHistoricToolOutputs(msgs, adapter as any, { keepRecentToolOutputs: 10 });
  // Last 10 preserved, first 5 pruned.
  const prunedIndices = out.messages.map((m, i) => isPlaceholder(m) ? i : -1).filter((i) => i >= 0);
  check("exactly 5 oldest pruned", prunedIndices.length === 5);
  check("recent 10 preserved",
    out.messages.slice(5).every((m) => !isPlaceholder(m)));
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
