#!/usr/bin/env tsx
/**
 * audit_experiment, offline: a fake `claude` on PATH records what it was
 * handed and answers in stream-json, so this checks the parts that decide what
 * an audit costs and what it can damage, without a model call:
 *  - the session runs in a clone, never in the project (re-running a project's
 *    build scripts overwrites its results.json);
 *  - ANTHROPIC_API_KEY is not passed on (the CLI would bill it instead of the
 *    subscription);
 *  - the prompt is the one verifier bench A2 measured, and the model and effort
 *    are the measured ones;
 *  - the answer is the audit, not a one-turn follow-up a late background-task
 *    notification appends to the stream;
 *  - a bad id or a non-project is refused before anything runs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPrompt, AUDIT_EFFORT, AUDIT_MODEL, readAudit } from "./audit_experiment.mts";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), "luxas-audit-smoke-"));
const proj = join(tmp, "proj"), eid = "E1_probe";
mkdirSync(join(proj, "notes"), { recursive: true });
mkdirSync(join(proj, "data", "experiments", eid, "runs", "run_1"), { recursive: true });
writeFileSync(join(proj, "notes", "experiments.md"), "## L2.1 — probe (E_1)\n\nT2* = 38.6 s.\n");
const results = join(proj, "data", "experiments", eid, "runs", "run_1", "results.json");
writeFileSync(results, '{"computed": {"T2": 38.6}}\n');

const bin = join(tmp, "bin"); mkdirSync(bin);
writeFileSync(join(bin, "claude"), `#!/bin/sh
printf '%s\\n' "$@" > "$PWD/argv.txt"
echo "\${ANTHROPIC_API_KEY-unset}" > "$PWD/key.txt"
echo '{"overwritten": true}' > data/experiments/${eid}/runs/run_1/results.json
echo '{"type":"system","subtype":"init","apiKeySource":"none"}'
echo '{"type":"result","subtype":"success","num_turns":12,"duration_ms":60000,"total_cost_usd":1.2,"result":"BREAKS notes/experiments.md:\\"T2* = 38.6 s\\" — recomputed 281.9 s"}'
echo '{"type":"result","subtype":"success","num_turns":1,"duration_ms":2000,"total_cost_usd":1.3,"result":"The slow scan was stopped. Nothing is lost."}'
`, { mode: 0o755 });

const run = (...a: string[]) => spawnSync("npx", ["tsx", "scripts/audit_experiment.mts", ...a], {
  encoding: "utf-8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ANTHROPIC_API_KEY: "sk-ant-smoke-not-a-key" },
});

console.log("\n[an audit of a project]");
{
  const r = run(proj, eid);
  const out = String(r.stdout);
  const clone = /clone=(\S+)/.exec(out)?.[1] ?? "";
  check("exit 3 when the audit reports BREAKS", r.status === 3, `exit ${r.status}: ${out.slice(-300)} ${String(r.stderr).slice(-300)}`);
  check("the session ran in a clone, not in the project", !!clone && clone !== proj && existsSync(join(clone, "argv.txt")), clone);
  check("the project's results.json is untouched (the fake overwrote the clone's)",
    readFileSync(results, "utf-8").includes('"T2": 38.6') && existsSync(join(clone, "data", "experiments", eid, "runs", "run_1", "results.json")) &&
    readFileSync(join(clone, "data", "experiments", eid, "runs", "run_1", "results.json"), "utf-8").includes("overwritten"));
  check("ANTHROPIC_API_KEY is not passed to the session", existsSync(join(clone, "key.txt")) && readFileSync(join(clone, "key.txt"), "utf-8").trim() === "unset",
    existsSync(join(clone, "key.txt")) ? readFileSync(join(clone, "key.txt"), "utf-8") : "no key.txt");
  const argv = existsSync(join(clone, "argv.txt")) ? readFileSync(join(clone, "argv.txt"), "utf-8").split("\n") : [];
  const after = (k: string) => argv[argv.indexOf(k) + 1];
  check("the measured model and effort", after("--model") === AUDIT_MODEL && after("--effort") === AUDIT_EFFORT, `${after("--model")} ${after("--effort")}`);
  check("the measured prompt, verbatim", argv.includes(auditPrompt(eid)));
  check("…which carries the recompute sentence", /recompute it independently from the stated inputs and the physics/.test(auditPrompt(eid)) && /re-run the shipped code/.test(auditPrompt(eid)));
  check("read, search and bash only", after("--allowedTools") === "Bash" && argv.includes("Grep") && !argv.includes("Write") && !argv.includes("Edit"));
  check("prints the audit's BREAKS line, not the follow-up turn", out.includes("recomputed 281.9 s") && !out.includes("Nothing is lost"), out.slice(-400));
  if (clone) rmSync(join(clone, ".."), { recursive: true, force: true });
}

console.log("\n[the verdict line, as the model actually writes it]");
{
  // Bench A3 (2026-10-21): the audit wrote "BREAK <file>…" four times and the
  // script printed "0 BREAKS line(s)" and exited 1, as if nothing had run.
  const fake = (result: string) => {
    const d = mkdtempSync(join(tmpdir(), "luxas-audit-verdict-"));
    writeFileSync(join(d, "claude"), `#!/bin/sh
echo '{"type":"system","subtype":"init","apiKeySource":"none"}'
cat <<'JSON'
${JSON.stringify({ type: "result", subtype: "success", num_turns: 9, duration_ms: 1000, total_cost_usd: 0.5, result })}
JSON
`, { mode: 0o755 });
    const r = spawnSync("npx", ["tsx", "scripts/audit_experiment.mts", proj, eid], {
      encoding: "utf-8", env: { ...process.env, PATH: `${d}:${process.env.PATH}` },
    });
    const clone = /clone=(\S+)/.exec(String(r.stdout))?.[1];
    if (clone) rmSync(join(clone, ".."), { recursive: true, force: true });
    rmSync(d, { recursive: true, force: true });
    return r;
  };
  const one = fake("I found two defects.\n\nBREAK data/x/results.json:computed.s — the shipped code gives 203.35 MHz, reported 65.68 MHz\n\n- BREAK notes/experiments.md:\"0.22\" — gap omits the hyperfine shift");
  check("singular BREAK lines count as defects (exit 3)", one.status === 3, `exit ${one.status}: ${String(one.stdout).slice(-300)}`);
  check("…and are printed", String(one.stdout).includes("203.35 MHz") && String(one.stdout).includes("2 BREAKS line(s)"), String(one.stdout).slice(-300));
  const none = fake("The experiment looks fine to me overall.");
  check("no verdict line at all: exit 1, said so, not reported as 0 defects", none.status === 1 && /no BREAKS or NO BREAKS line/.test(String(none.stdout)) && !/0 BREAKS line/.test(String(none.stdout)), `exit ${none.status}: ${String(none.stdout).slice(-300)}`);
  const clean = fake("NO BREAKS");
  check("NO BREAKS: exit 0", clean.status === 0, `exit ${clean.status}`);
}

console.log("\n[readAudit]");
{
  const a = readAudit([
    '{"type":"system","subtype":"init","apiKeySource":"ANTHROPIC_API_KEY"}',
    '{"type":"result","num_turns":30,"total_cost_usd":2.5,"duration_ms":9,"result":"NO BREAKS"}',
    '{"type":"result","num_turns":1,"total_cost_usd":2.6,"duration_ms":1,"result":"follow-up"}',
    '{"type":"res',
  ].join("\n"));
  check("the longest result is the audit, the largest cost is the total", a?.text === "NO BREAKS" && a?.turns === 30 && a?.costUsd === 2.6);
  check("the login is read from the init line", a?.login === "ANTHROPIC_API_KEY");
  check("no result line: null", readAudit('{"type":"assistant"}\n') === null);
}

console.log("\n[refusals run nothing]");
{
  const r1 = run(proj, "../E1_probe");
  check("an id that is not E<N>_<slug> is refused (exit 2)", r1.status === 2 && /refused/.test(String(r1.stdout)), String(r1.stdout).slice(0, 200));
  const empty = join(tmp, "not-a-project"); mkdirSync(empty);
  const r2 = run(empty, eid);
  check("a directory without notes/experiments.md is refused (exit 2)", r2.status === 2 && /notes\/experiments\.md/.test(String(r2.stdout)), String(r2.stdout).slice(0, 200));
  const r3 = run(proj, "E9_absent");
  check("an experiment with no data/experiments/<EID>/ is refused (exit 2)", r3.status === 2, String(r3.stdout).slice(0, 200));
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
