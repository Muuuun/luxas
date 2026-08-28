/**
 * smoke_pi_stop_settling — the PI STOP freeze cannot deadlock claims-first:
 * while a headline row is DISPUTED/CONDITIONAL, replicator and experiment
 * spawns are finalization work; placeholder verdicts never count; a genuine
 * later verdict lifts the freeze; resume derives the freeze from disk.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResearchHooks } from "../src/hooks.ts";
import { parseLatestPIVerdict } from "../src/tools/index.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const call = async (h: any, name: string, args: any) => { const r = await h.before({ toolCall: { name }, args }); return r?.block ? "blocked" : "ok"; };

const frozen = buildResearchHooks({ projectDir: "fixtures/claims-ppss", initialState: { piStopped: true } as any } as any);
check("STOP + disputed headline: spawn experiment allowed (settling)", await call(frozen, "spawn_agent", { agent: "experiment", task: "run the discriminator" }) === "ok");
check("STOP + disputed headline: spawn replicator allowed", await call(frozen, "spawn_agent", { agent: "replicator", task: "blind replicate" }) === "ok");
check("STOP: spawn search still blocked", await call(frozen, "spawn_agent", { agent: "search", task: "x" }) === "blocked");
check("STOP: bash still blocked", await call(frozen, "bash", { command: "ls" }) === "blocked");
check("STOP: reason names the settling exception", String((await frozen.before({ toolCall: { name: "bash" }, args: { command: "ls" } }))?.reason).includes("DISPUTED/CONDITIONAL"));
frozen.setPIStopped(false);
check("setPIStopped(false) lifts the freeze", await call(frozen, "bash", { command: "ls" }) === "ok");

const legacy = buildResearchHooks({ projectDir: "fixtures/claims-297nm/raw", initialState: { piStopped: true } as any } as any);
check("STOP on a legacy project (no quantities): experiment still blocked", await call(legacy, "spawn_agent", { agent: "experiment", task: "x" }) === "blocked");

const dir = mkdtempSync(join(tmpdir(), "pi-verdict-"));
mkdirSync(join(dir, "reviews"));
writeFileSync(join(dir, "reviews", "pi_feedback.md"), "## Verdict: STOP\nexcellent\n\n## Verdict: STEER\n⚠️ PI review did NOT complete: the reviewer produced no structured verdict after a retry.\n");
check("placeholder STEER after STOP does not count: latest genuine verdict is stop", parseLatestPIVerdict(dir)?.verdict === "stop");
writeFileSync(join(dir, "reviews", "pi_feedback.md"), "## Verdict: STOP\nexcellent\n\n## Verdict: STEER\nreal steer: fix the abstract\n");
check("genuine STEER after STOP supersedes it", parseLatestPIVerdict(dir)?.verdict === "steer");
writeFileSync(join(dir, "reviews", "pi_feedback.md"), "## Verdict: STEER\n⚠️ PI review did NOT complete\n");
check("only placeholders → no verdict at all", parseLatestPIVerdict(dir) === null);
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — STOP can no longer deadlock a disputed claim table.");
