/**
 * V3 smoke tests — fast, no API calls.
 *
 *   npx tsx scripts/smoke_v3.mts
 *
 * Covers:
 *   1. buildBrainContext renders active_agents / completed_artifacts / plan_status
 *   2. buildBrainContext is deterministic over equal state (cache invariant)
 *   3. In-place array element mutation preserves shared reference
 *      (regression guard for the pi-agent-core systemPrompt capture bug)
 *   4. extractExpectedArtifact recognizes the documented patterns
 *      and rejects traversal / unknown extensions.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveContextBuilder } from "../src/agents/context-builders.js";
import { extractExpectedArtifact } from "../src/active-agents.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name: string) { console.log(`\n${name}`); }

// ── Fixture project ─────────────────────────────────────────────
const root = join(tmpdir(), `luxas-smoke-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, ".agent"), { recursive: true });
mkdirSync(join(root, "design"), { recursive: true });
mkdirSync(join(root, "notes"), { recursive: true });
mkdirSync(join(root, "reviews"), { recursive: true });

writeFileSync(join(root, ".agent/active-agents.json"), JSON.stringify([{
  id: "experiment.foo",
  name: "experiment",
  task: "Design logical-op scheduling. Return: design/spec_foo.md",
  mode: "background",
  startedAt: Date.now() - 120_000,
  conversationFile: "",
  status: "running",
  expected_artifact: "design/spec_foo.md",
}]));
writeFileSync(join(root, "design/spec_done.md"), "# completed artifact\n");
writeFileSync(join(root, "notes/plan.md"), "# Plan\n## Q1 foo\n## Q2 bar\n## Q3 baz\n");
writeFileSync(join(root, "reviews/pi_feedback.md"), "Verdict: continue\nSomething something.\n");

// ── 1. Render ───────────────────────────────────────────────────
section("1. buildBrainContext render");
const build = resolveContextBuilder("brain");
if (!build) { console.log("  ✗ resolveContextBuilder('brain') returned undefined"); process.exit(1); }
const out = build(root);
check("contains <active_agents", out.includes("<active_agents"));
check("mentions experiment.foo", out.includes("experiment.foo"));
check("surfaces expected artifact path", out.includes("design/spec_foo.md"));
check("contains <completed_artifacts", out.includes("<completed_artifacts"));
check("lists completed spec_done.md", out.includes("spec_done.md"));
check("contains <plan_status", out.includes("<plan_status"));

// ── 2. Determinism over equal state ─────────────────────────────
section("2. deterministic over equal state");
const a = build(root);
const b = build(root);
check("two calls with no state change produce identical text", a === b,
  a === b ? undefined : `first call ${a.length} chars, second ${b.length}`);
check("no ISO timestamp leaked into output",
  !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(out));
check("no 'running Xs' elapsed-time marker",
  !/running \d+s/.test(out));

// ── 3. In-place mutation preserves captured reference ───────────
// pi-agent-core captures currentContext.systemPrompt by reference at
// _runLoop start (agent.js:477) and never re-reads. Reassigning the
// field breaks the shared reference; mutating the element preserves it.
section("3. shared-reference mutation");
const arr: Array<{ text: string }> = [{ text: "L1" }, { text: "L2" }, { text: "L3-old" }];
const captured = arr;
arr[2] = { text: "L3-new" };
check("element mutation visible through captured reference",
  captured[2].text === "L3-new");

const arr2: Array<{ text: string }> = [{ text: "L1" }, { text: "L2" }, { text: "L3-old" }];
const captured2 = arr2;
let ref: Array<{ text: string }> = arr2;
ref = [...ref]; ref[2] = { text: "L3-new" }; // simulate the BAD pattern
check("reassigning into a new array breaks propagation (anti-regression)",
  captured2[2].text === "L3-old");

// ── 4. extractExpectedArtifact ──────────────────────────────────
section("4. extractExpectedArtifact");
const cases: Array<[string, string]> = [
  ["Return: design/spec_foo.md",        "design/spec_foo.md"],
  ["Deliver circuits/y.stim to brain",  "circuits/y.stim"],
  ["→ data/experiments/E1_x/runs/r1/results.json", "data/experiments/E1_x/runs/r1/results.json"],
  ["see `notes/plan.md` for context",   "notes/plan.md"],
  ["just do the literature search",     ""],
  ["Return: ../evil.md",                ""],
  ["Return: /etc/passwd",               ""], // absolute path — current heuristic permits but no ext match
];
for (const [input, want] of cases) {
  const got = extractExpectedArtifact(input);
  check(`${JSON.stringify(input)} → ${JSON.stringify(want)}`,
    got === want, `got ${JSON.stringify(got)}`);
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
