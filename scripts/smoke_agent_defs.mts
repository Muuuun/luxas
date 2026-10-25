#!/usr/bin/env tsx
/**
 * Smoke: agent definitions load and resolve wrappers/builders.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefinition, loadAgentDefinitions, resolvePrompt, soloExperimentDefinition } from "../src/agents/registry.js";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { resolveContextBuilder } from "../src/agents/context-builders.js";
import { expandTemplate } from "../src/utils.js";
import { reportIntegrityIssues } from "../src/tools/report-integrity.js";
import { createPIReviewTool } from "../src/pi-agent.js";
import { openReviewFindings, persistReview, reviewOpenIssues } from "../src/claims-review.js";
import { buildBudgetStatus } from "../src/context.js";
import { buildResearchHooks, finalizationAllows } from "../src/hooks.js";

const defs = loadAgentDefinitions();
const checked = ["brain", "experiment", "tool_impl", "tool_review", "typesetter", "contradiction_auditor", "prior_art_auditor"];
let failures = 0;

for (const name of checked) {
  const d = defs.get(name);
  if (!d) {
    console.log(`FAIL missing definition: ${name}`);
    failures++;
    continue;
  }
  const sw = buildSafetyWrapper(d.safety);
  const cb = resolveContextBuilder(d.contextBuilder);
  const swTag = d.safety ? (sw ? "OK" : "MISSING") : "(none)";
  const cbTag = d.contextBuilder ? (cb ? "OK" : "MISSING") : "(none)";
  if (d.safety && !sw) failures++;
  if (d.contextBuilder && !cb) failures++;
  console.log(`${name.padEnd(14)} model=${d.model.padEnd(8)} spawn.enabled=${String(d.spawn.enabled).padEnd(5)} spawn.allowedTypes=${JSON.stringify(d.spawn.allowedTypes ?? null).padEnd(50)} safety=${swTag} context=${cbTag} templates=${JSON.stringify(d.templates)}`);
}

// Every toolSets entry must be a real factory name, or "spawn" (special-cased
// in resolveToolSets and a no-op there: spawn.enabled alone grants the
// spawn tool, spawn.ts:459). An unknown name is only a console warning at spawn time
// and the agent silently runs WITHOUT that capability — observed 2026-08-23:
// prior_art_auditor declared toolSets: [search] (an agent type, not a
// toolSet) and would have spawned with no way to search.
const VALID_TOOL_SETS = new Set(["coding", "report", "authority", "pi", "wolfram", "exit", "figure-gen", "spawn"]);
for (const [name, d] of defs) {
  for (const ts of d.toolSets ?? []) {
    if (!VALID_TOOL_SETS.has(ts)) {
      console.log(`FAIL ${name}: unknown toolSet "${ts}" (valid: ${[...VALID_TOOL_SETS].join(", ")}) — agent would spawn without it`);
      failures++;
    }
  }
  // Every allowedType must name a definition that exists.
  for (const t of d.spawn.allowedTypes ?? []) {
    if (!defs.has(t)) { console.log(`FAIL ${name}: spawn.allowedTypes names unknown agent "${t}"`); failures++; }
  }
}

const exp = defs.get("experiment")!;
for (const n of ["tool_impl", "tool_review"]) {
  if (!exp.spawn.allowedTypes?.includes(n)) {
    console.log(`FAIL experiment.spawn.allowedTypes missing: ${n}`);
    failures++;
  }
}

// §C34 — the harness spawns the replicator in estimate mode with no ROUTE, so
// rendering both mode blocks handed the estimator a literal {{ROUTE}} and an
// instruction to write replication/results.json. Estimate mode must render
// only its own block; replicate mode reuses the estimate block's line format
// and MODE-unset callers expect the template as written, so both stay byte-
// identical to plain expansion.
{
  const check = (label: string, ok: boolean) => {
    if (!ok) { console.log(`FAIL C34 ${label}`); failures++; }
    else console.log(`ok   C34 ${label}`);
  };
  const rep = getDefinition("replicator");
  const base = { PROJECT_DIR: "/p", EXPERIMENT_ID: "E1_c34", QUANTITY_ID: "q_c34" };
  const est = resolvePrompt(rep, { ...base, MODE: "estimate" });
  check("estimate render keeps <estimate_mode>", est.includes("<estimate_mode>"));
  check("estimate render keeps <hard_rules>", est.includes("<hard_rules>"));
  check("estimate render keeps the ESTIMATE(blind) line", est.includes("ESTIMATE(blind): q_c34 —"));
  check("estimate render has no <replicate_mode>", !est.includes("<replicate_mode>"));
  check("estimate render has no replication/results.json", !est.includes("replication/results.json"));
  check("estimate render has no '{{'", !est.includes("{{"));
  check("estimate render leaves one blank line between blocks", est.includes("</estimate_mode>\n\n<hard_rules>"));
  // 2026-10-25: a third block, <check_mode> (the verifier seat), is rendered only
  // in check mode, so "plain expansion" is now the template minus that block.
  const CHECK_MODE_RE = /\n*<check_mode>[\s\S]*?<\/check_mode>/;
  check("the template has a <check_mode> block (smoke_verifier_seat §F renders it)", CHECK_MODE_RE.test(rep.systemPromptTemplate));
  for (const [label, vars] of [
    ["replicate", { ...base, MODE: "replicate", ROUTE: "x" }],
    ["MODE unset", base],
  ] as const) {
    check(`${label} render byte-identical to plain expansion minus the check block`,
      resolvePrompt(rep, vars) === expandTemplate(rep.systemPromptTemplate.replace(CHECK_MODE_RE, ""), vars));
    check(`${label} render has no <check_mode>`, !resolvePrompt(rep, vars).includes("<check_mode>"));
  }
  const noBlock = { ...rep, systemPromptTemplate: rep.systemPromptTemplate.replace(/<replicate_mode>[\s\S]*?<\/replicate_mode>/, "") };
  let threw = false;
  try { resolvePrompt(noBlock, { ...base, MODE: "estimate" }); } catch { threw = true; }
  check("estimate render throws when <replicate_mode> anchor is gone", threw);
}

// §C44 — prompt <-> code. Each check pins a sentence in a definition to the
// code that has to agree with it; every one of these was a live contradiction
// (a template the finish gate rejects, a PI parameter the schema lacks, a
// marker nothing emits, a file the brain may not write).
{
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) { console.log(`FAIL C44 ${label}${detail ? `  — ${detail}` : ""}`); failures++; }
    else console.log(`ok   C44 ${label}`);
  };
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const DEFS = join(ROOT, "src/agents/definitions");
  const body = (raw: string) => raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const front = (raw: string) => (raw.match(/^---\n([\s\S]*?)\n---\n/) ?? ["", ""])[1];
  const mdFiles = readdirSync(DEFS).filter((f) => f.endsWith(".md"));
  const brainRaw = readFileSync(join(DEFS, "brain.md"), "utf-8");
  // Backticks and bold are formatting, not wording.
  const plain = (s: string) => s.replace(/`|\*\*/g, "");

  // (a) the outline template, copied literally, passes the finish gate's
  // outline check. report.tex must exist or reportIntegrityIssues returns [].
  const outlineIssues = (outline: string) => {
    const dir = mkdtempSync(join(tmpdir(), "c44-outline-"));
    try {
      mkdirSync(join(dir, "notes")); mkdirSync(join(dir, "report"));
      writeFileSync(join(dir, "notes", "report_outline.md"), outline);
      writeFileSync(join(dir, "report", "report.tex"), "\\documentclass{article}\\begin{document}x\\end{document}\n");
      return reportIntegrityIssues(dir).filter((i) => i.kind === "outline");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const tpl = brainRaw.match(/\*\*Outline format — mandatory:\*\*\s*\n\s*```\n([\s\S]*?)```/);
  check("(a) brain.md outline template found", !!tpl);
  const ex = readFileSync(join(ROOT, "skills/review/references/exemplar_survey_outline.md"), "utf-8").match(/```markdown\n([\s\S]*?)```/);
  check("(a) control: survey exemplar outline passes the outline gate", !!ex && outlineIssues(ex[1]).length === 0);
  const tplIssues = tpl ? outlineIssues(tpl[1]) : [];
  check("(a) brain.md outline template passes the outline gate", !!tpl && tplIssues.length === 0, tplIssues.map((i) => i.text.slice(0, 110)).join(" | "));

  // (b) request_pi_review(...) examples name only schema parameters.
  const piParams = new Set(Object.keys((createPIReviewTool({ projectDir: tmpdir() }).tool.parameters as any).properties));
  for (const f of mdFiles) {
    const text = body(readFileSync(join(DEFS, f), "utf-8"));
    for (const hit of text.matchAll(/request_pi_review\(/g)) {
      const start = hit.index! + hit[0].length;
      let i = start, depth = 1, q: string | null = null;
      while (i < text.length && depth > 0) {
        const c = text[i++];
        if (q) { if (c === q) q = null; }
        else if (c === '"' || c === "`" || c === "'") q = c;
        else if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      const line = text.slice(0, hit.index).split("\n").length;
      if (depth > 0) { check(`(b) ${f} body line ${line}: request_pi_review( is closed`, false); continue; }
      const bare = text.slice(start, i - 1).replace(/"[^"]*"|`[^`]*`|'[^']*'/g, "");
      const names = [...bare.matchAll(/(?:^|,)\s*(\w+)\s*=/g)].map((m) => m[1]);
      const bad = names.filter((n) => !piParams.has(n));
      if (names.length) check(`(b) ${f} body line ${line}: request_pi_review(${names.join(",")}) uses schema params`, bad.length === 0, `unknown: ${bad.join(",")}; schema: ${[...piParams].join(",")}`);
    }
  }

  // (c) every multi-word [ALLCAPS ...] marker a definition tells the agent to
  // watch for is emitted somewhere in src/ (outside the definitions).
  const tsFiles: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (e !== "definitions") walk(p); }
      else if (p.endsWith(".ts")) tsFiles.push(p);
    }
  };
  walk(join(ROOT, "src"));
  const corpus = tsFiles.map((p) => readFileSync(p, "utf-8")).join("\n");
  for (const f of mdFiles) {
    const text = body(readFileSync(join(DEFS, f), "utf-8"));
    for (const m of new Set([...text.matchAll(/\[([A-Z]{2,}(?: [A-Z]{2,})+)[\]:\s—]/g)].map((x) => x[1]))) {
      check(`(c) ${f}: [${m}] has an emitter in src/`, corpus.includes("[" + m));
    }
  }

  // (d) agent.ts runs the brain at its own default, not the frontmatter's.
  const agentTs = readFileSync(join(ROOT, "src/agent.ts"), "utf-8");
  const runs = agentTs.match(/opts\.thinkingLevel \?\? "(\w+)"/)?.[1];
  const declared = front(brainRaw).match(/^thinkingLevel:\s*(\S+)/m)?.[1];
  check("(d) agent.ts brain thinkingLevel default found", !!runs);
  check("(d) brain.md thinkingLevel absent or equal to what agent.ts runs", declared === undefined || declared === runs, `brain.md=${declared} agent.ts=${runs}`);

  // (e) every spawn_agent(agent="X") example in brain.md is spawnable by brain.
  const brainDef = defs.get("brain")!;
  const brainAllowed = new Set(brainDef.spawn.allowedTypes ?? []);
  const examples = new Set([...body(brainRaw).matchAll(/spawn_agent\(agent="(\w+)"/g)].map((m) => m[1]));
  const notAllowed = [...examples].filter((n) => !brainAllowed.has(n));
  check("(e) brain.md spawn_agent examples are in brain's allowedTypes", examples.size > 0 && notAllowed.length === 0, `not allowed: ${notAllowed.join(",")}`);

  // (f) brain is not told to update a file its safety wrapper blocks.
  const notesLine = body(brainRaw).split("\n").find((l) => l.includes("update the relevant notes file"));
  check("(f) brain.md 'update the relevant notes file' line found", !!notesLine);
  const named = [...(notesLine ?? "").matchAll(/[\w.-]+\.md\b/g)].map((m) => m[0]);
  const protectedHit = named.filter((n) => (brainDef.safety?.protectedFiles ?? []).some((p) => p === n || p.endsWith("/" + n)));
  check("(f) no file on that line is in brain's protectedFiles", named.length > 0 && protectedHit.length === 0, `protected: ${protectedHit.join(",")}`);

  // (g) the experiment task template carries no 'downstream notes' (brain does
  // not own the ledger the experiment writes).
  const expTask = body(brainRaw).match(/spawn_agent\(agent="experiment",\s*\n\s*task="([^"]*)"/)?.[1];
  check("(g) brain.md experiment task template found", expTask !== undefined);
  check("(g) experiment task template has no 'downstream'", expTask !== undefined && !/downstream/i.test(expTask), expTask);

  // (h) experiment.md says once, outside <role_separation> so the solo
  // derivation keeps it, who writes which part of the L2 section.
  const orch = plain(defs.get("experiment")!.systemPromptTemplate);
  const solo = plain(soloExperimentDefinition(defs.get("experiment")!).systemPromptTemplate);
  const stub = "You write only the ## L2.N stub with Status: Pending (Phase 1); the section body and its final Status line are written by the ledger_writer you spawn at the end of Phase 3.";
  check("(h) orchestrator does not claim to write the L2 section directly", !orch.includes("write directly: the notes/experiments.md L2 section"));
  check("(h) orchestrator does not edit the stub 'in place to Complete'", !orch.includes("in place to Complete"));
  check("(h) orchestrator states the Pending-stub / ledger_writer split", orch.includes(stub));
  check("(h) solo derivation keeps the Pending-stub / ledger_writer split", solo.includes(stub));
  // ledger_writer's section format has no FollowUp, so the "only the stub"
  // rule must carve out the block <fail_forward_protocol> obliges; otherwise
  // the two strict blocks disagree and the lead never reaches parseFollowUps.
  const scope = (s: string) => s.match(/<scope_boundary strict="true">([\s\S]*?)<\/scope_boundary>/)?.[1] ?? "";
  for (const [label, p] of [["orchestrator", orch], ["solo derivation", solo]] as const) {
    check(`(h) ${label} obliges a ### FollowUp: block`, p.includes("MUST append a ### FollowUp: block"));
    check(`(h) ${label} <scope_boundary> says the experiment appends the FollowUp block itself`, scope(p).includes("### FollowUp:") && scope(p).includes("you append it"));
  }
}

// §C55 — net-growth ratchet on the brain and experiment bodies. Their
// contradictions come from additions that never deleted what they superseded
// (the plan gate went "optional" at 15:42 on 2026-04-19 and came back
// "MANDATORY" at 22:29 with the "optional" lines left in). A body may pass its
// pre-ratchet size only by bytes the ledger in prompt-budget.json accounts
// for: each entry names the metric the new text moves, the script that
// measures it, the item it came from and the text it replaced. Deletions are
// logged as negative entries, so the room they free is not later spent by a
// ceiling raise with no entry.
{
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) { console.log(`FAIL C55 ${label}${detail ? `  — ${detail}` : ""}`); failures++; }
    else console.log(`ok   C55 ${label}`);
  };
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const MANIFEST = join(ROOT, "src/agents/definitions/prompt-budget.json");
  // Body bytes before the ratchet: 2026-10-09, before the C4/C15/C26/C44/C84 edits.
  const BASELINE: Record<string, number> = { brain: 91208, experiment: 48603 };
  const WARN_UNDER = 1024;
  // The file's body, not getDefinition's: under LUXAS_EXPERIMENT_MODE=solo
  // that is the derived prompt.
  const sizes: Record<string, number> = Object.fromEntries([...defs].map(([n, d]) => [n, Buffer.byteLength(d.systemPromptTemplate, "utf8")]));
  const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const baselined = (name: unknown) => Object.hasOwn(BASELINE, String(name));
  const logged = (m: any, name: string) => (Array.isArray(m?.growth) ? m.growth : [])
    .filter((g: any) => g?.agent === name && Number.isInteger(g?.bytes)).reduce((s: number, g: any) => s + g.bytes, 0);

  // One function judges the real bodies and the synthetic ones below.
  const budgetProblems = (m: any, bodies: Record<string, number>) => {
    const fail: string[] = [], warn: string[] = [];
    if (!Array.isArray(m?.growth)) fail.push("growth is not an array");
    const budgeted = Object.keys(m ?? {}).filter((k) => k !== "growth" && !k.startsWith("$"));
    for (const name of new Set([...Object.keys(BASELINE), ...budgeted])) {
      const ceiling = m?.[name]?.ceilingBytes;
      if (!Number.isInteger(ceiling) || ceiling <= 0) { fail.push(`${name}: no integer ceilingBytes`); continue; }
      if (!baselined(name)) { fail.push(`${name}: has a ceiling but no pinned BASELINE in §C55`); continue; }
      const body = bodies[name];
      if (body === undefined) { fail.push(`${name}: no such definition`); continue; }
      if (body > ceiling) fail.push(`${name}: body ${body} B > ceiling ${ceiling} B — delete what the new text supersedes, or log a growth entry and raise the ceiling by it`);
      else if (ceiling - body > WARN_UNDER) warn.push(`${name}: body ${body} B is ${ceiling - body} B under its ceiling — lower ceilingBytes and log the deletion`);
      const allowance = BASELINE[name] + logged(m, name);
      if (ceiling > allowance) fail.push(`${name}: ceiling ${ceiling} B > baseline ${BASELINE[name]} B + logged growth ${allowance - BASELINE[name]} B — a ceiling rises only with a growth entry`);
      else if (ceiling < allowance) warn.push(`${name}: ceiling is ${allowance - ceiling} B below baseline + logged growth — log the deletion that lowered it, or a later raise of up to that much needs no entry`);
    }
    (Array.isArray(m?.growth) ? m.growth : []).forEach((g: any, i: number) => {
      const at = `growth[${i}] ${filled(g?.item) ? g.item : "?"}`;
      if (!baselined(g?.agent)) fail.push(`${at}: agent ${JSON.stringify(g?.agent)} has no pinned BASELINE`);
      if (!filled(g?.item)) fail.push(`${at}: no item or commit`);
      if (!Number.isInteger(g?.bytes) || g.bytes === 0) fail.push(`${at}: bytes is not a non-zero integer`);
      if (!filled(g?.supersedes)) fail.push(`${at}: no supersedes (the text deleted in the same diff, or 'none')`);
      // Growth says what it moves and who measures it; a deletion only says what it deleted.
      if (g?.bytes > 0) {
        if (!filled(g?.metric)) fail.push(`${at}: no metric`);
        const by = filled(g?.measuredBy) ? join(ROOT, g.measuredBy) : "";
        if (!by || !existsSync(by) || !statSync(by).isFile()) fail.push(`${at}: measuredBy ${JSON.stringify(g?.measuredBy)} is not a file in the repo`);
      } else if (g?.bytes < 0 && g?.supersedes === "none") fail.push(`${at}: a deletion must quote what it deleted`);
    });
    return { fail, warn };
  };

  const present = existsSync(MANIFEST);
  check("(i) src/agents/definitions/prompt-budget.json exists", present);
  let m: any = {};
  if (present) {
    try { m = JSON.parse(readFileSync(MANIFEST, "utf-8")); } catch (e: any) { check("(i) prompt-budget.json parses", false, e?.message); }
  }
  for (const name of Object.keys(BASELINE)) check(`(i) manifest budgets ${name}`, Number.isInteger(m?.[name]?.ceilingBytes));
  const real = budgetProblems(m, sizes);
  for (const w of real.warn) console.log(`WARN C55 ${w}`);
  check("(ii)-(iv) bodies within ceilings, ceilings within baseline + logged growth, entries well-formed", real.fail.length === 0, real.fail.join(" | "));
  for (const name of Object.keys(BASELINE)) {
    const ceiling = m?.[name]?.ceilingBytes;
    if (!Number.isInteger(ceiling)) { check(`(v) ${name}: synthetic checks`, false, "no ceiling to test against"); continue; }
    console.log(`     C55 ${name}: body ${sizes[name]} B, ceiling ${ceiling} B, baseline ${BASELINE[name]} B + logged ${logged(m, name)} B`);
    check(`(v) ${name}: a body of ceiling+1 bytes fails`,
      budgetProblems(m, { ...sizes, [name]: ceiling + 1 }).fail.some((f) => f.startsWith(`${name}: body`)));
    check(`(v) ${name}: a ceiling raised past baseline + logged growth with no entry fails`,
      budgetProblems({ ...m, [name]: { ceilingBytes: BASELINE[name] + logged(m, name) + 1 } }, sizes).fail.some((f) => f.startsWith(`${name}: ceiling`)));
    const under = budgetProblems(m, { ...sizes, [name]: ceiling - WARN_UNDER - 1 });
    check(`(vi) ${name}: a body more than 1 KB under its ceiling only warns`,
      !under.fail.some((f) => f.startsWith(`${name}: body`)) && under.warn.some((w) => w.startsWith(`${name}: body`)));
  }
  const bare = budgetProblems({ ...m, growth: [...(Array.isArray(m?.growth) ? m.growth : []), { agent: "brain", item: "synthetic", bytes: 1, supersedes: "none" }] }, sizes).fail;
  check("(iv) a growth entry with no metric and no measuredBy fails", bare.some((f) => f.includes("synthetic: no metric")) && bare.some((f) => f.includes("synthetic: measuredBy")));
}

