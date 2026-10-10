/**
 * Brain-context smoke tests — fast, no API calls.
 *
 *   npx tsx scripts/smoke_brain_context.mts
 *
 * Covers:
 *   1. buildBrainContext renders active_agents / completed_artifacts / plan_status
 *   2. buildBrainContext is deterministic over equal state (cache invariant)
 *   3. In-place array element mutation preserves shared reference
 *      (regression guard for the pi-agent-core systemPrompt capture bug)
 *   4. extractExpectedArtifact recognizes the documented patterns
 *      and rejects traversal / unknown extensions.
 *   5. C27: literature / methodology reach the brain trailer, the experiment
 *      context and the PI context as constant-size pointers, never as the
 *      tail of notes/literature.md or notes/methodology.md.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveContextBuilder } from "../src/agents/context-builders.js";
import { extractExpectedArtifact } from "../src/active-agents.js";
import { buildContextTransformer } from "../src/context.js";

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

// ── 5. C27: literature / methodology as pointers ────────────────
// smartTruncate keeps a file's TAIL: for literature.md that is the last-merged
// paper's Limitations, for methodology.md the "Papers processed" ledger — the
// least load-bearing text, and it grows with the corpus. The fixture uses FEW
// headers with long bodies on purpose: with many headers smartTruncate's TOC
// eats the budget and the tail never shows, which is how this went unseen.
section("5. C27 literature/methodology are pointers, not file tails");

async function trailerOf(dir: string): Promise<string> {
  const { transformContext } = buildContextTransformer({ projectDir: dir });
  const msgs = await transformContext([
    { role: "user", content: "a", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "b" }], timestamp: 2 },
    { role: "user", content: "c", timestamp: 3 },
  ]);
  return String(msgs[msgs.length - 1].content);
}

// Anchored at a line start: PI_RESEARCH_MODE names `<field_methodology_standard>`
// in prose above the block, and an unanchored match would measure from there.
function tagBlock(text: string, tag: string): string {
  return (text.match(new RegExp(`(?<=^|\\n)<${tag}[^>\\n]*>[\\s\\S]*?</${tag}>`)) ?? [""])[0];
}

function c27Fixture(nEntries: number): string {
  const dir = join(tmpdir(), `luxas-c27-${nEntries}-${Date.now()}`);
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "notes/literature.d"), { recursive: true });
  mkdirSync(join(dir, "notes/methodology.d"), { recursive: true });
  mkdirSync(join(dir, "data/papers"), { recursive: true });
  writeFileSync(join(dir, "RESEARCH.md"), "# Goal\nMeasure the thing.\n");
  const keys = Array.from({ length: nEntries },
    (_, i) => i === nEntries - 1 ? "Wu2022" : `Key${String(i).padStart(3, "0")}`);
  // ~100 KB literature.md whatever the entry count.
  const per = Math.ceil(100_000 / nEntries);
  let lit = "# Literature Notes\n\n";
  for (const k of keys) {
    writeFileSync(join(dir, `notes/literature.d/${k}.md`), `### ${k}\n- **Core claim**: ${k}.\n`);
    writeFileSync(join(dir, `notes/methodology.d/${k}.md`), `## A. Theoretical quantities computed\n- ${k}\n`);
    lit += `### ${k}\n- **Core claim**: ${"x".repeat(per)}\n`;
  }
  lit += "- **Limitations**: Wu2022 LAST_PAPER_LIMITATIONS_SENTENCE.\nSENTINEL_LIT_TAIL\n";
  writeFileSync(join(dir, "notes/literature.md"), lit);
  let meth = "# Methodology\n\n## A. Theoretical quantities computed\n";
  for (let j = 0; j < 300; j++) meth += `- METH_A_BULLET_${j} ${"y".repeat(80)}\n`;
  meth += "\n## Papers processed\n";
  for (const k of keys) meth += `- ${k} — contributed: something\n`;
  meth += "SENTINEL_METH_TAIL\n";
  writeFileSync(join(dir, "notes/methodology.md"), meth);
  return dir;
}

{
  const small = c27Fixture(3), large = c27Fixture(300);
  const tS = await trailerOf(small), tL = await trailerOf(large);
  const exp = resolveContextBuilder("experiment")!;
  const pi = resolveContextBuilder("reviewer")!;
  const eS = exp(small, {}), eL = exp(large, {});
  const pS = pi(small, {}), pL = pi(large, {});
  for (const [name, t] of [["brain trailer", tS], ["experiment ctx", eS], ["PI ctx", pS]] as const) {
    check(`C27 ${name}: no literature.md tail sentinel`, !t.includes("SENTINEL_LIT_TAIL"));
    check(`C27 ${name}: no last-paper Limitations sentence`, !t.includes("LAST_PAPER_LIMITATIONS_SENTENCE"));
    check(`C27 ${name}: no methodology.md tail sentinel`, !t.includes("SENTINEL_METH_TAIL"));
  }
  check("C27 brain trailer names notes/literature.d/",
    tagBlock(tS, "literature_notes").includes("notes/literature.d"));
  check("C27 brain trailer names notes/methodology",
    /notes\/methodology/.test(tagBlock(tS, "field_methodology_standard")));
  check("C27 experiment ctx names notes/literature.d/",
    tagBlock(eS, "literature_notes").includes("notes/literature.d"));
  // PI_RESEARCH_MODE and the <project_code> preamble refer to this tag by name.
  check("C27 PI keeps the <field_methodology_standard> tag its prompt references",
    tagBlock(pS, "field_methodology_standard").length > 0);
  const litMeth = (t: string) =>
    tagBlock(t, "literature_notes").length + tagBlock(t, "field_methodology_standard").length;
  check("C27 brain: literature+methodology blocks ≤ 800 chars", litMeth(tS) <= 800, `${litMeth(tS)}`);
  check("C27 brain: blocks do not grow with paper count (3 vs 300 entries, ≤ 10 chars)",
    Math.abs(litMeth(tL) - litMeth(tS)) <= 10, `${litMeth(tS)} vs ${litMeth(tL)}`);
  check("C27 brain: whole trailer does not grow with paper count",
    Math.abs(tL.length - tS.length) <= 10, `${tS.length} vs ${tL.length}`);
  const eLitS = tagBlock(eS, "literature_notes").length, eLitL = tagBlock(eL, "literature_notes").length;
  check("C27 experiment: literature block ≤ 400 chars and constant",
    eLitS <= 400 && Math.abs(eLitL - eLitS) <= 10, `${eLitS} vs ${eLitL}`);
  const pMethS = tagBlock(pS, "field_methodology_standard").length;
  const pMethL = tagBlock(pL, "field_methodology_standard").length;
  check("C27 PI: methodology block ≤ 1500 chars and constant",
    pMethS <= 1500 && Math.abs(pMethL - pMethS) <= 10, `${pMethS} vs ${pMethL}`);
  // The unledgered-paper prompt is a dispatch instruction, not a file tail: kept.
  mkdirSync(join(small, "data/papers/9999.99999"), { recursive: true });
  writeFileSync(join(small, "data/papers/9999.99999/main.tex"), "x");
  check("C27 <unprocessed_papers> still emitted for an unledgered paper",
    (await trailerOf(small)).includes("<unprocessed_papers>"));
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
