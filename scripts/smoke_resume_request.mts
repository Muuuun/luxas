#!/usr/bin/env tsx
/**
 * smoke_resume_request — a RESUMED brain still sends its prompt and its tools,
 * and its history is still a cached prefix.
 *
 * Found on the Dy run (2026-10-06), with every other gate green:
 *   1. the first call after a resume has no token count yet, so compaction
 *      fell back to a fixed 80K-character cap and condensed a 24K-token
 *      history on a 1M-token window;
 *   2. the condensed context dropped the leading role:"system" message, which
 *      since pi 0.87 IS the system prompt and the tool declarations — the
 *      request went out with neither;
 *   3. from the next call on the history was un-condensed again, so nothing
 *      written to the cache was read back.
 *
 * Offline: scripts/cache_replay.mts builds every request with the real brain,
 * the real compaction transform and pi-ai's real Anthropic adapter, and stops
 * before the network. Pass 1 runs a fresh project to write a checkpoint with a
 * history well past the old cap; pass 2 resumes from it.
 *
 *   npx tsx scripts/smoke_resume_request.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ContextPacker } from "../src/compaction/engine.js";
import { createBlockConversationAdapter } from "../src/compaction/adapter.js";
import { measurePressure, buildWindowPlan, buildCharPlan } from "../src/compaction/thresholds.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));

console.log("1. condensing never folds the system message into the note");
{
  const big = "x".repeat(20_000);
  const messages: any[] = [{ role: "system", content: "You are the brain.", tools: [{ name: "read" }], timestamp: 1 }, { role: "user", content: [{ type: "text", text: "goal" }], timestamp: 1 }];
  for (let i = 0; i < 12; i++) {
    messages.push({ role: "assistant", content: [{ type: "toolCall", id: `t${i}`, name: "read", arguments: {} }], timestamp: 1 });
    messages.push({ role: "toolResult", toolCallId: `t${i}`, toolName: "read", content: [{ type: "text", text: big }], isError: false, timestamp: 1 });
  }
  const packer = new ContextPacker<any>({ adapter: createBlockConversationAdapter(), thresholds: { windowLimit: 60_000 }, keepTailMessages: 4 } as any);
  const out = await packer.runCycle({ messages, usageTokens: 55_000 });
  check("the fixture really condenses", out.mode === "condensed", out.mode);
  check("the system message is still first", out.messages[0]?.role === "system" && out.messages[0]?.tools?.length === 1, JSON.stringify(out.messages[0]).slice(0, 120));
  check("the carry-forward note comes right after it", JSON.stringify(out.messages[1]).includes("<carryforward_note>"));
  check("exactly one system message", out.messages.filter((m: any) => m.role === "system").length === 1);
}

console.log("\n2. without a token count the decision matches the token-based one");
{
  const plan = buildWindowPlan({ windowLimit: 1_000_000 }), chars = buildCharPlan({});
  check("200K chars on a 1M window: no condense (the old cap was 80K chars)", !measurePressure(undefined, 200_000, plan, chars).shouldCondense);
  check("…and no warning-level trimming either", !measurePressure(undefined, 200_000, plan, chars).shouldWarn);
  check("a history that would overflow still condenses", measurePressure(undefined, 3_000_000, plan, chars).shouldCondense);
  check("an explicitly configured char cap still wins", measurePressure(undefined, 50_000, plan, buildCharPlan({ condenseThresholdChars: 40_000 })).shouldCondense);
  const small = buildWindowPlan({ windowLimit: 200_000 });
  check("a 200K window condenses where its token rule would (~108K tokens)", measurePressure(undefined, 108_000 * 3, small, chars).shouldCondense && !measurePressure(undefined, 100_000 * 3, small, chars).shouldCondense);
}

console.log("\n3. the assembled brain, fresh and then resumed (claude-opus-5-5)");
const proj = mkdtempSync(join(tmpdir(), "luxas-resume-gate-"));
mkdirSync(join(proj, "notes"), { recursive: true });
writeFileSync(join(proj, "RESEARCH.md"), "# gate\nA throwaway goal for an offline wiring gate.\n");
writeFileSync(join(proj, "notes", "memory.md"), "# memory\n");
function replay(turns: number) {
  const env = { ...process.env }; delete env.LUXAS_MODEL_PROFILE; delete env.LUXAS_BRAIN_MODEL;
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "scripts", "cache_replay.mts"), proj, "--in-place", "--json", "--turns", String(turns),
    "--command", "seq 1 6000; echo \"- step\" >> notes/memory.md"], { encoding: "utf-8", timeout: 150_000, env });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("REPLAY_JSON "));
  if (!line) console.log(`  (replay produced no result: exit ${r.status} ${String(r.stderr).slice(-300)})`);
  return line ? JSON.parse(line.slice("REPLAY_JSON ".length)) : null;
}
const fresh = replay(5);
check("pass 1 ran and wrote a checkpoint", !!fresh && fresh.rows.length >= 4 && existsSync(join(proj, ".agent", "checkpoint.jsonl")), JSON.stringify(fresh)?.slice(0, 200));
const resumed = replay(4);
check("pass 2 resumed from it", !!resumed && resumed.restored > 0, `restored ${resumed?.restored}`);
if (fresh && resumed) {
  const historyChars = resumed.rows[0].total - resumed.rows[0].systemChars;
  check("the resumed history is past the old 80K-char cap (else this proves nothing)", historyChars > 100_000, `${historyChars} chars`);
  for (const [name, run] of [["fresh", fresh], ["resumed", resumed]] as const) {
    check(`${name}: every request carries the system prompt`, run.rows.every((r: any) => r.systemChars > 10_000), run.rows.map((r: any) => r.systemChars).join(","));
    check(`${name}: every request declares tools`, run.rows.every((r: any) => r.tools > 5), run.rows.map((r: any) => r.tools).join(","));
    check(`${name}: nothing was condensed`, run.rows.every((r: any) => !r.condensed));
    check(`${name}: at most 4 breakpoints per request`, run.rows.every((r: any) => r.breakpoints.length <= 4));
  }
  const tail = resumed.rows.slice(1);
  check("resumed: each call can read back everything but its new turn (≥ 85% here)", tail.length >= 3 && tail.every((r: any) => r.reusable / r.total >= 0.85 && /assistant/.test(r.firstDiff)),
    tail.map((r: any) => `${Math.round(100 * r.reusable / r.total)}% (first diff ${r.firstDiff})`).join("; "));
}
rmSync(proj, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
