#!/usr/bin/env tsx
/**
 * smoke_simrun — the runner for external simulation software, over the local transport.
 *
 * skills/compute-methods/scripts/simrun runs a prepared job directory with a registered
 * program, holds the program's licence seat while it runs, survives the caller going away
 * (Luxas kills every bash command at 30 minutes and hands the call back after 90 s) and
 * records what produced the results. Its readers are the agents with bash, the operator,
 * and src/review-images.ts (simrun.json). This gate needs only python3: the "simulator"
 * is the host's own Python running a script written below, declared as a launcher.
 *
 * The load-bearing checks are the refusals and the cases a naive runner passes:
 *   - a job that exits 0 while printing a licence error is not a success;
 *   - an input the job did not touch is not an output;
 *   - a seat that has merely been silent is not dead (its owner may be a sleeping machine),
 *     and a seat from before the last reboot is dead at once;
 *   - `start` must return while the job runs, and a second `wait` must not redo the first;
 *   - two calls typed at once (two starts in one directory, several waiters on one stale seat)
 *     must not both win: a check followed by a write is not a lock;
 *   - a pid on record is a number, not a process: it is neither proof that a supervisor
 *     lives nor something `cancel` may kill once its beat is old;
 *   - what the caller writes into the directory after the program ended is not an output.
 * Every assertion reads bytes on disk or a process table, never simrun's own summary alone.
 *
 * smoke_simrun_ssh.mts holds the same runner against real ssh and scp.
 *
 *   npx tsx scripts/smoke_simrun.mts
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0, checks = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail.replace(/\s*\n\s*/g, " ⏎ ").slice(0, 600)}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SIMRUN = join(ROOT, "skills", "compute-methods", "scripts", "simrun");
const PY = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
if (!PY) { console.log("smoke_simrun: python3 is not on PATH, and the runner under test is a Python program"); process.exit(1); }

const T = mkdtempSync(join(tmpdir(), "luxas-simrun-"));
const STATE = join(T, "state");
const HOSTWD = join(STATE, "hosts", "here");      // the default workdir of a local host
const SOFTWARE = join(T, "software.json");
// HOME points into the temp directory: simrun's defaults live under ~/.sisyphus, and a gate
// that wrote there would change what the operator's next real job sees.
const ENV: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: join(T, "home"), TMPDIR: join(T, "tmp"), LUXAS_SOFTWARE_FILE: SOFTWARE, SIMRUN_STATE_DIR: STATE, SIMRUN_BEAT_S: "1" };
mkdirSync(ENV.HOME); mkdirSync(ENV.TMPDIR);
// Stand-ins for ssh and scp that write down their argv and connect to nothing. The cases that
// must be refused before any connection run with these, so a guard that has gone missing
// shows up as a line in this file and nothing leaves the machine.
const VOID_LOG = join(T, "void-argv.jsonl");
writeFileSync(VOID_LOG, "");
writeFileSync(join(T, "void.py"), `import json, sys\nwith open(${JSON.stringify(VOID_LOG)}, "a") as f:\n    f.write(json.dumps(sys.argv[1:]) + "\\n")\nsys.exit(97)\n`);
const VOID = { SIMRUN_SSH: `${PY} ${join(T, "void.py")}`, SIMRUN_SCP: `${PY} ${join(T, "void.py")}` };

