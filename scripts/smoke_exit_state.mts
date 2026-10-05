#!/usr/bin/env tsx
/**
 * smoke_exit_state — every way a run ends leaves a named record, and the next
 * launch can read it.
 *
 * Uses real child processes for the endings that matter most, because those are
 * the ones a unit test cannot fake: an exit nobody named, and a SIGKILL that
 * runs no handler at all.
 *
 *   npx tsx scripts/smoke_exit_state.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beginRun, setExitReason, readLastExit, describeExit, EXIT_ACTION, _resetExitStateForTest } from "../src/exit-state.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mk = () => { const d = mkdtempSync(join(tmpdir(), "luxas-exit-")); mkdirSync(join(d, ".agent")); return d; };
const raw = (d: string) => JSON.parse(readFileSync(join(d, ".agent", "last_exit.json"), "utf-8"));

console.log("1. in-process");
{
  const d = mk();
  setExitReason("budget_exhausted", "must be ignored");
  check("no record before beginRun (sub-agent processes never call it)", readLastExit(d) === null);
  check("first launch has no previous record", beginRun(d) === null);
  check("launch marks the run as running", raw(d).kind === "running" && raw(d).pid === process.pid);
  check("a live pid reads back as running, not killed", readLastExit(d)?.kind === "running");
  setExitReason("budget_exhausted", "cost $61.42 exceeded the $60 cap");
  setExitReason("crashed", "fallout after the real cause");
  const r = readLastExit(d)!;
  check("the first named reason wins", r.kind === "budget_exhausted" && /61\.42/.test(r.detail ?? ""), JSON.stringify(r));
  check("written at once, not only at exit", raw(d).kind === "budget_exhausted");
  check("supervisor fields: not finished, not transient", r.finished === false && r.lastErrTransient === false);
  check("describeExit carries the next action", describeExit(r).includes(EXIT_ACTION.budget_exhausted));
  _resetExitStateForTest();
  const prev = beginRun(d);
  check("the next launch is handed the previous record", prev?.kind === "budget_exhausted");
  setExitReason("provider_transient", "502 Bad Gateway");
  check("provider_transient sets lastErrTransient for the supervisor", readLastExit(d)?.lastErrTransient === true);
  _resetExitStateForTest();
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mk();
  writeFileSync(join(d, ".agent", "last_exit.json"), JSON.stringify({ finished: false, lastErrTransient: true, ts: 1 }));
  check("a pre-2026-10 record is still readable", readLastExit(d)?.kind === "provider_transient");
  writeFileSync(join(d, ".agent", "last_exit.json"), "{ torn");
  check("a torn record reads as none, never throws", readLastExit(d) === null);
  rmSync(d, { recursive: true, force: true });
}
for (const k of Object.keys(EXIT_ACTION)) check(`every kind names a next action: ${k}`, EXIT_ACTION[k as keyof typeof EXIT_ACTION].length > 10);

console.log("\n2. real endings (child processes)");
function child(dir: string, body: string) {
  const script = join(dir, "child.mts");
  writeFileSync(script, `import { beginRun, setExitReason } from ${JSON.stringify(join(ROOT, "src", "exit-state.ts"))};\nbeginRun(${JSON.stringify(dir)});\n${body}\n`);
  return spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [script], { encoding: "utf-8", timeout: 60_000 });
}
{
  const d = mk();
  child(d, `process.exit(3);`);
  const r = readLastExit(d);
  check("an exit nobody named is recorded as crashed", r?.kind === "crashed" && /code 3/.test(r?.detail ?? ""), JSON.stringify(r));
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mk();
  child(d, `setExitReason("provider_unfunded", "deepseek: Insufficient Balance"); process.exit(1);`);
  const r = readLastExit(d);
  check("a named exit survives process.exit", r?.kind === "provider_unfunded", JSON.stringify(r));
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mk();
  child(d, `process.kill(process.pid, "SIGKILL"); await new Promise(r => setTimeout(r, 5000));`);
  check("SIGKILL leaves 'running' on disk (no handler ran)", raw(d).kind === "running", JSON.stringify(raw(d)));
  const r = readLastExit(d);
  check("…which the reader reports as killed", r?.kind === "killed", JSON.stringify(r));
  rmSync(d, { recursive: true, force: true });
}

console.log("\n3. no unnamed kill switch");
// Every process.exit / injected exit() in the files that kill a run must have
// named its reason just above. A new kill switch without one would put
// "crashed" in the record for what is really a policy decision.
for (const f of ["src/hooks.ts", "src/agent.ts", "src/usage-log.ts"]) {
  const lines = readFileSync(join(ROOT, f), "utf-8").split("\n");
  const exits = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^\s*(process\.exit|exit)\(1\);/.test(l));
  const unnamed = exits.filter(({ i }) => !lines.slice(Math.max(0, i - 3), i).some((l) => l.includes("setExitReason(")));
  check(`${f}: ${exits.length} kill switch(es), all named`, exits.length > 0 && unnamed.length === 0,
    unnamed.map(({ i }) => `line ${i + 1}`).join(", "));
}
{
  const idx = readFileSync(join(ROOT, "src", "index.ts"), "utf-8");
  check("index.ts: the launch reads the previous record", /beginRun\(dir\)/.test(idx));
  check("index.ts: the resuming brain is told how the last session ended", /\[harness\] The previous session did not end through finish\(\)/.test(idx));
  check("index.ts: `luxas status` prints it", /Last session: \$\{describeExit/.test(idx));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