// §F9 — what the brain is told about the ledger matches what it can do. It
// cannot write notes/experiments.md, so no text asks it to; the block it gets
// when it tries names ledger_writer, which the freeze admits, for a finding
// line (re-spawning experiment past 90% is refused). Its done rule names a
// status the claim table can produce (CORROBORATED was retired 2026-09-04).
// And the finding_answered template ledger_writer.md teaches, filled in, is a
// line reviewOpenIssues credits: the writer is the agent that writes it.
{
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) { console.log(`FAIL F9 ${label}${detail ? `  — ${detail}` : ""}`); failures++; }
    else console.log(`ok   F9 ${label}`);
  };
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const DEFS = join(ROOT, "src/agents/definitions");
  const body = (raw: string) => raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const brain = getDefinition("brain");
  const brainProtected = brain.safety?.protectedFiles ?? [];
  const tmp = mkdtempSync(join(tmpdir(), "f9-"));
  try {
    // (a) "write down …" lists only files the brain may write.
    const writeDown = (text: string) => text.match(/Write down anything held only in this conversation \(([^)]*)\)/)?.[1];
    const proj = join(tmp, "proj");
    mkdirSync(join(proj, ".agent"), { recursive: true });
    writeFileSync(join(proj, ".agent", "run_config.json"), JSON.stringify({ maxCost: 100 }));
    writeFileSync(join(proj, ".agent", "usage.log"), "1788000000000\tm\tp\t1\t1\t0\t0\t95\n");
    const hooks = buildResearchHooks({ projectDir: proj, maxCostUsd: 100, usageLogPath: join(proj, ".agent", "usage.log") } as any);
    const deny = String((await hooks.before({ toolCall: { name: "bash" }, args: { command: "ls" } }))?.reason ?? "");
    for (const [label, text] of [["context.ts <budget_status>", buildBudgetStatus(proj)], ["hooks.ts soft-cap deny", deny]] as const) {
      const files = writeDown(text);
      check(`(a) ${label}: 'Write down …' line found`, files !== undefined, text.slice(0, 120));
      const hit = (files ?? "").split(/,\s*/).filter((f) => brainProtected.includes(f.trim()));
      check(`(a) ${label}: lists no file in brain's protectedFiles`, files !== undefined && hit.length === 0, `protected: ${hit.join(",")}`);
    }

    // (b) the protectedFiles block names the route that is open in the freeze.
    const stub = (name: string) => ({ name, label: name, description: "stub", parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }) });
    const tools: any[] = buildSafetyWrapper(brain.safety)!([stub("edit"), stub("write")], proj,
      { PROJECT_DIR: proj, SISYPHUS_DIR: join(tmp, "sisyphus") }, undefined);
    const [edit, write] = tools;
    const textOf = (r: any) => String(r?.content?.[0]?.text ?? "");
    const blocks: [string, string][] = [
      ["edit", textOf(await edit.execute("e1", { path: "notes/experiments.md", edits: [{ oldText: "a", newText: "b" }] }))],
      ["write", textOf(await write.execute("w1", { path: "notes/experiments.md", content: "x" }))],
    ];
    for (const [tool, text] of blocks) {
      check(`(b) ${tool} of notes/experiments.md is blocked as protected`, /is protected/.test(text), text.slice(0, 120));
      check(`(b) ${tool} block routes a round-bound ledger line to ledger_writer`,
        /spawn_agent\(agent="ledger_writer"/.test(text) && /finding_answered: r<R> #<N>/.test(text), text.slice(0, 400));
      check(`(b) ${tool} block keeps experiment for revising the science`, /spawn_agent\(agent="experiment"/.test(text), text.slice(0, 400));
    }
    check("(b) ledger_writer is open inside the cost freeze", finalizationAllows("spawn_agent", "ledger_writer", false));
    const other = textOf(await edit.execute("e2", { path: "reviews/pi_feedback.md", edits: [{ oldText: "a", newText: "b" }] }));
    check("(b) another protected file's block does not offer ledger_writer", /is protected/.test(other) && !/ledger_writer/.test(other), other.slice(0, 200));

    // (c) CORROBORATED is not a claim status. `xval:CORROBORATED` is the
    // report registry's grade and is live.
    // The render caps reach the report_writer twice, in its definition and in
    // the line context-builders.ts appends to <claim_status>; both named the
    // removed status until 2026-10-09. Dropping the clause moves no cap:
    // CONVERGING keeps its one-clause hedge.
    const CLAIM_STATUSES = ["CONVERGING", "INDICATIVE", "CONDITIONAL", "DISPUTED", "DISCLOSED"];   // claims-table.ts ClaimStatus, as rendered
    const capsNamed = (text: string) => (text.match(/Render caps[^\n]*/)?.[0] ?? "").match(/\b[A-Z]{8,}\b/g) ?? [];
    const inCtx = capsNamed(resolveContextBuilder("report_writer")!(join(ROOT, "fixtures", "claims-297nm", "retrofit")));
    check("(c) the render caps injected beside <claim_status> name only statuses the claim table has",
      inCtx.length >= 4 && inCtx.every((w) => CLAIM_STATUSES.includes(w)), `named: ${inCtx.join(", ") || "(no Render caps line)"}`);
    const inDef = capsNamed(readFileSync(join(DEFS, "report_writer.md"), "utf-8"));
    check("(c) report_writer.md's render caps name only statuses the claim table has",
      inDef.length >= 4 && inDef.every((w) => CLAIM_STATUSES.includes(w)), `named: ${inDef.join(", ") || "(no Render caps sentence)"}`);
    for (const f of readdirSync(DEFS).filter((x) => x.endsWith(".md"))) {
      const text = body(readFileSync(join(DEFS, f), "utf-8")).replaceAll("xval:CORROBORATED", "");
      const line = text.split("\n").findIndex((l) => /\bCORROBORATED\b/.test(l));
      check(`(c) ${f} names no CORROBORATED claim status`, line < 0, line < 0 ? "" : `body line ${line + 1}`);
    }

    // (d) ledger_writer.md's finding_* templates, filled in, are what the gate credits.
    const lw = body(readFileSync(join(DEFS, "ledger_writer.md"), "utf-8"));
    const expMd = body(readFileSync(join(DEFS, "experiment.md"), "utf-8"));
    const answeredTpl = (t: string) => t.match(/`(finding_answered:[^`]*)`/)?.[1];
    const lwAnswered = answeredTpl(lw);
    const lwOpen = lw.match(/`(finding_open:[^`]*)`/)?.[1];
    const lwRange = lw.match(/`(r<R> issues [^`]*)`/)?.[1];
    check("(d) ledger_writer.md finding_answered template binds a round and an issue", !!lwAnswered && lwAnswered.includes("r<R> #<N>"), lwAnswered);
    check("(d) ledger_writer.md shows the range form", !!lwRange, lwRange);
    const issues = [
      "The clock list in computed.clock_points omits a smooth 163 clock at 484.7 G that the scan itself shows.",
      "The 277 s coherence floor uses the unshielded field noise and ignores the shield factor measured in E2.",
      "No convergence test in the basis cutoff is reported for the hyperfine matrix at the highest field.",
    ];
    const fill = (tpl: string, r: number) => tpl.replace(/<R>/g, String(r)).replace(/<N>/g, "1")
      .replace(/<[^<>]*clause[^<>]*>/, "the omitted clock point is now listed")
      .replace(/<locator[^<>]*>/, "runs/run_2/results.json")
      .replace(/<[^<>]*Issue N[^<>]*>/, issues[0].split(" ").slice(0, 9).join(" "));
    // One REVISE round 2 with three issues; the line is the ledger's only Limitations entry.
    const finding = (line: string) => {
      const p = join(tmp, `ledger-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(p, "reviews"), { recursive: true }); mkdirSync(join(p, "notes"));
      writeFileSync(join(p, "reviews", "experiment_review_E1_clock_r2.md"),
        `VERDICT: revise\nFEEDBACK:\n${issues.map((t, i) => `- Issue ${i + 1}: ${t}`).join("\n")}\n`);
      writeFileSync(join(p, "notes", "experiments.md"), `# Ledger\n\n## L2.1 — clock points\n**Status:** Complete\n\n### Limitations\n- ${line}\n`);
      return { blocking: reviewOpenIssues(p).filter((i) => i.blocking).length, f: openReviewFindings(p).get("E1") };
    };
    // Control: the round-less form the gate rejects, so the fixture discriminates.
    check("(d) control: a round-less finding_answered leaves Issue 1 blocking",
      finding("finding_answered: the omitted clock point is now listed — runs/run_2/results.json").blocking === 1);
    for (const [label, tpl] of [["ledger_writer.md", lwAnswered], ["experiment.md", answeredTpl(expMd)]] as const) {
      const line = tpl ? fill(tpl, 2) : "";
      const got = finding(line);
      check(`(d) ${label} finding_answered, filled for round 2, answers Issue 1`, !!tpl && got.blocking === 0 && got.f?.answered === true, line);
      check(`(d) ${label} finding_answered filled for round 1 answers nothing in round 2`, !!tpl && finding(fill(tpl, 1)).blocking === 1);
    }
    const ranged = lwAnswered && lwRange ? fill(lwAnswered.replace("r<R> #<N>", lwRange), 2) : "";
    const rangeGot = finding(ranged);
    check("(d) ledger_writer.md range form answers issues 1–3", !!ranged && (rangeGot.f?.issues ?? []).length === 3 && rangeGot.f!.issues.every((i) => i.answered), ranged);
    const openLine = lwOpen ? fill(lwOpen, 2) : "";
    const openGot = finding(openLine);
    check("(d) ledger_writer.md finding_open, filled with ≥8 words of Issue 1, discloses it", !!lwOpen && openGot.blocking === 0 && openGot.f?.quoted === true, openLine);

    // The round the writer answers is the round the parser reads. A reviewer
    // that gave no review leaves persistReview's `VERDICT: (none — …)`, which
    // is not a vote: a trigger that counts it sends the writer to round 3
    // while finish() reads round 2.
    const trigger = lw.match(/When the latest `reviews\/experiment_review_\{\{EXPERIMENT_ID\}\}_r<R>\.md`([^\n]*?)says `VERDICT: revise`/)?.[1];
    check("(d) ledger_writer.md's trigger names the review file it reads", trigger !== undefined);
    const votes = [...(trigger ?? "").matchAll(/`(satisfied|revise)`/g)].map((m) => m[1]);
    const dead = join(tmp, "dead-reviewer");
    persistReview(dead, "E1_clock", 2, [], [], "VERDICT: revise", [], issues.map((t, i) => `- Issue ${i + 1}: ${t}`).join("\n"));
    persistReview(dead, "E1_clock", 3, [], [], "VERDICT: (none — reviewer gave no review: timeout)", ["q"]);
    // The trigger's rule applied to the files; naming no verdict, it counts any VERDICT line.
    const writerRound = Math.max(0, ...readdirSync(join(dead, "reviews")).flatMap((f) => {
      const v = readFileSync(join(dead, "reviews", f), "utf-8").match(/^VERDICT:\s*(\S+)/m)?.[1];
      return v !== undefined && (votes.length === 0 || votes.includes(v)) ? [Number(f.match(/_r(\d+)\.md$/)![1])] : [];
    }));
    const parserRound = openReviewFindings(dead).get("E1")?.round;
    check("(d) after a no-review round, the trigger picks the round the parser reads", writerRound === parserRound, `writer r${writerRound}, parser r${parserRound}`);
    mkdirSync(join(dead, "notes"));
    const deadBlocking = (line: string) => {
      writeFileSync(join(dead, "notes", "experiments.md"), `# Ledger\n\n## L2.1 — clock points\n**Status:** Complete\n\n### Limitations\n- ${line}\n`);
      return reviewOpenIssues(dead).filter((i) => i.blocking).length;
    };
    check("(d) after a no-review round, the line written for the trigger's round clears Issue 1", !!lwAnswered && deadBlocking(fill(lwAnswered, writerRound)) === 0);
    check("(d) a line labelled for the no-review round answers nothing", !!lwAnswered && deadBlocking(fill(lwAnswered, 3)) === 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures === 0) {
  console.log(`\nPASS — ${checked.length} agent defs load & wire up cleanly`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
