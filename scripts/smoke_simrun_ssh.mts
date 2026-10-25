#!/usr/bin/env tsx
/**
 * smoke_simrun_ssh — the runner for external simulation software, over real ssh and scp.
 *
 * skills/compute-methods/scripts/simrun reaches a machine that has the software through
 * exactly one remote command line and two file copies. This gate drives that path against a
 * throwaway user-mode sshd on 127.0.0.1 with temporary keys, so the "host" is this machine
 * and every claim can be checked against the host's own workdir and the process table.
 *
 * What it proves, and why each is here:
 *   - an ssh host runs nothing until `simrun doctor` has passed on it (the Windows-only code
 *     in simrun has never run; doctor is the gate in front of it). A doctor that was interrupted,
 *     a record made under another protocol, and a label re-pointed at another machine are not a pass;
 *   - `start` returns, the ssh command is gone, and the job is still running. Windows sshd
 *     kills every child when the ssh command returns; this is the POSIX half of that proof;
 *   - every word after the target on the remote command line is from a safe charset, read
 *     from a shim that records the argv ssh was actually given, not from simrun's source;
 *     and a job record that carries an unsafe id reaches neither ssh nor scp (tried, with
 *     stand-ins that connect to nothing);
 *   - a file over the pull limit stays on the host and is listed, never silently dropped;
 *   - an archive from the other machine cannot write outside the job directory;
 *   - a dead connection is exit 5 and names ssh, and the job is still there afterwards.
 *
 * smoke_simrun.mts holds the local transport and everything that needs no connection.
 * Needs sshd, ssh, scp and python3. The gate runner skips it when sshd is not on PATH;
 * an sshd that is there and cannot start is reported as a failure, in one line.
 *
 *   npx tsx scripts/smoke_simrun_ssh.mts
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutSiteNoise } from "./python-site-noise.mts";

let failures = 0, checks = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail.replace(/\s*\n\s*/g, " ⏎ ").slice(0, 700)}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SIMRUN = join(ROOT, "skills", "compute-methods", "scripts", "simrun");
const which = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const PY = which("python3");
const SSHD = existsSync("/usr/sbin/sshd") ? "/usr/sbin/sshd" : which("sshd");      // sshd refuses to start from a relative path
const SFTP = ["/usr/libexec/sftp-server", "/usr/lib/openssh/sftp-server", "/usr/libexec/openssh/sftp-server", "/usr/lib/ssh/sftp-server"].find((p) => existsSync(p));
if (!PY || !SSHD || !SFTP || !which("ssh") || !which("scp")) {
  console.log(`smoke_simrun_ssh: cannot run: python3=${PY || "missing"} sshd=${SSHD || "missing"} sftp-server=${SFTP ?? "missing"} ssh=${which("ssh") || "missing"} scp=${which("scp") || "missing"}`);
  process.exit(1);
}

// The workdir is typed on the remote command line, so simrun accepts only a safe charset for
// it; a temp root with other characters (a user name with a space) would fail the fixture, not simrun.
const SAFE = /^[A-Za-z0-9_.:\/\\-]+$/;
const T = mkdtempSync(join(SAFE.test(tmpdir()) ? tmpdir() : "/tmp", "luxas-simrun-ssh-"));
const STATE = join(T, "state"), HOSTWD = join(T, "hostwd"), SOFTWARE = join(T, "software.json");
const SSH_LOG = join(T, "ssh-argv.jsonl"), SCP_LOG = join(T, "scp-argv.jsonl");
for (const d of [STATE, HOSTWD, join(T, "home"), join(T, "tmp")]) mkdirSync(d);
writeFileSync(SSH_LOG, ""); writeFileSync(SCP_LOG, "");
// The shims record the argv simrun really handed to ssh and scp, then become them.
const shim = (name: string, log: string, real: string) => {
  const p = join(T, name);
  writeFileSync(p, `import json, os, sys\nwith open(${JSON.stringify(log)}, "a") as f:\n    f.write(json.dumps(sys.argv[1:]) + "\\n")\nos.execvp(${JSON.stringify(real)}, [${JSON.stringify(real)}] + sys.argv[1:])\n`);
  return p;
};
const ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "", HOME: join(T, "home"), TMPDIR: join(T, "tmp"), LUXAS_SOFTWARE_FILE: SOFTWARE, SIMRUN_STATE_DIR: STATE,
  SIMRUN_SSH: `${PY} ${shim("ssh-shim.py", SSH_LOG, "ssh")} -F ${join(T, "ssh_config")}`,
  SIMRUN_SCP: `${PY} ${shim("scp-shim.py", SCP_LOG, "scp")} -F ${join(T, "ssh_config")}`,
};

// Stand-ins that write down their argv and connect to nothing: the calls that must be refused
// before any connection run with these, so a missing guard is a line in a file, not a word
// handed to a real ssh or scp.
const VOID_LOG = join(T, "void-argv.jsonl");
writeFileSync(VOID_LOG, "");
writeFileSync(join(T, "void.py"), `import json, sys\nwith open(${JSON.stringify(VOID_LOG)}, "a") as f:\n    f.write(json.dumps(sys.argv[1:]) + "\\n")\nsys.exit(97)\n`);
const VOID = { SIMRUN_SSH: `${PY} ${join(T, "void.py")}`, SIMRUN_SCP: `${PY} ${join(T, "void.py")}` };

interface Ran { rc: number | null; out: string; last: string; ms: number }
/** `runner` is simrun itself, or a copy of it that the gate has edited. */
function simrun(args: string[], env: Record<string, string> = {}, timeout = 60_000, runner = SIMRUN): Ran {
  const t0 = Date.now();
  const r = spawnSync(PY, [runner, ...args], { env: { ...ENV, ...env }, encoding: "utf8", timeout });
  const out = withoutSiteNoise((r.stdout ?? "") + (r.stderr ?? ""));
  const lines = out.trimEnd().split("\n");
  return { rc: r.status, out, last: lines[lines.length - 1] ?? "", ms: Date.now() - t0 };
}
/** The same call without blocking the gate: for two calls at the same moment. */
function simrunAsync(args: string[]): Promise<Ran> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(PY, [SIMRUN, ...args], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (out += b));
    p.on("close", (rc) => { out = withoutSiteNoise(out); const lines = out.trimEnd().split("\n"); resolve({ rc, out, last: lines[lines.length - 1] ?? "", ms: Date.now() - t0 }); });
  });
}
const LINE = /^SIMRUN state=(\S+) exit=(\S+) host=(\S+) software=(\S+) job=(\d{8}T\d{6}Z-[0-9a-f]{8}) elapsed=(\d+)s(.*)$/;
const st = (r: Ran) => { const m = r.last.match(LINE); return m ? { state: m[1], exit: m[2], host: m[3], software: m[4], job: m[5], rest: m[7] } : { state: "", exit: "", host: "", software: "", job: "", rest: "" }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** A Python prelude that loads the runner as module `m` (the file has no .py suffix): for a call that has to say
 *  where it is, so the gate can stop it there. Run with -B: no __pycache__ beside the runner. */
const RUNNER_AS_M = `import importlib.machinery, importlib.util, json, os, sys, time
_loader = importlib.machinery.SourceFileLoader("simrun_under_test", ${JSON.stringify(SIMRUN)})
m = importlib.util.module_from_spec(importlib.util.spec_from_file_location(_loader.name, ${JSON.stringify(SIMRUN)}, loader=_loader))
_loader.exec_module(m)
`;
/** The fingerprint a doctor pass carries (spec section 1), written here from the specification:
 *  the first 16 hex of the sha256 of transport, ssh, os, python and workdir joined by newlines. */
const hostPrint = (h: { transport: string; ssh: string; os: string; python: string; workdir: string }) =>
  createHash("sha256").update([h.transport, h.ssh, h.os, h.python, h.workdir].join("\n")).digest("hex").slice(0, 16);
const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));
const logged = (p: string): string[][] => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(100); }
  return cond();
}
const processes = () => spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout.split("\n");
/** What this gate started and is still alive: sshd, the watchdog and supervisors (their command
 *  line names the temp directory) and jobs (each wrote its pid to pid.txt before anything else). */
function strays(): number[] {
  const table = processes();
  const named = table.filter((l) => l.includes(T)).map((l) => parseInt(l.trim(), 10));
  const jobs = (readdirSync(T, { recursive: true }) as string[]).filter((f) => f.endsWith("pid.txt")).map((f) => parseInt(readFileSync(join(T, f), "utf8"), 10))
    .filter((pid) => table.some((l) => parseInt(l.trim(), 10) === pid && l.includes("sim.py")));
  return [...new Set([...named, ...jobs])].filter((p) => p && p !== process.pid);
}
const BIG = Buffer.alloc(700_000, "simrun-pull-limit ");
const SIM = `import os, sys, time
mode = sys.argv[1]
open("pid.txt", "w").write(str(os.getpid()))
if mode == "calc":
    text = open("input.txt").read()
    open("result.txt", "w").write("x squared = %.2f\\n" % (float(text) ** 2))
    print("input was %s" % text.strip())
elif mode == "sleep":
    time.sleep(float(sys.argv[2]))
    open("done.txt", "w").write("done\\n")
    print("slept")
elif mode == "hold":
    open("started.flag", "w").close()
    time.sleep(float(sys.argv[2]))
elif mode == "many":
    for i in range(40):
        open("part-%02d.bin" % i, "wb").write(os.urandom(200000))
    print("wrote 40 files")
elif mode == "big":
    open("big.bin", "wb").write((b"simrun-pull-limit " * 40000)[:700000])
    open("small.txt", "w").write("small\\n")
    print("wrote 700000 bytes")
elif mode == "stamp":
    with open(sys.argv[2], "a") as f: f.write("S %s %.6f\\n" % (sys.argv[3], time.time()))
    time.sleep(float(sys.argv[4]))
    with open(sys.argv[2], "a") as f: f.write("E %s %.6f\\n" % (sys.argv[3], time.time()))
`;
function jobDir(name: string): string {
  const d = join(T, name);
  mkdirSync(d);
  writeFileSync(join(d, "sim.py"), SIM);
  writeFileSync(join(d, "input.txt"), "1337\n");
  return d;
}
const hostJob = (id: string, file: string) => join(HOSTWD, "jobs", id, file);

let watchdog: ReturnType<typeof spawn> | undefined;
function stopSshd() {
  try { process.kill(parseInt(readFileSync(join(T, "sshd.pid"), "utf8"), 10)); } catch { /* never started, or already gone */ }
}

