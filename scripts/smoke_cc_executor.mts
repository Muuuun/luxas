#!/usr/bin/env tsx
/**
 * smoke_cc_executor — LUXAS_EXPERIMENT_MODE=claude-code (src/executors/claude-code.ts),
 * offline, with a fake `claude` on LUXAS_CLAUDE_BIN.
 *
 *   1 argv: the task is not in argv (stdin), the system prompt is a file, model pinned, no settings file of any
 *     source, the tools last; resume only with a UUID
 *   2 env: an allowlist; the api key is the resolved one, not process.env's; Bash children scrubbed
 *   3 preflight: no auth, api without a key, an OAuth token as an api key, a tenant project on the subscription,
 *     a CLI that does not run
 *   4 spawnAgent hands an experiment to the executor: task on stdin, the solo definition + context + executor note
 *     in a 0600 file, the result text back; usage (cost 0 on the subscription) attributed to the experiment;
 *     conv markers; registry entry gone; session recorded
 *   5 a re-run of the same experiment resumes its session; LUXAS_CC_RESUME=0 starts fresh
 *   6 api: the key comes from getApiKey (process.env has none inside `luxas run`); spend logged per message and
 *     settled to the CLI's total; budget = min(per-run, cap − spent − what running executors reserved);
 *     refused below $0.50, refused for an OAuth token
 *   7 scope: RESEARCH.md put back, a file outside the write roots reported, writes inside them not
 *   8 endings: provider abort → error; budget stop → stop; no result line → error; wall limit → killed and the group gone
 *   9 cleanup: a background job, a detached descendant, and the group when the host dies
 *  10 the background runner hands an experiment to the executor too (review loop off)
 *  11 the review loop's harness-made re-run (not delivered) goes to the executor and resumes the session
 *  12 the credential the CLI reports is checked: an api run on a claude.ai login is killed at once
 *  13 harness files the executor could turn against its controls are restored; a session id that is not a UUID is ignored
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const A = await import("../src/board-actions.ts");
const { spawnAgent } = await import("../src/agents/spawn.ts");
const { runExperimentReviewLoop } = await import("../src/tools/spawn-agent.ts");

const work = mkdtempSync(join(tmpdir(), "smoke-cc-"));
const EID = "E1_toy";

// The fake CLI: writes its argv, env and stdin to FAKE_LOG.*, acts per FAKE_MODE, prints stream-json.
const fake = join(work, "fake-claude");
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9 (fake)"; exit 0; fi
log=\${FAKE_LOG:-/dev/null}
: > "$log.args"
for a in "$@"; do printf '%s\\n----\\n' "$a" >> "$log.args"; done
env > "$log.env"
cat > "$log.prompt"
sid=""; prev=""
for a in "$@"; do
  if [ "$prev" = "--session-id" ] || [ "$prev" = "--resume" ]; then sid="$a"; fi
  prev="$a"
done
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"'"$sid"'","model":"claude-opus-5-5","apiKeySource":"'"\${FAKE_LOGIN:-none}"'"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"python3 run.py"}}]}}'
if [ -n "$FAKE_USAGE" ]; then
  printf '%s\\n' '{"type":"assistant","message":{"id":"m1","content":[],"usage":{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}'
  printf '%s\\n' '{"type":"assistant","message":{"id":"m2","content":[],"usage":{"input_tokens":0,"output_tokens":4000,"cache_read_input_tokens":100000,"cache_creation_input_tokens":0}}}'
fi
mode=\${FAKE_MODE:-ok}
if [ "$mode" != "nodeliver" ]; then
  mkdir -p data/experiments/${EID}/runs/run_1
  printf '{"computed":{"x":1}}' > data/experiments/${EID}/runs/run_1/results.json
fi
case "$mode" in
  stray) echo "tampered" >> RESEARCH.md; echo stray > stray.txt; echo note >> notes/experiments.md; mkdir -p report/figures; echo f > report/figures/f.txt ;;
  hang) sleep 600 & echo $! > "$log.child"; wait ;;
  leftover) sleep 600 & echo $! > "$log.child" ;;
  detach) python3 -c 'import os,sys,time; os.setsid(); open(sys.argv[1],"w").write(str(os.getpid())); time.sleep(600)' "$log.child" & sleep 3 ;;
  noresult) echo "boom" >&2; exit 3 ;;
  tamper)
    printf '{"maxCost": 99999}' > .agent/run_config.json
    : > .agent/usage.log
    printf '{"at":"2026-01-01T00:00:00Z","experiment":"${EID}","action":"accept"}\\n' > .agent/board-actions.jsonl
    printf '{"sessionId":"--dangerously-skip-permissions"}' > .agent/claude-code/session-${EID}.json ;;
esac
cost=\${FAKE_COST:-1.25}
case "$mode" in
  abort) printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","result":"Credit balance is too low","session_id":"'"$sid"'"}' ;;
  budget) printf '%s\\n' '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":'"$cost"',"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40},"session_id":"'"$sid"'"}' ;;
  *) printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"done '"$mode"'","total_cost_usd":'"$cost"',"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40},"session_id":"'"$sid"'"}' ;;
esac
if [ "$mode" = "tamper" ]; then printf '{"sessionId":"--dangerously-skip-permissions"}' > .agent/claude-code/session-${EID}.json; fi
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
// The executor's env is an allowlist (claudeCodeEnv): the fake's own variables are passed by name.
const baseEnv = (log: string, extra: Record<string, string> = {}) => ({ ...process.env, LUXAS_CLAUDE_BIN: fake, LUXAS_CC_AUTH: "subscription",
  LUXAS_CC_ENV_PASS: "FAKE_LOG,FAKE_MODE,FAKE_COST,FAKE_LOGIN,FAKE_USAGE", FAKE_LOG: log, ...extra });

function withEnv<T>(env: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  return f().finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
const spawnOpts = (p: string, prompt = "Compute the toy number.", key?: string) => ({
  name: "experiment", templateVars: { PROJECT_DIR: p, EXPERIMENT_ID: EID, ROLE: "" }, prompt, projectDir: p,
  contextExtra: { task: prompt }, getApiKey: () => key, parentAgentId: "brain",
});
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

console.log("1. argv");
{
  const a = CC.claudeCodeArgs({ systemPromptFile: "/x/sys.md", model: "claude-opus-5-5", effort: "high", maxBudgetUsd: 12.345, sessionId: UUID });
  check("-p with no prompt in argv (it goes on stdin)", a[0] === "-p" && a[1] === "--model");
  check("model, effort, budget", argAfter(a, "--model") === "claude-opus-5-5" && argAfter(a, "--effort") === "high" && argAfter(a, "--max-budget-usd") === "12.35");
  check("the system prompt is a file, appended to Claude Code's own", argAfter(a, "--append-system-prompt-file") === "/x/sys.md" && !a.includes("--system-prompt") && !a.includes("--append-system-prompt"));
  check("no settings file of any source, no user skills, no MCP; stream-json needs --verbose", argAfter(a, "--setting-sources") === "" && a.includes("--disable-slash-commands") && a.includes("--strict-mcp-config") && a.includes("--verbose"));
  check("a fresh run names its session", argAfter(a, "--session-id") === UUID && !a.includes("--resume"));
  check("--allowedTools is last and lists the measured tools", a.slice(a.indexOf("--allowedTools") + 1).join(",") === CC.CC_TOOLS.join(","));
  const r = CC.claudeCodeArgs({ systemPromptFile: "/x", model: "m", effort: "high", maxBudgetUsd: 5, resumeSessionId: UUID });
  check("a re-run resumes a UUID session", argAfter(r, "--resume") === UUID && !r.includes("--session-id"));
  const bad = CC.claudeCodeArgs({ systemPromptFile: "/x", model: "m", effort: "high", maxBudgetUsd: 5, resumeSessionId: "--dangerously-skip-permissions" });
  check("a resume id that is not a UUID is dropped (no flag smuggled into argv)", !bad.includes("--resume") && !bad.includes("--dangerously-skip-permissions") && CC.SESSION_ID_RE.test(argAfter(bad, "--session-id") ?? ""));
}

console.log("\n2. env");
{
  const base = { PATH: "/usr/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-from-env", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
    CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CODE_USE_BEDROCK: "1" };
  const sub = CC.claudeCodeEnv(base, "subscription");
  check("the launching session's variables are dropped", !("CLAUDECODE" in sub) && !("CLAUDE_CODE_SESSION_ID" in sub) && !("CLAUDE_CODE_MESSAGING_SOCKET" in sub));
  check("the subscription's OAuth token and PATH pass", sub.CLAUDE_CODE_OAUTH_TOKEN === "o" && sub.PATH === "/usr/bin");
  check("subscription: no API key at all", !("ANTHROPIC_API_KEY" in sub) && !("ANTHROPIC_AUTH_TOKEN" in sub));
  const api = CC.claudeCodeEnv(base, "api", "sk-resolved");
  check("api: the resolved key, not process.env's", api.ANTHROPIC_API_KEY === "sk-resolved");
  check("api with no resolved key: none from process.env either", !("ANTHROPIC_API_KEY" in CC.claudeCodeEnv(base, "api")));
  check("Bash children are scrubbed of the credential; auto-memory, CLAUDE.md files, self-update off", sub.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB === "1" && api.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB === "1" && sub.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1" && sub.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1" && sub.DISABLE_AUTOUPDATER === "1");
  // An allowlist, not a denylist: nothing the executor does not need reaches its Bash children.
  const { CLAUDE_CODE_USE_BEDROCK: _bedrock, ...baseNoBedrock } = base;
  const leaky: NodeJS.ProcessEnv = { ...baseNoBedrock, DEEPSEEK_API_KEY: "d", OPENAI_API_KEY: "o", GLM_API_KEY: "g", GITHUB_TOKEN: "gh", GH_TOKEN: "gh2", SSH_AUTH_SOCK: "/tmp/agent.sock",
    AWS_SECRET_ACCESS_KEY: "aws", SESSION_SECRET: "jwt", LUXAS_STUDIO_SECRET: "st", PIP_INDEX_URL: "https://u:p@pypi.example", SMTP_PASS: "pw", DATABASE_URL: "postgres://u:p@h/db",
    LANG: "en_US.UTF-8", LC_ALL: "C", PYTHONPATH: "/x", OMP_NUM_THREADS: "4", HTTPS_PROXY: "http://proxy:3128", SSL_CERT_FILE: "/etc/ca.pem", XDG_CACHE_HOME: "/c", CONDA_PREFIX: "/conda" };
  for (const auth of ["subscription", "api"] as const) {
    const e = CC.claudeCodeEnv(leaky, auth, auth === "api" ? "sk-resolved" : undefined);
    const dropped = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "GLM_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "SSH_AUTH_SOCK", "AWS_SECRET_ACCESS_KEY", "SESSION_SECRET", "LUXAS_STUDIO_SECRET", "PIP_INDEX_URL", "SMTP_PASS", "DATABASE_URL", "CLAUDE_CODE_USE_BEDROCK"];
    check(`${auth}: other providers' keys, tokens, the ssh-agent, studio secrets, credentialed URLs are not passed`, dropped.every((k) => !(k in e)), dropped.filter((k) => k in e).join(","));
    check(`${auth}: locale, toolchain, numerics, proxy and CA settings are passed`, ["PATH", "HOME", "LANG", "LC_ALL", "PYTHONPATH", "OMP_NUM_THREADS", "HTTPS_PROXY", "SSL_CERT_FILE", "XDG_CACHE_HOME", "CONDA_PREFIX"].every((k) => k in e));
  }
  check("only the chosen auth's credential: api passes the key, subscription the OAuth token", !("CLAUDE_CODE_OAUTH_TOKEN" in CC.claudeCodeEnv(leaky, "api", "k")) && CC.claudeCodeEnv(leaky, "subscription").CLAUDE_CODE_OAUTH_TOKEN === "o");
  check("LUXAS_CC_ENV_PASS passes the operator's named extras, and only valid names", CC.claudeCodeEnv({ ...leaky, LUXAS_CC_ENV_PASS: "PIP_INDEX_URL, bad name ,SMTP_PASS" }, "subscription").PIP_INDEX_URL === "https://u:p@pypi.example" && !("bad name" in CC.claudeCodeEnv({ ...leaky, LUXAS_CC_ENV_PASS: "bad name" }, "subscription")));
  check("Bedrock: AWS_* passed only when CLAUDE_CODE_USE_BEDROCK is set", !("AWS_SECRET_ACCESS_KEY" in CC.claudeCodeEnv(leaky, "api", "k")) && CC.claudeCodeEnv({ ...leaky, CLAUDE_CODE_USE_BEDROCK: "1" }, "api", "k").AWS_SECRET_ACCESS_KEY === "aws");
}

console.log("\n3. preflight");
{
  const ok = { LUXAS_CLAUDE_BIN: fake, PATH: process.env.PATH };
  const has = async (env: any, key: string | undefined, dir: string | undefined, re: RegExp) => (await CC.claudeCodePreflight(env, dir, () => key)).some((p: string) => re.test(p));
  check("no LUXAS_CC_AUTH → refused", await has(ok, undefined, undefined, /LUXAS_CC_AUTH/));
  check("api without a key → refused", await has({ ...ok, LUXAS_CC_AUTH: "api" }, undefined, undefined, /no Anthropic API key/));
  check("api with an OAuth token for a key → refused", await has({ ...ok, LUXAS_CC_AUTH: "api" }, "sk-ant-oat01-xyz", undefined, /OAuth token/));
  check("api with a key → clean", (await CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "api" } as any, undefined, () => "sk-ant-api03-x")).length === 0);
  check("subscription on a CLI project → clean", (await CC.claudeCodePreflight({ ...ok, LUXAS_CC_AUTH: "subscription" } as any, "/Users/x/research/dy", () => undefined)).length === 0);
  check("subscription on a studio tenant's project → refused", await has({ ...ok, LUXAS_CC_AUTH: "subscription" }, undefined, "/srv/0123456789ab/projects/dy", /tenant/));
  check("a CLI that does not run → refused", await has({ ...ok, LUXAS_CC_AUTH: "subscription", LUXAS_CLAUDE_BIN: join(work, "nope") }, undefined, undefined, /does not run/));
}

console.log("\n4. spawnAgent → the executor");
const p4 = newProject("p4");
const log4 = join(work, "log4");
await withEnv({ ...baseEnv(log4), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
  const r = await spawnAgent(spawnOpts(p4));
  const args = argsOf(log4);
  const sysFile = argAfter(args, "--append-system-prompt-file") ?? "";
  const sys = readOr(sysFile);
  check("returns the CLI's result text, success, stopReason stop", r.success && r.output.startsWith("done ok") && r.exit.stopReason === "stop", JSON.stringify({ out: r.output.slice(0, 80), exit: r.exit }));
  check("the task reached the CLI on stdin", readOr(`${log4}.prompt`) === "Compute the toy number." && !args.includes("Compute the toy number."));
  check("the solo definition is in the system prompt file, with the experiment id filled in", sys.includes("SOLO executor") && sys.includes(`data/experiments/${EID}/`) && !sys.includes("{{EXPERIMENT_ID}}"));
  check("…and the executor note, after it", sys.includes("<claude_code_executor>") && sys.indexOf("<claude_code_executor>") > sys.indexOf("SOLO executor"));
  check("…in a file only the owner can read", !!sysFile && (statSync(sysFile).mode & 0o077) === 0, sysFile ? (statSync(sysFile).mode & 0o777).toString(8) : "no file");
  check("model pinned to claude-opus-5-5 by default, effort high", argAfter(args, "--model") === "claude-opus-5-5" && argAfter(args, "--effort") === "high");
  check("the CLI ran in the project dir", existsSync(join(p4, "data", "experiments", EID, "runs", "run_1", "results.json")));
  const env = readOr(`${log4}.env`, "ANTHROPIC_API_KEY=(fake never ran)");
  check("subscription: the child had no ANTHROPIC_API_KEY", !/^ANTHROPIC_API_KEY=/m.test(env));
  const rows = usageRows(p4);
  check("usage from the CLI's totals (no per-message usage here): cost 0 on the subscription, attributed to the experiment", rows.length === 1 && rows[0][2] === "claude-subscription" && Number(rows[0][7]) === 0 && rows[0][3] === "10" && rows[0][9] === "experiment" && rows[0][8] === r.agentId, JSON.stringify(rows));
  const conv = readFileSync(join(p4, ".agent", "conversations", `${r.agentId}.jsonl`), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  check("conv file: spawn_init with templateVars, the result as an assistant message, the run marker", conv[0].type === "spawn_init" && conv[0].templateVars?.EXPERIMENT_ID === EID && conv.some((m) => m.role === "assistant") && conv.some((m) => m.type === "claude_code_run" && m.listUsd === 1.25 && m.billedUsd === 0));
  const reg = existsSync(join(p4, ".agent", "active-agents.json")) ? readFileSync(join(p4, ".agent", "active-agents.json"), "utf-8") : "[]";
  check("the registry entry is removed after the run", !reg.includes(r.agentId), reg.slice(0, 200));
  check("the session is recorded for the experiment", CC.readExperimentSession(p4, EID) === argAfter(args, "--session-id"));
  check("a transcript per run under .agent/claude-code/, and no running marker left", readdirSync(join(p4, ".agent", "claude-code")).some((f: string) => f.startsWith(`${r.agentId}.1.`) && f.endsWith(".jsonl")) && !A.readRunningMarker(p4, EID));
});

console.log("\n5. re-runs resume the experiment's session");
await withEnv({ ...baseEnv(log4), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
  const sid = CC.readExperimentSession(p4, EID);
  await spawnAgent(spawnOpts(p4, "Revise: fix the units."));
  const args = argsOf(log4);
  check("the second spawn of the experiment resumes its session", !!sid && argAfter(args, "--resume") === sid && !args.includes("--session-id"), String(argAfter(args, "--resume")));
  await withEnv({ LUXAS_CC_RESUME: "0" }, () => spawnAgent(spawnOpts(p4)));
  const fresh = argsOf(log4);
  check("LUXAS_CC_RESUME=0 starts a fresh session", !!argAfter(fresh, "--session-id") && !fresh.includes("--resume"));
});

console.log("\n6. api: the resolved key, spend as it accrues, budget");
{
  const p6 = newProject("p6", 30);
  writeFileSync(join(p6, ".agent", "usage.log"), `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t22.00000000\tbrain\tbrain\n`);
  const log6 = join(work, "log6");
  const api = { ...baseEnv(log6, { LUXAS_CC_AUTH: "api", FAKE_LOGIN: "ANTHROPIC_API_KEY", FAKE_USAGE: "1", FAKE_COST: "0.45" }), LUXAS_EXPERIMENT_MODE: "claude-code" };
  await withEnv(api, async () => {
    const r = await spawnAgent(spawnOpts(p6, "Compute it.", "sk-resolved-by-luxas"));
    check("the run went through", r.success, r.output);
    check("the child got the key getApiKey resolved (process.env had none)", /^ANTHROPIC_API_KEY=sk-resolved-by-luxas$/m.test(readOr(`${log6}.env`)) && !process.env.ANTHROPIC_API_KEY);
    check("--max-budget-usd = cap − spent when below the per-run bound ($30 − $22)", argAfter(argsOf(log6), "--max-budget-usd") === "8.00", argAfter(argsOf(log6), "--max-budget-usd"));
    const rows = usageRows(p6).slice(1);
    const m1 = (1000 * 5 + 2000 * 25) / 1e6, m2 = (4000 * 25 + 100000 * 0.5) / 1e6;
    check("one row per API message, priced; then a correction to the CLI's total", rows.length === 3 && Math.abs(Number(rows[0][7]) - m1) < 1e-9 && Math.abs(Number(rows[1][7]) - m2) < 1e-9 && Math.abs(rows.reduce((s, x) => s + Number(x[7]), 0) - 0.45) < 1e-9, JSON.stringify(rows.map((x) => x[7])));
    check("…all attributed to the experiment, provider anthropic", rows.every((x) => x[2] === "anthropic" && x[9] === "experiment"));
  });
  await withEnv(api, async () => {
    // Another executor of this project is running with $5 reserved.
    const host = spawnProc("sleep", ["30"], { detached: true, stdio: "ignore" });
    const grp = spawnProc("sleep", ["30"], { detached: true, stdio: "ignore" });
    A.writeRunningMarker(p6, "E9_other", { eid: "E9_other", pgid: grp.pid!, hostPid: host.pid!, agentId: "x", startedAt: new Date().toISOString(), budget: 5 });
    writeFileSync(join(p6, ".agent", "usage.log"), `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t20.00000000\tbrain\tbrain\n`);
    await spawnAgent(spawnOpts(p6, "Compute it.", "sk-k"));
    check("what running executors reserved comes off the budget ($30 − $20 − $5)", argAfter(argsOf(log6), "--max-budget-usd") === "5.00", argAfter(argsOf(log6), "--max-budget-usd"));
    for (const c of [host, grp]) try { process.kill(c.pid!, "SIGKILL"); } catch { /* gone */ }
  });
  await withEnv({ ...baseEnv(log6), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_CC_MAX_USD: "7" }, async () => {
    await spawnAgent(spawnOpts(p6));
    check("subscription: the per-run bound alone (LUXAS_CC_MAX_USD)", argAfter(argsOf(log6), "--max-budget-usd") === "7.00");
  });
  writeFileSync(join(p6, ".agent", "usage.log"), `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t29.80000000\tbrain\tbrain\n`);
  rmSync(`${log6}.args`, { force: true });
  await withEnv(api, async () => {
    const r = await spawnAgent(spawnOpts(p6, "x", "sk-k"));
    check("api with $0.20 left: refused, the CLI never started", !r.success && r.output.includes("not started") && !existsSync(`${log6}.args`), r.output);
    const o = await spawnAgent(spawnOpts(p6, "x", "sk-ant-oat01-a-login"));
    check("api with an OAuth token for a key: refused", !o.success && /OAuth token/.test(o.output), o.output);
    const n = await spawnAgent(spawnOpts(p6, "x", undefined));
    check("api with no key resolved: refused", !n.success && /no Anthropic API key/.test(n.output), n.output);
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

console.log("\n9. cleanup");
{
  const p9 = newProject("p9");
  const log9 = join(work, "log9");
  await withEnv({ ...baseEnv(log9, { FAKE_MODE: "leftover" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, () => spawnAgent(spawnOpts(p9)));
  const left = Number(readOr(`${log9}.child`, "0")) || -1;
  check("a background job the CLI left running is killed when it exits", await until(() => !alive(left), 5_000), `pid ${left}`);
  rmSync(`${log9}.child`, { force: true });
  await withEnv({ ...baseEnv(log9, { FAKE_MODE: "detach" }), LUXAS_EXPERIMENT_MODE: "claude-code", LUXAS_CC_RESUME: "0" }, () => spawnAgent(spawnOpts(p9)));
  const det = Number(readOr(`${log9}.child`, "0")) || -1;
  check("a descendant that left the group (setsid, as Claude Code's Bash does) is killed too", det > 0 && await until(() => !alive(det), 5_000), `pid ${det}`);
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
    check("not delivered → the harness re-sends it through the executor, resuming the session", !!sid && argAfter(args, "--resume") === sid && /Not delivered/.test(readOr(`${log11}.prompt`)), readOr(`${log11}.prompt`).slice(0, 80));
    check("…and the re-run delivered", existsSync(join(p11, "data", "experiments", EID, "runs", "run_1", "results.json")) && !String(out.output).includes("NOT DELIVERED"), String(out.output).slice(-200));
  });
}

console.log("\n12. the credential the CLI reports is checked");
{
  check("api must be ANTHROPIC_API_KEY; subscription must not be an API key", !!CC.authMismatch("api", "none") && !CC.authMismatch("api", "ANTHROPIC_API_KEY") && !!CC.authMismatch("subscription", "ANTHROPIC_API_KEY") && !CC.authMismatch("subscription", "none"));
  const p12 = newProject("p12");
  const log12 = join(work, "log12");
  const t0 = Date.now();
  await withEnv({ ...baseEnv(log12, { LUXAS_CC_AUTH: "api", FAKE_LOGIN: "none", FAKE_MODE: "hang" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
    const r = await spawnAgent(spawnOpts(p12, "x", "sk-k"));
    const child = Number(readOr(`${log12}.child`, "0")) || -1;
    check("an api run that authenticated with the claude.ai login is killed within seconds", Date.now() - t0 < 15_000 && !r.success && /authenticated with "none"/.test(r.output), `${Date.now() - t0} ms: ${r.output.slice(-200)}`);
    check("…its process is gone", await until(() => !alive(child), 5_000));
  });
}

console.log("\n13. harness files the executor could turn against its controls");
{
  const p13 = newProject("p13", 40);
  const log13 = join(work, "log13");
  const usageBefore = `${Date.now()}\tm\tanthropic\t1\t1\t0\t0\t3.00000000\tbrain\tbrain\n`;
  writeFileSync(join(p13, ".agent", "usage.log"), usageBefore);
  const actionsBefore = JSON.stringify({ at: new Date().toISOString(), experiment: "E2_x", action: "stop", by: "op@x.y" }) + "\n";
  writeFileSync(join(p13, ".agent", "board-actions.jsonl"), actionsBefore);
  await withEnv({ ...baseEnv(log13, { FAKE_MODE: "tamper" }), LUXAS_EXPERIMENT_MODE: "claude-code" }, async () => {
    const r = await spawnAgent(spawnOpts(p13));
    check("run_config.json put back (the executor raised the cap to 99999)", JSON.parse(readFileSync(join(p13, ".agent", "run_config.json"), "utf-8")).maxCost === 40 && /run_config\.json, which was put back/.test(r.output), r.output.slice(-300));
    check("usage.log put back (the executor emptied it), with this run's own row after it", readFileSync(join(p13, ".agent", "usage.log"), "utf-8").startsWith(usageBefore) && usageRows(p13).length === 2 && /usage\.log, which was put back/.test(r.output));
    check("the decision log put back (the executor overwrote the stop with an accept)", readFileSync(join(p13, ".agent", "board-actions.jsonl"), "utf-8") === actionsBefore && !!A.stoppedByOperator(p13, "E2_x"));
    check("the harness's session record wins over the one the executor wrote", CC.SESSION_ID_RE.test(CC.readExperimentSession(p13, EID) ?? ""));
    writeFileSync(join(p13, ".agent", "claude-code", `session-${EID}.json`), JSON.stringify({ sessionId: "--dangerously-skip-permissions" }));
    check("a session id that is not a UUID is not used", CC.readExperimentSession(p13, EID) === undefined);
    await spawnAgent(spawnOpts(p13));
    const args = argsOf(log13);
    check("…no --resume, no smuggled flag", !args.includes("--resume") && !args.includes("--dangerously-skip-permissions") && !!argAfter(args, "--session-id"));
  });
}

rmSync(work, { recursive: true, force: true });
rmSync(process.env.HOME!, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
