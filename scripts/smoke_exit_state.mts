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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

console.log("\n2b. [C18] an uncaught exception the process survives does not name the ending");
// These children load the REAL src/index.ts top level, because its process
// handlers are what decide the record: through the read-only `status` command,
// with process.exit stubbed for the import, then armed as run() arms it.
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
function brainScript(dir: string, body: string[]): string {
  const idx = JSON.stringify(join(ROOT, "src", "index.ts"));
  const script = join(dir, "child.mts");
  writeFileSync(script, [
    `import { writeFileSync as __w, readFileSync as __r } from "node:fs";`,
    `const realExit = process.exit.bind(process), realError = console.error;`,
    `(process as any).exit = () => {};`,
    `process.argv = [process.argv[0], ${idx}, "status", ${JSON.stringify(dir)}];`,
    `console.log = () => {}; console.error = () => {};`,
    `await import(${idx});`,
    `(process as any).exit = realExit; console.error = realError;`,
    `const { beginRun, setExitReason } = await import(${JSON.stringify(join(ROOT, "src", "exit-state.ts"))});`,
    `beginRun(${JSON.stringify(dir)});`,
    ...body,
  ].join("\n"));
  return script;
}
const STRAY = [
  `setTimeout(() => { throw new Error("stray callback error"); }, 10);`,
  `await new Promise((r) => setTimeout(r, 300));`,
];
const brainChild = (dir: string, tail: string) =>
  spawnSync(TSX, [brainScript(dir, [...STRAY, tail])], { cwd: ROOT, encoding: "utf-8", timeout: 60_000 });
{
  const d = mk();
  const r = brainChild(d, `setExitReason("finished"); process.exit(0);`);
  const rec = readLastExit(d);
  check("2b-1 a survived exception does not overwrite a later gated finish", rec?.kind === "finished" && rec?.finished === true, `exit ${r.status}, ${JSON.stringify(rec)}`);
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mk();
  const r = brainChild(d, `setExitReason("provider_transient", "502 Bad Gateway"); process.exit(1);`);
  const rec = readLastExit(d);
  check("2b-2 …nor a later named stop; lastErrTransient reaches the supervisor", rec?.kind === "provider_transient" && rec?.lastErrTransient === true, `exit ${r.status}, ${JSON.stringify(rec)}`);
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mk();
  const r = brainChild(d, `/* nobody names a reason */`);
  const rec = readLastExit(d);
  check("2b-3 an exit nobody named is crashed and names the survived exception", rec?.kind === "crashed" && /uncaughtException: stray callback error/.test(rec?.detail ?? ""), `exit ${r.status}, ${JSON.stringify(rec)}`);
  rmSync(d, { recursive: true, force: true });
}
{
  // run() throwing is the CLI's top-level await rejecting (origin "unhandledRejection").
  const d = mk();
  const snap = join(d, "while_lingering.json");
  const r = spawnSync(TSX, [brainScript(d, [
    `setTimeout(() => __w(${JSON.stringify(snap)}, __r(${JSON.stringify(join(d, ".agent", "last_exit.json"))})), 800);`,
    `await new Promise((r) => setTimeout(r, 50));`,
    `await Promise.reject(new Error("run() threw after beginRun"));`,
  ])], { cwd: ROOT, encoding: "utf-8", timeout: 60_000 });
  let lingering: any = null;
  try { lingering = JSON.parse(readFileSync(snap, "utf-8")); } catch { /* the timer never fired */ }
  const rec = readLastExit(d);
  check("2b-4 run() throwing reads as crashed at once, while the process lingers", lingering?.kind === "crashed", JSON.stringify(lingering));
  check("2b-4 …and after exit: crashed, error named, exit code 1", rec?.kind === "crashed" && /run\(\) threw after beginRun/.test(rec?.detail ?? "") && r.status === 1, `exit ${r.status}, ${JSON.stringify(rec)}`);
  rmSync(d, { recursive: true, force: true });
}