try {
  // ── the loopback sshd ──
  const port: number = await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const p = (srv.address() as { port: number }).port; srv.close(() => resolve(p)); });
  });
  for (const key of ["host_key", "client_key"]) spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(T, key)]);
  copyFileSync(join(T, "client_key.pub"), join(T, "authorized_keys"));
  for (const f of ["host_key", "client_key", "authorized_keys"]) chmodSync(join(T, f), 0o600);
  writeFileSync(join(T, "sshd_config"), [`Port ${port}`, "ListenAddress 127.0.0.1", `HostKey ${join(T, "host_key")}`, `PidFile ${join(T, "sshd.pid")}`,
    `AuthorizedKeysFile ${join(T, "authorized_keys")}`, "PasswordAuthentication no", "KbdInteractiveAuthentication no", "UsePAM no", "StrictModes no", `Subsystem sftp ${SFTP}`, ""].join("\n"));
  writeFileSync(join(T, "ssh_config"), ["Host looptest", "  HostName 127.0.0.1", `  Port ${port}`, `  User ${userInfo().username}`, `  IdentityFile ${join(T, "client_key")}`, "  IdentitiesOnly yes",
    `  UserKnownHostsFile ${join(T, "known_hosts")}`, "  StrictHostKeyChecking accept-new", "  BatchMode yes", "  ConnectTimeout 5", ""].join("\n"));
  // If this gate is killed (the runner's timeout is SIGKILL, and no finally block runs), a
  // listening sshd with a key in a temp directory would stay behind. The watchdog outlives the gate.
  watchdog = spawn("sh", ["-c", `sleep 230; kill "$(cat '${join(T, "sshd.pid")}')" 2>/dev/null`], { detached: true, stdio: "ignore" });
  watchdog.unref();
  const started = spawnSync(SSHD, ["-f", join(T, "sshd_config"), "-E", join(T, "sshd.log")], { encoding: "utf8", timeout: 15_000 });
  const listening = await until(() => existsSync(join(T, "sshd.pid")), 5000) && await new Promise<boolean>((resolve) => {
    const c = createConnection({ port, host: "127.0.0.1" }, () => { c.destroy(); resolve(true); });
    c.on("error", () => resolve(false));
  });
  const hello = listening ? spawnSync("ssh", ["-F", join(T, "ssh_config"), "looptest", "echo", "simrun-gate-reached"], { encoding: "utf8", timeout: 20_000 }) : null;
  if (!hello || !hello.stdout.includes("simrun-gate-reached")) {
    const why = [started.stderr, hello?.stderr, existsSync(join(T, "sshd.log")) ? readFileSync(join(T, "sshd.log"), "utf8") : ""].join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
    throw new Error(`a user-mode sshd on 127.0.0.1:${port} could not be started or logged into (${SSHD} exit ${started.status}): ${why || "no message"}`);
  }

  writeFileSync(SOFTWARE, JSON.stringify({ hosts: { loop: { transport: "ssh", ssh: "looptest", python: PY, workdir: HOSTWD, software: {
    calc: { launchers: { py: PY }, max_minutes: 1 },
    seat1: { launchers: { py: PY }, seats: 1, max_minutes: 1, check: ["py", "-c", "print(6 * 7)"], expect: "42" },
  } } } }, null, 1));

  console.log("1. an ssh host runs nothing before doctor has passed on it");
  const rt = jobDir("roundtrip");
  let r = simrun(["run", rt, "--software", "calc", "--", "py", "sim.py", "calc"]);
  check("a job is refused with the spec's sentence, exit 4", r.rc === 4 && r.out.trimEnd() === `simrun: host "loop" has not passed 'simrun doctor loop' yet; jobs are refused until it has`, r.out);
  check("…and the host was not contacted: no ssh, no scp, an empty workdir", logged(SSH_LOG).length === 0 && logged(SCP_LOG).length === 0 && readdirSync(HOSTWD).length === 0);
  r = simrun(["ps"]);
  check("ps does not ask it either, and says why", r.rc === 0 && /host "loop" is not asked: it has not passed/.test(r.out) && logged(SSH_LOG).length === 0, r.out);
  const older = join(HOSTWD, ".simrun", "000000000000");
  mkdirSync(older, { recursive: true });
  writeFileSync(join(older, "simrun"), "# an earlier version of the host part; a supervisor may still be running from it\n");

  // A first contact that hangs is exactly when an operator presses Ctrl-C. The record of that
  // run used to say ok:true (no problem had been printed yet), and jobs were accepted.
  const refusal = `simrun: host "loop" has not passed 'simrun doctor loop' yet; jobs are refused until it has`;
  const bookPath = join(STATE, "doctor.json");
  const LOOP = { transport: "ssh", ssh: "looptest", os: "posix", python: PY, workdir: HOSTWD };
  /** A job is refused with `sentence`, and neither ssh nor scp is started for it. */
  const stillRefused = (label: string, software = "calc", sentence = refusal) => {
    const n = [logged(SSH_LOG).length, logged(SCP_LOG).length];
    const x = simrun(["run", rt, "--software", software, "--", "py", "sim.py", "calc"]);
    check(label, x.rc === 4 && x.out.trimEnd() === sentence && logged(SSH_LOG).length === n[0] && logged(SCP_LOG).length === n[1] && !existsSync(join(rt, "pid.txt")), `rc=${x.rc} ${x.out}`);
  };
  const cut = spawn(PY, [SIMRUN, "doctor", "loop"], { env: ENV, stdio: "ignore" });
  const cutDone = new Promise((resolve) => cut.on("close", resolve));
  await sleep(3000);
  cut.kill("SIGINT");
  await cutDone;
  let book = existsSync(bookPath) ? readJson(bookPath) : {};
  check("a doctor interrupted after 3 s records ok false for the host it was proving (same protocol, same fingerprint), not a pass", book.loop?.ok === false && book.loop?.protocol === 1 && book.loop?.host === hostPrint(LOOP), JSON.stringify(book));
  stillRefused("…so a job is still refused, and the host is not contacted for it");
  const cutLeft = readdirSync(join(HOSTWD, "jobs"));
  check("the interrupted doctor cancelled and forgot every job it had started (an upload it was cut off in has no status and is pruned later)", cutLeft.every((f) => /\.(in\.zip|req\.json)$/.test(f)) && !existsSync(join(HOSTWD, "locks", "seat1", "seat-1")), cutLeft.join(","));
  for (const f of cutLeft) rmSync(join(HOSTWD, "jobs", f), { recursive: true, force: true });

  r = simrun(["doctor", "loop"], {}, 100_000);
  const dl = r.out.trimEnd().split("\n");
  check("doctor prints only ok lines and exits 0", r.rc === 0 && dl.length >= 8 && dl.every((l) => l.startsWith("ok ")), r.out);
  for (const what of [/^ok transport reachable \(ssh\)/, /^ok Python 3\.\d+\.\d+ on the host; workdir writable/, /^ok a job ran with the host's own Python/, /^ok a 1 MB file went to the host and its copy came back with the same sha256/,
    /^ok two jobs on a one-seat software did not overlap \(a person using the program at the desktop holds the same licence seat/, /^ok cancel ended a sleeping job and freed its seat/,
    /^ok software "seat1": its check exited 0 and printed the expected text/, /^ok software "calc": declared without a "check"/, /^ok a 20 s job kept running after the command that started it had returned/])
    check(`doctor line: ${what.source.slice(1, 60)}`, dl.some((l) => what.test(l)), r.out);
  check("doctor took the 20 s its detachment check needs (it did not skip the wait)", r.ms >= 20_000, `${r.ms}ms`);
  book = existsSync(bookPath) ? readJson(bookPath) : {};
  check("doctor.json records loop: ok true, with when, which simrun and which os", book.loop?.ok === true && /^\d{4}-\d\d-\d\dT/.test(book.loop.at) && book.loop.simrun === sha(SIMRUN).slice(0, 12) && book.loop.os === "posix", JSON.stringify(book));
  check("…and what the pass was made against: the protocol, the host entry's fingerprint, the software whose check passed (seat1; calc declares none)", book.loop?.protocol === 1 && book.loop?.host === hostPrint(LOOP) && JSON.stringify(book.loop?.checked) === JSON.stringify(["seat1"]), JSON.stringify(book));
  // The pass is tied to what was proven. Each change below is one an operator can make by
  // editing a file, and each must put the host back behind doctor without a single connection.
  const passBytes = existsSync(bookPath) ? readFileSync(bookPath, "utf8") : "{}", operatorBytes = readFileSync(SOFTWARE, "utf8");
  const withEntry = (change: (e: any) => void) => { const e = { ...book.loop }; change(e); writeFileSync(bookPath, JSON.stringify({ loop: e })); };
  withEntry((e) => { e.protocol = 0; });
  stillRefused("a pass made under another protocol number is no pass");
  withEntry((e) => { delete e.host; });
  stillRefused("a pass that does not say which host entry it was made against is no pass");
  writeFileSync(bookPath, passBytes);
  writeFileSync(SOFTWARE, operatorBytes.replace('"transport": "ssh",', '"transport": "ssh", "os": "windows",'));
  stillRefused("the label re-pointed at another kind of machine (os: windows) is a host doctor never touched: the Windows command line is not used on it");
  writeFileSync(SOFTWARE, operatorBytes.replace(`"workdir": "${HOSTWD}"`, `"workdir": "${HOSTWD}/elsewhere"`));
  stillRefused("…and so is the same machine with another workdir");
  writeFileSync(SOFTWARE, operatorBytes);
  withEntry((e) => { e.checked = []; });
  stillRefused("software that declares a check is refused when the recorded doctor run did not pass that check", "seat1", `simrun: software "seat1" on host "loop" declares a check that the last 'simrun doctor loop' did not run; run doctor again before using it`);
  writeFileSync(bookPath, passBytes);
  check("the record and the operator file are back as doctor and the gate wrote them", readFileSync(bookPath, "utf8") === passBytes && readFileSync(SOFTWARE, "utf8") === operatorBytes && operatorBytes.includes('"transport": "ssh",') && operatorBytes.includes(`"workdir": "${HOSTWD}"`));
  const hostCopy = join(HOSTWD, ".simrun", sha(SIMRUN).slice(0, 12), "simrun");
  check("the host part is the same bytes as the client, under <workdir>/.simrun/<sha12>/", existsSync(hostCopy) && sha(hostCopy) === sha(SIMRUN));
  check("an earlier version beside it was not replaced or removed", JSON.stringify(readdirSync(join(HOSTWD, ".simrun")).sort()) === JSON.stringify(["000000000000", sha(SIMRUN).slice(0, 12)].sort())
    && readFileSync(join(older, "simrun"), "utf8").startsWith("# an earlier version"), readdirSync(join(HOSTWD, ".simrun")).join(","));
  check("doctor left no job behind on the host", readdirSync(join(HOSTWD, "jobs")).length === 0 && !existsSync(join(HOSTWD, "locks", "seat1", "seat-1")), readdirSync(join(HOSTWD, "jobs")).join(","));

  console.log("2. round trip: inputs go, the job runs there, outputs come back");
  r = simrun(["run", rt, "--software", "calc", "--", "py", "sim.py", "calc"]);
  let s = st(r);
  check("after doctor the same job runs: exit 0, state=exited exit=0", r.rc === 0 && s.state === "exited" && s.exit === "0" && s.host === "loop", r.out);
  check("the input arrived: the job printed its content, and the host's copy has the same bytes", r.out.includes("| input was 1337") && existsSync(hostJob(s.job, "input.txt")) && readFileSync(hostJob(s.job, "input.txt"), "utf8") === "1337\n", r.out);
  check("the job ran on the host, not in the caller's directory (its pid file was written under the workdir first)", existsSync(hostJob(s.job, "pid.txt")) && readFileSync(hostJob(s.job, "pid.txt"), "utf8") === readFileSync(join(rt, "pid.txt"), "utf8"));
  check("the output came back with the right bytes", existsSync(join(rt, "result.txt")) && readFileSync(join(rt, "result.txt"), "utf8") === "x squared = 1787569.00\n" && sha(join(rt, "result.txt")) === sha(hostJob(s.job, "result.txt")));
  let rec = existsSync(join(rt, "simrun.json")) ? readJson(join(rt, "simrun.json")) : {};
  check("simrun.json lists exactly the two files the job made, with the sha256 of the bytes on disk", JSON.stringify(rec.outputs) === JSON.stringify(["pid.txt", "result.txt"].map((p) => ({ path: p, bytes: statSync(join(rt, p)).size, sha256: sha(join(rt, p)) }))), JSON.stringify(rec.outputs));
  check("unchanged inputs are not listed, nothing was left on the host, the command is by launcher name", !JSON.stringify(rec.outputs).includes("input.txt") && !JSON.stringify(rec.outputs).includes("sim.py")
    && JSON.stringify(rec.left_on_host) === "[]" && JSON.stringify(rec.command) === JSON.stringify(["py", "sim.py", "calc"]) && !readFileSync(join(rt, "simrun.json"), "utf8").includes(PY));
  check("the archives are not kept in the job directory", !existsSync(join(rt, ".simrun", "in.zip")) && !existsSync(join(rt, ".simrun", "out.zip")) && !existsSync(join(rt, ".simrun", "out.zip.part")));

  console.log("3. detachment across ssh");
  const det = jobDir("detached");
  r = simrun(["start", det, "--software", "calc", "--", "py", "sim.py", "sleep", "8"]);
  s = st(r);
  check("start exits 0 in well under the job's 8 s", r.rc === 0 && s.state === "running" && r.ms < 5000, `${r.ms}ms ${r.out}`);
  const sshLeft = processes().filter((l) => l.includes(`-F ${join(T, "ssh_config")}`));
  check("the ssh command that started it is gone", sshLeft.length === 0, sshLeft.join(" | "));
  await until(() => existsSync(hostJob(s.job, "pid.txt")) && readFileSync(hostJob(s.job, "pid.txt"), "utf8") !== "", 8000);
  const detPid = parseInt(readFileSync(hostJob(s.job, "pid.txt"), "utf8"), 10);
  check("the job is still running on the host (process table), and nothing has come back", detPid > 0 && pidAlive(detPid) && !existsSync(join(det, "pid.txt")));
  r = simrun(["status", det]);
  check("status says running", r.rc === 0 && st(r).state === "running" && st(r).job === s.job, r.out);
  r = simrun(["wait", det, "--timeout", "30"]);
  check("wait later returns exited 0 and brings the files back", r.rc === 0 && st(r).state === "exited" && r.out.includes("| slept") && readFileSync(join(det, "done.txt"), "utf8") === "done\n", r.out);
  const before = [logged(SSH_LOG).length, logged(SCP_LOG).length];
  const again = simrun(["wait", det]);
  check("a second wait reports the same without a single ssh or scp call", again.rc === 0 && again.last === r.last && logged(SSH_LOG).length === before[0] && logged(SCP_LOG).length === before[1], again.out);
  // The default --timeout is below the 90 s at which Luxas hands a foreground call back. Read from the remote
  // command line, where it is used: the usage text alone stayed right while the code said 100.
  const dflt = jobDir("default-timeout");
  const jdf = st(simrun(["start", dflt, "--software", "calc", "--", "py", "sim.py", "sleep", "1"])).job;
  r = simrun(["wait", dflt]);
  const waitedFor = logged(SSH_LOG).filter((a) => a.includes("wait") && a.includes(jdf)).map((a) => a[a.length - 1]);
  check("a wait without --timeout asks the host to wait 75 s (and returns as soon as the job ends)", r.rc === 0 && st(r).state === "exited" && r.ms < 20_000 && JSON.stringify(waitedFor) === JSON.stringify(["75.0"]), `${r.ms}ms ${JSON.stringify(waitedFor)} ${r.out}`);
  r = simrun(["run", jobDir("six"), "--software", "calc", "--timeout", "1", "--", "py", "sim.py", "sleep", "5"]);
  check('run --timeout 1 on a longer job exits 3 with next="simrun wait <dir>"', r.rc === 3 && r.last.endsWith(` next="simrun wait ${join(T, "six")}"`), r.out);
  r = simrun(["wait", join(T, "six"), "--timeout", "30"]);
  check("…and the following wait exits 0", r.rc === 0 && st(r).state === "exited", r.out);

  console.log("4. a file over the pull limit stays on the host and says so");
  const big = jobDir("big");
  r = simrun(["run", big, "--software", "calc", "--pull-limit-mb", "1", "--", "py", "sim.py", "big"]);
  s = st(r);
  rec = existsSync(join(big, "simrun.json")) ? readJson(join(big, "simrun.json")) : {};
  check("the job succeeded and the small files came back", r.rc === 0 && s.state === "exited" && readFileSync(join(big, "small.txt"), "utf8") === "small\n" && JSON.stringify(rec.outputs?.map((o: any) => o.path)) === JSON.stringify(["pid.txt", "small.txt"]), r.out);
  check("the 700 kB file (over half of 1 MB) was not pulled and is listed in left_on_host with its size", !existsSync(join(big, "big.bin")) && JSON.stringify(rec.left_on_host) === JSON.stringify([{ path: "big.bin", bytes: 700000 }]) && /1 file\(s\) stayed on the host \(left_on_host\): simrun fetch/.test(r.out), JSON.stringify(rec.left_on_host));
  r = simrun(["fetch", big, "big.bin"]);
  check("fetch brings it back intact (same bytes as the host's copy and as the job was told to write)", r.rc === 0 && existsSync(join(big, "big.bin")) && readFileSync(join(big, "big.bin")).equals(BIG) && sha(join(big, "big.bin")) === sha(hostJob(s.job, "big.bin")), r.out);
  rec = readJson(join(big, "simrun.json"));
  check("simrun.json now lists it as an output with its sha256, and nothing as left", JSON.stringify(rec.left_on_host) === "[]" && rec.outputs.some((o: any) => o.path === "big.bin" && o.bytes === 700000 && o.sha256 === createHash("sha256").update(BIG).digest("hex")), JSON.stringify(rec));
  // Two fetches typed at once in one directory. The request and the archive have one name each on both sides: one
  // call failed, the other reported the first one's file while its own never arrived, and the record lost an entry.
  const both = jobDir("two-fetches");
  r = simrun(["run", both, "--software", "calc", "--pull-limit-mb", "0", "--", "py", "sim.py", "big"]);
  const jf = st(r).job;
  const fetched = await Promise.all([simrunAsync(["fetch", both, "big.bin"]), simrunAsync(["fetch", both, "small.txt"])]);
  rec = existsSync(join(both, "simrun.json")) ? readJson(join(both, "simrun.json")) : {};
  check("two fetches typed at once in one directory each bring their own file, intact, and say so", r.rc === 0 && jf !== "" && fetched.every((f) => f.rc === 0) && /^simrun: fetched big\.bin \(700000 bytes/m.test(fetched[0].out) && !fetched[0].out.includes("small.txt")
    && /^simrun: fetched small\.txt \(6 bytes/m.test(fetched[1].out) && !fetched[1].out.includes("big.bin") && existsSync(join(both, "big.bin")) && readFileSync(join(both, "big.bin")).equals(BIG)
    && existsSync(join(both, "small.txt")) && readFileSync(join(both, "small.txt"), "utf8") === "small\n" && !existsSync(join(both, ".simrun", "collecting")), fetched.map((f) => `rc=${f.rc} ${f.out}`).join(" ⏎ "));
  check("…and the record lists both as outputs (neither update was lost), with only the third file still on the host", JSON.stringify(rec.outputs?.map((o: any) => o.path)) === JSON.stringify(["big.bin", "small.txt"])
    && JSON.stringify(rec.left_on_host?.map((o: any) => o.path)) === JSON.stringify(["pid.txt"]), JSON.stringify(rec));
  // A fetch that had to wait for the directory's claim while the next job was started and collected there. It went on
  // to fetch the job it had read before the wait: the earlier job's file landed over the newer job's result, under the
  // newer job's record, and both calls exited 0. Forced, not raced: the gate holds the claim with its own pid (what a
  // fetch in flight leaves there), the fetch is the runner loaded as a module that says when it found the claim held,
  // and it is stopped there until the directory has moved on.
  const queued = jobDir("queued-fetch");
  const q1 = st(simrun(["run", queued, "--software", "calc", "--pull-limit-mb", "0", "--", "py", "sim.py", "calc"]));
  writeFileSync(join(queued, ".simrun", "collecting"), String(process.pid));
  const lateFetch = spawn(PY, ["-B", "-c", RUNNER_AS_M + `real = m.take_claim
def announced(d, name):
    held = real(d, name)
    if held and name == "collecting":
        sys.stderr.write("CLAIM-HELD\\n")
        sys.stderr.flush()
    return held
m.take_claim = announced
sys.exit(m.main(["simrun", "fetch", sys.argv[1], "result.txt"]))
`, queued], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let lateFetchOut = "";
  lateFetch.stdout.on("data", (b) => (lateFetchOut += b)); lateFetch.stderr.on("data", (b) => (lateFetchOut += b));
  const lateFetchDone = new Promise<number | null>((resolve) => lateFetch.on("close", resolve));
  const sawClaim = await until(() => lateFetchOut.includes("CLAIM-HELD"), 10_000);
  process.kill(lateFetch.pid ?? 0, "SIGSTOP");
  rmSync(join(queued, ".simrun", "collecting"));
  writeFileSync(join(queued, "input.txt"), "2\n");
  r = simrun(["run", queued, "--software", "calc", "--", "py", "sim.py", "calc"]);
  const q2 = st(r);
  const sentBefore = [logged(SSH_LOG).length, logged(SCP_LOG).length];
  process.kill(lateFetch.pid ?? 0, "SIGCONT");
  const lateFetchRc = await lateFetchDone;
  rec = existsSync(join(queued, "simrun.json")) ? readJson(join(queued, "simrun.json")) : {};
  check("a fetch that waited for the claim while the directory moved on to the next job is refused (exit 4), names both jobs, and sends nothing to the host",
    sawClaim && q1.state === "exited" && r.rc === 0 && q2.job !== "" && q2.job !== q1.job && lateFetchRc === 4 && lateFetchOut.includes(`job ${q1.job} is no longer the job of ${queued}`) && lateFetchOut.includes(`it holds job ${q2.job} now`)
    && !lateFetchOut.includes("fetched result.txt") && logged(SSH_LOG).length === sentBefore[0] && logged(SCP_LOG).length === sentBefore[1] && !existsSync(join(queued, ".simrun", "collecting")),
    `saw the claim=${sawClaim} rc=${lateFetchRc} ssh+${logged(SSH_LOG).length - sentBefore[0]} scp+${logged(SCP_LOG).length - sentBefore[1]} ${lateFetchOut}`);
  check("…and the newer job's result is as its collection left it: the bytes of its copy on the host, and the sha256 its record lists",
    rec.job === q2.job && existsSync(join(queued, "result.txt")) && readFileSync(join(queued, "result.txt"), "utf8") === "x squared = 4.00\n" && sha(join(queued, "result.txt")) === sha(hostJob(q2.job, "result.txt"))
    && rec.outputs?.find((o: any) => o.path === "result.txt")?.sha256 === sha(join(queued, "result.txt")), `result.txt=${JSON.stringify(existsSync(join(queued, "result.txt")) ? readFileSync(join(queued, "result.txt"), "utf8") : null)} record job=${rec.job}`);
  // The same fetch when the directory holds no job record at all by the time it gets the claim (what a start that the
  // host refused leaves behind). It is the other half of one condition: with "no record" let through, both gates passed.
  const vacated = jobDir("queued-fetch-no-record");
  const v1 = st(simrun(["run", vacated, "--software", "calc", "--pull-limit-mb", "0", "--", "py", "sim.py", "calc"]));
  writeFileSync(join(vacated, ".simrun", "collecting"), String(process.pid));
  const vacatedFetch = spawn(PY, ["-B", "-c", RUNNER_AS_M + `real = m.take_claim
def announced(d, name):
    held = real(d, name)
    if held and name == "collecting":
        sys.stderr.write("CLAIM-HELD\\n")
        sys.stderr.flush()
    return held
m.take_claim = announced
sys.exit(m.main(["simrun", "fetch", sys.argv[1], "result.txt"]))
`, vacated], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let vacatedOut = "";
  vacatedFetch.stdout.on("data", (b) => (vacatedOut += b)); vacatedFetch.stderr.on("data", (b) => (vacatedOut += b));
  const vacatedDone = new Promise<number | null>((resolve) => vacatedFetch.on("close", resolve));
  const vacatedSaw = await until(() => vacatedOut.includes("CLAIM-HELD"), 10_000);
  process.kill(vacatedFetch.pid ?? 0, "SIGSTOP");
  rmSync(join(vacated, ".simrun", "job.json"));
  rmSync(join(vacated, ".simrun", "collecting"));
  const vacatedSent = [logged(SSH_LOG).length, logged(SCP_LOG).length];
  process.kill(vacatedFetch.pid ?? 0, "SIGCONT");
  const vacatedRc = await vacatedDone;
  check("a fetch that waited for the claim and then finds no job record in the directory is refused (exit 4), says so, and sends nothing to the host",
    vacatedSaw && v1.state === "exited" && vacatedRc === 4 && vacatedOut.includes(`job ${v1.job} is no longer the job of ${vacated} (it holds no job record now); nothing was fetched`)
    && logged(SSH_LOG).length === vacatedSent[0] && logged(SCP_LOG).length === vacatedSent[1] && !existsSync(join(vacated, "result.txt")) && !existsSync(join(vacated, ".simrun", "collecting")) && !existsSync(join(vacated, ".simrun", "fetch.json")),
    `saw the claim=${vacatedSaw} rc=${vacatedRc} ssh+${logged(SSH_LOG).length - vacatedSent[0]} scp+${logged(SCP_LOG).length - vacatedSent[1]} ${vacatedOut}`);
  // A wait whose job has ended while another call holds the directory's claim (a fetch holds it for its whole
  // transfer). It waited for the claim without a limit and printed nothing: the silence past 90 s that the 75 s default
  // exists to prevent. Now it comes back at its --timeout and says who holds the directory.
  const behind = jobDir("behind-a-claim");
  const jBehind = st(simrun(["start", behind, "--software", "calc", "--", "py", "sim.py", "calc"])).job;
  await until(() => st(simrun(["status", behind])).state === "exited", 15_000);
  writeFileSync(join(behind, ".simrun", "collecting"), String(process.pid));
  r = simrun(["wait", behind, "--timeout", "3"], {}, 20_000);
  check("a wait whose job has ended while another call holds the directory's claim comes back at its --timeout: exit 3, the host's state, who holds the directory, and next=",
    r.rc === 3 && r.ms < 12_000 && st(r).state === "exited" && st(r).exit === "0" && st(r).job === jBehind && r.last.endsWith(` next="simrun wait ${behind}"`)
    && r.out.includes(`simrun: job ${jBehind} has ended on the host and is not collected into ${behind} yet (no simrun.json for it): another simrun call (pid ${process.pid}) is collecting or fetching in this directory`), `rc=${r.rc} ${r.ms}ms ${r.out}`);
  check("…it collected nothing and left the other call's claim alone", !existsSync(join(behind, "simrun.json")) && !existsSync(join(behind, "result.txt")) && readJson(join(behind, ".simrun", "job.json")).final === null
    && existsSync(join(behind, ".simrun", "collecting")) && readFileSync(join(behind, ".simrun", "collecting"), "utf8") === String(process.pid));
  rmSync(join(behind, ".simrun", "collecting"), { force: true });
  r = simrun(["wait", behind]);
  check("…and the wait typed next collects the job: exit 0, the result is there", r.rc === 0 && st(r).state === "exited" && st(r).job === jBehind && existsSync(join(behind, "result.txt")) && readFileSync(join(behind, "result.txt"), "utf8") === "x squared = 1787569.00\n", r.out);
  r = simrun(["fetch", big, "../roundtrip/result.txt"]);
  check("fetch refuses a path that leaves the job directory", r.rc === 4, r.out);
  r = simrun(["fetch", big, "no-such-file.bin"]);
  check("fetch of a file the host does not have exits 1 and names it", r.rc === 1 && r.out.includes("no-such-file.bin"), r.out);

  console.log("5. an unpack never writes outside the directory");
  const U = join(T, "unpack");
  mkdirSync(join(U, "dest"), { recursive: true });
  const mk = spawnSync(PY, ["-c", `
import sys, zipfile
u = sys.argv[1]
def z(name, members):
    with zipfile.ZipFile(u + "/" + name, "w") as f:
        for m, mode, *text in members:
            info = zipfile.ZipInfo(m)
            if mode: info.external_attr = mode << 16
            f.writestr(info, text[0] if text else "payload\\n" if mode != 0o120777 else u + "/dest")
z("dotdot.zip", [("good.txt", 0), ("../escape.txt", 0)])
z("nested.zip", [("good.txt", 0), ("sub/../../escape.txt", 0)])
z("absolute.zip", [("good.txt", 0), (u + "/abs.txt", 0)])
z("symlink.zip", [("good.txt", 0), ("link", 0o120777)])
z("records.zip", [("good.txt", 0), (".simrun/job.json", 0)])
z("upper.zip", [("good.txt", 0), (".SIMRUN/job.json", 0)])
z("record.zip", [("good.txt", 0), ("SIMRUN.JSON", 0)])
z("clash.zip", [("a_first.txt", 0), ("clash", 0), ("clash/inner.txt", 0)])
z("through.zip", [("out/x.txt", 0)])
z("benign.zip", [("good.txt", 0), ("sub/deep.txt", 0), ("sub/simrun.json", 0)])
z("longs_dir.zip", [("good.txt", 0), (".\u017fimrun/job.json", 0)])
z("longs_rec.zip", [("good.txt", 0), ("\u017fimrun.json", 0)])
z("twins.zip", [("good.txt", 0), ("Mesh.dat", 0, "fine\\n"), ("mesh.dat", 0, "coarse\\n")])
z("longname.zip", [("r" * 246 + ".dat", 0)])
z("file_for_dir.zip", [("good.txt", 0), ("sub", 0)])
z("dir_for_file.zip", [("other.txt", 0), ("good.txt/inner.txt", 0)])
z("twin_of_held.zip", [("good.txt", 0), ("mesh.dat", 0, "the job's mesh\\n"), ("Out/x.txt", 0)])
z("twin_then_stuck.zip", [("mesh.dat", 0, "the job's mesh\\n"), ("sub/deep.txt", 0), ("late.txt", 0)])
z("accents.zip", [("e\u0301.dat", 0, "the job's\\n"), ("u\u0308.txt", 0, "the job's\\n")])
`, U], { encoding: "utf8" });
  check("the hostile archives were built", mk.status === 0 && readdirSync(U).length === 20, mk.stderr);
  for (const [zip, what] of [["dotdot.zip", "a ../ member"], ["nested.zip", "a member that climbs out through a subdirectory"], ["absolute.zip", "an absolute member"], ["symlink.zip", "a symlink member"], ["records.zip", "a member aimed at simrun's own records"],
    ["upper.zip", "the same records spelled .SIMRUN (one directory on this Mac's disk and on NTFS)"], ["record.zip", "a top-level SIMRUN.JSON (the record the reviewer reads)"], ["clash.zip", "a member that lies under a path the archive also holds as a file"],
    ["longs_dir.zip", "the records directory spelled with a long s (this Mac's disk folds that letter to s too; lower() does not)"], ["longs_rec.zip", "simrun.json spelled with a long s"]]) {
    r = simrun(["_unpack", join(U, zip), join(U, "dest")]);
    check(`${what}: the call fails, says nothing was unpacked, and nothing at all is written, inside or outside`, r.rc !== 0 && r.rc !== null && r.out.includes("nothing was unpacked") && !existsSync(join(U, "escape.txt")) && !existsSync(join(T, "escape.txt")) && !existsSync(join(U, "abs.txt"))
      && readdirSync(join(U, "dest")).length === 0, `rc=${r.rc} dest=${readdirSync(join(U, "dest")).join(",")} ${r.out}`);
  }
  r = simrun(["_unpack", join(U, "benign.zip"), join(U, "dest")]);
  check("a benign archive unpacks (the routine is not refusing everything), a job's own sub/simrun.json included", r.rc === 0 && readFileSync(join(U, "dest", "sub", "deep.txt"), "utf8") === "payload\n" && existsSync(join(U, "dest", "sub", "simrun.json")), r.out);
  // Every case above unpacks into an empty directory. The caller's directory is not empty.
  const outside = join(U, "outside");
  mkdirSync(outside); mkdirSync(join(U, "dest2"));
  symlinkSync(outside, join(U, "dest2", "out"));
  r = simrun(["_unpack", join(U, "through.zip"), join(U, "dest2")]);
  check("a member that passes through a symlink already in the destination is refused, and nothing lands where the link points", r.rc === 4 && readdirSync(outside).length === 0 && /passes through the symlink/.test(r.out), `rc=${r.rc} outside=${readdirSync(outside).join(",")} ${r.out}`);
  mkdirSync(join(U, "dest3"));
  writeFileSync(join(U, "dest3", "good.txt"), "the caller's copy, write-protected\n");
  chmodSync(join(U, "dest3", "good.txt"), 0o444);
  r = simrun(["_unpack", join(U, "benign.zip"), join(U, "dest3")]);
  check("a file that is read-only in the destination is replaced, not opened (a job may rewrite an input the caller protected)", r.rc === 0 && readFileSync(join(U, "dest3", "good.txt"), "utf8") === "payload\n", `rc=${r.rc} ${r.out}`);
  mkdirSync(join(U, "dest4", "sub"), { recursive: true });
  chmodSync(join(U, "dest4", "sub"), 0o555);
  r = simrun(["_unpack", join(U, "benign.zip"), join(U, "dest4")]);
  check("a member that cannot be written is a refusal that says which, and that the members before it were unpacked (it does not claim nothing was)", r.rc === 4 && !r.out.includes("Traceback") && /archive member 'sub\/deep\.txt' could not be written \(.*\); the members before it were unpacked/.test(r.out)
    && !r.out.includes("nothing was unpacked") && existsSync(join(U, "dest4", "good.txt")) && readdirSync(join(U, "dest4", "sub")).length === 0, `rc=${r.rc} ${r.out}`);
  chmodSync(join(U, "dest4", "sub"), 0o755);
  // Names from a disk that tells letter case apart, onto one that may not. The second member replaced the first,
  // the sha256 comparison after the pull failed, and every wait blamed scp. Which case applies is asked of this disk.
  const foldsCase = existsSync(join(U, "DEST"));
  mkdirSync(join(U, "dest5"));
  r = simrun(["_unpack", join(U, "twins.zip"), join(U, "dest5")]);
  if (foldsCase)
    check("two members whose names differ only by letter case, onto a disk that holds one name for both: refused, both named, nothing unpacked and no probe file left",
      r.rc === 4 && /archive members 'Mesh\.dat' and 'mesh\.dat' differ only by letter case, and the disk of .* holds one name for both; nothing was unpacked/.test(r.out) && readdirSync(join(U, "dest5")).length === 0, `rc=${r.rc} ${readdirSync(join(U, "dest5")).join(",")} ${r.out}`);
  else
    check("two members whose names differ only by letter case unpack as two files on a disk that tells them apart, and no probe file is left",
      r.rc === 0 && readFileSync(join(U, "dest5", "Mesh.dat"), "utf8") === "fine\n" && readFileSync(join(U, "dest5", "mesh.dat"), "utf8") === "coarse\n" && readdirSync(join(U, "dest5")).length === 3, `rc=${r.rc} ${readdirSync(join(U, "dest5")).join(",")} ${r.out}`);
  mkdirSync(join(U, "dest6"));
  r = simrun(["_unpack", join(U, "longname.zip"), join(U, "dest6")]);
  check("a member whose name is 250 bytes long unpacks (the temporary file's name used to be the member's plus 13 characters, past the disk's limit)",
    r.rc === 0 && JSON.stringify(readdirSync(join(U, "dest6"))) === JSON.stringify(["r".repeat(246) + ".dat"]) && readFileSync(join(U, "dest6", "r".repeat(246) + ".dat"), "utf8") === "payload\n", `rc=${r.rc} ${r.out}`);
  // What the destination already holds in a member's place is looked at before the first byte is written.
  mkdirSync(join(U, "dest7", "sub"), { recursive: true });
  writeFileSync(join(U, "dest7", "sub", "kept.txt"), "the caller's file\n");
  r = simrun(["_unpack", join(U, "file_for_dir.zip"), join(U, "dest7")]);
  check("a member that is a file where the destination has a directory is refused before anything is written (it used to fail half-way, with the members before it in place)",
    r.rc === 4 && /archive member 'sub' is a file, and .*sub is a directory here; nothing was unpacked/.test(r.out) && !existsSync(join(U, "dest7", "good.txt")) && readFileSync(join(U, "dest7", "sub", "kept.txt"), "utf8") === "the caller's file\n", `rc=${r.rc} ${r.out}`);
  mkdirSync(join(U, "dest8"));
  writeFileSync(join(U, "dest8", "good.txt"), "the caller's file\n");
  r = simrun(["_unpack", join(U, "dir_for_file.zip"), join(U, "dest8")]);
  check("…and so is a member that needs a directory where the destination has a file", r.rc === 4 && /archive member 'good\.txt\/inner\.txt' needs .*good\.txt to be a directory, and it is a file here; nothing was unpacked/.test(r.out)
    && !existsSync(join(U, "dest8", "other.txt")) && readFileSync(join(U, "dest8", "good.txt"), "utf8") === "the caller's file\n", `rc=${r.rc} ${r.out}`);
  // One of the pair is in the archive and the other is already in the caller's directory (the caller's input Mesh.dat,
  // the job's own mesh.dat on a host that tells them apart). On a disk that holds one name for both, the member is
  // written onto the caller's file: that is said, with both spellings, where it used to happen without a word.
  mkdirSync(join(U, "dest9", "out"), { recursive: true });
  writeFileSync(join(U, "dest9", "Mesh.dat"), "the caller's mesh\n");
  r = simrun(["_unpack", join(U, "twin_of_held.zip"), join(U, "dest9")]);
  if (foldsCase)
    check("a member whose name differs only by letter case from what the destination holds, on a disk with one name for both: unpacked, and each such name is said with both spellings",
      r.rc === 0 && readFileSync(join(U, "dest9", "mesh.dat"), "utf8") === "the job's mesh\n" && readdirSync(join(U, "dest9")).length === 3 && existsSync(join(U, "dest9", "out", "x.txt"))
      && /^simrun: 'mesh\.dat' from the archive was written onto 'Mesh\.dat', which .* already held: the two names differ only by letter case, and the disk of .* holds one name for both$/m.test(r.out)
      && /^simrun: 'Out' from the archive was written onto 'out', which /m.test(r.out) && !/good\.txt/.test(r.out), `rc=${r.rc} ${readdirSync(join(U, "dest9")).join(",")} ${r.out}`);
  else
    check("a member whose name differs only by letter case from what the destination holds is a second file on a disk that tells them apart, and nothing is said",
      r.rc === 0 && readFileSync(join(U, "dest9", "Mesh.dat"), "utf8") === "the caller's mesh\n" && readFileSync(join(U, "dest9", "mesh.dat"), "utf8") === "the job's mesh\n" && existsSync(join(U, "dest9", "Out", "x.txt"))
      && !/written onto/.test(r.out), `rc=${r.rc} ${readdirSync(join(U, "dest9")).join(",")} ${r.out}`);
  r = simrun(["_unpack", join(U, "benign.zip"), join(U, "dest9")]);
  check("…and an ordinary archive into the same directory says nothing of the kind (a file replaced under its own spelling is the job's new version)", r.rc === 0 && !/written onto/.test(r.out), r.out);
  // Since the fourth review. The note belongs to the members that were written. When a later member cannot be written
  // the call is a refusal, and the note of an earlier member used to go unsaid: the caller's Mesh.dat was replaced
  // without a word after all. A member the unpack never reached (late.txt, onto the caller's Late.txt) is not in it.
  mkdirSync(join(U, "dest10", "sub"), { recursive: true });
  writeFileSync(join(U, "dest10", "Mesh.dat"), "the caller's mesh\n");
  writeFileSync(join(U, "dest10", "Late.txt"), "the caller's file\n");
  chmodSync(join(U, "dest10", "sub"), 0o555);
  r = simrun(["_unpack", join(U, "twin_then_stuck.zip"), join(U, "dest10")]);
  chmodSync(join(U, "dest10", "sub"), 0o755);
  if (foldsCase)
    check("a member that cannot be written, after one that went onto an entry of another letter case: the refusal carries that member's note, and none for a member it never reached",
      r.rc === 4 && /archive member 'sub\/deep\.txt' could not be written \(.*\); the members before it were unpacked; 'mesh\.dat' from the archive was written onto 'Mesh\.dat', which .* already held: the two names differ only by letter case/.test(r.out)
      && !/late\.txt/i.test(r.out) && readFileSync(join(U, "dest10", "Mesh.dat"), "utf8") === "the job's mesh\n" && readFileSync(join(U, "dest10", "Late.txt"), "utf8") === "the caller's file\n", `rc=${r.rc} ${r.out}`);
  else
    check("a member that cannot be written, after one that is a second file on a disk that tells letter case apart: the refusal says nothing of a name written onto another",
      r.rc === 4 && /archive member 'sub\/deep\.txt' could not be written \(.*\); the members before it were unpacked$/m.test(r.out) && !/written onto/.test(r.out)
      && readFileSync(join(U, "dest10", "Mesh.dat"), "utf8") === "the caller's mesh\n" && readFileSync(join(U, "dest10", "mesh.dat"), "utf8") === "the job's mesh\n", `rc=${r.rc} ${r.out}`);
  // Letter case and the composition of an accent together: `É` as one character in the caller's directory, `e` followed
  // by the accent from the job. This Mac's disk holds one file for the two, and comparing by letter case alone did not
  // pair them. The same letter in two compositions (ü) is one visible name and is not reported. What this disk does
  // with each pair is asked of it before the unpack, so the expectation holds on any disk.
  mkdirSync(join(U, "dest11"));
  writeFileSync(join(U, "dest11", "É.dat"), "the caller's\n");
  writeFileSync(join(U, "dest11", "ü.txt"), "the caller's\n");
  const oneForAccentCase = existsSync(join(U, "dest11", "é.dat")), oneForComposition = existsSync(join(U, "dest11", "ü.txt"));
  r = simrun(["_unpack", join(U, "accents.zip"), join(U, "dest11")]);
  const accentNote = /^simrun: 'é\.dat' from the archive was written onto 'É\.dat', which .* already held: the two names differ only by letter case/m.test(r.out.normalize("NFC"));
  check(`a member that differs from a held name by letter case and by how its accent is composed ${oneForAccentCase ? "is one file on this disk: unpacked, and said with both spellings" : "is a second file on this disk, and nothing is said"}; the same letter composed otherwise is never reported`,
    r.rc === 0 && accentNote === oneForAccentCase && (r.out.match(/written onto/g) ?? []).length === (oneForAccentCase ? 1 : 0)
    && readdirSync(join(U, "dest11")).length === 2 + (oneForAccentCase ? 0 : 1) + (oneForComposition ? 0 : 1) && readFileSync(join(U, "dest11", "é.dat"), "utf8") === "the job's\n",
    `rc=${r.rc} one file for case+accent=${oneForAccentCase} for composition=${oneForComposition} ${readdirSync(join(U, "dest11")).join(",")} ${r.out}`);
  // The same note where a caller of the runner reads it, not only through the gate's own verb: the pull of run, a
  // later wait, and fetch. (With the note dropped on all three, both gates passed.) The job removes its input Mesh.dat
  // and writes mesh.dat, so the archive holds the other spelling whatever disk the host has.
  const RECASE = `import os\nopen("pid.txt", "w").write(str(os.getpid()))\nos.remove("Mesh.dat")\nopen("mesh.dat", "w").write("the job's mesh\\n")\nprint("recased")\n`;
  const recased = jobDir("recased"), recasedFetch = jobDir("recased-fetch");
  for (const d of [recased, recasedFetch]) { writeFileSync(join(d, "Mesh.dat"), "the caller's mesh\n"); writeFileSync(join(d, "sim.py"), RECASE); }
  const ONTO = /^simrun: 'mesh\.dat' from the archive was written onto 'Mesh\.dat', which .* already held: the two names differ only by letter case, and the disk of .* holds one name for both$/m;
  r = simrun(["run", recased, "--software", "calc", "--", "py", "sim.py"]);
  const recasedAgain = simrun(["wait", recased]);
  if (foldsCase)
    check("the caller of run is told when a pulled file went onto an entry of another letter case, and a later wait says it again",
      r.rc === 0 && ONTO.test(r.out) && recasedAgain.rc === 0 && ONTO.test(recasedAgain.out) && readFileSync(join(recased, "Mesh.dat"), "utf8") === "the job's mesh\n", `rc=${r.rc} ${r.out} ⏎ ${recasedAgain.out}`);
  else
    check("on a disk that tells the two names apart run pulls a second file and says nothing of the kind",
      r.rc === 0 && !/written onto/.test(r.out + recasedAgain.out) && readFileSync(join(recased, "Mesh.dat"), "utf8") === "the caller's mesh\n" && readFileSync(join(recased, "mesh.dat"), "utf8") === "the job's mesh\n", `rc=${r.rc} ${r.out}`);
  simrun(["run", recasedFetch, "--software", "calc", "--pull-limit-mb", "0", "--", "py", "sim.py"]);
  r = simrun(["fetch", recasedFetch, "mesh.dat"]);
  if (foldsCase)
    check("…and so is the caller of fetch", r.rc === 0 && /^simrun: fetched mesh\.dat /m.test(r.out) && ONTO.test(r.out) && readFileSync(join(recasedFetch, "Mesh.dat"), "utf8") === "the job's mesh\n", `rc=${r.rc} ${r.out}`);
  else
    check("…and fetch says nothing there either", r.rc === 0 && /^simrun: fetched mesh\.dat /m.test(r.out) && !/written onto/.test(r.out) && readFileSync(join(recasedFetch, "mesh.dat"), "utf8") === "the job's mesh\n", `rc=${r.rc} ${r.out}`);

  console.log("6. the remote command line");
  const calls = logged(SSH_LOG);
  const copy = `${HOSTWD}/.simrun/${sha(SIMRUN).slice(0, 12)}/simrun`;
  const shape = (a: string[]) => {
    const dd = a.indexOf("--"), opts = a.slice(0, dd).join(" ");
    const after = a.slice(dd + 2), h = after.indexOf("_host");
    return dd > 0 && a[dd + 1] === "looptest" && a.includes("-T") && ["BatchMode=yes", "ForwardAgent=no", "ConnectTimeout=10", "ServerAliveInterval=15", "ServerAliveCountMax=2"].every((o) => opts.includes(`-o ${o}`))
      && after.every((w) => SAFE.test(w)) && h === 2 && after[0] === PY && after[1] === copy && after.slice(h).every((w) => /^[A-Za-z0-9_.:\/-]+$/.test(w)) && after.length >= 4 && after.length <= 6;
  };
  const off = calls.filter((a) => !shape(a));
  // ForwardAgent=no on the command line, where no config file can override it: the machine that
  // drives this may hold keys to other servers, and agent-written scripts run on the host.
  check(`all ${calls.length} ssh invocations so far are -T, BatchMode, ForwardAgent=no, ConnectTimeout, the two ServerAlive options, "--" before the target, then <python> <host copy> _host <verb> <id> [small args]`, calls.length >= 30 && off.length === 0, JSON.stringify(off[0]));
  const verbs = new Set(calls.map((a) => a[a.indexOf("_host") + 1]));
  check("the verbs seen are the host verbs and nothing else", [...verbs].every((v) => ["hello", "start", "status", "wait", "cancel", "log", "pack", "fetchzip", "forget", "ps"].includes(v)) && verbs.has("start") && verbs.has("wait") && verbs.has("pack"), [...verbs].join(","));
  const scps = logged(SCP_LOG);
  check("scp is called with BatchMode and \"--\", and only ever to or from <workdir>/jobs/ or <workdir>/.simrun/", scps.length >= 10 && scps.every((a) => a.includes("BatchMode=yes") && a.includes("--")
    && a.slice(a.indexOf("--") + 1).filter((w) => w.startsWith("looptest:")).every((w) => w.startsWith(`looptest:${HOSTWD}/jobs/`) || w.startsWith(`looptest:${HOSTWD}/.simrun`) || w === `looptest:${HOSTWD}/`)), JSON.stringify(scps.find((a) => !a.includes("--"))));
  // The checks above only look at calls that were benign to begin with. These try the unsafe
  // thing: a job record whose id would mean something to a remote shell. It is planted in the
  // gate's own directory, compared as text, and run against stand-ins that connect to nothing.
  const marker = join(T, "pwned");
  const unsafeId = `x;touch\${IFS}${marker} $(id)`;
  const forged = jobDir("forged");
  mkdirSync(join(forged, ".simrun"));
  const tried: string[] = [];
  for (const final of [null, { state: "exited", exit: 0, reason: null, elapsed: 1, tail: [], notes: [], outputs: 0, left: 1 }]) {
    writeFileSync(join(forged, ".simrun", "job.json"), JSON.stringify({ job: unsafeId, host: "loop", software: "calc", command: ["py", "sim.py", "calc"], created: "2026-10-09T00:00:00Z", final }));
    for (const verb of [["status", forged], ["wait", forged], ["log", forged], ["cancel", forged], ["fetch", forged, "result.txt"]]) {
      const x = simrun(verb, VOID);
      if (x.rc !== 4 || LINE.test(x.last) || !/does not hold a job record simrun wrote/.test(x.out)) tried.push(`${verb[0]} (final ${final ? "set" : "null"}): rc=${x.rc} ${x.last}`);
    }
  }
  check("a job record with an id outside the id pattern is refused by status, wait, log, cancel and fetch, whether or not it claims to have ended", tried.length === 0, tried.join(" ⏎ "));
  check("…and not one word of it was handed to ssh or scp (fetch used to put the id into scp's remote path)", readFileSync(VOID_LOG, "utf8") === "" && !existsSync(marker), readFileSync(VOID_LOG, "utf8"));
  // The client's check is the first of three. The other two are asked directly, so that
  // removing one of them cannot hide behind the one in front of it.
  const direct = (args: string[]) => { try { return JSON.parse(spawnSync(PY, [hostCopy, "_host", ...args], { env: ENV, encoding: "utf8" }).stdout); } catch { return {}; } };
  const d1 = direct(["status", "x;y"]), d2 = direct(["log", "20261009T000000Z-0badc0de", "5;x"]);
  check("the host part refuses a job id or an argument outside its charset on its own", d1.ok === false && d1.error === "malformed host call: status x;y" && d2.ok === false && /^malformed host call: log /.test(d2.error ?? ""), JSON.stringify([d1, d2]));
  const inner = spawnSync(PY, ["-B", "-c", `
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader("simrun_under_test", sys.argv[1])
mod = importlib.util.module_from_spec(importlib.util.spec_from_file_location(loader.name, sys.argv[1], loader=loader))
loader.exec_module(mod)
host = {"label": "loop", "ssh": "looptest", "os": "posix", "python": ["python3"], "workdir": "/srv/w"}
for jid, args in (("x;y", ()), ("-", ("5;x",)), ("-", ("a b",)), ("-", ("5",))):
    try:
        mod.ssh_call(host, "status", jid, args)
        print("answered")
    except mod.Refuse:
        print("refused")
    except mod.Transport:
        print("called")
`, SIMRUN], { env: { ...ENV, ...VOID }, encoding: "utf8" });
  const handed = logged(VOID_LOG);
  check("the one remote command line refuses a word outside the safe charset before ssh is started, and passes a safe one on", inner.stdout.trim() === "refused\nrefused\nrefused\ncalled" && handed.length === 1 && handed[0].slice(-4).join(" ") === "_host status - 5", inner.stdout + inner.stderr + JSON.stringify(handed));
  writeFileSync(VOID_LOG, "");

  console.log("7. a dead connection is exit 5, and the job is still there afterwards");
  const fail255 = join(T, "fail255.sh"), fail1 = join(T, "fail1.sh");
  writeFileSync(fail255, "#!/bin/sh\necho 'ssh: connect to host 127.0.0.1 port 1: Connection refused' >&2\nexit 255\n"); chmodSync(fail255, 0o755);
  writeFileSync(fail1, "#!/bin/sh\necho 'scp: Connection closed' >&2\nexit 1\n"); chmodSync(fail1, 0o755);
  const down = jobDir("down");
  r = simrun(["run", down, "--software", "calc", "--", "py", "sim.py", "calc"], { SIMRUN_SSH: fail255 });
  check("run with ssh exiting 255: exit 5, the message names ssh and says nothing was started", r.rc === 5 && /^simrun: ssh to host "loop" failed \(exit 255: ssh: connect to host.*; nothing was started on the host$/.test(r.last), r.out);
  check("…and the directory is not left holding a job that never started", !existsSync(join(down, ".simrun", "job.json")));
  r = simrun(["run", down, "--software", "calc", "--", "py", "sim.py", "calc"], { SIMRUN_SCP: fail1 });
  check("run with scp failing: exit 5, the message names scp, and the input archive is not left in the directory", r.rc === 5 && /^simrun: scp with host "loop" failed \(exit 1: scp: Connection closed\); nothing was started on the host$/.test(r.last)
    && !existsSync(join(down, ".simrun", "job.json")) && !existsSync(join(down, ".simrun", "in.zip")), r.out);
  const jd = st(simrun(["start", down, "--software", "calc", "--", "py", "sim.py", "sleep", "1.5"])).job;
  r = simrun(["wait", down], { SIMRUN_SSH: fail255 });
  check("wait during an outage: exit 5, says the job may still be running and how to ask again", r.rc === 5 && r.last.includes(`job ${jd} may still be running on the host: simrun wait ${down}`), r.out);
  r = simrun(["wait", down, "--timeout", "30"]);
  check("the same wait once the connection is back: exit 0 with the results (an outage loses nothing)", r.rc === 0 && st(r).job === jd && st(r).state === "exited" && existsSync(join(down, "done.txt")), r.out);
  const sealed = jobDir("unreadable");
  writeFileSync(join(sealed, "secret.dat"), "not for this user\n");
  chmodSync(join(sealed, "secret.dat"), 0o000);
  r = simrun(["run", sealed, "--software", "calc", "--", "py", "sim.py", "calc"]);
  check("a file simrun cannot read is a refusal in one line that names it (exit 4, not a traceback with exit 1), and no half-made archive or claim is left", r.rc === 4 && !r.out.includes("Traceback") && r.out.trimEnd().split("\n").length === 1
    && /could not be packed for the host: .*secret\.dat/.test(r.out) && JSON.stringify(readdirSync(join(sealed, ".simrun"))) === JSON.stringify(["history"]), `rc=${r.rc} ${r.out} ${existsSync(join(sealed, ".simrun")) ? readdirSync(join(sealed, ".simrun")).join(",") : ""}`);
  chmodSync(join(sealed, "secret.dat"), 0o600);

  console.log("8. a client that changed while its job ran, and what a failed start left on the host");
  // The host part lives under the sha of the client file. Only start and doctor used to install
  // it, so after any edit to simrun every wait, status and cancel of a running job answered exit 5.
  const staleUpload = "20260901T000000Z-0badc0de", freshUpload = "20261009T000000Z-0badc0de";
  const hostFile = (name: string) => join(HOSTWD, "jobs", name);
  writeFileSync(hostFile(`${staleUpload}.in.zip`), "the archive of a start that failed before the host was asked\n");
  mkdirSync(hostFile(staleUpload));
  writeFileSync(join(hostFile(staleUpload), "half.txt"), "half an unpack\n");
  writeFileSync(hostFile(`${freshUpload}.in.zip`), "an upload that may still be in progress\n");
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  for (const f of [`${staleUpload}.in.zip`, staleUpload]) utimesSync(hostFile(f), twoDaysAgo, twoDaysAgo);
  const edited = join(T, "simrun-edited");
  copyFileSync(SIMRUN, edited);
  const ed = jobDir("edited-client");
  const je = st(simrun(["start", ed, "--software", "calc", "--", "py", "sim.py", "sleep", "4"], {}, 60_000, edited)).job;
  check("a start prunes what a failed start left on the host more than a day ago (it has no status, so the 7-day rule never saw it) and keeps a fresh upload", je !== "" && !existsSync(hostFile(`${staleUpload}.in.zip`)) && !existsSync(hostFile(staleUpload)) && existsSync(hostFile(`${freshUpload}.in.zip`)), readdirSync(join(HOSTWD, "jobs")).filter((f) => f.includes("0badc0de")).join(","));
  rmSync(hostFile(`${freshUpload}.in.zip`), { force: true });
  appendFileSync(edited, "\n# a later edit: a pull, a fix\n");
  r = simrun(["status", ed], {}, 60_000, edited);
  check("status from a client that was edited after the start answers (it installs its own host part and asks again)", r.rc === 0 && st(r).job === je && st(r).state === "running", `rc=${r.rc} ${r.out}`);
  r = simrun(["wait", ed, "--timeout", "30"], {}, 60_000, edited);
  check("…and wait brings the results back, exit 0", r.rc === 0 && st(r).state === "exited" && existsSync(join(ed, "done.txt")), `rc=${r.rc} ${r.out}`);
  check("both versions of the host part sit side by side on the host", JSON.stringify(readdirSync(join(HOSTWD, ".simrun")).sort()) === JSON.stringify(["000000000000", sha(SIMRUN).slice(0, 12), sha(edited).slice(0, 12)].sort()), readdirSync(join(HOSTWD, ".simrun")).join(","));

  console.log("9. seats, cancel and ps over ssh");
  const stamps = join(T, "stamps.txt");
  const sa = jobDir("seat-a"), sb = jobDir("seat-b");
  const ja = st(simrun(["start", sa, "--software", "seat1", "--", "py", "sim.py", "stamp", stamps, "A", "6"])).job;
  const jb = st(simrun(["start", sb, "--software", "seat1", "--", "py", "sim.py", "stamp", stamps, "B", "0.3"])).job;
  let waiting = { state: "", rest: "" };
  await until(() => { const x = st(simrun(["status", sb])); waiting = x; return x.rest !== "" || x.state !== "waiting_seat"; }, 5000);
  check("the second one-seat job is waiting_seat and names the holder", ja !== "" && jb !== "" && waiting.state === "waiting_seat" && waiting.rest === ` reason=seat_held_by:${ja}`, JSON.stringify(waiting));
  const ps = simrun(["ps", "loop"]);
  const row = (id: string) => ps.out.split("\n").find((l) => l.split(/\s+/)[1] === id) ?? "";      // by the job column: a waiter's row names its holder too
  check("ps lists the running job, the waiting one with its holder, and an ended one", ps.rc === 0 && /^loop\s/.test(row(ja)) && /\bseat1\s+running\b.*\bseat-1\b/.test(row(ja)) && row(jb).includes(`waits for ${ja}`) && /\bcalc\s+exited\b/.test(row(jd)), ps.out);
  const ra = simrun(["wait", sa, "--timeout", "30"]), rb = simrun(["wait", sb, "--timeout", "30"]);
  const order = existsSync(stamps) ? readFileSync(stamps, "utf8").trim().split("\n").map((l) => l.split(" ")) : [];
  check("both ran, and never at the same time (timestamps the jobs wrote on the host)", ra.rc === 0 && rb.rc === 0 && order.map((o) => o[0] + o[1]).join(" ") === "SA EA SB EB" && parseFloat(order[1][2]) <= parseFloat(order[2][2]), JSON.stringify(order) + ra.out + rb.out);
  const cj = jobDir("cancel-by-id");
  const jc = st(simrun(["start", cj, "--software", "seat1", "--", "py", "sim.py", "hold", "60"])).job;
  await until(() => existsSync(hostJob(jc, "pid.txt")) && readFileSync(hostJob(jc, "pid.txt"), "utf8") !== "", 8000);
  const cPid = existsSync(hostJob(jc, "pid.txt")) ? parseInt(readFileSync(hostJob(jc, "pid.txt"), "utf8"), 10) : 0;
  const seat = join(HOSTWD, "locks", "seat1", "seat-1");
  check("a sleeping job holds the seat on the host (owner.json names it)", cPid > 0 && pidAlive(cPid) && existsSync(join(seat, "owner.json")) && readJson(join(seat, "owner.json")).job === jc);
  r = simrun(["cancel", "--host", "loop", "--job", jc]);
  check("cancel --host --job: exit 0, the process is gone from the host, the seat directory is gone", r.rc === 0 && r.out.includes(`job ${jc} on host "loop" is cancelled`) && !pidAlive(cPid) && !existsSync(seat), r.out);
  r = simrun(["wait", cj]);
  rec = existsSync(join(cj, "simrun.json")) ? readJson(join(cj, "simrun.json")) : {};
  check("a wait in its directory reports cancelled, exit 1; nothing came back, not even the empty file it made (0 bytes fit every limit, the limit of 0 included), and what it wrote is listed as left on the host", r.rc === 1 && st(r).state === "cancelled" && rec.outputs?.length === 0
    && JSON.stringify(rec.left_on_host) === JSON.stringify([{ path: "pid.txt", bytes: String(cPid).length }, { path: "started.flag", bytes: 0 }]) && !existsSync(join(cj, "pid.txt")) && !existsSync(join(cj, "started.flag")), r.out + JSON.stringify(rec));
  r = simrun(["fetch", cj, "pid.txt"]);
  rec = readJson(join(cj, "simrun.json"));
  check("fetch brings a cancelled job's file back for inspection, and it still is not an output", r.rc === 0 && readFileSync(join(cj, "pid.txt"), "utf8") === String(cPid) && rec.outputs.length === 0 && rec.left_on_host.length === 2, r.out + JSON.stringify(rec));
  const cd = jobDir("cancel-by-dir");
  const jx = st(simrun(["start", cd, "--software", "seat1", "--", "py", "sim.py", "sleep", "60"])).job;
  await until(() => existsSync(hostJob(jx, "pid.txt")) && readFileSync(hostJob(jx, "pid.txt"), "utf8") !== "", 8000);
  const xPid = existsSync(hostJob(jx, "pid.txt")) ? parseInt(readFileSync(hostJob(jx, "pid.txt"), "utf8"), 10) : 0;
  r = simrun(["cancel", cd]);
  check("cancel <dir>: state=cancelled, the process is gone, the seat is free", r.rc === 0 && st(r).state === "cancelled" && xPid > 0 && !pidAlive(xPid) && !existsSync(seat), r.out);
  r = simrun(["run", cd, "--software", "seat1", "--seat-wait-minutes", "0.05", "--", "py", "sim.py", "calc"]);
  check("the next job on that seat runs at once", r.rc === 0 && st(r).state === "exited" && r.out.includes("| input was 1337"), r.out);
  // Luxas hands a foreground call back after 90 s while it keeps running, so an agent types
  // `simrun wait` while its first call is still collecting. Both used to pack into one archive
  // on the host and unpack into the same files; one answered exit 4, the other blamed scp.
  const many = jobDir("many");
  const jm = st(simrun(["start", many, "--software", "calc", "--", "py", "sim.py", "many"])).job;
  await until(() => st(simrun(["status", many])).state === "exited", 15_000);
  const scpBefore = logged(SCP_LOG).length;
  const waits = await Promise.all([0, 1].map(() => simrunAsync(["wait", many, "--timeout", "20"])));
  const pulls = logged(SCP_LOG).slice(scpBefore).filter((a) => a.some((w) => w.endsWith(`${jm}.out.zip`))).length;
  const parts = existsSync(many) ? readdirSync(many).filter((f) => /^part-\d\d\.bin$/.test(f) && statSync(join(many, f)).size === 200_000 && sha(join(many, f)) === sha(hostJob(jm, f))) : [];
  check("two waits typed at once on one ended job both report exited 0 with all 40 files intact, and the results are pulled once", jm !== "" && waits.every((w) => w.rc === 0 && st(w).state === "exited") && waits[0].last === waits[1].last
    && parts.length === 40 && pulls === 1 && !existsSync(join(many, ".simrun", "collecting")), `pulls=${pulls} files=${parts.length} ${waits.map((w) => `rc=${w.rc} ${w.out.trimEnd().split("\n").slice(-2).join(" / ")}`).join(" ⏎ ")}`);

  // A wait the caller left running comes back from its host wait after another call collected the job, the caller
  // edited a result, and the next job was started in the directory. It used to collect the first job again: pull its
  // files over the caller's and write its record over the running job's. Forced, not raced: the waiting call is
  // stopped once the shim has recorded its `_host wait`, and continued when the directory has moved on.
  const moved = jobDir("moved-on");
  const m1 = st(simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "sleep", "3"]));
  const lateWait = spawn(PY, [SIMRUN, "wait", moved, "--timeout", "60"], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let lateOut = "";
  lateWait.stdout.on("data", (b) => (lateOut += b)); lateWait.stderr.on("data", (b) => (lateOut += b));
  const lateDone = new Promise<number | null>((resolve) => lateWait.on("close", resolve));
  const inHostWait = await until(() => logged(SSH_LOG).some((a) => a.includes("wait") && a.includes(m1.job)), 10_000);
  process.kill(lateWait.pid ?? 0, "SIGSTOP");
  r = simrun(["wait", moved, "--timeout", "30"]);
  const pulledOnce = r.rc === 0 && st(r).job === m1.job && existsSync(join(moved, "done.txt")) && readFileSync(join(moved, "done.txt"), "utf8") === "done\n";
  writeFileSync(join(moved, "done.txt"), "edited by the caller after job 1\n");
  const m2 = st(simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "sleep", "30"]));
  const scpMoved = logged(SCP_LOG).length;
  process.kill(lateWait.pid ?? 0, "SIGCONT");
  const lateRc = await lateDone;
  const movedJob = existsSync(join(moved, ".simrun", "job.json")) ? readJson(join(moved, ".simrun", "job.json")) : {};
  const lateLine = (lateOut.trimEnd().split("\n").pop() ?? "").match(LINE);
  check("a wait that comes back after its job was collected and the next one started leaves job.json to the next job",
    inHostWait && pulledOnce && m2.state === "running" && m2.job !== m1.job && movedJob.job === m2.job && movedJob.final === null, `in host wait=${inHostWait} first ${m1.job} second ${m2.job} job.json ${JSON.stringify(movedJob)}`);
  check("…pulls nothing again: the file the caller edited in between is as the caller left it, and no scp ran",
    readFileSync(join(moved, "done.txt"), "utf8") === "edited by the caller after job 1\n" && logged(SCP_LOG).length === scpMoved, `done.txt=${JSON.stringify(readFileSync(join(moved, "done.txt"), "utf8"))} scp calls since=${logged(SCP_LOG).length - scpMoved}`);
  check("…and reports the job it waited for (exited 0) from that job's history record, naming the job the directory holds now",
    lateRc === 0 && lateLine?.[1] === "exited" && lateLine?.[5] === m1.job && lateOut.includes(`was collected by another call and its record is ${join(moved, ".simrun", "history", `${m1.job}.json`)}`) && lateOut.includes(`the job of ${moved} is now ${m2.job}`), lateOut);
  check("…status follows the running job, and a further start is still refused while it runs",
    st(simrun(["status", moved])).job === m2.job && (r = simrun(["start", moved, "--software", "calc", "--", "py", "sim.py", "calc"])).rc === 4 && r.out.includes(`job ${m2.job} is still active in ${moved}`), r.out);
  simrun(["cancel", "--host", "loop", "--job", m2.job]);      // by id: the directory's record is what was under test

  console.log("9b. a doctor that is running, or one that failed, does not cut off a job that is already on the host");
  {
    // doctor writes ok:false for the host before its first check and leaves it there when it fails. wait, status and
    // cancel answered "has not passed" for that whole time: a running job could be neither collected nor cancelled, and
    // when it held the seat a declared check needed, doctor could not pass until the job had ended on its own. The
    // record written below is the one doctor writes at its start.
    const heldDir = jobDir("held-through-doctor");
    const jh = st(simrun(["start", heldDir, "--software", "seat1", "--", "py", "sim.py", "sleep", "40"])).job;
    await until(() => existsSync(hostJob(jh, "pid.txt")) && readFileSync(hostJob(jh, "pid.txt"), "utf8") !== "", 8000);
    const hPid = existsSync(hostJob(jh, "pid.txt")) ? parseInt(readFileSync(hostJob(jh, "pid.txt"), "utf8"), 10) : 0;
    const byIdDir = jobDir("held-by-id");
    const jbi = st(simrun(["start", byIdDir, "--software", "calc", "--", "py", "sim.py", "sleep", "40"])).job;
    await until(() => existsSync(hostJob(jbi, "pid.txt")) && readFileSync(hostJob(jbi, "pid.txt"), "utf8") !== "", 8000);
    const bPid = existsSync(hostJob(jbi, "pid.txt")) ? parseInt(readFileSync(hostJob(jbi, "pid.txt"), "utf8"), 10) : 0;
    check("two jobs were accepted while the host had passed, one holding the seat of seat1", hPid > 0 && bPid > 0 && pidAlive(hPid) && pidAlive(bPid) && readFileSync(bookPath, "utf8") === passBytes);
    withEntry((e) => { e.ok = false; e.checked = []; });
    const freshDir = jobDir("fresh-while-failed");
    let sshSeen = logged(SSH_LOG).length;
    r = simrun(["run", freshDir, "--software", "calc", "--", "py", "sim.py", "calc"]);
    check("with ok:false on record a new job is refused as before, and the host is not contacted for it", r.rc === 4 && r.out.trimEnd() === refusal && logged(SSH_LOG).length === sshSeen && !existsSync(join(freshDir, ".simrun", "job.json")), r.out);
    r = simrun(["status", heldDir]);
    check("status of a job accepted before answers: exit 0, state=running", r.rc === 0 && st(r).state === "running" && st(r).job === jh, r.out);
    r = simrun(["wait", heldDir, "--timeout", "1"]);
    check("wait answers exit 3 with the state line and next=", r.rc === 3 && st(r).state === "running" && r.last.includes('next="simrun wait '), r.out);
    r = simrun(["log", heldDir]);
    check("log answers exit 0", r.rc === 0, r.out);
    r = simrun(["ps", "loop"]);
    check("ps lists the job with the seat it holds (after a doctor that found no seat, this is where the operator sees who has it)", r.rc === 0 && new RegExp(`^loop\\s+${jh}\\s+seat1\\s+running\\s+\\d+s\\s+seat-1\\b`, "m").test(r.out), r.out);
    r = simrun(["cancel", heldDir]);
    check("cancel <dir> ends it: state=cancelled, the process is gone, the seat is free for doctor's check", r.rc === 0 && st(r).state === "cancelled" && !pidAlive(hPid) && !existsSync(join(HOSTWD, "locks", "seat1", "seat-1")), r.out);
    r = simrun(["fetch", heldDir, "pid.txt"]);
    check("fetch brings back a file the cancelled job left on the host", r.rc === 0 && existsSync(join(heldDir, "pid.txt")) && readFileSync(join(heldDir, "pid.txt"), "utf8") === String(hPid), r.out);
    r = simrun(["cancel", "--host", "loop", "--job", jbi]);
    check("cancel --host --job ends the other by id", r.rc === 0 && r.out.includes(`job ${jbi} on host "loop" is cancelled`) && !pidAlive(bPid), r.out);
    r = simrun(["wait", byIdDir]);
    check("…and a wait in its directory collects the cancelled state", r.rc === 1 && st(r).state === "cancelled", r.out);
    // A record made for another protocol or another host entry is still no host at all: nothing is sent.
    writeFileSync(bookPath, passBytes);
    const neverDir = jobDir("held-under-another-protocol");
    const jn = st(simrun(["start", neverDir, "--software", "calc", "--", "py", "sim.py", "sleep", "40"])).job;
    await until(() => existsSync(hostJob(jn, "pid.txt")) && readFileSync(hostJob(jn, "pid.txt"), "utf8") !== "", 8000);
    const nPid = existsSync(hostJob(jn, "pid.txt")) ? parseInt(readFileSync(hostJob(jn, "pid.txt"), "utf8"), 10) : 0;
    withEntry((e) => { e.protocol = 0; });
    sshSeen = logged(SSH_LOG).length;
    const never = [["status", neverDir], ["wait", neverDir, "--timeout", "1"], ["cancel", neverDir], ["cancel", "--host", "loop", "--job", jn]].map((a) => simrun(a));
    r = simrun(["ps", "loop"]);
    check("under a record made for another protocol status, wait and both cancels are refused with the spec's sentence, ps does not ask, and nothing is sent; the job runs on",
      never.every((x) => x.rc === 4 && x.out.trimEnd() === refusal) && /host "loop" is not asked/.test(r.out) && logged(SSH_LOG).length === sshSeen && nPid > 0 && pidAlive(nPid), never.map((x) => `rc=${x.rc} ${x.out}`).join(" ⏎ ") + r.out);
    writeFileSync(bookPath, passBytes);
    r = simrun(["cancel", neverDir]);
    check("with the pass back it is cancelled", r.rc === 0 && st(r).state === "cancelled" && !pidAlive(nPid), r.out);
    check("the record is back as doctor wrote it", readFileSync(bookPath, "utf8") === passBytes);
  }

  console.log("10. nothing is left behind");
  const sshdPid = parseInt(readFileSync(join(T, "sshd.pid"), "utf8"), 10);
  const left = () => strays().filter((p) => p !== watchdog?.pid && p !== sshdPid);
  await until(() => left().length === 0, 3000);
  const leftNow = left();
  check("no job, supervisor or ssh process is left running (only the sshd, which is stopped next)", leftNow.length === 0 && pidAlive(sshdPid), processes().filter((l) => leftNow.includes(parseInt(l.trim(), 10))).join(" | "));
  check("simrun wrote nothing under ~/.sisyphus", !existsSync(join(T, "home", ".sisyphus")));
} catch (e: any) {
  failures++;
  console.log(`  ✗ the gate could not finish — ${String(e?.message ?? e).replace(/\s*\n\s*/g, " ⏎ ").slice(0, 900)}`);
} finally {
  stopSshd();
  if (watchdog?.pid) { try { process.kill(-watchdog.pid, "SIGKILL"); } catch { /* already gone */ } }
  await sleep(200);
  for (const pid of strays()) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  rmSync(T, { recursive: true, force: true });
}
console.log(failures === 0 ? `\nsmoke_simrun_ssh: all ${checks} checks passed` : `\nsmoke_simrun_ssh: ${failures} of ${checks} FAILED`);
process.exit(failures === 0 ? 0 : 1);
