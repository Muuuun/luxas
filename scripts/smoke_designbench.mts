#!/usr/bin/env tsx
/**
 * smoke_designbench — the na-advantage grader against designs whose numbers are known.
 *
 * designbench/na-advantage scores a neutral-atom advantage design by recomputing
 * its fidelity, run time and classical cost from design.json. A grader that
 * passes a wrong design makes every score built on it noise, so
 * _lib/make_refs.py builds three references and six planted designs. Each
 * planted design fails exactly the check it was built to fail. The references'
 * budgets are worked out a second time by hand (make_refs.analytic_budget),
 * and budget.py has to agree with that.
 *
 * The tensor-network search takes minutes, so it is read from the committed
 * cache (reference/tn_cache.json). Everything here runs on the system python3
 * with the standard library. The search itself needs the designbench venv and
 * is refreshed by hand (designbench/README.md).
 *
 *   npx tsx scripts/smoke_designbench.mts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutSiteNoise } from "./python-site-noise.mts";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = join(ROOT, "designbench");
const BENCH = join(DB, "na-advantage");
const REF = join(BENCH, "reference");
const CACHE = join(REF, "tn_cache.json");
const tmp = mkdtempSync(join(tmpdir(), "luxas-designbench-"));

function py(args: string[], input?: string) {
  // -B: no __pycache__ next to input/compile.py, which bench_run would copy into runs (checked in 7)
  const r = spawnSync("python3", ["-B", ...args], { cwd: ROOT, encoding: "utf-8", input, timeout: 120_000 });
  return { code: r.status, out: withoutSiteNoise((r.stdout ?? "") + (r.stderr ?? "")) };
}
function grade(target: string): any {
  const r = py([join(DB, "_lib", "grade.py"), target, "--no-search", "--cache", CACHE, "--json"]);
  try { return JSON.parse(r.out); } catch { return { parseError: r.out.slice(0, 400) }; }
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const expected = JSON.parse(readFileSync(join(REF, "expected.json"), "utf-8"));

console.log("0. a python that prints site's .pth error on start (the droplet's) is not the grader's output");
{
  const block = "Error processing line 1 of /usr/lib/python3/dist-packages/x-nspkg.pth:\n\n  Traceback (most recent call last):\n    File \"<frozen site>\", line 201, in addpackage\n  AttributeError: 'NoneType' object has no attribute 'loader'\n\nRemainder of file ignored\n";
  const own = "Traceback (most recent call last):\n  File \"grade.py\", line 3, in <module>\nValueError: bad design\n";
  check("the site .pth block is removed, wherever it sits", JSON.stringify(JSON.parse(withoutSiteNoise('{"S": 1.7}\n' + block))) === '{"S":1.7}' && withoutSiteNoise(block + "x\n" + block) === "x\n");
  check("…and a traceback of the program's own is kept", withoutSiteNoise(own + block) === own);
}

console.log("1. the committed references are what make_refs.py builds");
{
  const r = py([join(DB, "_lib", "make_refs.py"), "--check"]);
  check("make_refs --check: designs, expected.json and search cache are current", r.code === 0, r.out.trim());
  const cmp = py(["-c", "import sys; sys.path.insert(0, sys.argv[1]); from make_refs import same; print(same(1.666180026783073, 1.6661800267830729), same(1.6662, 1.666180026783073), same({'a': [1.0, True]}, {'a': [1.0, 1]}))", join(DB, "_lib")]);
  check("…where a last-bit float difference (another python or numpy) is current, and a 1e-5 change or a bool for a number is stale", cmp.out.trim() === "True False False", cmp.out.trim());
}

console.log("2. each design grades as built");
const graded: Record<string, any> = {};
for (const [name, exp] of Object.entries<any>(expected.designs)) {
  const g = grade(join(REF, name));
  graded[name] = g;
  if (g.parseError) { check(`${name}: grader output parses`, false, g.parseError); continue; }
  check(`${name}: feasible=${exp.feasible}${exp.failure ? `, fails ${exp.failure}` : ""}`,
    g.feasible === exp.feasible && (exp.failure ?? null) === (g.failure ?? null),
    `got feasible=${g.feasible} failure=${g.failure} checks=${JSON.stringify(g.checks)}`);
  if (exp.message) check(`${name}: the refusal says "${exp.message}"`, String(g.checks?.compile ?? "").includes(exp.message), g.checks?.compile);
  if (exp.analytic && g.budget) {
    const a = exp.analytic, b = g.budget;
    const worst = Math.max(...["fidelity", "keep_probability", "cycle_time_s", "quantum_time_s", "errors_per_cycle_max", "circuit_us"]
      .map((k) => rel(b[k], a[k])));
    check(`${name}: budget.py agrees with the hand count (worst relative difference ${worst.toExponential(1)})`,
      worst < 1e-9 && b.kept_samples === a.kept_samples, JSON.stringify({ budget: b, analytic: a }));
  }
  if (exp.method) check(`${name}: cheapest attack is ${exp.method}`, g.classical?.method === exp.method, g.classical?.method);
  if (exp.score_below !== undefined) check(`${name}: S < ${exp.score_below}`, typeof g.score === "number" && g.score < exp.score_below, String(g.score));
  if (exp.claims) {
    const got = Object.fromEntries(Object.entries<any>(g.claims ?? {}).map(([k, v]) => [k, v.status]));
    check(`${name}: exactly the planted claims are flagged`, JSON.stringify(got) === JSON.stringify(exp.claims), JSON.stringify(got));
  }
  if (name.startsWith("ref-")) {
    check(`${name}: scored, by tensor network`, typeof g.score === "number" && g.classical?.method === "tensor-network",
      `score=${g.score} method=${g.classical?.method} (no cache entry? see designbench/README.md)`);
    const bad = Object.entries<any>(g.claims ?? {}).filter(([, v]) => v.status === "inconsistent").map(([k]) => k);
    check(`${name}: its own claims are consistent`, bad.length === 0, bad.join(", "));
  }
}

console.log("3. the references order as the physics says");
{
  const s = (n: string) => graded[n]?.score as number;
  const [grid, cube, deep] = [s("ref-grid-rcs"), s("ref-hypercube-rcs"), s("ref-hypercube-deep")];
  check(`grid RCS has no advantage (S=${grid?.toFixed(2)})`, grid < 0);
  check(`hypercube beats the grid by at least a decade (${cube?.toFixed(2)} vs ${grid?.toFixed(2)})`, cube - grid >= 1);
  check(`the deeper hypercube beats the shallow one by at least a decade (${deep?.toFixed(2)} vs ${cube?.toFixed(2)})`, deep - cube >= 1);
}

console.log("4. compile.py, the agent's copy, runs on the system python and agrees with the grader");
for (const name of Object.keys(expected.designs)) {
  const r = py([join(BENCH, "input", "compile.py"), join(REF, name, "design.json")]);
  const wantOk = name !== "bad-blockade";
  check(`${name}: compile.py says ${wantOk ? "OK" : "ERROR"}`, wantOk ? r.out.startsWith("OK:") && r.code === 0 : r.out.startsWith("ERROR:") && r.code === 1, r.out.trim());
}
{
  const dump = join(tmp, "dump.json");
  py([join(BENCH, "input", "compile.py"), join(REF, "ref-hypercube-deep", "design.json"), "--dump", dump]);
  const viaCli = existsSync(dump) ? JSON.parse(readFileSync(dump, "utf-8")) : null;
  const r = py(["-c", [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location('c', ${JSON.stringify(join(BENCH, "input", "compile.py"))})`,
    "c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)",
    `d = json.load(open(${JSON.stringify(join(REF, "ref-hypercube-deep", "design.json"))}))`,
    "x = c.expand(d, c.load_hardware())",
    "print(json.dumps({k: x[k] for k in ('n', 'atoms', 'steps')}))",
  ].join("\n")]);
  check("--dump writes the same expansion the grader grades", viaCli !== null && JSON.stringify(viaCli) === JSON.stringify(JSON.parse(r.out)));
}

console.log("5. local_random draws exactly what FORMAT.md says");
{
  const design = {
    format: "atomx/1", atoms: [[0, 0], [10, 0], [20, 0]],
    program: [{ op: "repeat", times: 3, body: [
      { op: "local_random", set: ["SX", "SY", "SW"], seed: 5, no_repeat: true },
      { op: "local_random", set: ["T", "H"], atoms: [0, 2], seed: 9 },
    ] }],
  };
  const f = join(tmp, "rng.json");
  writeFileSync(f, JSON.stringify(design));
  const dump = join(tmp, "rng-dump.json");
  py([join(BENCH, "input", "compile.py"), f, "--dump", dump]);
  const got = JSON.parse(readFileSync(dump, "utf-8")).steps.map((s: any) => s.gates);
  // FORMAT.md's procedure, written out again from the text, not from compile.py.
  const r = py(["-c", [
    "import json, random",
    "last = [None] * 3; out = []; runs = {}",
    "entries = [(['SX', 'SY', 'SW'], [0, 1, 2], 5, True, 'a'), (['T', 'H'], [0, 2], 9, False, 'b')]",
    "for rep in range(3):",
    "    for gs, atoms, seed, nr, key in entries:",
    "        n = runs.get(key, 0); runs[key] = n + 1",
    "        rng = random.Random(f'{seed}:{n}'); step = []",
    "        for a in atoms:",
    "            cands = [g for g in gs if not (nr and last[a] == g)]",
    "            g = cands[rng.randrange(len(cands))]; last[a] = g; step.append([a, g])",
    "        out.append(step)",
    "print(json.dumps(out))",
  ].join("\n")]);
  let want: unknown = null;
  try { want = JSON.parse(r.out); } catch { /* reported below */ }
  check("the documented procedure reproduces every drawn gate", JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} vs ${r.out.trim()}`);
}

console.log("6. malformed designs are refused with a pointer to the legal word");
{
  const base = { format: "atomx/1", atoms: [[0, 0], [10, 0]], program: [{ op: "rydberg" }] };
  const cases: [string, any, string][] = [
    ["misspelt top-level key", { ...base, atom: [] }, "did you mean 'atoms'"],
    ["misspelt op", { ...base, program: [{ op: "ryd" }] }, "did you mean 'rydberg'"],
    ["misspelt gate", { ...base, program: [{ op: "global", gate: "SXX" }] }, "did you mean 'SX'"],
    ["move without dy", { ...base, program: [{ op: "move", x: "all", y: "all", dx: 5 }] }, "missing 'dy'"],
    ["misspelt claim", { ...base, claims: { fidelty: 1 } }, "did you mean 'fidelity'"],
    ["atom off the site grid", { ...base, atoms: [[0, 0], [5, 0]] }, "not a trap site"],
    ["three atoms in one blockade radius", { format: "atomx/1", atoms: [[0, 0], [10, 0], [20, 0]],
      program: [{ op: "move", x: [0], y: "all", dx: 9, dy: 0 }, { op: "move", x: [20], y: "all", dx: -9, dy: 0 }, { op: "rydberg" }] },
      "entangles atoms in pairs only"],
  ];
  for (const [label, d, frag] of cases) {
    const f = join(tmp, "bad.json");
    writeFileSync(f, JSON.stringify(d));
    const r = py([join(BENCH, "input", "compile.py"), f]);
    check(`${label}: ERROR mentions "${frag}"`, r.code === 1 && r.out.includes(frag), r.out.trim());
  }
}

console.log("7. what an agent is given");
{
  const given = readdirSync(join(BENCH, "input")).sort();
  check("input/ holds the brief's four files and nothing of the grader",
    JSON.stringify(given) === JSON.stringify(["FORMAT.md", "MACHINE.md", "compile.py", "hardware.json"]), given.join(", "));
  const hw = JSON.parse(readFileSync(join(BENCH, "input", "hardware.json"), "utf-8"));
  const doc = readFileSync(join(BENCH, "input", "MACHINE.md"), "utf-8");
  const stale = [...Object.entries<number>(hw.error), ...Object.entries<number>(hw.loss)]
    .filter(([, v]) => !doc.includes(v.toExponential(1))).map(([k]) => k);
  check("MACHINE.md states every error and loss rate in hardware.json", stale.length === 0, stale.join(", "));
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