console.log("\n2c. [C18] a dead stderr cannot flood the log");
// Whoever read the brain's piped stderr goes away. The child gets its own
// process group so the watchdog can kill tsx and the node it starts together.
// The watchdog stops a hang, not a flood (the line counts catch that): 8 s
// killed healthy children on the droplet under four parallel gates
// (2026-10-25, 2c passes there when run alone).
async function closedStderrChild(body: string[], watchdogMs = 30_000) {
  const d = mk();
  const t0 = Date.now();
  const c = spawn(TSX, [brainScript(d, body)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  c.stdout!.resume();
  c.stderr!.destroy();
  let watchdog = false;
  const t = setTimeout(() => { watchdog = true; try { process.kill(-c.pid!, "SIGKILL"); } catch { /* gone */ } }, watchdogMs);
  const code: number | null = await new Promise((r) => c.on("close", (x) => r(x)));
  clearTimeout(t);
  try { process.kill(-c.pid!, "SIGKILL"); } catch { /* gone */ }
  const log = join(d, ".agent", "log.jsonl");
  let lines = 0, bytes = 0;
  if (existsSync(log)) { const b = readFileSync(log); bytes = b.length; for (const x of b) if (x === 10) lines++; }
  const out = { code, watchdog, ms: Date.now() - t0, lines, bytes, alive: existsSync(join(d, "alive")), rec: readLastExit(d) };
  rmSync(d, { recursive: true, force: true });
  return { ...out, why: `${lines} process_crash lines (${(bytes / 1e6).toFixed(1)} MB) in ${out.ms} ms, watchdog=${watchdog} exit=${code} kind=${out.rec?.kind}` };
}
{
  const r = await closedStderrChild([
    `setTimeout(() => { throw new Error("stray callback error"); }, 10);`,
    `setTimeout(() => __w(process.argv[3] + "/alive", "1"), 600); // argv[3] = the project dir`,
    `await new Promise((r) => setTimeout(r, 2000));`,
    `setExitReason("finished"); process.exit(0);`,
  ]);
  check("2c-1 one throw with a closed stderr leaves a handful of process_crash lines", r.lines <= 10, r.why);
  check("2c-1 …and the loop stays responsive (a 600 ms timer fires; the run reaches its finish)", r.alive && !r.watchdog && r.code === 0 && r.rec?.kind === "finished", `alive=${r.alive} ${r.why}`);
}
{
  const r = await closedStderrChild([
    `let i = 0;`,
    `const iv = setInterval(() => { console.error("  ✻ bash ls"); process.stderr.write("  → bash\\n"); if (++i >= 100) clearInterval(iv); }, 5);`,
    `await new Promise((r) => setTimeout(r, 1500));`,
    `setExitReason("finished"); process.exit(0);`,
  ]);
  check("2c-2 progress lines to a closed stderr log one pipe error, not one per line", r.lines <= 3 && !r.watchdog && r.code === 0 && r.rec?.kind === "finished", r.why);
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
  check("index.ts: the resuming brain is told how the last session ended", /\[harness\] The previous session did not end through a gated finish\(\)/.test(idx));
  check("index.ts: `luxas status` prints it", /Last session: \$\{describeExit/.test(idx));
}

console.log("\n4. [C32] 'finished' is the gated finish, for the archive, the registry and the career ledger");
// A forced finish and an operator escalation also return details.success
// (Patch B exits the loop on it), so all three readers counted them as a
// finished study: the next launch archived the checkpoint and pi_feedback.md
// and started cold, and forced-finish claims entered ~/.sisyphus/career.
// Imported here, not at the top, so a missing export reads as a failed check.
const { finishOutcomeInCheckpoint } = await import("../src/exit-state.js") as
  { finishOutcomeInCheckpoint?: (lines: string[]) => string | null };
const outcomeOf = (lines: string[]) => finishOutcomeInCheckpoint ? finishOutcomeInCheckpoint(lines) : "(no helper)";
const resultLine = (text: string, details?: object, toolName = "finish") =>
  JSON.stringify({ type: "message", message: { role: "toolResult", toolName, content: [{ type: "text", text }], ...(details ? { details } : {}) } });
{
  check("C32 exit-state.ts exports finishOutcomeInCheckpoint", typeof finishOutcomeInCheckpoint === "function");
  for (const o of ["finished", "forced_finish", "needs_operator"]) {
    check(`C32 a result carrying outcome ${o} reads as ${o}`, outcomeOf([resultLine("x", { success: true, outcome: o })]) === o);
  }
  check("C32 legacy {success:true} reads as finished",
    outcomeOf([resultLine("Research complete: x", { success: true })]) === "finished");
  check("C32 legacy {success:true, escalated:true} reads as needs_operator",
    outcomeOf([resultLine("Escalated to the operator: the same finish gate …", { success: true, escalated: true })]) === "needs_operator");
  check("C32 legacy Force-exit text reads as forced_finish",
    outcomeOf([resultLine("Force-exit (runaway-cost backstop): 3 consecutive blocked finish() calls …", { success: true })]) === "forced_finish");
  const blocked = resultLine("Cannot finish: report/report.pdf does not exist.");
  check("C32 a blocked finish is no ending", outcomeOf([blocked]) === null);
  check("C32 a blocked result after a success keeps the success's outcome",
    outcomeOf([resultLine("x", { success: true, outcome: "needs_operator" }), blocked]) === "needs_operator");
  check("C32 the last success wins (escalation, resume, gated finish)",
    outcomeOf([resultLine("x", { success: true, outcome: "needs_operator" }), blocked, resultLine("x", { success: true, outcome: "finished" })]) === "finished");
  check("C32 another tool's success is no finish; a torn line is skipped",
    outcomeOf([resultLine("ok", { success: true }, "spawn_agent"), "{ torn"]) === null);
  check("C32 a bare message line (no session wrapper) is read too",
    outcomeOf([JSON.stringify({ role: "toolResult", toolName: "finish", details: { success: true, outcome: "forced_finish" } })]) === "forced_finish");
}
{
  // The real brain finish tool, offline: a project with only RESEARCH.md
  // refuses twice on the missing report.pdf and escalates on the third call.
  const d = mk();
  writeFileSync(join(d, "RESEARCH.md"), "# probe\n");
  const { buildResearchTools } = await import("../src/tools/index.js");
  const heard: (string | undefined)[] = [];
  const { tools } = buildResearchTools(d, { PROJECT_DIR: d }, () => undefined, { onFinish: (o?: string) => { heard.push(o); } });
  const finish = tools.find((t: any) => t.name === "finish");
  const rs: any[] = [];
  for (let i = 1; i <= 3; i++) rs.push(await finish.execute(`call${i}`, { summary: "probe" }));
  const text = (r: any) => String(r?.content?.[0]?.text ?? "");
  check("C32 real finish: the first two calls are refused on the missing report.pdf",
    rs.slice(0, 2).every((r) => /^Cannot finish: report\/report\.pdf does not exist/.test(text(r)) && !r?.details?.success),
    rs.slice(0, 2).map((r) => text(r).slice(0, 60)).join(" | "));
  check("C32 …the third escalates: success stays true (the loop still exits), outcome needs_operator",
    rs[2]?.details?.success === true && rs[2]?.details?.outcome === "needs_operator", JSON.stringify(rs[2]?.details));
  check("C32 …onFinish heard needs_operator", JSON.stringify(heard) === JSON.stringify(["needs_operator"]), JSON.stringify(heard));
  const tail = rs.map((r) => JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "finish", ...r } }));
  const o = outcomeOf(tail);
  check("C32 …and the checkpoint it leaves does not read as finished", o !== "finished" && o === "needs_operator", String(o));
  rmSync(d, { recursive: true, force: true });
}
{
  const tl = readFileSync(join(ROOT, "src", "tools", "index.ts"), "utf-8").split("\n");
  const sites = (kind: string) => tl.map((l, i) => ({ l, i })).filter(({ l }) => l.includes(`onFinish?.("${kind}")`));
  const carries = (i: number, kind: string) => new RegExp(`outcome:\\s*"${kind}"`).test(tl.slice(i, i + 25).join("\n"));
  const forced = sites("forced_finish");
  check(`C32 tools/index.ts: both forced-finish backstops (${forced.length}) return outcome forced_finish`,
    forced.length === 2 && forced.every(({ i }) => carries(i, "forced_finish")), forced.map(({ i }) => `line ${i + 1}`).join(", "));
  const esc = sites("needs_operator");
  check("C32 tools/index.ts: the escalation returns outcome needs_operator",
    esc.length === 1 && esc.every(({ i }) => carries(i, "needs_operator")), esc.map(({ i }) => `line ${i + 1}`).join(", "));
  check("C32 tools/index.ts: the gated success returns outcome finished",
    /text: `Research complete: \$\{args\.summary\}` \}\], details: \{ success: true, outcome: "finished" \}/.test(tl.join("\n")));
  const idx = readFileSync(join(ROOT, "src", "index.ts"), "utf-8");
  check("C32 index.ts: archiveIfFinished reads the outcome through finishOutcomeInCheckpoint",
    /function archiveIfFinished[\s\S]{0,2500}?finishOutcomeInCheckpoint\(/.test(idx));
  check("C32 index.ts: registry and career get finished = finishOutcome() === \"finished\"",
    /const finished = finishOutcome\(\) === "finished"/.test(idx));
  check("C32 index.ts: a forced finish or an escalation says the checkpoint is live, not 'Exited WITHOUT'",
    /Stopped as \$\{outcome\}[^\n]*NOT a gated finish[\s\S]{0,300}?resume with: luxas run/.test(idx));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
