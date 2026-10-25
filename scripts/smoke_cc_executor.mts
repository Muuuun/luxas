#!/usr/bin/env tsx
/**
 * smoke_cc_executor — LUXAS_EXPERIMENT_MODE=claude-code (src/executors/claude-code.ts),
 * offline, with a fake `claude` on LUXAS_CLAUDE_BIN.
 *
 *   1 argv: model pinned, effort, budget, the user's skills/settings/MCP left out, the tools last; resume vs a fresh session id
 *   2 env: session variables dropped, auth variables kept; subscription drops the API key, api keeps it; auto-memory off
 *   3 preflight: no auth, api without a key, a tenant project on the subscription, a CLI that does not run
 *   4 spawnAgent hands an experiment to the executor: the solo definition + context + executor note as the appended
 *     system prompt, the task as the prompt, the result text back; usage row (cost 0 on the subscription, the cost on
 *     api) attributed to the experiment; conv markers; registry entry gone; session recorded
 *   5 a re-run of the same experiment resumes its session; LUXAS_CC_RESUME=0 starts fresh
 *   6 budget: min(per-run, cap − spent) on api, per-run on the subscription; refused below $0.50
 *   7 scope: RESEARCH.md put back, a file outside the write roots reported, writes inside them not
 *   8 endings: provider abort → error; budget stop → stop; no result line → error; wall limit → killed and the group gone
 *   9 a background job the CLI leaves running is killed when it exits; the watchdog kills the group when the host dies
 *  10 the background runner hands an experiment to the executor too (review loop off)
 *  11 the review loop's harness-made re-run (not delivered) goes to the executor and resumes the session
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn as spawnProc, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const alive = (pid: number) => { if (pid <= 0) return true; try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(100); }
  return cond();
}

// Offline means offline: if the executor seam broke, an experiment spawn would fall back to the
// pi executor and that falls back to provider keys in the env. One mutation of this gate did exactly
// that on 2026-10-25 and spent $0.45 on Opus. With no key, the fallback fails fast instead.
for (const k of Object.keys(process.env)) if (/_API_KEY$|_AUTH_TOKEN$|^ANTHROPIC_|^OPENAI_|^DEEPSEEK_|^GLM_|^ZAI_|^MOONSHOT_|^KIMI_/.test(k)) delete process.env[k];
process.env.HOME = mkdtempSync(join(tmpdir(), "smoke-cc-home-"));   // and no ~/.sisyphus/auth.json either

const CC = await import("../src/executors/claude-code.ts");
const { spawnAgent } = await import("../src/agents/spawn.ts");
const { runExperimentReviewLoop } = await import("../src/tools/spawn-agent.ts");

const work = mkdtempSync(join(tmpdir(), "smoke-cc-"));
const EID = "E1_toy";

// The fake CLI: writes its argv and env to FAKE_LOG, acts per FAKE_MODE, prints stream-json.
const fake = join(work, "fake-claude");
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9 (fake)"; exit 0; fi
log=\${FAKE_LOG:-/dev/null}
: > "$log.args"
for a in "$@"; do printf '%s\\n----\\n' "$a" >> "$log.args"; done
env > "$log.env"
sid=""; prev=""
for a in "$@"; do
  if [ "$prev" = "--session-id" ] || [ "$prev" = "--resume" ]; then sid="$a"; fi
  prev="$a"
done
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"'"$sid"'","model":"claude-opus-5-5"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"python3 run.py"}}]}}'
mode=\${FAKE_MODE:-ok}
if [ "$mode" != "nodeliver" ]; then
  mkdir -p data/experiments/${EID}/runs/run_1
  printf '{"computed":{"x":1}}' > data/experiments/${EID}/runs/run_1/results.json
fi
case "$mode" in
  stray) echo "tampered" >> RESEARCH.md; echo stray > stray.txt; echo note >> notes/experiments.md; mkdir -p report/figures; echo f > report/figures/f.txt ;;
  hang) sleep 600 & echo $! > "$log.child"; wait ;;
  leftover) sleep 600 & echo $! > "$log.child" ;;
  noresult) echo "boom" >&2; exit 3 ;;
esac
cost=\${FAKE_COST:-1.25}
case "$mode" in
  abort) printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","result":"Credit balance is too low","session_id":"'"$sid"'"}' ;;
  budget) printf '%s\\n' '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":'"$cost"',"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40},"session_id":"'"$sid"'"}' ;;
  *) printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"done '"$mode"'","total_cost_usd":'"$cost"',"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40},"session_id":"'"$sid"'"}' ;;
esac
exit 0
`);
chmodSync(fake, 0o755);

function newProject(name: string, maxCost = 50): string {
  const p = join(work, name);
  mkdirSync(join(p, ".agent"), { recursive: true });
  mkdirSync(join(p, "notes"), { recursive: true });
  mkdirSync(join(p, "data", "experiments", EID), { recursive: true });
  writeFileSync(join(p, "RESEARCH.md"), "# Toy\nOriginal brief.\n");
  writeFileSync(join(p, "notes", "experiments.md"), "# Experiments\n");
  writeFileSync(join(p, ".agent", "run_config.json"), JSON.stringify({ maxCost }));
  return p;
}
// [] when the fake never ran, so a broken seam reads as failed checks, not a crash.
const argsOf = (log: string) => existsSync(`${log}.args`) ? readFileSync(`${log}.args`, "utf-8").split("\n----\n").filter((s, i, a) => i < a.length - 1 || s.trim()) : [];
const argAfter = (args: string[], flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const readOr = (path: string, dflt = "") => existsSync(path) ? readFileSync(path, "utf-8") : dflt;
const usageRows = (p: string) => { try { return readFileSync(join(p, ".agent", "usage.log"), "utf-8").trim().split("\n").filter(Boolean).map((l) => l.split("\t")); } catch { return []; } };
const baseEnv = (log: string, extra: Record<string, string> = {}) => ({ ...process.env, LUXAS_CLAUDE_BIN: fake, LUXAS_CC_AUTH: "subscription", FAKE_LOG: log, ...extra });

function withEnv<T>(env: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  return f().finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
const spawnOpts = (p: string, prompt = "Compute the toy number.") => ({
  name: "experiment", templateVars: { PROJECT_DIR: p, EXPERIMENT_ID: EID, ROLE: "" }, prompt, projectDir: p,
  contextExtra: { task: prompt }, getApiKey: () => undefined, parentAgentId: "brain",
});

console.log("1. argv");
{
  const a = CC.claudeCodeArgs({ prompt: "P", systemAppend: "S", model: "claude-opus-5-5", effort: "high", maxBudgetUsd: 12.345, sessionId: "sid-1" });
  check("prompt, model, effort, budget", argAfter(a, "-p") === "P" && argAfter(a, "--model") === "claude-opus-5-5" && argAfter(a, "--effort") === "high" && argAfter(a, "--max-budget-usd") === "12.35");
  check("stream-json needs --verbose; the system prompt is appended, not replaced", a.includes("--verbose") && argAfter(a, "--output-format") === "stream-json" && argAfter(a, "--append-system-prompt") === "S" && !a.includes("--system-prompt"));
  check("user skills, user settings and MCP servers stay out", a.includes("--disable-slash-commands") && argAfter(a, "--setting-sources") === "project,local" && a.includes("--strict-mcp-config"));
  check("a fresh run names its session", argAfter(a, "--session-id") === "sid-1" && !a.includes("--resume"));
  check("--allowedTools is last and lists the measured tools", a.slice(a.indexOf("--allowedTools") + 1).join(",") === CC.CC_TOOLS.join(","));
  const r = CC.claudeCodeArgs({ prompt: "P", systemAppend: "S", model: "m", effort: "high", maxBudgetUsd: 5, resumeSessionId: "sid-0" });
  check("a re-run resumes instead", argAfter(r, "--resume") === "sid-0" && !r.includes("--session-id"));
}

console.log("\n2. env");
{
  const base = { PATH: "/usr/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
    CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CODE_USE_BEDROCK: "1" };
  const sub = CC.claudeCodeEnv(base, "subscription");
  check("the launching session's variables are dropped", !("CLAUDECODE" in sub) && !("CLAUDE_CODE_SESSION_ID" in sub) && !("CLAUDE_CODE_MESSAGING_SOCKET" in sub));
  check("auth/provider variables pass", sub.CLAUDE_CODE_OAUTH_TOKEN === "o" && sub.CLAUDE_CODE_USE_BEDROCK === "1" && sub.PATH === "/usr/bin");
  check("subscription: the API key is removed", !("ANTHROPIC_API_KEY" in sub) && !("ANTHROPIC_AUTH_TOKEN" in sub));
  check("api: the API key stays", CC.claudeCodeEnv(base, "api").ANTHROPIC_API_KEY === "sk-x");
  check("auto-memory and CLAUDE.md files off, no self-update mid-run", sub.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1" && sub.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1" && sub.DISABLE_AUTOUPDATER === "1");
}

console.log("\n3. preflight");
{
  const ok = { LUXAS_CLAUDE_BIN: fake, PATH: process.env.PATH };
  check("no LUXAS_CC_AUTH → refused", CC.claudeCodePreflight(ok as any).some((p: string) => p.includes("LUXAS_CC_AUTH")));
  check("api without a key → refused", CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "api" } as any).some((p: string) => p.includes("ANTHROPIC_API_KEY")));
  check("api with a key → clean", CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "api", ANTHROPIC_API_KEY: "k" } as any).length === 0);
  check("subscription on a CLI project → clean", CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "subscription" } as any, "/Users/x/research/dy").length === 0);
  check("subscription on a studio tenant's project → refused", CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "subscription" } as any, "/srv/0123456789ab/projects/dy").some((p: string) => p.includes("tenant")));
  check("a CLI that does not run → refused", CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "subscription", LUXAS_CLAUDE_BIN: join(work, "nope") } as any).some((p: string) => p.includes("does not run")));
}

console.log("\n4. spawnAgent → the executor");
const p4 = newProject("p4");
const log4 = join(work, "log4");
await withEnv({ ...baseEnv(log4), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
  const r = await spawnAgent(spawnOpts(p4));
  const args = argsOf(log4);
  const sys = argAfter(args, "--append-system-prompt") ?? "";
  check("returns the CLI's result text, success, stopReason stop", r.success && r.output.startsWith("done ok") && r.exit.stopReason === "stop", JSON.stringify({ out: r.output.slice(0, 80), exit: r.exit }));
  check("the task is the prompt", argAfter(args, "-p") === "Compute the toy number.");
  check("the solo definition is in the appended system prompt, with the experiment id filled in", sys.includes("SOLO executor") && sys.includes(`data/experiments/${EID}/`) && !sys.includes("{{EXPERIMENT_ID}}"));
  check("…and the executor note, after it", sys.includes("<claude_code_executor>") && sys.indexOf("<claude_code_executor>") > sys.indexOf("SOLO executor"));
  check("model pinned to claude-opus-5-5 by default, effort high", argAfter(args, "--model") === "claude-opus-5-5" && argAfter(args, "--effort") === "high");
  check("the CLI ran in the project dir", existsSync(join(p4, "data", "experiments", EID, "runs", "run_1", "results.json")));
  const env = existsSync(`${log4}.env`) ? readFileSync(`${log4}.env`, "utf-8") : "ANTHROPIC_API_KEY=(fake never ran)";
  check("subscription: the child had no ANTHROPIC_API_KEY", !/^ANTHROPIC_API_KEY=/m.test(env));
  const rows = usageRows(p4);
  check("one usage row: cost 0 on the subscription, tokens kept, attributed to the experiment", rows.length === 1 && rows[0][2] === "claude-subscription" && Number(rows[0][7]) === 0 && rows[0][3] === "10" && rows[0][6] === "40" && rows[0][9] === "experiment" && rows[0][8] === r.agentId, JSON.stringify(rows));
  const conv = readFileSync(join(p4, ".agent", "conversations", `${r.agentId}.jsonl`), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  check("conv file: spawn_init with templateVars, the result as an assistant message, the run marker", conv[0].type === "spawn_init" && conv[0].templateVars?.EXPERIMENT_ID === EID && conv.some((m) => m.role === "assistant") && conv.some((m) => m.type === "claude_code_run" && m.listUsd === 1.25 && m.billedUsd === 0));
  const reg = existsSync(join(p4, ".agent", "active-agents.json")) ? readFileSync(join(p4, ".agent", "active-agents.json"), "utf-8") : "[]";
  check("the registry entry is removed after the run", !reg.includes(r.agentId), reg.slice(0, 200));
  check("the session is recorded for the experiment", CC.readExperimentSession(p4, EID) === argAfter(args, "--session-id"));
  check("a transcript per run under .agent/claude-code/", readdirSync(join(p4, ".agent", "claude-code")).some((f: string) => f.startsWith(`${r.agentId}.1.`) && f.endsWith(".jsonl")));
});

console.log("\n5. re-runs resume the experiment's session");
await withEnv({ ...baseEnv(log4), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
  const sid = CC.readExperimentSession(p4, EID);
  await spawnAgent(spawnOpts(p4, "Revise: fix the units."));
  const args = argsOf(log4);
  check("the second spawn of the experiment resumes its session", argAfter(args, "--resume") === sid && !args.includes("--session-id"), String(argAfter(args, "--resume")));
  await withEnv({ LUXAS_CC_RESUME: "0" }, () => spawnAgent(spawnOpts(p4)));
  const fresh = argsOf(log4);
  check("LUXAS_CC_RESUME=0 starts a fresh session", !!argAfter(fresh, "--session-id") && !fresh.includes("--resume"));
});

console.log("\n6. budget");
{
  const p6 = newProject("p6", 30);
  writeFileSync(join(p6, ".agent", "usage.log"), `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t22.00000000\tbrain\tbrain\n`);
  const log6 = join(work, "log6");
  await withEnv({ ...baseEnv(log6, { LUXAS_CC_AUTH: "api", ANTHROPIC_API_KEY: "sk-test" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
    const r = await spawnAgent(spawnOpts(p6));
    check("api: --max-budget-usd = cap − spent when below the per-run bound ($30 − $22)", argAfter(argsOf(log6), "--max-budget-usd") === "8.00", argAfter(argsOf(log6), "--max-budget-usd"));
    check("api: the child kept ANTHROPIC_API_KEY", /^ANTHROPIC_API_KEY=sk-test$/m.test(readOr(`${log6}.env`)));
    const rows = usageRows(p6);
    check("api: the usage row carries the cost, so the run cap counts it", rows.length === 2 && rows[1][2] === "anthropic" && Math.abs(Number(rows[1][7]) - 1.25) < 1e-9, JSON.stringify(rows[1]));
    check("api run returned", r.success);
  });
  await withEnv({ ...baseEnv(log6), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_CC_MAX_USD: "7" }, async () => {
    await spawnAgent(spawnOpts(p6));
    check("subscription: the per-run bound alone (LUXAS_CC_MAX_USD)", argAfter(argsOf(log6), "--max-budget-usd") === "7.00");
  });
  writeFileSync(join(p6, ".agent", "usage.log"), `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t29.80000000\tbrain\tbrain\n`);
  rmSync(`${log6}.args`, { force: true });
  await withEnv({ ...baseEnv(log6, { LUXAS_CC_AUTH: "api", ANTHROPIC_API_KEY: "sk-test" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
    const r = await spawnAgent(spawnOpts(p6));
    check("api with $0.20 left: refused, the CLI never started", !r.success && r.output.includes("not started") && !existsSync(`${log6}.args`), r.output);
  });
}

console.log("\n7. scope");
{
  const p7 = newProject("p7");
  const log7 = join(work, "log7");
  await withEnv({ ...baseEnv(log7, { FAKE_MODE: "stray" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
    const r = await spawnAgent(spawnOpts(p7));
    check("RESEARCH.md is put back byte for byte", readFileSync(join(p7, "RESEARCH.md"), "utf-8") === "# Toy\nOriginal brief.\n");
    check("…and the brain is told", r.output.includes("RESEARCH.md, which was put back"), r.output.slice(-400));
    check("a file outside the write roots is reported", r.output.includes("created stray.txt"));
    const reported = r.output.split("outside its write roots")[1]?.split("): ")[1] ?? "";
    check("writes inside the roots (notes/, report/figures/, the experiment dir) are not", reported.startsWith("created stray.txt") && !/notes\/experiments\.md|report\/figures|data\/experiments/.test(reported), reported);
  });
}

console.log("\n8. endings");
{
  const p8 = newProject("p8");
  const log8 = join(work, "log8");
  const run = (mode: string, extra: Record<string, string> = {}) => withEnv({ ...baseEnv(log8, { FAKE_MODE: mode, ...extra }), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_CC_RESUME: "0" }, () => spawnAgent(spawnOpts(p8)));
  const abort = await run("abort");
  check("provider abort → stopReason error, named", abort.exit.stopReason === "error" && /provider abort: Credit balance/.test(abort.exit.errorMessage ?? ""), JSON.stringify(abort.exit));
  const budget = await run("budget");
  check("own budget stop → stop (it may have delivered), noted", budget.exit.stopReason === "stop" && budget.output.includes("stopped at its budget"));
  const nores = await run("noresult");
  check("no result line → error with the exit code and stderr", nores.exit.stopReason === "error" && /code 3/.test(nores.exit.errorMessage ?? "") && /boom/.test(nores.exit.errorMessage ?? ""), nores.exit.errorMessage);
  const t0 = Date.now();
  const hang = await run("hang", { LUXAS_CC_WALL_MIN: String(1.5 / 60) });
  const child = Number(readOr(`${log8}.child`, "0")) || -1;
  check("wall limit → killed, returned within seconds", hang.exit.stopReason === "killed" && Date.now() - t0 < 20_000, `${hang.exit.stopReason} after ${Date.now() - t0} ms`);
  check("…and the CLI's child is gone", await until(() => !alive(child), 15_000), `pid ${child}`);
}

console.log("\n9. leftovers and the watchdog");
{
  const p9 = newProject("p9");
  const log9 = join(work, "log9");
  await withEnv({ ...baseEnv(log9, { FAKE_MODE: "leftover" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, () => spawnAgent(spawnOpts(p9)));
  const left = Number(readOr(`${log9}.child`, "0")) || -1;
  check("a background job the CLI left running is killed when it exits", await until(() => !alive(left), 5_000), `pid ${left}`);
  // A stand-in host that dies after a second: the watchdog must take the group down.
  const host = spawnProc("sleep", ["1"]);
  const transcriptPath = join(work, "w.jsonl"), stderrPath = join(work, "w.err");
  const p = CC.launchClaudeCode(fake, [], { cwd: p9, env: { ...process.env, FAKE_MODE: "hang", FAKE_LOG: join(work, "logw") }, wallMs: 120_000, transcriptPath, stderrPath, hostPid: host.pid });
  await until(() => existsSync(join(work, "logw.child")), 5_000);
  const hung = Number(readOr(join(work, "logw.child"), "0")) || -1;
  const res = await Promise.race([p, sleep(25_000).then(() => null)]);
  check("host dead → the watchdog kills the CLI's group (no wall limit needed)", res !== null && !res.timedOut && await until(() => !alive(hung), 5_000), JSON.stringify(res));
}

console.log("\n10. the background runner");
{
  const p10 = newProject("p10");
  const log10 = join(work, "log10");
  const id = "brain.bg-1";
  writeFileSync(join(p10, ".agent", "active-agents.json"), JSON.stringify([{ id, name: "experiment", task: "t", mode: "background", startedAt: Date.now(), conversationFile: join(p10, ".agent", "conversations", `${id}.jsonl`), status: "running" }]));
  const r = spawnSync(process.execPath, ["--import=tsx", join(ROOT, "src", "subagent-runner.ts"), "--agent", "experiment", "--task", "Compute the toy number.", "--project", p10, "--id", id,
    "--session", join(p10, ".agent", "conversations", `${id}.jsonl`), "--template-vars", JSON.stringify({ EXPERIMENT_ID: EID, ROLE: "" })],
    { cwd: ROOT, encoding: "utf-8", timeout: 120_000, env: { ...baseEnv(log10), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_MAX_REVIEW_ITERATIONS: "0" } });
  const reg = JSON.parse(readFileSync(join(p10, ".agent", "active-agents.json"), "utf-8"));
  const entry = (Array.isArray(reg) ? reg : reg.agents ?? []).find((a: any) => a.id === id);
  check("the runner ran the fake CLI", existsSync(`${log10}.args`), (r.stderr || "").slice(-400));
  check("…and marked its agent done with the CLI's result", entry?.status === "done" && String(entry?.result ?? "").startsWith("done ok"), JSON.stringify(entry).slice(0, 300));
}

console.log("\n11. the review loop's re-run goes to the executor and resumes");
{
  const p11 = newProject("p11");
  const log11 = join(work, "log11");
  await withEnv({ ...baseEnv(log11, { FAKE_MODE: "nodeliver" }), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_MAX_REVIEW_ITERATIONS: "0" }, async () => {
    const first = await spawnAgent(spawnOpts(p11));
    const sid = CC.readExperimentSession(p11, EID);
    process.env.FAKE_MODE = "ok";
    const out = await runExperimentReviewLoop(first, {
      projectDir: p11, mergedTemplateVars: { PROJECT_DIR: p11, EXPERIMENT_ID: EID, ROLE: "" },
      baseOpts: { name: "experiment", templateVars: { PROJECT_DIR: p11, EXPERIMENT_ID: EID, ROLE: "" }, projectDir: p11, getApiKey: () => undefined, parentAgentId: "brain", createSpawnTool: () => null },
      initialTask: "Compute the toy number.", getApiKey: () => undefined, parentAgentId: "brain", makeSpawnTool: () => null,
    });
    const args = argsOf(log11);
    check("not delivered → the harness re-sends it through the executor, resuming the session", argAfter(args, "--resume") === sid && /Not delivered/.test(argAfter(args, "-p") ?? ""), String(argAfter(args, "-p")).slice(0, 80));
    check("…and the re-run delivered", existsSync(join(p11, "data", "experiments", EID, "runs", "run_1", "results.json")) && !String(out.output).includes("NOT DELIVERED"), String(out.output).slice(-200));
  });
}

rmSync(work, { recursive: true, force: true });
rmSync(process.env.HOME!, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
