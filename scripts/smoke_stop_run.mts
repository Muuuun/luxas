/**
 * smoke_stop_run — `luxas stop` finds the run.pid process AND the exec'd
 * children / background runners that name the project, never the caller.
 * Regression for 2026-08-28: killing only the npx wrapper left the node child
 * running a $60-capped project to $95.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRunProcesses, parsePs, stopRun } from "../src/stop-run.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const DIR = "/Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project";
const ps = parsePs([
  "  100 sshd: muqiao [priv]",
  "  200 bash -c P=" + DIR + "; kill -0 1552090",                                  // an ssh shell merely mentioning the dir
  " 1552104 node /Users/muqiao/.npm/_npx/x/node_modules/.bin/tsx /Users/muqiao/Documents/Sisyphus/src/index.ts run " + DIR + " --profile dual",
  " 1552115 /usr/bin/node --require /x/preflight.cjs --import file:///x/loader.mjs /Users/muqiao/Documents/Sisyphus/src/index.ts run " + DIR,
  " 1560000 /usr/bin/node /Users/muqiao/Documents/Sisyphus/src/subagent-runner.ts --project " + DIR + " --id brain.reader-abc",
  " 1570000 node /Users/muqiao/Documents/Sisyphus/src/index.ts run /Users/muqiao/Documents/sisyphus-projects/other/project",
  " 1580000 node /Users/muqiao/Documents/Sisyphus/src/index.ts stop " + DIR,
  " 1590000 python3 /Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project/data/experiments/E1/scripts/x.py",
].join("\n"));
check("parsePs reads pid + args", ps.length === 8 && ps[2].pid === 1552104);
const found = findRunProcesses(ps, DIR, 1552115, 1580000);
check("wrapper, exec'd child and background runner are all found", [1552104, 1552115, 1560000].every((p) => found.includes(p)), found.join(","));
check("an ssh/bash line that merely mentions the dir is NOT a target", !found.includes(200));
check("another project's run is NOT a target", !found.includes(1570000));
check("the `luxas stop` process itself is NOT a target", !found.includes(1580000));
check("a python experiment job is NOT a target (owned by the run; dies with it)", !found.includes(1590000));
check("run.pid is included even when its args don't match (stale table)", findRunProcesses(parsePs("  42 /usr/bin/node something-else"), DIR, 42, 1).includes(42));
check("trailing slash on the dir is tolerated", findRunProcesses(ps, DIR + "/", null, 1).includes(1552115));

// §C31 — the word "stop" in a directive, a task or a directory name is not a
// `luxas stop`; a sibling directory sharing the prefix is not the project.
// A run whose directive said "please stop E3" was invisible to `luxas stop`
// (the operator then reaches for kill, the failure this file exists for).
{
  const node = "/opt/homebrew/bin/node /Users/muqiao/Documents/Sisyphus/src/index.ts run ";
  const P = "/Users/muqiao/Documents/sisyphus-projects/dy-nuclear-spin-qc-20261006/project";
  const DY = "/opt/homebrew/Cellar/node/25.8.0/bin/node /Users/muqiao/Documents/Sisyphus/src/index.ts run " + P +
    " --profile dual --max-cost 70 --directive Operator note, 2026-10-06: the run was stopped by the operator at $41 to change how experiments are executed";
  const runner = (dir: string, task: string) =>
    `/usr/bin/node --import=tsx /Users/muqiao/Documents/Sisyphus/src/subagent-runner.ts --agent experiment --task ${task} --project ${dir} --id brain.experiment-bg-1 --session ${dir}/.agent/conversations/x.jsonl`;
  const cases: [string, string, string, number | null, number, number[]][] = [
    // [label, argv, projectDir, runPid, selfPid, expected targets]
    ["P1 Dy's real argv ('stopped by the operator') is a target", DY, P, null, 1, [62465]],
    ["P2 directive 'please stop E3', no run.pid, is a target", node + P + " --directive please stop E3 and write up", P, null, 1, [62465]],
    ["P3 same directive with run.pid alive is a target", node + P + " --directive please stop E3 and write up", P, 62465, 1, [62465]],
    ["P4 sibling DIR-v2 is NOT a target of DIR", node + "/x/bragg-eom-test-v2", "/x/bragg-eom-test", null, 1, []],
    ["P5 project named band-stop-filter (run.pid) is a target", node + "/x/band-stop-filter --profile dual", "/x/band-stop-filter", 62465, 1, [62465]],
    ["A1 background runner whose --task says 'luxas stop' is a target", runner(P, "Check why luxas stop missed E3; stop when done"), P, null, 1, [62465]],
    ["A2 run whose directive names 'luxas stop' and 'src/index.ts stop' is a target", node + P + " --directive the luxas stop command and src/index.ts stop path", P, null, 1, [62465]],
    ["A3 npm exec ancestor of `luxas stop <DIR>` is NOT a target", "npm exec tsx src/index.ts stop " + P, P, null, 999, []],
    ["A4 tsx wrapper ancestor of `luxas stop <DIR>` is NOT a target", "node /Users/muqiao/.npm/_npx/x/node_modules/.bin/tsx src/index.ts stop " + P, P, null, 999, []],
    ["A5 `bash -c cd …/luxas && npx tsx src/index.ts stop` is NOT a target", "bash -c cd /home/u/luxas && npx tsx src/index.ts stop " + P, P, null, 999, []],
    ["A6 run launched with 'DIR/' in argv is a target", node + P + "/ --profile dual", P, null, 1, [62465]],
    ["A7 a DIR-v2 background runner is NOT a target", runner(P + "-v2", "x"), P, null, 1, []],
    ["A8 selfPid is never a target, even when it equals run.pid", node + P, P, 62465, 62465, []],
  ];
  for (const [label, args, dir, runPid, self, want] of cases) {
    const got = findRunProcesses([{ pid: 62465, args }], dir, runPid, self);
    check(`C31 ${label}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// §C31b — `luxas stop` acts only on a project. The dir forgotten in the luxas
// checkout (the documented cwd), an empty "$DIR", a projects parent or '/' is
// a path prefix of every run's argv (the checkout is in every script path), so
// the stop SIGKILLed every run on the machine. The checkout has a .agent/ of
// its own, so a bare .agent/ is no project marker. A fake `ps` lists only pids
// above any pid_max and process.kill is recorded: a missing guard signals nothing.
{
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "stop-c31b-")));
  const LUX = join(root, "luxas"), PARENT = join(root, "projects");
  const A = join(PARENT, "proj-a"), B = join(PARENT, "proj-b");
  for (const d of [join(LUX, ".agent"), A, B]) mkdirSync(d, { recursive: true });
  writeFileSync(join(LUX, ".agent", "run_config.json"), "{}\n");
  for (const d of [A, B]) writeFileSync(join(d, "RESEARCH.md"), "# goal\n");
  const brainA = 9_100_101, runnerA = 9_100_102;
  const table = [
    `${brainA} /usr/bin/node ${LUX}/src/index.ts run ${A} --profile dual`,
    `${runnerA} /usr/bin/node --import=tsx ${LUX}/src/subagent-runner.ts --agent experiment --project ${A} --id brain.experiment-bg-1`,
    `9100201 /usr/bin/node ${LUX}/src/index.ts run ${B} --profile dual`,
    `9100202 /usr/bin/node --import=tsx ${LUX}/src/subagent-runner.ts --agent reader --project ${B} --id brain.reader-1`,
  ].join("\n");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ps"), `#!/bin/sh\ncat <<'EOF'\n${table}\nEOF\n`, { mode: 0o755 });
  const PATH = `${bin}:${process.env.PATH}`;
  const realPath = process.env.PATH, realKill = process.kill, realCwd = process.cwd();
  const sent: string[] = [];
  process.env.PATH = PATH;
  // Every pid reads as already gone, so stopRun never waits out its grace.
  process.kill = ((pid: number, sig?: string | number) => {
    if (sig === 0) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    sent.push(`${sig} ${pid}`);
    return true;
  }) as typeof process.kill;
  let fakePs = false;
  try {
    fakePs = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" }).trim() === table;
    check("C31b the fake ps is the one on PATH", fakePs);
    if (fakePs) {
      process.chdir(LUX);
      const refusals: [string, string][] = [
        ["no dir, cwd = the luxas checkout (.agent/, no RESEARCH.md)", "."],
        ["'' (an empty \"$DIR\")", ""],
        ["'/'", "/"],
        ["a parent dir holding two projects", PARENT],
      ];
      for (const [label, dir] of refusals) {
        sent.length = 0;
        const r = stopRun(dir, { graceMs: 0, log: () => {} });
        check(`C31b ${label} is refused and signals nothing`, Boolean(r.refused) && r.killed.length === 0 && sent.length === 0,
          `refused=${JSON.stringify(r.refused)} killed=${JSON.stringify(r.killed)} sent=${JSON.stringify(sent)}`);
      }
      sent.length = 0;
      const r = stopRun(A, { graceMs: 0, log: () => {} });
      check("C31b a project dir still stops its brain and runner, not the other project's",
        !r.refused && JSON.stringify(r.killed) === JSON.stringify([brainA, runnerA]) && sent.includes(`SIGTERM ${brainA}`),
        `refused=${JSON.stringify(r.refused)} killed=${JSON.stringify(r.killed)} sent=${JSON.stringify(sent)}`);
    }
  } finally {
    process.chdir(realCwd);
    process.kill = realKill;
    process.env.PATH = realPath;
  }
  // Through the CLI: a refusal exits 2, and an empty "$DIR" is judged as
  // typed, not turned into the cwd first (here the cwd is a project).
  if (fakePs) {
    const cases: [string, string, string[]][] = [
      ["`luxas stop` with no dir in the checkout", LUX, []],
      ["`luxas stop \"\"` inside a project", A, [""]],
    ];
    for (const [label, cwd, dirArgs] of cases) {
      const p = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "src", "index.ts"), "stop", ...dirArgs],
        { cwd, env: { ...process.env, PATH }, encoding: "utf-8", timeout: 30_000 });
      check(`C31b CLI ${label} exits 2 and stops nothing`, p.status === 2 && /refus/i.test(p.stderr) && !/Stopped \d/.test(p.stderr),
        `exit=${p.status} stderr=${(p.stderr ?? "").trim().split("\n").slice(-2).join(" | ")}`);
    }
  }
  rmSync(root, { recursive: true, force: true });
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — luxas stop targets the whole run, not just the wrapper.");