interface Ran { rc: number | null; out: string; last: string; ms: number }
function simrun(args: string[], env: Record<string, string> = {}): Ran {
  const t0 = Date.now();
  const r = spawnSync(PY, [SIMRUN, ...args], { env: { ...ENV, ...env }, encoding: "utf8", timeout: 60_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const lines = out.trimEnd().split("\n");
  return { rc: r.status, out, last: lines[lines.length - 1] ?? "", ms: Date.now() - t0 };
}
const LINE = /^SIMRUN state=(\S+) exit=(\S+) host=(\S+) software=(\S+) job=(\d{8}T\d{6}Z-[0-9a-f]{8}) elapsed=(\d+)s(.*)$/;
const st = (r: Ran) => { const m = r.last.match(LINE); return m ? { state: m[1], exit: m[2], host: m[3], software: m[4], job: m[5], rest: m[7] } : { state: "", exit: "", host: "", software: "", job: "", rest: "" }; };
/** The same call without blocking the gate: for the cases that need two calls at the same moment. */
function simrunAsync(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(PY, [SIMRUN, ...args], { env: { ...ENV, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (out += b));
    p.on("close", (rc) => { const lines = out.trimEnd().split("\n"); resolve({ rc, out, last: lines[lines.length - 1] ?? "", ms: Date.now() - t0 }); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** A Python prelude that loads the runner as module `m` (the file has no .py suffix), for the few rules no command
 *  line reaches deterministically. Run with -B: no __pycache__ beside the runner. */
const RUNNER_AS_M = `import importlib.machinery, importlib.util, json, os, sys, time
_loader = importlib.machinery.SourceFileLoader("simrun_under_test", ${JSON.stringify(SIMRUN)})
m = importlib.util.module_from_spec(importlib.util.spec_from_file_location(_loader.name, ${JSON.stringify(SIMRUN)}, loader=_loader))
_loader.exec_module(m)
`;
const withRunner = (body: string, args: string[] = [], env: Record<string, string> = {}) => spawnSync(PY, ["-B", "-c", RUNNER_AS_M + body, ...args], { env: { ...ENV, ...env }, encoding: "utf8", timeout: 60_000 });
const parsed = (text: string): any => { try { return JSON.parse(text); } catch { return {}; } };
/** The fingerprint a doctor pass carries (spec section 1): the first 16 hex of the sha256 of
 *  transport, ssh, os, python and workdir joined by newlines. Written here from the
 *  specification, not copied from simrun: a second reader (src/software.ts) has only the text. */
const hostPrint = (h: { transport: string; ssh?: string; os?: string; python?: string; workdir?: string }) =>
  createHash("sha256").update([h.transport, h.ssh ?? "", h.os ?? "posix", h.python ?? (h.os === "windows" ? "py -3" : "python3"), h.workdir ?? ""].join("\n")).digest("hex").slice(0, 16);
const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(100); }
  return cond();
}
/** A fresh job directory holding the stand-in simulator and one input. */
function jobDir(name: string): string {
  const d = join(T, name);
  mkdirSync(d);
  writeFileSync(join(d, "sim.py"), SIM);
  writeFileSync(join(d, "input.txt"), "42\n");
  return d;
}
// The stand-in simulator. Every mode writes its pid first so the gate can ask the process
// table, not simrun, whether it is still there.
const SIM = `import os, subprocess, sys, time
mode = sys.argv[1]
open("pid.txt", "w").write(str(os.getpid()))
if mode == "calc":
    x = float(open("input.txt").read())
    open("result.txt", "w").write("x squared = %.2f\\n" % (x * x))
    print("answer = %.4f" % (x * x + 0.25))
elif mode == "exit3":
    open("partial.txt", "w").write("half a result\\n")
    print("about to stop with 3")
    sys.exit(3)
elif mode == "license":
    open("result.txt", "w").write("not a result\\n")
    print("License error: no seat for feature SOLVER")
elif mode == "sleep":
    time.sleep(float(sys.argv[2]))
    open("done.txt", "w").write("done\\n")
    print("slept")
elif mode == "stamp":
    with open(sys.argv[2], "a") as f: f.write("S %s %.6f\\n" % (sys.argv[3], time.time()))
    time.sleep(float(sys.argv[4]))
    with open(sys.argv[2], "a") as f: f.write("E %s %.6f\\n" % (sys.argv[3], time.time()))
elif mode == "spawn":
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(2.5)"])
    print("launcher done")
`;
const operatorFile = (hosts: unknown) => JSON.stringify({ hosts }, null, 1);
const GOOD = {
  here: {
    transport: "local",
    software: {
      calc: { launchers: { py: PY }, fail_patterns: ["License error"], max_minutes: 1 },
      quick: { launchers: { py: PY }, max_minutes: 0.02 },
      seat1: { launchers: { py: PY }, seats: 1, max_minutes: 1 },
      cad: { launchers: { cad: "/opt/cad/bin/cad" }, desktop: true },
    },
  },
  // A second local host with its own workdir, for doctor: it runs beside the other sections
  // (its detachment check alone sleeps 20 s) and must not show up in their job counts.
  spare: { transport: "local", software: {
    probe: { launchers: { py: PY }, check: ["py", "-c", "print(6 * 7)"], expect: "42" },
    mute: { launchers: { py: PY }, check: ["py", "-c", "print(41)"], expect: "42" },
  } },
  far: { transport: "ssh", ssh: "sim-user@far.example", workdir: "/srv/simwork", software: { solver: { launchers: { solve: "/opt/solver/bin/solve" }, seats: 2 } } },
};

/** What this gate started and is still alive: supervisors (their command line names the temp
 *  directory) and jobs (each wrote its pid to pid.txt before anything else). */
function strays(): number[] {
  const table = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout.split("\n");
  const named = table.filter((l) => l.includes(T)).map((l) => parseInt(l.trim(), 10));
  const jobs = (readdirSync(T, { recursive: true }) as string[]).filter((f) => f.endsWith("pid.txt")).map((f) => parseInt(readFileSync(join(T, f), "utf8"), 10))
    .filter((pid) => table.some((l) => parseInt(l.trim(), 10) === pid && l.includes("sim.py")));
  return [...new Set([...named, ...jobs])].filter((p) => p && p !== process.pid);
}

try {
  writeFileSync(SOFTWARE, operatorFile(GOOD));
  const doctor = spawn(PY, [SIMRUN, "doctor", "spare"], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let doctorOut = "";
  doctor.stdout.on("data", (b) => (doctorOut += b)); doctor.stderr.on("data", (b) => (doctorOut += b));
  const doctorDone = new Promise<number | null>((resolve) => doctor.on("close", resolve));

  console.log("1. the operator file is read strictly, and nothing private is printed");
  let r = simrun(["hosts", "--json"]);
  let doc: any = {};
  try { doc = JSON.parse(r.out); } catch { /* reported by the check below */ }
  check("hosts --json lists both hosts with their software ids and launcher names", r.rc === 0 && doc.exists === true && doc.problems?.length === 0
    && JSON.stringify(doc.hosts?.map((h: any) => [h.label, h.transport, h.os, h.doctor, h.software.map((s: any) => s.id).join("+")])) === JSON.stringify([["far", "ssh", "posix", "never", "solver"], ["here", "local", "posix", "n/a", "cad+calc+quick+seat1"], ["spare", "local", "posix", "n/a", "mute+probe"]])
    && JSON.stringify(doc.hosts[1].software[1]) === JSON.stringify({ id: "calc", launchers: ["py"], seats: null, max_minutes: 1, desktop: false, runs: true }), r.out);
  // "runs" is the runner's own answer to "is a job of this software accepted on this host now"; src/software.ts is
  // held to it in smoke_sim_wiring. "print" is what a doctor pass on the entry would be recorded against.
  const runsOf = (label: string) => Object.fromEntries((doc.hosts?.find((h: any) => h.label === label)?.software ?? []).map((s: any) => [s.id, s.runs]));
  check("…and says per software whether a job would be accepted now: not on a host without a doctor pass, not for desktop software",
    JSON.stringify(runsOf("far")) === JSON.stringify({ solver: false }) && runsOf("here").cad === false && runsOf("here").calc === true && runsOf("here").seat1 === true, JSON.stringify([runsOf("far"), runsOf("here")]));
  // The label is not part of it (doctor.json is keyed by label): the two local hosts have one entry and one fingerprint.
  check("…and each host's fingerprint, the one a doctor pass is recorded against", JSON.stringify(doc.hosts?.map((h: any) => h.print))
    === JSON.stringify([hostPrint({ transport: "ssh", ssh: "sim-user@far.example", workdir: "/srv/simwork" }), hostPrint({ transport: "local" }), hostPrint({ transport: "local" })]), JSON.stringify(doc.hosts?.map((h: any) => h.print)));
  const table = simrun(["hosts"]);
  for (const [what, secret] of [["the ssh target", "sim-user@far.example"], ["the workdir", "/srv/simwork"], ["a launcher path", "/opt/solver/bin/solve"], ["a launcher path", PY]] as const)
    check(`neither hosts nor hosts --json prints ${what} (${secret})`, !r.out.includes(secret) && !table.out.includes(secret) && table.rc === 0);
  const bad = (label: string, hosts: unknown, expect: RegExp) => {
    writeFileSync(join(T, "bad.json"), operatorFile(hosts));
    const h = simrun(["hosts", "--json"], { LUXAS_SOFTWARE_FILE: join(T, "bad.json") });
    let problems: string[] = [];
    try { problems = JSON.parse(h.out).problems; } catch { /* below */ }
    check(`${label} is a problem`, h.rc === 4 && problems.length === 1 && expect.test(problems[0]), h.out);
  };
  const withSw = (sw: object) => ({ here: { transport: "local", software: { calc: { launchers: { py: PY }, ...sw } } } });
  bad("an unknown key, naming the nearest legal key", withSw({ seat: 1 }), /unknown key "seat" \(nearest legal key: "seats"\)/);
  bad("an unknown host key (a key path does not belong in this file)", { here: { transport: "local", identity_file: "/k", software: {} } }, /unknown key "identity_file"/);
  bad("a workdir with a space", { far: { transport: "ssh", ssh: "far", workdir: "/srv/sim work", software: {} } }, /"workdir" must be an absolute path/);
  bad("a workdir with a backslash, with the reason (scp drops a backslash from a path it downloads)", { far: { transport: "ssh", ssh: "far", os: "windows", workdir: "C:\\luxas", software: {} } }, /"workdir" must use forward slashes \(C:\/luxas\): scp drops a backslash from a path it downloads/);
  bad("a python with a quote", { here: { transport: "local", python: "python3 -c 'x'", software: {} } }, /"python" must be space-separated tokens/);
  bad("an ssh target that starts with a dash", { far: { transport: "ssh", ssh: "-oProxyCommand=x", workdir: "/srv/w", software: {} } }, /"ssh" must be an ssh config alias/);
  bad("a check without expect", withSw({ check: ["py", "-V"] }), /"expect" is required with "check"/);
  bad("a check that does not start with a declared launcher", withSw({ check: ["python3", "-V"], expect: "3" }), /"check" must start with a declared launcher name \(py\)/);
  bad("seats: 0", withSw({ seats: 0 }), /"seats" must be a positive integer/);
  bad("max_minutes: -5", withSw({ max_minutes: -5 }), /"max_minutes" must be a positive number/);
  bad("a host label with a capital", { Here: { transport: "local", software: {} } }, /a host label must match/);
  // A value of the wrong type is a problem to print. The fingerprint is computed for every entry, good or not,
  // and joining an object into it ended `hosts` in a traceback with exit 1.
  bad("an ssh target that is an object, not a string", { far: { transport: "ssh", ssh: { host: "far.example" }, workdir: "/srv/w", software: {} } }, /"ssh" must be an ssh config alias/);
  bad("an os that is a number", { here: { transport: "local", os: 5, software: {} } }, /"os" must be "posix" or "windows"/);
  bad("a workdir that is a list", { here: { transport: "local", workdir: ["/srv/w"], software: {} } }, /"workdir" must be an absolute path/);
  r = simrun(["hosts"], { LUXAS_SOFTWARE_FILE: join(T, "bad.json") });
  check("…and the table prints the same problem, with exit 4 and no traceback", r.rc === 4 && !r.out.includes("Traceback") && /^problem: .*"workdir" must be an absolute path/m.test(r.out), r.out);
  mkdirSync(join(T, "state-list"));
  writeFileSync(join(T, "state-list", "doctor.json"), "[1, 2]");
  r = simrun(["hosts", "--json"], { SIMRUN_STATE_DIR: join(T, "state-list") });
  check("a doctor.json that is not an object is no record and no crash: the ssh host reads never", r.rc === 0 && parsed(r.out).hosts?.[0]?.doctor === "never" && parsed(r.out).hosts?.[0]?.software?.[0]?.runs === false, r.out);
  // …and doctor, which writes the file, starts a new record over it. `false` stands in for ssh: the host is not reached.
  r = simrun(["doctor", "far"], { SIMRUN_STATE_DIR: join(T, "state-list"), SIMRUN_SSH: "false", SIMRUN_SCP: "false" });
  const overList = parsed(readFileSync(join(T, "state-list", "doctor.json"), "utf8"));
  check("…and a doctor run writes its record over such a file: no traceback, the host it could not reach is on record as ok false", r.rc === 1 && !r.out.includes("Traceback") && /^problem: transport: /m.test(r.out)
    && !Array.isArray(overList) && overList.far?.ok === false && overList.far?.protocol === 1, `rc=${r.rc} ${r.out} ${JSON.stringify(overList)}`);
  const winHost = (sw: object) => ({ win: { transport: "ssh", ssh: "sim@win.example", os: "windows", workdir: "C:/lx", software: { solver: { launchers: { solve: "solve.exe" }, ...sw } } } });
  bad("a fail pattern outside ASCII on a Windows host (its log is in the machine's code page)", winHost({ fail_patterns: ["许可证错误"] }), /"fail_patterns" on a Windows host must be plain ASCII/);
  writeFileSync(join(T, "fine.json"), operatorFile(withSw({ fail_patterns: ["许可证错误"] })));
  r = simrun(["hosts", "--json"], { LUXAS_SOFTWARE_FILE: join(T, "fine.json") });
  check("…and the same pattern on a posix host is accepted (it matches there)", r.rc === 0 && JSON.parse(r.out).problems.length === 0, r.out);
  bad("software with no launcher", { here: { transport: "local", software: { calc: {} } } }, /"launchers" is required/);
  const refusedDir = jobDir("refused");
  r = simrun(["run", refusedDir, "--software", "calc", "--", "py", "sim.py", "calc"], { LUXAS_SOFTWARE_FILE: join(T, "bad.json") });
  check("with a problem in the file a job verb exits 4, prints the problem and starts nothing", r.rc === 4 && /"launchers" is required/.test(r.out) && !existsSync(join(refusedDir, "pid.txt")), r.out);
  r = simrun(["hosts", "--json"], { LUXAS_SOFTWARE_FILE: join(T, "absent.json") });
  try { doc = JSON.parse(r.out); } catch { doc = {}; }
  check("a missing file is not a problem: no hosts, exit 0", r.rc === 0 && doc.exists === false && doc.hosts?.length === 0 && doc.problems?.length === 0, r.out);

  console.log("2. refusals happen before anything runs, each with exit 4");
  const refuse = (label: string, args: string[], expect: string | RegExp, env: Record<string, string> = {}) => {
    const x = simrun(args, env);
    const hit = typeof expect === "string" ? x.out.trimEnd() === expect : expect.test(x.out);
    check(label, x.rc === 4 && hit && !LINE.test(x.last), `rc=${x.rc} ${x.out}`);
  };
  const cmd = ["--", "py", "sim.py", "calc"];
  refuse("software on no host: the exact sentence", ["run", refusedDir, "--software", "comsol", ...cmd], `simrun: software "comsol" is not available: no host in ${SOFTWARE} provides it`);
  refuse("desktop: true: the exact sentence", ["run", refusedDir, "--software", "cad", "--", "cad", "part.sldprt"], `simrun: software "cad" on host "here" needs the logged-on desktop session; this build has no desktop worker, so it cannot be started`);
  refuse("a launcher that is not declared, listing the legal ones", ["run", refusedDir, "--software", "calc", "--", "python3", "sim.py", "calc"], /must start with a launcher name declared for software "calc" on host "here" \(legal: py\); got "python3"/);
  refuse("the launcher's own path typed as the command", ["run", refusedDir, "--software", "calc", "--", PY, "sim.py", "calc"], /\(legal: py\)/);
  refuse("no command at all", ["run", refusedDir, "--software", "calc"], /\(legal: py\); got nothing/);
  refuse("an ssh host that has not passed doctor (nothing is contacted)", ["run", refusedDir, "--software", "solver", "--", "solve", "x"], `simrun: host "far" has not passed 'simrun doctor far' yet; jobs are refused until it has`);
  refuse("a host that does not have the software", ["run", refusedDir, "--software", "calc", "--host", "far", ...cmd], /host "far" does not provide software "calc" \(hosts that do: here\)/);
  const projectRoot = jobDir("project");
  writeFileSync(join(projectRoot, "RESEARCH.md"), "# a project\n");
  refuse("a directory that contains RESEARCH.md", ["run", projectRoot, "--software", "calc", ...cmd], /contains RESEARCH\.md: that is a project root, not a job directory/);
  writeFileSync(join(ENV.HOME, "sim.py"), SIM);
  refuse("the home directory", ["run", ENV.HOME, "--software", "calc", ...cmd], /is the home directory or contains it/);
  refuse("an ancestor of the home directory", ["run", T, "--software", "calc", ...cmd], /is the home directory or contains it/);
  const linked = jobDir("linked");
  mkdirSync(join(linked, "mesh"));
  symlinkSync(join(ENV.HOME, "sim.py"), join(linked, "mesh", "shared.py"));
  refuse("a symlink inside the directory", ["run", linked, "--software", "calc", ...cmd], /contains a symlink \(mesh\/shared\.py\); symlinks are refused, not followed/);
  refuse("an option the verb does not have, naming the nearest", ["run", refusedDir, "--software", "calc", "--max-minute", "1", ...cmd], /has no option --max-minute \(nearest: --max-minutes\)/);
  // A job directory is sent whole to the host. The directory that holds the keys is not a
  // project root (it contains no marker), so the rule above let it through.
  const keys = join(ENV.HOME, ".ssh"), inState = join(T, "elsewhere", ".sisyphus", "job");
  for (const d of [keys, inState]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, "sim.py"), SIM); writeFileSync(join(d, "input.txt"), "42\n"); }
  refuse("~/.ssh itself", ["run", keys, "--software", "calc", ...cmd], /is inside \.ssh; a job directory is sent whole to the host/);
  refuse("a directory anywhere under a .sisyphus", ["run", inState, "--software", "calc", ...cmd], /is inside \.sisyphus; a job directory is sent whole to the host/);
  // The same two typed in other letters. realpath keeps the case that was typed, and on a disk that folds case
  // (this Mac's) ~/.SSH is the keys directory: it was accepted and the job ran in it. On a disk that tells the
  // names apart, a directory spelled that way is refused all the same.
  const keysTyped = join(ENV.HOME, ".SSH"), stateTyped = join(T, "elsewhere", ".Sisyphus", "job");
  for (const d of [keysTyped, stateTyped]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, "sim.py"), SIM); writeFileSync(join(d, "input.txt"), "42\n"); }
  refuse("~/.SSH (the keys directory, on a disk that folds letter case)", ["run", keysTyped, "--software", "calc", ...cmd], /is inside \.ssh; a job directory is sent whole to the host/);
  refuse("a directory under .Sisyphus", ["run", stateTyped, "--software", "calc", ...cmd], /is inside \.sisyphus; a job directory is sent whole to the host/);
  // One place under .sisyphus is a project: a bench run is ~/.sisyphus/bench-runs/<run>/ (scripts/bench_run.mts).
  // As first written, the rule above refused every job directory inside one, so no bench run could use the runner.
  const benchRun = join(T, "elsewhere", ".sisyphus", "bench-runs", "2026-10-09T00-00-00-luxas-blender-02-lit-scene");
  const inBench = join(benchRun, "data", "experiments", "E1_scene", "job");
  const inArchive = join(T, "elsewhere", ".sisyphus", "archive", "p-1a2b", "job");
  const stateInBench = join(benchRun, "data", ".sisyphus", "job");
  for (const d of [benchRun, inBench, inArchive, stateInBench]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, "sim.py"), SIM); writeFileSync(join(d, "input.txt"), "42\n"); }
  refuse("a bench run's own directory", ["run", benchRun, "--software", "calc", ...cmd], /is inside \.sisyphus; a job directory is sent whole to the host/);
  refuse("a directory under another part of .sisyphus", ["run", inArchive, "--software", "calc", ...cmd], /is inside \.sisyphus; a job directory is sent whole to the host/);
  refuse("a .sisyphus inside a bench run", ["run", stateInBench, "--software", "calc", ...cmd], /is inside \.sisyphus; a job directory is sent whole to the host/);
  const jobsOnHost = () => (existsSync(join(HOSTWD, "jobs")) ? readdirSync(join(HOSTWD, "jobs")) : []);
  check("none of the refusals ran the program or left a job on the host", jobsOnHost().length === 0
    && [refusedDir, projectRoot, linked, ENV.HOME, keys, inState, keysTyped, stateTyped, benchRun, inArchive, stateInBench].every((d) => !existsSync(join(d, "pid.txt")) && !existsSync(join(d, ".simrun", "job.json"))), jobsOnHost().join(","));
  r = simrun(["run", inBench, "--software", "calc", ...cmd]);
  check("a job directory inside a bench run's project is an ordinary job directory: the job runs", r.rc === 0 && / state=exited exit=0 host=here /.test(` ${r.last}`) && existsSync(join(inBench, "simrun.json")), r.out);

  // A Windows host, proven by a doctor record written here by hand: nothing below may reach it.
  const WIN = { transport: "ssh", ssh: "sim@win.example", os: "windows", workdir: "C:/lx" };
  const winFile = join(T, "win.json"), winState = join(T, "state-win");
  const WINENV = { ...VOID, LUXAS_SOFTWARE_FILE: winFile, SIMRUN_STATE_DIR: winState };
  writeFileSync(winFile, operatorFile({ win: { ...WIN, software: { solver: { launchers: { solve: "solve.exe" }, check: ["solve", "--version"], expect: "9.1" }, plain: { launchers: { solve: "solve.exe" } } } } }));
  mkdirSync(winState);
  const winPass = (extra: object) => writeFileSync(join(winState, "doctor.json"), JSON.stringify({ win: { ok: true, at: "2026-10-09T08:15:00Z", simrun: "0123456789ab", os: "windows", protocol: 1, ...extra } }));
  const doctorOf = () => { try { return JSON.parse(simrun(["hosts", "--json"], WINENV).out).hosts[0].doctor; } catch { return "unreadable"; } };
  const names = jobDir("win-names");
  mkdirSync(join(names, "sub"));
  for (const f of ["results:hidden.txt", "sub/NUL", "trail.", "aux.py", "auxiliary.py", "fine.txt"]) writeFileSync(join(names, f), "x\n");
  winPass({ checked: ["solver"] });
  check("a pass recorded without the host's fingerprint is no pass (it does not say which machine was proven)", doctorOf() === "never");
  winPass({ host: hostPrint({ ...WIN, workdir: "C:/other" }), checked: ["solver"] });
  check("…nor is one made when the label pointed at another workdir", doctorOf() === "never");
  winPass({ host: hostPrint(WIN), checked: ["solver"] });
  check("with the fingerprint of this entry (computed here from the specification's rule) it is passed", doctorOf() === "passed");
  refuse("names a Windows host would change or lose without an error are refused here, each named", ["run", names, "--software", "solver", "--", "solve", "x"],
    /4 name\(s\) in .* cannot exist on the Windows host "win".*: aux\.py, results:hidden\.txt, sub\/NUL, trail\.; rename them/, WINENV);
  const winView = () => { try { return JSON.parse(simrun(["hosts", "--json"], WINENV).out).hosts[0]; } catch { return { software: [] }; } };
  const winRuns = () => JSON.stringify(Object.fromEntries(winView().software.map((s: any) => [s.id, s.runs])));
  check("hosts --json prints that fingerprint, and \"runs\" for both software once the host passed and the check ran", winView().print === hostPrint(WIN) && winRuns() === JSON.stringify({ plain: true, solver: true }), `${winView().print} ${winRuns()}`);
  winPass({ host: hostPrint(WIN), checked: [] });
  refuse("software whose check the recorded doctor run did not pass is refused, although the host passed", ["run", refusedDir, "--software", "solver", "--", "solve", "x"],
    `simrun: software "solver" on host "win" declares a check that the last 'simrun doctor win' did not run; run doctor again before using it`, WINENV);
  check("…\"runs\" says the same per software (the one with no check still runs), and the table says what to do",
    winRuns() === JSON.stringify({ plain: true, solver: false }) && /solver check not run by the last doctor: run doctor again \(solve\)/.test(simrun(["hosts"], WINENV).out) && !/plain check not run/.test(simrun(["hosts"], WINENV).out), `${winRuns()} ${simrun(["hosts"], WINENV).out}`);
  // "checked" is read as a list and as nothing else. A number ended hosts, hosts --json and run in a traceback (exit 1,
  // which for run means "the job ended badly"); a string counted software as checked when it held the id anywhere
  // ("solver-old"), and an object when it had the id as a key, while src/software.ts read both as no check at all.
  for (const [what, value] of [["a number", 5], ["true", true], ["a string that holds the id", "solver-old"], ["an object with the id as a key", { solver: 1 }]] as const) {
    winPass({ host: hostPrint(WIN), checked: value });
    const h = simrun(["hosts", "--json"], WINENV), t = simrun(["hosts"], WINENV);
    const x = simrun(["run", refusedDir, "--software", "solver", "--", "solve", "x"], WINENV);
    check(`a doctor record whose "checked" is ${what} proves no check: no traceback, the host reads passed, and software that declares a check is refused`,
      h.rc === 0 && t.rc === 0 && !(h.out + t.out + x.out).includes("Traceback") && parsed(h.out).hosts?.[0]?.doctor === "passed" && winRuns() === JSON.stringify({ plain: true, solver: false })
      && x.rc === 4 && x.out.includes("declares a check that the last 'simrun doctor win' did not run"), `hosts rc=${h.rc} table rc=${t.rc} run rc=${x.rc} ${winRuns()} ${x.out}`);
  }
  // desktop: true is answered before any doctor rule. Doctor never runs a desktop entry's check, so "its check was
  // not run; run doctor again" was a refusal nobody could clear, and the operator's checklist adds the key to an
  // entry that has a check.
  const desktopSentence = `simrun: software "cadchk" on host "win" needs the logged-on desktop session; this build has no desktop worker, so it cannot be started`;
  const winSoftware = { solver: { launchers: { solve: "solve.exe" }, check: ["solve", "--version"], expect: "9.1" }, plain: { launchers: { solve: "solve.exe" } } };
  writeFileSync(winFile, operatorFile({ win: { ...WIN, software: { ...winSoftware, cadchk: { launchers: { solve: "solve.exe" }, check: ["solve", "--version"], expect: "9.1", desktop: true } } } }));
  winPass({ host: hostPrint(WIN), checked: ["solver"] });
  refuse("desktop: true on an entry that also declares a check, on a host that passed: the desktop sentence, not \"run doctor again\"", ["run", refusedDir, "--software", "cadchk", "--", "solve", "x"], desktopSentence, WINENV);
  check("…\"runs\" is false for it, and the table says desktop and nothing about a check", winRuns() === JSON.stringify({ cadchk: false, plain: true, solver: true })
    && /cadchk desktop: cannot be started by this build \(solve\)/.test(simrun(["hosts"], WINENV).out) && !/cadchk[^;]*check not run/.test(simrun(["hosts"], WINENV).out), `${winRuns()} ${simrun(["hosts"], WINENV).out}`);
  winPass({ checked: ["solver"] });
  refuse("…and the same sentence on a host with no doctor pass (a doctor run would not change the answer)", ["run", refusedDir, "--software", "cadchk", "--", "solve", "x"], desktopSentence, WINENV);
  refuse("…while software that is not desktop is refused there for the missing pass, as before", ["run", refusedDir, "--software", "plain", "--", "solve", "x"], `simrun: host "win" has not passed 'simrun doctor win' yet; jobs are refused until it has`, WINENV);
  // Two names that differ only by letter case are one file on a Windows host: the second replaces the first there
  // without an error. The rule is asked directly, because this Mac's disk cannot hold such a pair in one directory;
  // on a disk that can, the refusal itself is checked as well.
  const pairs = withRunner(`print(json.dumps([m.case_twins(["mesh/Fine.dat", "run.py", "mesh/fine.dat"]), m.case_twins(["a.txt", "b.txt", "a.txt"]), m.case_twins([])]))`);
  check("names that differ only by letter case are found as a pair; equal names and different names are not", JSON.stringify(parsed(pairs.stdout)) === JSON.stringify([["mesh/Fine.dat", "mesh/fine.dat"], null, null]), pairs.stdout + pairs.stderr);
  const twinDir = jobDir("win-twins");
  mkdirSync(join(twinDir, "mesh"));
  writeFileSync(join(twinDir, "mesh", "Fine.dat"), "fine\n"); writeFileSync(join(twinDir, "mesh", "fine.dat"), "coarse\n");
  winPass({ host: hostPrint(WIN), checked: ["solver"] });
  if (readdirSync(join(twinDir, "mesh")).length === 2)
    refuse("…and a job directory that holds such a pair is refused for a Windows host, both named", ["run", twinDir, "--software", "plain", "--", "solve", "x"], /mesh\/Fine\.dat and mesh\/fine\.dat in .* differ only by letter case, and the Windows host "win" holds one name for both/, WINENV);
  else console.log("  · this disk folds letter case, so a job directory cannot hold such a pair here; the refusal is checked next with the listing replaced");
  // The refusal itself on any disk: the runner loaded as a module, with its directory listing replaced by one that
  // holds the pair. (Without this, on a disk that folds case nothing held the rule to the start of a job.)
  const twinsTold = withRunner(`m.walk = lambda root: (["mesh/Fine.dat", "mesh/fine.dat", "run.py"], ["mesh"], [])
sys.exit(m.main(["simrun", "run", sys.argv[1], "--software", "plain", "--", "solve", "x"]))
`, [refusedDir], WINENV);
  check("a job directory listed with two names that differ only by letter case is refused for a Windows host before anything is sent, both named", twinsTold.status === 4
    && /mesh\/Fine\.dat and mesh\/fine\.dat in .* differ only by letter case, and the Windows host "win" holds one name for both: one would replace the other there without an error; rename one/.test(twinsTold.stdout), `rc=${twinsTold.status} ${twinsTold.stdout}${twinsTold.stderr}`);
  // simrun's own records are left out of the list of a job's files under any spelling the disk would take for them.
  const longS = join(T, "long-s");
  mkdirSync(join(longS, ".\u017fimrun"), { recursive: true });
  writeFileSync(join(longS, ".\u017fimrun", "job.json"), "{}\n"); writeFileSync(join(longS, "\u017fimrun.json"), "{}\n"); writeFileSync(join(longS, "kept.txt"), "x\n");
  const walked = withRunner(`print(json.dumps(m.walk(sys.argv[1])))`, [longS]);
  check("the list of a job's files leaves out simrun's records spelled with a long s (this Mac's disk holds one name for both spellings; lower() does not fold that letter)",
    JSON.stringify(parsed(walked.stdout)) === JSON.stringify([["kept.txt"], [], []]), walked.stdout + walked.stderr);
  check("none of these refusals handed a single word to ssh or scp", readFileSync(VOID_LOG, "utf8") === "", readFileSync(VOID_LOG, "utf8"));

  const clogged = jobDir("clogged");
  writeFileSync(join(clogged, ".simrun"), "a file where simrun keeps its records\n");
  r = simrun(["run", clogged, "--software", "calc", ...cmd]);
  check("a file error on this machine is one line and exit 5, never a traceback with exit 1 (1 means the job ended badly)", r.rc === 5 && !r.out.includes("Traceback") && r.out.trimEnd().split("\n").length === 1
    && /^simrun: a file operation on this machine failed \(.*\); this says nothing about a job: simrun status /.test(r.out) && !existsSync(join(clogged, "pid.txt")), `rc=${r.rc} ${r.out}`);

  console.log("3. a job that prints a number and writes a file");
  const calc = jobDir("calc");
  r = simrun(["run", calc, "--software", "calc", "--", "py", "sim.py", "calc"]);
  let s = st(r);
  check("run exits 0 and its last line is SIMRUN state=exited exit=0", r.rc === 0 && s.state === "exited" && s.exit === "0" && s.host === "here" && s.software === "calc" && s.rest === "", r.out);
  const lines = r.out.trimEnd().split("\n");
  check("the number the job printed is in the log tail above the state line", lines.indexOf("| answer = 1764.2500") >= 0 && lines.indexOf("| answer = 1764.2500") < lines.length - 1, r.out);
  check("the job really ran in the directory (bytes on disk)", readFileSync(join(calc, "result.txt"), "utf8") === "x squared = 1764.00\n");
  let rec = existsSync(join(calc, "simrun.json")) ? readJson(join(calc, "simrun.json")) : {};
  check("simrun.json records the command by launcher name, with no absolute path", JSON.stringify(rec.command) === JSON.stringify(["py", "sim.py", "calc"]) && !readFileSync(join(calc, "simrun.json"), "utf8").includes(PY)
    && rec.job === s.job && rec.host === "here" && rec.software === "calc" && rec.state === "exited" && rec.exit === 0, JSON.stringify(rec));
  check("outputs lists exactly the files the job created, with the sha256 of the bytes on disk", JSON.stringify(rec.outputs) === JSON.stringify(["pid.txt", "result.txt"].map((p) => ({ path: p, bytes: statSync(join(calc, p)).size, sha256: sha(join(calc, p)) }))), JSON.stringify(rec.outputs));
  check("inputs the job did not touch (input.txt, sim.py) are not outputs", !JSON.stringify(rec.outputs).includes("input.txt") && !JSON.stringify(rec.outputs).includes("sim.py") && JSON.stringify(rec.left_on_host) === "[]");
  const firstJob = s.job;

  console.log("4. a job that ends badly is not a result");
  const exit3 = jobDir("exit3");
  r = simrun(["run", exit3, "--software", "calc", "--", "py", "sim.py", "exit3"]);
  s = st(r);
  rec = readJson(join(exit3, "simrun.json"));
  check("exit 3: run exits 1, state=exited exit=3", r.rc === 1 && s.state === "exited" && s.exit === "3" && r.out.includes("| about to stop with 3"), r.out);
  check("exit 3: outputs is [] although the job wrote a file", existsSync(join(exit3, "partial.txt")) && JSON.stringify(rec.outputs) === "[]" && rec.exit === 3, JSON.stringify(rec));
  const lic = jobDir("license");
  r = simrun(["run", lic, "--software", "calc", "--", "py", "sim.py", "license"]);
  s = st(r);
  rec = readJson(join(lic, "simrun.json"));
  check("a job that exits 0 but prints a declared fail pattern ends state=failed, run exits 1", r.rc === 1 && s.state === "failed" && s.exit === "0" && s.rest === ' reason="fail_pattern:License error"', r.out);
  check("…and its outputs is [] with the pattern recorded", JSON.stringify(rec.outputs) === "[]" && rec.state === "failed" && rec.reason === "fail_pattern:License error" && existsSync(join(lic, "result.txt")), JSON.stringify(rec));
  r = simrun(["run", lic, "--software", "quick", "--", "py", "sim.py", "license"]);
  check("the same output under software with no fail_patterns is exited 0 (the pattern is the operator's, not built in)", r.rc === 0 && st(r).state === "exited", r.out);

  console.log("5. the time limit kills the job");
  const slow = jobDir("slow");
  r = simrun(["run", slow, "--software", "quick", "--", "py", "sim.py", "sleep", "30"]);
  s = st(r);
  const slowPid = parseInt(readFileSync(join(slow, "pid.txt"), "utf8"), 10);
  check("a 30 s job under max_minutes 0.02 ends state=timeout, run exits 1, within seconds", r.rc === 1 && s.state === "timeout" && s.exit === "-" && s.rest === " reason=max_minutes" && r.ms < 15_000, `${r.ms}ms ${r.out}`);
  check("its process is gone and it never finished", slowPid > 0 && !pidAlive(slowPid) && !existsSync(join(slow, "done.txt")), `pid ${slowPid}`);
  r = simrun(["run", jobDir("clamp"), "--software", "quick", "--max-minutes", "5", "--", "py", "sim.py", "sleep", "30"]);
  check("--max-minutes cannot raise the operator's limit, and says so", r.rc === 1 && st(r).state === "timeout" && /--max-minutes 5 is above the limit of 0\.02/.test(r.out), r.out);
  r = simrun(["run", jobDir("lower"), "--software", "calc", "--max-minutes", "0.02", "--", "py", "sim.py", "sleep", "30"]);
  check("--max-minutes can lower it", r.rc === 1 && st(r).state === "timeout" && r.ms < 15_000, r.out);

  console.log("6. start returns while the job runs; wait collects it once");
  const det = jobDir("detached");
  r = simrun(["start", det, "--software", "calc", "--", "py", "sim.py", "sleep", "6"]);
  s = st(r);
  check("start exits 0 in well under the job's 6 s", r.rc === 0 && r.ms < 3000 && s.state === "running", `${r.ms}ms ${r.out}`);
  await until(() => existsSync(join(det, "pid.txt")) && readFileSync(join(det, "pid.txt"), "utf8") !== "", 8000);
  const detPid = parseInt(readFileSync(join(det, "pid.txt"), "utf8"), 10);
  check("the process that called start has exited and the job is alive (process table)", detPid > 0 && pidAlive(detPid) && !existsSync(join(det, "done.txt")));
  r = simrun(["status", det]);
  check("status says running and exits 0", r.rc === 0 && st(r).state === "running" && st(r).job === s.job, r.out);
  r = simrun(["start", det, "--software", "calc", "--", "py", "sim.py", "calc"]);
  check("a second start in the same directory is refused and names the active job", r.rc === 4 && r.out.includes(`job ${s.job} is still active in ${det}`), r.out);
  r = simrun(["wait", det, "--timeout", "30"]);
  check("wait returns state=exited exit=0 with the log tail", r.rc === 0 && st(r).state === "exited" && st(r).exit === "0" && r.out.includes("| slept") && existsSync(join(det, "done.txt")), r.out);
  const recBytes = readFileSync(join(det, "simrun.json"), "utf8"), recMtime = statSync(join(det, "simrun.json")).mtimeMs;
  await sleep(1100);
  const again = simrun(["wait", det]);
  check("a second wait reports the same and collects nothing twice (simrun.json untouched, one history record)", again.rc === 0 && again.last === r.last
    && readFileSync(join(det, "simrun.json"), "utf8") === recBytes && statSync(join(det, "simrun.json")).mtimeMs === recMtime
    && JSON.stringify(readdirSync(join(det, ".simrun", "history"))) === JSON.stringify([`${s.job}.json`]), again.out);

  // start + wait is the normal shape for a long job, and on a local host the directory is the
  // caller's. What the caller writes between the program's end and the wait is not the job's.
  const aw = jobDir("afterwards");
  simrun(["start", aw, "--software", "calc", "--", "py", "sim.py", "sleep", "0.3"]);
  await until(() => st(simrun(["status", aw])).state === "exited", 8000);
  writeFileSync(join(aw, "analysis_notes.txt"), "written by the caller after the job ended\n");
  writeFileSync(join(aw, "input.txt"), "43\n");
  writeFileSync(join(aw, "done.txt"), "edited by the caller\n");
  r = simrun(["wait", aw]);
  rec = existsSync(join(aw, "simrun.json")) ? readJson(join(aw, "simrun.json")) : {};
  check("files the caller wrote after the program ended are not outputs (a new file, a rewritten input)", r.rc === 0 && JSON.stringify(rec.outputs?.map((o: any) => o.path)) === JSON.stringify(["pid.txt"]), JSON.stringify(rec.outputs));
  check("…and an output the caller rewrote is dropped from the list and named (its bytes are no longer the job's)", r.out.includes("simrun: 1 file(s) the job wrote were changed or removed after it ended and are not listed as outputs: done.txt"), r.out);

  // Luxas hands a foreground call back after 90 s while it keeps running; an agent that types
  // the same start again must not get a second program in the directory.
  const twice: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = jobDir(`twice-${i}`), marks = join(T, `stamps-twice-${i}.txt`);
    const pair = await Promise.all(["A", "B"].map((n) => simrunAsync(["start", d, "--software", "calc", "--", "py", "sim.py", "stamp", marks, n, "0.4"])));
    const won = pair.filter((x) => x.rc === 0 && st(x).state === "running"), lost = pair.filter((x) => x.rc === 4 && /another simrun call .* is starting a job in|is still active in/.test(x.out));
    const done = simrun(["wait", d, "--timeout", "30"]);
    await sleep(500);      // a second program, had one started, has written its start mark by now
    const begun = existsSync(marks) ? readFileSync(marks, "utf8").split("\n").filter((l) => l.startsWith("S ")).length : 0;
    if (!(won.length === 1 && lost.length === 1 && begun === 1 && done.rc === 0 && !existsSync(join(d, ".simrun", "starting"))))
      twice.push(`round ${i}: started=${won.length} refused=${lost.length} programs=${begun} wait=${done.rc} ${pair.map((x) => x.last).join(" / ")}`);
  }
  check("two starts typed at once in one directory: one program runs, the other call is refused with exit 4, no claim file is left (6 rounds: one round catches a missing claim about half the time)", twice.length === 0, twice.join(" ⏎ "));

  // A wait the caller left running (Luxas hands a foreground call back after 90 s while it keeps running), then
  // `simrun cancel d` and `simrun start d ...`. A waiting call holds no claim while it is inside its host wait; it
  // came back after the directory had moved on, wrote the first job's record over the second's, and the directory
  // then accepted a third start beside a running job. Forced, not raced: the waiting call is the runner loaded as a
  // module with its one host call wrapped, so it says when it is inside the host wait and is stopped there.
  const moved = jobDir("moved-on");
  const first = st(simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "sleep", "30"]));
  const waiter = spawn(PY, ["-B", "-c", RUNNER_AS_M + `real = m.host_dispatch
def announced(wd, verb, jid, args):
    if verb == "wait":
        sys.stderr.write("IN-HOST-WAIT\\n")
        sys.stderr.flush()
    return real(wd, verb, jid, args)
m.host_dispatch = announced
sys.exit(m.main(["simrun", "wait", sys.argv[1], "--timeout", "60"]))
`, moved], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let waiterOut = "";
  waiter.stdout.on("data", (b) => (waiterOut += b)); waiter.stderr.on("data", (b) => (waiterOut += b));
  const waiterRc = new Promise<number | null>((resolve) => waiter.on("close", resolve));
  const inHostWait = await until(() => waiterOut.includes("IN-HOST-WAIT"), 10_000);
  process.kill(waiter.pid ?? 0, "SIGSTOP");
  r = simrun(["cancel", moved]);
  const second = st(simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "sleep", "30"]));
  process.kill(waiter.pid ?? 0, "SIGCONT");
  const movedRc = await waiterRc;
  const movedJob = existsSync(join(moved, ".simrun", "job.json")) ? readJson(join(moved, ".simrun", "job.json")) : {};
  check("a wait that comes back after its job was collected and the next one started leaves job.json to the next job",
    inHostWait && r.rc === 0 && st(r).state === "cancelled" && second.state === "running" && second.job !== first.job && movedJob.job === second.job && movedJob.final === null, `first ${first.job} second ${second.job} job.json ${JSON.stringify(movedJob)}`);
  const movedLine = (waiterOut.trimEnd().split("\n").pop() ?? "").match(LINE);
  check("…it reports the job it waited for (cancelled, exit 1) from that job's history record, and names the job the directory holds now",
    movedRc === 1 && movedLine?.[1] === "cancelled" && movedLine?.[5] === first.job && waiterOut.includes(`was collected by another call and its record is ${join(moved, ".simrun", "history", `${first.job}.json`)}`)
    && waiterOut.includes(`the job of ${moved} is now ${second.job}`) && !waiterOut.includes("are listed in"), waiterOut);
  check("…status follows the running job, and a further start is still refused while it runs",
    st(simrun(["status", moved])).job === second.job && (r = simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "calc"])).rc === 4 && r.out.includes(`job ${second.job} is still active in ${moved}`), r.out);
  simrun(["cancel", "--host", "here", "--job", second.job]);      // by id: the directory's record is what was under test

  // The same rule when the directory holds no job record at all: the job is in the history (another call collected
  // it) and job.json is gone, which is what a start that the host refused leaves behind. Asked of finalize() directly:
  // collecting again here would pull the job's files a second time and write its record back as the directory's job.
  const histOnly = jobDir("history-only"), histId = "20261009T000000Z-0123abcd";
  mkdirSync(join(histOnly, ".simrun", "history"), { recursive: true });
  writeFileSync(join(histOnly, ".simrun", "history", `${histId}.json`), JSON.stringify({ job: histId, host: "here", software: "calc", state: "cancelled", exit: null, reason: null, outputs: [] }));
  const lateCall = withRunner(`d, jid = sys.argv[1], sys.argv[2]
v = m.finalize(d, {"job": jid, "host": "here", "software": "calc", "command": ["py"], "final": None}, m.operator_hosts()["here"], {"state": "exited", "exit": 0, "elapsed": 1, "tail": []}, 0)
print(json.dumps({"state": v.get("state"), "notes": v.get("notes"), "job_json": os.path.exists(m.job_file(d)), "record": os.path.exists(os.path.join(d, "simrun.json")), "claim": os.path.exists(os.path.join(d, ".simrun", "collecting"))}))
`, [histOnly, histId]);
  const lateView = parsed(lateCall.stdout);
  check("a call that finds its job in the history and no job record in the directory writes nothing and pulls nothing: it reports the recorded state and says the directory holds no job now",
    lateView.state === "cancelled" && lateView.job_json === false && lateView.record === false && lateView.claim === false && lateView.notes?.length === 1
    && lateView.notes[0].includes(`was collected by another call and its record is ${join(histOnly, ".simrun", "history", `${histId}.json`)}`) && lateView.notes[0].includes(`${histOnly} holds no job record now`), lateCall.stdout + lateCall.stderr);

  // A wait whose job has ended while another call holds the directory's claim. It waited for the claim without a limit
  // and printed nothing; a fetch holds that claim for its whole transfer. The gate holds it here, with its own pid.
  const behind = jobDir("behind-a-claim");
  const jBehind = st(simrun(["start", behind, "--software", "calc", "--", "py", "sim.py", "calc"])).job;
  await until(() => st(simrun(["status", behind])).state === "exited", 8000);
  writeFileSync(join(behind, ".simrun", "collecting"), String(process.pid));
  r = simrun(["wait", behind, "--timeout", "2"]);
  check("a wait whose job has ended while another call holds the directory's claim comes back at its --timeout: exit 3, the host's state, who holds the directory, and next=",
    r.rc === 3 && r.ms < 10_000 && st(r).state === "exited" && st(r).exit === "0" && st(r).job === jBehind && r.last.endsWith(` next="simrun wait ${behind}"`)
    && r.out.includes(`simrun: job ${jBehind} has ended on the host and is not collected into ${behind} yet (no simrun.json for it): another simrun call (pid ${process.pid}) is collecting or fetching in this directory`), `rc=${r.rc} ${r.ms}ms ${r.out}`);
  check("…it collected nothing and left the other call's claim alone", !existsSync(join(behind, "simrun.json")) && readJson(join(behind, ".simrun", "job.json")).final === null
    && existsSync(join(behind, ".simrun", "collecting")) && readFileSync(join(behind, ".simrun", "collecting"), "utf8") === String(process.pid));
  r = simrun(["status", behind]);
  check("status of that job says it has ended and is not collected yet, and names the wait", r.rc === 0 && st(r).state === "exited" && r.out.includes(`simrun: job ${jBehind} has ended on the host and is not collected into ${behind} yet: simrun wait ${behind}\n`), r.out);
  rmSync(join(behind, ".simrun", "collecting"), { force: true });
  r = simrun(["wait", behind]);
  check("…and the wait typed next collects the job: exit 0, simrun.json is written", r.rc === 0 && st(r).state === "exited" && st(r).job === jBehind && existsSync(join(behind, "simrun.json")), r.out);
  // cancel has no --timeout: it gives the claim the default wait time. Here that time is set to 1 s in the loaded module.
  const heldCancel = jobDir("cancel-behind-a-claim");
  const jc = st(simrun(["start", heldCancel, "--software", "calc", "--", "py", "sim.py", "sleep", "30"])).job;
  await until(() => existsSync(join(heldCancel, "pid.txt")) && readFileSync(join(heldCancel, "pid.txt"), "utf8") !== "", 8000);
  const cPid = existsSync(join(heldCancel, "pid.txt")) ? parseInt(readFileSync(join(heldCancel, "pid.txt"), "utf8"), 10) : 0;
  writeFileSync(join(heldCancel, ".simrun", "collecting"), String(process.pid));
  const cancelled = withRunner(`m.WAIT_S = 1
sys.exit(m.main(["simrun", "cancel", sys.argv[1]]))
`, [heldCancel]);
  const cancelLast = cancelled.stdout.trimEnd().split("\n").pop() ?? "";
  check("a cancel in that situation stops the job, says it is not collected yet and who holds the directory, and exits 0 with next=",
    cancelled.status === 0 && cPid > 0 && !pidAlive(cPid) && cancelLast.match(LINE)?.[1] === "cancelled" && cancelLast.endsWith(` next="simrun wait ${heldCancel}"`)
    && cancelled.stdout.includes(`simrun: job ${jc} has ended on the host and is not collected into ${heldCancel} yet (no simrun.json for it): another simrun call (pid ${process.pid}) is collecting or fetching in this directory`)
    && readJson(join(heldCancel, ".simrun", "job.json")).final === null && !existsSync(join(heldCancel, "simrun.json")), `rc=${cancelled.status} ${cancelled.stdout}${cancelled.stderr}`);
  rmSync(join(heldCancel, ".simrun", "collecting"), { force: true });
  r = simrun(["wait", heldCancel]);
  check("…and the wait typed next records the cancelled job (exit 1)", r.rc === 1 && st(r).state === "cancelled" && st(r).job === jc && readJson(join(heldCancel, "simrun.json")).state === "cancelled", r.out);

  // Since the fourth review. A call that gives up on the claim said one sentence of every job: "has ended on the host,
  // and its results are not in <dir> yet". It said so of a job whose supervisor is gone (the program may still run and
  // hold its seat), and of a job that another call had collected long ago in a directory that is on its next job, with
  // next= pointing at that job's wait. Asked of finalize() directly; the gate's own pid holds the claim throughout.
  const gaveUp = join(T, "gave-up");
  mkdirSync(gaveUp);
  const otherJob = "20261009T000001Z-89abcdef";
  const gaveUpRun = withRunner(`root, holder, jid, other = sys.argv[1], sys.argv[2], "20261009T000000Z-0123abcd", sys.argv[3]
host, out = m.operator_hosts()["here"], []
def case(name, st, job_json, hist):
    d = os.path.join(root, name)
    os.makedirs(os.path.join(d, ".simrun", "history"))
    if job_json is not None:
        json.dump(job_json, open(m.job_file(d), "w"))
    if hist is not None:
        json.dump(hist, open(os.path.join(d, ".simrun", "history", jid + ".json"), "w"))
    open(os.path.join(d, ".simrun", "collecting"), "w").write(holder)
    before = sorted((p, open(os.path.join(b, p)).read()) for b, _, fs in os.walk(d) for p in fs)
    began = time.time()
    v = m.finalize(d, {"job": jid, "host": "here", "software": "calc", "command": ["py"], "final": None}, host, dict(st, elapsed=1, tail=[]), 0, 0)
    out.append({"name": name, "state": v.get("state"), "uncollected": bool(v.get("uncollected")), "notes": v.get("notes") or [], "seconds": time.time() - began,
                "untouched": before == sorted((p, open(os.path.join(b, p)).read()) for b, _, fs in os.walk(d) for p in fs)})
mine = {"job": jid, "host": "here", "software": "calc", "command": ["py"], "final": None}
case("ended", {"state": "exited", "exit": 0}, mine, None)
case("unwatched", {"state": "lost", "exit": None, "reason": "supervisor_gone"}, mine, None)
case("unanswered", {"state": "cancelled", "exit": None, "reason": "no_supervisor_answered_and_no_pid_was_killed"}, mine, None)
case("never-ran", {"state": "lost", "exit": None, "reason": "spawn_refused"}, mine, None)
case("no-record-at-all", {"state": "exited", "exit": 0}, None, None)
case("moved-on", {"state": "exited", "exit": 0}, dict(mine, job=other), {"job": jid, "state": "cancelled", "exit": None, "reason": None, "outputs": []})
case("history-only", {"state": "exited", "exit": 0}, None, {"job": jid, "state": "cancelled", "exit": None, "reason": None, "outputs": []})
case("collected", {"state": "exited", "exit": 0}, dict(mine, final={"state": "exited", "exit": 0, "reason": None, "elapsed": 2, "tail": [], "notes": [], "outputs": 1, "left": 0}), None)
print(json.dumps(out))
`, [gaveUp, String(process.pid), otherJob]);
  const gave: Record<string, { state: string; uncollected: boolean; notes: string[]; seconds: number; untouched: boolean }> = Object.fromEntries((Array.isArray(parsed(gaveUpRun.stdout)) ? parsed(gaveUpRun.stdout) : []).map((c: any) => [c.name, c]));
  const tailOf = (name: string) => ` and is not collected into ${join(gaveUp, name)} yet (no simrun.json for it): another simrun call (pid ${process.pid}) is collecting or fetching in this directory`;
  const mineId = "20261009T000000Z-0123abcd";
  check("a call that gives up on the claim says what the host said of the job: ended; no longer watched (its program may still be running) for both reasons simrun records for that; lost",
    gave.ended?.notes[0] === `job ${mineId} has ended on the host${tailOf("ended")}`
    && gave.unwatched?.notes[0] === `job ${mineId} is no longer watched on the host (the program it started may still be running there)${tailOf("unwatched")}`
    && gave.unanswered?.notes[0] === `job ${mineId} is no longer watched on the host (the program it started may still be running there)${tailOf("unanswered")}`
    && gave["never-ran"]?.notes[0] === `job ${mineId} is lost on the host${tailOf("never-ran")}`
    && gave["no-record-at-all"]?.notes[0] === `job ${mineId} has ended on the host${tailOf("no-record-at-all")}`
    && ["ended", "unwatched", "unanswered", "never-ran", "no-record-at-all"].every((n) => gave[n].uncollected && gave[n].notes.length === 1), gaveUpRun.stdout + gaveUpRun.stderr);
  check("…a job the directory's records already settle is reported from them and not as uncollected: collected by another call while the directory went on to the next job, or left no job record, or is this directory's finished job",
    gave["moved-on"]?.uncollected === false && gave["moved-on"].state === "cancelled" && gave["moved-on"].notes.length === 1
    && gave["moved-on"].notes[0].includes(`was collected by another call and its record is ${join(gaveUp, "moved-on", ".simrun", "history", `${mineId}.json`)}`) && gave["moved-on"].notes[0].includes(`the job of ${join(gaveUp, "moved-on")} is now ${otherJob}`)
    && gave["history-only"]?.uncollected === false && gave["history-only"].state === "cancelled" && gave["history-only"].notes[0].includes(`${join(gaveUp, "history-only")} holds no job record now`)
    && gave.collected?.uncollected === false && gave.collected.state === "exited" && gave.collected.notes.length === 0, gaveUpRun.stdout + gaveUpRun.stderr);
  check("…and none of these calls waited, wrote a record, or touched the other call's claim", Object.keys(gave).length === 8 && Object.values(gave).every((c) => c.untouched && c.seconds < 5), gaveUpRun.stdout + gaveUpRun.stderr);
  // The claim gets what is LEFT of --timeout. Asked of the loaded module, not of a clock: its host call is wrapped so
  // that the host wait has taken 1.5 s at least on any machine, and the patience handed to the claim is read off.
  const partWay = jobDir("part-way");
  simrun(["start", partWay, "--software", "calc", "--", "py", "sim.py", "calc"]);
  const given = withRunner(`real_call, real_claim, seen = m.call, m.claim_within, []
def slow(host, verb, *rest, **more):
    began = time.time()
    v = real_call(host, verb, *rest, **more)
    if verb == "wait":
        time.sleep(max(0.0, 1.5 - (time.time() - began)))
    return v
def seeing(d, name, patience):
    seen.append(patience)
    return real_claim(d, name, patience)
m.call, m.claim_within = slow, seeing
rc = m.main(["simrun", "wait", sys.argv[1], "--timeout", "60"])
sys.stderr.write("PATIENCE " + json.dumps(seen) + "\\n")
sys.exit(rc)
`, [partWay]);
  const patience = parsed((given.stderr.match(/^PATIENCE (.*)$/m) ?? [])[1] ?? "null");
  check("the claim is given what is left of --timeout once the host wait is over, not the whole of it a second time",
    given.status === 0 && Array.isArray(patience) && patience.length === 1 && typeof patience[0] === "number" && patience[0] > 0 && patience[0] <= 58.5, `rc=${given.status} patience=${JSON.stringify(patience)} ${given.stderr}`);
  // cancel of a job that had ended on its own. What it says of the results depends on whether this call collected
  // them, and on whether there are any to collect: results come back from a job that exited 0 and from no other.
  const endedHeld = jobDir("ended-on-its-own");
  const je = st(simrun(["start", endedHeld, "--software", "calc", "--", "py", "sim.py", "calc"])).job;
  await until(() => st(simrun(["status", endedHeld])).state === "exited", 8000);
  writeFileSync(join(endedHeld, ".simrun", "collecting"), String(process.pid));
  const endedCancel = withRunner(`m.WAIT_S = 1
sys.exit(m.main(["simrun", "cancel", sys.argv[1]]))
`, [endedHeld]);
  check("a cancel of a job that had ended on its own, behind a held claim, does not say that its results are collected",
    endedCancel.status === 0 && je !== "" && endedCancel.stdout.includes(`simrun: job ${je} had already ended on its own (exited)\n`) && !endedCancel.stdout.includes("collected instead")
    && (endedCancel.stdout.trimEnd().split("\n").pop() ?? "").endsWith(` next="simrun wait ${endedHeld}"`) && !existsSync(join(endedHeld, "simrun.json")), `rc=${endedCancel.status} ${endedCancel.stdout}${endedCancel.stderr}`);
  rmSync(join(endedHeld, ".simrun", "collecting"), { force: true });
  r = simrun(["cancel", endedHeld]);
  check("…and says so when it has collected them", r.rc === 0 && r.out.includes(`simrun: job ${je} had already ended on its own (exited); its results are collected instead\n`) && existsSync(join(endedHeld, "simrun.json")), r.out);
  const endedBadly = jobDir("ended-badly");
  const jbad = st(simrun(["start", endedBadly, "--software", "calc", "--", "py", "sim.py", "exit3"])).job;
  await until(() => st(simrun(["status", endedBadly])).state === "exited", 8000);
  r = simrun(["cancel", endedBadly]);
  check("a cancel of a job that had ended on its own with exit 3 says it is recorded and nothing is collected (it said \"its results are collected instead\", above a record that lists no output)",
    r.rc === 0 && jbad !== "" && st(r).state === "exited" && st(r).exit === "3" && r.out.includes(`simrun: job ${jbad} had already ended on its own (exited); it is recorded instead, and nothing is collected from a job that did not end well\n`)
    && !r.out.includes("its results are collected") && JSON.stringify(readJson(join(endedBadly, "simrun.json")).outputs) === "[]", r.out);
  // A local host needs no doctor record, so a job there does not read doctor.json. It did for one round: with a
  // doctor.json that could not be opened, every local job ended in exit 5.
  const stateNoBook = join(T, "state-doctor-is-a-directory");
  mkdirSync(join(stateNoBook, "doctor.json"), { recursive: true });
  const noBook = jobDir("local-needs-no-record");
  r = simrun(["run", noBook, "--software", "calc", "--", "py", "sim.py", "calc"], { SIMRUN_STATE_DIR: stateNoBook });
  check("a job on a local host runs with a doctor.json that cannot be opened (a local host needs no record, so none is read for it)", r.rc === 0 && st(r).state === "exited" && existsSync(join(noBook, "result.txt")), `rc=${r.rc} ${r.out}`);

  const nursery = jobDir("nursery");
  r = simrun(["run", nursery, "--software", "calc", "--", "py", "sim.py", "spawn"]);
  check("a launcher that exits while a process it started still runs: the job is exited 0, and the call says what that does not cover", r.rc === 0 && st(r).state === "exited"
    && r.out.includes(`simrun: the launcher of job ${st(r).job} exited while processes it started were still running on host "here"`), r.out);
  check("…and a plain job gets no such note", !simrun(["wait", det]).out.includes("the launcher of job"));

  // Luxas ends a bash call by signalling its process group (SIGTERM, then SIGKILL; at 30 minutes
  // for a tracked job). A supervisor that only outlived its parent would pass every check above.
  const grp = jobDir("group-kill");
  const starter = spawn(PY, [SIMRUN, "start", grp, "--software", "calc", "--", "py", "sim.py", "sleep", "3"], { env: ENV, detached: true, stdio: "ignore" });
  await new Promise((resolve) => starter.on("close", resolve));
  try { process.kill(-(starter.pid ?? 0), "SIGKILL"); } catch { /* the group is already empty: nothing of the job stayed in it */ }
  await until(() => existsSync(join(grp, "pid.txt")) && readFileSync(join(grp, "pid.txt"), "utf8") !== "", 8000);
  const grpPid = existsSync(join(grp, "pid.txt")) ? parseInt(readFileSync(join(grp, "pid.txt"), "utf8"), 10) : 0;
  check("killing the caller's whole process group right after start does not reach the job", grpPid > 0 && pidAlive(grpPid), `pid ${grpPid}`);
  r = simrun(["wait", grp, "--timeout", "30"]);
  check("…and the job runs to its end", r.rc === 0 && st(r).state === "exited" && existsSync(join(grp, "done.txt")), r.out);

  console.log("7. a short --timeout hands the call back, and the job goes on");
  const six = jobDir("six");
  r = simrun(["run", six, "--software", "calc", "--timeout", "1", "--", "py", "sim.py", "sleep", "6"]);
  s = st(r);
  check('run --timeout 1 on a 6 s job exits 3 and ends with next="simrun wait <dir>"', r.rc === 3 && s.state === "running" && r.last.endsWith(` next="simrun wait ${six}"`) && r.ms < 4000, `${r.ms}ms ${r.out}`);
  check("nothing was collected yet", !existsSync(join(six, "simrun.json")));
  r = simrun(["wait", six, "--timeout", "30"]);
  check("the following wait exits 0", r.rc === 0 && st(r).state === "exited" && st(r).job === s.job && readJson(join(six, "simrun.json")).outputs.length === 2, r.out);

  console.log("8. seats: one at a time when the operator says so");
  const stamps = join(T, "stamps-seat.txt");
  const sa = jobDir("seat-a"), sb = jobDir("seat-b");
  const ja = st(simrun(["start", sa, "--software", "seat1", "--", "py", "sim.py", "stamp", stamps, "A", "4"])).job;
  r = simrun(["start", sb, "--software", "seat1", "--", "py", "sim.py", "stamp", stamps, "B", "0.3"]);
  const jb = st(r).job;
  let waiting = { state: "", rest: "" };
  await until(() => { const x = st(simrun(["status", sb])); waiting = x; return x.rest !== "" || x.state !== "waiting_seat"; }, 4000);
  check("a second job started while the first runs is waiting_seat and names the holder", ja !== "" && jb !== "" && waiting.state === "waiting_seat" && waiting.rest === ` reason=seat_held_by:${ja}`, JSON.stringify(waiting));
  const owner = readJson(join(HOSTWD, "locks", "seat1", "seat-1", "owner.json"));
  check("the seat is a directory with owner.json {job, pid, prog, started, beat, deadline, boot}, held by a live process", owner.job === ja && pidAlive(owner.pid)
    && JSON.stringify(Object.keys(owner).sort()) === JSON.stringify(["beat", "boot", "deadline", "job", "pid", "prog", "started"]), JSON.stringify(owner));
  check("…and prog is the pid of the program itself (the one that holds the real licence), not of its supervisor", owner.prog !== owner.pid && String(owner.prog) === readFileSync(join(sa, "pid.txt"), "utf8"), JSON.stringify(owner));
  // On a local host the directory is the caller's, and a job may wait minutes for its seat.
  writeFileSync(join(sb, "while_waiting.txt"), "written by the caller while the job waited for its seat\n");
  const ra = simrun(["wait", sa, "--timeout", "30"]), rb = simrun(["wait", sb, "--timeout", "30"]);
  const order = readFileSync(stamps, "utf8").trim().split("\n").map((l) => l.split(" "));
  check("both ran to the end", ra.rc === 0 && rb.rc === 0, ra.out + rb.out);
  check("a file the caller wrote while the job waited for its seat is not an output of the job (the \"before\" picture is taken when the program starts)",
    JSON.stringify(readJson(join(sb, "simrun.json")).outputs.map((o: any) => o.path)) === JSON.stringify(["pid.txt"]), JSON.stringify(readJson(join(sb, "simrun.json")).outputs));
  check("the two never overlapped: A ended before B started (timestamps the jobs wrote)", order.map((o) => o[0] + o[1]).join(" ") === "SA EA SB EB" && parseFloat(order[1][2]) <= parseFloat(order[2][2]), JSON.stringify(order));
  const free = join(T, "stamps-free.txt");
  const fa = jobDir("free-a"), fb = jobDir("free-b");
  simrun(["start", fa, "--software", "calc", "--", "py", "sim.py", "stamp", free, "A", "2.5"]);
  simrun(["start", fb, "--software", "calc", "--", "py", "sim.py", "stamp", free, "B", "2.5"]);
  simrun(["wait", fa, "--timeout", "30"]); simrun(["wait", fb, "--timeout", "30"]);
  const fo = readFileSync(free, "utf8").trim().split("\n").map((l) => l.split(" "));
  check("with no seats key two jobs do overlap (the lock above is what kept them apart)", fo.length === 4 && fo[0][0] === "S" && fo[1][0] === "S", JSON.stringify(fo));

  console.log("9. a held seat: the wait gives up, cancel frees it");
  const holder = jobDir("holder"), late = jobDir("late");
  const jh = st(simrun(["start", holder, "--software", "seat1", "--", "py", "sim.py", "sleep", "60"])).job;
  await until(() => existsSync(join(holder, "pid.txt")) && readFileSync(join(holder, "pid.txt"), "utf8") !== "", 8000);
  const holderPid = parseInt(readFileSync(join(holder, "pid.txt"), "utf8"), 10);
  r = simrun(["run", late, "--software", "seat1", "--seat-wait-minutes", "0.03", "--", "py", "sim.py", "calc"]);
  check("with the seat held by a live job, --seat-wait-minutes 0.03 ends state=timeout reason=no_seat and the program never ran", r.rc === 1 && st(r).state === "timeout" && st(r).rest === " reason=no_seat" && !existsSync(join(late, "pid.txt")), r.out);
  const lateFirst = st(r).job;
  const ps = simrun(["ps"]);
  const row = (id: string) => ps.out.split("\n").find((l) => l.split(/\s+/)[1] === id) ?? "";      // by the job column: a waiter's row names its holder too
  check("ps lists the jobs with their states (running holder, timed-out waiter, the first job exited)", ps.rc === 0 && /\bseat1\s+running\b/.test(row(jh)) && /\bseat1\s+timeout\b/.test(row(lateFirst)) && /\bcalc\s+exited\b/.test(row(firstJob)), ps.out);
  r = simrun(["cancel", holder]);
  check("cancel <dir>: state=cancelled, exit 0", r.rc === 0 && st(r).state === "cancelled" && st(r).job === jh, r.out);
  check("…the job's process is gone and the seat directory with it", holderPid > 0 && !pidAlive(holderPid) && !existsSync(join(HOSTWD, "locks", "seat1", "seat-1")), `pid ${holderPid}`);
  check("…and simrun.json records it with no outputs", readJson(join(holder, "simrun.json")).state === "cancelled" && readJson(join(holder, "simrun.json")).outputs.length === 0);
  r = simrun(["run", late, "--software", "seat1", "--seat-wait-minutes", "0.03", "--", "py", "sim.py", "calc"]);
  check("the seat is free for the next job", r.rc === 0 && st(r).state === "exited", r.out);
  check("history keeps one record per job in a directory", lateFirst !== st(r).job
    && JSON.stringify(readdirSync(join(late, ".simrun", "history")).sort()) === JSON.stringify([`${lateFirst}.json`, `${st(r).job}.json`].sort()), readdirSync(join(late, ".simrun", "history")).join(","));
  const byId = jobDir("by-id");
  const ji = st(simrun(["start", byId, "--software", "seat1", "--", "py", "sim.py", "sleep", "60"])).job;
  await until(() => existsSync(join(byId, "pid.txt")) && readFileSync(join(byId, "pid.txt"), "utf8") !== "", 8000);
  const byIdPid = parseInt(readFileSync(join(byId, "pid.txt"), "utf8"), 10);
  r = simrun(["cancel", "--host", "here", "--job", ji]);
  check("cancel --host --job: exit 0, the process is gone, the seat is free", r.rc === 0 && r.out.includes(`job ${ji} on host "here" is cancelled`) && byIdPid > 0 && !pidAlive(byIdPid) && !existsSync(join(HOSTWD, "locks", "seat1", "seat-1")), r.out);
  r = simrun(["wait", byId]);
  check("…and a wait in its directory reports cancelled, exit 1", r.rc === 1 && st(r).state === "cancelled" && st(r).job === ji, r.out);
  r = simrun(["cancel", "--host", "here", "--job", "not-a-job-id"]);
  check("cancel with a malformed job id is refused", r.rc === 4, r.out);

  console.log("10. a stale seat is broken; a silent one is not");
  const seatDir = join(HOSTWD, "locks", "seat1", "seat-1");
  const dead = spawnSync(PY, ["-c", "pass"]).pid ?? 0;       // has exited and been reaped: nobody has this pid
  const now = () => Date.now() / 1000;
  const ghost = "20260101T000000Z-0badc0de";
  const plant = (o: { pid: number; beat: number; deadline: number; boot: number }) => {
    rmSync(seatDir, { recursive: true, force: true });
    mkdirSync(seatDir, { recursive: true });
    writeFileSync(join(seatDir, "owner.json"), JSON.stringify({ job: ghost, started: now() - 300, ...o }));
  };
  const stale = jobDir("stale");
  const tryRun = () => simrun(["run", stale, "--software", "seat1", "--seat-wait-minutes", "0.03", "--", "py", "sim.py", "calc"]);
  const ghostHolds = () => existsSync(join(seatDir, "owner.json")) && readJson(join(seatDir, "owner.json")).job === ghost;
  check("the planted owner's pid is dead and the gate's own is alive (the two halves of the fixture)", dead > 0 && !pidAlive(dead) && pidAlive(process.pid));
  plant({ pid: dead, beat: now() - 200, deadline: now() + 600, boot: owner.boot });
  r = tryRun();
  check("dead pid, beat back-dated by 200 s: the seat is broken and taken", r.rc === 0 && st(r).state === "exited" && !ghostHolds(), r.out);
  plant({ pid: dead, beat: now(), deadline: now() + 600, boot: owner.boot });
  r = tryRun();
  check("dead pid but a fresh beat: not yet (the wait gives up, the seat still belongs to the ghost)", r.rc === 1 && st(r).rest === " reason=no_seat" && ghostHolds(), r.out);
  plant({ pid: process.pid, beat: now() - 200, deadline: now() + 600, boot: owner.boot });
  r = tryRun();
  check("live pid, silent for 200 s, deadline not reached: not broken (silence alone does not kill a seat)", r.rc === 1 && st(r).rest === " reason=no_seat" && ghostHolds(), r.out);
  plant({ pid: process.pid, beat: now() - 200, deadline: now() - 100, boot: owner.boot });
  r = tryRun();
  check("live pid, silent for 200 s, 100 s past its own deadline: broken (a hung owner cannot keep the licence)", r.rc === 0 && !ghostHolds(), r.out);
  plant({ pid: process.pid, beat: now(), deadline: now() + 600, boot: owner.boot - 3600 });
  r = tryRun();
  check("a boot time one hour off the host's: broken at once, fresh beat and live pid notwithstanding", r.rc === 0 && st(r).state === "exited" && !ghostHolds(), r.out);
  check("no seat is left behind", !existsSync(seatDir), existsSync(join(HOSTWD, "locks", "seat1")) ? readdirSync(join(HOSTWD, "locks", "seat1")).join(",") : "");

  // A start on the host prunes empty locks/doctor-* directories. When that fell between doctor's two one-seat
  // jobs, the one still waiting lost its lock directory, died with FileNotFoundError, and doctor reported the
  // seat lock as unproven. Here the supervisor is run in-process and the directory is removed before its first try.
  const lostLock = withRunner(`wd, jid = sys.argv[1], "20260101T000000Z-0a0b0c0d"
os.makedirs(m.jp(wd, jid, ""))
os.makedirs(os.path.join(wd, "locks"))
m.write_atomic(m.jp(wd, jid, ".req.json"), {"job": jid, "software": "doctor-gate", "argv": ["@python", "-c", "print(6 * 7)"], "command": ["python"], "max_s": 30,
                                            "seat_wait_s": 10, "seats": 1, "fail_patterns": [], "beat_s": 1, "stale_s": 90})
m.write_atomic(m.jp(wd, jid, ".status.json"), {"job": jid, "software": "doctor-gate", "state": "waiting_seat", "created": time.time()})
real, tries = m.take_seat, []
def once_removed(lockdir, *rest):
    tries.append(1)
    if len(tries) == 1:
        os.rmdir(lockdir)          # what prune does to an empty locks/doctor-* directory
    return real(lockdir, *rest)
m.take_seat = once_removed
m.supervise(wd, jid)
st = m.read_json(m.jp(wd, jid, ".status.json"))
print(json.dumps({"state": st.get("state"), "exit": st.get("exit"), "reason": st.get("reason"), "tries": len(tries), "left": os.listdir(os.path.join(wd, "locks", "doctor-gate"))}))
`, [join(T, "lost-lock")]);
  check("a supervisor whose lock directory is removed while it waits for a seat makes it again and runs its job (it used to end lost with FileNotFoundError)",
    JSON.stringify(parsed(lostLock.stdout.trim().split("\n").pop() ?? "")) === JSON.stringify({ state: "exited", exit: 0, reason: null, tries: 2, left: [] }), lostLock.stdout + lostLock.stderr);

  // Several waiters judge the same dead owner at the same moment. Breaking it must be decided
  // again under a guard, or the second breaker removes the seat the first has just taken and
  // two programs run on a one-seat licence. A round catches that only part of the time, so three.
  const raced: string[] = [];
  for (let round = 0; round < 3; round++) {
    const marks = join(T, `stamps-race-${round}.txt`);
    plant({ pid: dead, beat: now() - 200, deadline: now() + 600, boot: owner.boot });
    const dirs = [0, 1, 2, 3, 4, 5].map((i) => jobDir(`race-${round}-${i}`));
    await Promise.all(dirs.map((d, i) => simrunAsync(["start", d, "--software", "seat1", "--", "py", "sim.py", "stamp", marks, String(i), "0.3"])));
    const ends = dirs.map((d) => simrun(["wait", d, "--timeout", "40"]));
    const seq = existsSync(marks) ? readFileSync(marks, "utf8").trim().split("\n").map((l) => l.split(" ")) : [];
    const serial = seq.length === 12 && seq.every((e, i) => e[0] === (i % 2 ? "E" : "S") && (i % 2 === 0 || e[1] === seq[i - 1][1]));
    const leftover = readdirSync(join(HOSTWD, "locks", "seat1"));
    if (!(serial && ends.every((e) => e.rc === 0 && st(e).state === "exited") && leftover.length === 0))
      raced.push(`round ${round}: marks=${seq.map((e) => e[0] + e[1]).join(" ")} ends=${ends.map((e) => `${st(e).state}${st(e).rest}`).join(",")} left=${leftover.join(",")}`);
  }
  check("six jobs started at once against one stale seat run one at a time, none is killed as seat_taken, and no seat or guard is left (3 rounds)", raced.length === 0, raced.join(" ⏎ "));

  // The other half of the lock: an owner that finds its seat is no longer its own must stop.
  const taken = jobDir("taken");
  const jt = st(simrun(["start", taken, "--software", "seat1", "--", "py", "sim.py", "sleep", "40"])).job;
  await until(() => existsSync(join(taken, "pid.txt")) && readFileSync(join(taken, "pid.txt"), "utf8") !== "" && existsSync(join(seatDir, "owner.json")), 8000);
  const takenPid = parseInt(readFileSync(join(taken, "pid.txt"), "utf8"), 10);
  // Its supervisor rewrites owner.json at every beat, so the plant is repeated until it is the one read.
  const gone = await until(() => {
    if (!pidAlive(takenPid)) return true;
    const cur = existsSync(join(seatDir, "owner.json")) ? readJson(join(seatDir, "owner.json")) : {};
    if (cur.job !== ghost) writeFileSync(join(seatDir, "owner.json"), JSON.stringify({ ...cur, job: ghost }));
    return false;
  }, 6000);
  r = simrun(["wait", taken, "--timeout", "10"]);
  check("a running job whose seat now names another job is killed within a few beats and ends lost, reason=seat_taken", jt !== "" && gone && r.rc === 1 && st(r).state === "lost" && st(r).rest === " reason=seat_taken" && !existsSync(join(taken, "done.txt")), `gone=${gone} ${r.out}`);
  check("…and it leaves the seat to the job that holds it now", ghostHolds());
  rmSync(seatDir, { recursive: true, force: true });

  console.log("11. a supervisor that dies is reported, not waited for");
  const orphan = jobDir("orphan");
  const jo = st(simrun(["start", orphan, "--software", "calc", "--", "py", "sim.py", "sleep", "60"], { SIMRUN_STALE_S: "5" })).job;
  await until(() => existsSync(join(orphan, "pid.txt")) && readFileSync(join(orphan, "pid.txt"), "utf8") !== "", 8000);
  const supPid = readJson(join(HOSTWD, "jobs", `${jo}.status.json`)).sup_pid as number;
  process.kill(supPid, "SIGKILL");
  const onDisk = () => readJson(join(HOSTWD, "jobs", `${jo}.status.json`)).state as string;
  r = simrun(["status", orphan]);
  check("right after the kill the status is still running (a beat 1 s old proves nothing yet)", st(r).state === "running" && onDisk() === "running", r.out);
  let lost = { state: "", rest: "" };
  await until(() => { lost = st(simrun(["status", orphan])); return lost.state === "lost"; }, 12_000);
  check("once the beat is older than the stale period it is reported lost, with the reason", lost.state === "lost" && lost.rest === " reason=supervisor_gone" && onDisk() === "running", JSON.stringify(lost));
  r = simrun(["wait", orphan]);
  check("wait ends with exit 1 and records lost with no outputs", r.rc === 1 && st(r).state === "lost" && readJson(join(orphan, "simrun.json")).outputs.length === 0, r.out);
  const orphanPid = parseInt(readFileSync(join(orphan, "pid.txt"), "utf8"), 10);
  check("…and says that the program may still be running and holding a seat, with its pid (nobody watches it now)", pidAlive(orphanPid) && r.out.includes(`(pid ${orphanPid} when last seen): it may still be running on host "here" and holding a licence seat`), r.out);
  if (orphanPid > 0 && pidAlive(orphanPid)) process.kill(orphanPid, "SIGKILL");      // the job outlives its supervisor by design; this gate started it

  console.log("12. a pid on record is a number, not a process");
  // After a reboot, or once the number has been reused, sup_pid names somebody else. The
  // bystander below is that somebody: a process of this gate that no job ever started.
  const STALE3 = { SIMRUN_STALE_S: "3" };
  const bystander = spawn(PY, ["-c", "import time; time.sleep(120)", T], { detached: true, stdio: "ignore" });      // T in its argv: strays() ends it if the gate does not
  bystander.unref();
  // Asked of the child handle after a turn of the event loop, not of kill(pid, 0): a killed
  // child of this gate is a zombie until Node reaps it, and a zombie still answers signal 0.
  const bystanderLives = async () => { await sleep(300); return bystander.exitCode === null && bystander.signalCode === null; };
  const orphaned = async (name: string, sw: string, extra: string[], killProgram: boolean) => {
    const d = jobDir(name);
    const id = st(simrun(["start", d, "--software", sw, ...extra, "--", "py", "sim.py", "sleep", "40"], STALE3)).job;
    await until(() => existsSync(join(d, "pid.txt")) && readFileSync(join(d, "pid.txt"), "utf8") !== "", 8000);
    const file = join(HOSTWD, "jobs", `${id}.status.json`), prog = parseInt(readFileSync(join(d, "pid.txt"), "utf8"), 10);
    await until(() => readJson(file).state === "running", 3000);
    process.kill(readJson(file).sup_pid, "SIGKILL");
    if (killProgram) process.kill(prog, "SIGKILL");
    return { d, id, file, prog, t0: Date.now() };
  };
  const reused = (file: string, more: object = {}) => writeFileSync(file, JSON.stringify({ ...readJson(file), sup_pid: bystander.pid, ...more }));
  const numA = await orphaned("pid-reused", "calc", [], true);
  const numB = await orphaned("pid-reused-overdue", "calc", ["--max-minutes", "0.03"], true);
  const held = await orphaned("seat-orphan", "seat1", [], false);
  const next = jobDir("seat-next");
  simrun(["start", next, "--software", "seat1", "--", "py", "sim.py", "calc"], STALE3);
  const bootA = readJson(numA.file).boot;
  reused(numA.file, { boot: (bootA ?? now()) - 3600 });
  r = simrun(["status", numA.d]);
  check("a status written before the last reboot is lost at once, whatever its beat and whoever has the pid now", typeof bootA === "number" && st(r).state === "lost" && st(r).rest === " reason=supervisor_gone", `boot=${bootA} ${r.out}`);
  reused(numA.file, { boot: bootA });
  reused(numB.file);
  await sleep(Math.max(0, numA.t0 + 3800 - Date.now()));
  r = simrun(["status", numA.d]);
  check("a silent job whose supervisor's pid number is in use still reads running while it could be inside its time limit (a number cannot say more)", st(r).state === "running" && await bystanderLives(), r.out);
  await sleep(Math.max(0, held.t0 + 4500 - Date.now()));      // its last beat is now older than the 3 s stale period: only the live program keeps the seat
  r = simrun(["status", next]);
  check("a seat whose supervisor was killed is not handed out while the program it started is alive (the program holds the licence, not the supervisor)", st(r).state === "waiting_seat" && st(r).rest === ` reason=seat_held_by:${held.id}` && pidAlive(held.prog) && !existsSync(join(next, "pid.txt")), r.out);
  process.kill(held.prog, "SIGKILL");
  r = simrun(["wait", next, "--timeout", "30"]);
  check("…and is, as soon as that program is gone", r.rc === 0 && st(r).state === "exited" && existsSync(join(next, "result.txt")), r.out);
  await sleep(Math.max(0, numB.t0 + 5300 - Date.now()));
  r = simrun(["wait", numB.d, "--timeout", "1"]);
  check("past its time limit and the stale period a silent job is lost, a live pid number notwithstanding (it used to read running for ever)", r.rc === 1 && st(r).state === "lost" && st(r).rest === " reason=supervisor_gone" && await bystanderLives(), r.out);
  r = simrun(["cancel", numA.d]);
  const spared = await bystanderLives();
  check("cancel of the silent job that still reads running kills no pid on record (the number is somebody else's by now) and says so", r.rc === 0 && st(r).state === "cancelled" && st(r).rest === " reason=no_supervisor_answered_and_no_pid_was_killed" && spared, `bystander alive=${spared} ${r.out}`);
  r = simrun(["status", held.d]);
  check("status of a job that is lost because its supervisor was killed does not say the job has ended: it says nothing watches it and the program may still be running",
    r.rc === 0 && st(r).state === "lost" && r.out.includes(`simrun: job ${held.id} is no longer watched on the host (the program it started may still be running there) and is not collected into ${held.d} yet: simrun wait ${held.d}\n`), r.out);
  r = simrun(["cancel", held.d]);
  check("cancel of a job that is lost (its supervisor was killed) says that it stopped nothing, not that the job ended on its own and was collected",
    r.rc === 0 && st(r).state === "lost" && r.out.includes(`simrun: job ${held.id} is lost (supervisor_gone): this cancel stopped nothing`) && !r.out.includes("had already ended on its own"), r.out);
  try { process.kill(bystander.pid ?? 0, "SIGKILL"); } catch { /* reported above */ }

  console.log("13. doctor on a local host (it ran beside the sections above)");
  const doctorRc = await doctorDone;
  const dl = doctorOut.trimEnd().split("\n");
  check("every line is an ok line or a problem line", dl.length >= 9 && dl.every((l) => l.startsWith("ok ") || l.startsWith("problem: ")), doctorOut);
  for (const what of [/^ok transport reachable \(local\)/, /^ok a job ran with the host's own Python/, /^ok a 1 MB file went to the host and its copy came back with the same sha256/, /^ok two jobs on a one-seat software did not overlap/,
    /^ok cancel ended a sleeping job and freed its seat/, /^ok software "probe": its check exited 0 and printed the expected text/, /^ok a 20 s job kept running after the command that started it had returned/])
    check(`doctor line: ${what.source.slice(1, 60)}`, dl.some((l) => what.test(l)), doctorOut);
  check("a check that exits 0 without the expected text is a problem (exit 0 proves nothing about a licence)", dl.filter((l) => l.startsWith("problem: ")).length === 2
    && dl.some((l) => /^problem: software "mute": its check ended exited exit=0 and the expected text is not in its output/.test(l)), doctorOut);
  const book = existsSync(join(STATE, "doctor.json")) ? readJson(join(STATE, "doctor.json")) : {};
  check("so doctor exits 1 and doctor.json records ok false for that host", doctorRc === 1 && book.spare?.ok === false && /did not pass doctor \(1 problem\(s\) above\)/.test(dl[dl.length - 1]), `rc=${doctorRc} ${JSON.stringify(book)}`);
  check("the record names what was proven: the host entry's fingerprint, and the software whose check passed (probe, not mute)", book.spare?.host === hostPrint({ transport: "local" }) && JSON.stringify(book.spare?.checked) === JSON.stringify(["probe"]) && book.spare?.protocol === 1, JSON.stringify(book));
  const spareWd = join(STATE, "hosts", "spare");
  check("doctor left no job and no seat behind on the host", readdirSync(join(spareWd, "jobs")).length === 0 && readdirSync(join(spareWd, "locks")).every((sw) => readdirSync(join(spareWd, "locks", sw)).length === 0), readdirSync(join(spareWd, "jobs")).join(","));

  console.log("14. output discipline");
  const all = [table.out, ps.out, simrun(["--help"]).out, simrun(["log", calc]).out, simrun(["hosts"], { LUXAS_SOFTWARE_FILE: join(T, "bad.json") }).out];
  check("no output line starts with ✗, FAIL or FAILED (the gate runner reads those as a verdict)", all.every((o) => !/^\s*(✗|FAIL)/m.test(o)));
  check("the usage text tells the caller to print the numbers in the same bash call", /Print the numbers you will report from the fetched files in the same bash call\./.test(all[2]), all[2]);
  check("run and wait return by default before Luxas hands a foreground call back at 90 s (the usage says 75)", (all[2].match(/\[--timeout 75\]/g) ?? []).length === 2 && !all[2].includes("--timeout 100"), all[2]);
  const usage = all[2].replace(/\s+/g, " ");      // the sentences, wherever the lines break
  check("the usage says whose exit codes 0, 1 and 3 are (run and wait), that 3 covers a job that ended while another call held its directory, and that status, log and cancel exit 0 when the call itself worked",
    /exit codes of run and wait: 0 the job exited 0/.test(usage) && /3 not finished here when --timeout elapsed: still waiting for a seat or running, or ended while another simrun call held the directory \(the last line ends with next=\)/.test(usage)
    && /status, log and cancel exit 0 when the call itself worked/.test(usage), all[2]);
  r = simrun(["status", exit3]);
  check("…which is what status does: exit 0 for a job that exited 3, and the state line says exit=3", r.rc === 0 && st(r).state === "exited" && st(r).exit === "3", r.out);
  check("log prints the job's lines behind a bar", all[3].trim() === "| answer = 1764.2500", all[3]);
  check("simrun wrote nothing under ~/.sisyphus (state and operator file come from the environment)", !existsSync(join(ENV.HOME, ".sisyphus")), readdirSync(ENV.HOME).join(","));
  await until(() => strays().length === 0, 3000);
  check("no job or supervisor process is left running", strays().length === 0, strays().join(","));
} catch (e: any) {
  failures++;
  console.log(`  ✗ the gate threw — ${String(e?.stack ?? e).replace(/\s*\n\s*/g, " ⏎ ").slice(0, 800)}`);
} finally {
  for (const pid of strays()) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  rmSync(T, { recursive: true, force: true });
}
console.log(failures === 0 ? `\nsmoke_simrun: all ${checks} checks passed` : `\nsmoke_simrun: ${failures} of ${checks} FAILED`);
process.exit(failures === 0 ? 0 : 1);
