/**
 * smoke_claims_dispatch — the §3.7 dispatch reader classifies spawns relative to
 * the first DISCREPANT signal (synthetic project: results.json + .agent/log.jsonl).
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureDispatch, renderDispatch } from "./claims_dispatch.mts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

function project(spawnsAfter: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "claims-dispatch-"));
  const run = join(dir, "data", "experiments", "E2_leakage", "runs", "run_1");
  mkdirSync(run, { recursive: true });
  mkdirSync(join(dir, ".agent"), { recursive: true });
  const results = { computed: { cross_validation: [{ claim_key: "computed.p2_peak", value_a: 1e-3, value_b: 4e-3, tolerance_rel: 0.1, method_a: "analytic", method_b: "tdse" }] } };
  writeFileSync(join(run, "results.json"), JSON.stringify(results));
  const T0 = new Date("2026-08-26T10:00:00Z");
  utimesSync(join(run, "results.json"), T0, T0);
  // started marker at `mins`; completion entry 90 min later (a long child) — the
  // reader must place the spawn at the marker's time, not the completion's.
  const ev = (mins: number, agent: string, tv?: Record<string, string>) =>
    JSON.stringify({ type: "tool_call", tool: "spawn_agent", phase: "started", args: { agent, agent_id: `brain.${agent}-${mins}`, parent_agent_id: "brain" }, success: true, timestamp: new Date(T0.getTime() + mins * 60_000).toISOString() }) + "\n" +
    JSON.stringify({ type: "tool_call", tool: "spawn_agent", args: { agent, task: `do ${agent}`, templateVars: tv }, success: true, timestamp: new Date(T0.getTime() + (mins + 90) * 60_000).toISOString() });
  const lines = [
    ev(-30, "search"),
    ev(-20, "experiment", { EXPERIMENT_ID: "E2_leakage" }),
    ...spawnsAfter.map((a, i) => ev(5 + i * 5, a, a === "experiment" ? { EXPERIMENT_ID: "E3_third_route", ROLE: "discriminator" } : undefined)),
    JSON.stringify({ type: "tool_call", tool: "spawn_agent", args: { agent: "reader", action: "continue", id: "x" }, success: true, timestamp: new Date(T0.getTime() + 60 * 60_000).toISOString() }),
  ];
  writeFileSync(join(dir, ".agent", "log.jsonl"), lines.join("\n") + "\n");
  return dir;
}

const changed = measureDispatch(project(["search", "replicator", "experiment", "illustrator"]));
check("discrepant xval is the first signal", changed.firstSignal?.kind === "xval_discrepant");
check("spawns before the signal are excluded from `after`", changed.after.settling + changed.after.cosmetic + changed.after.other === 4, JSON.stringify(changed.after));
check("action=continue is not a spawn; started+completed pair to one spawn", changed.spawns.length === 6, String(changed.spawns.length));
check("spawn time comes from the started marker (completion is +90 min)", changed.spawns.every((s) => s.t <= "2026-08-26T10:20:00.000Z"), changed.spawns.map((s) => s.t).join(","));
check("first non-other spawn = replicator → CHANGED", changed.verdict === "changed" && changed.after.settling === 2 && changed.after.cosmetic === 1);
check("EXPERIMENT_ID / ROLE surfaced", changed.spawns.some((s) => s.experimentId === "E3_third_route" && s.role === "discriminator"));

const unchanged = measureDispatch(project(["illustrator", "typesetter", "report_writer"]));
check("cosmetic-first dispatch → UNCHANGED", unchanged.verdict === "unchanged" && unchanged.after.cosmetic === 3);

const idle = measureDispatch(project([]));
check("no spawns after the signal → NO-SPAWNS-AFTER", idle.verdict === "no-spawns-after");

const text = renderDispatch(changed);
check("render shows timeline + verdict line", /SIGNAL xval_discrepant/.test(text) && /verdict .*CHANGED/.test(text));

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — dispatch reader tells settling from cosmetic spawns after the first dispute.");
